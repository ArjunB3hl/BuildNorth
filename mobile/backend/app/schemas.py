"""API request/response models. JSON uses camelCase; Python uses snake_case.

The same models validate user input and AI output (recipe/routine drafts), so a
malformed or oversized generation is rejected exactly like a malformed request.
"""

from __future__ import annotations

import re
from datetime import UTC
from datetime import date as date_type
from datetime import datetime
from typing import Any, Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class InputModel(ApiModel):
    # Unknown fields (e.g. a client-supplied userId) are rejected, never silently used.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


def _strip(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        raise ValueError("must not be blank")
    return value


def _strip_multiline(value: str) -> str:
    """Like _strip, but keeps line breaks (ingredient lists, numbered steps, chat messages)."""
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in value.replace("\r\n", "\n").split("\n")]
    value = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if not value:
        raise ValueError("must not be blank")
    return value


def _valid_date(value: str) -> str:
    try:
        date_type.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("must be a date in YYYY-MM-DD format") from exc
    return value


Text80 = Annotated[str, Field(min_length=1, max_length=80), AfterValidator(_strip)]
Text120 = Annotated[str, Field(min_length=1, max_length=120), AfterValidator(_strip)]
Text200 = Annotated[str, Field(min_length=1, max_length=200), AfterValidator(_strip)]
LocalDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_valid_date)]
TimeSlot = Literal["morning", "midday", "evening"]


# --- profile -----------------------------------------------------------------------------

class ProfileIn(InputModel):
    preferred_name: Annotated[str, Field(max_length=80)] | None = None
    goals: list[Text80] = Field(default_factory=list, max_length=12)
    dietary_preferences: list[Text80] = Field(default_factory=list, max_length=20)
    equipment: list[Text80] = Field(default_factory=list, max_length=20)
    experience_level: Literal["beginner", "intermediate", "advanced"] | None = None
    routine_times: list[TimeSlot] = Field(default_factory=list, max_length=3)
    onboarding_completed: bool = True

    @field_validator("preferred_name")
    @classmethod
    def blank_name_is_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class ProfileOut(ApiModel):
    preferred_name: str | None
    goals: list[str]
    dietary_preferences: list[str]
    equipment: list[str]
    experience_level: str | None
    routine_times: list[str]
    onboarding_completed: bool


# --- remembered preferences / memory ------------------------------------------------------

class PreferenceIn(InputModel):
    text: Annotated[str, Field(min_length=1, max_length=500), AfterValidator(_strip)]
    # Where in the app the user confirmed it; assistants' preferences arrive only through approved proposals.
    source: Literal["app", "coach", "planner"] = "app"


class PreferenceOut(ApiModel):
    id: str
    text: str
    memory_status: Literal["synced", "pending"]
    source: str
    source_detail: str | None
    created_at: datetime
    updated_at: datetime


class PreferencesOut(ApiModel):
    preferences: list[PreferenceOut]
    memory_available: bool


class MemoryHit(ApiModel):
    text: str
    kind: str
    score: float | None


class MemorySearchOut(ApiModel):
    hits: list[MemoryHit]


# --- recipes & shopping --------------------------------------------------------------------

