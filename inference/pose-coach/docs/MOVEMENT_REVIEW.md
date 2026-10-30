# Saved movement review

Open <http://127.0.0.1:8765/web/index.html?review=1> and reload after editing code. The newest local recording and
Casual freestyle dance are selected automatically. **Refresh recordings** loads the newest saved session. **Open recording JSON** reads files from another data folder directly in the browser, without uploading or moving them. The new attempt cards list candidates within each saved boundary; replay-only attempts remain available. Loading review uses GET requests only: it does not start a
camera, microphone, or coach session, and does not write recordings or the movement library.

Use **Play phrase**, the replay slider and **Speed** to inspect the saved pose beside the original animated Y Bot.
**Show this difference** pauses at a timestamp and highlights the corresponding joints on both figures. Drag to
rotate; **Reset view**, **Face both bodies forward**, and **Mirror display** change only the display. Choose another
activity/attempt or enter recording-relative seconds in **From** and **To**, then **Compare selected phrase**.
**Find a comparable phrase** searches inside the selected activity/attempt. An unsupported alignment still allows
visual replay, with the reference explicitly marked as proportionally timed rather than aligned.
**Review focus** defaults to **Feet and legs**. It prioritizes knee/hip motion for alignment and shows only leg or
foot-spacing cues. **Whole body** restores the eight-angle comparison. Changing focus re-compares the current
phrase; **Find a comparable phrase** searches the selected activity with that focus.

For a new recording, choose a movement in the library before **Start recording**. **Restart movement** closes the
current attempt and creates a fresh tracker with zero counters. **Stop and save** retains all attempts in one new
recording. A successful **Stop and save** automatically opens the new recording in the review; **Refresh recordings** also discovers sessions saved elsewhere in the same server data folder. Dance status has no live timer. Coach and voice remain
off in review mode until explicitly selected.

For a one-session welcome, open <http://127.0.0.1:8765/web/index.html?review=1&session_intro=1>.
The next **Start recording** shows a cancellable 5 → 1 countdown before camera, recording or coach startup.
After setup, the selected voice coach receives a brief capability introduction ending with “What would you like
to do today?” It does not claim a successful tracking update. The question stays available while the user answers.
This link selects Auto coach and voice only in memory; saved preferences and remote agent configuration stay
unchanged. Successful startup consumes the introduction and removes its URL flag; cancellation or failure keeps
it available for retry. Normal review links keep the existing quiet startup. A slow camera/model/voice connection
can take additional time after the five-second countdown; the UI shows setup separately.

`node --test tests/session-start.test.mjs` checks the countdown and capability event. The optional
`node tools/check_session_start.mjs` browser check accepts `RHYTHM_PLAYWRIGHT`, `RHYTHM_CHROMIUM`,
`RHYTHM_REVIEW_URL` and `RHYTHM_START_RECORDING`. It uses saved-pose input and a simulated voice transport,
checks cancellation, one-time activation, unchanged preferences, tracker failure and camera refusal, and opens
no actual camera, microphone or paid agent session.

## Evidence and coordinates

The default **3D view** loads the original GLB with the existing vendored `GLTFLoader` and clones its skinned scene
using `SkeletonUtils.clone`. These are two independent skinned characters, not cylinder/sphere approximations.
The reference clone uses `AnimationMixer` at the existing aligned reference time, including the 4.6-second endpoint.
The user clone has no animation mixer. Its skin is restored to its actual bind pose before creating the existing
`retarget.js` Rig; a trimmed animation's initial node transforms are not assumed to be a T-pose. The Rig follows
the directions in each saved frame, with floor placement and the hand-on-floor heuristic disabled.

