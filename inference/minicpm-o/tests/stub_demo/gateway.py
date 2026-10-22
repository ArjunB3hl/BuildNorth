"""Stub of `python gateway.py --http`: public port = GET /health, GET /echo (reports what the upstream received, for the
Caddy auth tests) and WS /v1/realtime; internal port = the worker registry (PUT /internal/workers/{id}).

Like the real gateway at the pinned commit: a session that finds no idle worker is queued (session.queued, then
session.queue_update every 3 s) instead of refused; with a free worker it gets session.queue_done directly. The
registry answers with the worker's status. Answers echo the chunk's input_id and carry chunk_index on the first delta
of each chunk; session.close is answered with session.closed.

Test knobs (environment): STUB_SPEAK=1 answers every video chunk with text + audio + listen deltas; STUB_UNIT_S is the
per-chunk model time; STUB_FAIL_AFTER_CHUNKS=N closes the video session with reason backend_error after N chunks;
STUB_CLOSE_REASON=R answers session.close with reason R; STUB_KV_WINDOW=K makes the reported kv_cache_length fall
back every K chunks; STUB_REQUIRE_CONFIG=1 refuses a video session.init without a
non-empty config (the real backend silently keeps the previous session's settings then); STUB_REFUSE_FIRST=N answers
the first N sessions with session_failed, as while the worker is still cleaning up. Every session.init (its voice)
and video chunk (its image count) is printed, so tests can check what reached the server."""
import argparse
import asyncio
import base64
import json
import os

from _stub import http_server
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

ap = argparse.ArgumentParser()
ap.add_argument("--host", required=True)
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--internal-port", type=int, required=True)
ap.add_argument("--http", action="store_true", required=True)
a = ap.parse_args()
workers = {}
busy = asyncio.Lock()
refused = {"n": 0}


def register(h, body):
    wid = h.path.rsplit("/", 1)[-1]
    if not body or not body.get("endpoint"):
        return 422, {"detail": "endpoint required"}
    workers[wid] = body
    print(f"stub gateway: registered {wid} -> {body}", flush=True)
    return 200, {"ok": True, "worker": {"worker_id": wid, "status": os.environ.get("STUB_REGISTER_STATUS", "idle"),
                                        **body}}


http_server(a.host, a.internal_port, {("PUT", "/internal/workers/"): register,
                                       ("GET", "/health"): lambda h, b: (200, {"status": "healthy"})})


def respond(status, obj):
    data = json.dumps(obj).encode()
    return Response(status, "OK" if status == 200 else "ERR",
                    Headers([("content-type", "application/json"), ("content-length", str(len(data)))]), data)


def process_request(conn, req):
    path = req.path.split("?")[0]
    if path == "/health":
        return respond(200, {"status": "healthy"})
    if path == "/workers":
        return respond(200, {"total": len(workers)})
    if path == "/echo":
        return respond(200, {"path": req.path, "authorization": req.headers.get("Authorization"),
                             "cookie": req.headers.get("Cookie"), "referer": req.headers.get("Referer")})
    if path.startswith("/v1/realtime"):
        return None
    return respond(404, {"detail": "not found"})


async def send(ws, **msg):
    await ws.send(json.dumps(msg))


async def session(ws):
    mode = "video"
    if "mode=" in ws.request.path:
        mode = ws.request.path.split("mode=")[1].split("&")[0]
    waited, queued = 0.0, False
    while not workers or os.environ.get("STUB_REGISTER_STATUS", "idle") != "idle" or busy.locked():
        if not queued:                                # like the real gateway: wait (tickets never expire), updates
            await send(ws, type="session.queued", position=1, estimated_wait_s=30)   # every 3 s
            queued = True
        await asyncio.sleep(0.1)
        waited += 0.1
        if waited >= 3:
            await send(ws, type="session.queue_update", position=1, estimated_wait_s=30)
            waited = 0.0
    if refused["n"] < int(os.environ.get("STUB_REFUSE_FIRST", "0") or 0):
        refused["n"] += 1                          # the worker is still cleaning up: the real gateway says this
        await send(ws, type="session.queue_done")
        await send(ws, type="error", error={"code": "session_failed", "message": "worker refused the connection"})
        return
    async with busy:
        await send(ws, type="session.queue_done")
        chunk = 0
        async for raw in ws:
            msg = json.loads(raw)
            t = msg.get("type")
            if t == "session.init":
                cfg = (msg.get("payload") or {}).get("config")
                voice = ((msg.get("payload") or {}).get("voice") or {}).get("ref_audio_path")
                print(f"stub gateway: session.init mode={mode} voice={voice}", flush=True)
                if mode != "chat" and os.environ.get("STUB_REQUIRE_CONFIG") == "1" and not cfg:
                    await send(ws, type="session.closed", reason="backend_error", diagnostic={"error": "no config"})
                    return
                await send(ws, type="session.created", session_id=f"stub-{mode}")
            elif t == "input.append" and mode == "chat":
                content = ((msg.get("input") or {}).get("messages") or [{}])[0].get("content")
                has_video = isinstance(content, list) and any(i.get("type") == "video" and i.get("data") for i in content)
                text = '{"exercise": "bodyweight squat", "reps": 3, "form_cue": "keep your chest up"}' if has_video else "ready"
                await send(ws, type="response.output.delta", kind="text", text=text)
                await send(ws, type="response.done", text=text)
            elif t == "input.append":
                inp = msg.get("input") or {}
                print(f"stub gateway: chunk {chunk} images={len(inp.get('video_frames') or [])}", flush=True)
                await asyncio.sleep(float(os.environ.get("STUB_UNIT_S", "0.05")))
                fail_after = int(os.environ.get("STUB_FAIL_AFTER_CHUNKS", "0") or 0)
                if fail_after and chunk >= fail_after:
                    await send(ws, type="session.closed", reason="backend_error", diagnostic={"error": "stub failure"})
                    return
                usage = {"chunk_index": chunk}
                metrics = {"wall_clock_ms": float(os.environ.get("STUB_UNIT_S", "0.05")) * 1000,
                           # grows 145 per step; STUB_KV_WINDOW=K drops it back every K steps, like the sliding window
                           "kv_cache_length": 300 + 145 * (chunk % int(os.environ.get("STUB_KV_WINDOW") or 10**9))}
                if os.environ.get("STUB_SPEAK") == "1":
                    await send(ws, type="response.output.delta", kind="text", text="Nice form. ",
                               input_id=inp.get("input_id"), metrics=metrics, **usage)
                    await send(ws, type="response.output.delta", kind="audio", input_id=inp.get("input_id"),
                               audio=base64.b64encode(b"\0" * 4 * 2400).decode(), metrics=metrics)
                    await send(ws, type="response.output.delta", kind="listen", input_id=inp.get("input_id"),
                               metrics=metrics)
                else:
                    await send(ws, type="response.output.delta", kind="listen", input_id=inp.get("input_id"),
                               metrics=metrics, **usage)
                chunk += 1
            elif t == "session.close":
                await asyncio.sleep(0.2)              # the real worker answers only after the backend cleaned up
                # STUB_CLOSE_REASON simulates a backend failure while cleaning up (the worker then says backend_error)
                await send(ws, type="session.closed", reason=os.environ.get("STUB_CLOSE_REASON") or msg.get("reason"))
                return


async def main():
    async with serve(session, a.host, a.port, process_request=process_request, max_size=128 * 1024 * 1024):
        print(f"stub gateway on {a.host}:{a.port} (internal {a.internal_port})", flush=True)
        await asyncio.Future()

asyncio.run(main())
