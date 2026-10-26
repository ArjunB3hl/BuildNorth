# Camera workouts on the website

## 2026-10-25 — local browser integration

Open **Camera workout** in the website navigation. Start inside the camera view. **Finish and save** stops the
workout, saves its counted sets to Activity, refreshes sessions/progress/today, and opens the saved session.
Stopping and restarting in the frame adds runs to the same workout. Unsaved counts survive a reload per account;
only one browser tab holds a camera workout at a time. Inactive stack screens release the frame and lock.
A stalled initial frame load is retried once before offering Try again; a frame that has started counting is never
automatically reloaded. Ambiguous saves are checked against recent sessions before
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
is sent to the frame. Both sides check the other window and its exact origin. The frame never calls the backend. The host can supply a short-lived ElevenLabs signed conversation URL over the exact-origin message channel after an authenticated server request; no API key or Clerk token is exposed.
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

- Signed-in replay through the isolated website: progress, summary, save, session page and Activity listing verified.
  One test session remains in the account. Activity saved only the counted sets reported by the coach.
- Coach and voice were Off during replay. Live camera, microphone and paid speech were not exercised.
- Saved Mistakes, You / Like this and See it in 3D opened in the embedded page.
- Website lint, typecheck and all 68 library tests passed. The historical host's 20 protocol tests passed.
- Full pose suites: 488 JavaScript tests passed, one optional test skipped; 125 Python tests passed.
- Static website export passed. Leaving and revisiting the camera route releases and reacquires its frame lock.

## Appearance

The host uses the website's `Screen`, `PageIntro`, `Card`, `Button`, `Notice` and theme hooks. The frame's
`web/embed.css` maps `WebColors`, the website font stack, 16 px card radii, 12 px controls and spacing. It is scoped
to `body.embed`; standalone mode retains its original presentation and all page element IDs remain intact.

The frame accepts an initial `theme=light|dark`, with the system preference as a fallback. The host sends
`pose-coach/theme {theme}` on readiness and whenever its scheme changes, through the exact-origin connection.
Changing theme does not reload the iframe or reset its workout. `pose-coach/resize {height}` lets the website
own page scrolling; the host bounds the height. The CSS is part of the server's stale-page version hash.

Private screenshot comparisons are kept under ignored `.data/screenshots/`, never in the public tree. They
cover Activity and Camera workout at 1440 px and 800 px, in light and dark. Light-mode visual QA uses a temporary
local theme-hook override, restored before commit; the actual theme-message behavior is covered by a protocol
test. No global system appearance setting is changed.

## Remaining checks

Camera and microphone permissions, actual live speech, and production HTTPS hosting require separate live checks.
The private development branch and its history must never be pushed. Ask the user before pushing or opening a PR;
leave the merge to them.


### Account connection gate

The embedded page now uses the signed-in Rhythm account's verified ElevenLabs connection. It never borrows this
computer's Claude/Codex CLI sign-in or standalone agent configuration. With a Claude key alone, the camera counts
and uses engine cues; ElevenLabs is required for the embedded agent voice. The host sends `ai-connection` capability
state. On Start, `elevenlabs-session-request {requestId}` requests a fresh authorization, and the matching
`elevenlabs-session {requestId, signedUrl}` response stays in memory. Requests are single-flight, time out, and accept
only ElevenLabs WSS URLs. Existing session/dialogue serialization remains in use. Standalone local mode is unchanged.
The website's account gate mounts no iframe until a verified connection is available; revocation or failed rechecks
unmount the frame. Camera and browser voice chat share the same Web Lock where supported.

## 2026-10-26 — public HTTPS browser deployment

The website can use `https://rhythm-buildnorth--camera.expo.app/web/index.html?embed=1`.
This is an independent EAS Hosting alias in the existing Expo project, with no Python dev server or local accounts
exposed. `poseFrameUrl` accepts only this camera origin and the exact production website origin. Local development
retains the localhost/127.0.0.1 cookie separation. Both message directions still validate origin and window source.
The camera host sends CSP `frame-ancestors https://rhythm-buildnorth.expo.app`; hosted Start waits for the validated
parent's AI-connection capability message. The existing signed-in AI gate remains on the website.

Build the public camera export from repository root:

```sh
python3 inference/pose-coach/tools/build_hosted.py artifacts/pose-coach-https-<new-build-name>
cd mobile
npx eas-cli@25.2.0 deploy --export-dir ../artifacts/pose-coach-https-<new-build-name> --alias camera --environment production --non-interactive
```

Build and deploy the website from `mobile/` with the production EAS environment and
`EXPO_PUBLIC_POSE_URL=https://rhythm-buildnorth--camera.expo.app/web/index.html?embed=1`.
Keep the camera deployment on its `camera` alias; never promote it to the main production alias.

The packager explicitly includes browser source, pinned MediaPipe models, and the MediaPipe/ElevenLabs/three.js
browser dependencies with notices. It never reads `.data`, clips, recordings, local API keys or CLI connections.
Hosted mode makes no requests to local formatter, recordings, STT or TTS APIs. Engine cues use browser speech;
ElevenLabs continues through the account-owned short-lived signed-URL handoff. No paid voice session is needed to
load the page. Camera video remains in the browser. The original 13 exercise engines and counted-set saving are
unchanged. Private motion-library assets and 3D character references are not in this public bundle, so their controls
are hidden; current-workout landmark replays and form cues remain available.

Future website releases must include this HTTPS configuration; rebuilding older code restores the local-only
camera configuration. Physical/live camera and paid ElevenLabs conversations require a separate user session check.
