"""Claude Code (the `claude` CLI) as the user's own signed-in Claude account: where the CLI is, an environment in which
it can only use that sign-in, and whether it is signed in.

The coach (coach.py, `claude -p` with the pose MCP server) and the Windows voice helper (win/local-voice) run Claude
Code this way. Neither reads, copies or passes credentials: the CLI uses the account signed in with `claude auth
login`. Every ANTHROPIC_* and CLAUDE* variable is removed from its environment (an API key, a gateway URL, Bedrock or
Vertex switches, or the variables a parent Claude Code session sets for its own children), so a key in the environment
is never used in place of that sign-in. CLAUDE_CONFIG_DIR is kept: it is the user's choice of which sign-in to use.

    find_cli()            the claude executable, or None
    clean_env(cli)        the environment to run it in
    auth_status(cli)      {"loggedIn", "authMethod", "email", "subscriptionType"} or {"error"}
    signed_in(status)     True only for a claude.ai account sign-in
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

KEEP = {"CLAUDE_CONFIG_DIR"}
PLAN = re.compile(r"[a-z_]{1,32}")


def _version(path: Path) -> tuple[int, ...]:
    """1.2.3 from a path such as ...\\claude-code\\2.1.308\\<build>\\claude.exe (0 when there is none)."""
    for part in reversed(path.parts):
        if re.fullmatch(r"\d+(\.\d+)+", part):
            return tuple(int(n) for n in part.split("."))
    return (0,)


def find_cli() -> str | None:
    """On PATH, else where the native installer puts it, else (Windows) the copy the Claude desktop app keeps for its
    Code tab, newest version first. That copy is the same Claude Code; it is signed in separately from the app."""
    candidates: list[Path] = []
    on_path = shutil.which("claude")
    if on_path:
        candidates.append(Path(on_path))
    exe = "claude.exe" if sys.platform == "win32" else "claude"
    candidates.append(Path.home() / ".local" / "bin" / exe)
    if sys.platform == "win32" and os.environ.get("LOCALAPPDATA"):
        bundled = Path(os.environ["LOCALAPPDATA"]).glob("Claude-Data/*/claude-code/*/*/claude.exe")
        candidates.extend(sorted(bundled, key=_version, reverse=True))
    for p in candidates:
        if p.is_file():
            return str(p)
    return None


def clean_env(cli: str | None = None) -> dict:
    env = {k: v for k, v in os.environ.items()
           if k in KEEP or not (k.upper().startswith("ANTHROPIC") or k.upper().startswith("CLAUDE"))}
    if cli:
        env["PATH"] = os.pathsep.join([str(Path(cli).parent), env.get("PATH", "")])
    return env


def auth_status(cli: str | None = None, timeout: float = 15) -> dict:
    """`claude auth status --json`, reduced to what callers may show: signed in or not, how, the account's email (to tell
    the user which account answers) and its plan. Nothing else of its output is kept."""
    cli = cli or find_cli()
    if not cli:
        return {"loggedIn": False, "error": "Claude Code is not installed."}
    try:
        r = subprocess.run([cli, "auth", "status", "--json"], text=True, capture_output=True, env=clean_env(cli),
                           timeout=timeout, stdin=subprocess.DEVNULL)
        info = json.loads(r.stdout or "{}")
        if not isinstance(info, dict):
            raise ValueError
    except subprocess.TimeoutExpired:
        return {"loggedIn": False, "error": "Claude Code took too long to report its sign-in. Check again in a moment."}
    except (OSError, ValueError):
        return {"loggedIn": False, "error": "Claude Code's sign-in status could not be read. Check again in a moment."}
    email = info.get("email")
    plan = info.get("subscriptionType")
    return {"loggedIn": info.get("loggedIn") is True,
            "authMethod": info.get("authMethod") if isinstance(info.get("authMethod"), str) else None,
            "email": email if isinstance(email, str) and len(email) <= 254 else None,
            "subscriptionType": plan if isinstance(plan, str) and PLAN.fullmatch(plan) else None}


def signed_in(status: dict) -> bool:
    return status.get("loggedIn") is True and status.get("authMethod") == "claude.ai"
