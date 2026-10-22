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


# Duplex settings a session may send, with the bounds of the backend's DuplexConfig (core/schemas/duplex.py @ 47709a92):
# (type, min, max). A value out of range fails every page session at session.init, so it is refused at start-up.
DUPLEX_FIELDS = {
    "temperature": (float, 0.0, 2.0), "top_k": (int, 0, None), "top_p": (float, 0.0, 1.0),
    "text_repetition_penalty": (float, 1.0, None), "text_repetition_window_size": (int, 1, None),
    "length_penalty": (float, 0.1, 5.0), "listen_prob_scale": (float, 0.0, None), "listen_top_k": (int, 1, None),
    "decode_mode": (str, None, None),
}
FRAME_MODES = {"grid4", "1", "2", "3", "4"}
KV_WINDOWS = {"off", "basic", "context"}
PAGE_KV_CAP = 8192        # the demo page stops a session at this KV-cache length (static/omni/omni-app.js)


def duplex_value_ok(key: str, v) -> bool:
    kind, lo, hi = DUPLEX_FIELDS[key]
    if key == "decode_mode":
        return v in ("sampling", "greedy")
    if key == "listen_top_k" and v is None:
        return True
    if isinstance(v, bool) or not isinstance(v, (int, float) if kind is float else int):
        return False
    return (lo is None or v >= lo) and (hi is None or v <= hi)


def page_config() -> dict:
    """Settings for the patched demo page (docker/patch_demo.py): frames per 1-second step and duplex settings."""
    mode = os.environ.get("RHYTHM_FRAME_MODE", "").strip() or "grid4"
    if mode not in FRAME_MODES:
        raise SystemExit(f"[write_config] RHYTHM_FRAME_MODE={mode!r}: one of {', '.join(sorted(FRAME_MODES))} (grid4 = the "
                         "current frame + one 2x2 grid of 4 samples per second; N = N frames per second)")
    raw = os.environ.get("RHYTHM_DUPLEX_CONFIG", "").strip() or "{}"
    try:
        duplex = json.loads(raw)
    except ValueError as e:
        raise SystemExit(f"[write_config] RHYTHM_DUPLEX_CONFIG is not valid JSON ({e})")
    if not isinstance(duplex, dict) or set(duplex) - set(DUPLEX_FIELDS):
        raise SystemExit(f"[write_config] RHYTHM_DUPLEX_CONFIG must be a JSON object with keys from {sorted(DUPLEX_FIELDS)}")
    for k, v in duplex.items():
        if not duplex_value_ok(k, v):
            kind, lo, hi = DUPLEX_FIELDS[k]
            allowed = ("'sampling' or 'greedy'" if k == "decode_mode" else
                       f"{kind.__name__}{'' if lo is None else f' >= {lo}'}{'' if hi is None else f' <= {hi}'}"
                       + (" or null" if k == "listen_top_k" else ""))
            raise SystemExit(f"[write_config] RHYTHM_DUPLEX_CONFIG {k}={v!r}: must be {allowed}")
    return {"frameMode": mode, "duplexConfig": duplex}


def kv_window() -> dict:
    """The backend's duplex KV window (read from the same variables by the patched core/processors/unified.py, which
    has the same defaults): checked here so a bad value stops start-up instead of the model load."""
    mode = os.environ.get("RHYTHM_KV_WINDOW", "basic")
    if mode not in KV_WINDOWS:
        raise SystemExit(f"[write_config] RHYTHM_KV_WINDOW={mode!r}: one of basic (default), context, off")
    high = int(env_num("RHYTHM_KV_WINDOW_HIGH", 6000, int))
    low = int(env_num("RHYTHM_KV_WINDOW_LOW", 4500, int))
    # one listening second adds up to ~280 tokens (4 images), a speaking one a few dozen more: keep 1000 below the cap
    if mode == "basic" and not 0 < low < high <= PAGE_KV_CAP - 1000:
        raise SystemExit(f"[write_config] RHYTHM_KV_WINDOW_LOW={low} / RHYTHM_KV_WINDOW_HIGH={high}: need "
                         f"0 < LOW < HIGH <= {PAGE_KV_CAP - 1000} (the page stops a session at {PAGE_KV_CAP} tokens)")
    return {"mode": mode, "high": high, "low": low}


