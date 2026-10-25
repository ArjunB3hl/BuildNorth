"""Local dev server for the browser pose coach (127.0.0.1 only).

    POSE_DATA_DIR=... POSE_CLIPS_DIR=... python server/dev_server.py [--port 8765]

It answers only requests addressed to 127.0.0.1, localhost or [::1] at its port (the Host header): a page elsewhere
whose name was made to resolve to 127.0.0.1 (DNS rebinding) would otherwise count as this server's own origin, and
could read /api/config or drive any endpoint.

- /web/...            the pages (web/), MediaPipe bundle and models (web/vendor, web/models)
- /clips/<file>       test clips from POSE_CLIPS_DIR (byte ranges, so the browser can seek); never part of the repo
- /demos/<file>       3D demo clips from POSE_DEMOS_DIR (tools/build_demos.mjs); never part of the repo
- GET  /moves/library.json      the movement library the page offers (POSE_MOVES_DIR, default .data/moves; built by
                      tools/build_moves.mjs from the private motion library): each movement's key, name, kind, how it is
                      tracked, its coaching notes and its 3D animation
- GET  /moves/glb/<key>.glb     a movement's 3D animation (Y Bot), for "Show in 3D". Only these two: the folder's other
                      files (the catalog, the study's reports, the skeletons) are never served
- GET  /api/demos     POSE_DEMOS_DIR/demos.json: per exercise, the demo clip, the rep to loop, its credit
- GET  /api/version   a hash of the page's code: a page loaded before a change says it needs a reload
- GET  /api/recordings  the saved live sets (POSE_DATA_DIR/results/live), to replay through the page
- GET  /api/recording?id=<name>  one of them (landmarks and events only)
- GET  /api/eval-set  the clips to evaluate: POSE_DATA_DIR/eval_set.json [{"id", "file", "exercise"}]
- POST /api/results   landmark series from web/eval.html -> POSE_DATA_DIR/results/<model>/<id>.json (+ snapshots/)
- GET  /api/tts?text=..&voice=af_heart&page=<id>&seq=<n>  the coach's local voice (Kokoro-82M on MLX, server/tts.py):
                      one JSON line per sentence as it is made, base64 PCM. A cue ends its page's cues of a lower seq
                      (their streams end with {"superseded": true}); one whose seq is not above its page's latest gets
                      only that line (page: one id per page voice, seq: rising; without them a cue ends none and is
                      made in turn). GET /api/tts/status says whether it is set up and ready
- POST /api/stt       what the user said to the coach, transcribed here (Parakeet TDT 0.6B v3 on MLX, server/stt.py): the
                      body is the utterance, PCM16 little-endian mono at 16000 Hz (Content-Type
                      application/octet-stream), 30 s at most -> {"text", "ms", "seconds"}; 400 for an empty, odd-length
                      or longer body, 415 for another type, 503 {"error"} when it is off, not set up or not ready, 504
                      when this utterance took too long (the page goes on listening). Like the writes below, only pages
                      on this machine may send it (Origin), and a page elsewhere cannot send that type without asking
                      first. GET /api/stt/status says whether it is set up and ready (and loads a model set up since)
- /bench/<file>        the voice-coach benchmark's pages and test sets (POSE_BENCH_DIR, default .data/dev/bench; private)
- POST /api/bench/result?name=<id>  a benchmark run's results -> POSE_BENCH_DIR/results/<id>.json
- GET  /api/config     what the page may use: the ElevenLabs agent id, the one /api/connections names (kept out of the
                      repo: the agent is public, limited by its origin allowlist and its call limits)
- GET  /api/connections[?fresh=1]  the coach's connections (server/connections.py): the ElevenLabs agent ("eleven":
                      set up, its plan paid), the claude CLI and the codex CLI ("claude", "chatgpt": found, signed in,
                      the model; "error": why it cannot be used; for Claude, its "transport", api or cli, and the
                      check of the user's API key, "api"), their "order" and the first usable one ("auto": eleven,
                      claude, chatgpt or none). The checks are kept for a minute (one that timed out, 10 s); fresh=1
                      (the page's Check again, after a sign-in) checks them again now. Nothing secret is in it (no
                      email, no token, no key)
- POST /api/connections/elevenlabs  {"agentId": "agent_...", "plan": "free" | "starter" | ... | null} saves the agent
                      the page uses (.data/connections/elevenlabs.json, mode 0600); DELETE forgets it (moved aside).
                      Both answer as GET /api/connections does, and take only a JSON body and, when the browser names
                      the page (Origin), only pages on this machine: a page elsewhere cannot set the coach's agent
- /api/coach/...       live coaching: the page posts engine events; a model session connected over MCP
                      (server/pose_mcp.py, the user's own login), or Claude through the Anthropic API on the user's own
                      key, answers with spoken cues (server/coach.py). POST /api/coach/start {"exercise", "brain":
                      "claude" (default) | "chatgpt"}: Claude (the API or Claude Code) or Codex. It starts a CLI on the
                      user's login or calls the API on their key, so it takes only JSON from this machine's pages (as
                      above)
"""
from __future__ import annotations

