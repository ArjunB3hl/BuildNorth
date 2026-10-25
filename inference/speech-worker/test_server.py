import base64
import io
import threading
import wave
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest
from server import create_app


class FakeModels:
    def transcribe(self, pcm): return "Hello"
    def synthesize(self, text): return b"test wav"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SPEECH_WORKER_TOKEN", "fictional-private-worker-token-123456")
    with TestClient(create_app(FakeModels)) as client:
        yield client


HEADERS = {"Authorization": "Bearer fictional-private-worker-token-123456"}


def wav():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(1); file.setsampwidth(2); file.setframerate(16000); file.writeframes(b"\0\0" * 16000)
    return base64.b64encode(buffer.getvalue()).decode()


def test_auth_limits_and_wav(client):
    assert client.get("/health").json()["ready"]
    assert client.post("/transcribe", json={"audioBase64": wav()}).status_code == 401
    assert client.post("/transcribe", headers=HEADERS, json={"audioBase64": "bad"}).status_code == 422
    assert client.post("/transcribe", headers=HEADERS, content=b"x" * 900001).status_code == 413
    response = client.post("/transcribe", headers=HEADERS, json={"audioBase64": wav()})
    assert response.json() == {"text": "Hello"}
    assert response.headers["cache-control"] == "no-store"
    assert client.post("/synthesize", headers=HEADERS, json={"text": "x" * 601}).status_code == 422
    assert client.post("/synthesize", headers=HEADERS, json={"text": "Hello"}).json()["mimeType"] == "audio/wav"


def test_concurrent_inference_is_rejected_then_recovers(client):
    entered, finish = threading.Event(), threading.Event()
    def blocked(_):
        entered.set(); assert finish.wait(5); return "Hello"
    client.app.state.models.transcribe = blocked
    with ThreadPoolExecutor() as pool:
        first = pool.submit(client.post, "/transcribe", headers=HEADERS, json={"audioBase64": wav()})
        assert entered.wait(5)
        try:
            assert client.post("/synthesize", headers=HEADERS, json={"text": "Hello"}).status_code == 429
        finally:
            finish.set()
        assert first.result().status_code == 200
    assert client.post("/synthesize", headers=HEADERS, json={"text": "Hello"}).status_code == 200
