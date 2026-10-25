"""Apple Watch: link tokens and the sharing setting (managed on the phone), and the watch's own data routes.

Token management and the sharing setting take the app's Clerk session (`CurrentUser`), so a watch token
can never mint, list or revoke tokens, change sharing, or reach any route outside this module's data
routes. Those take `WatchUser`: a `bnw_` watch token or the phone's own Clerk session.

Health days are stored here first; the mirror into Agent Memory (only while the user shares health data)
runs after the commit and never fails the upload (health.py).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import health
from app.deps import CurrentUser, Db, Memory, WatchUser, not_found
from app.mcp_auth import WATCH_TOKEN_LIFETIME, new_watch_token
from app.models import CheckIn, HealthDay, PlanItem, Profile, WatchToken
from app.routers.daily import _parse_date, _plan_for, set_plan_status
from app.schemas import (
    CheckInOut,
    HealthDayIn,
    HealthDayOut,
    HealthDaysOut,
    NewWatchTokenOut,
    PlanItemOut,
    WatchCheckInPatch,
    WatchPlanStatusIn,
    WatchSettingsIn,
    WatchSettingsOut,
    WatchTodayOut,
    WatchTokenIn,
    WatchTokenOut,
    WatchTokensOut,
)

router = APIRouter(tags=["watch"])
MAX_WATCH_TOKENS = 5
DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"


# --- link tokens (phone, Clerk session only) ----------------------------------------------------

def _token_out(t: WatchToken) -> WatchTokenOut:
    return WatchTokenOut(id=t.id, label=t.label, hint=t.hint, created_at=t.created_at, expires_at=t.expires_at,
                         last_used_at=t.last_used_at, revoked=t.revoked_at is not None)


def _active(db: Db, user_id: str, now: datetime) -> list[WatchToken]:
    rows = db.scalars(select(WatchToken).where(WatchToken.user_id == user_id, WatchToken.revoked_at.is_(None)))
    return [t for t in rows if t.expires_at > now]


@router.post("/watch/tokens", status_code=status.HTTP_201_CREATED)
def create_watch_token(user: CurrentUser, db: Db, body: WatchTokenIn | None = None) -> NewWatchTokenOut:
    """Link a watch. Shown once; the phone hands it to the watch and never stores it."""
    label = (body or WatchTokenIn()).label
    now = datetime.now(UTC)
    active = _active(db, user.user_id, now)
    for t in active:
        if t.label == label:
            t.revoked_at = now  # re-linking the same watch replaces its token
    if sum(t.revoked_at is None for t in active) >= MAX_WATCH_TOKENS:
        db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can link up to {MAX_WATCH_TOKENS} watches.")
    token, digest, hint = new_watch_token()
    row = WatchToken(user_id=user.user_id, label=label, token_hash=digest, hint=hint, created_at=now,
                     expires_at=now + WATCH_TOKEN_LIFETIME)
    db.add(row)
    db.commit()
    return NewWatchTokenOut(id=row.id, label=row.label, hint=row.hint, created_at=row.created_at,
                            expires_at=row.expires_at, token=token)


@router.get("/watch/tokens")
def list_watch_tokens(user: CurrentUser, db: Db) -> WatchTokensOut:
    rows = db.scalars(select(WatchToken).where(WatchToken.user_id == user.user_id).order_by(WatchToken.created_at.desc()))
    return WatchTokensOut(tokens=[_token_out(t) for t in rows])


@router.delete("/watch/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_watch_token(token_id: str, user: CurrentUser, db: Db) -> Response:
    row = db.scalar(select(WatchToken).where(WatchToken.id == token_id, WatchToken.user_id == user.user_id))
    if row is None:
        raise not_found("Watch link")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/watch/tokens", status_code=status.HTTP_204_NO_CONTENT)
def revoke_all_watch_tokens(user: CurrentUser, db: Db) -> Response:
    """Unlink every watch (the phone calls this on unlink and on sign-out)."""
    now = datetime.now(UTC)
    for t in _active(db, user.user_id, now):
        t.revoked_at = now
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- health sharing (phone, Clerk session only) -------------------------------------------------

@router.get("/watch/settings")
def get_watch_settings(user: CurrentUser, db: Db) -> WatchSettingsOut:
    return WatchSettingsOut(share_health=health.sharing_enabled(db, user.user_id))


@router.put("/watch/settings")
def save_watch_settings(body: WatchSettingsIn, user: CurrentUser, db: Db, memory: Memory) -> WatchSettingsOut:
    """Turning sharing off erases every mirrored day from memory; turning it on mirrors the complete days."""
    profile = db.get(Profile, user.user_id)
    if profile is None and body.share_health:
        profile = Profile(user_id=user.user_id)
        db.add(profile)
    if profile is not None:
        profile.share_health = body.share_health
    try:
        db.commit()
    except IntegrityError:
        # The profile was created by another request meanwhile.
        db.rollback()
        profile = db.get(Profile, user.user_id)
        if profile is None:
            raise
        profile.share_health = body.share_health
        db.commit()
    health.apply_sharing(db, memory, user.user_id)
    return WatchSettingsOut(share_health=body.share_health)


# --- the watch's data routes (watch token or Clerk session) -------------------------------------

def _checkin(db: Db, user_id: str, day: str) -> CheckIn | None:
    return db.scalar(select(CheckIn).where(CheckIn.user_id == user_id, CheckIn.date == day))


def _health_day(db: Db, user_id: str, day: str) -> HealthDay | None:
    return db.scalar(select(HealthDay).where(HealthDay.user_id == user_id, HealthDay.date == day))


@router.get("/watch/today")
def watch_today(user: WatchUser, db: Db, date_: str = Query(alias="date", pattern=DATE_PATTERN)) -> WatchTodayOut:
    day = _parse_date(date_)
    checkin = _checkin(db, user.user_id, day)
    row = _health_day(db, user.user_id, day)
    return WatchTodayOut(
        date=day,
        items=_plan_for(db, user.user_id, day),
        check_in=CheckInOut.model_validate(checkin) if checkin else None,
        health=HealthDayOut.model_validate(row) if row else None,
        share_health=health.sharing_enabled(db, user.user_id),
    )


@router.patch("/watch/plan/{item_id}")
def set_watch_plan_status(item_id: str, body: WatchPlanStatusIn, user: WatchUser, db: Db) -> PlanItemOut:
    item = db.scalar(select(PlanItem).where(PlanItem.id == item_id, PlanItem.user_id == user.user_id))
    if item is None:
        raise not_found("Plan item")
    set_plan_status(item, body.status)
    db.commit()
    return PlanItemOut.model_validate(item)


@router.patch("/watch/checkins/{day}")
def merge_watch_checkin(day: str, body: WatchCheckInPatch, user: WatchUser, db: Db) -> CheckInOut:
    """Merge: keys the watch leaves out keep what is stored, so a quick energy/mood tap never wipes the phone's note."""
    day = _parse_date(day)
    changes = {name: getattr(body, name) for name in body.model_fields_set}

    def merge(checkin: CheckIn) -> None:
        for name, value in changes.items():
            setattr(checkin, name, value)

    checkin = _checkin(db, user.user_id, day)
    if checkin is not None:
        merge(checkin)
        db.commit()
        return CheckInOut.model_validate(checkin)
    if body.energy is None or body.mood is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A new check-in needs energy and mood.")
    checkin = CheckIn(user_id=user.user_id, date=day)
    merge(checkin)
    db.add(checkin)
    try:
        db.commit()
    except IntegrityError:
        # The phone (or a retry) created this day's check-in at the same moment: merge into that one.
        db.rollback()
        checkin = _checkin(db, user.user_id, day)
        if checkin is None:
            raise
        merge(checkin)
        db.commit()
    return CheckInOut.model_validate(checkin)


