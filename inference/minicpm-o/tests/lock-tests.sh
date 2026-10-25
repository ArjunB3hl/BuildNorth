#!/usr/bin/env bash
# Re-resolve requirements-tests.txt (hash-pinned, all platforms: CI runs Linux, a developer may run macOS).
set -euo pipefail
cd "$(dirname "$0")"
uv pip compile requirements-tests.in --universal --python-version 3.12 --exclude-newer 2026-09-15T07:16:25Z \
  --generate-hashes --no-header -o requirements-tests.txt
