"""Today's plan, daily check-ins and progress."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, Db, not_found
from app.models import ActivitySession, CheckIn, PlanItem, Recipe, Routine, utcnow
from app.progress import compute_progress
from app.schemas import CheckInIn, CheckInOut, PlanItemIn, PlanItemOut, PlanItemPatch, ProgressOut, TodayOut

router = APIRouter(tags=["daily"])


def _parse_date(value: str) -> str:
    """The user's local calendar date (YYYY-MM-DD); the client decides what "today" is."""
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Dates must be YYYY-MM-DD.") from exc


def set_plan_status(item: PlanItem, value: str) -> None:
    """Done stamps completedAt; planned or skipped clear it. Shared with the watch (routers/watch.py)."""
    item.status = value
    item.completed_at = utcnow() if value == "done" else None


def _plan_for(db: Db, user_id: str, day: str) -> list[PlanItemOut]:
    items = db.scalars(
        select(PlanItem).where(PlanItem.user_id == user_id, PlanItem.date == day).order_by(PlanItem.created_at)
    )
    order = {"morning": 0, "midday": 1, "evening": 2, None: 3}
    return sorted((PlanItemOut.model_validate(i) for i in items), key=lambda i: order.get(i.time_slot, 3))


@router.get("/today")
def today(user: CurrentUser, db: Db, date_: str = Query(alias="date", pattern=r"^\d{4}-\d{2}-\d{2}$")) -> TodayOut:
    day = _parse_date(date_)
    checkin = db.scalar(select(CheckIn).where(CheckIn.user_id == user.user_id, CheckIn.date == day))
    return TodayOut(
        date=day,
        items=_plan_for(db, user.user_id, day),
        check_in=CheckInOut.model_validate(checkin) if checkin else None,
    )


@router.post("/plan", status_code=status.HTTP_201_CREATED)
def add_plan_item(body: PlanItemIn, user: CurrentUser, db: Db) -> PlanItemOut:
    # Links must point at the user's own records; anything else is rejected, not silently kept.
    if body.recipe_id and not db.scalar(select(Recipe.id).where(Recipe.id == body.recipe_id, Recipe.user_id == user.user_id)):
        raise not_found("Recipe")
    if body.routine_id and not db.scalar(select(Routine.id).where(Routine.id == body.routine_id, Routine.user_id == user.user_id)):
        raise not_found("Routine")

    def existing() -> PlanItem | None:
        if not body.client_key:
            return None
        return db.scalar(select(PlanItem).where(PlanItem.user_id == user.user_id, PlanItem.client_key == body.client_key))

    # Idempotent: a double tap or retry with the same client key returns the item already saved.
    if (found := existing()) is not None:
        return PlanItemOut.model_validate(found)
    item = PlanItem(user_id=user.user_id, source="manual", **body.model_dump())
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if (found := existing()) is not None:
            return PlanItemOut.model_validate(found)
        raise
    return PlanItemOut.model_validate(item)


@router.patch("/plan/{item_id}")
def update_plan_item(item_id: str, body: PlanItemPatch, user: CurrentUser, db: Db) -> PlanItemOut:
    item = db.scalar(select(PlanItem).where(PlanItem.id == item_id, PlanItem.user_id == user.user_id))
    if item is None:
        raise not_found("Plan item")
    if body.date is not None and body.date != item.date:
        item.date = body.date  # reschedule: back to planned on the new day
        item.status, item.completed_at = "planned", None
    if body.time_slot is not None:
        item.time_slot = body.time_slot
    if body.status is not None:
        set_plan_status(item, body.status)
    db.commit()
    return PlanItemOut.model_validate(item)


@router.delete("/plan/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan_item(item_id: str, user: CurrentUser, db: Db) -> Response:
    item = db.scalar(select(PlanItem).where(PlanItem.id == item_id, PlanItem.user_id == user.user_id))
    if item is None:
        raise not_found("Plan item")
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/checkins/{day}")
def save_checkin(day: str, body: CheckInIn, user: CurrentUser, db: Db) -> CheckInOut:
    day = _parse_date(day)
    checkin = db.scalar(select(CheckIn).where(CheckIn.user_id == user.user_id, CheckIn.date == day))
    if checkin is None:
        checkin = CheckIn(user_id=user.user_id, date=day)
        db.add(checkin)
    checkin.energy, checkin.mood = body.energy, body.mood
    checkin.sleep_hours, checkin.note = body.sleep_hours, body.note
    db.commit()
    return CheckInOut.model_validate(checkin)


@router.get("/progress")
def progress(user: CurrentUser, db: Db, today_: str = Query(alias="today", pattern=r"^\d{4}-\d{2}-\d{2}$")) -> ProgressOut:
    day = _parse_date(today_)
    since = (date.fromisoformat(day) - timedelta(days=60)).isoformat()
    sessions = db.scalars(
        select(ActivitySession).where(ActivitySession.user_id == user.user_id, ActivitySession.local_date >= since)
    )
    checkins = db.scalars(select(CheckIn).where(CheckIn.user_id == user.user_id, CheckIn.date >= since))
    plan = db.scalars(select(PlanItem).where(PlanItem.user_id == user.user_id, PlanItem.date >= since))
    return compute_progress(day, sessions, checkins, plan)
