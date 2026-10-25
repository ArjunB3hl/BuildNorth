"""Rhythm backend: Clerk-authenticated health companion API.

Structured records live in the SQL database (authoritative for app data);
confirmed preferences, conversational facts and (when the user shares them) Apple
Watch daily health summaries go to SurrealDB Agent Memory; model calls go through
the configured provider adapter.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import Receive, Scope, Send
from surrealdb.memory import Memory

from app.ai import build_provider
from app.auth import ClerkVerifier
from app.config import load_settings
from app.db import make_engine, make_session_factory, migrate
from app import mcp_server
from app.memory import MemoryService
from app.routers import account, activity, calendar, claude, coach, connections, daily, elevenlabs, meals, planner, profile, voice, watch
from app.provider_credentials import credential_cipher
from app.rhythm import router as rhythm
from app.rhythm.config import RhythmSettings
from app.rhythm.memory import Registry as RhythmMemoryRegistry
from app.rhythm.youtube import YouTube
from app.rhythm import mcp as rhythm_mcp

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("buildnorth")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = load_settings()
    app.state.settings = settings
    app.state.credential_cipher = credential_cipher(settings)
    app.state.rhythm_settings = RhythmSettings.load()
    app.state.rhythm_youtube = YouTube(app.state.rhythm_settings.youtube_api_key)
    app.state.rhythm_memory = RhythmMemoryRegistry(
        app.state.rhythm_settings.memory_contexts_json, settings.spectron_url, settings.spectron_context_id,
        app_api_key=settings.spectron_api_key, app_user_id=settings.spectron_owner_user_id)
    if settings.missing:
        log.warning("Missing settings in backend/.env: %s", ", ".join(settings.missing))

    if settings.auto_migrate:
        migrate(settings.database_url)
        logging.getLogger().setLevel(logging.INFO)  # alembic.ini lowers the root logger to WARNING
    engine = make_engine(settings.database_url)
    app.state.session_factory = make_session_factory(engine)

    app.state.verifier = None
    app.state.auth_error = "CLERK_PUBLISHABLE_KEY is not set."
    if settings.clerk_publishable_key:
        try:
            app.state.verifier = ClerkVerifier(settings.clerk_publishable_key, settings.clerk_authorized_parties)
            app.state.auth_error = None
            log.info("Verifying Clerk session tokens issued by %s", app.state.verifier.issuer)
        except ValueError as exc:
            app.state.auth_error = str(exc)
            log.error("%s", exc)

    client = None
    app.state.memory = None
    if settings.memory_configured:
        # The API key stays in this process; it is never returned to clients or logged.
        client = Memory(
            settings.spectron_context_id,
            endpoint=settings.spectron_url,
            api_key=settings.spectron_api_key,
            timeout=20.0,
            max_retries=1,
        )
    bound_services = dict(app.state.rhythm_memory.legacy_services)
    if client is not None and settings.spectron_owner_user_id:
        # Keep the existing app client's timeout/connection for its existing owner.
        bound_services.pop(settings.spectron_owner_user_id, None)
    if client is not None or bound_services:
        app.state.memory = MemoryService(client, owner_user_id=settings.spectron_owner_user_id,
                                         user_services=bound_services)

    app.state.ai, app.state.ai_unavailable_reason = build_provider(settings)
    if app.state.ai is not None:
        log.info("AI provider: %s (model %s)", app.state.ai.name, app.state.ai.model)
    else:
        log.warning("AI unavailable: %s", app.state.ai_unavailable_reason)

    # MCP for external assistants: a fresh server per lifespan (its session manager runs once).
    server, app.state.mcp_http = mcp_server.build(app, settings, app.state.verifier)
    video_server, app.state.rhythm_mcp_http = rhythm_mcp.build(app, settings, app.state.verifier)
    log.info("MCP endpoint: %s (authorization server: %s)", settings.mcp_public_url,
             app.state.verifier.issuer if app.state.verifier else "not configured")
    try:
        async with server.session_manager.run(), video_server.session_manager.run():
            yield
    finally:
        app.state.mcp_http = None
        app.state.rhythm_mcp_http = None
        if client is not None:
            client.close()
        ai_client = getattr(app.state.ai, "_client", None)
        if ai_client is not None:
            ai_client.close()
        app.state.rhythm_memory.close()
        engine.dispose()


app = FastAPI(title="Rhythm API · Demo version", lifespan=lifespan)
# Native apps don't need CORS; this only lets `expo start --web` on this machine call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_origins=list(load_settings().web_allowed_origins),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

for module in (account, calendar, profile, claude, elevenlabs, voice, coach, meals, activity, daily, planner, connections, watch, rhythm):
    app.include_router(module.router)
app.include_router(rhythm.videos)


_as_metadata: dict[str, object] = {}


@app.get("/.well-known/oauth-authorization-server", include_in_schema=False)
async def authorization_server_metadata() -> JSONResponse:
    """Clerk's OAuth metadata, for MCP clients from before protected-resource discovery. Public by design."""
    verifier = getattr(app.state, "verifier", None)
    if verifier is None:
        return JSONResponse({"error": "not_configured"}, status_code=404)
    if not _as_metadata:
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                response = await http.get(f"{verifier.issuer}/.well-known/oauth-authorization-server")
        except httpx.HTTPError:
            return JSONResponse({"error": "unavailable"}, status_code=502)
        if response.status_code != 200:
            return JSONResponse({"error": "unavailable"}, status_code=502)
        _as_metadata.update(response.json())
    return JSONResponse(_as_metadata)


@app.get("/.well-known/oauth-protected-resource", include_in_schema=False)
async def protected_resource_metadata_root() -> JSONResponse:
    """RFC 9728 metadata at the root path too, for clients that probe there before the /mcp-suffixed path."""
    settings = getattr(app.state, "settings", None)
    verifier = getattr(app.state, "verifier", None)
    if settings is None or verifier is None:
        return JSONResponse({"error": "not_configured"}, status_code=404)
    return JSONResponse({
        "resource": settings.mcp_public_url,
        "authorization_servers": [verifier.issuer],
        "scopes_supported": ["email", "profile"],
        "bearer_methods_supported": ["header"],
    })


async def mcp_gateway(scope: Scope, receive: Receive, send: Send) -> None:
    """Hands /mcp and its protected-resource metadata to the current MCP app; everything else 404s there."""
    inner = getattr(app.state, "mcp_http", None)
    if inner is None:
        response = JSONResponse({"detail": "Not found"}, status_code=404)
        await response(scope, receive, send)
        return
    await inner(scope, receive, send)


# Last, so the app's own routes always win.
class RhythmGateway:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        inner = getattr(app.state, "rhythm_mcp_http", None)
        if inner is None:
            await JSONResponse({"detail": "Rhythm is unavailable."}, status_code=503)(scope, receive, send)
            return
        await inner(scope, receive, send)


# ASGI Route endpoints preserve the full path for the MCP SDK's OAuth metadata and transport.
rhythm_gateway = RhythmGateway()
app.add_route("/rhythm/mcp", rhythm_gateway, methods=["GET", "POST", "DELETE"])
app.add_route("/.well-known/oauth-protected-resource/rhythm/mcp", rhythm_gateway, methods=["GET"])
app.mount("/", mcp_gateway)
