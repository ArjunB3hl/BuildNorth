"""The coach's brains (server/coach.py): the claude and codex command lines, and a codex coach kept going through the
dev server's own endpoints by a stand-in codex that plays the model (it asks for events and says cues as the MCP server
would, then ends its turn as told): started again with what it said, given up on when it cannot keep going (each run
judged on the events it was given itself), a run that never connects ended (a restart sooner), and a poll of an ended
run given no event. And where codex_cli finds an npm install under nvm, and the one-line reading of each event (the
tracker's questions, the user's answers, how a set ended, what the user said and what the page did with it, or that
it did nothing; a movement of the library the user named and its hold, moving and rhythm events, from a made-up
library; a hold's measured form: its fault, fix, clean checks, a fault waiting its turn, checks out of view or not seen
from this side, the faults the user was told of at its end, or that it is not measured), and what Claude and ChatGPT
are told (the exercises the tracker counts are the engine's; the agent's rules for the named movements; never to call
form good unless it was measured; the library's names when it is built). And Claude through the Anthropic API with a
stand-in client (never the API, never the user's own key): the request (max_tokens by thinking), each event one
message, the reply said (a reply cut short not at all), the history append-only, refusals, the API's failures and the
one retry, events the page no longer waits for told with the next one, nothing sent after a stop, when the API is
taken, the real client to api.anthropic.com alone (whatever the environment says; nothing sent), and the key in no
log, status or error.

    .venv/bin/python -m unittest tests/test_coach.py      (from inference/pose-coach; Python 3.11+ for tomllib; the
                                                           .venv for the anthropic SDK's own types)
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
import tomllib
import types
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import anthropic
import httpx2
from anthropic.types.beta import BetaMessage

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))
import coach  # noqa: E402
import connections  # noqa: E402
import dev_server  # noqa: E402


def no_api(*a, **k):
    raise AssertionError("a test reached for the Anthropic API")


# no test reads the user's own key or reaches the API: a key file that is not there (a test writes its own made-up
# key), and a client that fails the test (a test puts its stand-in in its place)
coach.KEY_FILE = Path(tempfile.gettempdir()) / "pose-coach-tests" / "no-anthropic-key"
coach.TRANSPORT = "auto"
coach.api_client = no_api

# the stand-in codex: reads its -c values as Codex would (TOML), logs each run in "runs", then follows its run's step
# in "plan": a number (answer that many events, then end the turn), "exit" (end before asking for anything), "hang"
# (never ask), "idle" (ask once, get nothing, end the turn), "drop" (take an event, end without a cue: killed, or an API
# error mid-turn) or "once" (answer one event, ask for the next, get nothing, end the turn)
FAKE_CODEX = """
import json, os, sys, time, tomllib, urllib.request
here, args = os.path.dirname(os.path.abspath(__file__)), sys.argv[1:]
cfg = {args[i + 1].partition("=")[0]: tomllib.loads("v = " + args[i + 1].partition("=")[2])["v"]
       for i, a in enumerate(args) if a == "-c"}
env = cfg["mcp_servers.pose.env"]
base, sid, run = env["POSE_SERVER"], env["POSE_COACH_SESSION"], env["POSE_COACH_RUN"]
with open(os.path.join(here, "runs"), "a") as f:
    f.write(json.dumps({"run": run, "prompt": args[-1], "key": "OPENAI_API_KEY" in os.environ, "cfg": cfg}) + "\\n")
plan = json.load(open(os.path.join(here, "plan")))
step = plan[min(int(run), len(plan)) - 1]

