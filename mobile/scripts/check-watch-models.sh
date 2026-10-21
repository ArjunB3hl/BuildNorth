#!/usr/bin/env bash
# Checks the Apple Watch app's Foundation-only sources against the /watch/* contract, on this Mac:
# request bodies (explicit nulls, exact keys, no `note` in check-in patches), sample backend responses decoding,
# link-message parsing and stamp ordering, the sleep merge, the check-in form's sleep (health-sharing gate, when
# `sleepHours` is sent, null or left out), which days a Health sync uploads, local dates and API URL building.
# It compiles those files together with scripts/watch-model-check/main.swift and runs the result. When the watchOS
# simulator SDK is installed it also typechecks the whole watch target, so the shared files stay watchOS-clean.
#
# Usage: bash scripts/check-watch-models.sh    (needs Xcode or the Command Line Tools; nothing is installed)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
watch="$root/targets/watch"
sources=(
  "$watch/Models.swift"
  "$watch/LinkMessage.swift"
  "$watch/SleepNight.swift"
  "$watch/CheckInDraft.swift"
  "$watch/HealthBackfill.swift"
  "$watch/APIClient.swift"
  "$root/scripts/watch-model-check/main.swift"
)

out="$(mktemp -d "${TMPDIR:-/tmp}/watch-model-check.XXXXXX")"
trap 'rm -rf "$out"' EXIT

echo "Building the model checks for macOS…"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" \
  -module-name WatchModelCheck "${sources[@]}" -o "$out/check"
"$out/check"

if xcrun --sdk watchsimulator --show-sdk-path >/dev/null 2>&1; then
  echo "Typechecking targets/watch for watchOS 11…"
  xcrun -sdk watchsimulator swiftc -typecheck -target arm64-apple-watchos11.0-simulator -parse-as-library \
    "$watch"/*.swift
  echo "OK: targets/watch typechecks for watchOS"
else
  echo "Skipped the watchOS typecheck: the watchOS simulator SDK isn't installed."
fi
