"""Coach sessions: the pose engine (in the page) measures, a model session turns its events into short spoken cues. Each
session has a brain:

- "claude": Sonnet at effort high by default (POSE_COACH_MODEL, POSE_COACH_EFFORT), by one of two transports
  (POSE_CLAUDE_TRANSPORT: auto, the default, takes "api" when the user saved a key, else "cli"):
  - "api": the Anthropic API through its Python SDK, on the user's own key (KEY_FILE: .data/connections/anthropic-key,
    git-ignored, mode 0600; POSE_ANTHROPIC_KEY_FILE elsewhere). A worker thread (Session._api_loop) sends each event as
    one user message and speaks the reply, while the page still waits for it. The key goes to the client alone (and
    the client to api.anthropic.com alone): never into a log, a status, an error or the environment.
  - "cli": Claude Code (`claude -p`) connected over MCP (server/pose_mcp.py), headless on the user's own Claude login
    (never a key: claude_env), the same pattern as BuildNorth's /mcp server. Fast mode only with POSE_COACH_FAST=1 on
    an Opus model: the CLI has it for Opus alone, and it needs extra usage on the plan.
- "chatgpt": Codex (`codex exec`) signed in with ChatGPT, GPT-6 Luna (POSE_CHATGPT_MODEL), with the same MCP server and
  instructions. codex exec ends when the model ends its turn; while the session is open it is started again (Session.
  _supervise), and when it cannot keep going the session ends, so the page moves on to its next connection.

Flow: page -> push_event() -> queue -> the model calls wait_for_event -> it calls say(text) -> said list -> page speaks
(on the API transport the worker takes the events from the same queue and says the model's replies).
The page speaks the engine's own template message if no cue arrives in time, so a slow or missing session never leaves
a fault unspoken. What the user says comes the same way, as user_said events: the page listens, Parakeet on this Mac
writes the words down (server/stt.py), and the model answers them or confirms what the page did with them; an empty
say is words not meant for it.

Besides the 13 exercises the engine counts, the user can name a movement of the movement library (a stretch, a dance,
a flow, ...; POSE_MOVES_DIR/library.json, built by tools/build_moves.mjs, private): the page tracks the one named (a
hold timer, time moving, or an approximate rhythm) and never recognises one by itself; for a few holds it measures the
form too (web/js/holdform.js), and for some moving and rhythm movements a few guard rails, clear mistakes only
(web/js/moveform.js); the coach never calls a movement's form right or wrong unless it was measured.
describe() reads those events, and a session's instructions list the library's names when it is there
(system_prompt()).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections import deque
from pathlib import Path

import claude_code

MODEL = os.environ.get("POSE_COACH_MODEL", "sonnet")
EFFORT = os.environ.get("POSE_COACH_EFFORT", "high")   # measured on Haiku: high costs no extra delay on these short cues
# the CLI has fast mode on Opus models only (elsewhere, or without extra usage, its init line says fast_mode_state off)
FAST = os.environ.get("POSE_COACH_FAST") == "1" and "opus" in MODEL.lower()
CHATGPT_MODEL = os.environ.get("POSE_CHATGPT_MODEL", "gpt-6-luna")
BRAINS = ("claude", "chatgpt")
# where the coach's CLI runs: an empty folder outside any checkout. Claude Code reads the CLAUDE.md files of every folder
# above its working directory and keys its auto memory by it; inside this repo that meant BuildNorth's CLAUDE.md and the
# BuildNorth project's memory (measured: 1562 input tokens for a first cue, 940 here with --setting-sources "")
COACH_CWD = Path(tempfile.gettempdir()) / "pose-coach-coach"
# what the CLI's aliases name today (its init line reports the model it runs), for /api/connections
ALIASES = {"sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5", "haiku": "claude-haiku-5-5"}
IDLE_LIMIT_S = 300
CONNECT_LIMIT_S = 60       # a codex process that has not asked for an event by then is stuck: it is ended (a failed run)
RECONNECT_LIMIT_S = 20     # ... for a run started again (measured: 5-7 s to connect), while the page shows it connected
RESTARTS = 2               # a codex that keeps failing (see _supervise) is started again this often, then given up on
RECAP = 6                  # cues a restarted codex is told it already said
# Codex's own tools, off: like `--tools ""` for Claude, the coach gets only the pose tools (no shell; it still has
# apply_patch, which the read-only sandbox refuses). code_mode_host stays: Codex reaches MCP tools through it.
CODEX_OFF = ("shell_tool", "unified_exec", "view_image", "image_generation", "browser_use", "computer_use", "apps",
             "plugins", "multi_agent", "goals", "tool_suggest", "skill_search", "sleep_tool", "in_app_browser",
             "personality")
HERE = Path(__file__).resolve().parent
VENV_PY = HERE.parent / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
# the movement library the page offers (tools/build_moves.mjs; git-ignored): read for the movements' names, how each is
# tracked and its coaching notes. Missing, the readings use what the event itself says.
LIBRARY = Path(os.environ.get("POSE_MOVES_DIR") or HERE.parent / ".data" / "moves") / "library.json"
# --- the API transport (Claude through the Anthropic SDK, on the user's own key) ---
TRANSPORT = os.environ.get("POSE_CLAUDE_TRANSPORT", "auto").strip().lower()      # auto | api | cli
# POSE_COACH_LOG=0: no session log. A log (DATA/coach/session-<id>.jsonl) keeps what the coach was sent and what it
# answered: the measured events and, with Talk to coach, the user's transcribed words. The Windows app's camera server
# (win/local-voice/camera.ps1) turns it off.
KEEP_LOG = os.environ.get("POSE_COACH_LOG", "1").strip().lower() not in ("0", "off", "no", "false")
KEY_FILE = Path(os.environ.get("POSE_ANTHROPIC_KEY_FILE") or HERE.parent / ".data" / "connections" / "anthropic-key")
THINKING = os.environ.get("POSE_CLAUDE_THINKING", "between_tools").strip().lower()   # between_tools | adaptive
API_URL = "https://api.anthropic.com"   # the key goes here and nowhere else (api_client)
API_MAX_TOKENS = 400       # a cue is at most 50 words (about 70 tokens); between_tools spends none of it on thinking
# adaptive thinking counts toward max_tokens too (from effort medium up the model thinks before almost every reply): at
# 400 most replies ended at max_tokens with no text. The 50-word rule still bounds the cue, and the page's wait its time
API_MAX_TOKENS_THINKING = 8000
# The page speaks the engine's sentence when no cue came in its wait (web/js/app.js FALLBACK_MS: 3 s; REPLY_MS, 10 s,
# for an answer to the user's words), counted from when it sent the event, and skips a cue that comes later: a request
# is worth making only within that wait (fresh)
PAGE_WAIT_S = 3.0
ANSWER_WAIT_S = 10.0
API_TIMEOUT_S = 10.0       # per attempt (the longest wait above): the SDK's default is 10 minutes
API_CONNECT_S = 3.0        # ... and to connect
# One retry of our own, not the SDK's (max_retries 0): the SDK follows any retry-after, however long (SDK 2.1.0: one 429
# with retry-after 60 kept the worker a minute, the page shown a healthy coach), and a retry is worth making only
# while the event is fresh. For a connection error or timeout, 408, 409, 429 and 5xx; after API_RETRY_S, or the API's
# retry-after up to API_RETRY_MAX_S (a longer one is cut to it).
API_RETRY_S = 0.5
API_RETRY_MAX_S = 2.0
API_POLL_S = 30            # the worker's wait for an event (an idle wait is waited again, as wait_for_event does)
API_FAILURES = 3           # events in a row whose request failed (after its retry) before the session gives up
MISSED_MAX = 6             # earlier events the page handled without the model, told with the next one (the latest)
FALLBACK_BETA = "server-side-fallback-2026-07-01"    # the header of fallbacks="default" (the array form has another)
KEY_REFUSED = "the Anthropic API refused the key (check .data/connections/anthropic-key)"
SPOKEN_MAX = 400           # characters of a cue, as /api/coach/say takes them


def model_id() -> str:
    return ALIASES.get(MODEL, MODEL)


def sdk():
    """The Anthropic SDK (in .venv), or None without it: only the API transport needs it."""
    try:
        import anthropic
    except ImportError:
        return None
    return anthropic


def open_log(path: Path, mode: str):
    """A session's log file, or nowhere (os.devnull) with POSE_COACH_LOG=0."""
    return open(path if KEEP_LOG else os.devnull, mode)


def api_key() -> str | None:
    """The user's Anthropic API key (KEY_FILE, read afresh each time), or None when there is none (no file, an empty
    one, unreadable). It goes to the client alone (api_client): never into a log, a status, an error or os.environ."""
    try:
        return KEY_FILE.read_text().strip() or None
    except (OSError, UnicodeDecodeError):
        return None


def claude_transport(key_ok: bool | None = None) -> str:
    """How a Claude session reaches Claude: POSE_CLAUDE_TRANSPORT when it is api or cli; else (auto) "api" when the
    user saved a key and the SDK is installed, unless the API check found the key refused (key_ok False: the page's
    connection check, server/connections.py), and "cli" (Claude Code on the user's login) otherwise."""
    if TRANSPORT in ("api", "cli"):
        return TRANSPORT
    return "api" if key_ok is not False and api_key() and sdk() else "cli"


