"""Apple Watch daily health summaries: authoritative rows in the database, a short text mirror in Agent Memory.

The numbers always come from SQL (`health_days`): Agent Memory can only answer semantic text recall, not
"HRV over the last week". So agents get structured days from here (user_context, the MCP tool), and memory
gets one deterministic sentence per complete day so recall can find it.

Sharing gate: `profiles.share_health`. While it is off, days are still stored and shown to the user and the
watch, but nothing is mirrored to memory and nothing reaches the Coach or assistants.

Mirror rules, the same as preferences.py:
- memory work runs after the SQL commit and never fails the request: if memory is down the day stays
  `pending` and `sync_pending_health` retries it later;
- a changed summary gets a new revision and so a new scope (`<user>/health/<revision>`). The old scope is
  erased first, or tombstoned when that fails, so a retried erase can never remove the newer text. A day whose
  text is set has its revision scope erased even while `pending`: a write can land and still report an error;
- turning sharing off erases the whole `<user>/health` subtree with one scoped forget, whatever the rows
  recorded, or leaves one tombstone for it. No summary is written again until that erase has landed, so its
  retry can never remove a newer summary;
- a write is recorded only if, when it returns, the day still holds that text and the user still shares health
  data (one conditional UPDATE). Otherwise sharing was turned off, memory erased or the day changed while it was
  in flight, and the scope just written is erased again (or tombstoned).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from pydantic import BaseModel
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session
from surrealdb.memory import MemoryServiceError

from app import preferences as prefs
from app.memory import MemoryService, health_root, health_scope
from app.models import HealthDay, MemoryTombstone, Profile, new_id

log = logging.getLogger(__name__)

MARKER = "Apple Watch daily summary for "
MAX_TEXT = 500  # fits MemoryTombstone.text, so stale filtering compares whole texts
CONTEXT_DAYS = 7
NOTE = ("Device-measured daily summaries from the user's Apple Watch. Days without a summary are missing data, "
        "not zero. complete=false means the day wasn't over when it was uploaded, so its totals are partial. "
        "This is not medical advice: don't diagnose or interpret it medically.")
SHARING_OFF = "Health sharing is off in the app."


class WorkoutSummary(BaseModel):
    activity_type: str
    started_at: str
    duration_minutes: float
    energy_kcal: float | None
    distance_meters: float | None
    average_heart_rate_bpm: float | None


class HealthDaySummary(BaseModel):
    """One local day as agents see it (snake_case, like every MCP result). Missing metrics are null."""

    date: str
    sleep_minutes: int | None
    resting_heart_rate_bpm: int | None
    hrv_sdnn_ms: float | None
    steps: int | None
    active_energy_kcal: float | None
    workouts: list[WorkoutSummary]
    complete: bool  # False: the day wasn't over when it was uploaded
    source: str


def sharing_enabled(db: Session, user_id: str) -> bool:
    profile = db.get(Profile, user_id)
    return bool(profile and profile.share_health)


def summary(row: HealthDay) -> HealthDaySummary:
    return HealthDaySummary(
        date=row.date, sleep_minutes=row.sleep_minutes, resting_heart_rate_bpm=row.resting_heart_rate_bpm,
        hrv_sdnn_ms=row.hrv_sdnn_ms, steps=row.steps, active_energy_kcal=row.active_energy_kcal,
        workouts=[WorkoutSummary.model_validate(_workout_fields(w)) for w in row.workouts or []],
        complete=row.complete, source=row.source,
    )


def _workout_fields(stored: dict[str, Any]) -> dict[str, Any]:
    return {k: stored.get(k) for k in WorkoutSummary.model_fields}


def days_between(db: Session, user_id: str, end: date, days: int) -> list[HealthDay]:
    """The user's stored days in the `days`-long window ending on `end`, oldest first."""
    start = end - timedelta(days=days - 1)
    return list(db.scalars(select(HealthDay).where(
        HealthDay.user_id == user_id, HealthDay.date >= start.isoformat(), HealthDay.date <= end.isoformat(),
    ).order_by(HealthDay.date)))


# --- text --------------------------------------------------------------------------------------

