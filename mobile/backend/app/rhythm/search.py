"""Reserve before IO; re-check the task/profile/grant after IO. Retries reuse the same search."""

import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import select

from app.models import RhythmCandidate, RhythmTask
from app.rhythm import tasks
from app.rhythm.policy import Actor, Denied, Policy, run
from app.rhythm.schemas import Result, SearchInput
from app.rhythm.youtube import ProviderError


@dataclass
class Reservation:
    key: str
    limit: int
    query: str
    language: str | None


def reserve(p: Policy, task_id: str, body: SearchInput):
    task = p.task(task_id, "search")
    if task.action != "recommend":
        raise Denied("permission_required", "This is a selected-video evaluation. Start a recommendation task to search.")
    key = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()
    previous = task.search_state.get(key)
    if previous:
        if previous["status"] == "pending":
            return Result(status="pending", task_id=task.id, message="This search is already in progress.")
        if previous["status"] == "provider_error":
            return Result(status="provider_error", message="This search failed. It will not be retried automatically.")
        rows = p.db.scalars(select(RhythmCandidate).where(
            RhythmCandidate.user_id == p.user_id, RhythmCandidate.task_id == task.id,
            RhythmCandidate.id.in_(previous["candidate_ids"]))).all()
        return Result(task_id=task.id, candidates=[tasks.candidate_view(c) for c in rows])
    remaining = p.settings.candidates_per_task - task.candidate_checks - task.candidate_reservations
    if remaining <= 0 or task.search_requests >= 2 or p.usage().search_requests >= p.settings.searches_per_day:
        raise Denied("budget_exceeded", "This task or today's video search limit has been reached.")
    limit = min(body.limit, remaining)
    task.search_state = {**task.search_state, key: {"status": "pending", "candidate_ids": []}}
    task.candidate_reservations += limit
    task.search_requests += 1
    p.count("search_requests")
    # Search terms remain bounded; all returned metadata is screened against the full profile.
    query = body.query
    if not any(topic.casefold() in query.casefold() for topic in p.profile.data["topics"]):
        query += " " + p.profile.data["topics"][0]
    language = body.language or next(iter(p.profile.data["preferred_languages"]), None)
    return Reservation(key, limit, query[:250], language)


def search(app, actor: Actor, task_id: str, body: SearchInput) -> Result:
    if not app.state.rhythm_youtube.configured:
        # Still authenticate and enforce the task/grant before disclosing provider state.
        def unavailable(p):
            p.task(task_id, "search")
            return Result(status="provider_error", message="Video search is not configured. Set YOUTUBE_API_KEY on the backend. Selected-page analysis still works.")
        return run(app, actor, unavailable)
    reservation = run(app, actor, lambda p: reserve(p, task_id, body))
    if isinstance(reservation, Result):
        return reservation
    try:
        videos = app.state.rhythm_youtube.search(reservation.query, reservation.limit, reservation.language)
        error = None
    except ProviderError as exc:
        videos, error = [], str(exc)

    def finish(p: Policy) -> Result:
        task = p.task(task_id, "search")  # fresh policy, current profile, active grant, task ownership
        task.candidate_reservations = max(0, task.candidate_reservations - reservation.limit)
        if error:
            p.count("provider_failures")
            task.search_state = {**task.search_state, reservation.key: {"status": "provider_error", "candidate_ids": []}}
            return Result(status="provider_error", task_id=task.id, message=error)
        candidates = [tasks.add_candidate(p, task, metadata, "youtube_api") for metadata in videos[:reservation.limit]]
        task.search_state = {**task.search_state, reservation.key: {"status": "ok", "candidate_ids": [c.id for c in candidates]}}
        candidates.sort(key=lambda c: c.relevance.get("score", 0), reverse=True)
        return Result(task_id=task.id, profile_revision=p.profile.revision,
                      candidates=[tasks.candidate_view(c) for c in candidates], task=tasks.view(p, task),
                      message="Search returned metadata only. Choose a small relevant shortlist before any analysis.",
                      limitations=["Search does not provide transcripts. Open a shortlisted video, or supply your own text."])
    return run(app, actor, finish)
