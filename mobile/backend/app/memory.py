"""Per-user memory on SurrealDB Agent Memory.

When a Context has an explicit owner, every operation checks that owner before
SDK access. Additional configured accounts route to their own bound services.

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


def user_scope(user_id: str, *, root: str = SCOPE_ROOT) -> str:
    """Base scope path for one Clerk user.

    Agent Memory rejects uppercase in scope paths, and plain lowercasing would
    merge IDs that differ only in case (`user_2aB` / `user_2Ab`) into one scope.
    Each uppercase letter becomes `-` + its lowercase form instead; Clerk IDs
    never contain `-`, so distinct users always get distinct paths.
    """
    if not CLERK_USER_ID.fullmatch(user_id):
        raise ValueError("refusing to build a scope from an unverified user ID")
    segment = "".join(f"-{c.lower()}" if c.isupper() else c for c in user_id)
    return f"{root}/user/{segment}"


def preference_scope(user_id: str, preference_id: str, *, root: str = SCOPE_ROOT) -> str:
    if not preference_id.isalnum():
        raise ValueError("invalid preference id")
    return f"{user_scope(user_id, root=root)}/pref/{preference_id.lower()}"


def health_root(user_id: str, *, root: str = SCOPE_ROOT) -> str:
    """The subtree holding every health summary revision of one user (erased in one call when sharing is turned off)."""
    return f"{user_scope(user_id, root=root)}/health"


def health_scope(user_id: str, revision: str, *, root: str = SCOPE_ROOT) -> str:
    """One revision of one day's health summary. A changed summary gets a new revision, never a reused scope."""
    if not revision.isalnum():
        raise ValueError("invalid health revision")
    return f"{health_root(user_id, root=root)}/{revision.lower()}"


def user_lens(user_id: str, *, root: str = SCOPE_ROOT) -> list[list[str]]:
    return [[f"{user_scope(user_id, root=root)}/*"]]


class MemoryService:
    scope_root = SCOPE_ROOT

    def __init__(
        self, client: MemoryClient | None, *, owner_user_id: str = "",
        user_services: dict[str, MemoryService] | None = None,
        shared_context: bool = False,
    ) -> None:
        if owner_user_id and not CLERK_USER_ID.fullmatch(owner_user_id):
            raise ValueError("Memory owner must be a valid Clerk user ID.")
        self._client = client
        self.owner_user_id = owner_user_id
        self.shared_context = shared_context
        self._user_services = user_services or {}
        self._registered: set[str] = set()
        self._lock = threading.Lock()

    def _check_owner(self, user_id: str) -> None:
        if not CLERK_USER_ID.fullmatch(user_id):
            raise ValueError("Memory requires a verified Clerk user ID.")
        if self.owner_user_id and user_id != self.owner_user_id:
            raise MemoryAPIError(403, "No memory Context is assigned to this account.")
        if self._client is None:
            raise MemoryAPIError(503, "Memory is not configured for this account.")

    def _for_user(self, user_id: str) -> MemoryService:
        service = self._user_services.get(user_id)
        if service is not None:
            service._check_owner(user_id)
            return service
        self._check_owner(user_id)
        return self

    def bound_to(self, user_id: str) -> MemoryService:
        """Bind a service to a server-verified identity, never a request-body user ID.

        Syntax validation is defense in depth, not authentication. HTTP/MCP callers
        must verify the session before supplying this identity.
        """
        service = self._for_user(user_id)
        if service.owner_user_id:
            return service
        bound = type(service)(service._client, owner_user_id=user_id, shared_context=service.shared_context)
        bound._registered, bound._lock = service._registered, service._lock
        return bound

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
        service = self._for_user(user_id)
        if service is not self:
            return service.remember_preference(user_id, preference_id, text)
        scope = preference_scope(user_id, preference_id, root=self.scope_root)
        self._ensure_registered(scope)
        # Shared Contexts must not synthesize a Context-wide persona from different users.
        self._client.remember(text, scopes=[[scope]], **({"infer": "none"} if self.shared_context else {}))
        return scope

    def remember_health(self, user_id: str, revision: str, text: str) -> str:
        service = self._for_user(user_id)
        if service is not self:
            return service.remember_health(user_id, revision, text)
        scope = health_scope(user_id, revision, root=self.scope_root)
        self._ensure_registered(scope)
        self._client.remember(text, scopes=[[scope]], **({"infer": "none"} if self.shared_context else {}))
        return scope

    def forget_scope(self, user_id: str, scope: str) -> int:
        """Permanently erase one scope subtree belonging to this user."""
        service = self._for_user(user_id)
        if service is not self:
            return service.forget_scope(user_id, scope)
        base = user_scope(user_id, root=self.scope_root)
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
        service = self._for_user(user_id)
        if service is not self:
            return service.forget_health(user_id)
        root = health_root(user_id, root=self.scope_root)
        self._ensure_registered(root)
        return self.forget_scope(user_id, root)

    def erase_user(self, user_id: str) -> int:
        service = self._for_user(user_id)
        if service is not self:
            return service.erase_user(user_id)
        return self.forget_scope(user_id, user_scope(user_id, root=self.scope_root))

    def recall(self, user_id: str, query: str, k: int = 5) -> list[RecalledFact]:
        service = self._for_user(user_id)
        if service is not self:
            return service.recall(user_id, query, k=k)
        result = self._client.recall(query, lens=user_lens(user_id, root=self.scope_root), k=k)
        facts: list[RecalledFact] = []
        seen: set[str] = set()
        for hit in result.hits:
            text = (hit.text or "").strip()
            if text and text not in seen:
                seen.add(text)
                facts.append(RecalledFact(text=text, kind=hit.source, score=hit.score))
        return facts