def _duration(minutes: int) -> str:
    hours, rest = divmod(minutes, 60)
    if hours and rest:
        return f"{hours} h {rest} min"
    return f"{hours} h" if hours else f"{rest} min"


def describe(day: HealthDaySummary, max_workouts: int | None = None) -> str:
    """The measured values as one phrase list ("slept 6 h 52 min; ...; workouts: 32 min running"). Missing values
    are left out, never written as 0. Empty when nothing was measured."""
    parts: list[str] = []
    if day.sleep_minutes is not None:
        parts.append(f"slept {_duration(day.sleep_minutes)}")
    if day.resting_heart_rate_bpm is not None:
        parts.append(f"resting heart rate {day.resting_heart_rate_bpm} bpm")
    if day.hrv_sdnn_ms is not None:
        parts.append(f"HRV {round(day.hrv_sdnn_ms)} ms")
    if day.steps is not None:
        parts.append(f"{day.steps:,} steps")
    if day.active_energy_kcal is not None:
        parts.append(f"{round(day.active_energy_kcal):,} kcal active energy")
    if day.workouts:
        shown = day.workouts if max_workouts is None else day.workouts[:max_workouts]
        listed = ", ".join(f"{round(w.duration_minutes)} min {w.activity_type.replace('_', ' ')}" for w in shown)
        hidden = len(day.workouts) - len(shown)
        if not shown:
            parts.append(f"workouts: {hidden} recorded")
        else:
            parts.append(f"workouts: {listed}" + (f" and {hidden} more" if hidden else ""))
    return "; ".join(parts)


def memory_text(row: HealthDay) -> str | None:
    """The one deterministic sentence mirrored for a day (at most 500 characters), or None if nothing was measured."""
    day = summary(row)
    head = f"{MARKER}{day.date} (device-measured): "
    text = ""
    for shown in range(len(day.workouts), -1, -1):  # long workout lists are shortened to fit
        body = describe(day, max_workouts=shown)
        if not body:
            return None
        text = f"{head}{body}."
        if len(text) <= MAX_TEXT:
            return text
    return text[:MAX_TEXT]


def _norm(text: str) -> str:
    return " ".join(text.lower().split()).rstrip(".!")


def is_health_text(text: str) -> bool:
    """Whether a recalled memory reads like one of these summaries (such hits never become generic memory notes)."""
    return _norm(text).startswith(_norm(MARKER) + " ")


def mirrored_texts(db: Session, user_id: str) -> dict[str, str]:
    """Mirrored text -> date, to attribute recalled memory to the day it came from."""
    rows = db.execute(select(HealthDay.date, HealthDay.memory_text).where(
        HealthDay.user_id == user_id, HealthDay.memory_text.is_not(None)))
    return {text: day for day, text in rows if text}


# --- mirror ------------------------------------------------------------------------------------

def _target(row: HealthDay, share: bool) -> str | None:
    return memory_text(row) if share and row.complete else None


def _retarget(db: Session, memory: MemoryService | None, row: HealthDay, text: str | None) -> bool:
    """Point the day's mirror at `text` (None: not mirrored). An unchanged text keeps its revision and status.
    Returns False when erasing the previous revision failed (a tombstone retries it)."""
    if text == row.memory_text:
        if text is None:
            row.memory_status = "not_mirrored"
        return True
    # A pending text may be stored as well (a timeout after the write was sent still reports an error), so the
    # revision's scope is erased whenever the day had a text, not only once a write was confirmed.
    previous = health_scope(row.user_id, row.revision) if row.memory_text is not None and row.revision else row.memory_scope
    erased = prefs._erase(db, memory, row.user_id, previous, row.memory_text)
    row.memory_scope = None
    row.revision = new_id()  # never reuse a scope across revisions
    row.memory_text = text
    row.memory_status = "pending" if text else "not_mirrored"
    return erased


