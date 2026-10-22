#!/usr/bin/env bash
# Container entrypoint (PID 1 is tini -g, which forwards SIGTERM/SIGINT to this script's process group).
#
# Runs the upstream demo's three processes in ONE container (Runpod Pods have no Docker Compose), one GPU worker:
#   backend  python -m py_backend.server   127.0.0.1:22500  loads MiniCPM-o 4.5 on GPU 0 (one session at a time)
#   worker   python worker.py              127.0.0.1:22400  forwards to the backend
#   gateway  python gateway.py --http      127.0.0.1:8006 (public API) + 127.0.0.1:8007 (worker registry)
#   caddy                                  0.0.0.0:8000     token check, then the gateway (the only public port)
#   sshd (if Runpod injects PUBLIC_KEY)    0.0.0.0:22       administration and file transfer
#
# Order: sshd -> config + preflight -> caddy -> backend (model load) -> worker -> gateway -> register worker -> warm-up
# -> worker idle again -> ready. /readyz turns 200 only after the warm-up got answers from the model and the worker is
# free for the next session. Any process dying, or a failed step, stops the others and exits non-zero
# (RHYTHM_ON_FAILURE=hold instead keeps sshd up, and Caddy if it had started, for debugging over SSH).
# On SIGTERM tini -g signals every process in the group at once; the entrypoint then waits for caddy, gateway, worker
# and backend in turn (killing any that hang). The per-process log pipes ignore TERM so shutdown output is kept.
set -Eeuo pipefail

RT=${RHYTHM_RUNTIME_DIR:-/opt/rhythm/runtime}
APP_DIR=${RHYTHM_APP_DIR:-/app}
: "${MODEL_ID:=openbmb/MiniCPM-o-4_5}"
: "${MODEL_REVISION:?MODEL_REVISION must be set (the image sets it)}"
: "${MODEL_DIR:=/workspace/models/${MODEL_ID}/${MODEL_REVISION}}"
: "${RHYTHM_STATE_DIR:=/workspace/rhythm}"
: "${RHYTHM_LOG_DIR:=${RHYTHM_STATE_DIR}/logs}"
: "${TORCHINDUCTOR_CACHE_DIR:=${RHYTHM_STATE_DIR}/cache/torchinductor}"
: "${HF_HOME:=${RHYTHM_STATE_DIR}/cache/huggingface}"
: "${TORCH_COMPILE:=0}"
: "${RHYTHM_PUBLIC_PORT:=8000}"
: "${GATEWAY_PORT:=8006}"
: "${GATEWAY_INTERNAL_PORT:=8007}"
: "${WORKER_PORT:=22400}"
: "${BACKEND_PORT:=22500}"
# a cold torch.compile adds ~15 min to the model load (upstream), so the default load limit grows with it
case ${TORCH_COMPILE,,} in 1|true|yes|on) : "${BACKEND_READY_TIMEOUT_S:=2700}" ;; esac
: "${BACKEND_READY_TIMEOUT_S:=900}"
: "${WARMUP:=1}"
: "${WARMUP_TIMEOUT_S:=180}"
: "${RHYTHM_ON_FAILURE:=exit}"
: "${RHYTHM_RUN_DIR:=/run/rhythm}"
export MODEL_ID MODEL_REVISION MODEL_DIR RHYTHM_STATE_DIR RHYTHM_LOG_DIR TORCHINDUCTOR_CACHE_DIR HF_HOME \
       RHYTHM_PUBLIC_PORT GATEWAY_PORT GATEWAY_INTERNAL_PORT WORKER_PORT BACKEND_PORT RHYTHM_RUN_DIR
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=$APP_DIR

READY_DIR=$RHYTHM_RUN_DIR
READY_FLAG=$READY_DIR/ready
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${RUNPOD_POD_ID:-local}"
RUN_LOG_DIR="$RHYTHM_LOG_DIR/$RUN_ID"
T0=$(date +%s.%N)
declare -A PIDS=()
declare -A MARKS=()
MARK_ORDER=()
STOPPING=0

# health URL REGEX: the endpoint answers and its body matches (output captured first: grep -q in a pipeline under
# pipefail can fail the pipeline with SIGPIPE)
health() { local body; body=$(curl -fsS --max-time 5 "$1" 2>/dev/null) || return 1; grep -Eq "$2" <<<"$body"; }

log() { printf '%s [rhythm] %s\n' "$(date -u +%FT%T.%3NZ)" "$*"; }
elapsed() { awk -v a="$T0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.1f", b-a}'; }
mark() { MARKS[$1]=$(elapsed); MARK_ORDER+=("$1"); log "t+${MARKS[$1]}s $1"; }

