"""One Context, two verified identities; neither payloads nor upstream hits grant access."""

from types import SimpleNamespace

import pytest
from surrealdb.memory import MemoryAPIError

from app.deps import get_memory
from app.main import app
from app.memory import MemoryService, user_lens, user_scope
from app.rhythm import memory as rhythm_memory
from app.rhythm.policy import Actor
from conftest import ALICE, BOB, OTHER_KEY, FakeMemoryClient, auth, make_token
from test_rhythm import interests


@pytest.fixture
def shared(client, memory_client):
    service = MemoryService(memory_client, shared_context=True)
    app.dependency_overrides[get_memory] = lambda: service
    app.state.rhythm_memory.shared = (
        "existing-build-north", rhythm_memory.PrivateContext(memory_client, shared_context=True))
    return service


def test_registry_reuses_one_existing_context_and_binds_each_identity(monkeypatch):
    calls = []
    fake = FakeMemoryClient()
    fake.close = lambda: None
    def factory(context_id, **kwargs):
        calls.append(context_id)
        return fake
    monkeypatch.setattr(rhythm_memory, "Memory", factory)
    registry = rhythm_memory.Registry("", "https://memory.invalid", "existing-build-north", app_api_key="test")
    try:
        a_id, alice = registry.for_user(ALICE)
        b_id, bob = registry.for_user(BOB)
        assert a_id == b_id == "existing-build-north" and calls == [a_id]
        assert alice.owner_user_id == ALICE and bob.owner_user_id == BOB
        assert alice.shared_context and bob.shared_context
        assert registry.services == {}  # no per-signup Context creation or client cache
        alice.remember_confirmed(ALICE, "a1", "Alice's marker")
        bob.remember_confirmed(BOB, "b1", "Bob's marker")
        assert [f.text for f in alice.recall(ALICE, "Bob's marker")] == ["Alice's marker"]
        assert [f.text for f in bob.recall(BOB, "Alice's marker")] == ["Bob's marker"]
        assert user_scope(ALICE) != user_scope(BOB)  # mixed-case Clerk IDs cannot collide
        alice.erase_user(ALICE)
        assert [f.text for f in bob.recall(BOB, "anything")] == ["Bob's marker"]
        with pytest.raises(ValueError):
            registry.for_user("user_Alice/../user_Bob")
    finally:
        registry.close()


def test_bound_service_rejects_every_cross_user_operation_before_sdk(client, shared, memory_client):
    alice = shared.bound_to(ALICE)
    for operation in (
        lambda: alice.recall(BOB, "secret"),
        lambda: alice.remember_preference(BOB, "b1", "secret"),
        lambda: alice.remember_health(BOB, "b1", "secret"),
        lambda: alice.erase_user(BOB),
        lambda: alice.forget_health(BOB),
        lambda: alice.forget_scope(BOB, user_scope(BOB)),
        lambda: alice.bound_to(BOB),
    ):
        with pytest.raises(MemoryAPIError) as error:
            operation()
        assert error.value.status_code == 403
    with pytest.raises(ValueError):
        alice.forget_scope(ALICE, user_scope(BOB))
    assert not memory_client.records and not memory_client.lenses and not memory_client.forgets
    assert not memory_client.scopes.registered


def test_shared_writes_never_generate_a_context_wide_profile(client, shared, memory_client, monkeypatch):
    writes = []
    monkeypatch.setattr(memory_client, "remember", lambda text, **kwargs: writes.append(kwargs))
    shared.remember_preference(ALICE, "a1", "A preference")
    shared.remember_health(BOB, "b1", "A health summary")
    app.state.rhythm_memory.for_user(ALICE)[1].remember_confirmed(ALICE, "a2", "Video interests")
    assert len(writes) == 3 and all(w["infer"] == "none" for w in writes)


