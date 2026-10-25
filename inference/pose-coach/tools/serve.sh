#!/usr/bin/env bash
# Run the pose coach's dev server on the data in .data/ (docs/DATA.md).
#   bash tools/serve.sh          http://localhost:8765/  the evaluation set, live recordings and the 3D demos
#   bash tools/serve.sh m3d      http://localhost:8766/  the 3D-vs-footage test set
# PORT=... overrides the port. The server binds 127.0.0.1 only.
set -euo pipefail
cd "$(dirname "$0")/.."
D="$PWD/.data"
case "${1:-}" in
  "")  export POSE_DATA_DIR="$D/posedata" POSE_CLIPS_DIR="$D/clipset" POSE_DEMOS_DIR="$D/demos"; PORT="${PORT:-8765}" ;;
  # (the 3D test set needs no speech to text: it would load a second 2.5 GB Parakeet next to the main server's)
  m3d) export POSE_DATA_DIR="$D/m3d/data" POSE_CLIPS_DIR="$D/m3d" POSE_DEMOS_DIR="$D/demos" POSE_STT=0; PORT="${PORT:-8766}" ;;
  *)   echo "usage: bash tools/serve.sh [m3d]" >&2; exit 2 ;;
esac
[[ -d "$POSE_DATA_DIR" ]] || { echo "no data at $POSE_DATA_DIR (see docs/DATA.md)" >&2; exit 1; }
PY=python3; [[ -x .venv/bin/python ]] && PY=.venv/bin/python
exec "$PY" server/dev_server.py --port "$PORT"
