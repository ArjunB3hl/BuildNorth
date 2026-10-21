"""Apple Watch: link tokens, the watch's data routes, health days and their Agent Memory mirror.

Same setup as the API tests (mocked Clerk keys, fake Agent Memory, fake AI, real migrated SQLite).
All health values are fictional.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from surrealdb.memory import MemoryAPIError

from app import health, user_context
from app import preferences as prefs
from app.deps import get_memory
from app.main import app
from app.mcp_auth import hash_token
from app.memory import MemoryService, preference_scope
from app.models import CheckIn, HealthDay, MemoryTombstone, Profile, WatchToken
from app.routers import watch as watch_routes
from conftest import ALICE, ALICE_SCOPE, BOB, BOB_SCOPE, ISSUER, SIGNING_KEY, auth, make_token

DAY = "2026-10-20"
TODAY = "2026-10-21"
# The contract's example day and the exact sentence mirrored for it.
SPEC_DAY: dict[str, Any] = {
    "sleepMinutes": 412, "restingHeartRateBpm": 58, "hrvSdnnMs": 42.5, "steps": 8412, "activeEnergyKcal": 510.2,
    "workouts": [{"externalId": "HK-UUID", "activityType": "running", "startedAt": "2026-10-20T07:12:00Z",
                  "durationMinutes": 32.0, "energyKcal": 310.0, "distanceMeters": 5100.0, "averageHeartRateBpm": 148.0}],
    "complete": True,
}
SPEC_TEXT = ("Apple Watch daily summary for 2026-10-20 (device-measured): slept 6 h 52 min; resting heart rate 58 bpm; "
             "HRV 42 ms; 8,412 steps; 510 kcal active energy; workouts: 32 min running.")


def link(client: TestClient, user: str = ALICE, label: str | None = None) -> dict[str, Any]:
    response = client.post("/watch/tokens", headers=auth(user), json={} if label is None else {"label": label})
    assert response.status_code == 201, response.text
    return response.json()


def bearer(token: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {token['token']}"}


def share(client: TestClient, on: bool = True, user: str = ALICE) -> None:
    response = client.put("/watch/settings", headers=auth(user), json={"shareHealth": on})
    assert response.status_code == 200 and response.json() == {"shareHealth": on}


def upload(client: TestClient, headers: dict[str, str], day: str = DAY, **changes: Any) -> dict[str, Any]:
    response = client.put(f"/watch/health/{day}", headers=headers, json={**SPEC_DAY, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def health_records(memory_client, scope: str = ALICE_SCOPE) -> list[tuple[str, str]]:  # type: ignore[no-untyped-def]
    return [(t, s[0][0]) for t, s in memory_client.records if s[0][0].startswith(scope + "/health/")]


def stored_day(client: TestClient, headers: dict[str, str], day: str = DAY) -> dict[str, Any]:
    days = client.get("/watch/health", headers=headers, params={"end": day, "days": 1}).json()["days"]
    assert len(days) == 1
    return days[0]


def gather(user: str, request: str, memory_client, on: str = TODAY) -> user_context.UserContext:  # type: ignore[no-untyped-def]
    with app.state.session_factory() as db:
        return user_context.gather(db, MemoryService(memory_client), user, request, on=date.fromisoformat(on))


def set_token(token_id: str, **values: Any) -> None:
    with app.state.session_factory() as db:
        row = db.get(WatchToken, token_id)
        for k, v in values.items():
            setattr(row, k, v)
        db.commit()


def tombstones(user: str = ALICE) -> list[tuple[str, str | None]]:
    with app.state.session_factory() as db:
        return [(t.scope, t.text) for t in db.scalars(select(MemoryTombstone).where(MemoryTombstone.user_id == user))]


def lands_then_fails(real):  # type: ignore[no-untyped-def]
    """A memory write that is stored but still reports an error (e.g. a read timeout after the request was sent)."""

    def remember(text: str | None = None, **kwargs: Any) -> None:
        real(text, **kwargs)
        raise MemoryAPIError(0, "Connection failed")

    return remember


def in_flight(real, during: Callable[[], None], after: Callable[[], None] | None = None):  # type: ignore[no-untyped-def]
    """A memory write that is still in flight while `during` runs (e.g. the phone turns sharing off), then lands.
    `after` runs once it has landed. Only the first write is affected."""
    calls: list[int] = []

    def remember(text: str | None = None, **kwargs: Any) -> None:
        first = not calls
        calls.append(1)
        if first:
            during()
        real(text, **kwargs)
        if first and after:
            after()

    return remember


def row_mirror(user: str = ALICE) -> tuple[str, str | None, str | None]:
    with app.state.session_factory() as db:
        row = db.scalar(select(HealthDay).where(HealthDay.user_id == user))
        return row.memory_status, row.memory_scope, row.memory_text


def sharing_off_elsewhere(memory_client) -> Callable[[], None]:  # type: ignore[no-untyped-def]
    """The phone's PUT /watch/settings false, committed and applied in its own session."""

    def run() -> None:
        with app.state.session_factory() as other:
            other.get(Profile, ALICE).share_health = False
            other.commit()
            health.apply_sharing(other, MemoryService(memory_client), ALICE)

    return run


def oauth_access_token(typ: str = "at+jwt", **claims: Any) -> str:
    """A Clerk OAuth access token for Alice, as an assistant gets one: same issuer and keys, here without `aud`."""
    now = int(time.time())
    payload = {"sub": ALICE, "iss": ISSUER, "iat": now, "exp": now + 600, "client_id": "https://chatgpt.com/oauth/client.json",
               "scope": "email profile", **claims}
    return jwt.encode({k: v for k, v in payload.items() if v is not None}, SIGNING_KEY, algorithm="RS256",
                      headers={"kid": "test-kid", "typ": typ})


# --- link tokens -------------------------------------------------------------------------------

