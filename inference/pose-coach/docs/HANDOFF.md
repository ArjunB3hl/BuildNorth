# Pose coach: handoff

A workout coach that runs in the browser. MediaPipe tracks the person from the webcam. The page works out which
exercise they are doing (13 exercises), counts reps and sets per exercise, and checks form on every rep. It shows what
went wrong, as a replay and on request in 3D, next to a 3D demo of the right form, and keeps each mistake to see again
after the workout (a saved one's too). It coaches by voice: the first
connected of an ElevenLabs agent (its own LLM and voice), Claude and ChatGPT (Codex) writes the cues (Claude through the
Anthropic API on the user's own key when one is saved, billed per token on their Console account, else Claude Code on
their Claude login; ChatGPT on their ChatGPT login; the agent by its id), and Kokoro on this Mac (or the agent's
voice) speaks them. The coach asks which exercise the user is about to do, and before it ends a set, whether
they are done. The user answers, and talks to the coach, by voice: to the agent with its own voice (duplex), or to
Claude, ChatGPT or the engine through the page, which writes the words down on this Mac (Parakeet TDT 0.6B v3 on
MLX); or with buttons in the side panel. Talk to coach opens a conversation without a workout.

It does not have to be one of the 13 exercises: the user can name any of 29 movements of the motion library (a
stretch, a dance, a gym move with no counter, ...) with a tap in the Movements card or by voice, and the coach keeps
track of that one with what the camera measures reliably (a hold timer, the time moving, an approximate rhythm, or a one-two technique check without a count). For
its three held poses the page measures the hold's form too
([README](../README.md#a-held-poses-form-measured-never-assumed)), and for 10 of the 13 movements done in motion a few
guard rails, clear mistakes only ([README](../README.md#a-moving-movements-form-guard-rails-clear-mistakes-only)); the
coach never calls a movement's form good unless it was measured, and a moving one's never as a whole.
Nothing recognises a library movement by itself: measured, that was right 7% of the time on other people's footage.
Reps are counted only for the 13 exercises ([README](../README.md#movements-from-the-library-named-not-recognised)).

It is a working prototype, tested against synthetic cases and private evaluation inputs. The public import is a
cleaned snapshot; private development history remains local (see [Rules](#rules)). The design and measured results are in [../README.md](../README.md). The data is described in [DATA.md](DATA.md), how to connect
the pose coach to the main app in [INTEGRATION.md](INTEGRATION.md), and the voice coach, its connections and voices in
[VOICE_COACH.md](VOICE_COACH.md).

## Where everything is

| What | Where |
|---|---|
| Code (this folder) | `inference/pose-coach/` in the BuildNorth repository. |
| Data: recordings, test clips, labels, demos, 3D characters | `.data/` in this folder, git-ignored. See [DATA.md](DATA.md). |
| Third-party code (MediaPipe 1.1.0, three.js 0.170.0, pose models, kokoro-js 1.2.1 and Kokoro-82M for the browser, @elevenlabs/client 1.27.0) | `web/vendor/`, `web/models/`. Git-ignored and fetched by `tools/fetch_assets.sh`. |
| The local voice (Kokoro-82M on MLX) | `.venv-kokoro/`, git-ignored, built by `tools/setup_kokoro.sh`; the model in the Hugging Face cache. |
| The local speech to text (Parakeet TDT 0.6B v3 on MLX) | the same `.venv-kokoro/`; the model (2.5 GB, pinned) in the Hugging Face cache, fetched by `tools/setup_stt.sh`. |
| The coach's ElevenLabs agent id | `.data/connections/elevenlabs.json`, git-ignored, saved from the page's Connections panel. See [VOICE_COACH.md](VOICE_COACH.md). |
| The user's Anthropic API key (Claude through the API) | `.data/connections/anthropic-key`, git-ignored, mode 0600, written by the user from the command line. A secret: never read, print, copy or log it ([Rules](#rules)). See [VOICE_COACH.md](VOICE_COACH.md#claude-through-the-anthropic-api-your-own-key). |
| The voice-coach benchmark (pages, scripts, test sets, results) | `.data/dev/bench/`, git-ignored and private. |
| The movement library (named movements) | `.data/moves/`, git-ignored: `library.json` and `glb/<key>.glb` built by `tools/build_moves.mjs` (served at `/moves/`, `POSE_MOVES_DIR`), from `catalog.json` (the 61 Ready motions labelled for the coach), `cleared.json` (the 42 the clip policy clears; the build offers 29 of them, leaving out the kinds `sport`, `locomotion`, `gesture` and `idle`), `slugs.json` (stable keys of the 29 cleared ones the engine does not count) and the motion library (read-only). The recognition study's reports are there too (`eval_*.json`, `fulleval/`, `review/`), its code in `.data/dev/moves/`. |
| The 3D animation library the demos come from | `<motion-library>/<id>/` (Y Bot GLB, renders) and `<character-library>/`. Also the private motion-library dataset on Hugging Face (`motion-results/<id>/retarget/`; ask the owner for access). |
| Clip licence policy | `.data/moves/clip-policy.json (or POSE_CLIP_POLICY)`. Mixkit and Envato footage is never used. Research footage (figshare, MM-Fit, ...) needs the owner's confirmation. It holds 19 of the library's 60 Ready motions, which are never loaded ([README](../README.md#which-movements-the-clip-policy)). |

## Run it

```bash
cd inference/pose-coach
bash tools/fetch_assets.sh                        # once: MediaPipe, pose models, three.js, Kokoro, ElevenLabs client (pinned; models and ElevenLabs client checksummed, npm checks the rest)
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "mcp>=2.3" "anthropic>=2.1"   # once: the coach
mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key   # optional, by the user: their Anthropic API key
bash tools/setup_kokoro.sh                        # once: the local voice (Kokoro-82M on MLX, Apple Silicon)
bash tools/setup_stt.sh                           # once: speech to text (Parakeet on MLX), to talk to the coach
node tools/build_moves.mjs                        # once, and after the library or the policy changes: the Movements card
bash tools/serve.sh                               # http://localhost:8765/ with the data in .data/
```

- **The page.** Open http://localhost:8765/ and press Start. "Auto: detect exercises" is the default: counting starts
  at once, and the coach asks which exercise you are about to do (say it to the agent, tap it in the side panel, or
  just start: after 12 s it goes on detecting). The camera works because localhost counts as a secure context. The
  microphone is asked for when the ElevenLabs agent speaks with its own voice (duplex), or, with Claude, ChatGPT or
  the engine, when the page listens (Parakeet set up): during a workout and in Talk to coach.
- **Movements.** The Movements card in the side panel lists the library by group with what each keeps track of and
  Show in 3D. Tap one (before Start: picked for the workout), or say it; the start question's chips have "Other
  movement...". While a movement that is not a counted exercise is named, no reps are counted: name an exercise or
  "detect it" to count again. Without `.data/moves/library.json` the card says so and the rest works as before. A
  movement with a form check (the three holds, and the ten moving and rhythm movements with guard rails) shows its form
  under the Now card's count, and each fault told in the form-check panel; a moving one's checks wait out the first 3 s
  of each run of movement (and start again after a pause: 5 s still, or for a rhythm up to 12 s by the pace of its
  reps), so do the movement for a few seconds before expecting one. Standing with a check's parts out of the picture
  for 5 s (or side-on a while), the coach and the Now card say to step back or turn (`form_unseen`): frame the whole
  body, feet included, for the leg movements. Sitting at the laptop, or too close for the hips and knees to show, it
  says nothing without recent visible standing evidence (at most 10 s; a framing request only).
- **Second server for the 3D test set.** `bash tools/serve.sh m3d` serves the 3D-vs-footage clips on port 8766.
- **AI coach.** Auto uses the first connected of the ElevenLabs agent, Claude and ChatGPT. For Claude, the user
  copies their Anthropic API key from the Console and saves it with the `anthropic-key` line above (the API, billed
  per token on their Console account; `.data/connections/` exists only once an agent was saved, hence `mkdir -p`, and
  `umask 077` sets no mode on a file that was already there, hence `chmod 600`), or signs in with `claude auth login`
  (Claude Code, their subscription; also the fallback when the key is missing or refused). `codex login` with
  ChatGPT, not an API key. The agent's id goes in the Connections panel of the standalone page (inside the app the
  form is hidden). With none, or with "AI coach" Off, the engine's own sentences are spoken. Setup, the fallbacks and
  the voices: [VOICE_COACH.md](VOICE_COACH.md).
- **Replay a saved set.** "Save set for debugging" stores the landmarks only, never video, in
  `.data/posedata/results/live/`. Each saved set appears as a "Recording: ..." source. Add `?replay_speed=3` to
  `/web/index.html` to play it faster. A set saved after movements of the library were named also keeps them, as the
  workout summary has them: `movements: [{movement, display, movementKind, track, seconds | count}]` (seconds held or
  moving, or an approximate count; neither when it was zero), and the movement tracker's events with the engine's (a
  hold's form included, and a moving movement's `form_fault` and `form_fix`). `node tools/hold_eval.mjs
  <recording.json> <movement key>` replays a held pose's form from one ([DATA.md](DATA.md)); private page replay tools
  in `.data/dev/analysis/` exercise moving movements through the real page. Run
  `node .data/dev/analysis/replay_page.mjs <recording-id> standing_side_crunch 4`; `sweeps.mjs` prints measurements,
  but its simple one-side grouping splits tracking swaps and omits very short / low lifts. Check both sides and
  annotated intervals when comparing counts. For accelerated browser replay, open
  `http://127.0.0.1:8765/web/index.html?replay_speed=4` directly: the root redirect drops the query string.
- **See a workout's mistakes again.** Every mistake the form check showed stays in the Workout card's Mistakes list
  after Stop, until the next Start: Show pins it in the side panel until Close, 3D opens it in the 3D view. The picker
  by "Mistakes" loads a saved set's mistakes without replaying it (one saved before the list has them derived from its
  events).
- **After any change to `web/`, reload the page.** A page left open over a change says "This page is out of date"
  when you press Start.

## How it fits together

```
camera ──► web/js/pose.js (MediaPipe, VIDEO mode, GPU → CPU fallback)
             │ 33 landmarks: image (normalised) + world (metres)
             ▼
         web/js/engine.js   features → per-exercise rep detector → rules: valid / full / distinct → faults → cues
             │ events per exercise
             ▼
         web/js/auto.js     which exercise (detected, or named by the user), when a set starts / ends / switches;
             │              tentative first reps
             │ set_start, rep, set_end, set_end_pending, set_end_cancelled, tentative, cue, fixed, praise, partial,
             │ visibility, workout_summary
             ▼
         web/js/app.js      UI: the side panel (counter, set, warnings, the coach's line, its questions' chips and
             │              buttons), log, form-check panel (formcheck.js), 3D view (view3d.js + retarget.js, loaded
             │              only when asked), the Workout card's Mistakes list (mistakes.js), saving and replaying
             │              sets, coach events
             │              the coach: web/js/connections.js plans from GET /api/connections (server/connections.py)
             ├──► web/js/eleven-coach.js ──WebSocket──► the ElevenLabs agent (its LLM and voice; a session per
             │                                          workout; duplex: the microphone and two client tools)
             ▼  POST /api/coach/event
         server/dev_server.py ──► server/coach.py (claude -p or codex exec, one session per page) ◄──MCP──► server/pose_mcp.py
                                  tools: wait_for_event, say  →  the page polls /api/coach/said and speaks it
                                  or, with the user's key saved: a worker thread ──► the Anthropic API (each reply said)
         web/js/voice.js    Kokoro: GET /api/tts (server/tts.py → kokoro_worker.py, MLX) → the browser (WebGPU) → the Mac's
         web/js/listen.js   the page listening (not with the agent): microphone → detector → POST /api/stt
                            (server/stt.py → stt_worker.py, Parakeet on MLX) → web/js/intents.js → applied, and
                            user_said to the coach
         web/js/moves.js    a movement of the library the user named (GET /moves/library.json): hold timer, time
                            moving, approximate rhythm; the AutoTracker gets no frames meanwhile → movement_set,
                            hold_*, moving_progress, rhythm_progress to the coach
         web/js/holdform.js a held pose's form, from the same landmarks → hold_fault, hold_fix, `form` on hold_*
                            (each fault with its `part` and `side`) → app.js: a fault told, in the form-check panel
                            next to the movement's reference pose (library.json `pose`; 3D: its GLB's `held` part)
         web/js/moveform.js a moving or rhythm movement's form (its guard rails: web/js/moveforms/*.js), from the same
                            landmarks and the rhythm's turns → form_fault, form_fix, `form` on moving_progress and
                            rhythm_progress → app.js: a fault told, in the same panel next to the reference pose of
                            its check (library.json `refPoses`; 3D: its GLB around that pose's moment)
                            either form, standing with a check's parts out of the picture, or every check side-on,
                            a while → form_unseen (moveform.js UnseenWatch; a hold's in moves.js) → the coach and
                            the Now card: step back, or turn
```

- **`web/js/engine.js`.** `features()` turns landmarks into angles and positions. `EXERCISES` defines the 13
  exercises: each has a signal, a prominence, and the rules `valid`, `full` and `distinct`, plus `checks` (the faults
  with their thresholds) and `lying`. `ExerciseEngine` counts one exercise; `RepDetector` is the zigzag rep detector.
- **`web/js/auto.js`.** `AutoTracker` runs every engine on the same frames. A rep that might start a set is decided
  as soon as no rival can still claim it (`settled`), and 3 s is the most it waits. Reps are decided in the order
  they happened. A set starts after 2 reps in a row (3 for arm exercises, 4 for knee raises and squat pulses). After
  8 s without a rep it asks whether the set is done (`set_end_pending`, `answerSetEnd`), and with no answer ends it
  after 20 s. An exercise the user names (`{ only }`, `setExercise`) is counted alone, a set from its first rep. The
  flow: [VOICE_COACH.md](VOICE_COACH.md#the-coach-asks-which-exercise-and-is-the-set-done).
- **`web/js/formcheck.js`.** Describes a fault in plain words with the engine's threshold, and replays the faulty
  rep as a stick figure; for a library movement's fault (a hold's, a moving one's), `RepReplay.show()` draws the
  movement's reference pose still next to the user's last 2 s, `mirrorImage()` turns it to the other side, and
  `bonesFor()` knows the parts (one limb when a side is named; the stance's feet with the gap between the ankles
  dashed).
- **`web/js/retarget.js` and `web/js/view3d.js`.** Pose the demos' Mixamo Y Bot from the world landmarks, tint the
  faulty part red, and play the demo's clip next to it; for a library movement, its GLB over a hold's held part or 1.5 s
  either side of a moving check's reference moment (no turning point: at its own pace), turned to face the way the
  person does and mirrored to their side.
- **A library movement's form check in `web/js/app.js`.** `holdCheck()` (from `moveEvents`, on what the coach is told:
  a hold's start carrying a fault in `form.open`, a `hold_fault` or a `form_fault`; that fault's `hold_fix` or
  `form_fix`, `hold_end`) and `showHold()`: the side panel's `#demo` with "You" (`S.trail` within `seenWindow()` of a
  moving fault's `seen`, else, for a hold's fault or with fewer than 2 of those frames left, its last 2 s,
  `HOLD_REPLAY_MS`) and "Like this" (`#likeCanvas`: `likeOf()`, a hold's reference pose turned by `workingSide()`
  against `pose.side`, a moving one's `refPoseOf()` turned to the fault's side against its `side`; `aroundOf()` its
  moment in 3D, its clip mirrored by `clipSide`, the other side from the pose's for a `mirrored` one), and "See it
  again" on the Now card (`#holdAgain`). `S.form.library` marks either kind;
  `finishMovement()` puts it away when the movement ends. `showForm()` draws the panel for an exercise's rep
  (`formCheck`) and a library movement's fault alike, and `threeOf()` makes its 3D view (`S.form.three` for "See it in
  3D"). A moving movement's Now card line goes through `steadyLine()` (`LINE_STEADY_MS`, `LINE_CHECKED_MS`). A
  `form_unseen` is no mistake: `moveEvents` keeps it as `x.unseen` and tells it (a hold's waits in `x.waiting` for the
  held-back start, then goes if `unseenLasts()` says it still holds), `FALLBACK.form_unseen` speaks its cue, and
  `unseenLine()` puts the cue on the Now card (`.alert`) while it holds, ahead of the form line. What it shows and
  when: [README](../README.md#form-check-what-went-wrong-and-the-right-form-in-3d).
- **The Mistakes list (`web/js/mistakes.js`, and in `web/js/app.js`).** Each mistake `formCheck()` or `showHold()`
  shows in a workout (kind `exercise`, `hold` or `move`) goes to `keepMistake()`: `S.mistakes` (a `MistakeList`, the
  latest `MAX_MISTAKES` = 40 and a count of the rest) with a copy of its frames, and `S.rec.mistakes` (`recordOf()`:
  by frame times, no frames). The Workout card's `#mistakes` lists them newest first (`renderMistakes()`, `rowOf()`);
  Show is `pinMistake()`: `showForm(m, true)`, the panel pinned (`S.form.pinned`: no `FORM_MS` timer, `hideForm()`
  leaves it unless forced by Close or the next Start; a mistake shown as it happens over it keeps it in `S.under`, and
  `hideForm()` shows it again when that one goes; only its row is marked), 3D is `open3D(threeOf(m))`.
  `formCheck()`'s 3 s repeat check is against the last one it showed (`S.shown`), not the panel, so a Show cannot turn
  a repeat into a new mistake. `resetMistakes()` clears them when the next workout starts, never at Stop. `#reviewPick` lists the saved recordings
  (`savedWorkouts()`), and `reviewSaved(id)` loads one's mistakes into `S.review` with their frames by window
  (`framesIn()`), or derives them from an older one's events (`mistakesOf()`, `deriveMistakes()`). What it shows: [README](../README.md#mistakes-kept-to-see-again-after-the-workout).
- **`server/dev_server.py`.** Serves the page, clips (with byte ranges), demos and GLBs, and these endpoints:
  `/api/eval-set`, `/api/results`, `/api/recordings`, `/api/recording`, `/api/demos` and `/api/version`, plus the
  coach and voice endpoints (`/api/connections`, `/api/coach/*`, `/api/tts`, `/bench/`, ...: listed in
  [VOICE_COACH.md](VOICE_COACH.md#server-api)). Its docstring describes the routes (not `/api/health`).
  `/api/version` is `code_version()`: a hash of `web/index.html` and every `.js` under `web/js`, its folders too (the
  group files in `web/js/moveforms/`), each with its path, so a page left open over any of them says it is out of date.
- **The coach and voices.** `web/js/connections.js` picks the coach and voice, `web/js/eleven-coach.js` talks to the
  ElevenLabs agent, `web/js/voice.js` speaks, `web/js/listen.js` and `web/js/intents.js` listen and read the user's
  words; `server/connections.py`, `server/coach.py`, `server/tts.py` and `server/stt.py` are the server side. All in
  [VOICE_COACH.md](VOICE_COACH.md).
- **`web/js/moves.js`.** `MovementTracker` follows the one movement the user named, with what the camera measures
  reliably: stillness for a hold (jitter-tolerant), seconds of movement, cycles of one joint signal for a rough rhythm.
  It never works out which movement it is. With a form check it runs the form on the frames given with their
  landmarks: a hold's (`HoldForm`) on the hold's frames, a moving or rhythm movement's (`MoveForm`, `this.mf`) on every
  frame with whether the person is moving (`movingNow()`, and for a rhythm its signal swinging `SWING_UNITS` within
  `swingMs`, its `swing` buffer kept only with a form check and trimmed to that window, or a turn just made) and, for a
  rhythm, the turn `CycleCounter` confirmed on that frame (its `turn`: `{kind, t, v, from, cycleFrom, far, counted,
  wobble}`, with `count`, `signal` and `periodMs` added). `moveFormState()`
  is the `form` on `moving_progress`, `rhythm_progress` and `current()`, null without a check or landmarks. A rhythm
  signal with a fallback (`FALLBACKS`, the library's `rhythm.fallback`; today `thighOut` for `feetWidth`) is
  counted from it while its own parts are out of view: `switchSignal()` goes to the fallback after `GRACE_MS` with
  the fallback's parts in view, and back after `FALLBACK_BACK_MS` of its own in view, each switch a
  `CycleCounter.retune()` (the zigzag afresh, the count and its last time kept). A hold's
  `form_unseen` is `holdBlind()` (`holdUnseen`, an `UnseenWatch` whose wait starts afresh at each `hold_start`; the
  parts from holdform.js `neededLandmarks()`). `tools/build_moves.mjs` builds its library (a repeated movement's
  `rhythm`, a hold's `held` part and reference `pose`, and a guarded movement's `refPoses` from the reference
  skeleton: `rhythmOf`, `heldOf`, `refPosesOf`, with `referenceFrames`, `referenceTurns`, `okMargin`, `stillnessOf`,
  and `prepare()` / `pickOn()` run again on `mirrorSkeleton()` for a one-sided check with no frame on the reference);
  `server/coach.py` reads its events to the coach (`tracked()`, `hold_reading()`, `move_form()`, `unseen_reading()`:
  [VOICE_COACH.md](VOICE_COACH.md#named-movements-what-the-coach-is-told)).
- **`web/js/holdform.js`.** A held pose's form, for the poses in `HOLD_FORMS` (triangle pose, quad stretch,
  figure-four balance): `poseMetrics()` measures a frame, `HoldForm` raises a fault once it lasts, one correction at a
  time, and notices its fix; its `state()` lists the checks `checked` (fine), `open` (told, still there), `pending`
  (a fault not told yet), `unseen` (out of the frame) and `wrongView` (the view cannot judge them), and the form is
  fine only with something checked and the other four empty. `InPose` (`IN_POSE`) says whether the user is in the pose
  at all. The tracker runs them on the hold's frames, given their landmarks (`tr.update(features, t, {world, image,
  aspect})`), each frame once the hold can no longer end before it; `tr.settle(t)` when the page says the start. Each
  check names the `part` to show in red (and `side(m)` for a part on one side), so each fault told carries `part` and
  the user's `side` of it. The checks and their lines: [README](../README.md#a-held-poses-form-measured-never-assumed).
- **`web/js/moveform.js` and `web/js/moveforms/`.** A moving or rhythm movement's guard rails, the same job for a body
  that moves. `bodyMetrics()` measures a frame (MediaPipe's world and image landmarks: angles, lengths in leg or torso
  lengths, per side, the view, what is seen). `MoveForm` (`update(m, lm, t, cycle, moving)`, `state()`, `summary()`,
  `settle()`) judges each check: a `'frame'` check on frames moving (or a `still` one at rest too, once moved, with
  `SETTLE_MS`), a `'peak'` or `'trough'` check on the cycle handed over (`take` 'at', 'max' or 'min', `over` 'half' or
  'cycle'); runs of movement with `WARM_MS`, and pauses by `pauseMs()` (min(`PAUSE_MAX_MS`, max(`PAUSE_MS`, the
  period the last five turns show, bounded by `PAUSE_BOUND_PERIODS` of the rhythm's own)): `turnTs`); 2 bad of the
  last 3 cycles, the verdicts expiring (`verdicts()`); one correction at a time (`tell()`), each `form_fault` with
  `seen` (a frame check's last bad frames, `bad`; a cycle check's `SEEN_MS` around the frame its value came from,
  `cycleSeen`); the floor at each distance (`withFloor()`: the lower ankle's picture height fitted against
  `steadyScaleImg`, `FLOOR_NEAR`, `FLOOR_SLOPE_MAX`, `FLOOR_SPREAD`). Its tuning is `MOVE_TUNING`, each number with
  why; its header comment is the contract (a check's fields, when it is judged, `seen`, the pause, the cycle's
  fields). `form_unseen` is its own part of the file: `UNSEEN_TUNING` (`FRAME_WAIT_MS`, `STAND_HIP`, `WAIT_MS`,
  `WAIT_TURNS`, `HOLD_WAIT_MS`, `EVERY_MS`, `SEEN_MS`), `UnseenWatch` (when to say it: `update()` per frame with
  blind, everything seen, counting towards the wait, a turn, and `ready`: something to say), `standingInPicture()`
  (shoulders, hips and knees in the picture, a hip open `STAND_HIP`), `outOfView()` (the parts to name, from
  `NEEDS_LANDMARKS`), `unseenCue()` and `unseenEvent()` (a hold's). `MoveForm.update()` runs it on each frame after
  the checks: `frame` with the person standing in the picture and an unseen check's parts out of it, naming the
  checks not judged within `FRAME_WAIT_MS` (`blocked`), moving or not; `view` with every check side-on while moving
  past the warm-up.
  `MOVE_FORMS` merges the four group files (`arms.js`, `legs.js`, `transitions.js`, `flow.js`, each a default export
  `{key: [checks]}`); a group file imports nothing from `moveform.js` (which imports it: in the circular import its
  constants would not be set yet), so its few helpers are its own. Each check's comment gives the reference's,
  MediaPipe's and the recordings' numbers behind its line, and each group file says what was left out and why.
  `checkProblems(forms, parts)` checks every check's shape (the tests run it with the page's part names). To add a
  check: put it in its movement's group file with its numbers, run its group test (a fault put in caught, the
  reference and footage passing, the recordings), and rebuild the library for its `refPoses`
  ([README](../README.md#a-moving-movements-form-guard-rails-clear-mistakes-only)).
- **The event shapes** are listed in the header comment of `web/js/auto.js`. The set summary that `AutoTracker.summary()`
  returns is what a main app would store: `{exercise, label, set, reps, partials, startT, endT}`.

## Develop and verify

```bash
npm test                                                  # 486 unit tests (node --test); three.js tests need fetch_assets
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'   # 124 server tests (the .venv: the anthropic SDK)
(cd host && node --experimental-strip-types --test src/lib/*.test.mjs)   # 20: the app's camera workout screen
node tools/run_engine.mjs  --data .data/posedata          # rep counts vs labels: 12/15 exact, 15/15 within one rep
node tools/negatives.mjs   --data .data/posedata          # phantom reps on non-exercise clips: 14 over 188 checks
node tools/auto_eval.mjs   --data .data/posedata          # auto mode: named 13/14, 0 phantom sets, workouts 8/8
node .data/m3d/compare.mjs .data/m3d                      # MediaPipe on the 3D renders vs their source footage
node tools/build_demos.mjs --spec .data/demos/demos_spec.json --out .data/demos   # rebuild the demos (~2 min)
node tools/build_moves.mjs                                # rebuild the movement library (.data/moves/library.json, glb/)
node tools/hold_eval.mjs <recording.json> triangle_pose   # a held pose's form over a saved recording, event by event
node --test tests/moveforms-legs.test.mjs                 # one group's guard rails (arms, legs, transitions, flow)
```

- **The guard rails' tests.** `tests/moveform.test.mjs` (the framework), the four
  `tests/moveforms-<group>.test.mjs` (each group, movement by movement) and `tests/refposes.test.mjs` (the reference
  poses) run their made-up cases anywhere; on this machine they also run the library's reference skeletons and
  footage and the user's recordings from `.data/` (skipped elsewhere), which takes most of their time (the legs'
  recordings test about 17 s). The arms' test also renders its references through a pinhole camera (turned, high or
  low, drifting), as a reviewer's camera sweep did. The group tests print diagnostics: the arms' what each check
  judged on the recordings, by the hand labels in `.data/moves/live_labels.json`. A change to a check's line, phase or
  value changes which frame of the reference
  best shows it: rebuild the library (`node tools/build_moves.mjs`, which prints each guarded movement's "form" line),
  or "Like this" shows the pose the old check picked (`tests/refposes.test.mjs` computes them afresh, so it does not
  see a stale library).

- **Side-crunch regressions.** `tests/side-crunch-recordings.test.mjs` reads the private
  `.data/moves/side_crunch_cases.json` annotations and the recordings at runtime, skipping if absent. Keep recording
  names and annotations private. It covers low / high lifts, strongly bent knees, framing with cropped knees, and
  counts within one measured sweep. Synthetic tests also cover the same-cycle fix/new-fault timing and clearing a
  stale turn on a lost frame. Those side-crunch fixes added no event type; they did not require a live agent prompt change.

- **One-two technique.** `one_two_jab` now has kind/track `technique`: no count or timer, each jab–cross attempt
  independent. `web/js/technique.js` checks upward direction, the other hand's guard and return; full extension and
  hip/shoulder rotation remain unmeasured. The reference and actual source footage both pass their measured checks.
  Same-hand jabs never pass as a complete one-two. `form_fault` uses the existing comparison, 3D and saved Mistakes
  paths; `technique_result` gives the sequence and measured scope. See the [design and thresholds](../README.md#a-one-two-technique-check-no-count).
  The private catalog must use `kind: technique`, `repsMatter: false`, no rhythm override, and the updated no-count
  coach line; `node tools/build_moves.mjs` builds all three correction reference poses. `boxing_cardio_combo` is
  unchanged. `tests/technique.test.mjs` reads `.data/moves/one_two_cases.json` and source footage at runtime, skipping
  absent private inputs. The checked local asset's human preview was a skeleton render; the footage evaluation used
  only the approved two-second original-source segment. The live ElevenLabs prompt was updated and read back for
  `technique_result` and the no-count wording; no paid conversation was started. Current totals: 486 Node, 124 Python.

- **Regression baselines.** Those numbers are the baselines. A change to `engine.js` or `auto.js` should leave the
  outputs unchanged unless it is meant to change them, so diff them before and after.
- **`auto.js` changes.** These have been checked against the previous version with a random-workout fuzzer: 100,000
  cases, the same sets. The fuzzer and other analysis tools are in `.data/dev/`
  ([DATA.md](DATA.md#dev-analysis-tools)).
- **Changes need a live check.** Every change so far went through tests, the evaluations, a browser replay of a
  saved set (Playwright, or the in-app browser), and usually an independent multi-agent review.

## Rules

- **The BuildNorth GitHub repo is public.** Never commit `.data/`, video or footage, demo videos, GLBs,
  labels, recordings, or anything licensed. These stay in the git-ignored `.data/`. Check `git status` before every
  commit.
- **Ask the user before any push or PR. Never merge without their approval.** Publish only a cleaned snapshot
  on a new branch from `origin/main`; never publish the private development history. Leave other checkouts alone.
- **Run the coach on the user's own accounts.** Claude through the Anthropic API on the user's own key, else through
  Claude Code on their login; ChatGPT through Codex signed in with ChatGPT (never an API key); the ElevenLabs agent by
  its id (no key). Never commit the agent id or the user's plans, not even in test fixtures (use made-up ones): the id
  stays in `.data/connections/`, the older `.data/eleven-agent-id`, or `POSE_ELEVEN_AGENT`. Never print `.env` values
  or credentials.
- **The Anthropic key is the user's secret.** Never read, print, copy or log `.data/connections/anthropic-key`, and
  never write it: the user saves it themselves, from `inference/pose-coach`:
  ```bash
  mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key
  ```
  The code hands it to the SDK's client alone, which sends it to `https://api.anthropic.com` only (whatever
  `ANTHROPIC_BASE_URL` says), and never puts it into a log, a status, an error, an answer or the environment; keep it
  so.
  Tests use a made-up key and a stand-in client and never call the real API. Never export `ANTHROPIC_API_KEY` (and
  never tell the user to): Claude Code would use that key and bill it, for the user's own sessions too.
- **Do not call `detectForVideo` on a page the user is using live.** It breaks their frame loop. Read the page
  state only.
- **Ask before any paid compute** (Runpod, cloud GPUs, ElevenLabs minutes and credits: Auto picks the agent first,
  and benchmark runs spend credits; Anthropic API tokens on the user's Console account: with a key saved, every Claude
  session goes through the API, `tools/replay_coach.py` too, unless the server runs with
  `POSE_CLAUDE_TRANSPORT=cli`).
- **Recordings store landmarks only, never camera images.**
- **Use only allowed clips.** Clips for tests and demos follow the licence policy above. Creative Commons footage
  needs its credit, as `demos.json` keeps it.

## Known limits and open work

- **Library movements are named, not recognised.** Recognising them automatically was measured and is not in the app:
  with one reference per movement it named the right one on 7% of the decisions on other people's footage, and a
  wrong one more often (9-14% [in the study](../README.md#why-the-user-names-it-the-recognition-study)). What the page
  measures for a named movement is generic: a hold is the body still, "moving" is the body moving (whatever it does),
  and a rhythm count is any swing of one joint signal, so it is shown and said as "about". Holds are not split by side
  (a quad stretch on each leg is two holds, with the movement between them ending the first). The study's code and
  reports stay private in `.data/`.
- **A held pose's form: three poses, one camera.** Only the triangle pose, the quad stretch and the figure-four
  balance have form checks (`HOLD_FORMS`); any other hold is timed alone (`form: null`), and the coach is told it
  cannot say whether that one looks right. The triangle's lines were set on the user's own recording as well as the
  references; **the quad stretch's and the figure-four's come only from the library's reference skeletons and
  footage**, with no recording of the user doing them yet. One camera judges what it sees: the triangle and the
  figure-four's ankle only from the front or at an angle, nothing frontal from the side, and a check whose parts are
  out of the frame, or that the view cannot judge, is neither bad nor good (the Now card says to step back, or to turn
  to face the camera, and the hold is never called good). A hold of such a pose ends when the user
  clearly leaves the pose, and none starts out of it (a loose test per pose, `IN_POSE`, its numbers in
  `web/js/holdform.js`); with that test's parts out of view nothing is decided, and the hold goes on. The form check
  it shows aside draws the right form as one still frame of the reference skeleton (its SMPL joints as a camera in
  front would see them, not MediaPipe on footage), turned to the user's side by what most of their last 2 s say; in
  3D the library's clip loops its held part at its own pace, with no moment to sync to the user's frames.
- **A moving movement's form: guard rails, little live data.** Ten of the 13 movements done in motion have a few
  checks each (`MOVE_FORMS`), clear mistakes only: the coach never calls their form good as a whole, and a mistake
  they do not look for goes unsaid. Live validation is limited; reference skeletons and approved footage
  do not establish accuracy for every person or camera angle. Keep personal replay results and annotations in
  `.data/`. A check whose parts are out of the picture checks nothing until they are visible.
  `form_unseen` asks after 5 s standing so, then at most every 30 s, from visible standing, or for at most 10 s after
  standing was seen if the shoulders remain visible, the trunk upright and hips near the lower edge; seated hips
  clear that memory. Missing legs never supply form or counts. The side crunch's form always uses thigh peaks
  (`rhythm.preferFallback`), while `SweepCounter` counts a rise
  of either thigh angle or visible feet width once within the reference's minimum period. Bent sweeps no longer
  reverse the form's phase. This remains approximate: other movements can swing these signals. The 3 s warm-up
  (`WARM_MS`) and the pause rule (5-12 s by the pace of the turns, `pauseMs()`) are not live-measured either. **The dances are unchecked** but for the
  Bharatanatyam's hands: the freestyle and the hip-hop dance have no check (nothing measured holds: in
  `web/js/moveforms/flow.js`), so `form: null` and the coach is told nothing of their form. The Bharatanatyam has one
  per hand, a hand raised by the face instead of brought in to the chest, on its
  own timing (`smoothMs` 400, `faultMs` 800: a gesture held about a second); as a `still` check it waits for a first
  movement, and its reference reads 0 s moving at its own pace. One camera: the frontal
  checks are judged from the front or at an angle only, the shoulder rotation's, the combo's knees and the kneels'
  front knee from the front only; the floor the step touch's jump is judged against is fitted to the person's distance
  over the last 4 s (a straight line by their size on screen), and the jump is judged only with the ankles within
  0.1 m of each other in depth (a foot stepped forward or back is not judged). The
  Y-to-W's Y is judged only when the arms come down into a W after it (elbows bent, forearms out): a Y lowered with
  straight elbows is never judged. "Like this" is one frame of the reference skeleton as a camera in front would see
  it (for a check of the side the reference never moves, the side crunch's left sweeping knee, its mirror image), and
  in 3D the clip plays around that moment at its own pace. A rhythm's cycle verdicts expire after 12 s
  (`VERDICT_MIN_MS`, while the build caps the period at 3 s): done slower than one cycle in 12 s, a movement's bad
  cycles never count together, so no cycle check tells a fault. There is no `hold_eval`-like tool for a moving
  movement's form on a recording yet.
- **A saved workout's mistakes, reviewed.** "Like this" is today's demos and library, not those of the day it was
  saved. A recording saved before the Mistakes list has its mistakes derived from its events by the page's rules (when
  a hold was told and its form then, which fault of a rep was shown), not from a record of what the page showed. A
  recording does not say when the tracker said a hold's end (its `t` is when the hold ended, a second or so before),
  so a hold whose end was said about when the page tells a hold (6.5 s in) counts as told by its end's time (5 s in)
  unless an event of it says; and what Stop or another movement named settles (a hold's end and a fault measured with
  it, a set's last reps) is derived although the page never shows it.
- **The movements' names by voice.** The page's own listening learns them from the library (`web/js/intents.js`). The
  agent's speech recognition has keywords for the exercises, "done" and "not yet" only, not the movements' names
  (its `set_movement` tool has them as an enum: the keys of the 17 the engine does not count).
- **The clip policy holds 19 of the 61 Ready motions** (licence, a possible minor, research consent not recorded): the
  library has no animation for the lunge, the lateral raise or the biceps curl, which are still counted as exercises.
  Of the 41 it clears, the library offers 28: the user chose to leave out sport moves, walking and jogging, gestures
  and idle poses (`LEFT_OUT` in `tools/build_moves.mjs` skips those kinds).

- **One camera.** It gives depth only as a guess. From the front, an arm forward and an arm out to the side can look
  alike, and the 3D view cannot see a limb's twist or which way a palm faces.
- **Gaps between reps.** Reps more than 6 s apart do not form a set. The page says so after a lone rep.
- **Framing.** The feet must be in view for leg exercises. The side panel shows a warning when they are not.
- **The push-up demo never locks out** (its tops stop at 140-154°), so it is never shown for "press all the way up".
  The overhead-press clip never lowers the bar, so its 3D demo plays at its own pace.
- **A rare timing race.** In 1 of 100,000 fuzzed workouts the new auto mode ends a set at its 20 s rest in the same
  second as a rep the old fixed wait had kept queued.
- **The ElevenLabs agent.** One session at a time, a daily cap, billed by the minute. Its allowlist names
  localhost and 127.0.0.1 (any port), which any machine can serve, and a client outside a browser can send any Origin: anyone with
  the id can start sessions on the user's plan. Keep the id private (it is an identifier the page receives, not a
  secret); the daily cap times the agent's maximum conversation duration bounds the spend.
- **Duplex: the user's voice leaves the machine.** With the agent and its own voice the microphone is open: what it
  hears goes to ElevenLabs for transcription, the transcript stays in the agent's conversation history for 30 days (the agent's own privacy settings, since
  2026-10-24: no audio recorded, transcripts kept 30 days; set on the agent, not here). It hears the room as well: its prompt tells it to ignore counting out loud, music and other people, and a
  toggle in the side panel mutes it (only silence is sent then, but the microphone stays open until the session ends;
  another voice never opens it). Video never leaves the machine. Details:
  [VOICE_COACH.md](VOICE_COACH.md#security-and-privacy).
- **Open security items** (details in [VOICE_COACH.md](VOICE_COACH.md#security-and-privacy)). `POST /api/results` and
  `POST /api/bench/result` have no write guard, so a page elsewhere can overwrite results. Claude Code's check
  accepts any Claude Code sign-in, and only `ANTHROPIC_API_KEY` is removed from its environment. The user's Anthropic
  key sits in a plain file on this Mac (mode 0600, git-ignored): anything running as the user can read it. The server
  never sets that mode; its connection check only warns (`/api/connections`, `claude.api.warning`, from the file's
  mode alone) when other users can open the file, and the Connections panel does not show that warning yet.
- **Codex ends its turn.** `codex exec` stops when GPT-6 Luna ends its turn. The server starts it again with a recap
  (5-7 s to reconnect) and gives up after 3 failed runs in a row; the page then moves on.
- **Kokoro on MLX is Apple Silicon only.** misaki's espeak-ng fallback is GPL-3.0: fine on this Mac, a question before
  the voice is served to other people.
- **Listening without the agent.** Parakeet runs on this Mac (Apple Silicon only; the model is CC-BY-4.0): the audio
  never leaves it, and the words go to Claude or ChatGPT as text and stay in the coach session's log
  (`.data/posedata/coach/`; through the Anthropic API the log keeps the replies, not the events). It hears the room:
  other people's words are written down and sent like the user's (the coach is told to let pass what is not meant
  for it; counting out loud and fillers are never sent). The Mac's voice plays outside the page, so echo cancellation
  cannot take it out of the microphone: the echo guard takes its words out of an utterance that overlapped it, but
  talking over it does not cut it. Measured on Kokoro's voices only, not on a real voice in a real room: 54 of 60
  phrases word for word; a British voice's "Jumping jacks" came back "Jumping Jackson", which reads as a jump, and a
  bare "No." as "Now". Words
  the page did not apply are read to the coach as "the page changed nothing", and its prompt lists the 13 exercises:
  live, "Let's do burpees." got "I can't count burpees..." (before, "Burpees, great choice."). Each dev server loads
  its own Parakeet (2.5 GB), as it does Kokoro (`POSE_STT=0` turns it off on a server that needs no listening;
  `tools/serve.sh m3d` does not set it yet); on a 16 GB Mac under memory pressure the first utterance after a minute
  idle took 0.65-0.9 s instead of 0.1-0.2 s. Live, a question to Claude took 2.2-3.0 s to answer (the page waits 10 s
  for an answer).
- **What the page does not tell Claude and ChatGPT yet.** Whether it is listening: their questions are not tagged
  `listening: false` when nothing hears the user (no Parakeet, the microphone refused or muted), so `SYSTEM` has them
  ask without saying how to answer. The `say` tool's description (`server/pose_mcp.py`) still says 25 words and not
  that an empty text is allowed, against `SYSTEM`'s 50 for an answer and its empty text for words not meant for it.
- **The coach inside the app is not verified.** Whether the agent's allowlist admits the frame's origin
  (http://127.0.0.1:8765; a refusal hands over to Claude), the voices inside the frame, and the microphone there, for
  duplex and for the page's own listening (the screen's iframe allows `microphone`; refused, the page goes on with the
  buttons).
- **The main app: phase 1 built, not merged.** A camera workout screen for the BuildNorth web app is in
  [`host/`](../host/README.md), with the page's embed mode (`web/js/embed.js`). It waits for the other agents' web app
  to be committed; until then `bash tools/try_in_app.sh` runs it in a copy of the app on :8082. The later phases are in
  [INTEGRATION.md](INTEGRATION.md).