def _write(db: Session, memory: MemoryService, row: HealthDay) -> bool:
    """Mirror the day's text under its revision scope. Returns False when memory didn't answer."""
    if row.memory_text is None:
        return True
    user_id, revision, text = row.user_id, row.revision, row.memory_text
    try:
        scope = memory.remember_health(user_id, revision, text)
    except (MemoryServiceError, ValueError) as exc:
        # Only the error type is logged: health values never go to logs.
        log.warning("Memory write failed for a health day of %s: %s", user_id, type(exc).__name__)
        row.memory_status = "pending"
        return False
    if _record_write(db, row, revision, text, scope):
        return True
    # Sharing was turned off, memory erased or the day changed while the write was in flight. Whatever erased the
    # mirror meanwhile may have run before this write landed, so the scope just written is erased now.
    log.info("A health day of %s changed or stopped being shared during its memory write; erasing that write.", user_id)
    return prefs._erase(db, memory, user_id, scope, text)


def _record_write(db: Session, row: HealthDay, revision: str, text: str, scope: str) -> bool:
    """Mark the day synced, but only if it still holds this revision and text and the user still shares health data,
    all read fresh in the same UPDATE, so a change committed while the write was in flight is never overwritten.
    Commits. Returns False when nothing matched: the row is left as the other change set it (or deleted)."""
    shared = select(Profile.user_id).where(Profile.user_id == row.user_id, Profile.share_health.is_(True))
    result = db.execute(
        update(HealthDay)
        .where(HealthDay.id == row.id, HealthDay.revision == revision, HealthDay.memory_text == text,
               HealthDay.user_id.in_(shared))
        .values(memory_scope=scope, memory_status="synced")
        .execution_options(synchronize_session=False)
    )
    matched = result.rowcount == 1  # type: ignore[attr-defined]
    db.commit()
    if matched:
        db.refresh(row)
    else:
        db.expire(row)  # reloaded when next read, with whatever the other change left
    return matched


def refresh(db: Session, memory: MemoryService | None, row: HealthDay) -> bool:
    """After a day was saved (and committed): update what its mirror should hold, then commit. Returns whether
    memory answered (False: erasing the previous revision just failed, so don't wait on memory again now)."""
    reachable = _retarget(db, memory, row, _target(row, sharing_enabled(db, row.user_id)))
    db.commit()
    return reachable


def erase_pending(db: Session, user_id: str) -> bool:
    """Whether erasing the user's whole health subtree (sharing turned off while memory was down) still waits for a retry."""
    return db.scalar(select(MemoryTombstone.id).where(
        MemoryTombstone.user_id == user_id, MemoryTombstone.scope == health_root(user_id)).limit(1)) is not None


def erase_mirror(db: Session, memory: MemoryService | None, user_id: str) -> bool:
    """Erase every health summary of the user with one forget of `<user>/health`, including any whose write
    reported an error after landing. When memory can't do it now, one tombstone for the subtree is left and
    `prefs.sync_pending` retries it. Returns False when that tombstone was left. The caller commits."""
    root = health_root(user_id)
    tombstones = list(db.scalars(select(MemoryTombstone).where(
        MemoryTombstone.user_id == user_id,
        or_(MemoryTombstone.scope == root, MemoryTombstone.scope.startswith(root + "/", autoescape=True)),
    )))
    if memory is not None:
        try:
            memory.forget_health(user_id)
        except (MemoryServiceError, ValueError) as exc:
            log.warning("Memory erase of the health summaries failed for %s; will retry: %s", user_id, type(exc).__name__)
        else:
            for tomb in tombstones:
                db.delete(tomb)  # what they were retrying is gone with the subtree
            return True
    if not any(t.scope == root for t in tombstones):
        db.add(MemoryTombstone(user_id=user_id, scope=root, text=None))
    return False


def _mirror_may_exist(db: Session, user_id: str) -> bool:
    """Whether memory could hold health summaries of the user: a day has (or had, pending) a mirrored text or still
    records a scope, or an earlier erase is still waiting for a retry. Otherwise there is nothing to erase."""
    root = health_root(user_id)
    has_text = db.scalar(select(HealthDay.id).where(
        HealthDay.user_id == user_id,
        or_(HealthDay.memory_text.is_not(None), HealthDay.memory_scope.is_not(None)),
    ).limit(1)) is not None
    has_tombstone = db.scalar(select(MemoryTombstone.id).where(
        MemoryTombstone.user_id == user_id,
        or_(MemoryTombstone.scope == root, MemoryTombstone.scope.startswith(root + "/", autoescape=True)),
    ).limit(1)) is not None
    return has_text or has_tombstone


