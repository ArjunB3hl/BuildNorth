#!/usr/bin/env bash
# Exit 0 only when an anonymous pull of IMAGE_REF is explicitly refused by the registry (the package is private).
# Public (the pull works) and inconclusive (network/registry errors, anything else) both exit 1: the caller must not
# push the real image then. Usage: scripts/ghcr_private.sh ghcr.io/<owner>/<name>:<tag>
set -uo pipefail
ref=$1
anon=$(mktemp -d)
trap 'rm -rf "$anon"' EXIT
for attempt in 1 2 3; do
  if out=$(DOCKER_CONFIG="$anon" docker manifest inspect "$ref" 2>&1); then
    echo "::error::$ref can be pulled anonymously: the package is PUBLIC. Delete it (GitHub -> Packages -> rhythm-minicpm-o -> Package settings -> Delete), add a classic PAT with write:packages as the repository secret GHCR_TOKEN, and run again. The real image was not pushed."
    exit 1
  fi
  if grep -qiE 'unauthorized|denied|authentication required' <<<"$out"; then
    echo "anonymous pull of $ref is refused: the package is private"
    exit 0
  fi
  echo "visibility check attempt $attempt inconclusive: $out"
  sleep 10
done
echo "::error::could not determine whether $ref is private (last answer: $out); the real image was not pushed"
exit 1
