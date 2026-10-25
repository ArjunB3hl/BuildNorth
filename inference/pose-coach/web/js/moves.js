// Movements the user names: any movement of the motion library (POSE_MOVES_DIR/library.json, built by
// tools/build_moves.mjs), followed with what the camera measures reliably. Nothing here works out WHICH movement a
// person is doing (on other people's footage that was right about 7% of the time): the user names it, by voice or a
// tap, and a MovementTracker follows that one movement: how long a pose is held still, how long the person moves, or
// about how many cycles of a repeated movement. Reps are counted only for the exercises the engine counts
// (web/js/engine.js through web/js/auto.js), never here. Pure ES module (no DOM): the page and the Node tests share it.
//
//   const tr = new MovementTracker({ movement });   // a library.json entry {key, display, kind, track, rhythm?, ...}
//   events = tr.update(features, tMs, lm?)          // features: engine.js features() of one frame; lm (optional):
//                                                   // its landmarks {world, image, aspect}, for the form (a
//                                                   // hold's: holdform.js; a moving or rhythm one's: moveform.js)
//   events = tr.lost(tMs)                           // no person in this frame
//   events = tr.finish(tMs)                         // the user named something else, or the workout ended
//   tr.settle(tMs)                                  // a hold's start was said now (the page holds it back): the
//                                                   // form's next correction waits from here (HoldForm settle())
//   tr.current(tMs)                                 // now, for the page: {key, display, kind, track, ...} (below)
//   tr.summary()                                    // {key, display, kind, track, seconds | count, ...}
//   statusText(tr.current())                        // the Now card's words: "Hold 0:23", "Moving 1:42", "About 12"
//
// What each track measures (library.json `track`; TRACK_OF_KIND maps the library's kinds to them):
//   hold    a held pose (stretch, balance, yoga pose): the time held. A hold starts once still for HOLD_START_MS
//           (current() shows its timer) and is told once it has lasted HOLD_TOLD_MS: hold_start {t} (t: when the
//           stillness began), hold_progress {seconds} at 10, 20 and 30 s and every 15 s after, hold_end {seconds}
//           after MOVE_END_MS of clear movement within END_SPAN_MS, or the person out of view LOST_END_MS. A hold that
//           ends before it is told (a pause, an adjustment) has no event and is not counted. Jitter, a sway or one hand
//           adjusting never ends it: only movement of the trunk or of two limbs, or a large one of a single limb, that
//           lasts. current(): {holding, seconds (of the hold under way), last, total, form}.
//           The form (web/js/holdform.js), for a movement with an entry in HOLD_FORMS and frames given with their
//           landmarks: measured from the hold's start (reset at each hold), frames of clear movement left out (a
//           person moving is not holding a pose), and frames the stillness measure cannot judge ('unknown': too little
//           in view, which the hold takes as out of view). hold_start {form: state()} carries the faults measured by
//           then (one told at most: no hold_fault of its own); after it, hold_fault {fault, label, measured, target,
//           cue, part, side} and hold_fix {fault, label} (part: a formcheck.js bonesFor / retarget.js faultBones
//           name; side: the user's own 'left' | 'right' | null; each entry of form.open carries them too); hold_progress {form: state()}, hold_end {form: summary()}, current()
//           {form: state() while holding}. form: null when the movement has no form check, or no landmarks were given.
//           A frame reaches the form only once the hold cannot end before it (as hold_progress waits: movement under
//           way or the pose left may end it where they began), so its faults and fixes are held back with it and
//           dropped if the hold ends first, and hold_end's summary is the form as of the hold's end: on the user's
//           triangle recording, "trunk too upright" was told of frames after a hold's end and listed in its summary
//           as not fixed. hold_end's `told`: said in hold_start's form.open or a hold_fault (a fault told and fixed
//           before the start, never said, is left out).
//           In the pose at all (holdform.js IN_POSE, the same movements and frames): no hold starts while the person
//           is clearly out of the pose (standing still beside it is not holding it), and a hold ends once they have
//           been out of it OUT_END_MS, hold_end timed to when they left it; the form never sees those frames. Its
//           parts out of view: no decision (as without it).
//   moving  dances, flows, transitions: the time spent moving (movement that lasts at least MOVING_MIN_MS; a fidget
//           is not moving). moving_progress {seconds, form} every MOVING_STEP_S of it; pauses do not reset it.
//           current(): {seconds, form}.
//   rhythm  repeated gym moves the engine has no counter for: cycles of the movement's `rhythm.signal` (one period:
//           away from where it started and back, by at least `rhythm.prominence`, no faster than `minPeriodS`).
//           rhythm_progress {count, approximate: true, form} every RHYTHM_STEP cycles. Approximate by design: any
//           swing of that signal counts, whatever the person is doing. A width across the picture (the hands' or
//           feet's spread) is counted only with the camera in front (SIGNALS `view`). current(): {count,
//           approximate: true, form}.
//   The form of a moving or rhythm movement (web/js/moveform.js), for one with an entry in MOVE_FORMS and frames
//           given with their landmarks: its guard rails, judged while the person moves (moving: the frames counted
//           as moving; rhythm: those, or its signal swinging, or a turn of it just made), and a rhythm's cycle checks
//           on each turn CycleCounter confirms (its `turn`, handed over as MoveForm's cycle). form_fault {fault,
//           label, measured, target, cue, part, side} and form_fix {fault, label}, as a hold's; `form` (MoveForm
//           state()) on moving_progress, rhythm_progress and current(); summary() {form: MoveForm summary()} once
//           measured. form: null when the movement has no form check, or no landmarks were given (and summary() has
//           no form).
//   form_unseen {missing, parts, why, cue}: every check of the form out of view ('frame': `parts` out of the picture)
//           or seen side-on ('view') while the person does the movement, said once it lasts (moveform.js
//           UnseenWatch): a moving or rhythm movement's after WAIT_MS of movement past its warm-up (or WAIT_TURNS
//           turns), a hold's HOLD_WAIT_MS after hold_start; again EVERY_MS later at the earliest while it lasts, or
//           after every check has been seen and then lost again. Some checks seen: none (the Now card says it).
//   technique  a named one-two, assessed by technique.js from guard to punch to return, without a count or timer.
//           form_fault uses the existing replay and Mistakes path. technique_result carries {verdict, sequence,
//           checked, unmeasured, faults, seen, cue}; only measured checks may pass. current(): {phase, result, form};
//           summary(): {reviewed, result}.
//   reps    the exercises the engine counts: the page names the exercise to AutoTracker; nothing here.
// Every event carries {type, key, display, kind, t}.
//
// The stillness measure. Every frame, over the last WINDOW_MS of smoothed features, each channel's spread (trimmed of
// its extreme samples) is divided by MediaPipe's jitter on a still person; a body part (the trunk, each arm, each leg)
// scores its PART_RANK-th channel, and the body scores the trunk, the second limb, or the first limb over LIMB, which
// ever is highest. Measured on the user's six recordings (hand-labelled still stretches: 276 s; movement and exercise:
// 238 s), the idle footage and the three hold motions' own footage (2026-10-24).
//
// Frame rate. Every threshold is a time, not a number of frames: the window keeps the frame before it, needs only
// MIN_SAMPLES frames, each frame stands for the time since the one before (up to DT_MAX), and the smoothing goes by
// time too (TimeSmoother). The user's recordings and the footage decimated from 30 fps, down to 4 fps: the still
// stretches timed 58% (64% at 30 fps), holds running into movement 4-6 s of 238 (7 s), the time moving within 10% on
// movement (12-17 s more over the 276 s still), the rhythm counts the same but for one quick combo's below 10 fps. 3 fps does a little less; at 2 fps the window
// holds too few frames to tell (no hold starts, nothing moves). (Counted per frame, as before: the time moving was a quarter short at 8 fps, a third at 7,
// and at 6 fps no hold started.)

