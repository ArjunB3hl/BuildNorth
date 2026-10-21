"""Per-user memory on SurrealDB Agent Memory.

Isolation: every Clerk user gets their own scope subtree, built here from the
verified user ID. Each confirmed preference is written under its own child path
(`<user>/pref/<id>`), and each shared Apple Watch day summary under
`<user>/health/<revision>`, so either can be corrected or deleted on its own with
a scoped forget. Reads use the lens `<user>/*`, which covers the user's whole subtree and
nothing else (verified live: the bare `<user>` lens matches only records tagged
with exactly that path).

Never pass an empty scope or lens: the SDK drops empty selectors and the server
then falls back to the API key's whole region, i.e. every user. The general
`/forget` endpoint is not used for the same reason: it takes no scope.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Protocol

from surrealdb.memory import MemoryAPIError

from app.auth import CLERK_USER_ID

SCOPE_ROOT = "buildnorth"


@dataclass(frozen=True)
class RecalledFact:
    text: str
    kind: str
    score: float | None


class MemoryClient(Protocol):
    """The slice of surrealdb.memory.Memory used here (lets tests substitute a fake)."""

    scopes: Any

    def remember(self, text: str | None = None, **kwargs: Any) -> Any: ...

    def recall(self, query: str, **kwargs: Any) -> Any: ...


def user_scope(user_id: str) -> str:
    """Base scope path for one Clerk user.

    Agent Memory rejects uppercase in scope paths, and plain lowercasing would
    merge IDs that differ only in case (`user_2aB` / `user_2Ab`) into one scope.
    Each uppercase letter becomes `-` + its lowercase form instead; Clerk IDs
    never contain `-`, so distinct users always get distinct paths.
    """
    if not CLERK_USER_ID.fullmatch(user_id):
        raise ValueError("refusing to build a scope from an unverified user ID")
    segment = "".join(f"-{c.lower()}" if c.isupper() else c for c in user_id)
    return f"{SCOPE_ROOT}/user/{segment}"


def preference_scope(user_id: str, preference_id: str) -> str:
    if not preference_id.isalnum():
        raise ValueError("invalid preference id")
    return f"{user_scope(user_id)}/pref/{preference_id.lower()}"


def health_root(user_id: str) -> str:
    """The subtree holding every health summary revision of one user (erased in one call when sharing is turned off)."""
    return f"{user_scope(user_id)}/health"


def health_scope(user_id: str, revision: str) -> str:
    """One revision of one day's health summary. A changed summary gets a new revision, never a reused scope."""
    if not revision.isalnum():
        raise ValueError("invalid health revision")
    return f"{health_root(user_id)}/{revision.lower()}"


def user_lens(user_id: str) -> list[list[str]]:
    return [[f"{user_scope(user_id)}/*"]]


class MemoryService:
    def __init__(self, client: MemoryClient) -> None:
        self._client = client
        self._registered: set[str] = set()
        self._lock = threading.Lock()

    def _ensure_registered(self, scope: str) -> None:
        """Register the path and its ancestors (Agent Memory requires registration before first write)."""
        with self._lock:
            segments = scope.split("/")
            for depth in range(1, len(segments) + 1):
                path = "/".join(segments[:depth])
                if path in self._registered:
                    continue
                try:
                    self._client.scopes.register(path)
                except MemoryAPIError as exc:
                    if exc.status_code != 409:  # 409: already registered
                        raise
                self._registered.add(path)

    def remember_preference(self, user_id: str, preference_id: str, text: str) -> str:
        scope = preference_scope(user_id, preference_id)
        self._ensure_registered(scope)
        self._client.remember(text, scopes=[[scope]])
        return scope

    def remember_health(self, user_id: str, revision: str, text: str) -> str:
        scope = health_scope(user_id, revision)
        self._ensure_registered(scope)
        self._client.remember(text, scopes=[[scope]])
        return scope

    def forget_scope(self, user_id: str, scope: str) -> int:
        """Permanently erase one scope subtree belonging to this user."""
        base = user_scope(user_id)
        if not scope or not (scope == base or scope.startswith(base + "/")):
            raise ValueError("refusing to forget a scope outside the user's subtree")
        try:
            result = self._client.scopes.forget(scope)
        except MemoryAPIError as exc:
            if exc.status_code == 404:  # nothing was ever stored under this path: already erased
                return 0
            raise
        return int(getattr(result, "forgotten", 0) or 0)

    def forget_health(self, user_id: str) -> int:
        """Erase every health summary revision of this user (and nothing outside their subtree) in one call.
        The path is registered first (a no-op once it exists), so the erase never targets an unknown scope."""
        root = health_root(user_id)
        self._ensure_registered(root)
        return self.forget_scope(user_id, root)

    def erase_user(self, user_id: str) -> int:
        return self.forget_scope(user_id, user_scope(user_id))

    def recall(self, user_id: str, query: str, k: int = 5) -> list[RecalledFact]:
        result = self._client.recall(query, lens=user_lens(user_id), k=k)
        facts: list[RecalledFact] = []
        seen: set[str] = set()
        for hit in result.hits:
            text = (hit.text or "").strip()
            if text and text not in seen:
                seen.add(text)
                facts.append(RecalledFact(text=text, kind=hit.source, score=hit.score))
        return facts
