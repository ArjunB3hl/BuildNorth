"""Proof-bound browser-to-Mac sign-in. Disabled until explicitly configured."""
from __future__ import annotations

import hashlib
import ipaddress
import os
import re
import secrets
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError

from app.deps import CurrentUser, Db
from app.models import MacSignInHandoff, MacSignInRateBucket

router = APIRouter(prefix="/mac-sign-in", tags=["mac-sign-in"])
TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")
HASH = re.compile(r"^[a-f0-9]{64}$")
LIFETIME = timedelta(minutes=3)


class Start(BaseModel):
    challenge: str = Field(min_length=64, max_length=64)


class Code(BaseModel):
    code: str = Field(min_length=43, max_length=43)


class Approval(Code):
    expected_user_id: str = Field(min_length=1, max_length=255)
    expected_session_id: str = Field(min_length=1, max_length=255)


class Redeem(Code):
    proof: str = Field(min_length=43, max_length=43)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def enabled(request: Request, response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    if os.getenv("MAC_BROWSER_SIGN_IN_ENABLED", "").lower() != "true" or not request.app.state.settings.clerk_secret_key:
        raise HTTPException(503, "Browser sign-in is not configured.")


def valid(code: str) -> str:
    if not TOKEN.fullmatch(code):
        raise HTTPException(400, "Invalid handoff.")
    return digest(code)


def peer(request: Request) -> str:
    # Never parse untrusted forwarding headers here. Configure Uvicorn's trusted
    # proxies so its ASGI client is correct before enabling in production.
    host = request.client.host if request.client else "unknown"
    try:
        addr = ipaddress.ip_address(host)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False)) if addr.version == 6 else str(addr)
    except ValueError:
        return "unknown"


def limit(db: Db, groups: list[tuple[str, str, int, int]]) -> None:
    """Atomically debit shared fixed-window limits; unavailable database fails closed."""
    now = int(datetime.now(UTC).timestamp())
    dialect = db.get_bind().dialect.name
    if dialect not in {"sqlite", "postgresql"}:
        raise HTTPException(503, "Browser sign-in is unavailable.")
    insert = pg_insert if dialect == "postgresql" else sqlite_insert
    try:
        if secrets.randbelow(64) == 0:
            db.execute(delete(MacSignInRateBucket).where(MacSignInRateBucket.expires_at <= now))
        for scope, identity, max_count, seconds in groups:
            bucket = now // seconds
            key = digest(f"{scope}:{identity}:{bucket}")
            statement = insert(MacSignInRateBucket).values(key_hash=key, count=1, expires_at=(bucket + 1) * seconds)
            statement = statement.on_conflict_do_update(
                index_elements=[MacSignInRateBucket.key_hash],
                set_={"count": MacSignInRateBucket.count + 1},
                where=MacSignInRateBucket.count < max_count,
            ).returning(MacSignInRateBucket.count)
            if db.execute(statement).scalar_one_or_none() is None:
                db.rollback()
                raise HTTPException(429, "Too many sign-in requests. Try again later.",
                                    headers={"Retry-After": str(max(1, (bucket + 1) * seconds - now))})
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Browser sign-in is unavailable.") from None


@router.post("/start")
def start(body: Start, request: Request, response: Response, db: Db) -> dict:
    enabled(request, response)
    limit(db, [("start-global", "all", 300, 60), ("start-peer", peer(request), 10, 60)])
    if not HASH.fullmatch(body.challenge):
        raise HTTPException(400, "Invalid challenge.")
    now = datetime.now(UTC)
    db.execute(delete(MacSignInHandoff).where(MacSignInHandoff.expires_at < now))
    code = secrets.token_urlsafe(32)
    db.add(MacSignInHandoff(code_hash=digest(code), proof_hash=body.challenge, expires_at=now + LIFETIME))
    db.commit()
    return {"code": code, "expires_in": int(LIFETIME.total_seconds())}


