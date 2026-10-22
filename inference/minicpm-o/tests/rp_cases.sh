#!/usr/bin/env bash
# shellcheck disable=SC2015  # 'cond && ok || bad' is intended: ok/bad always return 0
# runpod/rp.sh against a stub of Runpod's REST API (tests/stub_runpod.py): set-image sends every Pod setting back with
# only the image changed (the stub applies the documented defaults to omitted fields, the worst case), prints no env
# value, and reports a setting the PATCH changed; template still sends its body (on stdin). No network, no Runpod.
# Usage: bash tests/rp_cases.sh   (from inference/minicpm-o)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
W=$(mktemp -d)
pass=0 failn=0
ok() { pass=$((pass + 1)); printf 'ok    %s\n' "$1"; }
bad() { failn=$((failn + 1)); printf 'FAIL  %s\n' "$1"; return 0; }
SP=""
trap '[[ -n $SP ]] && kill "$SP" 2>/dev/null; rm -rf "$W"' EXIT
mkdir -p "$W/runpod" && cp runpod/rp.sh runpod/template.json runpod/pod.json "$W/runpod/" && cp versions.env "$W/"
export RUNPOD_REST_API=http://127.0.0.1:18999 RUNPOD_API_KEY=testkey STUB_LOG=$W/stub.log
IMAGE_REF="ghcr.io/x/rhythm@sha256:$(printf 'a%.0s' {1..64})" && export IMAGE_REF RUNPOD_REGISTRY_AUTH_ID=auth1
start_stub() {
  [[ -n $SP ]] && { kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null; }
  rm -f "$STUB_LOG"; python3 tests/stub_runpod.py 18999 & SP=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1:18999/x && break; sleep 0.1; done
}
rp() { bash "$W/runpod/rp.sh" "$@"; }

start_stub
out=$(rp set-image pod1 <<<"no thanks" 2>&1); rc=$?
[[ $rc == 1 && $out == *"not changed"* && ! -s $STUB_LOG ]] && ok "set-image without the confirmation sends nothing" || bad "decline: $out"
out=$(rp set-image pod1 <<<"switch image" 2>&1); rc=$?
[[ $rc == 0 && $out == *"verified: only the image changed"* ]] && ok "set-image: switch verified" || bad "switch (exit $rc): $out"
[[ $out != *SECRETjupyter123* && $out != *"AAAA test"* ]] && ok "set-image prints no env value" || bad "an env value was printed"
python3 - "$STUB_LOG" <<'PY' && ok "PATCH body: the new image and every other setting as it was" || bad "PATCH body"
import json, sys
p = json.loads(open(sys.argv[1]).readline())["patch"]
assert p["imageName"].endswith("a" * 64) and p["ports"] == ["8000/http", "22/tcp"] and p["containerDiskInGb"] == 50
assert p["volumeInGb"] == 0 and p["volumeMountPath"] == "/workspace" and p["containerRegistryAuthId"] == "auth1"
assert p["env"]["JUPYTER_PASSWORD"] == "SECRETjupyter123" and p["env"]["RHYTHM_API_TOKEN"] == "{{ RUNPOD_SECRET_rhythm_api_token }}"
PY
STUB_BREAK=ports start_stub
out=$(STUB_BREAK=ports rp set-image pod1 <<<"switch image" 2>&1); rc=$?
[[ $rc != 0 && $out == *"CHECK: ports changed"* ]] && ok "a setting the PATCH changed is reported (exit $rc)" || bad "check (exit $rc): $out"
out=$(rp template 2>&1); rc=$?
[[ $rc == 0 ]] && python3 - "$STUB_LOG" <<'PY' && ok "template still sends its body (now on stdin)" || bad "template: $out"
import json, sys
b = [json.loads(line) for line in open(sys.argv[1]) if '"post"' in line][0]["body"]
assert b["imageName"].endswith("a" * 64) and b["env"]["RHYTHM_API_TOKEN"].startswith("{{"), b
PY
out=$(rp set-image 2>&1); rc=$?
[[ $rc == 2 && $out == *usage* ]] && ok "set-image without POD_ID -> usage" || bad "usage: $out"
out=$(IMAGE_REF=ghcr.io/x/rhythm:0.1.2 rp set-image pod1 2>&1); rc=$?
[[ $rc == 2 && $out == *digest* ]] \
  && ok "set-image refuses a tag (digest only)" || bad "tag: $out"

echo "rp cases: $pass passed, $failn failed"
[[ $failn == 0 ]]
