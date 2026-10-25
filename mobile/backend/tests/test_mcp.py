"""MCP endpoint tests over real HTTP: a uvicorn server in a thread, the official MCP client, real SQLite.

Clerk keys are mocked (same signing key as conftest), Agent Memory is fake and no AI provider is
configured, so this also proves MCP reads and validated saves never need Ollama or another model.
"""

from __future__ import annotations

import os
import socket
import threading
import time
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import anyio
import httpx
import httpx2
import pytest
import uvicorn
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import ElicitResult
from sqlalchemy import func, select

from app.main import app
from app.memory import MemoryService
from app.models import AssistantProposal, HealthDay, PlanItem, Profile, Recipe, RememberedPreference, Routine, WatchToken
from conftest import ALICE, BOB, ISSUER, PUBLISHABLE_KEY, SIGNING_KEY, FakeMemoryClient, make_token

MON = "2026-10-19"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def live(tmp_path_factory: pytest.TempPathFactory) -> Iterator[SimpleNamespace]:
    port = _free_port()
    db = tmp_path_factory.mktemp("mcp") / "mcp.db"
    env = {
        "DATABASE_URL": f"sqlite:///{db}",
        "CLERK_PUBLISHABLE_KEY": PUBLISHABLE_KEY,
        "AI_PROVIDER": "none",
        "SPECTRON_API_KEY": "",  # memory replaced by a fake below
        "SPECTRON_OWNER_USER_ID": "",
        "RHYTHM_MEMORY_CONTEXTS_JSON": "",
        "YOUTUBE_API_KEY": "",
        "RHYTHM_RECOMMENDATIONS": "on",
        "MCP_PUBLIC_URL": f"http://127.0.0.1:{port}/mcp",
        "MCP_CLIENT_APPROVAL": "true",
    }
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    app.dependency_overrides.clear()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "server didn't start"
    public_key = SIGNING_KEY.public_key()
    app.state.verifier.jwks = SimpleNamespace(get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=public_key))
    memory_client = FakeMemoryClient()
    app.state.memory = MemoryService(memory_client)
    assert app.state.ai is None  # no model anywhere in these tests
    try:
        yield SimpleNamespace(base=f"http://127.0.0.1:{port}", url=f"http://127.0.0.1:{port}/mcp", memory=memory_client)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# --- helpers ---------------------------------------------------------------------------------------

def rest(live: SimpleNamespace, method: str, path: str, user: str = ALICE, **kwargs: Any) -> httpx.Response:
    """The mobile app's own REST API, with a Clerk session token."""
    return httpx.request(method, live.base + path, headers={"Authorization": f"Bearer {make_token(user)}"}, timeout=20, **kwargs)


def connection_token(live: SimpleNamespace, user: str = ALICE, label: str = "Test") -> str:
    response = rest(live, "POST", "/connections/tokens", user, json={"label": label})
    assert response.status_code == 201, response.text
    return response.json()["token"]


def call(live: SimpleNamespace, token: str, tool: str, args: dict[str, Any] | None = None, elicit: Any = None,
         mode: str = "auto") -> Any:
    async def go() -> Any:
        async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30) as http:
            transport = streamable_http_client(live.url, http_client=http)
            async with Client(transport, elicitation_callback=elicit, mode=mode) as client:  # type: ignore[arg-type]
                if tool == "__list__":
                    return await client.list_tools()
                return await client.call_tool(tool, args or {})

    return anyio.run(go)


def ok(result: Any) -> dict[str, Any]:
    assert not result.is_error, result.content
    return result.structured_content


def err(result: Any) -> str:
    assert result.is_error, result.structured_content
    return " ".join(getattr(c, "text", "") for c in result.content)


def seed(live: SimpleNamespace, user: str) -> dict[str, str]:
    rest(live, "PUT", "/profile", user, json={"goals": ["Build strength"], "dietaryPreferences": ["Vegetarian"], "equipment": ["Dumbbells"]})
    recipe = rest(live, "POST", "/recipes", user, json={
        "title": f"Lentil dal ({user})", "servings": 2, "ingredients": [{"name": "red lentils"}], "steps": [{"text": "Simmer."}],
        "tags": ["vegetarian"]}).json()
    routine = rest(live, "POST", "/routines", user, json={
        "name": f"Dumbbell 15 ({user})", "exercises": [{"name": "Goblet squat", "sets": 3, "reps": 10, "restSeconds": 45}]}).json()
    workout = rest(live, "POST", "/plan", user, json={"date": "2026-10-22", "kind": "activity", "title": "Long ride", "minutes": 45}).json()
    dinner = rest(live, "POST", "/plan", user, json={"date": MON, "kind": "meal", "title": "Chicken wrap", "timeSlot": "evening"}).json()
    return {"recipe": recipe["id"], "routine": routine["id"], "workout": workout["id"], "dinner": dinner["id"]}


def snapshot(user: str) -> dict[str, Any]:
    """Everything a user owns, to prove reads change nothing."""
    with app.state.session_factory() as db:
        def rows(model: Any) -> list[tuple[Any, ...]]:
            return sorted((getattr(r, "id", r.user_id), getattr(r, "updated_at", None), getattr(r, "status", None))
                          for r in db.scalars(select(model).where(model.user_id == user)))
        return {m.__name__: rows(m) for m in (Recipe, Routine, PlanItem, RememberedPreference, AssistantProposal, Profile,
                                              HealthDay, WatchToken)}


def plan(live: SimpleNamespace, user: str) -> dict[str, dict[str, Any]]:
    items = rest(live, "GET", "/plan", user, params={"start": MON, "days": 7}).json()["items"]
    return {i["id"]: i for i in items}


# --- authentication --------------------------------------------------------------------------------

