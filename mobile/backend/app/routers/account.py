"""Service status and deletion of all of a user's data."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from sqlalchemy import delete
from surrealdb.memory import MemoryServiceError

from app.deps import CurrentUser, Db, Memory
from app.models import USER_TABLES, MemoryTombstone
from app.memory import user_scope
from app.schemas import DeleteDataOut, StatusOut
from app.rhythm import data as rhythm_data

log = logging.getLogger(__name__)
router = APIRouter(tags=["account"])


@router.get("/status")
@router.get("/health")
def service_status(request: Request) -> StatusOut:
    """Public, secret-free summary the app uses to explain unavailable features."""
    state = request.app.state
    ai = getattr(state, "ai", None)
    return StatusOut(
        status="ok",
        clerk_configured=getattr(state, "verifier", None) is not None,
        memory_configured=getattr(state, "memory", None) is not None,
        ai_available=ai is not None,
        ai_provider=ai.name if ai is not None else "none",
        ai_unavailable_reason=None if ai is not None else getattr(state, "ai_unavailable_reason", None),
    )


@router.get("/me")
def me(user: CurrentUser) -> dict[str, str]:
    return {"userId": user.user_id}


@router.delete("/account/data")
def delete_all_data(request: Request, user: CurrentUser, db: Db, memory: Memory) -> DeleteDataOut:
    """Delete every app record and erase Agent Memory for this user. Reports exactly what happened.

    The Clerk sign-in account itself is not deleted here.
    """
    rhythm = rhythm_data.erase(request.app, user.user_id)
    if memory is None:
        memory_status, memory_detail = "not_configured", "Memory isn't configured on this server, so nothing was stored there."
    else:
        try:
            forgotten = memory.erase_user(user.user_id)
            memory_status, memory_detail = "erased", f"Erased {forgotten} memory record(s)."
        except MemoryServiceError as exc:
            log.warning("Memory erase failed during data deletion for %s: %s", user.user_id, exc)
            memory_status = "failed"
            memory_detail = "Memory couldn't be erased right now. Your app data was deleted; try deleting again later to erase memory."

    deleted: dict[str, int] = dict(rhythm.deleted_records or {})
    for table in USER_TABLES:
        if table in rhythm_data.TABLES:
            # Private-context erasure markers and today's non-content quota survive until their purpose is complete.
            continue
        result = db.execute(delete(table).where(table.user_id == user.user_id))  # type: ignore[attr-defined]
        deleted[table.__tablename__] = result.rowcount or 0
    if memory_status == "failed":
        # Keep one marker so a later request can finish the memory erase.
        db.add(MemoryTombstone(user_id=user.user_id, scope=user_scope(user.user_id), text=None))
    db.commit()
    if rhythm.memory_status == "erase_pending":
        memory_status = "failed"
        memory_detail += " Rhythm's private memory erasure is queued for retry."
    elif memory is None and rhythm.memory_status == "ok":
        memory_status = "erased"
        memory_detail = "Rhythm's private memory erasure completed. General Rhythm memory is not configured."
    memory_detail += " Today's Rhythm acquisition counter remains until the daily reset."
    return DeleteDataOut(deleted_records=deleted, memory_status=memory_status, memory_detail=memory_detail)
