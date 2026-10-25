"""Verified per-account ElevenLabs credentials. Secrets only leave this server for api.elevenlabs.io."""
import json
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.deps import CurrentUser, Db
from app.models import ClaudeCredential, ElevenLabsCredential
from app.provider_credentials import seal, shared_claude, unlock_key
from app.voice import selected_voice

router = APIRouter(tags=["connections"])


def unlock(request: Request, row) -> str | None:
    return unlock_key(getattr(request.app.state, "credential_cipher", None), row)


def eleven_get(key: str, path: str, params: dict | None = None) -> dict:
    try:
        with httpx.Client(base_url="https://api.elevenlabs.io", timeout=15, follow_redirects=False) as client:
            response = client.get(path, params=params, headers={"xi-api-key": key})
            if response.status_code in (401, 403, 404):
                raise HTTPException(400, "ElevenLabs rejected this key or agent. Check agent access and Conversational AI permissions.")
            if response.status_code == 429:
                raise HTTPException(429, "ElevenLabs is busy. Try again shortly.")
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Could not reach ElevenLabs. Try again.") from None


def signed_session(key: str, agent_id: str) -> str:
    value = eleven_get(key, "/v1/convai/conversation/get-signed-url", {"agent_id": agent_id}).get("signed_url", "")
    url = urlparse(value)
    if url.scheme != "wss" or url.hostname != "api.elevenlabs.io" or url.username or url.password:
        raise HTTPException(502, "ElevenLabs returned an invalid session address.")
    return value


@router.get("/connections/access")
def access(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    response.headers["Cache-Control"] = "no-store"
    personal = db.get(ClaudeCredential, user.user_id)
    claude = bool(unlock(request, personal))
    shared = shared_claude(request.app.state) is not None
    # A broken personal credential must be repaired/removed, never silently billed to another key.
    text_chat = claude or (personal is None and shared)
    eleven = bool(unlock(request, db.get(ElevenLabsCredential, user.user_id)))
    return {"linked": text_chat or eleven, "claude": claude, "sharedClaude": shared, "elevenlabs": eleven,
            "textChat": text_chat, "camera": text_chat or eleven,
            "voiceProvider": selected_voice(request.app.state, db, user.user_id)}


@router.get("/connections/elevenlabs")
def connection(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    response.headers["Cache-Control"] = "no-store"
    row = db.get(ElevenLabsCredential, user.user_id)
    return {"configured": row is not None, "usable": bool(unlock(request, row)),
            "storageAvailable": getattr(request.app.state, "credential_cipher", None) is not None,
            "hint": row.hint if row else None, "agentName": row.agent_name if row else None}


@router.put("/connections/elevenlabs")
async def connect(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 4096:
            raise HTTPException(413, "Connection details are too large.")
    try:
        body = json.loads(raw)
        if not isinstance(body, dict) or set(body) != {"apiKey", "agentId"}:
            raise ValueError()
        key, agent = body["apiKey"], body["agentId"]
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{20,500}", key):
            raise ValueError()
        if not isinstance(agent, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,100}", agent):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "Enter an ElevenLabs API key and agent ID.") from None
    cipher = getattr(request.app.state, "credential_cipher", None)
    if cipher is None:
        raise HTTPException(503, "Secure key storage is unavailable.")
    info = await run_in_threadpool(eleven_get, key, f"/v1/convai/agents/{agent}")
    # Validate conversation permissions, without opening a conversation or using voice minutes.
    await run_in_threadpool(signed_session, key, agent)
    row = db.get(ElevenLabsCredential, user.user_id)
    if row is None:
        row = ElevenLabsCredential(user_id=user.user_id)
        db.add(row)
    row.ciphertext, row.hint = seal(cipher, user.user_id, key), key[-4:]
    row.agent_id, row.agent_name = agent, str(info.get("name") or "ElevenLabs agent")[:120]
    db.commit()
    return connection(request, response, user, db)


@router.delete("/connections/elevenlabs", status_code=204)
def disconnect(user: CurrentUser, db: Db) -> Response:
    row = db.get(ElevenLabsCredential, user.user_id)
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/connections/elevenlabs/session")
def session(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    response.headers["Cache-Control"] = "no-store"
    row = db.get(ElevenLabsCredential, user.user_id)
    key = unlock(request, row)
    if not key:
        raise HTTPException(403, "Connect ElevenLabs in AI connections first.")
    return {"signedUrl": signed_session(key, row.agent_id)}
