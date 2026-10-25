"""Backend settings, read from backend/.env (git-ignored) or the process environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
DEFAULT_DATABASE_URL = f"sqlite:///{BACKEND_DIR / 'var' / 'buildnorth.db'}"

AI_PROVIDERS = {"none", "ollama", "openai", "anthropic"}


@dataclass(frozen=True)
class Settings:
    spectron_url: str
    spectron_context_id: str
    spectron_api_key: str
    clerk_publishable_key: str
    clerk_authorized_parties: tuple[str, ...]
    database_url: str
    auto_migrate: bool
    ai_provider: str
    ai_model: str
    ai_base_url: str
    ai_api_key: str
    ai_timeout_seconds: float
    # MCP endpoint for external assistants (ChatGPT, Claude, ElevenLabs).
    mcp_public_url: str  # the exact URL clients use, e.g. https://xyz.example.com/mcp
    mcp_allowed_hosts: tuple[str, ...]  # Host headers accepted at /mcp (DNS-rebinding protection)
    mcp_client_approval: bool  # accept an approval the user gives in the assistant's own prompt (elicitation)
    clerk_secret_key: str  # optional; only needed to verify *opaque* Clerk OAuth access tokens
    mcp_oauth_client_hosts: tuple[str, ...]  # hosts whose CIMD client IDs may use Clerk OAuth at /mcp
    mcp_oauth_client_ids: tuple[str, ...]  # extra exact client IDs allowed (e.g. a pre-registered Clerk OAuth app)
    mcp_require_resource_audience: bool  # OAuth tokens must name MCP_PUBLIC_URL in `aud` (RFC 8707)
    spectron_owner_user_id: str = ""  # explicit owner when the app Context is private to one account
    ai_credential_key: str = ""  # Fernet key for account-owned Claude credentials
    web_allowed_origins: tuple[str, ...] = ()
    speech_worker_url: str = ""
    speech_worker_token: str = ""

    @property
    def missing(self) -> list[str]:
        """Names (never values) of required settings that are empty."""
        required = {
            "SPECTRON_URL": self.spectron_url,
            "SPECTRON_CONTEXT_ID": self.spectron_context_id,
            "SPECTRON_API_KEY": self.spectron_api_key,
            "CLERK_PUBLISHABLE_KEY": self.clerk_publishable_key,
        }
        return [name for name, value in required.items() if not value]

    @property
    def memory_configured(self) -> bool:
        return bool(self.spectron_url and self.spectron_context_id and self.spectron_api_key)


def database_url(value: str) -> str:
    """Render's Postgres URLs use the psycopg 3 driver installed with this backend."""
    for prefix in ("postgres://", "postgresql://"):
        if value.startswith(prefix):
            return "postgresql+psycopg://" + value[len(prefix):]
    return value


def public_mcp_url() -> str:
    explicit = os.getenv("MCP_PUBLIC_URL", "").strip()
    render_url = os.getenv("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
    return (explicit or (f"{render_url}/mcp" if render_url else "http://localhost:8000/mcp")).rstrip("/")


def load_settings() -> Settings:
    load_dotenv(ENV_FILE)

    def env(name: str, default: str = "") -> str:
        return os.getenv(name, default).strip()

    provider = env("AI_PROVIDER", "auto").lower()
    automatic = provider in {"", "auto"}
    if automatic:
        provider = "anthropic" if env("ANTHROPIC_API_KEY") else "none"
    if provider not in AI_PROVIDERS:
        provider = "none"
    # Provider-specific key names are accepted too, so an existing ANTHROPIC_API_KEY just works.
    api_key = env("ANTHROPIC_API_KEY") if automatic else env("AI_API_KEY") or {
        "anthropic": env("ANTHROPIC_API_KEY"),
        "openai": env("OPENAI_API_KEY"),
    }.get(provider, "")
    try:
        timeout = float(env("AI_TIMEOUT_SECONDS", "150"))
    except ValueError:
        timeout = 150.0

    return Settings(
        spectron_url=env("SPECTRON_URL").rstrip("/"),
        spectron_context_id=env("SPECTRON_CONTEXT_ID"),
        spectron_api_key=env("SPECTRON_API_KEY"),
        clerk_publishable_key=env("CLERK_PUBLISHABLE_KEY"),
        clerk_authorized_parties=tuple(
            party.strip() for party in env("CLERK_AUTHORIZED_PARTIES").split(",") if party.strip()
        ),
        database_url=database_url(env("DATABASE_URL") or DEFAULT_DATABASE_URL),
        speech_worker_url=env("SPEECH_WORKER_URL").rstrip("/"),
        speech_worker_token=env("SPEECH_WORKER_TOKEN"),
        auto_migrate=env("AUTO_MIGRATE", "true").lower() not in {"0", "false", "no"},
        ai_provider=provider,
        ai_model=env("AI_MODEL"),
        ai_base_url=env("AI_BASE_URL").rstrip("/"),
        ai_api_key=api_key,
        ai_timeout_seconds=max(5.0, timeout),
        mcp_public_url=public_mcp_url(),
        mcp_allowed_hosts=tuple(h.strip() for h in env("MCP_ALLOWED_HOSTS").split(",") if h.strip()),
        mcp_client_approval=env("MCP_CLIENT_APPROVAL", "true").lower() not in {"0", "false", "no"},
        clerk_secret_key=env("CLERK_SECRET_KEY"),
        mcp_oauth_client_hosts=tuple(
            h.strip().lower() for h in (env("MCP_OAUTH_CLIENT_HOSTS") or "chatgpt.com,claude.ai,claude.com").split(",") if h.strip()
        ),
        mcp_oauth_client_ids=tuple(c.strip() for c in env("MCP_OAUTH_CLIENT_IDS").split(",") if c.strip()),
        mcp_require_resource_audience=env("MCP_REQUIRE_RESOURCE_AUDIENCE", "true").lower() not in {"0", "false", "no"},
        spectron_owner_user_id=env("SPECTRON_OWNER_USER_ID"),
        ai_credential_key=env("AI_CREDENTIAL_ENCRYPTION_KEY"),
        web_allowed_origins=tuple(o.strip().rstrip("/") for o in env("WEB_ALLOWED_ORIGINS").split(",") if o.strip()),
    )