def call(path, body=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

if step == "exit":
    sys.exit(1)
if step == "hang":
    time.sleep(60)
    sys.exit(0)
if step == "idle":
    call(f"/api/coach/next?session={sid}&timeout=0.2&run={run}")
    sys.exit(0)
if step == "drop":
    while True:
        ev = call(f"/api/coach/next?session={sid}&timeout=5&run={run}")
        if ev.get("done") or "event_id" in ev:
            sys.exit(0)
left = 1 if step == "once" else step
while left:
    ev = call(f"/api/coach/next?session={sid}&timeout=5&run={run}")
    if ev.get("done"):
        sys.exit(0)
    if not ev.get("idle"):
        call("/api/coach/say", {"session": sid, "text": f"run {run} answers {ev['event_id']}"})
        left -= 1
if step == "once":
    call(f"/api/coach/next?session={sid}&timeout=0.2&run={run}")
"""


def wait_for(cond, timeout=15.0):
    end = time.monotonic() + timeout
    while not cond():
        if time.monotonic() > end:
            raise AssertionError("timed out")
        time.sleep(0.02)


class Codex(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dev_server.Handler.log_message = lambda *a: None
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), dev_server.Handler)
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pose-coach-codex-"))
        (self.tmp / "fake.py").write_text(FAKE_CODEX)
        codex = self.tmp / "codex"
        codex.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{self.tmp / "fake.py"}" "$@"\n')
        codex.chmod(0o755)
        self.saved = (coach.codex_cli, coach.CONNECT_LIMIT_S, coach.RECONNECT_LIMIT_S, connections.CHATGPT.get)
        coach.codex_cli = lambda: str(codex)
        connections.CHATGPT.get = lambda *a, **k: {"available": True, "loggedIn": True, "error": None, "failed": False}
        os.environ["OPENAI_API_KEY"] = "sk-test"          # the coach runs on the ChatGPT login: it must not see a key

    def tearDown(self):
        coach.stop_all()
        coach.SESSIONS.clear()
        coach.codex_cli, coach.CONNECT_LIMIT_S, coach.RECONNECT_LIMIT_S, connections.CHATGPT.get = self.saved
        os.environ.pop("OPENAI_API_KEY", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def start(self, plan: list) -> coach.Session:
        (self.tmp / "plan").write_text(json.dumps(plan))
        sid = coach.start({"exercise": "workout", "brain": "chatgpt"}, self.tmp / "data", self.url)["session"]
        return coach.get(sid)

    def runs(self) -> list[dict]:
        f = self.tmp / "runs"
        return [json.loads(line) for line in f.read_text().splitlines()] if f.exists() else []

    def cue(self, s: coach.Session, kind="cue") -> str:
        n = len(s.said)
        s.push({"kind": kind, "exercise": "squat", "exerciseLabel": "Squat", "reps": 3, "message": "Go deeper"})
        wait_for(lambda: len(s.said) > n)
        return s.said[-1]["text"]

    def end(self, s: coach.Session):
        with s.cond:
            s.done = True
            s.cond.notify_all()
        wait_for(lambda: not s.alive())

    def test_no_chatgpt_sign_in_no_codex(self):
        connections.CHATGPT.get = lambda *a, **k: {"available": True, "loggedIn": False, "failed": False,
                                                   "error": "signed in with an API key, not ChatGPT: run codex login"}
        with self.assertRaises(ValueError):
            coach.start({"exercise": "workout", "brain": "chatgpt"}, self.tmp, self.url)
        self.assertFalse(coach.SESSIONS)                           # no session, so no codex was started

    def test_the_command_line_is_codex_with_the_coach_instructions_and_the_pose_tools_only(self):
        s = self.start([1000])
        self.assertEqual(self.cue(s, "start"), "run 1 answers 1")
        [run] = self.runs()
        cfg = run["cfg"]                                   # (every -c value read as TOML, as Codex reads it)
        self.assertFalse(run["key"])
        self.assertTrue(run["prompt"].startswith(coach.FIRST_PROMPT))
        self.assertIn("a workout summary is not the end", run["prompt"])
        self.assertEqual(Path(cfg["model_instructions_file"]).read_text(), s.system)
        self.assertTrue(s.system.startswith(coach.SYSTEM))                   # (and the library's names, when built)
        self.assertEqual(cfg["approval_policy"], "never")
        self.assertEqual(cfg["mcp_servers.pose.command"], str(coach.VENV_PY))
        self.assertEqual(cfg["mcp_servers.pose.args"], [str(SERVER / "pose_mcp.py")])
        self.assertEqual(cfg["mcp_servers.pose.env"], {"POSE_SERVER": self.url, "POSE_COACH_SESSION": s.id,
                                                       "POSE_COACH_RUN": "1"})
        self.assertEqual(cfg["mcp_servers.pose.enabled_tools"], ["wait_for_event", "say"])
        self.assertEqual(cfg["mcp_servers.pose.default_tools_approval_mode"], "approve")
        self.assertGreater(cfg["mcp_servers.pose.tool_timeout_sec"], 300)   # wait_for_event blocks up to 300 s
        cmd = s.codex_cmd("p", 1)
        for flag in ("--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--ephemeral", "--json"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("-m") + 1], coach.CHATGPT_MODEL)
        self.assertEqual(cmd[cmd.index("-s") + 1], "read-only")
        self.assertIn("shell_tool", [cmd[i + 1] for i, a in enumerate(cmd) if a == "--disable"])
        self.assertEqual(s.said_since(0)["brain"], "chatgpt")
        self.assertIsNotNone(s.said_since(0)["connect_ms"])
        self.end(s)
        log = (s.dir / f"session-{s.id}.jsonl")
        self.assertTrue(log.is_file())                     # the run's output, as a Claude session's

    def test_a_run_that_ends_mid_workout_is_started_again_with_what_it_said(self):
        s = self.start([2, 1000])
        self.assertEqual(self.cue(s, "start"), "run 1 answers 1")
        self.assertEqual(self.cue(s), "run 1 answers 2")          # ... and that run ends its turn
        self.assertEqual(self.cue(s), "run 2 answers 3")
        self.assertTrue(s.said_since(0)["alive"])
        first, second = self.runs()
        self.assertNotIn("run 1 answers", first["prompt"])
        self.assertIn("- (start) run 1 answers 1\n- (cue) run 1 answers 2", second["prompt"])
        self.assertIn("do not greet the user again", second["prompt"])
        self.end(s)
        self.assertIsNone(s.error)
        self.assertIn('"type": "pose_coach.restart", "run": 2', (s.dir / f"session-{s.id}.jsonl").read_text())

    def test_a_restart_is_not_told_of_words_it_let_pass(self):
        s = coach.Session("workout", self.tmp / "data", self.url, "chatgpt")
        s.said = [{"text": "Lunges, got it.", "kind": "user_said"}, {"text": "", "kind": "user_said"}]
        self.assertEqual(s.codex_prompt().splitlines()[1:2], ["- (user_said) Lunges, got it."])
        self.assertNotIn("- (user_said) \n", s.codex_prompt())
        s.said = [{"text": "", "kind": "user_said"}]                     # (only that: as a first run)
        self.assertTrue(s.codex_prompt().startswith(coach.FIRST_PROMPT))

    def test_runs_that_end_with_nothing_to_answer_do_not_count_against_it(self):
        s = self.start(["idle"] * (coach.RESTARTS + 2) + [1000])  # (a turn ended in a rest)
        wait_for(lambda: s.runs > coach.RESTARTS + 2)
        self.assertEqual(self.cue(s), f"run {s.runs} answers 1")
        self.assertIsNone(s.error)

    def test_a_run_is_judged_on_its_own_events_not_on_one_an_earlier_run_left(self):
        # a run takes an event and ends without its cue; the runs after it end in a rest (between workouts, say)
        s = self.start([2, "drop", "idle", "idle", 1000])
        self.cue(s, "start")
        self.cue(s)
        s.push({"kind": "cue", "exercise": "squat", "exerciseLabel": "Squat", "reps": 4, "message": "Go deeper"})
        wait_for(lambda: s.runs >= 5)
        self.assertEqual(self.cue(s), "run 5 answers 4")
        self.assertIsNone(s.error)
        self.assertTrue(s.said_since(0)["alive"])
        log = (s.dir / f"session-{s.id}.jsonl").read_text()
        self.assertIn('"run": 3, "after": "ended with an event unanswered (exit 0)"', log)
        self.assertIn('"run": 4, "after": "idle"', log)

    def test_a_coach_that_ends_its_turn_after_every_cue_is_given_up_on(self):
        # started again for every event, each cue would come after the page spoke its own
        s = self.start([1])
        for i in range(coach.RESTARTS + 1):
            self.assertEqual(self.cue(s, "start" if i == 0 else "cue"), f"run {i + 1} answers {i + 1}")
        wait_for(lambda: s.done)
        self.assertEqual(len(self.runs()), coach.RESTARTS + 1)
        self.assertEqual(s.error, f"codex ended its turn after a single cue, {coach.RESTARTS + 1} runs in a row")
        self.assertFalse(s.said_since(0)["alive"])
        self.assertIn('"type": "pose_coach.gave_up"', (s.dir / f"session-{s.id}.jsonl").read_text())

    def test_a_run_that_asks_for_more_after_one_cue_is_fine(self):
        s = self.start(["once"] * (coach.RESTARTS + 2) + [1000])
        for i in range(coach.RESTARTS + 3):
            self.assertEqual(self.cue(s), f"run {i + 1} answers {i + 1}")
            if i < coach.RESTARTS + 2:
                wait_for(lambda: s.runs > i + 1)               # (its turn has ended: the next event is the next run's)
        self.assertIsNone(s.error)
        self.assertTrue(s.said_since(0)["alive"])

    def test_a_coach_that_cannot_keep_going_ends_the_session_so_the_page_moves_on(self):
        s = self.start(["exit"])
        wait_for(lambda: s.done)
        self.assertEqual(len(self.runs()), coach.RESTARTS + 1)
        r = s.said_since(0)
        self.assertFalse(r["alive"])
        self.assertIn("ended before it connected", r["error"])

    def test_a_run_that_never_asks_for_an_event_is_ended(self):
        # Include interpreter startup on a busy machine; still exhaust every bounded retry.
        coach.CONNECT_LIMIT_S = coach.RECONNECT_LIMIT_S = 2
        s = self.start(["hang"])
        wait_for(lambda: s.done)
        self.assertEqual(len(self.runs()), coach.RESTARTS + 1)
        self.assertIn("did not connect in 2 s", s.error)
        self.assertFalse(s.alive())

    def test_a_restart_that_hangs_is_given_up_on_sooner_than_the_first_run(self):
        # the page shows a session that has connected as connected: it waits on its restarts with no limit of its own
        coach.CONNECT_LIMIT_S, coach.RECONNECT_LIMIT_S = 30, 0.3
        s = self.start([2, "hang"])
        self.cue(s, "start")
        self.cue(s)
        t0 = time.monotonic()
        wait_for(lambda: s.done)
        self.assertLess(time.monotonic() - t0, 10)
        self.assertEqual(s.error, f"codex did not connect in 0.3 s, {coach.RESTARTS + 1} runs in a row")

    def test_an_event_waits_for_the_next_run_not_for_a_poll_of_the_ended_one(self):
        s = coach.Session("workout", self.tmp / "data", self.url, "chatgpt")
        s.proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        s.runs = 2
        try:
            s.push({"kind": "cue"})
            self.assertEqual(s.next_event(0.1, "1"), {"done": True})         # run 1's MCP server, still polling
            self.assertEqual(len(s.events), 1)
            self.assertEqual(s.next_event(0.1, "2")["event_id"], 1)
            got = []
            poll = threading.Thread(target=lambda: got.append(s.next_event(5, "2")))
            poll.start()
            time.sleep(0.1)
            s.proc.kill()                                                    # run 2 ends while its poll is open
            s.proc.wait()
            s.push({"kind": "cue"})
            poll.join(5)
            self.assertEqual(got, [{"done": True}])
            self.assertEqual(len(s.events), 1)                               # kept for the run after
            self.assertEqual(s.next_event(0.1)["event_id"], 2)                # (a Claude session's poll has no run)
        finally:
            if s.proc.poll() is None:
                s.proc.kill()


class CodexCli(unittest.TestCase):
    """npm's codex under nvm, for a server started without nvm on PATH (from launchd or an app)."""

    def find(self, home: Path, **env) -> str:
        return subprocess.run([sys.executable, "-c", "import coach; print(coach.codex_cli())"], cwd=SERVER, check=True,
                              env={"HOME": str(home), "PATH": "/usr/bin:/bin", **env}, capture_output=True,
                              text=True).stdout.strip()

    def test_codex_is_found_under_nvm_the_default_node_first(self):
        if any(Path(p).exists() for p in ("/usr/bin/codex", "/bin/codex", "/opt/homebrew/bin/codex",
                                          "/usr/local/bin/codex")):
            self.skipTest("a codex outside nvm would be found first")
        home = Path(tempfile.mkdtemp(prefix="pose-coach-nvm-"))
        try:
            nodes = home / ".nvm" / "versions" / "node"
            for v in ("v9.0.0", "v20.1.0", "v23.5.0"):
                (nodes / v / "bin").mkdir(parents=True)
                (nodes / v / "bin" / "codex").write_text("")
            self.assertEqual(self.find(home), str(nodes / "v23.5.0" / "bin" / "codex"))      # the newest (not v9)
            (home / ".nvm" / "alias").mkdir()
            (home / ".nvm" / "alias" / "default").write_text("20\n")                        # nvm's default
            self.assertEqual(self.find(home), str(nodes / "v20.1.0" / "bin" / "codex"))
            self.assertEqual(self.find(home, NVM_BIN=str(nodes / "v9.0.0" / "bin")),        # the node in use
                             str(nodes / "v9.0.0" / "bin" / "codex"))
            self.assertEqual(self.find(home / "nowhere"), "None")
        finally:
            shutil.rmtree(home, ignore_errors=True)


class Describe(unittest.TestCase):
    """The one-line reading every coach gets with an event (the agent too, through /api/coach/describe)."""

    # as the page sends them in auto mode: every event is tagged exercise and exerciseLabel "workout" (no set yet), and
    # the event's own fields come after
    AUTO = {"exercise": "workout", "exerciseLabel": "workout", "auto": True}

    def read(self, **event) -> str:
        line = coach.describe({**self.AUTO, **event})["summary"]
        self.assertNotIn("\n", line)
        self.assertNotIn("None", line, event)
        return line

    def test_the_questions_say_what_to_ask(self):
        ask = self.read(kind="ask_exercise")
        self.assertIn("ask which exercise", ask)
        self.assertIn("Greet them if you have not yet", ask)               # (a session may have greeted already)
        self.assertIn("recognise it as they go", self.read(kind="exercise_auto"))
        done = self.read(kind="confirm_set_end", exercise="squat", label="Squat", set=2, reps=8)
        self.assertIn("set 2 of Squat may be over, 8 reps counted", done)
        self.assertIn("ask if they are done with this set", done)
        # (the page may tag it as it tags a set's own events)
        self.assertIn("set 1 of Push-up may be over, 6 reps", self.read(kind="confirm_set_end", exercise="pushup",
                                                                         exerciseLabel="Push-up", set=1, reps=6))

    def test_the_users_answers_name_the_exercise_not_the_workout(self):
        self.assertEqual(self.read(kind="exercise_set", exercise="lunge", label="Lunge"),
                         "The user chose Lunge: only Lunge is counted now. Confirm in a few words.")
        self.assertIn("chose lunge", self.read(kind="exercise_set", exercise="lunge"))          # (no label sent)
        auto = self.read(kind="exercise_set", exercise="auto", label="Detect for me")
        self.assertIn("recognised as they go", auto)
        self.assertNotIn("Detect for me", auto)
        # a gym exercise of the movement library, tapped: confirmed by the name the user chose, counted as its exercise
        self.assertEqual(self.read(kind="exercise_set", exercise="squat", label="Squat", movement="made_up_squat",
                                   display="Made-up squat"),
                         "The user chose Made-up squat (counted as Squat): only Squat is counted now. Confirm in a few "
                         "words.")
        self.assertIn("The user chose Push-up: only", self.read(kind="exercise_set", exercise="pushup", label="Push-up",
                                                                movement="made_up_pushup", display="push-up"))

    def test_a_set_ends_after_a_rest_or_when_the_user_says_so(self):
        set_end = {"kind": "set_end", "exercise": "squat", "exerciseLabel": "Squat", "set": 2, "reps": 8}
        self.assertEqual(self.read(**set_end), "Set 2 of Squat finished (after a rest): 8 reps.")   # (as before)
        self.assertEqual(self.read(**set_end, reason="rest"), "Set 2 of Squat finished (after a rest): 8 reps.")
        self.assertEqual(self.read(**set_end, reason="confirmed"),
                         "Set 2 of Squat finished (the user tapped Done): 8 reps.")
        # (a movement of the library named with a tap ends the set in progress: reps pause; its movement_set comes
        # next, and a second cue in a row would cut the first off, so the reps go with that one, as the page's own)
        self.assertEqual(self.read(**set_end, reason="movement"),
                         "Set 2 of Squat finished (the user named a movement of the library, so no reps are counted "
                         "meanwhile): 8 reps. Say nothing now: give these reps when you confirm the movement they "
                         "named, which comes next.")

    def test_what_the_user_said_is_answered_or_what_the_page_did_with_it_confirmed(self):
        said = lambda text, **applied: self.read(kind="user_said", text=text, **({"applied": applied} if applied else {}))
        self.assertEqual(said("now lunges", type="exercise", exercise="lunge", label="Lunge"),
                         'The user said: "now lunges". The page switched to counting Lunge: confirm in a few words.')
        self.assertIn("counting lunge:", said("lunges", type="exercise", exercise="lunge"))     # (no label sent)
        self.assertEqual(said("made-up squats", type="exercise", exercise="squat", label="Squat",
                              movement="made_up_squat", display="Made-up squat"),
                         'The user said: "made-up squats". The page switched to Made-up squat (counted as Squat): '
                         "confirm in a few words.")
        self.assertEqual(said("you figure it out", type="auto"), 'The user said: "you figure it out". The page '
                         "recognises the exercise as they go now: confirm in a few words.")
        self.assertEqual(said("yes, done", type="set_end", done=True, label="Squat", set=2, reps=8),
                         'The user said: "yes, done". The page ended set 2 of Squat at 8 reps: confirm in a few words, '
                         "with the reps.")
        self.assertEqual(said("one more", type="set_end", done=False, label="Squat", set=2, reps=1),
                         'The user said: "one more". The page keeps set 2 of Squat going (1 rep so far): confirm in a '
                         "few words.")
        self.assertEqual(said("done", type="set_end", done=True), 'The user said: "done". The page ended the set: '
                         "confirm in a few words.")
        # anything else (a question, words outside a workout) is answered; the words are one quoted line
        self.assertEqual(said("how was my squat depth?"), 'The user said: "how was my squat depth?". Answer them.')
        self.assertEqual(said('he said "go"\n  now'), """The user said: "he said 'go' now". Answer them.""")
        self.assertEqual(said("hello", type="mystery"), 'The user said: "hello". Answer them.')
        # mid-set (tagged like a set's own events) in a few words; outside a workout (Talk to coach) knowing it
        self.assertEqual(self.read(kind="user_said", text="is this deep enough?", workout=True, exercise="squat",
                                   exerciseLabel="Squat", set=2, reps=5),
                         'The user said: "is this deep enough?". The page changed nothing: it still counts Squat, and '
                         "they are mid-set (set 2, 5 reps so far): answer in a few words.")
        self.assertEqual(self.read(kind="user_said", text="what should I warm up with?", workout=False),
                         'The user said: "what should I warm up with?". No workout is running, so nothing is counted: '
                         "answer them.")
        self.assertEqual(self.read(kind="user_said", text="switch to curls", workout=True, exercise="squat",
                                   exerciseLabel="Squat", set=2, reps=5,
                                   applied={"type": "exercise", "exercise": "biceps_curl", "label": "Biceps curl"}),
                         'The user said: "switch to curls". The page switched to counting Biceps curl: confirm in a '
                         "few words.")
        self.assertLess(len(said("word " * 400)), 600)

    def test_words_the_page_did_not_apply_are_never_confirmed_as_a_switch(self):
        # a name the page did not take (one it cannot count, or a garbled one): the coach is told nothing changed, and
        # what is counted still (measured before: "Burpees, great choice." and "Mountain climbers, got it.")
        start = self.read(kind="user_said", text="Let's do burpees.", workout=True)
        self.assertEqual(start, 'The user said: "Let\'s do burpees.". The page changed nothing: it still '
                                "recognises the exercise as they go. Answer them.")
        chosen = self.read(kind="user_said", text="Let's do burpees.", workout=True, auto=False)
        self.assertIn("The page changed nothing: it still counts the exercise they chose.", chosen)
        mid = self.read(kind="user_said", text="Now mountain climbers.", workout=True, exercise="squat",
                        exerciseLabel="Squat", set=1, reps=4)
        self.assertIn("The page changed nothing: it still counts Squat, and they are mid-set (set 1, 4 reps so "
                      "far)", mid)
        self.assertIn("The page changed nothing.", self.read(kind="user_said", text="lunges", workout=True, auto=None))
        rules = " ".join(coach.SYSTEM.split())
        for rule in ("Never confirm a choice or a switch of exercise or movement, nor the end of a set, unless the "
                     "event says the page did it", "When it says the page changed nothing, nothing changed",
                     "tell them it cannot count or track that one",
                     "tell them to tap it, or to say it again as a short switch",
                     "With no workout running nothing is counted"):
            self.assertIn(rule, rules)

    def test_claude_and_chatgpt_are_told_the_exercises_the_engine_counts_and_no_other(self):
        # the labels of EXERCISES in web/js/engine.js, one per exercise: a new one must be named to the coach too
        src = (SERVER.parent / "web" / "js" / "engine.js").read_text()
        body = src[src.index("export const EXERCISES = {"):]
        labels = re.findall(r"^    label: '([^']+)'", body, re.M)
        self.assertEqual(len(labels), 13)
        named = " ".join(coach.SYSTEM.split())
        listed = named[named.index("It counts these exercises and no other: "):].split(": ", 1)[1].split(".")[0]
        self.assertEqual(listed.split(", "), [label.lower().replace(" / ", " or ") for label in labels])

    def test_a_question_the_user_cannot_answer_by_voice_says_so(self):
        # (the page tags the questions `listening`: false when nothing hears the user: no speech to text, the
        # microphone refused or muted; then they tap, and the coach must not ask them to say it)
        for kind, extra in (("ask_exercise", {}), ("confirm_set_end", {"label": "Squat", "set": 2, "reps": 8})):
            plain = self.read(kind=kind, **extra)
            self.assertEqual(self.read(kind=kind, listening=False, **extra), f"{plain} {coach.UNHEARD}")
            self.assertEqual(self.read(kind=kind, listening=True, **extra), plain)
            self.assertNotIn("cannot talk", plain)
        self.assertNotIn("cannot talk", self.read(kind="set_end", listening=False, set=2, reps=8))
        self.assertIn("If the event says they cannot talk to you right now, never ask them to say it",
                      " ".join(coach.SYSTEM.split()))

    def test_claude_and_chatgpt_are_told_they_ask_and_how_the_user_answers(self):
        rules = " ".join(coach.SYSTEM.split())
        for kind in ("ask_exercise", "exercise_auto", "exercise_set", "confirm_set_end", "user_said"):
            self.assertIn(kind, rules)
        self.assertNotIn("You cannot hear the user", rules)
        self.assertIn("They can always answer with buttons on screen", rules)
        self.assertIn("the page is not always listening", rules)
        self.assertIn("Ask without telling them how to answer", rules)
        self.assertIn("Ask nothing else of your own accord", rules)
        self.assertIn("Never invent a fault", rules)                                          # (its other rules stay)

    def test_claude_and_chatgpt_hold_a_conversation_by_the_agents_rules(self):
        # the ElevenLabs agent's own prompt (set on the agent) allows the same: short, measured facts only, safe on pain
        for rule in ("at most 50 words", "During a set", "keep it to a few words", "general fitness knowledge",
                     "never invent a measurement, a count or a fault", "pain, dizziness or an injury",
                     "see a doctor or a physiotherapist", "Never diagnose", "Words not meant for you",
                     "call say with an empty text", "before a workout starts or between workouts"):
            self.assertIn(rule, " ".join(coach.SYSTEM.split()), rule)


class Movements(unittest.TestCase):
    """A movement of the library the user named (web/js/moves.js tracks it): its readings, with what the event says and
    else what library.json says (a made-up library here: no movement of the real one is in the repo), the workout
    summary's movements, and the rules Claude and ChatGPT share with the agent."""

    AUTO = Describe.AUTO
    LIBRARY = {"built": "2026-01-01", "movements": [
        {"key": "made_up_stretch", "display": "Made-up stretch", "kind": "hold", "track": "hold",
         "coach": "Track hold time per side; hips square,\n stand tall."},
        {"key": "made_up_dance", "display": "Made-up dance", "kind": "dance", "track": "moving",
         "coach": "Count spins; big, sharp moves. No reps."},
        {"key": "made_up_raise", "display": "Made-up raise", "kind": "gym_reps", "track": "rhythm"},
        {"key": "made_up_squat", "display": "Made-up squat", "kind": "gym_counted", "track": "reps",
         "engine": "squat"}]}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pose-coach-moves-"))
        self.saved = coach.LIBRARY
        coach.LIBRARY = self.tmp / "library.json"                       # not built yet

    def tearDown(self):
        coach.LIBRARY = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, library=None):
        coach.LIBRARY.write_text(json.dumps(library or self.LIBRARY))

    def read(self, **event) -> str:
        line = coach.describe({**self.AUTO, **event})["summary"]
        self.assertNotIn("\n", line)
        for word in ("None", "workout", "Event on"):
            self.assertNotIn(word, line, event)
        return line

    def test_a_named_movement_is_confirmed_with_what_is_kept_track_of_and_reps_pause(self):
        # (as the page sends it: the movement's own fields, no library needed)
        sent = lambda key, kind, track: self.read(kind="movement_set", movement=key, display=key.title(),
                                                  movementKind=kind, track=track, coach="Notes.")
        self.assertEqual(sent("stretch", "hold", "hold"),
                         "The user named Stretch (a stretch, pose or balance), from the movement library: the page "
                         "times the hold, and no reps are counted meanwhile. Confirm it in a few words, with what you "
                         "will keep track of.")
        self.assertIn("the page times how long they keep moving, and no reps", sent("dance", "dance", "moving"))
        self.assertIn("the page keeps an approximate count of the rhythm (there is no rep counter for this move)",
                      sent("raise", "gym_reps", "rhythm"))
        self.assertIn("(a flow)", sent("flow", "flow", "moving"))
        self.assertIn("(a transition, such as kneeling and standing up), from the movement library: the page times how "
                      "long they keep moving", sent("rise", "transition", "moving"))
        self.assertIn("The user named Odd, from the movement library", sent("odd", "unknown", "odd"))
        # (the library's kinds, as tools/build_moves.mjs builds them)
        self.assertEqual(set(coach.KINDS), {"technique", "gym_counted", "gym_reps", "hold", "flow", "dance", "transition"})

    def test_the_trackers_events_hold_moving_and_an_approximate_rhythm(self):
        self.build()
        # (no form on the event: a page from before the form check, read as a movement with none: not measured)
        self.assertEqual(self.read(kind="hold_start", key="made_up_stretch"),
                         "Made-up stretch: the user has settled into the hold. Its form is not measured: never say it "
                         "looks right or wrong. One short cue on what to keep. Form notes: hips square, stand tall.")
        self.assertEqual(self.read(kind="hold_progress", movement="made_up_stretch", seconds=20),
                         "Made-up stretch: held for 20 seconds so far. Its form is not measured: never say it looks "
                         "right or wrong. Say the time held, with a few words to keep it going.")
        self.assertEqual(self.read(kind="hold_end", movement="made_up_stretch", seconds=83.4),
                         "Made-up stretch: the hold ended after 1 minute 23 seconds. Its form was not measured: never "
                         "say it looked right or wrong. Say how long they held it, in a few words.")
        # a hold of a few seconds: nothing said, as the page's engine says nothing (it still counts towards the time
        # held in the summary: the reading does not call it something else)
        self.assertEqual(self.read(kind="hold_end", movement="made_up_stretch", seconds=3),
                         "Made-up stretch: a short hold of 3 seconds ended. A hold this short needs no cue: say "
                         "nothing.")
        self.assertIn("needs no cue", self.read(kind="hold_end", movement="made_up_stretch", seconds=4.9))
        self.assertIn("the hold ended after 5 seconds",
                      self.read(kind="hold_end", movement="made_up_stretch", seconds=5))
        self.assertEqual(self.read(kind="moving_progress", movement="made_up_dance", seconds=120),
                         "Made-up dance: 2 minutes of moving so far. A few words of encouragement, with the time. "
                         "Form notes: big, sharp moves.")
        rhythm = self.read(kind="rhythm_progress", movement="made_up_raise", count=10, approximate=True)
        self.assertEqual(rhythm, "Made-up raise: about 10 reps so far, by its rhythm: an approximate count (there is "
                                 "no rep counter for this move). Say it with 'about', never as an exact count.")
        self.assertEqual([coach.dur(s) for s in (0, 1, 59.6, 60, 61, 125, None)],
                         ["0 seconds", "1 second", "1 minute", "1 minute", "1 minute 1 second",
                          "2 minutes 5 seconds", "a while"])

    # a hold whose form is measured (web/js/holdform.js), as the page sends its events: state() on hold_start and
    # hold_progress, summary() on hold_end, a fault and its fix as their own events (made-up checks, shaped as the
    # contract's: the label names the fault, `measured` and `target` are what the coach may quote, `cue` the fix)
    FEET = {"fault": "feet_narrow", "label": "feet too close together", "measured": "feet 0.45 leg lengths apart",
            "target": "about one leg length", "cue": "Step your feet wider, about a leg's length apart."}
    ARM = {"fault": "arm_off_vertical", "label": "top arm not straight up", "measured": "top arm 63 degrees from up",
           "target": "straight up, within 20 degrees", "cue": "Reach the top arm straight up"}

    def hold(self, kind, form="absent", **event) -> str:
        sent = {"kind": kind, "movement": "made_up_stretch", "display": "Made-up stretch", "movementKind": "hold",
                "track": "hold", **event}
        return self.read(**sent, **({} if form == "absent" else {"form": form}))

    def test_a_holds_measured_fault_is_the_cue_and_its_fix_is_praised(self):
        self.build()
        checked = ["feet too close together", "top arm not straight up"]
        # settled in with a fault already measured: the first open one is the cue (no hold_fault of its own follows)
        self.assertEqual(self.hold("hold_start", {"checked": checked, "open": [self.FEET, self.ARM], "unseen": []}),
                         "Made-up stretch: the user has settled into the hold. Measured: feet 0.45 leg lengths apart "
                         "(aim for about one leg length). Your cue is this correction: Step your feet wider, about a "
                         "leg's length apart.")
        # a fault measured later in the hold, and its fix
        self.assertEqual(self.hold("hold_fault", **self.ARM),
                         "Made-up stretch: measured fault: top arm 63 degrees from up (aim for straight up, within 20 "
                         "degrees). Correct it in a few words: Reach the top arm straight up.")
        self.assertEqual(self.hold("hold_fix", fault="feet_narrow", label="feet too close together"),
                         "Made-up stretch: the user fixed it (feet too close together). Praise that fix in a few "
                         "words.")
        # (sparse events still read: no target, no cue, no label)
        self.assertEqual(self.hold("hold_fault", fault="feet_narrow", measured="feet 0.45 leg lengths apart"),
                         "Made-up stretch: measured fault: feet 0.45 leg lengths apart. Correct it in a few words.")
        self.assertIn("the user fixed it (feet narrow)", self.hold("hold_fix", fault="feet_narrow"))
        # the time held, with the fault still open, then the hold's faults at its end
        self.assertEqual(self.hold("hold_progress", {"checked": checked, "open": [self.ARM], "unseen": []},
                                   seconds=20),
                         "Made-up stretch: held for 20 seconds so far. Its measured fault is still open: top arm 63 "
                         "degrees from up (aim for straight up, within 20 degrees). Say the time held, with the "
                         "correction still to make in a few words.")
        faults = [{"fault": "feet_narrow", "label": "feet too close together", "fixed": True, "told": True},
                  {"fault": "arm_off_vertical", "label": "top arm not straight up", "fixed": False, "told": True}]
        self.assertEqual(self.hold("hold_end", {"checked": checked, "faults": faults}, seconds=27),
                         "Made-up stretch: the hold ended after 27 seconds. Faults the user was told of in it: feet "
                         "too close together (fixed); top arm not straight up (not fixed). Say how long they held it "
                         "and the fault to work on next time, in a few words.")
        self.assertIn("(fixed). Say how long they held it with a word of praise for the fix, in a few words.",
                      self.hold("hold_end", {"checked": checked, "faults": faults[:1]}, seconds=27))
        # a short hold still needs no word, faults or not
        self.assertIn("needs no cue: say nothing", self.hold("hold_end", {"checked": checked, "faults": faults},
                                                             seconds=3))

    def test_a_holds_form_is_fine_only_when_measured_and_out_of_view_checks_are_named(self):
        self.build()
        checked = ["feet too close together", "top arm not straight up"]
        clean = {"checked": checked, "open": [], "unseen": []}
        self.assertEqual(self.hold("hold_start", clean),
                         "Made-up stretch: the user has settled into the hold, measured and fine so far (checked for "
                         "feet too close together, top arm not straight up: none found). One short cue on what to "
                         "keep.")
        self.assertEqual(self.hold("hold_progress", clean, seconds=10),
                         "Made-up stretch: held for 10 seconds so far. Its form, measured: fine so far. Say the time "
                         "held, with a few words to keep it going.")
        self.assertEqual(self.hold("hold_end", {"checked": checked, "faults": []}, seconds=45),
                         "Made-up stretch: the hold ended after 45 seconds. Its form, measured: no fault found "
                         "(checked for feet too close together, top arm not straight up). Say how long they held it, "
                         "in a few words.")
        # (every list empty, as the contract's state() gives them: still fine)
        self.assertIn("measured and fine so far", self.hold("hold_start", {**clean, "pending": [], "wrongView": []}))
        # parts out of view: never fine as a whole, and said which checks could not be made, and why
        part = {"checked": checked[1:], "open": [], "unseen": checked[:1]}
        self.assertEqual(self.hold("hold_start", part),
                         "Made-up stretch: the user has settled into the hold. Checked for top arm not straight up: "
                         "none found, but not all of its form. Out of view, so not checked: feet too close together "
                         "(they would step back to be seen whole). One short cue on what to keep; never call its form "
                         "good as a whole.")
        self.assertEqual(self.hold("hold_progress", part, seconds=20),
                         "Made-up stretch: held for 20 seconds so far. Its form, measured where it could be: no fault "
                         "found (checked for top arm not straight up). Out of view, so not checked: feet too close "
                         "together (they would step back to be seen whole). Say the time held, with a few words to "
                         "keep it going.")
        for kind in ("hold_start", "hold_progress"):
            self.assertNotIn("fine so far", self.hold(kind, part, seconds=20))
        self.assertTrue(self.hold("hold_start", {**part, "open": [self.ARM]}).endswith(
            "Reach the top arm straight up. Out of view, so not checked: feet too close together (they would step back "
            "to be seen whole)."))
        # nothing measurable (all out of view) is not measured: never fine, and the notes come back as with no check
        none = {"checked": [], "open": [], "unseen": checked}
        self.assertEqual(self.hold("hold_start", none),
                         "Made-up stretch: the user has settled into the hold. Its form is not measured: never say it "
                         "looks right or wrong. Out of view, so not checked: feet too close together, top arm not "
                         "straight up (they would step back to be seen whole). One short cue on what to keep. Form "
                         "notes: hips square, stand tall.")
        self.assertIn("Its form is not measured", self.hold("hold_progress", none, seconds=10))
        self.assertIn("Its form was not measured", self.hold("hold_end", {"checked": [], "faults": []}, seconds=30))

    def test_checks_the_view_cannot_judge_ask_the_user_to_turn_not_to_step_back(self):
        # (seen side-on, a check measured only facing the camera: stepping back would change nothing)
        self.build()
        side = {"checked": ["chest up"], "open": [], "unseen": [], "wrongView": ["ankle above the knee"]}
        start = self.hold("hold_start", side)
        self.assertEqual(start, "Made-up stretch: the user has settled into the hold. Checked for chest up: none "
                                "found, but not all of its form. Not checked from this side: ankle above the knee (it "
                                "is measured facing the camera: they would turn towards it). One short cue on what to "
                                "keep; never call its form good as a whole.")
        self.assertNotIn("step back", start)
        self.assertNotIn("fine so far", self.hold("hold_progress", side, seconds=20))
        # all of it from the side: not measured, and why
        everything = {"checked": [], "open": [], "unseen": [], "wrongView": ["stance width", "top arm"]}
        self.assertIn("Its form is not measured: never say it looks right or wrong. Not checked from this side: stance "
                      "width, top arm (it is measured facing the camera", self.hold("hold_start", everything))
        # both reasons at once, each with its own way out
        both = self.hold("hold_start", {**side, "unseen": ["stance width"]})
        self.assertIn("Out of view, so not checked: stance width (they would step back to be seen whole). Not checked "
                      "from this side: ankle above the knee", both)

    def test_a_fault_waiting_its_turn_is_never_called_fine(self):
        # (holdform.js tells one correction at a time: a fault measured meanwhile is pending; its hold_fault, with the
        # correction, comes on its own a moment later, so the start must not call the form fine before it)
        self.build()
        waiting = {"checked": ["stance width", "top arm"], "open": [], "pending": ["trunk tilt"], "unseen": []}
        start = self.hold("hold_start", waiting)
        self.assertEqual(start, "Made-up stretch: the user has settled into the hold. A fault is measured, its "
                                "correction to come next on its own (trunk tilt): do not call the form good. One short "
                                "cue to keep holding.")
        progress = self.hold("hold_progress", waiting, seconds=12)
        self.assertEqual(progress, "Made-up stretch: held for 12 seconds so far. A fault is measured, its correction "
                                   "to come next on its own (trunk tilt): do not call the form good. Say the time "
                                   "held, with a few words to keep it going.")
        for line in (start, progress):
            self.assertNotIn("fine", line)
            self.assertNotIn("none found", line)
        # an open fault still comes first: its correction is the cue
        self.assertIn("Your cue is this correction: Reach the top arm straight up.",
                      self.hold("hold_start", {**waiting, "open": [self.ARM]}))
        self.assertIn("(they would step back to be seen whole). One short cue to keep holding.",
                      self.hold("hold_start", {**waiting, "unseen": ["long legs"]}))

    def test_the_holds_end_names_only_the_faults_the_user_was_told_of(self):
        # (the page marks `told` from what the coach really heard, and drops a fault never heard and fixed meanwhile:
        # a fix is praised only when the fault was said, and a fault never said is not named at its end)
        self.build()
        checked = ["stance width", "top arm"]
        told_fixed = {"fault": "feet_narrow", "label": "feet too close together", "fixed": True, "told": True}
        untold_open = {"fault": "trunk_tilt", "label": "trunk too upright", "fixed": False, "told": False}
        untold_fixed = {"fault": "top_arm", "label": "top arm not straight up", "fixed": True, "told": False}
        end = lambda *faults: self.hold("hold_end", {"checked": checked, "faults": list(faults)}, seconds=30)
        self.assertEqual(end(told_fixed, untold_fixed),
                         "Made-up stretch: the hold ended after 30 seconds. Faults the user was told of in it: feet "
                         "too close together (fixed). Say how long they held it with a word of praise for the fix, in "
                         "a few words.")
        self.assertNotIn("top arm", end(told_fixed, untold_fixed))
        # a fault still there that nobody said: not named, and the form never called good
        self.assertEqual(end(told_fixed, untold_open),
                         "Made-up stretch: the hold ended after 30 seconds. Faults the user was told of in it: feet "
                         "too close together (fixed). Say how long they held it with a word of praise for the fix, in "
                         "a few words; never call its form good.")
        self.assertEqual(end(untold_open),
                         "Made-up stretch: the hold ended after 30 seconds. A fault was still measured at its end. Say "
                         "how long they held it, in a few words; never call its form good.")
        for line in (end(untold_open), end(untold_fixed)):
            self.assertNotIn("praise", line)
            self.assertNotIn("trunk too upright", line)
        # (one never said and fixed, should a page still send it: as if none)
        self.assertIn("Its form, measured: no fault found (checked for stance width, top arm)", end(untold_fixed))

    def test_a_hold_with_no_form_check_is_never_called_right_or_wrong_and_keeps_its_notes(self):
        # form: null (a movement with no form check) reads as a page from before the form check (no form at all)
        self.build()
        for form in (None, "absent", "junk"):
            start = self.hold("hold_start", form)
            self.assertEqual(start, "Made-up stretch: the user has settled into the hold. Its form is not measured: "
                                    "never say it looks right or wrong. One short cue on what to keep. Form notes: "
                                    "hips square, stand tall.", form)
            self.assertIn("never say it looks right or wrong. Say the time held",
                          self.hold("hold_progress", form, seconds=20))
            self.assertIn("never say it looked right or wrong. Say how long",
                          self.hold("hold_end", form, seconds=20))
        # the event's own notes, filtered to form cues, with no library entry for it
        line = coach.describe({**self.AUTO, "kind": "hold_start", "movement": "other", "display": "Other",
                               "track": "hold", "form": None, "coach": "Track hold time per leg; open the chest."})
        self.assertTrue(line["summary"].endswith("One short cue on what to keep. Form notes: open the chest."))
        self.assertIsNone(line["form"])                                      # (the coach sees the event's form too)

    # a moving or rhythm movement's guard rails (web/js/moveform.js), as the page sends them: a fault and its fix as
    # their own events, state() as `form` on moving_progress and rhythm_progress (made-up checks, shaped as the
    # contract's)
    ELBOWS = {"fault": "elbows_out", "label": "elbows drifting off the sides",
              "measured": "elbow 52 degrees out from your side",
              "target": "elbows tucked in at your sides, within about 30 degrees",
              "cue": "Keep your elbows pinned to your sides as you turn your hands out.", "part": "elbow", "side": None}

    def moved_event(self, kind, form="absent", movement="made_up_raise", **event) -> str:
        sent = {"kind": kind, "movement": movement, **event}
        return self.read(**sent, **({} if form == "absent" else {"form": form}))

    def test_a_moving_movements_measured_fault_is_the_cue_and_its_fix_is_praised(self):
        self.build()
        self.assertEqual(self.moved_event("form_fault", **self.ELBOWS),
                         "Made-up raise: measured fault: elbow 52 degrees out from your side (aim for elbows tucked in "
                         "at your sides, within about 30 degrees). Correct it in a few words: Keep your elbows pinned "
                         "to your sides as you turn your hands out.")
        self.assertEqual(self.moved_event("form_fix", fault="elbows_out", label="elbows drifting off the sides"),
                         "Made-up raise: the user fixed it (elbows drifting off the sides). Praise that fix in a few "
                         "words.")
        # (a dance's, read the same way; sparse events still read)
        self.assertEqual(self.moved_event("form_fault", movement="made_up_dance", fault="lean",
                                          measured="trunk 40 degrees forward"),
                         "Made-up dance: measured fault: trunk 40 degrees forward. Correct it in a few words.")
        self.assertIn("the user fixed it (lean)", self.moved_event("form_fix", movement="made_up_dance", fault="lean"))

    def test_the_progress_of_a_moving_movement_carries_a_short_form_clause_never_fine_as_a_whole(self):
        self.build()
        empty = {"checked": [], "open": [], "pending": [], "unseen": [], "wrongView": []}
        rhythm = lambda form: self.moved_event("rhythm_progress", form, count=10, approximate=True)
        moving = lambda form: self.moved_event("moving_progress", form, movement="made_up_dance", seconds=120)
        count = ("Made-up raise: about 10 reps so far, by its rhythm: an approximate count (there is no rep counter "
                 "for this move).")
        # a fault told and still open: the correction still to make, with the count or the time
        self.assertEqual(rhythm({**empty, "open": [self.ELBOWS]}),
                         f"{count} Its measured fault is still open: elbow 52 degrees out from your side (aim for "
                         "elbows tucked in at your sides, within about 30 degrees). Say it with 'about', never as an "
                         "exact count, with the correction still to make in a few words.")
        self.assertEqual(moving({**empty, "open": [self.ELBOWS]}),
                         "Made-up dance: 2 minutes of moving so far. Its measured fault is still open: elbow 52 "
                         "degrees out from your side (aim for elbows tucked in at your sides, within about 30 "
                         "degrees). A few words of encouragement, with the time and the correction still to make. "
                         "Form notes: big, sharp moves.")
        # checked and none found: said so, but never called good as a whole (a few clear mistakes only)
        checked = rhythm({**empty, "checked": ["elbows at your sides"]})
        self.assertEqual(checked, f"{count} Checked for elbows at your sides: none found so far; these checks look for "
                                  "a few clear mistakes only, so never call its form good as a whole. Say it with "
                                  "'about', never as an exact count.")
        # a fault measured and waiting its turn: never fine
        pending = rhythm({**empty, "pending": ["elbows at your sides"]})
        self.assertEqual(pending, f"{count} A fault is measured, its correction to come next on its own (elbows at "
                                  "your sides): do not call the form good. Say it with 'about', never as an exact "
                                  "count.")
        for line in (checked, pending):
            self.assertNotIn("fine", line)
        # out of view, the wrong view: which, and why
        self.assertEqual(moving({**empty, "checked": ["trunk up"], "unseen": ["knees over toes"],
                                 "wrongView": ["arms level"]}),
                         "Made-up dance: 2 minutes of moving so far. Checked for trunk up: none found so far; these "
                         "checks look for a few clear mistakes only, so never call its form good as a whole. Out of "
                         "view, so not checked: knees over toes (they would step back to be seen whole). Not checked "
                         "from this side: arms level (it is measured facing the camera: they would turn towards it). A "
                         "few words of encouragement, with the time. Form notes: big, sharp moves.")
        # nothing measured yet (the warm-up, the parts out of view): not measured
        self.assertEqual(rhythm(empty), f"{count} Its form is not measured: never say it looks right or wrong. Say it "
                                        "with 'about', never as an exact count.")
        # no form check (form: null), or a page from before the checks: the reading as it always was
        for form in (None, "absent", "junk"):
            self.assertEqual(rhythm(form), f"{count} Say it with 'about', never as an exact count.", form)
            self.assertEqual(moving(form), "Made-up dance: 2 minutes of moving so far. A few words of encouragement, "
                                           "with the time. Form notes: big, sharp moves.", form)

    def test_a_form_not_checked_at_all_is_said_with_what_to_show(self):
        # form_unseen (web/js/moveform.js; moves.js for a hold): every check out of view, or seen side-on
        self.build()
        feet = {"missing": ["standing leg long"], "parts": ["feet"], "why": "frame",
                "cue": "Step back so I can see your feet: I can't check your form."}
        self.assertEqual(self.moved_event("form_unseen", **feet),
                         "Made-up raise: the tracker can't see their feet, so their form isn't being checked "
                         "(standing leg long). Ask them in a few words to step back so you can see their feet; never "
                         "call their form right or wrong meanwhile.")
        self.assertIn("can't see their legs and arms,",
                      self.moved_event("form_unseen", **{**feet, "parts": ["legs", "arms"]}))
        self.assertIn("can't see all of them, so", self.moved_event("form_unseen", **{**feet, "parts": []}))
        side = {"missing": ["stance width", "top arm"], "parts": [], "why": "view",
                "cue": "Turn to face the camera so I can check your form."}
        self.assertEqual(self.hold("form_unseen", **side),
                         "Made-up stretch: the tracker sees them side-on, so their form isn't being checked (stance "
                         "width, top arm). Ask them in a few words to turn to face the camera; never call their form "
                         "right or wrong meanwhile.")
        # (sparse: no checks named)
        self.assertIn("can't see their feet, so their form isn't being checked. Ask",
                      self.moved_event("form_unseen", parts=["feet"], why="frame"))
        self.assertIsNotNone(coach.tracked("form_unseen", {"movement": "x"}))
        for system in (coach.SYSTEM, coach.API_SYSTEM):
            rules = " ".join(system.split())
            self.assertIn("form_unseen (while they do a movement or hold a pose, every part its form is checked by is "
                          "out of the picture, or the camera angle cannot show the check): ask them in a few words "
                          "to step back or turn as the event says. Their form is not being checked "
                          "meanwhile: never call it right or wrong.", rules)

    def test_claude_and_chatgpt_correct_a_moving_movements_fault_and_never_call_its_form_good(self):
        rules = " ".join(coach.SYSTEM.split())
        for rule in ("form_fault (a clear mistake measured while they move, in a flow, a dance, a transition or a gym "
                     "move with no rep counter): give its correction in a few words",
                     "form_fix: praise that fix in a few words",
                     "These checks look for a few clear mistakes only: never call such a movement's form good as a "
                     "whole"):
            self.assertIn(rule, rules, rule)
            self.assertIn(rule, " ".join(coach.API_SYSTEM.split()), rule)
        for kind in ("form_fault", "form_fix"):
            self.assertIsNotNone(coach.tracked(kind, {"movement": "x"}), kind)

    def test_claude_and_chatgpt_never_call_form_good_unless_it_was_measured(self):
        rules = " ".join(coach.SYSTEM.split())
        for rule in ("when they settle into it, the correction of a fault the event measured, else one short cue on "
                     "what to keep",
                     "hold_fault (a fault measured in the hold): give its correction in a few words",
                     "hold_fix: praise that fix in a few words", "You do not see the user",
                     "Never say their form is good, correct or that nothing needs fixing",
                     "never name something they do right, unless an event measured it (a hold's form with nothing "
                     "open, a clean set)",
                     "If asked whether a held pose is right, answer from the last form reading",
                     "say you can time it but cannot check its form",
                     "give its key points as things to check themselves"):
            self.assertIn(rule, rules, rule)
        # the readings of every hold event (the agent reads the same through /api/coach/describe)
        for kind in ("hold_fault", "hold_fix"):
            self.assertIsNotNone(coach.tracked(kind, {"movement": "x"}), kind)
        self.assertIsNone(coach.tracked("hold_wobble", {"movement": "x"}))

    def test_the_describe_endpoint_passes_a_holds_form_through(self):
        dev_server.Handler.log_message = lambda *a: None
        srv = ThreadingHTTPServer(("127.0.0.1", 0), dev_server.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            form = {"checked": ["feet too close together"], "open": [self.FEET], "unseen": []}
            event = {"kind": "hold_start", "movement": "made_up_stretch", "display": "Made-up stretch", "form": form}
            req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}/api/coach/describe",
                                         data=json.dumps({"event": event}).encode(),
                                         headers={"content-type": "application/json"})
            got = json.loads(urllib.request.urlopen(req, timeout=10).read())
            self.assertEqual(got["form"], form)
            self.assertIn("Your cue is this correction: Step your feet wider", got["summary"])
        finally:
            srv.shutdown()
            srv.server_close()

    def test_the_notes_are_the_coaching_lines_form_cues_alone(self):
        # (made-up lines shaped as the catalog's: what its author meant to be counted or timed, which the page does not
        # do, never reaches the coach; a line with no form cue gives no notes)
        for line, cues in (("Count presses; short dip, drive, lock out.", "short dip, drive, lock out"),
                           ("Track hold time per leg; knees together, stand tall.", "knees together, stand tall"),
                           ("Track time (and cadence); relaxed shoulders, light steps.",
                            "relaxed shoulders, light steps"),
                           ("Keep the elbows in; count reps or hold time. Not counted by the engine.",
                            "Keep the elbows in"),
                           ("Note the rise; drive up with the chest up. No reps.", "drive up with the chest up"),
                           ("Track rounds and pace; the squats in it are real reps, punches are not counted.", ""),
                           ("Count throws; nothing more to coach from the engine.", ""),
                           ("Count leg raises/pulses per side; keep the hips level.", "keep the hips level"),
                           ("", ""), (None, "")):
            self.assertEqual(coach.form_notes(line), cues, line)
        # with the event: no notes on a moving event whose line has none; the coach sees the event's line filtered too
        line = coach.describe({**self.AUTO, "kind": "moving_progress", "movement": "spin", "display": "Spin",
                               "coach": "Count spins; track the time. No reps.", "seconds": 30})
        self.assertNotIn("Count", line["summary"])
        self.assertNotIn("notes", line["summary"])
        self.assertEqual(line["coach"], "")
        named = coach.describe({**self.AUTO, "kind": "movement_set", "movement": "s", "display": "S", "track": "hold",
                                "coach": "Track hold time per leg; stand tall."})
        self.assertEqual(named["coach"], "stand tall")
        self.assertNotIn("coach", coach.describe({**self.AUTO, "kind": "praise", "reps": 5}))   # (no line, none added)

    def test_the_library_fills_in_what_the_event_leaves_out_and_is_read_again_when_rebuilt(self):
        self.assertIn("The user named Made up stretch, from the movement library: no reps are counted",
                      self.read(kind="movement_set", movement="made_up_stretch"))      # (not built: the key)
        self.build()
        self.assertIn("The user named Made-up stretch (a stretch, pose or balance), from the movement library: the "
                      "page times the hold", self.read(kind="movement_set", movement="made_up_stretch"))
        renamed = json.loads(json.dumps(self.LIBRARY))
        renamed["movements"][0]["display"] = "Renamed stretch, a longer name"
        self.build(renamed)
        self.assertIn("Renamed stretch, a longer name: held for", self.read(kind="hold_progress",
                                                                           movement="made_up_stretch", seconds=10))
        coach.LIBRARY.write_text("{not json")
        self.assertEqual(coach.library(), {})

    def test_a_movement_named_by_voice_is_confirmed_and_words_meanwhile_change_nothing(self):
        self.build()
        said = lambda **applied: self.read(kind="user_said", text="quad stretch", workout=True, applied=applied)
        self.assertEqual(said(type="movement", movement="made_up_stretch", display="Made-up stretch"),
                         'The user said: "quad stretch". The page switched to Made-up stretch, a movement they named: '
                         "the page times the hold, and no reps are counted meanwhile. Confirm it in a few words, with "
                         "what you will keep track of.")
        self.assertIn("switched to Made-up dance, a movement they named: the page times how long they keep moving",
                      said(type="movement", movement="made_up_dance"))
        # named mid-set (the page tags the words with the set in progress): the set ends there, and no set_end is sent
        mid = lambda key, reps: self.read(kind="user_said", text="quad stretch", workout=True, exercise="squat",
                                          exerciseLabel="Squat", set=2, reps=reps,
                                          applied={"type": "movement", "movement": key})
        self.assertEqual(mid("made_up_stretch", 8),
                         'The user said: "quad stretch". The page ended set 2 of Squat at 8 reps and switched to '
                         "Made-up stretch, a movement they named: the page times the hold, and no reps are counted "
                         "meanwhile. Confirm it in a few words, with the reps of the set that ended and what you will "
                         "keep track of.")
        self.assertIn("ended set 2 of Squat at 1 rep and switched to Made-up dance", mid("made_up_dance", 1))
        self.assertIn("the page times how long they keep moving, and no reps are counted meanwhile. Confirm it in a "
                      "few words, with the reps of the set that ended and what you will keep track of.",
                      mid("made_up_dance", 1))
        self.assertIn("its reps are counted", said(type="movement", movement="made_up_squat"))
        self.assertEqual(self.read(kind="user_said", text="how long now?", workout=True, movement="made_up_stretch"),
                         'The user said: "how long now?". The page changed nothing: it still tracks Made-up stretch, '
                         "a movement they named, and counts no reps. Answer them.")

    def test_the_workout_summary_gives_the_movements_with_their_times_or_about_counts(self):
        self.build()
        movements = [{"key": "made_up_stretch", "display": "Made-up stretch", "track": "hold", "seconds": 45},
                     {"key": "made_up_raise", "display": "Made-up raise", "track": "rhythm", "count": 20},
                     {"key": "made_up_dance", "display": "Made-up dance", "track": "moving", "seconds": 125}, "junk"]
        squats = {"squat": {"label": "Squat", "sets": 2, "reps": 16}}
        self.assertEqual(self.read(kind="workout_summary", sets=[], totals=squats, movements=movements),
                         "Workout finished. Squat: 2 sets, 16 reps. Movements: Made-up stretch: held 45 seconds; "
                         "Made-up raise: about 20 reps (an approximate count); Made-up dance: 2 minutes 5 seconds "
                         "moving.")
        self.assertEqual(self.read(kind="workout_summary", sets=[], totals={}, movements=movements[:1]),
                         "Workout finished. No set of a counted exercise. Movements: Made-up stretch: held 45 seconds.")
        self.assertEqual(coach.describe({"kind": "workout_summary", "totals": squats, "movements": []})["summary"],
                         "Workout finished. Squat: 2 sets, 16 reps.")                     # (as before)
        self.assertIn("ask which exercise or movement", coach.describe({"kind": "ask_exercise"})["summary"])

    def test_claude_and_chatgpt_get_the_agents_rules_for_movements(self):
        # the agent's own prompt (set on the agent) has the same: track only what the user named, never recognise a
        # movement by itself, reps only for the counted exercises, "about" for a rhythm count
        rules = " ".join(coach.SYSTEM.split())
        for rule in ("a dance, a gym move with no rep counter, or a transition such as kneeling and standing up",
                     "The tracker never recognises one of these by itself, and neither do you",
                     "keep track only of the movement the user named", "Reps are counted only for the exercises above",
                     "while another movement is named, no reps are counted", "movement_set: confirm it in a few words",
                     "the hold time, the time moving, or an approximate rhythm", "hold_start, hold_progress, hold_end",
                     "use the event's notes", "moving_progress (a flow, a dance, or kneeling and standing up)",
                     "rhythm_progress",
                     "A hold of a few seconds needs no word when it ends: call say with an empty text",
                     "never offer to time each side or leg", "The notes of a movement are form cues",
                     "you never offer to count or time anything the events do not",
                     'always say "about" with it, never give it as an exact count',
                     "tell them you can't track that one", "the holds and other movements with their times",
                     "During a set (after its set_start, before its set_end) or a hold keep it to a few words"):
            self.assertIn(rule, rules, rule)
        # the library offers no sport move, walking or jogging, gesture or idle pose
        for gone in ("sport move", "walking", "jogging", "gesture", "idle pose", "stay quiet"):
            self.assertNotIn(gone, rules, gone)

    def test_a_sessions_instructions_name_the_library_when_it_is_built(self):
        self.assertEqual(coach.system_prompt(), coach.SYSTEM)                              # not built
        self.build()
        prompt = coach.system_prompt()
        self.assertTrue(prompt.startswith(coach.SYSTEM + "\n\nThe movement library"))
        listed = prompt[len(coach.SYSTEM):]
        for line in ("- counted as the exercise in brackets: Made-up squat (squat)", "- a hold timer: Made-up stretch",
                     "- the time moving: Made-up dance", "- an approximate rhythm count: Made-up raise"):
            self.assertIn(line, listed)
        self.assertEqual(listed.count("\n- "), 4)                                         # (one line per track)
        saved = coach.claude_cli
        coach.claude_cli = lambda: "/bin/claude"
        try:
            s = coach.Session("workout", self.tmp, "http://127.0.0.1:1")
            cmd = s.claude_cmd(self.tmp / "mcp.json")
            self.assertEqual(cmd[cmd.index("--system-prompt") + 1], prompt)
        finally:
            coach.claude_cli = saved
        # the repo's own SYSTEM names no movement of the library (they come from the private library at run time)
        self.assertNotIn("Made-up", coach.SYSTEM)


