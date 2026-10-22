"""Stage MiniCPM-o 4.5 at a pinned revision onto a Runpod network volume through Runpod's S3-compatible API, from any
Linux CPU machine (CI runner, small VM). No GPU Pod and no Pod at all is needed, and nothing is downloaded at run time.

    # from the repo's GitHub Actions workflow (.github/workflows/minicpm-o-stage-model.yml), or by hand:
    export RUNPOD_S3_ACCESS_KEY_ID=user_...        # Runpod user id (Settings -> S3 API Keys)
    export RUNPOD_S3_SECRET_ACCESS_KEY=rps_...     # the S3 API key's secret (never printed)
    export RUNPOD_VOLUME_ID=...                    # network volume id = bucket name
    export RUNPOD_DATACENTER=US-KS-2               # the volume's data centre = region
    python scripts/stage_model.py --target s3 --dry-run     # plan only: lists what would be uploaded
    python scripts/stage_model.py --target s3               # stage (resumable; re-run after any failure)
    python scripts/stage_model.py --target s3 --verify-only # check every object's size against the pinned listing

    python scripts/stage_model.py --target local --dest /workspace/models/openbmb/MiniCPM-o-4_5/<rev>   # from a Pod

Layout on the volume (mounted at /workspace in a Pod), matching the image's default MODEL_DIR:
    models/<MODEL_ID>/<REVISION>/<repo files...>
    models/<MODEL_ID>/<REVISION>/.rhythm/manifest.json   every file with size and sha256 (LFS) or git blob id
    models/<MODEL_ID>/<REVISION>/.rhythm/COMPLETE.json   written last; the container's preflight requires it

Per file: skip it when the volume already has it at the expected size (idempotent, resumable); otherwise download it
at the pinned revision into a scratch dir, verify its sha256 / git blob id against the Hub listing, upload it (multipart,
parts of at most 500 MB as Runpod requires), check the uploaded size, and delete the scratch copy (so the machine needs
free disk for one file, about 5 GB, not the whole 20 GB). Objects are regular files on the volume: S3 has no symlinks,
and the local target replaces any symlink with a real file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

MANIFEST = ".rhythm/manifest.json"
COMPLETE = ".rhythm/COMPLETE.json"
MANIFEST_SCHEMA = "rhythm.model-manifest/1"
INCLUDE_MANIFEST = ".rhythm/manifest.include.json"       # --include runs (testing) never touch the real manifest
# Multipart part size. Runpod documents up to 500 MB per part, but its S3 gateway answers 413 (Request Entity Too
# Large) to a 256 MiB part, consistent with a ~100 MB proxy body limit; 64 MiB stays well below it.
PART = int(os.environ.get("RUNPOD_S3_PART_MB", "64")) * 1024 * 1024
VERSIONS = Path(__file__).resolve().parent.parent / "versions.env"
S3_DATACENTERS = {"EU-CZ-1", "EU-RO-1", "EUR-IS-1", "EUR-NO-1", "US-CA-2", "US-GA-2", "US-IL-1", "US-KS-2", "US-MD-1",
                  "US-MO-1", "US-MO-2", "US-NC-1", "US-NC-2", "US-NE-1", "US-WA-1"}


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc):%H:%M:%S} [stage] {msg}", flush=True)


class StageError(Exception):
    pass


def read_versions() -> dict:
    out = {}
    if VERSIONS.is_file():
        for line in VERSIONS.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def hub_listing(model_id: str, revision: str) -> list[dict]:
    """Every file of the repo at `revision`, with size and the hash the Hub records for it."""
    from huggingface_hub import HfApi  # noqa: PLC0415
    info = HfApi().model_info(model_id, revision=revision, files_metadata=True)
    if len(revision) == 40 and info.sha != revision:
        raise StageError(f"the Hub resolved {model_id}@{revision} to {info.sha}")
    files = []
    for s in info.siblings:
        lfs = s.lfs
        if lfs is not None:
            sha = lfs.sha256 if hasattr(lfs, "sha256") else lfs["sha256"]
            size = lfs.size if hasattr(lfs, "size") else lfs["size"]
            files.append({"path": s.rfilename, "size": int(size), "sha256": sha})
        else:
            if s.size is None or not s.blob_id:
                raise StageError(f"the Hub listing has no size/blob id for {s.rfilename}")
            files.append({"path": s.rfilename, "size": int(s.size), "git_oid": s.blob_id})
    files.sort(key=lambda f: f["path"])
    return files


def verify_file(path: Path, f: dict) -> None:
    size = path.stat().st_size
    if size != f["size"]:
        raise StageError(f"{f['path']}: downloaded {size} bytes, the Hub lists {f['size']}")
    if f.get("sha256"):
        h = hashlib.sha256()
    else:
        h = hashlib.sha1(f"blob {size}\0".encode())
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(8 << 20), b""):
            h.update(b)
    want = f.get("sha256") or f["git_oid"]
    if h.hexdigest() != want:
        raise StageError(f"{f['path']}: checksum {h.hexdigest()} != {want} (corrupt download; it was not uploaded)")


def download(model_id: str, revision: str, f: dict, scratch: Path) -> Path:
    from huggingface_hub import hf_hub_download  # noqa: PLC0415
    p = Path(hf_hub_download(model_id, f["path"], revision=revision, local_dir=str(scratch)))
    if p.is_symlink():                                            # never expected with local_dir; resolve to be safe
        real = p.resolve()
        p.unlink()
        shutil.copyfile(real, p)
    verify_file(p, f)
    return p


# --------------------------------------------------------------------------------------------------------- targets
class S3Target:
    def __init__(self, prefix: str):
        try:
            import boto3  # noqa: PLC0415
            from boto3.s3.transfer import TransferConfig  # noqa: PLC0415
            from botocore.config import Config  # noqa: PLC0415
        except ImportError as e:
            raise StageError("boto3 is not installed: create a venv and install the pinned staging requirements "
                             "(python3 -m venv .venv && .venv/bin/pip install --require-hashes -r "
                             "scripts/requirements-stage.txt), then run this script with .venv/bin/python") from e
        missing = [k for k in ("RUNPOD_S3_ACCESS_KEY_ID", "RUNPOD_S3_SECRET_ACCESS_KEY", "RUNPOD_VOLUME_ID",
                               "RUNPOD_DATACENTER") if not os.environ.get(k)]
        if missing:
            raise StageError(f"missing environment: {', '.join(missing)}. Create an S3 API key in Runpod (Settings -> "
                             "S3 API Keys: access key = your user_... id, secret = rps_...), and use the network "
                             "volume's id and data centre (Storage -> the volume).")
        self.dc = os.environ["RUNPOD_DATACENTER"].upper()
        # RUNPOD_S3_ENDPOINT overrides the derived endpoint (a data centre added after this list, or a local test)
        self.endpoint = os.environ.get("RUNPOD_S3_ENDPOINT") or f"https://s3api-{self.dc.lower()}.runpod.io/"
        if self.dc not in S3_DATACENTERS and not os.environ.get("RUNPOD_S3_ENDPOINT"):
            raise StageError(f"RUNPOD_DATACENTER={self.dc} has no Runpod S3 endpoint (supported: "
                             f"{', '.join(sorted(S3_DATACENTERS))}); create the volume in one of those")
        self.bucket = os.environ["RUNPOD_VOLUME_ID"]
        self.prefix = prefix.strip("/")
        self.s3 = boto3.client(
            "s3", endpoint_url=self.endpoint, region_name=self.dc,
            aws_access_key_id=os.environ["RUNPOD_S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["RUNPOD_S3_SECRET_ACCESS_KEY"],
            config=Config(retries={"mode": "standard", "max_attempts": 10}, read_timeout=7200, connect_timeout=60,
                          s3={"addressing_style": "path"},
                          # boto3 >= 1.36 adds CRC checksums to every upload by default; send them only where the
                          # S3 API requires them, for compatibility with S3-compatible stores
                          request_checksum_calculation="when_required",
                          response_checksum_validation="when_required"))
        self.transfer = TransferConfig(multipart_threshold=PART, multipart_chunksize=PART, max_concurrency=4,
                                       use_threads=True)

    def describe(self) -> str:
        return f"s3://{self.bucket}/{self.prefix}/ via {self.endpoint} (region {self.dc})"

    def key(self, rel: str) -> str:
        return f"{self.prefix}/{rel}"

    def size(self, rel: str) -> int | None:
        from botocore.exceptions import ClientError  # noqa: PLC0415
        try:
            return int(self.s3.head_object(Bucket=self.bucket, Key=self.key(rel))["ContentLength"])
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def put_file(self, src: Path, rel: str) -> None:
        self.s3.upload_file(str(src), self.bucket, self.key(rel), Config=self.transfer)

    def put_bytes(self, data: bytes, rel: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=self.key(rel), Body=data)

    def get_bytes(self, rel: str) -> bytes | None:
        from botocore.exceptions import ClientError  # noqa: PLC0415
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=self.key(rel))["Body"].read()
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def delete(self, rel: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=self.key(rel))      # single-object delete (no DeleteObjects)

    def list(self, rel_prefix: str) -> list[str]:
        """Keys under rel_prefix, relative to this target's prefix."""
        out = []
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=self.key(rel_prefix)):
            out += [o["Key"][len(self.prefix) + 1:] for o in page.get("Contents", [])]
        return out


