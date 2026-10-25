"""Parakeet TDT 0.6B v3 on the Mac's GPU (MLX), as a worker process of the dev server (server/stt.py): what the user says
to the coach, transcribed on this Mac. Runs in Kokoro's venv (tools/setup_kokoro.sh, then tools/setup_stt.sh fetches the
model), loaded once and warmed up. The model comes from one pinned snapshot (REPO at REVISION) in the Hugging Face cache,
read offline: the worker never downloads it (tools/setup_stt.sh does).

stdin, one JSON per line:   {"id": n, "pcm": <base64 int16 LE, mono, 16000 Hz>}     an utterance, after the ones before it
stdout, one JSON per line:  {"ready": true, "load_ms": ..., "warm_ms": ...}         once, when loaded
                            {"id": n, "text": "...", "ms": ..., "seconds": ...}      per utterance (text "" for no words)
                            {"id": n, "error": "..."}
Utterances are short (the page cuts them at 15 s, the server takes 30 s at most) and take 0.1-0.2 s each, so they are
made in turn and never cancelled.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time

REPO = os.environ.get("POSE_STT_REPO", "mlx-community/parakeet-tdt-0.6b-v3")
REVISION = os.environ.get("POSE_STT_REVISION", "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15")
RATE = 16000                                                    # the model's own rate: the page sends it so


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def samples(pcm: bytes):
    """PCM16 little-endian -> float32 in [-1, 1), as the model reads audio."""
    import numpy as np
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def serve(transcribe) -> None:
    """The utterances on stdin, in turn, until it closes: transcribe(PCM16 LE bytes at 16 kHz) -> text, its spaces
    tidied."""
    for line in sys.stdin:
        try:
            job = json.loads(line)
        except json.JSONDecodeError:
            continue
        jid = job.get("id")
        try:
            pcm = base64.b64decode(job.get("pcm") or "")
            if not pcm or len(pcm) % 2:
                raise ValueError("PCM16 is an even number of bytes, not none")
            t = time.perf_counter()
            text = " ".join(str(transcribe(pcm)).split())
            emit({"id": jid, "text": text, "ms": round((time.perf_counter() - t) * 1000),
                  "seconds": round(len(pcm) / 2 / RATE, 2)})
        except Exception as e:  # noqa: BLE001 - reported to the page, which goes on listening
            emit({"id": jid, "error": f"{type(e).__name__}: {e}"})


def main() -> None:
    import mlx.core as mx
    import numpy as np
    from huggingface_hub import snapshot_download
    from mlx_audio.stt.utils import load_model

    t0 = time.perf_counter()
    # from the cache only (the server also starts it with HF_HUB_OFFLINE=1): a missing model is an error that names the
    # setup script, not a 2.5 GB download in the background of the dev server
    snapshot = snapshot_download(REPO, revision=REVISION, local_files_only=True)
    model = load_model(snapshot, model_type="parakeet")
    load_ms = (time.perf_counter() - t0) * 1000
    t1 = time.perf_counter()

    def transcribe(pcm: bytes) -> str:
        return model.generate(mx.array(samples(pcm))).text

    # compiles the GPU kernels: a second of quiet noise (silence alone could take a shorter path through the decoder)
    transcribe((np.random.default_rng(0).standard_normal(RATE) * 100).astype("<i2").tobytes())
    emit({"ready": True, "load_ms": round(load_ms), "warm_ms": round((time.perf_counter() - t1) * 1000)})
    serve(transcribe)


if __name__ == "__main__":
    main()
