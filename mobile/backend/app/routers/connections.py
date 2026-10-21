"""App-side controls for external assistants: connection tokens, and approving what assistants propose.

These routes use the app's Clerk session like every other app route. Approving here is the
user's explicit decision on the exact changes shown; assistants can't call these routes.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import select

from app import assistant_proposals as proposals
from app.deps import CurrentUser, Db, Memory, not_found
from app.mcp_auth import TOKEN_LIFETIME, new_connection_token
from app.models import ConnectionToken
from app.schemas import (
    AssistantProposalOut,
    AssistantProposalsOut,
    ConnectionsInfoOut,
    ConnectionTokenIn,
    ConnectionTokenOut,
    NewConnectionTokenOut,
)

router = APIRouter(tags=["connections"])
MAX_TOKENS = 10
ERROR_STATUS = {"not_found": status.HTTP_404_NOT_FOUND, "invalid": status.HTTP_422_UNPROCESSABLE_CONTENT,
                "conflict": status.HTTP_409_CONFLICT}


def _token_out(t: ConnectionToken) -> ConnectionTokenOut:
    return ConnectionTokenOut(id=t.id, label=t.label, hint=t.hint, created_at=t.created_at, expires_at=t.expires_at,
                              revoked=t.revoked_at is not None)


@router.get("/connections")
def connections_info(request: Request, user: CurrentUser, db: Db) -> ConnectionsInfoOut:
    tokens = db.scalars(select(ConnectionToken).where(ConnectionToken.user_id == user.user_id)
                        .order_by(ConnectionToken.created_at.desc()))
    verifier = getattr(request.app.state, "verifier", None)
    return ConnectionsInfoOut(
        mcp_url=request.app.state.settings.mcp_public_url,
        oauth_authorization_server=verifier.issuer if verifier else None,
        tokens=[_token_out(t) for t in tokens],
    )


@router.post("/connections/tokens", status_code=status.HTTP_201_CREATED)
def create_token(body: ConnectionTokenIn, user: CurrentUser, db: Db) -> NewConnectionTokenOut:
    """Create a connection token for an assistant that uses a fixed bearer header. Shown once."""
    active = db.scalars(select(ConnectionToken.id).where(
        ConnectionToken.user_id == user.user_id, ConnectionToken.revoked_at.is_(None))).all()
    if len(active) >= MAX_TOKENS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can have up to {MAX_TOKENS} active tokens. Revoke one first.")
    token, digest, hint = new_connection_token()
    row = ConnectionToken(user_id=user.user_id, label=body.label, token_hash=digest, hint=hint,
                          expires_at=datetime.now(UTC) + TOKEN_LIFETIME)
    db.add(row)
    db.commit()
    return NewConnectionTokenOut(**_token_out(row).model_dump(), token=token)


@router.delete("/connections/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(token_id: str, user: CurrentUser, db: Db) -> Response:
    row = db.scalar(select(ConnectionToken).where(ConnectionToken.id == token_id, ConnectionToken.user_id == user.user_id))
    if row is None:
        raise not_found("Token")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _out(p: proposals.AssistantProposal) -> AssistantProposalOut:
    return AssistantProposalOut.model_validate(proposals.view(p).model_dump())


@router.get("/assistant/proposals")
def list_proposals(user: CurrentUser, db: Db, status_: str | None = Query(default=None, alias="status")) -> AssistantProposalsOut:
    return AssistantProposalsOut(proposals=[_out(p) for p in proposals.list_owned(db, user.user_id, status_)])


@router.get("/assistant/proposals/pending")
def pending_proposals(user: CurrentUser, db: Db) -> AssistantProposalsOut:
    return AssistantProposalsOut(proposals=[_out(p) for p in proposals.list_owned(db, user.user_id, "pending")])


@router.post("/assistant/proposals/{proposal_id}/approve")
def approve(proposal_id: str, user: CurrentUser, db: Db, memory: Memory) -> AssistantProposalOut:
    """The user approved the exact changes shown in the app: apply them (at most once)."""
    try:
        return _out(proposals.approve(db, memory, user.user_id, proposal_id, "app"))
    except proposals.ProposalError as exc:
        raise HTTPException(ERROR_STATUS[exc.kind], exc.message) from exc


@router.post("/assistant/proposals/{proposal_id}/reject")
def reject(proposal_id: str, user: CurrentUser, db: Db) -> AssistantProposalOut:
    try:
        return _out(proposals.reject(db, user.user_id, proposal_id))
    except proposals.ProposalError as exc:
        raise HTTPException(ERROR_STATUS[exc.kind], exc.message) from exc
