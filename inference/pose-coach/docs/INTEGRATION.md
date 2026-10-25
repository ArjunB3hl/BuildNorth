# Connecting the pose coach to the BuildNorth app

**Status (2026-10-23): phase 1 is built, but not in the main checkout.** The pose page has its embed mode
(`web/js/embed.js`). The app's side (a camera workout screen) is in [`host/`](../host/README.md), ready to copy into
`mobile/` once the web app there is committed. `tools/try_in_app.sh` runs it in a copy of the app on :8082, so the
main checkout is never touched. The facts about the main app come from reading its code on 2026-10-23, on branch
`minicpm-o-s3-part-size` with its uncommitted changes. [Verified and not verified](#verified-and-not-verified) keeps
the two apart.

## The two sides

| | Pose coach (this folder) | BuildNorth app (`mobile/`) |
|---|---|---|
| What | A static page plus a small Python server: MediaPipe in the browser, auto-counted reps and sets, form checks, a voice coach | An Expo SDK 57 app for iPhone, Android and the web (react-native-web), with a FastAPI backend in `mobile/backend` |
| Runs at | http://localhost:8765 (`tools/serve.sh`, bound to 127.0.0.1) | Web app http://localhost:8081 (`npm run web`); API http://localhost:8000 (uvicorn) |
| Identity | None. Local, single user. | Clerk. The app sends `Authorization: Bearer <Clerk session token>`; the backend takes the user only from the verified token and never from a request field. |
| Workouts | `AutoTracker.summary()`: `{sets: [{exercise, label, set, reps, partials, startT, endT}], totals}`; and the movements of the library the user named (a hold's seconds, the time moving, an approximate rhythm count), which the page keeps for its coach, its Workout card and its saved sets, not in the messages to the app yet (a held pose's measured form faults, and a moving or rhythm movement's, go to the coach and the saved sets only) | `ActivitySession`, created with `POST /sessions` (`SessionIn`) and shown under Activity, progress and streaks |
| AI | Claude on the user's own account: through the Anthropic API on their key when one is saved on the Mac (`.data/connections/anthropic-key`, billed per token on their Console account), else the `claude -p` CLI on their Claude login with a local stdio MCP server (`wait_for_event`, `say`; live, voice, about 1.1 s per cue). The user talks to it: Parakeet on the Mac writes the words down (`POST /api/stt`), and Claude gets them as text. | In-app Coach: a text chat (`POST /coach/messages`) through `AI_PROVIDER`. The MCP servers `/mcp` and `/rhythm/mcp` are for outside assistants and run no model. |
| Camera | `getUserMedia`. Needs a secure context: localhost or HTTPS. | Not used anywhere yet: no expo-camera, no react-native-webview, no camera permissions |

"The main webpage" is the Expo web app. It is the only BuildNorth web page, and it already has the Activity section
that records workouts. `mobile/README.md` ("Later phases") already plans "Recorded exercise analysis" (a pose model,
with results saved alongside an activity session) and "Live coaching" as separate services that the core screens do
not depend on. The pose coach is that service.

**Coordinate first.** The web app (`(tabs)/_layout.web.tsx`, `index.web.tsx`, `mobile/docs/web-app.md`), the
extension, `backend/app/rhythm/` and migrations 0006-0008 exist only as uncommitted or untracked changes in the main
checkout, owned by other agents. `pose-coach` branches from `main` (3ee70e6) without them. Build the connection on
top of the web app once that work is committed, or together with its owner. Do not edit their uncommitted files on
your own.

## Recommended path

### Phase 1: web, local, no backend change

1. **A web-only Activity route that embeds the pose page.** Add `mobile/src/app/(app)/(tabs)/activity/camera.web.tsx`
   with `<iframe src={POSE_URL} allow="camera; microphone; autoplay">`. Expo Router needs a platform-neutral
   `camera.tsx` next to it. Register the route in `activity/_layout.tsx` with `presentation: 'fullScreenModal'`, like
   `run`.
   - `microphone` is for talking to the coach: the ElevenLabs agent's duplex mode (its own voice), and the page's own
     listening for Claude, ChatGPT and the engine, where Parakeet on the Mac writes the words down
     ([VOICE_COACH.md](VOICE_COACH.md#talking-to-the-coach-the-page-listens)). Without it the browser refuses the
     microphone inside the frame, and the page goes on without it: the user answers with the buttons in its side
     panel.
   - `POSE_URL` comes from an `EXPO_PUBLIC_POSE_URL` setting, defaulting to `http://127.0.0.1:8765/web/index.html?embed=1`.
     127.0.0.1, not localhost: cookies ignore ports, so a page on localhost would get the app's Clerk cookies.
   - The iframe is cross-origin (8765 vs 8081), which is fine: localhost is a secure context, so the camera works.
2. **Entry points, but only once the screen works.** The README rule is "no placeholder buttons in the app".
   Candidates: a "Camera coach" item in the web sidebar's `main` array (`(tabs)/_layout.web.tsx`), a button in
   Activity's `PageIntro` (`activity/index.tsx`), and "Start with camera" next to "Start session" on a routine
   (`activity/[id].tsx`). Pass the same params as `/activity/run`: `routineId` and `planItemId`.
3. **The pose page posts its results to the parent** (see the [protocol](#messages-between-the-page-and-the-app)).
   The host screen, which is the only place that holds the Clerk token, saves the workout with
   `api.sessions.create` and then does what `run.tsx` does:
   - invalidate `['sessions', 'progress', 'today']`;
   - `router.replace('/activity/session/[id]?justFinished=1')`.
4. **An embed mode on the pose page (this repo).**
   - `?embed=1` hides the title and the source and model pickers. Voice, AI coach, form check (and the Workout
     card's Mistakes list, with its saved-workout picker) and "save set for debugging" stay, as on the page.
   - It answers to the protocol, only to the origin in `?parent=` (default `http://localhost:8081`), which must be a
     page on this machine; the server lets only such pages frame it (`frame-ancestors`, on every response).
   - It sends wall-clock times (ISO), taken when the workout starts and stops.
   - Nothing else changes: the page keeps its server at 8765 for the models, demos and coach.

No Clerk token, user id or secret ever goes into the iframe URL or to the pose page. The pose page never calls the
backend in phase 1, so neither CORS nor `CLERK_AUTHORIZED_PARTIES` needs to change.

### Phase 2: keep the form data

`POST /sessions` takes only `{reps, weight, durationSeconds, completed}` per set (`extra='forbid'`). Partial reps,
faults and per-side counts are rejected (422), or have to be squeezed into `notes` (at most 2000 characters). Two
ways to keep them:
- **Option A:** add optional fields to `SetResult` and `SessionEntry` (`partials`, `faults: {code: count}`,
  `perSide`, `source: 'pose'`). The entries are a JSON column, so no SQL migration is needed. The Pydantic schema,
  the TS types (`mobile/src/lib/types.ts`) and the session UI must change together. Never write extra keys into the
  JSON directly: `GET /sessions` re-validates the entries and would fail.
- **Option B:** a new table (for example `PoseSetResult` → `activity_sessions.id`) in migration 0009, chained from
  0008. It must be added to `models.USER_TABLES` so that "delete all my data" covers it.

Keep the measured values (the engine's) apart from what the coach said, as the README plans.

### Phase 3: one Claude session for both

- **Don't merge the MCP servers.** The pose tools long-poll a local, per-workout queue with no user. `/mcp` is
  per-user and database-backed, with OAuth.
- **Add BuildNorth's `/mcp` to the pose coach's mcp-config** (`server/coach.py`) as a second, HTTP server:
  `http://127.0.0.1:8000/mcp` with `Authorization: Bearer bnc_…`. The token comes from Profile → Connect AI
  assistants, or `POST /connections/tokens`, and is kept in the agent's environment, never committed. That config is
  Claude Code's (and Codex's): Claude through the Anthropic API has no MCP config and no tools (each event is one
  message, the reply the cue), so with a key saved this needs a way of its own.
- **Read context once, at workout start.** The same headless Claude can then read `get_user_context` (profile,
  equipment, today's plan) at workout start and pass it to the coach's `start` event. Not per cue: recall can take
  up to 20 s, and cues aim for about 1.1 s.
- **Writes still go through the user.** Either REST from the app (phase 1), or a new `propose_activity_session` MCP
  tool with the existing approve-in-app flow. A model-supplied "confirmed" flag is never accepted.
- **Naming.** The pose coach's prompt calls the coach "Rhythm", but in the backend "Rhythm" is the YouTube video
  companion (`/rhythm/*`, `/rhythm/mcp`). Rename it, or decide that the two are one product surface.

### Phase 4: phones

Embed the page with `react-native-webview` or an Expo DOM component (`'use dom'`). This needs:
- an HTTPS address for the pose page: an ngrok tunnel like the backend's, or a deployment;
- `NSCameraUsageDescription` and the Android `CAMERA` permission in `app.json`, then a new
  `expo run:ios|android` development build (Expo Go cannot run this app);
- `postMessage` through `window.ReactNativeWebView`.

Not measured yet:
- **MediaPipe in WKWebView and Android WebView.** WKWebView needs iOS 14.3 or later. The models are 5.8, 9.4 and
  30.7 MB, so phones probably need the lite one, cached.
- **`speechSynthesis` in a WebView.**
- **The microphone in a WebView** (the agent's duplex mode, and the page's own listening):
  `NSMicrophoneUsageDescription` and the Android `RECORD_AUDIO` permission too, or the coach without it (the page's
  buttons answer its questions).
- **The voice coach on a phone.** Its server runs on the Mac (Claude through the API on the key saved there, or the
  Claude CLI), and Kokoro and Parakeet on the Mac's GPU (MLX, Apple Silicon), so it cannot run on a phone as it is.
  The key stays on the Mac: never in the app, the frame or a message.

An alternative for later is to port the modules into the app instead of embedding the page. `engine.js`, `auto.js`
and `formcheck.js`'s text are plain ES modules with no DOM. They cannot be imported as TypeScript the way the
extension shares `rhythm.ts`.

## Messages between the page and the app

Implemented by `web/js/embed.js` (the page) and `host/src/lib/pose-coach.ts` (the app). All messages are
`{type, ...}` with `type` prefixed `pose-coach/`, sent with `postMessage` to the exact origin of the other side. Each
side takes messages only from that origin and from that window: the page from its parent, the app from its frame.

| Direction | type | Fields |
|---|---|---|
| page → app | `pose-coach/ready` | `{version}` (`/api/version`) |
| page → app | `pose-coach/state` | `{running, startedAt}` when a workout starts or stops |
| app → page | `pose-coach/start` | `{exercise?: 'auto' \| key}` (none: what the page's Exercise picker says, Auto by default). Not used by the screen: Start is pressed in the frame, which also lets the page speak (browsers allow speech after a click in that frame). With `'auto'` the page then asks the user which exercise; with a key it counts only that exercise and does not ask which. Later: `routine`, `planItemId` (a routine's exercise would be that key) |
| page → app | `pose-coach/progress` | `{exercise, label, set, reps, partials, faults, perSide}` of the set in progress, after each counted rep (and at a set's start), so the app keeps reps a run cut short would lose |
| page → app | `pose-coach/set` | `{exercise, label, set, reps, partials, faults: {code: count}, perSide}` at each `set_end`, with the exercise named or detected (after a rest, the user's "Done", a switch or Stop) |
| app → page | `pose-coach/stop` | `{}`: stops a running workout; during start-up it cancels the start (an empty summary follows); when stopped, the page sends its last summary again |
| page → app | `pose-coach/summary` | `{startedAt, finishedAt (ISO), sets: [...], totals}` once the workout stops (Stop in the frame, the end of a replayed set, or `stop`) |
| page → app | `pose-coach/error` | `{message}` (no camera, model failed to load, ...) |

Other page parameters: `?source=rec:<id>` replays a saved set instead of the camera (inside the app too), and
`?replay_speed=N` speeds it up.

**Named movements are not in these messages yet.** The user can name a movement of the motion library (a stretch, a
dance, a gym move with no counter, ...: [README](../README.md#movements-from-the-library-named-not-recognised)). A gym
exercise of the library is counted as its exercise, so its sets reach the app as any set does. Any other one (a hold's
seconds, the time moving, an approximate rhythm count) stays on the page: `pose-coach/progress`, `set` and `summary`
carry exercise sets only, and `SessionIn` has reps per set. Neither does a held pose's form (the faults measured in a
hold, `hold_end`'s `form`), nor a moving or rhythm movement's (its guard rails' `form_fault` and `form_fix`, the
`form` on its progress), nor `form_unseen` (the form not checked at all: step back, or turn): they go to the coach and
into the page's saved recordings only, and the embed mode (`web/js/embed.js`) sends none of it. Saving them needs a
decision ([below](#open-decisions-for-the-user)): a hold or a time as a set's `durationSeconds`, an approximate count
kept apart from counted reps, the form faults kept apart from what the coach said, and the library's names (from a
private library) mapped to the app's exercise names.

Mapping a workout to `SessionIn` (camelCase, `extra='forbid'`): `sessionFromWorkout()` in
`host/src/lib/pose-coach.ts`, with its tests. One entry per exercise in the order first done, each set completed at
its reps; more than 20 sets of one exercise go on in another entry of the same name (at most 50 entries of 20 sets);
reps 0-500, names up to 120 characters; `finishedAt` never before `startedAt`; notes "Counted by the camera coach."
plus the partial reps not counted. Several runs on the same screen (Stop, then Start again) add up into one session.
What the screen counts, message by message, is `countMessage()`; the bodies were checked against the backend's own
`SessionIn` on 2026-10-23.

Exercise names: a routine's exercise names are free text, while the pose engine has 13 keys (`squat`, `lunge`,
`pushup`, `jumping_jack`, ... in `EXERCISES`, `web/js/engine.js`). Comparing against a routine's targets needs an
alias table. Auto mode can also run without a routine and save whatever it detected.

## Rules the connection must keep

- **Identity comes only from the verified Clerk token** in the host app. No user ids or tokens in URLs or messages.
- **Session limits.** At most 50 entries and 20 sets per entry, reps 0-500, names up to 120 characters, notes up to
  2000. `finishedAt` must not be before `startedAt`. A `routineId` must belong to the user and a `planItemId` must
  exist, or the request fails with 404.
- **Live pose data is not cached.** Add its query keys to `NOT_PERSISTED` (`mobile/src/lib/cache-policy.ts`).
- **Web conventions.** Web-only code goes in `.web.tsx` files or behind `Platform.OS === 'web'`. Use
  `confirmAction` (`lib/confirm.ts`) because `Alert.alert` does nothing on the web. Install with `npx expo install`,
  and run `npm run lint` and `npm run typecheck` before calling it done (`mobile/AGENTS.md`).
- **Hosting.** CORS allows only `http://localhost` and `http://127.0.0.1`. A hosted or HTTPS origin needs a CORS
  change plus `CLERK_AUTHORIZED_PARTIES`.
- **Paths.** The pose page uses root-absolute paths (`/web/...`, `/api/...`) and an import map, so it must be served
  at the root of its origin.
- **Wording.** Health and coaching text is not medical advice.
- **Public repo.** No secrets, footage, recordings or licensed assets in git. Ask the user before pushing.
- **Docs, once it is built.** Add `mobile/docs/pose-coach.md` in the house style: dated sections, a Source map,
  Verification performed, Remaining checks. Add an `inference/` row to the root `README.md`, a bullet to
  `CLAUDE.md`, and update `mobile/README.md` "Later phases". Coordinate those edits, because these files have
  uncommitted changes by other agents.

## Source map (main app)

| File | Role for the connection |
|---|---|
| `mobile/src/app/(app)/(tabs)/_layout.web.tsx` | Web sidebar: the `main` / `rhythm` / `profile` NavItem arrays |
| `mobile/src/app/(app)/(tabs)/activity/_layout.tsx` | The Activity stack: register the camera route here |
| `mobile/src/app/(app)/(tabs)/activity/run.tsx` | The live-session pattern to copy: save, invalidate, replace to the session |
| `mobile/src/app/(app)/(tabs)/activity/index.tsx`, `[id].tsx`, `session/[id].tsx` | Entry points, and the saved-session view (shows a pose workout without changes) |
| `mobile/src/lib/api.ts`, `src/hooks/use-api.ts` | The one API client (Bearer Clerk token, retries, timeouts): `sessions.create` |
| `mobile/src/lib/types.ts` | `Exercise`, `SetResult`, `SessionEntry`, `SessionInput` |
| `mobile/src/lib/cache-policy.ts` | `NOT_PERSISTED` query keys |
| `mobile/backend/app/routers/activity.py`, `app/schemas.py` | `POST /sessions`, `SessionIn` and its limits |
| `mobile/backend/app/main.py`, `app/auth.py`, `app/deps.py` | CORS, Clerk verification, `CurrentUser` |
| `mobile/backend/app/mcp_server.py`, `app/mcp_auth.py`, `routers/connections.py` | `/mcp` tools, `bnc_` tokens, proposals |
| `mobile/README.md` ("Later phases"), `mobile/docs/web-app.md`, `mobile/AGENTS.md` | Product plan, web-app record, Expo rules |

## Run both locally

Run each command in a separate terminal, starting at the repository root.

```bash
# pose coach
cd inference/pose-coach && bash tools/serve.sh            # :8765
# BuildNorth API and web app (from the main checkout)
cd mobile/backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
cd mobile && EXPO_PUBLIC_API_URL=http://localhost:8000 npm run web -- --port 8081
```

The ports do not clash: 8000 API, 8081 Expo web, 8090 Mac Metro, 8765 pose coach, 8766 the pose coach's 3D test set.

## Open decisions (for the user)

1. **Which surface first.** The web app (phase 1, the cheapest) or phones (phase 4: HTTPS, WebView, camera
   permissions)?
2. **Where to save.** As a plain Activity session (phase 1), or keep partials and faults too (phase 2: option A or B)?
3. **Who saves.** The page through the app's own Finish (no approval, like `run.tsx`), Claude through a
   `propose_activity_session` MCP tool (approved in the app), or both?
4. **The coach's context.** Should the live coach read the user's profile and plan through `/mcp` (phase 3)? Who
   mints and stores the `bnc_` token on the Mac?
5. **The coach's name.** Keep "Rhythm" or rename it, given the video companion of the same name?
6. **Named movements in the app.** Save the holds, times and approximate counts of the movements the user named, and
   their measured form faults (a hold's, a moving movement's guard rails) (phase 2), or keep them on the page? An
   approximate rhythm count must not be stored as counted reps.
7. **The merge.** Commit the other agents' web-app work first, then merge `pose-coach` into `main`, and build the
   connection on a branch from there?

## Verified and not verified

**Verified on 2026-10-23, by reading the code (nothing was run in the main app):**
- the routes, screens, API client, schemas and their limits;
- CORS, the Clerk verification and the MCP servers listed above;
- that the app uses no camera today.

**Verified in the pose coach:**
- the page, auto mode, the form check and the 3D view (tests, evaluations, browser replays of the user's recordings);
- the shape of `AutoTracker.summary()`.

**Verified on 2026-10-23, phase 1 ([`host/`](../host/README.md)):**
- the app's typecheck, lint and the host tests, on a copy of `mobile/`;
- the messages, with a test page framing the pose page and replaying a saved set.

**Not verified yet:**
- a pose workout saved through `POST /sessions` (needs a signed-in browser);
- MediaPipe, the camera and `speechSynthesis` inside a WebView;
- the pose page served over HTTPS;
- the microphone inside the frame (the coach's duplex mode with the ElevenLabs agent, and the page's own listening
  for Claude, ChatGPT and the engine);
- the coach with BuildNorth's `/mcp` added to its config.
