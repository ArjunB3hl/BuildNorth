"""Selected-page grants and short side-panel leases; never arbitrary browser commands."""

from datetime import timedelta

from sqlalchemy import select, update

from app.models import RhythmBrowser, RhythmBrowserRequest, RhythmTask, utcnow
from app.rhythm.policy import Denied, Policy, browser_available
from app.rhythm.relevance import screen
from app.rhythm.schemas import BrowserInput, BrowserProof, BrowserView, Result, VideoMetadata


def view(row: RhythmBrowser, p: Policy) -> BrowserView:
    return BrowserView(id=row.id, label=row.label, status=row.status, page_ref=row.page_ref,
                       video_id=row.video_id, metadata=row.page_metadata, captured_at=row.captured_at,
                       available=browser_available(row, p.settings), allow_transcripts=row.allow_transcripts)


def fresh_capture(captured_at) -> None:
    now = utcnow()
    if captured_at.tzinfo is None or not now - timedelta(minutes=2) <= captured_at <= now + timedelta(seconds=10):
        raise Denied("stale_context", "Capture this page again; its details are out of date.")


def permit(p: Policy, body: BrowserInput) -> Result:
    p.trusted()
    profile = p.require_profile(metadata=True)
    if profile.revision != body.expected_revision:
        raise Denied("stale_context", "Your phone interests changed. Refresh before using this page.")
    fresh_capture(body.captured_at)
    existing = p.db.scalar(select(RhythmBrowser).where(
        RhythmBrowser.user_id == p.user_id, RhythmBrowser.video_id == body.metadata.video_id,
        RhythmBrowser.captured_at == body.captured_at, RhythmBrowser.status == "active"))
    if existing:
        return Result(browser=view(existing, p), profile_revision=profile.revision)
    decision = screen(profile.data, body.metadata)
    p.count("candidate_checks")
    if decision.status != "relevant":
        # No URL or page contents are retained for blocked page observations.
        p.count("blocked_requests")
        return Result(status=decision.status, message=" ".join(decision.reasons),
                      profile_revision=profile.revision, limitations=decision.limitations)
    active = p.db.scalars(select(RhythmBrowser).where(
        RhythmBrowser.user_id == p.user_id, RhythmBrowser.status == "active",
        RhythmBrowser.last_seen_at > utcnow() - timedelta(seconds=p.settings.browser_lease_seconds))).all()
    if len(active) >= 5:
        raise Denied("budget_exceeded", "Pause an existing browser connection before adding another.")
    row = RhythmBrowser(user_id=p.user_id, label=body.label, video_id=body.metadata.video_id,
                        page_metadata=body.metadata.model_dump(), captured_at=body.captured_at,
                        allow_transcripts=body.allow_transcripts and profile.data["consent"]["transcripts"])
    p.db.add(row)
    p.db.flush()
    return Result(browser=view(row, p), profile_revision=profile.revision, message="This video is permitted. No transcript has been requested.")


def check_proof(browser: RhythmBrowser, proof: BrowserProof) -> None:
    if browser.page_ref != proof.page_ref or browser.video_id != proof.video_id:
        raise Denied("stale_context", "The selected page changed. Use the new page explicitly.")


def heartbeat(p: Policy, browser_id: str, proof: BrowserProof) -> RhythmBrowser:
    p.trusted()
    browser = p.browser(browser_id, live=False)
    check_proof(browser, proof)
    if browser.last_seen_at < utcnow() - timedelta(seconds=p.settings.browser_lease_seconds):
        # Reopening a panel is not permission to resume an old page or retry a claimed request.
        raise Denied("browser_unavailable", "The connection ended. Use this page again to reconnect.")
    browser.last_seen_at = utcnow()
    return browser


def pause(p: Policy, browser_id: str, *, revoke: bool = True) -> Result:
    p.trusted()
    browser = p.owned(RhythmBrowser, browser_id)
    # Losing a live page ends extraction; explicit Pause/revoke also withdraws use of cached text.
    browser.status = "paused" if revoke or browser.status == "paused" else "disconnected"
    browser.page_metadata = None
    p.db.execute(update(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.browser_session_id == browser_id,
        RhythmBrowserRequest.status.in_(["pending", "claimed"])).values(status="cancelled"))
    return Result(message="Page access stopped. Existing transcript requests are cancelled.")


def selected(p: Policy, browser_id: str) -> Result:
    p.agent("page")
    browser = p.browser(browser_id)
    if browser.page_metadata is None:
        raise Denied("permission_required", "Use this page again in Rhythm.")
    decision = screen(p.require_profile(metadata=True).data, VideoMetadata.model_validate(browser.page_metadata))
    if decision.status != "relevant":
        raise Denied(decision.status, " ".join(decision.reasons))
    return Result(browser=view(browser, p), profile_revision=p.profile.revision)