import { HOLD_FORMS, HoldForm, IN_POSE, InPose, neededLandmarks, poseMetrics } from './holdform.js';
import { MOVE_FORMS, MoveForm, UNSEEN_TUNING, UnseenWatch, bodyMetrics, unseenEvent } from './moveform.js';
import { OneTwoTechnique } from './technique.js';
import { sideCrunchStanding } from './moveforms/legs.js';

/** What a library movement of each kind tracks. */
export const TRACK_OF_KIND = {
  technique: 'technique',
  gym_counted: 'reps', gym_reps: 'rhythm', hold: 'hold', flow: 'moving', dance: 'moving', transition: 'moving',
};
export const TRACKS = ['reps', 'rhythm', 'hold', 'moving', 'technique'];

const VIS = { legs: 'visLegs', arms: 'visArms', torso: 'visTorso' };
const inView = (f, part) => f[VIS[part]] >= 0.6;

/** Rhythm signals: what a `rhythm.signal` may name, with the part of the body it needs in view and its jitter on a
 * still person (`unit`: the spread over half a second, 90th percentile, on the idle footage and the user's still
 * stretches; tools/build_moves.mjs keeps a prominence of at least 3 units). Side-agnostic (the higher arm, the more
 * bent knee): the user doing the movement on the other side counts the same. `view`: a width across the picture,
 * which a camera at the person's side does not see (the angles and heights hold from any side): a frame whose
 * frontness (engine.js: the shoulders' or hips' width on screen over the torso's length) is below `view` is out of
 * view for the count. The hands' spread is over the shoulders' width on screen, which nears zero from the side: there
 * the ratio jumps by tens of shoulder widths from frame to frame (a side view of the user's: median 3.7, 95th
 * percentile 46), so it counts from the front only (engine.js 'front': above 0.45; the library's footage of the
 * movement it is used for: 0.71 and above). The feet's spread is over a hip width never below 0.3 of the body's scale, and a sideways
 * bend narrows the shoulders on screen (the library's footage: down to 0.39, at the far end of the movement, which a
 * gate at 0.45 missed once in three), so it counts down to 0.3. Without the gate, the 10 side-view clips of the
 * footage (75 s) gave 34 and 13 cycles; with it, none. */
/** A rhythm signal's fallback, counted from the landmarks while the signal's own parts are out of view (the build
 * stores its prominence and minPeriodS as `rhythm.fallback`, from the reference as the signal's own): `get(f, lm)`
 * from a frame's features and landmarks, `inView(lm)` its parts in view, `unit` its jitter as SIGNALS's. thighOut: the
 * more lifted thigh (hip to knee, world landmarks) from straight down, in degrees, for the feet's spread, which needs
 * the ankles in view: the user swept a leg out to the side with the feet below the picture (two recordings of the
 * standing side crunch) and nothing was counted. The knees' spread across the picture counted those sweeps too, late
 * or twice (2 more of 18 on the one, the first of six missed on the other); the thigh found every one, a sweep each.
 * Its unit: the smoothed signal's spread over half a second on the user's still frames, 90th percentile, 16.5 deg
 * where the feet's spread reads 0.45 (its unit 0.15): 5.5 deg. */
const LEG_VIS = 0.6;                    // a hip or a knee in view for the fallback (engine.js's 0.6 for a limb)
const inPic = p => p && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.985;
export const FALLBACKS = {
  thighOut: {
    get: (f, lm) => {
      const W = lm.world, from = (h, k) => {
        const d = [W[k].x - W[h].x, W[k].y - W[h].y, (W[k].z ?? 0) - (W[h].z ?? 0)], n = Math.hypot(...d);
        return n ? (Math.acos(Math.max(-1, Math.min(1, d[1] / n))) * 180) / Math.PI : NaN;
      };
      return Math.max(from(23, 25), from(24, 26));
    },
    inView: lm => !!lm?.image
      && [23, 24, 25, 26].every(i => inPic(lm.image[i]) && (lm.image[i].visibility ?? 1) >= LEG_VIS),
    unit: 5.5,
  },
};

export const SIGNALS = {
  kneeMin: { get: f => f.kneeMin, needs: 'legs', unit: 4 },                          // the more bent knee (deg)
  kneeMax: { get: f => f.kneeMax, needs: 'legs', unit: 3 },                          // the straighter knee: squats
  hipMin: { get: f => f.hipMin, needs: 'legs', unit: 5 },                            // knee drives, kicks, leg raises
  hipAvg: { get: f => f.hipAvg, needs: 'legs', unit: 4 },                            // hinges, crunches
  armMax: { get: f => f.armMax, needs: 'arms', unit: 4 },                            // the higher arm against the torso
  armMin: { get: f => Math.min(f.armL, f.armR), needs: 'arms', unit: 4 },            // both arms up
  elbowMin: { get: f => Math.min(f.elbowL, f.elbowR), needs: 'arms', unit: 5 },      // punches, curls
  torsoLean: { get: f => f.torsoLean, needs: 'torso', unit: 4 },                     // bending, side crunches
  wristUpMax: { get: f => Math.max(f.wristUpL, f.wristUpR), needs: 'arms', unit: 0.05 },   // the higher hand (body lengths)
  wristUpMin: { get: f => Math.min(f.wristUpL, f.wristUpR), needs: 'arms', unit: 0.05 },
  wristSpread: { get: f => f.wristSpread, needs: 'arms', unit: 0.15, view: 0.45 },   // hands apart (shoulder widths)
  hipHeight: { get: f => f.hipHeight, needs: 'torso', unit: 0.04 },                  // hips up and down (body lengths)
  feetWidth: { get: f => f.feetWidth, needs: 'legs', unit: 0.15, view: 0.3,          // feet apart (hip widths)
    fallback: 'thighOut' },
};

