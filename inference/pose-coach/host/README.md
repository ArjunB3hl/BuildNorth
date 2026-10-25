# Historical phase-1 host template

The website integration now lives in `mobile/`; see [the website guide](../../../mobile/docs/pose-coach.md).
Use that implementation for new work. It adds website navigation, a native redirect, stricter URL isolation,
server-rendering support and BuildNorth appearance. The files below are the original standalone template for
reference. `tools/try_in_app.sh` intentionally stops if its legacy patch is already applied; it is not needed to
run the integrated website.

| File | Goes to | What |
|---|---|---|
| `src/app/(app)/(tabs)/activity/camera.web.tsx` | the same path in `mobile/` | The screen: frames the pose page, lists the sets as they are counted, saves the workout with `api.sessions.create` |
| `src/app/(app)/(tabs)/activity/camera.tsx` | the same path | The phone fallback Expo Router needs next to a `.web.tsx` route. No phone screen links to it |
| `src/lib/pose-coach.ts` | the same path | The page's address (`EXPO_PUBLIC_POSE_URL`), the message filter, what the screen counts (`countMessage`), the kept workouts (`restoreWorkouts`), workout → `SessionInput` within the API's limits |
| `src/lib/pose-coach.test.mjs` | the same path | Its tests (`node --experimental-strip-types --test src/lib/*.test.mjs`) |
| `src/hooks/use-camera-workout.ts` | the same path | The workouts counted and not saved yet, kept on the device (like `use-active-session.ts`) |
| `app.patch` | `patch -p1` in `mobile/` | Registers the `camera` route in `activity/_layout.tsx` (a full-screen modal, like `run`) and adds a "Camera workout" button to Activity on the web |

## Try it

Run the pose commands from `inference/pose-coach`. Set `BUILDNORTH_MOBILE` to the website source folder
when trying uncommitted website work from a different checkout.

```bash
bash tools/serve.sh                                   # the pose coach, :8765
cd "${BUILDNORTH_MOBILE:?set the website source folder}/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
bash tools/try_in_app.sh                              # a copy of the app with the screen, :8082
```

Open http://localhost:8082/activity, sign in, and press **Camera workout**. Press **Start** in the camera view, then
**Finish and save** (or Stop in the camera view, then **Save workout**). The session opens as after any workout.
**Discard** (top left) throws the workout away.

- `bash tools/try_in_app.sh check` runs the app's typecheck (after a dev server generates the typed routes, about
  10 s), lint and these tests on the copy instead. If `app.patch` no longer applies (the app changed, or already has
  the screen), the script stops and says so.
- To replay a saved set instead of the camera, start the copy with
  `EXPO_PUBLIC_POSE_URL='http://127.0.0.1:8765/web/index.html?embed=1&source=rec:<id>&replay_speed=8'`.
- The copy is in `$HOME/Library/Caches/pose-coach-app` (not `$TMPDIR`, which macOS empties after 3 days; `POSE_APP_COPY=`
  to change: a new folder whose parent exists; the script
  refuses a folder it did not make, anything inside a git checkout, the app, this repo and your home folder, comparing
  real paths). Each run refreshes it from `mobile/`. Its `node_modules` is an APFS clone (no extra disk space), made
  again when the app's packages change (`package.json`, `package-lock.json`, or an `npm install`).

## How it works

- The page is framed from `http://127.0.0.1:8765` with `?embed=1&parent=<this app's origin>`. 127.0.0.1, not
  localhost: cookies ignore ports, so on localhost the page would get the app's Clerk cookies. It hides its title,
  input and model pickers, and talks only to that origin, which must be on this machine (`http://localhost:<port>` or
  `127.0.0.1`). Its server only lets pages on this machine frame it (`Content-Security-Policy: frame-ancestors`).
- The page sends `ready`, `state {running, startedAt}`, `progress` after each counted rep, `set` at each finished
  set, `summary` when the workout stops, and `error`. The screen sends `stop` for "Finish and save" (and could send
  `start {exercise}`). The protocol is in docs/INTEGRATION.md.
- What is counted is kept on the device as reps arrive, so leaving the screen (the browser's Back too), reloading or
  closing the tab loses nothing. Opening Camera workout again within 30 minutes, the same day, continues that
  workout; an older one is offered as a workout of its own ("Not saved yet: ...", saved as its own session).
- Leaving with the in-app navigation while the camera counts asks first, and so does reloading or closing the tab
  while counting or saving. The browser's Back button is not asked about (expo-router on the web does not report
  it), but nothing counted is lost then either.
- Saving hands the workout over: it never grows after that, and a later run is another workout. A save whose answer
  never came (an error, a timeout, the tab closed) stays marked on the device and is checked against the server
  before it is saved again, so it is never saved twice. If the server's list of recent sessions can't tell (more than
  50 sessions finished since), it is not saved again, and the screen says to check Activity. Stop, then Start again on
  the same screen adds to the same workout.
- What is kept is restored from the device at once (the server check runs in the background). Only one camera
  workout screen works at a time (a Web Lock): one opened in another tab says so, waits, and takes over by itself
  when the other one closes. A page back from the browser's back/forward cache reloads (Safari drops its lock).
- If the pose page doesn't answer (its server isn't running), **Try again** loads it again without reloading the
  screen (a reload would hand the screen to a camera workout waiting in another tab).
- Only this screen calls the API, with the Clerk token it already has. The page never sees the token, the user or
  the backend.
- A session gets one entry per exercise, in the order first done, with each set completed at its reps (more than 20
  sets of one exercise continue in another entry of the same name), and the notes "Counted by the camera coach."
  (plus the partial reps not counted). Faults and per-side counts are sent but not saved: phase 2.

## Checked on 2026-10-23

- The app's `tsc --noEmit` (with freshly generated route types), `expo lint` and the 20 tests here pass on a copy of `mobile/` as it was that day.
- A test page framing the pose page from another local origin delivered ready, state, progress, set and summary
  messages. The mapped session body was checked against the backend's `SessionIn`. Recording IDs and workout
  details remain private. Duplicate start, stop-during-start and repeated-summary cases were checked too.
- Six review rounds (independent reviewers, each finding checked by two others): every confirmed finding is fixed.

The integrated website was subsequently verified in a signed-in browser with a saved recording and Activity
session creation. Live camera and speech checks remain separate; see the website guide for current verification.
