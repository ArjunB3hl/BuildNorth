// The form of a movement done in motion (web/js/moves.js, tracks 'moving' and 'rhythm'): a few guard rails for each
// movement, every one a clear, measurable mistake (never a matter of style), raised only once it lasts or comes back
// cycle after cycle, one correction at a time, and its fix noticed. The same job web/js/holdform.js does for a held
// pose, with the same semantics, for a body that moves. Pure ES module (no DOM): the page and the Node tests share it.
//
//   const m = bodyMetrics(world, image, aspect)        // one frame's measures (MediaPipe world + image landmarks)
//   const mf = new MoveForm({ key })                   // a MOVE_FORMS key; mf.reset() when the movement starts afresh
//   events = mf.update(m, lm, tMs, cycle, moving)      // [{type: 'form_fault', fault, label, measured, target, cue,
//                                                      //   part, side, seen} | {type: 'form_fix', fault, label} |
//                                                      //   {type: 'form_unseen', missing, parts, why, cue} (below)]
//   mf.state()                                         // now: {checked, open, pending, unseen, wrongView}
//   mf.summary()                                       // so far: {checked, faults: [{fault, label, fixed, told}]}
//   mf.settle(tMs)                                     // what is open counts as told now (HoldForm settle())
//
// update(m, lm, t, cycle, moving): `m` bodyMetrics of the frame (null: nobody), `lm` its landmarks {world, image,
// aspect} (for a check that needs more than the metrics), `t` its time in ms, `cycle` (rhythm only) the half cycle the
// rhythm signal completed on this frame (null on most frames: below), `moving` whether the person is moving now (the
// tracker's measure: omitted, true). A form_fault's `seen` {from, to}: the span of frame times (ms, the clock of `t`)
// its verdict rests on, to replay as what was measured (the event itself may come seconds later: a turn is confirmed
// after it): a frame check's last FAULT_MS of bad frames; a cycle check's SEEN_MS around the frame its value came
// from (the extreme's, or the one of the largest or smallest `take`), no later than the event.
// state(), summary() and settle() mean what HoldForm's do: `open` the faults told and not fixed, the latest told
// first, each with {fault, label, measured, target, cue, part, side, seen}; `checked` the
// names of the checks measured lately and fine; `pending` measured as faults and not told yet (waiting their turn);
// `unseen` their parts out of the frame; `wrongView` measurable only from another view. A check waiting for its first
// cycle, or for the warm-up, is in none of them.
//
// The checks. MOVE_FORMS maps a movement's key (library.json `key`) to its checks: the four groups' files in
// web/js/moveforms/ (arms.js, legs.js, transitions.js, flow.js), each exporting such a map by default, merged here. A
// group file imports nothing from this one (this one imports it: in a circular import its constants would not be set
// yet there), so its few helpers are its own. A check:
//   id        the fault's code (unique within the movement)
//   name      what it checks, a few words ("elbows at your sides"): state().checked lists these
//   label     the fault, a few words ("elbows drifting off the sides")
//   part      the body part to show in red: a name of formcheck.js bonesFor and retarget.js faultBones
//   side(m, lm)  for a part on one side of the body: which, 'L' or 'R' (null: both), on the frame's metrics and
//             landmarks (a cycle check: its extreme's frame's) (optional)
//   needs     parts of bodyMetrics `seen` that must be in view (SEEN_PARTS)
//   views     the views it can be judged from (optional: any); a check in the body's frontal plane: FRONTAL
//   at        'frame': judged on every frame; 'peak' or 'trough': once per cycle, at the rhythm signal's highest or
//             lowest point (its `rhythm.signal` in the library: which end is which depends on that signal)
//   still     (frame only, optional) true: judged on frames not moving too, with no warm-up and through pauses, once
//             the person has moved at all since the movement was named: its `phase` is what keeps a person at rest
//             out. Its phase starting to hold, its samples start afresh and its first SETTLE_MS are not judged
//   smoothMs, faultMs  (frame only, optional) its own SMOOTH_MS and FAULT_MS: a gesture held about a second (a
//             dance's), which the defaults' second of smoothing and 1.5 s of bad frames never tell
//   take      (peak and trough only, optional) 'at' (default): the value at the extreme, the median of its frames
//             within PEAK_MS / 2 of it; 'max' / 'min': the largest / smallest value over `over`, each frame's value
//             the median of it and its neighbours
//   over      (with take 'max' or 'min', optional) 'half' (default): the half cycle leading to the extreme (from the
//             turn before it), judged only with a frame of it near the extreme; 'cycle': the whole cycle, since the
//             turn of the same kind before (both halves: a kick or a knee drive between the signal's turns), all of
//             it in this run of movement, judged when any frame of it passes `phase` (none need be near the turn)
//   phase(m, lm)  only frames where it holds are judged (optional; a peak check: those around its extreme)
//   value(m, lm)  the measure (a number; null or NaN: not measurable on this frame, as out of view)
//   bad(v), ok(v) the fault, and fixed (a little inside `bad`, so a value on the line does not flicker)
//   measured(v)   the value in words ("elbow 52 degrees out from your side"); target, cue (the spoken fix) strings
//   order     priority: the lowest is told first; after (optional) ids of checks that, while faulted, hold this one
//             back (one fault is not told twice in other words)
//
// When a check is judged. Never while the person is still or paused, nor in the warm-up: a run of movement starts on
// the first frame `moving` after the movement was named (reset) or after a pause (not moving, or nobody, for PAUSE_MS),
// and its first WARM_MS are not judged (getting into it, finding the rhythm). Never on a frame with its parts out of
// view (`needs`) or from a view it cannot be judged from (`views`), nor where its `phase` does not hold.
//   'frame': judged on its value smoothed (the median over SMOOTH_MS of the frames it was judged on). Bad FAULT_MS in a
//   row (of frames judged): a fault; ok FIX_MS in a row, once a fault: fixed. A frame not judged changes neither.
//   A still check: on every frame its parts are in view from the right view and its phase holds, moving or not,
//   from the first movement since the movement was named; a run, a pause or the warm-up are not its business.
//   'peak' / 'trough': judged once per cycle the tracker hands over (moves.js: on each turn of the rhythm signal that
//   CycleCounter confirms), on the frames buffered around the extreme or over the cycle (`take`, `over`); a turn
//   whose extreme came in the warm-up or before a pause since is not judged, nor one without a frame to judge. Bad on
//   CYCLES_BAD of the last CYCLES_OF cycles judged: a fault; ok on the last CYCLES_OK, once a fault: fixed (as
//   engine.js's cues: 2 of the last 3 reps, and the last 2 clean). Only the verdicts of the last VERDICT_PERIODS
//   periods count (the cycles' periodMs; VERDICT_MIN_MS at least), none from before a pause: older ones go, and a
//   fault not told yet goes with them. The extreme's frames need not be `moving` (a turn dwells at its far end).
// A pause is PAUSE_MS not moving, or for a rhythm still turning, PAUSE_PERIODS of the period its turns show (twice
// the median time between its last turns, at most PAUSE_BOUND_PERIODS of the rhythm's own periodMs), at most
// PAUSE_MAX_MS: a slow rep's hold at its far end goes on the set; a stop longer than that is a pause.
// One correction at a time, as HoldForm: the most important fault not told yet, NEXT_MS after the last one told (or
// AFTER_FIX_MS after the last fix, for the praise), each at most once unless it was fixed and came back; a frame check
// is told on a frame it was judged on, a cycle check on a cycle it was judged bad on (`measured` and `side` are that
// frame's or that cycle's). A new run (after a pause) starts the checks afresh but the still ones: a fault told stays
// open until fixed, one not told yet goes.
//
// The cycle (rhythm only), as moves.js hands it over on the frame CycleCounter confirms a turn (the signal came back by
// its prominence from an extreme, a little after the extreme itself):
//   {kind: 'peak' | 'trough' (the signal's highest or lowest point), t (that extreme's frame time, ms), v (the
//    signal's smoothed value there), from (the turn before: the half cycle is from..t; where the count restarted,
//    if none), cycleFrom (the turn of the same kind before: the whole cycle is cycleFrom..t; else `from`), far (the
//    far end of the movement: where a cycle is counted; else the near end, where it started), counted (a cycle was
//    counted at it), wobble (a far end sooner than minPeriodS after the last count: no cycle, never judged), count
//    (cycles so far), signal (its name), periodMs (the rhythm's period, 2 x minPeriodS: the verdicts expire by it)}
//
// A movement without an entry in MOVE_FORMS has no form check: the tracker says so (form: null), and the coach must
// not call it right or wrong. Without landmarks, nothing is measured (form: null too).

