"""What the user says to the coach, transcribed on this Mac: Parakeet TDT 0.6B v3 on the Mac's GPU (MLX), in a worker
process (server/stt_worker.py) started with the dev server when Kokoro's venv and the model are there
(tools/setup_stt.sh), warmed up once, and kept (started again if it stops, up to MAX_RESTARTS times in a row), as the
voice is (server/tts.py). The audio never leaves the machine; the page sends the coach the words only. POSE_STT=0 turns
it off on a server that needs no listening (each dev server loads its own: 2.5 GB on disk, about 0.9 GB in memory).

    available()           whether it is on, and the venv and the pinned model snapshot are there
    status()              {"available", "ready", "error"}, plus "load_ms" and "warm_ms" once ready; starts the worker
                          if the model was set up after the server started
    transcribe(pcm)       PCM16 little-endian mono at 16 kHz -> {"text", "ms", "seconds"}; NotReady when it is not set
                          up, not loaded yet or stopped, TooSlow when this utterance took over TIMEOUT_S, RuntimeError
                          when the model failed on this audio
"""
from __future__ import annotations

import base64
import itertools
import json
import os
import subprocess
import threading
from pathlib import Path
from queue import Empty, Queue

HERE = Path(__file__).resolve().parent
# Kokoro's venv: mlx-audio has both models, and one venv is one set of pinned packages to keep
PYTHON = Path(os.environ.get("POSE_STT_PY") or os.environ.get("POSE_KOKORO_PY")
              or HERE.parent / ".venv-kokoro" / "bin" / "python")
WORKER = HERE / "stt_worker.py"
LOG = HERE.parent / ".data" / "stt-worker.log"            # the worker's stderr, when .data/ is there
REPO = os.environ.get("POSE_STT_REPO", "mlx-community/parakeet-tdt-0.6b-v3")
REVISION = os.environ.get("POSE_STT_REVISION", "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15")   # (as stt_worker.py)
OFF = os.environ.get("POSE_STT", "").strip().lower() in ("0", "off", "no", "false")
RATE = 16000
MAX_SECONDS = 30            # the longest utterance taken (the page cuts its own at 15 s)
MAX_BYTES = MAX_SECONDS * RATE * 2
TIMEOUT_S = 20              # for one utterance (measured: 0.1-0.2 s for 1.5-3.7 s of speech, 13.7 s once under load)
MAX_RESTARTS = 3            # starts again in a row, with no utterance transcribed between, before it is given up on

_lock = threading.RLock()                                   # (start() runs under it from _read)
_proc: subprocess.Popen | None = None
_state: dict = {"ready": False, "error": None}
_jobs: dict[int, Queue] = {}                                # the utterances being transcribed
_ids = itertools.count(1)
_restarts = 0


class NotReady(Exception):
    """Off, not set up, still loading, or stopped (the page keeps its taps; /api/stt answers 503)."""


class TooSlow(Exception):
    """This utterance took over TIMEOUT_S (the GPU busy elsewhere, say), the worker still being up: /api/stt answers 504,
    and the page logs it and goes on listening (a 503 would close its microphone until the status says ready)."""


def hub_cache() -> Path:
    """The Hugging Face cache, where huggingface_hub looks for it (HF_HUB_CACHE, else HF_HOME/hub, else
    XDG_CACHE_HOME/huggingface/hub, else $HOME/.cache/huggingface/hub)."""
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"]).expanduser()
    home = os.environ.get("HF_HOME") or Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "huggingface"
    return Path(home).expanduser() / "hub"


def snapshot() -> Path:
    return hub_cache() / f"models--{REPO.replace('/', '--')}" / "snapshots" / REVISION


def available() -> bool:
    # (the worker reads the model from the cache only: without it, it would only fail at every start)
    return not OFF and PYTHON.is_file() and (snapshot() / "model.safetensors").exists()


def status() -> dict:
    if OFF:
        return {"available": False, "ready": False, "error": "turned off on this server (POSE_STT=0)"}
    # a model set up after the server started (tools/setup_stt.sh while it ran) is loaded now: the page asks this before
    # it listens, and sends no utterance until it says ready, so nothing else would start it
    if _proc is None and available():
        start()
    return {"available": available(), **_state}