// The stillness measure's channels: positions on screen (raw image units over the body scale) and joint angles, by
// body part. `unit`: MediaPipe's jitter on a still person over WINDOW_MS (90th percentile on the idle footage: 0.02-0.04
// body lengths, 2-6 deg; the hidden elbow of a side view jitters most).
const POS = 0.03, ANG = 4;
const CHANNELS = [
  { get: f => f.hipXImg, pos: true, unit: POS, needs: 'torso', part: 'trunk' },
  { get: f => f.hipYImg, pos: true, unit: POS, needs: 'torso', part: 'trunk' },
  { get: f => f.shoulderYImg, pos: true, unit: POS, needs: 'torso', part: 'trunk' },
  { get: f => f.torsoLean, unit: ANG, needs: 'torso', part: 'trunk' },
  { get: f => f.ankleYImg, pos: true, unit: POS, needs: 'legs', part: 'trunk' },
  { get: f => f.legHeightL, pos: true, unit: POS, needs: 'legs', part: 'legL' },
  { get: f => f.kneeL, unit: ANG, needs: 'legs', part: 'legL' },
  { get: f => f.hipL, unit: ANG, needs: 'legs', part: 'legL' },
  { get: f => f.legHeightR, pos: true, unit: POS, needs: 'legs', part: 'legR' },
  { get: f => f.kneeR, unit: ANG, needs: 'legs', part: 'legR' },
  { get: f => f.hipR, unit: ANG, needs: 'legs', part: 'legR' },
  { get: f => f.wristUpL * f.scale, pos: true, unit: POS, needs: 'arms', part: 'armL' },
  { get: f => f.armL, unit: ANG, needs: 'arms', part: 'armL' },
  { get: f => f.elbowL, unit: 1.5 * ANG, needs: 'arms', part: 'armL' },
  { get: f => f.wristUpR * f.scale, pos: true, unit: POS, needs: 'arms', part: 'armR' },
  { get: f => f.armR, unit: ANG, needs: 'arms', part: 'armR' },
  { get: f => f.elbowR, unit: 1.5 * ANG, needs: 'arms', part: 'armR' },
];
const LIMBS = ['armL', 'armR', 'legL', 'legR'];

export const TUNING = {
  WINDOW_MS: 500,         // the stillness measure's window (it holds the frames of the last WINDOW_MS and the one before)
  MIN_SAMPLES: 3,         // ...and needs at least this many frames (4 fps: 3; 6 fps: 4)
  TRIM: 0.07,             // share of the window's samples left out at each end (a landmark glitch for a frame)
  PART_RANK: 2,           // a part scores its PART_RANK-th channel: one channel alone moving is a glitch
  LIMB: 3,                // a single limb moving counts this many times less (a hand adjusting; a hidden limb's guess)
  STILL: 1.5,             // score at most this: still
  MOVE: 3,                // score at least this: clear movement (the end of a hold)
  GLITCH_MS: 250,         // a stretch of not-still shorter than this does not break a run of stillness
  HOLD_START_MS: 1500,    // still this long: a hold starts (its timer runs: current())
  HOLD_TOLD_MS: 3000,     // ...and it is told (hold_start) once it has lasted this long. A shorter one (a pause, an
                          // adjustment between sides) ends with nothing said and nothing counted. On the user's
                          // recordings, told at once: 38 holds, 20 under 5 s; told at 3 s: 27, 9 under 5 s
  MOVE_END_MS: 1000,      // clear movement this long within END_SPAN_MS ends it
  END_SPAN_MS: 1500,
  LOST_END_MS: 1500,      // the person (or too much of them) out of view this long ends it
  OUT_END_MS: 1000,       // clearly out of the pose this long ends it (a movement with an in-pose test and landmarks):
                          // the user once stood up out of a triangle in 0.9 s of movement (not enough to end it) and
                          // stood there 5 s, the hold running on. Out less and back in (a glitch, a wobble) keeps it
  MOVING_AT: 2,           // score at least this counts towards the time moving...
  MOVING_MIN_MS: 700,     // ...once there is this much of it within END_SPAN_MS (then all of it counts)
  MOVING_STEP_S: 30,      // moving_progress every this many seconds of movement
  RHYTHM_STEP: 5,         // rhythm_progress every this many cycles
  GRACE_MS: 400,          // the rhythm signal's part out of view this briefly keeps the count going (as the engine);
                          // longer, with its fallback in view (FALLBACKS, rhythm.fallback), the count goes on that
  FALLBACK_BACK_MS: 2000, // ...and back on the signal itself once its parts are in view this long. The user's first
                          // side crunch, the swept ankle rising into the picture and leaving it again: back after 1 s,
                          // 14 of its 18 sweeps were counted (each switch starts the zigzag afresh); after 2 s, 18.
                          // After 3 s, a sweep of the second recording's was lost, its feet coming into view to stay
  SWING_UNITS: 3,         // a rhythm's form: its signal swinging this many jitter units within the swing window is
                          // moving (the smallest swing its counter counts: tools/build_moves.mjs keeps a prominence
                          // of 3). The window: about the movement's own period (2 x minPeriodS, which the build sets
                          // to half the reference's period), at least END_SPAN_MS. A slow one dwells at its ends: the
                          // shoulder rotation's reference, played out and back at its own pace, read not moving for
                          // 5.7 s around its far end with END_SPAN_MS, 3.3 s with its 3 s window (minPeriodS 1.5),
                          // which moveform.js PAUSE_MS does not take for a pause
};

/** Seconds of a hold at which hold_progress is said: 10, 20, 30, then every 15 s. */
export const holdMark = i => (i < 3 ? 10 * (i + 1) : 30 + 15 * (i - 2));

// A frame stands for the time since the one before, at most DT_MAX: the times above (the movement needed to end a
// hold, the time moving) add up frames' times, so a slow camera (the CPU fallback, a phone: 4-8 fps) times the same as
// 30 fps, while a stall (the tab in the background, a second without frames) is not movement.
const DT_MAX = 300;

/** engine.js's Smoother (an exponential average of each number of the features, 0.45 of the new frame at 30 fps), by
 * the time between frames rather than per frame: the same at 30 fps, and at a low frame rate a quick movement's turns
 * are not flattened (the library's repeated movements decimated: every count as at 30 fps down to 4 fps, one quick
 * combo's down to 10 fps; averaged per frame, that one fell at 15 fps and three others between 4 and 7 fps). */
