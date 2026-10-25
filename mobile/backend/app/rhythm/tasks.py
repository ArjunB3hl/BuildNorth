"""Explicit, short-lived tasks. Candidate and shortlist limits count unique videos, including retries."""

from datetime import timedelta

from sqlalchemy import select, update

from app.models import (
    RhythmAgent, RhythmBrowserRequest, RhythmCandidate, RhythmRecommendation, RhythmSignal, RhythmTask, utcnow,
)
from app.rhythm.policy import Denied, Policy
from app.rhythm.relevance import screen
from app.rhythm.schemas import CandidateView, Result, ShortlistInput, TaskInput, TaskView, VideoMetadata


def candidate_view(c: RhythmCandidate) -> CandidateView:
    return CandidateView(id=c.id, task_id=c.task_id, video_id=c.video_id, metadata=c.page_metadata,
                         relevance=c.relevance, shortlisted=c.shortlisted, source=c.source, captured_at=c.captured_at)


def view(p: Policy, task: RhythmTask) -> TaskView:
    candidates = p.db.scalars(select(RhythmCandidate).where(
        RhythmCandidate.user_id == p.user_id, RhythmCandidate.task_id == task.id)).all()
    state = task.status
    if task.profile_revision != p.profile.revision or task.expires_at <= utcnow():
        state = "stale"
    return TaskView(
        id=task.id, action=task.action, request=task.request, status=state, profile_revision=task.profile_revision,
        analyze_transcripts=task.analyze_transcripts, browser_session_id=task.browser_session_id,
        agent_id=task.agent_id, expires_at=task.expires_at, candidate_checks=task.candidate_checks,
        transcript_attempts=task.transcript_attempts, cache_hits=task.cache_hits,
        candidates=[candidate_view(c) for c in candidates],
    )


def create(p: Policy, body: TaskInput) -> Result:
    profile = p.require_profile(metadata=True)
    agent = p.agent("recommend")
    existing = p.db.scalar(select(RhythmTask).where(
        RhythmTask.user_id == p.user_id, RhythmTask.idempotency_key == body.idempotency_key))
    if existing:
        if agent and existing.agent_id != agent.id:
            raise Denied("permission_required", "This retry key belongs to another connection.")
        return Result(task_id=existing.id, task=view(p, existing))
    agent_id = agent.id if agent else body.agent_id
    if agent_id:
        bound = p.owned(RhythmAgent, agent_id)
        if bound.status != "active" or "recommend" not in bound.capabilities or not profile.data["consent"]["agent"]:
            raise Denied("permission_required", "Choose an authorized agent connection.")
        p.check_connection(bound)
        if body.analyze_transcripts and "transcripts" not in bound.capabilities:
            raise Denied("permission_required", "This agent is not allowed to analyze transcripts.")
    if body.analyze_transcripts and not profile.data["consent"]["transcripts"]:
        raise Denied("permission_required", "Allow transcript processing in your phone interests first.")
    if body.browser_session_id:
        p.browser(body.browser_session_id, transcripts=body.analyze_transcripts)
    active = p.db.scalars(select(RhythmTask.id).where(
        RhythmTask.user_id == p.user_id, RhythmTask.status.in_(["pending", "active"]),
        RhythmTask.expires_at > utcnow())).all()
    if len(active) >= 10:
        raise Denied("budget_exceeded", "Finish or cancel an existing task before starting another.")
    task = RhythmTask(
        user_id=p.user_id, agent_id=agent_id, browser_session_id=body.browser_session_id, action=body.action,
        request=body.request.strip(), analyze_transcripts=body.analyze_transcripts,
        profile_revision=profile.revision, idempotency_key=body.idempotency_key,
        status="pending" if agent else "active", expires_at=utcnow() + timedelta(minutes=p.settings.task_minutes),
    )
    p.db.add(task)
    p.db.flush()
    return Result(status="pending" if agent else "ok", task_id=task.id, task=view(p, task),
                  message="Review this task in the phone app or side panel." if agent else "Task started.")


def approve(p: Policy, task_id: str) -> Result:
    p.trusted()
    profile = p.require_profile(metadata=True)
    task = p.owned(RhythmTask, task_id)
    if task.profile_revision != profile.revision or task.expires_at <= utcnow():
        raise Denied("stale_context", "Start a new task with your current interests.")
    if task.status == "pending":
        task.status = "active"
    task = p.task(task_id)
    return Result(task_id=task.id, task=view(p, task), message="Task approved.")


def cancel(p: Policy, task_id: str) -> Result:
    p.trusted()
    task = p.owned(RhythmTask, task_id)
    task.status = "cancelled"
    p.db.execute(update(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.task_id == task_id,
        RhythmBrowserRequest.status.in_(["pending", "claimed"])).values(status="cancelled"))
    return Result(status="cancelled", message="Task stopped.")


