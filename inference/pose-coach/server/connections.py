"""Coach connections: which brains and voices the coach can use on this machine, and the one the page picks first (the
user can still pick by hand), in this order:

1. eleven: an ElevenLabs coach agent set up for this app, on a paid plan. Its LLM writes the cues and its voice speaks
   them. The page reaches the agent by its id, with no key: the agent is public but answers only pages served from
   localhost or 127.0.0.1, on any port (its allowlist; any machine can serve those), one session at a time and 40 a day. The
   id comes from POSE_ELEVEN_AGENT, else the record .data/connections/elevenlabs.json (written by save_eleven;
   git-ignored, though it holds no secret), else the older .data/eleven-agent-id (the id alone). A plan that is not
   known counts as usable.
2. claude: Claude, by the transport a session would take now (coach.claude_transport): "api" when the user saved an
   Anthropic API key (coach.KEY_FILE) and the API has not refused it, else "cli". Through the API it is usable with a
   key the API took or has not answered about yet ("api": {configured, ok, error, warning}; the check reads the coach's
   model, GET /v1/models/<id>: free, no tokens; a key file other users can open is a warning; the key itself is never
   given out). Through the CLI, the Claude Code CLI
   signed in (`claude auth status --json`): server/coach.py runs `claude -p` with the pose MCP server, on the user's
   own login (never an API key: the check, like the coach, runs without ANTHROPIC_API_KEY).
3. chatgpt: the Codex CLI signed in with ChatGPT (`codex login status`). server/coach.py runs `codex exec` with the
   same MCP server and instructions.
4. none: the engine's own cues.

The checks run with a short timeout and are kept for a minute (one that itself failed, for CHECK_FAILED_TTL_S;
status(fresh=True), after a sign-in, checks again). A CLI's "error" says why it cannot be used, or is None when it can:
not found, not signed in (for Codex, also: signed in with an API key), or the check itself failed: it "did not answer"
in time, "could not run", or gave an answer it "could not read" (web/js/connections.js tells the last three apart from
a definite answer by those words; the API check's own failure "did not answer" too). What the CLIs print (an email, an
organisation, part of a key) never leaves this module: only whether they are signed in, and the plan's name.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from datetime import date
from pathlib import Path

import coach

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / ".data" / "connections"            # the ElevenLabs agent record (tests point these two elsewhere)
LEGACY = ROOT / ".data" / "eleven-agent-id"     # the agent id alone, from before the record
ORDER = ["eleven", "claude", "chatgpt"]
AGENT_ID = re.compile(r"agent_[a-z0-9]{20,40}")
PLAN = re.compile(r"[a-z0-9][a-z0-9 _-]{0,39}")  # an ElevenLabs plan's name: free, starter, creator, pro, ...
CHECK_TTL_S = 60
CHECK_FAILED_TTL_S = 10                          # a check that timed out or could not run is tried again sooner
FRESH_S = 2                                      # status(fresh=True) takes a check this recent as it is
CHECK_TIMEOUT_S = 5                              # measured: 0.2-1 s for either CLI on an M3


# --- the ElevenLabs agent ---------------------------------------------------------------------------------------------
def _record(f: Path) -> dict | None:
    try:
        rec = json.loads(f.read_text())
    except (OSError, ValueError):
        return None
    return rec if isinstance(rec, dict) and AGENT_ID.fullmatch(str(rec.get("agentId", ""))) else None


def eleven_record() -> dict | None:
    """The saved agent record, or None (none saved, unreadable, or not an agent id)."""
    return _record(DIR / "elevenlabs.json")


def eleven_agent_id() -> str | None:
    """The agent the page talks to: POSE_ELEVEN_AGENT, else the record, else the legacy file (each only if it is an
    agent id). /api/config gives the page this one too."""
    env = os.environ.get("POSE_ELEVEN_AGENT", "").strip()
    if AGENT_ID.fullmatch(env):
        return env
    rec = eleven_record()
    if rec:
        return rec["agentId"]
    try:
        legacy = LEGACY.read_text().strip()
    except OSError:
        return None
    return legacy if AGENT_ID.fullmatch(legacy) else None


def _text(v) -> str | None:
    return v if isinstance(v, str) and v else None


def eleven_status() -> dict:
    agent = eleven_agent_id()
    rec = eleven_record() or {}
    rec = rec if rec.get("agentId") == agent else {}    # the record tells of its own agent (not POSE_ELEVEN_AGENT's)
    plan = _text(rec.get("plan"))
    return {"connected": agent is not None, "agentId": agent, "name": _text(rec.get("name")), "plan": plan,
            "paid": None if plan is None else plan.lower() != "free", "llm": _text(rec.get("llm"))}


def save_eleven(agent_id, plan) -> dict:
    """Saves the agent the page should use (mode 0600). The same agent again keeps what the record says about it (its
    name and LLM, set when it was created), also when it was forgotten in between (the page cannot send them again);
    another agent starts a new record."""
    if not isinstance(agent_id, str) or not AGENT_ID.fullmatch(agent_id):
        raise ValueError("agentId must be an ElevenLabs agent id (agent_ and 20-40 lower-case letters or digits)")
    if plan is not None and not (isinstance(plan, str) and PLAN.fullmatch(plan)):
        raise ValueError("plan must be an ElevenLabs plan's name in lower case (free, starter, pro, ...) or null")
    old = next((r for r in (eleven_record(), _record(DIR / "elevenlabs.json.forgotten"))
                if r and r["agentId"] == agent_id), None)
    rec = {**(old or {"setUp": date.today().isoformat()}), "agentId": agent_id, "plan": plan}
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = DIR / f".elevenlabs-{os.getpid()}-{threading.get_ident()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(rec, f, indent=1)
    os.chmod(tmp, 0o600)                                # (a leftover tmp file would keep its own mode)
    os.replace(tmp, DIR / "elevenlabs.json")            # whole or not at all: a reader never sees half a record
    return rec


def forget_eleven() -> None:
    """Forgets the agent: the record and the legacy id file are moved aside (*.forgotten; neither holds a secret, and the
    agent itself stays in the ElevenLabs workspace). POSE_ELEVEN_AGENT, when set, still names one."""
    for f in (DIR / "elevenlabs.json", LEGACY):
        if f.is_file():
            os.replace(f, f.with_name(f.name + ".forgotten"))


# --- the CLIs ---------------------------------------------------------------------------------------------------------
# Each check gives {"available", "loggedIn", ..., "error", "failed"}: failed (kept here, not given out) when the check
# itself gave no answer, so it is kept for less time.
def _run(cmd: list[str], env: dict) -> tuple[subprocess.CompletedProcess | None, str | None]:
    """A CLI check: (its result, None) or (None, why it gave none)."""
    try:
        return subprocess.run(cmd, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              timeout=CHECK_TIMEOUT_S), None
    except subprocess.TimeoutExpired:
        return None, f"{Path(cmd[0]).name} {' '.join(cmd[1:])} did not answer in {CHECK_TIMEOUT_S} s"
    except OSError as e:
        return None, f"{Path(cmd[0]).name} could not run ({type(e).__name__})"


def check_claude() -> dict:
    cli = coach.claude_cli()
    if not cli:
        return {"available": False, "loggedIn": False, "plan": None, "error": "the claude CLI was not found",
                "failed": False}
    r, err = _run([cli, "auth", "status", "--json"], coach.claude_env())
    try:
        info = json.loads(r.stdout) if r else {}
        if not isinstance(info, dict):
            raise ValueError
    except ValueError:
        info, err = {}, "claude auth status gave an answer it could not read"
    logged = info.get("loggedIn") is True
    plan = info.get("subscriptionType")                 # max, pro, ... (its email and organisation stay here)
    return {"available": True, "loggedIn": logged,
            "plan": plan if logged and isinstance(plan, str) and PLAN.fullmatch(plan) else None,
            "error": err or (None if logged else "not signed in: sign in with claude auth login"), "failed": bool(err)}


def check_chatgpt() -> dict:
    cli = coach.codex_cli()
    if not cli:
        return {"available": False, "loggedIn": False, "error": "the codex CLI was not found", "failed": False}
    r, err = _run([cli, "login", "status"], coach.codex_env(cli))
    said = (r.stdout + r.stderr) if r else ""            # (it answers on stderr)
    logged, failed = "Logged in using ChatGPT" in said, err is not None
    if not err and not logged:
        # with an API key it prints part of the key: only the fact goes out
        err = ("signed in with an API key, not ChatGPT: run codex login" if "API key" in said
               else "not signed in with ChatGPT: run codex login")
    return {"available": True, "loggedIn": logged, "error": err, "failed": failed}


def key_warning() -> str | None:
    """A warning (not an error: the key still works) when the key file's mode lets other users of this machine open
    it (the docs' umask 077 sets no mode on a file that was already there). From its mode alone: it is not read for
    this."""
    try:
        mode = coach.KEY_FILE.stat().st_mode
    except OSError:
        return None
    if not mode & 0o077:
        return None
    try:
        shown = coach.KEY_FILE.relative_to(ROOT)
    except ValueError:
        shown = coach.KEY_FILE
    return f"the key file is mode {mode & 0o777:o}, open to other users of this machine: chmod 600 {shown}"


def check_api() -> dict:
    """The Anthropic API with the user's key: {"configured": a key saved, "ok": True when the API reads the coach's
    model with it, False when it refused the key (or the request), None when not known (no key, or the check got no
    answer: failed), "error", "warning" (key_warning), "failed"}. The key goes to the client alone; an error holds none
    of it (coach.scrub)."""
    key = coach.api_key()
    if not key:
        return {"configured": False, "ok": None, "error": None, "warning": None, "failed": False}
    warning = key_warning()
    if coach.sdk() is None:
        return {"configured": True, "ok": False, "error": "the anthropic package is not installed (.venv)",
                "warning": warning, "failed": False}
    try:
        coach.api_client(key, timeout=CHECK_TIMEOUT_S, max_retries=0).models.retrieve(coach.model_id())
    except Exception as e:  # noqa: BLE001 - every way it fails is an answer for the page
        kind, why = coach.api_failure(e, key)
        if kind == "transient":                         # (the words the page reads a failed check by)
            return {"configured": True, "ok": None, "error": f"the Anthropic API did not answer ({why})",
                    "warning": warning, "failed": True}
        return {"configured": True, "ok": False, "error": why, "warning": warning, "failed": False}
    return {"configured": True, "ok": True, "error": None, "warning": warning, "failed": False}


class Cached:
    """A check kept for CHECK_TTL_S (one that itself failed, for CHECK_FAILED_TTL_S: a slow answer at start-up does not
    hide a CLI from Auto for a minute). Callers that arrive while it runs wait for that run instead of starting
    another."""

    def __init__(self, run):
        self.run, self.lock, self.at, self.value = run, threading.Lock(), 0.0, None

    def get(self, max_age: float | None = None) -> dict:
        """The check's answer, checked again if it is older than max_age (default CHECK_TTL_S)."""
        with self.lock:
            ttl = CHECK_TTL_S if max_age is None else max_age
            if self.value is not None and self.value.get("failed"):
                ttl = min(ttl, CHECK_FAILED_TTL_S)
            if self.value is None or time.monotonic() - self.at > ttl:
                self.value, self.at = self.run(), time.monotonic()
            return self.value

    def clear(self) -> None:
        with self.lock:
            self.value = None

    def peek(self) -> dict | None:
        """The answer kept, however old, without checking or waiting for a check that runs (None if there is none)."""
        return self.value


