"""Shared FastAPI dependencies. Every protected route gets the user ID only from a verified Clerk token.

The one exception is `WatchUser`, used only by the Apple Watch's own data routes (/watch/*): it also
accepts a `bnw_` watch link token, resolved to the user who created it. `CurrentUser` never accepts one,
so a watch token can't delete data, mint assistant tokens or reach any other route.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai import AIError, AIProvider
from app.auth import AuthenticatedUser, ClerkVerifier, unauthorized
from app.mcp_auth import WATCH_TOKEN_PREFIX, hash_token
from app.memory import MemoryService
from app.models import ClaudeCredential, WatchToken
from app.provider_credentials import personal_provider, shared_claude

log = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)
# A watch polls often; recording every use would turn each read into a write.
WATCH_TOKEN_TOUCH_EVERY = timedelta(minutes=10)


def get_verifier(request: Request) -> ClerkVerifier:
    verifier = getattr(request.app.state, "verifier", None)
    if verifier is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Server sign-in verification isn't configured: {request.app.state.auth_error}",
        )
    return verifier


def current_user(
    verifier: Annotated[ClerkVerifier, Depends(get_verifier)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AuthenticatedUser:
    if credentials is None:
        raise unauthorized("Sign in required.")
    return verifier.verify(credentials.credentials)


def get_db(request: Request) -> Iterator[Session]:
    session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


def watch_user(
    verifier: Annotated[ClerkVerifier, Depends(get_verifier)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> AuthenticatedUser:
    """A `bnw_` Apple Watch link token, or the app's own Clerk session (the phone uses the same routes)."""
    if credentials is None:
        raise unauthorized("Sign in required.")
    token = credentials.credentials
    if not token.startswith(WATCH_TOKEN_PREFIX):
        return verifier.verify(token)
    row = db.scalar(select(WatchToken).where(WatchToken.token_hash == hash_token(token)))
    now = datetime.now(UTC)
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise unauthorized("Watch link is invalid or revoked.")
    if row.last_used_at is None or now - row.last_used_at >= WATCH_TOKEN_TOUCH_EVERY:
        row.last_used_at = now
        try:
            db.commit()
        except SQLAlchemyError as exc:  # bookkeeping only: never fail the watch's request over it
            db.rollback()
            log.warning("Couldn't record watch token use: %s", type(exc).__name__)
    return AuthenticatedUser(user_id=row.user_id, session_id=None)


def get_memory(request: Request) -> MemoryService | None:
    """Agent Memory, or None when it isn't configured (app features keep working without it)."""
    return getattr(request.app.state, "memory", None)


def get_ai(request: Request) -> AIProvider:
    provider = getattr(request.app.state, "ai", None)
    if provider is None:
        reason = getattr(request.app.state, "ai_unavailable_reason", None) or "AI isn't configured."
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=reason)
    return provider


def get_ai_optional(request: Request) -> AIProvider | None:
    """The AI provider, or None so a route can offer a non-AI fallback (planner rules, saved records)."""
    return getattr(request.app.state, "ai", None)


AI_STATUS = {
    "unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
    "timeout": status.HTTP_504_GATEWAY_TIMEOUT,
    "rate_limited": status.HTTP_429_TOO_MANY_REQUESTS,
    "bad_output": status.HTTP_502_BAD_GATEWAY,
    "refused": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "upstream": status.HTTP_502_BAD_GATEWAY,
}


def ai_failure(exc: AIError) -> HTTPException:
    return HTTPException(status_code=AI_STATUS[exc.kind], detail=exc.message)


CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]
WatchUser = Annotated[AuthenticatedUser, Depends(watch_user)]
Db = Annotated[Session, Depends(get_db)]
Memory = Annotated[MemoryService | None, Depends(get_memory)]
AI = Annotated[AIProvider, Depends(get_ai)]
OptionalAI = Annotated[AIProvider | None, Depends(get_ai_optional)]


def get_coach_ai(request: Request, user: CurrentUser, db: Db) -> Iterator[AIProvider]:
    row = db.get(ClaudeCredential, user.user_id)
    if row:
        provider = personal_provider(getattr(request.app.state, "credential_cipher", None), row,
                                     request.app.state.settings.ai_timeout_seconds)
        try:
            yield provider
        finally:
            provider._client.close()
    else:
        provider = shared_claude(request.app.state)
        if provider is None:
            raise HTTPException(403, "Connect Claude in AI connections for text Coach, or use your linked ElevenLabs agent.")
        # This is the application-owned client; only lifespan shutdown closes it.
        yield provider


CoachAI = Annotated[AIProvider, Depends(get_coach_ai)]


def not_found(what: str) -> HTTPException:
    # Same response whether the record doesn't exist or belongs to someone else.
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found.")