def test_unauthenticated_and_wrong_credentials_are_rejected(live: SimpleNamespace) -> None:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    none = httpx.post(live.url, json=body, headers=headers)
    assert none.status_code == 401
    assert "resource_metadata=" in none.headers["www-authenticate"]
    # The last is the app's own session token; watch link tokens are never MCP credentials either.
    for bad in ("nonsense", "bnc_not-a-real-token", "bnw_not-a-real-token", make_token(ALICE)):
        r = httpx.post(live.url, json=body, headers={**headers, "Authorization": f"Bearer {bad}"})
        assert r.status_code == 401, bad
    metadata = httpx.get(f"{live.base}/.well-known/oauth-protected-resource/mcp").json()
    assert metadata["resource"] == live.url
    assert [s.rstrip("/") for s in metadata["authorization_servers"]] == [ISSUER]
    assert set(metadata["scopes_supported"]) == {"email", "profile"}
    root = httpx.get(f"{live.base}/.well-known/oauth-protected-resource").json()
    assert root["resource"] == live.url and [s.rstrip("/") for s in root["authorization_servers"]] == [ISSUER]


def test_clerk_oauth_access_tokens(live: SimpleNamespace) -> None:
    """End to end over HTTP; the detailed claim rules are in test_mcp_auth.py."""
    seed(live, ALICE)

    def oauth(**claims: Any) -> str:
        import jwt as pyjwt
        now = int(time.time())
        payload = {"sub": ALICE, "iss": ISSUER, "iat": now, "exp": now + 600, "jti": "oat_e2e",
                   "client_id": "https://chatgpt.com/oauth/client.json", "scope": "email profile", "aud": live.url}
        payload.update(claims)
        return pyjwt.encode({k: v for k, v in payload.items() if v is not None}, SIGNING_KEY, algorithm="RS256",
                            headers={"kid": "test-kid", "typ": "at+jwt"})

    assert ok(call(live, oauth(), "get_profile"))["dietary_preferences"] == ["Vegetarian"]
    cimd = "https://claude.ai/oauth/claude-code-client-metadata"
    assert ok(call(live, oauth(client_id=cimd, aud=[live.url, cimd]), "get_profile"))["goals"] == ["Build strength"]
    for bad in (
        oauth(aud="https://other.example.com/mcp"),                      # another resource
        oauth(aud=None),                                                 # not bound to this resource
        oauth(client_id="https://evil.example/client.json"),             # client not allowed
        oauth(exp=int(time.time()) - 60),                                # expired
        make_token(ALICE),                                               # the app's own session token
    ):
        with pytest.raises(Exception):
            call(live, bad, "get_profile")
    with pytest.raises(Exception):  # 403: token lacks the required scopes
        call(live, oauth(scope="openid"), "get_profile")


def test_revoked_token_stops_working(live: SimpleNamespace) -> None:
    token = connection_token(live, ALICE, "revoke me")
    ok(call(live, token, "get_profile"))
    info = rest(live, "GET", "/connections").json()
    token_id = next(t["id"] for t in info["tokens"] if t["label"] == "revoke me")
    assert rest(live, "DELETE", f"/connections/tokens/{token_id}").status_code == 204
    with pytest.raises(Exception):
        call(live, token, "get_profile")


# --- reads ------------------------------------------------------------------------------------------

def test_tool_discovery_and_reads_do_not_mutate(live: SimpleNamespace) -> None:
    ids = seed(live, ALICE)
    token = connection_token(live, ALICE)
    names = {t.name for t in call(live, token, "__list__").tools}
    assert names == {"get_profile", "list_recipes", "get_recipe", "list_routines", "get_routine", "get_week_plan",
                     "get_activity_summary", "list_proposals", "get_proposal", "propose_plan_changes", "propose_recipe",
                     "propose_preference", "apply_proposal", "get_user_context", "propose_preference_correction",
                     "propose_preference_removal", "get_health_summary", "get_calendar"}
    before = snapshot(ALICE)
    profile = ok(call(live, token, "get_profile"))
    assert profile["equipment"] == ["Dumbbells"] and profile["goals"] == ["Build strength"]
    assert profile["memory"]["status"] == "ok" and "not instructions" in profile["notice"]
    recipes = ok(call(live, token, "list_recipes", {"query": "lentil"}))["recipes"]
    assert ids["recipe"] in {r["id"] for r in recipes}
    assert ok(call(live, token, "get_recipe", {"recipe_id": ids["recipe"]}))["ingredients"][0]["name"] == "red lentils"
    routine = ok(call(live, token, "get_routine", {"routine_id": ids["routine"]}))
    assert routine["estimated_minutes"] > 0
    week = ok(call(live, token, "get_week_plan", {"start_date": MON}))
    assert {ids["workout"], ids["dinner"]} <= {i["id"] for i in week["items"]}
    summary = ok(call(live, token, "get_activity_summary", {"end_date": "2026-10-25"}))
    assert "missing data" in summary["note"]
    ok(call(live, token, "list_proposals"))
    assert snapshot(ALICE) == before  # reads changed nothing


