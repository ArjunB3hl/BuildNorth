#!/usr/bin/env bash
# shellcheck disable=SC2015  # 'cond && ok || bad' is intended: ok/bad always return 0
# The test-clip path on CPU, end to end: scripts/stage_clips.py build (policy, metadata stripping) -> upload to a local
# "volume" -> verify -> runtime/clip_eval.py against the stub gateway. Synthetic clips only (ffmpeg testsrc), no real
# footage. Needs ffmpeg/ffprobe and a python with tests/requirements-tests.txt on PATH.
# Usage: bash tests/clips_cases.sh   (from inference/minicpm-o)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
W=$(mktemp -d)
pass=0 failn=0
ok() { pass=$((pass + 1)); printf 'ok    %s\n' "$1"; }
bad() { failn=$((failn + 1)); printf 'FAIL  %s\n' "$1"; if [[ -n ${2:-} && -f $2 ]]; then tail -20 "$2"; fi; return 0; }
GWPID=""
trap '[[ -n $GWPID ]] && kill $GWPID 2>/dev/null; rm -rf "$W"' EXIT

# five silent synthetic clips with library-style metadata; one carries a GPS tag like a phone recording
mkdir -p "$W/src" "$W/emptylib"
mk() {  # mk DIR ID NAME SECONDS LICENCE ORIGIN [extra ffmpeg args]
  mkdir -p "$1"
  ffmpeg -v error -f lavfi -i "testsrc=duration=$4:size=320x240:rate=10" -c:v libx264 -pix_fmt yuv420p "${@:7}" "$1/$2.mp4"
  printf '{"id": "%s", "name": "%s", "category": "exercise", "tags": [], "license": "%s", "origin": "%s", "attribution": "synthetic"}\n' \
    "$2" "$3" "$5" "$6" > "$1/$2.json"
}
mk "$W/src" clip-squat "Bodyweight squat" 3 "Pexels License" "Pexels" -metadata location=+57.0499+009.8986/ -movflags +use_metadata_tags
mk "$W/src" clip-wave "Wave hello" 2.4 "CC BY 4.0" "Wikimedia"
mk "$W/src" clip-minor "Excluded by policy" 2 "Pexels License" "Pexels"
mk "$W/src" clip-mixkit "Mixkit clip not listed by id" 2 "Mixkit Stock Video Free License" "Mixkit"
mk "$W/src" clip-study "Study clip not listed by id" 2 "CC BY 4.0" "Zenodo record 123 (study)"
cat > "$W/policy.json" <<'JSON'
{"exclude": {"clip-minor": "test exclusion"}, "confirm": {"clip-wave": "needs confirmation"},
 "exclude_licenses": ["mixkit"], "confirm_origins": ["zenodo"],
 "reviewed": ["clip-squat", "clip-wave", "clip-minor", "clip-mixkit", "clip-study"]}
JSON
st() { python scripts/stage_clips.py "$@"; }

echo "--- build"
st build --out "$W/set" --extra-dir "$W/src" > "$W/b0.log" 2>&1 && bad "build ran without a policy" "$W/b0.log" \
  || { grep -q -- '--policy is required' "$W/b0.log" && ok "build refuses to run without --policy" || bad "no-policy message" "$W/b0.log"; }
st build --out "$W/set" --library "$W/emptylib" --extra-dir "$W/src" --policy "$W/policy.json" > "$W/b1.log" 2>&1 \
  && ok "build exit 0" || bad "build failed" "$W/b1.log"
n=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['count'])" "$W/set/clips.json")
[[ $n == 1 ]] && ok "policy: only 1 of 5 clips staged" || bad "count $n" "$W/b1.log"
grep -q 'clip-minor: policy exclude: test exclusion' "$W/b1.log" && grep -q 'clip-wave: policy confirm (not confirmed)' "$W/b1.log" \
  && ok "id rules: exclude + unconfirmed left out, reasons logged" || bad "id reasons" "$W/b1.log"
