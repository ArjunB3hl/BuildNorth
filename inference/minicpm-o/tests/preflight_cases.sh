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

echo "preflight cases: $pass passed, $failn failed"
[[ $failn == 0 ]]
