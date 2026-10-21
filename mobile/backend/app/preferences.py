"""Remembered preferences: authoritative rows in the database, mirrored into Agent Memory.

A preference is saved to the database first, then written to its own memory
scope. If Agent Memory is unavailable the row stays `pending` and is retried on
later requests. Corrections and deletions erase the old scope; if that fails, a
tombstone keeps retrying and the old text is filtered out of recall meanwhile,
so an outdated preference never keeps steering advice.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session
from surrealdb.memory import MemoryServiceError

from app.memory import MemoryService, RecalledFact
from app.models import HealthDay, MemoryTombstone, RememberedPreference

log = logging.getLogger(__name__)
MAX_RETRIES_PER_REQUEST = 5
SOURCES = ("app", "coach", "planner", "assistant")
# A one-off request ("no meat tonight", "short workouts this week") is never stored as a lasting preference.
TEMPORARY = re.compile(
    r"\b(tonight|today|tomorrow|this (week|weekend|morning|afternoon|evening|month|time)|next (week|weekend)|"
    r"for now|just for|for the (day|week|weekend)|until (the weekend|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b",
    re.IGNORECASE,
)


def temporary_reason(text: str) -> str | None:
    """The time-bound phrase that makes this a one-off request rather than a lasting preference, if any."""
    match = TEMPORARY.search(text)
    return match.group(0) if match else None


def _write(memory: MemoryService, pref: RememberedPreference) -> bool:
    try:
        pref.memory_scope = memory.remember_preference(pref.user_id, pref.id, pref.text)
        pref.memory_status = "synced"
        return True
    except (MemoryServiceError, ValueError) as exc:
        log.warning("Memory write failed for a preference of %s: %s", pref.user_id, exc)
        pref.memory_status = "pending"
        return False


def _erase(db: Session, memory: MemoryService | None, user_id: str, scope: str | None, text: str | None) -> bool:
    """Erase one scope now, or leave a tombstone that retries it. Returns False when a tombstone was left."""
    if not scope:
        return True
    if memory is not None:
        try:
            memory.forget_scope(user_id, scope)
            return True
        except (MemoryServiceError, ValueError) as exc:
            log.warning("Memory erase failed for %s; will retry: %s", user_id, exc)
    db.add(MemoryTombstone(user_id=user_id, scope=scope, text=text))
    return False


def sync_pending(db: Session, memory: MemoryService | None, user_id: str) -> bool:
    """Retry outstanding memory writes and erasures. Returns whether memory is reachable."""
    if memory is None:
        return False
    reachable = True
    tombstones = db.scalars(select(MemoryTombstone).where(MemoryTombstone.user_id == user_id).limit(MAX_RETRIES_PER_REQUEST))
    for tomb in tombstones:
        try:
            memory.forget_scope(user_id, tomb.scope)
            db.delete(tomb)
        except (MemoryServiceError, ValueError):
            reachable = False
            break
    if reachable:
        pending = db.scalars(
            select(RememberedPreference)
            .where(RememberedPreference.user_id == user_id, RememberedPreference.memory_status == "pending")
            .limit(MAX_RETRIES_PER_REQUEST)
        )
        for pref in pending:
            if not _write(memory, pref):
                reachable = False
                break
    db.commit()
    return reachable


def list_preferences(db: Session, user_id: str) -> list[RememberedPreference]:
    return list(
        db.scalars(
            select(RememberedPreference)
            .where(RememberedPreference.user_id == user_id)
            .order_by(RememberedPreference.created_at.desc())
        )
    )


def create_preference(
    db: Session, memory: MemoryService | None, user_id: str, text: str, source: str = "app", source_detail: str | None = None
) -> RememberedPreference:
    pref = RememberedPreference(
        user_id=user_id, text=text, memory_status="pending", source=source, source_detail=(source_detail or None) and source_detail[:160]
    )
    db.add(pref)
    db.flush()  # assigns the id used in the memory scope
    if memory is not None:
        _write(memory, pref)
    db.commit()
    return pref


def update_preference(
    db: Session, memory: MemoryService | None, pref: RememberedPreference, text: str,
    source: str = "app", source_detail: str | None = None,
) -> RememberedPreference:
    _erase(db, memory, pref.user_id, pref.memory_scope, pref.text)
    # The corrected text gets a new row (and so a new scope), so a retried erase of the
    # old scope can never remove the correction. `source` is whoever made the correction.
    replacement = RememberedPreference(
        user_id=pref.user_id, text=text, memory_status="pending", created_at=pref.created_at,
        source=source, source_detail=(source_detail or None) and source_detail[:160],
    )
    db.delete(pref)
    db.add(replacement)
    db.flush()
    if memory is not None:
        _write(memory, replacement)
    db.commit()
    return replacement


def delete_preference(db: Session, memory: MemoryService | None, pref: RememberedPreference) -> None:
    _erase(db, memory, pref.user_id, pref.memory_scope, pref.text)
    db.delete(pref)
    db.commit()


def stale_texts(db: Session, user_id: str) -> set[str]:
    return {t.text.strip().lower() for t in db.scalars(select(MemoryTombstone).where(MemoryTombstone.user_id == user_id)) if t.text}


def filter_stale(facts: list[RecalledFact], stale: set[str]) -> list[RecalledFact]:
    return [f for f in facts if f.text.strip().lower() not in stale]


def erase_all(db: Session, memory: MemoryService, user_id: str) -> int:
    """Erase the user's whole memory subtree, then the preference rows that mirrored it.

    Health days stay in the app (they are the user's records, not memory), but their mirror is gone:
    they are marked not mirrored, and only a new upload or turning sharing on again mirrors them anew.
    """
    forgotten = memory.erase_user(user_id)
    db.execute(delete(RememberedPreference).where(RememberedPreference.user_id == user_id))
    db.execute(delete(MemoryTombstone).where(MemoryTombstone.user_id == user_id))
    db.execute(update(HealthDay).where(HealthDay.user_id == user_id)
               .values(memory_status="not_mirrored", memory_scope=None, memory_text=None))
    db.commit()
    return forgotten