def write_atomic(path: str, text: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def yaml_quoted(text: str) -> str:
    """text as a YAML double-quoted scalar on one line. json.dumps escapes quotes, backslashes and control characters
    (valid YAML escapes too) but writes emoji as UTF-16 surrogate escapes, which YAML rejects: so keep non-ASCII
    literal and escape only what YAML may not contain literally or would read as a line break."""
    out = []
    for ch in json.dumps(text, ensure_ascii=False)[1:-1]:
        c = ord(ch)
        printable = c in (0x09, 0x0A, 0x0D) or 0x20 <= c <= 0x7E or 0xA0 <= c <= 0xD7FF or 0xE000 <= c <= 0xFFFD \
            or c >= 0x10000
        out.append(ch if printable and c not in (0x2028, 0x2029) else f"\\u{c:04x}")
    return '"' + "".join(out) + '"'


def set_coach_prompt(app_dir: str, prompt: str) -> None:
    """Replace the English preset's system prompt (the page loads it into the prompt box): the one line is rewritten
    without a YAML library, and checked with PyYAML (as the demo reads it) where available."""
    path = os.path.join(app_dir, "assets", "presets", "omni", "english_call.yaml")
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError as e:
        raise SystemExit(f"[write_config] RHYTHM_COACH_PROMPT set but {path} is unreadable ({e})")
    hits = [i for i, line in enumerate(lines) if line.startswith("system_prompt:")]
    if len(hits) != 1:
        raise SystemExit(f"[write_config] {path}: expected one system_prompt line, found {len(hits)}")
    lines[hits[0]] = "system_prompt: " + yaml_quoted(prompt)
    try:
        import yaml  # noqa: PLC0415 - in the image (the demo reads presets with it); optional for the CPU tests
    except ImportError:
        yaml = None
    if yaml is not None and yaml.safe_load(lines[hits[0]]) != {"system_prompt": prompt}:
        raise SystemExit("[write_config] RHYTHM_COACH_PROMPT does not survive YAML quoting; simplify it")
    write_atomic(path, "\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="/app/config.json")
    ap.add_argument("--print", action="store_true", help="print the config instead of writing it")
    a = ap.parse_args()
    cfg = build()
    page = page_config()
    window = kv_window()
    ref = cfg["audio"]["ref_audio_path"]
    app_dir = os.path.dirname(os.path.abspath(a.out))
    if not a.print and not os.path.isfile(ref if os.path.isabs(ref) else os.path.join(app_dir, ref)):
        raise SystemExit(f"[write_config] reference voice {ref} not found under {app_dir} (RHYTHM_REF_AUDIO)")
    text = json.dumps(cfg, indent=2) + "\n"
    if a.print:
        sys.stdout.write(text)
        sys.stdout.write("rhythm-config.js: " + json.dumps(page) + "\n")
        sys.stdout.write("kv window: " + json.dumps(window) + "\n")
        return 0
    write_atomic(a.out, text)
    os.makedirs(os.path.join(app_dir, "static"), exist_ok=True)
    write_atomic(os.path.join(app_dir, "static", "rhythm-config.js"), "window.RHYTHM_CONFIG = " + json.dumps(page) + ";\n")
    if os.environ.get("RHYTHM_COACH_PROMPT", "").strip():
        set_coach_prompt(app_dir, os.environ["RHYTHM_COACH_PROMPT"].strip())
    print(f"[write_config] wrote {a.out}: model_path={cfg['model']['model_path']} attn={cfg['model']['attn_implementation']} "
          f"compile={cfg['service']['compile']} recording={cfg['recording']['enabled']} voice={cfg['audio']['ref_audio_path']} "
          f"page frames={page['frameMode']} duplex={page['duplexConfig']} kv_window={window['mode']}"
          + (f" {window['low']}-{window['high']}" if window["mode"] == "basic" else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
