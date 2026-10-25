"""The dev server's local voice (server/tts.py) and its door (server/dev_server.py), without MLX: the worker is the real
job loop (kokoro_worker.serve) with a fake synthesizer, so which cue is cut, when, and what each stream says are the
real ones; a worker that dies is started again; requests addressed to another host are turned away; the coach's
connections are read by any page here (checked again when asked fresh), and changed, like a coach session started, only
with JSON from this machine's pages; an event's reading (the agent's messages, a named movement's too) needs no session;
the movement library and its animations are served (GET), and nothing else of their private folder; the page's code
version (/api/version) changes with any of its files, in web/js's folders too.

    python3 tests/test_server.py          (from inference/pose-coach; the standard library only)
"""
from __future__ import annotations

import http.client
import importlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))
import coach  # noqa: E402
import connections  # noqa: E402
import dev_server  # noqa: E402
import tts  # noqa: E402


def no_api(*a, **k):
    raise AssertionError("a test reached for the Anthropic API")


# no test reads the user's own Anthropic key or reaches the API: a key file that is not there, a client that fails
coach.KEY_FILE = Path(tempfile.gettempdir()) / "pose-coach-tests" / "no-anthropic-key"
coach.TRANSPORT = "auto"
coach.api_client = no_api

SENTENCE_S = 0.3                    # how long the fake worker takes per sentence
# a stand-in for kokoro_worker.main: no model, the same job loop. "Die..." kills it; a file "die-at-start" next to it
# makes it exit before it is ready; each start is counted in "starts".
FAKE = """
import os, sys, time
sys.path.insert(0, {server!r})
import kokoro_worker
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "starts"), "a") as f:
    f.write("x")
if os.path.exists(os.path.join(here, "die-at-start")):
    sys.exit(1)

def make(text, voice):
    if text.startswith("Die"):
        os._exit(3)
    time.sleep({sentence_s})
    return b"\\0\\0" * 8, 24000

kokoro_worker.emit({{"ready": True, "load_ms": 0, "warm_ms": 0}})
kokoro_worker.serve(make, {{"af_heart"}})
"""
LONG = " ".join(f"This is sentence number {n} of a long cue." for n in range(1, 11))    # ten chunks
THREE = " ".join(f"This is sentence number {n} of a cue." for n in range(1, 4))
ONE = "One sentence long enough to stand alone."


