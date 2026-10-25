#!/usr/bin/env python3
"""Verify simulator signing and the entitlements used by simulator securityd."""

import json
import plistlib
import struct
import subprocess
import sys
from pathlib import Path


def simulator_entitlements(executable: Path) -> dict:
    # Xcode embeds simulator entitlements in the Mach-O __TEXT section, not
    # the normal codesign entitlement blob. These builds explicitly use arm64.
    data = executable.read_bytes()
    if data[:4] != b"\xcf\xfa\xed\xfe":
        raise ValueError(f"Expected a thin 64-bit Mach-O: {executable.name}")
    command_count = struct.unpack_from("<I", data, 16)[0]
    command_offset = 32
    for _ in range(command_count):
        command, command_size = struct.unpack_from("<II", data, command_offset)
        if command == 0x19:  # LC_SEGMENT_64
            section_count = struct.unpack_from("<I", data, command_offset + 64)[0]
            for index in range(section_count):
                section = command_offset + 72 + index * 80
                name = data[section : section + 16].rstrip(b"\x00")
                segment = data[section + 16 : section + 32].rstrip(b"\x00")
                if (segment, name) == (b"__TEXT", b"__entitlements"):
                    size = struct.unpack_from("<Q", data, section + 40)[0]
                    offset = struct.unpack_from("<I", data, section + 48)[0]
                    return plistlib.loads(data[offset : offset + size].rstrip(b"\x00"))
        command_offset += command_size
    raise ValueError(f"Missing simulator entitlements: {executable.name}")


def main() -> None:
    phone = Path(sys.argv[1])
    config = json.loads((Path(__file__).resolve().parents[1] / "app.json").read_text())
    team = config["expo"]["ios"]["appleTeamId"]
    for app in (phone, phone / "Watch" / "watch.app"):
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        info = plistlib.loads((app / "Info.plist").read_bytes())
        entitlements = simulator_entitlements(app / info["CFBundleExecutable"])
        expected = f"{team}.{info['CFBundleIdentifier']}"
        if entitlements.get("application-identifier") != expected:
            raise ValueError(f"Missing or incorrect application-identifier for {app.name}")
        if app != phone and not entitlements.get("com.apple.developer.healthkit"):
            raise ValueError("Watch simulator build is missing its HealthKit entitlement")
        print(f"Verified simulator signature and application identifier: {info['CFBundleIdentifier']}")


if __name__ == "__main__":
    main()