def _fill(row: HealthDay, body: HealthDayIn) -> None:
    row.sleep_minutes, row.resting_heart_rate_bpm = body.sleep_minutes, body.resting_heart_rate_bpm
    # Old Watch versions omit this field; do not erase a newer upload's stage details.
    if "sleep_pattern" in body.model_fields_set:
        row.sleep_pattern = body.sleep_pattern.model_dump(mode="json") if body.sleep_pattern else None
    row.hrv_sdnn_ms, row.steps, row.active_energy_kcal = body.hrv_sdnn_ms, body.steps, body.active_energy_kcal
    by_id = {w.external_id: w for w in body.workouts}  # a workout sent twice is kept once
    row.workouts = [w.model_dump(mode="json") for w in sorted(by_id.values(), key=lambda w: (w.started_at, w.external_id))]
    row.complete = body.complete
    row.source = "apple_watch"


@router.put("/watch/health/{day}")
def save_health_day(day: str, body: HealthDayIn, user: WatchUser, db: Db, memory: Memory) -> HealthDayOut:
    """Upsert one day's summary (repeating an upload changes nothing), then mirror it if the user shares health data."""
    day = _parse_date(day)
    row = _health_day(db, user.user_id, day)
    if row is None:
        row = HealthDay(user_id=user.user_id, date=day)
        db.add(row)
    _fill(row, body)
    try:
        db.commit()
    except IntegrityError:
        # The same day arrived twice at once (e.g. a retried upload): update the row the other request created.
        db.rollback()
        row = _health_day(db, user.user_id, day)
        if row is None:
            raise
        _fill(row, body)
        db.commit()
    if health.refresh(db, memory, row):  # skip the retries when memory just failed, rather than wait on it twice
        # Only this day is written here, so an upload stays inside the watch's timeout; the phone's requests
        # (Coach, planner, preferences) work through the rest of the backlog.
        health.sync_pending_health(db, memory, user.user_id, only=row)
    return HealthDayOut.model_validate(row)


@router.get("/watch/health")
def list_health_days(
    user: WatchUser, db: Db, end: str = Query(pattern=DATE_PATTERN), days: int = Query(default=7, ge=1, le=31),
) -> HealthDaysOut:
    """Stored days in the window ending on `end`, oldest first. Days without an upload are left out."""
    last = date.fromisoformat(_parse_date(end))
    return HealthDaysOut(days=[HealthDayOut.model_validate(r) for r in health.days_between(db, user.user_id, last, days)])
