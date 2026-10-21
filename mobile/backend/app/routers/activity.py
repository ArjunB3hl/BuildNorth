"""Exercise routines and completed activity sessions."""

from __future__ import annotations

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select

from app.ai import AIError
from app.assistant import extract_routine
from app.deps import AI, CurrentUser, Db, ai_failure, not_found
from app.models import ActivitySession, PlanItem, Routine, utcnow
from app.schemas import ExtractIn, RoutineDraftOut, RoutineIn, RoutineOut, SessionIn, SessionOut

router = APIRouter(tags=["activity"])


def _owned_routine(db: Db, user_id: str, routine_id: str) -> Routine:
    routine = db.scalar(select(Routine).where(Routine.id == routine_id, Routine.user_id == user_id))
    if routine is None:
        raise not_found("Routine")
    return routine


@router.get("/routines")
def list_routines(user: CurrentUser, db: Db) -> list[RoutineOut]:
    routines = db.scalars(select(Routine).where(Routine.user_id == user.user_id).order_by(Routine.updated_at.desc()))
    return [RoutineOut.model_validate(r) for r in routines]


@router.post("/routines", status_code=status.HTTP_201_CREATED)
def create_routine(body: RoutineIn, user: CurrentUser, db: Db) -> RoutineOut:
    routine = Routine(
        user_id=user.user_id, name=body.name, notes=body.notes, exercises=[e.model_dump() for e in body.exercises]
    )
    db.add(routine)
    db.commit()
    return RoutineOut.model_validate(routine)


@router.get("/routines/{routine_id}")
def get_routine(routine_id: str, user: CurrentUser, db: Db) -> RoutineOut:
    return RoutineOut.model_validate(_owned_routine(db, user.user_id, routine_id))


@router.put("/routines/{routine_id}")
def update_routine(routine_id: str, body: RoutineIn, user: CurrentUser, db: Db) -> RoutineOut:
    routine = _owned_routine(db, user.user_id, routine_id)
    routine.name, routine.notes = body.name, body.notes
    routine.exercises = [e.model_dump() for e in body.exercises]
    db.commit()
    return RoutineOut.model_validate(routine)


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(routine_id: str, user: CurrentUser, db: Db) -> Response:
    db.delete(_owned_routine(db, user.user_id, routine_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/routines/extract")
def extract(body: ExtractIn, user: CurrentUser, ai: AI) -> RoutineDraftOut:
    """Turn a workout description into a draft routine. Nothing is saved until the user confirms."""
    try:
        draft, warnings = extract_routine(ai, body.text)
    except AIError as exc:
        raise ai_failure(exc) from exc
    return RoutineDraftOut(draft=draft, warnings=warnings)


@router.get("/sessions")
def list_sessions(user: CurrentUser, db: Db, limit: int = Query(default=50, ge=1, le=200)) -> list[SessionOut]:
    sessions = db.scalars(
        select(ActivitySession)
        .where(ActivitySession.user_id == user.user_id)
        .order_by(ActivitySession.finished_at.desc())
        .limit(limit)
    )
    return [SessionOut.model_validate(s) for s in sessions]


@router.get("/sessions/{session_id}")
def get_session(session_id: str, user: CurrentUser, db: Db) -> SessionOut:
    session = db.scalar(
        select(ActivitySession).where(ActivitySession.id == session_id, ActivitySession.user_id == user.user_id)
    )
    if session is None:
        raise not_found("Session")
    return SessionOut.model_validate(session)


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def save_session(body: SessionIn, user: CurrentUser, db: Db) -> SessionOut:
    routine_id = None
    if body.routine_id:
        routine_id = _owned_routine(db, user.user_id, body.routine_id).id
    session = ActivitySession(
        user_id=user.user_id,
        routine_id=routine_id,
        routine_name=body.routine_name,
        local_date=body.local_date,
        started_at=body.started_at,
        finished_at=body.finished_at,
        duration_seconds=int((body.finished_at - body.started_at).total_seconds()),
        entries=[e.model_dump() for e in body.entries],
        notes=body.notes,
    )
    db.add(session)
    if body.plan_item_id:
        item = db.scalar(select(PlanItem).where(PlanItem.id == body.plan_item_id, PlanItem.user_id == user.user_id))
        if item is None:
            raise not_found("Plan item")
        item.status, item.completed_at = "done", utcnow()
    db.commit()
    return SessionOut.model_validate(session)
