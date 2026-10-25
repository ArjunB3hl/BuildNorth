"""Kokoro-82M on the Mac's GPU (MLX), as a worker process of the dev server (server/tts.py): the coach's local voice.
Runs in its own venv (tools/setup_kokoro.sh: mlx-audio, mlx, misaki), loaded once and warmed up. The model and its
voices come from one pinned snapshot (REPO at REVISION).

stdin, one JSON per line:   {"id": n, "text": "...", "voice": "af_heart"}    a cue, made after the ones before it
                            {"cancel": n}                                    drop what is left of cue n
stdout, one JSON per line:  {"ready": true, "load_ms": ..., "warm_ms": ...}                     once, when loaded
                            {"id": n, "i": 0, "last": false, "rate": 24000, "pcm": <base64 int16 LE>,
                             "synth_ms": ..., "text": "..."}                                       per sentence
                            {"id": n, "error": "..."}                       (also for a voice not in the snapshot, or
                                                                             a cue with nothing to say)
A cue is made sentence by sentence (web/js/speech-text.js's split), so its first sentence is heard while the next is
made. Cues are made in turn (ids rising); the server cancels one that a newer cue of its page replaced, or that nobody
listens to any more, and its sentences not made yet are dropped.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from queue import Queue

REPO = os.environ.get("POSE_KOKORO_REPO", "mlx-community/Kokoro-82M-bf16")
REVISION = os.environ.get("POSE_KOKORO_REVISION", "a71e4d38b236d968966a2002c4c895dbd12b1c3c")   # 2025-12-02
SHORT_FIRST = 25
MIN_CLAUSE = 12
SENTENCE = re.compile(r'[\s\S]+?(?:[.!?]+["\')\]]*(?=\s+[^a-z\s]|\s*$)|$)')


def sentences(text: str) -> list[str]:
    """As web/js/speech-text.js: by sentence (not at the '.' of "1.5" or of "e.g. like"), pieces with no letter or digit
    dropped, a first sentence under 25 characters merged with the next, then the first chunk cut at its first comma,
    semicolon or colon if that leaves at least 12 characters on each side."""
    parts = [s.strip() for s in SENTENCE.findall(text) if re.search(r"[^\W_]", s)]
    if len(parts) > 1 and len(parts[0]) < SHORT_FIRST:
        parts[0:2] = [f"{parts[0]} {parts[1]}"]
    m = re.search(r"[,;:]\s", parts[0]) if parts else None
    if m and m.start() >= MIN_CLAUSE and len(parts[0]) - m.end() >= MIN_CLAUSE:
        parts[0:1] = [parts[0][:m.start() + 1].strip(), parts[0][m.end():].strip()]
    return parts


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def serve(make, voices) -> None:
    """The cues on stdin, in turn, until it closes: make(text, voice) -> (int16 LE PCM bytes, sample rate) for a voice
    in voices."""
    cancelled: set[int] = set()
    guard = threading.Lock()
    jobs: Queue = Queue()

    def reader() -> None:
        for line in sys.stdin:
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "cancel" in msg:
                with guard:
                    cancelled.add(msg["cancel"])
            else:
                jobs.put(msg)
        jobs.put(None)

    threading.Thread(target=reader, daemon=True).start()
    while (job := jobs.get()) is not None:
        jid, voice = job.get("id"), job.get("voice") or "af_heart"
        try:
            if voice not in voices:
                raise LookupError(f"no Kokoro voice {voice} in {REPO}")
            parts = sentences(str(job.get("text", ""))[:600])
            if not parts:
                raise ValueError("nothing to say (no letter or digit)")
            for i, part in enumerate(parts):
                if jid in cancelled:
                    break                                       # a newer cue replaced it, or nobody listens
                t = time.perf_counter()
                pcm, rate = make(part, voice)
                emit({"id": jid, "i": i, "last": i == len(parts) - 1, "rate": rate, "text": part,
                      "synth_ms": round((time.perf_counter() - t) * 1000), "pcm": base64.b64encode(pcm).decode()})
        except Exception as e:  # noqa: BLE001 - reported to the page, which falls back to the Mac's voice
            emit({"id": jid, "error": f"{type(e).__name__}: {e}"})
        finally:
            with guard:                                         # cues come in order: a cancel up to this one is spent
                cancelled.difference_update([c for c in cancelled if c <= jid])


def main() -> None:
    import numpy as np
    from huggingface_hub import snapshot_download
    from mlx_audio.tts.utils import load_model

    t0 = time.perf_counter()
    snapshot = snapshot_download(REPO, revision=REVISION)
    model = load_model(snapshot, model_type="kokoro")
    # the voices by path, from the same snapshot: given a bare name, mlx-audio would look it up in another repo
    # (prince-canuma/Kokoro-82M) at its latest revision, and download it from there if it is not cached
    voices = {p.stem: str(p) for p in Path(snapshot, "voices").glob("*.safetensors")}
    load_ms = (time.perf_counter() - t0) * 1000
    t1 = time.perf_counter()

    def make(text: str, voice: str) -> tuple[bytes, int]:
        audio = np.concatenate([np.asarray(r.audio, dtype=np.float32).reshape(-1)
                                for r in model.generate(text=text, voice=voices[voice], speed=1.0, lang_code=voice[0])])
        return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes(), model.sample_rate

    make("Ready when you are.", "af_heart")                     # loads the G2P and compiles the GPU kernels
    emit({"ready": True, "load_ms": round(load_ms), "warm_ms": round((time.perf_counter() - t1) * 1000)})
    serve(make, voices)


if __name__ == "__main__":
    main()