def api_client(key: str, timeout: float = API_TIMEOUT_S, max_retries: int = 0):
    """The Anthropic client, with the key passed in (no ANTHROPIC_API_KEY anywhere: the CLI keeps the user's Claude
    login), to API_URL alone: the SDK otherwise reads ANTHROPIC_BASE_URL, which Claude Code and gateways set (a server
    started from a Claude Code shell inherits it), and would send the key there; and it merges ANTHROPIC_CUSTOM_HEADERS
    into every request whatever headers are passed, so each of those is named here as Omit (dropped). No retries of
    its own by default (_answer makes its one). The tests put a stand-in here: they never call the API."""
    a = sdk()
    env_headers = {line.partition(":")[0].strip(): a.Omit()             # (split as SDK 2.1.0 splits it)
                   for line in os.environ.get("ANTHROPIC_CUSTOM_HEADERS", "").split("\n") if ":" in line}
    return a.Anthropic(api_key=key, base_url=API_URL, default_headers=env_headers, max_retries=max_retries,
                       timeout=a.Timeout(timeout, connect=min(API_CONNECT_S, timeout)))


def thinking_config() -> dict:
    """between_tools, the lowest setting (no extended thinking: a cue must come fast), which only Claude Sonnet 5.5
    takes, at effort high or below; adaptive thinking on another model, at xhigh or max (where between_tools is a 400),
    or with POSE_CLAUDE_THINKING=adaptive."""
    if THINKING != "adaptive" and model_id() == "claude-sonnet-5-5" and EFFORT not in ("xhigh", "max"):
        return {"type": "between_tools"}
    return {"type": "adaptive"}


def max_tokens() -> int:
    """A request's max_tokens: API_MAX_TOKENS with no thinking (between_tools), else API_MAX_TOKENS_THINKING."""
    return API_MAX_TOKENS if thinking_config()["type"] == "between_tools" else API_MAX_TOKENS_THINKING


def page_wait(ev: dict) -> float:
    """How long the page waits for event ev's cue: PAGE_WAIT_S, or ANSWER_WAIT_S for the user's words when the page
    did nothing with them (it waits that long for an answer; one it acted on waits as a cue does)."""
    return ANSWER_WAIT_S if ev.get("kind") == "user_said" and not ev.get("applied") else PAGE_WAIT_S


def fresh(ev: dict, queued: float | None, after: float = 0.0) -> bool:
    """Whether a cue for ev, queued at `queued` (monotonic), can still come within the page's wait `after` seconds from
    now. (The page counts an answer's wait from when the user stopped talking, a little before it was queued: the
    transcription.)"""
    return queued is None or time.monotonic() + after - queued < page_wait(ev)


def retry_wait(e: Exception) -> float | None:
    """How long to wait before the one retry of a request that failed with e, or None when it is not worth one (an
    answer that will not change, or the API saying so: x-should-retry false). API_RETRY_S, or the API's retry-after
    up to API_RETRY_MAX_S."""
    a = sdk()
    if isinstance(e, a.APIConnectionError):                    # (APITimeoutError is one)
        return API_RETRY_S
    if not isinstance(e, a.APIStatusError) or not (e.status_code in (408, 409, 429) or e.status_code >= 500):
        return None
    h = e.response.headers
    if h.get("x-should-retry") == "false":
        return None
    try:
        after = float(h["retry-after-ms"]) / 1000 if "retry-after-ms" in h else float(h.get("retry-after") or "nan")
    except ValueError:                                         # (an HTTP date: a long wait, cut as any)
        after = API_RETRY_MAX_S
    return min(after, API_RETRY_MAX_S) if after > 0 else API_RETRY_S


def scrub(text, key: str | None) -> str:
    """One line of an error for a log or the page, with the key (or anything shaped like one) taken out: the API's own
    messages never hold it, and this keeps it so."""
    s = " ".join(str(text or "").split())                    # (whole before it is cut: no half key is left)
    if key:
        s = s.replace(key, "[key]")
    return one_line(re.sub(r"sk-ant-[A-Za-z0-9_-]+", "[key]", s), 300)


def api_failure(e: Exception, key: str | None) -> tuple[str, str]:
    """How an API call failed, most specific first (the SDK's exception classes): ("refused", KEY_REFUSED) for a key
    the API turned away (401, 403); ("transient", why) for what the SDK retries and may pass (a connection error or
    timeout, 408, 409, 429, 5xx and 529 overloaded, which in SDK 2.1.0 is not an InternalServerError), or anything
    unexpected; ("fatal", the API's message) for any other answer: 400, 404 (the model), 402 billing, 413."""
    a = sdk()
    if a is None:
        return "fatal", "the anthropic package is not installed (.venv)"
    if isinstance(e, (a.AuthenticationError, a.PermissionDeniedError)):
        return "refused", KEY_REFUSED
    if isinstance(e, a.APIConnectionError):                    # (APITimeoutError is one)
        return "transient", type(e).__name__
    if isinstance(e, a.APIStatusError):
        if e.status_code in (408, 409, 429) or e.status_code >= 500:
            return "transient", f"{type(e).__name__} {e.status_code}"
        err = e.body.get("error") if isinstance(e.body, dict) else None
        said = err.get("message") if isinstance(err, dict) and err.get("message") else e.message
        return "fatal", scrub(f"the Anthropic API answered {e.status_code}: {said}", key)
    return "transient", scrub(f"{type(e).__name__}: {e}", key)


def echo(content: list) -> list:
    """An assistant turn as it goes back into the history: the response's blocks unchanged (thinking blocks too: the
    model reads its own notes back, and the API checks that history is not edited), except, after a fallback, the
    thinking and tool blocks of the model that declined before the last fallback block (the fallback model cannot read
    them; a non-streaming response leaves the declined attempt out anyway, so this rarely drops anything)."""
    marks = [i for i, b in enumerate(content) if getattr(b, "type", None) == "fallback"]
    if not marks:
        return list(content)
    drop = ("thinking", "redacted_thinking", "tool_use", "server_tool_use")
    return [b for i, b in enumerate(content) if i > marks[-1] or getattr(b, "type", None) not in drop]


def fallbacks(content: list) -> list[str]:
    """A response's fallback blocks, one per model that declined: "claude-sonnet-5-5 -> claude-sonnet-5"."""
    def model(b, side: str):
        return getattr(getattr(b, side, None), "model", None)
    return [f"{model(b, 'from_')} -> {model(b, 'to')}" for b in content if getattr(b, "type", None) == "fallback"]


def complete(text: str) -> bool:
    """A reply cut at max_tokens is spoken only if it still ends as a sentence does."""
    return bool(re.search(r"[.!?][\"')\]]*$", text))


def claude_cli() -> str | None:
    """The claude CLI: on PATH, else where its installer puts it, else (Windows) the Claude desktop app's copy."""
    return claude_code.find_cli()


def nvm_bins() -> list[Path]:
    """Where npm under nvm puts its commands: the node in use ($NVM_BIN), nvm's default ($HOME/.nvm/alias/default: 23 or
    v23.5.0, say), then every installed node, newest first. A server started without nvm on PATH (from launchd or an
    app) finds an npm install there."""
    nvm = Path(os.environ.get("NVM_DIR") or Path.home() / ".nvm")
    nodes = sorted((nvm / "versions" / "node").glob("v*"), reverse=True,
                   key=lambda d: tuple(int(n) for n in re.findall(r"[0-9]+", d.name)[:3]))
    try:
        alias = (nvm / "alias" / "default").read_text().strip().lstrip("v")
    except OSError:
        alias = ""                                  # (or an alias such as lts/*, not a version: the newest node then)
    default = [d for d in nodes if alias[:1].isdigit() and (d.name[1:] == alias or d.name[1:].startswith(alias + "."))]
    in_use = [Path(os.environ["NVM_BIN"])] if os.environ.get("NVM_BIN") else []
    return [*in_use, *(d / "bin" for d in default + nodes)]


def codex_cli() -> str | None:
    """The codex CLI: on PATH, else where npm (under nvm too) or Homebrew put it."""
    for p in (shutil.which("codex"), Path.home() / ".local/bin/codex", "/opt/homebrew/bin/codex",
              "/usr/local/bin/codex", *(d / "codex" for d in nvm_bins())):
        if p and Path(p).is_file():
            return str(p)
    return None


def claude_env() -> dict:
    """The user's Claude Code sign-in only: no ANTHROPIC_* or CLAUDE* variable (a key, a gateway, a parent session's)."""
    return claude_code.clean_env(claude_cli())


def codex_env(cli: str) -> dict:
    """The user's ChatGPT login, not a key; and npm's codex is a node script, so the node installed beside it (nvm:
    codex_cli looks there) is found even when the server was started without it on PATH."""
    env = {k: v for k, v in os.environ.items() if k not in ("OPENAI_API_KEY", "CODEX_API_KEY")}
    env["PATH"] = os.pathsep.join([str(Path(cli).parent), env.get("PATH", "")])
    return env