import { SEEN } from './holdform.js';
import ARMS from './moveforms/arms.js';
import LEGS from './moveforms/legs.js';
import TRANSITIONS from './moveforms/transitions.js';
import FLOW from './moveforms/flow.js';

/** Each group's checks, by movement key (the tests check that no key is in two groups). */
export const MOVE_FORM_GROUPS = { arms: ARMS, legs: LEGS, transitions: TRANSITIONS, flow: FLOW };
/** The checks of every movement: the groups merged. */
export const MOVE_FORMS = Object.assign({}, ...Object.values(MOVE_FORM_GROUPS));

/** BlazePose landmarks used here, by side. */
const SIDE = {
  L: { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 },
  R: { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 },
};
const other = s => (s === 'L' ? 'R' : 'L');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const flat = a => [a[0], 0, a[2]];                                // the horizontal part (world y is vertical)
const unit = a => { const n = len(a); return n > 1e-9 ? a.map(x => x / n) : null; };
const DEG = 180 / Math.PI;
/** Angle between two vectors, degrees (NaN for a zero vector). */
const between = (a, b) => {
  const n = len(a) * len(b);
  return n ? Math.acos(Math.max(-1, Math.min(1, dot(a, b) / n))) * DEG : NaN;
};
const UP = [0, -1, 0], DOWN = [0, 1, 0];          // world landmarks: y points down

/** The parts bodyMetrics `seen` names (a check's `needs`): one arm (shoulder, elbow, wrist), one leg (hip, knee,
 * ankle), both of either, the trunk (shoulders and hips) and the head (the nose). */
export const SEEN_PARTS = ['armL', 'armR', 'arms', 'legL', 'legR', 'legs', 'trunk', 'head'];
/** The views a check in the body's frontal plane (side to side, up and down) can be judged from: from the side it lies
 * in depth, where MediaPipe guesses. */
export const FRONTAL = ['front', 'angled'];
export const VIEWS = ['front', 'angled', 'side'];

/** One frame's measures of the body, from MediaPipe landmarks: `world` [{x, y, z}] metres around the hips (y down; x
 * the person's left for a camera in front of them, smaller z nearer the camera), `image` [{x, y, visibility}]
 * normalised to the picture, `aspect` its width over its height. As holdform.js poseMetrics: angles in degrees of the
 * world landmarks (3D, so they hold from any view, with depth guessed), lengths in leg lengths (hip to knee to ankle,
 * the two legs' mean) or torso lengths (the hips' middle to the shoulders'), so they do not depend on the person's size
 * or the camera's distance. Per side, `...L` and `...R` as MediaPipe names the landmarks (the person's own left and
 * right); a check that takes either side takes the larger or smaller of the two (and its side() says which), so the
 * movement done on the other side counts the same. Signed measures are signed toward the person's left or forward.
 * Null without landmarks.
 *
 *   kneeL/R            knee, hip to knee to ankle (180: straight)
 *   elbowL/R           elbow, shoulder to elbow to wrist (180: straight)
 *   hipL/R             hip, shoulder to hip to knee (180: standing straight; smaller: folded), as engine.js hipL
 *   armL/R             the upper arm from the torso: at the shoulder, between the elbow and that side's hip (0: down
 *                      by the side, 90: out level, 180: overhead; any plane), as engine.js armL. The SMPL skeletons'
 *                      arms hanging read 10-20 (the shoulder joint sits outside the hip)
 *   armFromDownL/R     the upper arm (shoulder to elbow) from straight down (0: hanging, 90: level, 180: straight up)
 *   armPlaneL/R        where the upper arm points in the horizontal plane, against the shoulders' line (0: out to the
 *                      side, 90: forward or back), as engine.js armPlane; NaN with the upper arm within about 10 deg of
 *                      vertical (its horizontal part under 5 cm: no direction to tell)
 *   thighFromDownL/R   the thigh (hip to knee) from straight down (0: standing, 90: thigh level, as a knee raise's top)
 *   thighPlaneL/R      the thigh's direction in the horizontal plane, against the hips' line (0: out to the side, 90:
 *                      forward or back); NaN with the thigh near vertical, as armPlane
 *   wristUpL/R         the wrist above its shoulder, in torso lengths (0: level with it; -1 about at the hip). World
 *                      heights, not engine.js's wristUp (on screen, in body lengths): the numbers differ
 *   wristOverHeadL/R   the wrist above the head (the nose), in torso lengths (positive: above it)
 *   ankleUpL/R         the ankle above the other one, in leg lengths (0: both down; one is minus the other)
 *   pelvisTilt         the hips' line from level, signed: positive with the left hip higher
 *   shoulderTilt       the shoulders' line from level, signed: positive with the left shoulder higher
 *   trunkTilt          the trunk (hips' middle to shoulders') from upright, any direction, as holdform.js trunkTilt
 *   trunkLeanFwd       the trunk's lean forward (negative: back), in the plane straight ahead (0: upright, 90: level,
 *                      over 90: the head below the hips, as a forward fold)
 *   trunkLeanSide      the trunk's lean to the side, out of that plane (positive: to the person's left)
 *   trunkTwist         the shoulders' line turned against the hips' line, seen from above (0: square)
 *   stance             the ankles apart, in leg lengths (3D, as holdform.js stance)
 *   stanceWidth        ...side to side only (along the hips' line), in leg lengths
 *   kneeGap            the knees apart over the ankles apart, side to side (along the hips' line): under 1, the knees
 *                      closer together than the feet (knees caving in), as engine.js kneeToAnkleGap (0.8 its squat's
 *                      line); NaN with the ankles under 0.15 leg lengths apart (feet together, where the ratio is
 *                      noise: the Bharatanatyam reference stands at 0.14-0.15)
 *   legLen, torsoLen   metres (world)
 *   footImgY           the lower ankle's height in the picture (normalised, y down), bodyScaleImg the body's size
 *                      on screen (engine.js's body scale: the largest of the trunk from the ears, 1.5 shoulder widths
 *                      and 1.1 shins), and steadyScaleImg the same without the shoulders' width, which the arms raised
 *                      narrow (the trunk from the ears, or the shins): MoveForm finds the floor with them (feetLift,
 *                      airborne)
 *   view, frontness    as engine.js: 'front', 'angled' or 'side' by the shoulders' or hips' width on screen over the
 *                      torso's length (frontness)
 *   seen               {armL, armR, arms, legL, legR, legs, trunk, head}: every landmark of the part in the frame and
 *                      seen (visibility SEEN or more); as engine.js vis(), one outside the frame is unseen whatever
 *                      its score
 * MoveForm adds, from the frames before (both legs seen): feetLift, the lower ankle above the floor in body lengths
 * (the floor: where the lower ankle sat on most of the last FLOOR_MS; a body length: engine.js's body scale at its
 * largest over them, as with the arms down), and airborne, true with both feet clearly off it (feetLift AIRBORNE or
 * more), false, or null (not known: the legs unseen, too few frames, or the person nearer or further from the camera
 * than over those frames, by steadyScaleImg). Approximate: a step back from the camera lifts the feet on screen too; a
 * check should only use it with its persistence. */
