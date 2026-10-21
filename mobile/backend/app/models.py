"""Structured application records. Every row belongs to exactly one Clerk user (`user_id`).

These tables are authoritative for saved app data; Agent Memory only holds
conversational facts, confirmed preferences and (when the user shares them) a
text mirror of Apple Watch daily health summaries.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, false
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC datetimes on every backend (SQLite drops tzinfo on read)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[no-untyped-def]
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(UTC)
        return value

    def process_result_value(self, value, dialect):  # type: ignore[no-untyped-def]
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    pass


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Profile(Timestamped, Base):
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    preferred_name: Mapped[str | None] = mapped_column(String(80))
    goals: Mapped[list[str]] = mapped_column(JSON, default=list)
    dietary_preferences: Mapped[list[str]] = mapped_column(JSON, default=list)
    equipment: Mapped[list[str]] = mapped_column(JSON, default=list)
    experience_level: Mapped[str | None] = mapped_column(String(20))
    routine_times: Mapped[list[str]] = mapped_column(JSON, default=list)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Apple Watch health summaries go to Agent Memory, the Coach and connected assistants only while this is on.
    share_health: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


class RememberedPreference(Timestamped, Base):
    """A preference the user explicitly saved or confirmed; mirrored into Agent Memory."""

    __tablename__ = "remembered_preferences"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    text: Mapped[str] = mapped_column(String(500))
    # synced: written to Agent Memory under `memory_scope`; pending: not yet written (retried later)
    memory_status: Mapped[str] = mapped_column(String(20), default="pending")
    memory_scope: Mapped[str | None] = mapped_column(String(255))
    # Who last set this text: app (typed in Profile), coach (a Coach suggestion the user confirmed),
    # planner (a plan change the user chose to remember) or assistant (an approved MCP proposal).
    source: Mapped[str] = mapped_column(String(20), default="app", server_default="app")
    source_detail: Mapped[str | None] = mapped_column(String(160))  # e.g. which assistant connection


class MemoryTombstone(Base):
    """A memory scope whose deletion has not been confirmed yet; retried until Agent Memory erases it.

    `text` is the preference that scope held, so recall results repeating it can be
    filtered out meanwhile and a corrected preference never keeps driving advice.
    """

    __tablename__ = "memory_tombstones"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    scope: Mapped[str] = mapped_column(String(255))
    text: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Recipe(Timestamped, Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    servings: Mapped[int] = mapped_column(Integer, default=1)
    description: Mapped[str | None] = mapped_column(Text)
    ingredients: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    # Always an estimate when present; never presented as measured data.
    nutrition: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    search_text: Mapped[str] = mapped_column(Text, default="")


class ShoppingItem(Timestamped, Base):
    __tablename__ = "shopping_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(20))
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id", ondelete="SET NULL"))


class Routine(Timestamped, Base):
    __tablename__ = "routines"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    exercises: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class ActivitySession(Base):
    __tablename__ = "activity_sessions"
    __table_args__ = (Index("ix_activity_sessions_user_date", "user_id", "local_date"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    routine_id: Mapped[str | None] = mapped_column(ForeignKey("routines.id", ondelete="SET NULL"))
    routine_name: Mapped[str] = mapped_column(String(120))
    local_date: Mapped[str] = mapped_column(String(10))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime())
    finished_at: Mapped[datetime] = mapped_column(UTCDateTime())
    duration_seconds: Mapped[int] = mapped_column(Integer)
    entries: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class CheckIn(Timestamped, Base):
    __tablename__ = "checkins"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_checkins_user_date"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    date: Mapped[str] = mapped_column(String(10))
    energy: Mapped[int] = mapped_column(Integer)
    mood: Mapped[int] = mapped_column(Integer)
    sleep_hours: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text)


class PlanItem(Timestamped, Base):
    __tablename__ = "plan_items"
    __table_args__ = (
        Index("ix_plan_items_user_date", "user_id", "date"),
        # Idempotency: a retried or double-tapped create with the same key never makes a second row.
        UniqueConstraint("user_id", "client_key", name="uq_plan_items_user_client_key"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    date: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(20))  # meal | activity
    title: Mapped[str] = mapped_column(String(200))
    time_slot: Mapped[str | None] = mapped_column(String(20))  # morning | midday | evening
    recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id", ondelete="SET NULL"))
    routine_id: Mapped[str | None] = mapped_column(ForeignKey("routines.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="planned")  # planned | done | skipped
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    minutes: Mapped[int | None] = mapped_column(Integer)
    # Unsaved idea from the planner (e.g. a meal suggestion); becomes a recipe only via the review flow.
    note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual")  # manual | planner
    client_key: Mapped[str | None] = mapped_column(String(100))


class AppliedChangeSet(Base):
    """Records a confirmed plan change set so a retried confirmation is never applied twice."""

    __tablename__ = "applied_change_sets"
    __table_args__ = (UniqueConstraint("user_id", "change_set_id", name="uq_applied_change_sets_user_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    change_set_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class CoachMessage(Base):
    __tablename__ = "coach_messages"
    __table_args__ = (Index("ix_coach_messages_user_created", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    suggestions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # Assistant replies: what personal context the reply was built from, including whether memory was reachable.
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ConnectionToken(Base):
    """A token the signed-in user created in the app to connect an AI assistant (e.g. OpenCode) over MCP.

    Only a SHA-256 hash is stored; the token itself is shown once. It identifies the user it was
    created for and nothing else: the user ID is never taken from what an assistant sends.
    """

    __tablename__ = "connection_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(80))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    hint: Mapped[str] = mapped_column(String(12))  # last characters, to tell tokens apart
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class WatchToken(Base):
    """A token the phone created to link the user's Apple Watch (handed over with WatchConnectivity).

    Only a SHA-256 hash is stored; the token itself is returned once. It works only on the watch's
    own data routes (/watch/*), never on other app routes or at /mcp.
    """

    __tablename__ = "watch_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(80))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    hint: Mapped[str] = mapped_column(String(12))  # last characters, to tell tokens apart
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())  # updated at most every 10 minutes


class HealthDay(Timestamped, Base):
    """One local day of device-measured Apple Watch data. Missing metrics are NULL, never 0.

    HealthKit workouts stay here (not ActivitySession rows) so app-recorded sessions aren't counted twice.
    While the user shares health data, a complete day is mirrored into Agent Memory as `memory_text` under
    `<user>/health/<revision>`; a changed text gets a new revision, so a retried erase of the old scope
    can never remove the new one.
    """

    __tablename__ = "health_days"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_health_days_user_date"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    date: Mapped[str] = mapped_column(String(10))
    sleep_minutes: Mapped[int | None] = mapped_column(Integer)  # asleep, for the night that ended on this date
    resting_heart_rate_bpm: Mapped[int | None] = mapped_column(Integer)
    hrv_sdnn_ms: Mapped[float | None] = mapped_column(Float)
    steps: Mapped[int | None] = mapped_column(Integer)
    active_energy_kcal: Mapped[float | None] = mapped_column(Float)
    workouts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    complete: Mapped[bool] = mapped_column(Boolean, default=False)  # the day is over; partial days aren't mirrored
    source: Mapped[str] = mapped_column(String(20), default="apple_watch")
    # synced: memory_text is in Agent Memory under memory_scope; pending: not written yet (retried later);
    # not_mirrored: not eligible (sharing off, day not complete, or memory was erased).
    memory_status: Mapped[str] = mapped_column(String(20), default="not_mirrored")
    memory_scope: Mapped[str | None] = mapped_column(String(200))
    memory_text: Mapped[str | None] = mapped_column(String(500))
    revision: Mapped[str] = mapped_column(String(32), default=new_id)


class AssistantProposal(Base):
    """A change an external assistant proposed over MCP. Nothing in it is applied until the user approves it."""

    __tablename__ = "assistant_proposals"
    __table_args__ = (
        Index("ix_assistant_proposals_user_status", "user_id", "status"),
        UniqueConstraint("user_id", "request_key", name="uq_assistant_proposals_user_request_key"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(20))  # plan_changes | recipe | preference
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | applied | rejected | stale | expired
    summary: Mapped[str] = mapped_column(Text)
    # The validated, normalised content that will be applied, and what the user is shown.
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    preview: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    request_key: Mapped[str | None] = mapped_column(String(100))  # client retry key
    client: Mapped[str] = mapped_column(String(120), default="")  # which assistant connection proposed it
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    decided_via: Mapped[str | None] = mapped_column(String(20))  # app | client_prompt
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)


# Tables holding per-user rows, in a safe deletion order (children before parents).
USER_TABLES: tuple[type[Base], ...] = (
    AssistantProposal,
    ConnectionToken,
    WatchToken,
    CoachMessage,
    AppliedChangeSet,
    PlanItem,
    ShoppingItem,
    ActivitySession,
    CheckIn,
    HealthDay,
    Recipe,
    Routine,
    RememberedPreference,
    MemoryTombstone,
    Profile,
)
