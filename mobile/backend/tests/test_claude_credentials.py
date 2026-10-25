"""Personal credentials are encrypted, never echoed, isolated, removable and actually used by Coach."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.main import app
from app.deps import get_coach_ai
from app.models import ClaudeCredential
from app.provider_credentials import personal_provider
from conftest import ALICE, BOB, auth

KEY = "sk-ant-api03-MADE-UP-DEMO-ONLY-0001"
MODEL = "claude-opus-5-5"


@pytest.fixture(autouse=True)
def real_connection_dependencies(client):
    app.dependency_overrides.pop(get_coach_ai, None)


@pytest.fixture
def verify(monkeypatch):
    calls = []

    def check(key, model):
        calls.append((key, model))
        return model
    monkeypatch.setattr("app.routers.claude.verify_key", check)
    return calls


def attach(client, user=ALICE):
    return client.put("/connections/claude", headers=auth(user), json={"apiKey": KEY, "model": MODEL})


def test_encryption_isolation_and_no_secret_echo(client, verify):
    assert client.get("/connections/claude").status_code == 401
    response = attach(client)
    assert response.status_code == 200, response.text
    assert KEY not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["hint"] == "0001"
    assert verify == [(KEY, MODEL)]
    with app.state.session_factory() as db:
        row = db.get(ClaudeCredential, ALICE)
        assert row and KEY not in row.ciphertext and row.ciphertext != KEY
    assert client.get("/connections/claude", headers=auth(BOB)).json()["configured"] is False
    assert client.delete("/connections/claude", headers=auth(BOB)).status_code == 204
    assert client.get("/connections/claude", headers=auth()).json()["configured"] is True
    assert client.delete("/connections/claude", headers=auth()).status_code == 204
    assert client.get("/connections/claude", headers=auth()).json()["configured"] is False


@pytest.mark.parametrize("body", [
    {"apiKey": KEY, "model": "invalid"}, {"apiKey": KEY, "userId": BOB},
    {"apiKey": KEY + "\n"}, [KEY], KEY, {"apiKey": {"secret": KEY}},
])
def test_bad_inputs_never_return_secret(client, verify, body):
    response = client.put("/connections/claude", headers=auth(), json=body)
    assert response.status_code == 422
    assert KEY not in response.text
    assert not verify


def test_failed_replacement_keeps_existing_key(client, verify, monkeypatch):
    assert attach(client).status_code == 200
    def fail(*_):
        raise HTTPException(400, "Key not accepted.")
    monkeypatch.setattr("app.routers.claude.verify_key", fail)
    assert attach(client).status_code == 400
    assert client.get("/connections/claude", headers=auth()).json()["configured"] is True


def test_credential_owner_is_cryptographically_bound(client, verify):
    assert attach(client).status_code == 200
    with app.state.session_factory() as db:
        original = db.get(ClaudeCredential, ALICE)
        swapped = ClaudeCredential(user_id=BOB, ciphertext=original.ciphertext, hint=original.hint, model=MODEL)
        with pytest.raises(HTTPException) as failure:
            personal_provider(app.state.credential_cipher, swapped, 5)
        assert failure.value.status_code == 503


def test_coach_uses_own_key_and_disconnect_locks_coach(client, verify, monkeypatch, fake_ai):
    created = []
    def provider(key, model, timeout, *, base_url):
        assert base_url == "https://api.anthropic.com"
        created.append((key, model))
        fake_ai._client = SimpleNamespace(close=lambda: None)
        return fake_ai
    monkeypatch.setattr("app.provider_credentials.AnthropicProvider", provider)
    assert attach(client).status_code == 200
    response = client.post("/coach/messages", headers=auth(), json={"content": "Suggest a quick dinner."})
    assert response.status_code == 200, response.text
    assert created == [(KEY, MODEL)]
    assert KEY not in response.text
    assert client.post("/coach/messages", headers=auth(BOB), json={"content": "Suggest dinner."}).status_code == 403
    assert len(created) == 1
    client.delete("/connections/claude", headers=auth())
    assert client.post("/coach/messages", headers=auth(), json={"content": "Suggest dinner."}).status_code == 403
    assert len(created) == 1


def test_missing_encryption_never_falls_back_to_another_provider(client, verify, monkeypatch):
    assert attach(client).status_code == 200
    monkeypatch.setattr(app.state, "credential_cipher", None)
    assert client.get("/connections/claude", headers=auth()).json()["usable"] is False
    assert client.post("/coach/messages", headers=auth(), json={"content": "Hello"}).status_code == 503
    assert attach(client).status_code == 503


def test_account_erasure_removes_credential(client, verify):
    assert attach(client).status_code == 200
    assert client.delete("/account/data", headers=auth()).status_code == 200
    assert client.get("/connections/claude", headers=auth()).json()["configured"] is False