import argparse
import atexit
import base64
import hashlib
import json
import mimetypes
import os
import re
import signal
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import coach  # noqa: E402
import connections  # noqa: E402
import stt  # noqa: E402
import tts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = Path(os.environ.get("POSE_DATA_DIR", ROOT / ".data")).resolve()
CLIPS = Path(os.environ["POSE_CLIPS_DIR"]).resolve() if os.environ.get("POSE_CLIPS_DIR") else None
DEMOS = Path(os.environ["POSE_DEMOS_DIR"]).resolve() if os.environ.get("POSE_DEMOS_DIR") else None
MOVES = Path(os.environ.get("POSE_MOVES_DIR") or ROOT / ".data" / "moves").resolve()
MOVE_GLB = re.compile(r"/moves/glb/([a-z0-9][a-z0-9_-]{0,79})\.glb")     # a movement's key: library.json's "key"
BENCH = Path(os.environ.get("POSE_BENCH_DIR", ROOT / ".data" / "dev" / "bench")).resolve()


def code_version() -> str:
    """A hash of the page's code (web/index.html and every .js under web/js, its folders too: web/js/moveforms/ holds
    the moving movements' checks), so a tab left open over a change can tell it is stale. Each file's path within web/
    goes in with it: a file moved, or one of the same name in another folder, changes it too."""
    h = hashlib.sha1()
    for f in sorted([WEB / "index.html", *(WEB / "js").rglob("*.js")]):
        h.update(f.relative_to(WEB).as_posix().encode()); h.update(f.read_bytes())
    return h.hexdigest()[:12]
TYPES = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream",
         ".json": "application/json", ".html": "text/html; charset=utf-8", ".css": "text/css", ".mp4": "video/mp4",
         ".webm": "video/webm", ".glb": "model/gltf-binary"}
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,120}$")
LOCAL_ORIGIN = re.compile(r"http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?")   # pages on this machine


def inside(base: Path, rel: str) -> Path | None:
    p = (base / rel).resolve()
    return p if p.is_file() and (p == base or base in p.parents) else None