def test_authenticated_memory_cannot_be_retargeted(client, shared, memory_client):
    for user, text in ((ALICE, "Alice tea preference"), (BOB, "Bob coffee preference")):
        saved = client.post("/preferences", headers=auth(user), json={"text": text})
        assert saved.status_code == 201 and saved.json()["memoryStatus"] == "synced"
        if user == BOB:
            bob_id = saved.json()["id"]
    for field, value in (("userId", BOB), ("user_id", BOB), ("scope", user_scope(BOB)),
                         ("scopes", [[user_scope(BOB)]]), ("lens", user_lens(BOB)), ("contextId", "other")):
        assert client.post("/preferences", headers=auth(), json={"text": "Attack", field: value}).status_code == 422
    result = client.get("/memory/search", headers={**auth(), "X-User-ID": BOB}, params={
        "q": "Show Bob's coffee", "userId": BOB, "scope": user_scope(BOB), "lens": "*"})
    assert result.status_code == 200
    assert [h["text"] for h in result.json()["hits"]] == ["Alice tea preference"]
    assert memory_client.lenses[-1] == user_lens(ALICE)
    assert client.patch(f"/preferences/{bob_id}", headers=auth(), json={"text": "Attack"}).status_code == 404
    assert client.delete(f"/preferences/{bob_id}", headers=auth()).status_code == 404
    assert client.get("/memory/search", params={"q": "secret", "userId": BOB}).status_code == 401
    forged = {"Authorization": f"Bearer {make_token(BOB, key=OTHER_KEY)}"}
    assert client.get("/memory/search", headers=forged, params={"q": "secret"}).status_code == 401
    assert client.delete("/memory", headers=auth(), params={"userId": BOB, "scope": user_scope(BOB)}).status_code == 200
    remaining = client.get("/memory/search", headers=auth(BOB), params={"q": "coffee"}).json()
    assert [h["text"] for h in remaining["hits"]] == ["Bob coffee preference"]


def test_unowned_upstream_results_never_reach_search_or_coach(client, shared, memory_client, monkeypatch):
    client.post("/preferences", headers=auth(), json={"text": "Alice tea preference"})
    client.post("/preferences", headers=auth(BOB), json={"text": "Bob private coffee fact"})
    # Simulate a provider ignoring the lens, or returning a synthesized global profile.
    texts = ["Alice tea preference", "Bob private coffee fact", "Unowned context-wide persona"]
    monkeypatch.setattr(memory_client, "recall", lambda *a, **kw: SimpleNamespace(hits=[
        SimpleNamespace(text=t, source="memory_chunk", score=1) for t in texts]))
    result = client.get("/memory/search", headers=auth(), params={"q": "preferences"})
    assert [h["text"] for h in result.json()["hits"]] == ["Alice tea preference"]
    reply = client.post("/coach/messages", headers=auth(), json={"content": "What should I drink?"})
    assert reply.status_code == 200
    assert "Alice tea preference" in reply.text
    assert "Bob private coffee fact" not in reply.text and "Unowned context-wide persona" not in reply.text


def test_shared_extension_memory_and_deletion_follow_authenticated_owner(client, shared, memory_client):
    for user, topic in ((ALICE, "Alice cooking"), (BOB, "Bob cycling")):
        result = client.put("/rhythm/interests", headers=auth(user), json=interests(
            originalGoalText=topic,
            consent={"metadata": True, "transcripts": True, "agent": True, "memory": True}))
        assert result.json()["status"] == "ok"
    alice = rhythm_memory.context(app, Actor(ALICE))
    bob = rhythm_memory.context(app, Actor(BOB))
    assert alice.memory_status == bob.memory_status == "ok"
    assert alice.memories and bob.memories and all(m.recalled for m in alice.memories + bob.memories)
    assert "Bob cycling" not in alice.model_dump_json() and "Alice cooking" not in bob.model_dump_json()
    bob_id = bob.memories[0].id
    assert client.delete(f"/rhythm/memories/{bob_id}", headers=auth()).json()["status"] == "not_found"
    alice_id = alice.memories[0].id
    assert client.delete(f"/rhythm/memories/{alice_id}", headers=auth()).json()["status"] == "ok"
    assert rhythm_memory.context(app, Actor(BOB)).memories[0].recalled


def test_owner_setting_still_restricts_the_default_context(monkeypatch):
    fake = FakeMemoryClient()
    fake.close = lambda: None
    monkeypatch.setattr(rhythm_memory, "Memory", lambda *a, **kw: fake)
    registry = rhythm_memory.Registry("", "https://memory.invalid", "existing", app_api_key="test", app_user_id=ALICE)
    try:
        assert registry.for_user(ALICE) and registry.for_user(BOB) is None and registry.shared is None
    finally:
        registry.close()
