"""Grounded saved results. The agent selects candidates and exact evidence, never invents source IDs."""

from datetime import timedelta

from sqlalchemy import select

from app.models import RhythmBrowser, RhythmMemory, RhythmRecommendation, RhythmTranscript, utcnow
from app.rhythm import tasks, transcripts
from app.rhythm.policy import Denied, Policy, browser_available
from app.rhythm.relevance import screen
from app.rhythm.schemas import FeedbackInput, RecommendationView, RecommendationsInput, Result, VideoMetadata


def view(p: Policy, row: RhythmRecommendation) -> RecommendationView:
    return RecommendationView(id=row.id, task_id=row.task_id, video_id=row.video_id,
                              profile_revision=row.profile_revision, created_at=row.created_at,
                              feedback=row.feedback, stale=not p.profile or row.profile_revision != p.profile.revision, **row.data)


def delivery(p: Policy, rows: list[RhythmRecommendation]) -> str:
    for row in rows:
        if not row.displayed_at or row.displayed_at < utcnow() - timedelta(seconds=15) or not row.displayed_browser_id:
            return "saved_for_later"
        browser = p.db.scalar(select(RhythmBrowser).where(
            RhythmBrowser.user_id == p.user_id, RhythmBrowser.id == row.displayed_browser_id))
        if browser is None or not browser_available(browser, p.settings):
            return "saved_for_later"
    return "displayed" if rows else "saved_for_later"


def publish(p: Policy, task_id: str, body: RecommendationsInput) -> Result:
    task = p.task(task_id)
    rows = []
    if len({i.candidate_id for i in body.items}) != len(body.items):
        raise Denied("provider_error", "Each recommendation must reference a different candidate.")
    for item in body.items:
        candidate = tasks.eligible(p, task, item.candidate_id, shortlisted=True)
        metadata = VideoMetadata.model_validate(candidate.page_metadata)
        decision = screen(p.profile.data, metadata)
        sources = [candidate.id]
        excerpts = []
        limitations = list(decision.limitations)
        basis = item.analysis_basis
        if basis == "metadata":
            if item.citations:
                raise Denied("provider_error", "A metadata-only recommendation cannot cite a transcript.")
            limitations.append("Based on metadata only; no transcript was used for this recommendation.")
        else:
            transcripts.authorize(p, task_id, candidate.id)
            entry = p.db.scalar(select(RhythmTranscript).where(
                RhythmTranscript.user_id == p.user_id, RhythmTranscript.id == candidate.transcript_id))
            if entry is None:
                raise Denied("transcript_unavailable", "No authorized transcript was read for this candidate.")
            transcripts.authorize_entry(p, task, candidate, entry)
            expected_basis = "user_text" if entry.source == "user_supplied" else "transcript"
            if basis != expected_basis or not item.citations:
                raise Denied("provider_error", "Declare the actual text source and cite at least one segment you read.")
            for citation in item.citations:
                if citation.segment_index not in candidate.delivered_segments or citation.segment_index >= len(entry.segments):
                    raise Denied("provider_error", "A citation must reference a segment returned for this task.")
                segment = entry.segments[citation.segment_index]
                if citation.quote not in segment["text"]:
                    raise Denied("provider_error", "The quoted text does not match the declared source.")
                excerpts.append({"start_seconds": segment["start_seconds"], "text": citation.quote})
            sources.append(entry.id)
            if entry.completeness == "partial":
                basis = "transcript_partial" if basis == "transcript" else "user_text_partial"
            if entry.limitation:
                limitations.append(entry.limitation)
        # The saved explanation is constructed from checked matching preferences. Richer agent
        # interpretation stays in its host; unverified prose cannot masquerade as a source claim here.
        explanation = " ".join(decision.reasons)
        if excerpts:
            explanation += " The excerpts below are exact passages from the declared text source."
        row = p.db.scalar(select(RhythmRecommendation).where(
            RhythmRecommendation.user_id == p.user_id, RhythmRecommendation.task_id == task.id,
            RhythmRecommendation.video_id == candidate.video_id))
        data = {"url": metadata.canonical_url, "title": metadata.title,
                "duration_seconds": metadata.duration_seconds, "matching_preferences": decision.matching_preferences,
                "explanation": explanation, "analysis_basis": basis, "source_refs": sources,
                "excerpts": excerpts, "limitations": limitations}
        if row is None:
            row = RhythmRecommendation(user_id=p.user_id, task_id=task.id, video_id=candidate.video_id,
                                       profile_revision=p.profile.revision, data=data)
            p.db.add(row)
            p.db.flush()
        else:
            if "feedback_at" in row.data:
                data["feedback_at"] = row.data["feedback_at"]
            if data != row.data:
                row.data = data
                row.displayed_at, row.displayed_browser_id = None, None
        rows.append(row)
    return Result(task_id=task.id, profile_revision=p.profile.revision, recommendations=[view(p, r) for r in rows],
                  delivery=delivery(p, rows), message="Recommendations saved. Display is reported only after a live panel acknowledges them.")


