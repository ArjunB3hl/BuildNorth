#!/usr/bin/env bash
# shellcheck disable=SC2015  # 'cond && ok || bad' is intended: ok/bad always return 0
# runtime/warmup.py (the warm-up and latency probe) against the stub gateway: per-chunk answer counting when the model
# speaks, falling behind real time, a server-side close, and the queue deadline. Needs a python with
# tests/requirements-tests.txt on PATH. Usage: bash tests/probe_cases.sh   (from inference/minicpm-o)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
W=$(mktemp -d)
pass=0 failn=0
ok() { pass=$((pass + 1)); printf 'ok    %s\n' "$1"; }
bad() { failn=$((failn + 1)); printf 'FAIL  %s\n' "$1"; if [[ -n ${2:-} && -f $2 ]]; then cat "$2"; fi; return 0; }
GWPID=""
gateway() {   # gateway [ENV=VALUE ...] [--no-register]: (re)start the stub gateway on 18206/18207
  [[ -n $GWPID ]] && kill "$GWPID" 2>/dev/null && wait "$GWPID" 2>/dev/null
  local envs=() register=1
  for x in "$@"; do if [[ $x == --no-register ]]; then register=0; else envs+=("$x"); fi; done
  (cd tests/stub_demo && exec env "${envs[@]}" python gateway.py --host 127.0.0.1 --port 18206 --internal-port 18207 --http) \
    > "$W/gw.log" 2>&1 &
  GWPID=$!
  for _ in $(seq 1 50); do curl -fsS http://127.0.0.1:18207/health >/dev/null 2>&1 && break; sleep 0.1; done
  if [[ $register == 1 ]]; then
    curl -fsS -X PUT http://127.0.0.1:18207/internal/workers/w0 -H 'content-type: application/json' \
      --data '{"endpoint":"127.0.0.1:1"}' >/dev/null
  fi
}
trap '[[ -n $GWPID ]] && kill $GWPID 2>/dev/null; rm -rf "$W"' EXIT
probe() { python runtime/warmup.py --url ws://127.0.0.1:18206/v1/realtime "$@"; }
field() { python -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {'d': d}))" "$@"; }

echo "--- listen-only model, 4 chunks"
gateway
probe --skip-chat --chunks 4 --timeout 20 --json "$W/a.json" > "$W/a.log" 2>&1 && ok "probe exit 0" || bad "probe failed" "$W/a.log"
[[ $(field "$W/a.json" "d['video']['chunks_answered']") == 4 ]] && ok "4/4 chunks answered" || bad "answered: $(field "$W/a.json" "d['video']")"
lag=$(field "$W/a.json" "d['video']['lag_after_last_chunk_s']")
python -c "import sys; sys.exit(0 if float('$lag') < 0.5 else 1)" && ok "keeps pace: last-chunk lag ${lag}s" || bad "lag $lag"
[[ $(field "$W/a.json" "d['video']['closed_reason']") == probe_done ]] && ok "waited for session.closed after session.close" || bad "no close ack"

echo "--- speaking model (text+audio+listen per chunk) that is slower than real time (1.5 s per 1 s chunk), 5 chunks"
gateway STUB_SPEAK=1 STUB_UNIT_S=1.5
probe --skip-chat --chunks 5 --timeout 30 --json "$W/b.json" > "$W/b.log" 2>&1 && ok "probe exit 0" || bad "probe failed" "$W/b.log"
[[ $(field "$W/b.json" "d['video']['chunks_answered']") == 5 ]] && ok "5/5 chunks answered (deltas not miscounted as chunks)" \
  || bad "answered $(field "$W/b.json" "d['video']['chunks_answered']")"
[[ $(field "$W/b.json" "d['video']['backend_wall_clock_ms']['n']") == 5 ]] && ok "wall_clock_ms counted once per chunk" || bad "wall n"
lag=$(field "$W/b.json" "d['video']['lag_after_last_chunk_s']")
python -c "import sys; sys.exit(0 if float('$lag') > 3.0 else 1)" && ok "falling behind is visible: last-chunk lag ${lag}s (> 3 s)" || bad "lag $lag hides the backlog"
[[ $(field "$W/b.json" "d['video']['audio_out_s']") != 0 ]] && ok "audio output measured ($(field "$W/b.json" "d['video']['audio_out_s']") s)" || bad "no audio measured"

echo "--- backend fails after 2 chunks (session.closed reason=backend_error)"
gateway STUB_FAIL_AFTER_CHUNKS=2
probe --skip-chat --chunks 4 --timeout 20 --json "$W/c.json" > "$W/c.log" 2>&1 && bad "probe passed despite backend_error" "$W/c.log" \
  || { grep -q 'reason=backend_error' "$W/c.log" && ok "exit 1, reports reason=backend_error" || bad "wrong error" "$W/c.log"; }

echo "--- the backend fails while cleaning up (session.closed reason=backend_error after our session.close)"
gateway STUB_CLOSE_REASON=backend_error
probe --skip-video --timeout 20 > "$W/f.log" 2>&1 && bad "probe passed although the close failed" "$W/f.log" \
  || { grep -q "session closed with reason='backend_error'" "$W/f.log" && ok "exit 1: close answered with backend_error is a failure" || bad "close msg" "$W/f.log"; }

echo "--- the video session sends the full duplex config (a gateway that refuses an empty config)"
gateway STUB_REQUIRE_CONFIG=1
probe --skip-chat --chunks 2 --timeout 20 --json "$W/g.json" > "$W/g.log" 2>&1 && ok "probe exit 0 with the config check on" || bad "config" "$W/g.log"
[[ $(field "$W/g.json" "d['video']['duplex_config']['temperature']") == 0.7 ]] && ok "duplex_config recorded (temperature 0.7)" || bad "config record"

echo "--- no free worker: --no-queue fails at once; otherwise the handshake deadline holds despite queue updates"
gateway --no-register
t0=$(date +%s)
probe --skip-video --timeout 20 --no-queue > "$W/d.log" 2>&1 && bad "probe passed with no worker" "$W/d.log" \
  || { grep -q 'queued behind another session' "$W/d.log" && (( $(date +%s) - t0 < 5 )) && ok "--no-queue: fails within 5 s" || bad "no-queue" "$W/d.log"; }
t0=$(date +%s)
probe --skip-video --timeout 5 > "$W/e.log" 2>&1 && bad "probe passed with no worker" "$W/e.log" \
  || { el=$(( $(date +%s) - t0 )); grep -q 'no session within 5s' "$W/e.log" && (( el <= 8 )) \
       && ok "queued: gives up after the 5 s deadline (${el}s) although updates keep arriving" || bad "deadline (${el}s)" "$W/e.log"; }

echo "probe cases: $pass passed, $failn failed"
[[ $failn == 0 ]]