class Ingredient(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    name: Text200
    quantity: Annotated[float, Field(ge=0, le=100_000)] | None = None
    unit: Annotated[str, Field(max_length=20)] | None = None
    note: Annotated[str, Field(max_length=200)] | None = None


class Step(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    text: Annotated[str, Field(min_length=1, max_length=2000), AfterValidator(_strip_multiline)]
    timer_seconds: Annotated[int, Field(ge=1, le=86_400)] | None = None


class Nutrition(ApiModel):
    calories: Annotated[float, Field(ge=0, le=20_000)] | None = None
    protein_g: Annotated[float, Field(ge=0, le=2_000)] | None = None
    carbs_g: Annotated[float, Field(ge=0, le=2_000)] | None = None
    fat_g: Annotated[float, Field(ge=0, le=2_000)] | None = None
    # Values are per serving and always estimates; the API never reports measured nutrition.
    is_estimate: Literal[True] = True


class RecipeIn(InputModel):
    title: Text200
    servings: Annotated[int, Field(ge=1, le=100)] = 1
    description: Annotated[str, Field(max_length=2000)] | None = None
    ingredients: list[Ingredient] = Field(default_factory=list, max_length=100)
    steps: list[Step] = Field(default_factory=list, max_length=100)
    tags: list[Text80] = Field(default_factory=list, max_length=20)
    notes: Annotated[str, Field(max_length=4000)] | None = None
    source: Literal["manual", "pasted", "coach", "assistant"] = "manual"
    nutrition: Nutrition | None = None


class RecipeOut(ApiModel):
    id: str
    title: str
    servings: int
    description: str | None
    ingredients: list[Ingredient]
    steps: list[Step]
    tags: list[str]
    notes: str | None
    source: str
    nutrition: Nutrition | None
    created_at: datetime
    updated_at: datetime


class RecipeDraft(ApiModel):
    """A generated recipe the user must review before saving."""

    title: Text200
    servings: Annotated[int, Field(ge=1, le=100)] = 1
    description: Annotated[str, Field(max_length=2000)] | None = None
    ingredients: list[Ingredient] = Field(default_factory=list, max_length=100)
    steps: list[Step] = Field(default_factory=list, max_length=100)
    nutrition: Nutrition | None = None


class ExtractIn(InputModel):
    text: Annotated[str, Field(min_length=10, max_length=20_000)]


class RecipeDraftOut(ApiModel):
    draft: RecipeDraft
    warnings: list[str]


class ShoppingItemIn(InputModel):
    name: Text200
    quantity: Annotated[float, Field(ge=0, le=100_000)] | None = None
    unit: Annotated[str, Field(max_length=20)] | None = None


class ShoppingItemPatch(InputModel):
    name: Text200 | None = None
    quantity: Annotated[float, Field(ge=0, le=100_000)] | None = None
    unit: Annotated[str, Field(max_length=20)] | None = None
    checked: bool | None = None
    clear_quantity: bool = False


class ShoppingItemOut(ApiModel):
    id: str
    name: str
    quantity: float | None
    unit: str | None
    checked: bool
    recipe_id: str | None


class AddToShoppingIn(InputModel):
    servings: Annotated[int, Field(ge=1, le=100)] | None = None


class ShoppingListOut(ApiModel):
    items: list[ShoppingItemOut]


class AddToShoppingOut(ShoppingListOut):
    added: int
    combined: int


# --- routines & sessions -------------------------------------------------------------------

class Exercise(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    name: Text120
    sets: Annotated[int, Field(ge=1, le=20)] | None = None
    reps: Annotated[int, Field(ge=1, le=500)] | None = None
    duration_seconds: Annotated[int, Field(ge=1, le=7_200)] | None = None
    weight: Annotated[float, Field(ge=0, le=2_000)] | None = None
    weight_unit: Literal["kg", "lb"] | None = None
    rest_seconds: Annotated[int, Field(ge=0, le=1_800)] | None = None
    notes: Annotated[str, Field(max_length=500)] | None = None


class RoutineIn(InputModel):
    name: Text120
    notes: Annotated[str, Field(max_length=2000)] | None = None
    exercises: list[Exercise] = Field(min_length=1, max_length=50)


class RoutineOut(ApiModel):
    id: str
    name: str
    notes: str | None
    exercises: list[Exercise]
    created_at: datetime
    updated_at: datetime


class RoutineDraft(ApiModel):
    name: Text120
    notes: Annotated[str, Field(max_length=2000)] | None = None
    exercises: list[Exercise] = Field(min_length=1, max_length=50)


class RoutineDraftOut(ApiModel):
    draft: RoutineDraft
    warnings: list[str]


class SetResult(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    reps: Annotated[int, Field(ge=0, le=500)] | None = None
    weight: Annotated[float, Field(ge=0, le=2_000)] | None = None
    duration_seconds: Annotated[int, Field(ge=0, le=7_200)] | None = None
    completed: bool = True


class SessionEntry(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    name: Text120
    weight_unit: Literal["kg", "lb"] | None = None
    sets: list[SetResult] = Field(default_factory=list, max_length=20)
    skipped: bool = False


class SessionIn(InputModel):
    routine_id: str | None = None
    routine_name: Text120
    local_date: LocalDate
    started_at: datetime
    finished_at: datetime
    entries: list[SessionEntry] = Field(min_length=1, max_length=50)
    notes: Annotated[str, Field(max_length=2000)] | None = None
    plan_item_id: str | None = None

    @field_validator("finished_at")
    @classmethod
    def finished_after_start(cls, value: datetime, info) -> datetime:  # type: ignore[no-untyped-def]
        started = info.data.get("started_at")
        if started and value < started:
            raise ValueError("finishedAt must not be before startedAt")
        return value


class SessionOut(ApiModel):
    id: str
    routine_id: str | None
    routine_name: str
    local_date: str
    started_at: datetime
    finished_at: datetime
    duration_seconds: int
    entries: list[SessionEntry]
    notes: str | None


# --- check-ins, plan, progress ------------------------------------------------------------

class CheckInIn(InputModel):
    energy: Annotated[int, Field(ge=1, le=5)]
    mood: Annotated[int, Field(ge=1, le=5)]
    sleep_hours: Annotated[float, Field(ge=0, le=24)] | None = None
    note: Annotated[str, Field(max_length=1000)] | None = None


class CheckInOut(ApiModel):
    date: str
    energy: int
    mood: int
    sleep_hours: float | None
    note: str | None


ClientKey = Annotated[str, Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9:_-]+$")]
Minutes = Annotated[int, Field(ge=1, le=600)]
NoteText = Annotated[str, Field(max_length=2000)]


class PlanItemIn(InputModel):
    date: LocalDate
    kind: Literal["meal", "activity"]
    title: Text200
    time_slot: TimeSlot | None = None
    recipe_id: str | None = None
    routine_id: str | None = None
    minutes: Minutes | None = None
    note: NoteText | None = None
    # Idempotency key from the client: repeating a create with the same key returns the first item.
    client_key: ClientKey | None = None


class PlanItemPatch(InputModel):
    status: Literal["planned", "done", "skipped"] | None = None
    date: LocalDate | None = None
    time_slot: TimeSlot | None = None


class PlanItemOut(ApiModel):
    id: str
    date: str
    kind: str
    title: str
    time_slot: str | None
    recipe_id: str | None
    routine_id: str | None
    status: str
    completed_at: datetime | None
    minutes: int | None = None
    note: str | None = None
    source: str = "manual"


class PlanRangeOut(ApiModel):
    start: str
    days: int
    items: list[PlanItemOut]


class TodayOut(ApiModel):
    date: str
    items: list[PlanItemOut]
    check_in: CheckInOut | None


class ProgressWindow(ApiModel):
    days: int
    sessions_completed: int
    active_minutes: int
    plan_done: int
    plan_skipped: int
    check_ins: int
    average_energy: float | None
    average_mood: float | None
    average_sleep_hours: float | None


class ProgressDay(ApiModel):
    date: str
    sessions: int
    active_minutes: int
    energy: int | None
    mood: int | None


class ProgressOut(ApiModel):
    today: str
    week: ProgressWindow
    month: ProgressWindow
    streak_days: int
    last7: list[ProgressDay]


# --- coach --------------------------------------------------------------------------------

class Suggestion(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    type: Literal["recipe", "routine", "preference"]
    title: Annotated[str, Field(min_length=1, max_length=120), AfterValidator(_strip)]
    content: Annotated[str, Field(min_length=1, max_length=3000), AfterValidator(_strip_multiline)]


class CoachMessageIn(InputModel):
    content: Annotated[str, Field(min_length=1, max_length=4000), AfterValidator(_strip_multiline)]
    local_date: LocalDate | None = None
    timezone: Annotated[str, Field(max_length=80)] = "UTC"
    client_key: Annotated[str, Field(min_length=1, max_length=80)] | None = None


class CoachContextOut(ApiModel):
    """What a Coach reply was built from. `memory` is whether long-term memory was actually checked."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    memory: Literal["ok", "unavailable", "not_configured"]
    topics: list[str] = []
    preferences: int = 0
    recalled: int = 0
    memory_notes: int = 0
    recipes: int = 0
    routines: int = 0
    plan_items: int = 0
    health_days: int = 0
    calendar_entries: int = 0


class CoachMessageOut(ApiModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    suggestions: list[Suggestion]
    context: CoachContextOut | None = None
    created_at: datetime


class CoachReplyOut(ApiModel):
    user_message: CoachMessageOut
    reply: CoachMessageOut
    memory_available: bool


class CoachHistoryOut(ApiModel):
    messages: list[CoachMessageOut]


# --- status & account ----------------------------------------------------------------------

class StatusOut(ApiModel):
    status: Literal["ok"]
    clerk_configured: bool
    memory_configured: bool
    ai_available: bool
    ai_provider: str
    ai_unavailable_reason: str | None


class DeleteDataOut(ApiModel):
    deleted_records: dict[str, int]
    memory_status: Literal["erased", "failed", "not_configured"]
    memory_detail: str


# --- weekly planner ------------------------------------------------------------------------

class PlannerRequest(InputModel):
    start_date: LocalDate
    days: Annotated[int, Field(ge=1, le=7)] = 7
    meal_slots: list[TimeSlot] = Field(default_factory=lambda: ["evening"], max_length=3)
    activity_days: Annotated[int, Field(ge=0, le=7)] = 3
    # Activity time limit for this plan only (not saved to the profile).
    minutes_per_day: Annotated[int, Field(ge=5, le=240)] | None = None
    recipe_ids: list[str] = Field(default_factory=list, max_length=30)
    routine_ids: list[str] = Field(default_factory=list, max_length=20)
    # Equipment for this plan only, used when the profile has none.
    equipment: list[Text80] | None = Field(default=None, max_length=20)
    # Temporary instructions for this plan only, e.g. "vegetarian this week".
    note: Annotated[str, Field(max_length=500)] | None = None


class PlanFact(ApiModel):
    id: str
    label: str
    source: Literal["profile", "preference", "request", "recipe", "routine", "memory"]


class ProposalItem(ApiModel):
    key: str
    date: str
    kind: Literal["meal", "activity"]
    title: str
    time_slot: TimeSlot | None
    recipe_id: str | None
    routine_id: str | None
    minutes: int | None
    idea: str | None
    reasons: list[str]
    warnings: list[str]


class ProposalOut(ApiModel):
    proposal_id: str
    start_date: str
    days: int
    summary: str
    items: list[ProposalItem]
    facts: list[PlanFact]
    notes: list[str]
    # Whether long-term memory was checked for this draft (None: not requested by the caller).
    memory: Literal["ok", "unavailable", "not_configured"] | None = None


class AcceptItem(InputModel):
    key: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]
    date: LocalDate
    kind: Literal["meal", "activity"]
    title: Text200
    time_slot: TimeSlot | None = None
    recipe_id: str | None = None
    routine_id: str | None = None
    minutes: Minutes | None = None
    idea: NoteText | None = None


class AcceptIn(InputModel):
    proposal_id: Annotated[str, Field(min_length=8, max_length=40, pattern=r"^[A-Za-z0-9]+$")]
    items: list[AcceptItem] = Field(min_length=1, max_length=60)


class AcceptOut(ApiModel):
    items: list[PlanItemOut]
    created: int
    already_saved: int


class ChangeItemView(ApiModel):
    date: str
    kind: Literal["meal", "activity"]
    title: str
    time_slot: TimeSlot | None = None
    recipe_id: str | None = None
    routine_id: str | None = None
    minutes: int | None = None
    note: str | None = None


class DraftItem(InputModel):
    """A proposal item the client is still editing (scope="proposal")."""

    key: Annotated[str, Field(min_length=1, max_length=40)]
    date: LocalDate
    kind: Literal["meal", "activity"]
    title: Text200
    time_slot: TimeSlot | None = None
    recipe_id: str | None = None
    routine_id: str | None = None
    minutes: Minutes | None = None
    idea: NoteText | None = None


class ChangeRequest(InputModel):
    message: Annotated[str, Field(min_length=2, max_length=500), AfterValidator(_strip)]
    today: LocalDate
    start_date: LocalDate
    days: Annotated[int, Field(ge=1, le=14)] = 7
    scope: Literal["plan", "proposal"] = "plan"
    draft_items: list[DraftItem] = Field(default_factory=list, max_length=60)
    # The item the user pointed at ("replace this meal"): a plan item id or a draft key.
    focus_key: Annotated[str, Field(max_length=40)] | None = None


class PlanChange(ApiModel):
    op: Literal["move", "replace", "remove", "add"]
    target_key: str | None
    before: ChangeItemView | None
    after: ChangeItemView | None
    description: str
    warnings: list[str]


class ChangePreviewOut(ApiModel):
    change_set_id: str
    summary: str
    changes: list[PlanChange]
    rejected: list[str]
    temporary: bool
    preference_suggestion: str | None


class ApplyChange(InputModel):
    op: Literal["move", "replace", "remove", "add"]
    target_key: Annotated[str, Field(max_length=40)] | None = None
    after: ChangeItemView | None = None


class ApplyChangesIn(InputModel):
    change_set_id: Annotated[str, Field(min_length=8, max_length=40, pattern=r"^[A-Za-z0-9]+$")]
    changes: list[ApplyChange] = Field(min_length=1, max_length=30)


class ApplyChangesOut(ApiModel):
    already_applied: bool
    items: list[PlanItemOut]


# --- weekly review -------------------------------------------------------------------------

class ReviewDay(ApiModel):
    date: str
    has_records: bool
    check_in: CheckInOut | None
    planned_activities: int
    done_activities: int
    skipped_activities: int
    open_activities: int
    planned_meals: int
    done_meals: int
    skipped_meals: int
    open_meals: int
    sessions: int
    active_minutes: int


class ReviewTotals(ApiModel):
    sessions: int
    active_minutes: int
    planned_activities: int
    done_activities: int
    skipped_activities: int
    open_activities: int
    planned_meals: int
    done_meals: int
    skipped_meals: int
    open_meals: int
    check_in_days: int
    days_without_records: int


class PlannerPreset(ApiModel):
    activity_days: int | None = None
    minutes_per_day: int | None = None
    meal_slots: list[TimeSlot] | None = None


class ReviewAdjustment(ApiModel):
    id: str
    label: str
    description: str
    preset: PlannerPreset


class WeeklyReviewOut(ApiModel):
    start: str
    end: str
    days: list[ReviewDay]
    totals: ReviewTotals
    observations: list[str]
    adjustments: list[ReviewAdjustment]


# --- external assistants (MCP) -------------------------------------------------------------

class ConnectionTokenIn(InputModel):
    label: Annotated[str, Field(min_length=1, max_length=80), AfterValidator(_strip)] = "AI assistant"


class ConnectionTokenOut(ApiModel):
    id: str
    label: str
    hint: str
    created_at: datetime
    expires_at: datetime
    revoked: bool


class NewConnectionTokenOut(ConnectionTokenOut):
    token: str  # shown once


class ConnectionsInfoOut(ApiModel):
    mcp_url: str
    oauth_authorization_server: str | None
    tokens: list[ConnectionTokenOut]


class ProposalChangeOut(ApiModel):
    description: str
    warnings: list[str]


class AssistantProposalOut(ApiModel):
    id: str
    kind: Literal["plan_changes", "recipe", "preference", "preference_update", "preference_delete"]
    status: Literal["pending", "applied", "rejected", "stale", "expired"]
    summary: str
    changes: list[ProposalChangeOut]
    rejected: list[str]
    details: dict[str, Any] | None
    client: str
    created_at: datetime
    expires_at: datetime
    decided_at: datetime | None
    decided_via: str | None
    result: dict[str, Any] | None
    next_step: str


class AssistantProposalsOut(ApiModel):
    proposals: list[AssistantProposalOut]


# --- Apple Watch -------------------------------------------------------------------------------

class WatchTokenIn(InputModel):
    label: Annotated[str, Field(min_length=1, max_length=80), AfterValidator(_strip)] = "Apple Watch"


class WatchTokenOut(ApiModel):
    id: str
    label: str
    hint: str
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked: bool


class NewWatchTokenOut(ApiModel):
    id: str
    label: str
    hint: str
    created_at: datetime
    expires_at: datetime
    token: str  # shown once, for the phone to hand to the watch; never stored


class WatchTokensOut(ApiModel):
    tokens: list[WatchTokenOut]


class WatchSettingsIn(InputModel):
    share_health: bool


class WatchSettingsOut(ApiModel):
    share_health: bool


class WatchPlanStatusIn(InputModel):
    status: Literal["planned", "done", "skipped"]


class WatchCheckInPatch(InputModel):
    """A partial check-in: keys left out keep what is stored (e.g. sleep hours or a note entered on the phone)."""

    energy: Annotated[int, Field(ge=1, le=5)] | None = None
    mood: Annotated[int, Field(ge=1, le=5)] | None = None
    sleep_hours: Annotated[float, Field(ge=0, le=24)] | None = None
    note: Annotated[str, Field(max_length=1000)] | None = None

    @field_validator("energy", "mood")
    @classmethod
    def not_null(cls, value: int | None) -> int | None:
        if value is None:
            raise ValueError("leave it out instead of sending null")
        return value


def _activity_type(value: str) -> str:
    value = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9_ -]+", value):
        raise ValueError("must be lowercase words, e.g. running or traditional_strength_training")
    return value


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)  # no offset given: UTC


class HealthWorkoutIn(InputModel):
    external_id: Annotated[str, Field(min_length=1, max_length=64)]  # HealthKit workout UUID
    activity_type: Annotated[str, Field(min_length=1, max_length=40), AfterValidator(_activity_type)]
    started_at: Annotated[datetime, AfterValidator(_aware)]
    duration_minutes: Annotated[float, Field(ge=0, le=1440)]
    energy_kcal: Annotated[float, Field(ge=0, le=20_000)] | None = None
    distance_meters: Annotated[float, Field(ge=0, le=1_000_000)] | None = None
    average_heart_rate_bpm: Annotated[float, Field(ge=0, le=300)] | None = None
    min_heart_rate_bpm: Annotated[float, Field(ge=0, le=300)] | None = None
    max_heart_rate_bpm: Annotated[float, Field(ge=0, le=300)] | None = None

    @model_validator(mode="after")
    def ordered_rate(self):
        low, high, average = self.min_heart_rate_bpm, self.max_heart_rate_bpm, self.average_heart_rate_bpm
        if low is not None and high is not None and low > high:
            raise ValueError("Minimum heart rate must not exceed maximum.")
        if average is not None and ((low is not None and average < low) or (high is not None and average > high)):
            raise ValueError("Average heart rate must fall within its recorded range.")
        return self


class SleepPattern(InputModel):
    started_at: Annotated[datetime, AfterValidator(_aware)] | None = None
    ended_at: Annotated[datetime, AfterValidator(_aware)] | None = None
    core_minutes: Annotated[int, Field(ge=0, le=1440)] | None = None
    deep_minutes: Annotated[int, Field(ge=0, le=1440)] | None = None
    rem_minutes: Annotated[int, Field(ge=0, le=1440)] | None = None
    awake_minutes: Annotated[int, Field(ge=0, le=1440)] | None = None
    unspecified_minutes: Annotated[int, Field(ge=0, le=1440)] | None = None

    @model_validator(mode="after")
    def ordered_window(self):
        if self.started_at and self.ended_at and not 0 < (self.ended_at - self.started_at).total_seconds() <= 48 * 3600:
            raise ValueError("Choose a valid sleep window of at most two days.")
        return self


class HealthDayIn(InputModel):
    """One local day from the watch. Missing metrics are null, never 0. A PUT replaces the whole day."""

    sleep_minutes: Annotated[int, Field(ge=0, le=1440)] | None = None  # asleep, for the night that ended on this date
    sleep_pattern: SleepPattern | None = None
    resting_heart_rate_bpm: Annotated[int, Field(ge=20, le=250)] | None = None
    hrv_sdnn_ms: Annotated[float, Field(ge=0, le=500)] | None = None
    steps: Annotated[int, Field(ge=0, le=200_000)] | None = None
    active_energy_kcal: Annotated[float, Field(ge=0, le=20_000)] | None = None
    workouts: list[HealthWorkoutIn] = Field(default_factory=list, max_length=20)
    complete: bool = False  # True once the day is over; only complete days are mirrored to memory


class HealthWorkoutOut(ApiModel):
    external_id: str
    activity_type: str
    started_at: datetime
    duration_minutes: float
    energy_kcal: float | None
    distance_meters: float | None
    average_heart_rate_bpm: float | None
    min_heart_rate_bpm: float | None = None
    max_heart_rate_bpm: float | None = None


class HealthDayOut(ApiModel):
    date: str
    sleep_minutes: int | None
    sleep_pattern: SleepPattern | None = None
    resting_heart_rate_bpm: int | None
    hrv_sdnn_ms: float | None
    steps: int | None
    active_energy_kcal: float | None
    workouts: list[HealthWorkoutOut]
    complete: bool
    source: Literal["apple_watch"]
    memory_status: Literal["synced", "pending", "not_mirrored"]
    updated_at: datetime


class HealthDaysOut(ApiModel):
    days: list[HealthDayOut]


class WatchTodayOut(ApiModel):
    date: str
    items: list[PlanItemOut]
    check_in: CheckInOut | None
    health: HealthDayOut | None
    share_health: bool
