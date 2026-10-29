"""The dev server's local transcription (server/stt.py) and its door (POST /api/stt, server/dev_server.py), without MLX:
the worker is the real job loop (stt_worker.serve) with a fake model, so what each request gets back, a worker that dies
started again (and one that keeps dying given up on), and the guards are the real ones: raw audio only, from this
machine's pages, at most 30 s; 503 while it is off, not set up or still loading, 504 for an utterance that took too
long; a model set up after the server started loaded when the page asks. And PCM16 read as the model reads it, in
Kokoro's venv when it is there.

    python3 tests/test_stt.py          (from inference/pose-coach; the standard library only)
"""
from __future__ import annotations

import http.client
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))
import dev_server  # noqa: E402
import stt  # noqa: E402

# a stand-in for stt_worker.main: no model, the same job loop. It "hears" how much audio it got; audio starting with
# the sample 0x7fff kills it, 0x7ffe makes the model fail, 0x7ffd holds it 0.6 s; a file "die-at-start" next to it
# makes it exit before it is ready, "slow-start" holds it that many seconds first; each start is counted in "starts".
FAKE = """
import os, sys, time
sys.path.insert(0, {server!r})
import stt_worker
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "starts"), "a") as f:
    f.write("x")
if os.path.exists(os.path.join(here, "die-at-start")):
    sys.exit(1)
if os.path.exists(os.path.join(here, "slow-start")):
    time.sleep(float(open(os.path.join(here, "slow-start")).read()))

def transcribe(pcm):
    if pcm[:2] == b"\\xff\\x7f":
        os._exit(3)
    if pcm[:2] == b"\\xfe\\x7f":
        raise ValueError("the model failed")
    if pcm[:2] == b"\\xfd\\x7f":
        time.sleep(0.6)
    return "  heard   " + str(len(pcm) // 2) + " samples "

stt_worker.emit({{"ready": True, "load_ms": 1, "warm_ms": 2}})
stt_worker.serve(transcribe)
"""
SECOND = b"\0\0" * stt.RATE                                     # one second of silence


def wait_for(cond, timeout=10.0):
    end = time.monotonic() + timeout
    while not cond():
        if time.monotonic() > end:
            raise AssertionError("timed out")
        time.sleep(0.01)


