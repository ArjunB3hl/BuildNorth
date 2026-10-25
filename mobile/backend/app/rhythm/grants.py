"""Separate application grants for agents and browser pages. Only app sessions can approve or revoke."""

from sqlalchemy import select, update

from app.mcp_auth import RHYTHM_TOKEN_PREFIX, TOKEN_LIFETIME, new_token
from app.models import ConnectionToken, RhythmAgent, RhythmBrowser, RhythmBrowserRequest, RhythmTask, utcnow
from app.rhythm import browser
from app.rhythm.policy import Denied, Policy
from app.rhythm.schemas import AgentApproval, AgentView, Assistant, Result

ASSISTANT_LABELS = {"claude": "Claude", "chatgpt": "ChatGPT", "codex": "Codex"}


def view(agent: RhythmAgent) -> AgentView:
    return AgentView(id=agent.id, label=agent.label, client_id=agent.client_id,
                     status=agent.status, capabilities=agent.capabilities)


def connect(p: Policy) -> Result:
    p.require_profile()
    if not p.actor.client_id:
        raise Denied("permission_required", "Connect from your chosen MCP client.")
    row = p.grant_for(p.actor.client_id)
    if row is None:
        pending = p.db.scalars(select(RhythmAgent.id).where(
            RhythmAgent.user_id == p.user_id, RhythmAgent.status != "revoked")).all()
        if len(pending) >= 10:
            raise Denied("budget_exceeded", "Revoke an old agent connection before connecting another.")
        row = RhythmAgent(user_id=p.user_id, client_id=p.actor.client_id, label=p.actor.label[:160], status="pending")
        p.db.add(row)
        p.db.flush()
    return Result(status="ok" if row.status == "active" else "permission_required", agents=[view(row)],
                  message="Connection ready." if row.status == "active" else "Review this connection in Profile → Rhythm videos on your phone.")


def connections(p: Policy) -> Result:
    p.trusted()
    agents = p.db.scalars(select(RhythmAgent).where(RhythmAgent.user_id == p.user_id)
                          .order_by(RhythmAgent.created_at.desc()).limit(30)).all()
    browsers = p.db.scalars(select(RhythmBrowser).where(RhythmBrowser.user_id == p.user_id)
                            .order_by(RhythmBrowser.created_at.desc()).limit(20)).all()
    return Result(agents=[view(a) for a in agents], browsers=[browser.view(b, p) for b in browsers],
                  mcp_url=p.settings.mcp_public_url)


def approve(p: Policy, agent_id: str, body: AgentApproval) -> Result:
    p.trusted()
    profile = p.require_profile()
    if not profile.data["consent"]["agent"]:
        raise Denied("permission_required", "Allow your chosen agent in your phone interests first.")
    row = p.owned(RhythmAgent, agent_id)
    p.check_connection(row)
    row.status = "active"
    row.capabilities = sorted(set(body.capabilities))
    return Result(agents=[view(row)], message="Agent permissions saved.")


def approve_assistant(p: Policy, assistant: Assistant, body: AgentApproval) -> Result:
    """"Connect Claude / ChatGPT / Codex" in the app: approve that assistant before it signs in, so its first
    request works without a separate approval. It still signs in with the user's own account (OAuth)."""
    p.trusted()
    profile = p.require_profile()
    if not profile.data["consent"]["agent"]:
        raise Denied("permission_required", "Turn on Share with my chosen agent in Interests & sharing first.")
    client_id = f"assistant:{assistant}"
    row = p.db.scalar(select(RhythmAgent).where(RhythmAgent.user_id == p.user_id, RhythmAgent.client_id == client_id))
    if row is None:
        row = RhythmAgent(user_id=p.user_id, client_id=client_id, label=ASSISTANT_LABELS[assistant])
        p.db.add(row)
    row.status = "active"
    row.capabilities = sorted(set(body.capabilities))
    p.db.flush()
    return Result(agents=[view(row)], mcp_url=p.settings.mcp_public_url,
                  message=f"{ASSISTANT_LABELS[assistant]} is approved. Finish connecting in {ASSISTANT_LABELS[assistant]}.")


def revoke(p: Policy, agent_id: str) -> Result:
    p.trusted()
    row = p.owned(RhythmAgent, agent_id)
    row.status = "revoked"
    if row.client_id.startswith("connection-token:"):
        credential = p.db.get(ConnectionToken, row.client_id.split(":", 1)[1])
        if credential and credential.user_id == p.user_id and credential.purpose == "rhythm":
            credential.revoked_at = utcnow()
    task_ids = select(RhythmTask.id).where(RhythmTask.user_id == p.user_id, RhythmTask.agent_id == row.id)
    p.db.execute(update(RhythmBrowserRequest).where(
        RhythmBrowserRequest.user_id == p.user_id, RhythmBrowserRequest.task_id.in_(task_ids),
        RhythmBrowserRequest.status.in_(["pending", "claimed"])).values(status="cancelled"))
    p.db.execute(update(RhythmTask).where(RhythmTask.user_id == p.user_id, RhythmTask.agent_id == row.id)
                 .values(status="cancelled"))
    return Result(message="Agent access revoked. Its pending work has stopped.")


def mint_token(p: Policy, label: str, body: AgentApproval) -> tuple[str, AgentView]:
    p.trusted()
    profile = p.require_profile()
    if not profile.data["consent"]["agent"]:
        raise Denied("permission_required", "Allow your chosen agent in your phone interests first.")
    count = p.db.scalars(select(ConnectionToken.id).where(
        ConnectionToken.user_id == p.user_id, ConnectionToken.revoked_at.is_(None),
        ConnectionToken.expires_at > utcnow())).all()
    if len(count) >= 10:
        raise Denied("budget_exceeded", "Revoke an old connection token before creating another.")
    token, digest, hint = new_token(RHYTHM_TOKEN_PREFIX)
    credential = ConnectionToken(user_id=p.user_id, label=f"Rhythm: {label}"[:80], token_hash=digest, hint=hint, purpose="rhythm",
                                 expires_at=utcnow() + TOKEN_LIFETIME)
    p.db.add(credential)
    p.db.flush()
    agent = RhythmAgent(user_id=p.user_id, client_id=f"connection-token:{credential.id}", label=label,
                        status="active", capabilities=sorted(set(body.capabilities)))
    p.db.add(agent)
    p.db.flush()
    return token, view(agent)
