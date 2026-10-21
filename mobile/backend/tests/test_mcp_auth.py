"""Clerk OAuth access-token rules at /mcp: documented claims, allowed clients and the resource audience."""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Any

import httpx
import jwt
import pytest

from app.mcp_auth import AssistantTokenVerifier, new_watch_token
from conftest import ALICE, ISSUER, OTHER_KEY, SIGNING_KEY, make_token

RESOURCE = "https://unintrusive-timika-unshadily.ngrok-free.dev/mcp"
CHATGPT = "https://chatgpt.com/oauth/client.json"
CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata"


def verifier(**kwargs: Any) -> AssistantTokenVerifier:
    public = SIGNING_KEY.public_key()
    clerk = SimpleNamespace(issuer=ISSUER, jwks=SimpleNamespace(get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=public)))
    return AssistantTokenVerifier(lambda: None, clerk, RESOURCE, **kwargs)  # type: ignore[arg-type]


def oauth(*, typ: str | None = "at+jwt", key: Any = SIGNING_KEY, **claims: Any) -> str:
    now = int(time.time())
    payload = {"sub": ALICE, "iss": ISSUER, "iat": now, "exp": now + 600, "jti": "oat_test",
               "client_id": CHATGPT, "scope": "email profile", "aud": RESOURCE}
    payload.update(claims)
    headers = {"kid": "test-kid", **({"typ": typ} if typ else {})}
    return jwt.encode({k: v for k, v in payload.items() if v is not None}, key, algorithm="RS256", headers=headers)


@pytest.mark.parametrize(
    "token_claims",
    [
        {},                                             # ChatGPT, bound to this resource
        {"aud": [RESOURCE]},                            # list form
        {"aud": [RESOURCE, CHATGPT]},                   # resource plus the client's own ID
        {"aud": RESOURCE + "/"},                        # trailing slash
        {"client_id": CLAUDE_CODE, "aud": RESOURCE},    # Claude's CIMD host
        {"scp": ["email", "profile"], "scope": None},   # scp array instead of scope string
    ],
)
def test_accepted(token_claims: dict[str, Any]) -> None:
    token = verifier().verify_sync(oauth(**token_claims))
    assert token is not None and token.subject == ALICE
    assert set(token.scopes) >= {"email", "profile"}


@pytest.mark.parametrize(
    ("token_kwargs", "reason"),
    [
        ({"aud": "https://other.example.com/mcp"}, "bound to another resource"),
        ({"aud": [RESOURCE, "https://other.example.com/mcp"]}, "also valid for another resource"),
        ({"aud": "api"}, "a non-URL audience that isn't this resource"),
        ({"aud": None}, "not bound to any resource"),
        ({"aud": CHATGPT}, "aud is only the client's own ID"),
        ({"client_id": "https://evil.example/client.json"}, "client host not allowed"),
        ({"client_id": "http://chatgpt.com/oauth/client.json"}, "client ID not HTTPS"),
        ({"client_id": "https://chatgpt.com.evil.example/client.json"}, "look-alike host"),
        ({"client_id": "oauth_app_123"}, "pre-registered client not listed"),
        ({"client_id": None}, "no client_id"),
        ({"typ": "JWT"}, "session-token typ"),
        ({"typ": None}, "no typ"),
        ({"iss": "https://other.clerk.accounts.dev"}, "different issuer"),
        ({"exp": int(time.time()) - 60}, "expired"),
        ({"key": OTHER_KEY}, "wrong signing key"),
        ({"sub": "org_123"}, "subject isn't a Clerk user"),
    ],
)
def test_rejected(token_kwargs: dict[str, Any], reason: str) -> None:
    assert verifier().verify_sync(oauth(**token_kwargs)) is None, reason


def test_app_session_tokens_are_refused() -> None:
    assert verifier().verify_sync(make_token(ALICE)) is None


def test_explicit_client_ids_and_relaxed_audience() -> None:
    listed = verifier(client_ids=("oauth_app_123",))
    assert listed.verify_sync(oauth(client_id="oauth_app_123")) is not None
    # Only when Clerk can't bind `aud` and you opt out: the client allow-list is then the only binding.
    relaxed = verifier(require_resource_audience=False)
    assert relaxed.verify_sync(oauth(aud=None)) is not None
    assert relaxed.verify_sync(oauth(aud=CHATGPT)) is not None
    assert relaxed.verify_sync(oauth(aud="https://other.example.com/mcp")) is None  # foreign audiences never pass
    assert relaxed.verify_sync(oauth(aud=None, client_id="https://evil.example/client.json")) is None


def test_watch_tokens_are_refused_without_asking_clerk(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_network(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("a watch token must never be sent to Clerk")

    monkeypatch.setattr(httpx, "post", no_network)
    # With a secret key set, any other unrecognized token would be checked with Clerk's API.
    with_secret = AssistantTokenVerifier(lambda: None, verifier().clerk, RESOURCE, "sk_test_fictional")  # type: ignore[arg-type]
    token, _, _ = new_watch_token()
    assert token.startswith("bnw_") and with_secret.verify_sync(token) is None