class FakeWorker(unittest.TestCase):
    """Each test with a fresh stt module, whose worker is FAKE and whose model is a file in a temporary cache."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pose-coach-stt-"))
        self.env = os.environ.get("HF_HUB_CACHE")
        os.environ["HF_HUB_CACHE"] = str(self.tmp / "hub")
        importlib.reload(stt)                                # a fresh state (dev_server sees the same module)
        stt.WINDOWS = False                                  # (these fake the Mac's model files, on any system)
        stt.PYTHON = Path(sys.executable)
        stt.WORKER = self.tmp / "worker.py"
        stt.LOG = self.tmp / "worker.log"
        stt.WORKER.write_text(FAKE.format(server=str(SERVER)))
        stt.snapshot().mkdir(parents=True)
        (stt.snapshot() / "model.safetensors").touch()

    def tearDown(self):
        stt.stop()
        if self.env is None:
            os.environ.pop("HF_HUB_CACHE", None)
        else:
            os.environ["HF_HUB_CACHE"] = self.env
        shutil.rmtree(self.tmp, ignore_errors=True)

    def starts(self) -> int:
        f = self.tmp / "starts"
        return len(f.read_text()) if f.exists() else 0

    def ready(self):
        stt.start()
        wait_for(lambda: stt.status()["ready"])


class Transcribe(FakeWorker):
    def test_an_utterance_comes_back_as_its_words_with_how_long_it_took_and_was(self):
        self.ready()
        self.assertEqual(stt.status(), {"available": True, "ready": True, "error": None, "load_ms": 1, "warm_ms": 2})
        got = stt.transcribe(SECOND * 2)
        self.assertEqual((got["text"], got["seconds"]), (f"heard {2 * stt.RATE} samples", 2.0))   # (spaces tidied)
        self.assertIsInstance(got["ms"], int)
        self.assertEqual(stt._jobs, {})

    def test_utterances_sent_together_each_get_their_own_words(self):
        self.ready()
        out: dict = {}
        threads = [threading.Thread(target=lambda n=n: out.__setitem__(n, stt.transcribe(b"\0\0" * n)["text"]))
                   for n in range(1, 9)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(10)
        self.assertEqual(out, {n: f"heard {n} samples" for n in range(1, 9)})
        self.assertEqual(stt._jobs, {})

    def test_not_set_up_or_still_loading_is_not_ready_and_starts_nothing_without_the_model(self):
        (stt.snapshot() / "model.safetensors").unlink()     # the venv is there, the model is not (setup_stt.sh not run)
        self.assertEqual(stt.status()["available"], False)
        with self.assertRaisesRegex(stt.NotReady, "not set up"):
            stt.transcribe(SECOND)
        self.assertEqual(self.starts(), 0)
        (stt.snapshot() / "model.safetensors").touch()
        (self.tmp / "slow-start").write_text("1.5")
        with self.assertRaisesRegex(stt.NotReady, "loading"):  # (answered at once, not after the load)
            stt.transcribe(SECOND)
        wait_for(lambda: stt.status()["ready"])
        self.assertEqual(stt.transcribe(SECOND)["seconds"], 1.0)

    def test_a_model_error_is_an_error_for_that_utterance_only(self):
        self.ready()
        with self.assertRaisesRegex(RuntimeError, "ValueError: the model failed"):
            stt.transcribe(b"\xfe\x7f" + SECOND)
        self.assertEqual(stt.transcribe(SECOND)["text"], f"heard {stt.RATE} samples")
        self.assertEqual(self.starts(), 1)

    def test_a_worker_that_dies_is_started_again_and_the_next_utterance_is_heard(self):
        self.ready()
        with self.assertRaisesRegex(stt.NotReady, "stopped"):
            stt.transcribe(b"\xff\x7f" + SECOND)
        wait_for(lambda: stt.status()["ready"])
        self.assertEqual(stt.transcribe(SECOND)["seconds"], 1.0)
        self.assertEqual(self.starts(), 2)
        self.assertEqual(stt._jobs, {})

    def test_an_utterance_that_takes_too_long_is_too_slow_and_the_worker_goes_on(self):
        self.ready()
        stt.TIMEOUT_S = 0.2
        with self.assertRaisesRegex(stt.TooSlow, "over 0.2 s"):         # (not NotReady: the page keeps listening)
            stt.transcribe(b"\xfd\x7f" + SECOND)
        self.assertEqual(stt._jobs, {})                                 # (its late words are for nobody)
        stt.TIMEOUT_S = 20
        self.assertEqual(stt.transcribe(SECOND)["seconds"], 1.0)        # (it waited behind the slow one)
        self.assertEqual((stt.status()["ready"], self.starts()), (True, 1))

    def test_a_model_set_up_after_the_server_started_is_loaded_when_the_page_asks(self):
        (stt.snapshot() / "model.safetensors").unlink()
        stt.start()                                                     # (the server's start: nothing to load)
        self.assertEqual(stt.status(), {"available": False, "ready": False, "error": None})
        (stt.snapshot() / "model.safetensors").touch()                  # tools/setup_stt.sh, while the server runs
        wait_for(lambda: stt.status()["ready"])                         # (the page asks every second while it loads)
        self.assertEqual(self.starts(), 1)
        self.assertEqual(stt.transcribe(SECOND)["seconds"], 1.0)

    def test_turned_off_it_is_not_available_and_starts_nothing(self):
        was = os.environ.get("POSE_STT")
        os.environ["POSE_STT"] = "0"
        try:
            importlib.reload(stt)
        finally:
            os.environ.pop("POSE_STT")
            if was is not None:
                os.environ["POSE_STT"] = was
        stt.PYTHON, stt.WORKER = Path(sys.executable), self.tmp / "worker.py"     # (the model is there)
        self.assertTrue(stt.OFF)
        stt.start()
        self.assertEqual(stt.status(), {"available": False, "ready": False,
                                        "error": "turned off on this server (POSE_STT=0)"})
        with self.assertRaisesRegex(stt.NotReady, r"turned off on this server \(POSE_STT=0\)"):
            stt.transcribe(SECOND)
        time.sleep(0.2)
        self.assertEqual(self.starts(), 0)

    def test_a_worker_that_keeps_dying_is_given_up_on(self):
        (self.tmp / "die-at-start").touch()
        stt.start()
        wait_for(lambda: "restart the dev server" in (stt.status()["error"] or ""))
        self.assertEqual(self.starts(), 1 + stt.MAX_RESTARTS)
        with self.assertRaisesRegex(stt.NotReady, "restart the dev server"):
            stt.transcribe(SECOND)
        self.assertEqual(self.starts(), 1 + stt.MAX_RESTARTS)

    def test_the_cache_is_found_where_huggingface_hub_looks(self):
        env = {k: os.environ.pop(k, None) for k in ("HF_HUB_CACHE", "HF_HOME", "XDG_CACHE_HOME")}
        try:
            self.assertEqual(stt.hub_cache(), Path.home() / ".cache" / "huggingface" / "hub")
            os.environ["XDG_CACHE_HOME"] = "/x"
            self.assertEqual(stt.hub_cache(), Path("/x/huggingface/hub"))
            os.environ["HF_HOME"] = "/h"
            self.assertEqual(stt.hub_cache(), Path("/h/hub"))
            os.environ["HF_HUB_CACHE"] = "/c"
            self.assertEqual(stt.snapshot(), Path("/c/models--mlx-community--parakeet-tdt-0.6b-v3/snapshots")
                             / stt.REVISION)
        finally:
            for k, v in env.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v

    def test_the_worker_reads_its_pinned_model_offline_and_the_server_agrees_on_it(self):
        src = (SERVER / "stt_worker.py").read_text()
        self.assertIn(f'"{stt.REPO}"', src)
        self.assertIn(f'"{stt.REVISION}"', src)
        self.assertIn("local_files_only=True", src)
        self.ready()
        self.assertEqual(stt._proc.args[1], str(stt.WORKER))


class Pcm(unittest.TestCase):
    PY = SERVER.parent / ".venv-kokoro" / "bin" / "python"

    @unittest.skipUnless(PY.is_file(), "Kokoro's venv is not there (tools/setup_kokoro.sh)")
    def test_pcm16_little_endian_is_read_as_floats_in_minus_one_to_one(self):
        out = subprocess.run([str(self.PY), "-c", "import stt_worker; print(stt_worker.samples("
                              "bytes([0, 0, 0, 0x80, 0xff, 0x7f, 0x00, 0x40, 0xff, 0xff])).tolist())"],
                             cwd=SERVER, capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), [0.0, -1.0, 32767 / 32768, 0.5, -1 / 32768])


class Server(FakeWorker):
    """POST /api/stt and GET /api/stt/status on the dev server in this process, on a free port."""

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

    def post(self, body: bytes | None, headers=None, host="127.0.0.1:{port}") -> tuple[int, dict]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        c.putrequest("POST", "/api/stt", skip_host=True)
        c.putheader("Host", host.format(port=self.port))
        h = {"Content-Type": "application/octet-stream", **(headers or {})}
        for k, v in h.items():
            if v is not None:
                c.putheader(k, v.format(port=self.port))
        c.putheader("Content-Length", str(len(body or b"")))
        c.endheaders(body)
        r = c.getresponse()
        data = r.read().decode()
        c.close()
        try:
            return r.status, json.loads(data)
        except json.JSONDecodeError:
            return r.status, {"body": data}

    def status(self) -> dict:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        c.request("GET", "/api/stt/status")
        r = c.getresponse()
        data = json.loads(r.read())
        c.close()
        return data

    def test_an_utterance_is_transcribed_for_this_machines_pages(self):
        self.ready()
        self.assertEqual(self.status()["ready"], True)
        for origin in (None, "http://localhost:{port}", "http://127.0.0.1:8792", "http://[::1]:{port}"):
            status, got = self.post(SECOND * 3, {"Origin": origin})
            self.assertEqual(status, 200, origin)
            self.assertEqual((got["text"], got["seconds"]), (f"heard {3 * stt.RATE} samples", 3.0))
            self.assertEqual(sorted(got), ["ms", "seconds", "text"])
        # 30 s exactly is taken
        status, got = self.post(SECOND * stt.MAX_SECONDS)
        self.assertEqual((status, got["seconds"]), (200, 30.0))

    def test_raw_audio_only_from_this_machines_pages_and_never_empty_odd_or_over_30_s(self):
        self.ready()
        for headers, body, code in (
                ({"Content-Type": "text/plain"}, SECOND, 415),            # what a page elsewhere can send unasked
                ({"Content-Type": "application/x-www-form-urlencoded"}, SECOND, 415),
                ({"Content-Type": "application/json"}, SECOND, 415),
                ({"Content-Type": None}, SECOND, 415),
                ({"Content-Type": "audio/wav"}, SECOND, 415),
                ({"Origin": "http://evil.example"}, SECOND, 403),
                ({"Origin": "null"}, SECOND, 403),
                ({"Origin": "https://localhost:{port}"}, SECOND, 403),
                ({}, b"", 400),                                          # empty
                ({}, SECOND + b"\0", 400),                               # not PCM16
                ({}, SECOND * stt.MAX_SECONDS + b"\0\0", 400)):          # a sample over 30 s
            status, got = self.post(body, headers)
            self.assertEqual(status, code, (headers, len(body)))
            self.assertIn("error", got)
        self.assertIn("at most 30 s", self.post(SECOND * 31)[1]["error"])
        self.assertEqual(self.starts(), 1)                             # (none of them reached the model)
        self.assertEqual(stt._jobs, {})

    def test_addressed_to_another_host_it_is_turned_away(self):
        self.assertEqual(self.post(SECOND, host="evil.example:{port}")[0], 421)

    def test_not_set_up_or_not_ready_is_503_and_says_why(self):
        (stt.snapshot() / "model.safetensors").unlink()
        self.assertEqual(self.status(), {"available": False, "ready": False, "error": None})
        status, got = self.post(SECOND)
        self.assertEqual((status, got["error"]), (503, "Parakeet is not set up (bash tools/setup_stt.sh)"))
        (stt.snapshot() / "model.safetensors").touch()
        (self.tmp / "slow-start").write_text("1.5")
        status, got = self.post(SECOND)
        self.assertEqual((status, got["error"]), (503, "Parakeet is loading"))
        wait_for(lambda: self.status()["ready"])
        self.assertEqual(self.post(SECOND)[0], 200)

    def test_an_utterance_that_took_too_long_is_504_and_the_next_is_heard(self):
        self.ready()
        stt.TIMEOUT_S = 0.2
        status, got = self.post(b"\xfd\x7f" + SECOND)
        self.assertEqual((status, got["error"]), (504, "Parakeet took over 0.2 s for this utterance"))
        stt.TIMEOUT_S = 20
        self.assertEqual(self.status()["ready"], True)                 # (the page reads only a 503 as not ready)
        self.assertEqual(self.post(SECOND)[0], 200)

    def test_turned_off_it_is_503_and_says_so(self):
        stt.OFF = True
        self.assertEqual(self.status()["error"], "turned off on this server (POSE_STT=0)")
        self.assertEqual(self.post(SECOND), (503, {"error": "Parakeet is turned off on this server (POSE_STT=0)"}))
        self.assertEqual(self.starts(), 0)

    def test_a_model_error_is_500_and_the_next_utterance_is_heard(self):
        self.ready()
        status, got = self.post(b"\xfe\x7f" + SECOND)
        self.assertEqual((status, got["error"]), (500, "ValueError: the model failed"))
        self.assertEqual(self.post(SECOND)[0], 200)


if __name__ == "__main__":
    unittest.main()
