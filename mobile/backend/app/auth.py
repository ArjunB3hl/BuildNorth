"""Clerk session-token verification.

The app sends its Clerk session token as `Authorization: Bearer <token>`. The
token is verified against Clerk's public JWKS (located through the publishable
key, so no Clerk secret is needed) and the user ID is taken from the verified
`sub` claim. Nothing the client says about its identity is trusted.

Clerk OAuth access tokens (what assistants get, see mcp_auth.py) share the issuer and the JWKS, so they
are refused here by their `typ` and `client_id`: an assistant's token never passes as the app's session.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, status

log = logging.getLogger(__name__)

CLERK_USER_ID = re.compile(r"user_[A-Za-z0-9]+")
OAUTH_JWT_TYPES = {"at+jwt", "application/at+jwt"}  # RFC 9068 access tokens


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    session_id: str | None


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def frontend_api_host(publishable_key: str) -> str:
    """Decode the Frontend API host embedded in a Clerk publishable key.

    `pk_test_<base64("example.clerk.accounts.dev$")>` -> `example.clerk.accounts.dev`
    """
    prefix, _, encoded = publishable_key.partition("_")
    environment, _, encoded = encoded.partition("_")
    if prefix != "pk" or environment not in {"test", "live"} or not encoded:
        raise ValueError("CLERK_PUBLISHABLE_KEY is not a Clerk publishable key (pk_test_/pk_live_).")
    try:
        decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4), validate=True).decode()
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError("CLERK_PUBLISHABLE_KEY could not be decoded.") from exc
    host = decoded.rstrip("$")
    if not decoded.endswith("$") or "." not in host or "/" in host:
        raise ValueError("CLERK_PUBLISHABLE_KEY does not contain a Frontend API host.")
    return host


class ClerkVerifier:
    def __init__(self, publishable_key: str, authorized_parties: tuple[str, ...] = ()) -> None:
        self.issuer = f"https://{frontend_api_host(publishable_key)}"
        self.authorized_parties = authorized_parties
        # PyJWKClient caches keys and refetches when it sees an unknown `kid`.
        self.jwks = jwt.PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json", cache_keys=True, lifespan=3600, timeout=10
        )

    def verify(self, token: str) -> AuthenticatedUser:
        try:
            header = jwt.get_unverified_header(token)
            signing_key = self.jwks.get_signing_key_from_jwt(token)
        except jwt.PyJWKClientConnectionError as exc:
            log.warning("Could not fetch Clerk JWKS: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Can't reach Clerk to verify your session. Try again shortly.",
            ) from exc
        except (jwt.PyJWKClientError, jwt.InvalidTokenError) as exc:
            raise unauthorized("Invalid session token.") from exc

        try:
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=self.issuer,
                options={"require": ["exp", "iat", "iss", "sub"]},
                leeway=5,
            )
        except jwt.ExpiredSignatureError as exc:
            log.info("Rejected an expired session token (the app retries with a fresh one).")
            raise unauthorized("Session token expired.") from exc
        except jwt.InvalidTokenError as exc:
            log.warning("Rejected a session token: %s", type(exc).__name__)
            raise unauthorized("Invalid session token.") from exc

        if str(header.get("typ", "")).lower() in OAUTH_JWT_TYPES or "client_id" in claims:
            # One bound to a resource already failed above (PyJWT refuses an `aud` it wasn't given); one
            # without `aud` (MCP_REQUIRE_RESOURCE_AUDIENCE=false) would otherwise pass as the user's session.
            log.warning("Rejected an OAuth access token where the app's session token is required.")
            raise unauthorized("Invalid session token.")
        azp = claims.get("azp")
        if self.authorized_parties and azp and azp not in self.authorized_parties:
            raise unauthorized("Session token was issued for a different origin.")
        # Session tokens v2 mark sessions with unfinished tasks as pending; treat them as signed out.
        if claims.get("sts") == "pending":
            raise unauthorized("Finish setting up your account before continuing.")
        user_id = claims["sub"]
        if not isinstance(user_id, str) or not CLERK_USER_ID.fullmatch(user_id):
            raise unauthorized("Session token has an unexpected subject.")
        return AuthenticatedUser(user_id=user_id, session_id=claims.get("sid"))
