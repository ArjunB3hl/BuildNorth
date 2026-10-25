"""Only trusted app sessions can confirm the authoritative interests."""

from sqlalchemy import delete, select, update

from app.models import (
    RhythmBrowser, RhythmBrowserRequest, RhythmMemory, RhythmProfile, RhythmRecommendation, RhythmSignal, RhythmTask,
    RhythmTranscript, utcnow,
)
from app.rhythm.policy import NOT_LEARNED, Denied, Policy, limits
from app.rhythm.schemas import FeedbackContext, InterestsInput, InterestsProfile, MemoryView, Metrics, Result, SettingsInput


def profile_view(p: RhythmProfile) -> InterestsProfile:
    return InterestsProfile(owner_user_id=p.user_id, profile_revision=p.revision, updated_at=p.updated_at,
                            confirmed=p.confirmed, **p.data)


def get_interests(p: Policy) -> Result:
    grant = p.agent("interests")
    row = p.profile
    memories = p.db.scalars(select(RhythmMemory).where(
        RhythmMemory.user_id == p.user_id, RhythmMemory.status.in_(["confirmed", "forget_requested"]))).all()
    feedback = p.db.scalars(select(RhythmRecommendation).where(
        RhythmRecommendation.user_id == p.user_id, RhythmRecommendation.feedback.is_not(None))
        .order_by(RhythmRecommendation.created_at.desc()).limit(60)).all()
    feedback.sort(key=lambda r: r.data.get("feedback_at") or r.created_at.isoformat(), reverse=True)
    # Only confirmed SQL facts are authoritative. Recall is an optional annotation added separately.
    return Result(
        status="ok" if row and row.confirmed else "profile_required",
        message="" if row and row.confirmed else NOT_LEARNED,
        profile=profile_view(row) if row else None,
        profile_revision=row.revision if row else None,
        memories=[MemoryView(id=m.id, text=m.text, status=m.status, evidence_ref=m.evidence_ref,
                             memory_status=m.memory_status) for m in memories[:30]]
        if not grant or "memory" in grant.capabilities else [],
        memory_status="not_authorized" if grant and "memory" not in grant.capabilities else "not_checked",
        limits=limits(p.settings),
        feedback=[FeedbackContext(video_id=r.video_id, action=r.feedback, reason=r.feedback_reason,
                                  updated_at=r.data.get("feedback_at") or r.created_at) for r in feedback[:20]],
        learned=evidence_summary(row) if row else None,
    )


def evidence_summary(row: RhythmProfile) -> dict:
    """Limited supporting evidence for agents: why each interest is there, and the user's own pins and blocks."""
    choices = row.data.get("choices") or {}
    topics = (row.learned or {}).get("topics", {})
    return {
        "learning": bool(row.data["consent"].get("learn")),
        "pinned": choices.get("pinned", []),
        "blocked": choices.get("blocked", []),
        "why": {t: {k: v for k, v in e.items() if k in ("videos", "saved", "chats", "feedback", "notInterested")}
                for t, e in topics.items() if t in row.data.get("topics", [])},
    }


def save_interests(p: Policy, body: InterestsInput) -> Result:
    p.trusted()
    current = p.profile
    if body.expected_revision != (current.revision if current else 0):
        raise Denied("stale_context", "Your interests changed on another screen. Refresh before saving.")
    data = body.model_dump(exclude={"expected_revision"})
    if current is None:
        current = RhythmProfile(user_id=p.user_id, revision=1, data=data)
        p.db.add(current)
        p.profile = current
    else:
        current.revision += 1
        current.data = data
        current.updated_at = utcnow()
    current.confirmed = bool(body.topics and body.purposes)
    stale_open_work(p)
    apply_permissions(p, body.consent.model_dump(), list(body.enabled_sites))
    from app.rhythm.memory import mark_deleted
    for memory in p.db.scalars(select(RhythmMemory).where(
            RhythmMemory.user_id == p.user_id, RhythmMemory.evidence_ref.is_(None))):
        mark_deleted(p, memory)
    if body.consent.memory and current.confirmed:
        text = (f"Confirmed video interests (phone revision {current.revision}): {', '.join(body.topics)}. "
                f"Purposes: {', '.join(body.purposes)}. "
                f"Hard exclusions: {', '.join(body.excluded_topics + body.excluded_content_types) or 'none selected'}.")
        p.db.add(RhythmMemory(user_id=p.user_id, text=text[:500], status="confirmed", memory_status="pending"))
    p.db.flush()
    return Result(profile=profile_view(current), profile_revision=current.revision,
                  message="Interests saved. Existing tasks must use a new decision.")


