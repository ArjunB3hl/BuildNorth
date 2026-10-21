"""Weekly planner: plan range, AI proposals, confirmed changes and the weekly review.

Proposals and change previews never write anything. Saving happens only through
`/planner/accept` and `/plan/changes`, which re-validate every item against the user's
own records, run in one transaction, and are idempotent for retries and double taps.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import health, planner, user_context
from app import preferences as prefs
from app.ai import AIError
from app.deps import CurrentUser, Db, Memory, OptionalAI, ai_failure, not_found
from app.models import PlanItem
from app.plan_changes import PlanChangeError, apply_plan_changes, check_owned
from app.schemas import (
    AcceptIn,
    AcceptOut,
    ApplyChangesIn,
    ApplyChangesOut,
    ChangePreviewOut,
    ChangeRequest,
    PlanItemOut,
    PlannerRequest,
    PlanRangeOut,
    ProposalOut,
    WeeklyReviewOut,
)

router = APIRouter(tags=["planner"])
DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
SLOT_ORDER = {"morning": 0, "midday": 1, "evening": 2}


def _day(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Dates must be YYYY-MM-DD.") from exc


def _out(items: list[PlanItem]) -> list[PlanItemOut]:
    ordered = sorted(items, key=lambda i: (i.date, SLOT_ORDER.get(i.time_slot or "", 3), i.created_at))
    return [PlanItemOut.model_validate(i) for i in ordered]


def _check_owned(db: Db, user_id: str, recipe_ids: set[str], routine_ids: set[str]) -> None:
    try:
        check_owned(db, user_id, recipe_ids, routine_ids)
    except PlanChangeError as exc:
        raise not_found(exc.message.removesuffix(" not found.")) from exc


@router.get("/plan")
def plan_range(user: CurrentUser, db: Db, start: str = Query(pattern=DATE_PATTERN), days: int = Query(default=7, ge=1, le=31)) -> PlanRangeOut:
    first = _day(start)
    end = (date.fromisoformat(first) + timedelta(days=days)).isoformat()
    items = db.scalars(select(PlanItem).where(PlanItem.user_id == user.user_id, PlanItem.date >= first, PlanItem.date < end))
    return PlanRangeOut(start=first, days=days, items=_out(list(items)))


@router.post("/planner/proposals")
def propose(body: PlannerRequest, user: CurrentUser, db: Db, memory: Memory, ai: OptionalAI) -> ProposalOut:
    """Draft a week. Nothing is saved. Without AI, the week is filled only from the selected recipes and routines.
    Long-term memory is checked first (shared user context); the draft says if it couldn't be."""
    _check_owned(db, user.user_id, set(body.recipe_ids), set(body.routine_ids))
    if prefs.sync_pending(db, memory, user.user_id):
        health.sync_pending_health(db, memory, user.user_id)
    request = " ".join(filter(None, ["Weekly meals and workouts plan.", body.note]))
    ctx = user_context.gather(db, memory, user.user_id, request, recall_k=5, include_records=False)
    try:
        return planner.propose(ai, db, user.user_id, body,
                               memory_notes=[n.text for n in ctx.memory_notes], memory_status=ctx.memory.status)
    except AIError as exc:
        raise ai_failure(exc) from exc


@router.post("/planner/accept")
def accept(body: AcceptIn, user: CurrentUser, db: Db) -> AcceptOut:
    """Save accepted proposal items in one transaction. Repeating a request never duplicates items."""
    meal_recipes = {i.recipe_id for i in body.items if i.recipe_id and i.kind == "meal"}
    routines = {i.routine_id for i in body.items if i.routine_id and i.kind == "activity"}
    _check_owned(db, user.user_id, meal_recipes, routines)
    keyed = {f"p:{body.proposal_id}:{i.key}": i for i in body.items}
    if len(keyed) != len(body.items):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each item needs a different key.")

    def saved() -> dict[str, PlanItem]:
        rows = db.scalars(select(PlanItem).where(PlanItem.user_id == user.user_id, PlanItem.client_key.in_(keyed)))
        return {row.client_key: row for row in rows if row.client_key}

    existing = saved()
    created = 0
    for client_key, item in keyed.items():
        if client_key in existing:
            continue
        db.add(
            PlanItem(
                user_id=user.user_id,
                date=item.date,
                kind=item.kind,
                title=item.title,
                time_slot=item.time_slot,
                recipe_id=item.recipe_id if item.kind == "meal" else None,
                routine_id=item.routine_id if item.kind == "activity" else None,
                minutes=item.minutes,
                note=item.idea,
                source="planner",
                client_key=client_key,
            )
        )
        created += 1
    try:
        db.commit()
    except IntegrityError:
        # A concurrent duplicate of this request won the race; it saved the same items.
        db.rollback()
        created = 0
    rows = saved()
    return AcceptOut(items=_out(list(rows.values())), created=created, already_saved=len(keyed) - created)


@router.post("/planner/changes")
def preview_changes(body: ChangeRequest, user: CurrentUser, db: Db, ai: OptionalAI) -> ChangePreviewOut:
    """Turn a request like "move Thursday's workout to Saturday" into exact proposed changes. Nothing is saved."""
    _day(body.today)
    try:
        return planner.preview_changes(ai, db, user.user_id, body)
    except AIError as exc:
        raise ai_failure(exc) from exc


PLAN_ERROR_STATUS = {"not_found": status.HTTP_404_NOT_FOUND, "stale": status.HTTP_409_CONFLICT, "invalid": status.HTTP_422_UNPROCESSABLE_CONTENT}


@router.post("/plan/changes")
def apply_changes(body: ApplyChangesIn, user: CurrentUser, db: Db) -> ApplyChangesOut:
    """Apply confirmed changes all-or-nothing. Done/skipped items can't be changed. Retries are no-ops."""
    try:
        already, touched = apply_plan_changes(db, user.user_id, body.change_set_id, body.changes)
    except PlanChangeError as exc:
        raise HTTPException(PLAN_ERROR_STATUS[exc.kind], exc.message) from exc
    return ApplyChangesOut(already_applied=already, items=[] if already else _out(touched))


@router.get("/review/week")
def review_week(user: CurrentUser, db: Db, end: str = Query(pattern=DATE_PATTERN)) -> WeeklyReviewOut:
    """Facts from the last 7 days of records. No AI and no memory involved."""
    return planner.weekly_review(db, user.user_id, _day(end))
