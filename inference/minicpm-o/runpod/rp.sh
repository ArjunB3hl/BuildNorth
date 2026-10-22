#!/usr/bin/env bash
# Runpod control for the Rhythm MiniCPM-o deployment, via the REST API (https://rest.runpod.io/v1). Small API calls
# only: safe to run from a laptop. Needs RUNPOD_API_KEY in the environment (never printed, never on the command line).
#
#   rp.sh template                 create the Pod template from template.json (IMAGE_REF, RUNPOD_REGISTRY_AUTH_ID)
#   rp.sh create                   create the GPU Pod from pod.json (RUNPOD_TEMPLATE_ID, RUNPOD_VOLUME_ID,
#                                  RUNPOD_DATACENTER); asks for confirmation: this starts paid GPU time
#   rp.sh status   [POD_ID]        desiredStatus, GPU, cost per hour, public URL
#   rp.sh wait-ready [POD_ID]      poll https://POD_ID-8000.proxy.runpod.net/readyz; prints seconds to ready
#                                  (gives up after READY_TIMEOUT_S, default 2400; with TORCH_COMPILE=1 use >= 3600)
#   rp.sh stop     [POD_ID]        stop the Pod (GPU released; network volume kept), then verify-stopped
#   rp.sh start    [POD_ID]        resume a stopped Pod (restart test; Runpod may have no free GPU on that host)
#   rp.sh verify-stopped [POD_ID]  exit 0 only if the Pod is EXITED or gone
#   rp.sh terminate [POD_ID]       delete the Pod (asks first), then verify it is gone
#   rp.sh running                  list every Pod on the account that is not stopped (should be empty after a test)
#   rp.sh registry-auths           list the Container Registry Auth credentials (id + name) for RUNPOD_REGISTRY_AUTH_ID
#
# POD_ID defaults to the id saved in runpod/.pod-id by `create`.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
API=${RUNPOD_REST_API:-https://rest.runpod.io/v1}       # override only for tests
: "${RUNPOD_API_KEY:?set RUNPOD_API_KEY (Runpod Settings -> API Keys); it is read from the environment only}"

api() {   # api METHOD PATH [JSON_BODY]: prints the body; exits non-zero on HTTP >= 400 (body on stderr)
  local method=$1 path=$2 body=${3:-} out code
  out=$(mktemp)
  code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$API$path" \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$RUNPOD_API_KEY") \
    -H 'content-type: application/json' ${body:+--data "$body"}) || { rm -f "$out"; return 1; }
  if (( code >= 400 )); then
    echo "Runpod API $method $path -> HTTP $code: $(head -c 500 "$out")" >&2
    rm -f "$out"
    return "$(( code == 404 ? 4 : 1 ))"
  fi
  cat "$out"
  rm -f "$out"
}
pod_id() { echo "${1:-$(cat "$HERE/.pod-id" 2>/dev/null || true)}"; }
need() { [[ -n ${!1:-} ]] || { echo "set $1 (see .env.example)" >&2; exit 2; }; }
fill() {  # fill FILE: replace __VAR__ placeholders with environment values
  python3 - "$1" <<'EOF'
import os, re, sys
text = open(sys.argv[1]).read()
missing = sorted({m for m in re.findall(r"__([A-Z0-9_]+)__", text) if not os.environ.get(m)})
if missing:
    sys.exit("missing environment: " + ", ".join(missing))
out = re.sub(r"__([A-Z0-9_]+)__", lambda m: os.environ[m.group(1)], text)
if re.search(r"__[A-Za-z0-9_]+__", out):
    sys.exit("unfilled placeholder in " + sys.argv[1])
print(out)
EOF
}
PYSHOW=$(cat <<'EOF'
import json, sys
p = json.load(sys.stdin)
m = p.get("machine") or {}
gpu = m.get("gpuTypeId") or (p.get("gpu") or {}).get("id") or p.get("gpuTypeId") or "?"
print(f"pod {p.get('id')}  desiredStatus={p.get('desiredStatus')}  costPerHr=${p.get('costPerHr')}  gpu={gpu}")
print(f"  last: {p.get('lastStatusChange')}")
print(f"  url:  https://{p.get('id')}-8000.proxy.runpod.net   ssh: {p.get('publicIp')} {p.get('portMappings')}")
EOF
)
PYRUNNING=$(cat <<'EOF'
import json, sys
pods = [p for p in json.load(sys.stdin) if p.get("desiredStatus") not in ("EXITED", "TERMINATED")]
for p in pods:
    print(f"{p['id']}  {p.get('name')}  desiredStatus={p.get('desiredStatus')}  costPerHr=${p.get('costPerHr')}")
print(f"{len(pods)} pod(s) not stopped" + ("" if pods else ": nothing is accruing GPU charges"))
sys.exit(1 if pods else 0)
EOF
)
show() { python3 -c "$PYSHOW"; }

