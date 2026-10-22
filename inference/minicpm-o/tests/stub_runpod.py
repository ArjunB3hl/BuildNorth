"""Stub of Runpod's REST API (rest.runpod.io/v1) for tests/rp_cases.sh: GET/PATCH /pods/pod1 and POST /templates.

PATCH applies Runpod's documented defaults to every field the request leaves out (the worst case for an in-place image
switch). STUB_BREAK=ports makes the PATCH change the ports anyway, to test rp.sh's check. Requests are logged to
$STUB_LOG, one JSON line each."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

DEFAULTS = {"ports": ["8888/http", "22/tcp"], "env": {}, "containerDiskInGb": 50, "volumeInGb": 20,
            "volumeMountPath": "/workspace"}
POD = {
    "id": "pod1", "name": "gentle", "desiredStatus": "RUNNING", "costPerHr": 0.99,
    "imageName": "ghcr.io/x/rhythm@sha256:" + "0" * 64, "containerRegistryAuthId": "auth1",
    "containerDiskInGb": 50, "volumeInGb": 0, "volumeMountPath": "/workspace", "networkVolumeId": "vol1",
    "ports": ["8000/http", "22/tcp"], "dockerEntrypoint": None, "dockerStartCmd": None,
    "env": {"JUPYTER_PASSWORD": "SECRETjupyter123", "PUBLIC_KEY": "ssh-ed25519 AAAA test",
            "RHYTHM_API_TOKEN": "{{ RUNPOD_SECRET_rhythm_api_token }}"},
}


def log(entry: dict) -> None:
    with open(os.environ["STUB_LOG"], "a") as f:
        f.write(json.dumps(entry) + "\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        if self.headers.get("Authorization") == "Bearer testkey":
            return True
        self.reply(401, {"error": "unauthorized"})
        return False

    def body(self) -> dict:
        return json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")

    def do_GET(self):
        if self.authorized():
            self.reply(200, POD) if self.path == "/pods/pod1" else self.reply(404, {"error": "not found"})

    def do_PATCH(self):
        if not self.authorized():
            return
        req = self.body()
        log({"patch": req})
        for key, default in DEFAULTS.items():
            POD[key] = req.get(key, default)
        for key in ("imageName", "containerRegistryAuthId", "name"):
            if key in req:
                POD[key] = req[key]
        if os.environ.get("STUB_BREAK") == "ports":
            POD["ports"] = ["8888/http"]
        self.reply(200, POD)

    def do_POST(self):
        if self.authorized():
            log({"post": self.path, "body": self.body()})
            self.reply(200, {"id": "tpl1"})


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
