#!/usr/bin/env bash
# shellcheck disable=SC2015  # 'cond && ok || bad' is intended: ok/bad always return 0
# The real runtime/entrypoint.sh on a CPU machine, with tests/stub_demo standing in for the demo's backend, worker,
# gateway and torch, a stub nvidia-smi, and a synthetic model dir: start order, readiness only after the warm-up,
# timings, failure exits, supervision, hold mode and shutdown. Needs caddy, curl and a python with
# tests/requirements-tests.txt on PATH (GNU date: on macOS, coreutils' gdate is used automatically).
# Usage: bash tests/entrypoint_cases.sh   (from inference/minicpm-o)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT=$PWD
W=$(mktemp -d)
mkdir -p "$W/bin"
if ! [[ $(date +%3N) =~ ^[0-9]{3}$ ]] || ! date -d @0 >/dev/null 2>&1; then   # BSD date (macOS): shim GNU date
  command -v gdate >/dev/null || { echo "needs GNU date (coreutils gdate on macOS)"; exit 1; }
  ln -s "$(command -v gdate)" "$W/bin/date"
fi
printf '#!/bin/sh\necho "NVIDIA L40S, 46068, 580.65.06"\n' > "$W/bin/nvidia-smi"
chmod +x "$W/bin/nvidia-smi"
REV=d59117d19ddb8a28a62f1b5f4e3b34ac48d510a4
python tests/make_fake_model.py "$W/model" "$REV"

export PATH="$W/bin:$PATH"
export RHYTHM_RUNTIME_DIR=$ROOT/runtime RHYTHM_RUN_DIR=$W/run MODEL_REVISION=$REV MODEL_DIR=$W/model
export RHYTHM_PUBLIC_PORT=18000 GATEWAY_PORT=18006 GATEWAY_INTERNAL_PORT=18007 WORKER_PORT=18400 BACKEND_PORT=18500
export RHYTHM_API_TOKEN=tok-0123456789abcdef0123456789abcdef STUB_LOAD_S=1
unset PUBLIC_KEY
U=http://127.0.0.1:$RHYTHM_PUBLIC_PORT
pass=0 failn=0
ok() { pass=$((pass + 1)); printf 'ok    %s\n' "$1"; }
bad() { failn=$((failn + 1)); printf 'FAIL  %s\n' "$1"; if [[ -n ${2:-} && -f $2 ]]; then tail -25 "$2"; fi; return 0; }

