"""Test fixtures: fresh migrated SQLite per test, mocked Clerk keys, fake Agent Memory and fake AI.

Nothing here touches the network. Live behaviour is checked by scripts/live_check.py.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from surrealdb.memory import MemoryAPIError

from app.ai import AIError
from app.assistant import COACH_SCHEMA, RECIPE_SCHEMA, ROUTINE_SCHEMA
from app.auth import ClerkVerifier
from app.deps import get_coach_ai, get_ai, get_ai_optional, get_memory, get_verifier
from app.main import app
from app.memory import MemoryService
from app.planner import CHANGE_SCHEMA, PROPOSAL_SCHEMA
from app.rhythm.learn import LEARN_SCHEMA
from app.rhythm.summaries import SUMMARY_SCHEMA

FRONTEND_API = "test-app.clerk.accounts.dev"
PUBLISHABLE_KEY = "pk_test_" + base64.b64encode(f"{FRONTEND_API}$".encode()).decode().rstrip("=")
ISSUER = f"https://{FRONTEND_API}"
# Real Clerk IDs are mixed-case; these two differ only in case, so lowercasing would merge them.
ALICE = "user_2abCd"
BOB = "user_2aBcd"
ALICE_SCOPE = "buildnorth/user/user_2ab-cd"
BOB_SCOPE = "buildnorth/user/user_2a-bcd"

SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_token(sub: str = ALICE, *, key: Any = SIGNING_KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {"sub": sub, "iss": ISSUER, "iat": now, "nbf": now, "exp": now + 60, "sid": "sess_1"}
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-kid"})


def auth(user: str = ALICE) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user)}"}


@dataclass
class FakeScopes:
    owner: FakeMemoryClient
    registered: list[str] = field(default_factory=list)

    def register(self, path: str) -> None:
        self.owner.check()
        if path in self.registered:
            raise MemoryAPIError(409, "scope already exists")
        self.registered.append(path)

    def forget(self, path: str | None = None) -> SimpleNamespace:
        self.owner.check()
        assert path, "forget without a path would erase every user's memory"
        before = len(self.owner.records)
        self.owner.records = [
            (t, s) for t, s in self.owner.records if not any(c == path or c.startswith(path + "/") for clause in s for c in clause)
        ]
        self.owner.forgets.append(path)
        return SimpleNamespace(forgotten=before - len(self.owner.records))


@dataclass
class FakeMemoryClient:
    """Mirrors the live-verified rule: lens `<user>/*` sees the user's subtree and nothing else."""

    records: list[tuple[str, list[list[str]]]] = field(default_factory=list)
    lenses: list[Any] = field(default_factory=list)
    forgets: list[str] = field(default_factory=list)
    down: bool = False

    def __post_init__(self) -> None:
        self.scopes = FakeScopes(self)

    def check(self) -> None:
        if self.down:
            raise MemoryAPIError(0, "Connection failed")

    def remember(self, text: str | None = None, **kwargs: Any) -> None:
        self.check()
        scopes = kwargs["scopes"]
        assert scopes and all(scopes), "empty scope would fall back to the key's whole region"
        self.records.append((text or "", scopes))

    def recall(self, query: str, **kwargs: Any) -> SimpleNamespace:
        self.check()
        lens = kwargs["lens"]
        assert lens and all(lens), "empty lens would read every user's memory"
        self.lenses.append(lens)

        def visible(scopes: list[list[str]]) -> bool:
            for clause in lens:
                for pattern in clause:
                    base = pattern[:-2] if pattern.endswith("/*") else pattern
                    if any(c == base or (pattern.endswith("/*") and c.startswith(base + "/")) for sc in scopes for c in sc):
                        return True
            return False

        hits = [
            SimpleNamespace(id=str(i), score=0.9, source="memory_chunk", text=text)
            for i, (text, scopes) in enumerate(self.records)
            if visible(scopes)
        ]
        return SimpleNamespace(hits=hits)


