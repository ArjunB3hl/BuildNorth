"""Bounded transcript acquisition and delivery. Cache lookups never bypass current policy."""

from datetime import timedelta

from sqlalchemy import select, update

from app.models import RhythmBrowser, RhythmBrowserRequest, RhythmCandidate, RhythmTask, RhythmTranscript, utcnow
from app.rhythm import browser, tasks
from app.rhythm.policy import Denied, Policy
from app.rhythm.schemas import (
    BrowserProof, BrowserRequestView, ImportedTranscript, Result, TranscriptInput, TranscriptUpload, TranscriptView,
)


def authorize(p: Policy, task_id: str, candidate_id: str) -> tuple[RhythmTask, RhythmCandidate]:
    task = p.task(task_id, "transcripts")
    candidate = tasks.eligible(p, task, candidate_id, shortlisted=True)
    if not task.analyze_transcripts:
        raise Denied("permission_required", "This task only permits metadata. Start a transcript analysis task explicitly.")
    if not p.profile.data["consent"]["transcripts"]:
        raise Denied("permission_required", "Transcript processing is off in your phone interests.")
    return task, candidate


def authorize_entry(p: Policy, task: RhythmTask, candidate: RhythmCandidate, entry: RhythmTranscript) -> None:
    if entry.user_id != p.user_id or entry.video_id != candidate.video_id or entry.expires_at <= utcnow():
        raise Denied("transcript_unavailable", "This transcript is unavailable or has expired.")
    if entry.source == "youtube_displayed":
        original = p.owned(RhythmBrowser, entry.browser_session_id)
        if original.status not in ("active", "disconnected") or not original.allow_transcripts:
            raise Denied("permission_required", "Permission for this cached transcript was revoked.")
    elif entry.source != "user_supplied":
        raise Denied("transcript_unavailable", "This transcript source is not supported.")


def selected_browser(p: Policy, task: RhythmTask, candidate: RhythmCandidate):
    if not task.browser_session_id:
        raise Denied("browser_unavailable", "Open this shortlisted video, permit it in Rhythm, and attach it to this task.")
    selected = p.browser(task.browser_session_id, transcripts=True)
    if selected.video_id != candidate.video_id:
        raise Denied("browser_unavailable", "Open this shortlisted video and choose Use this page before reading its transcript.")
    return selected


def request_view(row: RhythmBrowserRequest) -> BrowserRequestView:
    return BrowserRequestView(
        id=row.id, task_id=row.task_id, candidate_id=row.candidate_id, browser_session_id=row.browser_session_id,
        page_ref=row.page_ref, video_id=row.video_id, language=row.language, profile_revision=row.profile_revision,
        expires_at=row.expires_at, idempotency_key=row.id,
    )


def deliver(p: Policy, task: RhythmTask, candidate: RhythmCandidate, entry: RhythmTranscript, body: TranscriptInput) -> Result:
    authorize_entry(p, task, candidate, entry)
    if body.language and entry.language != body.language:
        raise Denied("transcript_unavailable", "The available transcript does not establish the requested language.")
    start = min(body.range.offset, len(entry.segments))
    end = min(start + body.range.limit, len(entry.segments))
    # Bounded by both segment count and text length, including a page of long imported paragraphs.
    while sum(len(s["text"]) for s in entry.segments[start:end]) > 12_000 and end > start:
        end -= 1
    candidate.delivered_segments = sorted(set(candidate.delivered_segments) | set(range(start, end)))
    return Result(
        status="transcript_partial" if entry.completeness == "partial" else "ok",
        task_id=task.id, profile_revision=p.profile.revision, source_refs=[entry.id],
        transcript=TranscriptView(
            id=entry.id, video_id=entry.video_id, language=entry.language, source=entry.source,
            completeness=entry.completeness, captured_at=entry.captured_at, segments=entry.segments[start:end],
            offset=start, next_offset=end if end < len(entry.segments) else None,
            total_segments=len(entry.segments), limitation=entry.limitation,
        ),
        limitations=[entry.limitation] if entry.limitation else [],
    )


