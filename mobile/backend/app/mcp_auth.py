"""Who is calling /mcp. Two kinds of credentials resolve to a Clerk user ID; nothing else does.

1. Clerk OAuth access tokens (ChatGPT, Claude, OpenCode's OAuth flow). The protected-resource
   metadata at /.well-known/oauth-protected-resource/mcp names this app's Clerk instance as the
   authorization server, so clients sign the user in with Clerk. JWT access tokens are verified
   with the instance's public JWKS (no secret needed); opaque ones need CLERK_SECRET_KEY.
2. Connection tokens the signed-in user creates in the app (Profile -> Connect AI assistants) for
   clients that send a fixed bearer header. Only a hash is stored; tokens expire and can be revoked.

Clerk *session* tokens from the mobile app are refused here: they live for about a minute and are
meant for the app itself, not for long-running assistant connections. Apple Watch link tokens (`bnw_`)
are refused too, before anything else, so they are never looked up as connection tokens or sent to Clerk.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import anyio.to_thread
import httpx
import jwt
from mcp.server.auth.provider import AccessToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CLERK_USER_ID, OAUTH_JWT_TYPES, ClerkVerifier
from app.models import ConnectionToken

log = logging.getLogger(__name__)

TOKEN_PREFIX = "bnc_"
TOKEN_SCOPES = ["email", "profile"]
TOKEN_LIFETIME = timedelta(days=90)
# Apple Watch link tokens: accepted only by the watch's REST data routes (deps.watch_user), never here.
WATCH_TOKEN_PREFIX = "bnw_"
WATCH_TOKEN_LIFETIME = timedelta(days=90)
CLERK_VERIFY_URL = "https://api.clerk.com/oauth_applications/access_tokens/verify"
# CIMD clients identify themselves with an HTTPS URL that Clerk fetches, so the URL's host is the client's
# owner: a client_id on chatgpt.com can only be ChatGPT. Other OAuth clients must be listed exactly.
DEFAULT_OAUTH_CLIENT_HOSTS = ("chatgpt.com", "claude.ai", "claude.com")


def _norm(url: str) -> str:
    return url.rstrip("/")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token(prefix: str) -> tuple[str, str, str]:
    """Returns (token, its hash, a short hint). The token is shown to the user once and never stored."""
    token = prefix + secrets.token_urlsafe(32)
    return token, hash_token(token), token[-4:]


def new_connection_token() -> tuple[str, str, str]:
    return new_token(TOKEN_PREFIX)


def new_watch_token() -> tuple[str, str, str]:
    return new_token(WATCH_TOKEN_PREFIX)


class AssistantTokenVerifier:
    """MCP `TokenVerifier`: returns an AccessToken whose `subject` is the verified Clerk user ID, or None."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        clerk: ClerkVerifier | None,
        resource_url: str,
        clerk_secret_key: str = "",
        *,
        client_hosts: tuple[str, ...] = DEFAULT_OAUTH_CLIENT_HOSTS,
        client_ids: tuple[str, ...] = (),
        require_resource_audience: bool = True,
    ) -> None:
        self.session_factory = session_factory
        self.clerk = clerk
        self.resource_url = resource_url
        self.clerk_secret_key = clerk_secret_key
        self.client_hosts = {h.lower() for h in client_hosts}
        self.client_ids = {_norm(c) for c in client_ids}
        self.require_resource_audience = require_resource_audience
        self._opaque_cache: dict[str, tuple[float, AccessToken | None]] = {}

    async def verify_token(self, token: str) -> AccessToken | None:
        return await anyio.to_thread.run_sync(self.verify_sync, token)

    def verify_sync(self, token: str) -> AccessToken | None:
        if not token or len(token) > 8192:
            return None
        if token.startswith(WATCH_TOKEN_PREFIX):
            log.info("Rejected an Apple Watch link token at /mcp: it only works on the watch's app routes.")
            return None
        if token.startswith(TOKEN_PREFIX):
            return self._connection_token(token)
        if token.count(".") == 2:
            return self._clerk_jwt(token)
        return self._clerk_opaque(token)

    # --- connection tokens created in the app -------------------------------------------------

    def _connection_token(self, token: str) -> AccessToken | None:
        with self.session_factory() as db:
            row = db.scalar(select(ConnectionToken).where(ConnectionToken.token_hash == hash_token(token)))
            if row is None or row.revoked_at is not None or row.expires_at <= datetime.now(UTC):
                return None
            return AccessToken(
                token=token,
                client_id=f"connection-token:{row.id}",
                scopes=list(TOKEN_SCOPES),
                expires_at=int(row.expires_at.timestamp()),
                resource=self.resource_url,
                subject=row.user_id,
                claims={"via": "connection_token", "label": row.label},
            )

    # --- Clerk OAuth access tokens ----------------------------------------------------------

    def _clerk_jwt(self, token: str) -> AccessToken | None:
        """Clerk OAuth access tokens are RFC 9068 JWTs (`typ: at+jwt`) with `client_id` and `scope`/`scp`."""
        if self.clerk is None:
            return None
        try:
            header = jwt.get_unverified_header(token)
            key = self.clerk.jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                issuer=self.clerk.issuer,
                options={"require": ["exp", "iat", "iss", "sub"], "verify_aud": False},  # aud is checked below
                leeway=5,
            )
        except (jwt.PyJWKClientError, jwt.InvalidTokenError) as exc:
            log.info("Rejected a bearer token at /mcp: %s", type(exc).__name__)
            return None
        if str(header.get("typ", "")).lower() not in OAUTH_JWT_TYPES:
            # e.g. a Clerk session token from the app (typ JWT): valid for the app, never an assistant credential.
            log.info("Rejected a JWT at /mcp with typ=%r: only Clerk OAuth access tokens (at+jwt) are accepted.", header.get("typ"))
            return None
        problem = self._oauth_claims_problem(claims)
        if problem:
            # Claim values here are not secrets; they show exactly why a real token was refused.
            log.info("Rejected a Clerk OAuth token at /mcp: %s (client_id=%r, aud=%r, scope=%r)", problem,
                     claims.get("client_id"), claims.get("aud"), claims.get("scope") or claims.get("scp"))
            return None
        log.info("Accepted a Clerk OAuth token at /mcp (client_id=%r, aud=%r, scope=%r, sub=%r)",
                 claims.get("client_id"), claims.get("aud"), claims.get("scope") or claims.get("scp"), claims.get("sub"))
        return self._access_token(
            token,
            subject=claims.get("sub"),
            client_id=str(claims["client_id"]),
            scopes=claims.get("scope") or claims.get("scp") or [],
            expires_at=claims.get("exp"),
            via="clerk_oauth_jwt",
        )

    def _oauth_claims_problem(self, claims: dict[str, object]) -> str | None:
        """Why these OAuth token claims aren't acceptable here, or None."""
        client_id = claims.get("client_id")
        if not isinstance(client_id, str) or not client_id:
            return "no client_id claim"
        if not self.client_allowed(client_id):
            return "client is not allowed (MCP_OAUTH_CLIENT_HOSTS / MCP_OAUTH_CLIENT_IDS)"
        audience = claims.get("aud")
        audiences = [audience] if isinstance(audience, str) else audience if isinstance(audience, list) else []
        audiences = [_norm(a) for a in audiences if isinstance(a, str) and a]
        resource = _norm(self.resource_url)
        # Besides this server, `aud` may only name the token's own client (some servers put the client ID there).
        foreign = [a for a in audiences if a not in (resource, _norm(client_id))]
        if foreign:
            return f"token audience includes other resources {foreign}"
        if resource not in audiences and self.require_resource_audience:
            return f"token is not bound to this resource ({self.resource_url}); set MCP_REQUIRE_RESOURCE_AUDIENCE=false only if Clerk can't bind it"
        return None

    def client_allowed(self, client_id: str) -> bool:
        if _norm(client_id) in self.client_ids:
            return True
        parsed = urlparse(client_id)
        return parsed.scheme == "https" and (parsed.hostname or "").lower() in self.client_hosts

    def _clerk_opaque(self, token: str) -> AccessToken | None:
        if not self.clerk_secret_key:
            # Only the token's type is logged, never the token.
            kind = "a Clerk opaque OAuth token (oat_…)" if token.startswith("oat_") else f"an unrecognized token ({len(token)} chars)"
            log.info("Rejected %s at /mcp: CLERK_SECRET_KEY isn't set, so opaque tokens can't be verified.", kind)
            return None
        key = hash_token(token)
        cached = self._opaque_cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        try:
            response = httpx.post(
                CLERK_VERIFY_URL,
                json={"access_token": token},
                headers={"Authorization": f"Bearer {self.clerk_secret_key}"},
                timeout=10,
            )
        except httpx.HTTPError as exc:
            log.warning("Couldn't reach Clerk to verify an OAuth token: %s", type(exc).__name__)
            return None
        result: AccessToken | None = None
        if response.status_code == 200:
            data = response.json()
            if not data.get("revoked") and not data.get("expired") and data.get("active", True):
                result = self._access_token(
                    token,
                    subject=data.get("subject") or data.get("user_id"),
                    client_id=str(data.get("client_id") or "clerk-oauth"),
                    scopes=data.get("scopes") or data.get("scope") or [],
                    expires_at=data.get("expiration") or data.get("expires_at"),
                    via="clerk_oauth_opaque",
                )
        self._opaque_cache[key] = (time.monotonic() + 60, result)
        return result

    def _access_token(self, token: str, *, subject: object, client_id: str, scopes: object, expires_at: object, via: str) -> AccessToken | None:
        if not isinstance(subject, str) or not CLERK_USER_ID.fullmatch(subject):
            log.info("Rejected an OAuth token without a Clerk user subject.")
            return None
        scope_list = scopes.split() if isinstance(scopes, str) else [str(s) for s in scopes] if isinstance(scopes, list) else []
        expiry = int(expires_at) if isinstance(expires_at, (int, float)) else None
        if expiry is not None and expiry > 10**11:  # milliseconds
            expiry //= 1000
        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=scope_list,
            expires_at=expiry,
            resource=self.resource_url,
            subject=subject,
            claims={"via": via},
        )
