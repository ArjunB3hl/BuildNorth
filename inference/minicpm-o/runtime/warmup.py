"""Warm-up / probe client for the MiniCPM-o realtime gateway (WS /v1/realtime, OpenBMB/MiniCPM-o-Demo protocol).

Inside the container (entrypoint, before reporting ready): a text chat turn and a short omni full-duplex video session
through gateway -> worker -> backend, so "ready" means the model has answered a request.

From a laptop against the deployed Pod (the same protocol through Caddy and Runpod's HTTPS proxy):

    python warmup.py --url wss://<POD_ID>-8000.proxy.runpod.net/v1/realtime --token "$RHYTHM_API_TOKEN" \
        --skip-chat --chunks 60 --json probe.json

The video session sends synthetic input by default (quiet noise + a generated frame): no real person's audio/video.
--video-file uses a clip you are permitted to use (ffmpeg extracts 16 kHz audio and 1 frame per second; a clip without
an audio track gets silence).

Per-chunk timing: every input chunk carries an input_id that the backend echoes on its answer, and the backend tags the
first answer of each processed chunk with chunk_index. A chunk counts as answered when an answer for it arrives; the
latency of chunk i is (arrival of its first answer) - (time chunk i was sent).

Exit 0 when both modes produced output, 1 otherwise. Timings go to --json.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import shutil
import subprocess
import sys
import time

MAX_WS = 128 * 1024 * 1024
CLOSE_WAIT_S = 30.0          # how long to wait for the server's session.closed after our session.close
# The upstream DuplexConfig defaults (core/schemas/duplex.py at the pinned demo commit). The backend keeps the last
# session's config for the whole process and ignores an empty or missing one, so every probe session sends the full
# set: a non-empty config builds a fresh DuplexConfig, and that resets any field left out as well.
DEFAULT_DUPLEX_CONFIG = {"decode_mode": "sampling", "temperature": 0.7, "top_k": 20, "top_p": 0.8,
                         "text_repetition_penalty": 1.05, "text_repetition_window_size": 512, "length_penalty": 1.1,
                         "listen_prob_scale": 1.0, "listen_top_k": None}


class ProbeError(RuntimeError):
    pass


def synthetic_chunk_audio(seconds: float = 1.0, rate: int = 16000) -> str:
    import numpy as np  # noqa: PLC0415
    rng = np.random.default_rng(0)
    pcm = (rng.standard_normal(int(seconds * rate)) * 0.003).astype("<f4")      # about -50 dBFS: near-silence
    return base64.b64encode(pcm.tobytes()).decode()


def synthetic_frame() -> str:
    from PIL import Image  # noqa: PLC0415
    img = Image.new("RGB", (448, 448))
    px = img.load()
    for y in range(448):
        for x in range(448):
            px[x, y] = (x // 2, y // 2, 128)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()


def file_chunks(path: str, chunks: int | None = None) -> list[tuple[str, list[str]]]:
    """1-second chunks of a clip: (base64 float32 16 kHz mono audio, [base64 JPEG frame]); silence if no audio track."""
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise ProbeError("clips need ffmpeg and ffprobe")
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "-"],
                         capture_output=True).stdout                      # empty when the clip has no audio track
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                           capture_output=True, text=True).stdout.strip()
    duration = float(probe or 0)
    n = max(1, int(duration))
    if chunks:
        n = min(n, chunks)
    second = 16000 * 4
    out = []
    for i in range(n):
        jpg = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{i + 0.5:.3f}", "-i", path, "-frames:v", "1",
                              "-vf", "scale='min(1280,iw)':-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4",
                              "-"], capture_output=True).stdout
        if not jpg:
            break
        audio = pcm[i * second:(i + 1) * second]
        audio += b"\0" * (second - len(audio))
        out.append((base64.b64encode(audio).decode(), [base64.b64encode(jpg).decode()]))
    if not out:
        raise ProbeError(f"no frames could be extracted from {path}")
    return out


async def recv_json(ws, deadline: float) -> dict:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise asyncio.TimeoutError()
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=remaining))


async def handshake(ws, init_payload: dict, timeout: float, no_queue: bool) -> tuple[str, float]:
    """Wait for the queue, send session.init, wait for session.created, all within `timeout` seconds in total (the
    gateway's queue updates every 3 s do not extend it). no_queue: being queued at all is an error (the container's own
    warm-up must find the single worker free). Returns (session id, seconds queued)."""
    from websockets.exceptions import ConnectionClosed  # noqa: PLC0415
    t0 = time.monotonic()
    deadline = t0 + timeout
    queued = 0.0
    try:
        while True:
            msg = await recv_json(ws, deadline)
            t = msg.get("type")
            if t in ("session.queued", "session.queue_update") and no_queue:
                raise ProbeError(f"queued behind another session (position {msg.get('position')}): the worker is not "
                                 "free; the gateway may have marked it offline or busy")
            if t in ("session.queue_done", "queue_done"):
                queued = time.monotonic() - t0
                try:
                    await ws.send(json.dumps({"type": "session.init", "payload": init_payload}))
                except ConnectionClosed:
                    pass        # the gateway may already have refused the session: its reason is still buffered
            elif t == "session.created":
                return msg.get("session_id") or "", queued
            elif t in ("error", "session.closed"):
                raise ProbeError(f"session ended during the handshake: {msg}")
    except asyncio.TimeoutError:
        raise ProbeError(f"no session within {timeout:.0f}s (queue + init)") from None
    except ConnectionClosed as e:
        raise ProbeError(f"session ended during the handshake: connection closed ({e})") from None


async def close_session(ws, reason: str) -> dict:
    """Send session.close and wait for the server's session.closed. The worker sends it only after the backend has
    cleaned up (KV cache, CUDA cache), so returning means the worker is free for the next session. A normal close
    echoes our reason; anything else (backend_error: the backend failed while cleaning up) is a failure."""
    await ws.send(json.dumps({"type": "session.close", "reason": reason}))
    deadline = time.monotonic() + CLOSE_WAIT_S
    try:
        while True:
            msg = await recv_json(ws, deadline)
            if msg.get("type") == "session.closed":
                if msg.get("reason") != reason:
                    raise ProbeError(f"session closed with reason={msg.get('reason')!r} "
                                     f"diagnostic={msg.get('diagnostic')!r}, not the {reason!r} we sent")
                return msg
            if msg.get("type") == "error":
                raise ProbeError(f"error while closing the session: {msg}")
    except asyncio.TimeoutError:
        raise ProbeError(f"no session.closed within {CLOSE_WAIT_S:.0f}s after session.close") from None


def connect(url: str, token: str | None):
    import websockets  # noqa: PLC0415
    headers = {"Authorization": f"Bearer {token}"} if token else None
    try:
        return websockets.connect(url, max_size=MAX_WS, additional_headers=headers, open_timeout=60)
    except TypeError:                                   # websockets < 14 names the argument extra_headers
        return websockets.connect(url, max_size=MAX_WS, extra_headers=headers, open_timeout=60)


async def run_chat(url: str, token: str | None, timeout: float, no_queue: bool = False,
                   question: str = "Reply with one word: ready", max_new_tokens: int = 8,
                   extra_input: dict | None = None, messages: list | None = None) -> dict:
    """One non-streaming, text-only turn. `messages` overrides the default single text question (e.g. a user message
    whose content is [{"type": "video", "data": <base64 mp4>, "stack_frames": 1}, {"type": "text", "text": ...}])."""
    t0 = time.monotonic()
    async with connect(f"{url}?mode=chat", token) as ws:
        t_conn = time.monotonic() - t0
        sid, queued = await handshake(ws, {}, timeout, no_queue)
        body = {"messages": messages or [{"role": "user", "content": question}], "streaming": False,
                "generation": {"max_new_tokens": max_new_tokens}, "image": {"max_slice_nums": 1}, "omni_mode": False,
                "tts": {"enabled": False}, "use_tts_template": False, **(extra_input or {})}
        t_send = time.monotonic()
        await ws.send(json.dumps({"type": "input.append", "input": body}))
        text = ""
        done: dict = {}
        deadline = t_send + timeout
        try:
            while True:
                msg = await recv_json(ws, deadline)
                t = msg.get("type")
                if t == "response.output.delta" and msg.get("kind") == "text":
                    text += msg.get("text", "")
                elif t == "response.done":
                    done = msg
                    text = msg.get("text") or text
                    break
                elif t in ("session.closed", "error"):
                    raise ProbeError(f"chat ended early: {msg}")
        except asyncio.TimeoutError:
            raise ProbeError(f"no chat answer within {timeout:.0f}s") from None
        t_done = time.monotonic()
        closed = await close_session(ws, "probe_done")
    if not text.strip():
        raise ProbeError("chat returned no text")
    return {"session_id": sid, "connect_s": round(t_conn, 3), "queued_s": round(queued, 3),
            "response_s": round(t_done - t_send, 3), "text": text[:2000], "usage": done.get("usage"),
            "closed_reason": closed.get("reason")}


async def run_video(url: str, token: str | None, timeout: float, chunks: int, video_file: str | None,
                    drain: float = 10.0, no_queue: bool = False,
                    system_prompt: str = "You are a concise fitness coach. Always speak English.",
                    data: list | None = None, init_extra: dict | None = None, tail_chunks: int = 0,
                    realtime: bool = True, duplex_config: dict | None = None) -> dict:
    """One omni full-duplex session: 1-second chunks (exactly 16000 float32 samples + frames), paced in real time
    unless realtime=False. tail_chunks appends that many silent chunks repeating the last frame: the model is forced to
    listen for the first 3 steps of a session and can only answer on a later step. The full duplex config is sent
    (default: DEFAULT_DUPLEX_CONFIG), because the backend otherwise keeps the previous session's sampling settings."""
    if data is None:
        data = file_chunks(video_file, chunks) if video_file else [(synthetic_chunk_audio(), [synthetic_frame()])] * chunks
    if tail_chunks:
        silence = base64.b64encode(b"\0" * 16000 * 4).decode()
        data = list(data) + [(silence, data[-1][1])] * tail_chunks
    kinds: dict[str, int] = {}
    first: dict[str, float] = {}
    answered: dict[int, float] = {}           # chunk number -> seconds after t_start of its first answer
    texts: list[str] = []
    audio_samples = 0
    wall: list[float] = []
    t0 = time.monotonic()
    async with connect(f"{url}?mode=video", token) as ws:
        t_conn = time.monotonic() - t0
        config = dict(duplex_config or DEFAULT_DUPLEX_CONFIG)
        sid, queued = await handshake(ws, {"system_prompt": system_prompt, "config": config, **(init_extra or {})},
                                      timeout, no_queue)
        t_start = time.monotonic()
        sent: list[float] = []

        async def sender():
            for i, (audio, frames) in enumerate(data):     # real time: one 1 s chunk per second
                await ws.send(json.dumps({"type": "input.append",
                                          "input": {"audio": audio, "video_frames": frames, "max_slice_nums": 1,
                                                    "input_id": f"c{i}"}}))
                sent.append(time.monotonic())
                if realtime:
                    await asyncio.sleep(1.0)

        send_task = asyncio.create_task(sender())
        last_event = None
        # Stop once every chunk has been sent and answered. While the model is cold, wait up to `timeout` for the
        # first answer; once answers flow, stop `drain` seconds after the last one.
        deadline = t_start + len(data) + timeout
        try:
            while True:
                now = time.monotonic()
                if send_task.done() and not send_task.cancelled() and send_task.exception():
                    raise ProbeError(f"sending failed: {send_task.exception()}")
                if send_task.done() and (len(answered) >= len(data) or (last_event and now - last_event > drain)):
                    break
                if now >= deadline:
                    break
                if not send_task.done():
                    wait = 1.0
                elif last_event:
                    wait = drain - (now - last_event)
                else:
                    wait = deadline - now
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, min(wait, deadline - now)))
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                t = msg.get("type")
                if t == "response.output.delta":
                    arrival = time.monotonic()
                    last_event = arrival
                    k = msg.get("kind", "?")
                    kinds[k] = kinds.get(k, 0) + 1
                    first.setdefault(k, round(arrival - t_start, 3))
                    if k == "text" and msg.get("text"):
                        texts.append(msg["text"])
                    if k == "audio" and msg.get("audio"):
                        audio_samples += len(base64.b64decode(msg["audio"])) // 4
                    idx = None
                    iid = msg.get("input_id")
                    if isinstance(iid, str) and iid[:1] == "c" and iid[1:].isdigit():
                        idx = int(iid[1:])
                    elif isinstance(msg.get("chunk_index"), int):
                        idx = msg["chunk_index"]
                    if idx is not None and idx not in answered:
                        answered[idx] = round(arrival - t_start, 3)
                        w = (msg.get("metrics") or {}).get("wall_clock_ms")
                        if w is not None:
                            wall.append(w)
                elif t == "error":
                    raise ProbeError(f"video session error: {msg}")
                elif t == "session.closed":
                    # a session we did not close ends only on failure (backend_error) or at the gateway's time cap
                    raise ProbeError(f"video session closed by the server: reason={msg.get('reason')} "
                                     f"diagnostic={msg.get('diagnostic')}")
        finally:
            send_task.cancel()
        closed = await close_session(ws, "probe_done")
    if not kinds:
        raise ProbeError(f"video duplex produced no output within {timeout:.0f}s of the last chunk")
    lat = sorted(answered[i] - (sent[i] - t_start) for i in answered if i < len(sent))
    last = len(data) - 1

    def pct(p: float):
        return round(lat[min(len(lat) - 1, int(p * len(lat)))], 3) if lat else None

    return {"session_id": sid, "connect_s": round(t_conn, 3), "queued_s": round(queued, 3), "chunks_sent": len(sent),
            "chunks_answered": len(answered), "events": kinds, "first_event_s": first,
            # per-chunk latency: first answer for chunk i minus the time chunk i was sent (network + model)
            "chunk_latency_s": {"p50": pct(0.5), "p90": pct(0.9), "max": round(lat[-1], 3) if lat else None},
            # the last chunk's latency: about one unit when the model keeps pace with real time; it grows with the
            # number of chunks when it falls behind. None when the last chunk got no answer.
            "lag_after_last_chunk_s": round(answered[last] - (sent[last] - t_start), 3)
            if last in answered and last < len(sent) else None,
            "backend_wall_clock_ms": {"n": len(wall), "max": max(wall) if wall else None,
                                      "mean": round(sum(wall) / len(wall), 1) if wall else None},
            "text": "".join(texts)[:2000], "audio_out_s": round(audio_samples / 24000, 2),
            "closed_reason": closed.get("reason"), "duplex_config": config,
            "send_times_s": [round(t - t_start, 3) for t in sent], "answer_times_s": answered}