class TechniqueReadings(unittest.TestCase):
    def reading(self, **event):
        return coach.describe({"movement": "made_up_technique", "display": "Practice combo",
                               "movementKind": "technique", "track": "technique", **event})["summary"]

    def test_named_technique_never_promises_a_count(self):
        text = self.reading(kind="movement_set")
        self.assertIn("without counting", text)
        self.assertIn("Only measured checks", text)
        self.assertNotIn("approximate rhythm", text)

    def test_attempt_result_keeps_the_measured_scope_and_incomplete_sequence(self):
        text = self.reading(kind="technique_result", verdict="incomplete", sequence="same_hand",
                            checked=["punch direction"], unmeasured=["hip rotation"],
                            cue="Follow with the other hand.")
        for part in ("incomplete", "same_hand", "punch direction", "hip rotation", "Never infer", "Follow with"):
            self.assertIn(part, text)

    def test_summary_and_legacy_progress_ignore_a_technique_count(self):
        entry = {"movement": "made_up_technique", "display": "Practice combo", "track": "technique",
                 "count": 13, "reviewed": True}
        text = coach.moved([entry])
        self.assertIn("technique reviewed", text)
        self.assertNotIn("13", text)
        self.assertNotIn("13", self.reading(kind="rhythm_progress", count=13))

    def test_fault_keeps_its_measured_direction_and_view_request_keeps_its_cue(self):
        text = self.reading(kind="form_fault", label="punch upward", measured="punch 29 degrees upward",
                            target="straight ahead", cue="Punch straight ahead.")
        self.assertIn("29 degrees upward", text)
        text = self.reading(kind="form_unseen", why="view", missing=["punch direction"],
                            cue="Turn sideways so I can see your punches.")
        self.assertIn("sideways", text)