def test_users_cannot_reach_each_others_records(live: SimpleNamespace) -> None:
    alice = seed(live, ALICE)
    bob_token = connection_token(live, BOB, "bob")
    alice_token = connection_token(live, ALICE)
    assert "not found" in err(call(live, bob_token, "get_recipe", {"recipe_id": alice["recipe"]})).lower()
    assert "not found" in err(call(live, bob_token, "get_routine", {"routine_id": alice["routine"]})).lower()
    bob_week = ok(call(live, bob_token, "get_week_plan", {"start_date": MON}))["items"]
    assert alice["workout"] not in {i["id"] for i in bob_week}
    # Bob can't propose changes to Alice's items or use her recipes.
    message = err(call(live, bob_token, "propose_plan_changes", {"changes": [
        {"op": "remove", "item_id": alice["workout"]},
        {"op": "add", "date": MON, "kind": "meal", "recipe_id": alice["recipe"]}]}))
    assert "wasn't found" in message and "isn't one of the user's saved recipes" in message
    # Bob can't see, apply or approve Alice's proposal.
    proposal = ok(call(live, alice_token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": alice["dinner"]}]}))
    assert "not found" in err(call(live, bob_token, "get_proposal", {"proposal_id": proposal["id"]})).lower()
    assert "not found" in err(call(live, bob_token, "apply_proposal", {"proposal_id": proposal["id"]})).lower()
    assert rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve", BOB).status_code == 404
    assert alice["dinner"] in plan(live, ALICE)


# --- proposals, approval, apply --------------------------------------------------------------------

def test_proposal_changes_nothing_until_approved_in_app(live: SimpleNamespace) -> None:
    ids = seed(live, ALICE)
    token = connection_token(live, ALICE)
    before = plan(live, ALICE)
    proposal = ok(call(live, token, "propose_plan_changes", {"changes": [
        {"op": "move", "item_id": ids["workout"], "date": "2026-10-24"},
        {"op": "replace", "item_id": ids["dinner"], "recipe_id": ids["recipe"]},
        {"op": "add", "date": "2026-10-21", "kind": "activity", "routine_id": ids["routine"]},
    ], "request_key": "fictional-week-1"}))
    assert proposal["status"] == "pending"
    descriptions = [c["description"] for c in proposal["changes"]]
    assert descriptions[0] == "Move “Long ride” from Thu to Sat"
    assert descriptions[1].startswith("Replace “Chicken wrap” on Mon dinner with “Lentil dal")
    assert descriptions[2].startswith("Add “Dumbbell 15")
    assert plan(live, ALICE) == before  # nothing saved by proposing
    # Without an approval prompt in the client, applying just reports that approval is needed.
    still = ok(call(live, token, "apply_proposal", {"proposal_id": proposal["id"]}))
    assert still["status"] == "pending" and "BuildNorth app" in still["next_step"]
    # A model-supplied "confirmed" flag is not approval: the argument isn't accepted and nothing changes.
    call(live, token, "apply_proposal", {"proposal_id": proposal["id"], "confirmed": True})
    assert plan(live, ALICE) == before
    # A retried propose with the same key returns the same proposal.
    again = ok(call(live, token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": ids["workout"]}],
                                                           "request_key": "fictional-week-1"}))
    assert again["id"] == proposal["id"]
    # The app shows it as pending, and approving there applies it once.
    pending = rest(live, "GET", "/assistant/proposals/pending").json()["proposals"]
    assert proposal["id"] in {p["id"] for p in pending}
    first = rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()
    second = rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()
    assert first["status"] == second["status"] == "applied" and first["decidedVia"] == "app"
    after = plan(live, ALICE)
    assert after[ids["workout"]]["date"] == "2026-10-24"
    assert after[ids["dinner"]]["recipeId"] == ids["recipe"]
    assert len(after) == len(before) + 1  # exactly one item added, even after a repeated approval
    assert ok(call(live, token, "get_proposal", {"proposal_id": proposal["id"]}))["status"] == "applied"
    assert ok(call(live, token, "apply_proposal", {"proposal_id": proposal["id"]}))["status"] == "applied"
    assert len(plan(live, ALICE)) == len(after)


def test_stale_and_completed_items_are_never_changed(live: SimpleNamespace) -> None:
    ids = seed(live, ALICE)
    token = connection_token(live, ALICE)
    proposal = ok(call(live, token, "propose_plan_changes", {"changes": [{"op": "move", "item_id": ids["workout"], "date": "2026-10-25"}]}))
    rest(live, "PATCH", f"/plan/{ids['workout']}", json={"status": "done"})  # completed meanwhile in the app
    result = rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()
    assert result["status"] == "stale"
    item = plan(live, ALICE)[ids["workout"]]
    assert item["date"] == "2026-10-22" and item["status"] == "done"
    # Proposing a change to a completed item is refused up front.
    assert "already done" in err(call(live, token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": ids["workout"]}]}))
    # Edited elsewhere (renamed) after proposing -> stale, not overwritten.
    proposal = ok(call(live, token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": ids["dinner"]}]}))
    with app.state.session_factory() as db:
        db.get(PlanItem, ids["dinner"]).title = "Renamed in the app"
        db.commit()
    assert rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()["status"] == "stale"
    assert ids["dinner"] in plan(live, ALICE)


def test_client_approval_prompt(live: SimpleNamespace) -> None:
    ids = seed(live, ALICE)
    token = connection_token(live, ALICE)
    prompts: list[str] = []

    async def approve(_ctx: Any, params: Any) -> ElicitResult:
        prompts.append(params.message)
        return ElicitResult(action="accept", content={"approve": True})

    async def decline(_ctx: Any, params: Any) -> ElicitResult:
        return ElicitResult(action="decline")

    declined = ok(call(live, token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": ids["workout"]}]}))
    assert ok(call(live, token, "apply_proposal", {"proposal_id": declined["id"]}, elicit=decline))["status"] == "pending"
    assert ids["workout"] in plan(live, ALICE)
    approved = ok(call(live, token, "apply_proposal", {"proposal_id": declined["id"]}, elicit=approve))
    assert approved["status"] == "applied" and approved["decided_via"] == "client_prompt"
    assert "Remove “Long ride”" in prompts[0]
    assert ids["workout"] not in plan(live, ALICE)
    # Older protocol revisions (a mid-call elicitation request) work the same way.
    legacy = ok(call(live, token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": ids["dinner"]}]}))
    applied = ok(call(live, token, "apply_proposal", {"proposal_id": legacy["id"]}, elicit=approve, mode="legacy"))
    assert applied["status"] == "applied" and ids["dinner"] not in plan(live, ALICE)


def test_recipe_and_preference_proposals(live: SimpleNamespace) -> None:
    seed(live, ALICE)
    token = connection_token(live, ALICE)
    recipe = {"title": "Fictional bean chili", "servings": 4, "tags": ["vegetarian"],
              "ingredients": [{"name": "kidney beans", "quantity": 2, "unit": "cans"}, {"name": "tomatoes", "quantity": 400, "unit": "g"}],
              "steps": [{"text": "Simmer everything.", "timer_seconds": 1200}]}
    proposal = ok(call(live, token, "propose_recipe", {"recipe": recipe}))
    assert proposal["status"] == "pending" and proposal["details"]["title"] == "Fictional bean chili"
    titles = lambda: [r["title"] for r in rest(live, "GET", "/recipes").json()]  # noqa: E731
    assert "Fictional bean chili" not in titles()
    for _ in range(2):
        rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve")
    assert titles().count("Fictional bean chili") == 1
    # The app's recipe rules apply: no ingredients, or servings out of range, are refused.
    assert "ingredient" in err(call(live, token, "propose_recipe", {"recipe": {"title": "Empty"}}))
    assert "servings" in err(call(live, token, "propose_recipe", {"recipe": {**recipe, "servings": 500}}))
    meaty = ok(call(live, token, "propose_recipe", {"recipe": {**recipe, "title": "Beef chili", "ingredients": [{"name": "beef mince"}]}}))
    assert any("vegetarian" in w for w in meaty["changes"][0]["warnings"])

    pref = ok(call(live, token, "propose_preference", {"text": "I prefer dinners under 30 minutes."}))
    assert rest(live, "GET", "/preferences").json()["preferences"] == [] or all(
        p["text"] != "I prefer dinners under 30 minutes." for p in rest(live, "GET", "/preferences").json()["preferences"])
    assert rest(live, "POST", f"/assistant/proposals/{pref['id']}/approve").json()["status"] == "applied"
    saved = [p["text"] for p in rest(live, "GET", "/preferences").json()["preferences"]]
    assert saved.count("I prefer dinners under 30 minutes.") == 1
    assert any(text == "I prefer dinners under 30 minutes." for text, _ in live.memory.records)
    assert "already remembered" in err(call(live, token, "propose_preference", {"text": "I prefer dinners under 30 minutes."}))
    # Rejected proposals are never applied.
    rejected = ok(call(live, token, "propose_preference", {"text": "I never eat breakfast."}))
    assert rest(live, "POST", f"/assistant/proposals/{rejected['id']}/reject").json()["status"] == "rejected"
    assert rest(live, "POST", f"/assistant/proposals/{rejected['id']}/approve").json()["status"] == "rejected"
    assert "I never eat breakfast." not in [p["text"] for p in rest(live, "GET", "/preferences").json()["preferences"]]


def test_concurrent_approvals_apply_once(live: SimpleNamespace) -> None:
    ids = seed(live, ALICE)
    token = connection_token(live, ALICE)
    proposal = ok(call(live, token, "propose_plan_changes", {"changes": [
        {"op": "add", "date": "2026-10-23", "kind": "meal", "recipe_id": ids["recipe"], "time_slot": "evening"}]}))
    count = lambda: sum(1 for i in plan(live, ALICE).values() if i["date"] == "2026-10-23")  # noqa: E731
    before = count()
    results: list[int] = []
    threads = [threading.Thread(target=lambda: results.append(
        rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").status_code)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [200, 200, 200, 200]
    assert count() == before + 1


def test_expired_proposals_are_not_applied(live: SimpleNamespace) -> None:
    ids = seed(live, ALICE)
    token = connection_token(live, ALICE)
    proposal = ok(call(live, token, "propose_plan_changes", {"changes": [{"op": "remove", "item_id": ids["dinner"]}]}))
    with app.state.session_factory() as db:
        db.get(AssistantProposal, proposal["id"]).expires_at = db.get(AssistantProposal, proposal["id"]).created_at
        db.commit()
    assert ok(call(live, token, "get_proposal", {"proposal_id": proposal["id"]}))["status"] == "expired"
    assert rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()["status"] == "expired"
    assert ids["dinner"] in plan(live, ALICE)


def test_mobile_routes_still_work_alongside_mcp(live: SimpleNamespace) -> None:
    carol = "user_3Carol"  # a fresh user, so earlier tests' items don't make the request ambiguous
    ids = seed(live, carol)
    assert rest(live, "GET", "/today", carol, params={"date": MON}).status_code == 200
    assert rest(live, "PATCH", f"/plan/{ids['dinner']}", carol, json={"status": "done"}).json()["status"] == "done"
    preview = rest(live, "POST", "/planner/changes", carol, json={"message": "Move Thursday's workout to Saturday",
                                                                  "today": MON, "startDate": MON, "days": 7}).json()
    assert preview["changes"][0]["description"] == "Move “Long ride” from Thu to Sat"
    with app.state.session_factory() as db:
        counts = db.scalar(select(func.count()).select_from(AssistantProposal))
    assert counts is not None
    assert rest(live, "GET", "/does-not-exist").status_code == 404


# --- shared user context and preference changes --------------------------------------------------

def prefs_of(live: SimpleNamespace, user: str = ALICE) -> dict[str, dict[str, Any]]:
    return {p["text"]: p for p in rest(live, "GET", "/preferences", user).json()["preferences"]}


@pytest.fixture(scope="module")
def alice(live: SimpleNamespace) -> str:
    """One connection token for these tests (users may hold at most 10)."""
    return connection_token(live, ALICE, "Context tests")


def test_calendar_mcp_is_owned_and_respects_health_sharing(live: SimpleNamespace) -> None:
    from datetime import UTC, datetime
    from app.models import CalendarEntry
    owner, other = "user_CalendarDemo", "user_CalendarOther"
    rest(live, "PUT", "/profile", owner, json={"goals": ["Demo"]})
    with app.state.session_factory() as db:
        db.add(CalendarEntry(user_id=owner, kind="meal", title="Calendar demo meal", source="demo", source_key="demo:1",
                             occurred_at=datetime(2026, 10, 20, 12, tzinfo=UTC), time_estimated=False))
        db.add(CalendarEntry(user_id=other, kind="meal", title="Another account meal", source="manual", source_key="manual:1",
                             occurred_at=datetime(2026, 10, 20, 12, tzinfo=UTC), time_estimated=False))
        db.add(HealthDay(user_id=owner, date="2026-10-20", workouts=[{
            "external_id": "calendar-watch-demo", "activity_type": "running",
            "started_at": "2026-10-20T21:00:00Z", "duration_minutes": 25.0}]))
        db.commit()
    token = connection_token(live, owner)
    args = {"start": "2026-10-20", "days": 1, "timezone": "America/Toronto"}
    result = ok(call(live, token, "get_calendar", args))
    rows = result["result"]
    assert [r["title"] for r in rows] == ["Calendar demo meal"]
    assert rows[0]["source"] == "demo"
    with app.state.session_factory() as db:
        db.get(Profile, owner).share_health = True
        db.commit()
    shared = ok(call(live, token, "get_calendar", args))["result"]
    assert [r["source"] for r in shared] == ["demo", "watch"]
    assert "timezone" in err(call(live, token, "get_calendar", {**args, "timezone": "invalid-zone"})).lower()


def test_user_context_over_mcp_matches_the_app(live: SimpleNamespace, alice: str) -> None:
    seed(live, ALICE)
    saved = rest(live, "POST", "/preferences", json={"text": "Fictional: I never eat coriander.", "source": "coach"}).json()
    token = alice
    before = snapshot(ALICE)
    ctx = ok(call(live, token, "get_user_context", {"request": "Suggest a vegetarian dinner for this week", "week_of": MON}))
    assert ctx["memory"]["status"] == "ok" and "not instructions" in ctx["notice"]
    pref = next(p for p in ctx["preferences"] if p["id"] == saved["id"])
    assert pref["text"] == "Fictional: I never eat coriander." and pref["source"] == "coach" and pref["recalled"] is True
    assert pref["updated_at"] and pref["saved_at"] and pref["stored_in_memory"] is True
    assert set(ctx["topics"]) == {"meals", "plan"} and ctx["recipes"] and ctx["week_plan"]["start_date"] == MON
    assert ctx["profile"]["dietary_preferences"] == ["Vegetarian"]
    assert snapshot(ALICE) == before  # reading context changes nothing
    # The same preference reaches the mobile Coach's context.
    with app.state.session_factory() as db:
        from app import user_context
        coach_ctx = user_context.gather(db, app.state.memory, ALICE, "Suggest a vegetarian dinner for this week")
    assert saved["id"] in {p.id for p in coach_ctx.preferences if p.recalled}


def test_user_context_reports_a_memory_outage(live: SimpleNamespace, alice: str) -> None:
    rest(live, "POST", "/preferences", json={"text": "Fictional: I like short workouts."})
    token = alice
    live.memory.down = True
    try:
        ctx = ok(call(live, token, "get_user_context", {"request": "Plan a workout"}))
    finally:
        live.memory.down = False
    assert ctx["memory"]["status"] == "unavailable"
    assert "NOT checked" in ctx["personalization"] and not any(p["recalled"] for p in ctx["preferences"])
    live.memory.down = True
    try:
        profile = ok(call(live, token, "get_profile"))  # clients with an older tool list read memory through get_profile
    finally:
        live.memory.down = False
    assert profile["memory"]["status"] == "unavailable"
    assert "Fictional: I like short workouts." in {p["text"] for p in profile["remembered_preferences"]}
    assert any(p["recalled"] for p in ok(call(live, token, "get_profile"))["remembered_preferences"])
    assert "Fictional: I like short workouts." in {p["text"] for p in ctx["preferences"]}  # the database still answers


def test_preference_correction_and_removal_need_approval(live: SimpleNamespace, alice: str) -> None:
    token = alice
    original = rest(live, "POST", "/preferences", json={"text": "Fictional: I prefer oat milk."}).json()
    proposal = ok(call(live, token, "propose_preference_correction", {"preference_id": original["id"], "text": "Fictional: I prefer soy milk."}))
    assert proposal["status"] == "pending" and proposal["kind"] == "preference_update"
    assert "Fictional: I prefer oat milk." in prefs_of(live)  # nothing changes before approval
    assert rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()["status"] == "applied"
    current = prefs_of(live)
    assert "Fictional: I prefer oat milk." not in current
    corrected = current["Fictional: I prefer soy milk."]
    assert corrected["source"] == "assistant" and "Context tests" in corrected["sourceDetail"]
    assert not any("oat milk" in text for text, _ in live.memory.records)
    ctx = ok(call(live, token, "get_user_context", {"request": "Which milk should I use?"}))
    assert "oat milk" not in str(ctx) and "Fictional: I prefer soy milk." in {p["text"] for p in ctx["preferences"]}

    removal = ok(call(live, token, "propose_preference_removal", {"preference_id": corrected["id"]}))
    assert removal["kind"] == "preference_delete" and "Fictional: I prefer soy milk." in prefs_of(live)
    rest(live, "POST", f"/assistant/proposals/{removal['id']}/approve")
    assert "Fictional: I prefer soy milk." not in prefs_of(live)
    assert not any("soy milk" in text for text, _ in live.memory.records)
    ctx = ok(call(live, token, "get_user_context", {"request": "Which milk should I use?"}))
    assert "soy milk" not in str(ctx).replace("Which milk should I use?", "")


def test_preference_change_goes_stale_if_the_user_edits_first(live: SimpleNamespace, alice: str) -> None:
    token = alice
    pref = rest(live, "POST", "/preferences", json={"text": "Fictional: I run on Sundays."}).json()
    proposal = ok(call(live, token, "propose_preference_removal", {"preference_id": pref["id"]}))
    rest(live, "PATCH", f"/preferences/{pref['id']}", json={"text": "Fictional: I run on Saturdays."})
    assert rest(live, "POST", f"/assistant/proposals/{proposal['id']}/approve").json()["status"] == "stale"
    assert "Fictional: I run on Saturdays." in prefs_of(live)


def test_one_off_requests_are_not_remembered(live: SimpleNamespace, alice: str) -> None:
    token = alice
    assert "one-off" in err(call(live, token, "propose_preference", {"text": "No meat this week."}))
    pref = rest(live, "POST", "/preferences", json={"text": "Fictional: I cook on weekends."}).json()
    assert "one-off" in err(call(live, token, "propose_preference_correction",
                                 {"preference_id": pref["id"], "text": "Fictional: I cook tonight only."}))


def test_other_users_preferences_are_invisible_over_mcp(live: SimpleNamespace) -> None:
    alice_pref = rest(live, "POST", "/preferences", json={"text": "Fictional: Alice hates olives."}).json()
    bob = connection_token(live, BOB, "Bob")
    ctx = ok(call(live, bob, "get_user_context", {"request": "Do I like olives? Suggest a salad recipe"}))
    assert "Alice" not in str(ctx) and alice_pref["id"] not in str(ctx)
    assert "not found" in err(call(live, bob, "propose_preference_removal", {"preference_id": alice_pref["id"]}))
    assert "not found" in err(call(live, bob, "propose_preference_correction", {"preference_id": alice_pref["id"], "text": "x y z"}))
    assert "Fictional: Alice hates olives." in prefs_of(live, ALICE)


# --- Apple Watch health summaries ------------------------------------------------------------------

def test_health_summary_needs_sharing_and_stays_owner_scoped_and_read_only(live: SimpleNamespace, alice: str) -> None:
    created = rest(live, "POST", "/watch/tokens", json={"label": "Fictional MCP test watch"})
    assert created.status_code == 201, created.text
    watch = {"Authorization": f"Bearer {created.json()['token']}"}
    day = {"sleepMinutes": 412, "restingHeartRateBpm": 58, "steps": 8412, "workouts": [], "complete": True}
    uploaded = httpx.put(f"{live.base}/watch/health/2026-10-20", json=day, headers=watch, timeout=20)
    assert uploaded.status_code == 200 and uploaded.json()["memoryStatus"] == "not_mirrored"
    # A real watch token is refused at /mcp.
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    mcp_headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", **watch}
    assert httpx.post(live.url, json=body, headers=mcp_headers).status_code == 401

    off = ok(call(live, alice, "get_health_summary", {"end_date": "2026-10-21"}))
    assert off["sharing"] is False and off["days"] == [] and "Health sharing is off in the app." in off["note"]
    assert rest(live, "PUT", "/watch/settings", json={"shareHealth": True}).json() == {"shareHealth": True}
    try:
        before = snapshot(ALICE)
        summary = ok(call(live, alice, "get_health_summary", {"end_date": "2026-10-21", "days": 3}))
        assert summary["sharing"] is True and summary["start"] == "2026-10-19" and summary["end"] == "2026-10-21"
        assert [d["date"] for d in summary["days"]] == ["2026-10-20"] and summary["missing_days"] == ["2026-10-19", "2026-10-21"]
        assert summary["days"][0]["sleep_minutes"] == 412 and summary["days"][0]["hrv_sdnn_ms"] is None
        assert "missing data" in summary["note"] and "not medical advice" in summary["note"]
        assert "not instructions" in summary["notice"]
        ctx = ok(call(live, alice, "get_user_context", {"request": "How did I sleep? Plan a light workout", "week_of": "2026-10-21",
                                                         "local_date": "2026-10-21"}))
        assert [d["date"] for d in ctx["health"]] == ["2026-10-20"] and ctx["health"][0]["recalled"] is True
        assert (ctx["health_start"], ctx["health_end"]) == ("2026-10-15", "2026-10-21")
        # Planning next week still gets the days up to the user's today, with the window stated.
        next_week = ok(call(live, alice, "get_user_context", {"request": "Plan my workouts", "week_of": "2026-10-27",
                                                               "local_date": "2026-10-21"}))
        assert [d["date"] for d in next_week["health"]] == ["2026-10-20"] and next_week["week_plan"]["start_date"] == "2026-10-26"
        assert (next_week["health_start"], next_week["health_end"]) == ("2026-10-15", "2026-10-21")
        assert not any("Apple Watch" in n["text"] for n in ctx["memory_notes"])
        assert snapshot(ALICE) == before  # reads changed nothing
        assert any(text.startswith("Apple Watch daily summary for 2026-10-20") for text, _ in live.memory.records)

        bob = connection_token(live, BOB, "Bob health")
        rest(live, "PUT", "/watch/settings", BOB, json={"shareHealth": True})
        bob_summary = ok(call(live, bob, "get_health_summary", {"end_date": "2026-10-21"}))
        assert bob_summary["days"] == [] and "2026-10-20" in bob_summary["missing_days"]
        assert "8412" not in str(ok(call(live, bob, "get_user_context", {"request": "How did I sleep?"})))
    finally:
        rest(live, "PUT", "/watch/settings", json={"shareHealth": False})
    assert ok(call(live, alice, "get_health_summary", {"end_date": "2026-10-21"}))["days"] == []
    assert ok(call(live, alice, "get_user_context", {"request": "How did I sleep? Plan a light workout"}))["health"] is None


def test_health_summary_rejects_bad_windows(live: SimpleNamespace, alice: str) -> None:
    for days in (0, 32):  # 1-31
        assert "days" in err(call(live, alice, "get_health_summary", {"end_date": "2026-10-21", "days": days})), days
    for end_date in ("2026-13-01", "21/10/2026", "not-a-date"):
        assert "isn't a YYYY-MM-DD date" in err(call(live, alice, "get_health_summary", {"end_date": end_date})), end_date
        assert "isn't a YYYY-MM-DD date" in err(call(live, alice, "get_user_context", {"request": "Plan", "local_date": end_date}))


def test_rhythm_phone_to_mcp_flow_obeys_grants_tasks_and_source_claims(live: SimpleNamespace) -> None:
    """Real Streamable HTTP + MCP client; Clerk signing keys and displayed video metadata are test fixtures."""
    import uuid
    from app.models import utcnow
    from test_rhythm import interests, video
    user = "user_4Rhythm"
    rhythm = SimpleNamespace(base=live.base, url=live.base + "/rhythm/mcp")

    def tool(name, arguments=None):
        return call(rhythm, token, name, arguments)

    def ui(method, path, **kwargs):
        response = rest(live, method, path, user, **kwargs)
        assert response.status_code == 200, response.text
        return response.json()

    ui("PUT", "/rhythm/interests", json=interests())
    metadata = httpx.get(live.base + "/.well-known/oauth-protected-resource/rhythm/mcp").json()
    assert metadata["resource"] == rhythm.url
    # The OAuth audience is separate as well as the bearer-token family.
    import jwt as pyjwt
    def oauth(resource):
        now = int(time.time())
        return pyjwt.encode({
            "sub": user, "iss": ISSUER, "iat": now, "exp": now + 600, "jti": "rhythm_oauth_test",
            "client_id": "https://claude.ai/oauth/mcp-oauth-client-metadata",
            "scope": "email profile", "aud": resource,
        }, SIGNING_KEY, algorithm="RS256", headers={"kid": "test-kid", "typ": "at+jwt"})
    oauth_token = oauth(rhythm.url)
    with pytest.raises(Exception):
        call(live, oauth_token, "get_profile")
    with pytest.raises(Exception):
        call(rhythm, oauth(live.url), "get_interests")
    assert ok(call(rhythm, oauth_token, "get_interests"))["status"] == "permission_required"
    oauth_grant = ok(call(rhythm, oauth_token, "connect_rhythm"))["agents"][0]
    ui("POST", f"/rhythm/agents/{oauth_grant['id']}/approve", json={"capabilities": ["interests"]})
    assert ok(call(rhythm, oauth_token, "get_interests"))["status"] == "ok"
    ui("DELETE", f"/rhythm/agents/{oauth_grant['id']}")
    assert ok(call(rhythm, oauth_token, "get_interests"))["status"] == "permission_required"

    created = ui("POST", "/rhythm/agents/token", json={
        "label": "MCP protocol test", "capabilities": ["interests", "page", "search", "transcripts", "recommend", "memory", "feedback"],
    })
    token, agent = created["token"], created["agent"]
    assert token.startswith("bnr_")
    # Separate resources: a Rhythm token cannot authenticate to the older app MCP endpoint.
    with pytest.raises(Exception):
        call(live, token, "get_profile")
    tool_names = {item.name for item in call(rhythm, token, "__list__").tools}
    assert "get_profile" not in tool_names and len(tool_names) == 16
    # It is not an app session and cannot self-approve a task.
    assert httpx.put(live.base + "/rhythm/interests", headers={"Authorization": f"Bearer {token}"},
                     json=interests(), timeout=10).status_code == 401
    context = ok(tool("get_interests"))
    assert context["profile"]["profileRevision"] == 1
    assert context["profile"]["ownerUserId"] == user
    page = ui("POST", "/rhythm/browsers", json={
        "metadata": video(), "capturedAt": utcnow().isoformat(), "allowTranscripts": True, "expectedRevision": 1,
    })["browser"]
    task = ok(tool("create_video_task", {"task": {
        "action": "evaluate", "request": "Evaluate my selected tutorial", "analyzeTranscripts": True,
        "browserSessionId": page["id"], "idempotencyKey": uuid.uuid4().hex,
    }}))["task"]
    assert task["status"] == "pending"
    denied = ok(tool("get_video_transcript", {"task_id": task["id"], "candidate_id": uuid.uuid4().hex}))
    assert denied["status"] == "permission_required"
    ui("POST", f"/rhythm/tasks/{task['id']}/approve")
    candidate = ok(tool("add_selected_video", {
        "task_id": task["id"], "browser_session_id": page["id"],
    }))["candidates"][0]
    from app.models import RhythmCandidate
    from app.rhythm.schemas import VideoMetadata
    with app.state.session_factory() as db:
        excluded = RhythmCandidate(user_id=user, task_id=task["id"], video_id="xxxxxxxxxxx",
                                    page_metadata=VideoMetadata.model_validate(video("BJJ guard passing", "xxxxxxxxxxx")).model_dump(),
                                    relevance={"status": "relevant", "reasons": ["Untrusted old decision"]},
                                    shortlisted=True, source="youtube_api")
        db.add(excluded); db.commit(); excluded_id = excluded.id
    assert ok(tool("get_video_transcript", {"task_id": task["id"], "candidate_id": excluded_id}))["status"] == "irrelevant"
    assert ui("GET", "/rhythm/metrics")["metrics"]["transcriptAttempts"] == 0
    assert ok(tool("get_video_transcript", {
        "task_id": task["id"], "candidate_id": candidate["id"],
    }))["status"] == "permission_required"
    ok(tool("shortlist_videos", {"task_id": task["id"], "candidate_ids": [candidate["id"]]}))
    assert ok(tool("get_video_transcript", {
        "task_id": task["id"], "candidate_id": candidate["id"],
    }))["status"] == "pending"
    # Supported alternative: text the user supplies, explicitly labelled. It cancels the queued page request.
    ui("POST", f"/rhythm/tasks/{task['id']}/candidates/{candidate['id']}/import", json={
        "segments": [{"startSeconds": 3, "text": "Keep your hands up."}], "language": "en", "completeness": "partial",
    })
    transcript = ok(tool("get_video_transcript", {"task_id": task["id"], "candidate_id": candidate["id"]}))
    assert transcript["status"] == "transcript_partial"
    assert transcript["transcript"]["source"] == "user_supplied"
    result = ok(tool("show_recommendations", {"task_id": task["id"], "items": [{
        "candidateId": candidate["id"], "analysisBasis": "user_text", "citations": [{"segmentIndex": 0, "quote": "Keep your hands up."}],
    }]}))
    assert result["delivery"] == "saved_for_later"
    rec = result["recommendations"][0]
    assert rec["analysisBasis"] == "user_text_partial"
    feedback = ok(tool("record_feedback", {"recommendation_id": rec["id"], "feedback": {"feedback": "saved"}}))
    assert feedback["status"] == "pending"
    assert ui("GET", "/rhythm/recommendations")["recommendations"][0]["feedback"] is None
    proposal = next(m for m in ui("GET", "/rhythm/memories")["memories"] if m["status"] == "feedback_saved")
    ui("POST", f"/rhythm/memories/{proposal['id']}/approve")
    assert ui("GET", "/rhythm/recommendations")["recommendations"][0]["feedback"] == "saved"
    ui("PUT", "/rhythm/interests", json=interests(expectedRevision=1, topics=["food"]))
    assert ok(tool("get_video_transcript", {
        "task_id": task["id"], "candidate_id": candidate["id"],
    }))["status"] == "stale_context"
    assert ui("GET", "/rhythm/metrics")["metrics"]["transcriptAttempts"] == 1
    ui("DELETE", f"/rhythm/agents/{agent['id']}")
    with pytest.raises(Exception):
        tool("get_interests")


def test_rhythm_agent_summarises_saved_videos(live: SimpleNamespace) -> None:
    """With the Saved videos permission, an agent reads saved videos with their transcripts and stores summaries."""
    from app.models import RhythmSignal
    from test_rhythm import interests
    from test_rhythm_learning import watched
    user = "user_5Saved"
    rhythm = SimpleNamespace(base=live.base, url=live.base + "/rhythm/mcp")

    def ui(method, path, **kwargs):
        response = rest(live, method, path, user, **kwargs)
        assert response.status_code == 200, response.text
        return response.json()

    ui("PUT", "/rhythm/interests", json=interests())
    kick = watched("Karate front kick basics", 1, transcript="Chamber the knee, then snap the kick out and back.")
    assert ui("POST", "/rhythm/reactions", json={**kick, "reaction": "more"})["status"] == "ok"
    ui("POST", "/rhythm/reactions", json={**watched("Boxing slip drill tutorial", 2), "reaction": "less"})

    # Without the permission, nothing is listed or stored.
    interests_only = ui("POST", "/rhythm/agents/token", json={"label": "Interests only", "capabilities": ["interests"]})["token"]
    assert ok(call(rhythm, interests_only, "list_saved_videos"))["status"] == "permission_required"
    assert ok(call(rhythm, interests_only, "save_video_summary", {
        "video_id": "vid00000001", "summary": "Not allowed."}))["status"] == "permission_required"

    token = ui("POST", "/rhythm/agents/token", json={"label": "Summariser", "capabilities": ["interests", "saved"]})["token"]
    listed = ok(call(rhythm, token, "list_saved_videos"))
    # Only saves: the "Not interested" video isn't listed.
    assert [v["videoId"] for v in listed["savedVideos"]] == ["vid00000001"]
    assert listed["savedVideos"][0]["transcript"] == "Chamber the knee, then snap the kick out and back."
    assert listed["savedVideos"][0]["summary"] is None
    stored = ok(call(rhythm, token, "save_video_summary", {
        "video_id": "vid00000001", "summary": "A beginner karate lesson on the front kick: chamber the knee, then snap it."}))
    assert stored["status"] == "ok" and stored["savedVideos"][0]["summary"].startswith("A beginner karate lesson")
    assert ok(call(rhythm, token, "list_saved_videos", {"unsummarized_only": True}))["savedVideos"] == []
    assert ok(call(rhythm, token, "save_video_summary", {"video_id": "vid00000002", "summary": "x"}))["status"] == "not_found"
    with app.state.session_factory() as db:
        row = db.scalar(select(RhythmSignal).where(RhythmSignal.user_id == user, RhythmSignal.video_id == "vid00000001"))
        assert row.summary.startswith("A beginner karate lesson") and row.summary_by == "Summariser"
        assert row.summarized_at is not None and "karate" in row.topics

    # Turning agent sharing off stops it.
    profile = ui("GET", "/rhythm/interests")["profile"]
    ui("PUT", "/rhythm/settings", json={"enabledSites": profile["enabledSites"], "consent": {**profile["consent"], "agent": False},
                                        "expectedRevision": profile["profileRevision"]})
    assert ok(call(rhythm, token, "list_saved_videos"))["status"] == "permission_required"


def test_rhythm_assistants_approved_in_the_app_connect_without_a_second_step(live: SimpleNamespace) -> None:
    """"Connect Claude / ChatGPT / Codex": approved in the app, then each signs in with its own OAuth identity."""
    import jwt as pyjwt
    from test_rhythm import interests
    user = "user_6Assist"
    rhythm = SimpleNamespace(base=live.base, url=live.base + "/rhythm/mcp")

    def ui(method, path, **kwargs):
        response = rest(live, method, path, user, **kwargs)
        assert response.status_code == 200, response.text
        return response.json()

    def oauth(client_id):
        now = int(time.time())
        return pyjwt.encode({
            "sub": user, "iss": ISSUER, "iat": now, "exp": now + 600, "jti": f"assistant_{abs(hash(client_id))}",
            "client_id": client_id, "scope": "email profile", "aud": rhythm.url,
        }, SIGNING_KEY, algorithm="RS256", headers={"kid": "test-kid", "typ": "at+jwt"})

    claude = oauth("https://claude.ai/oauth/mcp-oauth-client-metadata")
    codex = oauth("https://chatgpt.com/oauth/codex/client.json")
    chatgpt = oauth("https://chatgpt.com/oauth/client.json")
    ui("PUT", "/rhythm/interests", json=interests())
    assert ok(call(rhythm, claude, "get_interests"))["status"] == "permission_required"

    approved = ui("PUT", "/rhythm/assistants/claude", json={"capabilities": ["interests", "saved"]})
    assert approved["agents"][0]["label"] == "Claude" and approved["mcpUrl"] == rhythm.url
    # Claude's first request works: no connect_rhythm and no second approval.
    assert ok(call(rhythm, claude, "get_interests"))["status"] == "ok"
    assert ok(call(rhythm, claude, "connect_rhythm"))["status"] == "ok"
    assert ok(call(rhythm, claude, "list_saved_videos"))["status"] == "ok"

    # Codex and ChatGPT both sign in from chatgpt.com, but each needs its own approval.
    assert ok(call(rhythm, codex, "get_interests"))["status"] == "permission_required"
    ui("PUT", "/rhythm/assistants/codex", json={"capabilities": ["interests"]})
    assert ok(call(rhythm, codex, "get_interests"))["status"] == "ok"
    assert ok(call(rhythm, codex, "list_saved_videos"))["status"] == "permission_required"
    assert ok(call(rhythm, chatgpt, "get_interests"))["status"] == "permission_required"

    # Disconnecting in the app stops it at once; connecting again restores it.
    ui("DELETE", f"/rhythm/agents/{approved['agents'][0]['id']}")
    assert ok(call(rhythm, claude, "get_interests"))["status"] == "permission_required"
    ui("PUT", "/rhythm/assistants/claude", json={"capabilities": ["interests"]})
    assert ok(call(rhythm, claude, "get_interests"))["status"] == "ok"
    assert rest(live, "PUT", "/rhythm/assistants/gemini", user, json={"capabilities": ["interests"]}).status_code == 422