# The coach's instructions, one text for every coach: its {how} and {silent} parts differ between the MCP tools (Claude
# Code and Codex) and the API transport, where the reply itself is what is spoken. SYSTEM is the MCP one.
SYSTEM_TEMPLATE = """\
You are Rhythm, a personal fitness coach talking to the user during their workout, through their speaker.
You do not see video. A pose tracker measures the user's joints 30 times a second and raises events: form faults with
the measured angle or position, fixes, clean streaks, set summaries, and body parts out of view. In a workout the
tracker recognises the exercise itself: it tells you when a set of an exercise starts (and which set of it this is),
when a set ends, and gives a summary of the whole workout at the end. It counts these exercises and no other: squat,
squat pulses, push-up, lunge, lateral raise, front raise, biceps curl, triceps kickback, overhead press, deadlift or
hinge, jump, jumping jack, knee raise.

Besides those exercises, the user can name another movement from the movement library: a stretch, a yoga pose or a
balance, a flow, a dance, a gym move with no rep counter, or a transition such as kneeling and standing up.
The tracker never recognises one of these by itself, and neither do you: keep track only of the movement the user
named, and only with what the tracker reports. Reps are counted only for the exercises above; while another movement
is named, no reps are counted. You hear of a named movement as movement_set, or as the user's words with what the page
did. Then:
- movement_set: confirm it in a few words and say what you will keep track of: the hold time, the time moving, or an
  approximate rhythm, or technique checks without counting.
- technique_result: judge this attempt alone, using only its measured checks and cue. Never count punches or attempts.
  An incomplete jab–cross is not a clean one-two. Unmeasured extension or hip/shoulder rotation is never called correct.
  A fault's correction comes as form_fault. If its result has no cue, the correction was already given: {silent}.
- hold_start, hold_progress, hold_end (a stretch, a pose or a balance): when they settle into it, the correction of a
  fault the event measured, else one short cue on what to keep (use the event's notes); with the progress, the time
  held ("twenty seconds, keep breathing"); at the end, how long they held it. A hold of a few seconds needs no word when
  it ends: {silent}. The hold is timed as a whole: never offer to time each side or leg.
- hold_fault (a fault measured in the hold): give its correction in a few words. hold_fix: praise that fix in a few
  words.
- form_fault (a clear mistake measured while they move, in a flow, a dance, a transition or a gym move with no rep
  counter): give its correction in a few words. form_fix: praise that fix in a few words. These checks look for a few
  clear mistakes only: never call such a movement's form good as a whole.
- form_unseen (while they do a movement or hold a pose, every part its form is checked by is out of the picture, or
  the camera angle cannot show the check): ask them in a few words to step back or turn as the event
  says. Their form is not being checked meanwhile: never call it right or wrong.
- moving_progress (a flow, a dance, or kneeling and standing up): a few words of encouragement with the time.
- rhythm_progress (a gym move with no rep counter): the count is approximate: always say "about" with it, never give it
  as an exact count of reps.
- The notes of a movement are form cues, what to look for; they never make a count or a time that the events did
  not give, and you never offer to count or time anything the events do not.
- If they name a movement that is neither one of the exercises nor in the library, tell them you can't track that one.

The user may talk to you: while the page listens to them, what they say is transcribed on their computer and comes to
you as a user_said event with their words (a transcript can have small slips). Their voice reaches you only that way,
and the page is not always listening. They can always answer with buttons on screen. The tracker has you ask them two
things:
- ask_exercise (the workout is starting): greet them if you have not yet, and ask what they are about to do: an
  exercise, or another movement. They can tap it on screen, say it, or just start. You are told what they picked
  (exercise_set, movement_set, or their words with what the page did); if they do not answer, you are told the
  tracker will recognise the exercise as they go (exercise_auto).
- confirm_set_end (the tracker thinks a set is over): give the reps it counted and ask if they are done with this set
  ("That's eight squats. Done with this set?"). If they tap Done, the set ends and you are told (set_end); if they say
  so, you get their words with what the page did; if they tap Not yet or carry on, the set goes on.
Ask without telling them how to answer: the buttons are on screen. If the event says they cannot talk to you right
now, never ask them to say it. For exercise_set, confirm their choice in a few words ("Squats, got it."); for
exercise_auto, say in a few words that you will spot the exercise as they go. Ask nothing else of your own accord.

When the user talks to you (user_said):
- If the event says what the page did with their words (it switched the exercise or the movement, went back to
  recognising the exercise, ended the set or let it go on), confirm that in a few words of your own. Do not ask again.
- Never confirm a choice or a switch of exercise or movement, nor the end of a set, unless the event says the page did
  it. When it says the page changed nothing, nothing changed: if they named an exercise the tracker does not count and
  no movement of the library, tell them it cannot count or track that one; if they want one it counts or a movement of
  the library, tell them to tap it, or to say it again as a short switch ("switch to lunges"). With no workout running
  nothing is counted: they press Start to begin one.
- Otherwise answer them, in two or three short spoken sentences, at most 50 words. During a set (after its set_start,
  before its set_end) or a hold keep it to a few words: they are mid-rep.
- Answer from general fitness knowledge: technique, breathing, tempo, rest, warm-up, sets and reps. About this workout
  say only what the events told you: never invent a measurement, a count or a fault. If you were not told, say so.
- If they mention pain, dizziness or an injury, tell them to stop that exercise, give only general advice, and
  suggest they see a doctor or a physiotherapist if it goes on. Never diagnose.
- Words not meant for you (counting out loud, breathing, talking to someone else, music, a fragment that makes no
  sense): {silent}, and nothing is spoken.
- They may talk to you before a workout starts or between workouts: answer the same way.

{how}

What you say:
- One or two short spoken sentences, at most 25 words (a workout summary may use up to 40, an answer to the user up
  to 50). No lists, no emoji, no markdown.
- Coach the specific thing measured: name the body part and what to change or keep doing.
- Use the measurement when it helps ("you stopped about 20 degrees short of parallel"), but never mention sensors,
  trackers, data, events or confidence.
- Only claim what the event says. Never invent a fault or a correction that was not measured. For a fix, praise
  that specific fix. For a counted exercise set summary, give the rep count; if faults were measured, name the most
  frequent one as the focus for the next set; if none were, say the form was clean and encourage them.
- You do not see the user. Never say their form is good, correct or that nothing needs fixing, and never name
  something they do right, unless an event measured it (a hold's form with nothing open, a clean set). If asked whether
  a held pose is right, answer from the last form reading; when its form is not measured, say you can time it but
  cannot check its form, and give its key points as things to check themselves.
- If the event says a demo is playing on screen, you may point the user to it in a few words ("watch the demo").
- When a set starts, name the exercise in a few words so the user knows it was recognised (and, after a switch, the
  reps of the exercise they just finished). Add encouragement, not technique tips: nothing has been measured yet.
  For the workout summary, give each exercise's sets and reps, and the holds and other movements with their times
  (an approximate count with "about").
- Do not address the user by name.
- Vary your wording; do not repeat your previous cue word for word.
- Speak to the user as "you", warmly and directly, like a coach standing next to them."""
MCP_HOW = """\
How you work: call wait_for_event in a loop. For every event that is not idle, call say exactly once with your cue,
then call wait_for_event again. If it returns idle, call it again. When it returns done, stop. Never write text outside
tool calls; only what you pass to say is heard."""
API_HOW = """\
How you work: each message you get is one tracker event (JSON with its summary) or the user's words with what the page
did. Reply with only the words to speak: your reply is read aloud as it is. For words not meant for you, reply with only
a hyphen (-) and nothing is spoken. A message may start with a line on earlier events that the page handled without you
(it spoke its own cue for each): they are past, so reply to the event after that line alone."""
# the line a message starts with when the page handled earlier events without the model (Session._message)
MISSED = "Earlier, handled on screen without you: "
SYSTEM = SYSTEM_TEMPLATE.format(how=MCP_HOW, silent="call say with an empty text")
API_SYSTEM = SYSTEM_TEMPLATE.format(how=API_HOW, silent="reply with only a hyphen (-)")


# a library movement's kind, in the coach's words (library.json `kind`), and what the page does for each `track`
KINDS = {"technique": "a technique exercise without a count", "gym_counted": "an exercise the tracker counts",
         "gym_reps": "a gym move with no rep counter",
         "hold": "a stretch, pose or balance", "flow": "a flow", "dance": "a dance",
         "transition": "a transition, such as kneeling and standing up"}
TRACKING = {"technique": "the page checks each jab–cross attempt without counting", "hold": "the page times the hold",
            "moving": "the page times how long they keep moving",
            "rhythm": "the page keeps an approximate count of the rhythm (there is no rep counter for this move)"}
SHORT_HOLD_S = 5                           # a hold this short needs no cue (the page's engine says nothing for it)
_library: tuple = ("", {})                 # (the file and its stamp, {key: movement})
# A library coaching line mixes form cues with what its author meant to be counted or timed ("Track hold time per
# leg", "No reps", "Not counted by the engine"). The page measures only what web/js/moves.js does (one hold timer, not
# per side; the time moving; an approximate rhythm), so the readings keep the form cues alone: a part of the line
# (split at ; and .) goes if it starts as a tracking instruction or speaks of reps, counts, the engine, a side or a
# leg, or the hold time.
NOT_A_CUE = re.compile(r"^(count|track|note|not counted|no reps)\b"
                       r"|\b(reps?|counts?|counted|counter|engine|per (side|leg)|hold time)\b", re.I)


def form_notes(text) -> str:
    """The form cues of a library coaching line ('' if it has none): "Track hold time per leg; knees together, hips
    square, stand tall." -> "knees together, hips square, stand tall"."""
    parts = (p.strip(" ,:") for p in re.split(r"[;.](?:\s+|$)", one_line(text)))
    return "; ".join(p for p in parts if p and not NOT_A_CUE.search(p))


def library() -> dict:
    """The movement library by key, read again when LIBRARY changes; {} when it is not built (or unreadable)."""
    global _library
    try:
        st = LIBRARY.stat()
        stamp = f"{LIBRARY}:{st.st_mtime_ns}:{st.st_size}"
        if _library[0] != stamp:
            moves = json.loads(LIBRARY.read_text()).get("movements") or []
            _library = (stamp, {m["key"]: m for m in moves if isinstance(m, dict) and isinstance(m.get("key"), str)})
        return _library[1]
    except (OSError, ValueError, AttributeError):
        return {}


def one_line(text, n: int = 300) -> str:
    return " ".join(str(text or "").split())[:n].replace('"', "'")


