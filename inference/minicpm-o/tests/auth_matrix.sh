#!/usr/bin/env bash
# The public port's access rules, end to end: the real runtime/Caddyfile in front of the stub gateway (HTTP and the
# realtime WebSocket). Needs caddy and a python with tests/requirements-tests.txt on PATH.
# Usage: bash tests/auth_matrix.sh   (from inference/minicpm-o)
set -euo pipefail
cd "$(dirname "$0")/.."
W=$(mktemp -d)
export RHYTHM_PUBLIC_PORT=${RHYTHM_PUBLIC_PORT:-18000} GATEWAY_PORT=${GATEWAY_PORT:-18006} RHYTHM_RUN_DIR=$W/run
export RHYTHM_API_TOKEN=tok-0123456789abcdef0123456789abcdef RUNPOD_POD_ID=testpod
OWN=https://testpod-$RHYTHM_PUBLIC_PORT.proxy.runpod.net
mkdir -p "$RHYTHM_RUN_DIR"
(cd tests/stub_demo && exec python gateway.py --host 127.0.0.1 --port "$GATEWAY_PORT" --internal-port 18007 --http) \
  > "$W/gateway.log" 2>&1 &
GW=$!
caddy run --config runtime/Caddyfile --adapter caddyfile > "$W/caddy.log" 2>&1 &
CADDY=$!
trap 'kill $GW $CADDY 2>/dev/null; rm -rf "$W"' EXIT
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$RHYTHM_PUBLIC_PORT/healthz" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:18007/health" >/dev/null 2>&1 && break
  sleep 0.2
done
curl -fsS -X PUT "http://127.0.0.1:18007/internal/workers/w0" -H 'content-type: application/json' \
  --data '{"endpoint":"127.0.0.1:1"}' >/dev/null

U=http://127.0.0.1:$RHYTHM_PUBLIC_PORT
T=$RHYTHM_API_TOKEN
pass=0 failn=0
check() {      # check NAME WANT_STATUS [curl args...]; body/headers kept in $W/body and $W/hdr
  local name=$1 want=$2
  shift 2
  local got
  got=$(curl -s -o "$W/body" -D "$W/hdr" -w '%{http_code}' "$@")
  if [[ $got == "$want" ]]; then pass=$((pass + 1)); printf 'ok    %-58s %s\n' "$name" "$got"
  else failn=$((failn + 1)); printf 'FAIL  %-58s %s (wanted %s): %s\n' "$name" "$got" "$want" "$(head -c 200 "$W/body")"; fi
}
body_has() {   # body_has NAME PATTERN
  if grep -qE -- "$2" "$W/body" "$W/hdr"; then pass=$((pass + 1)); printf 'ok    %s\n' "$1"
  else failn=$((failn + 1)); printf 'FAIL  %s: /%s/ not in response\n' "$1" "$2"; cat "$W/hdr" "$W/body"; fi
}
body_lacks() {
  if grep -qE -- "$2" "$W/body"; then failn=$((failn + 1)); printf 'FAIL  %s: /%s/ leaked\n' "$1" "$2"
  else pass=$((pass + 1)); printf 'ok    %s\n' "$1"; fi
}

echo "--- model loading (no ready flag)"
check "/healthz needs no token" 200 "$U/healthz"
check "/readyz is 503 while loading" 503 "$U/readyz"
check "no token -> 401" 401 "$U/echo"
check "right token, not ready -> 503" 503 -H "Authorization: Bearer $T" "$U/echo"
body_has "503 says the model is loading" '"error":"starting"'

