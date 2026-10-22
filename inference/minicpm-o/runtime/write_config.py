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


# duplex settings the backend accepts (core/schemas/duplex.py); an unknown key would end every session
DUPLEX_KEYS = {"decode_mode", "temperature", "top_k", "top_p", "text_repetition_penalty", "text_repetition_window_size",
               "length_penalty", "listen_prob_scale", "listen_top_k"}
FRAME_MODES = {"grid4", "1", "2", "3", "4"}


def page_config() -> dict:
    """Settings for the patched demo page (docker/patch_demo.py): frames per 1-second step and duplex settings."""
    mode = os.environ.get("RHYTHM_FRAME_MODE", "grid4")
    if mode not in FRAME_MODES:
        raise SystemExit(f"[write_config] RHYTHM_FRAME_MODE={mode!r}: one of {', '.join(sorted(FRAME_MODES))} (grid4 = the "
                         "current frame + one 2x2 grid of 4 samples per second; N = N frames per second)")
    raw = os.environ.get("RHYTHM_DUPLEX_CONFIG", "").strip() or "{}"
    try:
        duplex = json.loads(raw)
    except ValueError as e:
        raise SystemExit(f"[write_config] RHYTHM_DUPLEX_CONFIG is not valid JSON ({e})")
    if not isinstance(duplex, dict) or set(duplex) - DUPLEX_KEYS:
        raise SystemExit(f"[write_config] RHYTHM_DUPLEX_CONFIG must be a JSON object with keys from {sorted(DUPLEX_KEYS)}")
    return {"frameMode": mode, "duplexConfig": duplex}


def write_atomic(path: str, text: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def set_coach_prompt(app_dir: str, prompt: str) -> None:
    """Replace the English preset's system prompt (the page loads it into the prompt box). A JSON string is a valid
    YAML double-quoted scalar, so the one line is rewritten without a YAML library."""
    path = os.path.join(app_dir, "assets", "presets", "omni", "english_call.yaml")
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError as e:
        raise SystemExit(f"[write_config] RHYTHM_COACH_PROMPT set but {path} is unreadable ({e})")
    hits = [i for i, line in enumerate(lines) if line.startswith("system_prompt:")]
    if len(hits) != 1:
        raise SystemExit(f"[write_config] {path}: expected one system_prompt line, found {len(hits)}")
    lines[hits[0]] = "system_prompt: " + json.dumps(prompt)
    write_atomic(path, "\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="/app/config.json")
    ap.add_argument("--print", action="store_true", help="print the config instead of writing it")
    a = ap.parse_args()
    cfg = build()
    page = page_config()
    ref = cfg["audio"]["ref_audio_path"]
    app_dir = os.path.dirname(os.path.abspath(a.out))
    if not a.print and not os.path.isfile(ref if os.path.isabs(ref) else os.path.join(app_dir, ref)):
        raise SystemExit(f"[write_config] reference voice {ref} not found under {app_dir} (RHYTHM_REF_AUDIO)")
    text = json.dumps(cfg, indent=2) + "\n"
    if a.print:
        sys.stdout.write(text)
        sys.stdout.write("rhythm-config.js: " + json.dumps(page) + "\n")
        return 0
    write_atomic(a.out, text)
    os.makedirs(os.path.join(app_dir, "static"), exist_ok=True)
    write_atomic(os.path.join(app_dir, "static", "rhythm-config.js"), "window.RHYTHM_CONFIG = " + json.dumps(page) + ";\n")
    if os.environ.get("RHYTHM_COACH_PROMPT", "").strip():
        set_coach_prompt(app_dir, os.environ["RHYTHM_COACH_PROMPT"].strip())
    print(f"[write_config] wrote {a.out}: model_path={cfg['model']['model_path']} attn={cfg['model']['attn_implementation']} "
          f"compile={cfg['service']['compile']} recording={cfg['recording']['enabled']} voice={cfg['audio']['ref_audio_path']} "
          f"page frames={page['frameMode']} duplex={page['duplexConfig']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