def movement(ev: dict) -> dict:
    """A named movement as the readings use it: its display name, kind, track and coaching notes (its form cues only:
    form_notes), from the event (a movement_set, a tracker event, `applied` or a summary entry name it as `movement` or
    `key`) and else the library."""
    key = ev.get("movement") or ev.get("key")
    m = library().get(key, {}) if isinstance(key, str) else {}
    display = ev.get("display") or ev.get("movementDisplay") or m.get("display") or (
        str(key).replace("_", " ").capitalize() if key else "the movement")
    return {"key": key, "display": one_line(display, 120), "kind": ev.get("movementKind") or m.get("kind"),
            "track": ev.get("track") or m.get("track"), "coach": form_notes(ev.get("coach") or m.get("coach"))}


def dur(seconds) -> str:
    """Seconds as the coach says them: "45 seconds", "1 minute 5 seconds", "2 minutes"."""
    try:
        s = max(0, round(float(seconds)))
    except (TypeError, ValueError):
        return "a while"
    m, s = divmod(s, 60)
    return " ".join([*([f"{m} minute{'' if m == 1 else 's'}"] if m else []),
                     *([f"{s} second{'' if s == 1 else 's'}"] if s or not m else [])])


def named_reading(m: dict, who: str, set_reps: bool = False) -> str:
    """What the page does now that the user named movement m (`who`: "The user named X" or "The page switched to
    X"), and what the coach is to say. set_reps: naming it ended a set in progress, whose reps `who` gives: the coach
    says them too."""
    with_reps = ", with the reps of the set that ended" if set_reps else ""
    if m["track"] == "technique":
        return (f"{who}: assess each jab–cross attempt independently, without counting punches or attempts. "
                "Only measured checks may be praised; never claim full technique is correct.")
    if m["track"] == "reps":
        return f"{who}: its reps are counted. Confirm in a few words{with_reps}."
    how = f" {TRACKING[m['track']]}, and" if m["track"] in TRACKING else ""
    keep = ("the reps of the set that ended and what you will keep track of" if set_reps else
            "what you will keep track of")
    return f"{who}:{how} no reps are counted meanwhile. Confirm it in a few words, with {keep}."


def moved(entries) -> str:
    """The workout summary's movements: each with its time held or moving, or its approximate count."""
    out = []
    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict):
            continue
        m = movement(e)
        if m["track"] == "technique":
            if e.get("reviewed"):
                out.append(f"{m['display']}: technique reviewed; no count; do not infer the whole technique was correct")
        elif e.get("count") is not None:
            out.append(f"{m['display']}: about {e['count']} reps (an approximate count)")
        elif e.get("seconds") is not None:
            out.append(f"{m['display']}: held {dur(e['seconds'])}" if m["track"] == "hold" else
                       f"{m['display']}: {dur(e['seconds'])} moving")
    return "; ".join(out)


def system_prompt(transport: str = "mcp") -> str:
    """SYSTEM (API_SYSTEM for the API transport), plus the movement library's names and how each is tracked when the
    library is built, so that Claude and ChatGPT know what the user can name (as the agent knows its set_movement tool's
    movements). The names come from the private library at run time: they are not in the repo."""
    base = API_SYSTEM if transport == "api" else SYSTEM
    by_track = {"reps": "counted as the exercise in brackets", "hold": "a hold timer",
                "moving": "the time moving", "rhythm": "an approximate rhythm count", "technique": "technique checks, no counts"}
    lines = []
    for track, how in by_track.items():
        names = [one_line(m.get("display"), 120) + (f" ({str(m['engine']).replace('_', ' ')})"
                                                    if track == "reps" and m.get("engine") else "")
                 for m in library().values() if m.get("track") == track and m.get("display")]
        if names:
            lines.append(f"- {how}: {'; '.join(names)}")
    if not lines:
        return base
    return (f"{base}\n\nThe movement library: what the user can name, and what is kept track of for each.\n"
            + "\n".join(lines))


def sentence(text, n: int = 200) -> str:
    """One line that ends as a sentence does (the page's cues end with a full stop; one that does not gets one)."""
    s = one_line(text, n)
    return s + "." if s and s[-1] not in ".!?" else s


def label_of(f: dict) -> str:
    """A form check's label ("feet too close together"), else its id."""
    return one_line(f.get("label") or str(f.get("fault") or "").replace("_", " "), 120) or "the fault"


def measured(f: dict) -> str:
    """A measured fault as the readings give it: "feet 0.45 leg lengths apart (aim for about one leg length)"."""
    aim = one_line(f.get("target"), 120)
    what = one_line(f.get("measured"), 160) or label_of(f)
    return f"{what} (aim for {aim})" if aim else what


def labels(xs) -> str:
    """Form checks' labels, one line each: "feet too close together, top arm not straight up"."""
    return ", ".join(one_line(x, 120) for x in xs if isinstance(x, str) and x.strip()) if isinstance(xs, list) else ""


def hold_form(event: dict) -> dict:
    """A hold's form as its event gives it (web/js/holdform.js: state() on hold_start and hold_progress, summary() on
    hold_end; a moving or rhythm movement's progress, web/js/moveform.js state(), has the same shape): "faults", its
    open faults (told and still there, the latest told first), or at the end the hold's
    faults ({fault, label, fixed, told}); and the names of its checks, each list as one line: "checked" (measured and
    fine), "pending" (a fault measured but not told yet: its hold_fault comes on its own), "unseen" (parts out of the
    frame) and "wrong_view" (seen side-on: measured only facing the camera). All empty when nothing is measured: a
    movement with no form check (form: null) and a page from before the form check (no form)."""
    form = event.get("form") if isinstance(event.get("form"), dict) else {}
    faults = form.get("open") if "open" in form else form.get("faults")
    return {"faults": [f for f in faults if isinstance(f, dict)] if isinstance(faults, list) else [],
            **{k: labels(form.get(name)) for k, name in (("checked", "checked"), ("pending", "pending"),
                                                         ("unseen", "unseen"), ("wrong_view", "wrongView"))}}


def not_checked(form: dict) -> str:
    """What a hold's reading says of the checks it could not make, and why: the parts are out of the frame (stepping
    back helps) or the view cannot judge them (stepping back does not: turning to face the camera does)."""
    return ((f" Out of view, so not checked: {form['unseen']} (they would step back to be seen whole)."
             if form["unseen"] else "")
            + (f" Not checked from this side: {form['wrong_view']} (it is measured facing the camera: they would "
               "turn towards it)." if form["wrong_view"] else ""))


# what a hold's reading says when its form is not measured (no form check for the movement, or none of it in view): the
# coach does not see the user, yet called a held pose's form good, with nothing to fix, when its feet were half a leg
# length apart and its top arm far from straight up (live, 2026-10-24: the hold events carried no form then)
UNMEASURED = "Its form is not measured: never say it looks right or wrong."
UNMEASURED_END = "Its form was not measured: never say it looked right or wrong."


def hold_reading(kind: str, name: str, event: dict, notes: str) -> str:
    """hold_start, hold_progress and hold_end with the hold's form: the measured fault to correct (the first open one),
    a fault measured whose correction comes next (pending: never fine meanwhile), that the checks found nothing (fine
    only when every check was made: else which were not, and why), or that its form is not measured. At the end, the
    faults the user was told of (a fix is praised only for those: the page marks what the coach really said)."""
    secs = dur(event.get("seconds"))
    form = hold_form(event)
    faults, checked, pending, gaps = form["faults"], form["checked"], form["pending"], not_checked(form)
    # (the page measured a fault it has not told yet, waiting its turn: "fine so far", then that fault a second later,
    # would contradict itself; its hold_fault comes with the correction)
    waiting = f"A fault is measured, its correction to come next on its own ({pending}): do not call the form good."
    if kind == "hold_start":
        settled = f"{name}: the user has settled into the hold."
        if faults:
            cue = sentence(faults[0].get("cue"))
            return (f"{settled} Measured: {measured(faults[0])}. "
                    + (f"Your cue is this correction: {cue}" if cue else "Your cue is its correction, in a few words.")
                    + gaps)
        if pending:
            return f"{settled} {waiting}{gaps} One short cue to keep holding."
        if checked and not gaps:
            return (f"{name}: the user has settled into the hold, measured and fine so far (checked for {checked}: "
                    "none found). One short cue on what to keep.")
        if checked:
            return (f"{settled} Checked for {checked}: none found, but not all of its form.{gaps} One short cue on "
                    "what to keep; never call its form good as a whole.")
        return f"{settled} {UNMEASURED}{gaps} One short cue on what to keep.{notes}"
    if kind == "hold_progress":
        held = f"{name}: held for {secs} so far."
        if faults:
            return (f"{held} Its measured fault is still open: {measured(faults[0])}. Say the time held, with the "
                    "correction still to make in a few words.")
        if pending:
            state = f" {waiting}{gaps}"
        elif checked and not gaps:
            state = " Its form, measured: fine so far."
        elif checked:
            state = f" Its form, measured where it could be: no fault found (checked for {checked}).{gaps}"
        else:
            state = f" {UNMEASURED}{gaps}"
        return f"{held}{state} Say the time held, with a few words to keep it going."
    try:
        short = float(event.get("seconds")) < SHORT_HOLD_S
    except (TypeError, ValueError):
        short = False
    # (as the page's engine: a hold of a few seconds is timed, and counts towards the time held in the summary, but
    # is not worth a word: holds start and end every few seconds when the user shifts in and out of a pose)
    if short:
        return f"{name}: a short hold of {secs} ended. A hold this short needs no cue: say nothing."
    ended = f"{name}: the hold ended after {secs}."
    told = [f for f in faults if f.get("told")]
    # (a fault still there that the user never heard of: not listed, as it was never said, but the form was not fine)
    untold = any(not f.get("told") and not f.get("fixed") for f in faults)
    if told:
        listed = "; ".join(f"{label_of(f)} ({'fixed' if f.get('fixed') else 'not fixed'})" for f in told)
        last = ("and the fault to work on next time" if any(not f.get("fixed") for f in told)
                else "with a word of praise for the fix")
        return (f"{ended} Faults the user was told of in it: {listed}. Say how long they held it {last}, in a few "
                "words" + ("; never call its form good." if untold else "."))
    if untold:
        return (f"{ended} A fault was still measured at its end. Say how long they held it, in a few words; never "
                "call its form good.")
    if checked:
        return (f"{ended} Its form, measured: no fault found (checked for {checked}).{gaps} Say how long they held it, "
                "in a few words.")
    return f"{ended} {UNMEASURED_END}{gaps} Say how long they held it, in a few words."