async def main_async(a) -> dict:
    out = {"url": a.url}
    if not a.skip_chat:
        out["chat"] = await run_chat(a.url, a.token, a.timeout, a.no_queue)
        print(f"[warmup] chat ok: {out['chat']['response_s']}s -> {out['chat']['text']!r}", flush=True)
    if not a.skip_video:
        out["video"] = await run_video(a.url, a.token, a.timeout, a.chunks, a.video_file, a.drain, a.no_queue)
        v = out["video"]
        print(f"[warmup] video duplex ok: {v['chunks_answered']}/{v['chunks_sent']} chunks answered, events "
              f"{v['events']}, chunk latency {v['chunk_latency_s']}", flush=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default="ws://127.0.0.1:8006/v1/realtime")
    ap.add_argument("--token", help="bearer token (needed through the public port; not inside the container)")
    ap.add_argument("--timeout", type=float, default=120.0, help="seconds allowed for each session step")
    ap.add_argument("--total-timeout", type=float, help="hard limit for the whole run (default: 3 x --timeout + chunks + 60)")
    ap.add_argument("--chunks", type=int, default=3, help="1-second video-duplex chunks to send")
    ap.add_argument("--video-file", help="use this (permitted) clip instead of synthetic input")
    ap.add_argument("--drain", type=float, default=10.0,
                    help="after the last chunk, stop this many seconds after the last answer")
    ap.add_argument("--no-queue", action="store_true", help="fail instead of waiting in the gateway queue")
    ap.add_argument("--skip-chat", action="store_true")
    ap.add_argument("--skip-video", action="store_true")
    ap.add_argument("--json", help="write timings here")
    a = ap.parse_args()
    total = a.total_timeout or (3 * a.timeout + a.chunks + 2 * CLOSE_WAIT_S)
    t0 = time.monotonic()
    try:
        out = asyncio.run(asyncio.wait_for(main_async(a), timeout=total))
        out["ok"], code = True, 0
    except asyncio.TimeoutError:
        out, code = {"ok": False, "error": f"TimeoutError: the probe did not finish within {total:.0f}s"}, 1
        print(f"[warmup] FAILED: {out['error']}", flush=True)
    except Exception as e:                                      # noqa: BLE001 - reported, not swallowed
        out, code = {"ok": False, "error": f"{type(e).__name__}: {e}"}, 1
        print(f"[warmup] FAILED: {out['error']}", flush=True)
    out["total_s"] = round(time.monotonic() - t0, 3)
    if a.json:
        with open(a.json, "w") as f:
            json.dump(out, f, indent=1)
    return code


if __name__ == "__main__":
    sys.exit(main())