def request(p: Policy, task_id: str, candidate_id: str, body: TranscriptInput) -> Result:
    task, candidate = authorize(p, task_id, candidate_id)
    if candidate.transcript_id:
        entry = p.db.scalar(select(RhythmTranscript).where(
            RhythmTranscript.user_id == p.user_id, RhythmTranscript.id == candidate.transcript_id))
        if entry:
            return deliver(p, task, candidate, entry, body)
    entries = p.db.scalars(select(RhythmTranscript).where(
        RhythmTranscript.user_id == p.user_id, RhythmTranscript.video_id == candidate.video_id,
        RhythmTranscript.expires_at > utcnow()).order_by(RhythmTranscript.captured_at.desc())).all()
    for entry in entries:
        if body.language and entry.language != body.language:
            continue
        try:
            authorize_entry(p, task, candidate, entry)
        except Denied:
            continue
        candidate.transcript_id = entry.id
        task.cache_hits += 1
        p.count("cache_hits")
        return deliver(p, task, candidate, entry, body)

    previous = p.db.scalar(select(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.task_id == task.id,
        RhythmBrowserRequest.candidate_id == candidate.id))
    if previous:
        if previous.status in ("pending", "claimed"):
            if previous.expires_at <= utcnow():
                previous.status = "transcript_unavailable"
                p.count("provider_failures")
            else:
                selected_browser(p, task, candidate)
                return Result(status="pending", task_id=task.id, message="Waiting for the permitted side panel. No new attempt was made.")
        state = previous.status if previous.status in {"cancelled", "stale_context", "provider_error"} else "transcript_unavailable"
        return Result(status=state, task_id=task.id, message="This acquisition ended. Rhythm will not retry it automatically.")

    selected = selected_browser(p, task, candidate)
    usage = p.usage()
    if task.transcript_attempts >= p.settings.attempts_per_task or usage.transcript_attempts >= p.settings.attempts_per_day:
        raise Denied("budget_exceeded", "The transcript acquisition limit has been reached.")
    # The per-user DB lock protects this reservation across threads, workers and reconnects.
    task.transcript_attempts += 1
    usage.transcript_attempts += 1
    row = RhythmBrowserRequest(
        user_id=p.user_id, task_id=task.id, candidate_id=candidate.id, browser_session_id=selected.id,
        page_ref=selected.page_ref, video_id=candidate.video_id, language=body.language,
        profile_revision=p.profile.revision, expires_at=utcnow() + timedelta(seconds=p.settings.request_seconds),
    )
    p.db.add(row)
    p.db.flush()
    return Result(status="pending", task_id=task.id, requests=[request_view(row)],
                  message="One transcript attempt reserved. Keep the permitted page and Rhythm side panel open.")


def validate_request(p: Policy, browser_id: str, row: RhythmBrowserRequest):
    task, candidate = authorize(p, row.task_id, row.candidate_id)
    selected = selected_browser(p, task, candidate)
    if (row.browser_session_id != browser_id or selected.id != browser_id or row.page_ref != selected.page_ref
            or row.video_id != selected.video_id or row.profile_revision != p.profile.revision):
        raise Denied("stale_context", "This request no longer belongs to the permitted page.")
    if row.expires_at <= utcnow():
        raise Denied("stale_context", "This browser request expired.")
    return task, candidate, selected


def poll(p: Policy, browser_id: str, proof: BrowserProof) -> Result:
    selected = browser.heartbeat(p, browser_id, proof)
    pending = p.db.scalars(select(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.browser_session_id == browser_id,
        RhythmBrowserRequest.status.in_(["pending", "claimed"]))).all()
    requests = []
    for row in pending:
        try:
            validate_request(p, browser_id, row)
        except Denied as exc:
            row.status = exc.status
            continue
        if row.status == "pending":
            requests.append(request_view(row))
    return Result(browser=browser.view(selected, p), requests=requests[:3], profile_revision=p.profile.revision)


def claim(p: Policy, browser_id: str, request_id: str, proof: BrowserProof) -> Result:
    p.trusted()
    row = p.owned(RhythmBrowserRequest, request_id)
    _, _, selected = validate_request(p, browser_id, row)
    browser.check_proof(selected, proof)
    if row.status != "pending":
        raise Denied("cancelled", "This acquisition was already claimed or stopped. It will not be read twice.")
    row.status = "claimed"
    return Result(requests=[request_view(row)], profile_revision=p.profile.revision)


