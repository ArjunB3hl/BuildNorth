"""Proof-bound browser-to-Mac sign-in. Disabled until explicitly configured."""
from __future__ import annotations

import hashlib
import ipaddress
import os
import re
import secrets
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
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
    # This is the direct socket peer, not an X-Forwarded-For result. Production
    # must disable Uvicorn proxy headers and restrict these CIDRs to an ingress
    # boundary verified with Render, excluding private-service callers.
    try:
        socket = ipaddress.ip_address(request.client.host if request.client else "")
        configured = os.getenv("MAC_SIGN_IN_TRUSTED_PROXY_CIDRS", "")
        networks = [ipaddress.ip_network(item.strip(), strict=True) for item in configured.split(",") if item.strip()]
        if not networks or any(net.prefixlen == 0 for net in networks) or not any(socket in net for net in networks):
            raise ValueError("untrusted ingress")
        values = request.headers.getlist("cf-connecting-ip")
        if len(values) != 1 or "," in values[0] or values[0] != values[0].strip():
            raise ValueError("missing or ambiguous client address")
        addr = ipaddress.ip_address(values[0])
        if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
            addr = addr.ipv4_mapped
        if not addr.is_global or addr.is_multicast or addr.is_unspecified:
            raise ValueError("invalid client address")
        return str(ipaddress.ip_network(f"{addr}/64", strict=False)) if addr.version == 6 else str(addr)
    except ValueError:
        raise HTTPException(503, "Browser sign-in is unavailable.") from None


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
            # Previously debited layers must survive a later rejection, so the
            # global cap also counts requests blocked by narrower limits.
            db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Browser sign-in is unavailable.") from None


def ingress_limit(request: Request, response: Response, db: Db) -> None:
    # A route dependency runs before user authentication and body validation.
    # Thus invalid or unauthenticated attempts also count toward the endpoint cap.
    enabled(request, response)
    name = request.scope['path'].rsplit('/', 1)[-1]
    limits = {'start': (300, 10), 'approve': (300, 60), 'cancel': (1200, 120), 'redeem': (3000, 240)}
    if name not in limits:
        raise HTTPException(503, 'Browser sign-in is unavailable.')
    global_cap, ip_cap = limits[name]
    limit(db, [(f'{name}-global', 'all', global_cap, 60)])
    limit(db, [(f'{name}-peer', peer(request), ip_cap, 60)])


@router.post("/start", dependencies=[Depends(ingress_limit)])
def start(body: Start, request: Request, response: Response, db: Db) -> dict:
    if not HASH.fullmatch(body.challenge):
        raise HTTPException(400, "Invalid challenge.")
    limit(db, [("start-challenge", body.challenge, 4, 180)])
    now = datetime.now(UTC)
    db.execute(delete(MacSignInHandoff).where(MacSignInHandoff.expires_at < now))
    code = secrets.token_urlsafe(32)
    db.add(MacSignInHandoff(code_hash=digest(code), proof_hash=body.challenge, expires_at=now + LIFETIME))
    db.commit()
    return {"code": code, "expires_in": int(LIFETIME.total_seconds())}


@router.post("/approve", dependencies=[Depends(ingress_limit)])
def approve(body: Approval, request: Request, response: Response, db: Db, user: CurrentUser) -> dict:
    limit(db, [("approve-user", user.user_id, 12, 600)])
    # These client values are only assertions about what was displayed; the
    # verified Clerk token remains the sole source of identity.
    if user.user_id != body.expected_user_id or not user.session_id or user.session_id != body.expected_session_id:
        raise HTTPException(409, "Your browser account changed. Review it and try again.")
    code_hash = valid(body.code)
    limit(db, [("approve-challenge", code_hash, 8, 180)])
    row = db.execute(update(MacSignInHandoff).where(
        MacSignInHandoff.code_hash == code_hash, MacSignInHandoff.expires_at > datetime.now(UTC),
        MacSignInHandoff.used_at.is_(None), MacSignInHandoff.user_id.is_(None),
    ).values(user_id=user.user_id).returning(MacSignInHandoff.code_hash)).scalar_one_or_none()
    db.commit()
    if row is None:
        raise HTTPException(410, "Handoff expired or already used.")
    return {"approved": True}


@router.post("/cancel", dependencies=[Depends(ingress_limit)])
def cancel(body: Redeem, request: Request, response: Response, db: Db) -> dict:
    if not TOKEN.fullmatch(body.proof):
        raise HTTPException(400, "Invalid handoff.")
    limit(db, [("cancel-challenge", valid(body.code), 12, 180)])
    db.execute(update(MacSignInHandoff).where(
        MacSignInHandoff.code_hash == valid(body.code), MacSignInHandoff.proof_hash == digest(body.proof),
        MacSignInHandoff.used_at.is_(None),
    ).values(used_at=datetime.now(UTC)))
    db.commit()
    return {"cancelled": True}


@router.post("/redeem", dependencies=[Depends(ingress_limit)])
async def redeem(body: Redeem, request: Request, response: Response, db: Db) -> dict:
    if not TOKEN.fullmatch(body.proof):
        raise HTTPException(400, "Invalid handoff.")
    code_hash, proof_hash = valid(body.code), digest(body.proof)
    limit(db, [("redeem-challenge", code_hash, 120, 180)])
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