def test_token_is_shown_once_and_stored_only_as_a_hash(client: TestClient) -> None:
    created = link(client)
    assert set(created) == {"id", "label", "hint", "createdAt", "expiresAt", "token"}
    assert created["label"] == "Apple Watch" and created["token"].startswith("bnw_") and created["hint"] == created["token"][-4:]
    lifetime = datetime.fromisoformat(created["expiresAt"]) - datetime.fromisoformat(created["createdAt"])
    assert lifetime == timedelta(days=90)
    listed = client.get("/watch/tokens", headers=auth()).json()["tokens"]
    assert [set(t) for t in listed] == [{"id", "label", "hint", "createdAt", "expiresAt", "lastUsedAt", "revoked"}]
    assert listed[0]["revoked"] is False and listed[0]["lastUsedAt"] is None
    with app.state.session_factory() as db:
        row = db.get(WatchToken, created["id"])
        assert row.token_hash == hash_token(created["token"]) and created["token"] not in (row.token_hash, row.hint)
    # No body at all is fine too (the default label), and Bob never sees Alice's links.
    assert client.post("/watch/tokens", headers=auth()).status_code == 201
    assert client.get("/watch/tokens", headers=auth(BOB)).json() == {"tokens": []}


def test_relinking_rotates_the_token_and_at_most_five_watches_link(client: TestClient) -> None:
    first = link(client, label="Fictional wrist")
    second = link(client, label="Fictional wrist")
    assert client.get("/watch/today", headers=bearer(first), params={"date": DAY}).status_code == 401
    assert client.get("/watch/today", headers=bearer(second), params={"date": DAY}).status_code == 200
    others = [link(client, label=f"Watch {i}") for i in range(4)]  # five active now
    full = client.post("/watch/tokens", headers=auth(), json={"label": "One too many"})
    assert full.status_code == 409 and full.json()["detail"] == "You can link up to 5 watches."
    link(client, label="Watch 0")  # the same label replaces its token, so it still fits
    assert client.get("/watch/today", headers=bearer(others[0]), params={"date": DAY}).status_code == 401
    set_token(others[1]["id"], expires_at=datetime.now(UTC) - timedelta(seconds=1))  # expired links don't count
    newest = link(client, label="Sixth")
    tokens = client.get("/watch/tokens", headers=auth()).json()["tokens"]
    assert tokens[0]["id"] == newest["id"]  # newest first, revoked ones included
    assert len(tokens) == 8 and sum(t["revoked"] for t in tokens) == 2


def test_revoke_one_and_revoke_all(client: TestClient) -> None:
    one, two = link(client, label="One"), link(client, label="Two")
    assert client.delete(f"/watch/tokens/{one['id']}", headers=auth(BOB)).status_code == 404  # not Bob's
    assert client.delete("/watch/tokens/not-a-token", headers=auth()).status_code == 404
    for _ in range(2):  # idempotent
        assert client.delete(f"/watch/tokens/{one['id']}", headers=auth()).status_code == 204
    assert client.get("/watch/today", headers=bearer(one), params={"date": DAY}).status_code == 401
    assert client.get("/watch/today", headers=bearer(two), params={"date": DAY}).status_code == 200
    bob = link(client, BOB)
    assert client.delete("/watch/tokens", headers=auth()).status_code == 204
    assert client.get("/watch/today", headers=bearer(two), params={"date": DAY}).status_code == 401
    assert all(t["revoked"] for t in client.get("/watch/tokens", headers=auth()).json()["tokens"])
    assert client.get("/watch/today", headers=bearer(bob), params={"date": DAY}).status_code == 200  # Bob unaffected
    link(client, label="One")  # linking again works


def test_revoked_expired_and_unknown_watch_tokens_are_refused(client: TestClient) -> None:
    revoked = link(client, label="Revoked")
    client.delete(f"/watch/tokens/{revoked['id']}", headers=auth())
    expired = link(client, label="Expired")
    set_token(expired["id"], expires_at=datetime.now(UTC) - timedelta(minutes=1))
    unknown = {"token": "bnw_" + "x" * 43}
    for token in (revoked, expired, unknown):
        for method, path, body in (("GET", "/watch/today?date=2026-10-20", None), ("PUT", f"/watch/health/{DAY}", SPEC_DAY)):
            response = client.request(method, path, headers=bearer(token), json=body)
            assert response.status_code == 401 and response.json()["detail"] == "Watch link is invalid or revoked."
    assert client.get("/watch/today", params={"date": DAY}).status_code == 401  # no credentials at all
    with app.state.session_factory() as db:
        assert db.scalars(select(HealthDay)).all() == []


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/profile", None),
        ("PUT", "/profile", {"preferredName": "Hijacked"}),
        ("GET", "/preferences", None),
        ("DELETE", "/memory", None),
        ("GET", "/connections", None),
        ("POST", "/connections/tokens", {"label": "From a watch"}),
        ("DELETE", "/account/data", None),
        ("GET", "/today?date=2026-10-20", None),
        ("PUT", "/checkins/2026-10-20", {"energy": 3, "mood": 3}),
        ("POST", "/watch/tokens", {"label": "From a watch"}),
        ("GET", "/watch/tokens", None),
        ("DELETE", "/watch/tokens", None),
        ("GET", "/watch/settings", None),
        ("PUT", "/watch/settings", {"shareHealth": True}),
    ],
)
def test_watch_token_is_refused_outside_the_watch_data_routes(client: TestClient, method: str, path: str, body: Any) -> None:
    client.put("/profile", headers=auth(), json={"preferredName": "Fictional Alice"})
    token = link(client)
    assert client.request(method, path, headers=bearer(token), json=body).status_code == 401
    assert client.get("/profile", headers=auth()).json()["preferredName"] == "Fictional Alice"  # nothing changed or deleted
    assert client.get("/watch/today", headers=bearer(token), params={"date": DAY}).status_code == 200  # still linked
    assert client.get("/watch/settings", headers=auth()).json() == {"shareHealth": False}


