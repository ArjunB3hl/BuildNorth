"""The server demo key is an authenticated fallback, never a personal-key override."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.ai import build_provider
from app.config import load_settings
from app.deps import get_coach_ai
from app.main import app
from app.models import ClaudeCredential
from app.rhythm.config import RhythmSettings
from conftest import ALICE, BOB, auth


@pytest.fixture
def clean_settings(monkeypatch):
    monkeypatch.setattr("app.config.load_dotenv", lambda *_: None)
    for name in ("AI_PROVIDER", "SHARED_AI_ENABLED", "AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AI_MODEL",
                 "DATABASE_URL", "MCP_PUBLIC_URL", "RHYTHM_MCP_PUBLIC_URL", "RENDER_EXTERNAL_URL"):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("provider", [None, "", "none", "invalid", "auto", "anthropic", "openai", "ollama"])
def test_shared_keys_do_not_enable_access_by_default(clean_settings, monkeypatch, provider):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "made-up-server-key")
    monkeypatch.setenv("AI_API_KEY", "made-up-legacy-key")
    if provider is not None:
        monkeypatch.setenv("AI_PROVIDER", provider)
    settings = load_settings()
    assert settings.ai_provider == "none"
    assert settings.ai_api_key == ""
    assert build_provider(settings)[0] is None


def test_explicit_auto_can_still_select_shared_provider(clean_settings, monkeypatch):
    monkeypatch.setenv("SHARED_AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "auto")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "made-up-server-key")
    monkeypatch.setenv("AI_API_KEY", "unused-legacy-provider-key")
    settings = load_settings()
    assert settings.ai_provider == "anthropic"
    factory = Mock(return_value=SimpleNamespace(name="anthropic"))
    monkeypatch.setattr("app.ai.AnthropicProvider", factory)
    assert build_provider(settings)[1] is None
    factory.assert_called_once_with("made-up-server-key", "claude-opus-5-5", 150.0)
    monkeypatch.setenv("AI_PROVIDER", "none")
    assert build_provider(load_settings())[0] is None


@pytest.mark.parametrize("enabled", ["false", "0", "no", "", "invalid"])
def test_shared_access_switch_overrides_old_deployment_config(clean_settings, monkeypatch, enabled):
    monkeypatch.setenv("SHARED_AI_ENABLED", enabled)
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "made-up-server-key")
    factory = Mock()
    monkeypatch.setattr("app.ai.AnthropicProvider", factory)
    settings = load_settings()
    assert settings.ai_api_key == ""
    assert build_provider(settings)[0] is None
    factory.assert_not_called()


def test_auto_without_a_key_is_unavailable(clean_settings, monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "auto")
    assert load_settings().ai_provider == "none"
    assert build_provider(load_settings())[0] is None


@pytest.mark.parametrize("prefix", ["postgres://", "postgresql://", "postgresql+psycopg://"])
def test_render_database_url_preserves_credentials_and_options(clean_settings, monkeypatch, prefix):
    monkeypatch.setenv("DATABASE_URL", prefix + "demo:p%40ss@db.example/rhythm?sslmode=require")
    assert load_settings().database_url == "postgresql+psycopg://demo:p%40ss@db.example/rhythm?sslmode=require"


def test_render_mcp_defaults_and_custom_domain(clean_settings, monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://rhythm-demo.onrender.com/")
    assert load_settings().mcp_public_url == "https://rhythm-demo.onrender.com/mcp"
    assert RhythmSettings.load().mcp_public_url == "https://rhythm-demo.onrender.com/rhythm/mcp"
    monkeypatch.setenv("MCP_PUBLIC_URL", "https://api.example.com/mcp")
    assert load_settings().mcp_public_url == "https://api.example.com/mcp"
    assert RhythmSettings.load().mcp_public_url == "https://api.example.com/rhythm/mcp"


@pytest.fixture
def shared(client, monkeypatch, fake_ai):
    app.dependency_overrides.pop(get_coach_ai, None)
    monkeypatch.setattr(fake_ai, "name", "anthropic")
    fake_ai._client = Mock()
    monkeypatch.setattr(app.state, "ai", fake_ai)
    return fake_ai


def test_shared_coach_is_automatic_for_signed_in_users_only(client, shared):
    assert client.get("/connections/access").status_code == 401
    assert client.post("/coach/messages", json={"content": "Hello"}).status_code == 401
    for user in (ALICE, BOB):
        access = client.get("/connections/access", headers=auth(user)).json()
        assert access == {"linked": True, "claude": False, "sharedClaude": True, "elevenlabs": False,
                          "textChat": True, "camera": True, "voiceProvider": None}
        info = client.get("/connections/claude", headers=auth(user))
        assert info.headers["cache-control"] == "no-store"
        assert info.json()["sharedAvailable"] and not info.json()["configured"]
        assert info.json()["hint"] is None
        response = client.post("/coach/messages", headers=auth(user), json={"content": "Suggest dinner."})
        assert response.status_code == 200, response.text
    shared._client.close.assert_not_called()  # Shared client survives individual requests.


def test_personal_override_then_disconnect_restores_shared(client, shared, monkeypatch):
    monkeypatch.setattr("app.routers.claude.verify_key", lambda _key, model: model)
    key = "sk-ant-MADE-UP-PERSONAL-KEY-1234"
    personal = Mock(name="personal-provider")
    personal.model = "claude-opus-5-5"
    personal.generate_json = Mock(side_effect=shared.generate_json)
    factory = Mock(return_value=personal)
    monkeypatch.setattr("app.provider_credentials.AnthropicProvider", factory)
    assert client.put("/connections/claude", headers=auth(), json={"apiKey": key}).status_code == 200
    assert client.post("/coach/messages", headers=auth(), json={"content": "Suggest dinner."}).status_code == 200
    factory.assert_called_once_with(key, "claude-opus-5-5", app.state.settings.ai_timeout_seconds,
                                    base_url="https://api.anthropic.com")
    personal._client.close.assert_called_once()
    assert client.get("/connections/access", headers=auth()).json()["claude"]
    assert client.delete("/connections/claude", headers=auth()).status_code == 204
    assert client.get("/connections/access", headers=auth()).json()["textChat"]
    assert client.post("/coach/messages", headers=auth(), json={"content": "Suggest lunch."}).status_code == 200
    assert factory.call_count == 1


def test_broken_personal_key_does_not_silently_use_shared(client, shared):
    with app.state.session_factory() as db:
        db.add(ClaudeCredential(user_id=ALICE, ciphertext="broken", hint="1234", model="claude-opus-5-5"))
        db.commit()
    assert not client.get("/connections/access", headers=auth()).json()["textChat"]
    assert not client.get("/connections/claude", headers=auth()).json()["usable"]
    response = client.post("/coach/messages", headers=auth(), json={"content": "Hello"})
    assert response.status_code == 503
    assert not shared.calls


def test_mcp_token_does_not_override_shared_provider(client, shared):
    assert client.post("/connections/tokens", headers=auth(), json={"label": "ChatGPT"}).status_code == 201
    assert client.get("/connections/access", headers=auth()).json()["sharedClaude"]
    assert client.post("/coach/messages", headers=auth(), json={"content": "Suggest dinner."}).status_code == 200
    assert shared.calls


@pytest.mark.parametrize("provider", ["ollama", "openai"])
def test_other_server_providers_do_not_unlock_the_claude_demo(client, shared, monkeypatch, provider):
    monkeypatch.setattr(shared, "name", provider)
    assert not client.get("/connections/access", headers=auth()).json()["linked"]
    assert not client.get("/connections/claude", headers=auth()).json()["sharedAvailable"]
    assert client.post("/coach/messages", headers=auth(), json={"content": "Hello"}).status_code == 403
