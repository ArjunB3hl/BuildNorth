#!/usr/bin/env bash
# Local voice on Windows (x64): Parakeet TDT 0.6B v3 (int8) hears the user and Kokoro-82M v1.0 speaks, as ONNX models
# run on the CPU by sherpa-onnx, with Silero VAD for pause detection. The macOS setup (setup_kokoro.sh, setup_stt.sh)
# needs MLX on Apple Silicon; this is its Windows counterpart, used by server/stt.py and server/tts.py through the
# sherpa-onnx workers (stt_worker_onnx.py, kokoro_worker_onnx.py) and by win/local-voice/service.py.
#   bash tools/setup_voice_windows.sh      (Git Bash, from inference/pose-coach; Python 3.11 through the py launcher)
# Downloads, pinned and checked against GitHub's SHA-256 digests: about 840 MB (Parakeet 487 MB, Kokoro 350 MB, Silero
# 0.2 MB), about 1.2 GB unpacked in .data/sherpa (git-ignored), plus about 210 MB of Python packages in .venv.
# (KOKORO_INT8=1: Kokoro 132 MB, 0.9 GB unpacked.)
# Licences: sherpa-onnx Apache-2.0; Parakeet TDT 0.6B v3 (NVIDIA) CC-BY-4.0 (credit it); Kokoro-82M Apache-2.0, its
# archive includes espeak-ng data (GPL-3.0); Silero VAD MIT; sounddevice MIT with PortAudio (MIT).
set -euo pipefail
cd "$(dirname "$0")/.."
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ;; *) echo "this is the Windows setup; on a Mac use setup_kokoro.sh and setup_stt.sh" >&2; exit 1 ;; esac

PY="${POSE_WINDOWS_PY:-py -3.11}"
MODELS=.data/sherpa
RELEASES=https://github.com/k2-fsa/sherpa-onnx/releases/download

if [[ ! -x .venv/Scripts/python.exe ]]; then
  $PY -m venv .venv
fi
.venv/Scripts/python.exe -m pip install -q --disable-pip-version-check \
  "sherpa-onnx==2.0.1" "numpy==2.4.6" "sounddevice==0.5.6" "mcp==2.3.0" "anthropic==2.3.0"

mkdir -p "$MODELS"

# fetch NAME URL SHA256 DEST: an archive streamed into tar (no copy of it on disk) while hashed; a bad digest removes what
# was unpacked. A plain file is downloaded and checked the same way.
fetch() {
  local name="$1" url="$2" sha="$3" dest="$4" got
  if [[ -e "$dest" ]]; then echo "$name: already there"; return; fi
  echo "$name: downloading"
  if [[ "$url" == *.tar.bz2 ]]; then
    local tmp="$MODELS/.unpacking" sum="$MODELS/.unpacking.sha256"
    rm -rf "$tmp" "$sum"; mkdir -p "$tmp"
    # tar is the pipeline's last step, so the pipeline ends when it has unpacked everything; the hash is written by
    # the process substitution, which can finish a moment later.
    curl -fsSL "$url" | tee >(sha256sum | cut -d' ' -f1 > "$sum") | tar -xjf - -C "$tmp"
    for _ in $(seq 50); do [[ -s "$sum" ]] && break; sleep 0.2; done
    got="$(cat "$sum" 2>/dev/null || true)"; rm -f "$sum"
    if [[ "$got" != "$sha" ]]; then rm -rf "$tmp"; echo "$name: checksum mismatch (${got:-none})" >&2; exit 1; fi
    mv "$tmp"/* "$dest"; rmdir "$tmp"
  else
    curl -fsSL -o "$dest.part" "$url"
    got="$(sha256sum "$dest.part" | cut -d' ' -f1)"
    if [[ "$got" != "$sha" ]]; then rm -f "$dest.part"; echo "$name: checksum mismatch ($got)" >&2; exit 1; fi
    mv "$dest.part" "$dest"
  fi
  echo "$name: ok"
}

fetch "Silero VAD" "$RELEASES/asr-models/silero_vad.int8.onnx" \
  c36d490aff5ab924ca6c7aeec4d8f6bd3d22db6fa17611b9c5b17eae58ac3a20 "$MODELS/silero_vad.int8.onnx"
# Kokoro in full precision by default: on an Intel i5-8250U (no VNNI) it speaks at 0.9x real time against 2.7-3.5x for
# the int8 model, which is less than half the size. KOKORO_INT8=1 fetches the int8 model instead (for a small disk).
if [[ "${KOKORO_INT8:-0}" == 1 ]]; then
  fetch "Kokoro-82M v1.0 int8" "$RELEASES/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2" \
    72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653 "$MODELS/kokoro-int8-multi-lang-v1_0"
else
  fetch "Kokoro-82M v1.0" "$RELEASES/tts-models/kokoro-multi-lang-v1_0.tar.bz2" \
    60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4 "$MODELS/kokoro-multi-lang-v1_0"
fi
fetch "Parakeet TDT 0.6B v3 int8" "$RELEASES/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" \
  5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf "$MODELS/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"

# Smoke test: Kokoro says a phrase, Parakeet must hear it (the same check as setup_stt.sh on a Mac).
.venv/Scripts/python.exe server/onnx_speech.py --self-test
echo "Local voice ready. For the Rhythm Windows app: win/local-voice/start.ps1 (Coach) or win/local-voice/camera.ps1."
