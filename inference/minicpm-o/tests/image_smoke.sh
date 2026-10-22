#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016  # ok/bad always return 0; the single-quoted scripts run inside the image
# Smoke test of a built image on a CPU machine (the CI runner), before it is pushed: architecture, pinned versions,
# the demo's three entry modules import, nothing secret or downloaded is baked in, a clip without audio works for the
# chat path, and the entrypoint fails fast with an actionable message when there is no token or no model.
# Usage: bash tests/image_smoke.sh IMAGE_REF
set -euo pipefail
REF=$1
pass=0 failn=0
ok() { pass=$((pass + 1)); printf 'ok    %s\n' "$1"; }
bad() { failn=$((failn + 1)); printf 'FAIL  %s\n' "$1"; return 0; }
run() { docker run --rm --network none "$@"; }

arch=$(docker image inspect "$REF" --format '{{.Os}}/{{.Architecture}}')
[[ $arch == linux/amd64 ]] && ok "platform $arch" || bad "platform is $arch, expected linux/amd64"
echo "image size: $(( $(docker image inspect "$REF" --format '{{.Size}}') / 1000000 )) MB"

if out=$(run -i --entrypoint python "$REF" - <<'EOF' 2>&1
import importlib.metadata as md, json, os, sys
want = {l.split("=", 1)[0]: l.split("=", 1)[1].strip() for l in open("/opt/rhythm/versions.env") if "=" in l and not l.startswith("#")}
import torch, torchaudio, transformers, accelerate, librosa, numpy, onnxruntime, soundfile, decord, websockets
assert torch.__version__.startswith(want["TORCH_VERSION"]), torch.__version__
assert torch.version.cuda.startswith(want["CUDA_RUNTIME"]), torch.version.cuda
assert transformers.__version__ == "4.51.0", transformers.__version__
assert not torch.cuda.is_available()          # CPU runner: the GPU path is verified on the Pod
sys.path.insert(0, "/app"); os.chdir("/app")
import gateway, worker                         # noqa: E401 - the demo's entry modules import on CPU
import py_backend.server
assert os.environ["HF_HUB_OFFLINE"] == "1" and os.environ["TRANSFORMERS_OFFLINE"] == "1"
info = json.load(open("/opt/rhythm/build-info.json"))
assert info["MODEL_REVISION"] == want["MODEL_REVISION"] and info["DEMO_COMMIT"] == want["DEMO_COMMIT"]
print(f"torch {torch.__version__} cuda {torch.version.cuda} transformers {transformers.__version__} "
      f"minicpmo-utils {md.version('minicpmo-utils')} librosa {librosa.__version__} numpy {numpy.__version__}")
EOF
); then
  # an empty run must not pass: the last line is the version summary printed after every check
  if grep -q '^torch ' <<<"$out"; then ok "imports and pins: $(tail -1 <<<"$out")"; else bad "imports/pins printed nothing: $out"; fi
else bad "imports/pins: $out"; fi

if out=$(run --entrypoint bash "$REF" -c '
  set -e
  test ! -e /app/certs                              || { echo "demo TLS key shipped"; exit 1; }
  ! ls /etc/ssh/ssh_host_*key >/dev/null 2>&1     || { echo "SSH host keys baked in"; exit 1; }
  test -z "$(find / -xdev \( -name "*.safetensors" -o -name "*.gguf" \) -size +1M 2>/dev/null | head -1)" \
                                                  || { echo "model weights baked in"; exit 1; }
  test ! -d /root/.cache/huggingface              || { echo "HF cache in image"; exit 1; }
  test -x /opt/rhythm/runtime/entrypoint.sh && command -v caddy tini sshd ffmpeg >/dev/null
  echo clean' 2>&1); then ok "no TLS key, SSH host keys, weights or HF cache in the image; tools present"
else bad "image content: $out"; fi

hist=$(docker history --no-trunc --format '{{.CreatedBy}}' "$REF")
if grep -qiE 'rps_[A-Za-z0-9]|ghp_|hf_[A-Za-z0-9]{20}|RHYTHM_API_TOKEN=[^b ]' <<<"$hist"; then bad "secret-looking value in the layer history"
else ok "no secret-looking values in the layer history"; fi

# entrypoint failure modes (no GPU and no volume on the runner)
# the chat path for a clip without an audio track (the library clips have none): the demo extracts 1 frame/s with
# decord and falls back from librosa to moviepy for the missing audio; this must work on CPU too
if out=$(run --entrypoint bash "$REF" -c '
  set -e
  ffmpeg -v error -f lavfi -i testsrc=duration=3:size=320x240:rate=10 -c:v libx264 -pix_fmt yuv420p /tmp/silent.mp4
  python - <<EOF
from minicpmo.utils import get_video_frame_audio_segments
frames, audio, stacked = get_video_frame_audio_segments("/tmp/silent.mp4", stack_frames=1)
assert len(frames) >= 3, len(frames)
print("frames", len(frames), "audio", None if audio is None else len(audio))
EOF' 2>&1); then ok "silent mp4 -> frames for the chat path ($(tail -1 <<<"$out"))"; else bad "silent-mp4 chat path: $out"; fi

out=$(run "$REF" 2>&1) && rc=0 || rc=$?
[[ $rc == 1 ]] && grep -q 'preflight failed (exit 2): RHYTHM_API_TOKEN is not set' <<<"$out" \
  && ok "no token -> exit 1, says how to set the Runpod secret" || bad "no-token run (exit $rc): $(tail -5 <<<"$out")"
out=$(run -e RHYTHM_API_TOKEN=smoke-0123456789abcdef0123456789abcdef "$REF" 2>&1) && rc=0 || rc=$?
[[ $rc == 1 ]] && grep -q 'preflight failed (exit 3): model directory /workspace/models/openbmb/MiniCPM-o-4_5/.* does not exist' <<<"$out" \
  && ok "no volume -> exit 1, says to attach/stage the model (never downloads)" || bad "no-volume run (exit $rc): $(tail -5 <<<"$out")"
out=$(run -e RHYTHM_API_TOKEN=smoke-0123456789abcdef0123456789abcdef -e MODEL_DIR=/tmp/m --entrypoint bash "$REF" -c \
  'python /opt/rhythm/runtime/write_config.py --out /tmp/c.json >/dev/null && python - <<EOF
import json; c = json.load(open("/tmp/c.json")); assert c["model"]["model_path"] == "/tmp/m"; assert c["recording"]["enabled"] is False
print("config ok")
EOF' 2>&1) && ok "write_config.py inside the image: model path from MODEL_DIR, recording off" || bad "write_config: $out"

echo "image smoke: $pass passed, $failn failed"
[[ $failn == 0 ]]