write_timings() {
  local status=$1
  {
    printf '{"run_id":"%s","status":"%s","image_version":"%s","model_revision":"%s","pod_id":"%s"' \
      "$RUN_ID" "$status" "${RHYTHM_IMAGE_VERSION:-}" "$MODEL_REVISION" "${RUNPOD_POD_ID:-}"
    printf ',"container_start_utc":"%s","marks_s":{' "$(date -u -d "@${T0%.*}" +%FT%TZ 2>/dev/null || true)"
    local first=1 k
    for k in "${MARK_ORDER[@]}"; do
      [[ $first == 1 ]] || printf ','
      printf '"%s":%s' "$k" "${MARKS[$k]}"
      first=0
    done
    printf '}}\n'
  } > "$RUN_LOG_DIR/startup.json" 2>/dev/null || true
}

# start NAME CMD...: run in the background, stdout+stderr prefixed in the container log and copied to NAME.log
start() {
  local name=$1
  shift
  # the log pipe ignores TERM/INT (tini -g signals the whole group): it drains until the service itself exits
  "$@" > >(trap '' TERM INT; tee -a "$RUN_LOG_DIR/$name.log" | sed -u "s/^/[$name] /") 2>&1 &
  PIDS[$name]=$!
  log "started $name (pid ${PIDS[$name]}): $*"
}

stop_one() {
  local name=$1 pid=${PIDS[$1]:-}
  [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 "${2:-20}"); do
    kill -0 "$pid" 2>/dev/null || { log "stopped $name"; return 0; }
    sleep 1
  done
  log "$name did not stop in ${2:-20}s; killing it"
  kill -KILL "$pid" 2>/dev/null || true
}

shutdown_all() {
  rm -f "$READY_FLAG"
  # stop taking traffic first, then the gateway (closes sessions), the worker, and the backend (releases the GPU)
  stop_one caddy 10
  stop_one gateway 20
  stop_one worker 20
  stop_one backend 30
  if [[ -n ${GPU_SAMPLER:-} ]]; then kill "$GPU_SAMPLER" 2>/dev/null || true; fi
  if [[ -f /run/sshd.pid ]]; then kill -TERM "$(cat /run/sshd.pid)" 2>/dev/null || true; fi
}

on_signal() {
  [[ $STOPPING == 1 ]] && return
  STOPPING=1
  log "received a stop signal: shutting down (Runpod stop / terminate, or docker stop)"
  write_timings stopped
  shutdown_all
  exit 0
}

fail() {
  local msg=$1
  rm -f "$READY_FLAG"                                         # /readyz must not stay 200 while holding
  log "FATAL: $msg"
  mark failed
  write_timings failed
  printf '%s\n' "$msg" > "$RUN_LOG_DIR/FAILED" 2>/dev/null || true
  if [[ $RHYTHM_ON_FAILURE == hold ]]; then
    log "RHYTHM_ON_FAILURE=hold: model processes stopped; sshd$([[ -n ${PIDS[caddy]:-} ]] && echo ' and caddy') kept up for debugging."
    log "The GPU is still billed: stop the Pod in Runpod when done (runpod/rp.sh stop; README.md section 9)."
    stop_one gateway 20; stop_one worker 20; stop_one backend 30
    while true; do sleep 3600 & wait $! || true; done        # background sleep: the TERM trap runs at once
  fi
  shutdown_all
  exit 1
}

# sshd for administration (only if Runpod injects PUBLIC_KEY). Started first, so SSH works even when a later step fails
# (with RHYTHM_ON_FAILURE=hold). Never fatal: every step only warns.
start_sshd() {
  [[ -n ${PUBLIC_KEY:-} ]] || { log "no PUBLIC_KEY from Runpod: sshd not started (add an SSH key in Runpod settings)"; return 0; }
  # host key on the volume keeps the fingerprint across restarts; /run is the fallback when the volume is missing
  local keys="$RHYTHM_STATE_DIR/ssh_host_keys"
  mkdir -p "$keys" 2>/dev/null && [[ -w $keys ]] || keys="$READY_DIR/ssh_host_keys"
  mkdir -p "$keys" /root/.ssh /run/sshd || { log "WARNING: cannot create SSH dirs; sshd not started"; return 0; }
  if [[ ! -f $keys/ssh_host_ed25519_key ]]; then
    ssh-keygen -q -t ed25519 -N '' -f "$keys/ssh_host_ed25519_key" || { log "WARNING: ssh-keygen failed; sshd not started"; return 0; }
  fi
  chmod 600 "$keys/ssh_host_ed25519_key" || true
  if ! { printf '%s\n' "$PUBLIC_KEY" > /root/.ssh/authorized_keys && chmod 700 /root/.ssh \
         && chmod 600 /root/.ssh/authorized_keys; }; then
    log "WARNING: cannot write authorized_keys; sshd not started"
    return 0
  fi
  if /usr/sbin/sshd -o "HostKey=$keys/ssh_host_ed25519_key" -o PasswordAuthentication=no -o PidFile=/run/sshd.pid; then
    log "sshd started (key auth only, host key in $keys)"
  else
    log "WARNING: sshd did not start; SSH administration is unavailable (the service itself is unaffected)"
  fi
}