class Claude(unittest.TestCase):
    def test_the_command_line_is_the_model_and_effort_set_and_fast_mode_only_when_on(self):
        saved = coach.claude_cli, coach.FAST
        coach.claude_cli = lambda: "/bin/claude"
        try:
            tmp = Path(tempfile.mkdtemp(prefix="pose-coach-claude-"))
            s = coach.Session("workout", tmp, "http://127.0.0.1:1")
            cmd = s.claude_cmd(tmp / "mcp.json")
            self.assertEqual(cmd[cmd.index("--model") + 1], coach.MODEL)
            self.assertEqual(cmd[cmd.index("--effort") + 1], coach.EFFORT)
            self.assertEqual(cmd[cmd.index("--tools") + 1], "")
            self.assertNotIn("--settings", cmd)
            coach.FAST = True
            cmd = s.claude_cmd(tmp / "mcp.json")
            self.assertEqual(json.loads(cmd[cmd.index("--settings") + 1]), {"fastMode": True})
            shutil.rmtree(tmp, ignore_errors=True)
        finally:
            coach.claude_cli, coach.FAST = saved

    def test_the_default_is_sonnet_at_effort_high(self):
        out = subprocess.run([sys.executable, "-c", "import coach; print(coach.MODEL, coach.EFFORT, coach.model_id())"],
                             cwd=SERVER, capture_output=True, text=True, check=True,
                             env={k: v for k, v in os.environ.items() if not k.startswith("POSE_COACH_")}).stdout
        self.assertEqual(out.split(), ["sonnet", "high", "claude-sonnet-5-5"])

    def test_start_takes_a_known_brain_and_leaves_no_session_when_it_cannot_start(self):
        saved = coach.claude_cli
        coach.claude_cli = lambda: None
        tmp = Path(tempfile.mkdtemp(prefix="pose-coach-claude-"))
        try:
            with self.assertRaises(ValueError):
                coach.start({"brain": "gemini"}, tmp, "http://127.0.0.1:1")
            with self.assertRaises(FileNotFoundError):
                coach.start({}, tmp, "http://127.0.0.1:1")                  # (claude by default)
            self.assertEqual(coach.SESSIONS, {})
        finally:
            coach.claude_cli = saved
            shutil.rmtree(tmp, ignore_errors=True)