def status(p: Policy, task_id: str) -> Result:
    p.require_profile()
    grant = p.agent("recommend")
    task = p.owned(RhythmTask, task_id)
    if grant and task.agent_id != grant.id:
        raise Denied("permission_required", "This task belongs to another connection.")
    return Result(task_id=task.id, task=view(p, task), profile_revision=p.profile.revision)


def list_tasks(p: Policy) -> Result:
    p.require_profile()
    grant = p.agent("recommend")
    query = select(RhythmTask).where(RhythmTask.user_id == p.user_id)
    if grant:
        query = query.where(RhythmTask.agent_id == grant.id)
    rows = p.db.scalars(query.order_by(RhythmTask.created_at.desc()).limit(10))
    return Result(tasks=[view(p, t) for t in rows], profile_revision=p.profile.revision)


def dismissed(p: Policy, video_id: str) -> bool:
    """A recommendation the user dismissed, or a video they marked "Not interested" in the side panel."""
    return bool(
        p.db.scalar(select(RhythmRecommendation.id).where(
            RhythmRecommendation.user_id == p.user_id, RhythmRecommendation.video_id == video_id,
            RhythmRecommendation.feedback.in_(["dismissed", "not_for_me"])))
        or p.db.scalar(select(RhythmSignal.id).where(
            RhythmSignal.user_id == p.user_id, RhythmSignal.video_id == video_id, RhythmSignal.reaction == "less"))
    )


def add_candidate(p: Policy, task: RhythmTask, metadata: VideoMetadata, source: str) -> RhythmCandidate:
    existing = p.db.scalar(select(RhythmCandidate).where(
        RhythmCandidate.user_id == p.user_id, RhythmCandidate.task_id == task.id,
        RhythmCandidate.video_id == metadata.video_id))
    if existing:
        return existing
    if task.candidate_checks + task.candidate_reservations >= p.settings.candidates_per_task:
        raise Denied("budget_exceeded", "This task has reached its candidate limit.")
    task.candidate_checks += 1
    p.count("candidate_checks")
    decision = screen(p.profile.data, metadata)
    if dismissed(p, metadata.video_id):
        decision = decision.model_copy(update={"status": "irrelevant", "reasons": ["You previously dismissed this video."]})
    if decision.status != "relevant":
        p.count("blocked_requests")
    candidate = RhythmCandidate(
        user_id=p.user_id, task_id=task.id, video_id=metadata.video_id,
        page_metadata=metadata.model_dump() if decision.status != "irrelevant" else None,
        relevance=decision.model_dump(), source=source,
    )
    p.db.add(candidate)
    p.db.flush()
    return candidate


def add_selected(p: Policy, task_id: str, browser_id: str) -> Result:
    task = p.task(task_id)
    p.agent("page")
    browser = p.browser(browser_id)
    if browser.page_metadata is None:
        raise Denied("permission_required", "Use this page again.")
    candidate = add_candidate(p, task, VideoMetadata.model_validate(browser.page_metadata), "selected_page")
    task.browser_session_id = browser.id
    return Result(task_id=task.id, candidates=[candidate_view(candidate)], task=view(p, task))


def eligible(p: Policy, task: RhythmTask, candidate_id: str, *, shortlisted: bool = False) -> RhythmCandidate:
    candidate = p.owned(RhythmCandidate, candidate_id)
    if candidate.task_id != task.id:
        raise Denied("not_found", "This candidate does not belong to the task.")
    if candidate.page_metadata is None:
        raise Denied("irrelevant", "This candidate was excluded.")
    decision = screen(p.profile.data, VideoMetadata.model_validate(candidate.page_metadata))
    if dismissed(p, candidate.video_id):
        raise Denied("irrelevant", "You previously dismissed this video.")
    if decision.status != "relevant":
        raise Denied(decision.status, " ".join(decision.reasons))
    if shortlisted and not candidate.shortlisted:
        raise Denied("permission_required", "Only shortlisted candidates can be analyzed or recommended.")
    return candidate


def shortlist(p: Policy, task_id: str, body: ShortlistInput) -> Result:
    task = p.task(task_id)
    rows = [eligible(p, task, candidate_id) for candidate_id in set(body.candidate_ids)]
    previous = p.db.scalars(select(RhythmCandidate.id).where(
        RhythmCandidate.user_id == p.user_id, RhythmCandidate.task_id == task.id, RhythmCandidate.shortlisted.is_(True))).all()
    # Monotonic: dropping an already analyzed video cannot buy another slot.
    if len(set(previous) | {c.id for c in rows}) > p.settings.shortlist_per_task:
        raise Denied("budget_exceeded", "This task has used all its shortlist slots.")
    for candidate in rows:
        candidate.shortlisted = True
    p.db.flush()
    return Result(task_id=task.id, task=view(p, task), message="Shortlist saved. This alone does not request any transcripts.")