def move_form(event: dict) -> tuple[str, bool]:
    """A moving or rhythm movement's form on its progress (web/js/moveform.js state(): a few guard rails, clear mistakes
    only), as a clause of the reading, and whether a fault is open (its correction still to make). '' with no form
    (no check for the movement, or no landmarks: form null; a page from before the checks: none), so the reading is
    as it always was. Fine is never said of such a movement as a whole, as its checks cover a few mistakes alone."""
    if not isinstance(event.get("form"), dict):
        return "", False
    form = hold_form(event)
    faults, checked, pending, gaps = form["faults"], form["checked"], form["pending"], not_checked(form)
    if faults:
        return f" Its measured fault is still open: {measured(faults[0])}.", True
    if pending:
        return (f" A fault is measured, its correction to come next on its own ({pending}): do not call the form "
                f"good.{gaps}"), False
    if checked:
        return (f" Checked for {checked}: none found so far; these checks look for a few clear mistakes only, so "
                f"never call its form good as a whole.{gaps}"), False
    return f" {UNMEASURED}{gaps}", False


def listed(xs) -> str:
    """Words as a spoken list: "feet", "legs and arms", "head, arms and feet"."""
    xs = [one_line(x, 40) for x in xs if isinstance(x, str) and x.strip()] if isinstance(xs, list) else []
    return f"{', '.join(xs[:-1])} and {xs[-1]}" if len(xs) > 1 else (xs[0] if xs else "")


def unseen_reading(name: str, event: dict) -> str:
    """form_unseen (web/js/moveform.js; web/js/moves.js for a hold): while they do the movement, every check of its
    form is out of view (`why` 'frame': the body `parts` out of the picture) or seen side-on ('view'), so nothing of it
    is checked. The coach asks them to show it, and calls it neither right nor wrong."""
    checks = labels(event.get("missing"))
    what = f" ({checks})" if checks else ""
    never = "; never call their form right or wrong meanwhile."
    if event.get("why") == "view":
        if event.get("track") == "technique":
            cue = sentence(event.get("cue"))
            return (f"{name}: this camera angle cannot show the check{what}. "
                    f"Ask them to change view as instructed: {cue}{never}")
        return (f"{name}: the tracker sees them side-on, so their form isn't being checked{what}. Ask them in a few "
                f"words to turn to face the camera{never}")
    parts = listed(event.get("parts"))
    seen = f"their {parts}" if parts else "all of them"
    return (f"{name}: the tracker can't see {seen}, so their form isn't being checked{what}. Ask them in a few words "
            f"to step back so you can see {seen}{never}")


def tracked(kind: str, event: dict) -> str | None:
    """The reading of a movement the user named (movement_set) and of its tracker's events (web/js/moves.js): a hold's
    start, time held and end with its measured form (hold_reading), a fault measured in the hold and its fix
    (web/js/holdform.js), the time moving and an approximate rhythm count with their form (move_form), a fault
    measured while moving and its fix (web/js/moveform.js), and the form not checked at all (unseen_reading). None for
    any other kind."""
    if kind not in ("movement_set", "hold_start", "hold_progress", "hold_end", "hold_fault", "hold_fix",
                    "moving_progress", "rhythm_progress", "form_fault", "form_fix", "form_unseen", "technique_result"):
        return None
    m = movement(event)
    name, secs = m["display"], dur(event.get("seconds"))
    notes = f" Form notes: {m['coach']}." if m["coach"] else ""
    what = f" ({KINDS[m['kind']]})" if m["kind"] in KINDS else ""
    count = event.get("count") if event.get("count") is not None else "a few"
    if m["track"] == "technique" and kind == "rhythm_progress":
        return f"{name}: technique only. Ignore any legacy count; do not say a punch or attempt total."
    if kind == "technique_result":
        checked = listed(event.get("checked"))
        limits = listed(event.get("unmeasured"))
        cue = sentence(event.get("cue"))
        return (f"{name}: attempt result {one_line(event.get('verdict'))}; sequence {one_line(event.get('sequence'))}. "
                f"Measured checks: {checked or 'none'}. Not assessed: {limits or 'unspecified'}. "
                f"Never infer that the whole technique is correct, or give a count. {cue or 'The measured correction was already given; say nothing.'}")
    if kind == "movement_set":
        return named_reading(m, f"The user named {name}{what}, from the movement library")
    if kind in ("hold_start", "hold_progress", "hold_end"):
        return hold_reading(kind, name, event, notes)
    if kind in ("hold_fault", "form_fault"):
        cue = sentence(event.get("cue"))
        return f"{name}: measured fault: {measured(event)}. Correct it in a few words" + (f": {cue}" if cue else ".")
    if kind in ("hold_fix", "form_fix"):
        return f"{name}: the user fixed it ({label_of(event)}). Praise that fix in a few words."
    if kind == "form_unseen":
        return unseen_reading(name, event)
    form, still_open = move_form(event)
    if kind == "moving_progress":
        fix = " and the correction still to make" if still_open else ""
        return f"{name}: {secs} of moving so far.{form} A few words of encouragement, with the time{fix}.{notes}"
    fix = ", with the correction still to make in a few words" if still_open else ""
    return (f"{name}: about {count} reps so far, by its rhythm: an approximate count (there is no rep counter for "
            f"this move).{form} Say it with 'about', never as an exact count{fix}.")


def picked(display, label) -> str:
    """An exercise as the user named it: a gym exercise of the movement library by its own name, with the exercise it
    is counted as ("Overhead kettlebell squat (counted as Squat)"); else the exercise ("Squat")."""
    shown = one_line(display, 120)
    return f"{shown} (counted as {label})" if shown and shown.lower() != str(label).lower() else str(label)


def heard(event: dict) -> str:
    """The reading of a user_said: the user's words (one line, quoted) and what the page did with them, if anything
    ("applied": an exercise or a movement of the library named, back to detecting it, or an answer to "done with this
    set?"), which the coach then confirms. With nothing applied the coach answers them: in a few words mid-set (the
    page tags the event with the set in progress, as a set's own events), and knowing when no workout runs (`workout`:
    false, as in Talk to coach).
    In a workout it is told that the page changed nothing and what it counts still: a name the page did not take as a
    choice (one it cannot count, a wish rather than a switch, a word Parakeet garbled) must not be confirmed as one."""
    words = " ".join(str(event.get("text") or "").split())[:500].replace('"', "'")
    a = event.get("applied") if isinstance(event.get("applied"), dict) else {}
    label = a.get("label") or a.get("exercise")
    which = f"set {a.get('set')} of {label}" if a.get("set") is not None and label else (
        f"the set of {label}" if label else "the set")
    reps = f"{a.get('reps')} {'rep' if a.get('reps') == 1 else 'reps'}" if a.get("reps") is not None else None
    if a.get("type") == "exercise" and label:
        # (a gym exercise of the movement library is counted as its exercise: the user named it by its own name)
        shown = picked(a.get("display"), label)
        did = f"The page switched to {shown if shown != label else f'counting {label}'}: confirm in a few words."
    elif a.get("type") == "auto":
        did = "The page recognises the exercise as they go now: confirm in a few words."
    elif a.get("type") == "set_end" and a.get("done"):
        did = (f"The page ended {which}{f' at {reps}' if reps else ''}: confirm in a few words"
               f"{', with the reps' if reps else ''}.")
    elif a.get("type") == "set_end":
        did = f"The page keeps {which} going{f' ({reps} so far)' if reps else ''}: confirm in a few words."
    elif a.get("type") == "movement":
        # (the page tags the words with the set in progress, if any: naming a movement the engine does not count ends
        # it, at the reps it had, and the page sends no set_end for it)
        m, n = movement(a), event.get("reps")
        mid = event.get("set") is not None and event.get("exerciseLabel") not in (None, "workout")
        at = f" at {n} {'rep' if n == 1 else 'reps'}" if mid and n is not None else ""
        ended = f"ended set {event.get('set')} of {event.get('exerciseLabel')}{at} and " if mid else ""
        did = named_reading(m, f"The page {ended}switched to {m['display']}, a movement they named", set_reps=bool(at))
    elif event.get("set") is not None and event.get("exerciseLabel") not in (None, "workout"):
        so_far = f", {event.get('reps')} reps so far" if event.get("reps") is not None else ""
        did = (f"The page changed nothing: it still counts {event.get('exerciseLabel')}, and they are mid-set (set "
               f"{event.get('set')}{so_far}): answer in a few words.")
    elif event.get("workout") is False:
        did = "No workout is running, so nothing is counted: answer them."
    elif event.get("workout") and event.get("movement"):
        # (a movement named, the page tags the user's words with it: no reps are counted meanwhile)
        did = (f"The page changed nothing: it still tracks {movement(event)['display']}, a movement they named, and "
               "counts no reps. Answer them.")
    elif event.get("workout"):
        # (`auto`: no exercise named, the tracker detects it; the page sends the named one's name only with its set)
        counts = {True: ": it still recognises the exercise as they go",
                  False: ": it still counts the exercise they chose"}.get(event.get("auto"), "")
        did = f"The page changed nothing{counts}. Answer them."
    else:
        did = "Answer them."
    return f'The user said: "{words}". {did}'