# --- the API transport: Claude through the Anthropic SDK, with a stand-in client (never the API) ---------------------
KEY = "sk-ant-api03-MADE-UP-test-key-0123456789"     # made up: what a test writes in its own key file
REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
USAGE = {"input_tokens": 12, "output_tokens": 6, "cache_creation_input_tokens": 40, "cache_read_input_tokens": 2500}


def reply(text="Go deeper.", stop="end_turn", content=None, **extra) -> BetaMessage:
    """A response as the SDK gives it (its own types)."""
    m = BetaMessage.model_validate({"id": "msg_test", "type": "message", "role": "assistant",
                                    "model": "claude-sonnet-5-5", "stop_reason": stop, "stop_sequence": None,
                                    "content": [{"type": "text", "text": text}] if content is None else content,
                                    "usage": USAGE, **extra})
    m._request_id = "req_test"
    return m


def failure(cls, code: int, message: str = "something went wrong", headers=None):
    """An error the SDK raises for an HTTP status, with the API's own body (and headers: retry-after, say)."""
    return cls(f"Error code: {code}", response=httpx2.Response(code, request=REQ, headers=headers),
               body={"type": "error", "error": {"type": "error", "message": message}})


class FakeApi:
    """A stand-in for anthropic.Anthropic: each beta.messages.create takes the next reply (an error is raised; a
    function is called first, as a slow request: what it returns is the reply); its calls are kept, each with the
    messages as they were sent."""

    def __init__(self, replies):
        self.replies, self.calls, self.sent = list(replies), [], []
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})
        r = self.replies.pop(0)
        r = r() if callable(r) else r
        if isinstance(r, Exception):
            raise r
        self.sent.append(r)
        return r


