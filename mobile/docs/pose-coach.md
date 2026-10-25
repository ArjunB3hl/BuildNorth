# Camera workouts on the website

## 2026-10-25 — local browser integration

Open **Camera workout** in the website navigation. Start inside the camera view. **Finish and save** stops the
workout, saves its counted sets to Activity, refreshes sessions/progress/today, and opens the saved session.
Stopping and restarting in the frame adds runs to the same workout. Unsaved counts survive a reload per account;
only one browser tab holds a camera workout at a time. Ambiguous saves are checked against recent sessions before
retrying. No camera coaching is added to the iPhone, Android, Watch or macOS applications.

The user selected counted sets only for this phase. Named movements, holds, approximate rhythm counts, technique
checks and Mistakes remain in the pose page. Approximate counts are never saved as measured repetitions. Faults
and per-side values can travel with counted-set messages but are not stored in the Activity schema. The host's
Finish and save button is the only writer; there is no new AI context or assistant write permission.

## Run locally

Use separate terminals from the repository root:

```sh
cd inference/pose-coach && bash tools/serve.sh
cd mobile/backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
cd mobile && npm run web -- --port 8081
```

Open the website at `http://localhost:8081`. `EXPO_PUBLIC_POSE_URL` defaults to
`http://127.0.0.1:8765/web/index.html?embed=1`. The host normalizes the coach hostname to 127.0.0.1, restricts it to
local HTTP, and rejects URL credentials. Keep the website on localhost: cookies ignore ports, so a website on
127.0.0.1 would share its cookie hostname with the coach. Hosted HTTPS deployment is outside this local phase.
Only `source` and `replay_speed` settings are retained from a configured coach URL, alongside embed and the host
origin. Private recording IDs belong only in ignored local configuration.

Identity comes from the host's existing verified Clerk session. No user ID, Clerk token, routine ID or plan-item ID
is sent to the frame. Both sides check the other window and its exact origin. The frame never calls the backend.
Pose live queries are excluded from persisted query caches; the recovery record contains counted sets, not video
or landmark frames. Models, licensed clips, recordings, screenshots and connection credentials remain ignored.

## Source map

| File | Role |
| --- | --- |
| `src/app/(app)/(tabs)/_layout.web.tsx` | Website navigation entry |
| `src/app/(app)/(tabs)/activity/_layout.web.tsx` | Website camera route registration |
| `src/app/(app)/(tabs)/activity/camera.web.tsx` | Embed, stop/save/retry/recovery and session navigation |
| `src/app/(app)/(tabs)/activity/camera.tsx` | Required neutral route; redirects to Activity on other platforms |
| `src/lib/pose-coach.ts`, `pose-coach.test.mjs` | Protocol, URL isolation, count accumulation and API mapping |
| `src/hooks/use-camera-workout.ts` | Per-account recovery of unsaved counted sets |
| `src/lib/cache-policy.ts` | Excludes live pose queries from offline query persistence |
| `../inference/pose-coach/web/js/embed.js` | Frame-side exact-origin protocol |

## Verification performed

The integration is checked with the pose-coach suites, the host protocol tests, and the website's lint,
typecheck and library tests. Specific results and browser checks are recorded after verification below.

## Remaining checks

Camera and microphone permissions, actual live speech, and production HTTPS hosting require separate live checks.
The private development branch and its history must never be pushed. Ask the user before pushing or opening a PR;
leave the merge to them.