# what a question's reading adds when the page says the user cannot answer it by voice (`listening`: false): no speech
# to text here, the microphone refused or muted, or an agent session that does not hear. (The page adds the same words
# itself to an agent session's questions.)
UNHEARD = "The user cannot talk to you right now: they answer by tapping on screen, so do not ask them to say it."


def describe(event: dict) -> dict:
    """What the model receives from wait_for_event: the engine event plus a one-line reading of it. The ElevenLabs agent
    reads the same line (POST /api/coach/describe), so the questions' lines say what to ask, not how the user answers:
    each coach's own prompt says that (the agent hears the user itself; Claude and ChatGPT get the user's words as
    user_said events, transcribed on this Mac, and are told about the buttons). A question the page tags with
    `listening`: false adds that the user cannot answer it by voice now."""
    kind = event.get("kind")
    ex = event.get("exerciseLabel") or event.get("exercise")
    reps = event.get("reps")
    # the user's answers and the tracker's questions name their exercise as `label`: in auto mode the page tags every
    # event with exerciseLabel "workout" (there is no set yet), which must not stand in for the exercise named
    named = event.get("label") or (ex if ex != "workout" else event.get("exercise"))
    of_set = f"set {event.get('set')} of {named}" if event.get("set") is not None else f"the set of {named}"
    # (a gym exercise of the movement library, tapped, is counted as its exercise: `display` is the name the user chose)
    chose = ("The user asked for the exercise to be recognised as they go, not naming one. Confirm in a few words."
             if event.get("exercise") == "auto" else
             f"The user chose {picked(event.get('display'), named)}: only {named} is counted now. Confirm in a few "
             "words.")
    # (a set the user ended by voice is not sent at all: the agent already heard it; this one was the Done button, or
    # a movement of the library named with a tap, which pauses the reps: its movement_set follows)
    ended = {"confirmed": "the user tapped Done", "switch": "the user moved on to another exercise",
             "movement": "the user named a movement of the library, so no reps are counted meanwhile",
             "stop": "the workout stopped"}.get(event.get("reason"), "after a rest")
    prev = event.get("previous") or {}
    started = (f"The user switched from {prev.get('label')} (set {prev.get('set')}: {prev.get('reps')} reps) to {ex}. "
               if prev else "") + f"Recognised a set of {ex}: set {event.get('set')}, {reps} reps so far."
    workout = "; ".join(f"{t.get('label')}: {t.get('sets')} sets, {t.get('reps')} reps"
                        for t in (event.get("totals") or {}).values())
    moves = moved(event.get("movements"))       # (the movements the user named, with their times or counts)
    workout = (f"{workout or 'No set of a counted exercise'}. Movements: {moves}" if moves
               else workout or "no complete set of any exercise")
    summary = {
        "cue": f"Form fault on {ex}{f', rep {reps}' if reps else ''}: {event.get('message')} ({event.get('reason')})."
               + (" A short 3D demo of the right form is playing on screen." if event.get("demo") else ""),
        "fixed": f"The user fixed '{event.get('message') or event.get('code')}' on {ex}; the last two reps were clean.",
        "praise": f"{reps} reps of {ex}, the last five clean.",
        "set_summary": f"Set of {ex} finished: {reps} reps.",
        "visibility": f"Doing {ex}, but out of view: {', '.join(event.get('parts') or [])}. Ask them to step back or turn.",
        "start": ("The user is starting a workout; you will be told which exercise they do. Greet them in one short "
                  "sentence and invite them to start any exercise." if event.get("auto")
                  else f"The user is starting a set of {ex}. Greet them in one short sentence."),
        "set_start": started,
        "set_end": f"Set {event.get('set')} of {ex} finished ({ended}): {reps} reps." + (
            # (the movement_set comes right after: two cues in a row, the second cuts the first off; the page's own
            # sentence for the movement says these reps, and so does the coach)
            " Say nothing now: give these reps when you confirm the movement they named, which comes next."
            if event.get("reason") == "movement" else ""),
        "workout_summary": f"Workout finished. {workout}.",
        "ask_exercise": ("The user is starting a workout and has not said which exercise they will do. Greet them if "
                         "you have not yet, and ask which exercise or movement they are about to do, in one short "
                         "sentence."),
        "exercise_auto": ("The user did not say which exercise they will do: tell them in a few words that you will "
                          "recognise it as they go."),
        "exercise_set": chose,
        "confirm_set_end": (f"No rep for a few seconds: {of_set} may be over, {reps} reps counted. Say the reps and "
                            "ask if they are done with this set, in one short sentence."),
        "user_said": heard(event),
    }.get(kind) or tracked(kind, event) or f"Event on {ex}."
    if kind in ("ask_exercise", "confirm_set_end") and event.get("listening") is False:
        summary = f"{summary} {UNHEARD}"
    # (a movement's coaching line goes on as its form cues alone, as the readings use it: the coach sees the event too)
    notes = {"coach": form_notes(event["coach"])} if "coach" in event else {}
    return {"summary": summary, **event, **notes}


FIRST_PROMPT = "Coach the user's workout: call wait_for_event now."