export function bodyMetrics(world, image, aspect = 16 / 9) {
  if (!world || !image || world.length < 29 || image.length < 29) return null;
  const W = i => [world[i].x, world[i].y, world[i].z ?? 0];
  const inFrame = p => p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.985;
  const vis = i => (inFrame(image[i]) ? image[i].visibility ?? 1 : 0);
  const seenAll = ids => ids.every(i => vis(i) >= SEEN);
  const S = s => SIDE[s];
  const legOf = s => len(sub(W(S(s).hip), W(S(s).kn))) + len(sub(W(S(s).kn), W(S(s).an)));
  const leg = (legOf('L') + legOf('R')) / 2 || 1e-6;
  const hipMid = mid(W(23), W(24)), trunk = sub(mid(W(11), W(12)), hipMid), torso = len(trunk) || 1e-6;
  const hipLine = sub(W(23), W(24)), shoulderLine = sub(W(11), W(12));        // right to left
  // the body's own axes: its left along the hips' line (level), forward square to it (towards a camera it faces)
  const left = unit(flat(hipLine)) ?? unit(flat(shoulderLine)) ?? [1, 0, 0];
  const fwd = cross(left, UP);
  const tilt = line => Math.atan2(-line[1], Math.hypot(line[0], line[2])) * DEG;   // the left end up: positive
  // a direction in the horizontal plane against a line, folded to 0-90 (forward and back alike); NaN near vertical
  const plane = (v, line) => {
    const a = flat(v), b = flat(line);
    return len(a) > 0.05 && len(b) > 0 ? Math.acos(Math.min(1, Math.abs(dot(a, b)) / (len(a) * len(b)))) * DEG : NaN;
  };
  const across = (a, b) => Math.abs(dot(sub(W(a), W(b)), left));               // apart along the hips' line
  const out = {};
  for (const s of ['L', 'R']) {
    const { sh, el, wr, hip, kn, an } = S(s), o = S(other(s));
    out[`knee${s}`] = between(sub(W(hip), W(kn)), sub(W(an), W(kn)));
    out[`elbow${s}`] = between(sub(W(sh), W(el)), sub(W(wr), W(el)));
    out[`hip${s}`] = between(sub(W(sh), W(hip)), sub(W(kn), W(hip)));
    out[`arm${s}`] = between(sub(W(hip), W(sh)), sub(W(el), W(sh)));
    out[`armFromDown${s}`] = between(sub(W(el), W(sh)), DOWN);
    out[`armPlane${s}`] = plane(sub(W(el), W(sh)), shoulderLine);
    out[`thighFromDown${s}`] = between(sub(W(kn), W(hip)), DOWN);
    out[`thighPlane${s}`] = plane(sub(W(kn), W(hip)), hipLine);
    out[`wristUp${s}`] = (W(sh)[1] - W(wr)[1]) / torso;
    out[`wristOverHead${s}`] = (W(0)[1] - W(wr)[1]) / torso;
    out[`ankleUp${s}`] = (W(o.an)[1] - W(an)[1]) / leg;
  }
  const ankleGap = across(27, 28);
  // the body's size on screen, as engine.js features() (the trunk from the ears, which raising the arms does not move;
  // the shoulders' width; the shins), aspect-corrected units
  const I = i => ({ x: image[i].x * aspect, y: image[i].y });
  const iMid = (a, b) => ({ x: (I(a).x + I(b).x) / 2, y: (I(a).y + I(b).y) / 2 });
  const iSh = iMid(11, 12), iHp = iMid(23, 24), iEar = iMid(7, 8);
  const iShW = Math.abs(I(11).x - I(12).x), iHipW = Math.abs(I(23).x - I(24).x);
  const iTorso = Math.hypot(iSh.x - iHp.x, iSh.y - iHp.y) || 1e-6;
  const dist = (a, b) => Math.hypot(I(a).x - I(b).x, I(a).y - I(b).y);
  const shin = (dist(25, 27) + dist(26, 28)) / 2;
  const iTrunk = Math.max(vis(7), vis(8)) >= 0.5 ? 0.72 * Math.hypot(iEar.x - iHp.x, iEar.y - iHp.y) : iTorso;
  const frontness = Math.max(iShW, iHipW) / iTorso;
  const arm = s => [S(s).sh, S(s).el, S(s).wr], legIds = s => [S(s).hip, S(s).kn, S(s).an];
  const seen = { armL: seenAll(arm('L')), armR: seenAll(arm('R')), legL: seenAll(legIds('L')),
    legR: seenAll(legIds('R')), trunk: seenAll([11, 12, 23, 24]), head: seenAll([0]) };
  seen.arms = seen.armL && seen.armR; seen.legs = seen.legL && seen.legR;
  return {
    ...out,
    pelvisTilt: tilt(hipLine), shoulderTilt: tilt(shoulderLine),
    trunkTilt: between(trunk, UP),
    trunkLeanFwd: Math.atan2(dot(trunk, fwd), dot(trunk, UP)) * DEG,
    trunkLeanSide: Math.asin(Math.max(-1, Math.min(1, dot(trunk, left) / torso))) * DEG,
    trunkTwist: between(flat(shoulderLine), flat(hipLine)),
    stance: len(sub(W(27), W(28))) / leg, stanceWidth: ankleGap / leg,
    kneeGap: ankleGap >= 0.15 * leg ? across(25, 26) / ankleGap : NaN,
    legLen: leg, torsoLen: torso,
    footImgY: Math.max(image[27].y, image[28].y), bodyScaleImg: Math.max(iTrunk, 1.5 * iShW, 1.1 * shin) || 1e-6,
    steadyScaleImg: Math.max(iTrunk, 1.1 * shin) || 1e-6,
    view: frontness > 0.45 ? 'front' : frontness < 0.22 ? 'side' : 'angled', frontness, seen,
  };
}

