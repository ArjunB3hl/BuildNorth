#!/usr/bin/env bash
# Re-resolve requirements-stage.txt (hash-pinned) for the staging job's Python on Linux x86_64.
set -euo pipefail
cd "$(dirname "$0")"
uv pip compile requirements-stage.in --python-version 3.12 --python-platform x86_64-manylinux_2_28 \
  --exclude-newer 2026-10-21T00:00:00Z --generate-hashes --no-header --emit-index-url -o requirements-stage.txt