def slow(gate: threading.Event, r):
    """A reply that comes once gate is set (the request in flight meanwhile)."""
    return lambda: gate.wait(15) and r


class Api(unittest.TestCase):
    """Claude through the Anthropic API (POSE_CLAUDE_TRANSPORT auto with a key, or api): each event one user message,
    the reply said, the history append-only, the API's failures and refusals, and the key nowhere but the client."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pose-coach-api-"))
        self.saved = {k: getattr(coach, k) for k in ("KEY_FILE", "TRANSPORT", "MODEL", "EFFORT", "THINKING",
                                                     "API_POLL_S", "API_RETRY_S", "PAGE_WAIT_S", "ANSWER_WAIT_S",
                                                     "api_client", "claude_cli")}
        coach.KEY_FILE = self.tmp / "anthropic-key"
        coach.TRANSPORT, coach.MODEL, coach.EFFORT, coach.THINKING = "auto", "sonnet", "high", "between_tools"
        coach.API_POLL_S = 0.05                          # (idle waits come round fast: they must cost no request)
        coach.API_RETRY_S = 0.01                         # (a retry comes at once)
        coach.claude_cli = lambda: None                  # the CLI transport, were it taken, could not start
        connections.ANTHROPIC.clear()
        self.made = []

    def tearDown(self):
        coach.stop_all()
        coach.SESSIONS.clear()
        for k, v in self.saved.items():
            setattr(coach, k, v)
        connections.ANTHROPIC.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def key(self, text=f"  {KEY}\n"):
        coach.KEY_FILE.write_text(text)
        coach.KEY_FILE.chmod(0o600)

    def start(self, replies) -> coach.Session:
        self.api = FakeApi(replies)
        coach.api_client = lambda key, **kw: self.made.append((key, kw)) or self.api
        self.key()
        r = coach.start({"brain": "claude"}, self.tmp / "data", "http://127.0.0.1:1")
        self.assertEqual(r["transport"], "api")
        return coach.get(r["session"])

    def push(self, s: coach.Session, kind="cue", **extra) -> dict:
        event = {"kind": kind, "exercise": "squat", "exerciseLabel": "Squat", "reps": 3, "message": "Go deeper",
                 **extra}
        s.push(event)
        return event

    def said(self, s: coach.Session, kind="cue", **extra) -> str:
        n = len(s.said)
        self.push(s, kind, **extra)
        wait_for(lambda: len(s.said) > n)
        return s.said[-1]["text"]

    def failed(self, s: coach.Session, kind="cue"):
        """An event whose request fails: nothing is said; it is logged."""
        n = len(self.lines(s))
        self.push(s, kind)
        wait_for(lambda: len(self.lines(s)) > n)

    def lines(self, s: coach.Session) -> list[dict]:
        f = s.dir / f"session-{s.id}.jsonl"
        return [json.loads(line) for line in f.read_text().splitlines()] if f.exists() else []

    def test_each_event_is_one_message_and_the_reply_is_said(self):
        refusal = reply(stop="refusal", content=[], stop_details={"type": "refusal", "category": "cyber"})
        s = self.start([reply("Squats, got it."), reply("-"), refusal, reply("Keep your chest up.")])
        self.assertEqual(self.made, [(KEY, {})])                    # the key from the file, once for the session
        self.assertEqual(self.said(s, "exercise_set", label="Squat"), "Squats, got it.")
        time.sleep(0.2)                                             # idle waits: no request
        self.assertEqual(len(self.api.calls), 1)
        self.assertEqual(self.said(s, "user_said", text="one, two, three"), "")      # "-": words not meant for it
        self.assertEqual(self.said(s), "")                                           # a refusal: nothing spoken
        self.assertEqual(self.said(s, "fixed"), "Keep your chest up.")
        self.assertEqual([x["event_id"] for x in s.said], [1, 2, 3, 4])
        self.assertTrue(all(isinstance(x["latency_ms"], int) for x in s.said))
        # the request: Sonnet 5.5, the API's instructions cached, the history cached as it grows, no thinking (the
        # cue must come fast) at effort high, the server-side fallback for refusals; the same for every request
        for call in self.api.calls:
            self.assertEqual({k: v for k, v in call.items() if k != "messages"}, {
                "model": "claude-sonnet-5-5", "max_tokens": 400,
                "system": [{"type": "text", "text": s.system, "cache_control": {"type": "ephemeral"}}],
                "cache_control": {"type": "ephemeral"}, "thinking": {"type": "between_tools"},
                "output_config": {"effort": "high"}, "betas": ["server-side-fallback-2026-07-01"],
                "fallbacks": "default"})
        self.assertTrue(s.system.startswith(coach.API_SYSTEM))
        # the messages: each event as wait_for_event gives it (its reading, its fields, its id), as JSON; each reply
        # back as the response's own blocks, unchanged; append-only (a refused exchange is left out)
        m, sent = [c["messages"] for c in self.api.calls], self.api.sent
        u = [x[-1] for x in m]
        self.assertEqual(json.loads(u[0]["content"]),
                         {**coach.describe({"kind": "exercise_set", "exercise": "squat", "exerciseLabel": "Squat",
                                            "reps": 3, "message": "Go deeper", "label": "Squat"}), "event_id": 1})
        self.assertEqual(m[0], [u[0]])
        self.assertEqual(m[1][:2], [u[0], {"role": "assistant", "content": sent[0].content}])
        self.assertIs(m[1][1]["content"][0], sent[0].content[0])                # (the very blocks)
        self.assertEqual(m[2][:4], m[1] + [{"role": "assistant", "content": sent[1].content}])
        self.assertEqual(m[3][:4], m[2][:4])                                     # the refused event is not there
        self.assertEqual(len(m[3]), 5)
        self.assertEqual([x["role"] for x in m[3]], ["user", "assistant"] * 2 + ["user"])
        self.assertEqual(s.history, m[3] + [{"role": "assistant", "content": sent[3].content}])
        # the log: one line per request
        api = [x for x in self.lines(s) if x["type"] == "pose_coach.api"]
        self.assertEqual([(x["event_id"], x["kind"], x["stop_reason"]) for x in api],
                         [(1, "exercise_set", "end_turn"), (2, "user_said", "end_turn"), (3, "cue", "refusal"),
                          (4, "fixed", "end_turn")])
        for x in api:
            self.assertEqual(x["usage"], USAGE)
            self.assertEqual((x["model"], x["request_id"]), ("claude-sonnet-5-5", "req_test"))
            self.assertIsInstance(x["latency_ms"], int)
            self.assertIsInstance(x["api_ms"], int)
        self.assertEqual([x["text"] for x in api], ["Squats, got it.", "-", "", "Keep your chest up."])
        self.assertEqual(api[2]["refusal"], "cyber")
        r = s.said_since(0)
        self.assertEqual((r["alive"], r["connected"], r["transport"], r["error"]), (True, True, "api", None))
        s.stop()
        wait_for(lambda: not s.alive())                  # (the worker wakes from its wait and ends)

    def test_a_reply_cut_short_is_spoken_whole_or_not_at_all_and_a_fallback_is_logged(self):
        iterations = [{"type": "message", "model": "claude-sonnet-5-5", **USAGE, "output_tokens": 0},
                      {"type": "fallback_message", "model": "claude-sonnet-5", **USAGE}]
        fell_back = reply(content=[{"type": "fallback", "from": {"model": "claude-sonnet-5-5"},
                                    "to": {"model": "claude-sonnet-5"}, "trigger": {"type": "refusal",
                                                                                     "category": "cyber"}},
                                   {"type": "text", "text": "Nice depth."}],
                          model="claude-sonnet-5", usage={**USAGE, "iterations": iterations})
        thought = reply(stop="max_tokens", content=[{"type": "thinking", "thinking": "Let me", "signature": "x"}])
        s = self.start([reply("Keep your knees", stop="max_tokens"), thought,
                        reply("Keep your knees out.", stop="max_tokens"), fell_back])
        # cut mid-sentence, or in its thinking with no text: nothing said at all (the page's wait runs out and it
        # speaks the engine's sentence), logged as a failure, and the exchange is not in the history
        self.failed(s)
        self.failed(s)
        self.assertEqual((s.said, s.history, s.alive(), s.error), ([], [], True, None))
        self.assertEqual(self.said(s), "Keep your knees out.")   # a whole sentence
        # (the two cut ones go with it, as the page handled them: the history stays true)
        first = self.api.calls[2]["messages"][-1]["content"]
        self.assertTrue(first.startswith(coach.MISSED + "(cue) Form fault on Squat"), first)
        self.assertEqual(first.count("(cue) Form fault on Squat"), 2)
        self.assertEqual(json.loads(first.split("\n", 1)[1])["event_id"], 3)
        self.assertEqual(self.said(s), "Nice depth.")
        self.assertFalse(self.api.calls[3]["messages"][-1]["content"].startswith(coach.MISSED))    # (told once)
        api = [x for x in self.lines(s) if x["type"] == "pose_coach.api"]
        self.assertEqual([x.get("failure") for x in api], ["cut", "cut", None, None])
        self.assertEqual(api[0]["text"], "Keep your knees")
        self.assertEqual(api[3]["fallback"], ["claude-sonnet-5-5 -> claude-sonnet-5"])
        self.assertEqual(api[3]["served_by"], "claude-sonnet-5")
        self.assertNotIn("served_by", api[2])
        self.assertEqual(s.history[-1]["content"], fell_back.content)    # (a non-streaming fallback goes back whole)
        # (after a fallback mid-output, the declined model's thinking before the last fallback block does not)
        blocks = [types.SimpleNamespace(type=t) for t in ("thinking", "text", "fallback", "thinking", "text")]
        self.assertEqual(coach.echo(blocks), blocks[1:])
        self.assertEqual(coach.echo(blocks[3:]), blocks[3:])

    def test_a_refused_key_ends_the_session_so_the_page_moves_on(self):
        for cls, code in ((anthropic.AuthenticationError, 401), (anthropic.PermissionDeniedError, 403)):
            s = self.start([failure(cls, code, "invalid x-api-key")])
            self.push(s)
            wait_for(lambda: not s.alive())
            r = s.said_since(0)
            self.assertEqual((r["said"], r["alive"], r["connected"], r["error"]), ([], False, True, coach.KEY_REFUSED))
            self.assertIn('"type": "pose_coach.gave_up"', (s.dir / f"session-{s.id}.jsonl").read_text())

    def test_a_rejected_request_ends_the_session_with_the_apis_words_and_never_the_key(self):
        for cls, code in ((anthropic.BadRequestError, 400), (anthropic.NotFoundError, 404)):
            s = self.start([reply("Squats, got it."), failure(cls, code, f"model: claude-x not found (key {KEY})")])
            self.said(s)
            self.push(s)
            wait_for(lambda: not s.alive())
            self.assertTrue(s.error.startswith(f"the Anthropic API answered {code}: model: claude-x not found"),
                            s.error)
            self.assertNotIn(KEY, s.error)
            self.assertNotIn("sk-ant", s.error)
            # nowhere the page, the log or the health check reads
            for text in ((s.dir / f"session-{s.id}.jsonl").read_text(), json.dumps(s.said_since(0)),
                         json.dumps(coach.status()), json.dumps(s.history, default=str)):
                self.assertNotIn(KEY, text)
                self.assertNotIn(KEY[7:20], text)
            self.assertNotIn("ANTHROPIC_API_KEY", os.environ)          # (and never in the environment)

    def failed_event(self, s: coach.Session, attempts=2):
        """An event whose request fails `attempts` times (with its retry): nothing is said; each is logged."""
        n = len([x for x in self.lines(s) if x.get("failure")])
        self.push(s)
        wait_for(lambda: len([x for x in self.lines(s) if x.get("failure")]) >= n + attempts)

    def test_a_request_that_fails_is_retried_once_then_left_to_the_page_and_three_in_a_row_end_the_session(self):
        overloaded = lambda: failure(anthropic.OverloadedError, 529)      # (529: not an InternalServerError in 2.1.0)
        s = self.start([failure(anthropic.RateLimitError, 429), failure(anthropic.InternalServerError, 500),
                        reply("Back on it."),
                        anthropic.APIConnectionError(request=REQ), reply("Steady."),
                        *(overloaded() for _ in range(6))])
        self.failed_event(s)                                                   # failed, and failed again
        self.assertEqual((s.said, s.alive(), s.error), ([], True, None))      # the page speaks the engine's cue
        self.assertEqual(self.said(s), "Back on it.")
        # the failed event is not in the history as an exchange: its message went unanswered; it goes with the next one
        # as a line, as the page handled it
        self.assertEqual(len(self.api.calls[2]["messages"]), 1)
        self.assertTrue(self.api.calls[2]["messages"][0]["content"].startswith(coach.MISSED + "(cue) "))
        self.assertEqual(self.said(s), "Steady.")                              # a connection error, then the retry
        self.assertEqual(len(self.api.calls), 5)
        self.failed_event(s)
        self.failed_event(s)
        self.assertEqual((len(s.said), s.alive(), s.error), (2, True, None))  # two in a row: it goes on
        self.push(s)
        wait_for(lambda: not s.alive())
        r = s.said_since(0)                                                    # (the page fails over on this poll)
        self.assertEqual((r["alive"], r["error"]),
                         (False, "the Anthropic API failed 3 times in a row (last: OverloadedError 529)"))
        errors = [x for x in self.lines(s) if x.get("failure")]
        self.assertEqual([x["error"] for x in errors], ["RateLimitError 429", "InternalServerError 500",
                                                         "APIConnectionError", *["OverloadedError 529"] * 6])
        self.assertEqual(["retry_in_ms" in x for x in errors], [True, False, True] + [True, False] * 3)
        api = [x for x in self.lines(s) if x["type"] == "pose_coach.api" and not x.get("failure")]
        self.assertEqual([x.get("retried") for x in api], [None, True])

    def test_a_retry_waits_at_most_two_seconds_and_only_for_what_may_pass(self):
        wait = coach.retry_wait
        self.assertEqual(wait(anthropic.APIConnectionError(request=REQ)), coach.API_RETRY_S)
        self.assertEqual(wait(anthropic.APITimeoutError(request=REQ)), coach.API_RETRY_S)
        self.assertEqual(wait(failure(anthropic.RateLimitError, 429)), coach.API_RETRY_S)
        self.assertEqual(wait(failure(anthropic.RateLimitError, 429, headers={"retry-after": "1"})), 1.0)
        self.assertEqual(wait(failure(anthropic.RateLimitError, 429, headers={"retry-after-ms": "300"})), 0.3)
        # (SDK 2.1.0 follows any retry-after: a minute of a silent coach shown as healthy)
        self.assertEqual(wait(failure(anthropic.RateLimitError, 429, headers={"retry-after": "60"})), 2.0)
        self.assertEqual(wait(failure(anthropic.RateLimitError, 429,
                                      headers={"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"})), 2.0)
        for e in (failure(anthropic.InternalServerError, 500), failure(anthropic.OverloadedError, 529),
                  failure(anthropic.APIStatusError, 408), failure(anthropic.ConflictError, 409)):
            self.assertEqual(wait(e), coach.API_RETRY_S, e)
        for e in (failure(anthropic.BadRequestError, 400), failure(anthropic.AuthenticationError, 401),
                  failure(anthropic.NotFoundError, 404), failure(anthropic.RateLimitError, 429,
                                                                 headers={"x-should-retry": "false"}),
                  ValueError("unexpected")):
            self.assertIsNone(wait(e), e)

    def test_no_retry_once_the_page_has_stopped_waiting(self):
        coach.PAGE_WAIT_S, coach.API_RETRY_S = 1.0, 1.5          # (the retry would come after the page's wait)
        s = self.start([failure(anthropic.RateLimitError, 429), reply("Go on.")])
        self.failed_event(s, attempts=1)
        self.assertEqual(self.said(s), "Go on.")
        self.assertEqual(len(self.api.calls), 2)                 # the next event's request, not a retry
        self.assertNotIn("retry_in_ms", [x for x in self.lines(s) if x.get("failure")][0])

    def test_events_the_page_stopped_waiting_for_are_not_sent_but_told_with_the_next(self):
        # a slow request: the events queued behind it come after the page's wait (it spoke the engine's sentence for
        # each, and skips a late cue): none costs a request; the next fresh one tells the model of them
        coach.PAGE_WAIT_S = 0.5
        gate = threading.Event()
        s = self.start([slow(gate, reply("Chest up.")), reply("Sure, rest a minute."), reply("Nice and deep.")])
        self.push(s)
        wait_for(lambda: len(self.api.calls) == 1)
        self.push(s, "fixed", message="Knees out")
        self.push(s, "praise", reps=5)
        self.push(s, "user_said", text="can I rest?")            # (an answer is waited for longer: ANSWER_WAIT_S)
        time.sleep(0.6)
        gate.set()
        wait_for(lambda: len(s.said) == 2)
        self.assertEqual([x["text"] for x in s.said], ["Chest up.", "Sure, rest a minute."])
        self.assertEqual(len(self.api.calls), 2)
        told = self.api.calls[1]["messages"][-1]["content"]
        line, event = told.split("\n", 1)
        self.assertEqual(line, coach.MISSED + "(fixed) The user fixed 'Knees out' on Squat; the last two reps were "
                               "clean. | (praise) 5 reps of Squat, the last five clean.")
        self.assertEqual((json.loads(event)["kind"], json.loads(event)["event_id"]), ("user_said", 4))
        self.assertEqual(s.history[-2]["content"], told)                    # (as it was sent: append-only)
        skipped = [x for x in self.lines(s) if x.get("skipped")]
        self.assertEqual([(x["event_id"], x["skipped"]) for x in skipped], [(2, "late"), (3, "late")])
        self.assertTrue(all(x["waited_ms"] >= 500 for x in skipped))
        coach.PAGE_WAIT_S = 3.0
        self.assertEqual(self.said(s), "Nice and deep.")                    # (told once)
        self.assertEqual(json.loads(self.api.calls[2]["messages"][-1]["content"])["event_id"], 5)

    def test_nothing_queued_is_sent_after_the_session_stops(self):
        gate = threading.Event()
        s = self.start([slow(gate, reply("Chest up.")), reply("x"), reply("y")])
        self.push(s)
        wait_for(lambda: len(self.api.calls) == 1)
        self.push(s)
        self.push(s)
        s.stop()                                                 # (Stop, the page gone idle, a plan changed)
        gate.set()
        wait_for(lambda: not s.alive())
        self.assertEqual(len(self.api.calls), 1)                 # the request in flight only: none billed after
        self.assertIsNone(s.error)

    def test_auto_takes_the_api_with_a_key_and_claude_code_without(self):
        coach.api_client = lambda key, **kw: FakeApi([])
        self.assertEqual(coach.claude_transport(), "cli")                    # no key file
        self.key(" \n")
        self.assertEqual(coach.claude_transport(), "cli")                    # an empty one
        self.assertIsNone(coach.api_key())
        self.key()
        self.assertEqual((coach.claude_transport(), coach.api_key()), ("api", KEY))
        self.assertEqual(coach.claude_transport(key_ok=False), "cli")        # the API refused it
        self.assertEqual(coach.status()["transport"], "api")
        s = coach.Session("workout", self.tmp, "http://127.0.0.1:1")
        self.assertEqual((s.transport, s.system), ("api", coach.system_prompt("api")))
        coach.TRANSPORT = "cli"
        self.assertEqual(coach.claude_transport(), "cli")
        self.assertEqual(coach.Session("workout", self.tmp, "http://127.0.0.1:1").system, coach.system_prompt())
        # the page's check found the key refused: Claude Code (here not found: no session is left)
        coach.TRANSPORT = "auto"
        connections.ANTHROPIC.value = {"configured": True, "ok": False, "error": coach.KEY_REFUSED, "failed": False}
        self.assertEqual(coach.status()["transport"], "cli")                 # (/api/health says so too)
        with self.assertRaises(FileNotFoundError):
            coach.start({}, self.tmp, "http://127.0.0.1:1")
        # api asked for with no key: nothing starts
        connections.ANTHROPIC.clear()
        coach.TRANSPORT = "api"
        coach.KEY_FILE.unlink()
        with self.assertRaises(FileNotFoundError):
            coach.start({}, self.tmp, "http://127.0.0.1:1")
        self.assertEqual(coach.SESSIONS, {})

    def test_thinking_is_off_on_sonnet_at_high_or_below_else_adaptive_with_room_for_it(self):
        self.assertEqual((coach.thinking_config(), coach.max_tokens()), ({"type": "between_tools"}, 400))
        for attr, value in (("EFFORT", "xhigh"), ("EFFORT", "max"), ("THINKING", "adaptive"), ("MODEL", "opus"),
                            ("MODEL", "haiku")):
            saved = getattr(coach, attr)
            setattr(coach, attr, value)
            # (thinking counts toward max_tokens: at 400 most replies ended in it, with no text)
            self.assertEqual((coach.thinking_config(), coach.max_tokens()), ({"type": "adaptive"}, 8000), value)
            setattr(coach, attr, saved)
        coach.EFFORT = "xhigh"
        s = self.start([reply("Squats, got it.")])
        self.said(s)
        call = self.api.calls[0]
        self.assertEqual((call["thinking"], call["output_config"], call["max_tokens"]),
                         ({"type": "adaptive"}, {"effort": "xhigh"}, 8000))
        coach.MODEL = "haiku"                             # Claude Haiku 5.5 has no server-side fallback
        s = self.start([reply("Squats, got it.")])
        self.said(s)
        self.assertNotIn("fallbacks", self.api.calls[0])
        self.assertNotIn("betas", self.api.calls[0])
        self.assertEqual(self.api.calls[0]["model"], "claude-haiku-5-5")

    def test_the_real_client_reaches_the_api_alone_whatever_the_environment_says(self):
        # (Claude Code and gateways set ANTHROPIC_BASE_URL and ANTHROPIC_CUSTOM_HEADERS; a server started from such a
        # shell inherits them.) The SDK's own client, with a made-up key, in a process of its own; its one request goes
        # to a transport in the process: nothing is sent
        script = """if True:
            import json, httpx2, coach
            c = coach.api_client("sk-ant-api03-MADE-UP-test-key-0123456789")
            sent = []
            def answer(request):
                sent.append(request)
                return httpx2.Response(200, json={"type": "model", "id": "claude-sonnet-5-5", "display_name": "x",
                                                  "created_at": "2026-01-01T00:00:00Z"})
            c.with_options(http_client=httpx2.Client(transport=httpx2.MockTransport(answer))).models.retrieve("m")
            print(json.dumps({"base_url": str(c.base_url), "url": str(sent[0].url), "max_retries": c.max_retries,
                              "headers": sorted(k.lower() for k in sent[0].headers),
                              "timeout": [c.timeout.connect, c.timeout.read]}))"""
        env = {**{k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"},
               "ANTHROPIC_BASE_URL": "https://proxy.example.invalid", "POSE_ANTHROPIC_KEY_FILE": str(coach.KEY_FILE),
               "ANTHROPIC_CUSTOM_HEADERS": "X-Test: leak\nX-Gateway-Token: also"}
        got = json.loads(subprocess.run([sys.executable, "-c", script], cwd=SERVER, env=env, capture_output=True,
                                        text=True, check=True).stdout)
        self.assertEqual(got["base_url"], "https://api.anthropic.com")
        self.assertEqual(got["url"], "https://api.anthropic.com/v1/models/m")
        self.assertNotIn("x-test", got["headers"])
        self.assertNotIn("x-gateway-token", got["headers"])
        self.assertIn("authorization", got["headers"])                      # (the key, as SDK 2.1.0 sends it)
        # no retries of the SDK's own (the session makes one, while the cue can still come), and a short timeout
        self.assertEqual((got["max_retries"], got["timeout"]), (0, [3.0, 10.0]))

    def test_the_apis_instructions_are_the_mcp_ones_with_the_reply_spoken(self):
        api = " ".join(coach.API_SYSTEM.split())
        for gone in ("wait_for_event", "call say", "tool calls"):
            self.assertNotIn(gone, api)
        for rule in ("Each message you get is one tracker event (JSON with its summary) or the user's words with "
                     "what the page did",
                     "Reply with only the words to speak: your reply is read aloud as it is",
                     "For words not meant for you, reply with only a hyphen (-) and nothing is spoken",
                     "A hold of a few seconds needs no word when it ends: reply with only a hyphen (-)",
                     "a fragment that makes no sense): reply with only a hyphen (-), and nothing is spoken",
                     "A message may start with a line on earlier events that the page handled without you",
                     "they are past, so reply to the event after that line alone"):
            self.assertIn(rule.lower(), api.lower(), rule)
        # one text: the MCP one but for those parts
        self.assertEqual(coach.API_SYSTEM.replace(coach.API_HOW, coach.MCP_HOW)
                         .replace("reply with only a hyphen (-)", "call say with an empty text"), coach.SYSTEM)
        self.assertIn(coach.MCP_HOW, coach.SYSTEM)


if __name__ == "__main__":
    unittest.main()