def stale_open_work(p: Policy) -> None:
    """A new profile revision: open tasks, browser requests and pending suggestions need a new decision."""
    p.db.execute(update(RhythmTask).where(RhythmTask.user_id == p.user_id,
                                        RhythmTask.status.in_(["pending", "active"])).values(status="stale"))
    p.db.execute(update(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.status.in_(["pending", "claimed"])
    ).values(status="stale_context"))
    p.db.execute(update(RhythmMemory).where(RhythmMemory.user_id == p.user_id, RhythmMemory.status == "pending")
                 .values(status="stale"))


def apply_permissions(p: Policy, consent: dict, enabled_sites: list[str]) -> None:
    """Withdrawn permissions take effect at once: pages pause, cached text and learning signals go, memory is erased."""
    if not consent["metadata"] or "youtube" not in enabled_sites:
        p.db.execute(update(RhythmBrowser).where(RhythmBrowser.user_id == p.user_id)
                     .values(status="paused", page_metadata=None))
    if not consent["transcripts"]:
        p.db.execute(delete(RhythmTranscript).where(RhythmTranscript.user_id == p.user_id))
    if not consent["metadata"] or "youtube" not in enabled_sites:
        p.db.execute(delete(RhythmSignal).where(RhythmSignal.user_id == p.user_id))
    elif not consent.get("learn"):
        # Learning off deletes what was collected passively; the user's own "Save" / "Not interested" stay.
        p.db.execute(delete(RhythmSignal).where(RhythmSignal.user_id == p.user_id, RhythmSignal.reaction.is_(None)))
    if not consent["memory"]:
        for memory in p.db.scalars(select(RhythmMemory).where(
                RhythmMemory.user_id == p.user_id, RhythmMemory.scope.is_not(None))):
            if memory.memory_status != "writing":
                memory.memory_status = "erase_pending"


# The interest fields learning fills in, emptied when learning is switched off.
UNLEARNED = {"topics": [], "purposes": [], "experience_level": None, "preferred_duration_minutes": None,
             "strict_duration": False, "available_equipment": [], "excluded_topics": []}


def save_settings(p: Policy, body: SettingsInput) -> Result:
    """Change only the user's switches. Learned interests stay as they are (see app.rhythm.learn)."""
    p.trusted()
    current = p.profile
    if body.expected_revision != (current.revision if current else 0):
        raise Denied("stale_context", "Your settings changed on another screen. Refresh before saving.")
    consent, sites = body.consent.model_dump(), list(body.enabled_sites)
    if current is None:
        data = InterestsInput(expected_revision=0).model_dump(exclude={"expected_revision"})
        current = RhythmProfile(user_id=p.user_id, revision=1, confirmed=False,
                                data={**data, "enabled_sites": sites, "consent": consent})
        p.db.add(current)
        p.profile = current
    else:
        if current.data.get("consent") == consent and current.data.get("enabled_sites") == sites:
            return Result(profile=profile_view(current), profile_revision=current.revision, message="Nothing changed.")
        was_learning = bool(current.data.get("consent", {}).get("learn"))
        current.revision += 1
        current.data = {**current.data, "enabled_sites": sites, "consent": consent}
        if was_learning and not consent["learn"]:
            # Off means nothing learned is kept: the interests were derived from the history being deleted.
            # The user's own choices (pins, level, length, equipment) stay in force.
            from app.rhythm.learn import compose
            cleared = {**current.data, **UNLEARNED}
            current.data = {**cleared, **compose(cleared, None)}
            current.confirmed = bool(current.data["topics"] and current.data["purposes"])
            current.learned = None
            current.learned_at = None
        current.updated_at = utcnow()
        stale_open_work(p)
    apply_permissions(p, consent, sites)
    # The summary note the old typed-in form mirrored into memory ("Confirmed video interests…") no longer applies.
    from app.rhythm.memory import mark_deleted
    for memory in p.db.scalars(select(RhythmMemory).where(
            RhythmMemory.user_id == p.user_id, RhythmMemory.evidence_ref.is_(None))):
        mark_deleted(p, memory)
    p.db.flush()
    return Result(profile=profile_view(current), profile_revision=current.revision, message="Settings saved.")


def metrics(p: Policy) -> Result:
    p.trusted()
    if p.profile is None:
        return Result(status="profile_required", message=NOT_LEARNED, limits=limits(p.settings))
    row = p.usage()
    return Result(metrics=Metrics.model_validate(row), limits=limits(p.settings))