class FakeWorker(unittest.TestCase):
    """Each test with a fresh tts module, whose worker is FAKE."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pose-coach-test-"))
        importlib.reload(tts)                                # a fresh state (dev_server sees the same module)
        tts.PYTHON = Path(sys.executable)
        tts.WORKER = self.tmp / "worker.py"
        tts.LOG = self.tmp / "worker.log"
        tts.WORKER.write_text(FAKE.format(server=str(SERVER), sentence_s=SENTENCE_S))

    def tearDown(self):
        tts.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def starts(self) -> int:
        f = self.tmp / "starts"
        return len(f.read_text()) if f.exists() else 0


class Voice(FakeWorker):
    def say(self, *args, **kw) -> tuple[threading.Thread, list]:
        """say() in a thread: (thread, [(seconds since the call, message), ...])"""
        out: list = []

        def run():
            t0 = time.monotonic()
            for msg in tts.say(*args, **kw):
                out.append((time.monotonic() - t0, msg))
        th = threading.Thread(target=run, daemon=True)
        th.start()
        return th, out

    def wait_for(self, cond, timeout=10.0):
        end = time.monotonic() + timeout
        while not cond():
            self.assertLess(time.monotonic(), end, "timed out")
            time.sleep(0.01)

    def test_a_cue_ends_its_pages_older_cue_which_says_so_and_the_worker_drops_the_rest(self):
        a, a_out = self.say(LONG, page="p", seq=1)
        self.wait_for(lambda: a_out)                         # the first sentence is out
        b, b_out = self.say(ONE, page="p", seq=2)
        a.join(10)
        b.join(10)
        self.assertEqual(a_out[-1][1], {"superseded": True})
        self.assertFalse(any(m.get("last") for _, m in a_out))
        self.assertEqual([m["text"] for _, m in b_out], [ONE])
        self.assertTrue(b_out[-1][1]["last"])
        # B waited for at most the sentence A was making, not for A's eight or so others
        self.assertLess(b_out[0][0], 4 * SENTENCE_S)
        self.assertEqual(tts._jobs, {})

    def test_a_cue_not_newer_than_its_pages_latest_gets_only_superseded(self):
        self.assertTrue(list(tts.say(ONE, page="p", seq=5))[-1]["last"])
        self.assertEqual(list(tts.say(ONE, page="p", seq=5)), [{"superseded": True}])
        self.assertEqual(list(tts.say(ONE, page="p", seq=4)), [{"superseded": True}])
        self.assertTrue(list(tts.say(ONE, page="p", seq=6))[-1]["last"])
        self.assertTrue(list(tts.say(ONE, page="q", seq=1))[-1]["last"])        # another page has its own seq
        self.assertEqual(tts._jobs, {})

    def test_cues_of_other_pages_or_of_no_page_are_not_cut_but_made_in_turn(self):
        runs = [self.say(THREE, page="p", seq=1), self.say(THREE, page="q", seq=1), self.say(THREE), self.say(THREE)]
        for th, _ in runs:
            th.join(30)
        for _, out in runs:
            self.assertEqual(len(out), 3)
            self.assertTrue(out[-1][1]["last"])
        self.assertEqual(tts._jobs, {})

    def test_a_stream_closed_early_drops_the_rest_of_its_cue(self):
        g = tts.say(LONG)
        self.assertEqual(next(g)["i"], 0)
        g.close()                                            # (as the dev server does when the page went away)
        self.assertEqual(tts._jobs, {})
        th, out = self.say(ONE)
        th.join(10)
        self.assertTrue(out[-1][1]["last"])
        self.assertLess(out[0][0], 4 * SENTENCE_S)          # not after the eight or so left of the closed one

    def test_a_voice_not_in_the_snapshot_or_a_cue_with_nothing_to_say_is_an_error(self):
        [msg] = list(tts.say(ONE, "af_zzzz"))
        self.assertTrue(msg["error"].startswith("LookupError: no Kokoro voice af_zzzz"), msg)
        [msg] = list(tts.say("...!?"))                       # (the dev server answers 400 before this)
        self.assertTrue(msg["error"].startswith("ValueError: nothing to say"), msg)
        self.assertEqual(tts._jobs, {})

    def test_a_worker_that_dies_is_started_again_and_the_next_cue_is_spoken(self):
        self.assertTrue(list(tts.say(ONE))[-1]["last"])
        self.assertEqual(list(tts.say("Die, worker, right now please.")), [{"error": "the Kokoro worker stopped"}])
        self.assertTrue(list(tts.say(ONE))[-1]["last"])
        self.assertEqual(self.starts(), 2)
        self.assertEqual(tts.status()["ready"], True)
        self.assertEqual(tts._jobs, {})

    def test_a_worker_that_keeps_dying_is_given_up_on(self):
        (self.tmp / "die-at-start").touch()
        [msg] = list(tts.say(ONE))
        self.assertIn("error", msg)
        self.wait_for(lambda: "restart the dev server" in (tts.status()["error"] or ""))
        self.assertEqual(self.starts(), 1 + tts.MAX_RESTARTS)
        [msg] = list(tts.say(ONE))
        self.assertIn("restart the dev server", msg["error"])
        self.assertEqual(self.starts(), 1 + tts.MAX_RESTARTS)

    def test_a_replaced_workers_reader_leaves_the_new_workers_state_alone(self):
        self.assertTrue(list(tts.say(ONE))[-1]["last"])

        class Old:                                           # a worker already replaced: it says ready, then stops
            stdin, stdout = io.StringIO(), io.StringIO('{"ready": true, "load_ms": 1, "warm_ms": 1}\n')
            def wait(self): return 3
        tts._read(Old())
        self.assertEqual(tts.status()["ready"], True)
        self.assertIsNone(tts.status()["error"])
        self.assertTrue(list(tts.say(ONE))[-1]["last"])
        self.assertEqual(self.starts(), 1)

    def test_a_failed_write_to_the_worker_is_an_error_line_and_leaves_no_queue(self):
        self.assertTrue(list(tts.say(ONE))[-1]["last"])

        class Broken:
            closed = False
            def write(self, s): raise BrokenPipeError
            def flush(self): pass
        stdin, tts._proc.stdin = tts._proc.stdin, Broken()
        try:
            self.assertEqual(list(tts.say(ONE)), [{"error": "the Kokoro worker stopped"}])
            self.assertEqual(tts._jobs, {})
        finally:
            tts._proc.stdin = stdin


class CodeVersion(unittest.TestCase):
    """/api/version's hash of the page's code, on a stand-in web/ folder: a change to any of the page's files, in web/js
    or a folder under it (web/js/moveforms/), marks an open page as out of date; nothing else does."""

    def setUp(self):
        self.web = Path(tempfile.mkdtemp(prefix="pose-coach-web-"))
        self.addCleanup(shutil.rmtree, self.web, ignore_errors=True)
        (self.web / "js" / "moveforms").mkdir(parents=True)
        (self.web / "index.html").write_text("<!doctype html>")
        (self.web / "js" / "app.js").write_text("// the page")
        (self.web / "js" / "moveforms" / "arms.js").write_text("export default {};")
        real, dev_server.WEB = dev_server.WEB, self.web
        self.addCleanup(setattr, dev_server, "WEB", real)

    def test_a_change_under_web_js_at_any_depth_changes_the_version(self):
        v0 = dev_server.code_version()
        self.assertRegex(v0, r"^[0-9a-f]{12}$")
        self.assertEqual(dev_server.code_version(), v0, "the same files: the same version")
        arms = self.web / "js" / "moveforms" / "arms.js"
        arms.write_text("export default { shoulder_external_rotation: [] };")
        v1 = dev_server.code_version()
        self.assertNotEqual(v1, v0, "a group file of web/js/moveforms/ changed")
        (self.web / "js" / "moveforms" / "deeper").mkdir()
        (self.web / "js" / "moveforms" / "deeper" / "x.js").write_text("export const x = 1;")
        v2 = dev_server.code_version()
        self.assertNotEqual(v2, v1, "a new file further down")
        (self.web / "js" / "app.js").write_text("// the page, changed")
        self.assertNotEqual(dev_server.code_version(), v2)
        arms.write_text("export default {};")
        (self.web / "js" / "moveforms" / "deeper" / "x.js").unlink()
        (self.web / "js" / "app.js").write_text("// the page")
        self.assertEqual(dev_server.code_version(), v0, "back as it was: the version it had")

    def test_a_file_moved_between_folders_changes_it_and_other_files_do_not(self):
        v0 = dev_server.code_version()
        (self.web / "js" / "notes.txt").write_text("not code")
        (self.web / "js" / "moveforms" / "arms.js.bak").write_text("an editor's copy")
        self.assertEqual(dev_server.code_version(), v0, "only page code and styles count")
        (self.web / "js" / "moveforms" / "arms.js").rename(self.web / "js" / "arms.js")
        self.assertNotEqual(dev_server.code_version(), v0, "the same file in another folder: another page")

    def test_embed_styles_change_the_version(self):
        before = dev_server.code_version()
        css = self.web / "embed.css"
        css.write_text("body.embed { color: white; }")
        self.assertNotEqual(dev_server.code_version(), before)
        before = dev_server.code_version()
        css.write_text("body.embed { color: black; }")
        self.assertNotEqual(dev_server.code_version(), before)

    def test_the_real_page_has_one(self):
        dev_server.WEB = Path(__file__).resolve().parent.parent / "web"
        self.assertRegex(dev_server.code_version(), r"^[0-9a-f]{12}$")


class Server(FakeWorker):
    """The dev server in this process, on a free port."""

    @classmethod
    def setUpClass(cls):
        dev_server.Handler.log_message = lambda *a: None
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), dev_server.Handler)
        cls.port = cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def get(self, path, host: str | None = "127.0.0.1:{port}", method="GET", body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        c.putrequest(method, path, skip_host=True)
        if host is not None:
            c.putheader("Host", host.format(port=self.port))
        for k, v in (headers or {}).items():
            c.putheader(k, v)
        if body is not None:
            if "Content-Type" not in (headers or {}):
                c.putheader("Content-Type", "application/json")
            c.putheader("Content-Length", str(len(body)))
        c.endheaders(body.encode() if body is not None else None)
        r = c.getresponse()
        data = r.read().decode()
        c.close()
        return r.status, data

    def test_only_requests_addressed_to_this_machine_by_its_port_are_answered(self):
        for host in ("127.0.0.1:{port}", "localhost:{port}", "LOCALHOST:{port}", "[::1]:{port}"):
            self.assertEqual(self.get("/api/version", host)[0], 200, host)
        for host in ("evil.example:{port}", "127.0.0.1", "localhost", "127.0.0.1:1{port}", "localhost.:{port}",
                     "127.0.0.1:{port}.evil.example", "evil.example", ""):
            self.assertEqual(self.get("/api/version", host)[0], 421, host)
            self.assertEqual(self.get("/api/config", host)[0], 421, host)
            self.assertEqual(self.get("/api/coach/describe", host, "POST", "{}")[0], 421, host)
            self.assertEqual(self.get("/api/connections/elevenlabs", host, "DELETE", "{}")[0], 421, host)
            self.assertEqual(self.get("/api/stt/status", host)[0], 421, host)
        self.assertEqual(self.get("/api/version", None)[0], 421)                  # no Host at all

    def connections(self, run):
        """run() with the agent record in a temporary folder, neither CLI found (none of the user's own runs) and no
        Anthropic API key."""
        saved = connections.DIR, connections.LEGACY, coach.claude_cli, coach.codex_cli, coach.KEY_FILE, os.environ.pop(
            "POSE_ELEVEN_AGENT", None)
        connections.DIR, connections.LEGACY = self.tmp / "connections", self.tmp / "eleven-agent-id"
        coach.claude_cli = coach.codex_cli = lambda: None
        coach.KEY_FILE = self.tmp / "connections" / "anthropic-key"
        for check in (connections.CLAUDE, connections.CHATGPT, connections.ANTHROPIC):
            check.clear()
        try:
            run()
        finally:
            connections.DIR, connections.LEGACY, coach.claude_cli, coach.codex_cli, coach.KEY_FILE, env = saved
            if env is not None:
                os.environ["POSE_ELEVEN_AGENT"] = env
            for check in (connections.CLAUDE, connections.CHATGPT, connections.ANTHROPIC):
                check.clear()

    def test_connections_are_read_by_the_page_and_changed_only_with_json_from_this_machines_pages(self):
        def run():
            agent = "agent_" + "0123456789" * 3
            status, body = self.get("/api/connections")
            st = json.loads(body)
            self.assertEqual((status, st["auto"], st["eleven"]["connected"]), (200, "none", False))
            self.assertEqual(st["order"], ["eleven", "claude", "chatgpt"])
            save = json.dumps({"agentId": agent, "plan": "starter"})
            for headers, code in (({"Content-Type": "text/plain"}, 415),             # a form or plain text: no
                                  ({"Content-Type": "application/x-www-form-urlencoded"}, 415),
                                  ({"Origin": "http://evil.example"}, 403),          # another site's page
                                  ({"Origin": "https://localhost:{port}"}, 403),
                                  ({"Origin": "http://localhost.evil.example:{port}"}, 403),
                                  ({"Origin": "null"}, 403)):                        # (a sandboxed frame, a file)
                h = {k: v.format(port=self.port) for k, v in headers.items()}
                self.assertEqual(self.get("/api/connections/elevenlabs", method="POST", body=save, headers=h)[0], code,
                                 h)
                self.assertEqual(self.get("/api/connections/elevenlabs", method="DELETE", body="{}", headers=h)[0],
                                 code, h)
            self.assertFalse((connections.DIR / "elevenlabs.json").exists())
            for bad in ("{", "[]", json.dumps({"agentId": "invalid-agent"}), json.dumps({"agentId": agent, "plan": 5})):
                status, body = self.get("/api/connections/elevenlabs", method="POST", body=bad)
                self.assertEqual(status, 400, bad)
                self.assertIn("error", json.loads(body))
            status, body = self.get("/api/connections/elevenlabs", method="POST", body=save,
                                    headers={"Origin": "http://localhost:{port}".format(port=self.port),
                                             "Content-Type": "application/json; charset=utf-8"})
            st = json.loads(body)
            self.assertEqual((status, st["auto"]), (200, "eleven"))
            self.assertEqual(st["eleven"], {"connected": True, "agentId": agent, "name": None, "plan": "starter",
                                            "paid": True, "llm": None})
            self.assertEqual(json.loads(self.get("/api/config")[1]), {"elevenAgentId": agent})
            status, body = self.get("/api/connections/elevenlabs", method="DELETE", body="",
                                    headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:8082"})
            self.assertEqual((status, json.loads(body)["eleven"]["connected"]), (200, False))
            self.assertEqual(json.loads(self.get("/api/config")[1]), {"elevenAgentId": None})
            self.assertEqual(self.get("/api/connections/other", method="DELETE", body="{}")[0], 404)
        self.connections(run)

    def test_fresh_asks_for_the_clis_to_be_checked_again(self):
        def run():
            checks, check = [], connections.CLAUDE.run
            connections.CLAUDE.run = lambda: checks.append(1) or check()
            saved_fresh, connections.FRESH_S = connections.FRESH_S, 0
            try:
                for path in ("/api/connections", "/api/connections", "/api/connections?fresh=0"):
                    self.assertEqual(self.get(path)[0], 200)
                self.assertEqual(len(checks), 1)                                # kept
                self.assertEqual(self.get("/api/connections?fresh=1")[0], 200)
                self.assertEqual(len(checks), 2)                                # checked again (Check again)
            finally:
                connections.CLAUDE.run, connections.FRESH_S = check, saved_fresh
        self.connections(run)

    def test_a_coach_session_starts_only_with_a_known_brain_from_this_machines_pages(self):
        # it starts a CLI on the user's subscription: a page elsewhere may not, even addressed to 127.0.0.1
        for headers, code in (({"Content-Type": "text/plain"}, 415), ({"Origin": "http://evil.example"}, 403),
                              ({"Origin": "http://localhost:{port}"}, 400)):     # (let in: gemini is no brain)
            h = {k: v.format(port=self.port) for k, v in headers.items()}
            status, body = self.get("/api/coach/start", method="POST", body=json.dumps({"brain": "gemini"}), headers=h)
            self.assertEqual(status, code, h)
        self.assertIn("brain must be one of", json.loads(body)["error"])
        self.assertEqual(coach.SESSIONS, {})
        # the page ends a session with sendBeacon (plain text): that one still reaches it
        status, body = self.get("/api/coach/stop", method="POST", body=json.dumps({"session": "nope"}),
                                headers={"Content-Type": "text/plain;charset=UTF-8"})
        self.assertEqual((status, "no coach session" in json.loads(body)["error"]), (404, True))

    def test_describe_reads_an_event_back_for_the_agent_the_trackers_questions_too(self):
        # the agent's messages: no session, nothing started; the event comes back whole, with its reading
        event = {"exercise": "workout", "exerciseLabel": "workout", "auto": True, "kind": "confirm_set_end",
                 "label": "Squat", "set": 1, "reps": 7}
        status, body = self.get("/api/coach/describe", method="POST", body=json.dumps({"event": event}),
                                headers={"Origin": "http://localhost:{port}".format(port=self.port)})
        got = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual({k: got[k] for k in event}, event)
        self.assertIn("set 1 of Squat may be over, 7 reps counted", got["summary"])
        status, body = self.get("/api/coach/describe", method="POST",
                                body=json.dumps({"event": {"kind": "ask_exercise"}}))
        self.assertIn("ask which exercise", json.loads(body)["summary"])
        # what the user said (to Claude or ChatGPT; the agent hears it itself), with what the page did with it
        said = {"kind": "user_said", "text": "switch to curls",
                "applied": {"type": "exercise", "exercise": "biceps_curl", "label": "Biceps curl"}}
        status, body = self.get("/api/coach/describe", method="POST", body=json.dumps({"event": said}))
        self.assertEqual(json.loads(body)["summary"], 'The user said: "switch to curls". The page switched to counting '
                         "Biceps curl: confirm in a few words.")
        self.assertEqual(coach.SESSIONS, {})

    def raw(self, path, headers=None, host="127.0.0.1:{port}") -> tuple[int, dict, bytes]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        c.putrequest("GET", path, skip_host=True)
        c.putheader("Host", host.format(port=self.port))
        for k, v in (headers or {}).items():
            c.putheader(k, v)
        c.endheaders()
        r = c.getresponse()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()}, r.read())
        c.close()
        return out

    def test_the_movement_library_and_its_animations_are_served_and_nothing_else_of_its_folder(self):
        # POSE_MOVES_DIR also holds the private catalog, the recognition study and the skeletons: only library.json and
        # glb/<key>.glb leave it, by GET (a made-up library: no movement of the real one in the repo)
        moves = self.tmp / "moves"
        (moves / "glb").mkdir(parents=True)
        (moves / "skel").mkdir()
        move = {"key": "made_up_move", "display": "Made-up move", "kind": "hold", "track": "hold",
                "glb": "glb/made_up_move.glb"}
        library = {"built": "2026-01-01", "movements": [move]}
        (moves / "library.json").write_text(json.dumps(library))
        glb = b"glTF" + bytes(range(60))
        (moves / "glb" / "made_up_move.glb").write_bytes(glb)
        for private in ("catalog.json", "cleared.json", "slugs.json", "eval_final.json", "skel/made_up.json",
                        "glb/notes.json", "glb/made_up_move.glb.json"):
            (moves / private).write_text("{}")
        (self.tmp / "outside.glb").write_bytes(b"glTF outside")
        (moves / "glb" / "linked_out.glb").symlink_to(self.tmp / "outside.glb")
        saved, dev_server.MOVES = dev_server.MOVES, moves.resolve()               # (as the server resolves it)
        try:
            status, headers, body = self.raw("/moves/library.json")
            self.assertEqual((status, headers["content-type"], json.loads(body)), (200, "application/json", library))
            status, headers, body = self.raw("/moves/glb/made_up_move.glb")
            self.assertEqual((status, headers["content-type"], body), (200, "model/gltf-binary", glb))
            status, headers, body = self.raw("/moves/glb/made_up_move.glb", {"Range": "bytes=0-3"})   # (byte ranges)
            self.assertEqual((status, body), (206, b"glTF"))
            self.assertTrue(json.loads(self.get("/api/health")[1])["moves"])
            for path in ("/moves/", "/moves", "/moves/catalog.json", "/moves/cleared.json", "/moves/slugs.json",
                         "/moves/eval_final.json", "/moves/skel/made_up.json", "/moves/glb/", "/moves/glb/notes.json",
                         "/moves/glb/made_up_move.glb.json", "/moves/glb/missing.glb", "/moves/glb/linked_out.glb",
                         "/moves/glb/../catalog.json", "/moves/glb/%2e%2e/catalog.json", "/moves/glb/..%2fcatalog.json",
                         "/moves/glb/Made_Up_Move.glb", "/moves/glb/made_up_move.GLB", "/moves/library.json/",
                         "/moves//library.json", "/moves/glb/sub/made_up_move.glb", "/moves/library.json%00"):
                self.assertEqual(self.raw(path)[0], 404, path)
            for method in ("POST", "DELETE"):                                   # GET only
                self.assertEqual(self.get("/moves/library.json", method=method, body="{}")[0], 404, method)
            self.assertEqual(self.raw("/moves/library.json", host="evil.example:{port}")[0], 421)
            (moves / "library.json").unlink()                                   # not built yet
            self.assertEqual(self.raw("/moves/library.json")[0], 404)
            self.assertFalse(json.loads(self.get("/api/health")[1])["moves"])
        finally:
            dev_server.MOVES = saved

    def test_describe_reads_a_named_movement_and_its_trackers_events_for_the_agent(self):
        saved, coach.LIBRARY = coach.LIBRARY, self.tmp / "no-library.json"     # (the event's own fields only)
        try:
            for event, says in (
                    ({"kind": "movement_set", "movement": "made_up_hold", "display": "Made-up hold",
                      "movementKind": "hold", "track": "hold"}, "the page times the hold, and no reps are counted"),
                    ({"kind": "hold_progress", "movement": "made_up_hold", "display": "Made-up hold", "seconds": 20},
                     "Made-up hold: held for 20 seconds so far"),
                    ({"kind": "rhythm_progress", "movement": "made_up_move", "display": "Made-up move", "count": 10,
                      "approximate": True}, "about 10 reps so far, by its rhythm: an approximate count")):
                status, body = self.get("/api/coach/describe", method="POST", body=json.dumps({"event": event}))
                self.assertEqual(status, 200)
                self.assertIn(says, json.loads(body)["summary"])
        finally:
            coach.LIBRARY = saved
        self.assertEqual(coach.SESSIONS, {})

    def tts(self, **q):
        status, body = self.get("/api/tts?" + urlencode({"voice": "af_heart", **q}))
        return status, [json.loads(line) for line in body.splitlines()] if status == 200 else json.loads(body)

    def test_tts_turns_away_text_with_nothing_to_say_and_a_page_without_its_seq(self):
        for q in ({"text": "..."}, {"text": " ?! "}, {"text": ONE, "voice": "af_heart\n"}, {"text": ONE, "page": "p"},
                  {"text": ONE, "seq": "1"}, {"text": ONE, "page": "a/b", "seq": "1"},
                  {"text": ONE, "page": "p" * 41, "seq": "1"}, {"text": ONE, "page": "p", "seq": "-1"},
                  {"text": ONE, "page": "p", "seq": "1.5"}):
            self.assertEqual(self.tts(**q)[0], 400, q)
        # the page logs the message: a cue of "..." must not read as a fault in the voice setting
        self.assertTrue(self.tts(text="...")[1]["error"].startswith("nothing to say"))
        self.assertIn("Kokoro voice", self.tts(text=ONE, voice="af_heart\n")[1]["error"])
        self.assertEqual(list(tts._jobs), [])
        self.assertEqual(self.starts(), 0)                   # none of them reached the worker

    def test_tts_streams_a_cue_and_says_when_one_was_superseded(self):
        status, lines = self.tts(text=ONE, page="page-1_x", seq="7")
        self.assertEqual(status, 200)
        self.assertEqual([m.get("last") for m in lines], [True])
        self.assertEqual(self.tts(text=ONE, page="page-1_x", seq="7"), (200, [{"superseded": True}]))
        status, lines = self.tts(text=ONE)                   # no page: supersedes nothing
        self.assertEqual(lines[-1].get("last"), True)

    def test_a_page_that_stops_listening_drops_the_rest_of_its_cue(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        c.request("GET", "/api/tts?" + urlencode({"voice": "af_heart", "text": LONG}))
        r = c.getresponse()
        self.assertEqual(json.loads(r.readline())["i"], 0)
        r.close()
        c.close()                                            # (as a page aborts its fetch)
        t0 = time.monotonic()
        status, lines = self.tts(text=ONE)
        self.assertEqual(lines[-1].get("last"), True)
        # the server sees the closed socket at its next write or two, then the worker drops the rest: not 9 sentences
        self.assertLess(time.monotonic() - t0, 6 * SENTENCE_S)


if __name__ == "__main__":
    unittest.main()
