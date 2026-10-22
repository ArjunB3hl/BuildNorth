"""Run a staged test-clip set (scripts/stage_clips.py) through the model and record what it says and how fast.

Inside the GPU Pod, against the local gateway (no proxy in the path):

    python /opt/rhythm/runtime/clip_eval.py --clips /workspace/rhythm/test-clips/ready-2026-10-22 \
        --out /workspace/rhythm/logs/clip-eval-$(date -u +%Y%m%dT%H%M%SZ)

Two passes per clip (choose with --modes):
  chat    the whole clip as one video plus a question (text answer only): which exercise, how many reps, one form cue.
          Measures recognition; the answer is compared with the clip's library name as a rough keyword check.
  duplex  the clip streamed like the app's camera: one 1-second chunk per second (one frame + the clip's audio, or
          silence: the library clips have no audio track), then a few silent chunks so the model can answer after
          the 3 forced-listen steps. Measures what the coach says unprompted and the per-chunk latency.

Outputs in --out: results.jsonl (one line per clip and mode), summary.json, summary.md. The clips' own metadata
(licence, attribution) is copied into the results so every answer can be traced to its source.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from warmup import DEFAULT_DUPLEX_CONFIG, ProbeError, file_chunks, run_chat, run_video  # noqa: E402

SCHEMA = "rhythm.clip-set/1"
QUESTION = ("Watch this exercise video. Answer in JSON only, with keys: \"exercise\" (the name of the exercise or "
            "movement), \"reps\" (how many repetitions are completed, as a number, or null if it is not a repeated "
            "exercise), \"form_cue\" (one short coaching cue about the person's form).")
COACH_PROMPT = ("You are Rhythm, a concise fitness coach watching the user through the camera. As soon as you recognise "
                "the exercise, say its name and give one short cue about their form.")
STOP = {"view", "front", "side", "back", "with", "and", "the", "from", "into", "hands", "hand", "arms", "arm", "right",
        "left", "both", "slow", "single", "rep", "reps", "three", "quarter", "standing", "hold", "facing", "camera",
        "light", "start", "stop", "full", "high", "deep", "relabel", "toward", "near", "using", "exercise", "workout",
        "doing", "while", "each", "then", "down", "chest", "body", "woman", "man", "person", "form", "great", "keep",
        "your", "good", "nice", "work", "repeated", "alternating", "light", "against", "plain", "wall", "show", "shows"}


def words(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z]+", (text or "").lower()):
        if len(w) >= 4 and w not in STOP:
            out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)
    return out


def parse_answer(text: str) -> dict:
    """The model is asked for JSON; accept it inside code fences or surrounded by prose, else keep the raw text."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if m:
        try:
            d = json.loads(m.group(0))
            if isinstance(d, dict):
                return d
        except ValueError:
            pass
    return {}


def load_set(root: str, verify: bool) -> list[dict]:
    if not os.path.isfile(os.path.join(root, ".rhythm", "COMPLETE.json")):
        raise SystemExit(f"{root} is not a complete clip set (no .rhythm/COMPLETE.json): stage it with "
                         "scripts/stage_clips.py upload (README.md, 'Test clips')")
    man = json.load(open(os.path.join(root, "clips.json")))
    if man.get("schema") != SCHEMA:
        raise SystemExit(f"{root}/clips.json: unknown schema {man.get('schema')!r}")
    for c in man["clips"]:
        path = os.path.join(root, c["file"])
        if not os.path.isfile(path) or os.path.getsize(path) != c["bytes"]:
            raise SystemExit(f"{path} is missing or has the wrong size: re-run stage_clips.py upload")
        if verify:
            h = hashlib.sha256(open(path, "rb").read()).hexdigest()
            if h != c["sha256"]:
                raise SystemExit(f"{path}: sha256 mismatch: re-run stage_clips.py upload")
    return man["clips"], man.get("policy")


RETRY_DELAYS = (0.5, 1, 2, 4, 4, 4)       # ~15 s: the worker may still be cleaning up after a failed session


async def with_reconnect(make_call, row: dict):
    """Retry a session the gateway refused at the handshake (session_failed / worker_busy: the worker is still cleaning
    up the previous session), with the backoff README section 10 prescribes. A mid-session failure is never replayed."""
    for delay in (*RETRY_DELAYS, None):
        try:
            return await make_call()
        except ProbeError as e:
            s = str(e)
            if delay is None or not s.startswith("session ended during the handshake") \
                    or not any(k in s for k in ("session_failed", "worker_busy", "connection closed")):
                raise
            row["reconnects"] = row.get("reconnects", 0) + 1
            await asyncio.sleep(delay)


