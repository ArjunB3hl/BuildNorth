"""Opt-in local voice helper for the Rhythm Windows app: Parakeet hears, Kokoro speaks (sherpa-onnx on this PC's CPU), and
the user's own Claude Code sign-in answers through one MCP tool. Loopback only; no AI keys, no account data, no logs.

How the app finds and trusts it (as the Mac prototype's helper):
- The helper writes a random token to the app's own data folder (LocalState\\local-voice.token), which the app reads
  through its NorthWin module; web pages (the camera WebView included) cannot read it.
- The app sends POST /status with a fresh nonce and checks that the proof is HMAC-SHA256(token, nonce) before sending
  anything else, so an impostor on the port gets no speech text.
- Every other request needs `Authorization: Bearer <token>`. Requests must name Host 127.0.0.1:<port> exactly (no DNS
  rebinding) and carry no Origin header: browsers always send one on these requests, so no web page, iframe or
  WebView content can use the helper even if it guessed the token. No CORS is offered.
- JSON bodies only, at most MAX_BODY bytes; one job at a time (429 otherwise); /cancel stops the current one.
It does not protect against other programs running as the same Windows user, which can read the token file.

POST /status    {nonce}                 -> {proof, ready flags}                     (no token needed)
POST /info      {}                      -> {transcription, speech, microphone, claude: {loggedIn, account, ...}}
POST /listen    {waitS?, maxS?}         -> {heard, text}: one utterance, ended by a pause (heard=false after waitS of quiet)
POST /coach     {text}                  -> {text}: Claude Code's reply through speak_reply
POST /speak     {text, voice?}          -> {spoken}: Kokoro says it on this PC's speaker
POST /transcribe {audioBase64}          -> {text}: a 16 kHz mono 16-bit WAV (tests, and parity with the Mac helper)
POST /cancel    {}                      -> {cancelled}

    .venv\\Scripts\\python.exe win\\local-voice\\service.py --token-file <app LocalState>\\local-voice.token
(win/local-voice/start.ps1 finds the app's folder and runs this.)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "inference" / "pose-coach" / "server"))
sys.path.insert(0, str(HERE))
import audio  # noqa: E402
import claude_mcp  # noqa: E402
import stt  # noqa: E402
import tts  # noqa: E402

PORT = 39765
MAX_BODY = 1_000_000                     # a 30 s WAV in base64 is about 1.3 MB: /transcribe takes up to ~20 s
MAX_SPEAK = 600
MAX_WAIT_S = 60
BUSY = threading.Lock()
CANCEL = threading.Event()
PATHS = {"/status", "/info", "/listen", "/coach", "/speak", "/transcribe", "/cancel"}


class Refused(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


def ready() -> dict:
    t, s = stt.status(), tts.status()
    return {"transcription": bool(t.get("ready")), "speech": bool(s.get("ready"))}


def info() -> dict:
    t, s = stt.status(), tts.status()
    return {"transcription": {"installed": bool(t.get("available")), "ready": bool(t.get("ready")),
                              "error": t.get("error")},
            "speech": {"installed": bool(s.get("available")), "ready": bool(s.get("ready")), "error": s.get("error")},
            "microphone": audio.microphone(), "claude": claude_mcp.status()}


def require(model, name: str) -> None:
    """A clear answer when the model files are missing, rather than "loading" forever."""
    if not model.available():
        raise Refused(503, "missing_models",
                      f"{name} is not set up on this PC: run tools/setup_voice_windows.sh in inference/pose-coach.")


def _number(data: dict, key: str, default: float, low: float, high: float) -> float:
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise Refused(400, "invalid", f"{key} must be between {low} and {high}")
    return float(value)


def _text(data: dict, key: str, limit: int) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Refused(400, "invalid", f"{key} must be 1 to {limit} characters")
    return value.strip()


def listen(data: dict) -> dict:
    wait_s = _number(data, "waitS", 20, 3, MAX_WAIT_S)
    max_s = _number(data, "maxS", audio.MAX_UTTERANCE_S, 2, audio.MAX_UTTERANCE_S)
    require(stt, "Parakeet speech recognition")
    pcm = audio.listen(CANCEL, wait_s=wait_s, max_s=max_s)
    if not pcm:
        return {"heard": False, "text": ""}
    text = stt.transcribe(pcm)["text"]
    return {"heard": bool(text), "text": text}


def speak(data: dict) -> dict:
    text = _text(data, "text", MAX_SPEAK)
    voice = data.get("voice", "af_heart")
    if not isinstance(voice, str) or not re.fullmatch(r"[a-z]{2}_[a-z]{2,12}", voice):
        raise Refused(400, "invalid", "unknown voice")
    require(tts, "Kokoro speech")

    def chunks():
        for chunk in tts.say(text, voice):
            if chunk.get("error"):
                raise RuntimeError(chunk["error"])
            if chunk.get("superseded"):
                return
            if chunk.get("pcm"):
                yield base64.b64decode(chunk["pcm"], validate=True), int(chunk["rate"])

    return {"spoken": audio.play(chunks(), CANCEL)}


def transcribe(data: dict) -> dict:
    raw = data.get("audioBase64")
    if not isinstance(raw, str):
        raise Refused(400, "invalid", "audioBase64 is required")
    require(stt, "Parakeet speech recognition")
    try:
        with wave.open(io.BytesIO(base64.b64decode(raw, validate=True)), "rb") as wav:
            if wav.getparams()[:3] != (1, 2, 16000) or not 1600 <= wav.getnframes() <= 320_000:
                raise ValueError
            pcm = wav.readframes(wav.getnframes())
    except (ValueError, wave.Error, EOFError):
        raise Refused(400, "invalid", "Send a 16 kHz mono 16-bit WAV of 0.1 to 20 seconds") from None
    return {"text": stt.transcribe(pcm)["text"]}


def make_server(token: str, port: int = PORT) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # never log requests: they would show what was said

        def answer(self, status: int, data: dict) -> None:
            raw = json.dumps(data, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def trusted_caller(self) -> bool:
            return (self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"
                    and self.headers.get("Origin") is None
                    and not any(h.lower().startswith("sec-fetch-") for h in self.headers.keys()))

        def authorized(self) -> bool:
            return hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

        def do_GET(self):
            self.answer(405, {"error": "Unavailable"})

        def do_POST(self):
            if not self.trusted_caller() or self.path not in PATHS:
                return self.answer(403, {"error": "Unavailable"})
            if self.path != "/status" and not self.authorized():
                return self.answer(403, {"error": "Unavailable"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY or self.headers.get("Content-Type") != "application/json":
                    raise ValueError
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError
            except (ValueError, TypeError):
                return self.answer(400, {"error": "Invalid request", "code": "invalid"})

            if self.path == "/status":
                nonce = data.get("nonce", "")
                if not isinstance(nonce, str) or not re.fullmatch(r"[0-9a-f]{64}", nonce):
                    return self.answer(400, {"error": "Invalid request", "code": "invalid"})
                proof = hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
                return self.answer(200, {"proof": proof, **ready(), "busy": BUSY.locked()})
            if self.path == "/info":
                return self.answer(200, info())
            if self.path == "/cancel":
                busy = BUSY.locked()
                if busy:
                    CANCEL.set()
                return self.answer(200, {"cancelled": busy})

            if not BUSY.acquire(blocking=False):
                return self.answer(429, {"error": "Local voice is busy", "code": "busy"})
            CANCEL.clear()
            try:
                if self.path == "/listen":
                    return self.answer(200, listen(data))
                if self.path == "/coach":
                    text = _text(data, "text", claude_mcp.MAX_INPUT)
                    claude = claude_mcp.status()             # (cached briefly) never start a signed-out Claude Code
                    if not claude.get("loggedIn"):
                        raise Refused(503, "claude_unavailable", claude.get("error") or "Claude Code is not signed in.")
                    return self.answer(200, {"text": claude_mcp.reply(text, CANCEL)})
                if self.path == "/speak":
                    return self.answer(200, speak(data))
                return self.answer(200, transcribe(data))
            except Refused as e:
                return self.answer(e.status, {"error": str(e), "code": e.code})
            except (audio.Cancelled, InterruptedError):
                return self.answer(409, {"error": "Stopped", "code": "cancelled"})
            except audio.MicrophoneError as e:
                return self.answer(409, {"error": str(e), "code": e.code})
            except claude_mcp.ClaudeUnavailable as e:
                return self.answer(503, {"error": str(e), "code": "claude_unavailable"})
            except stt.TooSlow:
                return self.answer(504, {"error": "Speech recognition took too long", "code": "slow"})
            except (stt.NotReady, RuntimeError, OSError, TimeoutError):
                return self.answer(503, {"error": "Local voice is loading or unavailable", "code": "loading"})
            finally:
                BUSY.release()

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def write_token(path: Path, token: str) -> None:
    """The token replaces any left by a helper that did not exit cleanly (this one holds the port, so that one is gone)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + f".{os.getpid()}.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(token)
    os.replace(temp, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    if args.token_file.name != "local-voice.token" or args.token_file.parent.name != "LocalState":
        sys.exit("--token-file must be the Rhythm app's LocalState\\local-voice.token (use start.ps1)")
    token = secrets.token_hex(32)
    try:
        server = make_server(token, args.port)          # first: a second helper stops here, before any token is written
    except OSError:
        sys.exit(f"Port {args.port} is in use: the local voice helper is probably running already.")
    write_token(args.token_file, token)
    stt.start()
    tts.start()
    print(f"Rhythm local voice is listening on 127.0.0.1:{args.port}. Keep this window open; Ctrl+C stops it.",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        stt.stop()
        tts.stop()
        args.token_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
