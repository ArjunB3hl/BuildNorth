"""Parakeet TDT 0.6B v3 on the CPU (sherpa-onnx, int8), as a worker process of server/stt.py on Windows: the counterpart of
stt_worker.py, which needs MLX on Apple Silicon. Same protocol (see stt_worker.py), same serve loop: one JSON per line on
stdin ({"id", "pcm"}), {"ready"} once loaded and warmed up, then {"id", "text", "ms", "seconds"} or {"id", "error"}.
The model is read from .data/sherpa (tools/setup_voice_windows.sh); nothing is downloaded.
"""
from __future__ import annotations

import time

import onnx_speech
from stt_worker import RATE, emit, serve


def main() -> None:
    import numpy as np

    if not onnx_speech.parakeet_ready():
        emit({"error": "Parakeet is not set up (bash tools/setup_voice_windows.sh)"})
        return
    t0 = time.perf_counter()
    transcribe = onnx_speech.transcriber()
    load_ms = (time.perf_counter() - t0) * 1000
    t1 = time.perf_counter()
    transcribe((np.random.default_rng(0).standard_normal(RATE) * 100).astype("<i2").tobytes())
    emit({"ready": True, "load_ms": round(load_ms), "warm_ms": round((time.perf_counter() - t1) * 1000)})
    serve(transcribe)


if __name__ == "__main__":
    main()
