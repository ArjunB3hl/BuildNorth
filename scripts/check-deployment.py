#!/usr/bin/env python3
"""Read-only public deployment checks; no credentials, model calls, or account writes."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def origin(value):
    parsed = urlparse(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username
            or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("Use an HTTP(S) origin without credentials, path, query, or fragment.")
    return value.rstrip("/")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", type=origin, default="https://buildnorth.onrender.com")
    parser.add_argument("--website", type=origin, default="https://rhythm-buildnorth.expo.app")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--shared-ai", choices=("disabled", "anthropic"), default="disabled",
                        help="Expected shared provider configuration (default: disabled). Does not check users' own keys.")
    args = parser.parse_args()
    checks = []

    def record(name, passed, detail):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    def request(path, method="GET", headers=None):
        req = Request(args.api + path, method=method, headers=headers or {})
        try:
            with urlopen(req, timeout=20) as response:
                return response.status, response.headers, response.read(65536)
        except HTTPError as error:
            return error.code, error.headers, error.read(65536)
        except (URLError, TimeoutError, OSError):
            # Do not print response bodies or environment/credential values on failures.
            return 0, {}, b""

    def document(body):
        try:
            value = json.loads(body)
            return value if isinstance(value, dict) else {}
        except (ValueError, UnicodeDecodeError):
            return {}

    status, _, body = request("/health")
    health = document(body)
    record("API health", status == 200 and health.get("status") == "ok", f"HTTP {status}")
    record("Clerk configured", health.get("clerkConfigured") is True, "Public readiness flag")
    expected_provider = "none" if args.shared_ai == "disabled" else "anthropic"
    record("Shared AI configuration", health.get("aiAvailable") is (args.shared_ai != "disabled")
           and health.get("aiProvider") == expected_provider,
           f"Expected {args.shared_ai}; configuration only, no paid model request")

    month = datetime.now(timezone.utc).strftime("%Y-%m")
    for path in ("/profile", "/connections/access", "/connections/claude", "/connections/elevenlabs",
                 "/watch/health", "/watch/calendar", f"/calendar/report?month={month}&timezone=UTC"):
        status, _, _ = request(path)
        record(f"Authentication required: {path}", status == 401, f"HTTP {status}; no token supplied")

    for web_origin, expected in ((args.website, True), ("https://rhythm-check.invalid", False)):
        status, headers, _ = request("/profile", "OPTIONS", {
            "Origin": web_origin, "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        })
        allowed = headers.get("Access-Control-Allow-Origin")
        passed = status == 200 and allowed == web_origin if expected else status == 400 and not allowed
        record("Website CORS" if expected else "Foreign-origin CORS rejection", passed, f"HTTP {status}")

    for path, resource in (("/.well-known/oauth-protected-resource", "/mcp"),
                           ("/.well-known/oauth-protected-resource/rhythm/mcp", "/rhythm/mcp")):
        status, _, body = request(path)
        metadata = document(body)
        servers = metadata.get("authorization_servers", [])
        passed = (status == 200 and metadata.get("resource") == args.api + resource
                  and isinstance(servers, list) and bool(servers)
                  and all(isinstance(server, str) and server.startswith("https://") for server in servers))
        record(f"MCP discovery: {resource}", passed, f"HTTP {status}; deployed resource and HTTPS issuer")
        status, headers, _ = request(resource, headers={"Accept": "text/event-stream"})
        record(f"MCP authentication: {resource}", status == 401 and "resource_metadata=" in headers.get("WWW-Authenticate", ""),
               f"HTTP {status}; OAuth discovery challenge required")

    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(), "api": args.api, "websiteOrigin": args.website,
        "passed": all(check["passed"] for check in checks), "checks": checks,
        "limits": ["No signed-in account data, model generation, website rendering, or hardware sensors tested.",
                   "Health readiness reports configuration, not provider availability or persistent database writes."],
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    for check in checks:
        print(f"{'PASS' if check['passed'] else 'FAIL'} {check['name']}: {check['detail']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
