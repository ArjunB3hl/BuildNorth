# Pose coach: data

Everything the pose coach reads, records or builds lives in `.data/` next to the code. Its full path is
`inference/pose-coach/.data/`. The folder is git-ignored (`.gitignore`: `.data/`),
and must stay so: the repo is public, and most of this is licensed footage, private animations or the user's own
recordings. `tools/serve.sh` points the server at it.

| Folder | Server setting | What | Size |
|---|---|---|---|
| `.data/posedata/` | `POSE_DATA_DIR` | evaluation set, labels, landmark results, live recordings, reports, coach sessions | ~90 MB |
| `.data/clipset/` | `POSE_CLIPS_DIR` | the evaluation set's video clips | ~115 MB |
| `.data/demos/` | `POSE_DEMOS_DIR` | the 3D demos: a cropped video and a character GLB per exercise, and the catalog | ~36 MB |
| `.data/m3d/` | (`serve.sh m3d`) | the 3D-vs-footage test set: its own data folder and clips | ~95 MB |
| `.data/sources/` | | downloads from the motion library the demos were built from | ~65 MB |
| `.data/connections/` | | the coach's connections: the ElevenLabs agent record and the user's Anthropic API key (see [below](#connections-the-coachs-connections)) | |
| `.data/dev/` | | analysis tools: fuzzer, recording plots, 3D checks (see [below](#dev-analysis-tools)) | |
| `.data/screenshots/` | | screenshots of the form check and the 3D view from the tests | |

## `posedata/` (POSE_DATA_DIR)

| Path | Contents |
|---|---|
| `eval_set.json` | The 60 evaluation clips: `{id, file, exercise, name}`. 15 exercise clips cover all 13 exercises. The other 45 are clips where nobody exercises (`exercise: null`): idle, gestures, walking, jogging, dance, sports, crouching. They test phantom reps and sets. `file` is relative to `POSE_CLIPS_DIR`. |
| `gt_labels.json` | Labels for 30 clips: `rep_count`, `rep_times`, `rep_unit`, `camera_view`, `form_observations` (time, body part, fault or good), `partial_reps`, a `recount`, and `confidence`. Written by reviewing the footage. |
| `results/full/<id>.json`, `results/lite/<id>.json` | MediaPipe output for each clip with the full or the lite model, from `web/eval.html`: `{id, exercise, model, fps, width, height, duration, frames: [{t, image, world}]}`. `image` is 33 points `[x, y, z, visibility]` (normalised to the frame); `world` is 33 points `[x, y, z]` in metres with the origin between the hips, y down. |
| `results/live/live-<UTC time>-<mode>.json` | Sets saved from the live page with "Save set for debugging". Landmarks only, never images. Format: `{id, started, code, source, exercise, model, delegate, frames, events, width, height, reps, sets, duration}` (plus `movements` when the user named a library movement: each one's key, track and time or count), where `events` is everything the engine, auto mode or the movement tracker emitted. The movement tracker's events are saved too (`{type, key, display, kind, t, ...}`: a hold's start, progress and end with its `form`, its `hold_fault` and `hold_fix`, the time moving, a rhythm count, and the end of a hold still open when the movement changed or the workout ended); recordings saved before that have none of them. Since the guard rails, a moving or rhythm movement's form too: each `form_fault` (`{fault, label, measured, target, cue, part, side, seen}`, at the frame time it was told; `seen: {from, to}` the frame times its verdict rests on, which can be seconds before that) and `form_fix` (`{fault, label}`), and `form` on its `moving_progress` and `rhythm_progress` (`web/js/moveform.js` `state()`, or null without a check). And `form_unseen` (`{missing, parts, why, cue}`: a check's parts out of the picture while the person stands in it, or every check side-on, a while; a hold's, every check out of view; no mistake, so never in `mistakes`). Since the Workout card's Mistakes list, `mistakes` too: each mistake the form check showed, oldest first (all of them: the list's 40 is the page's own cap), `{t, at, kind, what, ...}` with `t` the frame time it was shown at, `at` seconds into the workout (from its first frame), `kind` `exercise` (`exercise`, `turn`: the rep's turning point, and the engine's fault fields `code`, `message`, `value`, `severity`, `part`), `hold` (`movement`: the library key, and `fault`, `label`, `measured`, `target`, `cue`, `part`) or `move` (a moving or rhythm movement's guard rail: the same fields as `hold`), `what` (the exercise's label or the movement's name), `side` (or null), and `window: {start, end}`, the frame times shown as "You" (for a `move`, its fault's `seen` padded by 0.3 s, at most 3 s: `seenWindow`; else the 2 s before it): no frames of their own, those are in `frames` (`web/js/mistakes.js` `recordOf`). The page's picker by "Mistakes" loads a recording's mistakes, with their frames by window, without replaying it; a recording saved before has none, and the page derives them from its events (`deriveMistakes`: a held pose's start carrying a fault and its `hold_fault`s, a moving movement's `form_fault`s, each with the same window of frames as the page's, by its `seen` (the 2 s before it when it has none), an exercise's faulty and partial reps). `tools/hold_eval.mjs` replays a held pose's form from a recording's frames. They replay on the page as "Recording: ...". |
| `engine_report_full.json`, `negatives_full.json`, `auto_report_full.json` | Output of `tools/run_engine.mjs`, `negatives.mjs` and `auto_eval.mjs`: the regression baselines. |
| `coach_replay_full*.json` | `tools/replay_coach.py`: what the coach said for each clip, and how fast. |
| `coach/` | The coach's runtime files: an MCP config for each session (`mcp-<session>.json`), an empty working folder (`cwd/`) for the Claude CLI, and each session's log (`session-<session>.jsonl`: the CLI's output, with the events and the user's words; through the Anthropic API a line per request with its token counts and the reply, not the event; never the key). They can be deleted. |

Recording inventories, workout descriptions and hand annotations stay in `.data/`. Tests discover their inputs at
runtime and skip when absent. Never copy an actual recording ID into a public document or test fixture.

### Private stitched-workout cases

`tools/auto_eval.mjs` reads `POSE_DATA_DIR/workouts.json` (or `--workouts <private-json>`). With no file, only the
stitched-workout portion is skipped. Each case is `{name, segs, expect, startCounts?}`. A segment is
`{clip, loops?, from?, to?, join?, around?}`, `{rest, ms}` or `{gone}`. Clip IDs refer to the selected model's
results; `.json` paths are relative to `POSE_DATA_DIR`. `around: true` trims a clip to its labelled reps before
applying explicit segment overrides. Expectations contain exercise/set/count/end-reason strings, such as
`"squat#1=4/stop"`. Keep real IDs, recording intervals and expected workout details in this ignored file.
Use `--report <json>` to write an evaluation report somewhere other than the data directory.

## `connections/` (the coach's connections)

Always the repo's own `.data/connections/`, whatever `POSE_DATA_DIR` says (`docs/VOICE_COACH.md`, "Configuration").

| File | What |
|---|---|
| `elevenlabs.json` | The ElevenLabs agent record `{setUp, agentId, plan, name, llm}`, saved from the Connections panel (mode 0600). No secret, but the id stays out of the repo. |
| `elevenlabs.json.forgotten` | The record after Forget. |
| `anthropic-key` | **The user's Anthropic API key**, for Claude through the API: the key alone, one line. The user writes it: `mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key` from `inference/pose-coach` (mode 0600: `umask 077` sets the mode of a new file only, `chmod 600` that of one already there; the connection check warns, from the mode alone, when other users can open it). The server reads it afresh for the connection check and at each session start, and never writes, prints, logs or returns it (`POSE_ANTHROPIC_KEY_FILE` points elsewhere). It bills the user's Console account per token. A secret: never read, print, copy or commit it, never put it in a shell's `ANTHROPIC_API_KEY` (Claude Code would bill it); moving the file away sends Claude back through Claude Code. |

The older `.data/eleven-agent-id` (the agent's id alone) is read last, and moved aside by Forget.

## `clipset/` (POSE_CLIPS_DIR)

- `clips/*.mp4`: the 46 clips of the evaluation set. Most are 3D-animation-library source footage (Pexels, CC BY
  and public domain) or test clips allowed by the licence policy.
- `cropped/`: copies with the legs cropped out of frame, for the framing tests.
- `webm/`: two clips re-encoded.
- `clips.json` (`rhythm.clip-set/1`): where the clips came from.

## `demos/` (POSE_DEMOS_DIR)

| File | Contents |
|---|---|
| `<exercise>.webm` | One clean rep of the exercise by the Y Bot, cropped to the figure (VP9). It loops in the form-check panel. |
| `<exercise>.glb` | The same character and animation as a GLB: Mixamo Y Bot, 65 bones, one clip. The 3D view poses the person on it and plays the clip as the right form. |
| `demos.json` | The catalog the server serves at `/api/demos`. Per exercise: `file`, `model`, `segment {start, end, turn}` (the clean rep to loop, in seconds, on both the video and the GLB timeline), `repsInSource`, `cleanRep`, `avoidFor` (faults the demo itself has, so it is never shown for those) and `credit {title, creator, license, url, short}`. |
| `demos_spec.json` | The build input for `tools/build_demos.mjs`. Per exercise: `render` (the Y Bot render), `landmarks` (MediaPipe on the source footage), `renderLandmarks`, `model` (the GLB), `credit` and `avoidFor`. |

Demo source paths, credits and approved segments are configured in the private `demos_spec.json` file.
They may refer to a locally licensed animation library or approved private downloads.

To rebuild: `node tools/build_demos.mjs --spec .data/demos/demos_spec.json --out .data/demos`.

## `moves/` (POSE_MOVES_DIR: the named movements)

The movement library the page offers (docs/VOICE_COACH.md, "Named movements"), built by `node tools/build_moves.mjs` from
a configured private animation library. Only Ready motions that the clip policy clears, of the kinds the library
offers, go in: 29 of 61. The policy clears 42 (its `exclude` and `confirm` entries never go in); the build leaves out
the 13 of kinds `sport`, `locomotion`, `gesture` and `idle`. One of the 61, the shadow-boxing one-two, is a 2 s cut of a clip that was questionable as a whole, made its own motion in the library on the user's request (its `record.json` `derivedFrom`), and `catalog.json` gives its rhythm (`motions[].rhythm`). Licensed derivatives: private, never in the repo.

| Path | What |
|---|---|
| `library.json` | The movements the page loads (`GET /moves/library.json`): key, display name, kind, track (reps, rhythm, hold, moving), engine for the counted ones, coaching notes, spoken names, the rhythm signal (`rhythm: {signal, minPeriodS, prominence, fallback?}`; `fallback: {signal, minPeriodS, prominence}` for a signal counted from another while its parts are out of view: the side crunch's and the wall raise's feet's spread from `thighOut`, `{thighOut, 1.1, 19}` and `{thighOut, 1.1, 23}`); for a hold, its held part (`held: {start, end}`, seconds of its GLB's animation) and reference pose (`pose: {image, side}`: the 33 landmarks of the held part's middle frame and its working side), which the form check shows as the right form; for a moving or rhythm movement with guard rails (`web/js/moveform.js` `MOVE_FORMS`), `refPoses: {<check id>: {image, side, t}}`: per check, the 33 image landmarks (`[x, y]`, to 4 decimals, normalised to a 16:9 picture, as `pose`) of the reference skeleton's frame that best shows that check done right where it judges, the reference's side of the check's part there (`left`, `right`, or null for both or none) and that frame's time in seconds of the GLB's animation; the form check shows it as "Like this" for that check's fault, and the 3D view plays the clip around `t`. A one-sided check with no such frame on the reference (one of the side the reference never moves) takes its pose from the reference mirrored: `{image, side, t, mirrored: true}`, the image and side the mirror's and `t` the same frame (the page draws it as it is and mirrors the 3D clip for it). A check with no frame either way has none (the build prints why), and a library built before has no `refPoses`: the page then shows "You" alone. Today every one of the 21 checks has its pose, one of them mirrored (the side crunch's left sweeping knee) |
| `glb/<key>.glb` | Each movement's 3D animation (Y Bot), copied from the library (`GET /moves/glb/<key>.glb`) |
| `catalog.json`, `cleared.json`, `slugs.json`, `synonyms.json` | The build's inputs: the library's motions labelled for the coach (kind, engine, notes), the cleared ids, stable keys for the 30 cleared movements the engine does not count (the build uses those of the movements it builds; the voice agent's `set_movement` tool takes the 16 the library has), the spoken names |
| Everything else (`mp/`, `skel/`, `refs.json`, `params*.json`, `eval_*.json`, `fulleval/`, `search*/`, `review/`, `live_labels.json`, ...) | The recognition study, which the page does not use: MediaPipe series of library clips, reference skeletons and features, tuning runs and their reviewed results (the build reads a movement's `skel/<id>.json` dump only when its npz cannot be read), and hand labels of six of the user's recordings (`live_labels.json`: what they were doing when, in seconds from the first frame). The guard rails' tests read some of it too, skipped when it is not here: the reference skeletons, MediaPipe on the library's footage (`mp/index.json` and its series), and the labels (the arms' test, which never judges walking up to the camera) |

## `m3d/` (the 3D-vs-footage test set)

- **`data/`** is its own data folder (`eval_set.json`, `results/full/`, `results/live/`, reports). `eval_set.json`
  has 48 entries: 24 Y Bot renders (`kind: 3d`) and their 24 source clips (`kind: src`).
- **`clips/`** holds the videos.
- **`compare.mjs`** runs the engine on each pair and compares the counts.
- **`pick.json`** records which animations were picked, and why.

Serve it with `bash tools/serve.sh m3d` (port 8766). README "3D demos" has the results: the same count on 17 of 19
pairs, and the MediaPipe misreads of the mannequin.

## `sources/` (motion-library downloads)

Files fetched from the private motion-library dataset on Hugging Face (ask the owner for its id and access):
- the source videos under `gym/`, `boxing/`, `karate/` and `mobility/`;
- `motion-results/<id>/retarget/`: the rendered videos and `mixamo_character.glb`.

To fetch more: `hf download "$POSE_DATASET" <path> --repo-type dataset --local-dir .data/sources`. Set `POSE_DATASET` privately; the `hf` CLI must be signed in with access.

## Dev analysis tools

`.data/dev/` keeps the scripts used to diagnose and verify the changes so far. Its `README.md` lists their usage.
They run with `node` from that folder.

- **Recording analysis:**
  - `series.mjs`, `plot.py` and `sheet.py` plot a recording's signals and draw its skeleton over time (contact sheet).
  - `latency.mjs` shows how long after each rep the page shows it.
  - `trace.mjs`, `why.mjs`, `held.mjs` and `blockers.mjs` trace auto mode's decisions.
- **`fuzz/`:** the random-workout fuzzer that compares two versions of `auto.js`. `lib.mjs` sets `OLDP` and `NEWP`;
  export the old version with `git archive <commit> inference/pose-coach | tar -x -C <dir>`. `baseline/` is the
  export of commit 3b3b28b, the last version with the fixed 3 s wait.
- **`equiv/`, `order/`:** the reviewers' reproductions: clips joined into workouts, and scripted cases.
- **`glbtest/`:** loads a real Y Bot GLB with three.js in node and poses it from a recording (`pose.mjs`).
- **`3d/`:** the 3D view's checks: hands vs floor, overlap, jitter, lifecycle.
- **`faults.mjs`:** per-rep faults of two engine versions on all clips, for diffing.

## Licences and privacy

- **Footage:** clips follow `.data/moves/clip-policy.json (or POSE_CLIP_POLICY)`. Mixkit and Envato are never
  used, and research footage needs the owner's confirmation. Credits are kept in `demos.json` and shown with each
  demo.
- **Animations:** the Y Bot and the animations are Mixamo-rigged outputs of the user's pipeline, so they stay out of
  git.
- **Recordings:** landmark coordinates of the user, no images. Keep them out of git and off shared services. Their
  events can hold a held pose's or a moving movement's measured form, and their `mistakes` the faults the page showed
  the user; the coach CLIs' session logs hold the user's words.
- **The reference poses** (`moves/library.json` `refPoses`, like `pose`): landmarks of the library's reference
  skeletons, derived from licensed footage: private, as the rest of `moves/`.
- **The Anthropic API key** (`connections/anthropic-key`): the user's secret, on this Mac only. Never in git, a log, a
  message, a test fixture or the environment.