class LocalTarget:
    def __init__(self, dest: str):
        self.root = Path(dest)

    def describe(self) -> str:
        return str(self.root)

    def size(self, rel: str) -> int | None:
        p = self.root / rel
        if p.is_symlink() or not p.is_file():                     # symlinks are replaced with real files
            return None
        return p.stat().st_size

    def put_file(self, src: Path, rel: str) -> None:
        dst = self.root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(f".{dst.name}.partial")
        shutil.copyfile(src, tmp)
        if dst.is_symlink():
            dst.unlink()
        os.replace(tmp, dst)                                      # atomic: a crash never leaves a short file in place

    def put_bytes(self, data: bytes, rel: str) -> None:
        dst = self.root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(f".{dst.name}.partial")
        tmp.write_bytes(data)
        os.replace(tmp, dst)

    def get_bytes(self, rel: str) -> bytes | None:
        p = self.root / rel
        return p.read_bytes() if p.is_file() else None

    def delete(self, rel: str) -> None:
        (self.root / rel).unlink(missing_ok=True)

    def list(self, rel_prefix: str) -> list[str]:
        base = self.root / rel_prefix
        return sorted(str(p.relative_to(self.root)) for p in base.rglob("*") if p.is_file()) if base.is_dir() else []


# ------------------------------------------------------------------------------------------------------------ main
def main() -> int:
    v = read_versions()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model-id", default=v.get("MODEL_ID", "openbmb/MiniCPM-o-4_5"))
    ap.add_argument("--revision", default=v.get("MODEL_REVISION"), help="full commit sha (default: versions.env)")
    ap.add_argument("--target", choices=["s3", "local"], required=True)
    ap.add_argument("--prefix", help="key prefix on the volume (default models/<model-id>/<revision>)")
    ap.add_argument("--dest", help="--target local: the model directory to fill")
    ap.add_argument("--scratch", help="download dir (default: a temp dir; needs free space for the largest file)")
    ap.add_argument("--dry-run", action="store_true", help="list what would be uploaded; change nothing")
    ap.add_argument("--verify-only", action="store_true", help="check the staged copy against the pinned listing")
    ap.add_argument("--include", action="append",
                    help="stage only these paths (testing): never writes the real manifest or the completion marker")
    a = ap.parse_args()
    if not a.revision or len(a.revision) != 40:
        ap.error("--revision must be a full 40-character commit sha (pinned in versions.env)")
    t0 = time.time()
    try:
        if a.target == "s3":
            target = S3Target(a.prefix or f"models/{a.model_id}/{a.revision}")
        else:
            if not a.dest:
                ap.error("--target local needs --dest")
            target = LocalTarget(a.dest)
        log(f"{a.model_id}@{a.revision} -> {target.describe()}")
        files = hub_listing(a.model_id, a.revision)
        total = sum(f["size"] for f in files)
        log(f"Hub listing: {len(files)} files, {total / 1e9:.2f} GB")
        if a.include:
            unknown = sorted(set(a.include) - {f["path"] for f in files})
            if unknown:
                raise StageError(f"--include paths not in the repo: {unknown}")
            files = [f for f in files if f["path"] in set(a.include)]

        todo, have = [], 0
        for f in files:
            got = target.size(f["path"])
            if got == f["size"]:
                have += f["size"]
            else:
                todo.append((f, got))
        log(f"already staged: {len(files) - len(todo)} files ({have / 1e9:.2f} GB); to do: {len(todo)} files "
            f"({sum(f['size'] for f, _ in todo) / 1e9:.2f} GB)")
        for f, got in todo:
            state = "missing" if got is None else f"{got} bytes, expected {f['size']}"
            log(f"  {'would stage' if a.dry_run else 'to stage' if not a.verify_only else 'BAD'} {f['path']} ({state})")

        def manifest_problem() -> str | None:
            """Why the manifest on the target does not describe exactly this revision's files (None if it does)."""
            raw = target.get_bytes(INCLUDE_MANIFEST if a.include else MANIFEST)
            if raw is None:
                return "manifest missing"
            try:
                man = json.loads(raw)
            except ValueError:
                return "manifest is not valid JSON"
            if man.get("schema") != MANIFEST_SCHEMA or man.get("revision") != a.revision:
                return f"manifest is for {man.get('schema')} / revision {man.get('revision')}"
            if [(m.get("path"), m.get("size")) for m in man.get("files", [])] != [(f["path"], f["size"]) for f in files]:
                return "manifest file list differs from the pinned revision's listing"
            return None

        if a.verify_only:
            problems = [f["path"] for f, _ in todo]
            mp = manifest_problem()
            if mp:
                problems.append(mp)
            if not a.include and target.get_bytes(COMPLETE) is None:
                problems.append(COMPLETE + " missing")
            if problems:
                log(f"VERIFY FAILED: {len(problems)} problem(s): {', '.join(problems[:5])}; re-run without "
                    "--verify-only to repair")
                return 1
            log(f"VERIFY OK: {len(files)} files at the expected sizes, manifest present" +
                ("" if a.include else ", completion marker present"))
            return 0
        if a.dry_run:
            log("dry run: nothing changed")
            return 0
        if not todo and not a.include and target.get_bytes(COMPLETE) is not None and manifest_problem() is None:
            log("already complete: every file is staged, the manifest matches and the completion marker is present")
            return 0
        if not a.include:
            target.delete(COMPLETE)                       # the copy is incomplete until this run writes it again

        scratch_root = Path(a.scratch or tempfile.mkdtemp(prefix="stage-minicpm-o-"))
        scratch_root.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(scratch_root).free
        biggest = max((f["size"] for f, _ in todo), default=0)
        if free < biggest * 1.05:
            raise StageError(f"{scratch_root} has {free / 1e9:.1f} GB free; the largest file needs "
                             f"{biggest / 1e9:.1f} GB (use --scratch on a bigger disk)")
        for i, (f, _) in enumerate(todo, 1):
            t = time.time()
            local = download(a.model_id, a.revision, f, scratch_root)
            t_dl = time.time() - t
            target.put_file(local, f["path"])
            got = target.size(f["path"])
            if got != f["size"]:
                raise StageError(f"{f['path']}: the volume reports {got} bytes after upload, expected {f['size']}")
            local.unlink()
            log(f"[{i}/{len(todo)}] {f['path']} {f['size'] / 1e6:.1f} MB: downloaded+verified {t_dl:.0f}s, "
                f"uploaded {time.time() - t - t_dl:.0f}s")
        if not a.scratch:
            shutil.rmtree(scratch_root, ignore_errors=True)

        manifest = {"schema": MANIFEST_SCHEMA, "model_id": a.model_id, "revision": a.revision,
                    "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "total_bytes": sum(f["size"] for f in files), "files": files}
        if a.include:
            target.put_bytes(json.dumps(manifest, indent=1).encode(), INCLUDE_MANIFEST)
            log(f"--include: staged {len(files)} file(s); the real manifest and the completion marker are untouched")
            return 0
        target.put_bytes(json.dumps(manifest, indent=1).encode(), MANIFEST)
        target.put_bytes(json.dumps({"revision": a.revision, "files": len(files), "total_bytes": manifest["total_bytes"],
                                     "completed_utc": manifest["created_utc"]}).encode(), COMPLETE)
        log(f"DONE: {len(files)} files, {manifest['total_bytes'] / 1e9:.2f} GB staged and verified in "
            f"{time.time() - t0:.0f}s; MODEL_DIR=/workspace/{a.prefix or f'models/{a.model_id}/{a.revision}'}"
            if a.target == "s3" else f"DONE in {time.time() - t0:.0f}s: MODEL_DIR={a.dest}")
        return 0
    except StageError as e:
        log(f"ERROR: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
