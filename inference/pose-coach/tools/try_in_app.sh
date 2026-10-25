#!/usr/bin/env bash
# The pose coach inside the BuildNorth web app, without touching the main checkout (host/README.md).
#
#   bash tools/try_in_app.sh            # copy the app, add the camera screen, start the web app on :8082
#   bash tools/try_in_app.sh check      # the same copy, then the app's typecheck and lint instead of starting it
#
# Copies $BUILDNORTH_MOBILE (default: this checkout's mobile/) to $POSE_APP_COPY. node_modules
# is an APFS clone (no extra disk space), made again when the app's package files change. Then adds host/src (the
# camera screen) and host/app.patch (the route and the Activity button). Needs, as usual: the API on :8000 (the main
# checkout's mobile/backend) and the pose coach on :8765 (tools/serve.sh). Env: BUILDNORTH_MOBILE, POSE_APP_COPY,
# PORT, EXPO_PUBLIC_POSE_URL (e.g. with &source=rec:<id> to replay a saved set instead of the camera).
set -euo pipefail
# physical paths (pwd -P), so a symlink cannot hide that the copy would land inside the app or this repo
HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
APP="$(cd "${BUILDNORTH_MOBILE:-$HERE/../../mobile}" && pwd -P)" || { echo "no app folder (set BUILDNORTH_MOBILE)" >&2; exit 1; }
COPY="${POSE_APP_COPY:-$HOME/Library/Caches/pose-coach-app}"   # (not $TMPDIR: macOS deletes files there after 3 days)
PORT="${PORT:-8082}"
MARK=.pose-coach-app-copy      # written by this script: only such a folder is ever refreshed (rsync --delete)

[ -f "$APP/package.json" ] || { echo "no app at $APP (set BUILDNORTH_MOBILE)" >&2; exit 1; }
# checked before anything is created: the copy's real path, in a folder that exists
parent="$(cd "$(dirname "$COPY")" 2>/dev/null && pwd -P)" || { echo "the folder for $COPY does not exist" >&2; exit 1; }
COPY="${parent%/}/$(basename "$COPY")"
case "$COPY/" in
  "$APP"/*|"$HERE"/*|"$HOME/"|//*|/./) echo "refusing to use $COPY as the copy (set POSE_APP_COPY to a new folder)" >&2; exit 1 ;;
esac
case "$APP/" in "$COPY"/*) echo "refusing: $COPY contains the app" >&2; exit 1 ;; esac
# never inside a git checkout (the app's, BuildNorth's, or any other): a scratch copy there would show up as changes.
# By the .git entry of any folder above it, so it needs no git.
d="$parent"
while :; do
  [ -e "$d/.git" ] && { echo "refusing: $COPY is inside a git checkout ($d; set POSE_APP_COPY to a folder outside any repository)" >&2; exit 1; }
  [ "$d" = / ] && break
  d="$(dirname "$d")"
done
[ -L "$COPY" ] && { echo "refusing: $COPY is a symlink" >&2; exit 1; }
mkdir -p "$COPY"
if [ ! -f "$COPY/$MARK" ] && [ -n "$(ls -A "$COPY")" ]; then
  echo "refusing to overwrite $COPY: not empty and not made by this script (set POSE_APP_COPY to a new folder)" >&2; exit 1
fi
touch "$COPY/$MARK"

# the app's own files, fresh each time (so the patch applies to what is there now); nothing is written to $APP
rsync -a --delete --exclude "/$MARK" --exclude /node_modules --exclude /.node_modules.stamp --exclude /ios \
  --exclude /android --exclude /backend --exclude /dist --exclude /.expo "$APP/" "$COPY/"
# node_modules: cloned again when the app's packages change (package.json, its lock file, or what npm installed),
# into a new folder first (never half-copied)
stamp="$({ cat "$APP/package.json"; cat "$APP/package-lock.json" "$APP/node_modules/.package-lock.json" 2>/dev/null || true; } \
  | shasum | cut -d' ' -f1)"
if [ ! -d "$COPY/node_modules" ] || [ "$(cat "$COPY/.node_modules.stamp" 2>/dev/null)" != "$stamp" ]; then
  rm -rf "$COPY/node_modules.new" "$COPY/node_modules"
  cp -cR "$APP/node_modules" "$COPY/node_modules.new"
  mv "$COPY/node_modules.new" "$COPY/node_modules"
  echo "$stamp" > "$COPY/.node_modules.stamp"
fi
cp -R "$HERE/host/src/" "$COPY/src/"
# --forward: a patch the app already has fails here, instead of being silently reversed
if ! (cd "$COPY" && patch -p1 --forward --batch --quiet < "$HERE/host/app.patch"); then
  echo "host/app.patch does not apply to the app as it is now (already in it, or those files changed): update host/app.patch" >&2
  exit 1
fi
echo "app copy with the camera screen: $COPY"

cd "$COPY"
if [ "${1:-}" = check ]; then
  # the typed routes (.expo/types/router.d.ts) come from a running dev server: start one briefly, so the typecheck
  # knows the camera route and the app's current routes
  rm -f .expo/types/router.d.ts
  CI=1 npx expo start --web --port "$((PORT + 17))" >/dev/null 2>&1 &
  pid=$!
  for _ in $(seq 1 120); do [ -s .expo/types/router.d.ts ] && break; sleep 1; done
  pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
  [ -s .expo/types/router.d.ts ] || { echo "could not generate the route types (.expo/types/router.d.ts)" >&2; exit 1; }
  grep -q "/activity/camera" .expo/types/router.d.ts || { echo "the route types have no /activity/camera" >&2; exit 1; }
  npx tsc --noEmit
  npx expo lint
  node --experimental-strip-types --test src/lib/pose-coach.test.mjs
  exit
fi
curl -s -o /dev/null --max-time 2 http://127.0.0.1:8000/openapi.json || echo "note: the API is not running on :8000" >&2
curl -s -o /dev/null --max-time 2 http://127.0.0.1:8765/api/version || echo "note: the pose coach is not running on :8765" >&2
echo "open http://localhost:$PORT/activity/camera (or Activity -> Camera workout)"
EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://localhost:8000}" exec npx expo start --web --port "$PORT"
