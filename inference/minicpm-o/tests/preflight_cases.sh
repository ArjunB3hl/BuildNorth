#!/usr/bin/env bash
# CPU-only checks of runtime/preflight.py: each broken setup must stop with its exit code and an actionable message,
# and a complete (synthetic) model directory must pass. No GPU, no real weights: the "model" is small fake files with a
# matching manifest. Usage: bash tests/preflight_cases.sh   (from inference/minicpm-o; needs python3)
set -euo pipefail
cd "$(dirname "$0")/.."
PRE=runtime/preflight.py
PY=$(command -v python3)
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
REV=d59117d19ddb8a28a62f1b5f4e3b34ac48d510a4

# synthetic model dir (tests/make_fake_model.py): REQUIRED files, 2 fake shards, manifest, COMPLETE marker
python3 tests/make_fake_model.py "$W/model" "$REV"

export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 MODEL_REVISION=$REV MODEL_DIR=$W/model
export RHYTHM_STATE_DIR=$W/state RHYTHM_LOG_DIR=$W/state/logs TORCHINDUCTOR_CACHE_DIR=$W/state/ti HF_HOME=$W/state/hf
export RHYTHM_API_TOKEN=0123456789abcdef0123456789abcdef
pass=0 failn=0

# expect CODE PATTERN [ENV=VALUE ...] [-- preflight args]: run preflight --skip-ports (and --skip-gpu unless GPU=1 is
# among the ENV words), check the exit code and that the output matches PATTERN
expect() {
  local want=$1 pat=$2
  shift 2
  local envs=() flags=(--skip-ports --skip-gpu)
  while [[ $# -gt 0 && $1 != -- ]]; do
    if [[ $1 == GPU=1 ]]; then flags=(--skip-ports); else envs+=("$1"); fi
    shift
  done
  [[ ${1:-} == -- ]] && shift
  local out rc=0
  out=$(env "${envs[@]}" "$PY" "$PRE" "${flags[@]}" "$@" 2>&1) || rc=$?
  if [[ $rc == "$want" ]] && grep -qE -- "$pat" <<<"$out"; then
    pass=$((pass + 1)); printf 'ok    exit %s  %s\n' "$rc" "$pat"
  else
    failn=$((failn + 1)); printf 'FAIL  wanted exit %s /%s/, got %s:\n%s\n' "$want" "$pat" "$rc" "$out"
  fi
}

expect 0 "all checks passed"
expect 0 "verified by sha256" MODEL_VERIFY=sha256
expect 2 "RHYTHM_API_TOKEN is not set.*RUNPOD_SECRET" RHYTHM_API_TOKEN=
expect 2 "must be 32-256 characters" RHYTHM_API_TOKEN=short
expect 2 "unresolved secret reference" RHYTHM_API_TOKEN="{{ RUNPOD_SECRET_rhythm_api_token }}"
expect 2 "must be 32-256 characters" RHYTHM_API_TOKEN="$(printf '%064d' 0)"$'\n'   # valid token + trailing newline
expect 2 "HF_HUB_OFFLINE must be 1" HF_HUB_OFFLINE=0
expect 2 "MODEL_VERIFY='bogus'" MODEL_VERIFY=bogus
expect 3 "does not exist.*Attach the network volume.*never downloads" MODEL_DIR="$W/nope"
expect 3 "staged revision .* does not match" MODEL_REVISION=0000000000000000000000000000000000000000

mv "$W/model/.rhythm/COMPLETE.json" "$W/complete.bak"
expect 3 "COMPLETE.json is missing: staging did not finish"
mv "$W/complete.bak" "$W/model/.rhythm/COMPLETE.json"

cp "$W/model/model-00002-of-00002.safetensors" "$W/shard.bak"
head -c 500 "$W/shard.bak" > "$W/model/model-00002-of-00002.safetensors"
expect 3 "500 bytes, expected 2000 \(truncated"
printf 'z%.0s' $(seq 2000) > "$W/model/model-00002-of-00002.safetensors"
expect 0 "verified by sizes"
expect 3 "sha256 .* expected" MODEL_VERIFY=sha256
rm "$W/model/model-00002-of-00002.safetensors"
ln -s "$W/gone" "$W/model/model-00002-of-00002.safetensors"
expect 3 "broken symlink"
rm "$W/model/model-00002-of-00002.safetensors"
expect 3 "model-00002-of-00002.safetensors: missing"
cp "$W/shard.bak" "$W/model/model-00002-of-00002.safetensors"

cp "$W/model/config.json" "$W/config.bak"; printf '{x' > "$W/model/config.json"     # same size as '{}', not JSON
expect 3 "config.json does not parse as JSON"
printf '{bad' > "$W/model/config.json"
expect 3 "config.json does not parse as JSON" MODEL_VERIFY=off                          # off: presence only, no size
cp "$W/config.bak" "$W/model/config.json"

mv "$W/model/.rhythm/manifest.json" "$W/manifest.bak"
expect 3 "manifest.json is missing.*Re-run stage_model.py"
mv "$W/manifest.bak" "$W/model/.rhythm/manifest.json"

expect 5 "is not writable" RHYTHM_STATE_DIR=/proc/nope
expect 5 "only .* GB free" RHYTHM_MIN_FREE_GB=999999
# GPU checks with a stub nvidia-smi (prints "name, MiB, driver" like the real query)
mkdir -p "$W/bin"
gpu() { printf '#!/bin/sh\necho "%s"\n' "$1" > "$W/bin/nvidia-smi"; chmod +x "$W/bin/nvidia-smi"; }
expect 4 "nvidia-smi not found: this container has no NVIDIA GPU" GPU=1 PATH="$W/empty" -- --json "$W/pre.json"
if "$PY" -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['exit_code']==4 and d['message'], d" "$W/pre.json"; then
  pass=$((pass + 1)); echo "ok    --json report written with exit_code and message"
else
  failn=$((failn + 1)); echo "FAIL  --json report missing or incomplete"
fi
gpu "NVIDIA GeForce RTX 3090, 24576, 580.65.06"
expect 4 "24 GB of VRAM.*llama.cpp-omni profile" GPU=1 PATH="$W/bin"
gpu "NVIDIA RTX A6000, 49140, 550.127.05"
expect 4 "driver 550.127.05 is older than R570" GPU=1 PATH="$W/bin"
gpu "NVIDIA L40S, 46068, 580.65.06"
expect 4 "PyTorch does not import|cannot use the GPU" GPU=1 PATH="$W/bin"

# write_config.py: the default reference voice is the demo's English one, and a missing voice file stops start-up
mkdir -p "$W/app/assets/ref_audio"
if out=$(MODEL_DIR=/m python3 runtime/write_config.py --out "$W/app/config.json" 2>&1); then
  failn=$((failn + 1)); echo "FAIL  write_config accepted a missing reference voice"
else
  if grep -q "reference voice assets/ref_audio/ref_en_dlc_1.wav not found" <<<"$out"; then
    pass=$((pass + 1)); echo "ok    missing English reference voice -> clear error"
  else
    failn=$((failn + 1)); echo "FAIL  message: $out"
  fi
fi
printf x > "$W/app/assets/ref_audio/ref_en_dlc_1.wav"
if MODEL_DIR=/m python3 runtime/write_config.py --out "$W/app/config.json" >/dev/null \
   && python3 -c "import json,sys; assert json.load(open(sys.argv[1]))['audio']['ref_audio_path']=='assets/ref_audio/ref_en_dlc_1.wav'" "$W/app/config.json"; then
  pass=$((pass + 1)); echo "ok    config.json sets the English reference voice by default"
else
  failn=$((failn + 1)); echo "FAIL  English voice not in config.json"
fi

# write_config.py: the patched page's settings (static/rhythm-config.js) and the coach prompt override
check() {  # check <description> <python assertion over cfg (rhythm-config.js) and preset (english_call.yaml text)> [env...]
  local what=$1 assertion=$2; shift 2
  if env MODEL_DIR=/m "$@" python3 runtime/write_config.py --out "$W/app/config.json" >/dev/null 2>"$W/wc.err" \
     && python3 - "$W/app" "$assertion" <<'EOF'
import json, sys
app, assertion = sys.argv[1], sys.argv[2]
js = open(app + "/static/rhythm-config.js").read()
assert js.startswith("window.RHYTHM_CONFIG = ") and js.rstrip().endswith(";"), js
cfg = json.loads(js[len("window.RHYTHM_CONFIG = "):].rstrip().rstrip(";"))
preset = open(app + "/assets/presets/omni/english_call.yaml").read()
assert eval(assertion), (cfg, preset)
EOF
  then pass=$((pass + 1)); echo "ok    $what"
  else failn=$((failn + 1)); echo "FAIL  $what: $(cat "$W/wc.err")"; fi
}
reject() {  # reject <description> <expected message regex> [env...]
  local what=$1 re=$2 out; shift 2
  if out=$(env MODEL_DIR=/m "$@" python3 runtime/write_config.py --out "$W/app/config.json" 2>&1); then
    failn=$((failn + 1)); echo "FAIL  $what: accepted"
  elif grep -Eq "$re" <<<"$out"; then pass=$((pass + 1)); echo "ok    $what"
  else failn=$((failn + 1)); echo "FAIL  $what: $out"; fi
}
mkdir -p "$W/app/assets/presets/omni"
printf 'name: English Call\nsystem_prompt: "You are Rhythm, the default."\nother: 1\n' > "$W/app/assets/presets/omni/english_call.yaml"
check "page config defaults: grid4 frames, no duplex overrides, preset untouched" \
  'cfg == {"frameMode": "grid4", "duplexConfig": {}} and "the default." in preset'
check "RHYTHM_FRAME_MODE=4 and RHYTHM_DUPLEX_CONFIG reach the page" \
  'cfg == {"frameMode": "4", "duplexConfig": {"listen_prob_scale": 1.3, "length_penalty": 0.7}}' \
  RHYTHM_FRAME_MODE=4 'RHYTHM_DUPLEX_CONFIG={"listen_prob_scale": 1.3, "length_penalty": 0.7}'
check "RHYTHM_COACH_PROMPT replaces only the preset's system_prompt line (quotes escaped)" \
  'preset == "name: English Call\nsystem_prompt: \"Say \\\"good\\\" once.\"\nother: 1\n"' \
  'RHYTHM_COACH_PROMPT=Say "good" once.'
reject "unknown frame mode -> clear error" "RHYTHM_FRAME_MODE='8'.*one of" RHYTHM_FRAME_MODE=8
reject "duplex config that is not JSON -> clear error" "RHYTHM_DUPLEX_CONFIG is not valid JSON" 'RHYTHM_DUPLEX_CONFIG={listen'
reject "duplex config with an unknown key -> clear error" "RHYTHM_DUPLEX_CONFIG must be a JSON object" \
  'RHYTHM_DUPLEX_CONFIG={"listen_scale": 2}'
reject "duplex config that is a list -> clear error" "RHYTHM_DUPLEX_CONFIG must be a JSON object" 'RHYTHM_DUPLEX_CONFIG=[1]'
reject "duplex value out of the backend's range -> clear error" "temperature=3: must be float >= 0.0 <= 2.0" \
  'RHYTHM_DUPLEX_CONFIG={"temperature": 3}'
reject "duplex value of the wrong type -> clear error" "top_k=20.5: must be int >= 0" 'RHYTHM_DUPLEX_CONFIG={"top_k": 20.5}'
reject "unknown decode_mode -> clear error" "decode_mode='beam': must be 'sampling' or 'greedy'" \
  'RHYTHM_DUPLEX_CONFIG={"decode_mode": "beam"}'
check "in-range duplex values and listen_top_k null are accepted" \
  'cfg["duplexConfig"] == {"text_repetition_penalty": 1.0, "listen_top_k": None, "decode_mode": "greedy"}' \
  'RHYTHM_DUPLEX_CONFIG={"text_repetition_penalty": 1.0, "listen_top_k": null, "decode_mode": "greedy"}'
check "empty RHYTHM_FRAME_MODE means the default; spaces are ignored" 'cfg["frameMode"] == "grid4"' RHYTHM_FRAME_MODE=
check "RHYTHM_FRAME_MODE with spaces" 'cfg["frameMode"] == "2"' 'RHYTHM_FRAME_MODE= 2 '
check "RHYTHM_COACH_PROMPT with emoji, a colon and a line separator stays one valid YAML line" \
  'preset.splitlines()[1] == "system_prompt: \"Squat 💪: knees out\\u2028ok\"" and len(preset.splitlines()) == 3' \
  "RHYTHM_COACH_PROMPT=$(printf 'Squat \xf0\x9f\x92\xaa: knees out\xe2\x80\xa8ok')"
reject "unknown KV window mode -> clear error" "RHYTHM_KV_WINDOW='sliding': one of basic" RHYTHM_KV_WINDOW=sliding
reject "KV window high mark too close to the page's 8192 cap -> clear error" "need 0 < LOW < HIGH <= 7192" \
  RHYTHM_KV_WINDOW_HIGH=8000
reject "KV window low mark above the high mark -> clear error" "need 0 < LOW < HIGH" RHYTHM_KV_WINDOW_LOW=6500
reject "KV window mark that is not a number -> clear error" "RHYTHM_KV_WINDOW_HIGH='6k' is not a number" RHYTHM_KV_WINDOW_HIGH=6k
reject "duplex value Infinity -> clear error" "Infinity is not a number the page can send" \
  'RHYTHM_DUPLEX_CONFIG={"listen_prob_scale": Infinity}'
reject "duplex value 1e400 (overflows to inf) -> clear error" "listen_prob_scale=inf: must be float" \
  'RHYTHM_DUPLEX_CONFIG={"listen_prob_scale": 1e400}'
reject "temperature 0 with sampling -> points to greedy" 'temperature=0 with sampling: use "decode_mode": "greedy"' \
  'RHYTHM_DUPLEX_CONFIG={"temperature": 0}'
check "temperature 0 with greedy and an integral float for top_k are accepted" \
  'cfg["duplexConfig"] == {"temperature": 0, "decode_mode": "greedy", "top_k": 20.0}' \
  'RHYTHM_DUPLEX_CONFIG={"temperature": 0, "decode_mode": "greedy", "top_k": 20.0}'
if out=$(MODEL_DIR=/m RHYTHM_KV_WINDOW=off python3 runtime/write_config.py --out "$W/app/config.json" 2>&1) \
   && grep -q "kv_window=off" <<<"$out" && out2=$(MODEL_DIR=/m python3 runtime/write_config.py --out "$W/app/config.json" 2>&1) \
   && grep -q "kv_window=basic 4500-6000" <<<"$out2"; then
  pass=$((pass + 1)); echo "ok    KV window: basic 4500-6000 by default, off on request (reported at start-up)"
else failn=$((failn + 1)); echo "FAIL  KV window report: $out / ${out2:-}"; fi
# the patched backend (core/processors/unified.py) must read the window variables exactly like write_config.py does
if RHYTHM_KV_WINDOW='' RHYTHM_KV_WINDOW_HIGH='' RHYTHM_KV_WINDOW_LOW='' python3 - docker/patch_demo.py <<'EOF'
import os, re, sys
src = open(sys.argv[1]).read()
exprs = re.findall(r'"(sliding_window_mode|basic_window_high_tokens|basic_window_low_tokens)": (.+?),\n', src)
got = {k: eval(e) for k, e in exprs}
assert got == {"sliding_window_mode": "basic", "basic_window_high_tokens": 6000, "basic_window_low_tokens": 4500}, got
EOF
then pass=$((pass + 1)); echo "ok    patched backend: empty KV window variables mean the defaults (as in write_config.py)"
else failn=$((failn + 1)); echo "FAIL  patched backend reads empty KV window variables differently from write_config.py"; fi

echo "preflight cases: $pass passed, $failn failed"
[[ $failn == 0 ]]
