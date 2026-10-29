#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle_id="${1:-org.reactjs.native.NorthAssistant}"
if [[ ! "$bundle_id" =~ ^[A-Za-z0-9.-]+$ ]]; then echo 'Invalid Mac bundle identifier.' >&2; exit 1; fi
if [[ "$(uname -m)" != arm64 ]]; then echo 'Local speech requires Apple Silicon.' >&2; exit 1; fi
if [[ ! -x "$root/inference/pose-coach/.venv-kokoro/bin/python" ]]; then echo 'Install the models first: cd inference/pose-coach && bash tools/setup_stt.sh' >&2; exit 1; fi
container="$HOME/Library/Containers/$bundle_id/Data/Library/Application Support/Rhythm"
mkdir -p "$container"
echo 'Starting local speech. Keep this terminal open while using the Mac voice coach.'
exec /usr/bin/python3 "$root/mac/local-voice/service.py" --token-file "$container/local-voice.token"
