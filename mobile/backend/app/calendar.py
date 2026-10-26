"""Calendar combines authoritative sessions and completed meals with the user's journal.

UTC instants are filtered/displayed in the requested IANA timezone, including DST.
A model can propose journal entries only from an explicit completion in this turn.
"""
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re

from fastapi import HTTPException
from pydantic import AwareDatetime, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ActivitySession, CalendarEntry, HealthDay, PlanItem, utcnow
from app.schemas import ApiModel, InputModel, LocalDate, Text120, HealthWorkoutOut, SleepPattern


class EntryIn(InputModel):
    kind: Literal["meal", "activity"]
    title: Text120
    occurred_at: AwareDatetime
    duration_minutes: Annotated[int, Field(ge=1, le=1440)] | None = None
    notes: Annotated[str, Field(max_length=2000)] | None = None

    @field_validator("occurred_at")
    @classmethod
    def completed(cls, value: datetime) -> datetime:
        if value > utcnow() + timedelta(minutes=5):
            raise ValueError("Calendar records completed events; choose a time in the past.")
        return value


class EntryCreate(EntryIn):
    client_key: Annotated[str, Field(min_length=1, max_length=80)]


class EntryOut(ApiModel):
    id: str
    kind: Literal["meal", "activity", "sleep"]
    title: str
    occurred_at: datetime
    local_date: str
    local_time: str
    duration_minutes: int | None = None
    notes: str | None = None
    source: Literal["manual", "coach", "demo", "session", "plan", "watch"]
    time_estimated: bool = False
    editable: bool = False
    session_id: str | None = None
    workout: HealthWorkoutOut | None = None
    sleep_pattern: SleepPattern | None = None
    partial: bool = False


class DemoIn(InputModel):
    date: LocalDate
    timezone: Annotated[str, Field(max_length=80)] = "UTC"
    period: Literal["week", "month"] = "week"


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Choose a valid timezone.") from None


def entry_out(row: CalendarEntry, tz: ZoneInfo) -> EntryOut:
    at = row.occurred_at.astimezone(tz)
    return EntryOut(id=row.id, kind=row.kind, title=row.title, occurred_at=row.occurred_at,
                    local_date=at.date().isoformat(), local_time=at.strftime("%H:%M"),
                    duration_minutes=row.duration_minutes, notes=row.notes, source=row.source,
                    time_estimated=row.time_estimated, editable=True)