grep -q 'clip-mixkit: policy licence rule' "$W/b1.log" && ok "licence rule: a Mixkit clip not listed by id is left out" || bad "mixkit rule" "$W/b1.log"
grep -q 'clip-study: policy origin rule' "$W/b1.log" && ok "origin rule: unlisted study footage is left out" || bad "origin rule" "$W/b1.log"
python -c "import json,sys; m=json.load(open(sys.argv[1])); assert m['policy']['file']=='policy.json' and len(m['left_out'])==4" "$W/set/clips.json" \
  && ok "clips.json records the policy (file + sha256) and the 4 left-out clips" || bad "policy record"
tags() { ffprobe -v error -show_entries format_tags -of json "$1"; }      # captured first: grep -q + pipefail = SIGPIPE
[[ $(tags "$W/src/clip-squat.mp4") == *location* ]] && ok "source clip has a GPS tag" || bad "test clip lacks GPS tag"
[[ $(tags "$W/set/clips/clip-squat.mp4") == *location* ]] \
  && bad "GPS tag survived the build" || ok "GPS tag stripped from the staged clip"
st build --out "$W/set" --library "$W/emptylib" --extra-dir "$W/src" --policy "$W/policy.json" --include-confirm > "$W/b2.log" 2>&1
n=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['count'])" "$W/set/clips.json")
[[ $n == 2 ]] && ok "--include-confirm adds only the individually confirmed clip (study clip stays out)" || bad "count $n" "$W/b2.log"
mk "$W/src2" clip-new "Newly Ready, never reviewed" 2 "Pexels License" "Pexels"
st build --out "$W/set3" --extra-dir "$W/src2" --policy "$W/policy.json" > "$W/b3.log" 2>&1 && bad "unreviewed clip staged" "$W/b3.log" \
  || { grep -q "not in the policy's 'reviewed' list: \['clip-new'\]" "$W/b3.log" && ok "an unreviewed Ready clip stops the build" || bad "reviewed msg" "$W/b3.log"; }

echo "--- upload + verify"
mkdir -p "$W/vol"
st upload --src "$W/set" --target local --dest "$W/vol" --set s1 > "$W/u.log" 2>&1 && ok "upload exit 0 (2 clips)" || bad "upload" "$W/u.log"
st upload --src "$W/set" --target local --dest "$W/vol" --set s1 --verify-only > "$W/v.log" 2>&1 && ok "verify OK" || bad "verify" "$W/v.log"
st build --out "$W/set" --library "$W/emptylib" --extra-dir "$W/src" --policy "$W/policy.json" > "$W/b4.log" 2>&1   # confirmation withdrawn
st upload --src "$W/set" --target local --dest "$W/vol" --set s1 --verify-only > "$W/v2.log" 2>&1 && bad "verify OK after a rebuild" "$W/v2.log" \
  || { grep -q 'not in the set' "$W/v2.log" && grep -q 'differs from the local build' "$W/v2.log" && ok "verify flags the extra clip and the changed manifest" || bad "verify msg" "$W/v2.log"; }
st upload --src "$W/set" --target local --dest "$W/vol" --set s1 > "$W/u2.log" 2>&1
[[ ! -e $W/vol/s1/clips/clip-wave.mp4 ]] && grep -q 'deleted clips/clip-wave.mp4' "$W/u2.log" && ok "re-upload deletes the withdrawn clip from the volume" || bad "stale clip kept" "$W/u2.log"
st upload --src "$W/set" --target local --dest "$W/vol" --set s1 --verify-only > "$W/v3.log" 2>&1 && ok "verify OK after the re-upload" || bad "verify" "$W/v3.log"
st build --out "$W/np" --extra-dir "$W/src2" --no-policy > /dev/null 2>&1
st upload --src "$W/np" --target local --dest "$W/vol" --set np > "$W/u3.log" 2>&1 && bad "a no-policy set was uploaded" "$W/u3.log" \
  || { grep -q 'built without a policy' "$W/u3.log" && ok "upload refuses a set built without a policy" || bad "msg" "$W/u3.log"; }