def complete(p: Policy, browser_id: str, request_id: str, body: TranscriptUpload) -> Result:
    p.trusted()
    row = p.owned(RhythmBrowserRequest, request_id)
    task, candidate, selected = validate_request(p, browser_id, row)
    browser.check_proof(selected, body)
    if row.status in ("ok", "transcript_partial", "transcript_unavailable", "provider_error"):
        return Result(status=row.status, task_id=task.id, message="Result was already recorded.")
    if row.status != "claimed":
        raise Denied("cancelled", "This acquisition was not claimed or has stopped.")
    browser.fresh_capture(body.captured_at)
    if body.completeness == "unavailable":
        row.status = "transcript_unavailable"
        p.count("provider_failures")
        return Result(status="transcript_unavailable", task_id=task.id,
                      message=body.limitation or "YouTube's transcript for this video couldn't be read. It may have no captions.")
    duration = (candidate.page_metadata or {}).get("duration_seconds")
    if ((row.language and row.language != body.language)
            or (duration is not None and body.segments[-1].start_seconds > duration + 5)):
        row.status = "provider_error"
        p.count("provider_failures")
        return Result(status="provider_error", message="The transcript language or timestamps did not match the request.")
    # A claimed full result without positive coverage evidence is downgraded.
    full = (body.completeness == "complete" and body.observed_start and body.observed_end
            and not body.virtualized and body.total_visible_rows == len(body.segments))
    completeness = "complete" if full else "partial"
    entry = RhythmTranscript(
        user_id=p.user_id, video_id=row.video_id, language=body.language, source=body.source,
        completeness=completeness, browser_session_id=browser_id, page_ref=row.page_ref,
        segments=[s.model_dump() for s in body.segments], captured_at=body.captured_at,
        expires_at=utcnow() + timedelta(hours=p.settings.cache_hours),
        limitation=body.limitation or ("" if full else "Only displayed text was read; full transcript coverage is not established."),
    )
    p.db.add(entry)
    p.db.flush()
    candidate.transcript_id = entry.id
    row.status = "ok" if full else "transcript_partial"
    return Result(status=row.status, task_id=task.id, source_refs=[entry.id],
                  message="Displayed transcript recorded. The agent must request its bounded segments separately.")


def cancel(p: Policy, browser_id: str, request_id: str) -> Result:
    p.trusted()
    p.owned(RhythmBrowser, browser_id)
    row = p.owned(RhythmBrowserRequest, request_id)
    if row.browser_session_id != browser_id:
        raise Denied("not_found", "This request is unavailable.")
    if row.status in ("pending", "claimed"):
        row.status = "cancelled"
    return Result(status="cancelled", message="Transcript reading stopped.")


def import_text(p: Policy, task_id: str, candidate_id: str, body: ImportedTranscript) -> Result:
    p.trusted()  # A model cannot invent source material and label it user supplied.
    task, candidate = authorize(p, task_id, candidate_id)
    if candidate.transcript_id:
        return Result(message="This candidate already has text. Start a new task to provide a different transcript.", task_id=task.id)
    duration = (candidate.page_metadata or {}).get("duration_seconds")
    if duration is not None and body.segments[-1].start_seconds > duration + 5:
        raise Denied("provider_error", "The supplied timestamps extend beyond the known video duration.")
    p.db.execute(update(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.task_id == task.id,
        RhythmBrowserRequest.candidate_id == candidate.id, RhythmBrowserRequest.status.in_(["pending", "claimed"])
    ).values(status="cancelled"))
    entry = RhythmTranscript(
        user_id=p.user_id, video_id=candidate.video_id, language=body.language, source="user_supplied",
        completeness=body.completeness, segments=[s.model_dump() for s in body.segments],
        limitation="Text supplied by the user; not independently verified against YouTube.",
        captured_at=utcnow(), expires_at=utcnow() + timedelta(hours=p.settings.cache_hours),
    )
    p.db.add(entry)
    p.db.flush()
    candidate.transcript_id = entry.id
    return Result(task_id=task.id, source_refs=[entry.id], message="Your text is attached to this shortlisted video.")