export const MOVE_TUNING = {
  // as a held pose's (holdform.js FORM_TUNING, where the numbers are measured): MediaPipe jitters by a few degrees and
  // a landmark glitches for a frame or two, so a frame check's value is the median of its last SMOOTH_MS of frames, a
  // fault lasts FAULT_MS before it is one and its fix FIX_MS; NEXT_MS between corrections, AFTER_FIX_MS after a fix
  SMOOTH_MS: 1000, FAULT_MS: 1500, FIX_MS: 1500, NEXT_MS: 8000, AFTER_FIX_MS: 2500,
  // the start of a run of movement is not judged: getting into the movement and finding its rhythm (the user asked for
  // about 3 s). Not live-measured yet: no recording of these movements has landmarks
  WARM_MS: 3000,
  // not moving (or nobody) this long is a pause, and the next movement a new run (warm-up again). Longer than a slow
  // movement's dwell at its far end: the shoulder rotation's reference, played out and back at its own pace, drifts
  // its last 0.4 shoulder widths there and reads not moving for 3.3 s (moves.js: the signal swinging too little). A
  // real rest lasts longer; a frame check is never judged on a frame not moving anyway
  PAUSE_MS: 5000,
  // ...or, while a rhythm keeps turning, PAUSE_PERIODS of its period as the turns show it (twice the median time
  // between its last turns), at most PAUSE_MAX_MS: a slow rep's hold at its far end is no pause. Played slower than
  // their own pace the references dwell longer at their ends: at 0.8 times its pace the shoulder rotation's (0.6 the
  // Y-to-W's) read still past PAUSE_MS at every far end, each turn fell in a new run's warm-up, and nothing was judged
  PAUSE_PERIODS: 1, PAUSE_MAX_MS: 12000,
  // ...that period no longer than PAUSE_BOUND_PERIODS of the rhythm's own (the cycles' periodMs, 2 x minPeriodS): turns
  // far apart are sets apart, not one slow set. On the user's recordings, two sets of 2-3 jumping jacks 9-10 s apart,
  // named as the step touch, showed a period of 9-10 s, and the user standing 5-7 s between them was no pause (by 4 of
  // its periods, 5 s, it is one). 4, not 3: by 3 the shoulder rotation's bound is 9 s and the Y-to-W's 7.8 s, under
  // their holds at their far end played at half their pace (11.3 and 8.3 s), and neither was judged there again
  PAUSE_BOUND_PERIODS: 4,
  // a cycle check's value (`take` 'at'): the median of its frames within PEAK_MS / 2 of the extreme (5 frames at 30
  // fps; at 4-8 fps the frame nearest it): a single frame's glitch does not make a cycle bad
  PEAK_MS: 300,
  // a still check's phase starting to hold: its first SETTLE_MS not judged (a reach on its way up): with the flow's
  // reach judged on still frames too and no settle, a fault put into its reference was never seen fixed at 1.5 and 2
  // times its pace (each reach's first frames read short, breaking the fix's time ok)
  SETTLE_MS: 300,
  CYCLES_BAD: 2, CYCLES_OF: 3, CYCLES_OK: 2,   // as engine.js: a fault on 2 of the last 3 reps; fixed: the last 2 clean
  // ...of the cycles judged within VERDICT_PERIODS of the rhythm's period (2 x minPeriodS: the cycles' periodMs), at
  // least VERDICT_MIN_MS: older verdicts, and those from before a pause, count no more. On the user's recordings, with
  // a movement named, 2 bad of the last 3 joined cycles 14-70 s apart. The slowest reference played out and back at its
  // own pace, the Y-to-W raise, turns every 10.9 s (the shoulder rotation, from where its hands start apart, 8.7 s),
  // while the build caps minPeriodS at 1.5 s: a period of 3 s at most, so the 12 s floor is what holds for now
  VERDICT_PERIODS: 3, VERDICT_MIN_MS: 12000,
  // frames kept for the cycle checks: a half cycle (the slowest reference's out-and-back takes 7 s) and the turn's
  // confirmation after it (the signal coming back by its prominence)
  KEEP_MS: 15000,
  // the floor (feetLift, airborne): where the lower ankle sat on most of the last FLOOR_MS of frames, at each distance
  // from the camera (withFloor: its height in the picture against the body's size on screen, a straight line, and the
  // 80th percentile of the frames off it: low in the picture, so a person hopping half the time still stands on it),
  // over frames taken within FLOOR_NEAR of their median size; in the air from AIRBORNE body lengths up (engine.js's
  // jump: both feet clearly off the floor from 0.15). FLOOR_NEAR was 0.1 when the floor was one height for all of them
  FLOOR_MS: 4000, FLOOR_NEAR: 0.25, AIRBORNE: 0.15,
  // ...the line's slope (picture heights of the floor per picture height of the body's size: the camera's height over
  // the steady size's body length, about 3 for a camera 1.5 m up) within 0-FLOOR_SLOPE_MAX, and none when the sizes
  // spread (their range over their median) less than FLOOR_SPREAD: not enough of a change of distance to fit
  FLOOR_SLOPE_MAX: 4, FLOOR_SPREAD: 0.02,
  // a cycle fault's `seen`: the SEEN_MS of frames around the frame its value came from (the page replays them: the
  // turn is confirmed later, the shoulder rotation's 3.3 s after its peak at its own pace, so the moments before the
  // event may hold nothing of what was measured)
  SEEN_MS: 1500,
};
const DT_MAX = 300;       // a frame stands for the time since the one before, at most this (as moves.js)

// --- form_unseen: the form not checked at all, said out loud --------------------------------------------------------
// While the person does the movement and every check of it is out of view or seen from the wrong side, the form is
// not checked at all, and the Now card's "step back" line is easy to miss (the user did a 46 s set of the standing side
// crunch, feet out of the picture, its one check unseen throughout, and never saw it). form_unseen says so once it
// lasts: {missing: the checks' names, parts: the body parts out of view (outOfView), why: 'frame' (out of the picture:
// stepping back shows them) | 'view' (side-on: turning to the camera does), cue: the words to say}. Some checks seen,
// none: the Now card has it.
export const UNSEEN_TUNING = {
  // a moving or rhythm movement, a part its checks need out of the picture ('frame'): this long with the person
  // standing in it (the trunk and the knees in view, a hip straight: STAND_HIP), no check judged meanwhile, moving or
  // not. "Moving" cannot be judged there: on the user's second side crunch, the feet below the picture, the stillness
  // measure read the sweeps still on 70-100% of frames (its leg channels need the legs in view) and the rhythm, the
  // feet's spread, never turned; and a check of the lifted leg saw it on the frames its ankle rose into the picture,
  // never judged (no turns), so not every check was unseen. Never sooner than this after the movement is named
  FRAME_WAIT_MS: 5000,
  // standing, not sitting at the laptop: the straighter hip (shoulder to hip to knee) this open or more. Standing with
  // the feet cut off the user read 152-175 deg (the side crunches, standing still), sitting at the laptop 63 (knees in
  // the picture; mostly they are not)
  STAND_HIP: 140,
  // Brief continuity after standing was actually seen: the latest recording loses hips and knees together for
  // about 9 s. This only permits a framing request, never a form verdict or a count on inferred legs.
  STAND_RECENT_MS: 10000,
  // ...side-on ('view': every check judged facing the camera only): this much of the movement (frames moving, after
  // the run's warm-up), or this many turns of its rhythm meanwhile; a hold: this long after it was told (hold_start)
  WAIT_MS: 6000, WAIT_TURNS: 3, HOLD_WAIT_MS: 4000,
  EVERY_MS: 30000,        // ...at most once every EVERY_MS while it lasts
  SEEN_MS: 1000,          // ...and again, sooner, once every check has been seen this long (a frame or two is a glitch)
};

/** The landmarks each part of bodyMetrics `seen` (a check's `needs`) takes in. */
export const NEEDS_LANDMARKS = { armL: [11, 13, 15], armR: [12, 14, 16], arms: [11, 13, 15, 12, 14, 16],
  legL: [23, 25, 27], legR: [24, 26, 28], legs: [23, 25, 27, 24, 26, 28], trunk: [11, 12, 23, 24], head: [0] };
// body parts as the user is asked to show them, top to bottom: the landmarks out of view (any of them) that name each;
// a limb's end alone (the wrists, the ankles) is the hands or the feet, the elbows or knees with it the arms or legs
const SPOKEN = [['head', [0]], ['shoulders', [11, 12]], ['arms', [13, 14]], ['hands', [15, 16]], ['hips', [23, 24]],
  ['legs', [25, 26]], ['feet', [27, 28]]];
const COVERS = { arms: 'hands', legs: 'feet' };
/** The body parts out of view among landmarks `ids`, on a frame's image landmarks: out of the frame or barely seen
 * (engine.js's in-frame rule, and SEEN, as `seen`), as the user is asked to show them ('feet', 'legs', 'hands',
 * 'arms', 'hips', 'shoulders', 'head'; the legs cover the feet, the arms the hands). */
