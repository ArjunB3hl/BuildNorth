#!/usr/bin/env bash
# Re-resolve requirements.lock (Linux x86_64, CPython 3.12, with hashes). Resolution only: downloads package metadata,
# not the CUDA wheels, so it is safe to run on a laptop. Packages are resolved as of the demo's pinned commit
# (DEMO_COMMIT_DATE in ../versions.env), so the lock reproduces the environment that commit was built against.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091  # versions.env is plain KEY=value pins
source ../versions.env
uv pip compile requirements.in \
  --override overrides.txt \
  --python-version "${PYTHON_VERSION%.*}" \
  --python-platform x86_64-manylinux_2_28 \
  --exclude-newer "${DEMO_COMMIT_DATE}" \
  --generate-hashes \
  --no-header \
  --emit-index-url \
  -o requirements.lock
echo "requirements.lock: $(grep -c '==' requirements.lock) pinned packages"
