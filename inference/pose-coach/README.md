# Rhythm pose coach (browser prototype)

Form coaching that **measures** instead of guessing: MediaPipe pose tracking in the browser (33 body landmarks,
30 fps, on this machine) feeds an exercise engine that counts reps and checks form per rep with explicit rules. Only
when there is something worth saying does a coach turn the measured fault into one or two spoken sentences: an
ElevenLabs agent (reached by its id); Claude, through the Anthropic API on the user's own key when they saved one
(billed per token on their Console account), else Claude Code connected over **MCP** on their Claude login (like
BuildNorth's `/mcp`); or ChatGPT, Codex over MCP on their ChatGPT login. Kokoro on this Mac, or the agent's own voice,
speaks them. The coach asks
which exercise the user is about to do and, when a set seems over, whether it is, and the user can talk back: to the
agent with its own voice (duplex), or to Claude, ChatGPT or the engine through the page, which writes their words down
on this Mac (Parakeet TDT 0.6B v3 on MLX) and sends the coach the words only; or answer with buttons. Video never
leaves the machine: the coach gets small text events and the user's words, and only in duplex the user's voice (see
[privacy](docs/VOICE_COACH.md#security-and-privacy)).

It does not have to be one of the 13 exercises: the user can name any of 29 movements of the motion library (a stretch,
a yoga pose, a dance, a gym move with no counter, ...), by voice or with a tap, and the coach keeps track of that one
with what the camera measures reliably: a hold timer, the time moving, or an approximate rhythm. For three held poses
(triangle pose, quad stretch, figure-four balance) the page measures the form of the hold too
([A held pose's form](#a-held-poses-form-measured-never-assumed)), and for 10 of the movements done in motion (the 7
gym moves with no counter, the 2 transitions and the flow) a few guard rails, clear mistakes only
([A moving movement's form](#a-moving-movements-form-guard-rails-clear-mistakes-only)); the coach never calls a
movement's form right or wrong unless it was measured. Nothing in the page recognises a library movement
by itself (measured: on other people's footage that was right 7% of the time), and reps are counted only for the gym
exercises the engine counts
([Movements](#movements-from-the-library-named-not-recognised)).

```
camera / test clip -> PoseLandmarker (web/js/pose.js) -> features: joint angles, view, positions (web/js/engine.js)
  -> rep detector (peak/valley with hysteresis) -> per-rep form checks -> cue after a fault on 2 of 3 reps
  -> the first connected coach (web/js/connections.js):
       the ElevenLabs agent (web/js/eleven-coach.js, WebSocket from the page: its LLM and its voice), or
       dev server /api/coach/* -> MCP server (server/pose_mcp.py) <- claude -p --model sonnet | codex exec (server/coach.py)
       or, with the user's Anthropic API key saved: dev server /api/coach/* -> a worker thread -> the Anthropic API
  -> the cue (say(text) over MCP, or the API's reply) -> page -> the agent's voice, or Kokoro (web/js/voice.js:
     /api/tts on MLX, else in the browser, else the Mac's voice)   (the engine's own sentence if no cue within 3 s)
the user's answers (which exercise, is the set done) -> the agent's client tools (by voice), or the side panel's chips
  and buttons -> AutoTracker (web/js/auto.js)
the user's voice, for Claude, ChatGPT and the engine -> the page's microphone and detector (web/js/listen.js)
  -> POST /api/stt (server/stt.py -> stt_worker.py: Parakeet on MLX) -> the words -> web/js/intents.js: an exercise,
     "detect it", done or not yet applied as a chip would be -> the coach gets {kind: "user_said", text, applied?}
a movement of the library the user names (a tap in Movements, their words, the agent's set_movement) -> GET
  /moves/library.json -> an exercise the engine counts: as that exercise; any other: web/js/moves.js MovementTracker
  (a hold timer, time moving or an approximate rhythm), and no reps meanwhile -> the coach gets movement_set,
  hold_start / hold_progress / hold_end, moving_progress, rhythm_progress
  a hold of a pose web/js/holdform.js checks -> its form from the landmarks -> hold_fault / hold_fix, and `form` on the
  hold's own events -> a fault told: the side panel's form check (the user's last 2 s, the part in red, next to the
  movement's reference pose from /moves/library.json; in 3D on request, next to its /moves/glb/<key>.glb)
  a moving or rhythm movement web/js/moveform.js checks (its guard rails: web/js/moveforms/) -> its form from the
  landmarks -> form_fault / form_fix, and `form` on moving_progress / rhythm_progress -> a fault told: the same form
  check, next to the reference pose of that check (library.json `refPoses`)
  a check's parts out of the picture while the person stands in it, or every check side-on, a while -> form_unseen
  -> the coach asks the user to step back or turn, and the Now card says so in large type (no form check, no mistake)
  a feet-width rhythm with the ankles out of the picture -> counted from the more lifted thigh (`rhythm.fallback`)
each mistake the form check shows (a rep's, a hold's, a moving movement's) -> the Workout card's Mistakes list
  (web/js/mistakes.js): shown again pinned or in 3D, kept after Stop until the next Start, and in the saved set
  (`mistakes`), reviewed later
```

Start here: [docs/HANDOFF.md](docs/HANDOFF.md) (where everything is, how to work on it, the rules),
[docs/DATA.md](docs/DATA.md) (the git-ignored `.data/` folder), [docs/INTEGRATION.md](docs/INTEGRATION.md)
(connecting it to the BuildNorth app) and [docs/VOICE_COACH.md](docs/VOICE_COACH.md) (the coach, its connections and
voices).

## Run it

```bash
cd inference/pose-coach
bash tools/fetch_assets.sh                                     # MediaPipe 1.1.0, pose models, three.js, Kokoro, ElevenLabs client (pinned; models and ElevenLabs client checksummed)
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "mcp>=2.3" "anthropic>=2.1"   # the coach
mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key   # optional: Claude through the API on your own key
bash tools/setup_kokoro.sh                                     # optional: the local voice (Kokoro-82M on MLX, Apple Silicon)
bash tools/setup_stt.sh                                        # optional: talking to the coach without the agent (Parakeet on MLX, 2.5 GB)
node tools/build_moves.mjs                                     # optional: the Movements card (from the private motion library)
bash tools/serve.sh                                            # http://localhost:8765/ on the data in .data/
```

`tools/serve.sh` sets `POSE_DATA_DIR`, `POSE_CLIPS_DIR` and `POSE_DEMOS_DIR` to `.data/` (`bash tools/serve.sh m3d`
serves the 3D test set on 8766); the server can also be started by hand with those variables.

Open `http://localhost:8765/` (localhost counts as a secure context, so the camera works) and press **Start**. By
default ("Auto: detect exercises") the page counts at once, working out what you are doing (reps and sets per exercise),
and the coach asks which exercise you are about to do: say it (to the ElevenLabs agent), tap it in the side panel, or
just start; with no answer in 12 s it goes on detecting. Before it ends a set it asks whether you are done
([below](#auto-mode-which-exercise-how-many-reps-how-many-sets)). Pick one exercise instead to count only that. The
reps, the exercise and set, the warnings, the coach's last line and its questions are in the side panel, not on the
video: over the video there is only the skeleton, and the 3D view while you have it open. The form check of a
faulty rep, or of a held pose's or a moving movement's fault
([below](#form-check-what-went-wrong-and-the-right-form-in-3d)), is in the side
panel too, and each one it shows stays in the Workout card's Mistakes list, to see again after Stop (and a saved
workout's, reviewed later). The AI coach is the first connected of the ElevenLabs
agent (its id set in the Connections panel), Claude (an Anthropic API key saved in `.data/connections/anthropic-key`,
else `claude auth login`) and ChatGPT (`codex login`, signed in with ChatGPT); with none, or with "AI coach" Off, the
engine's own sentences are spoken. Claude through the API gets no tools at all: a worker thread in the dev server sends
each event as one message and speaks the reply (10 s per request and one quick retry of its own, so a slow API never
holds the coach for minutes; an event the page has stopped waiting for is not sent, but told with the next one).
Claude through Claude Code gets only the two pose tools (`--tools ""` disables Claude Code's built-in tools: no shell,
no files). A ChatGPT session gets them plus Codex's `apply_patch`,
which its read-only sandbox refuses (its other tools are disabled, and none of the user's Codex settings load). Both
CLIs run in an empty folder outside any checkout, and Claude Code without the user's settings, plugins or skills
(`--setting-sources ""`, `--disable-slash-commands`). Setup and every detail:
[docs/VOICE_COACH.md](docs/VOICE_COACH.md).

**Coach and voice** (the page's two pickers; measured in [the benchmark](#coach-and-voice-benchmark-2026-10-24)):
- *AI coach*: Auto takes the first that can be used, in this order: the Rhythm coach agent on ElevenLabs (its own LLM,
  DeepSeek V4.1 Flash, and its own voice; on a paid ElevenLabs plan, billed by the minute), Claude Sonnet 5.5 at
  effort high (through the Anthropic API on the user's own key, billed per token on their Anthropic Console account,
  when a key is saved and the API has not refused it; else through `claude -p`, the user's Claude subscription),
  ChatGPT GPT-6 Luna through `codex exec` (the user's ChatGPT subscription, never an API key), else the engine's own
  sentences. Each can be picked by hand, or Off. A coach that fails to start hands over to the next one in that order
  (never back), and cues it already owed still get the engine's sentence after 3 s.
- *Voice*: Auto is the agent's own voice with the agent, Kokoro otherwise. Kokoro-82M on this Mac
  (`tools/setup_kokoro.sh`; falls back to Kokoro in the browser, then the Mac voice, which also stands in while Kokoro
  loads), the agent's own voice (with the agent only), the Mac voice, or off.
- *Connections* (a panel): what is signed in or set up, what Auto uses, Check again (after a sign-in), and the agent's
  id with Save and Forget. The id is read from `POSE_ELEVEN_AGENT`, else `.data/connections/elevenlabs.json` (saved
  from the panel), else the older `.data/eleven-agent-id`; it stays out of the repo. The agent is public: its allowlist
  admits only pages served from localhost or 127.0.0.1, on any port (any machine can serve those, so it keeps other
  websites out, not people who have the id), one session at a time, with a daily cap. Claude's row says which way
  Claude goes: "through the API (your key)" or "through Claude Code (your Claude login)". The key is saved from the
  command line, never from the page, and is never shown, logged or sent back
  ([how](docs/VOICE_COACH.md#claude-through-the-anthropic-api-your-own-key)). Never export `ANTHROPIC_API_KEY` in the
  shell: Claude Code would then use that key and bill it.
- An agent session connects at Start and ends just after the workout summary (it bills by the minute); with no event
  for 5 minutes, or the page hidden for a minute, it ends early and the next event brings it back. Events that arrive
  while it answers go as one message. A Claude or ChatGPT session is one per page, kept across sets.
- *Talking to the coach*: with the agent and its own voice the session is duplex. The browser asks for the microphone
  (echo cancellation, noise suppression and automatic gain control on); the user answers and changes the exercise by
  voice (the agent's client tools `set_exercise` and `answer_set_end`), and a toggle in the side panel mutes the
  microphone (ElevenLabs then gets silence; the browser keeps it open until the session ends, and a session started
  muted never opens it). In duplex the user's voice goes to ElevenLabs for transcription and their transcript is kept
  in the agent's conversation history; the agent's own settings also keep the audio
  ([privacy](docs/VOICE_COACH.md#security-and-privacy)).
- *The page listens* with Claude, ChatGPT or the engine's sentences, once `tools/setup_stt.sh` has set up Parakeet:
  during a workout, a detector in the page cuts what the user says into utterances (an adaptive noise floor with
  hysteresis, 300 ms of pre-roll, 700 ms of quiet ends one, 15 s at most), Parakeet writes each down on this Mac
  (`POST /api/stt`, 0.16 s median for a 1.5-3.7 s phrase), and the audio never leaves the machine: the coach gets the
  words as text. Words that name an exercise ("now lunges", or any name while "which exercise?" is open), ask for
  detection ("you figure it out") or answer "Done with this set?" (yes, done / not yet, one more) are applied as a chip
  or a button would be, and the coach confirms them in its own words. Questions it answers in up to 50 words (a few
  mid-set), from general fitness knowledge, never with an invented measurement; pain gets general advice and "see a
  professional". Words it did not apply are never confirmed as a switch: the coach is told the page changed nothing,
  and says so for an exercise the tracker cannot count. Talking over the page's voice cuts it (barge-in), and the
  Mac's voice heard back is taken out of what the user said.
  Mute stops the detector; **Hold to talk** (or the Space bar) records one utterance without it, for a noisy room. With
  no AI coach the engine confirms what was applied and says it can count and coach reps. Details:
  [docs/VOICE_COACH.md](docs/VOICE_COACH.md#talking-to-the-coach-the-page-listens).
- *Talk to coach* (a button in the side panel) opens a conversation without a workout: the page listens (Claude,
  ChatGPT, the engine), or a duplex session of the agent (billed by the minute). It closes on a second tap, on Start
  (the workout carries it on) or after 2 minutes without a word. The **Coach chat** card shows the conversation
  ("You: ..." / "Coach: ...") for every coach, the agent included, apart from the log. A refused microphone, a
  text-only agent (another voice) and a Mac without Parakeet leave the chips and buttons.

Exercises: squat, squat pulses, push-up, lunge, lateral raise, front raise, biceps curl, triceps kickback,
overhead press, deadlift/hinge, jump, jumping jack, knee raise (`EXERCISES` in `web/js/engine.js`).

## Auto mode: which exercise, how many reps, how many sets

`web/js/auto.js` runs every exercise engine on the same frames and decides what is being done:
- a rep is a candidate only if it is clearly that exercise (the exercise's `distinct` rule: e.g. a lateral raise
  stops near shoulder height with the arm out to the side, a front raise points forward (both judged in 3D, so the
  camera's angle does not matter) and both are lifted under control, a curl's arm straightens at the bottom, a lunge
  bends one hip far more than the other, a kickback is bent over, arm exercises stand still on straight knees, only
  push-ups are done lying down) and the tracking held together over the rep. `distinct` is used in auto mode only:
  with one exercise chosen, the engine counts what it was told to (incline push-ups, squats leaning far forward);
- two exercises claiming one movement (within 0.7 s): the set in progress wins, then the more specific movement (a
  jumping jack also raises the arms). The squat before a jump (its take-off) and after it (the landing) always belong
  to the jump, so squats followed by squat jumps become a jump set; one or two bounces at the bottom of a squat are not
  squat pulses (a series of pulses is), and a pulse never beats a squat;
- a set starts after 2 reps in a row (3 for arm exercises, 4 for knee raises and pulses) at a steady rhythm (no gap
  more than 2.5x another, 2x for arm exercises), and those reps count; one stray movement never does;
- a set ends when the user says it is done: after 8 s without a rep of its exercise the coach asks "Done with this
  set?" (`set_end_pending`; the set stays open). Done ends it (reason `confirmed`); a new rep keeps it going, and so
  does Not yet (not asked again before its next rep; a rest ends it 20 s after the later of its last rep and the
  answer). With no answer it ends after 20 s without a rep, as before
  (plus the 3 s a rep can take to be reported; reps of the next exercise seen meanwhile carry over). It also ends at
  once when another exercise takes over (its K reps with none of the current one between; one more if the current one
  had not paused), so alternating push-ups and squats gives push-ups set 1, squats set 1, push-ups set 2. Arms taking
  turns with one following the other closely are judged on each arm's own rhythm and a repeating offset (which takes
  two more reps to see). The coach is told when a set is recognised, when it ends, and gets a workout summary; it
  hears "fixed" only for a fault (of that arm) it was told about in this set, and praise only for five clean reps of
  the set in a row.

**The user's word comes first.** Counting starts in auto mode at Start, so no rep is lost while the coach asks which
exercise. An answer (by voice to the agent, or a chip in the side panel) names it: `new AutoTracker({ only: key })`, or
`setExercise(key)` mid-workout, counts with that exercise's engine alone, and a set starts on its first counted rep (no
K reps in a row, no rival exercise; its reps seen just before the answer start that set). Naming another exercise ends
the open set (reason `switch`); "Detect for me" (`"auto"`) goes back to detecting. With no answer in 12 s the page stays
in auto mode. With nobody answering, as in `tools/auto_eval.mjs`, sets end as before. In detail:
[docs/VOICE_COACH.md](docs/VOICE_COACH.md#the-coach-asks-which-exercise-and-is-the-set-done).

During a set, a rep shows as soon as the engine reports it; a squat-like rep 1.1 s after its bottom (1.9 s if the feet
left the floor around it, or longer while a jump near it is undecided: it may be a jump's take-off or landing); a pulse
2 s after it (until a squat around it would have been reported).

Outside a set, a rep used to wait 3 s for any rival detector (an overhead press is reported up to 2.2 s after its top),
so every new set appeared 3 s after its K-th rep. Now a rep is decided as soon as that wait could no longer change the
outcome (`settled` in `web/js/auto.js`), and 3 s is only the limit:
- whatever could beat it must turn within 0.7 s of it (a jump up to 1.2 s after a squat-like take-off; a squat or lunge
  within 1.5 s of a pulse makes the pulse a bounce), and each engine says which reps it is in the middle of
  (`pendingTurns`), leaving out turning points in a posture its `distinct` rules out (`lying`: no deadlift in a plank)
  and, unless jumps are being done, a jump detector's "peak" with the feet on the floor (standing up after a squat);
- reps are decided in the order they happened: one waits for any earlier rep still waiting or still being reported
  (unless it beats that rep anyway; a detector still in a rep 3 s after its turn is holding a position);
- squats and lunges wait until the person stands up again; a rep that would switch the set to another exercise waits
  the full 3 s (a rep of the current exercise reported meanwhile still cancels the switch), and reps of a set that
  started early that a jump or a squat around them can still claim are decided at the time they were before.
Same sets as with the fixed wait: `tools/auto_eval.mjs` output is unchanged, and of 100,000 random scripted workouts
compared with the fixed-wait code (reps reported up to 2.2 s late; a scratch fuzzer, not in the repo) one gave other
sets: a set ending after its 20 s rest in the same second as a rep the fixed wait had kept queued a little longer.
Measured on the live sets, a new set now shows 0.2-0.3 s after its K-th jumping jack, 0.7 s after a push-up and
1.2-1.4 s after a squat or lunge (3.0 s before); a switch still takes 3 s.

The first reps of an exercise without a set show at once in the side panel, in grey on the rep counter and in large type
("Jumping jack? Do 1 more to start counting"; from halfway for the exercises that need 3-4 reps, which a stray movement
makes), and go back after 7 s if no rep follows, with a hint: reps more than 6 s apart are not one set (live, single
reps 5-25 s apart never started one). A page left open while the code changed says so at Start ("This page is out of
date: reload it"; `/api/version` hashes the page's code: `web/index.html` and every `.js` under `web/js`, its folders
too, each with its path) and saved sets record the version they ran (`code`).

Positions on screen (hip travel, foot lift) are measured in body lengths from the raw image positions over each rep's
own body scale, so they do not depend on where the person stands in the frame; the body scale is taken from ear to
hip, not shoulder to hip (raising the arms lifts the shoulder points).

## Movements from the library: named, not recognised

Besides the 13 exercises, the user can do any of the 29 movements the motion library offers
([below](#which-movements-the-clip-policy)): the **Movements** card in the side panel lists them by group, each with
what is kept track of and **Show in 3D** (its animation on the Y Bot, in the 3D view). The user names the one they do:

- **a tap** on it (before Start it is picked for the workout), **their words** ("now a quad stretch": `web/js/intents.js`
  learns each movement's spoken names from the library), or **the agent**, whose `set_movement({movement})` tool takes
  the same path. The start question's chips have **Other movement...**, which opens the card;
- **a gym exercise the engine counts** (12 of them, e.g. an overhead kettlebell squat, a tuck jump) goes the exercise's
  own way (`setExercise` with its engine key): its reps are counted, and its animation is the reference in 3D;
- **any other** runs a `MovementTracker` (`web/js/moves.js`) for that movement only, and **reps are not counted** while
  it is named: the set in progress ends, the AutoTracker gets no frames, and naming an exercise or "detect it" starts
  counting again. Another movement named ends the one before (its time or count is kept).

| Card group | Kinds (movements) | What is kept track of | Now card | The coach |
|---|---|---|---|---|
| Gym exercises | `gym_counted` (12) | reps, by the exercise's engine | the rep count | as for the exercise |
| Gym moves | `gym_reps` (7), `transition` (2) | gym moves: an approximate rhythm count; transitions: the time moving; for all 10, a few guard rails ([below](#a-moving-movements-form-guard-rails-clear-mistakes-only)) | "About 12" / "Moving 0:40", and under it the line of their form as a hold's (the fault told, "Form: checking...", "Form checked", what could not be checked and why), steadied; "See it again" while the fault told is still there; with a check's parts out of the picture a while (or the user side-on), what to do about it in large type ("Step back so I can see your feet: I can't check your form.") | "about 10 so far"; each guard rail's correction as it is measured and its fix praised; never "good form" as a whole; with a check's parts out of the picture a while (or side-on), to step back or turn |
| Gym moves | `technique` (1) | a single jab–cross attempt, without a count or timer | "Technique", the current attempt and its measured correction | scoped direction/guard verdicts; no punch or attempt totals ([below](#a-one-two-technique-check-no-count)) |
| Holds | `hold` (3) | a hold timer, and the hold's form ([below](#a-held-poses-form-measured-never-assumed)) | "Hold 0:23", and under it, once the coach was told the hold's start, the fault told ("Form: feet too close together"), "Form: checking...", "Form checked", or what could not be checked and why ("step back ...", "turn to face the camera"); "See it again" while the fault told is still there and its form check is put away ([below](#form-check-what-went-wrong-and-the-right-form-in-3d)); with every check out of view 4 s into the told hold, what to do about it in large type | a cue to settle in (the measured fault's correction, if any), each later fault's correction and its fix praised, the time held, how long at the end (nothing for a hold under 5 s); with every check out of view, to step back or turn |
| Flows and dance | `flow` (1), `dance` (3) | the time moving; the flow's reach overhead (the dances: no check) | "Moving 1:42" (the flow: its form line too) | encouragement with the time (the flow: its correction and fix too) |

What `MovementTracker` measures (pure, shared by the page and the node tests; its settings are `TUNING`):

- **Hold** (stretches, poses, balances): whether the body is still. Every frame it measures how far the body's
  positions on screen (over the body's scale) and its joint angles spread over the last 0.5 s, trimmed of glitches and
  in units of MediaPipe's own jitter on a person standing still, part by part (the trunk, each arm, each leg; a single
  limb counts three times less). After 1.5 s still a hold's timer shows; once the hold has lasted 3 s it is told
  (`hold_start`) and counted, with progress at 10, 20 and 30 s and then every 15 s (`hold_progress`); it ends after 1 s
  of clear movement within 1.5 s, or 1.5 s out of view (`hold_end` with the seconds held). A shorter one (a pause, an
  adjustment between sides) is neither told nor counted. Jitter, a sway or one hand adjusting never ends it: only
  lasting movement of the trunk or of two limbs, or a large one of a single limb. For a pose with a form check, a
  hold also ends when the user clearly leaves the pose (stands up out of the triangle, puts the lifted foot back
  down), timed to when they left it, and none starts while they are out of it (standing still beside the pose is not
  holding it). Each pose has a loose test of being in it (`IN_POSE`, `InPose` in `web/js/holdform.js`, with its
  numbers), far outside its form checks' lines: a pose done badly is still in the pose, and its faults are told. The
  form never sees the frames out of the pose, and with the test's parts out of view nothing is decided (the hold goes
  on; a leave the test cannot confirm within 1 s, because its parts went out of view or the user turned side-on, is
  forgotten, so the hold's marks and corrections are not held back until it decides again). Without it, standing up out of a pose in under a second could leave the hold
  ran on, and the coach was told their trunk was too upright. The coach hears of a hold only once it has lasted 5 s
  (the page holds `hold_start` back until 6.5 s in): shorter, the user was settling in or adjusting. Its form:
  [below](#a-held-poses-form-measured-never-assumed).
- **Moving** (flows, dances, transitions): the seconds of clear movement, added up once a movement lasts (0.7 s of
  it within 1.5 s: a fidget is not moving) and never reset by a pause, with `moving_progress {seconds, form}` every
  30 s.
- **Rhythm** (gym moves with no counter): cycles of one joint signal the library names for the movement (`rhythm:
  {signal, minPeriodS, prominence}`, derived by the build tool from the movement's reference skeleton: a knee angle,
  the higher arm, the hips' height, ...), counted with hysteresis, no faster than the movement goes, with
  `rhythm_progress {count, approximate: true, form}` every 5 cycles. Approximate by design: any swing of that signal
  counts, whatever the person is doing. It is shown as "About 12" and the coach says "about". A signal can have a
  fallback, counted while its own parts are out of view (`FALLBACKS`, the library's `rhythm.fallback`): the feet's
  spread (for example, the wall leg raise) falls back to `thighOut`, the more lifted thigh's angle from
  straight down, once the ankles have been out of the picture 400 ms with the hips and knees in it (`GRACE_MS`), and
  goes back to the feet once the ankles have been in view 2 s (`FALLBACK_BACK_MS`). Each switch starts the zigzag
  afresh and keeps the count (`CycleCounter.retune`), so no cycle is counted twice. In the earlier fallback experiment,
  the user swept a leg out with the
  feet below the picture on both of their side crunches and few sweeps were counted (10 of 18, 11 of 17); from the
  thigh, 19 and 17. The knees' spread across the picture counted them late or twice (20 of 18). Back to the feet after
  1 s, 14 of the 18 were counted (the swept ankle rising into the picture and leaving it again); after 3 s, a sweep of
  the other set was lost.
  The side crunch now sets `rhythm.preferFallback`: its form always follows the thigh's peaks, because bending the
  sweeping knee can reverse feet width before the thigh reaches its top. `SweepCounter` counts attempts from a clear
  rise of either thigh angle or visible feet width, once within the reference's minimum period (1.1 s here).
  Feet width recovers small straight lifts; thigh angle recovers bent lifts. The trunk must be visible and upright;
  the thigh signal needs both hips and knees visible. Neither counts inferred legs below the picture. A turn is
  cleared on an unseen frame, so consumers cannot mistake a stale turn for another rep.
- **The form of a moving or rhythm movement** with guard rails (`MOVE_FORMS` in `web/js/moveform.js`), from the frames'
  landmarks: `form_fault` and `form_fix` as they come, and `form` on the progress events and `current()`; `form: null`
  for a movement without a check, or frames given without their landmarks
  ([below](#a-moving-movements-form-guard-rails-clear-mistakes-only)).
- **The form not checked at all** (a moving, rhythm or held movement with a form check): `form_unseen {missing, parts,
  why, cue}` when a check's parts have been out of the picture a while with the person standing in it, or every
  check side-on (a hold: every check out of view or side-on)
  ([below](#a-moving-movements-form-guard-rails-clear-mistakes-only)).

Naming matters for counting too: with nothing named, auto mode makes sets of a close relative out of three of the
library's movements (`tools/auto_eval.mjs`: a kneel-and-stand as squats, a boxing combo and a side kick with a knee
raise as knee raises); named, they are tracked as themselves and no reps are counted.

The workout summary lists the movements with their times or counts, after the exercises' sets ("Quad stretch: held
0:45", "Hip-hop dance: 1:42 moving", "Y-to-W raise: about 20"). What the coach is sent and told, event by event:
[docs/VOICE_COACH.md](docs/VOICE_COACH.md#named-movements-what-the-coach-is-told).

**A rhythm the catalog gives.** A reference too short to show its own rhythm takes one from the catalog
(`catalog.json` `motions[].rhythm`, `tools/build_moves.mjs` `catalogRhythm`). The shadow-boxing one-two (2 s: one jab,
one cross) derived the hips bobbing as its rhythm; given `armMax` (the upper arm from the torso: 40-48 deg in guard, 59-68
at a jab, 76-79 at a cross, on the 9 s clip it was cut from), prominence 16 and 0.4 s, it counts one-twos: the cross's
swing (5 for the one-two played 5 times, 8 on the 9 s clip with its 8 crosses), the jab's too small to count on its own.

**Built from the library.** `node tools/build_moves.mjs` reads `.data/moves/catalog.json` (the 61 Ready motions labelled
for the coach: kind, engine key, display name, coaching line), `cleared.json`, `slugs.json` (the stable keys of the
movements the engine does not count) and the motion library (read-only), and writes `.data/moves/library.json` and a
copy of each movement's Y Bot animation as `.data/moves/glb/<key>.glb` (28 files of 2.1-2.4 MB, 63.5 MB). It reads and
copies nothing that is not in `cleared.json`, and stops before writing anything if the policy file excludes a cleared
motion, leaves it for confirmation or has not reviewed it. A cleared motion of a kind the library leaves out
(`LEFT_OUT`: `sport`, `locomotion`, `gesture`, `idle`) is skipped, and the build's summary line counts those by kind; a
kind the tool does not know stops it. It is idempotent (an unchanged library is not rewritten, an identical GLB not
copied again, the GLB of a key no longer built removed), and a library file that stalls (cloud-synced assets may need to download again) is skipped and reported, with exit code 1. A repeated movement's `rhythm` comes from its reference skeleton
(`source/skeleton_motion.npz`) run through the engine's own features: the signal that swings most regularly and well
above MediaPipe's jitter, its prominence, and half its period as the fastest a cycle may go; for a signal with a
fallback (the feet's spread: `thighOut`), `rhythm.fallback: {signal, minPeriodS, prominence}` by the same rule from the
same frames' landmarks, if it swings clearly there (the side crunch's `{thighOut, 1.1, 19}`, the wall raise's
`{thighOut, 1.1, 23}`). A held pose's `held` and
`pose` (the right form its form check shows, [below](#form-check-what-went-wrong-and-the-right-form-in-3d)) come from
its reference skeleton too, seen as MediaPipe would see it from the front (`skeletonLandmarks`; its
`.data/moves/skel/<id>.json` dump if the npz cannot be read): `held: {start, end}`, the seconds of its GLB animation
where the pose is held right (`heldOf`): the stillest second in which every frame is in the pose (`IN_POSE`) with each
of its form checks a little inside its line (`poseRight`), grown on either side while the frames stay right and still
by the page's own measure (`MovementTracker` score at most `TUNING.STILL`); on the library's three references,
2.1-3.6 s of clips of 6-7 s. `pose: {image, side}`: the 33 image landmarks of the held part's middle frame (normalised
as the page's are) and its working side (`poseMetrics`: the triangle's front leg, the quad stretch's bent leg, the
figure-four's crossed leg), 'left' or 'right'. The build prints each hold's held part and side, and says when a
reference is never still by the page's measure (its held part is then its stillest second alone); a hold with no
second right is skipped (exit 1). A moving or rhythm movement with guard rails gets `refPoses` (`refPosesOf`): for
each check, `{image, side, t}`, the frame of its reference skeleton that best shows that check done right at the moment
the check judges it, as the page's "Like this" when that check finds a mistake. A peak or trough check's comes from the
rhythm's turns of its kind as the tracker finds them on the clip (played back from its end, forward and back again,
an end of the clip counting as a turn only where the clip dwells there: `referenceTurns`), on the turns the check
calls ok, the frame whose own value is furthest from the line (`okMargin`); a frame check's from the frames it judges
(after its phase settled) with both its value and its smoothed value ok, the stillest (`stillnessOf`, the page's own
measure). Either way the frame passes the check, its phase holds and the whole body is in the picture; the floor a
check may use is found over the clip played back to its start, then forward (`referenceFrames`). `side` is the check's
`side()` there ('left' / 'right', null for both or none), `t` the frame's time in seconds of the GLB's animation (the 3D
view plays around it). A one-sided check (one with a `side()`) that finds no frame, as a check of the side the
reference never moves (the side crunch's left sweeping knee: the reference sweeps its right leg only), is tried again
by the same rules on the reference mirrored (`mirrorSkeleton`): found there, its pose is `{image, side, t, mirrored:
true}`, the image and side the mirror's, `t` the same frame of the GLB (whose clip shows the other side). A check with
no frame either way has none, and the build says why; it prints each guarded movement's line ("form <key>: <check> <t>
s[ mirrored], side ..., <value>; ..."). Today's library has 21 poses, one of them mirrored. The dev server serves only
the library and the
animations (`GET /moves/library.json`, `GET /moves/glb/<key>.glb`, from `POSE_MOVES_DIR`, default `.data/moves`); the
folder's other files (the catalog, the study, the skeletons) are not served. Everything there is derived from licensed
footage and the user's private library: it stays in the git-ignored `.data/`, and the repo holds no file of it and no
list of its movements (only the keys of those with form checks, in `HOLD_FORMS` and `MOVE_FORMS`). Without the
library the card says so and the page works as before.

### A held pose's form: measured, never assumed

For the library's three holds, `web/js/holdform.js` measures form from the same landmarks as the tracker.
The coach must never call a hold's form good unless an event measured it.

`poseMetrics()` measures each frame from MediaPipe's world landmarks (3D, in metres) and its image landmarks (what is
in view): angles in degrees and lengths in leg lengths (hip to knee to ankle, the two legs' mean), so neither the
person's size nor the camera's distance matters. The working side is found in every frame (the leg the trunk leans
over, the arm with the higher wrist, the leg with the higher ankle), so either side counts the same. A check's value
is the median of its last second of frames (MediaPipe jitters by a few degrees, a landmark glitches for a frame or two).
The checks, most important first (`HOLD_FORMS`, where each line's measurements are given beside it, with the spoken
cue and the target):

| Pose | Check | The fault told | Fault when | Fixed from | Views | Needs in view |
|---|---|---|---|---|---|---|
| Triangle pose | stance width | feet too close together | ankles under 0.75 leg lengths apart | 0.8 | front, angled | both legs |
| | long legs | knee bent | a knee under 130° | 135° | front, angled | both legs |
| | top arm | top arm not straight up | shoulder to wrist over 25° from straight up | 22° | front, angled | the top arm |
| | trunk tilt | trunk too upright | hips to shoulders under 38° from upright | 42° | front, angled | the trunk |
| | arms in one line | arms not in one line | hand to hand over 40° off one line; held back while the top arm is off | 36° | front, angled | both arms |
| | open chest | chest turned to the floor | the chest over 40° toward the floor; judged only with the trunk tipped 35° or more | 35° | front, angled | the trunk |
| Quad stretch | heel to glute | heel far from the glute | the bent knee over 85° | 80° | any | the bent leg |
| | knees together | bent knee drifting away | the thighs over 40° apart | 35° | any | both legs |
| | standing tall | leaning over | the trunk over 30° from upright | 25° | any | the trunk |
| | standing leg | standing knee bent | the standing knee under 130° | 135° | any | the standing leg |
| Figure-four balance | ankle above the knee | ankle not on the knee | the crossed ankle over 0.3 leg lengths from the standing knee | 0.25 | front, angled | both legs |
| | sitting back | not sitting back | the standing hip folded under 25° | 30° | any | the standing leg, the trunk |
| | chest up | chest dropping | the trunk over 55° from upright | 50° | any | the trunk |

- **Where the lines come from.** The library's reference skeleton of each pose (its SMPL joints seen as MediaPipe
  landmarks, as `tools/build_moves.mjs` does) and MediaPipe on the library's own footage of it (front view for the
  triangle and the quad stretch, side view for the figure-four). Private recording regressions supplement these
  checks where available; live validation is limited. The knee lines catch only a clearly bent knee: MediaPipe
  reads straight legs at 150-175°.
- **Views** (as `web/js/engine.js` tells them: the shoulders' or hips' width on screen over the torso's length). The
  triangle lies in the body's frontal plane, so from the side nothing of it is judged; facing the camera, its stacked
  shoulders read "angled" as often as "front", so both count. From the side the figure-four's legs overlap (on its
  footage MediaPipe put the crossed ankle 0.4-0.5 leg lengths below the knee for half the hold), so its ankle is judged
  from the front or at an angle only. The quad stretch's checks are 3D angles and hold from any view.
- **Parts out of view.** A landmark counts as seen inside the frame at visibility 0.3 or more (`SEEN`: with the user's
  feet just below the picture's edge, MediaPipe's guess at the ankles was right, and the engine's 0.6 would have left
  the stance unmeasured). A check whose parts are out of view, or seen from a view that cannot judge it, is neither bad
  nor good: its timers wait, and it is listed as `unseen` (its parts out of the frame: stepping back shows them) or
  `wrongView` (seen side-on, the triangle's checks or the figure-four's ankle: stepping back changes nothing, turning
  to face the camera does), never as fine. A check that applies only in part of the pose (the chest: only with the
  trunk tipped 35° or more) is judged on the smoothed values, not the last frame (one glitch below the line dropped the
  chest from the checks), and a fault told and still there is never hidden by it. With every check of the pose out of
  view or side-on 4 s after the hold was told, the tracker says so (`form_unseen`, as for a moving movement:
  [below](#a-moving-movements-form-guard-rails-clear-mistakes-only)); one that comes while the page still holds the
  start back goes right after the start if it still holds then, and is dropped with a hold too short to tell.
- **When a correction is told** (`FORM_TUNING`). A fault once its value has been past the line for 1.5 s (a
  half-second glitch raises nothing). One at a time, the most important first: the next once the one told is fixed
  (2.5 s after the fix, time to praise it) or 8 s after the last one told; each at most once a hold, unless it was
  fixed and came back. A fault told with the hold's start counts as told when the page sends that start, 6.5 s into
  the hold (`MovementTracker.settle()`): timed from the tracker's own start, 3 s in, the second correction on the
  user's recording came 4.5 s after the first one was spoken, not 8 s. A fix: the value on the right side of the
  "fixed from" column (a little inside the line, so a value on the line does not flicker) for 1.5 s. A fault that says
  the same as another in other words waits for it (the arms' line while the top arm is off). The form is measured
  afresh for each hold, from where the stillness began, leaving out frames of clear movement, frames the stillness
  measure cannot judge (too little in view, which the hold takes as out of view) and frames out of the pose. A frame
  reaches the form only once the hold can no longer end before it (as `hold_progress` waits while movement under way
  or the pose left may end the hold where it began), so a fault or a fix is held back with it and dropped if the hold
  ends first, and the hold's summary is its form as of its end: on a private regression recording, before this, "trunk too
  upright" was told of frames after a pause's end and listed at that end as not fixed.
- **What the coach gets** (`web/js/moves.js`). `hold_start` carries the hold's `form` as measured by then (`open`: the
  fault told and not fixed, with what was `measured`, the `target`, the `cue`, its `part` and `side`; `checked`: the
  checks measured and fine; `pending`: those measured as a fault and not told yet, waiting their turn; `unseen`: those
  whose parts are out of the frame; `wrongView`: those only another view can judge), with at most one fault in it;
  after it, `hold_fault {fault, label, measured, target, cue, part, side}` and `hold_fix {fault, label}`;
  `hold_progress` carries `form` too, and `hold_end` the hold's summary (`checked`, and `faults: [{fault, label,
  fixed, told}]`). A movement without a form check, or frames given without their landmarks: `form: null`. The
  readings leave `part` and `side` out: they are for the page's form check (below). The page sends a hold's start
  6.5 s in with the form as it is then, so a fault measured while the start waited goes with it, once; a fix that
  waited is folded into it and not said, and a fault measured but not told yet is in its `pending`. At the hold's end
  the page sets each fault's `told` from what the coach heard (the faults open in a start or progress it sent, and
  each `hold_fault` it sent) and leaves out a fault never heard and fixed by then: before, a fault told and fixed while
  the start waited was praised as fixed at the end, though the coach had never said it. The readings and the engine's
  sentences: [docs/VOICE_COACH.md](docs/VOICE_COACH.md#named-movements-what-the-coach-is-told).
- **Never called good unless measured.** The coaches' instructions say the coach does not see the user, and never
  says their form is good or names something they do right unless an event measured it; asked about a held pose whose
  form is not measured, it says it can time it but cannot check its form, and gives its key points to check
  themselves. Each hold's reading says which: the fault to correct; a fault measured whose correction comes next on its
  own ("do not call the form good"); "measured and fine so far" only when every check was made and found nothing; the
  checks made and what could not be checked and why (out of the frame: they would step back; from this side: they
  would turn towards the camera), "never call its form good as a whole"; or "Its form is not measured: never say it
  looks right or wrong." The form counts as fine only with something checked and nothing open, pending, out of the
  frame or seen from the wrong view: the engine's own sentence says "Good, hold it there." only then ("Hold it there."
  otherwise), and so does the Now card's "Form checked". Before, a fault waiting its turn was in no list, and a hold
  was called good a second or two before that fault was told.
- **On the Now card**, under the timer, once the coach was told the hold's start (6.5 s in): the fault the user was
  told of, in large type ("Form: feet too close together"; its measurement and aim on hover), "Form: checking..." while
  a fault measured waits its turn, "Form checked" when the form is fine, or what could not be checked and why: "Form
  partly checked" or "Form not checked", with "step back so I can see all of you" (parts out of the frame) or "turn to
  face the camera" (checks the view cannot judge); the checks on hover. Nothing before then, between holds or for a
  movement without a form check: shown from the hold's timer, 1.5 s into the stillness, the card showed a fault 5 s
  before the voice said it and one in a pause that was never said, and "Form checked" flashed in pauses.
- **Shown, not only said.** Live (2026-10-24), the coach corrected the user's pose and the page showed nothing of it:
  the exercises had their faulty rep replayed next to the right form, the holds had none. Now the fault the coach is
  told of shows in the side panel's form check, the user's last 2 s next to the movement's reference pose, and in 3D
  on request ([below](#form-check-what-went-wrong-and-the-right-form-in-3d)). What to show in red comes with each
  fault (`part` in `HOLD_FORMS`; in `hold_fault` and each entry of `open`): `feet` for the stance (the ankles' bones
  and the gap between them, dashed, as the measure), `knee` for a bent knee and the quad stretch's heel and knees,
  `arm` for the top arm, `arms` for their line, `torso` for the trunk's tilt (too upright, leaning over, the chest
  dropping), `chest` for its turn to the floor, `hips` for sitting back, `leg` for the figure-four's crossed ankle.
  For a part on one side of the body, `side` is the user's own side of it on the frame the fault is told on ('left' /
  'right', as MediaPipe names the landmarks: the top arm, the more bent knee, the bent or crossed leg, the standing
  knee); null for the feet, the trunk, both arms and the hips. One frame is enough: held, the two sides lie far apart
  next to MediaPipe's noise (the wrists a metre or more apart in height in a triangle; the lifted ankle 0.44-0.87 leg
  lengths above the other in the reference skeletons). `web/js/formcheck.js` `bonesFor` and `web/js/retarget.js`
  `faultBones` colour each name, one limb when a side is named, on the replay and on the Y Bot.
- **On a recording.** `node tools/hold_eval.mjs <recording.json> <movement key> [--from s] [--to s] [--state s]`
  runs a saved recording through the tracker as the page does and prints each event at its time, the form each hold
  was told with, each hold's summary and, with `--state`, the form every so many seconds; it writes nothing.
  `tests/holdform.test.mjs` runs the user's triangle recordings the same way when they are on this machine: the stance
  and the top arm are told in each hold of 20 s or more, and no knee, chest or arms' line fault.

### A moving movement's form: guard rails, clear mistakes only

A held pose can be judged on any frame of it; a movement done in motion passes through every shape on its way, and the
library has one performer's reference of it. So for the movements done in motion `web/js/moveform.js` checks a few
guard rails only: each one a clear, measurable mistake (never a matter of style: a dance is free), its line set from
the movement's reference skeleton with a margin, raised only once it lasts or comes back cycle after cycle, one
correction at a time, and its fix noticed. It does for a body that moves what `web/js/holdform.js` does for a held
pose, with the same semantics (`state()`, `summary()`, `settle()`), and the tracker (`web/js/moves.js`) runs it on the
frames of a named movement that has an entry in `MOVE_FORMS`, given their landmarks.

- **The measures** (`bodyMetrics()`), as `poseMetrics` takes them: angles in degrees of MediaPipe's world landmarks
  (3D), lengths in leg or torso lengths, per side as MediaPipe names the landmarks, signed toward the person's left or
  forward. The knees, elbows and hips; each upper arm from the torso and from straight down, and where it points seen
  from above (`armPlane`); each thigh the same way; the wrists' height over the shoulders and over the head; each ankle
  over the other; the hips' and shoulders' tilt; the trunk's tilt, its lean forward and to the side, its twist; the
  stance, and the knees apart over the ankles apart; the view, and what is seen (every landmark of a part in the frame
  at visibility 0.3 or more). `MoveForm` adds the floor (below).
- **A check** (the four group files in `web/js/moveforms/`, `arms.js`, `legs.js`, `transitions.js` and `flow.js`,
  merged into `MOVE_FORMS`; the shape is in `moveform.js`'s header, and `checkProblems()` checks it): an id, a name
  ("elbows at your sides": what `checked` lists), the fault's label, the `part` to show in red and `side(m, lm)` for a
  part on one side, the parts it `needs` in view and the `views` it is judged from, a `phase` (the frames it applies
  to), its `value`, `bad` and `ok` (a little inside `bad`, so a value on the line does not flicker), the measurement in
  words, the target and the spoken cue, an `order`, and `after` (checks that hold it back while they are faulted: one
  fault is not told twice in other words). It is judged `at`:
  - `'frame'`: on every frame, its value the median of its last 1 s (`SMOOTH_MS`); a fault once bad 1.5 s in a row
    (`FAULT_MS`) of the frames judged, fixed once ok 1.5 s (`FIX_MS`). With `still: true` it is judged on frames at
    rest too (no warm-up, through pauses) once the person has moved at all since the movement was named, its `phase`
    keeping a person at rest out; when its phase starts to hold, its samples start afresh and its first 0.3 s
    (`SETTLE_MS`) are not judged (a reach on its way up). The kneels and the fold's reach are `still` checks: they are
    held, which the stillness measure takes for not moving, and judged only on frames moving, neither kneel's
    reference was judged at all at its own pace. A check may set its own `smoothMs` and `faultMs` (the Bharatanatyam's
    hands: 0.4 s and 0.8 s, for a gesture held about a second, which a second of smoothing and 1.5 s of bad frames
    never told);
  - `'peak'` or `'trough'`: once per cycle, on each turn of the rhythm signal the tracker's `CycleCounter` confirms
    (handed over with that frame), at the signal's highest or lowest point (which end of the movement that is depends
    on the signal). `take: 'at'` (the default): the median of its frames within 0.15 s of the extreme (`PEAK_MS` / 2);
    `'max'` or `'min'`: the largest or smallest value (each the median of a frame and its neighbours) over the half
    cycle up to the extreme, or with `over: 'cycle'` over the whole cycle since the turn of the same kind before (a kick
    or a knee drive between the signal's turns). A fault on 2 of the last 3 cycles judged, fixed on the last 2 ok, as
    the engine's cues (`CYCLES_BAD`, `CYCLES_OF`, `CYCLES_OK`). Only the verdicts of the last max(12 s, 3 x the
    rhythm's period) count (`VERDICT_MIN_MS`, `VERDICT_PERIODS`; the period is 2 x `minPeriodS`, at most 3 s as the
    build caps it, so the 12 s is what holds today): on private regression recordings, with a movement named, 2 bad of the last
    3 joined cycles 14-70 s apart. Older verdicts go, so do those from before a pause, and a fault not told yet goes
    with them.
- **When.** Never while the person is still or paused (a `still` check aside, above), nor in the warm-up: a run of
  movement starts on the first frame moving after the movement was named or after a pause, and its first 3 s
  (`WARM_MS`: getting into it, finding the rhythm) are not judged. A pause is not moving (or nobody) for min(12 s,
  max(5 s, the period the turns show)) (`pauseMs()`: `PAUSE_MS`, `PAUSE_MAX_MS`): for a rhythm still turning, that
  period is twice the median time between its last five turns, at most 4 times the rhythm's own period
  (`PAUSE_BOUND_PERIODS`); for a moving movement, or before two turns, 5 s. So a slow, controlled rep's hold at its
  far end goes on the set (with 5 s alone, the shoulder rotation's reference played at 0.8 of its pace, and the
  Y-to-W's at 0.6, read still past it at every far end, each turn fell in a new run's warm-up and nothing was judged),
  while standing between sets is a pause (two sets of 2-3 jumping jacks 9-10 s apart on private regression recordings, named
  as the step touch, showed a period of 9-10 s, and the 5-7 s standing between them was no pause until the bound).
  A new run starts the checks afresh, the `still` ones aside: a fault told stays open until fixed, one not told yet
  goes. Moving is the tracker's measure: for a moving movement, the frames it counts as moving; for a rhythm, those, or
  its signal swinging 3 jitter units (`SWING_UNITS`) within about the movement's own period (1.5 s at least), or a turn
  within that long (the stillness measure alone misses a forearm turning out at the side and a sideways bend: on their
  references the shoulder rotation and the side crunch read 0 s moving). Never on a frame with its parts out of view
  (`needs`), from a view it cannot be judged from (`views`), or where its `phase` does not hold.
- **One correction at a time**, as a hold's: the most important fault not told yet (`order`), 8 s after the last one
  told (`NEXT_MS`) or 2.5 s after the last fix (`AFTER_FIX_MS`, time to praise it), each at most once unless it was
  fixed and came back. A frame check is told on a frame judged bad, a cycle check on a cycle judged bad, and `measured`
  and `side` are that frame's or that cycle's extreme's (`side(m, lm)` gets the frame's landmarks, as `value` does).
  A `form_fault` carries `seen: {from, to}`, the frame times its verdict rests on (a frame check's last 1.5 s of bad
  frames; a cycle check's 1.5 s, `SEEN_MS`, around the frame its value came from, no later than the event): a cycle
  check is told when the turn is confirmed, which can be seconds after what it measured (the shoulder rotation's turn
  3.3 s after its peak at its own pace), so the moments just before the event may show nothing of it.
- **The floor** (`feetLift` and `airborne`, for the step touch's jump), at each distance from the camera
  (`withFloor()`): over the last 4 s of frames with both legs seen, taken within 25% of their median size
  (`FLOOR_NEAR`), the lower ankle's height in the picture is fitted against the body's steady size on screen
  (`steadyScaleImg`, the trunk from the ears or the shins) by least squares (nearer the camera the feet sit lower in
  the picture), the slope kept within 0-4 (`FLOOR_SLOPE_MAX`; about 3 for a camera 1.5 m up) and 0 when the sizes
  spread less than 2% (`FLOOR_SPREAD`: no change of distance to fit); the floor is that line at this frame's size plus
  the 80th percentile of the frames off it (low in the picture: a person hopping half the time still stands on it).
  The lift is in body lengths (the engine's body scale, its 90th percentile over those frames); in the air from 0.15
  body lengths, as the engine's jump. The engine's body scale goes by the shoulders' width too, which raising the arms
  narrows (the step touch's reference: 18% smaller with both arms up); by the steady size the floor is known on 97% of
  the reference's frames with both arms up (51% by the engine's scale), and on 97% of MediaPipe's on its footage
  (84%). With one height for all distances, the step touch's reference drifting 0.2 m nearer and further before a
  camera 1.4-1.5 m up read "both feet off the floor" every few swings; with the floor at each distance, nothing is told
  of it drifting so before a camera 1 or 1.5 m up.
- **What counts as the movement.** The rhythm count takes any swing of its signal, whatever the person is doing, so
  each check judges only in the movement's own shape (its `phase`): standing, for the arm movements, with the arms
  where the movement puts them (the Y-to-W's Y judged only once the arms come down into a W after it; the step
  touch's arms only with the feet stepped apart, its jump only with the ankles level in depth); a knee drive, a kick,
  a leg swept out, a squat, kneeling, standing tall with the arms raised. Without it, with private regression recordings named
  as these movements, cycles of walking up to the camera were judged (MediaPipe there read the trunk upside down) and
  faults came from them; and judged at the Y itself, any two arms raised were a Y (jumping jacks were told "reach your
  arms all the way up into a wide Y").
- **The form not checked at all, said out loud** (`form_unseen`: `UNSEEN_TUNING`, `UnseenWatch` and
  `standingInPicture` in `web/js/moveform.js`; a hold's in `web/js/moves.js`). With a check's parts out of the
  picture, or the person side-on, its form is not checked, and the Now card's small "step back" line is easy to miss:
  the user did a 46 s set of the standing side crunch with the feet below the picture, its one check then unseen
  throughout, and nothing was said. So the tracker says it once it lasts, two ways:
  - **'frame'** (a part out of the picture: stepping back shows it): the person standing in the picture (the
    shoulders, hips and knees in it and seen, the straighter hip open 140° or more: `STAND_HIP`), a check out of view
    now, and its parts out of the picture, for 5 s of such frames (`FRAME_WAIT_MS`), whether or not the person counts
    as moving, and never sooner than 5 s after the movement was named. It names only the checks the frame blocks
    (out of view, and none judged in those 5 s: a check that sees the lifted leg at the top of each sweep is being
    checked), so a form checked in part still gets the prompt for the rest. If the knees and hips then leave the
    frame, standing seen within the last 10 s also permits the request while the shoulders remain visible, the trunk
    is within 30° of upright and the hips are near the lower edge (image y 0.85–1.25). Seeing seated hips clears that
    memory; starting cropped or returning after it expires proves nothing. This continuity only enables framing
    guidance, never a count or form verdict on the missing legs. Built so because on the user's second side crunch,
    the feet cut off, "moving" could not be judged: the stillness measure read the sweeps still on 70-100% of frames
    (its leg channels need the legs in view), the rhythm (the feet's spread) never turned, and a check saw the lifted
    leg at the top of each sweep, so not every check was unseen, and the prompt never came.
  - **'view'** (side-on: turning to the camera does): every check seen from a view that cannot judge it, while the
    person moves, for 6 s of the movement past its warm-up (`WAIT_MS`), or 3 turns of its rhythm meanwhile
    (`WAIT_TURNS`).
  - **A hold's**: every check out of view or side-on, 4 s after the hold was told (`HOLD_WAIT_MS`).

  Then at most every 30 s while it lasts (`EVERY_MS`), or sooner once everything has been seen for 1 s (`SEEN_MS`)
  and lost again. It is `{missing, parts, why, cue}`: the checks' names; the body parts out of the picture, as the
  user is asked to show them (`outOfView`: feet, legs, hands, arms, hips, shoulders, head; the legs cover the feet,
  the arms the hands); `why`, 'frame' or 'view'; and the words to say ("Step back so I can see your feet: I can't
  check your form.", "Turn to face the camera so I can check your form."). It is not a fault: the coach asks the user
  to step back or turn and calls the form neither right nor wrong, the engine speaks its cue, the Now card shows the
  cue in large type while it holds, and nothing goes to the side panel's form check or the Mistakes list.

The checks, most important first within each movement (`MOVE_FORMS`; the numbers behind each line are beside it in its
group file):

| Movement | Check | The fault told | Judged | Fault when | Fixed from | The reference (MediaPipe on its footage) | Views |
|---|---|---|---|---|---|---|---|
| Shoulder external rotation | elbows at your sides | elbows drifting off the sides | each peak (the hands at their widest), standing with both elbows bent and both upper arms below 75° | the further upper arm over 45° from the torso | 40° | 29° (31°) | front |
| | forearms turning out | forearm not turning out | each peak; held back while an elbow drifts | the forearm turning out less, under 10° out past straight ahead | 15° | 41° (40°) | front |
| Y-to-W raise | arms up in a full Y | arms short of the Y | at the W after each Y (the trough), the most the arms reached from the Y down, standing; only when the frames at the bottom are a W (both upper arms under 60°, the straighter elbow under 125°, both forearms turned out 15° or more: a Y lowered with straight elbows is not judged) | the lower arm over 60° and under 120° from the torso (at most 60°: the arms never rose together, no Y to judge) | 125° | 140° (141-143°) | front, angled |
| | arms out to the sides | arms drifting forward in the Y | at the W after each Y, as above: the most-forward reading over the frames with both arms over 100° | the more forward upper arm over 70° forward of the shoulders' line, seen from above | 60° | 28° (30-49°) | front, angled |
| Step touch with overhead arm swings | a foot on the floor | both feet leaving the floor | the swing up to each peak (both hands up), its most, with both arms over 45° and the ankles within 0.1 m of each other in depth | the lower ankle over 0.2 body lengths above the floor | 0.15 | 0.02-0.06 (0.04-0.06) | any |
| | arms reaching overhead | arms not reaching overhead | the swing up to each peak, its most, with the feet stepped apart (over 0.45 leg lengths) | the lower arm under 110° from the torso | 115° | 132-148° (139-151°) | front, angled |
| Side kick to twisting knee raise | knee drive to hip height | knee drive below hip height | the half cycle up to each knee drive (the trough), its most | the driving thigh under 55° from straight down (hip height is 90°) | 62° | 103-108° (97-104°) | any |
| | kick to hip height | kick too low | the whole cycle between two knee drives, its most, on a kick 40° up or more | the kicking thigh under 50° | 56° | 82-91° (68-73°) | front, angled |
| | trunk upright as you kick | leaning far over the standing leg | every frame of a kick 45° up or more | the trunk over 30° toward the standing leg | 24° | -9 to 5° (-3 to 7°) | front, angled |
| Standing side crunch | standing leg long | standing knee bent a lot | each peak (the leg out), both legs in view | the standing knee under 115° | 125° | 149-156° (165-167°) | any |
| | left sweeping leg straight, right sweeping leg straight (`swept_knee_left`, `swept_knee_right`: one check per side) | sweeping leg bent | the sweep's upper part, from the turn before up to each peak, its most bent frame (each frame the median of it and its neighbours), with only that leg in view: lifted 50° out or more, not straight ahead (seen from above, 70° or less from the hips' line), its foot off the floor, trunk within 50° of upright, and a hip open at least 140° or the support knee above 125°; no lower limit on the sweeping knee | the swept knee under 130° | 138° | 147-155° (148-151°) | any |
| | leg lifted toward hip height (`sweep_low`) | straight sweep too low | maximum over the rise to the thigh peak; both legs and trunk visible, swept knee ≥145°, support knee ≥140°, thigh ≥35° up and within 40° of sideways, trunk within 50° of upright | maximum under 50° from down | 55° | 72–83° (60–88°) | front, angled |
| | leg lift no higher than hip height (`sweep_high`) | straight sweep too high | maximum over the rise; same visibility, swept knee ≥145°, support knee ≥125°, thigh ≥35° up and within 60° of sideways, trunk within 50° of upright | maximum over 95° | 90° | 72–83° (60–88°) | front, angled |
| Wall-supported side leg raise | trunk upright | trunk leaning far sideways | each peak (the leg up) | the trunk over 40° to either side | 34° | 7-23° (21-27°) | front, angled (from behind too) |
| | standing leg long | standing knee bent a lot | each peak | the standing knee under 115° | 125° | 131-160° (158-168°) | any |
| Boxing cardio combo | knees over the feet in the squats | knees caving in on the squats | each squat's bottom (the trough), both knees bent and both feet down | the knees under 0.7 of the feet's width apart on screen | 0.76 | 0.9-1.1 (1.0) | front |
| | knee drive to hip height | knee drive below hip height | the whole cycle between two squats, its most | the driving thigh under 55° | 62° | 86-110° (75-78°) | any |
| Kneel and stand, half-kneel to stand | torso tall while kneeling | torso folding forward while kneeling | every frame kneeling on one knee, moving or not (`still`) | the trunk over 55° forward | 50° | 0-28° (25-39°: a camera pitched down adds its pitch) | any |
| | front knee over the foot | front knee caving in | every frame kneeling or pushing up off the knee, squarely facing the camera (`still`) | the front knee over 0.15 leg lengths inside its ankle | 0.10 | 0.13 to 0.02 out (0.23 out to 0.06 in) | front |
| Bharatanatyam arm gestures | left hand in at the chest, right hand in at the chest (`hand_raised_left`, `hand_raised_right`: one check per hand) | hand raised by the face, not brought in to the chest | every frame with the other forearm across the chest (both elbows bent under 140°, both upper arms over 35° from the side, the other forearm within 30° of level) and this hand up at the upper chest or higher (0.2 trunk heights under its shoulder or above, in the picture), standing upright (trunk within 30°), moving or not (`still`); its own timing, 0.4 s smoothing and 0.8 s of bad frames | the forearm over 45° above level in the picture | 30° | 5-20° (16° at most) | front, angled |
| Forward fold roll-up to overhead reach | arms overhead at the top | arms short of overhead at the top | every frame at the top (the trunk within 20° of upright, the arms in view past level, the elbows straighter than 110°), moving or not (`still`) | the lower arm in view under 110° from straight down | 120° | 141-147° (146-149°) | any |

- **The side crunch's knees.** The sweeping knee is two checks, one per side, so each needs only its own leg in view
  (its `needs`): a camera close in loses the standing foot first (the user's live set had both ankles at the
  picture's bottom edge throughout, the swept one in the frame at the top of each sweep). The standing knee needs
  both legs in view: its angle is the shin's direction, and with the foot below the picture's edge MediaPipe guesses
  where the shin goes; nothing showed that guess right for a bent knee, and a guess that reads it straight would call
  the leg fine unseen. Out of view, it is unseen, and after 5 s standing so `form_unseen` asks the user to step back
  (naming it, and a sweeping knee not judged meanwhile). A strongly bent sweeping knee is now eligible: the old
  100° minimum excluded precisely that fault. The support and direction gates keep forward knee raises and bent-leg
  skips out. Low and high straight sweeps have separate checks, measured over the whole rise, with the same two-bad-
  of-three rule. A new fault on the cycle that fixes another can be told immediately if the normal 8 s correction
  gap has passed; it is not lost behind the fix's cooldown.
- **The Bharatanatyam's hands.** The user's mistake (2026-10-25): the last gesture of each repetition a hand held up
  beside the head, "like a salute", where the reference brings it in to the chest. A hand's height and a forearm's
  direction are read in the picture (MediaPipe's world depth flattened the raised hand to half of it). The salutes
  read 58-89° and lasted 1.2-2.5 s (0.97-2.3 s of bad frames each, judged); the user's hands held at the chest 27° at
  most, an arm swung up on its way in 0.57 s of bad frames at most. One check per hand, judged only once that hand is up at the upper chest: the chest gestures lower down are
  never judged, so they never call a raised hand fixed; the hand brought in level at the upper chest does. The other
  forearm must be across the chest (a boxing guard or a goblet hold, both forearms up, is not this dance), the trunk
  upright (a squat MediaPipe read leaning back 31-45° came close otherwise). The reference reads 0 s moving at its own
  pace and half of it (one arm at a time): a `still` check waits for a first movement, which a user walking to their
  place gives.
- **Left out** (the measurements are in the group files). The Bharatanatyam's stance: its half-sit reads as standing
  up (its more bent knee 146-165°, MediaPipe on the user standing still 160°), its feet together are the stance itself,
  and the toes' turn-out lies in depth from the front. The freestyle and hip-hop dances: knees caving in means
  something only with both knees bent and both feet down apart, under 4% of either reference (where the hip-hop one
  crosses its knees on purpose), and neither hops. Those two have no check:
  `form: null`, and the coach does not call their form right or wrong. Dropped candidates: the Y-to-W's W (arms lowered
  straight are arms at rest, and with private regression recordings named as it a W check told faults on rests and on other
  arm swings); the leg barely sweeping out in the wall raise, and side-crunch lifts below 35° (too close to steps and
  jumping jacks to judge conservatively); the side
  crunch's trunk leaning away from the swept leg instead of crunching toward it (from upright, the reference leans away
  18-20° at the top of each sweep, MediaPipe on its footage 13-14°, the user's live set 6-16°: the hips hike with the
  leg and the trunk goes with them, so the user leaned away less than the reference; against the pelvis, the reference
  bends 11-13° toward the leg, the footage 17-20°, the user -2 to 11°, half their sweeps under 5°, while MediaPipe's
  hip line reads -7 to 3° off level on the user standing still, so a line under the reference's 11° sits within that
  noise of the user's sweeps either side); the wall raise's pelvis hiking (the
  reference tilts its pelvis 24-26° at every top); the combo's squat depth (a squat that bends less is no cycle, and
  MediaPipe from the front reads its 90° squats at 117-133°); the kneels' front knee past the toes or front foot too
  close (the references kneel that way themselves), and standing fully tall at the top (a frame cannot tell the top of
  the rise from the rise); the fold's knees locked (no angle shows a knee pushed back past straight) and its trunk
  upright at the top (a swan dive down from the reach leans it, the hands up).
- **Tested movement by movement** (`tests/moveforms-{arms,legs,transitions,flow}.test.mjs`, each through the movement
  tracker with its landmarks as the page runs it; the private data skipped when not on this machine). The reference
  skeleton at its own pace and others (twice it; half it too for the legs and the fold, 1.5 times for the fold),
  mirrored and with MediaPipe-sized jitter, raises nothing, and every check is judged. Each fault put into it on
  purpose is caught by its own check alone, on the right side (a milder one by none), and its fix is then noticed.
  MediaPipe on the library's own footage of each raises nothing. The shoulder rotation and the Y-to-W are judged down
  to half their pace (played at 0.5 and 0.6 of it), and a rest after them is still a pause. The arm movements'
  references through a pinhole camera (a reviewer's sweep: turned up to 45° either way, the camera 0.5-1.5 m up and
  2.8 m away, pitched to the hips or level, the step touch at every one of those and the two done standing still at a
  few; the step touch drifting 0.2 m nearer and further too) tell nothing, while a 12 cm hop in the step touch is
  still caught facing the camera, high or low. Before the ankles' depth was checked, the step
  touch turned 20-45° to such a camera read "both feet off the floor" every few swings: the floor is the lower
  ankle's height in the picture, and with the feet apart in depth the lower one is the nearer. Private recording checks and their annotations live in `.data/` and are loaded at runtime by
  `tests/side-crunch-recordings.test.mjs`. The public tree contains no personal workout inventory. Live validation
  is limited: reference and footage checks do not establish accuracy for every person or camera angle.
  The approximate counter can count setup motions and merge attempts faster than its minimum period; it does not
  recognise the exercise. Missing legs never supply form or counts.
- **What the coach gets** (`web/js/moves.js`): `form_fault {fault, label, measured, target, cue, part, side, seen}`
  and `form_fix {fault, label}`, as a hold's (`seen` is for the page's replay: the readings leave it out, with `part`
  and `side`), sent as they come (there is no start to hold back: the warm-up and the
  persistence keep the first seconds and the glitches out); `moving_progress` and `rhythm_progress` carry `form`
  (`state()`: `open`, the faults told and not fixed, the latest first, with what was measured; `checked`, `pending`,
  `unseen` and `wrongView`, as a hold's), and so does `current()`; the tracker's `summary()` has the form's
  `summary()` once it was measured. `form: null` for a movement without a check, or frames without landmarks. A check
  waiting for its first cycle, or in the warm-up, is in none of the lists. And `form_unseen {missing, parts, why,
  cue}`, as it comes (above). The readings:
  [docs/VOICE_COACH.md](docs/VOICE_COACH.md#named-movements-what-the-coach-is-told).
- **Never called good as a whole.** The checks look for a few clear mistakes only, so a moving movement's form is never
  called fine: its progress reading names the checks made and says none found so far, "so never call its form good as
  a whole"; an open fault gives its correction, a fault waiting its turn "do not call the form good", and `SYSTEM` says
  the same. The engine's sentences are the fault's cue and, for a fix, "That's it. Keep it up." (the user is still
  moving: not "keep it there").
- **On the Now card**, under "About 12" or "Moving 1:42", the same line as a hold's (`formLine`): the fault told
  ("Form: elbows drifting off the sides"), "Form: checking...", "Form checked" only when the form is fine, or "Form
  partly checked" / "Form not checked" with "step back so I can see all of you" or "turn to face the camera" (the
  shoulder rotation's checks need the camera in front); nothing in the warm-up or a pause, when nothing is judged. The
  form is judged frame by frame, and on a replay of a private regression recording the line flipped between "step back...",
  "turn to face the camera" and nothing several times a second, so it is steadied (`steadyLine` in `web/js/app.js`): a
  line shows once it has been the same for 1 s (`LINE_STEADY_MS`, nothing shown too), "Form checked" once the form has
  been fully clear 1.5 s (`LINE_CHECKED_MS`), and a fault told at once, until its `form_fix` (or until the line after
  it is due). A `form_unseen`'s cue takes the line's place, as large as a fault (`.alert`), at once and while it holds
  (every check it named still out of view or side-on: `unseenLine`, `unseenLasts`), and goes 1 s after it no longer
  does; a hold's the same way. "See it again" while the fault told is still there.
- **Shown, not only said**: each fault told goes to the side panel's form check, next to the reference pose of its
  check ([below](#form-check-what-went-wrong-and-the-right-form-in-3d)), and stays in the Mistakes list (a
  `form_unseen` does neither).

### A one-two technique check: no count

`one_two_jab` uses the `technique` kind and track (`web/js/technique.js`), not a rhythm counter. Its private catalog
entry has `repsMatter: false`, no rhythm override, and a coach line asking for a jab, cross and return to guard.
Rebuild with `node tools/build_moves.mjs` after changing that catalog. The Now card says **Technique**, the workout
summary says **technique reviewed**, and neither the tracker nor any coach gives punch or attempt totals.
`boxing_cardio_combo` still uses its existing rhythm and guard rails.

Each attempt starts from visible guard, follows a visible extension and return, then checks the other hand. Two
extensions of the same hand are an incomplete sequence. A lone jab expires after 2.5 seconds waiting for the cross.
There is no multi-cycle warm-up: a clear upward first punch can be corrected immediately. Each attempt has its own
faults, so an earlier mistake cannot mark the next attempt wrong. A tracking gap over 250 ms discards the pending
sequence instead of joining movements across missing frames.

| Check | Measurement and gate | Correction threshold |
|---|---|---|
| Upward punch | Median shoulder-to-wrist angle in image space near maximum reach, with torso and both arms visible; upright trunk, hips narrower than 0.48 torso lengths and shoulders narrower than 0.68 | More than 20° upward |
| Other hand at guard | Median guard wrist height during that extension | More than 0.5 torso lengths below its shoulder |
| Return to guard | Punching hand comes back near the face, elbow bent, wrist no lower than 0.45 torso lengths below shoulder | Still away 1.8 seconds after peak reach |

The start requires both hands near guard and no lower than 0.25 torso lengths below their shoulders, plus reach and
elbow extension increasing together. This keeps low arm circles out of the punch check. A punch held out is judged
after 0.5 seconds without a new peak, so failing to retract cannot evade the return check. A projected extension
needs at least 0.38 torso lengths of horizontal reach. A frontal extension that cannot show direction asks for a side
view; a brief world-depth glitch does not. With missing landmarks there is no positive verdict.

The approved reference skeleton is projected from the side for the comparison poses. The actual source footage was
also run through MediaPipe: 59 of 60 frames tracked. Its extended punches slope roughly −10° to +6°, while the
reference skeleton's slope is −4° to +4°. Both produce a complete alternating-hand sequence with no correction.
The skeleton also passes at half, normal and double pace, mirrored and with jitter. Tests replay the annotated
private recording and other local exercise recordings at runtime; neither recordings nor their names are tracked.
The file named as a human preview in this local asset was actually a skeleton render, so the footage check used the
approved two-second source-video segment, not that render or its longer parent motion.

**Measured scope:** direction, the other hand's guard and returning to guard. Full jab extension and hip/shoulder
rotation are not assessed: the recovered reference jab is shortened, and the live world-space yaw is unstable.
Alternating hands verifies the sequence, not which hand is lead/rear in a boxing stance. A passing result therefore
says only that the measured checks passed. This is a selected-movement assessor, not exercise recognition.

`form_fault` carries the measured interval and side through the existing coach, **You / Like this**, **See it in 3D**
and saved **Mistakes** paths. `build_moves.mjs` supplies `refPoses` for `punch_up`, `guard_drop` and `guard_return`.
`technique_result` carries `sequence`, `verdict`, `checked`, `unmeasured`, `faults` and `seen`; an empty cue updates the
coach's context without repeating an already spoken correction. The live agent prompt uses the same no-count and
measured-scope rules; its id stays private.

### Why the user names it: the recognition study

Before this feature, recognising a library movement automatically was built and measured (a private prototype in
`.data/dev/moves/`, its reports in `.data/moves/`, re-run in a review: `.data/moves/review/`). Every 0.5 s the last 3-4 s
of MediaPipe's world landmarks became view-independent joint features (joint angles, limb directions in the torso's
frame, torso pitch, side bend and twist against gravity, hand and foot heights, stance), matched by subsequence
dynamic time warping against **one reference per movement**: the 3D skeleton of that movement's Ready clip (and its
mirror image). Each feature was weighted by how much it moves in the reference and how reliably MediaPipe measures it;
a calibration from MediaPipe to the skeletons and the thresholds were fitted on a training split only; below a reject
threshold the answer was "unknown". Four versions, the share of 0.5 s decisions that named the right movement:

| Footage | Clips | Decisions | Named exactly |
|---|---|---|---|
| The reference's own source video (its held-out part) | 20 | 132 | 67-72% (14 of 20 clips most of the time) |
| Y Bot renders of the same motions | 12 | 84 | 71-87% |
| **Other people doing a movement of the library, on camera** (other clips of it in the library, and another library's) | 22 | 180 | **7.2% in every version** (13 decisions; 3 of 22 clips most of the time) |
| Those other clips' own 3D skeletons (no camera in the way) | 14 | 75 | 5-43% |

- On other people's footage the right kind of movement (a hold, a dance, a gym move, ...) came out on 15-44% of the
  decisions, and a wrong movement was named on 9-14%: more often than the right one, in every version. On 48 clips of
  movements with no reference, which should get "unknown", a movement was named on 8-29%.
- Asked only "is this a gym exercise?", it said yes on 15-61% of the decisions on other people's gym clips, and on 1-28%
  on their other clips.
- References taken from the user's own camera sets recognised 11-12 of 12 rep segments in the user's later sets, but
  named a movement on 16-20% of the user's other moments (standing, moving about, close to the camera).
- The sets are small (the own-footage figure's 95% interval is 44-87%), but the gap is not: no version came near.

Why it does not carry over: each movement has one reference, one performer in one setup filmed once, so the matcher
learns that clip, not the movement. Another person's tempo, range, stance and camera angle, and MediaPipe's guess at
depth from one camera, take a clip further from its reference than the references are from each other. A coach that
names a movement nobody named, more often than the right one, is worse than none. So nothing in the app recognises a
library movement: the user names it, and the page measures what one camera measures reliably (still or not, moving or
not, the period of one joint signal). The 13 exercises keep their own recognition (auto mode, above), a different
method (each exercise's rules and rep detector), unchanged.

### Which movements: the clip policy

The motion library has 61 Ready motions labelled for the coach. The user's clip policy
(`.data/moves/clip-policy.json (or POSE_CLIP_POLICY)`, its `exclude` and `confirm` lists) holds 19 of them, which
are never loaded:
- 8 whose source footage is under the Mixkit/Envato licence, which forbids AI/ML use;
- 1 whose performer may be a minor;
- 10 waiting for the owner's confirmation: 9 from research datasets whose participants' consent scope is not recorded
  (figshare, Zenodo, Mendeley, MM-Fit, a PLOS ONE supplement), and 1 of a person with prosthetic legs, whose gait a
  coach would grade (a question under the stock site's "bad or offensive light" clause).

The other 42 are in `.data/moves/cleared.json`. The library offers 29 of them (one, the shadow-boxing one-two, cut on the user's request from the first 2 s of a shadow-boxing clip that was questionable as a whole: its own motion in the library, a jab and a cross, counted by one-twos (below)): the user chose to leave out the 13 sport
moves, walking and jogging, gestures and idle poses (kinds `sport` 2, `locomotion` 2, `gesture` 4, `idle` 5), which the
build skips by kind (the policy still clears them). Five of the 19 the policy holds are gym exercises the engine counts,
so the library's gym exercises cover 10 of the 13 (none for the lunge, the lateral raise or the biceps curl, which are
still counted when named as exercises).

## Form check: what went wrong, and the right form in 3D

On the first rep with a fault, even a slight one (the spoken cue waits for the fault on 2 of 3 reps), and on a rep that
was not deep enough to count, the side panel's form check (never over the video) shows side by side:

- **Your rep**: that rep replayed from the last seconds of landmarks as a stick figure, looped at 3/4 speed, with the
  faulty body part in red (the fault's `part`: hips, arms, knees, ...; one arm for per-arm exercises);
- **Like this**: one clean rep of the exercise by a 3D figure (Y Bot), looped at 3/4 speed, with the footage's credit;
- the correction, and what was measured against the goal in plain words ("Your arms reached 117°. Bring them all the
  way overhead (140° or more)."; the thresholds are the engine's checks, `web/js/formcheck.js`).

A demo is never shown for a fault its own motion has (`avoidFor`: e.g. the lunge footage leans forward); the panel then
says there is no 3D demo for this one and keeps the replay. In auto mode a fault on one of the reps a new set counts
back is shown when the set is recognised. The panel goes away after a clean rep of the exercise, when the fault is
fixed, at the end of the set or after 10 s (the rep stays in the Mistakes list,
[below](#mistakes-kept-to-see-again-after-the-workout)); "Form check (3D demos)" in the header turns it off. The coach
is told when a demo is on screen.

**A held pose's fault** (the library's three holds with a form check,
[above](#a-held-poses-form-measured-never-assumed)) gets the same panel, once the coach is told it: when the hold's
start carrying it goes (its `form.open[0]`, 6.5 s in) or its `hold_fault` (`holdCheck` and `showHold` in
`web/js/app.js`, from `moveEvents`), side by side:

- **You**: the user's last 2 s of landmarks up to that event (`HOLD_REPLAY_MS`, from the frames the page keeps),
  replayed as a rep is, with the fault's `part` in red on the user's own `side` (the top arm, the bent or crossed leg;
  for the stance the feet, with the gap between the ankles dashed);
- **Like this**: the movement's reference pose (library.json `pose`: the middle frame of the held part of the library's
  animation, its skeleton as MediaPipe would see it from the front), drawn the same way and still, the same part in
  red, turned to the user's working side: when the user's front leg (triangle), bent leg (quad stretch) or crossed leg
  (figure-four), by what most of the replayed frames say (`poseMetrics`), is on the other side from the reference's
  (`pose.side`), the reference is mirrored (`mirrorImage`: x flipped and each left landmark swapped with its right
  one, so the part in red is on the user's side); with the camera view mirrored, both are;
- over them, the fault's label and measurement ("Feet too close together: feet 0.45 leg lengths apart"); under them,
  its cue and target ("Step your feet wider, about a leg's length apart. Aim for about one leg length apart.").

It goes 1.5 s after that fault's fix (and not before it has been up 2.5 s, as after a clean rep), at the hold's end or
after 10 s; a later fault replaces it. Each fault shown stays in the Mistakes list (below). While the fault told is
still there and its panel was put away, the Now card offers "See it again": the last 2 s again. With nobody tracked in
those 2 s nothing is shown; with a library built before `pose`, "You" shows alone with the words. The coach's readings
say nothing of the panel.

**In 3D, on request**: "See it in 3D" in the panel (or 3D on a row of the Mistakes list, after the set too) puts
the faulty rep on the same 3D character, over the whole video: the person's rep, the faulty part tinted red on the
mesh, next to the character doing the right form from the demo's clip (the clip's segment stretched so both turn at
the same moment), looped at 3/4 speed; drag to turn the view, Esc or Close to leave. Nothing of it is built or
downloaded until asked: the button loads `web/js/view3d.js`, three.js (0.170.0, `tools/fetch_assets.sh`) and the
character (each demo's GLB, ~2.3 MB). The character is posed from MediaPipe's world landmarks (`web/js/retarget.js`):
each bone is swung to point the way the body segment did, the hips and chest turn with the hip and shoulder lines,
and the lowest joint stands on the floor; it is mirrored like the camera view by mirroring the landmarks (left and
right swapped). One camera gives no twist along a limb and only a guess at depth (an arm forward or out to the side
can look alike from the front), so wrists and fingers keep their rest pose; height, bend and lean, which the checks
measure, come through.

For a held pose, "See it in 3D" (and the Mistakes list's 3D after it) puts the same 2 s on the character (an
exercise demo's Y Bot), the fault's part tinted red on the user's side, next to the library's own animation of the
movement (`/moves/glb/<key>.glb`) looping its held part (library.json `held`; the whole clip in a library built
without it) at 3/4 speed and at its own pace: a hold has no turning point to sync to. That clip is turned to face the
way the user does (the library's clips face wherever their footage's camera was), and mirrored when its working side
is not the user's as the view shows it (mirrored like the camera view, the user's side shows as the other). Its title
is the fault's label and measurement, under it the cue and target, and over the user "You (right arm in red)".

**A moving movement's fault** (a guard rail's `form_fault`,
[above](#a-moving-movements-form-guard-rails-clear-mistakes-only)) gets the same panel as it is told (`holdCheck` and
`showHold` take it as a hold's): "You", the frames its verdict rests on, the fault's `part` in red on the user's
`side` (its `seen`, padded by 0.3 s and at most 3 s about its middle, never after the event: `seenWindow` in
`web/js/mistakes.js`; with no `seen`, or its frames no longer kept, as for "See it again" long after, the 2 s before
the event); "Like this", the reference pose of that check (library.json `refPoses[<check id>]`: the frame of the
reference skeleton that best shows the check done right, at the moment it judges it), drawn still with the same part
in red, mirrored when the side the fault names is not the reference's (`refPoses` `side`; a part of both sides is
never turned); the fault's words over and under them. It goes 1.5 s after that fault's `form_fix` (not before it has
been up 2.5 s), when the movement ends (another one named, an exercise, Stop) or after 10 s; a later fault replaces
it, and "See it again" on the Now card shows it again while the fault is still there. In 3D the library's clip plays
1.5 s either side of that pose's moment (`refPoses` `t`, `AROUND_S`), at its own pace, turned and mirrored as a
hold's. A pose taken from the reference's mirror image (`mirrored: true`, the side crunch's left sweeping knee) is
drawn as it is (already on its side), while its clip, which does the movement on the other side, is mirrored for it
(`likeOf` `clipSide`: the other side from the pose's). A library built before `refPoses`, or a check with none: "You"
alone with the words, and the whole clip in 3D.

`node tools/build_demos.mjs --spec <spec.json> --out <POSE_DEMOS_DIR>` builds them from the animation libraries' Y Bot
renders: crops to the figure, encodes WebM, picks the first clean rep on the source footage's landmarks (same
timeline), copies the character and its clip (`model`: the render's GLB, Mixamo Y Bot) and writes `demos.json`. The
spec, the renders, the GLBs and the footage stay outside the repo; the server serves `POSE_DEMOS_DIR` at `/demos/` and
`/api/demos`.

Tested by running MediaPipe and the engine on 24 3D renders (the motion library's Ready and minor-flaw clips, and
the private library’s Ready exercise clips) against their source footage: the same rep count on 17 of the 19 clips of a counted
exercise, and the same exercise named in auto mode. The two others favour the 3D clip: a kettlebell sumo squat (4 reps;
the kettlebells hide the person's shins, 2 found) and an overhead squat cut off before its rep ends (0, as labelled;
the footage counts it). The rest are MediaPipe misreading the mannequin, not the motion: in a
deep squat it reads the torso ~15 deg more leaned (the animation's own skeleton leans 26 deg, like the footage), it
loses the elbows in a low side-view plank (knee push-ups: read 127-176 deg, animated 81 deg), and the mannequin's hip
points collapse for a frame with the arms overhead. That last one made arm swings read as jumping jacks; the engine now
measures foot width against at least 0.3 body scales and requires the feet wider at the top of a jack than at its start
(which also protects real users from hip jitter). One real motion limit: the push-up demo's tops stop at 140-154 deg
(no full lockout), so it is not shown for "press all the way up".

## Mistakes, kept to see again after the workout

Live (2026-10-24), the side panel showed what was wrong with a quad stretch, and by the time the user stopped the
workout to look at it, it was gone: the panel goes at the fix, at the hold's end or after 10 s, and only the last
mistake was kept (for "See the last mistake in 3D"). Now every mistake the form check shows in a workout is kept
(`S.mistakes`, `web/js/mistakes.js`): an exercise's faulty or partial rep (`formCheck`, kind `exercise`), a held pose's
fault the coach was told (`showHold`: the hold's start carrying it, or a `hold_fault`; kind `hold`), and a moving or
rhythm movement's (`showHold` on its `form_fault`; kind `move`). Each with what it takes to show it again the same
way: when (seconds into the workout, from its first frame), what (the exercise's label or the movement's name), the
fault (label or message, measurement, target, cue, `part`, `side`), a copy of the frames shown as "You", and where
"Like this" comes from (the exercise's demo; the movement's key, with the user's working side for a hold, and the
camera view's mirroring). The side crunch's low-lift, excessive-lift and bent-knee faults use this same saved review
flow. The same fault told again after its fix is a new mistake; "See it again" on the Now card
(the same fault, still there) is not. With the form check off nothing is shown, so nothing is kept. A `form_unseen`
(the form not checked at all) is no mistake: nothing of it is kept.

The Workout card lists them under **Mistakes**, newest first, one row each: when, what, the fault's label and its
measurement (0:42, "Quad stretch", "Heel far from the glute", "bent knee at 100 degrees"), with

- **Show**: that mistake in the side panel's form check as it was shown, **pinned**: "Mistake at 0:42 · Quad stretch"
  and Close over it, its replay looping, its row marked (only a pinned one's row is: one shown as it happens marks
  none). No 10 s timer puts it away, and neither does a fix, a clean rep, the end of a set or a hold, or Stop: it stays
  until Close or another Show. While a workout runs, a new fault still shows as it always did, over a pinned one, and
  goes as it did (its fix, the hold's end, 10 s): the pinned one is then back. The same fault again within 3 s of its
  showing is not shown again, the user's Show since or not;
- **3D**: the 3D view of it, from its stored frames (off when fewer than 2 were tracked in 3D). The panel's own "See it
  in 3D" opens the mistake the panel shows. Together they replace "See the last mistake in 3D".

The list stays after Stop, after the workout summary too, and is cleared only when the next workout starts (a Start
that fails keeps it); a mistake shown pinned goes then as well. A long workout keeps the latest 40 and says how many
earlier ones are left out ("3 earlier mistakes are not listed (the list keeps the last 40)"): never a silent cap.

**A saved workout.** A set saved with "Save set for debugging" keeps its mistakes too, by its frames' times and without
frames of their own (the recording has them): `mistakes: [{t, at, kind, what, exercise | movement, ...the fault's
fields, side, window: {start, end}}]` ([DATA.md](docs/DATA.md)). The picker by "Mistakes" ("This workout", then the
saved workouts, newest first: `GET /api/recordings`, and a set as soon as it is saved) loads a saved workout's mistakes
into the list without replaying it (`GET /api/recording?id=`): each one's frames are the recording's within its
`window`, its exercise's demo and its movement's reference pose the current ones (a held pose's reference turned to the
working side its frames show, a moving movement's to its fault's side), its 3D view the same. The list says which
workout it shows ("Saved workout of Jan 15, 12:00 PM (auto)", from the recording's id: its UTC time in the viewer's
own), and a mistake shown from it says "Mistake at 0:42 of the saved workout". The picker is off while a workout runs
or starts, and Start goes back to this workout.

**One saved before mistakes were kept** has no `mistakes`: the list derives them from its events (`deriveMistakes`)
and says so ("from its events"). A held pose's fault, in its start (`form.open`) or a `hold_fault`, is a mistake when
the page showed it, with the last 2 s of frames before then, once until its `hold_fix`. The page tells a hold 6.5 s
into it with its form as it is then: of the faults told by then, one fixed by then was never shown, and of those still
there only the latest told, at 6.5 s; one told later, when it was measured. None for a hold whose end came before the
page told it (an end within 5 s of its start: the tracker says it a second or so after the hold ended), unless one of
its events from 6.5 s on says the page had. An exercise's counted or partial rep with a fault is one (the fault the
page shows: the first its demo does not have; the same one within 3 s once), with its rep's frames; a faulty rep a new
set counts back is one when the rep counted with it is clean (the page shows it then). A moving or rhythm movement's
`form_fault` is one when it was told (the page tells and shows each as it comes), with the frames the page replayed
(`seenWindow` of its `seen`; an event without one, the 2 s before it); the tracker tells a fault once until it is
fixed, a `form_fix` takes back nothing shown, and the same fault told again after it is a new mistake. A mistake the
page kept has that window too, in the list and in the recording's `mistakes`. Private replay checks cover pinned and 3D review;
recording identities, timings and personal workout observations stay in `.data/`.

## Evaluate on clips

- `web/eval.html?model=full` runs the tracker over every clip in `POSE_DATA_DIR/eval_set.json` frame by frame and
  saves the landmark series (`results/<model>/<id>.json`) and 1-per-second skeleton snapshots.
- `node tools/run_engine.mjs --data <POSE_DATA_DIR>` replays the saved series through the engine and scores rep counts
  against `gt_labels.json`. `npm test` runs every node unit test (`tests/*.test.mjs`, 486), and
  `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'` the server's (124: connections, coach sessions and
  readings, the voice and speech-to-text servers, the movement library's routes, the page's code version; stand-in
  CLIs, a stand-in Anthropic client and fake workers, no MLX; the `.venv` for the anthropic SDK's own types and
  errors). No test reads the user's key or calls the API. The tests on private data (the library's references and
  footage, private regression recordings) are skipped when it is not on this machine. See
  [docs/VOICE_COACH.md](docs/VOICE_COACH.md#tests).
- `node tools/hold_eval.mjs <recording.json> <movement key>`: a held pose's form over a saved recording, event by event
  ([above](#a-held-poses-form-measured-never-assumed)).
- `node tools/negatives.mjs --data <POSE_DATA_DIR>`: phantom reps on clips where nobody exercises (idle, gestures,
  walking, jogging, legs cropped out of frame).
- `node tools/auto_eval.mjs --data <POSE_DATA_DIR>`: auto mode on each exercise clip (alone, and trimmed to its reps
  and looped 3x with a gap between copies), the no-exercise clips and their cropped copies, the movement clips no engine
  covers, recorded live sets, and workouts stitched from clips (each re-framed to one camera; expected set ends checked).
- `.venv/bin/python tools/replay_coach.py --data <POSE_DATA_DIR>` replays each clip's coaching events into a live
  coach session at the clip's timing and records what it said and how fast. It needs the dev server running and asks
  it (`--server`, default http://127.0.0.1:8765) for a session with its default brain: Claude, Sonnet unless that
  server was started with `POSE_COACH_MODEL`. It cannot drive the agent (the browser does) or ChatGPT. With an
  Anthropic API key saved, that session goes through the API and bills the user's Console account per token; start the
  server with `POSE_CLAUDE_TRANSPORT=cli` to replay through Claude Code instead.

Sets saved with "Save set for debugging" (landmarks only, `POSE_DATA_DIR/results/live/`) appear as "Recording: ..."
sources on the live page: the page replays them through the engine, auto mode and the form check as if live
(`index.html?replay_speed=3` plays them faster). One saved after movements of the library were named also has
`movements: [{movement, display, movementKind, track, seconds | count}]` (neither when zero), as the workout summary
gives them, and its `events` hold the movement tracker's own (a hold's start, progress and end with its `form`, its
faults and fixes, the time moving, a rhythm count; a hold still open when the movement ended too; a moving or rhythm
movement's `form_fault` and `form_fix`, and `form` on its progress; a `form_unseen`). One saved since
the Mistakes list has `mistakes` too, and the Workout card's picker shows any saved set's mistakes without replaying
it ([above](#mistakes-kept-to-see-again-after-the-workout)).

Clips and labels stay outside the repo (`POSE_DATA_DIR`, `POSE_CLIPS_DIR`).

## Results (2026-10-22, MacBook Air M3, Chrome-based browser pane, GPU delegate)

Tracking, 30 clips / 6,777 frames (full model): a person found in **100%** of frames; median **15.7 ms per frame**
(about 60 fps of headroom); mean visibility of the body landmarks 0.88 (side views 0.67-0.76: the far limbs are
hidden).

Rep counting, the 15 clips with a supported exercise, against ground truth labelled from 4 fps contact sheets (two
independent counts agree on 28 of 30 clips): **12/15 exact, 15/15 within one rep**, mean absolute error 0.2
(36 reps counted, 37 true). The misses: a clip that ends two-thirds of the way up a squat (the engine counts the rep
on the way up), a push press whose labellers disagreed (1 vs 0), and the first of six squat pulses.

Auto mode (2026-10-23, after three rounds of review, the last two by 44 and 88 agents that tried to break it): on the 14 exercise clips with at least one counted rep (each
trimmed to its reps and looped 3x), the right exercise **13/14** (the miss: a single push press the labellers disagree
on), **105 of 111 reps** (the misses: those 3 presses and 3 of 18 squat pulses), and **no exercise clip given a set of
a wrong exercise**. **0 phantom sets**
on idle, gesture, walking and jogging clips and their cropped copies, and on exercise clips cropped above the knees.
Stitched-workout annotations and individual replay results stay in private runtime data
(`POSE_DATA_DIR/workouts.json`). Movements the engine does not cover can be mistaken for a close relative;
private negative tests cover that boundary. These local checks are regression evidence, not a general accuracy
claim for new people or camera views.

Known limits of auto mode (each reproduced by a reviewer; none seen on real data so far):
- three or four curl-like hand movements at a steady pace (e.g. hand to chin and back, talking) can start a curl set;
  the rhythm rule only removes irregular ones. A set of 3 alternating single-arm curls with one arm following the
  other closely is not recognised until the 5th rep (then all are counted);
- squats with three bounces at the bottom are read as squat pulses, and so are very slow squats (2 s pause at the
  bottom) right after a pulse set;
- squat pulses: the engine misses about one pulse in six;
- jumps landing much slower than 0.75x of normal speed, with dropped frames, can lose one jump to a squat set;
- movements no engine knows can be named after a close relative (see above).

Form cues on the same clips: 2 cues, both matching a fault in the labels (lateral raise above shoulder height;
torso pitching forward in the lunge); no false alarm. Before the fixes below the engine raised 6 false alarms.
**Caveat:** the rules were adjusted on these clips (principled fixes, not threshold fitting), and the clips show
mostly good form, so fault *recall* is not measured yet: that is what the live test is for.

Pose model: `lite` scored 12/15 exact (15/15 within one) and ran no faster here (15.8 vs 15.7 ms per frame: on
this machine the time goes into getting the frame to the GPU, not the model), so `full` is the default.

Coach (Claude Haiku over MCP, before Sonnet became Claude's default; replaying the clips' events and live on test
clips): a cue is spoken ~0.9-1.5 s after the engine raises it; the first greeting of a page took 4-14 s while `claude`
started, so the page starts the session when it opens and keeps it across sets (Claude Sonnet 5.5 connects in about
3 s live; the current coaches are measured in [the benchmark](#coach-and-voice-benchmark-2026-10-24)). Rests cost no
model turns (`wait_for_event` waits server-side). Cues use the measured value ("you're leaning about 24 degrees as you
step back"); set summaries name the most frequent measured fault, or say the form was clean.

Review before the live test (5 confirmed issues, fixed, each with a regression test that fails on the old engine):
an overhead-press lean check that fired from the front; two-arm curls counted twice and a fault history shared by
both arms; the camera view voted over the whole set instead of per rep; the second set replaying the first set's coach
lines; frame loops piling up after Stop -> Start. Also fixed: nothing is counted or judged while the needed body parts
are out of view (or off-screen); bending over to pick up the weights is not a raise; "fixed" is only said on a clean
rep and says what was fixed.

Lessons from the clips (now in the engine):
- A front camera cannot measure depth well: the elbow angle of a curl facing the camera reads ~50 degrees too open,
  and forward lean is mostly a depth measurement. Curls are counted on wrist height on screen; torso-lean checks run
  only from side or angled views.
- Check a fault where it happens: knees vs ankles at the bottom of the squat (standing wide, the knees are naturally
  inside the ankles); "knee past toes" on the front leg only.
- A deadlift rep is floor -> lockout -> floor (counted at lockout); jumps are counted on hip height in flight.

## Coach and voice benchmark (2026-10-24)

The 20 events of test set A (from 249 logged event-to-cue pairs: every kind, 6 faults on 5 exercises, a set switch)
through each coach, in order, text only, on this M3 (Chrome, WebSocket to ElevenLabs). A panel of 8 blind judge agents
scored every cue: two independent fact-checkers, a coaching-rules judge and a delivery judge; panel score =
(2 x faithful + coaching + delivery) / 4. A second blind judge (Claude Opus, one call per event) agrees on the top.
16 configurations were run; the full table, the method and an MCP-tools comparison on Era are in
[docs/VOICE_COACH.md](docs/VOICE_COACH.md#benchmarks). Private files: `.data/dev/bench/`.

| Coach + voice | Panel score | Faithful (1-5) | Factual errors | Text p50 | Event to voice, p50 | Cost |
|---|---|---|---|---|---|---|
| **ElevenLabs agent, DeepSeek V4.1 Flash, its voice** (Auto's first) | 4.72 | 4.78 | 4.0 | **0.27 s** | **0.35 s** | ElevenLabs minutes |
| ElevenLabs agent, DeepSeek V4.1 Flash text + Kokoro (live, through the page) | | | | | 0.84 s | ElevenLabs minutes |
| **Claude Sonnet 5.5, `claude -p`** + Kokoro (Auto's second) | 4.46 | 4.75 | 4.5 | 1.55 s | not measured | Claude subscription |
| Claude Haiku 5.5, `claude -p` + Kokoro (before) | 3.96 | 4.15 | 10.5 | 1.50 s | 2.17 s | Claude subscription |
| ElevenLabs agent, GPT-6.1 Sol | **4.76** | 5.00 | 0.0 | 1.71 s | | ElevenLabs minutes |
| ElevenLabs agent, GPT-6 Astra | 4.74 | 5.00 | 0.0 | 1.89 s | | ElevenLabs minutes |
| ElevenLabs agent, Gemini 2.5 Flash, its voice (the pilot's pick) | 4.64 | 5.00 | 0.0 | 0.86 s | 0.96 s | ElevenLabs minutes |
| ElevenLabs agent, GPT-6 Luna | 4.62 | 4.85 | 1.0 | 1.04 s | | ElevenLabs minutes |

- Factual errors: the mean of the two fact-checkers over the 20 cues. ChatGPT (GPT-6 Luna through `codex exec`) was
  not run on test set A; live it takes 1.1 s median per cue and connects in 5-7 s.
- DeepSeek V4.1 Flash is within 0.04 of the best panel score, with the lowest text latency of all 16 (268 ms p50) and
  the best delivery (4.60). Its slips were mild (over-praise, an unmeasured detail); none was a wrong count or an
  invented correction. Claude Sonnet over Haiku: panel 4.46 against 3.96, factual errors 4.5 against 10.5.
- Live on the page: the agent replies in 0.15-0.62 s (0.5 s event to voice); Claude Sonnet 5.5 about 1.4 s per cue,
  connecting in about 3 s.
- Kokoro-82M, first sentence on this M3 (p50): MLX on the GPU 0.48-0.53 s (real-time factor 0.18), in the browser on
  WebGPU 1.75 s, ONNX on the CPU 1.76 s (Core ML 2.16, int8 2.47). Voices af_heart (fastest, best rated), bf_emma.
- Speech to text (Parakeet TDT 0.6B v3 on MLX, through `POST /api/stt`): 54 of 60 Kokoro-spoken phrases word for word
  (three voices), 156 ms median (p90 237 ms) for 2.5-4.7 s of audio, 10 of 10 in white noise at 10 dB SNR, no words
  from silence or noise, 1.1-1.3 s for the 30 s maximum. Claude Sonnet 5.5 confirmed an applied "Now lunges." in 1.1-1.2 s,
  answered a question in 2.2-3.0 s, and told the user it cannot count burpees or mountain climbers, words the page had
  not applied ([details](docs/VOICE_COACH.md#the-user_said-event)).
- Costs: the agent bills by the minute on the user's ElevenLabs plan. Claude through the Anthropic API (when the user
  saved a key) bills per token on their Console account; through `claude -p`, as measured here, Claude runs on the
  user's subscription (for Claude Code only `ANTHROPIC_API_KEY` is ruled out), and so does ChatGPT (Codex is checked
  to be signed in with ChatGPT); see [docs/VOICE_COACH.md](docs/VOICE_COACH.md#claude). The API transport was not run
  on test set A.

## Files

```
web/index.html, web/js/app.js   live page: camera or clip, skeleton overlay, the side panel (reps, the coach's
                                questions), cues, speech
web/js/engine.js                features, smoothing, rep detector, exercises and checks, coaching events
web/js/pose.js                  MediaPipe PoseLandmarker wrapper (VIDEO mode, GPU with CPU fallback)
web/eval.html, web/js/eval.js   frame-by-frame evaluation over a clip set
server/dev_server.py            127.0.0.1 server: pages, clips (byte ranges), results, coach, connections, voice, bench and
                                movement-library routes; the Host check and the write guards
server/coach.py                 coach sessions: event queue, Claude through the Anthropic API (a worker thread, the
                                user's key) or Claude Code (claude -p), Codex (codex exec) and its restarts, cue
                                latency; each event's reading (the named movements' too, with a hold's or a moving
                                movement's measured form)
server/connections.py           the coach's connections: the ElevenLabs agent record, the CLI sign-in checks, the API
                                key check, Claude's transport, Auto's order
server/pose_mcp.py              MCP server (stdio): wait_for_event, say
web/js/auto.js                  auto mode: which exercise, reps, sets (arbitration between the engines)
web/js/formcheck.js             form check: the faulty rep replayed (faulty part in red), the measurement in words; a
                                library movement's reference pose drawn still, turned to the other side (mirrorImage)
web/js/mistakes.js              the Mistakes list: a workout's mistakes kept (at most 40, the rest counted; an
                                exercise's, a hold's, a moving movement's), as a recording keeps them and back, derived
                                from an older recording's events, a row's words; seenWindow (a moving fault's frames)
web/js/retarget.js              the person's rep on a Mixamo character (Y Bot) from MediaPipe world landmarks
web/js/view3d.js                the form check in 3D (three.js), built only when asked; a library movement's clip over a
                                hold's held part or around a moving one's reference moment, turned to face as the
                                person does
tools/build_demos.mjs           the 3D demo clips and demos.json (from private renders and footage)
tools/serve.sh                  run the dev server on .data/ (or the 3D test set)
web/js/voice.js                 the coach's voice: Kokoro (server or browser) or the Mac, with when each cue was heard
web/js/speech-text.js           how a cue is cut for synthesis (the first clause first)
web/js/kokoro-worker.js         Kokoro-82M in the browser (kokoro-js, WebGPU): the fallback voice
web/js/eleven-coach.js          the ElevenLabs agent as the coach (its LLM and voice), one message in flight, duplex
web/js/connections.js           which coach and voice to use (Auto, hand picks, failover), the Connections panel's words
server/tts.py, kokoro_worker.py Kokoro-82M on the Mac's GPU (MLX) for GET /api/tts
tools/setup_kokoro.sh           builds that voice: .venv-kokoro and the pinned model (Apple Silicon)
server/stt.py, stt_worker.py    Parakeet TDT 0.6B v3 on the Mac's GPU (MLX) for POST /api/stt: what the user says
tools/setup_stt.sh              fetches Parakeet (pinned) for the same venv, with a smoke test
web/js/listen.js                the page listening: the microphone, the voice-activity detector, push-to-talk, /api/stt
web/js/intents.js               what the user's words ask of the page: an exercise, a movement of the library, "detect it",
                                done or not yet
web/js/moves.js                 a movement of the library the user named: hold timer, time moving, approximate rhythm
                                (CycleCounter's turns; a signal's fallback, FALLBACKS); the form of a hold
                                (holdform.js) or a moving one (moveform.js)
web/js/holdform.js              a held pose's form: poseMetrics, HOLD_FORMS (the checks of three poses, each with its
                                part to show in red), HoldForm; IN_POSE and InPose (in the pose at all)
web/js/moveform.js              a moving or rhythm movement's form: bodyMetrics, MOVE_FORMS (the groups merged),
                                MOVE_TUNING, MoveForm (frame and cycle checks, runs and pauses, the floor at each
                                distance, one correction at a time, each fault's `seen`), checkProblems; form_unseen
                                (UNSEEN_TUNING, UnseenWatch, standingInPicture, outOfView, unseenEvent), a hold's too
web/js/moveforms/               the guard rails by group (arms.js, legs.js, transitions.js, flow.js), each check's
                                numbers beside it, and what was left out and why
tools/hold_eval.mjs             a held pose's form over a saved recording, event by event (reads, writes nothing)
tools/build_moves.mjs           the movement library (.data/moves/library.json, glb/) from the private motion library;
                                a rhythm and its fallback (rhythmOf), a hold's held part and reference pose (heldOf),
                                a guarded movement's reference poses (refPosesOf; a one-sided check's from the
                                reference mirrored, mirrorSkeleton)
web/js/embed.js                 inside the BuildNorth app (?embed=1): messages to the app, the workout it saves
host/                           the BuildNorth app's camera workout screen, to copy into mobile/ (host/README.md)
tools/try_in_app.sh             that screen in a copy of the BuildNorth web app (:8082), main checkout untouched
docs/                           HANDOFF.md, DATA.md, INTEGRATION.md, VOICE_COACH.md
tools/                          run_engine.mjs, negatives.mjs, auto_eval.mjs, replay_coach.py, fetch_assets.sh
tests/engine.test.mjs           rep detector and cue logic
tests/auto.test.mjs             auto mode's set and arbitration logic (scripted engines)
tests/speech-text.test.mjs      the cue split, the same in the page and the Kokoro worker
tests/eleven-coach.test.mjs     the agent coach: one message in flight, the rest together, late replies, the silent input;
                                duplex: the user's words apart from tracker replies, the client tools, a refused mic
tests/connections.test.mjs      Auto and hand picks, failover, the voice rules, the panel's words (Claude through the
                                API or Claude Code), cues owed per session
tests/voice.test.mjs            the voices: Kokoro's page and seq, superseded cues, close(), the Mac voice's own cue
tests/embed.test.mjs            the embed mode: which pages may frame it, the workout, the messages
tests/formcheck.test.mjs        every engine fault has a description and body part to colour, and every held pose's
                                fault a part (one limb when a side is named); a reference turned to the other side
tests/retarget.test.mjs         posing the character from landmarks (T-pose, arms, jacks, squat, plank, turn, mirror, tint)
                                and a held pose's parts on the Y Bot
tests/test_connections.py       the CLI checks with stand-in CLIs (nothing secret out), their cache, the agent record;
                                Claude's transport: the API on a made-up key (a stand-in client), else Claude Code; a
                                key saved since the check checked again; a key file others can open warned of
tests/test_coach.py             the claude and codex command lines; a stand-in codex restarted, then given up on;
                                each event's reading (the coach's questions, the user's answers and words, what the
                                page did or did not do with them; a named movement and its hold, moving and rhythm
                                events, its notes' form cues alone; a hold's measured form, or that it is not
                                measured); the exercises SYSTEM names are the engine's, the agent's movement rules,
                                never calling form good unless measured (a fault waiting its turn, a check out of the
                                frame or the view, faults the user was never told of); Claude through the API with a
                                stand-in client (the request, max_tokens by thinking, the history, refusals, failures,
                                its one retry, events the page stopped waiting for, nothing sent after a stop, the real
                                client to api.anthropic.com alone, the key in no log, status or error); a moving
                                movement's guard rails in its readings (its fault, its fix, the progress's form clause,
                                never fine as a whole) and the rule in SYSTEM; form_unseen's reading (what to show, or
                                to turn) and its rule
tests/test_server.py            /api/tts with a fake Kokoro worker, the Host check, the write guards, the connections,
                                an event's reading for the agent, /moves/ (the library and its animations, nothing
                                else), /api/version changing with any of the page's files (web/js's folders too)
tests/test_stt.py               /api/stt with a fake Parakeet worker: the words, restarts, the guards, the 30 s limit,
                                a slow utterance (504), a model set up later, POSE_STT=0
tests/intents.test.mjs          what the user's words ask of the page (names, switches, questions, pain, done / not yet;
                                the library's movements by their spoken names, against the exercises' names)
tests/technique.test.mjs        single jab–cross checks, same-hand sequences, direction/guard faults, camera limits;
                                private reference, source footage and live-recording regressions
tests/moves.test.mjs            the named movements: hold timer, time moving, approximate rhythm on made-up frames with
                                MediaPipe-sized jitter; a hold's form in its events (frames it cannot judge left out,
                                faults and fixes held back while the hold may end first, settle(), the pose left); a
                                moving movement's form through the tracker (none without landmarks or a check; a peak
                                check's fault and fix; each turn handed over once; a frame check on the frames moving,
                                after the warm-up; the signal's swing kept for a form only, its window's) and
                                CycleCounter's turns and retune; a rhythm's fallback (the feet out of view, the
                                sweeps counted on the thigh, none twice at a switch); a hold's form_unseen; the library
                                build on made-up motions (policy, the kinds left out, keys, idempotent; a rhythm's
                                fallback parameters; a hold's held part, reference pose and working side, and the
                                library's references')
tests/moveform.test.mjs         a moving movement's form: bodyMetrics on made-up landmarks (either side, mirrored,
                                turned, partly out of view); frame, still and cycle checks on made-up checks (a fault
                                once it lasts or on 2 of 3 cycles, its fix, one at a time, the warm-up, a pause, the
                                view, a phase, the verdicts expiring, a whole cycle, a fault's `seen`); the pause rule
                                (slow reps' holds no pause, a rest one; sets far apart); the floor (at each distance);
                                form_unseen (standing in the picture, moving or not; never sitting, close or with
                                nobody; only the blocked checks; how often) and outOfView; every check's shape; the
                                shoulder rotation's and the Y-to-W's references through the tracker, at half pace
                                too, the user's side crunches with the feet out of the picture (asked to step back,
                                the sweeps counted) and their other recordings (never asked at the laptop) (private,
                                skipped when absent)
tests/moveforms-*.test.mjs      the guard rails of each group (arms, legs, transitions, flow), movement by movement:
                                made-up landmarks for each measure and phase; private, skipped when absent: the
                                reference at several paces, mirrored, with jitter, and MediaPipe on the footage,
                                telling nothing; faults put in, caught alone on their side and fixed; the arms'
                                references through a pinhole camera turned and high or low, the step touch drifting;
                                private regression recordings with each movement named over the whole, nothing told but in
                                the movement named, and the user's live side crunch (its bent sweeping knee told)
tests/refposes.test.mjs         the guarded movements' reference poses (refPosesOf on made-up skeletons and checks, a
                                one-sided check found on the reference mirrored; the library's references: each pose
                                passing its check, in the picture, on its side)
tests/holdform.test.mjs         a held pose's form: the measures on made-up landmarks, the checks on the references and
                                the footage (private, skipped when absent), faults told one at a time and their fixes,
                                pending and wrong-view checks, `when` on smoothed values, in the pose at all, each
                                fault's part and side, a hold seen side-on (form_unseen: turn), the user's recorded
                                triangle holds (skipped when absent)
tests/page.test.mjs             every element app.js looks up is in the page; the Movements card and the Now card's
                                line; a hold's form in the engine's words, the held-back start (a fix folded into it,
                                a fault pending, the next correction timed from it), told flags at the end, the Now
                                card's form only once the start was told, and the recording; a held pose's form check
                                (when it shows and goes, its words, the reference turned to the user's side); a moving
                                movement's form (its faults and fixes to the coach as they come, the Now card's line
                                steadied, its form check with the check's reference pose, a mirrored one, "You" its
                                `seen` frames); form_unseen (its cue to the coach and spoken, after a hold's start,
                                on the Now card; no mistake); the Mistakes list (each one kept with its frames, the
                                cap, Show pinned and back after a fault shown over it, cleared
                                at Start, the recording's mistakes, an older recording's held-pose and moving-movement
                                mistakes as the page's own moveEvents showed them, a saved workout reviewed)
tests/mistakes.test.mjs         the Mistakes list's cap, a mistake as a recording keeps it and back, an older
                                recording's mistakes derived from its events (held poses as the page told the hold, a
                                moving movement's faults each when told, with their `seen` frames, exercises with the
                                reps a new set counts back), a row's words
tests/listen.test.mjs           the voice-activity detector and push-to-talk on made-up frames, 16 kHz PCM16
host/src/lib/pose-coach.test.mjs  the app side's camera workout logic (cd host && node --experimental-strip-types --test ...)
```