The user mesh needs a reliable torso: both shoulders and both hips, defining a stable body frame. Each limb
segment (head, upper arm, forearm, hand, thigh, lower leg, foot) is posed only from its own two landmarks. An
uncertain segment is not posed at all; it and everything below it are collapsed to its joint, so a missing limb is
shown as absent, never guessed and never left in a rest pose. The label says "unmeasured parts hidden" and the
status names them. Changing an unmeasured landmark's coordinates moves nothing that is drawn (tested). If the torso
is uncertain, the whole user character is hidden and labelled saved landmarks are shown instead; the reliable
reference character continues. There is no smoothing through occlusion, previous-pose hold or reference-pose
substitution. A failed mesh load keeps the sampled landmark view; a failed GLB fetch keeps user-only replay and
suppresses comparison cues. (Earlier, any uncertain input, such as a far hand while turned, hid the whole
character; in the newest session that left legs-visible frames drawn as stick figures.) **Load review** retries. **Saved landmarks** can always be selected to inspect original proportions explicitly.

Both characters retain identical Y Bot proportions and share one bind-pose torso scale. Hip centering, optional
shoulder-yaw removal, display reflection and viewing rotation are applied in the same order on both sides. Display
reflection never swaps anatomical IDs. Character body shape, finger articulation and axial twist are illustrative,
not measurements; foot contact and absolute travel are not inferred. Numeric cues still come from the original
landmarks, never from retargeted geometry. Gold skin colour follows the relevant bones' vertex weights. Highlighting
is cleared outside the selected finding's measured interval, or if its required landmarks become uncertain.

- Saved `t` values are milliseconds: camera recordings use `performance.now()`, test clips use video time. Review
  subtracts the first saved frame's `t` for displayed times; data, event and attempt timestamps are not rewritten.
  Duplicate, invalid and decreasing timestamps are excluded without sorting a clock reset into a continuous take.
- `image` is unmirrored camera coordinates `[x,y,z,visibility]`; `world` contains estimated 3D coordinates. Existing
  recordings store world xyz only, so image visibility gates every body part. Missing visibility is unknown, not 1.
  The live mirrored camera is a CSS display transform, not a swap of saved left/right landmark IDs.
- The landmark view draws the actual saved joint geometry. The character view retargets reliable joint directions
  onto Y Bot proportions. Neither plays a canned user animation or shows a hidden limb in a rig's rest pose.
  Nearest real frames are used; gaps are not interpolated. Landmark figures use their own median torso length.
  Both views are centered at the hips. With forward alignment enabled, shoulder yaw is removed per frame.
  Global travel, orientation differences and absolute size are therefore not assessed in that view.
- Reference joints are sampled from the original GLB's animated hierarchy, using its translations, quaternion
  rotations and scales. The earlier of the library duration and GLB duration bounds playback, including the final
  sample. The freestyle reference remains its existing 0:00–0:04.6 clip. Library assets are read only.
- Visibility ≥0.7 and in-frame image coordinates are required. Implausible bone-length changes and abrupt world
  position jumps are withheld. These are review heuristics, not calibrated uncertainty estimates; monocular depth
  can be wrong even with high visibility. Both body anchors must be visible for a centered replay.

## Alignment and optional cues

The comparison uses eight joint angles (elbows, knees, upper arms and hips), which reduce sensitivity to body
proportions and global viewpoint. Frames are sampled at 10 Hz. Banded dynamic time warping matches monotonically
through a selected phrase, with a 25% normalized-time band and a penalty for non-diagonal steps. Phrase duration
must be 0.5–2 times the reference. At least four shared angles per matched sample, 70% temporal coverage, no long
visibility gap, and sustained variation in at least two channels are required. A large mean discrepancy rejects
the match. In feet/legs mode, each knee and hip has weight 1 and each arm angle weight 0.1. Both knees (which require
visible ankles) and at least one hip angle must be shared, and the two varying channels must be leg angles. Visible
or moving arms cannot substitute for hidden or still legs. Automatic search considers several durations inside each eligible interval and labels similarly good
alternative passages as ambiguous. It is not a movement recognizer or evidence of what the user intended.