trap on_signal TERM INT
trap 'fail "unexpected error at line $LINENO (exit $?)"' ERR

mkdir -p "$READY_DIR"
rm -f "$READY_FLAG"

# ---- 1. administration: before anything touches the volume, so SSH works even when the volume is the problem -------
start_sshd

# state dirs on the volume; if that fails (full, read-only, not attached) log to /run and let preflight report it
if ! mkdir -p "$RUN_LOG_DIR" "$TORCHINDUCTOR_CACHE_DIR" "$HF_HOME" "$RHYTHM_STATE_DIR/data" 2>/dev/null; then
  RUN_LOG_DIR=$READY_DIR/logs/$RUN_ID
  mkdir -p "$RUN_LOG_DIR"
  log "WARNING: cannot create the state dirs under $RHYTHM_STATE_DIR (volume full, read-only or missing?); logs in $RUN_LOG_DIR"
fi
log "MiniCPM-o 4.5 for Rhythm, image ${RHYTHM_IMAGE_VERSION:-?}, model ${MODEL_ID}@${MODEL_REVISION}, pod ${RUNPOD_POD_ID:-n/a}"
log "logs: $RUN_LOG_DIR"

# ---- 2. configuration + preflight (no model load yet) -----------------------------------------------------------------
# The access token comes from a Runpod secret. Runpod's docs describe two conventions: the template maps
# {{ RUNPOD_SECRET_rhythm_api_token }} into RHYTHM_API_TOKEN, or a secret whose key starts with RUNPOD_SECRET_ is
# injected as an environment variable of that name. Accept either (never logging the value).
if [[ -z ${RHYTHM_API_TOKEN:-} || ${RHYTHM_API_TOKEN} == *'{{'* ]]; then
  for v in RUNPOD_SECRET_RHYTHM_API_TOKEN RUNPOD_SECRET_rhythm_api_token; do
    if [[ -n ${!v:-} ]]; then
      export RHYTHM_API_TOKEN=${!v}
      log "access token taken from the Runpod secret variable $v"
      break
    fi
  done
fi
python "$RT/write_config.py" --out "$APP_DIR/config.json" || fail "could not write $APP_DIR/config.json (see the message above)"
cp "$APP_DIR/config.json" "$RUN_LOG_DIR/config.json"
rc=0
python "$RT/preflight.py" --json "$RUN_LOG_DIR/preflight.json" || rc=$?
[[ $rc == 0 ]] || fail "preflight failed (exit $rc): $(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["message"])' "$RUN_LOG_DIR/preflight.json" 2>/dev/null || echo 'see above')"
mark preflight_done

# ---- 3. the public listener (after preflight: it needs a validated token) ----------------------------------------------
start caddy caddy run --config "$RT/Caddyfile" --adapter caddyfile
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$RHYTHM_PUBLIC_PORT/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$RHYTHM_PUBLIC_PORT/healthz" >/dev/null 2>&1 || fail "caddy did not come up on port $RHYTHM_PUBLIC_PORT"
mark caddy_up

# GPU memory/utilisation every second for the whole run (peak VRAM is read from this file); not supervised
if command -v nvidia-smi >/dev/null 2>&1 && [[ ${RHYTHM_GPU_SAMPLING:-1} == 1 ]]; then
  nvidia-smi --query-gpu=timestamp,memory.used,memory.total,utilization.gpu,power.draw --format=csv,noheader,nounits \
    -l 1 > "$RUN_LOG_DIR/gpu.csv" 2>/dev/null &
  GPU_SAMPLER=$!
fi

