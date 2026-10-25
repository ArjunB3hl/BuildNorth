"""Clerk-authenticated speech; only stored replies owned by the caller can be spoken."""
import json

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.deps import CurrentUser, Db
from app.models import CoachMessage
from app.voice import MAX_AUDIO_BODY, call_speech, require_speech, validate_recording

router = APIRouter(tags=["voice"])


@router.post("/voice/transcribe")
async def transcribe(request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    response.headers["Cache-Control"] = "no-store"
    require_speech(request.app.state, db, user.user_id)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_AUDIO_BODY:
            raise HTTPException(413, "Record up to 20 seconds at a time.")
    try:
        body = json.loads(raw)
        audio = body["audioBase64"]
        if not isinstance(audio, str):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise HTTPException(422, "A WAV recording is required.") from None
    validate_recording(audio)
    db.rollback()  # Do not hold a database transaction during inference.
    result = await run_in_threadpool(call_speech, request.app.state.settings, "/transcribe", {"audioBase64": audio})
    text = result.get("text")
    if not isinstance(text, str) or len(text) > 4000:
        raise HTTPException(502, "The speech service returned an invalid transcript.")
    return {"text": text.strip()}


@router.post("/voice/speech/{message_id}")
def speech(message_id: str, request: Request, response: Response, user: CurrentUser, db: Db) -> dict:
    response.headers["Cache-Control"] = "no-store"
    require_speech(request.app.state, db, user.user_id)
    message = db.get(CoachMessage, message_id)
    if message is None or message.user_id != user.user_id or message.role != "assistant":
        raise HTTPException(404, "That Coach reply is unavailable.")
    text = message.content[:600]
    clipped = len(message.content) > 600
    db.rollback()
    result = call_speech(request.app.state.settings, "/synthesize", {"text": text})
    audio = result.get("audioBase64")
    if not isinstance(audio, str) or result.get("mimeType") != "audio/wav":
        raise HTTPException(502, "The speech service returned invalid audio.")
    return {"audioBase64": audio, "mimeType": "audio/wav", "clipped": clipped}