echo "--- clip_eval against the stub gateway"
(cd tests/stub_demo && exec python gateway.py --host 127.0.0.1 --port 18306 --internal-port 18307 --http) > "$W/gw.log" 2>&1 &
GWPID=$!
for _ in $(seq 1 50); do curl -fsS http://127.0.0.1:18307/health >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS -X PUT http://127.0.0.1:18307/internal/workers/w0 -H 'content-type: application/json' --data '{"endpoint":"x"}' >/dev/null
(cd tests/stub_demo && exec env STUB_REQUIRE_CONFIG=1 python gateway.py --host 127.0.0.1 --port 18316 --internal-port 18317 --http) \
  > "$W/gw2.log" 2>&1 &
GW2=$!
for _ in $(seq 1 50); do curl -fsS http://127.0.0.1:18317/health >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS -X PUT http://127.0.0.1:18317/internal/workers/w0 -H 'content-type: application/json' --data '{"endpoint":"x"}' >/dev/null
python runtime/clip_eval.py --clips "$W/vol/s1" --out "$W/out" --url ws://127.0.0.1:18316/v1/realtime --tail-chunks 2 \
  > "$W/e.log" 2>&1 && ok "clip_eval exit 0 (gateway refuses sessions without a full config)" || bad "clip_eval failed" "$W/e.log"
kill $GW2 2>/dev/null
(cd tests/stub_demo && exec env STUB_REFUSE_FIRST=2 python gateway.py --host 127.0.0.1 --port 18326 --internal-port 18327 --http) \
  > "$W/gw3.log" 2>&1 &
GW3=$!
for _ in $(seq 1 50); do curl -fsS http://127.0.0.1:18327/health >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS -X PUT http://127.0.0.1:18327/internal/workers/w0 -H 'content-type: application/json' --data '{"endpoint":"x"}' >/dev/null
python runtime/clip_eval.py --clips "$W/vol/s1" --out "$W/out3" --url ws://127.0.0.1:18326/v1/realtime --tail-chunks 1 --modes chat \
  > "$W/e3.log" 2>&1 && python -c "import json,sys; r=json.loads(open(sys.argv[1]).readline()); assert r['ok'] and r['reconnects']==2, r" "$W/out3/results.jsonl" \
  && ok "session_failed at the handshake: reconnected with backoff (2 retries) and succeeded" || bad "reconnect" "$W/e3.log"
kill $GW3 2>/dev/null
s() { python -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {'d': d}))" "$W/out/summary.json" "$1"; }
[[ $(s "d['chat']['ok']") == 1 && $(s "d['duplex']['ok']") == 1 ]] && ok "chat 1/1 and duplex 1/1 completed" || bad "summary" "$W/out/summary.json"
[[ $(s "d['chat']['parsed_json']") == 1 ]] && ok "JSON answer parsed" || bad "parse"
[[ $(s "d['chat']['label_match']") == 1 ]] && ok "label check: 'bodyweight squat' answer matches 'Bodyweight squat'" || bad "label_match"
[[ $(s "d['duplex']['label_unknown']") == 1 ]] && ok "duplex: nothing said -> label_match unknown, not counted as a miss or match" || bad "label_unknown"
[[ $(s "d['duplex']['unanswered_chunks']") == 0 ]] && ok "duplex: every chunk (clip + 2 silent tail) answered" || bad "unanswered"
[[ $(s "d['set']['policy']['file']") == policy.json ]] && ok "summary records the clip set's policy" || bad "policy in summary"
python - "$W/out/results.jsonl" <<'PY' && ok "duplex sent clip seconds + tail chunks (3+2) with the full default config, 2 images per step (grid4)" || bad "chunk counts/config"
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if '"duplex"' in l]
sys.exit(0 if [r["chunks_sent"] for r in rows] == [5] and rows[0]["duplex_config"]["top_k"] == 20
         and rows[0]["frame_mode"] == "grid4" and rows[0]["images_per_step"] == 2 else 1)