def hidden_mirror_may_exist(db: Session, user_id: str, share: bool) -> bool:
    """Whether memory may still hold health summaries (or facts Agent Memory derived from them) that agents must not
    see: an erase of the whole subtree is still waiting for a retry, or sharing is off while something may still be
    mirrored. A derived fact needn't repeat the summary's words, so recalled text no saved record accounts for is
    then withheld (user_context._recall)."""
    return erase_pending(db, user_id) or (not share and _mirror_may_exist(db, user_id))


def apply_sharing(db: Session, memory: MemoryService | None, user_id: str) -> None:
    """After the sharing setting was saved. Off: erase the whole health subtree in one call (or tombstone it) and
    mark every day not mirrored. On: mirror the complete days."""
    if not sharing_enabled(db, user_id):
        # Skipped when nothing was ever mirrored, so saving "off" again (or with memory not configured) neither
        # calls memory nor leaves a tombstone.
        if _mirror_may_exist(db, user_id):
            erase_mirror(db, memory, user_id)
        db.execute(update(HealthDay).where(HealthDay.user_id == user_id)
                   .values(memory_status="not_mirrored", memory_scope=None, memory_text=None))
        db.commit()
        return
    reachable = True
    for row in db.scalars(select(HealthDay).where(HealthDay.user_id == user_id).order_by(HealthDay.date)):
        # Once memory didn't answer, the remaining erasures are tombstoned instead of waiting on each one.
        if not _retarget(db, memory if reachable else None, row, _target(row, True)):
            reachable = False
    db.commit()
    if reachable:
        sync_pending_health(db, memory, user_id)


def _retry_revision_erases(db: Session, memory: MemoryService, user_id: str) -> bool:
    """Retry erasing old revisions of changed days (tombstoned while memory was down), so recall doesn't keep two
    versions of a day. Stops at the first failure. Returns False when memory didn't answer."""
    root = health_root(user_id)
    tombstones = list(db.scalars(select(MemoryTombstone).where(
        MemoryTombstone.user_id == user_id, MemoryTombstone.scope.startswith(root + "/", autoescape=True),
    ).limit(prefs.MAX_RETRIES_PER_REQUEST)))
    for tomb in tombstones:
        try:
            memory.forget_scope(user_id, tomb.scope)
        except (MemoryServiceError, ValueError) as exc:
            log.warning("Memory erase of an old health revision failed for %s; will retry: %s", user_id, type(exc).__name__)
            return False
        db.delete(tomb)
        # Committed now: left pending, the next query would flush it and hold SQLite's write lock through the
        # following memory calls, so another request's write would fail with "database is locked".
        db.commit()
    return True


def sync_pending_health(db: Session, memory: MemoryService | None, user_id: str, only: HealthDay | None = None) -> bool:
    """Retry outstanding health mirror work: a pending subtree erase, then old revisions' erasures, then pending writes
    (newest days first; just `only` when given, so a watch upload never waits on the backlog). Returns whether memory
    is reachable."""
    if memory is None:
        return False
    if not sharing_enabled(db, user_id):
        return True
    reachable = True
    if erase_pending(db, user_id):
        # Sharing was turned off and on again while memory was down: that erase lands first, or its later retry
        # would remove the summaries written now.
        reachable = erase_mirror(db, memory, user_id)
        db.commit()  # before more memory calls, so no write lock is held through them
    if reachable:
        reachable = _retry_revision_erases(db, memory, user_id)
    if reachable:
        query = select(HealthDay).where(
            HealthDay.user_id == user_id, HealthDay.memory_status == "pending", HealthDay.complete.is_(True))
        if only is not None:
            query = query.where(HealthDay.id == only.id)
        pending = list(db.scalars(query.order_by(HealthDay.date.desc()).limit(prefs.MAX_RETRIES_PER_REQUEST)))
        for row in pending:
            if not _write(db, memory, row):
                reachable = False
                break
    db.commit()
    return reachable
