"""Replay the engine's coaching events for each evaluated clip into a live coach session (Claude over MCP, via the
dev server), at the clip's own timing, and record what the coach said and how long each cue took.

    python tools/replay_coach.py --data <POSE_DATA_DIR> [--model full] [--server http://127.0.0.1:8765] [--ids a,b]

Reads <data>/engine_report_<model>.json (tools/run_engine.mjs); writes <data>/coach_replay_<model>.json.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

LABELS = {"squat": "Squat", "squat_pulse": "Squat pulses", "pushup": "Push-up", "lunge": "Lunge", "lateral_raise": "Lateral raise",
          "front_raise": "Front raise", "biceps_curl": "Biceps curl", "triceps_kickback": "Triceps kickback",
          "overhead_press": "Overhead press", "hinge": "Deadlift", "jump": "Jump", "jumping_jack": "Jumping jack",
          "knee_raise": "Knee raise"}


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def wait_for(base: str, sid: str, n: int, timeout: float) -> list[dict]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        said = call(base, "GET", f"/api/coach/said?session={sid}&since=0")
        if said["total"] >= n:
            return said["said"]
        time.sleep(0.25)
    return call(base, "GET", f"/api/coach/said?session={sid}&since=0")["said"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="full")
    ap.add_argument("--server", default="http://127.0.0.1:8765")
    ap.add_argument("--ids")
    a = ap.parse_args()
    report = json.loads((Path(a.data) / f"engine_report_{a.model}.json").read_text())
    only = set(a.ids.split(",")) if a.ids else None
    out = []
    for row in report["rows"]:
        if only and row["id"] not in only or "reps" not in row:
            continue
        ex, label = row["exercise"], LABELS.get(row["exercise"], row["exercise"])
        base = {"exercise": ex, "exerciseLabel": label, "view": row.get("view")}
        events = [(0.0, {**base, "kind": "start"})]
        for c in row["cues"]:
            events.append((c["t"], {**base, "kind": "cue", "code": c["code"], "message": c["message"],
                                    "reps": sum(1 for t in row["repTimes"] if t <= c["t"]), "reason": "2 of the last 3 reps"}))
        for o in row["other"]:
            if o["type"] in ("fixed", "praise", "visibility"):
                events.append((o["t"], {**base, "kind": o["type"], **({"parts": o["parts"]} if "parts" in o else {}),
                                        **({"code": o["code"]} if "code" in o else {})}))
        faults = {}
        for codes in row["faultsPerRep"]:
            for c in codes:
                faults[c] = faults.get(c, 0) + 1
        end = (row["repTimes"][-1] + 1.5) if row["repTimes"] else 3.0
        events.append((end, {**base, "kind": "set_summary", "reps": row["reps"], "perSide": row.get("perSide"),
                             "faultsByRep": faults, "repsTotalWithFaults": sum(1 for f in row["faultsPerRep"] if f)}))
        events.sort(key=lambda e: e[0])
        sid = call(a.server, "POST", "/api/coach/start", {"exercise": label})["session"]
        t0 = time.monotonic()
        sent = []
        for i, (t, ev) in enumerate(events):
            delay = t - (time.monotonic() - t0)
            if delay > 0:
                time.sleep(delay)
            call(a.server, "POST", "/api/coach/event", {"session": sid, "event": ev})
            sent.append({"t": t, "kind": ev["kind"], "code": ev.get("code"), "message": ev.get("message")})
            wait_for(a.server, sid, i + 1, 25)             # one cue per event; the first includes Claude's start-up
        said = wait_for(a.server, sid, len(events), 25)
        call(a.server, "POST", "/api/coach/stop", {"session": sid})
        out.append({"id": row["id"], "exercise": ex, "reps": row["reps"], "truth": row.get("truth"), "events": sent, "said": said})
        print(f"\n== {row['id']} ({label}, reps {row['reps']}, truth {row.get('truth')})", flush=True)
        for s in said:
            print(f"   [{s.get('kind'):11s} {s.get('latency_ms')} ms] {s['text']}", flush=True)
    (Path(a.data) / f"coach_replay_{a.model}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
