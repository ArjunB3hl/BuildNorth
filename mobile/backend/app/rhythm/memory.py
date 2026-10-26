"""Opt-in memory in user scopes of a shared Context or explicit private Contexts.

Network calls happen outside DB transactions. In-flight writes retain their deletion
marker; a late write is erased again before the marker can be removed. Recall only
annotates exact, still-confirmed SQL text, so generated profiles/history cannot revive
a deleted fact or override the current phone profile.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from sqlalchemy import select
from surrealdb.memory import Memory, MemoryServiceError

from app.auth import CLERK_USER_ID
from app.memory import MemoryService, preference_scope
from app.models import RhythmCandidate, RhythmMemory, RhythmRecommendation, utcnow
from app.rhythm.policy import Actor, Denied, Policy, run
from app.rhythm.schemas import FeedbackInput, MemoryProposalInput, MemoryView, Result

log = logging.getLogger(__name__)


class PrivateContext(MemoryService):
    # Sharing a user's Context must not couple the two features' recall or erase operations.
    scope_root = "buildnorth/rhythm"

    def remember_confirmed(self, user_id: str, record_id: str, text: str) -> None:
        self._check_owner(user_id)
        scope = preference_scope(user_id, record_id, root=self.scope_root)
        self._ensure_registered(scope)
        # No generated personality/profile facts from browsing. Store the confirmed text itself.
        self._client.remember(text, infer="none", scopes=[[scope]])


class Registry:
    def __init__(
        self, raw: str, endpoint: str, shared_context_id: str, *,
        app_api_key: str = "", app_user_id: str = "",
    ):
        self.services: dict[str, tuple[str, PrivateContext]] = {}
        self.legacy_services: dict[str, MemoryService] = {}
        self.clients: list[Memory] = []
        self.shared: tuple[str, PrivateContext] | None = None
        try:
            if app_user_id and not CLERK_USER_ID.fullmatch(app_user_id):
                raise ValueError()
            config = json.loads(raw) if raw else {}
            if not isinstance(config, dict) or len(config) > 50:
                raise ValueError()
            if app_user_id and shared_context_id:
                if app_user_id in config:
                    if not isinstance(config[app_user_id], dict) or config[app_user_id].get("contextId") != shared_context_id:
                        raise ValueError()  # Never silently move an existing owner's memory to another Context.
                if endpoint and app_api_key:
                    config.setdefault(app_user_id, {
                        "contextId": shared_context_id, "apiKey": app_api_key, "endpoint": endpoint,
                    })
            contexts = set()
            for user, entry in config.items():
                if not isinstance(entry, dict):
                    raise ValueError()
                context = entry["contextId"]
                url = entry.get("endpoint", endpoint)
                if (not CLERK_USER_ID.fullmatch(user) or not isinstance(context, str) or not context
                        or not isinstance(entry["apiKey"], str) or not entry["apiKey"] or not isinstance(url, str)
                        or context in contexts or (context == shared_context_id and user != app_user_id)
                        or not url.startswith("https://")):
                    raise ValueError()
                contexts.add(context)
                client = Memory(context, endpoint=url, api_key=entry["apiKey"], timeout=20, max_retries=0)
                self.clients.append(client)
                self.services[user] = (context, PrivateContext(client, owner_user_id=user))
                self.legacy_services[user] = MemoryService(client, owner_user_id=user)
            if not app_user_id and endpoint and shared_context_id and app_api_key:
                if not endpoint.startswith("https://"):
                    raise ValueError()
                client = Memory(shared_context_id, endpoint=endpoint, api_key=app_api_key,
                                timeout=20, max_retries=0)
                self.clients.append(client)
                self.shared = (shared_context_id, PrivateContext(client, shared_context=True))
        except (ValueError, TypeError, KeyError):
            self.close()
            raise ValueError(
                "Memory bindings must map valid users to distinct private HTTPS Contexts. "
                "Only SPECTRON_OWNER_USER_ID may reuse the existing app Context."
            ) from None

    def for_user(self, user_id: str) -> tuple[str, PrivateContext] | None:
        """Resolve only identities authenticated by the REST/MCP boundary.

        Reuses the existing Context; does not create Contexts, keys, or accounts.
        A returned service rejects every operation for a different identity.
        """
        if not CLERK_USER_ID.fullmatch(user_id):
            raise ValueError("Memory requires a verified Clerk user ID.")
        binding = self.services.get(user_id) or self.shared
        if binding is None:
            return None
        context_id, service = binding
        return context_id, service.bound_to(user_id)

    def close(self):
        for client in self.clients:
            client.close()


def view(row: RhythmMemory, p: Policy, recalled: bool = False) -> MemoryView:
    title = url = None
    if row.evidence_ref:
        recommendation = p.db.scalar(select(RhythmRecommendation).where(
            RhythmRecommendation.id == row.evidence_ref, RhythmRecommendation.user_id == p.user_id))
        if recommendation:
            title, url = recommendation.data["title"], recommendation.data["url"]
        else:
            candidate = p.db.scalar(select(RhythmCandidate).where(
                RhythmCandidate.id == row.evidence_ref, RhythmCandidate.user_id == p.user_id))
            if candidate:
                title = (candidate.page_metadata or {}).get("title")
                url = f"https://www.youtube.com/watch?v={candidate.video_id}"
    return MemoryView(id=row.id, text=row.text, status=row.status, evidence_ref=row.evidence_ref,
                      memory_status=row.memory_status, recalled=recalled, evidence_title=title, evidence_url=url)


def propose(p: Policy, body: MemoryProposalInput) -> Result:
    p.require_profile()
    p.agent("memory")
    candidate = p.db.scalar(select(RhythmCandidate).where(
        RhythmCandidate.user_id == p.user_id, RhythmCandidate.id == body.evidence_ref))
    recommendation = p.db.scalar(select(RhythmRecommendation).where(
        RhythmRecommendation.user_id == p.user_id, RhythmRecommendation.id == body.evidence_ref))
    if candidate is None and recommendation is None:
        raise Denied("not_found", "The evidence reference is unavailable.")
    task_id = candidate.task_id if candidate else recommendation.task_id
    p.task(task_id, "memory")
    pending = p.db.scalars(select(RhythmMemory.id).where(
        RhythmMemory.user_id == p.user_id, RhythmMemory.status == "pending")).all()
    if len(pending) >= 20:
        raise Denied("budget_exceeded", "Review the existing memory suggestions before adding more.")
    old = p.db.scalar(select(RhythmMemory).where(
        RhythmMemory.user_id == p.user_id, RhythmMemory.text == body.proposal,
        RhythmMemory.evidence_ref == body.evidence_ref, RhythmMemory.status == "pending"))
    row = old or RhythmMemory(user_id=p.user_id, text=body.proposal, evidence_ref=body.evidence_ref, status="pending")
    if old is None:
        p.db.add(row)
        p.db.flush()
    return Result(status="pending", memories=[view(row, p)],
                  message="Suggested context awaits your review on the phone. It cannot change the authoritative profile.")


def list_memories(p: Policy) -> Result:
    p.trusted()
    rows = p.db.scalars(select(RhythmMemory).where(
        RhythmMemory.user_id == p.user_id, RhythmMemory.status != "deleted")
        .order_by(RhythmMemory.created_at.desc()).limit(60))
    return Result(memories=[view(r, p) for r in rows])


def mark_deleted(p: Policy, row: RhythmMemory) -> None:
    if row.scope is None:
        p.db.delete(row)
    else:
        row.status, row.text = "deleted", ""
        if row.memory_status != "writing":
            row.memory_status = "erase_pending"


def approve(p: Policy, memory_id: str) -> Result:
    p.trusted()
    p.require_profile()
    row = p.owned(RhythmMemory, memory_id)
    if row.status == "forget_requested":
        mark_deleted(p, row)
        return Result(message="Saved context removed; its private memory copy will be erased.")
    if row.status.startswith("feedback_"):
        from app.rhythm.recommendations import apply_feedback
        recommendation = p.owned(RhythmRecommendation, row.evidence_ref)
        apply_feedback(p, recommendation, FeedbackInput(feedback=row.status.removeprefix("feedback_"), reason=row.text[:300]))
        p.db.delete(row)
        return Result(message="Feedback confirmed.")
    if row.status == "pending":
        row.status, row.memory_status = "confirmed", "pending"
    if row.status != "confirmed":
        raise Denied("not_found", "This suggestion is unavailable.")
    return Result(memories=[view(row, p)], message="Context confirmed. It does not override your phone interests.")


def remove(p: Policy, memory_id: str) -> Result:
    p.trusted()
    mark_deleted(p, p.owned(RhythmMemory, memory_id))
    return Result(message="Removed from Rhythm. A configured private memory copy is permanently erased, or queued for erasure while unavailable.")


def request_forget(p: Policy, memory_id: str) -> Result:
    p.agent("memory")
    row = p.owned(RhythmMemory, memory_id)
    if row.status not in ("confirmed", "forget_requested"):
        raise Denied("not_found", "This confirmed context is unavailable.")
    row.status = "forget_requested"
    return Result(status="pending", memories=[view(row, p)], message="Confirm removal on your phone. Nothing has been erased yet.")


def synchronize(app, user_id: str) -> str:
    binding = app.state.rhythm_memory.for_user(user_id)
    if not binding:
        return "not_configured"
    context_id, service = binding
    outcome = "ok"
    # Two bounded operations per foreground interaction; no permanent worker or DB lock during IO.
    for _ in range(2):
        with app.state.session_factory() as db:
            p = Policy(db, Actor(user_id), app.state.rhythm_settings)
            consent = bool(p.profile and p.profile.data["consent"]["memory"])
            rows = db.scalars(select(RhythmMemory).where(RhythmMemory.user_id == user_id)
                             .order_by(RhythmMemory.created_at)).all()
            job = None
            for row in rows:
                if row.context_id and row.context_id != context_id:
                    outcome = "context_changed"
                    continue
                if row.memory_status == "writing" and row.updated_at > utcnow() - timedelta(minutes=2):
                    continue
                erase = row.status == "deleted" or not consent
                if erase and row.scope:
                    job = (row.id, "erase", row.scope, "")
                    row.memory_status = "writing"
                    break
                if consent and row.status in ("confirmed", "forget_requested") and row.memory_status != "synced":
                    row.scope = preference_scope(user_id, row.id, root=service.scope_root)
                    row.context_id = context_id
                    row.memory_status = "writing"
                    job = (row.id, "write", row.scope, row.text)
                    break
            db.commit()
        if job is None:
            break
        row_id, operation, scope, text = job
        try:
            if operation == "erase":
                service.forget_scope(user_id, scope)
            else:
                service.remember_confirmed(user_id, row_id, text)
        except MemoryServiceError:
            with app.state.session_factory() as db:
                p = Policy(db, Actor(user_id), app.state.rhythm_settings)
                row = db.get(RhythmMemory, row_id)
                if row:
                    row.memory_status = "erase_pending" if row.status == "deleted" or operation == "erase" else "pending"
                db.commit()
            return "unavailable"
        with app.state.session_factory() as db:
            p = Policy(db, Actor(user_id), app.state.rhythm_settings)
            row = db.get(RhythmMemory, row_id)
            consent = bool(p.profile and p.profile.data["consent"]["memory"])
            must_erase_late_write = operation == "write" and (row is None or row.status == "deleted" or not consent)
            if row:
                if operation == "erase":
                    if row.status == "deleted":
                        db.delete(row)
                    else:
                        row.scope, row.context_id, row.memory_status = None, None, "not_mirrored"
                else:
                    row.memory_status = "erase_pending" if must_erase_late_write else "synced"
            db.commit()
        # The next iteration sees the marker from a concurrent deletion and permanently erases the late write.
    return outcome


def context(app, actor: Actor) -> Result:
    from app.rhythm.profile import get_interests
    before = run(app, actor, get_interests)
    if before.memory_status == "not_authorized":
        return before
    if before.status != "ok" or not before.profile or not before.profile.consent.memory:
        return before.model_copy(update={"memory_status": "disabled"})
    memory_status = synchronize(app, actor.user_id)
    binding = app.state.rhythm_memory.for_user(actor.user_id)
    recalled = set()
    if binding and memory_status == "ok":
        try:
            recalled = {fact.text for fact in binding[1].recall(actor.user_id, before.profile.original_goal_text or "confirmed video interests", k=8)}
        except MemoryServiceError:
            memory_status = "unavailable"
    # A profile/grant may change during IO: discard old results before sending anything to the agent.
    current = run(app, actor, get_interests)
    if current.status != "ok":
        return current
    if current.profile_revision != before.profile_revision:
        return Result(status="stale_context", message="Your phone interests changed while memory was being checked.")
    current.memory_status = memory_status
    current.memories = [item.model_copy(update={"recalled": item.text in recalled}) for item in current.memories or []]
    if memory_status != "ok":
        current.limitations.append("Long-term memory could not be checked. Use the confirmed phone profile and saved context only.")
    return current
