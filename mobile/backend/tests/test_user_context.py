"""The shared user context (user_context.py) and how the Coach uses it.

Fake Agent Memory (conftest.FakeMemoryClient) mirrors the live-verified scoping rules; fake AI echoes the
prompt it was given, so these tests see exactly what context reached the model.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import user_context
from app.main import app
from app.memory import MemoryService, preference_scope
from conftest import ALICE, ALICE_SCOPE, BOB, BOB_SCOPE, auth

RECIPE = {"title": "Fictional coriander-free dal", "servings": 2, "ingredients": [{"name": "red lentils"}],
          "steps": [{"text": "Simmer."}], "tags": ["vegetarian"]}
ROUTINE = {"name": "Fictional 15-minute dumbbells", "exercises": [{"name": "Goblet squat", "sets": 3, "reps": 10}]}
PREF = "I can't stand coriander; leave it out of every recipe."


def coach(client: TestClient, text: str, user: str = ALICE) -> dict:  # type: ignore[type-arg]
    response = client.post("/coach/messages", headers=auth(user), json={"content": text, "localDate": "2026-10-21"})
    assert response.status_code == 200, response.text
    return response.json()


def gather(user: str, request: str, memory_client) -> user_context.UserContext:  # type: ignore[no-untyped-def]
    with app.state.session_factory() as db:
        return user_context.gather(db, MemoryService(memory_client), user, request)


def test_topics_are_detected_from_the_request() -> None:
    assert user_context.detect_topics("What should I cook for dinner?") == ["meals"]
    assert user_context.detect_topics("A 20-minute workout with dumbbells") == ["workouts"]
    assert user_context.detect_topics("Plan my meals and workouts for next week") == ["meals", "workouts", "plan"]
    assert user_context.detect_topics("Hello") == []


def test_coach_combines_recalled_memory_with_the_records_the_request_needs(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    client.post("/preferences", headers=auth(), json={"text": PREF})
    client.post("/recipes", headers=auth(), json=RECIPE)
    client.post("/routines", headers=auth(), json=ROUTINE)
    client.post("/plan", headers=auth(), json={"date": "2026-10-22", "kind": "meal", "title": "Fictional bean tacos", "timeSlot": "evening"})
    reply = coach(client, "Plan my dinners and workouts for this week")
    prompt = reply["reply"]["content"]
    for expected in (PREF, "<memory_status>\nchecked", "<saved_recipes>", "Fictional coriander-free dal",
                     "<saved_routines>", "Fictional 15-minute dumbbells", "<week_plan>", "Fictional bean tacos"):
        assert expected in prompt, expected
    context = reply["reply"]["context"]
    assert context["memory"] == "ok" and context["recalled"] == 1 and context["preferences"] == 1
    assert context["recipes"] == 1 and context["routines"] == 1 and context["planItems"] == 1
    assert set(context["topics"]) == {"meals", "workouts", "plan"}
    # Stored with the reply, so the app can show it in history too.
    history = client.get("/coach/messages", headers=auth()).json()["messages"]
    assert history[-1]["context"]["memory"] == "ok" and history[0]["context"] is None
    # A greeting needs no records: none are pulled in.
    small_talk = coach(client, "Hello there")["reply"]["context"]
    assert small_talk["recipes"] == small_talk["routines"] == small_talk["planItems"] == 0


def test_memory_outage_is_flagged_on_the_reply_not_hidden(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    client.post("/preferences", headers=auth(), json={"text": PREF})
    memory_client.down = True
    reply = coach(client, "Suggest a curry recipe")
    assert reply["memoryAvailable"] is False
    assert reply["reply"]["context"]["memory"] == "unavailable" and reply["reply"]["context"]["recalled"] == 0
    prompt = reply["reply"]["content"]
    assert "UNAVAILABLE for this reply" in prompt
    assert PREF in prompt  # saved preferences come from the database and still apply
    memory_client.down = False
    assert coach(client, "Suggest a curry recipe")["reply"]["context"]["memory"] == "ok"


def test_coach_never_offers_one_off_requests_as_lasting_preferences(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    fake_ai.coach_suggestions = [{"type": "preference", "title": "Vegetarian", "content": "I prefer vegetarian meals."},
                                 {"type": "recipe", "title": "Bean chili", "content": "1 can beans. 1. Cook."}]
    one_off = coach(client, "No meat tonight please, what can I cook?")["reply"]["suggestions"]
    assert [s["type"] for s in one_off] == ["recipe"]
    lasting = coach(client, "I'm vegetarian from now on. What can I cook?")["reply"]["suggestions"]
    assert [s["type"] for s in lasting] == ["preference", "recipe"]
    assert client.get("/preferences", headers=auth()).json()["preferences"] == []  # suggestions are never saved by themselves


def test_preferences_record_their_source(client: TestClient) -> None:
    coach_pref = client.post("/preferences", headers=auth(), json={"text": "I train in the mornings.", "source": "coach"}).json()
    assert coach_pref["source"] == "coach"
    corrected = client.patch(f"/preferences/{coach_pref['id']}", headers=auth(), json={"text": "I train in the evenings."}).json()
    assert corrected["source"] == "app" and corrected["createdAt"] == coach_pref["createdAt"]
    assert client.post("/preferences", headers=auth(), json={"text": "x", "source": "assistant"}).status_code == 422


def test_corrected_and_deleted_preferences_never_come_back(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    pref = client.post("/preferences", headers=auth(), json={"text": "I prefer oat milk."}).json()
    corrected = client.patch(f"/preferences/{pref['id']}", headers=auth(), json={"text": "I prefer soy milk."}).json()
    ctx = gather(ALICE, "Which milk for my porridge?", memory_client)
    assert [p.text for p in ctx.preferences] == ["I prefer soy milk."] and ctx.preferences[0].recalled
    assert "oat" not in ctx.model_dump_json()
    assert client.delete(f"/preferences/{corrected['id']}", headers=auth()).status_code == 204
    ctx = gather(ALICE, "Which milk for my porridge?", memory_client)
    assert ctx.preferences == [] and ctx.memory_notes == [] and "milk" not in ctx.model_dump_json().replace(ctx.request, "")


def test_unattributed_memory_is_withheld_while_an_erase_is_pending(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    pref = client.post("/preferences", headers=auth(), json={"text": "I prefer spicy food."}).json()
    # Agent Memory may also hold facts it derived from a preference, under the same scope.
    scope = preference_scope(ALICE, pref["id"])
    memory_client.records.append(("Likes chilli heat", [[scope]]))
    memory_client.down = True
    assert client.delete(f"/preferences/{pref['id']}", headers=auth()).status_code == 204  # erase fails: tombstone
    memory_client.down = False
    ctx = gather(ALICE, "dinner ideas", memory_client)  # no retry here (MCP reads never write)
    assert ctx.memory.status == "ok" and ctx.memory_notes == [] and "withheld" in ctx.memory.detail
    assert "spicy" not in ctx.model_dump_json() and "chilli" not in ctx.model_dump_json()
    client.get("/preferences", headers=auth())  # the retry erases the whole scope, derived facts included
    assert memory_client.records == []


def test_context_is_scoped_to_the_verified_user(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    client.post("/preferences", headers=auth(ALICE), json={"text": "Alice is fictional and avoids mushrooms."})
    client.post("/recipes", headers=auth(ALICE), json=RECIPE)
    client.post("/preferences", headers=auth(BOB), json={"text": "Bob is fictional and loves mushrooms."})
    bob = gather(BOB, "Suggest a dinner recipe", memory_client)
    dumped = bob.model_dump_json()
    assert "Alice" not in dumped and "coriander-free" not in dumped
    assert [p.text for p in bob.preferences] == ["Bob is fictional and loves mushrooms."]
    assert memory_client.lenses[-1] == [[f"{BOB_SCOPE}/*"]]
    prompt = coach(client, "Suggest a dinner recipe", BOB)["reply"]["content"]
    assert "Alice" not in prompt and "coriander-free" not in prompt
    assert all(lens in ([[f"{ALICE_SCOPE}/*"]], [[f"{BOB_SCOPE}/*"]]) for lens in memory_client.lenses)


def test_weekly_planner_checks_memory_and_says_when_it_could_not(client: TestClient, memory_client, fake_ai) -> None:  # type: ignore[no-untyped-def]
    from test_planner import request, setup_user

    ids = setup_user(client)
    pref = client.post("/preferences", headers=auth(), json={"text": "I prefer quick dinners."}).json()
    # A fact Agent Memory derived from that preference (same scope), not itself a saved preference.
    memory_client.records.append(("Likes meals under 30 minutes", [[preference_scope(ALICE, pref["id"])]]))
    draft = client.post("/planner/proposals", headers=auth(), json=request(ids)).json()
    assert draft["memory"] == "ok"
    assert any(f["source"] == "memory" and "under 30 minutes" in f["label"] for f in draft["facts"])
    planning_prompt = fake_ai.calls[-1]["messages"][0]["content"]
    assert "Memory note: Likes meals under 30 minutes" in planning_prompt and "You said: I prefer quick dinners." in planning_prompt

    memory_client.down = True
    draft = client.post("/planner/proposals", headers=auth(), json=request(ids)).json()
    assert draft["memory"] == "unavailable"
    assert draft["notes"][0].startswith("Long-term memory couldn't be checked")
    assert not any(f["source"] == "memory" for f in draft["facts"])


def test_coach_shows_line_breaks_a_model_escaped(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    fake_ai.coach_suggestions = [{"type": "recipe", "title": "Dal", "content": "Ingredients:\\n- lentils\\n1. Simmer."}]
    reply = coach(client, "A dal recipe please")["reply"]
    assert reply["suggestions"][0]["content"] == "Ingredients:\n- lentils\n1. Simmer."
