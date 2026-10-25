"""Coach conversation. Replies are built from the shared user context (user_context.py): profile,
saved preferences, what long-term memory recalls for the message, and the recipes, routines,
week plan and (when the user shares them) Apple Watch health summaries the message is about.

Completed meals/workouts explicitly reported by the user are journalled to Calendar.
Other suggestions are returned for the user to confirm, and the client saves them through the normal recipe/routine/preference
endpoints. A turn is stored only once a reply has been produced, so a failed
request leaves no half-written conversation behind. Each reply stores what it was
built from, including whether long-term memory was actually checked.
"""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Query, Request, Response, status
from sqlalchemy import delete, select

from app.calendar import log_coach_entries, zone
from app import health
from app import preferences as prefs
from app import user_context
from app.ai import AIError
from app.assistant import coach_reply
from app.deps import AI, CurrentUser, Db, Memory, ai_failure
from app.models import CheckIn, CoachMessage, PlanItem, Profile, utcnow
from app.rhythm import learn as rhythm_learn
from app.schemas import CoachHistoryOut, CoachMessageIn, CoachMessageOut, CoachReplyOut, Suggestion

log = logging.getLogger(__name__)
router = APIRouter(tags=["coach"])
HISTORY_TURNS = 10
# Earlier turns are context, not content to repeat: long recipe replies are shortened so a small local
# model isn't slowed down by re-reading them on every message.
HISTORY_CHARS = 600


def _profile_text(profile: Profile | None) -> str:
    if profile is None:
        return "(no profile saved)"
    rows = {
        "Preferred name": profile.preferred_name,
        "Goals": ", ".join(profile.goals),
        "Dietary preferences": ", ".join(profile.dietary_preferences),
        "Available equipment": ", ".join(profile.equipment),
        "Experience level": profile.experience_level,
        "Preferred routine times": ", ".join(profile.routine_times),
    }
    return "\n".join(f"{k}: {v}" for k, v in rows.items() if v) or "(no profile saved)"


def _today_text(db: Db, user_id: str, day: str | None) -> str:
    if not day:
        return "(unknown date)"
    items = db.scalars(select(PlanItem).where(PlanItem.user_id == user_id, PlanItem.date == day))
    lines = [f"Date: {day}"]
    lines += [f"- {i.kind}: {i.title} ({i.time_slot or 'any time'}, {i.status})" for i in items] or ["- nothing planned"]
    checkin = db.scalar(select(CheckIn).where(CheckIn.user_id == user_id, CheckIn.date == day))
    if checkin:
        sleep = f", sleep {checkin.sleep_hours}h" if checkin.sleep_hours is not None else ""
        lines.append(f"Check-in: energy {checkin.energy}/5, mood {checkin.mood}/5{sleep}")
    return "\n".join(lines)


@router.get("/coach/messages")
def history(user: CurrentUser, db: Db, limit: int = Query(default=100, ge=1, le=500)) -> CoachHistoryOut:
    rows = list(
        db.scalars(
            select(CoachMessage).where(CoachMessage.user_id == user.user_id).order_by(CoachMessage.created_at.desc()).limit(limit)
        )
    )
    return CoachHistoryOut(messages=[CoachMessageOut.model_validate(m) for m in reversed(rows)])


def _records_text(ctx: user_context.UserContext) -> dict[str, str]:
    """The app records this message is about, as compact lines for the prompt."""
    blocks: dict[str, str] = {}
    if ctx.recipes:
        blocks["saved_recipes"] = "\n".join(
            f"- {r.title}" + (f" [{', '.join(r.tags)}]" if r.tags else "") + f" (ingredients: {', '.join(r.ingredients[:8])})"
            for r in ctx.recipes)
    if ctx.routines:
        blocks["saved_routines"] = "\n".join(f"- {r.name} (about {r.estimated_minutes} min: {', '.join(r.exercises[:8])})" for r in ctx.routines)
    if ctx.week_plan is not None:
        lines = [f"Week {ctx.week_plan.start_date} to {ctx.week_plan.end_date}:"]
        lines += [f"- {i.date} {i.kind}: {i.title} ({i.time_slot or 'any time'}, {i.status})" for i in ctx.week_plan.items] or ["- nothing planned"]
        blocks["week_plan"] = "\n".join(lines)
    if ctx.health is not None:
        span = f"{ctx.health_start}..{ctx.health_end}"
        lines = [f"Apple Watch daily summaries (device-measured; days in {span} not listed have no data):"]
        lines += [f"- {d.date}{'' if d.complete else ' (day not over yet)'}: {health.describe(d) or 'no measurements'}"
                  for d in ctx.health] or [f"- no Apple Watch data for {span}"]
        blocks["health_summary"] = "\n".join(lines)
    return blocks


