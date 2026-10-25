"""The coach's connections (server/connections.py) with stand-in CLIs: which one the page picks first, what the claude
and codex checks give out (signed in, the plan; never an email, an organisation or a key; an error the page can tell
from a check that failed), how long they are kept (less for a check that failed; checked again when asked fresh), and
the ElevenLabs agent record (where the id comes from, saving and forgetting it). And Claude's transport: the API with
the user's key (a made-up one here, and a stand-in client: never the API), else Claude Code; a key saved or removed
while a check is kept (checked again, so the two agree), and a key file other users can open (a warning).

    .venv/bin/python -m unittest tests/test_connections.py      (from inference/pose-coach; the .venv: the anthropic
                                                                 SDK's own errors)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path

import anthropic
import httpx2

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))
import coach  # noqa: E402
import connections  # noqa: E402


def no_api(*a, **k):
    raise AssertionError("a test reached for the Anthropic API")


# no test reads the user's own key or reaches the API (a test writes a made-up key and puts in a stand-in client)
coach.KEY_FILE = Path(tempfile.gettempdir()) / "pose-coach-tests" / "no-anthropic-key"
coach.TRANSPORT = "auto"
coach.api_client = no_api
KEY = "sk-ant-api03-MADE-UP-test-key-0123456789"
REQ = httpx2.Request("GET", "https://api.anthropic.com/v1/models/claude-sonnet-5-5")


def failure(cls, code: int, message: str):
    """An error the SDK raises for an HTTP status, with the API's own body."""
    return cls(f"Error code: {code}", response=httpx2.Response(code, request=REQ),
               body={"type": "error", "error": {"type": "error", "message": message}})

AGENT = "agent_" + "a1b2c3d4e5" * 3          # 30 characters after agent_
OTHER = "agent_" + "z9y8x7w6v5" * 3
# a stand-in for both CLIs: what it answers is in the file "<name>-mode" next to it; each call is logged in
# "<name>-calls" with whether an API key reached it
FAKE = """
import json, os, sys, time
here, name = os.path.dirname(os.path.abspath(__file__)), sys.argv[1]
mode_file = os.path.join(here, name + "-mode")
mode = open(mode_file).read().strip() if os.path.exists(mode_file) else "in"
with open(os.path.join(here, name + "-calls"), "a") as f:
    f.write(json.dumps({"argv": sys.argv[2:], "key": any(k in os.environ for k in
                        ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"))}) + "\\n")
if mode == "slow":
    time.sleep(3)
if name == "claude":
    if mode == "in":
        print(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "email": "private-email-placeholder",
                          "orgId": "org-0123456789", "orgName": "Someone's Organization", "subscriptionType": "pro"}))
    elif mode == "out":
        print(json.dumps({"loggedIn": False, "authMethod": "none"}))
        sys.exit(1)
    else:
        print("this is not JSON")
else:
    if mode == "in":
        print("Logged in using ChatGPT", file=sys.stderr)
    elif mode == "key":
        print("Logged in using an API key - sk-proj-****wxyz", file=sys.stderr)
    else:
        print("Not logged in", file=sys.stderr)
        sys.exit(1)
"""
SECRETS = ("private-email-placeholder", "org-0123456789", "Someone's Organization", "sk-proj", "wxyz")
# how web/js/connections.js (checkFailed) tells a check that failed from a definite answer (not signed in, an API key)
CHECK_FAILED = re.compile(r"did not answer|could not (run|read)")


