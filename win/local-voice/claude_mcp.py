"""One isolated Claude Code turn for the voice coach, answered through the speak_reply MCP tool (reply_mcp.py).

The user's own Claude Code sign-in answers: no API key is used or needed, and none is read from the environment
(claude_code.clean_env removes every ANTHROPIC_*/CLAUDE* variable). Claude Code runs with no built-in tools, no settings
files, no slash commands and no saved session, in an empty temporary folder, with only speak_reply allowed. Only the
text of what the user said (and the few turns before it) is sent; nothing is logged.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "inference" / "pose-coach" / "server"))
import claude_code  # noqa: E402

MODEL = "haiku"
TIMEOUT_S = 100
STATUS_TTL_S = 30
MAX_INPUT = 4000
MAX_REPLY = 600
TOOL = "mcp__rhythm_voice__speak_reply"
SYSTEM = ("You are Rhythm, a friendly coach for everyday meals, movement and sleep, talking with the user by voice. "
          "Answer in one to three short spoken sentences, without lists, markdown or emoji. You are not a doctor: for "
          "pain, injury or health conditions, suggest seeing a professional. Call the speak_reply tool exactly once "
          "with your answer. Do not call any other tool.")

_status: tuple[float, dict] | None = None
_status_lock = threading.Lock()


class ClaudeUnavailable(RuntimeError):
    """Claude Code is missing, signed out, out of usage, or did not answer through the tool."""


def status(fresh: bool = False) -> dict:
    """{"installed", "loggedIn", "account", "plan", "error"}: loggedIn only for a claude.ai sign-in. Cached briefly
    (each check starts the CLI)."""
    global _status
    with _status_lock:
        if not fresh and _status and time.monotonic() - _status[0] < STATUS_TTL_S:
            return _status[1]
        cli = claude_code.find_cli()
        if not cli:
            result = {"installed": False, "loggedIn": False, "account": None, "plan": None,
                      "error": "Claude Code is not installed."}
        else:
            s = claude_code.auth_status(cli)
            ok = claude_code.signed_in(s)
            error = s.get("error")
            if not error and not ok:
                error = ("Claude Code is signed in with an API key or another provider; sign in with your Claude account."
                         if s.get("loggedIn") else "Claude Code is not signed in.")
            # checkFailed: Claude Code did not say (too slow, unreadable), which is not the same as signed out
            result = {"installed": True, "loggedIn": ok, "account": s.get("email") if ok else None,
                      "plan": s.get("subscriptionType") if ok else None, "error": None if ok else error,
                      "checkFailed": bool(s.get("error"))}
        if not result.get("checkFailed"):
            _status = (time.monotonic(), result)            # (a check that failed is tried again next time)
        return result


def command(cli: str, config: Path) -> list[str]:
    return [cli, "-p", "--model", MODEL, "--tools", "", "--allowedTools", TOOL,
            "--permission-mode", "dontAsk", "--strict-mcp-config", "--mcp-config", str(config),
            "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
            "--output-format", "stream-json", "--verbose", "--system-prompt", SYSTEM]


def parse(stdout: str) -> str:
    """The speak_reply text from Claude Code's stream-json output, counted only once its tool call succeeded."""
    calls: dict[str, str] = {}
    succeeded: set[str] = set()
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
            for item in event.get("message", {}).get("content", []) or []:
                if item.get("type") == "tool_use" and item.get("name") == TOOL:
                    answer, ident = item.get("input", {}).get("text"), item.get("id")
                    if isinstance(answer, str) and 0 < len(answer) <= MAX_REPLY and isinstance(ident, str):
                        calls[ident] = answer
                elif item.get("type") == "tool_result" and not item.get("is_error"):
                    succeeded.add(item.get("tool_use_id"))
        except (ValueError, TypeError, AttributeError):
            continue
    for ident, answer in calls.items():
        if ident in succeeded:
            return answer
    raise ClaudeUnavailable("Claude did not answer through the voice tool.")


def reply(text: str, cancel: threading.Event, env: dict | None = None) -> str:
    """Claude's spoken answer to `text`. `env` is for tests only; the helper always uses the clean environment."""
    if not isinstance(text, str) or not 0 < len(text) <= MAX_INPUT:
        raise ValueError("Invalid transcript")
    cli = claude_code.find_cli()
    if not cli:
        raise ClaudeUnavailable("Claude Code is not installed.")
    # (a killed Claude Code may still hold the folder for a moment on Windows; it is removed at the next chance)
    with tempfile.TemporaryDirectory(prefix="rhythm-voice-", ignore_cleanup_errors=True) as tmp:
        config = Path(tmp) / "mcp.json"
        config.write_text(json.dumps({"mcpServers": {"rhythm_voice": {
            "command": sys.executable, "args": [str(Path(__file__).with_name("reply_mcp.py"))]}}}))
        proc = subprocess.Popen(command(cli, config), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, encoding="utf-8", cwd=tmp,
                                env=env if env is not None else claude_code.clean_env(cli),
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        out: list[str] = []
        reader = threading.Thread(target=lambda: out.append(proc.communicate(text)[0] or ""), daemon=True)
        reader.start()
        deadline = time.monotonic() + TIMEOUT_S
        while reader.is_alive():
            if cancel.is_set() or time.monotonic() > deadline:
                proc.kill()
                reader.join(5)
                if cancel.is_set():
                    raise InterruptedError("cancelled")
                raise ClaudeUnavailable("Claude Code took too long to answer.")
            reader.join(0.1)
    if proc.returncode:
        raise ClaudeUnavailable("Claude Code could not answer. Check its sign-in and your plan's usage limits.")
    return parse(out[0] if out else "")