class FakeAI:
    """Deterministic stand-in for a model provider. Coach replies echo the context they were given."""

    name = "fake"
    model = "fake-model"

    def __init__(self) -> None:
        self.error: AIError | None = None
        self.calls: list[dict[str, Any]] = []
        self.coach_suggestions: list[dict[str, Any]] = []
        # Scripted raw outputs for planner calls (validated by the app like real model output).
        self.proposal: dict[str, Any] = {"meals": [], "activities": []}
        self.change: dict[str, Any] = {"summary": "", "persistence": "temporary", "lasting_preference": None, "operations": []}
        # Scripted reading for Rhythm's interest learning; by default the model adds nothing.
        self.learn: dict[str, Any] = {"topics": [], "purposes": [], "experience_level": "unknown", "avoid": []}
        self.video_notes: dict[str, Any] = {
            "kind": "ideas", "overview": "Notes from this video.",
            "sections": [{"heading": "Missing details", "numbered": False, "items": ["Only a transcript excerpt was captured."]}],
        }

    def generate_json(self, *, system, messages, schema, temperature=0.2, max_tokens=4000):  # type: ignore[no-untyped-def]
        self.calls.append({"system": system, "messages": messages, "schema": schema})
        if self.error:
            raise self.error
        if schema is RECIPE_SCHEMA:
            return {
                "title": "Lentil soup",
                "servings": 4,
                "description": None,
                "ingredients": [
                    {"name": "red lentils", "quantity": 1, "unit": "cup", "note": None},
                    {"name": "onion", "quantity": 1, "unit": "diced", "note": None},
                    {"name": "salt", "quantity": None, "unit": None, "note": "to taste"},
                ],
                "steps": [{"text": "Soften the onion.", "timer_minutes": 5}, {"text": "Simmer.", "timer_minutes": 20}],
                "nutrition_per_serving_estimate": {"calories": 250, "protein_g": 14, "carbs_g": 40, "fat_g": 4},
            }
        if schema is ROUTINE_SCHEMA:
            return {
                "name": "Morning mobility",
                "notes": None,
                "exercises": [
                    {"name": "Squats", "sets": 3, "reps": 12, "duration_seconds": None, "weight": None, "weight_unit": None, "rest_seconds": 60},
                    {"name": "Plank", "sets": None, "reps": None, "duration_seconds": 45, "weight": None, "weight_unit": "kg", "rest_seconds": None},
                ],
            }
        if schema is COACH_SCHEMA:
            return {"reply": "ECHO:" + messages[-1]["content"], "suggestions": self.coach_suggestions}
        if schema is PROPOSAL_SCHEMA:
            return self.proposal
        if schema is CHANGE_SCHEMA:
            return self.change
        if schema is LEARN_SCHEMA:
            return self.learn
        if schema is SUMMARY_SCHEMA:
            return self.video_notes
        raise AssertionError("unexpected schema")


@pytest.fixture
def memory_client() -> FakeMemoryClient:
    return FakeMemoryClient()


@pytest.fixture
def fake_ai() -> FakeAI:
    return FakeAI()


@pytest.fixture
def client(tmp_path, monkeypatch, memory_client, fake_ai):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    # Real local bindings/keys must never turn an isolated test into live memory or video IO.
    monkeypatch.setenv("SPECTRON_OWNER_USER_ID", "")
    monkeypatch.setenv("RHYTHM_MEMORY_CONTEXTS_JSON", "")
    monkeypatch.setenv("YOUTUBE_API_KEY", "")
    monkeypatch.setenv("AI_PROVIDER", "none")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("AI_API_KEY", "")
    monkeypatch.setenv("RHYTHM_RECOMMENDATIONS", "on")  # off by default; most Rhythm tests cover the video features
    verifier = ClerkVerifier(PUBLISHABLE_KEY)
    public_key = SIGNING_KEY.public_key()
    verifier.jwks = SimpleNamespace(get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=public_key))
    service = MemoryService(memory_client)
    app.dependency_overrides[get_verifier] = lambda: verifier
    app.dependency_overrides[get_memory] = lambda: service
    app.dependency_overrides[get_ai] = lambda: fake_ai
    app.dependency_overrides[get_ai_optional] = lambda: fake_ai
    # Conversation/content tests use a stand-in connected provider. Connection tests remove this override.
    app.dependency_overrides[get_coach_ai] = lambda: fake_ai
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
