"""Unit tests for ingredient combination, memory scopes and migrations (no network)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect
from surrealdb.memory import MemoryAPIError

from app.db import migrate
from app.memory import MemoryService, health_root, health_scope, preference_scope, user_scope, user_lens
from app.units import Line, dimension, normalize_name, try_combine


def test_units_and_dimensions() -> None:
    assert dimension("Tablespoons") == "volume" and dimension("lbs") == "mass"
    assert dimension(None) == "count" and dimension("clove") == "unit:clove"
    assert normalize_name("Red Onions") == normalize_name("red onion")
    assert normalize_name("glass") == "glass"


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        (Line("flour", 500, "g"), Line("Flour", 1, "kg"), Line("flour", 1500, "g")),
        (Line("milk", 1, "l"), Line("milk", 250, "ml"), Line("milk", 1.25, "l")),
        (Line("egg", 2, None), Line("eggs", 3, None), Line("egg", 5, None)),
        (Line("garlic", 2, "clove"), Line("garlic", 1, "cloves"), None),  # different spellings aren't guessed
        (Line("flour", 1, "cup"), Line("flour", 100, "g"), None),  # volume vs mass stay separate
        (Line("salt", None, None), Line("salt", 5, "g"), None),
        (Line("salt", None, None), Line("salt", None, None), Line("salt", None, None)),
        (Line("rice", 1, "kg"), Line("beans", 1, "kg"), None),
    ],
)
def test_try_combine(a: Line, b: Line, expected: Line | None) -> None:
    assert try_combine(a, b) == expected


def test_scopes_are_case_safe_and_contained() -> None:
    assert user_scope("user_2abCd") != user_scope("user_2aBcd")
    assert user_scope("user_2abCd") == user_scope("user_2abCd").lower()
    assert preference_scope("user_2abCd", "ab12").startswith(user_scope("user_2abCd") + "/pref/")
    assert user_lens("user_2abCd") == [[user_scope("user_2abCd") + "/*"]]
    for bad in ("user_abc/../other", "", "org_1"):
        with pytest.raises(ValueError):
            user_scope(bad)
    with pytest.raises(ValueError):
        preference_scope("user_2abCd", "../x")
    assert health_scope("user_2abCd", "AB12") == user_scope("user_2abCd") + "/health/ab12"
    assert health_scope("user_2abCd", "ab12").startswith(health_root("user_2abCd") + "/")
    assert health_root("user_2abCd") == user_scope("user_2abCd") + "/health"
    for bad in ("../x", "", "2026-10-20"):
        with pytest.raises(ValueError):
            health_scope("user_2abCd", bad)


def test_forgetting_the_health_subtree_stays_in_the_user_subtree_and_tolerates_nothing_stored() -> None:
    forgotten: list[str] = []
    registered: list[str] = []

    def forget(path: str) -> SimpleNamespace:
        forgotten.append(path)
        raise MemoryAPIError(404, "scope not found")  # nothing was ever stored there

    scopes = SimpleNamespace(forget=forget, register=registered.append)
    assert MemoryService(SimpleNamespace(scopes=scopes)).forget_health("user_2abCd") == 0
    assert forgotten == [user_scope("user_2abCd") + "/health"]
    # The path (and its ancestors) is registered before the erase, so it never targets an unknown scope.
    assert registered[-2:] == [user_scope("user_2abCd"), user_scope("user_2abCd") + "/health"]

    def down(path: str) -> SimpleNamespace:
        raise MemoryAPIError(0, "Connection failed")

    with pytest.raises(MemoryAPIError):  # other failures still reach the caller, which leaves a tombstone
        MemoryService(SimpleNamespace(scopes=SimpleNamespace(forget=down, register=lambda path: None))).forget_health("user_2abCd")


def test_migrations_create_all_tables(tmp_path) -> None:  # type: ignore[no-untyped-def]
    url = f"sqlite:///{tmp_path / 'm.db'}"
    migrate(url)
    migrate(url)  # idempotent
    tables = set(inspect(create_engine(url)).get_table_names())
    assert {"profiles", "recipes", "shopping_items", "routines", "activity_sessions", "checkins", "plan_items",
            "coach_messages", "remembered_preferences", "memory_tombstones", "watch_tokens", "health_days"} <= tables
