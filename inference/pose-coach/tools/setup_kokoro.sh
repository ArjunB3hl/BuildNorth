#!/usr/bin/env bash
# The coach's local voice: Kokoro-82M on the Mac's GPU through MLX (server/kokoro_worker.py), in its own venv so the
# dev server's stays small. Pinned versions, none newer than POSE_PIN_DATE; the model and its voices at a pinned revision
# (Hugging Face cache). Apple Silicon only. The dev server starts the voice by itself when this venv exists.
#   bash tools/setup_kokoro.sh        (from inference/pose-coach; about 1 GB with the model)
# Licences: Kokoro-82M and mlx-audio are Apache-2.0/MIT; misaki's espeak-ng fallback (phonemizer-fork) is GPL-3.0,
# fine on this Mac, a question before the voice is served to other people.
set -euo pipefail
cd "$(dirname "$0")/.."
PIN_DATE="${POSE_PIN_DATE:-2026-10-09}"
[[ "$(uname -m)" == arm64 ]] || { echo "MLX needs Apple Silicon" >&2; exit 1; }
command -v uv >/dev/null || { echo "needs uv (https://docs.astral.sh/uv/)" >&2; exit 1; }
[[ -x .venv-kokoro/bin/python ]] || uv venv .venv-kokoro --python 3.12 -q
UV_EXCLUDE_NEWER="${PIN_DATE}T00:00:00Z" uv pip install --python .venv-kokoro/bin/python -q \
  "mlx-audio==0.5.8" "mlx==0.32.3" "misaki[en]==0.9.4" "pip"           # (pip: misaki installs its spaCy model with it)
.venv-kokoro/bin/python - <<'EOF'
import json, time
from pathlib import Path
from huggingface_hub import snapshot_download
from mlx_audio.tts.utils import load_model
t = time.perf_counter()
snapshot = snapshot_download("mlx-community/Kokoro-82M-bf16", revision="a71e4d38b236d968966a2002c4c895dbd12b1c3c")
model = load_model(snapshot, model_type="kokoro")
# the voice by path, from the same snapshot, as the worker does (a bare name would come from another repo's latest)
voice = Path(snapshot, "voices", "af_heart.safetensors")
if not voice.is_file():
    raise SystemExit(f"no voice af_heart in the snapshot ({voice})")
audio = [r.audio for r in model.generate(text="Ready when you are.", voice=str(voice), speed=1.0, lang_code="a")]
print(json.dumps({"kokoro": "ok", "seconds": round(time.perf_counter() - t, 1)}))
EOF
echo "Kokoro voice ready: restart the dev server (bash tools/serve.sh) to use it"
