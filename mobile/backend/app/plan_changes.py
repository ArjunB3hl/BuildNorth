"""Applying confirmed plan changes. Shared by the app's `/plan/changes` route and approved assistant proposals.

All changes in a set are applied in one transaction or not at all. A change set ID is recorded
with the changes, so repeating the same set (a retry or a double tap) is a no-op. Items that were
completed, skipped or removed in the meantime are never touched: the whole set is refused as stale.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AppliedChangeSet, PlanItem, Recipe, Routine
from app.schemas import ApplyChange, ChangeItemView


class PlanChangeError(Exception):
    """A change set that can't be applied. `kind` maps to an HTTP status in the routes."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind  # not_found | stale | invalid
        self.message = message


STALE_MESSAGE = "Your plan changed since these changes were proposed. Ask again to see up-to-date changes."


def check_owned(db: Session, user_id: str, recipe_ids: set[str], routine_ids: set[str]) -> None:
    """Every referenced recipe/routine must belong to the user (same error whether missing or someone else's)."""
    if recipe_ids:
        owned = set(db.scalars(select(Recipe.id).where(Recipe.user_id == user_id, Recipe.id.in_(recipe_ids))))
        if recipe_ids - owned:
            raise PlanChangeError("not_found", "Recipe not found.")
    if routine_ids:
        owned = set(db.scalars(select(Routine.id).where(Routine.user_id == user_id, Routine.id.in_(routine_ids))))
        if routine_ids - owned:
            raise PlanChangeError("not_found", "Routine not found.")


def _valid_date(value: str) -> None:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise PlanChangeError("invalid", "Dates must be YYYY-MM-DD.") from exc


def matches(item: PlanItem, view: ChangeItemView) -> bool:
    """Whether a saved item still looks the way it did when a change to it was proposed."""
    return (item.date, item.kind, item.title, item.time_slot) == (view.date, view.kind, view.title, view.time_slot)


def apply_plan_changes(
    db: Session, user_id: str, change_set_id: str, changes: list[ApplyChange], expected: dict[str, ChangeItemView] | None = None
) -> tuple[bool, list[PlanItem]]:
    """Apply a change set. Returns (already_applied, touched items). Commits on success, rolls back on error.

    `expected` optionally maps target item IDs to how they looked when proposed; any difference
    (moved, renamed, edited elsewhere) makes the set stale, so nothing is changed behind the user's back.
    """
    applied = db.scalar(
        select(AppliedChangeSet.id).where(AppliedChangeSet.user_id == user_id, AppliedChangeSet.change_set_id == change_set_id)
    )
    if applied:
        return True, []
    try:
        check_owned(
            db,
            user_id,
            {c.after.recipe_id for c in changes if c.after and c.after.recipe_id},
            {c.after.routine_id for c in changes if c.after and c.after.routine_id},
        )
        touched: list[PlanItem] = []
        for index, change in enumerate(changes):
            after = change.after
            if after is not None:
                _valid_date(after.date)
            if change.op == "add":
                if after is None:
                    raise PlanChangeError("invalid", "An added item needs its details.")
                item = PlanItem(
                    user_id=user_id, date=after.date, kind=after.kind, title=after.title[:200], time_slot=after.time_slot,
                    recipe_id=after.recipe_id if after.kind == "meal" else None,
                    routine_id=after.routine_id if after.kind == "activity" else None,
                    minutes=after.minutes, note=after.note, source="planner", client_key=f"c:{change_set_id}:{index}",
                )
                db.add(item)
                touched.append(item)
                continue
            item = db.scalar(select(PlanItem).where(PlanItem.id == change.target_key, PlanItem.user_id == user_id))
            if item is None or item.status != "planned":
                raise PlanChangeError("stale", STALE_MESSAGE)  # preserves completed/skipped items and removals
            if expected is not None and change.target_key in expected and not matches(item, expected[change.target_key]):
                raise PlanChangeError("stale", STALE_MESSAGE)
            if change.op == "remove":
                db.delete(item)
                continue
            if after is None or after.kind != item.kind:
                raise PlanChangeError("invalid", "A changed item keeps its kind (meal or activity).")
            item.date, item.time_slot = after.date, after.time_slot
            if change.op == "replace":
                item.title = after.title[:200]
                item.recipe_id = after.recipe_id if item.kind == "meal" else None
                item.routine_id = after.routine_id if item.kind == "activity" else None
                item.minutes, item.note = after.minutes, after.note
            touched.append(item)
        db.add(AppliedChangeSet(user_id=user_id, change_set_id=change_set_id))
        db.commit()
    except PlanChangeError:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()  # the same change set was applied by a concurrent retry
        return True, []
    return False, touched