# run_case NAME [ENV=VALUE ...]: start the entrypoint in the background (fresh app copy + state dir), log in $W/NAME.log
run_case() {
  local name=$1
  shift
  pkill -f -- "$PROCS" 2>/dev/null; sleep 0.5
  rm -rf "$W/app" "$W/state" "$W/run"
  cp -R tests/stub_demo "$W/app"
  env RHYTHM_APP_DIR="$W/app" RHYTHM_STATE_DIR="$W/state" "$@" bash runtime/entrypoint.sh > "$W/$name.log" 2>&1 &
  EP=$!
}
wait_exit() {   # wait_exit SECONDS -> sets RC (or 124 on timeout)
  for _ in $(seq 1 "$(( $1 * 5 ))"); do
    if ! kill -0 "$EP" 2>/dev/null; then wait "$EP"; RC=$?; return; fi
    sleep 0.2
  done
  RC=124
}
wait_ready() {
  for _ in $(seq 1 "$(( $1 * 5 ))"); do
    curl -fsS "$U/readyz" >/dev/null 2>&1 && return 0
    kill -0 "$EP" 2>/dev/null || return 1
    sleep 0.2
  done
  return 1
}
PROCS="--port 1(8500|8400|8006) |caddy run --config $ROOT/runtime/Caddyfile"
leftovers() { pgrep -f -- "$PROCS" >/dev/null 2>&1; }
run_dir() { find "$W/state/logs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1; }

echo "--- A. happy path: ready only after the warm-up, then SIGTERM"
run_case happy
if wait_ready 60; then ok "became ready (/readyz 200)"; else bad "never became ready" "$W/happy.log"; fi
L=$W/happy.log
order=$(grep -oE 't\+[0-9.]+s (preflight_done|caddy_up|model_loaded|gateway_up|warmup_done|ready)' "$L" | awk '{print $2}' | tr '\n' ' ')
[[ $order == "preflight_done caddy_up model_loaded gateway_up warmup_done ready " ]] \
  && ok "start order: $order" || bad "start order was: $order" "$L"
grep -q '\[warmup\] chat ok' "$L" && grep -q '\[warmup\] video duplex ok' "$L" && ok "warm-up answered (chat + video)" \
  || bad "warm-up lines missing" "$L"
grep -q 'stub gateway: registered worker-0' "$L" && ok "worker registered with the gateway" || bad "no registration" "$L"
for _ in $(seq 1 25); do grep -q 'READY: ' "$L" && break; sleep 0.2; done   # logged just after the flag
grep -q 'READY: https://<pod-id>-18000.proxy.runpod.net' "$L" && ok "READY line with the public URL" || bad "no READY line" "$L"
R=$(run_dir)
python -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['status']=='ready' and d['marks_s']['ready']>=d['marks_s']['model_loaded'], d" "$R/startup.json" \
  && ok "startup.json timings: $(python -c "import json,sys; print(json.load(open(sys.argv[1]))['marks_s'])" "$R/startup.json")" \
  || bad "startup.json" "$R/startup.json"
for f in preflight.json warmup.json config.json backend.log worker.log gateway.log caddy.log; do
  [[ -s $R/$f ]] || { bad "missing $f in the run's log dir"; continue; }
done && ok "run log dir has preflight/warmup/config JSON and per-process logs"
grep -q 'tok-0123456789abcdef' "$L" "$R"/*.log "$R"/*.json && bad "the access token appears in the logs" || ok "access token not in any log"
pid=$(pgrep -f "py_backend.server --host 127.0.0.1 --port 18500" | head -1)
[[ -n $pid ]] && ok "backend running as a real process (pid $pid)" || bad "backend process not found"
kill -TERM "$EP"; wait_exit 40
[[ $RC == 0 ]] && ok "SIGTERM -> clean exit 0" || bad "SIGTERM exit status $RC" "$L"
sleep 1
leftovers && bad "processes left after shutdown: $(pgrep -fl -- "$PROCS" | head -3)" || ok "no processes left behind"
[[ ! -e $W/run/ready ]] && ok "ready flag removed on shutdown" || bad "ready flag still present"

echo "--- B. preflight failure (no token): fails fast, starts nothing"
run_case notoken RHYTHM_API_TOKEN=
wait_exit 20
[[ $RC == 1 ]] && ok "exit 1" || bad "exit $RC" "$W/notoken.log"
grep -q 'FATAL: preflight failed (exit 2): RHYTHM_API_TOKEN is not set' "$W/notoken.log" && ok "FATAL line names the cause" \
  || bad "FATAL line" "$W/notoken.log"
grep -q 'RHYTHM_API_TOKEN is not set' "$(run_dir)/FAILED" && ok "FAILED file written" || bad "FAILED file"
grep -q 'started backend' "$W/notoken.log" && bad "backend was started anyway" || ok "no model process started"

echo "--- C. missing model: actionable message"
run_case nomodel MODEL_DIR="$W/nope"
wait_exit 20
[[ $RC == 1 ]] && grep -q 'preflight failed (exit 3): model directory .* does not exist.*never downloads' "$W/nomodel.log" \
  && ok "exit 1, says to attach the volume / stage the model" || bad "missing-model case (exit $RC)" "$W/nomodel.log"

echo "--- D. backend never ready: bounded wait"
run_case notready STUB_BACKEND_NEVER_READY=1 BACKEND_READY_TIMEOUT_S=4
wait_exit 40
[[ $RC == 1 ]] && grep -q 'backend was not ready after 4s' "$W/notready.log" && ok "exit 1 after BACKEND_READY_TIMEOUT_S" \
  || bad "never-ready case (exit $RC)" "$W/notready.log"
sleep 1; leftovers && bad "processes left after the failure" || ok "everything stopped"

echo "--- E. backend crashes after ready: supervisor exits non-zero"
run_case crash STUB_BACKEND_EXIT_AFTER_S=20
wait_ready 60 && ok "ready before the crash" || bad "not ready" "$W/crash.log"
wait_exit 40
[[ $RC == 1 ]] && grep -q 'FATAL: backend exited (status 3) after startup' "$W/crash.log" \
  && ok "exit 1: 'backend exited (status 3) after startup'" || bad "crash case (exit $RC)" "$W/crash.log"
sleep 1; leftovers && bad "processes left after the crash" || ok "everything stopped"

echo "--- F. RHYTHM_ON_FAILURE=hold: keeps Caddy (and sshd) up for debugging, then stops on SIGTERM"
run_case hold RHYTHM_ON_FAILURE=hold STUB_BACKEND_NEVER_READY=1 BACKEND_READY_TIMEOUT_S=3
for _ in $(seq 1 100); do grep -q 'RHYTHM_ON_FAILURE=hold' "$W/hold.log" && break; sleep 0.2; done
sleep 2
kill -0 "$EP" 2>/dev/null && curl -fsS "$U/healthz" >/dev/null && [[ $(curl -s -o /dev/null -w '%{http_code}' "$U/readyz") == 503 ]] \
  && ok "held: container alive, /healthz 200, /readyz 503" || bad "hold mode" "$W/hold.log"
pgrep -f "py_backend.server --host 127.0.0.1 --port 18500" >/dev/null && bad "backend still running in hold" \
  || ok "model processes stopped while holding"
kill -TERM "$EP"; wait_exit 20
[[ $RC == 0 ]] && ok "SIGTERM while holding -> exit 0 promptly" || bad "hold SIGTERM exit $RC" "$W/hold.log"
sleep 1; leftovers && bad "processes left after hold" || ok "nothing left behind"

echo "--- G. hold after a crash AFTER ready: /readyz must drop to 503 (no 502s behind a 200)"
run_case holdcrash RHYTHM_ON_FAILURE=hold STUB_BACKEND_EXIT_AFTER_S=20
wait_ready 60 && ok "ready before the crash" || bad "not ready" "$W/holdcrash.log"
for _ in $(seq 1 150); do grep -q 'RHYTHM_ON_FAILURE=hold' "$W/holdcrash.log" && break; sleep 0.2; done
code=$(curl -s -o /dev/null -w '%{http_code}' "$U/readyz")
[[ $code == 503 ]] && ok "held after crash: /readyz 503" || bad "held after crash: /readyz $code" "$W/holdcrash.log"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RHYTHM_API_TOKEN" "$U/echo")
[[ $code == 503 ]] && ok "held after crash: authorized request 503 'starting', not 502" || bad "authorized request got $code"
kill -TERM "$EP"; wait_exit 20
[[ $RC == 0 ]] && ok "SIGTERM while holding -> exit 0" || bad "exit $RC" "$W/holdcrash.log"

echo "--- H. hold after a PREFLIGHT failure: sshd is attempted before config/preflight"
run_case holdpre RHYTHM_ON_FAILURE=hold RHYTHM_API_TOKEN= PUBLIC_KEY="ssh-ed25519 AAAATEST test"
for _ in $(seq 1 100); do grep -q 'RHYTHM_ON_FAILURE=hold' "$W/holdpre.log" && break; sleep 0.2; done
ssh_line=$(grep -nE 'sshd started|WARNING: (cannot create SSH dirs|ssh-keygen failed|cannot write authorized_keys|sshd did not start)' "$W/holdpre.log" | head -1 | cut -d: -f1)
fatal_line=$(grep -n 'FATAL: preflight failed' "$W/holdpre.log" | head -1 | cut -d: -f1)
[[ -n $ssh_line && -n $fatal_line && $ssh_line -lt $fatal_line ]] && ok "sshd started/attempted (line $ssh_line) before the preflight failure (line $fatal_line)" \
  || bad "sshd not attempted before preflight" "$W/holdpre.log"
kill -0 "$EP" 2>/dev/null && ok "holding (container alive) after the preflight failure" || bad "not holding" "$W/holdpre.log"
kill -TERM "$EP"; wait_exit 20
[[ $RC == 0 ]] && ok "SIGTERM -> exit 0" || bad "exit $RC" "$W/holdpre.log"

echo "--- I. the gateway registers the worker as offline: fail instead of waiting in its queue"
run_case offline STUB_REGISTER_STATUS=offline
wait_exit 60
[[ $RC == 1 ]] && grep -q "registered the worker as 'offline'" "$W/offline.log" && ok "exit 1: registered as offline" \
  || bad "offline registration case (exit $RC)" "$W/offline.log"

echo "--- J. the backend closes the video session with backend_error: not ready"
run_case backenderr STUB_FAIL_AFTER_CHUNKS=1
wait_exit 60
[[ $RC == 1 ]] && grep -q "closed by the server: reason=backend_error" "$W/backenderr.log" \
  && grep -q 'FATAL: the warm-up request failed' "$W/backenderr.log" && ok "exit 1: warm-up saw backend_error" \
  || bad "backend_error case (exit $RC)" "$W/backenderr.log"
grep -q 'READY:' "$W/backenderr.log" && bad "READY was logged anyway" || ok "never reported READY"

echo "--- K. the backend keeps the warm-up session after its cleanup failed: not ready"
run_case stuck STUB_BACKEND_STUCK_SESSION=1
wait_exit 120
[[ $RC == 1 ]] && grep -q 'FATAL: the backend still holds the warm-up session' "$W/stuck.log" && ok "exit 1: backend still bound to a session" \
  || bad "stuck-session case (exit $RC)" "$W/stuck.log"
grep -q 'READY:' "$W/stuck.log" && bad "READY was logged anyway" || ok "never reported READY"

echo "--- L. state dir on the volume cannot be created: sshd first, logs fall back to /run, preflight says why"
run_case nostate RHYTHM_STATE_DIR=/proc/nope RHYTHM_ON_FAILURE=exit
wait_exit 30
[[ $RC == 1 ]] && grep -q 'WARNING: cannot create the state dirs under /proc/nope' "$W/nostate.log" \
  && grep -q 'preflight failed (exit 5)' "$W/nostate.log" && ok "exit 1 with the preflight disk message (exit 5), not a bare line-number error" \
  || bad "no-state case (exit $RC)" "$W/nostate.log"

echo "entrypoint cases: $pass passed, $failn failed"
rm -rf "$W"
[[ $failn == 0 ]]