def feed(db: Session, user_id: str, start: str, days: int, timezone: str) -> list[EntryOut]:
    tz = zone(timezone)
    try:
        day = date.fromisoformat(start)
        low = datetime.combine(day, time(), tz)
        high = datetime.combine(day + timedelta(days=days), time(), tz)
    except (ValueError, OverflowError):
        raise HTTPException(422, "Choose a valid calendar date.") from None
    result = [entry_out(r, tz) for r in db.scalars(select(CalendarEntry).where(
        CalendarEntry.user_id == user_id, CalendarEntry.occurred_at >= low, CalendarEntry.occurred_at < high))]
    # Read sessions directly: existing camera/phone recordings appear without a second write.
    for r in db.scalars(select(ActivitySession).where(ActivitySession.user_id == user_id,
                         ActivitySession.started_at >= low, ActivitySession.started_at < high)):
        at = r.started_at.astimezone(tz)
        result.append(EntryOut(id=f"session:{r.id}", kind="activity", title=r.routine_name,
            occurred_at=r.started_at, local_date=at.date().isoformat(), local_time=at.strftime("%H:%M"),
            duration_minutes=max(1, round(r.duration_seconds / 60)), notes=r.notes,
            source="session", session_id=r.id))
    # Marking a planned meal done is also a meal log, at its completion time.
    for r in db.scalars(select(PlanItem).where(PlanItem.user_id == user_id, PlanItem.kind == "meal",
                         PlanItem.status == "done", PlanItem.completed_at >= low, PlanItem.completed_at < high)):
        at = r.completed_at.astimezone(tz)
        result.append(EntryOut(id=f"plan:{r.id}", kind="meal", title=r.title, occurred_at=r.completed_at,
            local_date=at.date().isoformat(), local_time=at.strftime("%H:%M"), source="plan", time_estimated=True))
    # Watch uploads are already validated and user-scoped. Display their measured workout times.
    # Keep these separate from app sessions, just as HealthDay does in progress reporting.
    seen_workouts: set[str] = set()
    for health in db.scalars(select(HealthDay).where(HealthDay.user_id == user_id,
                         HealthDay.date >= (day - timedelta(days=2)).isoformat(),
                         HealthDay.date <= (day + timedelta(days=days + 2)).isoformat()).order_by(HealthDay.updated_at.desc())):
        if day.isoformat() <= health.date < (day + timedelta(days=days)).isoformat() and health.sleep_minutes is not None:
            pattern = SleepPattern.model_validate(health.sleep_pattern) if health.sleep_pattern else None
            # Sleep belongs to the Watch's night-ending date, even when viewing in another timezone.
            at = pattern.ended_at if pattern and pattern.ended_at else datetime.combine(date.fromisoformat(health.date), time(), tz)
            result.append(EntryOut(id=f"sleep:{health.date}", kind="sleep", title="Sleep · Apple Watch",
                occurred_at=at, local_date=health.date, local_time=at.astimezone(tz).strftime("%H:%M") if pattern and pattern.ended_at else "",
                duration_minutes=health.sleep_minutes, source="watch", sleep_pattern=pattern,
                time_estimated=not bool(pattern and pattern.ended_at), partial=not health.complete))
        for workout in health.workouts:
            try:
                at = datetime.fromisoformat(workout["started_at"].replace("Z", "+00:00")).astimezone(tz)
                if not low <= at < high:
                    continue
                if workout["external_id"] in seen_workouts:
                    continue
                seen_workouts.add(workout["external_id"])
                result.append(EntryOut(id=f"watch:{workout['external_id']}", kind="activity",
                    title=workout["activity_type"].replace("_", " ").capitalize(), occurred_at=at,
                    local_date=at.date().isoformat(), local_time=at.strftime("%H:%M"), source="watch",
                    duration_minutes=max(1, round(workout["duration_minutes"])), partial=not health.complete,
                    workout=HealthWorkoutOut.model_validate({"energy_kcal": None, "distance_meters": None,
                        "average_heart_rate_bpm": None, **workout})))
            except (KeyError, ValueError, TypeError):
                continue
    return sorted(result, key=lambda r: (r.occurred_at, r.id))


def insert_once(db: Session, user_id: str, key: str, source: str, body: EntryIn, *, estimated: bool = False) -> CalendarEntry:
    row = db.scalar(select(CalendarEntry).where(CalendarEntry.user_id == user_id, CalendarEntry.source_key == key))
    if row is None:
        # A savepoint makes concurrent retries safe without rolling back the surrounding Coach turn.
        from sqlalchemy.exc import IntegrityError
        try:
            with db.begin_nested():
                row = CalendarEntry(user_id=user_id, source_key=key, source=source,
                                    time_estimated=estimated, **body.model_dump())
                db.add(row)
                db.flush()
        except IntegrityError:
            row = db.scalar(select(CalendarEntry).where(CalendarEntry.user_id == user_id, CalendarEntry.source_key == key))
            if row is None:
                raise
    return row


class CoachEntry(InputModel):
    kind: Literal["meal", "activity"]
    title: Text120
    date: LocalDate
    time: Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")] | None = None
    duration_minutes: Annotated[int, Field(ge=1, le=1440)] | None = None
    evidence: Annotated[str, Field(min_length=3, max_length=1000)]


# Conservative second gate: suggestions, negations, questions, and someone else's events aren't a log.
_COMPLETED = re.compile(r"\bI\s+(?:(?:just|already)\s+|(?:have|had)\s+just\s+)?(?:ate|had|drank|finished|completed|did|ran|walked|cycled|swam|worked out)\b", re.I)
_UNCERTAIN = re.compile(r"\b(?:if|would|could|should|might|maybe|planned|planning|will|want|wanted|said|says|quoted|didn['’]?t|haven['’]?t|not|never|tomorrow|pretend|example|suppose)\b|\?", re.I)


