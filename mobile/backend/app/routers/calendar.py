"""Authenticated personal calendar. Demo data is opt-in and belongs only to its caller."""
from datetime import date, datetime, time, timedelta
from fastapi import APIRouter, Query, Response
from sqlalchemy import delete, select

from app.calendar import DemoIn, EntryCreate, EntryIn, EntryOut, entry_out, feed, insert_once, zone
from app.deps import CurrentUser, Db, WatchUser, not_found
from app.models import CalendarEntry

router = APIRouter(tags=["calendar"])


@router.get("/calendar")
def calendar(user: CurrentUser, db: Db, start: str, days: int = Query(42, ge=1, le=62), timezone: str = "UTC") -> list[EntryOut]:
    return feed(db, user.user_id, start, days, timezone)


@router.get("/watch/calendar")
def watch_calendar(user: WatchUser, db: Db, start: str, days: int = Query(1, ge=1, le=7), timezone: str = "UTC") -> list[EntryOut]:
    return feed(db, user.user_id, start, days, timezone)


@router.post("/calendar", status_code=201)
def create(body: EntryCreate, user: CurrentUser, db: Db, timezone: str = "UTC") -> EntryOut:
    tz = zone(timezone)
    row = insert_once(db, user.user_id, f"manual:{body.client_key}", "manual",
                      EntryIn(**body.model_dump(exclude={"client_key"})))
    db.commit()
    return entry_out(row, tz)


def owned(db: Db, user_id: str, entry_id: str) -> CalendarEntry:
    row = db.scalar(select(CalendarEntry).where(CalendarEntry.id == entry_id, CalendarEntry.user_id == user_id))
    if row is None:
        raise not_found("Calendar entry")
    return row


@router.put("/calendar/{entry_id}")
def update(entry_id: str, body: EntryIn, user: CurrentUser, db: Db, timezone: str = "UTC") -> EntryOut:
    tz = zone(timezone)
    row = owned(db, user.user_id, entry_id)
    changed_time = row.occurred_at != body.occurred_at
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    if changed_time:
        row.time_estimated = False
    db.commit()
    return entry_out(row, tz)


@router.delete("/calendar/{entry_id}", status_code=204)
def remove(entry_id: str, user: CurrentUser, db: Db) -> Response:
    db.delete(owned(db, user.user_id, entry_id))
    db.commit()
    return Response(status_code=204)


@router.post("/calendar/demo")
def demo(body: DemoIn, user: CurrentUser, db: Db) -> dict[str, int]:
    tz = zone(body.timezone)
    end = date.fromisoformat(body.date)
    # A reproducible week for this signed-in account; never write a hardcoded account ID.
    meals = ["Greek yogurt & berries", "Avocado toast", "Overnight oats", "Eggs on sourdough"]
    lunches = ["Chicken caesar wrap", "Chickpea grain bowl", "Tofu veggie stir fry"]
    for offset in range(7):
        day = end - timedelta(days=offset)
        samples = [("meal", meals[offset % len(meals)], "08:15", None),
                   ("meal", lunches[offset % len(lunches)], "12:30", None),
                   ("activity", "Full body strength" if offset % 2 == 0 else "Evening walk", "17:40", 32 if offset % 2 == 0 else 25),
                   ("meal", "Salmon & roasted vegetables" if offset % 2 == 0 else "Red lentil dal", "19:15", None)]
        for i, (kind, title, clock, duration) in enumerate(samples):
            at = datetime.combine(day, time.fromisoformat(clock), tz)
            # Demo events may be later today; construct explicitly so they never enter real completion flows.
            entry = EntryIn.model_construct(kind=kind, title=title, occurred_at=at, duration_minutes=duration,
                                           notes="Sample entry for your demo. You can edit or remove it.")
            insert_once(db, user.user_id, f"demo:{day}:{i}", "demo", entry)
    db.commit()
    return {"entries": 28}


@router.delete("/calendar/demo/all", status_code=204)
def clear_demo(user: CurrentUser, db: Db) -> Response:
    db.execute(delete(CalendarEntry).where(CalendarEntry.user_id == user.user_id, CalendarEntry.source == "demo"))
    db.commit()
    return Response(status_code=204)