export class TimeSmoother {
  constructor(alpha = 0.45, frameMs = 1000 / 30) { this.alpha = alpha; this.frameMs = frameMs; this.prev = null; }
  update(f, dt) {
    if (!f) return null;
    if (!this.prev) { this.prev = { ...f }; return this.prev; }
    const a = 1 - (1 - this.alpha) ** (Math.max(1, dt) / this.frameMs);
    const out = { ...f };
    for (const k of Object.keys(f)) {
      if (typeof f[k] === 'number' && Number.isFinite(f[k]) && Number.isFinite(this.prev[k])) out[k] = this.prev[k] + a * (f[k] - this.prev[k]);
    }
    this.prev = out;
    return out;
  }
}

/** Zigzag with hysteresis that counts cycles of a signal: a turn is confirmed when the signal comes back by
 * `prominence` from its extreme; the first turn (where the signal started) is not counted, and a cycle is counted on
 * every second turn after it: on the way back from the far end of the movement, whichever end it starts from. A
 * cycle sooner than `minPeriodMs` after the last one counted is a wobble, not counted.
 * After each update, `turn` is the turn confirmed by it (null: none): {kind: 'peak' (at a high) | 'trough' (at a low),
 * t, v (the extreme's time and value), from (the turn before, or where the zigzag started: the half cycle from..t),
 * cycleFrom (the turn of this kind before, or else `from`: the whole cycle cycleFrom..t), far (the far end of the
 * movement, where a cycle is counted), counted (it counted one), wobble (a far end sooner than minPeriodMs after the
 * last count)}: a movement's form judges its cycles there (web/js/moveform.js). */
export class CycleCounter {
  constructor({ prominence, minPeriodMs = 0 }) {
    this.p = prominence; this.minPeriod = minPeriodMs;
    this.reset();
    this.count = 0; this.lastCountT = -Infinity;
  }
  /** Counting another signal now (the rhythm's fallback, or back): its prominence and shortest period, the zigzag
   * started afresh (no turn of one counted as the other's) and the count, and the time of its last cycle, kept (a
   * cycle sooner than minPeriodMs after the last one counted, by either, is a wobble). */
  retune(prominence, minPeriodMs = 0) { this.p = prominence; this.minPeriod = minPeriodMs; this.reset(); }
  /** Start again (the signal was out of view): where it picks up is a new start, not a turn. The count is kept. */
  reset() {
    this.dir = null; this.hi = null; this.lo = null; this.turns = 0; this.turn = null; this.fromT = null;
    this.prevFromT = null;
  }
  /** Returns true when a cycle was counted. */
  update(v, t) {
    this.turn = null;
    if (!Number.isFinite(v)) return false;
    if (this.hi === null) { this.hi = { v, t }; this.lo = { v, t }; this.fromT = t; return false; }
    if (v > this.hi.v) this.hi = { v, t };
    if (v < this.lo.v) this.lo = { v, t };
    let turned = false, at = null;
    if (this.dir !== 'down' && v <= this.hi.v - this.p) {           // came down from a high: a turn at the high
      turned = this.dir !== null; at = { kind: 'peak', ...this.hi }; this.dir = 'down'; this.lo = { v, t };
    } else if (this.dir !== 'up' && v >= this.lo.v + this.p) {      // came up from a low: a turn at the low
      turned = this.dir !== null; at = { kind: 'trough', ...this.lo }; this.dir = 'up'; this.hi = { v, t };
    }
    if (!turned) {
      if (at) this.fromT = at.t;                                     // (the start: the extreme it set off from)
      return false;
    }
    this.turns += 1;
    const far = this.turns % 2 === 1, wobble = far && t - this.lastCountT < this.minPeriod;
    this.turn = { ...at, from: this.fromT, cycleFrom: this.prevFromT ?? this.fromT, far, counted: far && !wobble,
      wobble };
    this.prevFromT = this.fromT; this.fromT = at.t;
    if (!this.turn.counted) return false;
    this.count += 1; this.lastCountT = t;
    return true;
  }
}

/** Side-crunch attempts: either a clear thigh lift or a clear spread of the visible feet can confirm a sweep.
 * Bent knees reverse feet width early; very low straight lifts barely change the world thigh angle. Match peaks
 * by when the rise is confirmed, within the reference's minimum period. A resting leg's trough can be much older
 * than its next rise, so trough timestamps cannot deduplicate alternating legs. Count attempts on the way up.
 * Form still uses the thigh's turns, so an ankle reversal never selects the wrong phase for a knee verdict. */
export class SweepCounter {
  constructor({ prominence, minPeriodMs, feetProminence }) {
    this.thigh = new CycleCounter({ prominence });
    this.feet = new CycleCounter({ prominence: feetProminence });
    this.minPeriod = minPeriodMs; this.count = 0; this.lastCountT = -Infinity; this.turn = null;
  }
  retune(prominence, minPeriodMs) { this.thigh.retune(prominence); this.minPeriod = minPeriodMs; this.reset(); }
  reset() { this.thigh.reset(); this.feet.reset(); this.turn = null; }
  rise(turn, t) {
    if (!turn || turn.kind !== 'trough' || t - this.lastCountT < this.minPeriod) return false;
    this.lastCountT = t; this.count += 1;
    return true;
  }
  observeFeet(v, t, seen) {
    if (!seen) {
      if (t - (this.feetSeenT ?? -Infinity) >= TUNING.GRACE_MS) this.feet.reset();
      return;
    }
    this.feetSeenT = t;
    this.feet.update(v, t);
    this.rise(this.feet.turn, t);
  }
  update(v, t) {
    this.thigh.update(v, t);
    const turn = this.thigh.turn, counted = this.rise(turn, t);
    this.turn = turn && { ...turn, counted, wobble: false };
    return counted;
  }
}

