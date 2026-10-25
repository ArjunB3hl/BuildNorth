"""Startup preflight for the MiniCPM-o 4.5 container: fail fast, before any process loads the model, with an
actionable message.

Checks: access token, model mount and staged snapshot (manifest + completion marker written by
scripts/stage_model.py, revision, every file present with its size or sha256), the JSON configs the loader parses,
writable cache/log dirs and free disk, free local ports, Hugging Face offline mode, and the GPU (driver, VRAM,
CUDA from PyTorch, bf16).

    python preflight.py                 # all checks (GPU included)
    python preflight.py --skip-gpu      # CPU-only validation (CI); reports the GPU checks as skipped
    MODEL_VERIFY=sha256 python preflight.py   # hash every file (about 1-2 min for 20 GB on a network volume)

Exit codes: 0 ok, 2 configuration / access token, 3 model files, 4 GPU, 5 disk / ports.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time

MANIFEST = ".rhythm/manifest.json"
COMPLETE = ".rhythm/COMPLETE.json"
MANIFEST_SCHEMA = "rhythm.model-manifest/1"

# Files the PyTorch streaming backend reads (loader, tokenizer, processor, weights, token2wav vocoder for speech
# output). They must be in the manifest too; listing them here catches a hand-copied or truncated model directory.
REQUIRED = [
    "config.json", "generation_config.json", "preprocessor_config.json",
    "tokenizer_config.json", "tokenizer.json", "vocab.json", "merges.txt", "added_tokens.json", "special_tokens_map.json",
    "configuration_minicpmo.py", "modeling_minicpmo.py", "modeling_navit_siglip.py", "processing_minicpmo.py",
    "tokenization_minicpmo_fast.py", "utils.py",
    "model.safetensors.index.json",
    "assets/token2wav/campplus.onnx", "assets/token2wav/flow.pt", "assets/token2wav/flow.yaml",
    "assets/token2wav/hift.pt", "assets/token2wav/speech_tokenizer_v2_25hz.onnx",
]
JSON_FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer_config.json",
              "model.safetensors.index.json", "added_tokens.json", "special_tokens_map.json"]
PORTS = {"RHYTHM_PUBLIC_PORT": 8000, "GATEWAY_PORT": 8006, "GATEWAY_INTERNAL_PORT": 8007,
         "WORKER_PORT": 22400, "BACKEND_PORT": 22500}
TOKEN_RE = re.compile(r"^[A-Za-z0-9._~-]{32,256}$")


class Fail(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


results: list[dict] = []


def ok(name: str, detail: str) -> None:
    results.append({"check": name, "status": "ok", "detail": detail})
    print(f"[preflight] ok    {name}: {detail}", flush=True)


def skip(name: str, detail: str) -> None:
    results.append({"check": name, "status": "skipped", "detail": detail})
    print(f"[preflight] SKIP  {name}: {detail}", flush=True)


def warn(name: str, detail: str) -> None:
    results.append({"check": name, "status": "warning", "detail": detail})
    print(f"[preflight] WARN  {name}: {detail}", flush=True)


# ----------------------------------------------------------------------------------------------------------- checks
def check_token() -> None:
    tok = os.environ.get("RHYTHM_API_TOKEN", "")
    if not tok:
        raise Fail(2, "RHYTHM_API_TOKEN is not set. Create a Runpod secret (Settings -> Secrets, e.g. 'rhythm_api_token' "
                      "holding `openssl rand -hex 32`) and set RHYTHM_API_TOKEN={{ RUNPOD_SECRET_rhythm_api_token }} in "
                      "the template's environment variables. The public port refuses every request without it.")
    if "{{" in tok:
        raise Fail(2, "RHYTHM_API_TOKEN holds an unresolved secret reference: the Runpod secret it names does not "
                      "exist. Check the secret's key in Runpod (Credentials -> Secrets) and the template's "
                      "RHYTHM_API_TOKEN value, or name the secret RUNPOD_SECRET_RHYTHM_API_TOKEN (picked up directly).")
    if not TOKEN_RE.fullmatch(tok):        # fullmatch: a trailing newline would break Caddy's config
        raise Fail(2, "RHYTHM_API_TOKEN must be 32-256 characters of A-Z a-z 0-9 . _ ~ - (it is compared in Caddy and "
                      "carried in a cookie); generate one with `openssl rand -hex 32`.")
    ok("access token", f"set ({len(tok)} characters; value not shown)")


def check_offline() -> None:
    bad = [k for k in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE") if os.environ.get(k) != "1"]
    if bad:
        raise Fail(2, f"{', '.join(bad)} must be 1: startup must load the staged files, never download. The image sets "
                      "them; do not override them in the template.")
    ok("offline mode", "HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1")


def git_blob_sha1(path: str, size: int) -> str:
    h = hashlib.sha1(f"blob {size}\0".encode())
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(8 << 20), b""):
            h.update(b)
    return h.hexdigest()


def check_model() -> None:
    model_dir = os.environ.get("MODEL_DIR", "")
    rev = os.environ.get("MODEL_REVISION", "")
    mode = os.environ.get("MODEL_VERIFY", "size")
    if mode not in ("size", "sha256", "off"):
        raise Fail(2, f"MODEL_VERIFY={mode!r}: use size (default), sha256 or off")
    if not model_dir:
        raise Fail(2, "MODEL_DIR is not set (the image default is /workspace/models/<MODEL_ID>/<MODEL_REVISION>).")
    mount = "/workspace"
    if model_dir.startswith(mount + "/") and not os.path.ismount(mount):
        warn("volume mount", f"{mount} is not a mount point: the network volume may not be attached to this Pod "
                             "(attach it when creating the Pod; it cannot be added later)")
    if not os.path.isdir(model_dir):
        raise Fail(3, f"model directory {model_dir} does not exist. Attach the network volume that holds the staged "
                      f"model at /workspace, or stage it first: scripts/stage_model.py --revision {rev or '<rev>'} "
                      "(see README.md, 'Stage the model'). Startup never downloads the model.")
    mpath = os.path.join(model_dir, MANIFEST)
    if not os.path.isfile(mpath):
        raise Fail(3, f"{mpath} is missing: the directory was not staged by scripts/stage_model.py, or staging did not "
                      "finish. Re-run stage_model.py (it resumes and skips files already uploaded).")
    try:
        man = json.load(open(mpath))
    except (OSError, ValueError) as e:
        raise Fail(3, f"{mpath} is not valid JSON ({e}); re-run stage_model.py")
    if man.get("schema") != MANIFEST_SCHEMA:
        raise Fail(3, f"{mpath}: unknown schema {man.get('schema')!r} (expected {MANIFEST_SCHEMA})")
    if rev and man.get("revision") != rev:
        raise Fail(3, f"staged revision {man.get('revision')} does not match MODEL_REVISION={rev}: stage {rev} or "
                      "set MODEL_REVISION/MODEL_DIR to the staged one")
    cpath = os.path.join(model_dir, COMPLETE)
    if not os.path.isfile(cpath):
        raise Fail(3, f"{cpath} is missing: staging did not finish (it is written last). Re-run stage_model.py.")
    files = {f["path"]: f for f in man.get("files", [])}
    missing_req = [p for p in REQUIRED if p not in files]
    if missing_req:
        raise Fail(3, f"manifest lacks required files {missing_req}: the snapshot is not a complete MiniCPM-o 4.5 "
                      "checkpoint for the streaming backend")
    try:
        idx = json.load(open(os.path.join(model_dir, "model.safetensors.index.json")))
    except (OSError, ValueError) as e:
        raise Fail(3, f"model.safetensors.index.json is missing or invalid ({e}); re-run stage_model.py")
    shards = sorted(set(idx.get("weight_map", {}).values()))
    missing_shard = [s for s in shards if s not in files]
    if not shards or missing_shard:
        raise Fail(3, f"weight shards missing from the manifest: {missing_shard or 'index has no weight_map'}")
    problems, t0, hashed = [], time.time(), 0
    for path, f in sorted(files.items()):
        full = os.path.join(model_dir, path)
        if os.path.islink(full) and not os.path.exists(full):
            problems.append(f"{path}: broken symlink -> {os.readlink(full)}")
            continue
        if not os.path.isfile(full):
            problems.append(f"{path}: missing")
            continue
        size = os.path.getsize(full)
        if mode != "off" and size != f["size"]:
            problems.append(f"{path}: {size} bytes, expected {f['size']} (truncated or partial upload)")
            continue
        if mode == "sha256":
            if f.get("sha256"):
                got = sha256_file(full)
                if got != f["sha256"]:
                    problems.append(f"{path}: sha256 {got[:16]}... expected {f['sha256'][:16]}...")
            elif f.get("git_oid"):
                got = git_blob_sha1(full, size)
                if got != f["git_oid"]:
                    problems.append(f"{path}: git blob {got[:12]} expected {f['git_oid'][:12]}")
            hashed += size
    if problems:
        shown = "; ".join(problems[:8]) + (f"; ... {len(problems) - 8} more" if len(problems) > 8 else "")
        raise Fail(3, f"{len(problems)} model file problem(s) in {model_dir}: {shown}. Re-run stage_model.py for "
                      f"revision {man.get('revision')} (it re-uploads only bad or missing files).")
    for name in JSON_FILES:
        try:
            json.load(open(os.path.join(model_dir, name)))
        except ValueError as e:
            raise Fail(3, f"{name} does not parse as JSON ({e})")
    total = sum(f["size"] for f in files.values())
    how = f"sha256 of {hashed / 1e9:.1f} GB in {time.time() - t0:.0f}s" if mode == "sha256" else \
        ("sizes" if mode == "size" else "presence only (MODEL_VERIFY=off)")
    ok("model files", f"{len(files)} files, {total / 1e9:.2f} GB, revision {man.get('revision')}, verified by {how}")


def check_dirs() -> None:
    for var in ("RHYTHM_STATE_DIR", "RHYTHM_LOG_DIR", "TORCHINDUCTOR_CACHE_DIR", "HF_HOME"):
        d = os.environ.get(var)
        if not d:
            continue
        try:
            os.makedirs(d, exist_ok=True)
            probe = os.path.join(d, f".write-test-{os.getpid()}")
            open(probe, "w").close()
            os.remove(probe)
        except OSError as e:
            raise Fail(5, f"{var}={d} is not writable ({e}); it must be on the network volume (default under "
                          "/workspace/rhythm) or another writable path")
    need = float(os.environ.get("RHYTHM_MIN_FREE_GB", "2"))
    for d in {os.environ.get("RHYTHM_STATE_DIR", "/workspace/rhythm"), "/tmp"}:
        if os.path.isdir(d):
            free = shutil.disk_usage(d).free / 1e9
            if free < need:
                raise Fail(5, f"only {free:.1f} GB free under {d} (need {need} GB for caches and logs): grow the "
                              "volume or container disk")
    ok("writable dirs", "state, logs and caches writable; free disk above "
                        f"{os.environ.get('RHYTHM_MIN_FREE_GB', '2')} GB")


def check_ports() -> None:
    busy = []
    for var, default in PORTS.items():
        port = int(os.environ.get(var, default))
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                busy.append(f"{var}={port}")
    if busy:
        raise Fail(5, f"ports already in use: {', '.join(busy)} (another copy of the service is running in this "
                      "container?)")
    ok("ports", ", ".join(f"{var}={os.environ.get(var, default)}" for var, default in PORTS.items()) + " free")


def check_gpu() -> None:
    if not shutil.which("nvidia-smi"):
        raise Fail(4, "nvidia-smi not found: this container has no NVIDIA GPU attached. Deploy it on a GPU Pod "
                      "(48 GB: RTX A6000, A40, L40S, L40, RTX 6000 Ada).")
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=30, check=True)
    except (subprocess.SubprocessError, OSError) as e:
        raise Fail(4, f"nvidia-smi failed ({e}): the GPU or driver is not usable in this Pod")
    gpus = [l.split(", ") for l in out.stdout.strip().splitlines() if l.strip()]
    if not gpus:
        raise Fail(4, "nvidia-smi lists no GPU")
    name, mem_mib, driver = gpus[0][0], float(gpus[0][1]), gpus[0][2]
    if len(gpus) > 1:
        warn("gpu count", f"{len(gpus)} GPUs visible; this deployment runs one worker on GPU 0 only")
    min_drv = int(os.environ.get("RHYTHM_MIN_DRIVER_MAJOR", "570"))
    if int(driver.split(".")[0]) < min_drv:
        raise Fail(4, f"NVIDIA driver {driver} is older than R{min_drv}, which CUDA 12.8 (torch 2.8.0+cu128) needs. "
                      "Deploy on a host with CUDA 12.8+ (Runpod: filter by CUDA version 12.8 or newer).")
    min_gb = float(os.environ.get("MIN_VRAM_GB", "40"))
    if mem_mib / 1024 < min_gb:
        raise Fail(4, f"{name} has {mem_mib / 1024:.0f} GB of VRAM; this image is the PyTorch streaming profile, which "
                      f"needs at least {min_gb:.0f} GB here (upstream: >28 GB; ~21.5 GB after load plus session peaks). "
                      "A 24 GB GPU (RTX 3090/4090) needs the separate llama.cpp-omni profile (README.md, '24 GB GPUs'), "
                      "which is not this image.")
    try:
        import torch  # noqa: PLC0415 - imported only on GPU hosts
    except ImportError as e:
        raise Fail(4, f"PyTorch does not import ({e}): the image is broken; rebuild it")
    if not torch.cuda.is_available():
        raise Fail(4, f"torch {torch.__version__} (CUDA {torch.version.cuda}) cannot use the GPU with driver {driver}")
    cap = torch.cuda.get_device_capability(0)
    if cap < (8, 0):
        raise Fail(4, f"{name} is compute capability {cap[0]}.{cap[1]}; bf16 inference needs 8.0+ (Ampere or newer)")
    free, total = torch.cuda.mem_get_info(0)
    ok("gpu", f"{name}, {total / 2**30:.1f} GiB ({free / 2**30:.1f} free), driver {driver}, sm_{cap[0]}{cap[1]}, "
              f"torch {torch.__version__} CUDA {torch.version.cuda}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--skip-gpu", action="store_true", help="CPU-only validation: skip the GPU checks")
    ap.add_argument("--skip-ports", action="store_true", help="do not probe local ports")
    ap.add_argument("--json", help="write the results to this file")
    a = ap.parse_args()
    t0 = time.time()
    code, message = 0, "all checks passed"
    try:
        check_token()
        check_offline()
        check_model()
        check_dirs()
        if a.skip_ports:
            skip("ports", "--skip-ports")
        else:
            check_ports()
        if a.skip_gpu:
            skip("gpu", "--skip-gpu: CUDA, driver and VRAM are NOT verified")
        else:
            check_gpu()
    except Fail as e:
        code, message = e.code, str(e)
        print(f"[preflight] FAIL  {message}", flush=True)
        results.append({"check": "failure", "status": "failed", "detail": message, "exit_code": code})
    if a.json:
        with open(a.json, "w") as f:
            json.dump({"exit_code": code, "message": message, "seconds": round(time.time() - t0, 1),
                       "results": results}, f, indent=1)
    if code == 0:
        print(f"[preflight] {message} ({time.time() - t0:.1f}s)", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