class Connections(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pose-coach-connections-"))
        (self.tmp / "fake.py").write_text(FAKE)
        for name in ("claude", "codex"):
            f = self.tmp / name
            f.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{self.tmp / "fake.py"}" {name} "$@"\n')
            f.chmod(0o755)
        self.saved = [(m, k, getattr(m, k)) for m, k in (
            (connections, "DIR"), (connections, "LEGACY"), (connections, "CHECK_TTL_S"),
            (connections, "CHECK_TIMEOUT_S"), (connections, "CHECK_FAILED_TTL_S"), (connections, "FRESH_S"),
            (coach, "claude_cli"), (coach, "codex_cli"), (coach, "KEY_FILE"), (coach, "TRANSPORT"),
            (coach, "api_client"))]
        self.env = {k: os.environ.pop(k) for k in ("POSE_ELEVEN_AGENT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
                                                   "CODEX_API_KEY") if k in os.environ}
        connections.DIR, connections.LEGACY = self.tmp / "connections", self.tmp / "eleven-agent-id"
        coach.claude_cli = lambda: str(self.tmp / "claude")
        coach.codex_cli = lambda: str(self.tmp / "codex")
        coach.KEY_FILE = self.tmp / "connections" / "anthropic-key"      # (none until a test writes one)
        self.clear()

    def tearDown(self):
        for m, k, v in self.saved:
            setattr(m, k, v)
        for k in ("POSE_ELEVEN_AGENT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"):
            os.environ.pop(k, None)
        os.environ.update(self.env)
        self.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def clear(self):
        connections.CLAUDE.clear()
        connections.CHATGPT.clear()
        connections.ANTHROPIC.clear()

    def mode(self, name: str, mode: str):
        (self.tmp / f"{name}-mode").write_text(mode)
        self.clear()

    def calls(self, name: str) -> list[dict]:
        f = self.tmp / f"{name}-calls"
        return [json.loads(line) for line in f.read_text().splitlines()] if f.exists() else []

    def test_the_first_usable_connection_in_the_order_is_auto(self):
        self.assertEqual(connections.status()["auto"], "claude")          # no agent: the claude CLI, signed in
        connections.save_eleven(AGENT, "starter")
        self.assertEqual(connections.status()["auto"], "eleven")
        connections.save_eleven(AGENT, None)                               # a plan not known counts as usable
        self.assertEqual(connections.status()["auto"], "eleven")
        connections.save_eleven(AGENT, "free")                             # a free plan is not
        self.assertEqual(connections.status()["auto"], "claude")
        self.mode("claude", "out")
        self.assertEqual(connections.status()["auto"], "chatgpt")
        self.mode("codex", "out")
        self.assertEqual(connections.status()["auto"], "none")
        st = connections.status()
        self.assertEqual(st["order"], ["eleven", "claude", "chatgpt"])
        self.assertEqual(st["eleven"], {"connected": True, "agentId": AGENT, "name": None, "plan": "free",
                                        "paid": False, "llm": None})

    def test_the_shape_is_the_one_the_page_reads(self):
        st = connections.status()
        self.assertEqual(list(st), ["eleven", "claude", "chatgpt", "order", "auto"])
        self.assertEqual(set(st["eleven"]), {"connected", "agentId", "name", "plan", "paid", "llm"})
        self.assertEqual(st["claude"], {"available": True, "loggedIn": True, "plan": "pro", "model": coach.model_id(),
                                        "effort": coach.EFFORT, "fast": coach.FAST, "error": None, "transport": "cli",
                                        "api": {"configured": False, "ok": None, "error": None, "warning": None}})
        self.assertEqual(st["chatgpt"], {"available": True, "loggedIn": True, "model": coach.CHATGPT_MODEL,
                                         "error": None})
        self.assertEqual(st["eleven"]["connected"], False)
        json.dumps(st)

    def test_the_claude_check_uses_the_login_and_gives_out_nothing_secret(self):
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-made-up"     # the coach runs on the login: neither may see a key
        st = connections.status()
        self.assertTrue(st["claude"]["loggedIn"])
        self.assertEqual(self.calls("claude"), [{"argv": ["auth", "status", "--json"], "key": False}])
        text = json.dumps(st)
        for s in SECRETS:
            self.assertNotIn(s, text)
        self.mode("claude", "out")
        st = connections.status()["claude"]
        self.assertEqual((st["available"], st["loggedIn"], st["plan"]), (True, False, None))
        self.assertIn("sign in", st["error"])
        self.mode("claude", "junk")
        self.assertIn("could not read", connections.status()["claude"]["error"])

    def test_the_codex_check_wants_a_chatgpt_login_and_never_gives_out_the_key(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"
        self.assertTrue(connections.status()["chatgpt"]["loggedIn"])
        self.assertEqual(self.calls("codex"), [{"argv": ["login", "status"], "key": False}])
        self.mode("codex", "key")
        st = connections.status()
        self.assertFalse(st["chatgpt"]["loggedIn"])
        self.assertIn("API key", st["chatgpt"]["error"])
        for s in SECRETS:
            self.assertNotIn(s, json.dumps(st))
        self.mode("codex", "out")
        self.assertIn("codex login", connections.status()["chatgpt"]["error"])

    def api(self, *outcomes, clear=True):
        """The user's key saved (with spaces around it, as pasted), and a stand-in client whose model check gives each
        outcome in turn (an error is raised); its calls are kept in self.checks. clear: the checks kept are dropped
        (else they stand, as for a key saved while they are kept)."""
        connections.DIR.mkdir(exist_ok=True)
        coach.KEY_FILE.write_text(f" {KEY}\n")
        coach.KEY_FILE.chmod(0o600)
        self.checks, left = [], list(outcomes)

        def retrieve(model_id, **kw):
            self.checks[-1]["model"] = model_id
            r = left.pop(0) if len(left) > 1 else left[0]
            if isinstance(r, Exception):
                raise r
            return types.SimpleNamespace(id=model_id)

        def client(key, **kw):
            self.checks.append({"key": key, **kw})
            return types.SimpleNamespace(models=types.SimpleNamespace(retrieve=retrieve))
        coach.api_client = client
        if clear:
            self.clear()

    def test_claude_goes_through_the_api_with_the_users_key_else_through_claude_code(self):
        st = connections.status()["claude"]                 # no key: Claude Code, and no check made
        self.assertEqual((st["transport"], st["api"]),
                         ("cli", {"configured": False, "ok": None, "error": None, "warning": None}))
        self.api("ok")
        self.mode("claude", "out")                          # (the CLI signed out: the API is enough)
        st = connections.status()
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"], st["auto"]),
                         ("api", {"configured": True, "ok": True, "error": None, "warning": None}, "claude"))
        self.assertEqual(self.checks, [{"key": KEY, "timeout": connections.CHECK_TIMEOUT_S, "max_retries": 0,
                                        "model": coach.model_id()}])
        self.assertNotIn(KEY, json.dumps(st))
        self.assertNotIn("ANTHROPIC_API_KEY", os.environ)
        self.assertEqual(self.calls("claude")[-1]["key"], False)    # (the CLI's check still sees no key)
        # the key refused: Claude Code takes over, if it is signed in
        self.api(failure(anthropic.AuthenticationError, 401, "invalid x-api-key"))
        st = connections.status()
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"], st["auto"]),
                         ("cli", {"configured": True, "ok": False, "error": coach.KEY_REFUSED, "warning": None},
                          "chatgpt"))
        self.mode("claude", "in")
        self.assertEqual(connections.status()["auto"], "claude")
        self.assertEqual(connections.status()["claude"]["transport"], "cli")
        # the model not offered to the key: a definite answer too, in the API's words (never the key)
        self.api(failure(anthropic.NotFoundError, 404, f"model: {coach.model_id()} (key {KEY})"))
        api = connections.status()["claude"]["api"]
        self.assertEqual(api["ok"], False)
        self.assertTrue(api["error"].startswith(f"the Anthropic API answered 404: model: {coach.model_id()}"))
        self.assertNotIn(KEY, api["error"])
        self.assertFalse(CHECK_FAILED.search(api["error"]))

    def test_an_api_check_that_failed_is_tried_and_checked_again_sooner(self):
        self.api(anthropic.APIConnectionError(request=REQ), "ok")
        self.mode("claude", "out")
        st = connections.status()
        api = st["claude"]["api"]
        self.assertEqual((api["configured"], api["ok"], st["claude"]["transport"], st["auto"]),
                         (True, None, "api", "claude"))              # not known to be refused: tried
        self.assertTrue(CHECK_FAILED.search(api["error"]), api["error"])   # (the page tells it from an answer)
        self.assertEqual(api["error"], "the Anthropic API did not answer (APIConnectionError)")
        connections.status()
        self.assertEqual(len(self.checks), 1)                              # kept a while
        connections.CHECK_FAILED_TTL_S = 0
        self.assertEqual(connections.status()["claude"]["api"]["ok"], True)
        self.assertEqual(len(self.checks), 2)
        connections.CHECK_FAILED_TTL_S = 0
        connections.status()
        self.assertEqual(len(self.checks), 2)                              # an answer is kept for CHECK_TTL_S
        connections.FRESH_S = 0
        connections.status(fresh=True)
        self.assertEqual(len(self.checks), 3)                              # ... unless asked fresh

    def test_a_key_saved_or_removed_since_the_check_is_checked_again_so_transport_and_use_agree(self):
        # (measured before: a key saved within a minute of a check gave transport "api" with configured False, and
        # Auto skipped Claude although Claude Code was signed in)
        self.mode("claude", "out")
        st = connections.status()                           # no key: kept for CHECK_TTL_S
        none = {"configured": False, "ok": None, "error": None, "warning": None}
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"], st["auto"]), ("cli", none, "chatgpt"))
        self.api("ok", clear=False)                         # a key saved since
        st = connections.status()
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"], st["auto"]),
                         ("api", {**none, "configured": True, "ok": True}, "claude"))
        self.assertEqual(len(self.checks), 1)
        connections.status()
        self.assertEqual(len(self.checks), 1)                              # (agreeing: kept as before)
        # the key removed: Claude Code again, with what its own check says (signed out here)
        coach.KEY_FILE.unlink()
        st = connections.status()
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"], st["auto"]), ("cli", none, "chatgpt"))
        self.assertEqual(len(self.checks), 1)                              # (no key: no request)
        self.assertEqual(len(self.calls("claude")), 1)                     # (the CLI's check, kept all along)

    def test_a_key_file_other_users_can_open_is_a_warning_not_an_error(self):
        self.api("ok")
        coach.KEY_FILE.chmod(0o644)                         # (umask 077 sets no mode on a file that was already there)
        st = connections.status()
        api = st["claude"]["api"]
        self.assertEqual((api["ok"], api["error"], st["claude"]["transport"], st["auto"]),
                         (True, None, "api", "claude"))
        self.assertEqual(api["warning"],
                         f"the key file is mode 644, open to other users of this machine: chmod 600 {coach.KEY_FILE}")
        self.assertNotIn(KEY, json.dumps(st))
        coach.KEY_FILE.chmod(0o640)
        self.clear()
        self.assertIn("mode 640", connections.status()["claude"]["api"]["warning"])
        coach.KEY_FILE.chmod(0o600)
        self.clear()
        self.assertIsNone(connections.status()["claude"]["api"]["warning"])
        # (inside the repo it is named from there, as the docs name it)
        coach.KEY_FILE.chmod(0o604)
        saved, connections.ROOT = connections.ROOT, self.tmp
        try:
            self.assertTrue(connections.key_warning().endswith("chmod 600 connections/anthropic-key"))
        finally:
            connections.ROOT = saved

    def test_claude_code_when_asked_for_whatever_the_key(self):
        self.api("ok")
        coach.TRANSPORT = "cli"
        st = connections.status()
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"]["ok"], st["auto"]), ("cli", True, "claude"))
        self.mode("claude", "out")
        self.assertEqual(connections.status()["auto"], "chatgpt")         # usable by the CLI alone
        coach.TRANSPORT = "api"
        coach.KEY_FILE.unlink()
        self.clear()
        st = connections.status()                                          # the API asked for, with no key
        self.assertEqual((st["claude"]["transport"], st["claude"]["api"]["configured"], st["auto"]),
                         ("api", False, "chatgpt"))

    def test_a_cli_not_found_is_not_available(self):
        coach.claude_cli = coach.codex_cli = lambda: None
        st = connections.status()
        self.assertEqual((st["claude"]["available"], st["claude"]["loggedIn"]), (False, False))
        self.assertEqual((st["chatgpt"]["available"], st["chatgpt"]["loggedIn"]), (False, False))
        self.assertIn("not found", st["claude"]["error"])
        self.assertEqual(st["auto"], "none")

    def test_the_checks_are_kept_for_a_while_and_one_runs_for_many_callers(self):
        for _ in range(3):
            connections.status()
        self.assertEqual((len(self.calls("claude")), len(self.calls("codex"))), (1, 1))
        connections.CHECK_TTL_S = 0                         # out of date: checked again
        connections.status()
        self.assertEqual((len(self.calls("claude")), len(self.calls("codex"))), (2, 2))
        connections.CHECK_TTL_S = 60
        self.clear()
        threads = [threading.Thread(target=connections.status) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(20)
        self.assertEqual((len(self.calls("claude")), len(self.calls("codex"))), (3, 3))

    def test_fresh_checks_again_unless_just_checked(self):
        self.assertTrue(connections.status()["claude"]["loggedIn"])
        (self.tmp / "claude-mode").write_text("out")        # signed out since (or, the other way, signed in)
        self.assertTrue(connections.status()["claude"]["loggedIn"])          # kept
        connections.FRESH_S = 0
        self.assertFalse(connections.status(fresh=True)["claude"]["loggedIn"])
        self.assertEqual((len(self.calls("claude")), len(self.calls("codex"))), (2, 2))
        connections.FRESH_S = 60                            # asked again at once: the check just made stands
        connections.status(fresh=True)
        self.assertEqual((len(self.calls("claude")), len(self.calls("codex"))), (2, 2))

    def test_a_check_that_failed_is_kept_for_less_time_than_an_answer(self):
        connections.CHECK_TIMEOUT_S = 0.5
        self.mode("claude", "slow")
        self.assertIn("did not answer", connections.status()["claude"]["error"])
        (self.tmp / "claude-mode").write_text("in")
        self.assertFalse(connections.status()["claude"]["loggedIn"])         # kept a while
        connections.CHECK_FAILED_TTL_S = 0
        st = connections.status()["claude"]
        self.assertTrue(st["loggedIn"])                                       # checked again
        self.assertNotIn("failed", st)                                        # (kept in the module)
        (self.tmp / "claude-mode").write_text("out")
        self.assertTrue(connections.status()["claude"]["loggedIn"])          # an answer is kept for CHECK_TTL_S

    def test_the_page_can_tell_a_check_that_failed_from_an_answer(self):
        self.mode("claude", "out")
        answers = [connections.status()["claude"]["error"]]
        for mode in ("out", "key"):                         # (codex signed in with an API key: a definite answer too)
            self.mode("codex", mode)
            answers.append(connections.status()["chatgpt"]["error"])
        for err in answers:
            self.assertFalse(CHECK_FAILED.search(err), err)
        failures = []
        self.mode("claude", "junk")
        failures.append(connections.status()["claude"]["error"])
        connections.CHECK_TIMEOUT_S = 0.5
        self.mode("claude", "slow")
        self.mode("codex", "slow")
        st = connections.status()
        failures += [st["claude"]["error"], st["chatgpt"]["error"]]
        (self.tmp / "claude").chmod(0o644)                  # it cannot run
        self.clear()
        failures.append(connections.status()["claude"]["error"])
        for err in failures:
            self.assertTrue(CHECK_FAILED.search(err), err)

    def test_a_check_that_hangs_is_given_up_on_soon(self):
        connections.CHECK_TIMEOUT_S = 0.5
        self.mode("claude", "slow")
        (self.tmp / "codex-mode").write_text("slow")
        t0 = time.monotonic()
        st = connections.status()
        self.assertLess(time.monotonic() - t0, 2.5)        # the two side by side, each cut at 0.5 s
        self.assertFalse(st["claude"]["loggedIn"] or st["chatgpt"]["loggedIn"])
        self.assertIn("did not answer in 0.5 s", st["claude"]["error"])
        self.assertIn("did not answer in 0.5 s", st["chatgpt"]["error"])

    def test_the_agent_comes_from_the_env_else_the_record_else_the_legacy_file(self):
        self.assertIsNone(connections.eleven_agent_id())
        connections.LEGACY.write_text(OTHER + "\n")
        self.assertEqual(connections.eleven_agent_id(), OTHER)
        connections.save_eleven(AGENT, "starter")
        self.assertEqual(connections.eleven_agent_id(), AGENT)
        os.environ["POSE_ELEVEN_AGENT"] = OTHER
        st = connections.eleven_status()
        self.assertEqual(st["agentId"], OTHER)
        self.assertIsNone(st["plan"])                       # the record is about its own agent, not this one
        os.environ["POSE_ELEVEN_AGENT"] = "invalid-agent"     # not an agent id: the next place counts
        self.assertEqual(connections.eleven_agent_id(), AGENT)
        (connections.DIR / "elevenlabs.json").write_text('{"agentId": "agent_/../x"}')
        connections.LEGACY.write_text("not an agent")
        self.assertIsNone(connections.eleven_agent_id())

    def test_saving_keeps_what_the_record_says_of_the_same_agent_and_is_private(self):
        f = connections.DIR / "elevenlabs.json"
        connections.DIR.mkdir()
        f.write_text(json.dumps({"agentId": AGENT, "name": "Rhythm coach (pose-coach)", "llm": "deepseek-v41-flash",
                                 "plan": "free"}))
        connections.save_eleven(AGENT, "starter")
        st = connections.eleven_status()
        self.assertEqual((st["name"], st["llm"], st["plan"], st["paid"]),
                         ("Rhythm coach (pose-coach)", "deepseek-v41-flash", "starter", True))
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        connections.save_eleven(OTHER, None)
        st = connections.eleven_status()
        self.assertEqual((st["agentId"], st["name"], st["llm"], st["paid"]), (OTHER, None, None, None))
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        self.assertEqual([p.name for p in connections.DIR.iterdir()], ["elevenlabs.json"])   # no temporary file left

    def test_only_an_agent_id_and_a_plan_name_are_saved(self):
        for agent_id in (None, 7, "", "agent_", "agent_" + "a" * 19, "agent_" + "a" * 41, "agent_" + "ABCDEFGHIJKLMNOPQRSTU",
                         AGENT + "\n", "../" + AGENT):
            with self.assertRaises(ValueError, msg=agent_id):
                connections.save_eleven(agent_id, None)
        for plan in ("", "Starter", "x" * 41, 3, "free\n", "<b>"):
            with self.assertRaises(ValueError, msg=plan):
                connections.save_eleven(AGENT, plan)
        self.assertFalse((connections.DIR / "elevenlabs.json").exists())

    def test_the_same_agent_saved_again_after_forgetting_it_keeps_its_record(self):
        connections.DIR.mkdir()
        record = {"agentId": AGENT, "name": "Rhythm coach (pose-coach)", "llm": "deepseek-v41-flash", "plan": "starter",
                  "setUp": "2026-10-20", "via": "elevenlabs mcp"}
        (connections.DIR / "elevenlabs.json").write_text(json.dumps(record))
        connections.forget_eleven()
        connections.save_eleven(AGENT, "pro")
        self.assertEqual(connections.eleven_record(), {**record, "plan": "pro"})
        connections.forget_eleven()
        connections.save_eleven(OTHER, None)                # another agent: a record of its own
        self.assertEqual(set(connections.eleven_record()), {"agentId", "plan", "setUp"})

    def test_forgetting_moves_the_record_and_the_legacy_id_aside(self):
        connections.LEGACY.write_text(OTHER)
        connections.save_eleven(AGENT, "starter")
        connections.forget_eleven()
        self.assertEqual(connections.eleven_status()["connected"], False)
        self.assertTrue((connections.DIR / "elevenlabs.json.forgotten").is_file())
        self.assertTrue(connections.LEGACY.with_name("eleven-agent-id.forgotten").is_file())
        connections.forget_eleven()                         # nothing left to forget
        os.environ["POSE_ELEVEN_AGENT"] = AGENT              # the environment still names one
        self.assertEqual(connections.eleven_status()["agentId"], AGENT)


class FastMode(unittest.TestCase):
    """POSE_COACH_FAST asks for fast mode, which the CLI has on Opus models only: never on another model."""

    def fast(self, **env) -> tuple[bool, str]:
        out = subprocess.run([sys.executable, "-c", "import coach; print(coach.FAST, coach.model_id())"], cwd=SERVER,
                             env={**{k: v for k, v in os.environ.items() if not k.startswith("POSE_COACH_")}, **env},
                             capture_output=True, text=True, check=True).stdout.split()
        return out[0] == "True", out[1]

    def test_fast_only_when_asked_and_on_opus(self):
        self.assertEqual(self.fast(), (False, "claude-sonnet-5-5"))                  # the default: Sonnet
        self.assertEqual(self.fast(POSE_COACH_FAST="1"), (False, "claude-sonnet-5-5"))
        self.assertEqual(self.fast(POSE_COACH_MODEL="opus"), (False, "claude-opus-5-5"))
        self.assertEqual(self.fast(POSE_COACH_MODEL="opus", POSE_COACH_FAST="1"), (True, "claude-opus-5-5"))
        self.assertEqual(self.fast(POSE_COACH_MODEL="claude-opus-5-5", POSE_COACH_FAST="1"), (True, "claude-opus-5-5"))
        self.assertEqual(self.fast(POSE_COACH_MODEL="haiku", POSE_COACH_FAST="1"), (False, "claude-haiku-5-5"))


if __name__ == "__main__":
    unittest.main()