case ${1:-} in
  template)
    need IMAGE_REF; need RUNPOD_REGISTRY_AUTH_ID
    [[ $IMAGE_REF == *@sha256:* ]] || { echo "IMAGE_REF must be pinned by digest (ghcr.io/...@sha256:...)" >&2; exit 2; }
    IMAGE_VERSION=$(sed -n 's/^IMAGE_VERSION=//p' "$HERE/../versions.env") && export IMAGE_VERSION
    d=${IMAGE_REF##*sha256:} && export IMAGE_DIGEST12=${d:0:12}       # template names must be unique: one per digest
    id=$(api POST /templates "$(fill "$HERE/template.json")" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
    echo "$id" > "$HERE/.template-id"
    echo "template $id created (export RUNPOD_TEMPLATE_ID=$id)"
    ;;
  create)
    # the template made by `rp.sh template` wins over an older id from the environment
    if [[ -f $HERE/.template-id ]]; then RUNPOD_TEMPLATE_ID=$(cat "$HERE/.template-id"); export RUNPOD_TEMPLATE_ID; fi
    need RUNPOD_TEMPLATE_ID; need RUNPOD_VOLUME_ID; need RUNPOD_DATACENTER
    tpl_image=$(api GET "/templates/$RUNPOD_TEMPLATE_ID" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("imageName",""))')
    if [[ -n ${IMAGE_REF:-} && $tpl_image != "$IMAGE_REF" ]]; then
      echo "template $RUNPOD_TEMPLATE_ID runs $tpl_image, not IMAGE_REF=$IMAGE_REF: run '$0 template' first" >&2
      exit 2
    fi
    body=$(fill "$HERE/pod.json")
    if [[ -n ${RUNPOD_GPU_TYPES:-} ]]; then
      body=$(python3 -c 'import json,os,sys; b=json.loads(sys.argv[1]); b["gpuTypeIds"]=[g.strip() for g in os.environ["RUNPOD_GPU_TYPES"].split(",")]; print(json.dumps(b))' "$body")
    fi
    echo "About to create a PAID GPU Pod (Secure Cloud, 1 GPU, billed per second until stopped):"
    python3 -c 'import json,sys; b=json.loads(sys.argv[1]); print("  gpu types (in order):", ", ".join(b["gpuTypeIds"])); print("  datacenter:", b["dataCenterIds"], " network volume:", b["networkVolumeId"])' "$body"
    echo "  template: $RUNPOD_TEMPLATE_ID  image: $tpl_image"
    echo "  48 GB GPUs cost about \$0.59-1.09/h on Secure Cloud. Stop it with: $0 stop"
    read -r -p "Type 'start paid pod' to continue: " answer
    [[ $answer == "start paid pod" ]] || { echo "not created"; exit 1; }
    out=$(api POST /pods "$body")
    id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$out")
    echo "$id" > "$HERE/.pod-id"
    date -u +%FT%TZ > "$HERE/.pod-created"
    show <<<"$out"
    echo "created $id at $(cat "$HERE/.pod-created"); next: $0 wait-ready"
    ;;
  status)
    id=$(pod_id "${2:-}"); [[ -n $id ]] || { echo "no POD_ID" >&2; exit 2; }
    out=$(api GET "/pods/$id") && show <<<"$out"
    ;;
  wait-ready)
    id=$(pod_id "${2:-}"); [[ -n $id ]] || { echo "no POD_ID" >&2; exit 2; }
    t0=$(date +%s); url="https://$id-8000.proxy.runpod.net/readyz"; last=""
    while true; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)
      [[ $code != "$last" ]] && { echo "$(( $(date +%s) - t0 ))s  /readyz -> $code"; last=$code; }
      [[ $code == 200 ]] && break
      if (( $(date +%s) - t0 > ${READY_TIMEOUT_S:-2400} )); then
        echo "not ready after ${READY_TIMEOUT_S:-2400}s: check the Pod logs in the Runpod console, then '$0 stop'" >&2; exit 1
      fi
      sleep 10
    done
    echo "READY after $(( $(date +%s) - t0 ))s of polling (Pod created at $(cat "$HERE/.pod-created" 2>/dev/null || echo '?'))"
    ;;
  stop)
    id=$(pod_id "${2:-}"); [[ -n $id ]] || { echo "no POD_ID" >&2; exit 2; }
    api POST "/pods/$id/stop" >/dev/null
    echo "stop requested for $id"
    sleep 5
    exec "$0" verify-stopped "$id"
    ;;
  start)
    id=$(pod_id "${2:-}"); [[ -n $id ]] || { echo "no POD_ID" >&2; exit 2; }
    echo "Resuming $id starts paid GPU time again."
    read -r -p "Type 'start paid pod' to continue: " answer
    [[ $answer == "start paid pod" ]] || { echo "not started"; exit 1; }
    out=$(api POST "/pods/$id/start")
    date -u +%FT%TZ > "$HERE/.pod-created"
    echo "start requested at $(cat "$HERE/.pod-created"); next: $0 wait-ready"
    out=$(api GET "/pods/$id") && show <<<"$out"
    ;;
  verify-stopped)
    id=$(pod_id "${2:-}"); [[ -n $id ]] || { echo "no POD_ID" >&2; exit 2; }
    for _ in $(seq 1 24); do
      rc=0; out=$(api GET "/pods/$id" 2>/dev/null) || rc=$?
      if [[ $rc == 4 ]]; then
        # a 404 also comes from a wrong or stale id: only the account-wide check proves nothing is billing
        echo "pod $id not found (terminated, or a wrong/stale id); checking every Pod on the account:"
        out=$(api GET /pods) || exit 1
        if python3 -c "$PYRUNNING" <<<"$out"; then
          echo "VERIFIED: no Pod on the account is running: no GPU or Pod charges"; exit 0
        fi
        echo "NOT VERIFIED: the Pods above are still running and billed; stop them (rp.sh stop <id>)" >&2
        exit 1
      fi
      status=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("desiredStatus"))' <<<"$out" 2>/dev/null || echo "?")
      case $status in
        EXITED) echo "VERIFIED: pod $id is EXITED (stopped): GPU released, no GPU charge."
                echo "Still billed while stopped: the network volume (\$0.07/GB-month) and nothing else for this template (volumeInGb=0)."
                exit 0 ;;
        TERMINATED) echo "VERIFIED: pod $id is TERMINATED"; exit 0 ;;
      esac
      echo "pod $id desiredStatus=$status; waiting..."
      sleep 5
    done
    echo "NOT VERIFIED: pod $id is still $status after 2 minutes. Stop it in the console (Pods -> Stop) and re-check." >&2
    exit 1
    ;;
  terminate)
    id=$(pod_id "${2:-}"); [[ -n $id ]] || { echo "no POD_ID" >&2; exit 2; }
    read -r -p "Delete pod $id permanently (the network volume is kept)? Type 'terminate': " answer
    [[ $answer == terminate ]] || { echo "kept"; exit 1; }
    api DELETE "/pods/$id" >/dev/null
    exec "$0" verify-stopped "$id"
    ;;
  registry-auths)
    out=$(api GET /containerregistryauth) && python3 -c 'import json,sys
items = json.load(sys.stdin)
for a in items: print(a.get("id"), " ", a.get("name"))
print(f"{len(items)} credential(s); put the id of the ghcr.io one into .env as RUNPOD_REGISTRY_AUTH_ID")' <<<"$out"
    ;;
  running)
    out=$(api GET /pods) && python3 -c "$PYRUNNING" <<<"$out"
    ;;
  *)
    sed -n '2,15p' "$0"; exit 2 ;;
esac
