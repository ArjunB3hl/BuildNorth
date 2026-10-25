"""Shared policy boundary for REST and MCP.

A harmless UPDATE on the user's profile obtains a database write lock BEFORE any
budget/grant read. SQLite serializes writers; PostgreSQL locks just that row.
Every reservation is committed before a network call. No Python mutex is used as
an authorization or quota store, so multiple workers obey the same limits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ConnectionToken, RhythmAgent, RhythmBrowser, RhythmBrowserRequest, RhythmCandidate, RhythmProfile,
    RhythmMemory, RhythmSignal, RhythmTask, RhythmTranscript, RhythmUsage, utcnow,
)
from app.rhythm.config import RhythmSettings
from app.rhythm.schemas import Limits, Result, Status


NOT_LEARNED = ("Rhythm hasn't learned your interests yet. Turn on learning, then watch a few workout or recipe "
               "videos or chat with your coach.")


class Denied(Exception):
    def __init__(self, status: Status, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Actor:
    user_id: str
    # None means a verified Clerk app session, never an agent-supplied argument.
    client_id: str | None = None
    label: str = ""


class Policy:
    def __init__(self, db: Session, actor: Actor, settings: RhythmSettings):
        self.db, self.actor, self.settings = db, actor, settings
        self.user_id = actor.user_id
        db.execute(update(RhythmProfile).where(RhythmProfile.user_id == self.user_id)
                   .values(revision=RhythmProfile.revision, updated_at=RhythmProfile.updated_at))
        self.profile = db.get(RhythmProfile, self.user_id, populate_existing=True)
        self._usage: RhythmUsage | None = None

    def owned(self, model: Any, record_id: str) -> Any:
        row = self.db.scalar(select(model).where(model.id == record_id, model.user_id == self.user_id))
        if row is None:
            raise Denied("not_found", "That item is unavailable.")
        return row

    def trusted(self) -> None:
        if self.actor.client_id is not None:
            raise Denied("permission_required", "Confirm this action in the phone app or Rhythm side panel.")

    def require_profile(self, *, metadata: bool = False) -> RhythmProfile:
        p = self.profile
        if p is None or not p.confirmed:
            raise Denied("profile_required", NOT_LEARNED)
        if metadata and (not p.data["consent"]["metadata"] or "youtube" not in p.data["enabled_sites"]):
            raise Denied("permission_required", "Enable YouTube and page processing in your phone interests.")
        return p

    def agent(self, capability: str) -> RhythmAgent | None:
        if self.actor.client_id is None:
            return None
        p = self.require_profile()
        if not p.data["consent"]["agent"]:
            raise Denied("permission_required", "Allow your chosen agent in your phone interests.")
        grant = self.db.scalar(select(RhythmAgent).where(
            RhythmAgent.user_id == self.user_id, RhythmAgent.client_id == self.actor.client_id))
        if grant is None or grant.status != "active" or capability not in grant.capabilities:
            raise Denied("permission_required", "Authorize this agent and this action on your phone.")
        self.check_connection(grant)
        return grant

    def check_connection(self, grant: RhythmAgent) -> None:
        if grant.client_id.startswith("connection-token:"):
            token_id = grant.client_id.split(":", 1)[1]
            token = self.db.scalar(select(ConnectionToken).where(
                ConnectionToken.id == token_id, ConnectionToken.user_id == self.user_id))
            if token is None or token.revoked_at is not None or token.expires_at <= utcnow():
                raise Denied("permission_required", "This agent connection has expired or been revoked.")

    def task(self, task_id: str, capability: str = "recommend") -> RhythmTask:
        p = self.require_profile(metadata=True)
        grant = self.agent(capability)
        task = self.owned(RhythmTask, task_id)
        if grant and task.agent_id != grant.id:
            raise Denied("permission_required", "This task belongs to another agent connection.")
        if task.agent_id:
            bound = self.owned(RhythmAgent, task.agent_id)
            if bound.status != "active" or capability not in bound.capabilities or not p.data["consent"]["agent"]:
                raise Denied("permission_required", "The task's agent is no longer authorized for this action.")
            self.check_connection(bound)
        if task.profile_revision != p.revision or task.status == "stale":
            raise Denied("stale_context", "Your interests changed. Start a new task using the updated profile.")
        if task.expires_at <= utcnow():
            raise Denied("stale_context", "This task expired. Start a new task.")
        if task.status == "pending":
            raise Denied("permission_required", "Review and start this task in Rhythm before the agent continues.")
        if task.status != "active":
            raise Denied("cancelled", "This task has stopped.")
        return task

    def browser(self, browser_id: str, *, live: bool = True, transcripts: bool = False) -> RhythmBrowser:
        p = self.require_profile(metadata=True)
        browser = self.owned(RhythmBrowser, browser_id)
        if browser.status != "active":
            raise Denied("permission_required", "Use this page again in Rhythm to grant access.")
        if live and not browser_available(browser, self.settings):
            raise Denied("browser_unavailable", "Open Rhythm's side panel on the permitted video.")
        if transcripts and (not browser.allow_transcripts or not p.data["consent"]["transcripts"]):
            raise Denied("permission_required", "Allow transcript reading for this page and in your phone interests.")
        return browser

    def usage(self) -> RhythmUsage:
        if self._usage is None:
            day = utcnow().astimezone(ZoneInfo(self.settings.timezone)).date().isoformat()
            row = self.db.scalar(select(RhythmUsage).where(
                RhythmUsage.user_id == self.user_id, RhythmUsage.day == day))
            if row is None:
                row = RhythmUsage(user_id=self.user_id, day=day)
                self.db.add(row)
                self.db.flush()
            self._usage = row
        return self._usage

    def count(self, name: str, n: int = 1) -> None:
        row = self.usage()
        setattr(row, name, getattr(row, name) + n)


def browser_available(browser: RhythmBrowser, settings: RhythmSettings) -> bool:
    return browser.status == "active" and browser.last_seen_at > utcnow() - timedelta(seconds=settings.browser_lease_seconds)


def cleanup(db: Session, user_id: str, timezone: str = "America/Toronto") -> None:
    """Lazy retention cleanup, also callable by the maintenance command. Never runs an agent."""
    now = utcnow()
    db.execute(delete(RhythmTranscript).where(
        RhythmTranscript.user_id == user_id, RhythmTranscript.expires_at <= now))
    cutoff = now - timedelta(days=7)
    old_tasks = select(RhythmTask.id).where(RhythmTask.user_id == user_id, RhythmTask.created_at < cutoff)
    for model in (RhythmBrowserRequest, RhythmCandidate):
        db.execute(delete(model).where(model.user_id == user_id, model.task_id.in_(old_tasks)))
    db.execute(delete(RhythmTask).where(RhythmTask.user_id == user_id, RhythmTask.created_at < cutoff))
    db.execute(delete(RhythmMemory).where(
        RhythmMemory.user_id == user_id, RhythmMemory.status.in_(["pending", "stale"]),
        RhythmMemory.created_at < cutoff, RhythmMemory.scope.is_(None)))
    # Watched-video signals for learning are kept 60 days (learning itself only looks back 45).
    db.execute(delete(RhythmSignal).where(RhythmSignal.user_id == user_id, RhythmSignal.observed_at < now - timedelta(days=60)))
    # No page archive: retain only active, recently connected page grants.
    db.execute(delete(RhythmBrowser).where(RhythmBrowser.user_id == user_id, RhythmBrowser.last_seen_at < cutoff))
    db.execute(delete(RhythmUsage).where(
        RhythmUsage.user_id == user_id, RhythmUsage.day < now.astimezone(ZoneInfo(timezone)).date().isoformat()))


def run(app: Any, actor: Actor, operation: Callable[[Policy], Result]) -> Result:
    settings = app.state.rhythm_settings
    with app.state.session_factory() as db:
        try:
            policy = Policy(db, actor, settings)
            cleanup(db, actor.user_id, settings.timezone)
            result = operation(policy)
            db.commit()
            return result
        except Denied as exc:
            db.rollback()
            # Aggregate counters contain no page text, user request, or browsing history.
            policy = Policy(db, actor, settings)
            if policy.profile is not None:
                policy.count("blocked_requests")
                db.commit()
            return Result(status=exc.status, message=exc.message)
        except IntegrityError:
            db.rollback()
            # Includes simultaneous first saves; do not silently overwrite either phone edit.
            return Result(status="stale_context", message="Another request changed this data. Refresh and try again.")


def limits(settings: RhythmSettings) -> Limits:
    return Limits(**{name: getattr(settings, name) for name in Limits.model_fields})