export function outOfView(image, ids) {
  if (!image) return [];
  const inFrame = p => p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.985;
  const out = i => !(image[i] && inFrame(image[i]) && (image[i].visibility ?? 1) >= SEEN);
  const want = new Set(ids), parts = SPOKEN.filter(([, lm]) => lm.some(i => want.has(i) && out(i))).map(([p]) => p);
  return parts.filter(p => !Object.entries(COVERS).some(([big, small]) => small === p && parts.includes(big)));
}
const listed = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');
/** What to say: step back to show `parts` ('frame'), or turn to the camera ('view'). */
export function unseenCue(why, parts) {
  if (why === 'view') return 'Turn to face the camera so I can check your form.';
  return `Step back so I can see ${parts.length ? `your ${listed(parts)}` : 'all of you'}: I can't check your form.`;
}

/** When to say form_unseen: update() each frame with whether every check is unseen or from the wrong view (`blind`),
 * none is (`seen`), the frame counts towards the wait (`active`: doing the movement), and a turn of the rhythm on it;
 * true: say it now. The wait (`waitMs`, or `waitTurns` turns) counts frames both blind and active; after it is said,
 * again EVERY_MS later at the earliest, or once every check has been seen SEEN_MS and then not again. */
export class UnseenWatch {
  constructor(tuning = {}) { this.k = { ...UNSEEN_TUNING, ...tuning }; this.reset(); }
  reset() { this.saidT = -Infinity; this.spell(); }
  /** A new wait (a new hold): what was said still counts towards EVERY_MS. */
  spell() { this.blindMs = 0; this.turns = 0; this.seenMs = 0; }
  update(t, dt, { blind, seen, active, turn = false, waitMs, waitTurns = Infinity, ready = true }) {
    const k = this.k;
    if (seen) {
      this.seenMs += dt;
      if (this.seenMs >= k.SEEN_MS) { this.blindMs = 0; this.turns = 0; this.saidT = -Infinity; }
      return false;
    }
    this.seenMs = 0;
    if (!blind || !active) return false;              // (partly seen, or not doing it: the wait waits)
    this.blindMs += dt;
    if (turn) this.turns += 1;
    if ((this.blindMs < waitMs && this.turns < waitTurns) || !ready) return false;   // (ready: what to say holds)
    if (t - this.saidT < k.EVERY_MS) return false;
    this.saidT = t; this.blindMs = 0; this.turns = 0;
    return true;
  }
}

/** Standing in the picture, as setup guidance needs to tell from sitting at the laptop or walking up to it: the
 * shoulders, the hips and the knees in it and seen (engine.js's in-frame rule, SEEN), and the straighter hip open
 * `hip` deg or more (metrics `m`). */
export function standingInPicture(m, image, hip) {
  if (!m || !image) return false;
  const inFrame = p => p && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.985 && (p.visibility ?? 1) >= SEEN;
  return [11, 12, 23, 24, 25, 26].every(i => inFrame(image[i])) && Math.max(m.hipL, m.hipR) >= hip;
}

/** form_unseen's fields, for checks `checks` whose statuses on this frame are `nows` ('unseen' or 'view' each) and
 * landmarks `ids`, on image landmarks `image`. */
export function unseenEvent(checks, nows, ids, image) {
  const why = nows.some(x => x === 'unseen') ? 'frame' : 'view';
  const parts = why === 'frame' ? outOfView(image, ids) : [];
  return { missing: checks.map(c => c.name), parts, why, cue: unseenCue(why, parts) };
}

const median = v => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
const finite = x => typeof x === 'number' && Number.isFinite(x);
/** The user's side as a fault names it: 'left', 'right' or null. */
const sideName = s => (s === 'L' ? 'left' : s === 'R' ? 'right' : null);
const isCycle = c => c.at === 'peak' || c.at === 'trough';

export class MoveForm {
  constructor({ key, tuning = {}, forms = MOVE_FORMS } = {}) {
    if (!forms[key]) throw new Error(`no form check for ${key}`);
    this.key = key; this.k = { ...MOVE_TUNING, ...tuning };
    this.checks = [...forms[key]].sort((a, b) => a.order - b.order);
    this.reset();
  }

  /** The movement starts afresh (named again): nothing measured, nothing told, the warm-up to come. */
  reset() {
    // per check: why it was not judged on the last frame (`now`: 'unseen', 'view', 'still', 'warm', 'phase', 'settle'
    // or 'measured'), the last frame its parts could be judged on (okT: phase aside), the last time it was judged
    // (measuredT: a frame, or a cycle); its value (frame: the median of `samples`, the last SMOOTH_MS of frames judged;
    // cycle: the last cycle's), the time bad or ok in a row (frame) or the last cycles' verdicts (`hist`: 'bad', 'ok',
    // 'line', judged at `histT`), whether it is a fault (present), told (and not fixed since; `side` as told), ever
    // told, ever measured; a frame check's phase: when it began holding and when it last held (phaseFrom, phaseT); a
    // cycle check's frames buffered (`frames` {t, v, m, lm}) and the side on its last cycle's extreme
    this.s = Object.fromEntries(this.checks.map(c => [c.id, { now: 'unseen', okT: null, measuredT: null, samples: [],
      value: NaN, badMs: 0, okMs: 0, hist: [], histT: [], frames: [], cycleSide: null, phaseFrom: null, phaseT: null,
      bad: [], badSum: 0, cycleSeen: null, seen: null,
      present: false, told: false, toldT: null, side: null, everTold: false, measuredEver: false }]));
    this.lastT = null; this.lastToldT = -Infinity; this.lastFixT = -Infinity;
    // the run of movement under way: when it started (null: none yet: the person has not moved since the movement was
    // named), and when the frames stopped moving (null: moving); the floor's frames {t, y, scale, steady}; the
    // rhythm's period (the cycles' periodMs: their verdicts expire by it), and its last turns' times (the period they
    // show: the pause stretches to it)
    this.runStart = null; this.stillFrom = null; this.floor = []; this.periodMs = 0;
    this.turnTs = [];
    this.unseen = new UnseenWatch();
    this.standingT = null;
  }

  /** How long not moving is a pause: PAUSE_MS, or while the rhythm turns PAUSE_PERIODS of the period its turns show
   * (twice the median time between its last turns: a half cycle each, known from the second turn; at most
   * PAUSE_BOUND_PERIODS of the cycles' periodMs, when they give one), at most PAUSE_MAX_MS. */
  pauseMs() {
    const k = this.k, ts = this.turnTs, gaps = ts.slice(1).map((x, i) => x - ts[i]);
    let period = gaps.length ? 2 * median(gaps) : 0;
    if (this.periodMs > 0) period = Math.min(period, k.PAUSE_BOUND_PERIODS * this.periodMs);
    return Math.min(k.PAUSE_MAX_MS, Math.max(k.PAUSE_MS, k.PAUSE_PERIODS * period));
  }

  /** Paused at t: no run yet, or not moving for pauseMs(). */
  paused(t) { return this.runStart === null || (this.stillFrom !== null && t - this.stillFrom >= this.pauseMs()); }

