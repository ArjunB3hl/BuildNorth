"""Shared helpers for the stub processes: a threaded JSON HTTP server."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def http_server(host, port, routes):
    """routes: {(method, path_prefix): fn(handler, body) -> (status, obj)}; serves forever in a daemon thread."""

    class H(BaseHTTPRequestHandler):
        def _go(self, method):
            n = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(n) or b"null") if n else None
            for (m, prefix), fn in routes.items():
                if m == method and self.path.startswith(prefix):
                    status, obj = fn(self, body)
                    break
            else:
                status, obj = 404, {"detail": "not found"}
            data = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._go("GET")

        def do_PUT(self):
            self._go("PUT")

        def log_message(self, fmt, *args):
            pass

    srv = ThreadingHTTPServer((host, port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
