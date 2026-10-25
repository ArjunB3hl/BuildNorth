import base64
from dataclasses import replace
import io
import wave

import pytest

from app.models import ClaudeCredential, CoachMessage, ElevenLabsCredential
from app.provider_credentials import seal
from conftest import ALICE, BOB, auth


def recording(frames=16000, rate=16000):
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate)
        wav.writeframes(b"\0\0" * frames)
    return base64.b64encode(out.getvalue()).decode()


@pytest.fixture
def speech(client, fake_ai, monkeypatch):
    state = client.app.state
    monkeypatch.setattr(state, "settings", replace(state.settings, speech_worker_url="http://speech-private:8095", speech_worker_token="fictional-test-token-" * 3))
    monkeypatch.setattr(fake_ai, "name", "anthropic")
    monkeypatch.setattr(state, "ai", fake_ai)
    calls = []
    def call(settings, path, body):
        calls.append((path, body))
        return {"text": "I ate oatmeal."} if path == "/transcribe" else {"audioBase64": "fake-audio", "mimeType": "audio/wav"}
    monkeypatch.setattr("app.routers.voice.call_speech", call)
    return calls


def test_voice_requires_auth_and_configuration(client):
    assert client.post("/voice/transcribe", json={}).status_code == 401
    assert client.post("/voice/transcribe", headers=auth(), json={}).status_code == 503
    assert client.get("/connections/access", headers=auth()).json()["voiceProvider"] is None


def test_default_and_eleven_override_are_per_account(client, speech):
    assert client.get("/connections/access", headers=auth()).json()["voiceProvider"] == "parakeet_kokoro"
    # Merely creating an MCP token cannot switch the speech provider.
    client.post("/connections/tokens", headers=auth(), json={"label": "Claude"})
    assert client.get("/connections/access", headers=auth()).json()["voiceProvider"] == "parakeet_kokoro"
    with client.app.state.session_factory() as db:
        db.add(ElevenLabsCredential(user_id=ALICE, ciphertext=seal(client.app.state.credential_cipher, ALICE, "test-key"), hint="fake", agent_id="test-agent", agent_name="Demo"))
        db.commit()
    assert client.get("/connections/access", headers=auth()).json()["voiceProvider"] == "elevenlabs"
    assert client.get("/connections/access", headers=auth(BOB)).json()["voiceProvider"] == "parakeet_kokoro"
    assert client.post("/voice/transcribe", headers=auth(), json={"audioBase64": recording()}).status_code == 409
    assert not speech
    client.delete("/connections/elevenlabs", headers=auth())
    assert client.get("/connections/access", headers=auth()).json()["voiceProvider"] == "parakeet_kokoro"


def test_broken_personal_claude_blocks_default_voice(client, speech):
    with client.app.state.session_factory() as db:
        db.add(ClaudeCredential(user_id=ALICE, ciphertext="broken", hint="fake", model="test")); db.commit()
    assert client.get("/connections/access", headers=auth()).json()["voiceProvider"] is None
    assert client.post("/voice/transcribe", headers=auth(), json={}).status_code == 503


def test_transcription_is_bounded_and_not_stored(client, speech):
    response = client.post("/voice/transcribe", headers=auth(), json={"audioBase64": recording()})
    assert response.status_code == 200 and response.json() == {"text": "I ate oatmeal."}
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/coach/messages", headers=auth()).json()["messages"] == []
    for value in ("bad", recording(320001), recording(rate=48000)):
        assert client.post("/voice/transcribe", headers=auth(), json={"audioBase64": value}).status_code == 422
    assert client.post("/voice/transcribe", headers=auth(), content=b"x" * 900001).status_code == 413
    assert len(speech) == 1


def test_only_own_stored_assistant_reply_is_spoken(client, speech):
    with client.app.state.session_factory() as db:
        own = CoachMessage(user_id=ALICE, role="assistant", content="x" * 700, suggestions=[])
        other = CoachMessage(user_id=BOB, role="assistant", content="private", suggestions=[])
        user = CoachMessage(user_id=ALICE, role="user", content="hello", suggestions=[])
        db.add_all([own, other, user]); db.commit()
    response = client.post(f"/voice/speech/{own.id}", headers=auth())
    assert response.status_code == 200 and response.json()["clipped"]
    assert response.headers["cache-control"] == "no-store"
    assert speech == [("/synthesize", {"text": "x" * 600})]
    for id in (other.id, user.id, "missing"):
        assert client.post(f"/voice/speech/{id}", headers=auth()).status_code == 404
    assert len(speech) == 1
