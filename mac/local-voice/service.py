"""Opt-in loopback-only speech service for the Mac app; no AI keys or account data.

The secret is shared with the app via a per-user file, never with web pages. Requests
without it are rejected, and no CORS is offered. The proof authenticates the server
before the native bridge sends speech or reply text to it.
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

ROOT = Path(__file__).resolve().parents[2] / 'inference' / 'pose-coach'
sys.path.insert(0, str(ROOT / 'server'))
import stt  # noqa: E402
import tts  # noqa: E402
import claude_mcp  # noqa: E402

MAX_BODY = 900_000
BUSY = threading.BoundedSemaphore(1)


def make_server(token: str, port: int):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log speech, transcripts, text, or credentials.

        def answer(self, status, data, headers=()):
            raw = json.dumps(data, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            for key, value in headers:
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self):
            expected = 'Bearer ' + token
            return (self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}' and
                    self.headers.get('Origin') is None and
                    hmac.compare_digest(self.headers.get('Authorization', ''), expected))

        def do_POST(self):
            if (self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}' or
                self.headers.get('Origin') is not None or
                (self.path != '/status' and not self.authorized())):
                return self.answer(403, {'error': 'Unavailable'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_BODY or self.headers.get('Content-Type') != 'application/json':
                    return self.answer(400, {'error': 'Invalid request'})
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, TypeError):
                return self.answer(400, {'error': 'Invalid request'})
            if self.path == '/status':
                nonce = data.get('nonce', '')
                if not isinstance(nonce, str) or not re.fullmatch(r'[0-9a-f]{64}', nonce):
                    return self.answer(400, {'error': 'Invalid request'})
                proof = hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
                return self.answer(200, {'proof': proof, 'transcription': stt.status(), 'speech': tts.status(), 'claudeLoggedIn': claude_mcp.is_logged_in()})
            if self.path not in ('/transcribe', '/synthesize', '/coach'):
                return self.answer(404, {'error': 'Unavailable'})
            if not BUSY.acquire(blocking=False):
                return self.answer(429, {'error': 'Local voice is busy'})
            try:
                if self.path == '/coach':
                    return self.answer(200, {'text': claude_mcp.reply(data.get('text'))})
                if self.path == '/transcribe':
                    raw = base64.b64decode(data.get('audioBase64', ''), validate=True)
                    with wave.open(io.BytesIO(raw), 'rb') as wav:
                        if wav.getparams()[:3] != (1, 2, 16000) or not 1600 <= wav.getnframes() <= 320000:
                            raise ValueError()
                        pcm = wav.readframes(wav.getnframes())
                    return self.answer(200, {'text': stt.transcribe(pcm)['text']})
                text = data.get('text')
                if not isinstance(text, str) or not 0 < len(text) <= 600:
                    raise ValueError()
                pcm = bytearray()
                rate = None
                for chunk in tts.say(text):
                    if chunk.get('error') or chunk.get('superseded'):
                        raise RuntimeError()
                    if chunk.get('pcm'):
                        rate = chunk['rate'] if rate is None else rate
                        if chunk['rate'] != rate:
                            raise RuntimeError()
                        pcm.extend(base64.b64decode(chunk['pcm'], validate=True))
                        if len(pcm) > 8_000_000:
                            raise ValueError()
                if not pcm or not rate:
                    raise RuntimeError()
                output = io.BytesIO()
                with wave.open(output, 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(pcm)
                return self.answer(200, {'audioBase64': base64.b64encode(output.getvalue()).decode(), 'mimeType': 'audio/wav'})
            except (ValueError, TypeError, wave.Error, EOFError):
                return self.answer(400, {'error': 'Invalid audio or text'})
            except (stt.NotReady, stt.TooSlow, RuntimeError, OSError, TimeoutError):
                return self.answer(503, {'error': 'Local voice is loading or unavailable'})
            finally:
                BUSY.release()

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--port', type=int, default=39765)
    args = parser.parse_args()
    args.token_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    token = secrets.token_hex(32)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(args.token_file, flags, 0o600)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(token)
        server = make_server(token, args.port)
        stt.start(); tts.start()
        try:
            server.serve_forever()
        finally:
            server.server_close(); stt.stop(); tts.stop()
    finally:
        args.token_file.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