@pytest.mark.parametrize(
    "token",
    [
        lambda: oauth_access_token(),                                                   # RFC 9068 typ
        lambda: oauth_access_token(typ="application/at+jwt", client_id=None),           # the long typ, even without client_id
        lambda: make_token(ALICE, client_id="https://chatgpt.com/oauth/client.json"),   # typ JWT, but an OAuth client's claims
    ],
)
def test_oauth_access_tokens_never_pass_as_the_app_session(client: TestClient, token: Callable[[], str]) -> None:
    share(client)
    upload(client, auth())
    headers = {"Authorization": f"Bearer {token()}"}
    for method, path, body in (("PUT", "/watch/settings", {"shareHealth": False}), ("POST", "/watch/tokens", {"label": "Assistant"}),
                               ("GET", f"/watch/health?end={DAY}", None)):
        response = client.request(method, path, headers=headers, json=body)
        assert response.status_code == 401 and response.json()["detail"] == "Invalid session token.", path
    assert client.get("/watch/settings", headers=auth()).json() == {"shareHealth": True}  # nothing changed
    assert client.get("/watch/tokens", headers=auth()).json() == {"tokens": []}


def test_watch_data_routes_take_a_watch_token_or_the_phone_session(client: TestClient) -> None:
    item = client.post("/plan", headers=auth(), json={"date": DAY, "kind": "activity", "title": "Fictional walk"}).json()
    for headers in (bearer(link(client)), auth()):
        assert client.get("/watch/today", headers=headers, params={"date": DAY}).status_code == 200
        assert client.patch(f"/watch/plan/{item['id']}", headers=headers, json={"status": "done"}).status_code == 200
        assert client.patch(f"/watch/checkins/{DAY}", headers=headers, json={"energy": 3, "mood": 3}).status_code == 200
        assert client.put(f"/watch/health/{DAY}", headers=headers, json=SPEC_DAY).status_code == 200
        assert client.get("/watch/health", headers=headers, params={"end": DAY}).status_code == 200


def test_last_use_is_recorded_at_most_every_ten_minutes(client: TestClient) -> None:
    token = link(client)

    def last_used() -> datetime | None:
        with app.state.session_factory() as db:
            return db.get(WatchToken, token["id"]).last_used_at

    client.get("/watch/today", headers=bearer(token), params={"date": DAY})
    first = last_used()
    assert first is not None
    client.get("/watch/today", headers=bearer(token), params={"date": DAY})
    assert last_used() == first
    set_token(token["id"], last_used_at=datetime.now(UTC) - timedelta(minutes=11))
    client.get("/watch/today", headers=bearer(token), params={"date": DAY})
    assert last_used() > first
    assert client.get("/watch/tokens", headers=auth()).json()["tokens"][0]["lastUsedAt"] is not None


# --- today, plan and check-ins -----------------------------------------------------------------

def test_watch_plan_status_follows_the_app_rules_and_stays_owner_scoped(client: TestClient) -> None:
    item = client.post("/plan", headers=auth(), json={"date": DAY, "kind": "activity", "title": "Fictional walk",
                                                      "timeSlot": "morning"}).json()
    alice, bob = bearer(link(client)), bearer(link(client, BOB))
    today = client.get("/watch/today", headers=alice, params={"date": DAY}).json()
    assert set(today) == {"date", "items", "checkIn", "health", "shareHealth"}
    assert [i["id"] for i in today["items"]] == [item["id"]] and today["checkIn"] is None and today["health"] is None
    assert today["shareHealth"] is False

    done = client.patch(f"/watch/plan/{item['id']}", headers=alice, json={"status": "done"}).json()
    assert done["status"] == "done" and done["completedAt"]
    skipped = client.patch(f"/watch/plan/{item['id']}", headers=alice, json={"status": "skipped"}).json()
    assert skipped["status"] == "skipped" and skipped["completedAt"] is None
    assert client.patch(f"/watch/plan/{item['id']}", headers=alice, json={"status": "finished"}).status_code == 422
    assert client.patch(f"/watch/plan/{item['id']}", headers=alice, json={"status": "done", "date": TODAY}).status_code == 422

    assert client.patch(f"/watch/plan/{item['id']}", headers=bob, json={"status": "done"}).status_code == 404
    assert client.get("/watch/today", headers=bob, params={"date": DAY}).json()["items"] == []
    assert client.get("/today", headers=auth(), params={"date": DAY}).json()["items"][0]["status"] == "skipped"
    assert client.get("/watch/today", headers=alice, params={"date": "2026-02-30"}).status_code == 422


def test_watch_checkin_merges_and_keeps_what_the_phone_saved(client: TestClient) -> None:
    client.put(f"/checkins/{DAY}", headers=auth(), json={"energy": 3, "mood": 4, "sleepHours": 7.5, "note": "Fictional phone note"})
    alice = bearer(link(client))
    merged = client.patch(f"/watch/checkins/{DAY}", headers=alice, json={"energy": 2})
    assert merged.status_code == 200
    assert merged.json() == {"date": DAY, "energy": 2, "mood": 4, "sleepHours": 7.5, "note": "Fictional phone note"}
    cleared = client.patch(f"/watch/checkins/{DAY}", headers=alice, json={"sleepHours": None}).json()
    assert cleared["sleepHours"] is None and cleared["note"] == "Fictional phone note" and cleared["energy"] == 2
    for bad in ({"energy": None}, {"mood": 6}, {"energy": 3, "userId": BOB}, {"note": "x" * 1001}):
        assert client.patch(f"/watch/checkins/{DAY}", headers=alice, json=bad).status_code == 422, bad
    assert client.patch("/watch/checkins/not-a-date", headers=alice, json={"energy": 3}).status_code == 422

    new_day = client.patch(f"/watch/checkins/{TODAY}", headers=alice, json={"energy": 4})
    assert new_day.status_code == 422  # a new day needs energy and mood
    created = client.patch(f"/watch/checkins/{TODAY}", headers=alice, json={"energy": 4, "mood": 3, "sleepHours": 6.5}).json()
    assert created == {"date": TODAY, "energy": 4, "mood": 3, "sleepHours": 6.5, "note": None}
    assert client.get("/today", headers=auth(), params={"date": TODAY}).json()["checkIn"]["sleepHours"] == 6.5

    bob = bearer(link(client, BOB))
    assert client.patch(f"/watch/checkins/{DAY}", headers=bob, json={"energy": 5, "mood": 5}).json()["energy"] == 5
    assert client.get("/today", headers=auth(), params={"date": DAY}).json()["checkIn"]["energy"] == 2  # Alice's untouched


