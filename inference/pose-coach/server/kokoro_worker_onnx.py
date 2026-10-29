"""Kokoro-82M v1.0 on the CPU (sherpa-onnx, int8), as a worker process of server/tts.py on Windows: the counterpart of
kokoro_worker.py, which needs MLX on Apple Silicon. Same protocol and the same serve loop (see kokoro_worker.py): cues
made sentence by sentence, cancellable, {"ready"} once loaded and warmed up. Voices by the same names (af_heart, ...).
The model is read from .data/sherpa (tools/setup_voice_windows.sh); nothing is downloaded.
"""
from __future__ import annotations

import time

import onnx_speech
from kokoro_worker import emit, serve


def main() -> None:
    if not onnx_speech.kokoro_ready():
        emit({"error": "Kokoro is not set up (bash tools/setup_voice_windows.sh)"})
        return
    t0 = time.perf_counter()
    make = onnx_speech.speaker()
    load_ms = (time.perf_counter() - t0) * 1000
    t1 = time.perf_counter()
    make("Ready when you are.", "af_heart")
    emit({"ready": True, "load_ms": round(load_ms), "warm_ms": round((time.perf_counter() - t1) * 1000)})
    serve(make, set(onnx_speech.VOICES))


if __name__ == "__main__":
    main()
