"""Stage a private set of test clips (the animation libraries' Ready source videos) onto the Runpod network volume, so
the model can be tested on them from inside the GPU Pod (runtime/clip_eval.py). Clips never go into the image or the
repository: the set is built in a local scratch directory and uploaded to the volume, next to the model.

    # 1. build the set on the machine that has the libraries (small: ~105 MB; no model weights). --policy is required.
    python scripts/stage_clips.py build --out /tmp/rhythm-clips --policy POLICY.json \
        --library "~/Documents/Aigame/ForgeData/library/animations" \
        --motionlib-manifest MANIFEST.csv --motionlib-dir DIR --motionlib-id ID [--motionlib-id ID ...] \
        [--include-confirm] [--exclude ID ...]
    # 2. upload it (resumable, checksummed; same Runpod S3 variables as stage_model.py)
    python scripts/stage_clips.py upload --src /tmp/rhythm-clips --target s3 --set ready-2026-10-22
    python scripts/stage_clips.py upload --src /tmp/rhythm-clips --target s3 --set ready-2026-10-22 --verify-only

On the volume (in the Pod: /workspace/rhythm/test-clips/<set>/):
    clips/<id>.mp4            the source clip the motion pipeline used (trimmed original footage), metadata stripped
    clips.json                one entry per clip: id, file, sha256, bytes, name, labels, category, tags, licence,
                              attribution, url, permitted uses, review status, duration, has_audio; the policy used
                              and every clip left out with its reason
    .rhythm/COMPLETE.json     written last; clip_eval.py refuses a set without it
An upload also deletes clips that are no longer in the set (e.g. excluded since the previous upload).

The policy file (kept with the private library, not in this repository) decides what may be used:
    exclude            {id: reason}  never used (e.g. a possible minor)
    exclude_licenses   [text ...]    never used when the clip's licence/origin/terms contain this text (e.g. "mixkit")
    confirm            {id: reason}  used only with --include-confirm (the owner confirmed these individual clips)
    confirm_origins    [text ...]    research/study footage: used only if the clip is also listed under confirm and
                                     --include-confirm is given
    reviewed           [id ...]      every clip that may be staged at all; a new Ready clip that nobody reviewed stops
                                     the build (--allow-unreviewed overrides)
Container metadata (e.g. GPS location tags) is stripped: only the video and audio streams are copied.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage_model import LocalTarget, S3Target, StageError, log  # noqa: E402

SCHEMA = "rhythm.clip-set/1"
COMPLETE = ".rhythm/COMPLETE.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def probe(path: Path) -> dict:
    """Duration, size and whether there is an audio stream (ffprobe if present; otherwise unknown)."""
    if not shutil.which("ffprobe"):
        return {}
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                             capture_output=True, text=True, timeout=60, check=True).stdout
    except (subprocess.SubprocessError, OSError):
        return {}
    d = json.loads(out)
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    return {"duration_s": round(float(d.get("format", {}).get("duration") or 0), 3),
            "width": v.get("width"), "height": v.get("height"),
            "has_audio": any(s.get("codec_type") == "audio" for s in d.get("streams", []))}


def library_clips(lib: Path, statuses: set[str]) -> list[dict]:
    """GameForge library entries with the wanted review status, with the source clip their motion was made from."""
    out = []
    for rec_path in sorted(lib.glob("*/record.json")):
        r = json.loads(rec_path.read_text())
        status = (r.get("review") or {}).get("status")
        if status not in statuses:
            continue
        try:
            video = json.loads((rec_path.parent / "source" / "run.json").read_text()).get("video") or ""
        except (OSError, ValueError):
            video = ""
        src = r.get("source") or {}
        out.append({"id": r["id"], "video": video, "name": r.get("name"), "labels": [r.get("name") or ""],
                    "category": r.get("category"), "tags": r.get("tags") or [], "review_status": status,
                    "library": "gameforge", "license": src.get("license"), "attribution": src.get("attribution"),
                    "url": src.get("url"), "origin": src.get("origin"), "permitted_uses": src.get("permittedUses"),
                    "known_defects": (r.get("review") or {}).get("knownDefects") or []})
    return out


def motionlib_clips(manifest: Path, clip_dir: Path, ids: list[str]) -> list[dict]:
    """Clips of the motion-library dataset: metadata from its manifest.csv, files as downloaded with
    `hf download <owner>/motion-library --repo-type dataset --local-dir DIR --include <category>/<id>.mp4`."""
    rows = {r["id"]: r for r in csv.DictReader(open(manifest, newline=""))}
    out = []
    for i in ids:
        if i not in rows:
            raise StageError(f"--motionlib-id {i} is not in {manifest}")
        r = rows[i]
        path = clip_dir / r["category"] / f"{i}.mp4"
        if not path.is_file():
            raise StageError(f"{path} is missing: download it first (hf download ... --include {r['category']}/{i}.mp4)")
        if r.get("sha256") and sha256(path) != r["sha256"]:
            raise StageError(f"{path}: sha256 differs from {manifest.name}")
        label = re.sub(r"_\d+$", "", i).split("_", 1)[-1].replace("_", " ")      # gym_curl_001 -> "curl"
        out.append({"id": i, "video": str(path), "name": (r.get("movement") or "")[:160], "labels": [label],
                    "category": r.get("category"), "tags": [r.get("category") or ""], "review_status": "ready",
                    "library": "motion-library", "license": r.get("licence"),
                    "attribution": f"Video by {r.get('creator')} ({r.get('source_url')})", "url": r.get("source_url"),
                    "origin": "Pexels" if "pexels.com" in (r.get("source_url") or "") else r.get("source_url"),
                    "permitted_uses": r.get("licence_url"), "known_defects": [r.get("issues") or ""]})
    return out


def extra_clips(d: Path) -> list[dict]:
    """Clips from another source: <id>.mp4 with an optional <id>.json holding the same metadata fields."""
    out = []
    for mp4 in sorted(d.glob("*.mp4")):
        meta = json.loads(mp4.with_suffix(".json").read_text()) if mp4.with_suffix(".json").is_file() else {}
        out.append({"library": "extra", "review_status": "ready", **meta, "id": meta.get("id") or mp4.stem,
                    "video": str(mp4)})
    return out


def strip_metadata(src: Path, dst: Path) -> None:
    """Copy only the video/audio streams (no re-encode), dropping container metadata such as GPS location tags."""
    tmp = dst.with_name(f".{dst.name}.partial.mp4")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-map", "0:v", "-map", "0:a?", "-c", "copy",
                        "-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact", str(tmp)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise StageError(f"ffmpeg could not copy {src}: {r.stderr.strip()[:300]}")
    os.replace(tmp, dst)


def apply_policy(clips: list[dict], pol: dict | None, a) -> tuple[list[dict], dict[str, str]]:
    """The clips that may be staged, and {id: reason} for every clip left out."""
    left_out = {i: "--exclude" for i in a.exclude or []}
    unknown = set(left_out) - {c["id"] for c in clips}
    if unknown:
        raise StageError(f"--exclude ids not in the set: {sorted(unknown)}")
    if pol is None:
        return [c for c in clips if c["id"] not in left_out], left_out
    excl_text = [t.lower() for t in pol.get("exclude_licenses", [])]
    confirm_text = [t.lower() for t in pol.get("confirm_origins", [])]
    confirm_ids = pol.get("confirm", {})
    for c in clips:
        if c["id"] in left_out:
            continue
        terms = " ".join(str(c.get(k) or "") for k in ("license", "origin", "url", "attribution", "permitted_uses")).lower()
        if c["id"] in pol.get("exclude", {}):
            left_out[c["id"]] = f"policy exclude: {pol['exclude'][c['id']]}"
        elif any(t in terms for t in excl_text):
            left_out[c["id"]] = f"policy licence rule: terms mention {[t for t in excl_text if t in terms]}"
        elif c["id"] in confirm_ids and not a.include_confirm:
            left_out[c["id"]] = f"policy confirm (not confirmed): {confirm_ids[c['id']]}"
        elif any(t in terms for t in confirm_text) and not (a.include_confirm and c["id"] in confirm_ids):
            left_out[c["id"]] = "policy origin rule: research/study footage not individually confirmed"
    kept = [c for c in clips if c["id"] not in left_out]
    if "reviewed" in pol and not a.allow_unreviewed:
        unreviewed = sorted(c["id"] for c in kept if c["id"] not in set(pol["reviewed"]))
        if unreviewed:
            raise StageError(f"{len(unreviewed)} clip(s) are not in the policy's 'reviewed' list: {unreviewed[:10]}. "
                             "Review their licence and content, then add them to 'reviewed' (or to 'exclude').")
    return kept, left_out


def build(a) -> int:
    if not a.keep_metadata and not shutil.which("ffmpeg"):
        raise StageError("ffmpeg is needed to strip container metadata (GPS tags) from the clips; install it or pass "
                         "--keep-metadata after checking the clips yourself")
    pol, policy_rec = None, None
    if a.policy:
        pp = Path(os.path.expanduser(a.policy))
        pol = json.loads(pp.read_text())
        policy_rec = {"file": pp.name, "sha256": sha256(pp), "include_confirm": a.include_confirm,
                      "allow_unreviewed": a.allow_unreviewed}
    lib = Path(os.path.expanduser(a.library)) if a.library else None
    clips = library_clips(lib, set(a.status)) if lib and lib.is_dir() else []
    if lib and not lib.is_dir():
        raise StageError(f"--library {lib} is not a directory")
    if a.motionlib_id:
        if not (a.motionlib_manifest and a.motionlib_dir):
            raise StageError("--motionlib-id needs --motionlib-manifest and --motionlib-dir")
        clips += motionlib_clips(Path(os.path.expanduser(a.motionlib_manifest)),
                                 Path(os.path.expanduser(a.motionlib_dir)), a.motionlib_id)
    for d in a.extra_dir or []:
        clips += extra_clips(Path(os.path.expanduser(d)))
    dup = sorted({c["id"] for c in clips if sum(1 for x in clips if x["id"] == c["id"]) > 1})
    if dup:
        raise StageError(f"duplicate clip ids: {dup}")
    kept, left_out = apply_policy(clips, pol, a)
    for i, why in sorted(left_out.items()):
        log(f"  left out {i}: {why}")
    out = Path(a.out)
    (out / "clips").mkdir(parents=True, exist_ok=True)
    entries, missing = [], []
    for c in kept:
        src = Path(c.pop("video") or "/nonexistent")
        if not src.is_file():
            missing.append(f"{c['id']}: {src}")
            continue
        dst = out / "clips" / f"{c['id']}.mp4"
        if a.keep_metadata:
            shutil.copyfile(src, dst)
        else:
            strip_metadata(src, dst)
        entries.append({**c, "file": f"clips/{c['id']}.mp4", "bytes": dst.stat().st_size, "sha256": sha256(dst),
                        **probe(dst)})
    if missing:
        raise StageError(f"{len(missing)} source clip(s) not found: {missing[:5]}")
    for p in (out / "clips").glob("*.mp4"):              # e.g. a clip left out since the last build
        if p.stem not in {e["id"] for e in entries}:
            p.unlink()
    manifest = {"schema": SCHEMA, "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "count": len(entries), "total_bytes": sum(e["bytes"] for e in entries),
                "metadata_stripped": not a.keep_metadata, "policy": policy_rec,
                "left_out": [{"id": i, "reason": why} for i, why in sorted(left_out.items())], "clips": entries}
    (out / "clips.json").write_text(json.dumps(manifest, indent=1))
    lic: dict[str, int] = {}
    for e in entries:
        lic[e.get("license") or "?"] = lic.get(e.get("license") or "?", 0) + 1
    log(f"built {len(entries)} clips ({len(left_out)} left out), {manifest['total_bytes'] / 1e6:.1f} MB in {out} "
        f"({sum(1 for e in entries if e.get('has_audio'))} with audio); licences: {lic}")
    return 0


def upload(a) -> int:
    src = Path(a.src)
    local_manifest = (src / "clips.json").read_bytes()
    manifest = json.loads(local_manifest)
    if manifest.get("schema") != SCHEMA:
        raise StageError(f"{src}/clips.json is not a {SCHEMA} manifest (run `build` first)")
    if not manifest.get("policy") and not a.no_policy:
        raise StageError(f"{src} was built without a policy: rebuild with --policy (or pass --no-policy for a "
                         "synthetic test set)")
    prefix = f"rhythm/test-clips/{a.set}"
    target = S3Target(prefix) if a.target == "s3" else LocalTarget(os.path.join(a.dest, a.set))
    log(f"{manifest['count']} clips ({manifest['total_bytes'] / 1e6:.1f} MB) -> {target.describe()}")
    wanted = {e["file"] for e in manifest["clips"]}
    stale = sorted(k for k in target.list("clips/") if k not in wanted)
    todo = [e for e in manifest["clips"] if target.size(e["file"]) != e["bytes"]]
    log(f"already staged: {manifest['count'] - len(todo)}; to do: {len(todo)}; no longer in the set: {len(stale)}")
    if a.verify_only:
        problems = [e["file"] for e in todo] + [f"{k} (not in the set)" for k in stale]
        remote = target.get_bytes("clips.json")
        if remote is None:
            problems.append("clips.json missing")
        elif remote != local_manifest:
            problems.append("clips.json on the volume differs from the local build")
        if target.get_bytes(COMPLETE) is None:
            problems.append(COMPLETE)
        log(("VERIFY FAILED: " + ", ".join(problems[:10])) if problems else
            f"VERIFY OK: {manifest['count']} clips at the expected sizes, nothing extra, manifest identical, "
            "completion marker present")
        return 1 if problems else 0
    if a.dry_run:
        for e in todo:
            log(f"  would stage {e['file']} ({e['bytes'] / 1e6:.1f} MB)")
        for k in stale:
            log(f"  would delete {k}")
        return 0
    if todo or stale:
        target.delete(COMPLETE)
    for i, e in enumerate(todo, 1):
        local = src / e["file"]
        if sha256(local) != e["sha256"]:
            raise StageError(f"{local} changed since `build` (sha256 differs); re-run build")
        target.put_file(local, e["file"])
        if target.size(e["file"]) != e["bytes"]:
            raise StageError(f"{e['file']}: size on the volume differs after upload")
        log(f"[{i}/{len(todo)}] {e['file']} {e['bytes'] / 1e6:.1f} MB")
    for k in stale:
        target.delete(k)
        log(f"deleted {k} (no longer in the set)")
    target.put_bytes(local_manifest, "clips.json")
    target.put_bytes(json.dumps({"schema": SCHEMA, "count": manifest["count"],
                                 "completed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}).encode(),
                     COMPLETE)
    log(f"DONE: in the Pod: /workspace/{prefix}/ (clip_eval.py --clips /workspace/{prefix})" if a.target == "s3"
        else f"DONE: {os.path.join(a.dest, a.set)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="collect the clips + metadata into a local directory")
    b.add_argument("--out", required=True)
    b.add_argument("--policy", help="the clip policy JSON (required unless --no-policy)")
    b.add_argument("--no-policy", action="store_true", help="only for synthetic test sets")
    b.add_argument("--include-confirm", action="store_true", help="also include the policy's confirmed clips")
    b.add_argument("--allow-unreviewed", action="store_true", help="do not stop on clips missing from 'reviewed'")
    b.add_argument("--library", help="GameForge library dir (e.g. ~/Documents/Aigame/ForgeData/library/animations)")
    b.add_argument("--status", action="append", default=None, help="library review status to include (default: ready)")
    b.add_argument("--motionlib-manifest", help="motion-library manifest.csv")
    b.add_argument("--motionlib-dir", help="local copy of the dataset (<category>/<id>.mp4)")
    b.add_argument("--motionlib-id", action="append", help="motion-library clip id (repeatable)")
    b.add_argument("--extra-dir", action="append", help="directory of <id>.mp4 (+ <id>.json metadata) to add")
    b.add_argument("--exclude", action="append", help="clip id to leave out (repeatable)")
    b.add_argument("--keep-metadata", action="store_true", help="copy files unchanged (default: strip metadata)")
    u = sub.add_parser("upload", help="upload a built set to the network volume (or a local dir)")
    u.add_argument("--src", required=True)
    u.add_argument("--set", required=True, help="set name, e.g. ready-2026-10-22")
    u.add_argument("--target", choices=["s3", "local"], required=True)
    u.add_argument("--dest", help="--target local: parent directory (e.g. /workspace/rhythm/test-clips)")
    u.add_argument("--dry-run", action="store_true")
    u.add_argument("--verify-only", action="store_true")
    u.add_argument("--no-policy", action="store_true", help="accept a set built with --no-policy (tests only)")
    a = ap.parse_args()
    try:
        if a.cmd == "build":
            if not a.policy and not a.no_policy:
                ap.error("--policy is required (the clip policy decides which footage may be used); "
                         "--no-policy only for synthetic test sets")
            a.status = a.status or ["ready"]
            return build(a)
        if a.target == "local" and not a.dest:
            ap.error("--target local needs --dest")
        return upload(a)
    except StageError as e:
        log(f"ERROR: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
