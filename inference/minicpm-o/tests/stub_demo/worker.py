"""Stub of `python worker.py`: /health only (the real worker forwards sessions to the backend)."""
import argparse
import time

from _stub import http_server

ap = argparse.ArgumentParser()
ap.add_argument("--host", required=True)
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--gpu-id", type=int, required=True)
ap.add_argument("--backend-server-url", required=True)
a = ap.parse_args()
http_server(a.host, a.port, {("GET", "/health"): lambda h, b: (200, {"status": "healthy", "worker_status": "idle",
                                                                  "model_loaded": True})})
print(f"stub worker on {a.host}:{a.port} -> {a.backend_server_url}", flush=True)
while True:
    time.sleep(1)
