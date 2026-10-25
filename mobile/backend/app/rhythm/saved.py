"""Account-owned saved videos for the library and approved agents."""

from datetime import timedelta

from sqlalchemy import select

from app.models import RhythmSignal, utcnow
from app.rhythm.learn import kept_video
from app.rhythm.policy import Denied, Policy
from app.rhythm.schemas import Result, SavedVideoView

SUMMARY_CHARACTERS = 6000
SUMMARY_LEASE = timedelta(minutes=10)


def view(row: RhythmSignal, *, include_transcript: bool = True) -> SavedVideoView:
    pending = row.summary_requested_at and row.summary_requested_at > utcnow() - SUMMARY_LEASE
    return SavedVideoView(
        video_id=row.video_id, url=f"https://www.youtube.com/watch?v={row.video_id}", title=row.title,
        channel=row.channel, duration_seconds=row.duration_seconds, topics=row.topics or [],
        description=row.description, transcript=row.transcript if include_transcript else None, summary=row.summary,
        has_transcript=bool(row.transcript),
        summary_state="ready" if row.summary else "no_transcript" if not row.transcript else "generating" if pending else "not_ready",
        summarized_at=row.summarized_at, saved_at=row.observed_at,
    )


def listing(p: Policy, unsummarized_only: bool, limit: int, *, include_transcript: bool = True) -> Result:
    p.agent("saved")
    query = select(RhythmSignal).where(RhythmSignal.user_id == p.user_id, RhythmSignal.reaction == "more")
    if unsummarized_only:
        query = query.where(RhythmSignal.summary.is_(None))
    videos = [view(row, include_transcript=include_transcript)
              for row in p.db.scalars(query.order_by(RhythmSignal.observed_at.desc()).limit(limit))]
    message = f"{len(videos)} saved video{'' if len(videos) == 1 else 's'}." if videos else (
        "Every saved video has a summary." if unsummarized_only else "No saved videos yet.")
    return Result(saved_videos=videos, message=message)


def save_summary(p: Policy, video_id: str, summary: str) -> Result:
    grant = p.agent("saved")
    row = p.db.scalar(select(RhythmSignal).where(
        RhythmSignal.user_id == p.user_id, RhythmSignal.video_id == video_id, RhythmSignal.reaction == "more"))
    if row is None:
        raise Denied("not_found", "That saved video is unavailable. Use a video from list_saved_videos.")
    if not summary.strip():
        raise Denied("provider_error", "The summary was empty. Try again.")
    row.summary = summary.strip()[:SUMMARY_CHARACTERS]
    row.summarized_at = utcnow()
    row.summary_requested_at = None
    row.summary_by = grant.label if grant else "Rhythm"
    # The summary can name topics the title and transcript didn't; it never removes any.
    found = kept_video(" ".join(v for v in (row.title, row.description, row.transcript, row.summary) if v))
    if found:
        row.topics = list(dict.fromkeys([*(row.topics or []), *found.topics]))
    p.db.flush()
    return Result(message="Summary saved in your Content library with the original video link.",
                  saved_videos=[view(row)])