def grounded_title(title: str, evidence: str) -> str:
    """A model must not replace oatmeal with omelette (or invent an exercise)."""
    if title.casefold() in evidence.casefold():
        return title
    # Preserve the user's description when a paraphrase is not grounded. Keep the action
    # as well, because stripping "ran" from "I ran for 20 minutes" would lose the activity.
    literal = re.sub(r"^I\s+", "", evidence.strip(), flags=re.I)
    literal = re.split(r"\s+(?:at|around)\s+\d", literal, maxsplit=1, flags=re.I)[0]
    literal = re.sub(r"\s+(?:today|yesterday|this morning|this evening)[.!]?$", "", literal, flags=re.I)
    return literal[:120].strip().rstrip(".! ") or title


def reported_clause(evidence: str, message: str) -> str:
    """Recover stated times when a model shortens its quote to 'I ate yogurt'."""
    for clause in re.split(r"[.!?](?=\s|$)|;|\s+and\s+(?=I\b)", message, flags=re.I):
        if evidence.rstrip(".!? ") in clause:
            return clause.strip()
    return evidence


def grounded_time(clock: str | None, evidence: str) -> str | None:
    reported: set[str] = set()
    for match in re.finditer(r"\b(\d{1,2})(?::([0-5]\d))?\s*([ap]\.?m\.?)?\b", evidence, re.I):
        hours, minutes, meridiem = match.groups()
        if minutes is None and meridiem is None:
            continue
        h = int(hours)
        if meridiem:
            if not 1 <= h <= 12:
                continue
            h = h % 12 + (12 if meridiem.lower().startswith("p") else 0)
        if h < 24:
            reported.add(f"{h:02}:{int(minutes or 0):02}")
    if clock in reported:
        return clock
    # An unambiguous clock in the user's clause wins over a missing/incorrect model value.
    return next(iter(reported)) if len(reported) == 1 else None


def grounded_duration(minutes: int | None, evidence: str) -> int | None:
    if minutes is None:
        return None
    for match in re.finditer(r"\b(\d+)\s*[- ]?\s*(minutes?|mins?|hours?|hrs?)\b", evidence, re.I):
        amount = int(match[1]) * (60 if match[2].lower().startswith("h") else 1)
        if amount == minutes:
            return minutes
    return None


def grounded_date(day: str, evidence: str, now: datetime) -> date:
    explicit = re.search(r"\b\d{4}-\d{2}-\d{2}\b", evidence)
    if explicit:
        return date.fromisoformat(explicit[0])
    if re.search(r"\byesterday\b", evidence, re.I):
        return now.date() - timedelta(days=1)
    if re.search(r"\b(?:today|just|this morning|this evening|this afternoon)\b", evidence, re.I):
        return now.date()
    # Named historical dates may need the model's interpretation. With no date words,
    # an unstated date is today, not whatever date the model happens to generate.
    if re.search(r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|last|ago)\b", evidence, re.I):
        return date.fromisoformat(day)
    return now.date()


def log_coach_entries(db: Session, user_id: str, key: str, message: str, raw: list, timezone: str) -> int:
    tz = zone(timezone)
    now = utcnow().astimezone(tz)
    count = 0
    # Evidence must come from this user's current message, never prior chat or model-created prose.
    for index, item in enumerate(raw[:8]):
        try:
            event = CoachEntry.model_validate(item)
            if event.evidence not in message or not _COMPLETED.search(event.evidence) or _UNCERTAIN.search(message):
                continue
            evidence = reported_clause(event.evidence, message)
            reported_time = grounded_time(event.time, evidence)
            wall = datetime.combine(grounded_date(event.date, evidence, now), time.fromisoformat(reported_time) if reported_time else now.time().replace(tzinfo=None))
            at = wall.replace(tzinfo=tz)
            # Reject nonexistent local times at the spring DST transition.
            if at.astimezone(UTC).astimezone(tz).replace(tzinfo=None) != wall:
                continue
            body = EntryIn(kind=event.kind, title=grounded_title(event.title, evidence), occurred_at=at,
                           duration_minutes=grounded_duration(event.duration_minutes, evidence),
                           notes=evidence)
            insert_once(db, user_id, f"coach:{key}:{index}", "coach", body, estimated=reported_time is None)
            count += 1
        except (ValidationError, ValueError):
            continue
    return count