CLAUDE = Cached(check_claude)
CHATGPT = Cached(check_chatgpt)
ANTHROPIC = Cached(check_api)


def status(fresh: bool = False) -> dict:
    """GET /api/connections: every connection, and the first usable one in ORDER ("auto"). fresh (?fresh=1, the page's
    Check again, after a sign-in): the CLIs are checked again, unless a check ended in the last FRESH_S (so a page that
    asks for it over and over runs each CLI that often at most)."""
    age = FRESH_S if fresh else None
    got: dict = {}
    side = [threading.Thread(target=lambda k=k, c=c: got.update({k: c.get(age)}), daemon=True)   # side by side, if
            for k, c in (("claude", CLAUDE), ("api", ANTHROPIC))]                                  # not kept
    for t in side:
        t.start()
    chatgpt = CHATGPT.get(age)
    for t in side:
        t.join()
    claude = got.get("claude") or CLAUDE.get(age)
    api = got.get("api") or ANTHROPIC.get(age)
    if bool(coach.api_key()) != api["configured"]:
        # a key saved (or removed) since the check kept: checked again, so that the transport (from the key file now)
        # and the check agree. Measured: just after a key was saved, transport "api" with configured False, and
        # Claude unusable either way for up to CHECK_TTL_S although Claude Code was signed in
        ANTHROPIC.clear()
        api = ANTHROPIC.get()
    transport = coach.claude_transport(api["ok"])
    eleven = eleven_status()
    usable = {"eleven": eleven["connected"] and eleven["paid"] is not False,
              # (a key the API has not answered about yet is tried: the session ends with an error if it is refused)
              "claude": (api["configured"] and api["ok"] is not False) if transport == "api" else claude["loggedIn"],
              "chatgpt": chatgpt["loggedIn"]}
    return {
        "eleven": eleven,
        "claude": {"available": claude["available"], "loggedIn": claude["loggedIn"], "plan": claude["plan"],
                   "model": coach.model_id(), "effort": coach.EFFORT, "fast": coach.FAST, "error": claude["error"],
                   "transport": transport,
                   "api": {"configured": api["configured"], "ok": api["ok"], "error": api["error"],
                           "warning": api.get("warning")}},
        "chatgpt": {"available": chatgpt["available"], "loggedIn": chatgpt["loggedIn"], "model": coach.CHATGPT_MODEL,
                    "error": chatgpt["error"]},
        "order": list(ORDER),
        "auto": next((k for k in ORDER if usable[k]), "none"),
    }
