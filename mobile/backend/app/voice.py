"""Speech routing and the private Parakeet/Kokoro service boundary. No model weights in the API."""
import base64
import io
import json
import wave

import httpx
from fastapi import HTTPException

from app.models import ClaudeCredential, ElevenLabsCredential
from app.provider_credentials import shared_claude, unlock_key

MAX_AUDIO_BODY = 900_000  # 20 seconds of 16 kHz PCM16, base64 + JSON


def selected_voice(state, db, user_id: str) -> str | None:
    cipher = getattr(state, "credential_cipher", None)
    # A configured and decryptable account agent is the only voice-provider override.
    if unlock_key(cipher, db.get(ElevenLabsCredential, user_id)):
        return "elevenlabs"
    personal = db.get(ClaudeCredential, user_id)
    text_available = bool(unlock_key(cipher, personal)) if personal else shared_claude(state) is not None
    settings = state.settings
    if text_available and settings.speech_worker_url and len(settings.speech_worker_token) >= 32:
        return "parakeet_kokoro"
    return None


def require_speech(state, db, user_id: str) -> None:
    provider = selected_voice(state, db, user_id)
    if provider == "elevenlabs":
        raise HTTPException(409, "Your connected ElevenLabs agent handles voice. Reopen Voice Coach.")
    if provider is None:
        raise HTTPException(503, "Voice needs a configured speech service and a working Claude connection. Text chat is still available when Claude is connected.")


def validate_recording(value: str) -> None:
    try:
        raw = base64.b64decode(value, validate=True)
        with wave.open(io.BytesIO(raw), "rb") as wav:
            frames = wav.getnframes()
            if wav.getparams()[:3] != (1, 2, 16000) or not 1600 <= frames <= 320_000:
                raise ValueError()
            if len(wav.readframes(frames)) != frames * 2:
                raise ValueError()
    except (ValueError, wave.Error, EOFError, TypeError):
        raise HTTPException(422, "Record 0.1–20 seconds of mono 16 kHz PCM16 WAV audio.") from None


def call_speech(settings, path: str, body: dict) -> dict:
    """No redirects, no upstream bodies/secrets in errors, and bounded output."""
    try:
        with httpx.Client(timeout=httpx.Timeout(90, connect=5), follow_redirects=False) as client:
            with client.stream("POST", settings.speech_worker_url + path, json=body,
                               headers={"Authorization": f"Bearer {settings.speech_worker_token}"}) as response:
                if response.status_code == 429:
                    raise HTTPException(429, "Voice is busy with another turn. Try again shortly.")
                response.raise_for_status()
                output = bytearray()
                for chunk in response.iter_bytes():
                    output.extend(chunk)
                    if len(output) > 8_000_000:
                        raise ValueError()
                result = json.loads(output)
                if not isinstance(result, dict):
                    raise ValueError()
                return result
    except httpx.TimeoutException:
        raise HTTPException(504, "The speech service took too long. Your saved chat is still available.") from None
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "The speech service is unavailable. Try text chat or reconnect later.") from None
