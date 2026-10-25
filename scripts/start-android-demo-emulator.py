#!/usr/bin/env python3
"""Start the preserved Rhythm test AVD without resetting data or downloading SDKs.

Default: show an emulator window. For unattended verification, use --headless.
After boot, run the release folder's `launch-demo.sh android` to install Rhythm.
"""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def output(command, timeout=10):
    return subprocess.run(
        command, capture_output=True, text=True, timeout=timeout, check=True
    ).stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--headless", action="store_true", help="Do not open a window")
    parser.add_argument("--avd", default="RhythmReleaseTest20261025")
    parser.add_argument("--port", type=int, default=5556)
    parser.add_argument("--timeout", type=int, default=120, help="Boot deadline in seconds")
    args = parser.parse_args()
    if not 5554 <= args.port <= 5682 or args.port % 2:
        parser.error("--port must be an even number from 5554 through 5682")
    if not 1 <= args.timeout <= 300:
        parser.error("--timeout must be between 1 and 300 seconds")

    default_sdk = Path.home() / ("Library/Android/sdk" if sys.platform == "darwin" else "Android/Sdk")
    sdk = Path(os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME") or default_sdk)
    emulator = sdk / "emulator/emulator"
    adb = shutil.which("adb") or str(sdk / "platform-tools/adb")
    if not emulator.is_file() or not Path(adb).is_file():
        parser.error("Android SDK emulator/adb missing. Set ANDROID_SDK_ROOT to your installed SDK.")
    if args.avd not in output([str(emulator), "-list-avds"]).splitlines():
        parser.error(
            f"AVD {args.avd!r} is not installed. Choose an existing ARM64 test AVD with --avd. "
            "This helper never creates, resets or downloads an AVD."
        )

    device = f"emulator-{args.port}"
    devices = output([adb, "devices"]).splitlines()[1:]
    occupied = any(line.split() and line.split()[0] == device for line in devices)
    reuse = False
    for line in devices:
        fields = line.split()
        if len(fields) < 2 or not fields[0].startswith("emulator-") or fields[1] != "device":
            continue
        names = output([adb, "-s", fields[0], "emu", "avd", "name"]).splitlines()
        if names and names[0] == args.avd:
            device, reuse = fields[0], True
            break
    if occupied and not reuse:
        parser.error(f"Port {args.port} is already occupied by an emulator. Choose another --port.")

    process = None
    log_path = None
    if reuse:
        print(f"Reusing {args.avd} on {device}; existing data and process are preserved.", flush=True)
    else:
        command = [
            str(emulator), "-avd", args.avd, "-no-snapshot", "-no-audio", "-no-boot-anim",
            "-cores", "2", "-memory", "2048", "-gpu", "swiftshader", "-feature", "-Vulkan",
            "-camera-back", "none", "-camera-front", "none", "-port", str(args.port), "-show-kernel",
        ]
        if args.headless:
            command.append("-no-window")
        log_fd, log_path = tempfile.mkstemp(prefix="rhythm-android-emulator-", suffix=".log")
        with os.fdopen(log_fd, "w") as log:
            process = subprocess.Popen(
                command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        print(f"Starting {args.avd} with SwiftShader and guest Vulkan disabled. Log: {log_path}", flush=True)

    deadline = time.monotonic() + args.timeout
    try:
        while time.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                raise RuntimeError(f"Emulator exited with status {process.returncode}; inspect {log_path}")
            try:
                remaining = max(0.1, min(5, deadline - time.monotonic()))
                booted = output([adb, "-s", device, "shell", "getprop", "sys.boot_completed"], remaining)
                if booted == "1":
                    print(f"Ready: {device}. Run the release folder's launch-demo.sh android.")
                    return 0
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
            time.sleep(min(2, max(0, deadline - time.monotonic())))
        raise RuntimeError(f"Boot did not complete within {args.timeout} seconds. Log: {log_path or 'existing emulator'}")
    except (RuntimeError, KeyboardInterrupt) as error:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        cleanup = "Only this helper's new process was stopped." if process else "Existing emulator was left running."
        print(f"{error}\n{cleanup} AVD data was preserved.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, subprocess.SubprocessError) as error:
        sys.exit(f"Android emulator setup failed: {error}")