touch "$RHYTHM_RUN_DIR/ready"
echo "--- ready"
check "/readyz is 200 when ready" 200 "$U/readyz"
check "no token -> 401" 401 "$U/echo"
check "wrong bearer -> 401" 401 -H "Authorization: Bearer wrong-0123456789abcdef0123456789abcd" "$U/echo"
check "token + 1 char -> 401" 401 -H "Authorization: Bearer ${T}x" "$U/echo"
check "token minus last char -> 401" 401 -H "Authorization: Bearer ${T%?}" "$U/echo"
check "token without 'Bearer ' -> 401" 401 -H "Authorization: $T" "$U/echo"
check "authorized GET reaches the gateway" 200 -H "Authorization: Bearer $T" "$U/echo"
body_has "proxied responses say Cache-Control: no-cache (no stale page code after an image switch)" '^[Cc]ache-[Cc]ontrol: no-cache'
check "empty access_token -> 401" 401 "$U/echo?access_token="
check "wrong cookie -> 401" 401 -H "Cookie: __Host-rhythm_token=nope" "$U/echo"
check "old cookie name is not accepted" 401 -H "Cookie: rhythm_token=$T" "$U/echo"
check "bearer token -> 200 from the gateway" 200 -H "Authorization: Bearer $T" "$U/echo"
body_has "gateway answered" '"path": "/echo"'
body_has "Authorization header is stripped before the gateway" '"authorization": null'
check "access_token query -> 200" 200 "$U/echo?x=1&access_token=$T"
body_lacks "access_token is removed from the URL the gateway sees" "$T"
body_has "other query parameters are kept" '"path": "/echo\?x=1"'
body_has "query login sets a __Host- HttpOnly Secure SameSite cookie" "Set-Cookie: __Host-rhythm_token=$T; Path=/; HttpOnly; Secure; SameSite=Strict"
body_has "query login answers with Referrer-Policy: no-referrer" "Referrer-Policy: no-referrer"
check "Referer carrying the token -> 200" 200 -H "Authorization: Bearer $T" -H "Referer: https://x/?access_token=$T" "$U/echo"
body_lacks "Referer is not forwarded to the gateway" "$T"
check "cookie, no Origin (navigation) -> 200" 200 -H "Cookie: other=1; __Host-rhythm_token=$T; more=2" "$U/echo"
body_lacks "the token cookie is removed before the gateway" "$T"
body_has "other cookies are kept" '"cookie": "other=1; more=2"'
check "cookie + this Pod's Origin -> 200" 200 -H "Cookie: __Host-rhythm_token=$T" -H "Origin: $OWN" -H "Sec-Fetch-Site: same-origin" "$U/echo"
check "cookie + another Pod's Origin -> 401" 401 -H "Cookie: __Host-rhythm_token=$T" -H "Origin: https://evil-8000.proxy.runpod.net" "$U/echo"
check "cookie + Sec-Fetch-Site: same-site -> 401" 401 -H "Cookie: __Host-rhythm_token=$T" -H "Sec-Fetch-Site: same-site" "$U/echo"
check "cookie + Sec-Fetch-Site: cross-site -> 401" 401 -H "Cookie: __Host-rhythm_token=$T" -H "Sec-Fetch-Site: cross-site" "$U/echo"
check "bearer + foreign Origin still 200 (apps send no cookie)" 200 -H "Authorization: Bearer $T" -H "Origin: https://evil-8000.proxy.runpod.net" "$U/echo"
check "authorized POST (upload-recording) -> 405" 405 -X POST -H "Authorization: Bearer $T" "$U/api/sessions/x/upload-recording"
check "authorized DELETE (queue ticket) -> 405" 405 -X DELETE -H "Authorization: Bearer $T" "$U/api/queue/x"
check "authorized PUT (eta config) -> 405" 405 -X PUT -H "Authorization: Bearer $T" "$U/api/config/eta"
check "unauthorized POST -> 401 (auth first)" 401 -X POST "$U/api/sessions/x/upload-recording"
check "authorized HEAD -> passes" 200 -I -H "Authorization: Bearer $T" "$U/echo"
check "bearer, no Set-Cookie" 200 -H "Authorization: Bearer $T" "$U/echo"
if grep -qi '^set-cookie' "$W/hdr"; then failn=$((failn + 1)); echo "FAIL  Set-Cookie sent without a query login"
else pass=$((pass + 1)); echo "ok    Set-Cookie only on a query login"; fi
check "unknown path, no token -> 401 (no route leak)" 401 "$U/api/admin/apps"
check "X-Forwarded-For spoof does not bypass auth" 401 -H "X-Forwarded-For: 127.0.0.1" "$U/echo"

echo "--- realtime WebSocket through Caddy"
python - "$U" "$T" "$OWN" <<'EOF' && pass=$((pass + 5)) || failn=$((failn + 1))
import asyncio, json, sys
import websockets
from websockets.exceptions import InvalidStatus
base, tok, own = sys.argv[1].replace("http://", "ws://"), sys.argv[2], sys.argv[3]

async def handshake(ws):
    while True:
        m = json.loads(await ws.recv())
        if m["type"] == "session.queue_done":
            await ws.send(json.dumps({"type": "session.init", "payload": {}}))
        elif m["type"] == "session.created":
            return m

async def main():
    try:
        async with websockets.connect(f"{base}/v1/realtime?mode=chat"):
            raise SystemExit("FAIL  WebSocket without a token was accepted")
    except InvalidStatus as e:
        assert e.response.status_code == 401, e
        print("ok    WebSocket without a token -> 401 at the handshake")
    async with websockets.connect(f"{base}/v1/realtime?mode=chat",
                                  additional_headers={"Authorization": f"Bearer {tok}"}) as ws:
        await handshake(ws)
        await ws.send(json.dumps({"type": "input.append", "input": {}}))
        assert json.loads(await ws.recv())["type"] == "response.output.delta"
        print("ok    WebSocket with a bearer token: session created, response streamed")
    async with websockets.connect(f"{base}/v1/realtime?mode=video", origin=own,
                                  additional_headers={"Cookie": f"__Host-rhythm_token={tok}"}) as ws:
        await handshake(ws)
        print("ok    WebSocket with the cookie from this Pod's page (browser path): session created")
    for origin in ("https://evil-8000.proxy.runpod.net", None):
        hdrs = {"Cookie": f"__Host-rhythm_token={tok}"}
        if origin is None:
            hdrs["Sec-Fetch-Site"] = "same-site"
        try:
            async with websockets.connect(f"{base}/v1/realtime?mode=chat", origin=origin, additional_headers=hdrs):
                raise SystemExit(f"FAIL  cross-origin cookie WebSocket accepted ({origin or 'Sec-Fetch-Site: same-site'})")
        except InvalidStatus as e:
            assert e.response.status_code == 401, e
            print(f"ok    WebSocket with the cookie from {origin or 'a same-site page'} -> 401 (no cross-Pod hijack)")

asyncio.run(main())
EOF

echo "auth matrix: $pass passed, $failn failed"
[[ $failn == 0 ]]