  /** One frame (see the head of this file): the faults told and fixed on it. */
  update(m, lm, t, cycle = null, moving = true) {
    const k = this.k, out = [];
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(DT_MAX, t - this.lastT));
    this.lastT = t;
    if (cycle && finite(cycle.t)) {                    // (the period the turns show: the last five turns)
      this.turnTs.push(cycle.t);
      if (this.turnTs.length > 5) this.turnTs.shift();
    }
    if (m && moving) {
      if (this.paused(t)) this.newRun(t);
      this.stillFrom = null;
    } else this.stillFrom ??= t;
    if (cycle?.periodMs > 0) this.periodMs = cycle.periodMs;
    const paused = this.paused(t), warm = !paused && t - this.runStart >= k.WARM_MS;
    if (m) m = this.withFloor(m, t);
    for (const c of this.checks) {
      const s = this.s[c.id];
      const why = this.why(c, m, moving && !!m, paused, warm);
      if (isCycle(c)) this.cycleFrame(c, s, why, m, lm, t);
      else this.frame(c, s, why, m, lm, t, dt, out);
    }
    if (cycle && !cycle.wobble) {
      for (const c of this.checks) if (c.at === cycle.kind) this.judgeCycle(c, this.s[c.id], cycle, t, out);
    }
    this.tell(m, lm, t, out);
    // the form not checked, said once it lasts (UnseenWatch): the person standing in the picture with checks out of
    // view, their parts out of the picture ('frame', moving or not), said for those of them the frame blocks (none
    // judged within FRAME_WAIT_MS: one judged at every sweep, its leg rising into the picture, is being checked); or
    // every check from the wrong side while moving after the warm-up ('view')
    const U = UNSEEN_TUNING, nows = this.checks.map(c => this.s[c.id].now), off = x => x === 'unseen' || x === 'view';
    const needIds = c => (c.needs ?? []).flatMap(n => NEEDS_LANDMARKS[n] ?? []);
    const unseen = !m || !lm ? [] : this.checks.filter(c => this.s[c.id].now === 'unseen');
    const blocked = unseen.filter(c => !(t - (this.s[c.id].measuredT ?? -Infinity) < U.FRAME_WAIT_MS));
    const partsOf = cs => (cs.length ? outOfView(lm.image, [...new Set(cs.flatMap(needIds))]) : []);
    const outParts = partsOf(blocked);
    const standing = this.standingForFraming(m, lm?.image, t);
    const frameBlind = partsOf(unseen).length > 0 && standing;
    const viewBlind = !frameBlind && nows.every(x => x === 'view') && !!m && moving && !paused
      && t - this.runStart >= k.WARM_MS;
    const allOut = m && lm ? outOfView(lm.image, [...new Set(this.checks.flatMap(needIds))]) : [];
    if (this.unseen.update(t, dt, { blind: frameBlind || viewBlind, active: frameBlind || viewBlind,
      seen: !!m && !allOut.length && !nows.some(off), turn: viewBlind && !!cycle && !cycle.wobble,
      waitMs: frameBlind ? U.FRAME_WAIT_MS : U.WAIT_MS, waitTurns: frameBlind ? Infinity : U.WAIT_TURNS,
      ready: !frameBlind || outParts.length > 0 })) {
      const why = frameBlind ? 'frame' : 'view';
      out.push({ type: 'form_unseen', missing: (frameBlind ? blocked : this.checks).map(c => c.name),
        parts: frameBlind ? outParts : [], why, cue: unseenCue(why, frameBlind ? outParts : []) });
    }
    return out;
  }

  /** A cropped knee cannot prove standing. Keep a short memory of standing actually seen, only while the shoulders
   * remain in frame, the trunk upright and the hips near the lower edge. Seeing a seated hip clears that memory.
   * Starting close to the laptop, disappearing or coming back later cannot enable it. */
  standingForFraming(m, image, t) {
    const U = UNSEEN_TUNING;
    if (!m || !image) return false;                 // a brief dropout retains evidence; the time limit still expires
    const visible = i => !outOfView(image, [i]).length;
    const knees = [23, 24, 25, 26].every(visible);
    if (knees && Math.max(m.hipL, m.hipR) < U.STAND_HIP) this.standingT = null;
    if (standingInPicture(m, image, U.STAND_HIP)) {
      if (m.trunkTilt < 50) this.standingT = t;
      return true;
    }
    return this.standingT !== null && t - this.standingT <= U.STAND_RECENT_MS
      && [11, 12].every(visible) && m.trunkTilt < 30
      && [23, 24].every(i => image[i].x > 0.01 && image[i].x < 0.99 && image[i].y >= 0.85 && image[i].y <= 1.25);
  }

  /** A new run of movement at t (the first, or after a pause): the checks start afresh, their cycles' verdicts from
   * before it gone, a fault not told dropped (one told stays open until fixed). A still check is no run's: left as it
   * is. */
  newRun(t) {
    this.runStart = t;
    for (const c of this.checks) {
      if (c.still) continue;
      const s = this.s[c.id];
      s.hist = []; s.histT = [];
      if (s.present && s.told) continue;
      s.present = false; s.samples = []; s.badMs = 0; s.okMs = 0; s.bad = []; s.badSum = 0;
    }
  }

  /** Why the check is not judged on this frame, or 'measured' ('phase': all but its phase). The parts first (out of
   * view, the wrong view), then the movement: a still check once the person has moved at all since the movement was
   * named (moving or not, through pauses, no warm-up: its phase keeps a person at rest out); a frame check only while
   * moving; a cycle check (its frames around the extreme, which may dwell) while not paused; neither in the warm-up. */
  why(c, m, moving, paused, warm) {
    if (!m || !(c.needs ?? []).every(p => m.seen[p])) return 'unseen';
    if (c.views && !c.views.includes(m.view)) return 'view';
    if (c.still && !isCycle(c)) return this.runStart === null ? 'still' : 'measured';
    if (isCycle(c) ? paused : !moving) return 'still';
    if (!warm && !isCycle(c)) return 'warm';
    return 'measured';
  }

  /** A frame check on one frame: its value smoothed, its time bad or ok, a fault or its fix. A still check's phase
   * starting to hold (after SETTLE_MS without it): its samples afresh and its first SETTLE_MS not judged, neither bad
   * nor ok (a reach's first frames, on the way up, are short of any line: without it they broke the fix's time ok on
   * every reach). Only a still check's: on the others' short phases (frames moving only) at twice a reference's pace,
   * the flow's reach and the side kick's lean, a fault put in was no longer caught. */
  frame(c, s, why, m, lm, t, dt, out) {
    const k = this.k, smoothMs = c.smoothMs ?? k.SMOOTH_MS, faultMs = c.faultMs ?? k.FAULT_MS;
    while (s.samples.length && s.samples[0].t <= t - smoothMs) s.samples.shift();
    s.now = why;
    if (why !== 'measured') return;
    s.okT = t;
    if (c.phase) {
      if (!c.phase(m, lm)) { s.now = 'phase'; return; }
      if (c.still) {
        if (s.phaseT === null || t - s.phaseT > k.SETTLE_MS) { s.phaseFrom = t; s.samples = []; }
        s.phaseT = t;
        if (t - s.phaseFrom < k.SETTLE_MS) { s.now = 'settle'; return; }
      }
    }
    const v = c.value(m, lm);
    if (!finite(v)) { s.now = 'unseen'; return; }     // (a measure MediaPipe could not give: as out of view)
    s.samples.push({ t, v }); s.measuredT = t; s.measuredEver = true;
    s.value = median(s.samples.map(x => x.v));
    if (c.bad(s.value)) {
      s.badMs += dt; s.okMs = 0;
      // (its last faultMs of bad frames, for its `seen`)
      s.bad.push({ t, dt }); s.badSum += dt;
      while (s.bad.length > 1 && s.badSum - s.bad[0].dt >= faultMs) s.badSum -= s.bad.shift().dt;
    } else {
      if (c.ok(s.value)) { s.okMs += dt; s.badMs = 0; } else { s.badMs = 0; s.okMs = 0; }   // (on the line: neither)
      if (!s.present) { s.bad = []; s.badSum = 0; }
    }
    if (!s.present && s.badMs >= faultMs) s.present = true;
    else if (s.present && s.okMs >= k.FIX_MS) this.fixed(c, s, t, out);
  }

  /** A cycle check on one frame: buffered for the cycle's judgement if it can be judged here. The warm-up is the
   * cycle's to apply (by when its extreme came); `now` leaves the phase out (it applies near the extreme only). */
  cycleFrame(c, s, why, m, lm, t) {
    const f = s.frames;
    while (f.length && f[0].t < t - this.k.KEEP_MS) f.shift();
    s.now = why === 'measured' && t - this.runStart < this.k.WARM_MS ? 'warm' : why;
    if (why !== 'measured') return;
    if (s.now === 'measured') s.okT = t;
    if (c.phase && !c.phase(m, lm)) return;
    const v = c.value(m, lm);
    if (finite(v)) f.push({ t, v, m, lm });
  }

  /** A cycle check's verdicts still counting at t (`hist`, oldest first): those of the last VERDICT_PERIODS periods of
   * the rhythm (the cycles' periodMs), at least VERDICT_MIN_MS; older ones go. */
  verdicts(s, t) {
    const keep = Math.max(this.k.VERDICT_MIN_MS, this.k.VERDICT_PERIODS * this.periodMs);
    while (s.histT.length && s.histT[0] < t - keep) { s.histT.shift(); s.hist.shift(); }
    return s.hist;
  }

  /** A cycle handed over (its kind is the check's `at`): its value, its verdict, a fault or its fix. */
  judgeCycle(c, s, cycle, t, out) {
    const k = this.k;
    // (an extreme in the warm-up, or before a pause since: the run it belongs to is not this one, or not warm yet)
    if (this.paused(t) || cycle.t < this.runStart + k.WARM_MS) return;
    const near = s.frames.filter(x => Math.abs(x.t - cycle.t) <= k.PEAK_MS / 2);
    let at;
    if ((c.take ?? 'at') === 'at') {
      if (!near.length) return;                       // no frame judged near the extreme: not judged
      at = near.reduce((b, x) => (Math.abs(x.t - cycle.t) < Math.abs(b.t - cycle.t) ? x : b));
      at = { ...at, v: median(near.map(x => x.v)) };
    } else {
      // the half cycle up to the extreme (and PEAK_MS / 2 after it), within this run, its extreme's frames judged;
      // or (`over` 'cycle') the whole cycle since the turn of this kind before (each frame in one cycle only), all of
      // it in this run, judged on any frame of it its phase holds on. Each value the median of three frames
      let span;
      if (c.over === 'cycle') {
        const from = cycle.cycleFrom ?? cycle.from;
        if (!(from >= this.runStart)) return;
        span = s.frames.filter(x => x.t > from + k.PEAK_MS / 2 && x.t <= cycle.t + k.PEAK_MS / 2);
      } else {
        if (!near.length) return;
        const from = Math.max(cycle.from ?? -Infinity, this.runStart);
        span = s.frames.filter(x => x.t >= from && x.t <= cycle.t + k.PEAK_MS / 2);
      }
      if (!span.length) return;
      const sm = span.map((x, i) => ({ ...x, v: median(span.slice(Math.max(0, i - 1), i + 2).map(y => y.v)) }));
      at = sm.reduce((b, x) => ((c.take === 'max' ? x.v > b.v : x.v < b.v) ? x : b));
    }
    const v = at.v;
    s.value = v; s.measuredT = t; s.measuredEver = true; s.cycleSide = c.side?.(at.m, at.lm) ?? null;
    s.cycleSeen = { from: at.t - k.SEEN_MS / 2, to: Math.min(t, at.t + k.SEEN_MS / 2) };
    const hist = this.verdicts(s, t);
    hist.push(c.bad(v) ? 'bad' : c.ok(v) ? 'ok' : 'line'); s.histT.push(t);
    if (hist.length > k.CYCLES_OF) { hist.shift(); s.histT.shift(); }
    // a fault not told yet: as its last cycles say (CYCLES_BAD of them bad); one told: fixed on the last CYCLES_OK ok
    if (!s.told) s.present = hist.filter(x => x === 'bad').length >= k.CYCLES_BAD;
    else if (hist.length >= k.CYCLES_OK && hist.slice(-k.CYCLES_OK).every(x => x === 'ok')) this.fixed(c, s, t, out);
  }

  fixed(c, s, t, out) {
    s.present = false; s.bad = []; s.badSum = 0;
    if (s.told) { s.told = false; this.lastFixT = t; out.push({ type: 'form_fix', fault: c.id, label: c.label }); }
  }

  /** One correction at a time: the most important fault not told yet, judged bad on this frame (a cycle check: on the
   * cycle judged now), once none told is still open (and the fix was praised), or NEXT_MS after the last one told. */
  tell(m, lm, t, out) {
    const k = this.k;
    const open = this.checks.some(c => this.s[c.id].present && this.s[c.id].told);
    const due = (open ? t - this.lastToldT >= k.NEXT_MS : t - this.lastFixT >= k.AFTER_FIX_MS)
      // A new fault measured on the very cycle that fixes another must not disappear behind the fix's cooldown.
      // Still respect the normal time between corrections; never announce stale evidence on a later frame.
      || (this.lastFixT === t && t - this.lastToldT >= k.NEXT_MS);
    if (!due) return;
    const now = c => {
      const s = this.s[c.id];
      return s.measuredT === t && (isCycle(c) ? s.hist.at(-1) === 'bad' : true);
    };
    const c = this.checks.find(x => {
      const s = this.s[x.id];
      return s.present && !s.told && now(x) && !(x.after ?? []).some(id => this.s[id]?.present);
    });
    if (!c) return;
    const s = this.s[c.id];
    s.told = true; s.everTold = true; s.toldT = t; this.lastToldT = t;
    s.side = sideName(isCycle(c) ? s.cycleSide : c.side?.(m, lm));
    // the frames the verdict rests on: a cycle check's around the frame its value came from, a frame check's last
    // FAULT_MS (its faultMs) of bad frames
    s.seen = isCycle(c) ? s.cycleSeen : s.bad.length ? { from: s.bad[0].t - s.bad[0].dt, to: s.bad.at(-1).t } : null;
    out.push({ type: 'form_fault', ...this.fault(c) });
  }

  /** The person's floor, from the frames before (both legs seen, about this far from the camera): m with feetLift (body
   * lengths above it) and airborne (true, false, or null: not known). The frames at about this distance are those
   * whose steady size (steadyScaleImg) is within FLOOR_NEAR of their median; the body length, engine.js's body scale
   * at its largest over them (the 90th percentile): the arms raised narrow the shoulders on screen, which that scale
   * goes by, and shrink it (the step touch's reference: 18% with both arms up; MediaPipe on its footage 13%), while
   * the steady size holds (the same; 4% larger). Played out and back, its floor is known on 97% of its frames with
   * both arms up (by engine.js's scale: 51%), and MediaPipe's on its footage on 97% (84%). */
  withFloor(m, t) {
    const k = this.k, fl = this.floor;
    while (fl.length && fl[0].t < t - k.FLOOR_MS) fl.shift();
    let feetLift = NaN, airborne = null;
    if (m.seen.legs && finite(m.footImgY) && finite(m.bodyScaleImg) && finite(m.steadyScaleImg)) {
      fl.push({ t, y: m.footImgY, scale: m.bodyScaleImg, steady: m.steadyScaleImg });
      const steady = median(fl.map(x => x.steady));
      const near = fl.filter(x => Math.abs(x.steady / steady - 1) <= k.FLOOR_NEAR);
      const here = Math.abs(m.steadyScaleImg / steady - 1) <= k.FLOOR_NEAR;
      if (t - fl[0].t >= k.FLOOR_MS / 4 && here && near.length >= 3) {
        // the floor at each distance: the lower ankle's height against the steady size, by least squares (nearer the
        // camera the feet sit lower in the picture, the camera being above them), and the frames' 80th percentile off
        // that line; the floor here, that line at this frame's size
        const n = near.length, ss = near.map(x => x.steady), sm = ss.reduce((a, b) => a + b, 0) / n;
        const ym = near.reduce((a, x) => a + x.y, 0) / n;
        const sxx = near.reduce((a, x) => a + (x.steady - sm) ** 2, 0);
        const sxy = near.reduce((a, x) => a + (x.steady - sm) * (x.y - ym), 0);
        const spread = (Math.max(...ss) - Math.min(...ss)) / steady;
        const slope = spread < k.FLOOR_SPREAD || !(sxx > 0) ? 0 : Math.max(0, Math.min(k.FLOOR_SLOPE_MAX, sxy / sxx));
        const line = size => ym + slope * (size - sm);
        const off = near.map(x => x.y - line(x.steady)).sort((a, b) => a - b);
        const floor = line(m.steadyScaleImg) + off[Math.floor(0.8 * (off.length - 1))];
        const sizes = near.map(x => x.scale).sort((a, b) => a - b), scale = sizes[Math.floor(0.9 * (sizes.length - 1))];
        feetLift = (floor - m.footImgY) / scale;
        airborne = feetLift >= k.AIRBORNE;
      }
    }
    return { ...m, feetLift, airborne };
  }

  /** settle(t), as HoldForm's: the faults open now count as told at t (the next one NEXT_MS from there). */
  settle(t) {
    if (this.checks.some(c => this.s[c.id].present && this.s[c.id].told)) this.lastToldT = Math.max(this.lastToldT, t);
  }

  /** A fault told: what it is, as measured last, and what to show in red (`part`, and `side` as told). */
  fault(c) {
    const s = this.s[c.id];
    return { fault: c.id, label: c.label, measured: c.measured(s.value), target: c.target, cue: c.cue, part: c.part,
      side: s.side, seen: s.seen };
  }

  /** Measured lately. A frame check: judged within SMOOTH_MS (as HoldForm's: once its phase has not held that long, it
   * is neither checked nor pending; a still check through pauses too). A cycle check: its parts could be judged within
   * SMOOTH_MS (its phase aside), with a verdict still counting (verdicts()). */
  fresh(c) {
    const s = this.s[c.id], t = this.lastT;
    if (!isCycle(c)) return s.measuredT !== null && t - s.measuredT < this.k.SMOOTH_MS;
    return s.okT !== null && t - s.okT < this.k.SMOOTH_MS && this.verdicts(s, t).length > 0;
  }

  /** Measured now as a fault: one already (present), or bad lately and waiting to last (a frame check's smoothed value,
   * a cycle check's last verdict). */
  faulty(c) {
    const s = this.s[c.id];
    return s.present || (this.fresh(c) && (isCycle(c) ? s.hist.at(-1) === 'bad' : c.bad(s.value)));
  }

  /** Now, as HoldForm's: {checked, open (the latest told first), pending, unseen, wrongView}. */
  state() {
    const checked = [], open = [], pending = [], unseen = [], wrongView = [];
    const byId = id => this.checks.find(x => x.id === id);
    for (const c of this.checks) {
      const s = this.s[c.id];
      if (s.present && s.told) open.push({ ...this.fault(c), toldT: s.toldT });    // (whatever this frame shows)
      else if (!this.fresh(c)) {                        // not measured lately: why, on the last frame
        if (s.now === 'view') wrongView.push(c.name);
        else if (s.now === 'unseen') unseen.push(c.name);
      } else if (this.faulty(c)) {
        // (one held back by another fault there: the same fault in other words, told as that one)
        if (!(c.after ?? []).some(id => this.faulty(byId(id)))) pending.push(c.name);
      } else checked.push(c.name);
    }
    open.sort((a, b) => b.toldT - a.toldT);
    return { checked, open: open.map(({ toldT, ...f }) => f), pending, unseen, wrongView };
  }

  /** So far, as HoldForm's: {checked: the checks measured and fine at the end, faults: [{fault, label, fixed, told}]:
   * every fault told or still there at the end}. */
  summary() {
    const checked = [], faults = [];
    for (const c of this.checks) {
      const s = this.s[c.id];
      if (s.measuredEver && !s.present && !c.bad(s.value)) checked.push(c.name);
      if (!s.everTold && (c.after ?? []).some(id => this.s[id]?.present)) continue;
      if (s.everTold || s.present) faults.push({ fault: c.id, label: c.label, fixed: !s.present, told: s.everTold });
    }
    return { checked, faults };
  }
}

