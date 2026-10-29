"""Tests for the Windows local voice helper: who may call it, what it accepts, and how listening, cancelling, quiet
periods, a blocked microphone and a signed-out Claude Code behave. Speech, the microphone and Claude are faked here; the
real models and Claude Code are exercised by test_live.py.

    inference\\pose-coach\\.venv\\Scripts\\python.exe -m unittest discover -s win\\local-voice -p "test_service.py"
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import io
import json
import os
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

import audio
import claude_mcp
import service
import claude_code


def wav(seconds: float = 1.0, rate: int = 16000, channels: int = 1) -> str:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(channels); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(seconds * rate) * channels)
    return base64.b64encode(out.getvalue()).decode()


class HelperTest(unittest.TestCase):
    token = "a" * 64

    def setUp(self):
        self.server = service.make_server(self.token, 0)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.auth = {"Authorization": "Bearer " + self.token}
        patches = [patch.object(service.stt, "status", return_value={"available": True, "ready": True}),
                   patch.object(service.tts, "status", return_value={"available": True, "ready": True}),
                   patch.object(service.stt, "available", return_value=True),
                   patch.object(service.tts, "available", return_value=True),
                   patch.object(service.audio, "microphone", return_value={"ok": True, "name": "Test mic"}),
                   patch.object(service.claude_mcp, "status",
                                return_value={"installed": True, "loggedIn": True, "account": "you@example.com",
                                              "plan": "pro", "error": None})]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def post(self, path, data=None, headers=None, body=None, method="POST"):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        raw = body if body is not None else json.dumps(data if data is not None else {})
        c.request(method, path, raw, {"Content-Type": "application/json", **(headers or {})})
        r = c.getresponse()
        result = r.status, json.loads(r.read() or b"{}")
        c.close()
        return result

    # --- who may call it -----------------------------------------------------------------------------------------

    def test_status_proves_the_helper_without_revealing_the_token(self):
        nonce = secrets_hex()
        code, result = self.post("/status", {"nonce": nonce})
        self.assertEqual(code, 200)
        self.assertEqual(result["proof"], hmac.new(self.token.encode(), nonce.encode(), hashlib.sha256).hexdigest())
        self.assertNotIn(self.token, json.dumps(result))
        self.assertNotIn("account", json.dumps(result))         # the Claude account is only for authorized callers

    def test_everything_else_needs_the_token(self):
        for path in ("/info", "/listen", "/coach", "/speak", "/transcribe", "/cancel"):
            self.assertEqual(self.post(path, {"text": "hi"})[0], 403, path)
            self.assertEqual(self.post(path, {"text": "hi"}, {"Authorization": "Bearer " + "b" * 64})[0], 403, path)
        code, result = self.post("/info", {}, self.auth)
        self.assertEqual(code, 200)
        self.assertEqual(result["claude"]["account"], "you@example.com")

    def test_web_pages_are_refused_even_with_the_token(self):
        # Browsers (and WebView2 pages, such as the camera page) send Origin and Sec-Fetch-* on these requests.
        for extra in ({"Origin": "http://127.0.0.1:8765"}, {"Origin": "https://evil.example"}, {"Origin": "null"},
                      {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Mode": "cors"}):
            self.assertEqual(self.post("/info", {}, {**self.auth, **extra})[0], 403, extra)
            self.assertEqual(self.post("/status", {"nonce": secrets_hex()}, extra)[0], 403, extra)

    def test_dns_rebinding_hosts_are_refused(self):
        for host in ("evil.example", f"localhost:{self.port}", f"127.0.0.1:{self.port + 1}", "127.0.0.1"):
            self.assertEqual(self.post("/status", {"nonce": secrets_hex()}, {"Host": host})[0], 403, host)

    def test_only_known_paths_and_json_posts(self):
        self.assertEqual(self.post("/admin", {}, self.auth)[0], 403)
        self.assertEqual(self.post("/status", method="GET", body="")[0], 405)
        self.assertEqual(self.post("/info", headers={**self.auth, "Content-Type": "text/plain"}, body="{}")[0], 400)
        self.assertEqual(self.post("/info", headers=self.auth, body="[1]")[0], 400)
        self.assertEqual(self.post("/status", {"nonce": "not-hex"})[0], 400)

    def test_request_size_is_bounded(self):
        big = json.dumps({"audioBase64": "A" * (service.MAX_BODY + 10)})
        self.assertEqual(self.post("/transcribe", headers=self.auth, body=big)[0], 400)
        self.assertEqual(self.post("/speak", {"text": "x" * (service.MAX_SPEAK + 1)}, self.auth)[0], 400)
        self.assertEqual(self.post("/coach", {"text": "x" * (claude_mcp.MAX_INPUT + 1)}, self.auth)[0], 400)
        self.assertEqual(self.post("/listen", {"waitS": 3600}, self.auth)[0], 400)

    # --- listening, quiet periods, cancelling ----------------------------------------------------------------------

    def test_a_quiet_period_reports_nothing_heard_without_calling_claude(self):
        with patch.object(service.audio, "listen", return_value=None), \
             patch.object(service.claude_mcp, "reply") as reply:
            code, result = self.post("/listen", {"waitS": 20}, self.auth)
        self.assertEqual((code, result), (200, {"heard": False, "text": ""}))
        reply.assert_not_called()

    def test_listen_transcribes_the_utterance(self):
        with patch.object(service.audio, "listen", return_value=b"\x00\x01" * 8000), \
             patch.object(service.stt, "transcribe", return_value={"text": "how far should I run"}):
            self.assertEqual(self.post("/listen", {}, self.auth), (200, {"heard": True, "text": "how far should I run"}))

    def test_cancel_stops_a_listen_and_frees_the_helper(self):
        def wait_for_cancel(cancel, **_):
            while not cancel.is_set():
                time.sleep(0.01)
            raise audio.Cancelled()

        with patch.object(service.audio, "listen", side_effect=wait_for_cancel):
            results = []
            t = threading.Thread(target=lambda: results.append(self.post("/listen", {}, self.auth)))
            t.start()
            time.sleep(0.2)
            self.assertEqual(self.post("/coach", {"text": "hi"}, self.auth)[0], 429)     # one job at a time
            self.assertEqual(self.post("/cancel", {}, self.auth), (200, {"cancelled": True}))
            t.join(5)
        self.assertEqual(results[0][0], 409)
        self.assertEqual(results[0][1]["code"], "cancelled")
        self.assertEqual(self.post("/cancel", {}, self.auth), (200, {"cancelled": False}))

    def test_a_blocked_or_missing_microphone_is_explained(self):
        for code in ("microphone_blocked", "no_microphone"):
            with patch.object(service.audio, "listen", side_effect=audio.MicrophoneError(code, "explained")):
                status, result = self.post("/listen", {}, self.auth)
            self.assertEqual((status, result["code"]), (409, code))

    def test_missing_model_files_say_how_to_set_them_up(self):
        with patch.object(service.stt, "available", return_value=False), \
             patch.object(service.audio, "listen") as heard:
            status, result = self.post("/listen", {}, self.auth)
            self.assertFalse(heard.called)                       # the microphone isn't opened for nothing
        self.assertEqual((status, result["code"]), (503, "missing_models"))
        self.assertIn("setup_voice_windows.sh", result["error"])
        with patch.object(service.tts, "available", return_value=False):
            status, result = self.post("/speak", {"text": "hi"}, self.auth)
        self.assertEqual((status, result["code"]), (503, "missing_models"))
        with patch.object(service.stt, "status", return_value={"available": False, "ready": False, "error": None}):
            status, result = self.post("/info", {}, self.auth)
        self.assertEqual(result["transcription"], {"installed": False, "ready": False, "error": None})

    def test_models_still_loading_say_so(self):
        with patch.object(service.audio, "listen", return_value=b"\x00\x01" * 8000), \
             patch.object(service.stt, "transcribe", side_effect=service.stt.NotReady("not set up")):
            status, result = self.post("/listen", {}, self.auth)
        self.assertEqual((status, result["code"]), (503, "loading"))

    def test_signed_out_claude_is_reported(self):
        with patch.object(service.claude_mcp, "reply",
                          side_effect=claude_mcp.ClaudeUnavailable("Claude Code is not signed in.")):
            status, result = self.post("/coach", {"text": "hello"}, self.auth)
        self.assertEqual((status, result), (503, {"error": "Claude Code is not signed in.", "code": "claude_unavailable"}))

    def test_a_signed_out_claude_code_is_never_started(self):
        signed_out = {"installed": True, "loggedIn": False, "account": None, "plan": None,
                      "error": "Claude Code is not signed in."}
        with patch.object(service.claude_mcp, "status", return_value=signed_out), \
             patch.object(service.claude_mcp, "reply") as reply:
            status, result = self.post("/coach", {"text": "hello"}, self.auth)
        self.assertFalse(reply.called)
        self.assertEqual((status, result["code"]), (503, "claude_unavailable"))

    def test_transcribe_checks_the_wav(self):
        with patch.object(service.stt, "transcribe", return_value={"text": "ok"}):
            self.assertEqual(self.post("/transcribe", {"audioBase64": wav()}, self.auth), (200, {"text": "ok"}))
            self.assertEqual(self.post("/transcribe", {"audioBase64": wav(rate=44100)}, self.auth)[0], 400)
            self.assertEqual(self.post("/transcribe", {"audioBase64": wav(channels=2)}, self.auth)[0], 400)
            self.assertEqual(self.post("/transcribe", {"audioBase64": wav(seconds=0.05)}, self.auth)[0], 400)
            self.assertEqual(self.post("/transcribe", {"audioBase64": "not base64!"}, self.auth)[0], 400)

    def test_speak_plays_kokoro_and_can_be_stopped(self):
        played = []

        def say(text, voice):
            yield {"pcm": base64.b64encode(b"\x00\x00" * 100).decode(), "rate": 24000}

        with patch.object(service.tts, "say", side_effect=say), \
             patch.object(service.audio, "play", side_effect=lambda chunks, cancel: played.extend(chunks) or True):
            self.assertEqual(self.post("/speak", {"text": "Nice work."}, self.auth), (200, {"spoken": True}))
        self.assertEqual(played, [(b"\x00\x00" * 100, 24000)])
        self.assertEqual(self.post("/speak", {"text": "hi", "voice": "../../etc"}, self.auth)[0], 400)


class TokenFileTest(unittest.TestCase):
    def test_token_replaces_a_stale_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "LocalState" / "local-voice.token"
            path.parent.mkdir()
            path.write_text("stale")
            service.write_token(path, "c" * 64)
            self.assertEqual(path.read_text(), "c" * 64)
            self.assertEqual([p.name for p in path.parent.iterdir()], ["local-voice.token"])


class PauseDetectionTest(unittest.TestCase):
    """audio.Utterance with a stand-in VAD: it reports speech, then a finished segment."""

    class FakeVad:
        def __init__(self, speech_from: int, segment_at: int):
            self.n, self.speech_from, self.segment_at, self.done = 0, speech_from, segment_at, False
            self.front = type("Segment", (), {})()
            self.front.samples = np.ones(1600, dtype=np.float32) * 0.1

        def accept_waveform(self, _):
            self.n += 1

        def is_speech_detected(self):
            return self.n >= self.speech_from

        def empty(self):
            return not (self.n >= self.segment_at and not self.done)

        def pop(self):
            self.done = True
            self.front.samples = np.zeros(0, dtype=np.float32)   # (as sherpa-onnx: `front` is a view, gone after pop)

        def flush(self):
            pass

    def window(self, level=0.01):
        return np.full(audio.WINDOW, level, dtype=np.float32)

    def test_an_utterance_ends_when_the_vad_closes_it(self):
        u = audio.Utterance(self.FakeVad(speech_from=5, segment_at=40), wait_s=20, max_s=15)
        results = [u.feed(self.window()) for _ in range(40)]
        self.assertTrue(all(r is None for r in results[:-1]))
        self.assertEqual(len(results[-1]), 1600 * 2)

    def test_quiet_gives_up_after_wait_s_only_without_speech(self):
        quiet = audio.Utterance(self.FakeVad(speech_from=10 ** 9, segment_at=10 ** 9), wait_s=3, max_s=15)
        for _ in range(int(3 * audio.RATE / audio.WINDOW) + 1):
            quiet.feed(self.window())
        self.assertTrue(quiet.gave_up())
        talking = audio.Utterance(self.FakeVad(speech_from=1, segment_at=10 ** 9), wait_s=3, max_s=15)
        for _ in range(int(3 * audio.RATE / audio.WINDOW) + 1):
            talking.feed(self.window())
        self.assertFalse(talking.gave_up())

    def test_a_blip_too_short_to_be_speech_does_not_hold_the_quiet_timer(self):
        class Blip(self.FakeVad):
            def is_speech_detected(self):
                return 5 <= self.n < 8                     # a click: speech for three windows, then dropped
        u = audio.Utterance(Blip(speech_from=0, segment_at=10 ** 9), wait_s=3, max_s=15)
        for _ in range(int(3 * audio.RATE / audio.WINDOW) + 1):
            u.feed(self.window())
        self.assertTrue(u.gave_up())
        self.assertFalse(u.too_long())

    def test_digital_silence_means_a_blocked_microphone(self):
        u = audio.Utterance(self.FakeVad(speech_from=10 ** 9, segment_at=10 ** 9), wait_s=20, max_s=15)
        for _ in range(int(audio.BLOCKED_AFTER_S * audio.RATE / audio.WINDOW) + 1):
            u.feed(np.zeros(audio.WINDOW, dtype=np.float32))
        self.assertTrue(audio.blocked(u.frames, u.nonzero))
        u.feed(self.window(0.001))
        self.assertFalse(audio.blocked(u.frames, u.nonzero))


class ClaudeTest(unittest.TestCase):
    def test_no_api_key_or_parent_session_variable_reaches_claude_code(self):
        env = {"ANTHROPIC_API_KEY": "sk-ant-x", "ANTHROPIC_AUTH_TOKEN": "t", "ANTHROPIC_BASE_URL": "http://x",
               "CLAUDE_CODE_USE_BEDROCK": "1", "CLAUDE_CODE_OAUTH_TOKEN": "o", "CLAUDECODE": "1",
               "CLAUDE_CONFIG_DIR": r"C:\Users\me\.claude", "PATH": "C:\\Windows", "anthropic_api_key": "lower"}
        with patch.dict(os.environ, env, clear=True):
            cleaned = claude_code.clean_env(r"C:\tools\claude.exe")
        self.assertEqual(sorted(cleaned), ["CLAUDE_CONFIG_DIR", "PATH"])
        self.assertTrue(cleaned["PATH"].startswith("C:\\tools"))

    def test_only_a_claude_ai_sign_in_counts(self):
        self.assertTrue(claude_code.signed_in({"loggedIn": True, "authMethod": "claude.ai"}))
        self.assertFalse(claude_code.signed_in({"loggedIn": True, "authMethod": "apiKey"}))
        self.assertFalse(claude_code.signed_in({"loggedIn": False, "authMethod": "claude.ai"}))

    def test_status_explains_each_case(self):
        claude_mcp._status = None
        with patch.object(claude_mcp.claude_code, "find_cli", return_value=None):
            self.assertEqual(claude_mcp.status(fresh=True)["error"], "Claude Code is not installed.")
        with patch.object(claude_mcp.claude_code, "find_cli", return_value="claude"), \
             patch.object(claude_mcp.claude_code, "auth_status", return_value={"loggedIn": False, "authMethod": "none"}):
            s = claude_mcp.status(fresh=True)
        self.assertEqual((s["loggedIn"], s["error"]), (False, "Claude Code is not signed in."))
        with patch.object(claude_mcp.claude_code, "find_cli", return_value="claude"), \
             patch.object(claude_mcp.claude_code, "auth_status",
                          return_value={"loggedIn": True, "authMethod": "claude.ai", "email": "you@example.com",
                                        "subscriptionType": "max"}):
            s = claude_mcp.status(fresh=True)
        self.assertEqual((s["loggedIn"], s["account"], s["plan"]), (True, "you@example.com", "max"))

    def test_the_reply_comes_only_from_a_successful_speak_reply_call(self):
        def event(*items):
            return json.dumps({"message": {"content": list(items)}})

        use = {"type": "tool_use", "name": claude_mcp.TOOL, "id": "t1", "input": {"text": "Try a short walk."}}
        ok = {"type": "tool_result", "tool_use_id": "t1", "is_error": False}
        self.assertEqual(claude_mcp.parse("\n".join([event(use), event(ok)])), "Try a short walk.")
        with self.assertRaises(claude_mcp.ClaudeUnavailable):
            claude_mcp.parse(event(use))                                         # never confirmed
        with self.assertRaises(claude_mcp.ClaudeUnavailable):
            claude_mcp.parse("\n".join([event({**use, "name": "mcp__other__tool"}), event(ok)]))
        with self.assertRaises(claude_mcp.ClaudeUnavailable):
            claude_mcp.parse(event({"type": "text", "text": "plain text is not an answer"}))

    def test_claude_code_runs_with_only_the_voice_tool(self):
        cmd = claude_mcp.command("claude", Path("mcp.json"))
        self.assertEqual(cmd[cmd.index("--tools") + 1], "")
        self.assertEqual(cmd[cmd.index("--allowedTools") + 1], claude_mcp.TOOL)
        for flag in ("--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--setting-sources") + 1], "")


def secrets_hex() -> str:
    return os.urandom(32).hex()


if __name__ == "__main__":
    unittest.main()