class Handler(BaseHTTPRequestHandler):
    server_version = "pose-coach-dev"

    def log_message(self, fmt, *args):  # quieter: only errors
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def parse_request(self):
        # every request, whatever its method: addressed to this machine by its own name or address. A page served from
        # another name sends that name, even when it resolves to 127.0.0.1 (DNS rebinding), so it is turned away here.
        if not super().parse_request():
            return False
        port = self.server.server_port
        if (self.headers.get("Host") or "").lower() not in (f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"):
            self.send_error(HTTPStatus.MISDIRECTED_REQUEST, "this server answers only 127.0.0.1, localhost or [::1]")
            return False
        return True

    def end_headers(self):
        # every response, whatever its path or type: only pages on this machine may frame this server's pages (the
        # BuildNorth app embeds the page with ?embed=1)
        self.send_header("Content-Security-Policy", "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path):
        size = path.stat().st_size
        ctype = TYPES.get(path.suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)$", rng or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_GET(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        if path in ("/", "/index.html"):
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/web/index.html")
            self.end_headers()
            return
        if path.startswith("/web/"):
            p = inside(WEB, path[len("/web/"):])
            return self.send_file(p) if p else self.send_error(404)
        if path.startswith("/bench/") and BENCH.is_dir():
            p = inside(BENCH, path[len("/bench/"):])
            return self.send_file(p) if p else self.send_error(404)
        if path.startswith("/clips/") and CLIPS:
            p = inside(CLIPS, path[len("/clips/"):])
            return self.send_file(p) if p else self.send_error(404)
        if path.startswith("/demos/") and DEMOS:
            p = inside(DEMOS, path[len("/demos/"):])
            return self.send_file(p) if p else self.send_error(404)
        if path.startswith("/moves/"):
            # the library and the movements' animations, and nothing else of POSE_MOVES_DIR (it also holds the private
            # catalog, the recognition study and the skeletons)
            glb = MOVE_GLB.fullmatch(path)
            p = (inside(MOVES, "library.json") if path == "/moves/library.json" else
                 inside(MOVES / "glb", glb.group(1) + ".glb") if glb else None)
            return self.send_file(p) if p else self.send_error(404)
        if path == "/api/demos":
            f = DEMOS / "demos.json" if DEMOS else None
            demos = json.loads(f.read_text()) if f and f.is_file() else {}
            return self.send_json({k: {**v, "url": "/demos/" + v["file"],
                                       **({"modelUrl": "/demos/" + v["model"]} if v.get("model") else {})}
                                   for k, v in demos.items()})
        if path == "/api/version":
            return self.send_json({"version": code_version()})
        if path == "/api/config":
            return self.send_json({"elevenAgentId": connections.eleven_agent_id()})
        if path == "/api/connections":
            return self.send_json(connections.status(fresh=parse_qs(u.query).get("fresh") == ["1"]))
        if path == "/api/tts/status":
            return self.send_json(tts.status())
        if path == "/api/stt/status":
            return self.send_json(stt.status())
        if path == "/api/tts":
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            text, voice, page, seq = q.get("text", "")[:600], q.get("voice", "af_heart"), q.get("page"), q.get("seq")
            # text with no letter or digit ("...") has nothing to say: the worker would make no sentence of it. The two
            # are told apart, since the page logs the message and a voice setting is not at fault for a cue of "..."
            if not re.search(r"[^\W_]", text):
                return self.send_json({"error": "nothing to say (the text has no letter or digit)"}, 400)
            if not re.fullmatch(r"[a-z]{2}_[a-z]{2,12}", voice):
                return self.send_json({"error": "a Kokoro voice (e.g. af_heart) is needed"}, 400)
            if (page is None) != (seq is None) or (page is not None and not (
                    re.fullmatch(r"[A-Za-z0-9_-]{1,40}", page) and re.fullmatch(r"[0-9]{1,16}", seq))):
                return self.send_json({"error": "page (1-40 of A-Z a-z 0-9 _ -) and seq (a number) go together"}, 400)
            if not tts.available():
                return self.send_json({"error": "Kokoro is not set up (bash tools/setup_kokoro.sh)"}, 503)
            self.send_response(200)                     # streamed as made, one JSON line per sentence (HTTP/1.0: ends at close)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            chunks = tts.say(text, voice, page, int(seq) if seq is not None else None)
            try:
                for chunk in chunks:
                    self.wfile.write((json.dumps(chunk) + "\n").encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass                                    # the page stopped listening (it aborts a cue a newer one cut)
            finally:
                chunks.close()                          # the worker drops what is left of a cue nobody hears
            return
        if path == "/api/recordings":
            live = DATA / "results" / "live"
            items = []
            for f in sorted(live.glob("*.json")) if live.is_dir() else []:
                items.append({"id": f.stem, "bytes": f.stat().st_size})
            return self.send_json(items)
        if path == "/api/recording":
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            f = inside(DATA / "results" / "live", q.get("id", "") + ".json")
            return self.send_file(f) if f else self.send_error(404)
        if path == "/api/eval-set":
            f = DATA / "eval_set.json"
            if not f.is_file():
                return self.send_json({"error": f"no {f}"}, 404)
            items = json.loads(f.read_text())
            return self.send_json([{**c, "url": "/clips/" + c["file"]} for c in items])
        if path == "/api/health":
            return self.send_json({"ok": True, "clips": bool(CLIPS), "moves": (MOVES / "library.json").is_file(),
                                   "coach": coach.status()})
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if path == "/api/coach/next":       # called by the MCP server on behalf of Claude (long poll)
                return self.send_json(coach.get(q["session"]).next_event(min(float(q.get("timeout", 30)), 60),
                                                                         q.get("run") or None))
            if path == "/api/coach/said":       # polled by the page
                return self.send_json(coach.get(q["session"]).said_since(int(q.get("since", 0))))
        except KeyError as e:
            return self.send_json({"error": str(e)}, 404)
        self.send_error(404)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 200 * 1024 * 1024:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def write_refused(self, what: str, ctype: str = "application/json") -> tuple[int, str] | None:
        """Why a request that changes a connection, starts a coach session or uses the Mac's GPU for speech is turned
        away, or None. A page elsewhere can send a form or plain text here without the browser asking this server
        first, but not JSON or raw bytes (application/octet-stream); and the browser names the page (Origin). (The
        Host check does not stop it: that page's request is addressed to 127.0.0.1.)"""
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != ctype:
            what_type = "JSON" if ctype == "application/json" else "raw audio"
            return HTTPStatus.UNSUPPORTED_MEDIA_TYPE, f"the body must be {what_type} (Content-Type: {ctype})"
        origin = self.headers.get("Origin")
        if origin is not None and not LOCAL_ORIGIN.fullmatch(origin.lower()):
            return HTTPStatus.FORBIDDEN, f"only pages on this machine may {what}"
        return None

    def change_connection(self, change) -> None:
        refused = self.write_refused("change the coach's connections")
        if refused:
            return self.send_json({"error": refused[1]}, refused[0])
        try:
            body = self.read_json()
            if not isinstance(body, dict):
                raise ValueError("the body must be a JSON object")
            change(body)
        except ValueError as e:                         # (bad JSON too)
            return self.send_json({"error": str(e)}, 400)
        return self.send_json(connections.status())

    def do_DELETE(self):
        if urlparse(self.path).path == "/api/connections/elevenlabs":
            return self.change_connection(lambda body: connections.forget_eleven())
        self.send_error(404)

    def transcribe(self) -> None:
        """POST /api/stt: one utterance, PCM16 LE mono 16 kHz, to the words in it (server/stt.py)."""
        refused = self.write_refused("send the coach speech", "application/octet-stream")
        if refused:
            return self.send_json({"error": refused[1]}, refused[0])
        n = max(0, int(self.headers.get("Content-Length") or 0))
        if n > stt.MAX_BYTES:
            self.rfile.read(min(n, 2 * stt.MAX_BYTES))      # (drained, up to a point, so the page reads the answer)
            return self.send_json({"error": f"at most {stt.MAX_SECONDS} s of audio "
                                            f"({stt.MAX_BYTES} bytes of PCM16 at {stt.RATE} Hz)"}, 400)
        pcm = self.rfile.read(n)
        if not pcm or len(pcm) % 2:
            return self.send_json({"error": "the body must be PCM16 little-endian mono at 16000 Hz: "
                                            "an even number of bytes, not none"}, 400)
        try:
            return self.send_json(stt.transcribe(pcm))
        except stt.NotReady as e:                       # (the page closes its microphone until the status says ready)
            return self.send_json({"error": str(e)}, 503)
        except stt.TooSlow as e:                        # (this utterance only: the page goes on listening)
            return self.send_json({"error": str(e)}, 504)
        except RuntimeError as e:                       # the model failed on this audio: the page goes on listening
            return self.send_json({"error": str(e)}, 500)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/stt":
            return self.transcribe()
        if u.path == "/api/connections/elevenlabs":
            return self.change_connection(lambda body: connections.save_eleven(body.get("agentId"), body.get("plan")))
        if u.path == "/api/results":
            model = parse_qs(u.query).get("model", ["full"])[0]
            body = self.read_json()
            cid = str(body.get("id", ""))
            if not SAFE_ID.match(cid) or not SAFE_ID.match(model):
                return self.send_json({"error": "bad id"}, 400)
            out = DATA / "results" / model
            (out / "snapshots").mkdir(parents=True, exist_ok=True)
            for s in body.pop("snapshots", []):
                b64 = s["jpeg"].split(",", 1)[1]
                (out / "snapshots" / f"{cid}_{int(s['t']):06d}.jpg").write_bytes(base64.b64decode(b64))
            (out / f"{cid}.json").write_text(json.dumps(body))
            return self.send_json({"saved": f"{out / cid}.json"})
        if u.path == "/api/bench/result":
            name = parse_qs(u.query).get("name", [""])[0]
            if not SAFE_ID.match(name) or not BENCH.is_dir():
                return self.send_json({"error": "bad name"}, 400)
            (BENCH / "results").mkdir(exist_ok=True)
            (BENCH / "results" / f"{name}.json").write_text(json.dumps(self.read_json(), indent=1))
            return self.send_json({"saved": f"results/{name}.json"})
        if u.path.startswith("/api/coach/"):
            # the one coach endpoint that starts a session (a CLI on the user's subscription, or API calls on their
            # key). The others need a session's id, which a page elsewhere cannot read; and the page ends a session
            # with sendBeacon (plain text)
            refused = u.path == "/api/coach/start" and self.write_refused("start a coach session")
            if refused:
                return self.send_json({"error": refused[1]}, refused[0])
            body = self.read_json()
            try:
                if u.path == "/api/coach/describe":      # what a coach reads for an event (for ElevenLabs agents too)
                    return self.send_json(coach.describe(body.get("event") or {}))
                if u.path == "/api/coach/start":
                    return self.send_json(coach.start(body, DATA, f"http://127.0.0.1:{self.server.server_port}"))
                s = coach.get(str(body.get("session", "")))
                if u.path == "/api/coach/event":
                    return self.send_json(s.push(body.get("event") or {}))
                if u.path == "/api/coach/say":
                    return self.send_json(s.say(str(body.get("text", ""))[:400]))
                if u.path == "/api/coach/stop":
                    s.stop()
                    return self.send_json({"stopped": s.id})
            except KeyError as e:
                return self.send_json({"error": str(e)}, 404)
            except ValueError as e:                     # (a brain that is not one)
                return self.send_json({"error": str(e)}, 400)
            except Exception as e:  # noqa: BLE001 - reported to the page, which falls back to its template cues
                return self.send_json({"error": f"{type(e).__name__}: {e}"}, 500)
        self.send_error(404)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    DATA.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    atexit.register(coach.stop_all)                     # coach processes never outlive the server
    atexit.register(tts.stop)
    atexit.register(stt.stop)
    tts.start()                                         # the local voice loads in the background (if set up)
    stt.start()                                         # ... and the speech to text (unless POSE_STT=0)
    threading.Thread(target=connections.status, daemon=True).start()   # the CLI checks, ready for the page's first ask
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(f"pose coach dev server: http://localhost:{a.port}/  data={DATA}  clips={CLIPS}  moves={MOVES}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