/** What is wrong with the checks of `forms` (a MOVE_FORMS-shaped map): a list of problems, empty when every check has
 * the shape above. `parts`: the body part names the page can show (formcheck.js boneParts, retarget.js faultParts). */
export function checkProblems(forms, parts = null) {
  const out = [];
  const str = x => typeof x === 'string' && x.trim().length > 0;
  for (const [key, checks] of Object.entries(forms)) {
    if (!Array.isArray(checks) || !checks.length) { out.push(`${key}: not a list of checks`); continue; }
    const ids = new Set();
    for (const c of checks) {
      const at = `${key}/${c?.id}`;
      if (!str(c?.id) || ids.has(c.id)) out.push(`${at}: id missing or repeated`);
      ids.add(c?.id);
      for (const f of ['name', 'label', 'part', 'target', 'cue']) if (!str(c?.[f])) out.push(`${at}: ${f} missing`);
      for (const f of ['value', 'bad', 'ok', 'measured']) if (typeof c?.[f] !== 'function') out.push(`${at}: ${f}()`);
      for (const f of ['side', 'phase']) {
        if (c?.[f] !== undefined && typeof c[f] !== 'function') out.push(`${at}: ${f}`);
      }
      if (c?.still !== undefined && (typeof c.still !== 'boolean' || c.at !== 'frame')) {
        out.push(`${at}: still is true or false, for a frame check`);
      }
      for (const f of ['smoothMs', 'faultMs']) {
        if (c?.[f] !== undefined && (typeof c[f] !== 'number' || !(c[f] > 0) || c.at !== 'frame')) {
          out.push(`${at}: ${f} is a time over 0, for a frame check`);
        }
      }
      if (c?.over !== undefined && (!['half', 'cycle'].includes(c.over) || !['max', 'min'].includes(c.take))) {
        out.push(`${at}: over is half or cycle, with take max or min`);
      }
      if (!['frame', 'peak', 'trough'].includes(c?.at)) out.push(`${at}: at must be frame, peak or trough`);
      if (c?.take !== undefined && (!isCycle(c) || !['at', 'max', 'min'].includes(c.take))) {
        out.push(`${at}: take is at, max or min, for a peak or trough check`);
      }
      if (!Array.isArray(c?.needs) || !c.needs.every(p => SEEN_PARTS.includes(p))) out.push(`${at}: needs`);
      if (c?.views !== undefined && !(Array.isArray(c.views) && c.views.every(v => VIEWS.includes(v)))) {
        out.push(`${at}: views`);
      }
      if (!finite(c?.order)) out.push(`${at}: order`);
      if (c?.after !== undefined && !(Array.isArray(c.after) && c.after.every(id => checks.some(x => x.id === id)))) {
        out.push(`${at}: after names a check of the movement`);
      }
      if (parts && str(c?.part) && !parts.includes(c.part)) out.push(`${at}: part ${c.part} cannot be shown`);
    }
  }
  return out;
}