def _send(msg: dict) -> None:
    """One line to the worker (with _lock held); OSError if it is gone."""
    if _proc is None or _proc.stdin.closed:
        raise BrokenPipeError("the Parakeet worker is stopped")
    _proc.stdin.write(json.dumps(msg) + "\n")
    _proc.stdin.flush()


def _read(proc: subprocess.Popen) -> None:
    global _restarts
    for line in proc.stdout:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("ready"):
            with _lock:
                if proc is _proc:
                    _state.update(ready=True, error=None, load_ms=msg.get("load_ms"), warm_ms=msg.get("warm_ms"))
            continue
        if "text" in msg:
            _restarts = 0                                   # it works: a later stop counts from zero
        q = _jobs.get(msg.get("id"))
        if q:
            q.put(msg)
    proc.wait()
    with _lock:
        for pipe in (proc.stdin, proc.stdout):
            try:
                pipe.close()
            except OSError:
                pass                                        # (what was left in stdin is for nobody)
        if proc is not _proc:
            return                                          # stopped, or replaced: the state is the new worker's
        _state.update(ready=False, error="the Parakeet worker stopped")
        for q in _jobs.values():
            q.put({"stopped": True})
        start()                                             # back for the next utterance (under _lock: never after stop())


def start() -> None:
    """Start the worker in the background, or again if it stopped; it takes several seconds to load and warm up."""
    global _proc, _restarts
    with _lock:
        if not available() or (_proc is not None and _proc.poll() is None):
            return
        if _proc is not None:                               # it stopped: a crash, a kill, out of memory
            if _restarts >= MAX_RESTARTS:
                _state.update(ready=False, error=f"the Parakeet worker stopped {_restarts + 1} times in a row "
                                                 f"(see {LOG.name}); restart the dev server")
                return
            _restarts += 1
        _state.update(ready=False, error=None)
        # offline: the model is read from the cache, never fetched (tools/setup_stt.sh fetches it)
        env = {**os.environ, "HF_HUB_OFFLINE": "1"}
        with open(LOG, "a") if LOG.parent.is_dir() else open(os.devnull, "w") as log:
            _proc = subprocess.Popen([str(PYTHON), str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=log, text=True, bufsize=1, env=env)
        threading.Thread(target=_read, args=(_proc,), daemon=True).start()


def stop() -> None:
    global _proc
    with _lock:
        if _proc is not None:
            _proc.terminate()
            _proc = None
            _state.update(ready=False)


def transcribe(pcm: bytes) -> dict:
    """The words in an utterance (PCM16 LE, mono, 16 kHz, at most MAX_BYTES): {"text", "ms", "seconds"}, "ms" being
    the model's time. Utterances are transcribed in turn. NotReady: off, not set up, loading or stopped; TooSlow: this
    one took over TIMEOUT_S (its words, should they come, are for nobody; the next utterance waits behind it)."""
    if OFF:
        raise NotReady("Parakeet is turned off on this server (POSE_STT=0)")
    if not available():
        raise NotReady("Parakeet is not set up (bash tools/setup_stt.sh)")
    start()
    if not _state["ready"]:
        raise NotReady(_state.get("error") or "Parakeet is loading")
    q: Queue = Queue()
    with _lock:
        jid = next(_ids)
        _jobs[jid] = q
        try:
            _send({"id": jid, "pcm": base64.b64encode(pcm).decode()})
        except OSError:                                     # it stopped since the ready check
            _jobs.pop(jid, None)
            raise NotReady("the Parakeet worker stopped") from None
    try:
        msg = q.get(timeout=TIMEOUT_S)
    except Empty:
        raise TooSlow(f"Parakeet took over {TIMEOUT_S} s for this utterance") from None
    finally:
        with _lock:
            _jobs.pop(jid, None)
    if msg.get("stopped"):
        raise NotReady("the Parakeet worker stopped")
    if "error" in msg:
        raise RuntimeError(msg["error"])
    return {"text": msg["text"], "ms": msg.get("ms"), "seconds": msg.get("seconds")}