# ---- 4. backend: loads the model ----------------------------------------------------------------------------------------
cd "$APP_DIR"
start backend python -m py_backend.server --host 127.0.0.1 --port "$BACKEND_PORT" --gpu-id 0 --model-path "$MODEL_DIR"
deadline=$(( $(date +%s) + BACKEND_READY_TIMEOUT_S ))
until health "http://127.0.0.1:$BACKEND_PORT/health" '"status" *: *"ready"'; do
  kill -0 "${PIDS[backend]}" 2>/dev/null || fail "the backend exited while loading the model (see [backend] lines / $RUN_LOG_DIR/backend.log)"
  (( $(date +%s) < deadline )) || fail "the backend was not ready after ${BACKEND_READY_TIMEOUT_S}s (BACKEND_READY_TIMEOUT_S)"
  sleep 2
done
mark model_loaded

# ---- 5. worker + gateway, then register the one worker ----------------------------------------------------------------
start worker python worker.py --host 127.0.0.1 --port "$WORKER_PORT" --gpu-id 0 \
  --backend-server-url "http://127.0.0.1:$BACKEND_PORT"
start gateway python gateway.py --host 127.0.0.1 --port "$GATEWAY_PORT" --internal-port "$GATEWAY_INTERNAL_PORT" --http
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$WORKER_PORT/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null 2>&1 && break
  for p in worker gateway; do kill -0 "${PIDS[$p]}" 2>/dev/null || fail "the $p exited during startup ($RUN_LOG_DIR/$p.log)"; done
  sleep 1
done
curl -fsS "http://127.0.0.1:$WORKER_PORT/health" >/dev/null 2>&1 || fail "the worker did not answer /health within 120s"
curl -fsS "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null 2>&1 || fail "the gateway did not answer /health within 120s"
reg=$(curl -fsS -X PUT "http://127.0.0.1:$GATEWAY_INTERNAL_PORT/internal/workers/worker-0" -H 'content-type: application/json' \
  --data "{\"endpoint\":\"127.0.0.1:$WORKER_PORT\",\"gpu_group\":\"gpu-0\"}" 2>&1) \
  || fail "could not register the worker with the gateway registry on 127.0.0.1:$GATEWAY_INTERNAL_PORT: $reg"
# the registry answers 200 even when its own health probe marks the worker offline: require "idle"
wstatus=$(python -c 'import json,sys; print(json.loads(sys.argv[1])["worker"]["status"])' "$reg" 2>/dev/null || echo "?")
[[ $wstatus == idle ]] || fail "the gateway registered the worker as '$wstatus', not idle (registry answer: $reg)"
mark gateway_up

# ---- 6. warm-up through the full chain, then ready ---------------------------------------------------------------------
if [[ $WARMUP == 1 ]]; then
  # warmup.py bounds itself (per-session deadline; overall limit 3 x WARMUP_TIMEOUT_S + chunks + 60 s, ~10 min)
  python "$RT/warmup.py" --url "ws://127.0.0.1:$GATEWAY_PORT/v1/realtime" --timeout "$WARMUP_TIMEOUT_S" --no-queue \
    --json "$RUN_LOG_DIR/warmup.json" || fail "the warm-up request failed: the model is loaded but did not answer ($RUN_LOG_DIR/warmup.json)"
  mark warmup_done
  # the warm-up session's teardown (backend cleanup, CUDA cache release) must finish before the first real session
  for _ in $(seq 1 60); do
    health "http://127.0.0.1:$WORKER_PORT/health" '"worker_status" *: *"idle"' \
      && health "http://127.0.0.1:$BACKEND_PORT/health" '"active_session_id" *: *null' && break
    sleep 1
  done
  health "http://127.0.0.1:$WORKER_PORT/health" '"worker_status" *: *"idle"' \
    || fail "the worker did not return to idle within 60s after the warm-up"
  # the backend can stay bound to a session whose cleanup failed while the worker already reports idle
  health "http://127.0.0.1:$BACKEND_PORT/health" '"active_session_id" *: *null' \
    || fail "the backend still holds the warm-up session 60s after it was closed (cleanup failed; see backend.log)"
else
  log "WARMUP=0: skipping the warm-up; ready means 'model loaded', not 'answered a request'"
fi
touch "$READY_FLAG"
mark ready
write_timings ready
log "READY: https://${RUNPOD_POD_ID:-<pod-id>}-$RHYTHM_PUBLIC_PORT.proxy.runpod.net (bearer token required; /readyz is 200)"

# ---- 7. supervise -------------------------------------------------------------------------------------------------------
while true; do
  for p in backend worker gateway caddy; do
    if ! kill -0 "${PIDS[$p]}" 2>/dev/null; then
      wait "${PIDS[$p]}" 2>/dev/null && rc=0 || rc=$?
      fail "$p exited (status $rc) after startup ($RUN_LOG_DIR/$p.log)"
    fi
  done
  sleep 5 &
  wait $! || true
done
