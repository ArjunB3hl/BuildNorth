#!/usr/bin/env python3
"""Build a public, static camera bundle. Never traverse .data or package local server/account files."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PARENT = "https://rhythm-buildnorth.expo.app"


def build(destination: Path) -> dict:
    if destination.exists():
        raise ValueError("Choose a new export directory; existing files are never removed by this builder.")
    web = ROOT / "web"
    destination.mkdir(parents=True)
    target = destination / "web"
    target.mkdir()
    # Only public source and pinned dependencies. No data, recordings, GLBs, clips, connections or server code.
    for name in ("app.js",):
        assert (web / "js" / name).is_file()
    shutil.copytree(web / "js", target / "js", ignore=shutil.ignore_patterns("*.map"))
    shutil.copy2(web / "embed.css", target / "embed.css")
    for vendor in ("tasks-vision-1.1.0", "elevenlabs-client-1.27.0", "three-0.170.0"):
        shutil.copytree(web / "vendor" / vendor, target / "vendor" / vendor,
                        symlinks=True, ignore=shutil.ignore_patterns("*.map", "node_modules", ".*"))
    sums = dict(line.split()[::-1] for line in (web / "models" / "SHA256SUMS").read_text().splitlines() if line.strip())
    (target / "models").mkdir()
    for kind in ("lite", "full", "heavy"):
        name = f"pose_landmarker_{kind}.task"
        source = web / "models" / name
        expected = sums.get(name) or sums.get(f"./{name}")
        if not expected or hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Pinned model checksum failed: {name}")
        shutil.copy2(source, target / "models" / name)
    version = hashlib.sha256(b"".join(p.read_bytes() for p in sorted((target / "js").rglob("*.js")))).hexdigest()[:16]
    html = (web / "index.html").read_text().replace('<html lang="en">', f'<html lang="en" data-hosted="true" data-version="{version}">')
    html = html.replace('Form check (3D demos)', 'Form check')
    (target / "index.html").write_text(html)
    (destination / "index.html").write_text(
        '<!doctype html><title>Rhythm camera coach</title><p>Open '
        f'<a href="{PARENT}/activity/camera">Camera workout on Rhythm</a>.</p>')
    config = destination / "_expo" / ".routes.json"
    config.parent.mkdir()
    config.write_text(json.dumps({"headers": {
        "Content-Security-Policy": f"frame-ancestors {PARENT}; base-uri 'self'; object-src 'none'",
        "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    }, "redirects": []}))
    (destination / "THIRD-PARTY-NOTICES.txt").write_text(
        "MediaPipe tasks-vision and Pose Landmarker: Google, Apache-2.0. "
        "https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE\n"
        "three.js: MIT license, included in web/vendor/three-0.170.0/build/LICENSE.\n"
        "ElevenLabs client: MIT license, included with its dependency notices in web/vendor/elevenlabs-client-1.27.0/.\n"
        "No private reference footage, motion-library models or account configuration is distributed.\n")
    files = list(destination.rglob("*"))
    if any(p.is_symlink() or p.suffix in {".glb", ".mp4", ".mov"} or p.name == ".env" for p in files):
        raise ValueError("Unexpected private or linked asset in public export")
    report = {"version": version, "files": sum(p.is_file() for p in files),
              "bytes": sum(p.stat().st_size for p in files if p.is_file()), "allowedParent": PARENT,
              "privateDataIncluded": False}
    (destination.parent / f"{destination.name}-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    print(json.dumps(build(parser.parse_args().destination.resolve()), indent=2))
