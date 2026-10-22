Stand-ins for the upstream demo's three processes and for `torch`, so `tests/entrypoint_cases.sh` can run the real
`runtime/entrypoint.sh` (preflight, Caddy, start order, worker registration, warm-up, readiness, supervision, shutdown)
on a CPU machine. They accept the same command-line flags the entrypoint passes to the real
`py_backend/server.py`, `worker.py` and `gateway.py` at the pinned demo commit, and speak just enough of the realtime
WebSocket protocol for `runtime/warmup.py`. Nothing here is copied into the image.