@router.post("/approve")
def approve(body: Approval, request: Request, response: Response, db: Db, user: CurrentUser) -> dict:
    enabled(request, response)
    limit(db, [("approve-global", "all", 300, 60), ("approve-peer", peer(request), 60, 60),
               ("approve-user", user.user_id, 12, 600)])
    # These client values are only assertions about what was displayed; the
    # verified Clerk token remains the sole source of identity.
    if user.user_id != body.expected_user_id or not user.session_id or user.session_id != body.expected_session_id:
        raise HTTPException(409, "Your browser account changed. Review it and try again.")
    code_hash = valid(body.code)
    row = db.execute(update(MacSignInHandoff).where(
        MacSignInHandoff.code_hash == code_hash, MacSignInHandoff.expires_at > datetime.now(UTC),
        MacSignInHandoff.used_at.is_(None), MacSignInHandoff.user_id.is_(None),
    ).values(user_id=user.user_id).returning(MacSignInHandoff.code_hash)).scalar_one_or_none()
    db.commit()
    if row is None:
        raise HTTPException(410, "Handoff expired or already used.")
    return {"approved": True}


@router.post("/cancel")
def cancel(body: Redeem, request: Request, response: Response, db: Db) -> dict:
    enabled(request, response)
    limit(db, [("cancel-global", "all", 1200, 60), ("cancel-peer", peer(request), 120, 60)])
    if not TOKEN.fullmatch(body.proof):
        raise HTTPException(400, "Invalid handoff.")
    db.execute(update(MacSignInHandoff).where(
        MacSignInHandoff.code_hash == valid(body.code), MacSignInHandoff.proof_hash == digest(body.proof),
        MacSignInHandoff.used_at.is_(None),
    ).values(used_at=datetime.now(UTC)))
    db.commit()
    return {"cancelled": True}


@router.post("/redeem")
async def redeem(body: Redeem, request: Request, response: Response, db: Db) -> dict:
    enabled(request, response)
    limit(db, [("redeem-global", "all", 3000, 60), ("redeem-peer", peer(request), 240, 60)])
    if not TOKEN.fullmatch(body.proof):
        raise HTTPException(400, "Invalid handoff.")
    code_hash, proof_hash = valid(body.code), digest(body.proof)
    now = datetime.now(UTC)
    candidate = db.scalar(select(MacSignInHandoff.user_id).where(
        MacSignInHandoff.code_hash == code_hash, MacSignInHandoff.proof_hash == proof_hash,
        MacSignInHandoff.expires_at > now, MacSignInHandoff.used_at.is_(None),
        MacSignInHandoff.user_id.is_not(None)))
    if candidate:
        limit(db, [("issue-global", "all", 120, 60), ("issue-user", candidate, 10, 600)])
    # Claim atomically before contacting Clerk, so simultaneous workers can never mint two tickets.
    user_id = db.execute(update(MacSignInHandoff).where(
        MacSignInHandoff.code_hash == code_hash, MacSignInHandoff.proof_hash == proof_hash,
        MacSignInHandoff.expires_at > now, MacSignInHandoff.used_at.is_(None),
        MacSignInHandoff.user_id.is_not(None),
    ).values(used_at=now).returning(MacSignInHandoff.user_id)).scalar_one_or_none()
    db.commit()
    if user_id is None:
        pending = db.scalar(select(MacSignInHandoff.code_hash).where(
            MacSignInHandoff.code_hash == code_hash, MacSignInHandoff.proof_hash == proof_hash,
            MacSignInHandoff.expires_at > now, MacSignInHandoff.used_at.is_(None),
            MacSignInHandoff.user_id.is_(None)))
        if pending: return {"status": "pending"}
        raise HTTPException(410, "Handoff expired or already used.")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            result = await client.post("https://api.clerk.com/v1/sign_in_tokens",
                headers={"Authorization": f"Bearer {request.app.state.settings.clerk_secret_key}"},
                json={"user_id": user_id, "expires_in_seconds": 60})
        if result.status_code != 200:
            raise ValueError("Clerk rejected ticket request")
        ticket = result.json().get("token")
        if not isinstance(ticket, str) or not ticket:
            raise ValueError("Clerk returned no ticket")
    except (httpx.HTTPError, ValueError):
        # The claim stays used even if the upstream result is unknown; start a new flow.
        raise HTTPException(502, "Could not finish sign-in. Start again.") from None
    return {"status": "ready", "ticket": ticket}
