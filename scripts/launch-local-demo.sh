#!/usr/bin/env bash
set -euo pipefail

# The catalog copies this helper next to the artifacts. No download or store login.
release_dir="$(cd "$(dirname "$0")" && pwd)"
target="${1:-}"
if [[ -z "$target" ]]; then
  printf 'Rhythm demo: 1 iPhone, 2 Apple Watch, 3 Android, 4 Mac\n'
  read -r -p 'Choose a platform: ' target
fi

simulator_id() {
  xcrun simctl list devices booted --json | python3 -c '
import json, sys
family = "." + sys.argv[1] + "-"
devices = json.load(sys.stdin)["devices"]
print(next((d["udid"] for runtime, group in devices.items() if family in runtime
            for d in group if d["state"] == "Booted"), ""))
' "$1"
}

case "$target" in
  1|ios|iphone)
    device="$(simulator_id iOS)"
    [[ -n "$device" ]] || { echo 'Start an iPhone in Xcode Simulator, then run this again.'; exit 1; }
    mkdir -p "$release_dir/.launch/ios"
    ditto -x -k "$release_dir/ios/Rhythm-iOS-Simulator-Release.zip" "$release_dir/.launch/ios"
    xcrun simctl install "$device" "$release_dir/.launch/ios/Rhythm.app"
    xcrun simctl launch "$device" com.arjun273773.buildnorth
    ;;
  2|watchos|watch)
    device="$(simulator_id watchOS)"
    [[ -n "$device" ]] || { echo 'Start the paired Watch in Xcode Simulator, then run this again.'; exit 1; }
    mkdir -p "$release_dir/.launch/watchos"
    ditto -x -k "$release_dir/watchos/Rhythm-watchOS-Simulator-Release.zip" "$release_dir/.launch/watchos"
    xcrun simctl install "$device" "$release_dir/.launch/watchos/watch.app"
    xcrun simctl launch "$device" com.arjun273773.buildnorth.watch
    ;;
  3|android)
    rhythm_adb="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
    [[ -x "$rhythm_adb" ]] || rhythm_adb="$(command -v adb)"
    device="$("$rhythm_adb" devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1; exit}')"
    [[ -n "$device" ]] || { echo 'Start an Android emulator (python3 start-android-demo-emulator.py), then run this again.'; exit 1; }
    apk="$(find "$release_dir/android" -maxdepth 1 -name '*-release.apk' -print -quit)"
    [[ -n "$apk" ]] || { echo 'The Android Release APK is not ready.'; exit 1; }
    # A signing conflict fails safely; never uninstall the existing app or erase its data.
    "$rhythm_adb" -s "$device" install -r "$apk"
    "$rhythm_adb" -s "$device" shell am start -n com.arjun273773.buildnorth/.MainActivity
    ;;
  4|macos|mac)
    [[ -d "$release_dir/macos/Rhythm.app" ]] || { echo 'Unzip the Mac release into the macos folder first.'; exit 1; }
    # Debug and Release share a bundle ID. Force this packaged copy to launch
    # instead of activating an older instance; never quit another app or reset data.
    open -n "$release_dir/macos/Rhythm.app"
    ;;
  *) echo 'Choose ios, watchos, android or macos.'; exit 2 ;;
esac