An optional cue requires a consistent angle difference of at least 25 degrees for at least 300 ms and four distinct
source frames. Repeated DTW matches cannot manufacture evidence. The UI names the body part, recording time and
reference time, shows rounded angle estimates at the highlighted frame, and offers a conditional cue to try the
reference. Other freestyle choices are not mistakes. Insufficient evidence yields no cue.

Feet/legs mode also compares the 3D distance between ankle centers divided by each body's mean hip–knee–ankle
length. A spacing cue needs a difference of at least 0.2 leg lengths for 400 ms and five distinct visible source
frames. It offers a wider/narrower-step cue, not a floor-contact judgment. Toe direction is not scored: the GLB's
toe-base bone is not the same anatomical endpoint as MediaPipe's foot tip. This avoids mistaking a rig difference
for a foot correction. Body-relative normalization does not remove monocular depth errors.

No video or audio exists in these recordings. Music synchronization, exact dance phase, hand detail, weight
transfer, foot contact, historical restart commands and original tracker-loader failures cannot be established
from landmarks alone. This is a movement comparison, not a medical assessment.

## Attempts and recovery

New recordings have `attempts: [{id, movement, start, end, reason, endReason}]`, paired selection/restart/end events,
and `movementIntervals: [{movement, attempt, start, end}]`. A preselected movement's start is anchored to the first
recorded frame. Restart constructs a working replacement first, saves the old summary and intervals, then closes
and opens boundaries at the same timestamp. Tracker time accumulation cannot reach back across that boundary.
Zero-activity attempts remain in the boundary list. Review does not align across saved attempt boundaries.

For older recordings without boundaries, a fresh offline tracker can estimate generic activity after the saved
selection event. Its scratch data is separate from the source. Nearby activity intervals may be grouped for
navigation, but their total counts only the measured intervals. They are explicitly labeled estimates with restart
boundaries unknown. Neither a legacy attempt counter nor the coach's speech reconstructs a restart.

Tracker import/construction/runtime errors reject control actions. A failed restart leaves its previous tracker
and attempt intact. The page silences and stops streamed agent audio and drops pending replies/fallbacks after a
tracking failure, since merely filtering the final transcript would be too late. Successful restart supplies an
authoritative context update. Automated tests use in-memory agents; no paid voice session is opened by the tests.
Live and offline callers share one module loader with at most three attempts, distinct retry URLs, and no cached
failure. A persistent failure leaves manual landmark replay available without claiming activity recovery worked.

## Validation

`npm test` covers the existing engine and the added review regressions. Focused tests are
`tests/review-analysis.test.mjs` and `tests/movement-review.test.mjs`: pace and nonlinear alignment, camera rotation
and scale, absent/low-confidence/offscreen landmarks, spikes, missing frames, static false matches, sustained cues,
actual 3D replay geometry and mirroring, unchanged source data, atomic restart failures, preserved summaries and
attempt boundaries. The real 4.6-second GLB test runs when private local assets are present. UI checks can use a
saved recording as the live page's Source with coach and voice off, without opening the camera or saving over it.

`tests/review-character.test.mjs` additionally parses the real private GLB with GLTFLoader, checks independent
skinned instances, deformed skin vertices, source sampler versus animated mesh timing (including backward scrubs
from 4.6 seconds), retargeted bone directions, mirrored anatomy, canonical facing, missing-pose fallback, supported
mesh highlights, failed model loads and retry recovery. Scene-submission tests run without a GPU; these alone do
not establish browser/WebGL pixel correctness. They skip when the local model or vendored Three.js is absent.

With Playwright and Chromium installed, `node tools/check_review_browser.mjs` runs the local page in a separate
headless browser. Optional `RHYTHM_PLAYWRIGHT` and `RHYTHM_CHROMIUM` point to an existing module and executable.
It uses the saved freestyle diagnostic, checks actual WebGL submissions, playback, backward scrubbing, the 4.6 s
endpoint, mirroring, and the landmark view. Low-confidence inputs, an unskinned GLB and HTTP 404 are injected only
into browser response copies. Originals are not changed. All write requests and external requests are blocked;
camera and coach are not started. Screenshots go to the ignored `.data/review-artifacts/` directory.

