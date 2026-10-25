"""Authenticated personal Claude connection. No key is ever returned to a client."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.ai import DEFAULT_MODELS
from app.deps import CurrentUser, Db
from app.models import ClaudeCredential
from app.provider_credentials import seal, verify_key

router = APIRouter(tags=["connections"])


@router.get("/connections/claude")
def connection(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    response.headers["Cache-Control"] = "no-store"
    row = db.get(ClaudeCredential, user.user_id)
    available = getattr(request.app.state, "credential_cipher", None) is not None
    return {"configured": row is not None, "storageAvailable": available,
            "hint": row.hint if row else None, "model": row.model if row else DEFAULT_MODELS["anthropic"],
            "scope": "coach", "usable": row is not None and available}


@router.put("/connections/claude")
async def connect(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    # Parse privately: default validation errors include the raw invalid input, which could be a secret.
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 4096:
            raise HTTPException(413, "Connection details are too large.")
    try:
        body = json.loads(raw)
        if not isinstance(body, dict) or set(body) - {"apiKey", "model"}:
            raise ValueError()
        key = body.get("apiKey")
        model = body.get("model", DEFAULT_MODELS["anthropic"])
        if not isinstance(key, str) or not re.fullmatch(r"sk-ant-[A-Za-z0-9_-]{10,490}", key):
            raise ValueError()
        if not isinstance(model, str) or not re.fullmatch(r"claude-[a-z0-9.-]{3,90}", model):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "Enter an Anthropic API key and a valid Claude model name.") from None
    cipher = getattr(request.app.state, "credential_cipher", None)
    if cipher is None:
        raise HTTPException(503, "Key storage is not configured. The server needs AI_CREDENTIAL_ENCRYPTION_KEY.")
    verified_model = await run_in_threadpool(verify_key, key, model)
    row = db.get(ClaudeCredential, user.user_id)
    if row is None:
        row = ClaudeCredential(user_id=user.user_id)
        db.add(row)
    row.ciphertext, row.hint, row.model = seal(cipher, user.user_id, key), key[-4:], verified_model
    db.commit()
    return connection(request, response, user, db)


@router.delete("/connections/claude", status_code=204)
def disconnect(user: CurrentUser, db: Db) -> Response:
    row = db.get(ClaudeCredential, user.user_id)
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