PY
[[ $(grep -c 'stub gateway: chunk [0-9]* images=2$' "$W/gw2.log") == 5 && $(grep -c 'stub gateway: chunk' "$W/gw2.log") == 5 ]] \
  && ok "the stub gateway received 2 images in each of the 5 duplex chunks" || bad "images per chunk at the gateway" "$W/gw2.log"
grep -q 'session.init mode=video voice=assets/ref_audio/ref_en_dlc_1.wav' "$W/gw2.log" \
  && ok "duplex session.init carries the English reference voice" || bad "voice at the gateway" "$W/gw2.log"
# a clip that gets brighter over time: the grid's quadrants must be 4 increasing moments within each second
ffmpeg -v error -f lavfi -i "color=c=black:s=320x240:r=20:d=3,format=gray,geq=lum='16+T*70'" -pix_fmt yuv420p "$W/ramp.mp4"
ffmpeg -v error -f lavfi -i "testsrc=duration=0.8:size=320x240:rate=30" -pix_fmt yuv420p "$W/short.mp4"
python - "$W/ramp.mp4" "$W/short.mp4" <<'PY' && ok "frame modes: 1/3/grid4 give 1/3/2 images per second; grid quadrants are 4 moments in order, inside their own second; a 0.8 s clip still gives one step" || bad "frame modes"
import base64, io, sys
sys.path.insert(0, "runtime")
from PIL import Image, ImageStat
from warmup import file_chunks, synthetic_frames
img = lambda b: Image.open(io.BytesIO(base64.b64decode(b))).convert("L")
one, three, grid = (file_chunks(sys.argv[1], frame_mode=m) for m in ("1", "3", "grid4"))
assert len(one) == len(three) == len(grid) == 3, (len(one), len(three), len(grid))
assert all(len(c[1]) == 1 for c in one) and all(len(c[1]) == 3 for c in three) and all(len(c[1]) == 2 for c in grid)
prev_max = -1
for i, (_, (main, g)) in enumerate(grid):
    m, gi = img(main), img(g)
    assert gi.size == (2 * m.size[0], 2 * m.size[1]), (m.size, gi.size)
    w, h = m.size
    q = [ImageStat.Stat(gi.crop(((k % 2) * w, (k // 2) * h, (k % 2 + 1) * w, (k // 2 + 1) * h))).mean[0] for k in range(4)]
    assert q == sorted(q) and q[3] - q[0] > 20, (i, q)                # 4 distinct moments, oldest top-left
    assert q[0] > prev_max, (i, q, prev_max)                          # all inside second i, after second i-1
    assert q[0] <= ImageStat.Stat(m).mean[0] <= q[3], (i, q)          # the full frame is from the same second
    prev_max = q[3]
for mode, k in (("1", 1), ("2", 2), ("4", 4), ("grid4", 2)):
    c = file_chunks(sys.argv[2], frame_mode=mode)
    assert len(c) == 1 and len(c[0][1]) == k, (mode, len(c), [len(x[1]) for x in c])
assert [len(synthetic_frames(m)) for m in ("1", "3", "grid4")] == [1, 3, 2]
PY
[[ -s $W/out/summary.md ]] && grep -q 'clip-squat' "$W/out/summary.md" && ok "summary.md written" || bad "summary.md"
rm "$W/vol/s1/.rhythm/COMPLETE.json"
python runtime/clip_eval.py --clips "$W/vol/s1" --out "$W/out2" > "$W/e2.log" 2>&1 && bad "ran on an incomplete set" \
  || { grep -q 'not a complete clip set.*stage_clips.py upload' "$W/e2.log" && ok "incomplete set refused with an actionable message" || bad "message" "$W/e2.log"; }

echo "clip cases: $pass passed, $failn failed"
[[ $failn == 0 ]]
