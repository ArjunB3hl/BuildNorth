"""Stub of `python -m py_backend.server`: /health says "loading" for STUB_LOAD_S seconds, then "ready".
STUB_BACKEND_NEVER_READY=1 never gets ready; STUB_BACKEND_EXIT_AFTER_S=N exits with status 3 after N seconds."""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _stub import http_server  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--host", required=True)
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--gpu-id", type=int, required=True)
ap.add_argument("--model-path", required=True)
a = ap.parse_args()
assert os.path.isfile(os.path.join(a.model_path, "config.json")), a.model_path
t0 = time.time()
load_s = float(os.environ.get("STUB_LOAD_S", "2"))


def health(_h, _b):
    ready = time.time() - t0 >= load_s and not os.environ.get("STUB_BACKEND_NEVER_READY")
    stuck = os.environ.get("STUB_BACKEND_STUCK_SESSION") == "1"     # a session whose cleanup failed stays bound
    return 200, {"status": "ready" if ready else "loading", "backend": "stub",
                 "active_session_id": "sess_stuck" if stuck and ready else None}


http_server(a.host, a.port, {("GET", "/health"): health})
print(f"stub backend on {a.host}:{a.port}, model {a.model_path}", flush=True)
exit_after = float(os.environ.get("STUB_BACKEND_EXIT_AFTER_S", "0") or 0)
while True:
    time.sleep(0.2)
    if exit_after and time.time() - t0 > exit_after:
        print("stub backend: simulated crash", flush=True)
        sys.exit(3)
