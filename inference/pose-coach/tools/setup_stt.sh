#!/usr/bin/env bash
# Talking to the coach without the ElevenLabs agent: Parakeet TDT 0.6B v3 transcribes the user on the Mac's GPU through
# MLX (server/stt_worker.py), in Kokoro's venv (mlx-audio has both; tools/setup_kokoro.sh builds it, and is run first if
# the venv is not there). The model at a pinned revision (Hugging Face cache, about 2.5 GB); the worker then reads it
# offline. Smoke test: Kokoro says a phrase, Parakeet must hear it. Apple Silicon only. The dev server starts the worker
# by itself when the venv and the model are there.
#   bash tools/setup_stt.sh          (from inference/pose-coach)
# Licence: Parakeet TDT 0.6B v3 (NVIDIA) is CC-BY-4.0: fine on this Mac, credited in docs/VOICE_COACH.md.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -m)" == arm64 ]] || { echo "MLX needs Apple Silicon" >&2; exit 1; }
[[ -x .venv-kokoro/bin/python ]] || bash tools/setup_kokoro.sh
.venv-kokoro/bin/python - <<'EOF'
import json, time
import numpy as np
import mlx.core as mx
from pathlib import Path
from huggingface_hub import snapshot_download
from mlx_audio.stt.utils import load_model as load_stt
from mlx_audio.tts.utils import load_model as load_tts
t = time.perf_counter()
snapshot = snapshot_download("mlx-community/parakeet-tdt-0.6b-v3", revision="ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15")
stt = load_stt(snapshot, model_type="parakeet")
load_s = time.perf_counter() - t
# a phrase in Kokoro's voice (24 kHz), at the 16 kHz the page sends (linear resampling is enough for a smoke test)
kokoro = snapshot_download("mlx-community/Kokoro-82M-bf16", revision="a71e4d38b236d968966a2002c4c895dbd12b1c3c")
tts = load_tts(kokoro, model_type="kokoro")
voice = str(Path(kokoro, "voices", "af_heart.safetensors"))
audio = np.concatenate([np.asarray(r.audio, dtype=np.float32).reshape(-1)
                        for r in tts.generate(text="Switch to lunges now.", voice=voice, speed=1.0, lang_code="a")])
audio16 = np.interp(np.arange(0, len(audio), 1.5), np.arange(len(audio)), audio).astype(np.float32)
stt.generate(mx.array(audio16))                                             # (the first run compiles the kernels)
t = time.perf_counter()
heard = stt.generate(mx.array(audio16)).text.strip()
ms = (time.perf_counter() - t) * 1000
if "lunge" not in heard.lower():
    raise SystemExit(f"Parakeet heard {heard!r} for 'Switch to lunges now.'")
print(json.dumps({"parakeet": "ok", "heard": heard, "load_s": round(load_s, 1), "ms": round(ms)}))
EOF
echo "Parakeet ready: restart the dev server (bash tools/serve.sh) to talk to the coach"