export class MovementTracker {
  /** `forms`: the moving and rhythm movements' checks (moveform.js MOVE_FORMS), `holdForms` the held poses'
   * (holdform.js HOLD_FORMS): a test gives made-up ones. */
  constructor({ movement, tuning = {}, forms = MOVE_FORMS, holdForms = HOLD_FORMS } = {}) {
    if (!movement || !movement.key) throw new Error('a movement (a library.json entry) is required');
    const track = movement.track ?? TRACK_OF_KIND[movement.kind];
    if (!TRACKS.includes(track)) throw new Error(`unknown track ${track}`);
    this.technique = track === 'technique' && movement.key === 'one_two_jab' ? new OneTwoTechnique() : null;
    if (track === 'technique' && !this.technique) throw new Error('no technique assessor for this movement');
    this.m = movement; this.track = track; this.k = { ...TUNING, ...tuning };
    this.smoother = new TimeSmoother();
    this.win = [];            // smoothed features of the last WINDOW_MS, with t
    this.lastT = null;        // the last frame (seen or not)
    this.seenT = null;        // the last frame with a person
    // hold
    this.holding = false; this.holdStart = null; this.marks = 0;
    this.told = false;        // the hold under way has been told (hold_start): it lasted HOLD_TOLD_MS
    this.stillFrom = null;    // when the stillness under way began
    this.notStillFrom = null; // when the frames stopped being still (a glitch shorter than GLITCH_MS is forgiven)
    this.movedT = null;       // the last frame that was not still
    this.knownT = null;       // the last frame of a hold with enough of the body in view to tell
    this.holds = [];          // completed holds, in seconds
    // hold and moving: recent movement frames {t, dt, counted}
    this.moveLog = [];
    // the hold's form: its checks, whether landmarks are given, and the last frames' metrics {t, m, st, pose} (a hold
    // starts HOLD_START_MS into the stillness: its form is measured from where the stillness began); during a hold,
    // its frames not given to the form yet (`formQueue`: the hold may still end before them) and the faults said
    this.form = track === 'hold' && holdForms[movement.key]
      ? new HoldForm({ key: movement.key, forms: holdForms }) : null;
    this.holdUnseen = new UnseenWatch();      // (form_unseen for a hold: every check out of view since hold_start)
    this.formOn = false; this.formLog = []; this.formQueue = []; this.said = new Set();
    // in the pose at all (with the form's landmarks): the last frame clearly out of it while no hold was under way
    // (a hold starts after it), and while one is, when the pose was left (null: in it, or no decision)
    this.inPose = this.form && IN_POSE[movement.key] ? new InPose({ key: movement.key }) : null;
    this.outT = null; this.leftT = null;
    // moving
    this.movingMs = 0; this.movingMarks = 0;
    // rhythm
    if (track === 'rhythm') {
      const r = movement.rhythm;
      if (!r || !SIGNALS[r.signal] || !(r.prominence > 0)) throw new Error(`movement ${movement.key}: rhythm needs a known signal and a prominence`);
      this.signal = SIGNALS[r.signal];
      this.cycles = new CycleCounter({ prominence: r.prominence, minPeriodMs: (r.minPeriodS ?? 0) * 1000 });
      this.missSince = null;
    }
    // the form of a moving or rhythm movement (web/js/moveform.js), for one with an entry in MOVE_FORMS and frames
    // given with their landmarks (formOn); a rhythm's signal over its swing window {t, v}, and its last turn
    this.mf = (track === 'moving' || track === 'rhythm') && forms[movement.key]
      ? new MoveForm({ key: movement.key, forms }) : null;
    this.swing = []; this.turnAt = null;
    // a rhythm's fallback (FALLBACKS, with its library parameters `rhythm.fallback`), counted while the signal's own
    // parts are out of view and the fallback's in view (frames with their landmarks): the signal counted now ('main' or
    // 'fallback'), since when the signal's parts are out of view and in it, and the fallback's smoothed value
    const fb = movement.rhythm?.fallback;
    this.fallback = track === 'rhythm' && fb && FALLBACKS[fb.signal] && fb.prominence > 0
      ? { ...FALLBACKS[fb.signal], name: fb.signal, prominence: fb.prominence,
        minPeriodMs: (fb.minPeriodS ?? 0) * 1000 }
      : null;
    if (movement.key === 'standing_side_crunch' && movement.rhythm?.preferFallback && this.fallback) {
      this.cycles = new SweepCounter({ prominence: this.fallback.prominence,
        minPeriodMs: this.fallback.minPeriodMs, feetProminence: movement.rhythm.prominence });
    }
    this.counting = 'main'; this.outSince = null; this.inSince = null; this.fbSmoother = new TimeSmoother();
    this.swingMs = Math.max(this.k.END_SPAN_MS, 2000 * (movement.rhythm?.minPeriodS ?? 0));
  }

  ev(type, t, extra = {}) {
    return { type, key: this.m.key, display: this.m.display, kind: this.m.kind, t, ...extra };
  }

  /** How much the body moved over the last WINDOW_MS, in jitter units: the trunk, the second limb or the first limb
   * over LIMB, whichever is highest ({score, trunk, limbs}); null with too little of the body in view to tell (the
   * trunk and the arms or the legs). */
  score() {
    const k = this.k, w = this.win;
    if (w.length < k.MIN_SAMPLES || w.at(-1).t - w[0].t < 0.6 * k.WINDOW_MS) return null;
    const scales = w.map(r => r.scale).filter(Number.isFinite).sort((a, b) => a - b);
    const scale = scales[scales.length >> 1];
    if (!(scale > 0)) return null;
    const parts = {};
    for (const c of CHANNELS) {
      if (!w.every(r => inView(r, c.needs))) continue;
      const v = w.map(r => c.get(r)).filter(Number.isFinite).sort((a, b) => a - b);
      if (v.length < k.MIN_SAMPLES) continue;
      const cut = Math.floor(k.TRIM * v.length);
      (parts[c.part] ??= []).push((v[v.length - 1 - cut] - v[cut]) / (c.pos ? scale : 1) / c.unit);
    }
    const partScore = p => p && p.sort((a, b) => b - a)[Math.min(p.length, k.PART_RANK) - 1];
    const limbs = LIMBS.map(n => partScore(parts[n])).filter(v => v !== undefined).sort((a, b) => b - a);
    // close to the camera with the trunk alone in view, the trunk hardly moves on screen: no way to tell
    if (!parts.trunk || limbs.length < 2) return null;
    const trunk = partScore(parts.trunk);
    return { score: Math.max(trunk, limbs[1], limbs[0] / k.LIMB), trunk, limbs };
  }

  /** 'still', 'moving' (clear movement), 'between' or 'unknown' (too little in view), for the last frame. */
  state(s = this.score()) {
    if (s === null) return 'unknown';
    return s.score <= this.k.STILL ? 'still' : s.score >= this.k.MOVE ? 'moving' : 'between';
  }

