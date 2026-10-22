"""Write the demo's config.json (read by config.py next to it, /app/config.json) from the container environment.

Only fields of the demo's ServiceConfig schema (config.py @ 47709a92) are written; everything else keeps the demo's
defaults. Session recording is off: the input is camera video and microphone audio of real people, and the demo's
default would keep every session forever.
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    if v.lower() in ("1", "true", "yes", "on"):
        return True
    if v.lower() in ("0", "false", "no", "off"):
        return False
    raise SystemExit(f"[write_config] {name}={v!r}: use 1/0, true/false, yes/no or on/off")


def env_num(name: str, default: float, kind=float):
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    try:
        return kind(v)
    except ValueError:
        raise SystemExit(f"[write_config] {name}={v!r} is not a number")


def build() -> dict:
    model_dir = os.environ.get("MODEL_DIR", "")
    if not model_dir:
        raise SystemExit("[write_config] MODEL_DIR is not set")
    attn = os.environ.get("ATTN_IMPLEMENTATION", "sdpa")
    if attn not in ("auto", "sdpa", "flash_attention_2", "eager"):
        raise SystemExit(f"[write_config] ATTN_IMPLEMENTATION={attn!r}: one of auto, sdpa, flash_attention_2, eager")
    if attn == "flash_attention_2":
        raise SystemExit("[write_config] ATTN_IMPLEMENTATION=flash_attention_2 needs the flash-attn package, which this "
                         "image does not include; use sdpa")
    state = os.environ.get("RHYTHM_STATE_DIR", "/workspace/rhythm")
    # The duplex model speaks in the language of its reference voice: with the demo's default voice
    # (ref_minicpm_signature.wav) it answers in Chinese even to an English system prompt. Sessions that send no voice
    # of their own use this one; the demo's English preset uses ref_en_dlc_1.wav. Relative to the demo dir (/app).
    ref_audio = os.environ.get("RHYTHM_REF_AUDIO", "assets/ref_audio/ref_en_dlc_1.wav")
    return {
        "model": {"model_path": model_dir, "pt_path": None, "attn_implementation": attn},
        "audio": {"ref_audio_path": ref_audio},
        "service": {
            "gateway_port": int(env_num("GATEWAY_PORT", 8006, int)),
            "worker_base_port": int(env_num("WORKER_PORT", 22400, int)),
            # one GPU worker serves one session at a time; a short queue instead of the demo's 1000
            "max_queue_size": int(env_num("RHYTHM_MAX_QUEUE", 4, int)),
            "request_timeout": float(env_num("RHYTHM_REQUEST_TIMEOUT_S", 300.0)),
            "compile": env_bool("TORCH_COMPILE", False),
            "data_dir": os.path.join(state, "data"),
        },
        "recording": {
            "enabled": env_bool("RHYTHM_RECORD_SESSIONS", False),
            "session_retention_days": int(env_num("RHYTHM_RECORDING_RETENTION_DAYS", 7, int)),
            "max_storage_gb": float(env_num("RHYTHM_RECORDING_MAX_GB", 2.0)),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="/app/config.json")
    ap.add_argument("--print", action="store_true", help="print the config instead of writing it")
    a = ap.parse_args()
    cfg = build()
    ref = cfg["audio"]["ref_audio_path"]
    app_dir = os.path.dirname(os.path.abspath(a.out))
    if not a.print and not os.path.isfile(ref if os.path.isabs(ref) else os.path.join(app_dir, ref)):
        raise SystemExit(f"[write_config] reference voice {ref} not found under {app_dir} (RHYTHM_REF_AUDIO)")
    text = json.dumps(cfg, indent=2) + "\n"
    if a.print:
        sys.stdout.write(text)
        return 0
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.replace(tmp, a.out)
    print(f"[write_config] wrote {a.out}: model_path={cfg['model']['model_path']} attn={cfg['model']['attn_implementation']} "
          f"compile={cfg['service']['compile']} recording={cfg['recording']['enabled']} voice={cfg['audio']['ref_audio_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
