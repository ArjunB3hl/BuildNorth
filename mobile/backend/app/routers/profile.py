"""Profile, remembered preferences and the user's view of their memory."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from surrealdb.memory import MemoryServiceError

from app import health
from app import preferences as prefs
from app.deps import CurrentUser, Db, Memory, not_found
from app.models import HealthDay, Profile, RememberedPreference
from app.schemas import MemoryHit, MemorySearchOut, PreferenceIn, PreferenceOut, PreferencesOut, ProfileIn, ProfileOut

router = APIRouter(tags=["profile"])

EMPTY_PROFILE = ProfileOut(
    preferred_name=None,
    goals=[],
    dietary_preferences=[],
    equipment=[],
    experience_level=None,
    routine_times=[],
    onboarding_completed=False,
)


def memory_unavailable(detail: str = "Memory is temporarily unavailable. Your saved app data is unaffected.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


@router.get("/profile")
def get_profile(user: CurrentUser, db: Db) -> ProfileOut:
    profile = db.get(Profile, user.user_id)
    return ProfileOut.model_validate(profile) if profile else EMPTY_PROFILE


@router.put("/profile")
def save_profile(body: ProfileIn, user: CurrentUser, db: Db) -> ProfileOut:
    profile = db.get(Profile, user.user_id)
    if profile is None:
        profile = Profile(user_id=user.user_id)
        db.add(profile)
    for field, value in body.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    return ProfileOut.model_validate(profile)


def _owned_preference(db: Db, user_id: str, preference_id: str) -> RememberedPreference:
    pref = db.scalar(
        select(RememberedPreference).where(RememberedPreference.id == preference_id, RememberedPreference.user_id == user_id)
    )
    if pref is None:
        raise not_found("Preference")
    return pref


@router.get("/preferences")
def list_preferences(user: CurrentUser, db: Db, memory: Memory) -> PreferencesOut:
    available = prefs.sync_pending(db, memory, user.user_id)
    if available:  # skip when memory just failed, rather than wait on it twice
        health.sync_pending_health(db, memory, user.user_id)
    return PreferencesOut(
        preferences=[PreferenceOut.model_validate(p) for p in prefs.list_preferences(db, user.user_id)],
        memory_available=available,
    )


@router.post("/preferences", status_code=status.HTTP_201_CREATED)
def add_preference(body: PreferenceIn, user: CurrentUser, db: Db, memory: Memory) -> PreferenceOut:
    return PreferenceOut.model_validate(prefs.create_preference(db, memory, user.user_id, body.text, body.source))


@router.patch("/preferences/{preference_id}")
def correct_preference(preference_id: str, body: PreferenceIn, user: CurrentUser, db: Db, memory: Memory) -> PreferenceOut:
    pref = _owned_preference(db, user.user_id, preference_id)
    return PreferenceOut.model_validate(prefs.update_preference(db, memory, pref, body.text, "app"))


@router.delete("/preferences/{preference_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_preference(preference_id: str, user: CurrentUser, db: Db, memory: Memory) -> Response:
    prefs.delete_preference(db, memory, _owned_preference(db, user.user_id, preference_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/memory/search")
def search_memory(
    user: CurrentUser, db: Db, memory: Memory, q: str = Query(min_length=1, max_length=300)
) -> MemorySearchOut:
    """What long-term memory recalls for this user (only their own scope)."""
    if memory is None:
        raise memory_unavailable("Memory isn't configured on the server.")
    try:
        memory = memory.bound_to(user.user_id)
        facts = memory.recall(user.user_id, q, k=8)
    except MemoryServiceError as exc:
        raise memory_unavailable() from exc
    if memory.shared_context:
        # A lens is not the authorization boundary. Even if an upstream result is
        # unscoped or synthesized, only this account's authoritative text may leave
        # our server. No client-provided owner, lens, or scope participates here.
        allowed = set(db.scalars(select(RememberedPreference.text).where(
            RememberedPreference.user_id == user.user_id)))
        allowed.update(text for text in db.scalars(select(HealthDay.memory_text).where(
            HealthDay.user_id == user.user_id)) if text)
        facts = [fact for fact in facts if fact.text in allowed]
    facts = prefs.filter_stale(facts, prefs.stale_texts(db, user.user_id))
    if health.erase_pending(db, user.user_id):  # health sharing was turned off; the erase is still being retried
        facts = [f for f in facts if not health.is_health_text(f.text)]
    return MemorySearchOut(hits=[MemoryHit(text=f.text, kind=f.kind, score=f.score) for f in facts])


@router.delete("/memory")
def erase_memory(user: CurrentUser, db: Db, memory: Memory) -> dict[str, int]:
    """Permanently erase everything Agent Memory holds for this user, and the preferences mirrored there.
    Health days stay in the app, marked as no longer mirrored."""
    if memory is None:
        raise memory_unavailable("Memory isn't configured on the server.")
    try:
        forgotten = prefs.erase_all(db, memory, user.user_id)
    except MemoryServiceError as exc:
        raise memory_unavailable("Memory couldn't be erased right now. Nothing was removed; please try again.") from exc
    return {"forgotten": forgotten}