def expected_words(c: dict) -> set[str]:
    """What counts as naming the movement: the clip's explicit labels if the set has them, else its library name.
    Tags are not used: they hold generic and descriptive words that would match almost any answer."""
    return words(" ".join(c.get("labels") or []) or c.get("name") or "")


async def eval_clip(a, root: str, c: dict) -> list[dict]:
    path = os.path.join(root, c["file"])
    meta = {k: c.get(k) for k in ("id", "name", "category", "library", "license", "attribution", "url",
                                  "duration_s", "has_audio")}
    rows = []
    if "chat" in a.modes:
        t0 = time.monotonic()
        row = {**meta, "mode": "chat"}
        try:
            video_b64 = base64.b64encode(open(path, "rb").read()).decode()
            r = await with_reconnect(lambda: run_chat(
                a.url, a.token, a.timeout, a.no_queue, max_new_tokens=a.max_new_tokens,
                messages=[{"role": "user", "content": [{"type": "video", "data": video_b64, "stack_frames": 1},
                                                       {"type": "text", "text": a.question}]}],
                extra_input={"omni_mode": True, "image": {"max_slice_nums": 1}}), row)
            ans = parse_answer(r["text"])
            row.update(ok=True, response_s=r["response_s"], answer=r["text"], parsed=ans)
            exercise = ans.get("exercise") if isinstance(ans.get("exercise"), str) else ""
            if exercise.strip():                        # only the parsed exercise name counts, never the raw text
                overlap = sorted(expected_words(c) & words(exercise))
                row.update(label_overlap=overlap, label_match=bool(overlap))
            else:
                row.update(label_overlap=[], label_match=None)          # unparsed: reported separately
        except Exception as e:                          # noqa: BLE001 - one bad clip must not end the run
            row.update(ok=False, error=f"{type(e).__name__}: {e}")
        row["wall_s"] = round(time.monotonic() - t0, 2)
        rows.append(row)
    if "duplex" in a.modes:
        t0 = time.monotonic()
        row = {**meta, "mode": "duplex"}
        try:
            data = file_chunks(path)
            v = await with_reconnect(lambda: run_video(
                a.url, a.token, a.timeout, len(data), None, a.drain, a.no_queue, system_prompt=a.coach_prompt,
                data=data, tail_chunks=a.tail_chunks, realtime=not a.fast, duplex_config=a.duplex_config), row)
            overlap = sorted(expected_words(c) & words(v["text"]))
            row.update(ok=True, said=v["text"], audio_out_s=v["audio_out_s"], events=v["events"],
                       duplex_config=v["duplex_config"],
                       chunks_sent=v["chunks_sent"], chunks_answered=v["chunks_answered"],
                       chunk_latency_s=v["chunk_latency_s"], lag_after_last_chunk_s=v["lag_after_last_chunk_s"],
                       backend_wall_clock_ms=v["backend_wall_clock_ms"], first_event_s=v["first_event_s"],
                       spoke=bool(v["text"].strip() or v["audio_out_s"]),
                       label_overlap=overlap, label_match=bool(overlap) if v["text"].strip() else None)
        except Exception as e:                          # noqa: BLE001 - one bad clip must not end the run
            row.update(ok=False, error=f"{type(e).__name__}: {e}")
        row["wall_s"] = round(time.monotonic() - t0, 2)
        rows.append(row)
    return rows


def pct(values: list[float], p: float):
    v = sorted(x for x in values if x is not None)
    return round(v[min(len(v) - 1, int(p * len(v)))], 3) if v else None


def summarize(rows: list[dict]) -> dict:
    out = {}
    for mode in ("chat", "duplex"):
        rs = [r for r in rows if r["mode"] == mode]
        if not rs:
            continue
        ok = [r for r in rs if r.get("ok")]
        s = {"clips": len(rs), "ok": len(ok), "failed": len(rs) - len(ok),
             "label_match": sum(1 for r in ok if r.get("label_match")),
             "label_unknown": sum(1 for r in ok if r.get("label_match") is None),
             "wall_s_total": round(sum(r["wall_s"] for r in rs), 1)}
        if mode == "chat":
            s["response_s"] = {"p50": pct([r["response_s"] for r in ok], 0.5), "p90": pct([r["response_s"] for r in ok], 0.9),
                               "max": pct([r["response_s"] for r in ok], 1.0)}
            s["parsed_json"] = sum(1 for r in ok if r.get("parsed"))
        else:
            s["spoke"] = sum(1 for r in ok if r.get("spoke"))
            s["chunk_latency_p50_s"] = pct([r["chunk_latency_s"]["p50"] for r in ok], 0.5)
            s["chunk_latency_p90_s"] = pct([r["chunk_latency_s"]["p90"] for r in ok], 0.9)
            s["lag_after_last_chunk_max_s"] = pct([r["lag_after_last_chunk_s"] for r in ok], 1.0)
            s["unanswered_chunks"] = sum(r["chunks_sent"] - r["chunks_answered"] for r in ok)
        out[mode] = s
    return out