class Session:
    def __init__(self, exercise: str, data_dir: Path, server_url: str, brain: str = "claude",
                 transport: str | None = None):
        self.id = uuid.uuid4().hex[:12]
        self.exercise = exercise
        self.brain = brain
        # "api" (Claude through the SDK, in a worker thread) or "cli" (a CLI over MCP: Claude Code; codex for ChatGPT)
        self.transport = transport or (claude_transport() if brain == "claude" else "cli")
        self.cond = threading.Condition()
        self.events: deque[dict] = deque()
        self.said: list[dict] = []
        self.done = False
        self.error: str | None = None         # why the session gave up (the page then moves on to its next connection)
        self.delivered: dict | None = None   # the event the model is answering (for latency)
        self.seq = 0                          # event ids, unique within the session
        self.created = time.time()
        self.t0 = time.monotonic()
        self.connect_ms: int | None = None    # from the start to the model's first wait_for_event
        self.polled = 0.0                     # when the model last asked for an event
        self.runs = 0                         # CLI processes started (codex is started again when its turn ends)
        self.run_started = 0.0
        self.run_said = 0                     # cues said before the current run began
        self.run_taken = 0                    # events the current run was given (it is judged on those alone)
        self.run_asked = False                # ... and whether it asked for another after the last of them
        self.proc: subprocess.Popen | None = None
        self.dir = data_dir / "coach"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.server_url = server_url
        self.last_page = time.monotonic()       # the page polls said_since(); a session nobody polls ends itself
        # SYSTEM (API_SYSTEM), with the movement library's names when it is built; frozen for the session, so that the
        # prompt cache holds it
        self.system = system_prompt(self.transport)
        self.worker: threading.Thread | None = None   # the API transport's (it calls the API; no process)
        self.request: dict = {}                 # ... the parameters of its every request, but the messages
        self.history: list[dict] = []           # ... and the conversation so far, append-only (worker thread only)
        self.missed: list[str] = []             # ... and the events since its last answer the page handled alone

    def cwd(self) -> Path:
        COACH_CWD.mkdir(exist_ok=True)
        return COACH_CWD

    def spawn(self) -> None:
        if self.brain == "chatgpt":
            with self.cond:
                self._spawn_codex()
            threading.Thread(target=self._supervise, name=f"coach-{self.id}", daemon=True).start()
            return
        if self.transport == "api":
            return self._spawn_api()
        cfg = self.dir / f"mcp-{self.id}.json"
        cfg.write_text(json.dumps({"mcpServers": {"pose": {
            "command": str(VENV_PY), "args": [str(HERE / "pose_mcp.py")],
            "env": {"POSE_SERVER": self.server_url, "POSE_COACH_SESSION": self.id}}}}))
        cmd = self.claude_cmd(cfg)
        self.log = open_log(self.dir / f"session-{self.id}.jsonl", "w")
        self.run_started, self.runs = time.monotonic(), 1
        self.proc = subprocess.Popen(cmd, cwd=self.cwd(), env=claude_env(), stdin=subprocess.DEVNULL, stdout=self.log,
                                     stderr=subprocess.STDOUT)

    def claude_cmd(self, cfg: Path) -> list[str]:
        claude = claude_cli()
        if not claude:
            raise FileNotFoundError("the claude CLI was not found")
        return [claude, "-p", "--model", MODEL, "--effort", EFFORT,
                *(["--settings", json.dumps({"fastMode": True})] if FAST else []),
                "--strict-mcp-config", "--mcp-config", str(cfg),
                "--tools", "",                                   # no built-in tools: no shell, no files
                "--allowedTools", "mcp__pose__wait_for_event,mcp__pose__say",
                "--output-format", "stream-json", "--verbose", "--no-session-persistence",
                "--setting-sources", "", "--disable-slash-commands",   # none of the user's settings, plugins or skills
                "--system-prompt", self.system,
                FIRST_PROMPT]

    # --- the API transport (Claude through the Anthropic SDK) ---------------------------------------------------------
    def _spawn_api(self) -> None:
        """A worker thread in place of a process (_api_loop). The key is read now (a key saved later is the next
        session's) and the client made once for the session; so are the request's parameters, which stay the same for
        every request of it (the prompt cache is a prefix match)."""
        key = api_key()
        if not key:
            raise FileNotFoundError(f"no Anthropic API key in {KEY_FILE}")
        if sdk() is None:
            raise ModuleNotFoundError("the anthropic package is not installed (.venv)")
        client = api_client(key)
        self.request = {
            "model": model_id(), "max_tokens": max_tokens(),
            # the instructions, cached: about 2,500 tokens (the least Claude Sonnet 5.5 caches is 512) ...
            "system": [{"type": "text", "text": self.system, "cache_control": {"type": "ephemeral"}}],
            # ... and automatic caching for the history: each request reads what the one before it wrote
            "cache_control": {"type": "ephemeral"},
            "thinking": thinking_config(), "output_config": {"effort": EFFORT}}
        if "haiku" not in model_id():
            # a request the model declines (a refusal) is run again, in the same call, on the model Anthropic names for
            # the refusal's category (Claude Haiku 5.5 has no server-side fallback)
            self.request.update(betas=[FALLBACK_BETA], fallbacks="default")
        self.log = open_log(self.dir / f"session-{self.id}.jsonl", "w")
        self.run_started, self.runs = time.monotonic(), 1
        self.worker = threading.Thread(target=self._api_loop, args=(client, key), name=f"coach-{self.id}", daemon=True)
        self.worker.start()

    def _api_loop(self, client, key: str) -> None:
        """The events as wait_for_event gives them (next_event: the same latency accounting), each one user message,
        each reply said. None is sent once the session has ended (stopped, idle, the page's plan changed: next_event
        still hands over what is queued, and each would be billed with nobody to hear it), nor one the page no longer
        waits for (fresh: it has spoken the engine's sentence): that one goes with the next message as a line of
        context (_message), so the history stays true at the cost of no request. A key the API refuses, or a request
        it rejects, ends the session with an error, so the page moves on to its next connection (as from a codex that
        gave up). A request that still fails after its retry, or a reply cut short, is left to the page's own cue, and
        API_FAILURES of those in a row end the session. key: only to keep it out of an error's text."""
        failed = 0
        try:
            while True:
                ev = self.next_event(API_POLL_S)
                if ev.get("idle"):
                    continue
                if ev.get("done"):
                    return
                with self.cond:
                    if self.done:
                        return
                    queued = (self.delivered or {}).get("_queued")
                if not fresh(ev, queued):
                    self._missed(ev)
                    self._write({"type": "pose_coach.api", "event_id": ev.get("event_id"), "kind": ev.get("kind"),
                                 "skipped": "late", "waited_ms": round((time.monotonic() - queued) * 1000)})
                    continue
                kind, why = self._answer(client, key, ev, queued)
                if kind == "stopped":
                    return
                failed = 0 if kind == "ok" else failed + 1
                if kind == "ok" or (kind in ("transient", "cut") and failed < API_FAILURES):
                    continue
                self._give_up(why if kind not in ("transient", "cut") else
                              f"the Anthropic API failed {failed} times in a row (last: {why})")
                return
        except Exception as e:  # noqa: BLE001 - a worker never ends unseen: the page is told, and moves on
            self._give_up(scrub(f"the coach stopped ({type(e).__name__}: {e})", key))
        finally:
            self.log.close()

    def _missed(self, ev: dict) -> None:
        """Event ev was left to the page (it spoke the engine's sentence): the model hears of it with the next one."""
        self.missed = [*self.missed, f"({ev.get('kind') or 'event'}) {one_line(ev.get('summary'), 200)}"][-MISSED_MAX:]

    def _message(self, ev: dict) -> str:
        """Event ev's user message: its JSON as wait_for_event gives it, after one line on the events the page handled
        alone since the last exchange in the history, if any (MISSED)."""
        text = json.dumps(ev)
        return f"{MISSED}{' | '.join(self.missed)}\n{text}" if self.missed else text

    def _answer(self, client, key: str, ev: dict, queued: float | None = None) -> tuple[str, str | None]:
        """One request for event ev, and one retry of a transient failure while the event is still fresh after the
        wait (retry_wait): ("ok", None) once its cue is said; ("stopped", None) when the session ended during that wait;
        else how it failed (api_failure, or "cut": a reply cut at max_tokens with no whole sentence, which says nothing,
        so the page's wait runs out and it speaks the engine's sentence, as for a failure). The reply is said as it is;
        one of only "-" (words not meant for the coach, a short hold) or a refusal (stop_reason first: its content is
        empty or partial) says "" (the event is answered, nothing is spoken). The exchange then goes into the history:
        the event's message and the response's own blocks (echo), never edited later. A refusal stays out of it (so
        the next request does not carry it again), as does a reply with no text (an empty assistant turn would be a
        400); an event left to the page (a failure, a cut reply) goes with the next message (_missed)."""
        msg = {"role": "user", "content": self._message(ev)}
        entry = {"type": "pose_coach.api", "event_id": ev.get("event_id"), "kind": ev.get("kind")}
        for attempt in (1, 2):
            t0 = time.monotonic()
            try:
                r = client.beta.messages.create(messages=[*self.history, msg], **self.request)
                break
            except Exception as e:  # noqa: BLE001 - sorted by api_failure, the most specific first
                kind, why = api_failure(e, key)
                wait = retry_wait(e) if attempt == 1 and kind == "transient" else None
                retry = wait is not None and fresh(ev, queued, wait)
                self._write({**entry, "api_ms": round((time.monotonic() - t0) * 1000), "failure": kind, "error": why,
                             **({"retry_in_ms": round(wait * 1000)} if retry else {})})
                if not retry:
                    self._missed(ev)
                    return kind, why
                with self.cond:                         # (a stop() wakes it)
                    if self.cond.wait_for(lambda: self.done, wait):
                        return "stopped", None
        entry.update(api_ms=round((time.monotonic() - t0) * 1000), **({"retried": True} if attempt > 1 else {}))
        text = "".join(b.text for b in r.content if getattr(b, "type", None) == "text").strip()
        u = r.usage
        entry.update(usage={k: getattr(u, k, None) for k in ("input_tokens", "cache_creation_input_tokens",
                                                              "cache_read_input_tokens", "output_tokens")},
                     stop_reason=r.stop_reason, model=r.model, request_id=getattr(r, "_request_id", None), text=text)
        # a fallback: where the model switched, and the model that served the reply (a fallback_message in the usage's
        # iterations: a turn served by the fallback model directly, after an earlier one, has no fallback block)
        if fallbacks(r.content):
            entry["fallback"] = fallbacks(r.content)
        if any(getattr(i, "type", None) == "fallback_message" for i in getattr(u, "iterations", None) or []):
            entry["served_by"] = r.model
        if r.stop_reason == "max_tokens" and not complete(text):
            why = "a reply cut at max_tokens with no whole sentence"
            self._write({**entry, "failure": "cut", "error": why})
            self._missed(ev)
            return "cut", why
        if r.stop_reason == "refusal":
            entry["refusal"] = getattr(getattr(r, "stop_details", None), "category", None)
            spoken, keep = "", False
        else:
            spoken, keep = ("" if re.fullmatch(r"[\s\-–—]*", text) else text), bool(text)
        self.say(spoken[:SPOKEN_MAX])
        if keep:
            self.history += [msg, {"role": "assistant", "content": echo(r.content)}]
            self.missed = []                            # (told in that message, now in the history)
        with self.cond:
            entry["latency_ms"] = self.said[-1]["latency_ms"]
        self._write(entry)
        return "ok", None

    def _give_up(self, why: str) -> None:
        with self.cond:
            self.error = self.error or why
            self.done = True
            self.cond.notify_all()
        self._write({"type": "pose_coach.gave_up", "error": why})

    def _write(self, entry: dict) -> None:
        """One line of the session's log (never the key: the entries hold none)."""
        try:
            self.log.write(json.dumps({**entry, "t": time.time()}) + "\n")
            self.log.flush()
        except (OSError, ValueError):                   # (closed: the session has ended)
            pass

    # --- codex (ChatGPT) --------------------------------------------------------------------------------------------
    def codex_cmd(self, prompt: str, run: int) -> list[str]:
        codex = codex_cli()
        if not codex:
            raise FileNotFoundError("the codex CLI was not found")
        # the coach's instructions in place of Codex's own (a coding agent's), as --system-prompt does for Claude
        instructions = self.dir / f"codex-{self.id}.md"
        instructions.write_text(self.system)
        toml = json.dumps                       # -c values are read as TOML, and a JSON string is a TOML string
        pose = "mcp_servers.pose."
        cmd = [codex, "exec",
               "--ignore-user-config",          # none of the user's own MCP servers, plugins or settings (login stays)
               "--ignore-rules", "--skip-git-repo-check", "--ephemeral", "--json",
               "-m", CHATGPT_MODEL, "-s", "read-only", "-C", str(self.cwd()),
               "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
               "-c", f"model_instructions_file={toml(str(instructions))}",
               "-c", f"{pose}command={toml(str(VENV_PY))}",
               "-c", f"{pose}args=[{toml(str(HERE / 'pose_mcp.py'))}]",
               "-c", f"{pose}env={{POSE_SERVER={toml(self.server_url)}, POSE_COACH_SESSION={toml(self.id)}, "
                     f"POSE_COACH_RUN={toml(str(run))}}}",
               "-c", f'{pose}enabled_tools=["wait_for_event", "say"]',
               # its tools need no asking (with approvals off, a tool that needs approval is refused)
               "-c", f'{pose}default_tools_approval_mode="approve"',
               "-c", f"{pose}startup_timeout_sec=60",
               "-c", f"{pose}tool_timeout_sec=600"]   # wait_for_event waits through rests, up to 300 s
        for feature in CODEX_OFF:
            cmd += ["--disable", feature]
        return cmd + [prompt]

    def codex_prompt(self) -> str:
        """Claude's prompt, and that a workout summary is not the end (measured: GPT-6 Luna ended its turn after one, and
        the page keeps a session across workouts). A run started again mid-workout is told what was said last, so it
        neither greets again nor repeats itself."""
        keep_going = (" Keep calling it until it returns done: a workout summary is not the end, another workout may "
                      "follow.")
        said = [s for s in self.said if s["text"]]          # (an empty say: words not meant for it, nothing spoken)
        if not said:
            return FIRST_PROMPT + keep_going
        recap = "\n".join(f"- ({s['kind'] or 'event'}) {s['text']}" for s in said[-RECAP:])
        return ("The workout is already under way: you coached it until now, in a turn that has ended. What you said "
                f"last, oldest first:\n{recap}\nCarry on from there: do not greet the user again or repeat these word "
                "for word. Call wait_for_event now." + keep_going)

    def _spawn_codex(self, after: str | None = None) -> None:
        """(with self.cond held: a stop() comes before or after a run starts, never in between). after: how the last
        run ended, for the log."""
        run = self.runs + 1
        cmd = self.codex_cmd(self.codex_prompt(), run)
        if self.runs:
            self.log.write(json.dumps({"type": "pose_coach.restart", "run": run, "after": after,
                                       "t": time.time()}) + "\n")
            self.log.flush()
        else:
            self.log = open_log(self.dir / f"session-{self.id}.jsonl", "a")     # one log for all its runs
        self.run_started, self.run_said = time.monotonic(), len(self.said)
        self.run_taken, self.run_asked = 0, False
        self.proc = subprocess.Popen(cmd, cwd=self.cwd(), env=codex_env(cmd[0]), stdin=subprocess.DEVNULL,
                                     stdout=self.log, stderr=subprocess.STDOUT)
        self.runs = run
        self.cond.notify_all()                          # an earlier run's poll still open lets go (stale)

    def _supervise(self) -> None:
        """codex exec ends when the model ends its turn (after a long rest's idle, say). While the session is open it
        is started again. Each run is judged on the events it was given itself. One that never asked for an event (one
        that has not within CONNECT_LIMIT_S, RECONNECT_LIMIT_S for a restart, is ended), that said nothing to the events
        it took, or that took a single event and ended its turn right after the cue (a model that does so every time
        would be started again for every event, each cue too late) failed; one given no event (its turn ended in a
        rest) counts neither way. After RESTARTS failed runs in a row the session ends with an error, and the page moves
        on to its next connection."""
        failed = 0
        try:
            while True:
                proc, stuck = self.proc, False
                limit = CONNECT_LIMIT_S if self.runs == 1 else RECONNECT_LIMIT_S
                try:
                    code = proc.wait(limit)
                except subprocess.TimeoutExpired:
                    stuck = self.polled < self.run_started
                    if stuck:
                        proc.terminate()
                        try:
                            proc.wait(10)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                    code = proc.wait()
                with self.cond:
                    if self.done:
                        return
                    connected, said = self.polled >= self.run_started, len(self.said) - self.run_said
                    if stuck:
                        why = f"did not connect in {limit} s"
                    elif not connected:
                        why = f"ended before it connected (exit {code})"
                    elif self.run_taken and not said:
                        why = f"ended with an event unanswered (exit {code})"
                    elif self.run_taken == 1 and not self.run_asked:
                        why = "ended its turn after a single cue"
                    else:
                        why = None
                    if why:
                        failed += 1
                    elif self.run_taken:
                        failed = 0
                    if failed > RESTARTS:
                        self.error = f"codex {why}, {failed} runs in a row"
                        self.log.write(json.dumps({"type": "pose_coach.gave_up", "error": self.error,
                                                   "t": time.time()}) + "\n")
                    else:
                        try:
                            self._spawn_codex(why or ("idle" if not self.run_taken else "ok"))
                            continue
                        except OSError as e:
                            self.error = f"codex could not be started again ({type(e).__name__}: {e})"
                    self.done = True
                    self.cond.notify_all()
                    return
        finally:
            self.log.close()

    def alive(self) -> bool:
        if self.worker is not None:                     # the API transport: while its worker runs and has not given up
            return self.worker.is_alive() and self.error is None     # (the page fails over on the poll that says why)
        running = bool(self.proc and self.proc.poll() is None)
        # a codex run that ended mid-workout is being started again, unless the session has ended (or gave up)
        return running or (self.brain == "chatgpt" and self.proc is not None and not self.done)

    # --- page side -------------------------------------------------------------------------------------------------
    def push(self, event: dict) -> dict:
        with self.cond:
            ev = describe(event)
            self.seq += 1
            ev["event_id"] = self.seq
            ev["_queued"] = time.monotonic()
            self.events.append(ev)
            self.cond.notify_all()
        return {"queued": ev["event_id"]}

    def stop(self) -> None:
        with self.cond:
            self.done = True
            self.cond.notify_all()
        if self.proc:
            threading.Timer(15, self._kill).start()

    def _kill(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()

    def said_since(self, n: int) -> dict:
        with self.cond:
            self.last_page = time.monotonic()
            return {"said": self.said[n:], "total": len(self.said), "alive": self.alive(),
                    "connected": self.delivered is not None or bool(self.said), "brain": self.brain,
                    "transport": self.transport, "error": self.error, "connect_ms": self.connect_ms}

    # --- model (MCP) side ------------------------------------------------------------------------------------------
    def stale(self, run: str | None) -> bool:
        """A poll of an earlier codex run, or of one that has ended (its MCP server outlives the CLI while a long poll is
        open): were it given an event, nobody would answer it."""
        return run is not None and (run != str(self.runs) or self.proc is None or self.proc.poll() is not None)

    def next_event(self, timeout: float, run: str | None = None) -> dict:
        deadline = time.monotonic() + timeout
        with self.cond:
            if self.stale(run):
                return {"done": True}
            self.polled = time.monotonic()
            self.run_asked = True
            if self.delivered is None:
                self.delivered = {}                     # the model has connected
                self.connect_ms = round((self.polled - self.t0) * 1000)
            while not self.events and not self.done and not self.stale(run):
                if time.monotonic() - self.last_page > IDLE_LIMIT_S:
                    self.done = True                    # the page went away without stopping the session
                    break
                left = deadline - time.monotonic()
                if left <= 0:
                    return {"idle": True}
                self.cond.wait(left)
            if not self.events or self.stale(run):
                return {"done": True}
            ev = self.events.popleft()
            self.delivered = ev
            self.run_taken, self.run_asked = self.run_taken + 1, False
            return {k: v for k, v in ev.items() if not k.startswith("_")}

    def say(self, text: str) -> dict:
        with self.cond:
            ev = self.delivered or {}
            q = ev.get("_queued")
            self.said.append({"text": text, "t": time.time(), "event_id": ev.get("event_id"), "kind": ev.get("kind"),
                              "latency_ms": round((time.monotonic() - q) * 1000) if q else None})
            self.cond.notify_all()
        return {"ok": True}


SESSIONS: dict[str, Session] = {}


def status() -> dict:
    """/api/health's coach: what a session would run (the key itself never; whether there is one shows as the
    transport, which start() would take now: a key the page's connection check found refused goes unused)."""
    import connections                                   # (it imports this module)
    seen = connections.ANTHROPIC.peek()
    return {"mode": "mcp", "claude_cli": claude_cli() is not None, "model": MODEL, "effort": EFFORT, "fast": FAST,
            "transport": claude_transport(seen["ok"] if seen else None), "thinking": thinking_config()["type"],
            "codex_cli": codex_cli() is not None, "chatgpt_model": CHATGPT_MODEL, "mcp_python": VENV_PY.exists(),
            "sessions": len(SESSIONS)}


def start(body: dict, data_dir: Path, server_url: str) -> dict:
    brain = body.get("brain") or "claude"
    if brain not in BRAINS:
        raise ValueError(f"brain must be one of: {', '.join(BRAINS)}")
    import connections                                   # (it imports this module)
    if brain == "chatgpt":
        # codex exec signed in with an API key would bill that key: only a ChatGPT sign-in starts it
        if not connections.CHATGPT.get()["loggedIn"]:
            raise ValueError("ChatGPT is not signed in on this machine (codex login): not starting a ChatGPT coach")
    # a key the page's connection check found refused goes unused: Claude Code then, as the page was told (never
    # waited for here: the check is the one kept, if any)
    seen = connections.ANTHROPIC.peek() if brain == "claude" else None
    transport = claude_transport(seen["ok"] if seen else None) if brain == "claude" else "cli"
    s = Session(str(body.get("exercise") or "workout"), data_dir, server_url, brain, transport)
    SESSIONS[s.id] = s
    try:
        s.spawn()
    except Exception:
        SESSIONS.pop(s.id, None)                        # (the page is told, and falls back)
        raise
    return {"session": s.id, "brain": brain, "transport": s.transport}


def stop_all() -> None:
    """On server shutdown: end every session and its CLI process (they would otherwise outlive the server). An API
    session's worker wakes and ends (done), or ends with the server: it is a daemon thread."""
    for s in list(SESSIONS.values()):
        with s.cond:
            s.done = True
            s.cond.notify_all()
        if s.proc and s.proc.poll() is None:
            s.proc.terminate()
            try:
                s.proc.wait(5)
            except subprocess.TimeoutExpired:
                s.proc.kill()


def get(sid: str) -> Session:
    s = SESSIONS.get(sid)
    if s is None:
        raise KeyError(f"no coach session {sid!r}")
    return s