def _clip(text: str) -> str:
    return text if len(text) <= HISTORY_CHARS else text[:HISTORY_CHARS].rstrip() + " …"


def _keep(suggestion: Suggestion, message: str) -> bool:
    """A one-off request ("no meat tonight") is never offered as a lasting preference."""
    if suggestion.type != "preference":
        return True
    return not (prefs.temporary_reason(message) or prefs.temporary_reason(suggestion.content))


@router.post("/coach/messages")
def send(
    body: CoachMessageIn, request: Request, background: BackgroundTasks, user: CurrentUser, db: Db, memory: Memory, ai: AI,
) -> CoachReplyOut:
    if prefs.sync_pending(db, memory, user.user_id):
        health.sync_pending_health(db, memory, user.user_id)
    on = date.fromisoformat(body.local_date) if body.local_date else None
    ctx = user_context.gather(db, memory, user.user_id, body.content, on=on, recall_k=5)
    saved = [p.text for p in ctx.preferences]
    memory_line = {
        "ok": "checked",
        "unavailable": "UNAVAILABLE for this reply: nothing was recalled. Don't claim to remember anything beyond <profile> and <preferences>.",
        "not_configured": "not configured: nothing was recalled. Don't claim to remember anything beyond <profile> and <preferences>.",
    }[ctx.memory.status]

    recent = list(
        db.scalars(
            select(CoachMessage)
            .where(CoachMessage.user_id == user.user_id)
            .order_by(CoachMessage.created_at.desc())
            .limit(HISTORY_TURNS)
        )
    )
    tz = zone(body.timezone)
    context = {
        "calendar_clock": utcnow().astimezone(tz).isoformat(),
        "profile": _profile_text(db.get(Profile, user.user_id)),
        "preferences": "\n".join(f"- {t}" for t in saved) or "(none saved)",
        "memory_notes": "\n".join(f"- {n.text}" for n in ctx.memory_notes) or "(none)",
        "memory_status": memory_line,
        **_records_text(ctx),
        "today": _today_text(db, user.user_id, body.local_date),
    }
    calendar_entries: list = []
    try:
        reply, suggestions = coach_reply(
            ai,
            history=[{"role": m.role, "content": _clip(m.content)} for m in reversed(recent)],
            context=context,
            message=body.content,
            calendar_entries=calendar_entries,
        )
    except AIError as exc:
        raise ai_failure(exc) from exc
    suggestions = [s for s in suggestions if _keep(s, body.content)]

    user_message = CoachMessage(user_id=user.user_id, role="user", content=body.content, suggestions=[])
    db.add(user_message)
    db.flush()
    logged = log_coach_entries(db, user.user_id, body.client_key or user_message.id,
                               body.content, calendar_entries, body.timezone)
    assistant = CoachMessage(
        user_id=user.user_id, role="assistant", content=reply, suggestions=[s.model_dump() for s in suggestions],
        context={**ctx.summary(), "calendar_entries": logged},
    )
    db.add(assistant)
    db.commit()
    # With learning on, what the user asks about shapes their Rhythm interests (in the background, throttled).
    background.add_task(rhythm_learn.refresh, request.app, user.user_id, ai)
    return CoachReplyOut(
        user_message=CoachMessageOut.model_validate(user_message),
        reply=CoachMessageOut.model_validate(assistant),
        memory_available=ctx.memory.status == "ok",
    )


@router.delete("/coach/messages", status_code=status.HTTP_204_NO_CONTENT)
def clear(user: CurrentUser, db: Db) -> Response:
    db.execute(delete(CoachMessage).where(CoachMessage.user_id == user.user_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