def list_saved(p: Policy) -> Result:
    p.trusted()
    rows = list(p.db.scalars(select(RhythmRecommendation).where(RhythmRecommendation.user_id == p.user_id)
                             .order_by(RhythmRecommendation.created_at.desc()).limit(60)))
    return Result(recommendations=[view(p, r) for r in rows], delivery=delivery(p, rows))


def displayed(p: Policy, recommendation_id: str, browser_id: str) -> Result:
    p.trusted()
    browser = p.browser(browser_id)
    row = p.owned(RhythmRecommendation, recommendation_id)
    row.displayed_at, row.displayed_browser_id = utcnow(), browser.id
    return Result(delivery="displayed")


def apply_feedback(p: Policy, row: RhythmRecommendation, body: FeedbackInput) -> None:
    if row.feedback == (None if body.feedback == "clear" else body.feedback) and row.feedback_reason == body.reason:
        return
    row.feedback = None if body.feedback == "clear" else body.feedback
    row.feedback_reason = body.reason
    row.data = {**row.data, "feedback_at": utcnow().isoformat()}
    # Feedback is explicit, not a profile inference. Replacing it retires its old memory copy.
    from app.rhythm.memory import mark_deleted
    for old in p.db.scalars(select(RhythmMemory).where(
            RhythmMemory.user_id == p.user_id, RhythmMemory.evidence_ref == row.id,
            RhythmMemory.status.in_(["confirmed", "forget_requested"]))):
        mark_deleted(p, old)
    if body.feedback != "clear" and p.profile and p.profile.data["consent"]["memory"]:
        p.db.add(RhythmMemory(user_id=p.user_id, evidence_ref=row.id, status="confirmed", memory_status="pending",
                              text=f"User feedback on YouTube video {row.video_id}: {body.feedback}. {body.reason}"[:500]))


def feedback(p: Policy, recommendation_id: str, body: FeedbackInput) -> Result:
    p.require_profile()
    row = p.owned(RhythmRecommendation, recommendation_id)
    if p.actor.client_id is not None:
        p.agent("feedback")
        existing = p.db.scalar(select(RhythmMemory).where(
            RhythmMemory.user_id == p.user_id, RhythmMemory.evidence_ref == row.id,
            RhythmMemory.status == f"feedback_{body.feedback}"))
        if not existing:
            p.db.add(RhythmMemory(user_id=p.user_id, evidence_ref=row.id, status=f"feedback_{body.feedback}",
                                 text=body.reason or f"Mark this video as {body.feedback.replace('_', ' ')}."))
        return Result(status="pending", message="Review the suggested feedback on your phone. It has not changed your preferences or ranking.")
    apply_feedback(p, row, body)
    return Result(recommendations=[view(p, row)], message="Feedback saved.")