  update(raw, t, lm = null) {
    if (this.technique) { this.lastT = t; return this.technique.update(lm, t).map(e => this.ev(e.type, t, e)); }
    if (!raw) return this.lost(t);
    const out = [];
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(DT_MAX, t - this.lastT));
    this.lastT = t;
    if (this.track === 'reps') return out;
    const f = this.smoother.update(raw, dt || 1000 / 30);
    this.seenT = t;
    if (this.mf && lm) this.formOn = true;
    // (a rhythm without a form check needs no stillness measure: only its signal)
    if (this.track === 'rhythm' && !this.mf) { this.rhythm(f, t, out, null, dt, lm); return out; }
    this.win.push({ ...f, t });
    // (the frame before the window too: at a low frame rate the window would otherwise span too little time to tell)
    while (this.win.length > 1 && this.win[1].t <= t - this.k.WINDOW_MS) this.win.shift();
    const s = this.score();
    if (this.track === 'hold') {
      if (this.form && lm) this.formOn = true;
      this.hold(this.state(s), t, dt, out, this.form && lm ? poseMetrics(lm.world, lm.image, lm.aspect) : null, lm);
    } else if (this.track === 'rhythm') this.rhythm(f, t, out, s, dt, lm);
    else this.moving(s, t, dt, out, lm);
    return out;
  }

  lost(t) {
    if (this.technique) { this.lastT = t; return this.technique.update(null, t).map(e => this.ev(e.type, t, e)); }
    const out = [];
    this.lastT = t;
    if (this.track === 'reps') return out;
    this.win = [];                          // the measure starts afresh when the person is seen again
    this.smoother = new TimeSmoother();
    this.stillFrom = null; this.notStillFrom = null;
    if (this.track === 'hold' && this.holding && t - (this.knownT ?? t) >= this.k.LOST_END_MS) {
      this.endHold(Math.min(this.knownT, this.leftT ?? Infinity), out);
    }
    if (this.track === 'rhythm') this.missed(t);
    this.moveForm(null, t, null, false, out);           // (nobody: nothing judged, and a pause once it lasts)
    return out;
  }

  /** The user named something else, or the workout ended: an open hold ends where it is (or where the pose was left,
   * if it was). */
  finish(t = this.lastT) {
    if (this.technique) return this.technique.finish(t).map(e => this.ev(e.type, t, e));
    const out = [];
    if (this.track === 'hold' && this.holding) this.endHold(Math.min(t, this.knownT ?? t, this.leftT ?? Infinity), out);
    return out;
  }

  hold(st, t, dt, out, m = null, lm = null) {
    const k = this.k;
    // in the pose at all: 'in', 'out' (clearly out of it) or null (no decision: no test, no landmarks, parts unseen)
    const pose = this.inPose && this.formOn ? this.inPose.update(m, t) : null;
    const frame = this.formOn ? { t, m, st, pose } : null;
    if (frame) {
      this.formLog.push(frame);
      while (this.formLog.length && this.formLog[0].t < t - k.HOLD_START_MS - k.WINDOW_MS - 1000) this.formLog.shift();
      if (this.holding) this.formQueue.push(frame);
    }
    if (!this.holding) {
      if (pose === 'out') this.outT = t;         // standing still out of the pose is not holding it
      if (st === 'still') {
        this.notStillFrom = null;
        // stillness began where the window that first showed it starts (no earlier than the last movement seen), and
        // a hold no earlier than the last frame out of the pose
        this.stillFrom ??= Math.max(t - k.WINDOW_MS, this.movedT ?? -Infinity);
        const from = Math.max(this.stillFrom, this.outT ?? -Infinity);
        if (pose === 'out' || t - from < k.HOLD_START_MS) return;
        this.holding = true; this.told = false; this.holdStart = from; this.marks = 0; this.moveLog = [];
        this.knownT = t;
        if (this.form) {               // a new hold: its form from where it began (this frame included), given below
          this.form.reset(); this.said = new Set();
          this.formQueue = this.formLog.filter(x => x.t >= this.holdStart);
        }
      } else {
        this.notStillFrom ??= t;
        if (st === 'unknown' || t - this.notStillFrom >= k.GLITCH_MS) { this.stillFrom = null; this.movedT = t; }
        return;
      }
    }
    // clearly out of the pose OUT_END_MS of frames since it was left: the hold lasted until then (back in sooner: it
    // goes on)
    // A leave the in-pose test cannot confirm (no decision again for OUT_END_MS: parts out of view, a side view) is
    // forgotten, as no decision means the hold goes on as without the test; kept, it would hold back the hold's
    // progress and its form until the test decided again (a quad stretch side-on 13 s: two progress marks, a fault and
    // its fix all told in one frame)
    if (pose === 'out') this.leftT = Math.max(this.holdStart, this.inPose.leftT);
    else if (pose === 'in' || (this.leftT != null && t - this.inPose.lastOutT >= k.OUT_END_MS)) this.leftT = null;
    if (pose === 'out' && this.inPose.lastOutT - this.leftT >= k.OUT_END_MS) {
      this.endHold(this.leftT, out);
      this.outT = t;
      return;
    }
    if (st === 'unknown') {                  // too little of the body in view to tell: as if out of view
      if (t - this.knownT >= k.LOST_END_MS) this.endHold(Math.min(this.knownT, this.leftT ?? Infinity), out);
      return;
    }
    this.knownT = t;
    if (st === 'moving') this.moveLog.push({ t, dt });
    while (this.moveLog.length && this.moveLog[0].t < t - k.END_SPAN_MS) this.moveLog.shift();
    if (this.moveLog.reduce((sum, x) => sum + x.dt, 0) >= k.MOVE_END_MS) {
      // the hold lasted until the movement began (the window that first showed it ends at that frame), or the pose
      // was left before
      const moved = this.moveLog[0].t - k.WINDOW_MS / 2;
      this.endHold(Math.max(this.holdStart, Math.min(moved, this.leftT ?? Infinity)), out);
      this.movedT = t;
      return;
    }
    // (movement under way, or the pose left, may still end the hold where it began: nothing told past that point
    // until it has passed)
    const moved = this.moveLog.length ? this.moveLog[0].t - k.WINDOW_MS / 2 : Infinity;
    const until = Math.min(t, moved, this.leftT ?? Infinity);
    // the form: WINDOW_MS / 2 behind too (movement first seen on the next frame ends the hold that far back: on a
    // made-up hold with squats from 12.2 s, "top arm not straight up" was told at 12.43 s and the hold then ended at
    // 12.28 s)
    this.formTo(Math.min(until, t - k.WINDOW_MS / 2), t, out);
    const held = (until - this.holdStart) / 1000;
    if (!this.told) {
      if (held * 1000 < k.HOLD_TOLD_MS) return;
      // (a fault measured by now is told with it: hold_start's form.open; the next one NEXT_MS after this)
      this.told = true;
      if (this.form && this.formOn) this.form.settle(t);
      const form = this.formState();
      for (const f of form?.open ?? []) this.said.add(f.fault);
      out.push(this.ev('hold_start', this.holdStart, { form }));
      this.holdUnseen.spell();
    }
    while (held >= holdMark(this.marks)) {
      out.push(this.ev('hold_progress', t, { seconds: holdMark(this.marks), form: this.formState() }));
      this.marks += 1;
    }
    this.holdBlind(t, dt, out, m, lm);
  }

  /** form_unseen for the hold under way (told): every check of its form out of view or from the wrong side (as
   * HoldForm's statuses on the frames it was given), HOLD_WAIT_MS of the hold, then at most once every EVERY_MS
   * (UnseenWatch). */
  holdBlind(t, dt, out, m, lm) {
    if (!this.form || !this.formOn || !this.told) return;
    const f = this.form, nows = f.checks.map(c => f.s[c.id].now), off = x => x === 'unseen' || x === 'view';
    if (!this.holdUnseen.update(t, dt, { blind: nows.every(off), seen: !nows.some(off), active: true,
      waitMs: UNSEEN_TUNING.HOLD_WAIT_MS })) return;
    const ids = neededLandmarks([...new Set(f.checks.flatMap(c => c.needs ?? []))], m);
    out.push(this.ev('form_unseen', t, unseenEvent(f.checks, nows, ids, lm?.image)));
  }

  /** The hold's frames up to `until` to its form, but those of clear movement, those the stillness measure cannot
   * judge (as out of view: the hold ends at the last frame before them) and those out of the pose. Its faults and
   * fixes are said now (events at t, this frame's time) once the hold is told (before, what it measured goes with
   * hold_start). */
  formTo(until, t, out) {
    if (!this.form || !this.formOn) return;
    const q = this.formQueue;
    while (q.length && q[0].t <= until) {
      const x = q.shift();
      if (x.st === 'moving' || x.st === 'unknown' || x.pose === 'out') continue;
      for (const { type, ...e } of this.form.update(x.m, x.t)) {
        if (!this.told) continue;
        if (type === 'hold_fault') this.said.add(e.fault);
        out.push(this.ev(type, t, e));
      }
    }
  }

  /** The form of the hold under way now (HoldForm state()), or null: no form check, or no landmarks given. */
  formState() { return this.form && this.formOn ? this.form.state() : null; }

  /** The hold's start was said at t (later than the tracker told it: the page holds a start back until it is sure of
   * the hold): the form's open fault counts as told from then, the next one NEXT_MS after it (HoldForm settle()). The
   * tracker settles it when it tells the start; the page held that start 3.5 s more, and on the user's recording the
   * second correction came 4.5 s after the first one spoken, not NEXT_MS. */
  settle(t) {
    if (this.form && this.formOn) this.form.settle(t);
    if (this.mf && this.formOn) this.mf.settle(t);
  }

  endHold(endT, out) {
    // the form: the frames up to the end are in the hold (their faults and fixes said first), those after it are not
    this.formTo(endT, this.lastT, out);
    this.formQueue = [];
    if (this.told) {
      // (never fewer seconds than the last hold_progress said)
      const seconds = Math.max(this.marks ? holdMark(this.marks - 1) : 0, Math.round((endT - this.holdStart) / 1000));
      this.holds.push(seconds);
      out.push(this.ev('hold_end', endT, { seconds, form: this.formSummary() }));
    }                                       // (one never told was a pause: nothing said, nothing counted)
    this.holding = false; this.told = false; this.holdStart = null; this.moveLog = []; this.stillFrom = null; this.notStillFrom = null;
    this.leftT = null;
  }

  /** The hold's form (HoldForm summary()), its faults' `told` as said (hold_start's form.open, each hold_fault): one
   * the form told before the start and that was fixed by then was never said, and goes; null: no form measured. */
  formSummary() {
    if (!this.form || !this.formOn) return null;
    const sum = this.form.summary();
    return { ...sum, faults: sum.faults.filter(f => this.said.has(f.fault) || !f.fixed)
      .map(f => ({ ...f, told: this.said.has(f.fault) })) };
  }

  /** Movement that lasts (MOVING_MIN_MS of it within END_SPAN_MS: a fidget is not moving) on this frame. */
  movingNow(s, t, dt) {
    const k = this.k, log = this.moveLog;
    if (s !== null && s.score >= k.MOVING_AT) log.push({ t, dt, counted: false });
    while (log.length && log[0].t < t - k.END_SPAN_MS) log.shift();
    return log.reduce((sum, x) => sum + x.dt, 0) >= k.MOVING_MIN_MS;
  }

  moving(s, t, dt, out, lm = null) {
    // movement counts once it lasts, from its start; the form judges the frames it counts
    const k = this.k, now = this.movingNow(s, t, dt);
    this.moveForm(lm, t, null, now, out);
    if (!now) return;
    for (const x of this.moveLog) if (!x.counted) { x.counted = true; this.movingMs += x.dt; }
    while (this.movingMs >= (this.movingMarks + 1) * k.MOVING_STEP_S * 1000) {
      this.movingMarks += 1;
      const seconds = this.movingMarks * k.MOVING_STEP_S;
      out.push(this.ev('moving_progress', t, { seconds, form: this.moveFormState() }));
    }
  }

  /** The rhythm's count; with a form check (s: the stillness measure, lm: the landmarks), the frame to its form, with
   * the turn the signal made on it (CycleCounter `turn`) and whether the person is moving: the stillness measure's
   * lasting movement, the signal swinging (SWING_UNITS of its jitter within swingMs) or a turn within that long.
   * The stillness measure alone misses a forearm turning out at the side or a sideways bend (on their references,
   * played out and back, shoulder external rotation and the standing side crunch read 0 s moving). */
  rhythm(f, t, out, s = null, dt = 0, lm = null) {
    const k = this.k;
    const before = this.cycles.count;
    let turn = null;
    this.cycles.turn = null;                         // a turn belongs to one update, even if this frame is unseen
    const upright = this.m.key !== 'standing_side_crunch' || !lm
      || sideCrunchStanding(bodyMetrics(lm.world, lm.image, lm.aspect));
    // (a width across the picture, seen too much from the side: as if out of view)
    const mainIn = upright && inView(f, this.signal.needs) && !(this.signal.view && !(f.frontness >= this.signal.view));
    const fb = this.fallback, fbIn = upright && !!fb && fb.inView(lm);
    const fbV = fbIn ? this.fbSmoother.update({ v: fb.get(f, lm) }, dt || 1000 / 30).v : NaN;
    if (fb) this.switchSignal(t, mainIn, fbIn);
    this.cycles.observeFeet?.(this.signal.get(f), t, mainIn);
    const on = this.counting === 'fallback' ? fbIn : mainIn, sig = this.counting === 'fallback' ? fb : this.signal;
    if (!on) this.missed(t);
    else {
      this.missSince = null;
      const v = this.counting === 'fallback' ? fbV : sig.get(f);
      this.cycles.update(v, t);
      turn = this.cycles.turn;                          // (this frame's turn only: none on a frame out of view)
      if (this.mf && Number.isFinite(v)) this.swing.push({ t, v });   // (kept for a form only, and trimmed there)
    }
    if (this.mf) {
      while (this.swing.length && this.swing[0].t < t - this.swingMs) this.swing.shift();
      const vs = this.swing.map(x => x.v);
      if (turn) this.turnAt = t;
      const swinging = vs.length > 1 && Math.max(...vs) - Math.min(...vs) >= k.SWING_UNITS * sig.unit;
      const moving = this.movingNow(s, t, dt) || swinging || (this.turnAt !== null && t - this.turnAt <= this.swingMs);
      // (with the rhythm's period, about the reference's: its cycles' verdicts expire by it)
      const cycle = turn && { ...turn, count: this.cycles.count,
        signal: this.counting === 'fallback' ? fb.name : this.m.rhythm.signal,
        periodMs: 2000 * (this.m.rhythm.minPeriodS ?? 0) };
      this.moveForm(lm, t, cycle, moving, out);
    }
    if (this.cycles.count > before && this.cycles.count % k.RHYTHM_STEP === 0) {
      const count = this.cycles.count;
      out.push(this.ev('rhythm_progress', t, { count, approximate: true, form: this.moveFormState() }));
    }
  }

  /** Which signal counts this frame: the fallback once the signal's own parts have been out of view GRACE_MS with the
   * fallback's in view, the signal again once its parts have been in view FALLBACK_BACK_MS (or the fallback's are out
   * and its own in). A switch retunes the counter (CycleCounter retune: the zigzag afresh, the count kept). */
  switchSignal(t, mainIn, fbIn) {
    const k = this.k, fb = this.fallback, r = this.m.rhythm;
    // A bent sweeping knee reverses the feet's spread before the thigh reaches its top. For the side crunch the
    // build prefers thigh turns for form throughout, even when the feet help count smaller lifts.
    if (r.preferFallback) {
      if (this.counting !== 'fallback') {
        this.counting = 'fallback'; this.cycles.retune(fb.prominence, fb.minPeriodMs); this.swing = [];
      }
      return;
    }
    if (mainIn) { this.outSince = null; this.inSince ??= t; } else { this.inSince = null; this.outSince ??= t; }
    if (this.counting === 'main' && fbIn && this.outSince !== null && t - this.outSince >= k.GRACE_MS) {
      this.counting = 'fallback'; this.cycles.retune(fb.prominence, fb.minPeriodMs); this.swing = [];
    } else if (this.counting === 'fallback' && mainIn && (!fbIn || t - this.inSince >= k.FALLBACK_BACK_MS)) {
      this.counting = 'main'; this.cycles.retune(r.prominence, (r.minPeriodS ?? 0) * 1000); this.swing = [];
    }
  }

  /** The rhythm signal's part out of view: a brief drop keeps the count going, a longer one restarts the zigzag. */
  missed(t) {
    this.cycles.turn = null;
    this.missSince ??= t;
    if (t - this.missSince >= this.k.GRACE_MS) { this.cycles.reset(); this.swing = []; }
  }

  /** A frame (lm: its landmarks; null: nobody) to the movement's form, with the half cycle the rhythm completed on it
   * and whether the person is moving: its faults and fixes, said at t. */
  moveForm(lm, t, cycle, moving, out) {
    if (!this.mf || !this.formOn) return;
    const m = lm ? bodyMetrics(lm.world, lm.image, lm.aspect) : null;
    for (const { type, ...e } of this.mf.update(m, lm, t, cycle, moving)) out.push(this.ev(type, t, e));
  }

  /** The form of the moving or rhythm movement now (MoveForm state()), or null: no form check, or no landmarks. */
  moveFormState() { return this.mf && this.formOn ? this.mf.state() : null; }

  /** Seconds held in all: every hold told, the one under way included once told. */
  heldSeconds(t = this.lastT) {
    const open = this.holding && this.told ? Math.max(0, Math.round((Math.min(t, this.knownT ?? t) - this.holdStart) / 1000)) : 0;
    return this.holds.reduce((s, x) => s + x, 0) + open;
  }

  /** Now, for the page: the hold under way (shown from HOLD_START_MS, before it is told) and its seconds so far (and
   * the last and total held), the seconds moving, or the cycles so far. */
  current(t = this.lastT) {
    const base = { key: this.m.key, display: this.m.display, kind: this.m.kind, track: this.track };
    if (this.technique) return { ...base, ...this.technique.current() };
    if (this.track === 'hold') {
      return { ...base, holding: this.holding, seconds: this.holding ? Math.max(0, Math.floor((t - this.holdStart) / 1000)) : 0,
        last: this.holds.at(-1) ?? null, total: this.heldSeconds(t),
        form: this.holding ? this.formState() : null };
    }
    const form = this.moveFormState();
    if (this.track === 'moving') return { ...base, seconds: Math.floor(this.movingMs / 1000), form };
    if (this.track === 'rhythm') return { ...base, count: this.cycles.count, approximate: true, form };
    return base;
  }

  /** The movement over the workout: seconds held (every hold, the one under way included; holds, longest), seconds
   * moving, or about how many cycles; a moving or rhythm movement whose form was measured, its form (MoveForm
   * summary()). */
  summary() {
    const base = { key: this.m.key, display: this.m.display, kind: this.m.kind, track: this.track };
    if (this.technique) return { ...base, ...this.technique.summary() };
    const form = this.mf && this.formOn ? { form: this.mf.summary() } : {};
    if (this.track === 'hold') {
      const all = [...this.holds, ...(this.holding && this.told ? [this.heldSeconds() - this.holds.reduce((s, x) => s + x, 0)] : [])];
      return { ...base, seconds: this.heldSeconds(), holds: all.length, longest: all.length ? Math.max(...all) : 0 };
    }
    if (this.track === 'moving') return { ...base, seconds: Math.round(this.movingMs / 1000), ...form };
    if (this.track === 'rhythm') return { ...base, count: this.cycles.count, approximate: true, ...form };
    return base;
  }
}

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The Now card's words for a tracker's current(): "Hold 0:23", "Moving 1:42", "About 12" ('' for reps). */
export function statusText(cur) {
  if (!cur) return '';
  if (cur.track === 'technique') return cur.phase === 'punch' ? 'Checking punch' : cur.phase === 'cross'
    ? 'Follow with the other hand' : cur.result?.cue || (cur.result?.verdict === 'fault' ? 'Correction shown' : 'Jab, cross, then guard');
  if (cur.track === 'hold') return cur.holding ? `Hold ${clock(cur.seconds)}` : cur.last != null ? `Held ${clock(cur.last)}` : 'Hold: keep still to start';
  if (cur.track === 'moving') return `Moving ${clock(cur.seconds)}`;
  if (cur.track === 'rhythm') return `About ${cur.count}`;
  return '';
}