## Tracking proof

A constructed tracker is now only *ready*. The first successfully processed pose adds a `tracking_started` event
and per-attempt `tracking: {updates, firstT, lastT}` evidence. Restart first requires a recent successful update
and visible pose, constructs a zero-state replacement, then closes/opens attempts. Its immediate UI/coach message
says the new attempt is ready and waiting for its first tracked pose. Failed construction/update/lost callbacks
cannot record tracking success or partial movement intervals. The coach is stopped on tracker failure; the raw
pose recording remains available. Interval writes are clipped to their saved attempt boundaries. Dance live
status contains no timer. Older sessions have activity intervals as evidence, but no new per-frame processing log.

## Phase validation

Average pose similarity is insufficient: the original search matched relatively straight legs to several phases
of the dance and attached a knee correction to the cheapest path. The updated alignment compares the forward
reference with a time-reversed reference under the same DTW constraints. A forward advantage below 3 degrees of
weighted mean joint discrepancy withholds timing-specific cues. This is a conservative rejection heuristic, not
a calibrated confidence score or proof of the intended dance phase. It can reject legitimate symmetric phrases.

For a retained candidate, a forward/backward cost calculation finds all reference times lying on complete paths
within max(0.18, 2.5% of optimal accumulated cost) of the optimum. Each correction must retain its direction and
exceed its threshold across that envelope for the existing minimum run length. This suppresses changes caused
by small plausible timing shifts. Multiple similarly scored passages are presented as alternatives, not a unique
match. Search uses the existing 0.75/1/1.25/1.5 duration grid and 500 ms start grid; an unsuccessful search is not
proof that no corresponding phrase exists. In leg mode, hips help alignment but feedback is limited to knees and
ankle separation, with at most two optional cues. The original full-body mode is still available.

## Bend-order timing

The reference has four distinct leg events: right bend (0:00.0), left lift (0:00.8), second left lift while turning to its right (0:01.7), deep right fold
(0:02.7), then a wide step. User knee bends are detected on the saved ~30 Hz frames with their side, minimum knee
angle, shoulder-line turn and foot rise. Foot rise is the height of one ankle above the other divided by leg length,
in image y for the user (no depth estimate) and world y for the reference. A phrase is anchored when at least three
consecutive user bends follow consecutive reference bends in side order, at one plausible pace (each gap 0.6–2.2×,
within 2.2× of each other), turning the same way where the reference turns by ≥15°. Mirrored orders are labelled
and give no side cue. The reference time is piecewise linear between matched bend peaks.

A matched bend gives a cue only when the knee is ≥25° less bent **and** the foot is ≥0.1 leg lengths lower than the
reference's matching bend, with both ankles visible. A bend is `hidden`, and never a cue, when an uncertain frame
within 300 ms has a raw knee estimate ≥10° deeper than the measured minimum. Deeper bends or higher feet are
freestyle choices. The highlight is the measured bend only.

Numeric findings are computed from each local recording. Personal session reports, recording files, screenshots
and exported videos remain in ignored data folders and are not included in the repository.

```sh
RHYTHM_SESSION_DIR=/path/to/private/results/live npm test
node tools/review_recordings.mjs /path/to/first.json /path/to/new.json
node tools/render_review_videos.mjs /path/to/output /path/to/jobs.json
```

The optional real-recording regressions require their documented local fixtures; absent fixtures are skipped.
Synthetic tests cover order/pace/turn anchoring, shallower versus deeper lifts, disagreeing measures, hidden bends,
mirrored copies, alternating steps, restart-bounded phrases, pinned DTW edges and side ambiguity.