def test_watch_checkin_merges_into_a_check_in_created_at_the_same_moment(client: TestClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    alice = bearer(link(client))
    real = watch_routes._checkin
    calls: list[str] = []

    def racing(db, user_id: str, day: str):  # type: ignore[no-untyped-def]
        calls.append(day)
        if len(calls) == 1:
            # The phone saves this day's check-in between the watch's lookup and its insert.
            with app.state.session_factory() as other:
                other.add(CheckIn(user_id=user_id, date=day, energy=3, mood=3, note="Fictional phone note"))
                other.commit()
            return None
        return real(db, user_id, day)

    monkeypatch.setattr(watch_routes, "_checkin", racing)
    response = client.patch(f"/watch/checkins/{DAY}", headers=alice, json={"energy": 5, "mood": 4})
    assert response.status_code == 200, response.text
    assert response.json() == {"date": DAY, "energy": 5, "mood": 4, "sleepHours": None, "note": "Fictional phone note"}
    assert len(calls) == 2
    with app.state.session_factory() as db:
        assert len(db.scalars(select(CheckIn).where(CheckIn.user_id == ALICE)).all()) == 1


# --- health days ---------------------------------------------------------------------------------

def test_health_text_is_one_deterministic_sentence_without_missing_values() -> None:
    def text(**values: Any) -> str | None:
        fields = {"date": DAY, "sleep_minutes": None, "resting_heart_rate_bpm": None, "hrv_sdnn_ms": None, "steps": None,
                  "active_energy_kcal": None, "workouts": [], "complete": True, "source": "apple_watch"}
        return health.memory_text(HealthDay(**{**fields, **values}))

    workout = {"external_id": "HK-UUID", "activity_type": "running", "started_at": "2026-10-20T07:12:00Z",
               "duration_minutes": 32.0, "energy_kcal": 310.0, "distance_meters": 5100.0, "average_heart_rate_bpm": 148.0}
    assert text(sleep_minutes=412, resting_heart_rate_bpm=58, hrv_sdnn_ms=42.5, steps=8412, active_energy_kcal=510.2,
                workouts=[workout]) == SPEC_TEXT
    assert text(steps=0) == "Apple Watch daily summary for 2026-10-20 (device-measured): 0 steps."
    assert text(sleep_minutes=420, hrv_sdnn_ms=None) == "Apple Watch daily summary for 2026-10-20 (device-measured): slept 7 h."
    assert text() is None  # nothing measured: nothing to mirror
    many = [{**workout, "external_id": f"w{i}", "activity_type": "traditional_strength_training"} for i in range(20)]
    long = text(sleep_minutes=412, steps=8412, workouts=many)
    assert long is not None and len(long) <= 500 and "traditional strength training" in long and "more." in long


def test_health_upload_is_an_idempotent_upsert(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    alice = bearer(link(client))
    first = upload(client, alice)
    assert set(first) == {"date", "sleepMinutes", "restingHeartRateBpm", "hrvSdnnMs", "steps", "activeEnergyKcal", "workouts",
                          "complete", "source", "memoryStatus", "updatedAt"}
    assert first["workouts"] == SPEC_DAY["workouts"] and first["source"] == "apple_watch"
    assert first["memoryStatus"] == "not_mirrored"  # sharing is off by default
    upload(client, alice)
    days = client.get("/watch/health", headers=alice, params={"end": TODAY}).json()["days"]
    assert [d["date"] for d in days] == [DAY] and days[0]["sleepMinutes"] == 412
    with app.state.session_factory() as db:
        assert len(db.scalars(select(HealthDay)).all()) == 1
    # A PUT replaces the day: metrics left out are missing (null), and a workout sent twice is kept once.
    replaced = upload(client, alice, hrvSdnnMs=None, steps=None, workouts=SPEC_DAY["workouts"] * 2)
    assert replaced["hrvSdnnMs"] is None and replaced["steps"] is None and len(replaced["workouts"]) == 1
    # Health workouts are not activity sessions (no double counting in progress).
    assert client.get("/sessions", headers=auth()).json() == []
    assert memory_client.records == []


def test_health_upload_updates_a_day_created_at_the_same_moment(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    real = watch_routes._health_day
    calls: list[str] = []

    def racing(db, user_id: str, day: str):  # type: ignore[no-untyped-def]
        calls.append(day)
        if len(calls) == 1:
            # Another upload of the same day inserts it between this request's lookup and its insert.
            with app.state.session_factory() as other:
                other.add(HealthDay(user_id=user_id, date=day, steps=1, workouts=[], complete=False))
                other.commit()
            return None
        return real(db, user_id, day)

    monkeypatch.setattr(watch_routes, "_health_day", racing)
    saved = upload(client, alice)
    assert len(calls) == 2
    assert saved["steps"] == 8412 and saved["complete"] is True and saved["memoryStatus"] == "synced"
    with app.state.session_factory() as db:
        [row] = db.scalars(select(HealthDay).where(HealthDay.user_id == ALICE)).all()  # one row, this upload's values
        assert row.steps == 8412 and row.sleep_minutes == 412 and row.complete is True and len(row.workouts) == 1
    assert [t for t, _ in health_records(memory_client)] == [SPEC_TEXT]


def test_health_input_is_validated(client: TestClient) -> None:
    alice = bearer(link(client))
    workout = SPEC_DAY["workouts"][0]
    for bad in ({"heartRate": 60}, {"userId": BOB}, {"steps": -1}, {"sleepMinutes": 1441}, {"restingHeartRateBpm": 10},
                {"hrvSdnnMs": 501}, {"workouts": [workout] * 21}, {"workouts": [{**workout, "activityType": "Run!"}]},
                {"workouts": [{**workout, "source": "x"}]}, {"workouts": [{k: v for k, v in workout.items() if k != "startedAt"}]}):
        assert client.put(f"/watch/health/{DAY}", headers=alice, json={**SPEC_DAY, **bad}).status_code == 422, bad
    assert client.put("/watch/health/2026-02-30", headers=alice, json=SPEC_DAY).status_code == 422
    assert client.get("/watch/health", headers=alice, params={"end": DAY, "days": 32}).status_code == 422
    assert client.get("/watch/health", headers=alice, params={"end": DAY, "days": 0}).status_code == 422
    assert client.get("/watch/health", headers=alice).status_code == 422  # the client says which day it is
    capitalised = upload(client, alice, workouts=[{**workout, "activityType": "Running"}])
    assert capitalised["workouts"][0]["activityType"] == "running"


def test_health_days_are_owner_scoped(client: TestClient) -> None:
    alice, bob = bearer(link(client)), bearer(link(client, BOB))
    upload(client, alice)
    assert client.get("/watch/health", headers=bob, params={"end": DAY}).json()["days"] == []
    assert client.get("/watch/today", headers=bob, params={"date": DAY}).json()["health"] is None
    upload(client, bob, steps=1)
    assert stored_day(client, alice)["steps"] == 8412 and stored_day(client, bob)["steps"] == 1


def test_mirrored_only_while_shared_and_only_complete_days(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    alice = bearer(link(client))
    upload(client, alice)
    assert client.get("/watch/settings", headers=auth()).json() == {"shareHealth": False}
    assert memory_client.records == []
    share(client)  # turning sharing on mirrors the complete days already stored
    [(text, scope)] = health_records(memory_client)
    assert text == SPEC_TEXT and scope.startswith(ALICE_SCOPE + "/health/") and stored_day(client, alice)["memoryStatus"] == "synced"
    assert client.get("/watch/today", headers=alice, params={"date": DAY}).json()["shareHealth"] is True

    today = upload(client, alice, day=TODAY, complete=False, steps=3000)
    assert today["memoryStatus"] == "not_mirrored"  # the day isn't over yet
    empty = client.put("/watch/health/2026-10-19", headers=alice, json={"workouts": [], "complete": True}).json()
    assert empty["memoryStatus"] == "not_mirrored"  # nothing measured
    assert len(health_records(memory_client)) == 1
    finished = upload(client, alice, day=TODAY, complete=True, steps=3000)
    assert finished["memoryStatus"] == "synced" and len(health_records(memory_client)) == 2
    assert health_records(memory_client, BOB_SCOPE) == []  # nothing in Bob's subtree


def test_changed_day_erases_the_old_revision_and_writes_a_new_scope(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    [(_, old_scope)] = health_records(memory_client)
    upload(client, alice, steps=9000)
    [(text, new_scope)] = health_records(memory_client)
    assert old_scope in memory_client.forgets and new_scope != old_scope and "9,000 steps" in text
    assert new_scope.startswith(ALICE_SCOPE + "/health/")
    forgets = list(memory_client.forgets)
    upload(client, alice, steps=9000)  # the same upload again changes nothing in memory
    assert memory_client.forgets == forgets and len(health_records(memory_client)) == 1

    # If memory is down while the day changes, the old revision is tombstoned and never recalled meanwhile.
    memory_client.down = True
    assert upload(client, alice, steps=10000)["memoryStatus"] == "pending"
    memory_client.down = False
    hits = client.get("/memory/search", headers=auth(), params={"q": "steps"}).json()["hits"]
    assert not any("9,000" in h["text"] for h in hits)
    client.get("/preferences", headers=auth())  # the next app request retries the erase and the write
    [(text, latest)] = health_records(memory_client)
    assert "10,000 steps" in text and latest not in (old_scope, new_scope)
    assert stored_day(client, alice)["memoryStatus"] == "synced"


def test_memory_outage_leaves_days_pending_until_a_later_sync(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    memory_client.down = True
    assert upload(client, alice)["memoryStatus"] == "pending"  # the upload itself still succeeds
    assert upload(client, alice, day="2026-10-19", steps=5000)["memoryStatus"] == "pending"
    memory_client.down = False
    client.get("/preferences", headers=auth())  # next to the existing preference retries
    assert stored_day(client, alice)["memoryStatus"] == "synced"
    assert stored_day(client, alice, "2026-10-19")["memoryStatus"] == "synced"
    assert SPEC_TEXT in [t for t, _ in health_records(memory_client)]

    memory_client.down = True
    upload(client, alice, day="2026-10-18", steps=4000)
    memory_client.down = False
    # An upload writes only its own day, so it stays inside the watch's timeout; the phone's requests do the rest.
    assert upload(client, alice, day="2026-10-17", steps=3000)["memoryStatus"] == "synced"
    assert stored_day(client, alice, "2026-10-18")["memoryStatus"] == "pending"
    client.get("/preferences", headers=auth())
    assert stored_day(client, alice, "2026-10-18")["memoryStatus"] == "synced"
    assert len(health_records(memory_client)) == 4


def test_health_upload_waits_on_unreachable_memory_at_most_once(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    memory_client.down = True
    upload(client, alice, day="2026-10-19", steps=5000)  # pending, so the next upload would retry it
    calls: list[int] = []
    real = memory_client.check

    def check() -> None:
        calls.append(1)
        real()

    monkeypatch.setattr(memory_client, "check", check)
    # The changed day's old revision can't be erased (one attempt), so the pending retries are skipped.
    assert upload(client, alice, steps=9000)["memoryStatus"] == "pending"
    assert len(calls) == 1
    memory_client.down = False
    client.get("/preferences", headers=auth())
    assert stored_day(client, alice)["memoryStatus"] == "synced"
    assert stored_day(client, alice, "2026-10-19")["memoryStatus"] == "synced"
    assert sorted("9,000 steps" in t for t, _ in health_records(memory_client)) == [False, True]


def test_sharing_off_erases_memory_and_hides_health_from_agents(client: TestClient, memory_client, fake_ai) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    [(_, scope)] = health_records(memory_client)
    forgets = len(memory_client.forgets)
    share(client, on=False)  # one forget of the whole health subtree, not one call per day
    assert memory_client.forgets[forgets:] == [ALICE_SCOPE + "/health"] and health_records(memory_client) == []
    # Still stored and shown to the user and the watch.
    day = stored_day(client, alice)
    assert day["memoryStatus"] == "not_mirrored" and day["sleepMinutes"] == 412
    today = client.get("/watch/today", headers=alice, params={"date": DAY}).json()
    assert today["health"]["steps"] == 8412 and today["shareHealth"] is False
    # ...but not to the Coach or the shared agent context.
    ctx = gather(ALICE, "How did I sleep this week? Plan a workout", memory_client)
    assert ctx.health is None and "Apple Watch" not in ctx.model_dump_json() and ctx.summary()["health_days"] == 0
    reply = client.post("/coach/messages", headers=auth(), json={"content": "How did I sleep?", "localDate": TODAY}).json()
    assert "<health_summary>" not in reply["reply"]["content"] and reply["reply"]["context"]["healthDays"] == 0
    with app.state.session_factory() as db:
        row = db.scalar(select(HealthDay))
        assert row.memory_scope is None and row.memory_text is None
    # Turning it back on mirrors the day again, under a new revision.
    share(client)
    [(text, again)] = health_records(memory_client)
    assert text == SPEC_TEXT and again != scope


def test_sharing_off_while_memory_is_down_tombstones_the_erase(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    upload(client, alice, day="2026-10-19", steps=5000)
    memory_client.down = True
    share(client, on=False)  # still succeeds
    share(client, on=False)  # saving it again doesn't pile up tombstones
    memory_client.down = False
    assert tombstones() == [(ALICE_SCOPE + "/health", None)]  # one tombstone for the whole subtree
    assert client.get("/memory/search", headers=auth(), params={"q": "sleep"}).json()["hits"] == []  # stale text filtered
    client.get("/preferences", headers=auth())  # the retry erases the subtree
    assert health_records(memory_client) == [] and tombstones() == []
    assert stored_day(client, alice)["memoryStatus"] == "not_mirrored"


def test_sharing_off_erases_a_summary_whose_write_reported_an_error(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client, user=BOB)
    upload(client, bearer(link(client, BOB)))
    share(client)
    alice = bearer(link(client))
    real = memory_client.remember
    monkeypatch.setattr(memory_client, "remember", lands_then_fails(real))
    assert upload(client, alice)["memoryStatus"] == "pending"
    monkeypatch.setattr(memory_client, "remember", real)
    assert [t for t, _ in health_records(memory_client)] == [SPEC_TEXT]  # stored, though no scope was recorded
    with app.state.session_factory() as db:
        assert db.scalar(select(HealthDay).where(HealthDay.user_id == ALICE)).memory_scope is None
    forgets = len(memory_client.forgets)
    share(client, on=False)
    assert memory_client.forgets[forgets:] == [ALICE_SCOPE + "/health"]  # one call for the whole subtree
    assert health_records(memory_client) == [] and tombstones() == []
    assert stored_day(client, alice)["memoryStatus"] == "not_mirrored"
    assert len(health_records(memory_client, BOB_SCOPE)) == 1  # the erase stays inside Alice's subtree


def test_sharing_off_with_memory_down_tombstones_a_summary_whose_write_reported_an_error(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    real = memory_client.remember
    monkeypatch.setattr(memory_client, "remember", lands_then_fails(real))
    upload(client, alice)
    monkeypatch.setattr(memory_client, "remember", real)
    memory_client.down = True
    share(client, on=False)
    memory_client.down = False
    assert tombstones() == [(ALICE_SCOPE + "/health", None)] and len(health_records(memory_client)) == 1
    # Until the retry lands, the summary is neither shown nor recalled.
    assert client.get("/memory/search", headers=auth(), params={"q": "sleep"}).json()["hits"] == []
    ctx = gather(ALICE, "How did I sleep? Plan a workout", memory_client)
    assert ctx.health is None and ctx.memory_notes == [] and "Apple Watch" not in ctx.model_dump_json()
    client.get("/preferences", headers=auth())  # a later sync retries the erase
    assert health_records(memory_client) == [] and tombstones() == []


def test_sharing_on_again_finishes_a_pending_erase_before_writing(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    [(_, first)] = health_records(memory_client)
    memory_client.down = True
    share(client, on=False)
    memory_client.down = False
    share(client)  # the subtree erase lands first, then the day is written under a new revision
    [(text, second)] = health_records(memory_client)
    assert text == SPEC_TEXT and second != first and tombstones() == []
    client.get("/preferences", headers=auth())  # no late retry removes the new summary
    assert health_records(memory_client) == [(text, second)] and stored_day(client, alice)["memoryStatus"] == "synced"

    # Off and on again while memory is down: the day waits, and the next upload erases first, then writes.
    memory_client.down = True
    share(client, on=False)
    share(client)
    memory_client.down = False
    assert stored_day(client, alice)["memoryStatus"] == "pending" and tombstones() == [(ALICE_SCOPE + "/health", None)]
    upload(client, alice, day=TODAY, complete=False)  # the erase lands; this upload writes only its own (partial) day
    assert tombstones() == [] and health_records(memory_client) == [] and stored_day(client, alice)["memoryStatus"] == "pending"
    upload(client, alice)  # uploading the waiting day again writes it
    [(text, third)] = health_records(memory_client)
    assert text == SPEC_TEXT and third not in (first, second) and tombstones() == []
    assert stored_day(client, alice)["memoryStatus"] == "synced"


def test_changing_a_day_erases_its_pending_revision_without_a_recorded_scope(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    real = memory_client.remember
    monkeypatch.setattr(memory_client, "remember", lands_then_fails(real))
    assert upload(client, alice)["memoryStatus"] == "pending"
    monkeypatch.setattr(memory_client, "remember", real)
    [(_, landed)] = health_records(memory_client)
    assert upload(client, alice, steps=9000)["memoryStatus"] == "synced"
    [(text, scope)] = health_records(memory_client)
    assert "9,000 steps" in text and scope != landed and landed in memory_client.forgets


def test_sharing_off_without_anything_mirrored_leaves_memory_alone(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    alice = bearer(link(client))
    upload(client, alice)  # stored, but sharing was never turned on
    share(client, on=False)
    assert memory_client.forgets == [] and tombstones() == []
    share(client)
    share(client, on=False)  # erases what sharing just mirrored, registering the path first
    assert memory_client.forgets == [ALICE_SCOPE + "/health"] and ALICE_SCOPE + "/health" in memory_client.scopes.registered
    share(client, on=False)  # saving "off" again has nothing left to erase
    assert memory_client.forgets == [ALICE_SCOPE + "/health"] and tombstones() == []


def test_sharing_off_with_memory_not_configured_leaves_no_tombstone(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    alice = bearer(link(client))
    upload(client, alice)
    app.dependency_overrides[get_memory] = lambda: None
    share(client, on=False)
    assert tombstones() == []


def test_sharing_off_erases_a_day_that_still_records_a_scope(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    with app.state.session_factory() as db:  # a scope recorded without its text (a late write, before writes were checked)
        db.scalar(select(HealthDay)).memory_text = None
        db.get(Profile, ALICE).share_health = False
        db.commit()
    share(client, on=False)
    assert memory_client.forgets == [ALICE_SCOPE + "/health"] and health_records(memory_client) == []
    assert row_mirror() == ("not_mirrored", None, None)


def test_a_write_in_flight_when_sharing_is_turned_off_is_erased_again(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    monkeypatch.setattr(memory_client, "remember", in_flight(memory_client.remember, sharing_off_elsewhere(memory_client)))
    # The subtree erase ran before the write landed: the write is erased again and the row says what's true.
    assert upload(client, alice)["memoryStatus"] == "not_mirrored"
    assert health_records(memory_client) == [] and tombstones() == []
    assert row_mirror() == ("not_mirrored", None, None)
    assert client.get("/watch/settings", headers=auth()).json() == {"shareHealth": False}


def test_a_late_write_whose_erase_fails_is_tombstoned_and_withheld(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))

    def outage() -> None:
        memory_client.down = True

    monkeypatch.setattr(memory_client, "remember", in_flight(memory_client.remember, sharing_off_elsewhere(memory_client), outage))
    assert upload(client, alice)["memoryStatus"] == "not_mirrored"
    [(scope, text)] = tombstones()
    assert scope.startswith(ALICE_SCOPE + "/health/") and text == SPEC_TEXT
    memory_client.down = False
    memory_client.records.append(("Walked about 8.4k steps that day", [[scope]]))  # a fact derived from it
    ctx = gather(ALICE, "How did I sleep? Plan a light workout", memory_client)
    assert ctx.memory_notes == [] and "withheld" in ctx.memory.detail and "8.4k" not in ctx.model_dump_json()
    share(client, on=False)  # saving "off" again now knows there's something to erase
    assert health_records(memory_client) == [] and tombstones() == []


def test_a_write_in_flight_when_memory_is_erased_is_erased_again(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))

    def erase_memory() -> None:
        with app.state.session_factory() as other:  # the phone's DELETE /memory
            prefs.erase_all(other, MemoryService(memory_client), ALICE)

    monkeypatch.setattr(memory_client, "remember", in_flight(memory_client.remember, erase_memory))
    assert upload(client, alice)["memoryStatus"] == "not_mirrored"
    assert memory_client.records == [] and tombstones() == [] and row_mirror() == ("not_mirrored", None, None)


def test_derived_health_facts_are_withheld_while_sharing_is_off_and_the_erase_is_pending(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    pref = client.post("/preferences", headers=auth(), json={"text": "Fictional: I like evening walks."}).json()
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    [(_, scope)] = health_records(memory_client)
    # Agent Memory may derive facts from a summary, under its scope, that don't repeat its words.
    memory_client.records.append(("Resting heart rate is 58 bpm", [[scope]]))
    memory_client.down = True
    share(client, on=False)  # the subtree erase fails: one tombstone, with no text to filter by
    memory_client.down = False
    ctx = gather(ALICE, "How did I sleep? Plan a light workout", memory_client)  # no retry here (MCP reads never write)
    assert ctx.memory.status == "ok" and ctx.memory_notes == [] and "1 recalled note(s) were withheld" in ctx.memory.detail
    assert "58 bpm" not in ctx.model_dump_json() and ctx.health is None
    assert [p.id for p in ctx.preferences if p.recalled] == [pref["id"]]  # saved preferences are still attributed
    client.get("/preferences", headers=auth())  # the retry erases the subtree, derived facts included
    assert health_records(memory_client) == [] and tombstones() == []
    ctx = gather(ALICE, "How did I sleep? Plan a light workout", memory_client)
    assert "withheld" not in ctx.memory.detail and ctx.preferences[0].recalled


def test_an_upload_retries_old_revision_erases_which_never_withhold_other_notes(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    pref = client.post("/preferences", headers=auth(), json={"text": "I prefer spicy food."}).json()
    memory_client.records.append(("Likes chilli heat", [[preference_scope(ALICE, pref["id"])]]))  # derived, not stale
    alice = bearer(link(client))
    upload(client, alice)
    memory_client.down = True
    upload(client, alice, steps=9000)  # erasing the old revision fails: tombstoned with its text
    memory_client.down = False
    [(old_scope, old_text)] = tombstones()
    assert old_text == SPEC_TEXT
    # The old summary is filtered by its text and marker; it's no reason to withhold anything else.
    ctx = gather(ALICE, "dinner ideas", memory_client)
    assert [n.text for n in ctx.memory_notes] == ["Likes chilli heat"] and "withheld" not in ctx.memory.detail
    # A watch-only user: the next upload erases the old revision first, then writes.
    assert upload(client, alice, steps=9000)["memoryStatus"] == "synced"
    assert tombstones() == [] and old_scope in memory_client.forgets
    [(text, _)] = health_records(memory_client)
    assert "9,000 steps" in text


def test_no_write_lock_is_held_while_a_retried_sync_waits_on_memory(client: TestClient, memory_client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    path = app.state.session_factory.kw["bind"].url.database

    def another_writer() -> None:  # another request committing while the memory write is in flight
        other = sqlite3.connect(path, timeout=0)
        try:
            other.execute("BEGIN IMMEDIATE")  # raises "database is locked" if a write transaction is open
            other.rollback()
        finally:
            other.close()

    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    # An old revision's erase waits for a retry: the next upload erases it first, then writes.
    memory_client.down = True
    upload(client, alice, steps=9000)
    memory_client.down = False
    assert len(tombstones()) == 1
    monkeypatch.setattr(memory_client, "remember", in_flight(memory_client.remember, another_writer))
    assert upload(client, alice, steps=9000)["memoryStatus"] == "synced" and tombstones() == []
    # A subtree erase waits for a retry (sharing off while memory was down, then on again): same.
    memory_client.down = True
    share(client, on=False)
    memory_client.down = False
    monkeypatch.setattr(memory_client, "remember", in_flight(memory_client.remember, another_writer))
    share(client)
    assert stored_day(client, alice)["memoryStatus"] == "synced" and tombstones() == []


def test_health_reaches_the_shared_context_and_the_coach(client: TestClient, memory_client, fake_ai) -> None:  # type: ignore[no-untyped-def]
    assert user_context.detect_topics("How did I sleep this week?") == ["plan", "health"]
    assert user_context.detect_topics("My resting heart rate and steps") == ["health"]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    assert client.put(f"/watch/health/{TODAY}", headers=alice, json={"steps": 3000, "complete": False}).status_code == 200
    upload(client, alice, day="2026-10-10")  # outside the 7-day window
    # A health summary no current day accounts for is never passed on as a generic memory note.
    memory_client.records.append(("Apple Watch daily summary for 2026-09-01 (device-measured): 1 steps.",
                                  [[f"{ALICE_SCOPE}/health/orphan"]]))
    ctx = gather(ALICE, "I feel tired, should I rest today?", memory_client)
    assert "health" in ctx.topics and [d.date for d in ctx.health] == [DAY, TODAY]
    assert (ctx.health_start, ctx.health_end) == ("2026-10-15", TODAY)
    assert ctx.health[0].sleep_minutes == 412 and ctx.health[0].workouts[0].activity_type == "running"
    assert ctx.health[0].recalled is True and ctx.health[1].recalled is False and ctx.health[1].complete is False
    assert ctx.memory_notes == [] and ctx.summary()["health_days"] == 2
    # Workout and plan requests get it too; other requests don't.
    assert gather(ALICE, "A 20-minute workout with dumbbells", memory_client).health is not None
    assert gather(ALICE, "What should I cook for dinner?", memory_client).health is None

    reply = client.post("/coach/messages", headers=auth(), json={"content": "How did I sleep? Suggest a light workout",
                                                                 "localDate": TODAY}).json()["reply"]
    prompt = reply["content"]
    assert "<health_summary>" in prompt and "slept 6 h 52 min" in prompt and "device-measured" in prompt
    assert f"{TODAY} (day not over yet): 3,000 steps" in prompt and "2026-10-10" not in prompt
    assert f"days in 2026-10-15..{TODAY} not listed have no data" in prompt  # the window is stated, not implied
    assert reply["context"]["healthDays"] == 2
    system = fake_ai.calls[-1]["system"]
    assert "Never diagnose" in system and "<health_summary>" in system and "date range its first line gives" in system


def test_health_window_ends_at_the_end_of_the_week_or_today(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    upload(client, alice, day="2026-10-13", steps=5000)

    def window(on: str, today: str | None = TODAY) -> tuple[str | None, str | None, list[str]]:
        with app.state.session_factory() as db:
            ctx = user_context.gather(db, MemoryService(memory_client), ALICE, "Plan my workouts", on=date.fromisoformat(on),
                                      today=date.fromisoformat(today) if today else None)
        return ctx.health_start, ctx.health_end, [d.date for d in ctx.health or []]

    assert window("2026-10-27") == ("2026-10-15", TODAY, [DAY])  # planning next week: up to today, never the future
    assert window("2026-10-19") == ("2026-10-15", TODAY, [DAY])  # this week's Monday no longer cuts off the days after it
    assert window("2026-10-14") == ("2026-10-12", "2026-10-18", ["2026-10-13"])  # a past week: that whole week
    assert window(DAY, today=None) == ("2026-10-14", DAY, [DAY])  # without `today`, `on` is the user's today (the Coach)
    share(client, on=False)
    assert window(TODAY) == (None, None, [])


def test_erasing_memory_resets_the_health_mirror(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    share(client)
    alice = bearer(link(client))
    upload(client, alice)
    assert client.delete("/memory", headers=auth()).status_code == 200
    assert memory_client.records == [] and stored_day(client, alice)["memoryStatus"] == "not_mirrored"
    with app.state.session_factory() as db:
        assert db.scalar(select(HealthDay)).memory_text is None
    client.get("/preferences", headers=auth())  # nothing is pending, so nothing comes back by itself
    assert memory_client.records == []
    assert upload(client, alice)["memoryStatus"] == "synced"  # a new upload mirrors it again
    assert [t for t, _ in health_records(memory_client)] == [SPEC_TEXT]


def test_deleting_all_data_removes_watch_links_and_health_days(client: TestClient, memory_client) -> None:  # type: ignore[no-untyped-def]
    tokens = {}
    for user in (ALICE, BOB):
        share(client, user=user)
        tokens[user] = bearer(link(client, user))
        upload(client, tokens[user])
    result = client.delete("/account/data", headers=auth(ALICE)).json()
    assert result["deletedRecords"]["watch_tokens"] == 1 and result["deletedRecords"]["health_days"] == 1
    assert client.get("/watch/today", headers=tokens[ALICE], params={"date": DAY}).status_code == 401
    assert client.get("/watch/health", headers=auth(ALICE), params={"end": DAY}).json()["days"] == []
    assert client.get("/watch/settings", headers=auth(ALICE)).json() == {"shareHealth": False}
    assert health_records(memory_client) == []
    assert stored_day(client, tokens[BOB])["steps"] == 8412  # Bob's data is untouched
    assert len(health_records(memory_client, BOB_SCOPE)) == 1