def write_markdown(path: str, rows: list[dict], summary: dict) -> None:
    lines = ["# Clip evaluation", "", "```", json.dumps(summary, indent=1), "```", "",
             "label_match is a rough keyword check of the named exercise against the clip's library name (blank = no "
             "parsable answer / nothing said), not a grade.", "",
             "| id | library name | mode | ok | answer / what the coach said | match | time |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        said = r.get("answer") if r["mode"] == "chat" else r.get("said")
        said = (said or r.get("error") or "").replace("|", "/").replace("\n", " ")[:160]
        t = r.get("response_s") if r["mode"] == "chat" else (r.get("chunk_latency_s") or {}).get("p50")
        match = {True: "yes", False: "no", None: ""}[r.get("label_match")]
        lines.append(f"| {r['id']} | {(r.get('name') or '')[:50]} | {r['mode']} | {'yes' if r.get('ok') else 'NO'} | "
                     f"{said} | {match} | {t} |")
    open(path, "w").write("\n".join(lines) + "\n")


async def main_async(a) -> int:
    clips, policy = load_set(a.clips, not a.skip_hash)
    if a.ids:
        clips = [c for c in clips if c["id"] in set(a.ids)]
    if a.limit:
        clips = clips[: a.limit]
    os.makedirs(a.out, exist_ok=True)
    rows = []
    try:
        with open(os.path.join(a.out, "results.jsonl"), "w") as f:
            for i, c in enumerate(clips, 1):
                for r in await eval_clip(a, a.clips, c):
                    rows.append(r)
                    f.write(json.dumps(r) + "\n")
                    f.flush()
                    print(f"[clip_eval] {i}/{len(clips)} {c['id']} {r['mode']}: "
                          f"{'ok' if r.get('ok') else 'FAILED ' + r.get('error', '')[:120]}", flush=True)
    finally:                                            # a partial run still gets its summary
        summary = summarize(rows)
        summary["set"] = {"path": a.clips, "policy": policy, "clips_run": len(clips)}
        summary["duplex_config"] = a.duplex_config
        json.dump(summary, open(os.path.join(a.out, "summary.json"), "w"), indent=1)
        write_markdown(os.path.join(a.out, "summary.md"), rows, summary)
        print(json.dumps(summary, indent=1), flush=True)
    return 0 if rows and all(r.get("ok") for r in rows) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--clips", required=True, help="a staged set: directory with clips.json and .rhythm/COMPLETE.json")
    ap.add_argument("--out", required=True, help="output directory for results.jsonl / summary.json / summary.md")
    ap.add_argument("--url", default="ws://127.0.0.1:8006/v1/realtime")
    ap.add_argument("--token", help="bearer token (only through the public port)")
    ap.add_argument("--modes", default="chat,duplex", type=lambda s: s.split(","))
    ap.add_argument("--ids", nargs="*", help="only these clip ids")
    ap.add_argument("--limit", type=int, help="only the first N clips")
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--drain", type=float, default=10.0)
    ap.add_argument("--tail-chunks", type=int, default=4, help="silent chunks after each clip in duplex mode")
    ap.add_argument("--fast", action="store_true", help="duplex: send chunks back to back instead of in real time")
    ap.add_argument("--no-queue", action="store_true", help="fail instead of waiting behind another session")
    ap.add_argument("--max-new-tokens", type=int, default=160)
    ap.add_argument("--question", default=QUESTION)
    ap.add_argument("--coach-prompt", default=COACH_PROMPT)
    ap.add_argument("--skip-hash", action="store_true", help="check sizes only, not sha256")
    ap.add_argument("--duplex-config", type=json.loads, default=DEFAULT_DUPLEX_CONFIG,
                    help="JSON duplex sampling config for every streamed session (default: the upstream defaults)")
    a = ap.parse_args()
    bad = set(a.modes) - {"chat", "duplex"}
    if bad:
        ap.error(f"unknown modes {sorted(bad)}")
    return asyncio.run(main_async(a))


if __name__ == "__main__":
    sys.exit(main())
