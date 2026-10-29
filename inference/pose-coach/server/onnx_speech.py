"""Parakeet, Kokoro and Silero VAD on the CPU with sherpa-onnx: the Windows counterpart of the MLX workers (Apple Silicon
only). ONNX models from tools/setup_voice_windows.sh in .data/sherpa (POSE_SHERPA_DIR to move them), read from disk
only: nothing is downloaded here.

    parakeet_ready(), kokoro_ready(), vad_ready()     whether the model files are there (no model is loaded)
    transcriber()      -> transcribe(pcm16 bytes at 16 kHz) -> text            (Parakeet TDT 0.6B v3)
    speaker()          -> make(text, voice) -> (pcm16 bytes, sample rate)      (Kokoro-82M v1.0, voices as on the Mac)
    vad()              a Silero voice-activity detector at 16 kHz, for pause detection
    VOICES             Kokoro voice name -> speaker id in the v1.0 model

python server/onnx_speech.py --self-test    Kokoro says a phrase, Parakeet must hear it (timings on stdout, as JSON)
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS = Path(os.environ.get("POSE_SHERPA_DIR") or HERE.parent / ".data" / "sherpa")
PARAKEET = MODELS / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
# full precision (the setup's default: three times faster than int8 on CPUs without VNNI), else int8 (KOKORO_INT8=1)
KOKORO = next((d for d in (MODELS / "kokoro-multi-lang-v1_0", MODELS / "kokoro-int8-multi-lang-v1_0") if d.is_dir()),
              MODELS / "kokoro-multi-lang-v1_0")
SILERO = MODELS / "silero_vad.int8.onnx"
RATE = 16000
# Half the logical processors (4 of 8 here) keeps the machine usable while a model runs; POSE_SHERPA_THREADS overrides.
THREADS = int(os.environ.get("POSE_SHERPA_THREADS") or max(1, min(4, (os.cpu_count() or 2) // 2)))

# Kokoro v1.0's English voices in the model's speaker order (sherpa-onnx's kokoro-multi-lang-v1_0 table): the 28 voices
# the camera page and the Mac use by name (af_heart by default).
VOICES = {name: sid for sid, name in enumerate(
    "af_alloy af_aoede af_bella af_heart af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky "
    "am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa "
    "bf_alice bf_emma bf_isabella bf_lily bm_daniel bm_fable bm_george bm_lewis".split())}


def _parakeet_files() -> dict[str, Path]:
    return {"encoder": PARAKEET / "encoder.int8.onnx", "decoder": PARAKEET / "decoder.int8.onnx",
            "joiner": PARAKEET / "joiner.int8.onnx", "tokens": PARAKEET / "tokens.txt"}


def _kokoro_model() -> Path:
    for name in ("model.int8.onnx", "model.onnx"):
        if (KOKORO / name).is_file():
            return KOKORO / name
    return KOKORO / "model.int8.onnx"


def parakeet_ready() -> bool:
    return all(p.is_file() for p in _parakeet_files().values())


def kokoro_ready() -> bool:
    return (_kokoro_model().is_file() and (KOKORO / "voices.bin").is_file() and (KOKORO / "tokens.txt").is_file()
            and (KOKORO / "lexicon-us-en.txt").is_file())


def vad_ready() -> bool:
    return SILERO.is_file()


def samples(pcm: bytes):
    """PCM16 little-endian -> float32 in [-1, 1)."""
    import numpy as np
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def to_pcm16(audio) -> bytes:
    import numpy as np
    return (np.clip(np.asarray(audio, dtype=np.float32), -1, 1) * 32767).astype("<i2").tobytes()


def transcriber():
    import sherpa_onnx
    f = _parakeet_files()
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(f["encoder"]), decoder=str(f["decoder"]), joiner=str(f["joiner"]), tokens=str(f["tokens"]),
        num_threads=THREADS, sample_rate=RATE, feature_dim=80, decoding_method="greedy_search",
        model_type="nemo_transducer")

    def transcribe(pcm: bytes) -> str:
        stream = recognizer.create_stream()
        stream.accept_waveform(RATE, samples(pcm))
        recognizer.decode_stream(stream)
        return " ".join(stream.result.text.split())

    return transcribe


def speaker():
    import sherpa_onnx
    # (sherpa-onnx 2.x reads pronunciations from the lexicons only: it ignores the archive's espeak-ng-data)
    lexicons = ",".join(str(p) for p in (KOKORO / "lexicon-us-en.txt", KOKORO / "lexicon-zh.txt") if p.is_file())
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(_kokoro_model()), voices=str(KOKORO / "voices.bin"), tokens=str(KOKORO / "tokens.txt"),
                lexicon=lexicons),
            num_threads=THREADS, provider="cpu"),
        max_num_sentences=1)
    if not config.validate():
        raise RuntimeError(f"the Kokoro model in {KOKORO} is incomplete")
    tts = sherpa_onnx.OfflineTts(config)

    def make(text: str, voice: str = "af_heart") -> tuple[bytes, int]:
        if voice not in VOICES:
            raise LookupError(f"no Kokoro voice {voice}")
        audio = tts.generate(text, sid=VOICES[voice], speed=1.0)
        if not len(audio.samples):
            raise RuntimeError("Kokoro made no audio for this text")
        return to_pcm16(audio.samples), audio.sample_rate

    return make


def vad(min_silence_s: float = 0.85, min_speech_s: float = 0.25, max_speech_s: float = 15.0):
    """Silero VAD on 16 kHz float32 audio fed in windows of `vad.config.silero_vad.window_size` samples (512)."""
    import sherpa_onnx
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(SILERO)
    config.silero_vad.threshold = 0.5
    config.silero_vad.min_silence_duration = min_silence_s
    config.silero_vad.min_speech_duration = min_speech_s
    config.silero_vad.max_speech_duration = max_speech_s
    config.sample_rate = RATE
    config.num_threads = 1
    return sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=max_speech_s + 5)


def resample(pcm: bytes, rate: int, to: int = RATE) -> bytes:
    """Linear resampling (enough for a smoke test, and for Kokoro's 24 kHz speech into Parakeet's 16 kHz)."""
    import numpy as np
    x = samples(pcm)
    n = int(len(x) * to / rate)
    return to_pcm16(np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x))


def self_test() -> dict:
    t = time.perf_counter()
    make = speaker()
    tts_load = time.perf_counter() - t
    t = time.perf_counter()
    pcm, rate = make("Switch to lunges now.", "af_heart")
    tts_ms = (time.perf_counter() - t) * 1000
    t = time.perf_counter()
    transcribe = transcriber()
    stt_load = time.perf_counter() - t
    t = time.perf_counter()
    text = transcribe(resample(pcm, rate))
    stt_ms = (time.perf_counter() - t) * 1000
    result = {"heard": text, "ok": "lunge" in text.lower(), "threads": THREADS,
              "kokoro_load_s": round(tts_load, 1), "kokoro_ms": round(tts_ms), "audio_s": round(len(pcm) / 2 / rate, 2),
              "parakeet_load_s": round(stt_load, 1), "parakeet_ms": round(stt_ms)}
    if vad_ready():
        detector = vad()
        result["vad_window"] = detector.config.silero_vad.window_size
    return result


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        missing = [n for n, ok in (("Parakeet", parakeet_ready()), ("Kokoro", kokoro_ready()), ("Silero VAD", vad_ready()))
                   if not ok]
        if missing:
            sys.exit(f"missing models: {', '.join(missing)} (bash tools/setup_voice_windows.sh)")
        out = self_test()
        print(json.dumps(out))
        sys.exit(0 if out["ok"] else 1)
    sys.exit("usage: python server/onnx_speech.py --self-test")
