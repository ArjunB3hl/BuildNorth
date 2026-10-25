"""Content deletion keeps only in-flight erasure markers and today's quota ledger."""

from sqlalchemy import delete, select, update

from app.models import (
    ConnectionToken, RhythmAgent, RhythmBrowser, RhythmBrowserRequest, RhythmCandidate, RhythmMemory,
    RhythmProfile, RhythmRecommendation, RhythmSignal, RhythmTask, RhythmTranscript, RhythmUsage, utcnow,
)
from app.rhythm import memory
from app.rhythm.policy import Actor, Policy, run
from app.rhythm.schemas import Result

TABLES = (RhythmSignal, RhythmBrowserRequest, RhythmCandidate, RhythmTranscript, RhythmRecommendation, RhythmTask,
          RhythmBrowser, RhythmAgent, RhythmMemory, RhythmUsage, RhythmProfile)


def erase_rows(p: Policy, memory_ids: list[str] | None = None) -> Result:
    p.trusted()
    deleted = {}
    p.db.execute(update(ConnectionToken).where(
        ConnectionToken.user_id == p.user_id, ConnectionToken.purpose == "rhythm").values(revoked_at=utcnow()))
    memories = list(p.db.scalars(select(RhythmMemory).where(RhythmMemory.user_id == p.user_id)))
    if memory_ids is not None:
        memory_ids.extend(row.id for row in memories)
    for row in memories:
        memory.mark_deleted(p, row)
    p.db.flush()
    deleted["rhythm_memories"] = len(memories)
    for table in TABLES:
        if table in (RhythmMemory, RhythmUsage):
            continue
        result = p.db.execute(delete(table).where(table.user_id == p.user_id))
        deleted[table.__tablename__] = result.rowcount or 0
    return Result(deleted_records=deleted, message="Rhythm content deleted. Today's acquisition counter remains until the daily reset.")


def erase(app, user_id: str) -> Result:
    memory_ids: list[str] = []
    result = run(app, Actor(user_id), lambda p: erase_rows(p, memory_ids))
    if result.status == "ok":
        result.memory_status = memory.synchronize(app, user_id)
        with app.state.session_factory() as db:
            pending = db.scalars(select(RhythmMemory.id).where(
                RhythmMemory.user_id == user_id, RhythmMemory.id.in_(memory_ids))).all()
        result.deleted_records["rhythm_memories"] = len(memory_ids) - len(pending)
        if pending:
            result.memory_status = "erase_pending"
            result.message += " Private memory erasure is queued; pending markers contain no saved text."
    return result
