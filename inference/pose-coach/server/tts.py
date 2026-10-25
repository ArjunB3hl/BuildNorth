"""The coach's local voice for the page: Kokoro-82M on the Mac's GPU (MLX), in a worker process (server/kokoro_worker.py)
started with the dev server when its venv exists (tools/setup_kokoro.sh), warmed up once, and kept (started again if it
stops, up to MAX_RESTARTS times in a row).

    available()           whether the venv is there
    status()              {"available", "ready", "error", "load_ms", "warm_ms"}
    say(text, voice, page, seq)
                          the cue's audio, one dict per sentence as it is made (see kokoro_worker.py). A cue of a page
                          (page: one id per page voice, seq: rising per page) ends that page's older cues, whose streams
                          end with {"superseded": true}; a cue whose seq is not above its page's latest gets only that
                          line. A cue without a page ends none: each is made in turn.
"""
from __future__ import annotations

import itertools
import json
import os
import subprocess
import threading
from pathlib import Path
from queue import Empty, Queue

HERE = Path(__file__).resolve().parent
PYTHON = Path(os.environ.get("POSE_KOKORO_PY", HERE.parent / ".venv-kokoro" / "bin" / "python"))
WORKER = HERE / "kokoro_worker.py"
LOG = HERE.parent / ".data" / "kokoro-worker.log"         # the worker's stderr, when .data/ is there
CHUNK_TIMEOUT_S = 20
MAX_RESTARTS = 3            # starts again in a row, with no sentence said between, before the worker is given up on
PAGES_KEPT = 100            # the pages whose latest seq is remembered (the most recent ones)

_lock = threading.RLock()                                   # (start() runs under it from _read)
_proc: subprocess.Popen | None = None
_state: dict = {"ready": False, "error": None}
_jobs: dict[int, tuple[Queue, str | None]] = {}             # the cues being made: their queue and page
_latest: dict[str, int] = {}                                # per page, the seq of its newest cue
_ids = itertools.count(1)
_ready = threading.Event()
_restarts = 0


def available() -> bool:
    return PYTHON.is_file()


def status() -> dict:
    return {"available": available(), **_state}


def _send(msg: dict) -> None:
    """One line to the worker (with _lock held); OSError if it is gone."""
    if _proc is None or _proc.stdin.closed:
        raise BrokenPipeError("the Kokoro worker is stopped")
    _proc.stdin.write(json.dumps(msg) + "\n")
    _proc.stdin.flush()


def _cancel(jid: int) -> None:
    """The worker drops what is left of a cue nobody waits for (with _lock held)."""
    try:
        _send({"cancel": jid})
    except OSError:
        pass                                                # a worker that stopped makes nothing anyway


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
                    _ready.set()
            continue
        if msg.get("pcm"):
            _restarts = 0                                   # it works: a later stop counts from zero
        job = _jobs.get(msg.get("id"))
        if job:
            job[0].put(msg)
    proc.wait()
    with _lock:
        for pipe in (proc.stdin, proc.stdout):
            try:
                pipe.close()
            except OSError:
                pass                                        # (what was left in stdin is for nobody)
        if proc is not _proc:
            return                                          # stopped, or replaced: the state is the new worker's
        _state.update(ready=False, error="the Kokoro worker stopped")
        _ready.set()
        for q, _ in _jobs.values():
            q.put({"error": _state["error"]})
        start()                                             # back before the next cue (under _lock: never after stop())


def start() -> None:
    """Start the worker in the background, or again if it stopped; it takes a few seconds to load and warm up."""
    global _proc, _restarts
    with _lock:
        if not available() or (_proc is not None and _proc.poll() is None):
            return
        if _proc is not None:                               # it stopped: a crash, a kill, out of memory
            for q, _ in _jobs.values():
                q.put({"error": "the Kokoro worker stopped"})
            if _restarts >= MAX_RESTARTS:
                _state.update(ready=False, error=f"the Kokoro worker stopped {_restarts + 1} times in a row "
                                                 f"(see {LOG.name}); restart the dev server")
                _ready.set()
                return
            _restarts += 1
        _ready.clear()
        _state.update(ready=False, error=None)
        with open(LOG, "a") if LOG.parent.is_dir() else open(os.devnull, "w") as log:
            _proc = subprocess.Popen([str(PYTHON), str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=log, text=True, bufsize=1)
        threading.Thread(target=_read, args=(_proc,), daemon=True).start()


def stop() -> None:
    global _proc
    with _lock:
        if _proc is not None:
            _proc.terminate()
            _proc = None
            _state.update(ready=False)


def _supersede(page: str, seq: int) -> None:
    """With _lock held: seq is now the page's newest cue, and its older cues end."""
    _latest.pop(page, None)
    _latest[page] = seq
    if len(_latest) > PAGES_KEPT:
        del _latest[next(iter(_latest))]
    for jid, (q, p) in list(_jobs.items()):
        if p == page:
            q.put({"superseded": True})
            del _jobs[jid]
            _cancel(jid)


def say(text: str, voice: str = "af_heart", page: str | None = None, seq: int | None = None):
    """The cue's audio, sentence by sentence (dicts with base64 PCM), until its last sentence, an error, or a newer cue
    of its page ({"superseded": true}). Closing it early drops the rest of the cue."""
    start()
    if not _ready.wait(timeout=60) or not _state["ready"]:
        yield {"error": _state.get("error") or "Kokoro is not ready"}
        return
    q: Queue = Queue()
    jid, ended = None, False                                # ended: the worker is done with it, or never had it
    try:
        with _lock:
            if page is None or page not in _latest or seq > _latest[page]:
                if page is not None:
                    _supersede(page, seq)
                jid = next(_ids)                            # (in the order they reach the worker)
                _jobs[jid] = (q, page)
                _send({"id": jid, "text": text, "voice": voice})
        if jid is None:
            yield {"superseded": True}                      # a newer cue of its page came first
            return
        while True:
            try:
                msg = q.get(timeout=CHUNK_TIMEOUT_S)
            except Empty:
                yield {"error": "Kokoro took too long"}
                return
            ended = bool(msg.get("superseded") or msg.get("error") or msg.get("last"))
            yield msg
            if ended:
                return
    except OSError:                                         # it stopped since the ready check
        ended = True
        yield {"error": "the Kokoro worker stopped"}
    finally:
        with _lock:
            if _jobs.pop(jid, None) is not None and not ended:
                _cancel(jid)                                # nobody listens any more, or it took too long
