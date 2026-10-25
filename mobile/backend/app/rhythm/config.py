"""Conservative configurable ceilings. Clients cannot raise these."""

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, urlunsplit
from app.config import public_mcp_url


def bounded(name: str, default: int, maximum: int) -> int:
    try:
        return max(1, min(maximum, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


@dataclass(frozen=True)
class RhythmSettings:
    mcp_public_url: str = "http://localhost:8000/rhythm/mcp"
    candidates_per_task: int = 10
    shortlist_per_task: int = 3
    attempts_per_task: int = 3
    attempts_per_day: int = 10
    searches_per_day: int = 20
    task_minutes: int = 30
    cache_hours: int = 24
    browser_lease_seconds: int = 20
    request_seconds: int = 90
    timezone: str = "America/Toronto"
    youtube_api_key: str = ""
    memory_contexts_json: str = ""
    # Video tasks, page grants, search and recommendations (API and MCP). Off until RHYTHM_RECOMMENDATIONS is on;
    # learning, reactions and the interest profile work either way.
    recommendations: bool = False

    @classmethod
    def load(cls) -> "RhythmSettings":
        timezone = os.getenv("RHYTHM_BUDGET_TIMEZONE", "America/Toronto")
        ZoneInfo(timezone)  # Invalid deployment configuration should fail at startup.
        base = urlsplit(public_mcp_url())
        resource = (os.getenv("RHYTHM_MCP_PUBLIC_URL") or urlunsplit((base.scheme, base.netloc, "/rhythm/mcp", "", ""))).rstrip("/")
        if urlsplit(resource).path != "/rhythm/mcp":
            raise ValueError("RHYTHM_MCP_PUBLIC_URL must end with /rhythm/mcp at the API origin.")
        return cls(
            mcp_public_url=resource,
            candidates_per_task=bounded("RHYTHM_CANDIDATES_PER_TASK", 10, 10),
            shortlist_per_task=bounded("RHYTHM_SHORTLIST_PER_TASK", 3, 3),
            attempts_per_task=bounded("RHYTHM_ATTEMPTS_PER_TASK", 3, 3),
            attempts_per_day=bounded("RHYTHM_ATTEMPTS_PER_DAY", 10, 100),
            searches_per_day=bounded("RHYTHM_SEARCHES_PER_DAY", 20, 100),
            task_minutes=bounded("RHYTHM_TASK_MINUTES", 30, 120),
            cache_hours=bounded("RHYTHM_CACHE_HOURS", 24, 24),
            timezone=timezone,
            youtube_api_key=os.getenv("YOUTUBE_API_KEY", "").strip(),
            memory_contexts_json=os.getenv("RHYTHM_MEMORY_CONTEXTS_JSON", "").strip(),
            recommendations=os.getenv("RHYTHM_RECOMMENDATIONS", "").strip().lower() in ("1", "true", "on", "yes"),
        )
