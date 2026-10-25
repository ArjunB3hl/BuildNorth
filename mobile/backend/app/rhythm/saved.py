"""Saved videos for the user's chosen agent: what they saved with Save to Rhythm (with the transcript the extension
read), and the summary the agent writes back. The summary stays with the video and learning reads it; the apps don't
show it. Needs the agent's "saved" permission and the user's agent-sharing switch."""

from sqlalchemy import select

from app.models import RhythmSignal, utcnow
from app.rhythm.learn import kept_video
from app.rhythm.policy import Denied, Policy
from app.rhythm.schemas import Result, SavedVideoView

SUMMARY_CHARACTERS = 2000


def view(row: RhythmSignal) -> SavedVideoView:
    return SavedVideoView(
        video_id=row.video_id, url=f"https://www.youtube.com/watch?v={row.video_id}", title=row.title,
        channel=row.channel, duration_seconds=row.duration_seconds, topics=row.topics or [],
        description=row.description, transcript=row.transcript, summary=row.summary,
        summarized_at=row.summarized_at, saved_at=row.observed_at,
    )


def listing(p: Policy, unsummarized_only: bool, limit: int) -> Result:
    p.agent("saved")
    query = select(RhythmSignal).where(RhythmSignal.user_id == p.user_id, RhythmSignal.reaction == "more")
    if unsummarized_only:
        query = query.where(RhythmSignal.summary.is_(None))
    videos = [view(row) for row in p.db.scalars(query.order_by(RhythmSignal.observed_at.desc()).limit(limit))]
    message = f"{len(videos)} saved video{'' if len(videos) == 1 else 's'}." if videos else (
        "Every saved video has a summary." if unsummarized_only else "No saved videos yet.")
    return Result(saved_videos=videos, message=message)


def save_summary(p: Policy, video_id: str, summary: str) -> Result:
    grant = p.agent("saved")
    row = p.db.scalar(select(RhythmSignal).where(
        RhythmSignal.user_id == p.user_id, RhythmSignal.video_id == video_id, RhythmSignal.reaction == "more"))
    if row is None:
        raise Denied("not_found", "That saved video is unavailable. Use a video from list_saved_videos.")
    row.summary = summary.strip()[:SUMMARY_CHARACTERS]
    row.summarized_at = utcnow()
    row.summary_by = grant.label if grant else "Rhythm"
    # The summary can name topics the title and transcript didn't; it never removes any.
    found = kept_video(" ".join(v for v in (row.title, row.description, row.transcript, row.summary) if v))
    if found:
        row.topics = list(dict.fromkeys([*(row.topics or []), *found.topics]))
    p.db.flush()
    return Result(message="Summary saved with the video. Rhythm uses it to learn the user's interests.",
                  saved_videos=[view(row)])
