"""Weekly planner tests: grounding, validation, transactional/idempotent saves, conversational changes,
temporary vs lasting preferences, isolation, unavailable AI and the weekly review (fake AI, real SQLite)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.planner import persistence_of, routine_minutes
from conftest import ALICE, BOB, auth

MON = "2026-10-19"  # a Monday; the week runs Mon 19 – Sun 25 Oct 2026
THU, SAT = "2026-10-22", "2026-10-24"


def setup_user(client: TestClient, user: str = ALICE) -> dict[str, str]:
    client.put(
        "/profile",
        headers=auth(user),
        json={"goals": ["Build strength"], "dietaryPreferences": ["Vegetarian"], "equipment": ["Dumbbells"]},
    )
    recipe = client.post(
        "/recipes", headers=auth(user),
        json={"title": "Chickpea spinach curry", "servings": 2, "ingredients": [{"name": "chickpeas"}, {"name": "spinach"}],
              "steps": [{"text": "Cook."}], "tags": ["vegetarian"]},
    ).json()
    routine = client.post(
        "/routines", headers=auth(user),
        json={"name": "Dumbbell basics", "exercises": [{"name": "Goblet squat", "sets": 2, "reps": 10, "restSeconds": 30},
                                                       {"name": "Dumbbell row", "sets": 2, "reps": 10, "restSeconds": 30}]},
    ).json()
    return {"recipe": recipe["id"], "routine": routine["id"]}


def request(ids: dict[str, str], **overrides: Any) -> dict[str, Any]:
    body = {"startDate": MON, "days": 7, "mealSlots": ["evening"], "activityDays": 2, "minutesPerDay": 20,
            "recipeIds": [ids["recipe"]], "routineIds": [ids["routine"]]}
    body.update(overrides)
    return body


def meal(day: int, *, recipe=None, title="", idea=None, slot="evening", facts=()):  # type: ignore[no-untyped-def]
    return {"day": day, "slot": slot, "recipe": recipe, "title": title, "idea": idea, "facts": list(facts)}


def activity(day: int, *, routine=None, title="", minutes=None, idea=None, facts=()):  # type: ignore[no-untyped-def]
    return {"day": day, "routine": routine, "title": title, "minutes": minutes, "idea": idea, "facts": list(facts)}


def op(name: str, item=None, **fields: Any) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    base = {"op": name, "item": item, "day": None, "kind": None, "slot": None, "recipe": None, "routine": None,
            "title": None, "minutes": None, "idea": None}
    return {**base, **fields}


def change_calls(fake_ai) -> int:  # type: ignore[no-untyped-def]
    from app.planner import CHANGE_SCHEMA
    return sum(1 for c in fake_ai.calls if c["schema"] is CHANGE_SCHEMA)


def plan(client: TestClient, user: str = ALICE) -> list[dict[str, Any]]:
    return client.get("/plan", headers=auth(user), params={"start": MON, "days": 7}).json()["items"]


# --- unit rules -------------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Vegetarian tonight", "temporary"),
        ("Replace this meal with a vegetarian option", "temporary"),
        ("I'm vegetarian tonight", "temporary"),
        ("I'm vegetarian this week, so swap the meals", "temporary"),
        ("I only have 15 minutes tomorrow", "temporary"),
        ("I'm vegetarian now, so make Thursday's dinner meat-free", "lasting"),
        ("From now on I want short workouts", "lasting"),
        ("I don't eat pork", "lasting"),
        ("Move Thursday's workout to Saturday", "temporary"),
    ],
)
def test_persistence_rules(message: str, expected: str) -> None:
    assert persistence_of(message) == expected


def test_routine_minutes_estimate() -> None:
    assert routine_minutes([{"sets": 3, "reps": 10, "rest_seconds": 60}]) == 5  # 120 s work + 120 s rest + 20 s
    assert routine_minutes([{"sets": 1, "duration_seconds": 600}]) == 11


# --- proposals ----------------------------------------------------------------------------------

def test_proposal_is_grounded_validated_and_not_saved(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    fake_ai.proposal = {
        "meals": [
            meal(0, recipe="R1", title="ignored", facts=["F2", "F99"]),               # saved recipe; F99 is invented
            meal(1, title="Chicken stir fry", idea="Quick and tasty"),                 # conflicts with vegetarian
            meal(2, recipe="R7", title="Lentil soup", idea="Red lentils and carrots"), # unknown ref -> new idea
            meal(9, title="Out of range"),
        ],
        "activities": [
            activity(1, title="Chickpea spinach curry", minutes=20),                  # food posing as exercise: dropped
            activity(0, routine="A1", facts=["F3"]),
            activity(2, title="Barbell squats", minutes=35, idea="Heavy squats"),     # over limit, missing equipment
            activity(4, title="Kettlebell swings", minutes=15),                       # needs equipment not listed
            activity(5, title="Walk", minutes=15),                                    # beyond requested 2 activity days
        ],
    }
    response = client.post("/planner/proposals", headers=auth(), json=request(ids))
    assert response.status_code == 200
    proposal = response.json()
    items = proposal["items"]
    titles = [i["title"] for i in items]
    assert set(titles) == {"Chickpea spinach curry", "Chicken stir fry", "Lentil soup", "Dumbbell basics", "Kettlebell swings"}
    assert [i["kind"] for i in items if i["title"] == "Chickpea spinach curry"] == ["meal"] * 5  # Mon + 4 filled days
    assert len([i for i in items if i["kind"] == "activity"]) == 2  # squats (over the limit) left out; the walk is a 3rd
    curry = items[0]
    assert curry["recipeId"] == ids["recipe"] and "Dietary preference: Vegetarian" in curry["reasons"]
    assert all("F99" not in r for i in items for r in i["reasons"])  # invented fact dropped
    by_title = {i["title"]: i for i in items}
    assert any("vegetarian" in w for w in by_title["Chicken stir fry"]["warnings"])
    assert by_title["Lentil soup"]["recipeId"] is None and by_title["Lentil soup"]["idea"]
    assert by_title["Lentil soup"]["reasons"][0].startswith("New idea")
    assert "Left out “Barbell squats” (about 35 min) — longer than your 20-minute limit." in proposal["notes"]
    swings = by_title["Kettlebell swings"]
    assert swings["minutes"] == 15 and any("kettlebell" in w.lower() for w in swings["warnings"])
    basics = by_title["Dumbbell basics"]
    assert basics["minutes"] == routine_minutes([{"sets": 2, "reps": 10, "rest_seconds": 30}] * 2)
    assert "Time limit: 20 minutes per activity (this plan)" in basics["reasons"]
    filled = [i for i in items if i["reasons"][0] == "From the recipes you selected"]
    assert len(filled) == 4 and all("Dietary preference: Vegetarian" in i["reasons"] for i in filled)
    assert "Dietary preference: Vegetarian" in proposal["summary"]
    assert any("4 open slots filled" in n for n in proposal["notes"])
    assert [i["key"] for i in items] == [f"i{n}" for n in range(1, len(items) + 1)]
    assert plan(client) == []  # nothing saved by drafting


def test_proposal_fills_week_from_selections_and_respects_existing_plan(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    client.post("/plan", headers=auth(), json={"date": "2026-10-21", "kind": "meal", "title": "Dinner out", "timeSlot": "evening"})
    proposal = client.post("/planner/proposals", headers=auth(), json=request(ids, activityDays=3)).json()  # model proposes nothing
    meals = [i for i in proposal["items"] if i["kind"] == "meal"]
    assert len(meals) == 6 and "2026-10-21" not in {i["date"] for i in meals}  # Wednesday is already planned
    days = [i["date"] for i in proposal["items"] if i["kind"] == "activity"]
    assert days == [MON, THU, "2026-10-25"]  # spread across the week
    assert not any("Left open" in n for n in proposal["notes"])


def test_proposal_rejects_other_users_records(client: TestClient) -> None:
    alice = setup_user(client, ALICE)
    bob = setup_user(client, BOB)
    response = client.post("/planner/proposals", headers=auth(BOB), json=request(bob, recipeIds=[alice["recipe"]]))
    assert response.status_code == 404


# --- accept -------------------------------------------------------------------------------------

def accepted_items(ids: dict[str, str]) -> list[dict[str, Any]]:
    return [
        {"key": "i1", "date": MON, "kind": "meal", "title": "Chickpea spinach curry", "timeSlot": "evening", "recipeId": ids["recipe"]},
        {"key": "i2", "date": THU, "kind": "activity", "title": "Dumbbell basics", "routineId": ids["routine"], "minutes": 6},
        {"key": "i3", "date": "2026-10-20", "kind": "meal", "title": "Lentil soup (edited)", "timeSlot": "evening",
         "idea": "Red lentils, carrots, cumin"},
    ]


def test_accept_saves_once_even_when_repeated(client: TestClient) -> None:
    ids = setup_user(client)
    body = {"proposalId": "abc12345", "items": accepted_items(ids)}
    first = client.post("/planner/accept", headers=auth(), json=body).json()
    assert first["created"] == 3 and first["alreadySaved"] == 0
    second = client.post("/planner/accept", headers=auth(), json=body).json()  # double tap / retry
    assert second["created"] == 0 and second["alreadySaved"] == 3
    saved = plan(client)
    assert len(saved) == 3
    assert {i["source"] for i in saved} == {"planner"}
    assert next(i for i in saved if i["title"] == "Lentil soup (edited)")["note"] == "Red lentils, carrots, cumin"
    # Accepting one more item later adds only that item.
    more = client.post("/planner/accept", headers=auth(), json={"proposalId": "abc12345", "items": [
        {"key": "i4", "date": SAT, "kind": "activity", "title": "Walk", "minutes": 15}]}).json()
    assert more["created"] == 1 and len(plan(client)) == 4


def test_accept_is_all_or_nothing(client: TestClient) -> None:
    alice = setup_user(client, ALICE)
    bob = setup_user(client, BOB)
    items = accepted_items(bob)
    items[1]["routineId"] = alice["routine"]  # someone else's routine
    response = client.post("/planner/accept", headers=auth(BOB), json={"proposalId": "zzz12345", "items": items})
    assert response.status_code == 404
    assert plan(client, BOB) == [] and plan(client, ALICE) == []


def test_manual_add_with_client_key_is_idempotent(client: TestClient) -> None:
    body = {"date": MON, "kind": "meal", "title": "Leftovers", "clientKey": "manual-key-0001"}
    first = client.post("/plan", headers=auth(), json=body).json()
    second = client.post("/plan", headers=auth(), json=body).json()
    assert first["id"] == second["id"] and len(plan(client)) == 1
    # The same key from another user is independent.
    other = client.post("/plan", headers=auth(BOB), json=body).json()
    assert other["id"] != first["id"] and len(plan(client)) == 1


# --- conversational changes ---------------------------------------------------------------------

def seed_week(client: TestClient, ids: dict[str, str]) -> dict[str, str]:
    client.post("/planner/accept", headers=auth(), json={"proposalId": "seed1234", "items": [
        *accepted_items(ids),
        {"key": "i5", "date": "2026-10-21", "kind": "activity", "title": "Morning walk", "minutes": 20},
    ]})
    by_title = {i["title"]: i["id"] for i in plan(client)}
    client.patch(f"/plan/{by_title['Morning walk']}", headers=auth(), json={"status": "done"})
    return by_title


def change_body(message: str, **extra: Any) -> dict[str, Any]:
    return {"message": message, "today": MON, "startDate": MON, "days": 7, "scope": "plan", **extra}


def ref_of(client: TestClient, fake_ai, title: str) -> str:  # type: ignore[no-untyped-def]
    """The I-reference the planner gave an item in the prompt (items are listed in date order)."""
    titles = [i["title"] for i in plan(client)]
    return f"I{titles.index(title) + 1}"


def test_move_workout_preview_then_apply_once(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    by_title = seed_week(client, ids)
    before = {i["id"]: i for i in plan(client)}
    preview = client.post("/planner/changes", headers=auth(), json=change_body("Move Thursday's workout to Saturday.")).json()
    assert [c["description"] for c in preview["changes"]] == ["Move “Dumbbell basics” from Thu to Sat"]
    assert preview["rejected"] == [] and change_calls(fake_ai) == 0  # handled by rules, no model call
    assert preview["temporary"] is True and preview["preferenceSuggestion"] is None
    assert {i["id"]: i for i in plan(client)} == before  # preview saves nothing

    apply = {"changeSetId": preview["changeSetId"],
             "changes": [{"op": c["op"], "targetKey": c["targetKey"], "after": c["after"]} for c in preview["changes"]]}
    assert client.post("/plan/changes", headers=auth(), json=apply).json()["alreadyApplied"] is False
    assert client.post("/plan/changes", headers=auth(), json=apply).json()["alreadyApplied"] is True  # retry is a no-op
    after = {i["id"]: i for i in plan(client)}
    assert after[by_title["Dumbbell basics"]]["date"] == SAT
    assert after[by_title["Morning walk"]]["status"] == "done"  # completed activity preserved
    unrelated = [k for k in before if k != by_title["Dumbbell basics"]]
    assert all(after[k] == before[k] for k in unrelated)


def test_completed_items_are_never_changed(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    by_title = seed_week(client, ids)
    # Rule path: the only Wednesday workout is already done.
    preview = client.post("/planner/changes", headers=auth(), json=change_body("Move Wednesday's workout to Friday")).json()
    assert preview["changes"] == [] and preview["rejected"] == ["“Morning walk” is already done, so it was left as it is."]
    assert preview["summary"] == "Nothing could be changed."
    # Model path: the model tries to move both; only the planned one is offered.
    fake_ai.change = {"summary": "Swap them.", "persistence": "temporary", "lasting_preference": None, "operations": [
        op("move", ref_of(client, fake_ai, "Dumbbell basics"), day=2), op("move", ref_of(client, fake_ai, "Morning walk"), day=3)]}
    swapped = client.post("/planner/changes", headers=auth(), json=change_body("Swap my walk and my dumbbell session around")).json()
    assert [c["targetKey"] for c in swapped["changes"]] == [by_title["Dumbbell basics"]]
    assert swapped["rejected"] == ["“Morning walk” is already done, so it was left as it is."]


def test_apply_refuses_completed_items_and_other_users(client: TestClient) -> None:
    ids = setup_user(client)
    by_title = seed_week(client, ids)
    move_done = {"changeSetId": "set00001", "changes": [
        {"op": "move", "targetKey": by_title["Morning walk"], "after": {"date": SAT, "kind": "activity", "title": "Morning walk"}}]}
    assert client.post("/plan/changes", headers=auth(), json=move_done).status_code == 409
    remove_for_bob = {"changeSetId": "set00002", "changes": [{"op": "remove", "targetKey": by_title["Lentil soup (edited)"]}]}
    assert client.post("/plan/changes", headers=auth(BOB), json=remove_for_bob).status_code == 409
    assert len(plan(client)) == 4


def test_fifteen_minutes_tomorrow_swaps_in_a_saved_routine(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    client.post("/planner/accept", headers=auth(), json={"proposalId": "tmrw1234", "items": [
        {"key": "a", "date": "2026-10-20", "kind": "activity", "title": "Long ride", "minutes": 45},
        {"key": "b", "date": "2026-10-20", "kind": "meal", "title": "Chickpea spinach curry", "timeSlot": "evening", "recipeId": ids["recipe"]}]})
    before = {i["title"]: i for i in plan(client)}
    preview = client.post("/planner/changes", headers=auth(), json=change_body("I only have 15 minutes tomorrow.")).json()
    assert len(preview["changes"]) == 1 and change_calls(fake_ai) == 0  # the meal on the same day is untouched
    change = preview["changes"][0]
    assert change["before"]["title"] == "Long ride" and change["after"]["routineId"] == ids["routine"]
    assert change["after"]["minutes"] <= 15 and change["after"]["date"] == "2026-10-20"
    apply = {"changeSetId": preview["changeSetId"], "changes": [{"op": "replace", "targetKey": change["targetKey"], "after": change["after"]}]}
    client.post("/plan/changes", headers=auth(), json=apply)
    after = {i["title"]: i for i in plan(client)}
    assert "Long ride" not in after and after["Dumbbell basics"]["id"] == before["Long ride"]["id"]
    assert after["Chickpea spinach curry"] == before["Chickpea spinach curry"]


def test_model_changes_flag_time_limit(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    setup_user(client)
    client.post("/plan", headers=auth(), json={"date": "2026-10-20", "kind": "activity", "title": "Long ride", "minutes": 45})
    fake_ai.change = {"summary": "Shorter workout tomorrow.", "persistence": "temporary", "lasting_preference": None, "operations": [
        op("replace", "I1", title="Dumbbell circuit", minutes=25, idea="Squats, rows and presses")]}
    preview = client.post("/planner/changes", headers=auth(), json=change_body("Give me a shorter workout tomorrow, 15 minutes max")).json()
    change = preview["changes"][0]
    assert change["after"]["title"] == "Dumbbell circuit" and change_calls(fake_ai) == 1
    assert any("15 minutes" in w for w in change["warnings"])  # the model's 25 min is flagged, not hidden


def test_vegetarian_swap_uses_saved_recipe(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    chili = client.post("/plan", headers=auth(), json={"date": "2026-10-20", "kind": "meal", "title": "Beef chili", "timeSlot": "evening"}).json()
    client.post("/plan", headers=auth(), json={"date": "2026-10-20", "kind": "meal", "title": "Porridge", "timeSlot": "morning"})
    preview = client.post("/planner/changes", headers=auth(),
                          json=change_body("Replace this meal with a vegetarian option.", focusKey=chili["id"])).json()
    assert [c["description"] for c in preview["changes"]] == ["Replace “Beef chili” on Tue dinner with “Chickpea spinach curry”"]
    assert preview["changes"][0]["after"]["recipeId"] == ids["recipe"] and change_calls(fake_ai) == 0
    assert preview["temporary"] is True and preview["preferenceSuggestion"] is None


def test_drop_workout_removes_only_that_workout(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    by_title = seed_week(client, ids)
    preview = client.post("/planner/changes", headers=auth(), json=change_body("Drop Thursday's workout, I'm sore.")).json()
    assert [c["description"] for c in preview["changes"]] == ["Remove “Dumbbell basics” on Thu"]
    assert preview["changes"][0]["targetKey"] == by_title["Dumbbell basics"] and change_calls(fake_ai) == 0
    # A model that tries to remove a meal for a workout request is overruled.
    fake_ai.change = {"summary": "Rest.", "persistence": "temporary", "lasting_preference": None,
                      "operations": [op("remove", ref_of(client, fake_ai, "Lentil soup (edited)"))]}
    wrong = client.post("/planner/changes", headers=auth(), json=change_body("No exercise on Tuesday, I'm sore")).json()
    assert wrong["changes"] == []
    assert wrong["rejected"] == ["A suggested change to “Lentil soup (edited)” was left out because you asked about your activities."]


def test_every_dinner_vegetarian_swaps_only_conflicts(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    client.post("/plan", headers=auth(), json={"date": MON, "kind": "meal", "title": "Chicken tikka", "timeSlot": "evening"})
    client.post("/plan", headers=auth(), json={"date": THU, "kind": "meal", "title": "Chickpea spinach curry", "timeSlot": "evening",
                                               "recipeId": ids["recipe"]})
    preview = client.post("/planner/changes", headers=auth(), json=change_body("Make every dinner vegetarian this week")).json()
    assert [c["description"] for c in preview["changes"]] == ["Replace “Chicken tikka” on Mon dinner with “Chickpea spinach curry”"]
    assert preview["temporary"] is True and change_calls(fake_ai) == 0
    client.post("/plan/changes", headers=auth(), json={"changeSetId": preview["changeSetId"], "changes": [
        {"op": c["op"], "targetKey": c["targetKey"], "after": c["after"]} for c in preview["changes"]]})
    again = client.post("/planner/changes", headers=auth(), json=change_body("Make every dinner vegetarian this week")).json()
    assert again["changes"] == [] and "nothing needs to change" in again["summary"]


def test_model_edit_is_retargeted_and_checked_against_the_request(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    by_title = seed_week(client, ids)
    # The model points at the wrong item, but its own kind/day/slot describe exactly one planned meal.
    fake_ai.change = {"summary": "Tofu dinner.", "persistence": "temporary", "lasting_preference": None, "operations": [
        op("replace", ref_of(client, fake_ai, "Dumbbell basics"), kind="meal", day=1, slot="evening", title="Bean stew")]}
    preview = client.post("/planner/changes", headers=auth(), json=change_body("Swap Tuesday dinner for something with tofu")).json()
    change = preview["changes"][0]
    assert change["targetKey"] == by_title["Lentil soup (edited)"] and change["after"]["title"] == "Bean stew"
    assert change["warnings"] == ["Doesn't mention tofu — check it's what you asked for."]
    # Replacing a dish with itself is not a change.
    fake_ai.change["operations"] = [op("replace", ref_of(client, fake_ai, "Lentil soup (edited)"), title="lentil soup (edited)")]
    same = client.post("/planner/changes", headers=auth(), json=change_body("Swap Tuesday dinner for something with tofu")).json()
    assert same["changes"] == [] and same["summary"].startswith("I couldn't turn that into specific changes")


def test_temporary_instruction_is_not_remembered(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    ids = setup_user(client)
    seed_week(client, ids)
    fits = client.post("/planner/changes", headers=auth(), json=change_body("Vegetarian tonight")).json()
    assert fits["changes"] == [] and change_calls(fake_ai) == 0
    assert fits["summary"] == "“Chickpea spinach curry” on Monday 19 Oct has no obvious non-vegetarian ingredient, so nothing needs to change."
    assert fits["temporary"] is True and fits["preferenceSuggestion"] is None
    ask = "Vegetarian tonight, something with beans"
    fake_ai.change = {"summary": "Vegetarian dinner.", "persistence": "lasting",  # model wrongly says lasting
                      "lasting_preference": "I am vegetarian.", "operations": [
                          op("replace", ref_of(client, fake_ai, "Lentil soup (edited)"), title="Bean chili")]}
    wrong_day = client.post("/planner/changes", headers=auth(), json=change_body(ask)).json()
    assert wrong_day["changes"] == []  # the model edited Tuesday; "tonight" is Monday
    assert wrong_day["rejected"] == ["A suggested change to Tuesday 20 Oct was left out because you asked about Monday 19 Oct."]
    fake_ai.change["operations"] = [op("replace", ref_of(client, fake_ai, "Chickpea spinach curry"), title="Beef burger", day=4),
                                    op("remove", ref_of(client, fake_ai, "Dumbbell basics"))]  # not what was asked about
    preview = client.post("/planner/changes", headers=auth(), json=change_body(ask)).json()
    assert len(preview["changes"]) == 1
    assert preview["temporary"] is True and preview["preferenceSuggestion"] is None
    assert preview["changes"][0]["after"]["date"] == MON  # a replacement stays on its day
    assert any("vegetarian" in w for w in preview["changes"][0]["warnings"])  # beef flagged
    # Lasting, but the profile already says vegetarian: nothing new to remember.
    known = client.post("/planner/changes", headers=auth(), json=change_body("I'm vegetarian now, change Tuesday's dinner")).json()
    assert known["temporary"] is False and known["preferenceSuggestion"] is None
    assert known["changes"][0]["after"]["title"] == "Chickpea spinach curry"
    fake_ai.change = {"summary": "No mushrooms.", "persistence": "lasting", "lasting_preference": "I don't eat mushrooms",
                      "operations": []}
    lasting = client.post("/planner/changes", headers=auth(), json=change_body("From now on, no mushrooms in my dinners")).json()
    assert lasting["temporary"] is False and lasting["preferenceSuggestion"] == "I don't eat mushrooms."
    # Offering is all that happens: nothing is remembered until the user confirms through /preferences.
    assert client.get("/preferences", headers=auth()).json()["preferences"] == []


def test_proposal_scope_changes_use_draft_items(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    setup_user(client)
    draft = [{"key": "i1", "date": THU, "kind": "activity", "title": "Dumbbell basics", "minutes": 6},
             {"key": "i2", "date": MON, "kind": "meal", "title": "Pasta", "timeSlot": "evening"}]
    preview = client.post("/planner/changes", headers=auth(),
                          json=change_body("Move Thursday's workout to Saturday", scope="proposal", draftItems=draft)).json()
    assert preview["changes"][0]["targetKey"] == "i1" and preview["changes"][0]["after"]["date"] == SAT
    assert plan(client) == []


# --- AI unavailable --------------------------------------------------------------------------------

def test_planning_without_ai(client: TestClient) -> None:
    from app.deps import get_ai, get_ai_optional
    from app.main import app

    app.dependency_overrides.pop(get_ai)
    app.dependency_overrides.pop(get_ai_optional)
    app.state.ai, app.state.ai_unavailable_reason = None, "AI isn't configured on the server (set AI_PROVIDER in backend/.env)."
    ids = setup_user(client)
    # Drafting falls back to the user's selections, and says so; with nothing selected there is nothing to draft.
    proposal = client.post("/planner/proposals", headers=auth(), json=request(ids))
    assert proposal.status_code == 200
    body = proposal.json()
    assert body["notes"][0].startswith("Automatic suggestions are unavailable")
    assert {i["title"] for i in body["items"]} == {"Chickpea spinach curry", "Dumbbell basics"}
    empty = client.post("/planner/proposals", headers=auth(), json=request(ids, recipeIds=[], routineIds=[]))
    assert empty.status_code == 503 and "plan it manually" in empty.json()["detail"]
    # Manual planning works as usual.
    added = client.post("/plan", headers=auth(), json={"date": THU, "kind": "activity", "title": "Dumbbell basics",
                                                       "routineId": ids["routine"], "clientKey": "manual-0000001"})
    assert added.status_code == 201
    # Common requests are handled by rules; anything else explains what works.
    moved = client.post("/planner/changes", headers=auth(), json=change_body("Move Thursday's workout to Saturday")).json()
    assert moved["changes"][0]["after"]["date"] == SAT
    other = client.post("/planner/changes", headers=auth(), json=change_body("Make the week more fun"))
    assert other.status_code == 503 and "Move Thursday" in other.json()["detail"]
    vegan = client.post("/planner/changes", headers=auth(), json=change_body("Vegan tonight please")).json()
    assert [c["description"] for c in vegan["changes"]] == ["Add “Chickpea spinach curry” on Mon dinner"]
    assert vegan["changes"][0]["warnings"] == ["“Chickpea spinach curry” isn't tagged vegan — check the ingredients."]
    assert vegan["temporary"] is True
    assert client.get("/review/week", headers=auth(), params={"end": "2026-10-25"}).status_code == 200


def test_ai_failure_falls_back_to_selections(client: TestClient, fake_ai) -> None:  # type: ignore[no-untyped-def]
    from app.ai import AIError

    ids = setup_user(client)
    fake_ai.error = AIError("timeout", "The AI service took too long to respond.")
    proposal = client.post("/planner/proposals", headers=auth(), json=request(ids)).json()
    assert proposal["notes"][0].startswith("Automatic suggestions failed") and len(proposal["items"]) == 9
    empty = client.post("/planner/proposals", headers=auth(), json=request(ids, recipeIds=[], routineIds=[]))
    assert empty.status_code == 504


# --- weekly review ---------------------------------------------------------------------------------

def test_weekly_review_uses_records_and_separates_missing_data(client: TestClient) -> None:
    accepted = client.post("/planner/accept", headers=auth(), json={"proposalId": "rev12345", "items": [
        {"key": "a", "date": MON, "kind": "activity", "title": "Walk", "minutes": 20},
        {"key": "b", "date": "2026-10-20", "kind": "activity", "title": "Dumbbells", "minutes": 20},
        {"key": "c", "date": "2026-10-21", "kind": "activity", "title": "Yoga", "minutes": 20},
        {"key": "d", "date": MON, "kind": "meal", "title": "Curry", "timeSlot": "evening"}]}).json()
    ids = {i["title"]: i["id"] for i in accepted["items"]}
    client.patch(f"/plan/{ids['Walk']}", headers=auth(), json={"status": "done"})
    client.patch(f"/plan/{ids['Dumbbells']}", headers=auth(), json={"status": "skipped"})
    client.post("/sessions", headers=auth(), json={
        "routineName": "Walk", "localDate": MON, "startedAt": "2026-10-19T07:00:00Z", "finishedAt": "2026-10-19T07:20:00Z",
        "entries": [{"name": "Walk", "sets": [{"durationSeconds": 1200}]}]})
    client.put("/checkins/2026-10-19", headers=auth(), json={"energy": 4, "mood": 3})
    client.put("/checkins/2026-10-23", headers=auth(), json={"energy": 2, "mood": 4})  # check-in only: zero activity

    review = client.get("/review/week", headers=auth(), params={"end": "2026-10-25"}).json()
    t = review["totals"]
    assert (t["sessions"], t["activeMinutes"], t["doneActivities"], t["skippedActivities"], t["openActivities"]) == (1, 20, 1, 1, 1)
    assert t["checkInDays"] == 2 and t["daysWithoutRecords"] == 3  # Thu 22, Sat 24 and Sun 25 have nothing
    text = " ".join(review["observations"])
    assert "Thu, Sat, Sun — that's missing data" in text
    assert "No activity was logged on" in text and "Fri" in text
    assert "1 done, 1 skipped, 1 not marked" in text
    assert {a["id"] for a in review["adjustments"]} >= {"shorter"}
    assert all("because" not in o.lower() for o in review["observations"])  # no invented reasons
    assert client.get("/review/week", headers=auth(BOB), params={"end": "2026-10-25"}).json()["totals"]["daysWithoutRecords"] == 7
