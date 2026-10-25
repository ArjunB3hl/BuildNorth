"""MCP server (stdio) through which a Claude session coaches a live workout, with its own model and the user's own
Claude login (no API key here), like BuildNorth's /mcp: the app measures, Claude talks.

Tools:
- wait_for_event(timeout_s): the next coaching event the pose engine raised (a form fault, a fix, a clean streak,
  a set summary), {"idle": true} when nothing happened, or {"done": true} when the workout session ended.
- say(text): speak one short cue to the user (the page reads it aloud).

Started by the dev server's coach session (server/coach.py) via `claude -p --mcp-config` or `codex exec -c
mcp_servers.pose...`; talks to the dev server at POSE_SERVER for session POSE_COACH_SESSION, as the CLI's run
POSE_COACH_RUN (codex is started again when its turn ends: a poll of an earlier run that is still open takes no event).
"""
from __future__ import annotations

import json
import os
import urllib.request

import anyio.to_thread
from mcp.server import MCPServer

BASE = os.environ.get("POSE_SERVER", "http://127.0.0.1:8765")
SESSION = os.environ.get("POSE_COACH_SESSION", "")
RUN = os.environ.get("POSE_COACH_RUN", "")

server = MCPServer(
    name="pose",
    instructions="Coach a live workout: call wait_for_event in a loop and answer coaching events with say().",
)


def _call(method: str, path: str, body: dict | None = None, timeout: float = 70.0) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


IDLE_RETURN_S = 300   # rests between sets are waited out here, not with a model turn every 30 s


@server.tool(description="Wait for the next coaching event from the pose tracker. Blocks until there is one (through "
                         "rests between sets). Returns the event; {'idle': true} after a long rest (call again); or "
                         "{'done': true} when the workout session has ended (then stop).")
async def wait_for_event(timeout_s: int = 300) -> dict:
    deadline = anyio.current_time() + max(1, min(int(timeout_s), IDLE_RETURN_S))
    while True:
        left = deadline - anyio.current_time()
        if left <= 0:
            return {"idle": True}
        t = max(1, min(int(left), 30))
        try:
            path = f"/api/coach/next?session={SESSION}&timeout={t}&run={RUN}"
            ev = await anyio.to_thread.run_sync(lambda: _call("GET", path, timeout=t + 10))
        except Exception:  # noqa: BLE001 - dev server gone or session unknown: the workout is over for this coach
            return {"done": True}
        if not ev.get("idle"):
            return ev


@server.tool(description="Speak one short cue to the user right now (one or two sentences, at most 25 words; up to 50 "
                         "when answering the user). An empty text speaks nothing (for words not meant for you). "
                         "Returns immediately.")
async def say(text: str) -> dict:
    try:
        return await anyio.to_thread.run_sync(lambda: _call("POST", "/api/coach/say", {"session": SESSION, "text": text}))
    except Exception:  # noqa: BLE001
        return {"done": True, "note": "the workout session has ended; stop"}


if __name__ == "__main__":
    server.run("stdio")
