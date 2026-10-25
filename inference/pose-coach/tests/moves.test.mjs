// Named library movements (web/js/moves.js): the hold timer, the time moving, the approximate rhythm count, on made-up
// frames with MediaPipe-sized jitter, at 30 fps and at a slow camera's uneven 6 and 4 fps, front on and side on; and
// a moving or rhythm movement's form through the tracker (web/js/moveform.js); the library build
// (tools/build_moves.mjs) on made-up motions in a temp dir.
// The real library, its footage and the measurements on it are private (.data/moves/, .data/dev/moves/tracker/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CycleCounter, FALLBACKS, MovementTracker, SIGNALS, TRACKS, TRACK_OF_KIND, TUNING, holdMark, statusText }
  from '../web/js/moves.js';
import { FORM_TUNING, HOLD_FORMS, HoldForm, poseMetrics } from '../web/js/holdform.js';
import { MOVE_TUNING, UNSEEN_TUNING } from '../web/js/moveform.js';
import { features } from '../web/js/engine.js';
import { LEFT_OUT, WORKING_SIDE, catalogRhythm, heldOf, plan, poseRight, readNpz, rhythmOf, skeletonFeatures,
  skeletonFromNpz,
  skeletonLandmarks, slugify, synonymsOf } from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30, DT = 1000 / FPS;

// --- made-up frames ------------------------------------------------------------------------------------------------
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };   // deterministic jitter
/** One frame's features (only those the tracker reads) for a person standing, `knee` deg at both knees, `arm` deg
 * both arms, hands `wrist` body lengths above the shoulders, with jitter the size MediaPipe shows on a still person
 * (about 0.005 body lengths and 1 deg frame to frame). */
function pose({ knee = 175, arm = 15, wrist = -1, hipY = 0.55, hipX = 0.5, armR = null, spread = 1.2, jitter = 1, legs = 1, arms = 1, torso = 1, side = false } = {}) {
  const j = a => a * jitter * rnd(), scale = 0.25;
  const fold = (175 - knee) / 175;           // the legs fold as the knees bend
  const f = {
    scale, hipXImg: hipX + j(0.002), hipYImg: hipY + 0.2 * fold + j(0.002), shoulderYImg: hipY - 0.2 + 0.2 * fold + j(0.002),
    torsoLean: 5 + 20 * fold + j(2), ankleYImg: 0.9 + j(0.002),
    legHeightL: 0.35 * (1 - fold) + j(0.002), legHeightR: 0.35 * (1 - fold) + j(0.002),
    kneeL: knee + j(2), kneeR: knee + j(2), hipL: Math.min(178, knee + 3) + j(2), hipR: Math.min(178, knee + 3) + j(2),
    armL: arm + j(2), armR: (armR ?? arm) + j(2), elbowL: 170 + j(3), elbowR: 170 + j(3),
    wristUpL: wrist + j(0.01), wristUpR: (armR !== null ? wrist + armR / 90 : wrist) + j(0.01),
    visLegs: legs, visArms: arms, visTorso: torso, wristSpread: spread + j(0.02), feetWidth: 1 + j(0.05), hipHeight: -(hipY + 0.2 * fold) / scale,
    frontness: 0.7 + j(0.02), view: 'front',
  };
  if (side) {
    // from the side the shoulders nearly overlap on screen: the hands' spread over their width jumps with the jitter
    // (engine.js wristSpread: |wrists' dx| / shoulders' dx), as on the user's side views (median 3.7, 95th percentile 46)
    const shoulders = Math.abs(0.002 + j(0.006)), hands = Math.abs(0.01 + j(0.006));
    Object.assign(f, { frontness: shoulders / 0.2, view: 'side', wristSpread: hands / Math.max(shoulders, 1e-6) });
  }
  f.kneeMin = Math.min(f.kneeL, f.kneeR); f.kneeMax = Math.max(f.kneeL, f.kneeR);
  f.hipMin = Math.min(f.hipL, f.hipR); f.hipAvg = (f.hipL + f.hipR) / 2; f.armMax = Math.max(f.armL, f.armR);
  return f;
}
const squatAt = (t, period = 2000) => 175 - 40 * (1 - Math.cos((2 * Math.PI * t) / period));     // 175 -> 95 -> 175

const HOLD = { key: 'made_up_stretch', display: 'Made-up stretch', kind: 'hold', track: 'hold' };
const MOVING = { key: 'made_up_dance', display: 'Made-up dance', kind: 'dance', track: 'moving' };
const RHYTHM = { key: 'made_up_bends', display: 'Made-up knee bends', kind: 'gym_reps', track: 'rhythm',
  rhythm: { signal: 'kneeMax', prominence: 30, minPeriodS: 0.8 } };

/** Run frames from `script(t)` (features, or null for nobody) from `from` to `to` ms; returns the events, each with
 * `at`: the frame it came on. */
function run(tr, script, to, from = 0) {
  const out = [];
  for (let t = from; t <= to; t += DT) {
    const f = script(t);
    out.push(...(f ? tr.update(f, t) : tr.lost(t)).map(e => ({ ...e, at: t })));
  }
  return out;
}
const types = evs => evs.map(e => e.type);
/** As run(), at about `fps` with uneven frame times (a slow camera: at 6 fps 150-210 ms apart). */
function runAt(fps, tr, script, to, from = 0) {
  const out = [];
  for (let t = from; t <= to; t += 1000 / fps + 60 * (rnd() + 0.2)) {
    const f = script(t);
    out.push(...(f ? tr.update(f, t) : tr.lost(t)).map(e => ({ ...e, at: t })));
  }
  return out;
}

// --- hold ----------------------------------------------------------------------------------------------------------
test('hold: still for 1.5 s starts the timer (t: when the stillness began); progress at 10, 20, 30, 45, 60 s', () => {
  const tr = new MovementTracker({ movement: HOLD });
  const evs = run(tr, () => pose(), 65000);
  const start = evs.find(e => e.type === 'hold_start');
  assert.ok(start, 'a hold started');
  assert.ok(start.t <= 500, `the hold began at the start (${start.t})`);
  assert.deepEqual(evs.filter(e => e.type === 'hold_progress').map(e => e.seconds), [10, 20, 30, 45, 60]);
  assert.ok(!evs.some(e => e.type === 'hold_end'), 'jitter never ends it');
  for (const e of evs) assert.deepEqual([e.key, e.display, e.kind], ['made_up_stretch', 'Made-up stretch', 'hold']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(holdMark), [10, 20, 30, 45, 60, 75]);
  const cur = tr.current(65000);
  assert.equal(cur.holding, true);
  assert.ok(cur.seconds >= 64 && cur.seconds <= 65, `${cur.seconds}`);
  assert.equal(statusText({ ...cur, seconds: 23 }), 'Hold 0:23');
});

test('hold: the timer is shown about 1.5 s after the person stops moving, and told (hold_start) at 3 s of it', () => {
  const tr = new MovementTracker({ movement: HOLD });
  let shown = null;
  const evs = run(tr, t => {
    if (shown === null && tr.current(t).holding) shown = t;
    return t < 4000 ? pose({ knee: squatAt(t) }) : pose();
  }, 12000);
  assert.ok(shown - 4000 >= 1300 && shown - 4000 <= 2200, `shown ${shown - 4000} ms after the last movement`);
  const start = evs.find(e => e.type === 'hold_start');
  assert.ok(start && start.t >= 3500 && start.t <= 4600, `began ${start?.t}`);
  assert.ok(Math.abs(start.at - start.t - TUNING.HOLD_TOLD_MS) <= 2 * DT, `told ${start.at - start.t} ms into the hold`);
});

test('hold: a pause shorter than HOLD_TOLD_MS (an adjustment) is timed on screen but neither told nor counted', () => {
  const tr = new MovementTracker({ movement: HOLD });
  // squats, a 2.5 s pause (the timer shows ~1 s of it), squats; then a 4 s hold: told, and its end too
  const script = t => (t < 4000 || (t >= 6500 && t < 10000) || t >= 14000 ? pose({ knee: squatAt(t) }) : pose());
  let shown = false;
  const evs = run(tr, t => { const f = script(t); shown ||= t < 6500 && tr.current(t).holding; return f; }, 17000);
  assert.ok(shown, 'the pause showed on the Now card');
  assert.deepEqual(types(evs), ['hold_start', 'hold_end']);
  assert.ok(evs[0].t >= 10000, `the 4 s hold, not the pause (${evs[0].t})`);
  assert.ok(evs[1].seconds >= 3 && evs[1].seconds <= 5, `${evs[1].seconds} s`);
  assert.deepEqual({ holds: tr.summary().holds, longest: tr.summary().longest }, { holds: 1, longest: evs[1].seconds });
  // and the same with the hold told at once (HOLD_TOLD_MS 0): the pause is a hold
  const now = new MovementTracker({ movement: HOLD, tuning: { HOLD_TOLD_MS: 0 } });
  assert.deepEqual(types(run(now, script, 17000)), ['hold_start', 'hold_end', 'hold_start', 'hold_end']);
});

test('hold: never starts while the person keeps moving, nor in a pause under 1.5 s', () => {
  const tr = new MovementTracker({ movement: HOLD });
  // squats for 20 s with a 1 s pause at the top every other rep
  const script = t => { const c = t % 5000; return c < 4000 ? pose({ knee: squatAt(c) }) : pose(); };
  const evs = run(tr, script, 20000);
  assert.deepEqual(types(evs), []);
  assert.equal(tr.current().holding, false);
  assert.equal(statusText(tr.current()), 'Hold: keep still to start');
});

test('hold: jitter, a one-frame glitch and one hand adjusting do not end it', () => {
  const tr = new MovementTracker({ movement: HOLD });
  const script = t => {
    if (t > 5000 && t % 2000 < DT) return pose({ knee: 120 });                           // a landmark glitch, one frame
    if (t > 8000 && t < 11000) return pose({ armR: 15 + 10 * Math.sin(t / 150) });      // one hand adjusting for 3 s
    return pose({ jitter: 2 });                                                          // twice the usual jitter
  };
  const evs = run(tr, script, 20000);
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress']);
});

test('hold: a second of clear movement ends it, counted to where the movement began', () => {
  const tr = new MovementTracker({ movement: HOLD });
  const evs = run(tr, t => (t < 12000 ? pose() : pose({ knee: squatAt(t - 12000) })), 16000);
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_end']);
  const end = evs.at(-1);
  assert.ok(end.seconds >= 11 && end.seconds <= 13, `held ${end.seconds} s`);
  assert.ok(end.t >= 11800 && end.t <= 12800, `ended at ${end.t}`);
  assert.equal(tr.current().holding, false);
  assert.equal(statusText(tr.current()), `Held 0:${String(end.seconds).padStart(2, '0')}`);
  // standing still again: a new hold
  const more = run(tr, () => pose(), 22000, 16000 + DT);
  assert.deepEqual(types(more), ['hold_start']);
  const sum = tr.summary();
  assert.deepEqual({ ...sum, seconds: 0 }, { key: 'made_up_stretch', display: 'Made-up stretch', kind: 'hold', track: 'hold',
    seconds: 0, holds: 2, longest: end.seconds });
  assert.ok(Math.abs(sum.seconds - (end.seconds + tr.current(22000).seconds)) <= 1, `${sum.seconds} s held in all`);
});

test('hold: hold_end never says fewer seconds than the last hold_progress', () => {
  for (let stop = 9400; stop <= 10800; stop += 100) {
    const tr = new MovementTracker({ movement: HOLD });
    const evs = run(tr, t => (t < stop ? pose() : pose({ knee: squatAt(t - stop) })), stop + 3000);
    const said = evs.filter(e => e.type === 'hold_progress').map(e => e.seconds), end = evs.find(e => e.type === 'hold_end');
    assert.ok(end, `ended (movement from ${stop} ms)`);
    assert.ok(end.seconds >= Math.max(0, ...said), `movement from ${stop} ms: said ${said}, ended at ${end.seconds}`);
    assert.ok(Math.abs(end.seconds - stop / 1000) <= 1, `movement from ${stop} ms: ${end.seconds} s`);
  }
});

test('hold: out of view under LOST_END_MS keeps it; longer ends it at the last frame seen', () => {
  const tr = new MovementTracker({ movement: HOLD });
  let evs = run(tr, t => (t >= 5000 && t < 6000 ? null : pose()), 9000);   // a 1 s dropout
  assert.deepEqual(types(evs), ['hold_start']);
  evs = run(tr, t => (t >= 9000 && t < 12000 ? null : pose()), 13000, 9000);   // 3 s: gone
  assert.deepEqual(types(evs).slice(0, 1), ['hold_end']);
  assert.ok(Math.abs(evs[0].t - 9000) <= DT, `ended at ${evs[0].t}, the last frame seen`);
  assert.equal(evs[0].seconds, 9);
});

test('hold: only the trunk in view (close to the camera) cannot tell, and ends a hold like being out of view', () => {
  const tr = new MovementTracker({ movement: HOLD });
  const evs = run(tr, t => (t < 6000 ? pose() : pose({ legs: 0.2, arms: 0.3 })), 9000);
  assert.deepEqual(types(evs), ['hold_start', 'hold_end']);
});

test('hold: finish() ends an open hold where it is; none is open after', () => {
  const tr = new MovementTracker({ movement: HOLD });
  run(tr, () => pose(), 7000);
  const evs = tr.finish(7000);
  assert.deepEqual(types(evs), ['hold_end']);
  assert.equal(evs[0].seconds, 7);
  assert.deepEqual(tr.finish(8000), []);
});

// --- a hold's form (web/js/holdform.js; tests/holdform.test.mjs tests the checks themselves) ------------------------
const TRIANGLE = { key: 'triangle_pose', display: 'Triangle pose (yoga)', kind: 'hold', track: 'hold' };
const add3 = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
/** A frame's landmarks {world, image, aspect} of a triangle pose facing the camera (legs 0.9 m, trunk 0.5 m tipped
 * `tilt` deg over the left leg, arms 0.6 m in one line): the feet `stance` leg lengths apart, the top (right) arm
 * `topArm` deg from straight up; a few mm of jitter. `standing()` below: the same person standing up. `hide`: landmarks
 * not visible. */
function triangleLm({ stance = 1.1, topArm = 10, tilt = 60, armsDown = false, hide = [] } = {}) {
  const r = Math.PI / 180, a = Math.asin((stance * 0.9 - 0.2) / 1.8), t = tilt * r;
  const P = { 23: [0.1, 0, 0], 24: [-0.1, 0, 0] };
  for (const [hip, kn, an, sx] of [[23, 25, 27, 1], [24, 26, 28, -1]]) {
    const d = [sx * Math.sin(a), Math.cos(a), 0];
    P[kn] = add3(P[hip], d, 0.45); P[an] = add3(P[hip], d, 0.9);
  }
  const sh = [0.5 * Math.sin(t), -0.5 * Math.cos(t), 0], e = [Math.cos(t), Math.sin(t), 0];
  P[11] = add3(sh, e, 0.18); P[12] = add3(sh, e, -0.18);
  const up = [Math.sin(topArm * r), -Math.cos(topArm * r), 0], down = armsDown ? [0, 1, 0] : up.map(v => -v);
  P[14] = add3(P[12], armsDown ? down : up, 0.3); P[16] = add3(P[12], armsDown ? down : up, 0.6);
  P[13] = add3(P[11], down, 0.3); P[15] = add3(P[11], down, 0.6);
  P[0] = add3(sh, [0.11, -0.19, -0.1]);
  const world = [], image = [];
  for (let i = 0; i < 33; i++) {
    const p = (P[i] ?? P[0]).map(v => v + 0.003 * rnd());
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (2.4 * 16 / 9), y: 0.55 + p[1] / 2.4, z: 0, visibility: hide.includes(i) ? 0 : 1 });
  }
  return { world, image, aspect: 16 / 9 };
}
/** The same person standing up out of the triangle: the trunk 14 deg off upright (as the user's camera read them
 * standing), the arms down, the feet still half a leg length apart. */
const standingLm = (o = {}) => triangleLm({ stance: 0.45, tilt: 14, armsDown: true, ...o });
/** As run(), each frame with its landmarks from `lmAt(t)`. */
function runLm(tr, script, lmAt, to, from = 0) {
  const out = [];
  for (let t = from; t <= to; t += DT) {
    const f = script(t);
    out.push(...(f ? tr.update(f, t, lmAt(t)) : tr.lost(t)).map(e => ({ ...e, at: t })));
  }
  return out;
}

test('hold form: without landmarks, or for a movement without a form check, holds as before, form: null', () => {
  const script = t => (t < 12000 ? pose() : pose({ knee: squatAt(t - 12000) }));
  const bare = run(new MovementTracker({ movement: TRIANGLE }), script, 16000);
  const plain = run(new MovementTracker({ movement: HOLD }), script, 16000);
  const noForm = runLm(new MovementTracker({ movement: HOLD }), script, () => triangleLm({ stance: 0.4 }), 16000);
  for (const evs of [bare, plain, noForm]) {
    assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_end']);
    for (const e of evs) assert.equal(e.form, null, `${e.type}`);
  }
  assert.deepEqual(bare.map(e => [e.t, e.seconds]), plain.map(e => [e.t, e.seconds]));
  const tr = new MovementTracker({ movement: HOLD });
  runLm(tr, () => pose(), () => triangleLm(), 5000);
  assert.equal(tr.current().holding, true);
  assert.equal(tr.current().form, null);
});

test('hold form: hold_start carries the fault measured by then; faults and fixes after it; progress, end too', () => {
  const tr = new MovementTracker({ movement: TRIANGLE });
  let before = null, between = null;
  // still 45 s; the feet half a leg length apart throughout; the top arm 60 deg off from 15 s to 30 s
  const lmAt = t => triangleLm({ stance: 0.45, topArm: t >= 15000 && t < 30000 ? 60 : 10 });
  const evs = runLm(tr, t => {
    if (Math.abs(t - 1000) < DT / 2) before = tr.current(t);
    if (Math.abs(t - 20000) < DT / 2) between = tr.current(t);
    return pose();
  }, lmAt, 45000);
  evs.push(...tr.finish(45000));
  assert.deepEqual(types(evs),
    ['hold_start', 'hold_progress', 'hold_fault', 'hold_progress', 'hold_progress', 'hold_fix', 'hold_end']);
  const [start, p10, fault, p20, , fix, end] = evs;
  // told at HOLD_TOLD_MS, with the stance measured from where the stillness began: no hold_fault of its own
  const toldAfter = start.at - start.t;
  assert.ok(toldAfter >= TUNING.HOLD_TOLD_MS - DT && toldAfter <= TUNING.HOLD_TOLD_MS + 2 * DT, `${toldAfter}`);
  assert.deepEqual(start.form.open.map(f => f.fault), ['stance']);
  assert.match(start.form.open[0].measured, /^feet 0\.4\d leg lengths apart$/);
  assert.equal(start.form.open[0].cue, "Step your feet wider, about a leg's length apart.");
  assert.ok(start.form.checked.includes('top arm') && !start.form.checked.includes('stance width'));
  assert.deepEqual(start.form.unseen, []);
  assert.deepEqual(p10.form.open.map(f => f.fault), ['stance']);
  // the top arm: told about 1.5 s after it went off (and WINDOW_MS / 2: the form takes a frame once the hold cannot end
  // before it), with the usual fields (and what to show in red: the top arm, the person's right: landmarks 12-14-16)
  assert.deepEqual({ ...fault, at: undefined }, {
    type: 'hold_fault', key: 'triangle_pose', display: 'Triangle pose (yoga)', kind: 'hold', t: fault.at,
    fault: 'top_arm', label: 'top arm not straight up', measured: fault.measured,
    target: 'straight up, over the shoulder', cue: 'Reach your top arm straight up, stacked over your shoulder.',
    part: 'arm', side: 'right', at: undefined });
  const late = 2200 + TUNING.WINDOW_MS / 2;
  assert.ok(fault.at >= 15000 + 1500 && fault.at <= 15000 + late, `${fault.at}`);
  assert.match(fault.measured, /^top arm [56]\d degrees from straight up$/);
  assert.deepEqual(p20.form.open.map(f => f.fault), ['top_arm', 'stance']);       // the latest told first
  assert.deepEqual({ ...fix, at: undefined }, { type: 'hold_fix', key: 'triangle_pose', display: 'Triangle pose (yoga)',
    kind: 'hold', t: fix.at, fault: 'top_arm', label: 'top arm not straight up', at: undefined });
  assert.ok(fix.at >= 30000 + 1500 && fix.at <= 30000 + late, `${fix.at}`);
  assert.deepEqual(end.form.faults, [{ fault: 'stance', label: 'feet too close together', fixed: false, told: true },
    { fault: 'top_arm', label: 'top arm not straight up', fixed: true, told: true }]);
  assert.ok(end.form.checked.includes('top arm') && !end.form.checked.includes('stance width'));
  // the Now card: the form while holding (from HOLD_START_MS, before it is told), nothing once the hold is over
  assert.equal(before.holding, false);
  assert.equal(before.form, null);
  assert.deepEqual(between.form.open.map(f => f.fault), ['top_arm', 'stance']);
  assert.equal(tr.current().form, null);
});

test('hold form: each hold measured afresh; a hold ending before it is told says nothing of its form', () => {
  const tr = new MovementTracker({ movement: TRIANGLE });
  // a 12 s hold with the feet together, squats, a 2.5 s pause (never told), squats, a 12 s hold done well
  const moving = t => (t >= 12000 && t < 16000) || (t >= 18500 && t < 22000);
  const script = t => (moving(t) ? pose({ knee: squatAt(t) }) : pose());
  const lmAt = t => triangleLm({ stance: t < 12000 ? 0.4 : 1.1 });
  const evs = runLm(tr, script, lmAt, 34000);
  evs.push(...tr.finish(34000));
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_end', 'hold_start', 'hold_progress', 'hold_end']);
  assert.deepEqual(evs[0].form.open.map(f => f.fault), ['stance']);
  assert.deepEqual(evs[2].form.faults.map(f => f.fault), ['stance']);
  assert.ok(evs[3].t >= 20000, 'the second hold, not the pause');
  assert.deepEqual(evs[3].form.open, []);
  assert.deepEqual(evs[3].form.checked,
    ['stance width', 'long legs', 'top arm', 'trunk tilt', 'arms in one line', 'open chest']);
  assert.deepEqual(evs[5].form.faults, []);
});

// In the pose at all (holdform.js IN_POSE): the user stood up out of a triangle in under a second of movement and
// stood there, the hold running on and the coach told their trunk was too upright; and standing still before getting
// into the pose started holds of its own.
test('hold form: standing up out of the pose ends the hold where it was left, nothing told of the frames after', () => {
  // a good triangle, up in a 0.4 s movement at 15 s (too little to end a hold), then standing still 20 s
  const script = t => (t >= 15000 && t < 15400 ? pose({ knee: squatAt(t - 15000, 400) }) : pose());
  const up = t => t >= 15200;
  const tr = new MovementTracker({ movement: TRIANGLE });
  const evs = runLm(tr, script, t => (up(t) ? standingLm() : triangleLm()), 35000);
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_end']);
  const [start, , end] = evs;
  // timed to the first frame out of the pose, said once out of it OUT_END_MS
  assert.ok(Math.abs(end.t - 15200) <= DT, `ended at ${end.t}`);
  assert.ok(end.at - end.t >= TUNING.OUT_END_MS && end.at - end.t <= TUNING.OUT_END_MS + 2 * DT, `${end.at - end.t}`);
  assert.equal(end.seconds, Math.round((end.t - start.t) / 1000));
  // the standing frames (feet half a leg length apart, the trunk upright, the arms down) never reached the form
  assert.deepEqual(end.form.faults, []);
  assert.equal(tr.current().holding, false);
  assert.equal(statusText(tr.current()), `Held 0:${String(end.seconds).padStart(2, '0')}`);
  // the same without landmarks: nothing says the pose was left, the hold runs on (as before)
  const bare = run(new MovementTracker({ movement: TRIANGLE }), script, 35000);
  assert.deepEqual(types(bare), ['hold_start', 'hold_progress', 'hold_progress', 'hold_progress']);
  // standing with the shoulders out of view: no decision either; the legs in view, the stance is told (as before)
  const unseen = runLm(new MovementTracker({ movement: TRIANGLE }), script,
    t => (up(t) ? standingLm({ hide: [11, 12] }) : triangleLm()), 35000);
  assert.deepEqual(types(unseen).slice(0, 3), ['hold_start', 'hold_progress', 'hold_fault']);
  assert.ok(!types(unseen).includes('hold_end'));
  assert.equal(unseen[2].fault, 'stance');
});

test('hold form: out of the pose under OUT_END_MS (a wobble, a glitch) keeps the hold and tells nothing of it', () => {
  const tr = new MovementTracker({ movement: TRIANGLE });
  // upright for 0.9 s at 12 s, and for two frames every 3 s after
  const out = t => (t >= 12000 && t < 12900) || (t > 16000 && t % 3000 < 2 * DT);
  const evs = runLm(tr, () => pose(), t => (out(t) ? standingLm() : triangleLm()), 40000);
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_progress', 'hold_progress']);
  assert.deepEqual(tr.current().form,
    { checked: ['stance width', 'long legs', 'top arm', 'trunk tilt', 'arms in one line', 'open chest'], open: [],
      pending: [], unseen: [], wrongView: [] });
});

test('hold form: a leave the in-pose test cannot confirm is forgotten: the hold and its marks go on, nothing in a burst', () => {
  // upright for 0.6 s at 12 s (under OUT_END_MS), then the shoulders out of view 10 s (no decision), then all in view
  const lmAt = t => (t >= 12000 && t < 12600 ? standingLm()
    : t >= 12600 && t < 22600 ? triangleLm({ hide: [11, 12] }) : triangleLm());
  const evs = runLm(new MovementTracker({ movement: TRIANGLE }), () => pose(), lmAt, 32000);
  assert.ok(!types(evs).includes('hold_end'), types(evs).join());
  const start = evs[0], marks = evs.filter(e => e.type === 'hold_progress');
  assert.deepEqual(marks.map(e => e.seconds).slice(0, 2), [10, 20]);
  // each mark said at its time, not held back until the test decided again at 22.6 s (kept, the leave did so)
  for (const e of marks) assert.ok(e.at - start.t - e.seconds * 1000 <= 2 * DT, `${e.seconds} s said at ${e.at}`);
});

test('hold form: standing still before getting into the pose starts no hold; once in it, one starts', () => {
  // standing still 10 s, into the pose in a 1 s movement, held 15 s
  const script = t => (t >= 10000 && t < 11000 ? pose({ knee: squatAt(t - 10000, 1000) }) : pose());
  const lmAt = t => (t < 10500 ? standingLm() : triangleLm());
  const tr = new MovementTracker({ movement: TRIANGLE });
  let before = null;
  const watch = t => { if (Math.abs(t - 9000) < DT / 2) before = tr.current(t); return script(t); };
  const evs = runLm(tr, watch, lmAt, 26000);
  assert.deepEqual([before.holding, statusText(before)], [false, 'Hold: keep still to start']);
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress']);
  assert.ok(evs[0].t >= 10500, `began at ${evs[0].t}, in the pose`);
  assert.deepEqual(evs[0].form.open, []);               // the standing frames (feet half as wide) measured nothing
  // standing still: a hold as before for a movement without a form check, without landmarks, or with the shoulders
  // out of view (no decision)
  const unseen = () => standingLm({ hide: [11, 12] });
  for (const [what, evs2] of [
    ['no form check', runLm(new MovementTracker({ movement: HOLD }), () => pose(), () => standingLm(), 8000)],
    ['no landmarks', run(new MovementTracker({ movement: TRIANGLE }), () => pose(), 8000)],
    ['shoulders unseen', runLm(new MovementTracker({ movement: TRIANGLE }), () => pose(), unseen, 8000)],
  ]) assert.deepEqual(types(evs2).slice(0, 1), ['hold_start'], what);
});

// The form ran on every frame but those of clear movement, its events said at once: on the user's triangle recording
// "trunk too upright" was told of frames the stillness measure could not judge, after the hold's end, and listed in
// its summary as not fixed.
test('hold form: frames the stillness measure cannot judge never reach the form; a fault on them is not told', () => {
  /** A tracker that records each frame's stillness state and the frames its form was given. */
  const watched = () => {
    const tr = new MovementTracker({ movement: TRIANGLE }), st = new Map(), fed = [];
    const hold = tr.hold.bind(tr), update = tr.form.update.bind(tr.form);
    tr.hold = (s, t, ...rest) => { st.set(t, s); return hold(s, t, ...rest); };
    tr.form.update = (m, t) => { fed.push(t); return update(m, t); };
    return { tr, st, fed };
  };
  // a good triangle; the top arm off from 8.8 s to 10.8 s, of which 10-10.8 s (and the half second after, the
  // stillness measure's window) too little in view for the stillness measure (the trunk alone), under LOST_END_MS:
  // the hold goes on. Measured on those frames, the arm lasted FAULT_MS and was told, then fixed (as the
  // user's "trunk too upright"); on the frames the hold could judge, it was off 1.2 s: nothing
  let { tr, st, fed } = watched();
  const off = t => t >= 10000 && t < 10800;
  let evs = runLm(tr, t => (off(t) ? pose({ legs: 0.2, arms: 0.3 }) : pose()),
    t => triangleLm({ topArm: t >= 8800 && t < 10800 ? 60 : 10 }), 16000);
  evs.push(...tr.finish(16000));
  assert.ok([...st.values()].filter(s => s === 'unknown').length >= 30, 'a second unknown');
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_end']);
  assert.deepEqual(evs[2].form, { checked: ['stance width', 'long legs', 'top arm', 'trunk tilt', 'arms in one line',
    'open chest'], faults: [] });
  assert.deepEqual(fed.filter(t => st.get(t) === 'unknown'), []);
  // the same from 10 s on: the hold ends at 10 s, LOST_END_MS later; the arm's fault, measured on those frames after
  // that end, is neither told nor in its summary (not fine either: off as the hold ended)
  ({ tr, st, fed } = watched());
  evs = runLm(tr, t => (t < 10000 ? pose() : pose({ legs: 0.2, arms: 0.3 })),
    t => triangleLm({ topArm: t >= 9000 ? 60 : 10 }), 13000);
  assert.deepEqual(types(evs), ['hold_start', 'hold_end']);
  const end = evs[1];
  assert.ok(Math.abs(end.t - 10000) <= DT, `ended at ${end.t}`);
  assert.deepEqual(end.form.faults, []);
  assert.ok(!end.form.checked.includes('top arm'));
  assert.ok(fed.length && fed.every(t => t <= end.t && st.get(t) !== 'unknown'), `fed up to ${fed.at(-1)}`);
});

test('hold form: a fault or fix waits while the hold may still end before it; dropped if it does', () => {
  const lmAt = t => triangleLm({ topArm: t >= 10500 ? 60 : 10 });  // the top arm off from 10.5 s: told about 12.5 s
  // a 0.4 s movement at 12 s (not enough to end the hold): the fault waits until the movement is behind the hold
  const brief = runLm(new MovementTracker({ movement: TRIANGLE }),
    t => (t >= 12000 && t < 12400 ? pose({ knee: squatAt(t - 12000, 400) }) : pose()), lmAt, 20000);
  assert.deepEqual(types(brief), ['hold_start', 'hold_progress', 'hold_fault']);
  assert.ok(brief[2].at >= 12400 + TUNING.END_SPAN_MS, `told at ${brief[2].at}`);
  // squats from 12.2 s: the hold ends where they began, before the fault lasted: never told, not in its summary
  const tr = new MovementTracker({ movement: TRIANGLE });
  const ends = runLm(tr, t => (t >= 12200 ? pose({ knee: squatAt(t - 12200) }) : pose()), lmAt, 16000);
  assert.deepEqual(types(ends), ['hold_start', 'hold_progress', 'hold_end']);
  assert.ok(ends[2].t >= 11800 && ends[2].t <= 12400, `ended at ${ends[2].t}`);
  assert.deepEqual(ends[2].form.faults, []);
  // a fix the same way: the top arm off from the start (told with hold_start), raised at 10.5 s, squats from 11.9 s
  const fixAt = t => triangleLm({ topArm: t >= 10500 ? 10 : 60 });
  const raised = runLm(new MovementTracker({ movement: TRIANGLE }),
    t => (t >= 11900 ? pose({ knee: squatAt(t - 11900) }) : pose()), fixAt, 16000);
  assert.deepEqual(types(raised), ['hold_start', 'hold_progress', 'hold_end']);
  assert.deepEqual(raised[2].form.faults, [{ fault: 'top_arm', label: 'top arm not straight up', fixed: false,
    told: true }]);
});

// The page holds a hold's start back (6.5 s into it) and says it then: the next correction NEXT_MS from there, not from
// when the tracker told it (on the user's recording the second came 4.5 s after the first one spoken).
test('hold form: settle(t) when the start is said later: the next correction NEXT_MS after that', () => {
  const lmAt = () => triangleLm({ stance: 0.45, topArm: 60 });
  const run2 = settleAt => {
    const tr = new MovementTracker({ movement: TRIANGLE });
    const script = t => { if (settleAt && Math.abs(t - settleAt) < DT / 2) tr.settle(t); return pose(); };
    return runLm(tr, script, lmAt, 25000);
  };
  const now = run2(null), later = run2(6800);
  for (const evs of [now, later]) {
    assert.deepEqual([evs[0].type, evs[0].form.open.map(f => f.fault)], ['hold_start', ['stance']]);
  }
  const fault = evs => evs.find(e => e.type === 'hold_fault');
  assert.equal(fault(now).fault, 'top_arm');
  // (NEXT_MS on the form's clock, which takes frames WINDOW_MS / 2 behind)
  const lag = TUNING.WINDOW_MS / 2 + 2 * DT, after = fault(now).at - now[0].at;
  assert.ok(after >= FORM_TUNING.NEXT_MS && after <= FORM_TUNING.NEXT_MS + lag, `${after}`);
  assert.ok(fault(later).at >= 6800 + FORM_TUNING.NEXT_MS && fault(later).at <= 6800 + FORM_TUNING.NEXT_MS + lag,
    `${fault(later).at}`);
  // an earlier time keeps the later one; no form (a movement without checks, or no landmarks): nothing to settle
  const tr = new MovementTracker({ movement: TRIANGLE });
  runLm(tr, () => pose(), lmAt, 5000);
  tr.settle(1000);
  const next = fault(runLm(tr, () => pose(), lmAt, 25000, 5000 + DT));
  assert.ok(next.at >= tr.holdStart + TUNING.HOLD_TOLD_MS + FORM_TUNING.NEXT_MS - DT, `${next.at}`);
  for (const t of [new MovementTracker({ movement: HOLD }), new MovementTracker({ movement: TRIANGLE })]) {
    run(t, () => pose(), 5000);
    t.settle(5000);
    assert.equal(t.current().form, null);
  }
});

// The reviews' case: the top arm off as the user settles, raised at 3 s; the trunk too upright all along, waiting
// AFTER_FIX_MS behind the arm's fix. The page says the start 6.5 s in, with the form as it is then: that fault was in
// no list, and the start said "Good, hold it there." a second before telling it.
test('hold form: the arm raised at 3 s, the trunk waiting its turn: pending at the page\'s start, never fine', () => {
  const tr = new MovementTracker({ movement: TRIANGLE });
  const lmAt = t => triangleLm({ topArm: 40 - 30 * Math.max(0, Math.min(1, (t - 3000) / 600)), tilt: 30 });
  let atPage = null;
  const evs = runLm(tr, t => {
    if (tr.holding && atPage === null && t - tr.holdStart >= 6500) atPage = tr.current(t).form;
    return pose();
  }, lmAt, 20000);
  evs.push(...tr.finish(20000));
  assert.deepEqual(evs.map(e => `${e.type}${e.fault ? `:${e.fault}` : ''}`),
    ['hold_start', 'hold_fix:top_arm', 'hold_fault:trunk_tilt', 'hold_progress', 'hold_end']);
  assert.deepEqual([evs[0].form.open.map(f => f.fault), evs[0].form.pending], [['top_arm'], ['trunk tilt']]);
  // the fix (5.4-5.7 s) before the page's start, the tilt told after it: at the start, pending, not checked
  assert.ok(evs[1].at < evs[0].t + 6500 && evs[2].at > evs[0].t + 6500, `${evs[1].at} ${evs[2].at}`);
  assert.deepEqual(atPage, { checked: ['stance width', 'long legs', 'top arm', 'arms in one line'], open: [],
    pending: ['trunk tilt'], unseen: [], wrongView: [] });
  assert.deepEqual(evs.at(-1).form.faults, [
    { fault: 'top_arm', label: 'top arm not straight up', fixed: true, told: true },
    { fault: 'trunk_tilt', label: 'trunk too upright', fixed: false, told: true }]);
});

test('hold form: a fault the form told and saw fixed before the hold was told was never said: not in hold_end', () => {
  // told 6 s into the hold; the top arm off for its first 2 s (a fault by 1.5 s, fixed by about 4 s)
  const tr = new MovementTracker({ movement: TRIANGLE, tuning: { HOLD_TOLD_MS: 6000 } });
  const evs = runLm(tr, () => pose(), t => triangleLm({ topArm: t < 2000 ? 60 : 10 }), 12000);
  evs.push(...tr.finish(12000));
  assert.deepEqual(types(evs), ['hold_start', 'hold_progress', 'hold_end']);
  assert.deepEqual(evs[0].form.open, []);
  assert.deepEqual(tr.form.summary().faults.map(f => [f.fault, f.fixed, f.told]), [['top_arm', true, true]]);
  assert.deepEqual(evs[2].form.faults, []);
});

test('hold form: every check out of view: form_unseen HOLD_WAIT_MS after hold_start, then once every EVERY_MS', () => {
  // a made-up hold whose one check needs the legs, the ankles not seen (the feet out of the picture)
  const FORMS = { made_up_stretch: [{ id: 'stance', name: 'stance width', label: 'feet too close together',
    needs: ['legs'], order: 1, part: 'feet', value: m => m.stance, bad: () => false, ok: () => true, measured: String,
    target: 't', cue: 'c' }] };
  const tr = new MovementTracker({ movement: HOLD, holdForms: FORMS });
  const evs = runLm(tr, () => pose(), () => triangleLm({ hide: [27, 28] }), 45000);
  const start = evs.find(e => e.type === 'hold_start'), unseen = evs.filter(e => e.type === 'form_unseen');
  assert.ok(start, 'a hold');
  assert.equal(unseen.length, 2);
  assert.ok(Math.abs(unseen[0].at - start.at - UNSEEN_TUNING.HOLD_WAIT_MS) <= 2 * DT, `${unseen[0].at - start.at} ms`);
  assert.ok(Math.abs(unseen[1].at - unseen[0].at - UNSEEN_TUNING.EVERY_MS) <= 2 * DT, 'again EVERY_MS later');
  assert.deepEqual({ ...unseen[0], at: 0, t: 0 }, { type: 'form_unseen', key: 'made_up_stretch',
    display: 'Made-up stretch', kind: 'hold', t: 0, missing: ['stance width'], parts: ['feet'], why: 'frame',
    cue: 'Step back so I can see your feet: I can\'t check your form.', at: 0 });
  // the feet in the picture: nothing
  const seen = new MovementTracker({ movement: HOLD, holdForms: FORMS });
  assert.deepEqual(runLm(seen, () => pose(), () => triangleLm(), 45000).filter(e => e.type === 'form_unseen'), []);
  // the triangle's own checks, the feet out of the picture: its arms and trunk still checked, nothing said
  const tri = new MovementTracker({ movement: TRIANGLE });
  assert.deepEqual(runLm(tri, () => pose(), () => triangleLm({ hide: [27, 28] }), 45000)
    .filter(e => e.type === 'form_unseen'), []);
});

// --- moving --------------------------------------------------------------------------------------------------------
test('moving: progress every 30 s of movement; pauses do not reset it; a fidget is not moving', () => {
  const tr = new MovementTracker({ movement: MOVING });
  const evs = [];
  evs.push(...run(tr, t => pose({ knee: squatAt(t, 1200), arm: 60 + 50 * Math.sin(t / 300) }), 20000));        // 20 s moving
  evs.push(...run(tr, t => (t % 3000 < 200 ? pose({ armR: 60 }) : pose()), 30000, 20000 + DT));             // 10 s still, twitches
  assert.ok(Math.abs(tr.current().seconds - 20) <= 1, `${tr.current().seconds} s after the pause`);
  evs.push(...run(tr, t => pose({ knee: squatAt(t, 1200) }), 45000, 30000 + DT));                          // 15 s moving
  assert.deepEqual(evs.map(e => [e.type, e.seconds]), [['moving_progress', 30]]);
  const s = tr.summary();
  assert.ok(s.seconds >= 33 && s.seconds <= 36, `${s.seconds} s moving`);
  assert.equal(s.track, 'moving');
  assert.equal(statusText({ track: 'moving', seconds: 102 }), 'Moving 1:42');
});

test('moving: standing still with jitter counts nothing', () => {
  const tr = new MovementTracker({ movement: MOVING });
  run(tr, () => pose({ jitter: 2 }), 60000);
  assert.equal(tr.summary().seconds, 0);
});

// --- rhythm --------------------------------------------------------------------------------------------------------
test('rhythm: 12 knee bends give progress at 5 and 10 (approximate) and a count of 12', () => {
  const tr = new MovementTracker({ movement: RHYTHM });
  const evs = run(tr, t => pose({ knee: squatAt(t) }), 24000 - DT);
  assert.deepEqual(evs.map(e => [e.type, e.count, e.approximate]), [['rhythm_progress', 5, true], ['rhythm_progress', 10, true]]);
  assert.equal(tr.current().count, 12);
  assert.deepEqual(tr.summary(), { key: 'made_up_bends', display: 'Made-up knee bends', kind: 'gym_reps', track: 'rhythm', count: 12, approximate: true });
  assert.equal(statusText(tr.current()), 'About 12');
});

test('rhythm: jitter, and swings smaller than the prominence, count nothing', () => {
  const tr = new MovementTracker({ movement: RHYTHM });
  run(tr, t => pose({ knee: 175 - 10 * (1 - Math.cos(t / 300)), jitter: 2 }), 30000);
  assert.equal(tr.current().count, 0);
});

test('rhythm: the legs out of view restart the zigzag but keep the count', () => {
  const tr = new MovementTracker({ movement: RHYTHM });
  run(tr, t => pose({ knee: squatAt(t), legs: t >= 6000 && t < 7000 ? 0 : 1 }), 12000 - DT);
  // 6 bends; the one under way when the legs left the picture (5-7 s) is lost
  assert.equal(tr.current().count, 5);
});

test('CycleCounter: a cycle on the way back whichever end it starts from; faster than minPeriod is a wobble', () => {
  const count = (vals, opts) => { const c = new CycleCounter(opts); vals.forEach((v, i) => c.update(v, i * 100)); return c.count; };
  const wave = (n, lo, hi, startHigh, step = 10) => {
    const out = [];
    for (let i = 0; i <= n * step; i++) { const c = Math.cos((2 * Math.PI * i) / step); out.push(lo + ((hi - lo) * (1 + (startHigh ? c : -c))) / 2); }
    return out;
  };
  assert.equal(count(wave(4, 90, 170, true), { prominence: 30 }), 4);      // from the top (standing, squats)
  assert.equal(count(wave(4, 10, 90, false), { prominence: 30 }), 4);      // from the bottom (arms down, raises)
  assert.equal(count(wave(4, 90, 170, true), { prominence: 100 }), 0);
  assert.equal(count(wave(6, 90, 170, true, 4), { prominence: 30, minPeriodMs: 700 }), 3);   // 0.4 s cycles, 0.7 s minimum
});

test('rhythm: a width across the picture counts from the front only (from the side, jitter swings it by many widths)', () => {
  const ROT = { key: 'made_up_rotation', display: 'Made-up rotation', kind: 'gym_reps', track: 'rhythm',
    rhythm: { signal: 'wristSpread', prominence: 0.97, minPeriodS: 1.5 } };
  const out = t => 1.2 + (1 - Math.cos((2 * Math.PI * t) / 2500));                  // hands 1.2 -> 3.2 -> 1.2 apart, 2.5 s
  let tr = new MovementTracker({ movement: ROT });
  run(tr, t => pose({ spread: out(t) }), 25000 - DT);
  assert.equal(tr.current().count, 10, 'ten reps from the front');
  // a person standing still, side on, for a minute: nothing (without the gate, the jitter alone counted)
  const still = () => pose({ side: true });
  tr = new MovementTracker({ movement: ROT });
  assert.deepEqual(run(tr, still, 60000), []);
  assert.equal(tr.current().count, 0);
  const ungated = new MovementTracker({ movement: ROT });
  ungated.signal = { ...ungated.signal, view: 0 };
  run(ungated, still, 60000);
  assert.ok(ungated.current().count >= 5, `without the gate: ${ungated.current().count} cycles of jitter`);
  // ... nor a person doing the movement side on (the hands' spread is not seen from there)
  tr = new MovementTracker({ movement: ROT });
  run(tr, t => pose({ side: true, arm: 15 + 20 * (1 - Math.cos((2 * Math.PI * t) / 2500)) }), 25000);
  assert.equal(tr.current().count, 0);
});

// --- a moving or rhythm movement's form (web/js/moveform.js; tests/moveform.test.mjs tests its timing and checks) ---
// the example check's movement, made up as the library has it (its rhythm: the hands' spread, as the test above)
const ROTATION = { key: 'shoulder_external_rotation', display: 'Made-up rotation', kind: 'gym_reps', track: 'rhythm',
  rhythm: { signal: 'wristSpread', prominence: 0.97, minPeriodS: 1.5 } };
/** Its checks here: the first example's alone (web/js/moveforms/arms.js has the real ones, tested on their own), so
 * these tests are of the tracker's hand-over, whatever the arms' checks become. */
const ELBOWS = { shoulder_external_rotation: [{ id: 'elbows_out', name: 'elbows at your sides',
  label: 'elbows drifting off the sides', part: 'elbow', needs: ['arms'], views: ['front'], at: 'peak', order: 1,
  side: m => (m.armL > 45 && m.armR > 45 ? null : m.armL >= m.armR ? 'L' : 'R'),
  value: m => Math.max(m.armL, m.armR), bad: v => v > 45, ok: v => v <= 40,
  measured: v => `elbow ${Math.round(v)} degrees out from your side as your hands turn out`,
  target: 'elbows tucked in at your sides, within about 30 degrees',
  cue: 'Keep your elbows pinned to your sides as you turn your hands out.' }] };
/** A frame's landmarks {world, image, aspect} of a person facing the camera (hips and shoulders 0.3 m wide, the
 * shoulders over the hips; legs 0.9 m, trunk 0.5 m leaning `lean` deg forward), the elbows bent with the forearms in
 * front, the upper arms `out` deg out from the sides, the forearms turned `turn` deg out (a shoulder external
 * rotation); a few mm of jitter. `hide`: the arms not visible. */
function rotationLm({ out = 5, turn = 0, lean = 0, hide = false } = {}) {
  const r = Math.PI / 180, P = { 23: [0.15, 0, 0], 24: [-0.15, 0, 0] };
  for (const [hip, kn, an] of [[23, 25, 27], [24, 26, 28]]) {
    P[kn] = add3(P[hip], [0, 1, 0], 0.45); P[an] = add3(P[hip], [0, 1, 0], 0.9);
    P[an + 2] = add3(P[an], [0, 0.04, 0.05]); P[an + 4] = add3(P[an], [0, 0.06, -0.15]);    // heel, toes
  }
  const u = [0, -Math.cos(lean * r), -Math.sin(lean * r)], sm = add3([0, 0, 0], u, 0.5);
  P[11] = add3(sm, [1, 0, 0], 0.15); P[12] = add3(sm, [1, 0, 0], -0.15);
  for (const [sh, el, wr, sx] of [[11, 13, 15, 1], [12, 14, 16, -1]]) {
    P[el] = add3(P[sh], [sx * Math.sin(out * r), Math.cos(out * r), 0], 0.3);
    P[wr] = add3(P[el], [sx * Math.sin(turn * r), 0, -Math.cos(turn * r)], 0.27);
    for (const h of [wr + 2, wr + 4, wr + 6]) P[h] = P[wr];                               // the hand's points
  }
  P[0] = add3(add3(sm, u, 0.25), [0, 0, -1], 0.1);
  P[7] = add3(P[0], [1, 0, 0], 0.07); P[8] = add3(P[0], [1, 0, 0], -0.07);
  const world = [], image = [];
  for (let i = 0; i < 33; i++) {
    const p = (P[i] ?? P[0]).map(v => v + 0.003 * rnd());
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (2.4 * 16 / 9), y: 0.55 + p[1] / 2.4, z: 0,
      visibility: hide && i >= 13 && i <= 22 ? 0 : 1 });
  }
  return { world, image, aspect: 16 / 9 };
}
const turnAt = t => 40 * (1 - Math.cos((2 * Math.PI * t) / 2500));            // the forearms 0 -> 80 deg out, 2.5 s
/** As run(), the frames' features from their landmarks (engine.js features, as the page) `lmAt(t)`, given with them
 * or not (`withLm`). */
function runRot(tr, lmAt, to, from = 0, withLm = true) {
  const out = [];
  for (let t = from; t <= to; t += DT) {
    const lm = lmAt(t);
    out.push(...tr.update(features(lm.world, lm.image, lm.aspect), t, withLm ? lm : null).map(e => ({ ...e, at: t })));
  }
  return out;
}
const formEvents = evs => evs.filter(e => e.type === 'form_fault' || e.type === 'form_fix');

test('move form: without landmarks, or for a movement without a check, moving and rhythm as before, form: null', () => {
  const pinned = t => rotationLm({ turn: turnAt(t) });
  const bare = new MovementTracker({ movement: ROTATION, forms: ELBOWS });
  const seen = new MovementTracker({ movement: ROTATION, forms: ELBOWS });
  const a = runRot(bare, pinned, 25000, 0, false), b = runRot(seen, pinned, 25000);
  // the count is the form's business no more than the form is the count's
  assert.deepEqual(a.map(e => [e.type, e.count]), [['rhythm_progress', 5], ['rhythm_progress', 10]]);
  assert.deepEqual(b.filter(e => e.type === 'rhythm_progress').map(e => e.count), [5, 10]);
  assert.equal(bare.current().count, seen.current().count);
  for (const e of a) assert.equal(e.form, null);
  assert.equal(bare.current().form, null);
  assert.ok(!('form' in bare.summary()), 'no form measured: summary() as before');
  // a rhythm and a moving movement without a check: as before with their landmarks, form: null
  const bends = new MovementTracker({ movement: RHYTHM });
  const evs = runLm(bends, t => pose({ knee: squatAt(t) }), () => rotationLm(), 24000 - DT);
  assert.deepEqual(evs.map(e => [e.type, e.count, e.form]),
    [['rhythm_progress', 5, null], ['rhythm_progress', 10, null]]);
  assert.deepEqual(bends.summary(), { key: 'made_up_bends', display: 'Made-up knee bends', kind: 'gym_reps',
    track: 'rhythm', count: 12, approximate: true });
  assert.equal(bends.mf, null);
  const dance = new MovementTracker({ movement: MOVING });
  const moved = runLm(dance, t => pose({ knee: squatAt(t, 1200), arm: 60 + 50 * Math.sin(t / 300) }),
    () => rotationLm(), 31000);
  assert.deepEqual(moved.map(e => [e.type, e.seconds, e.form]), [['moving_progress', 30, null]]);
  assert.equal(dance.current().form, null);
});

test('move form: a rhythm\'s peak check through the tracker: checked while right, its fault, then its fix', () => {
  const tr = new MovementTracker({ movement: ROTATION, forms: ELBOWS });
  // 25 s with the elbows at the sides: checked, said with the progress; nothing told
  const good = runRot(tr, t => rotationLm({ turn: turnAt(t) }), 25000);
  assert.deepEqual(formEvents(good), []);
  const prog = good.filter(e => e.type === 'rhythm_progress');
  assert.deepEqual(prog.map(e => e.count), [5, 10]);
  for (const e of prog) {
    assert.deepEqual(e.form, { checked: ['elbows at your sides'], open: [], pending: [], unseen: [], wrongView: [] });
  }
  assert.deepEqual(tr.current().form.checked, ['elbows at your sides']);
  // 15 s with the upper arms 55 deg out from the sides: told once, on the second bad peak
  const out = runRot(tr, t => rotationLm({ out: 55, turn: turnAt(t) }), 40000, 25000 + DT);
  const faults = formEvents(out);
  assert.equal(faults.length, 1);
  const f = faults[0];
  assert.ok(f.at > 25000 + 2500 && f.at < 25000 + 2 * 2500 + 1500, `told at ${f.at}`);
  assert.deepEqual({ ...f, measured: null, at: null, t: null, seen: null }, { type: 'form_fault',
    key: 'shoulder_external_rotation', display: 'Made-up rotation', kind: 'gym_reps', t: null, fault: 'elbows_out',
    label: 'elbows drifting off the sides', measured: null,
    target: 'elbows tucked in at your sides, within about 30 degrees',
    cue: 'Keep your elbows pinned to your sides as you turn your hands out.', part: 'elbow', side: null, at: null,
    seen: null });
  assert.equal(f.t, f.at);
  // `seen`: the frames around the peak it measured (the hands widest: 1.25 s into each 2.5 s), before the event
  const peakAt = Math.round((f.seen.from + f.seen.to) / 2 / 2500 - 0.5) * 2500 + 1250;
  assert.ok(f.seen.from <= peakAt && peakAt <= f.seen.to && f.seen.to <= f.t, `${JSON.stringify(f.seen)} at ${f.t}`);
  assert.match(f.measured, /^elbow 5\d degrees out from your side/);
  assert.deepEqual(tr.current().form.open.map(x => x.fault), ['elbows_out']);
  // back at the sides: fixed on the second good peak
  const back = runRot(tr, t => rotationLm({ turn: turnAt(t) }), 55000, 40000 + DT);
  assert.deepEqual(formEvents(back).map(e => [e.type, e.fault, e.label]),
    [['form_fix', 'elbows_out', 'elbows drifting off the sides']]);
  assert.deepEqual(tr.summary().form, { checked: ['elbows at your sides'], faults: [{ fault: 'elbows_out',
    label: 'elbows drifting off the sides', fixed: true, told: true }] });
  // ...and settle(t), as a hold's: the form's open fault counts as told then
  tr.settle(55000);
});

test('move form: a rhythm keeps its signal\'s recent swing for a form check only, and only its window\'s', () => {
  const bare = new MovementTracker({ movement: ROTATION, forms: {} });
  const formed = new MovementTracker({ movement: ROTATION, forms: ELBOWS });
  runRot(bare, t => rotationLm({ turn: turnAt(t) }), 60000);
  runRot(formed, t => rotationLm({ turn: turnAt(t) }), 60000);
  assert.equal(bare.swing.length, 0, 'no form check: none kept');
  assert.ok(formed.swing.length <= formed.swingMs / DT + 2, `${formed.swing.length} frames kept`);
});

test('move form: each turn is handed over once, on the frame that confirms it (none on a frame out of view)', () => {
  const tr = new MovementTracker({ movement: ROTATION, forms: ELBOWS }), handed = [], confirmed = [];
  let hide = false;
  const update = tr.mf.update.bind(tr.mf), count = tr.cycles.update.bind(tr.cycles);
  const periods = new Set();
  tr.mf.update = (m, lm, t, cycle, moving) => {
    if (cycle) { handed.push(cycle.t); periods.add(cycle.periodMs); }
    return update(m, lm, t, cycle, moving);
  };
  tr.cycles.update = (v, t) => {
    const r = count(v, t);
    if (tr.cycles.turn) { confirmed.push(tr.cycles.turn.t); hide = true; }
    return r;
  };
  // the arms hidden on the frame after each turn (a hand crossing the frame's edge: the count keeps going)
  runRot(tr, t => { const lm = rotationLm({ turn: turnAt(t), hide }); hide = false; return lm; }, 20000);
  assert.ok(confirmed.length >= 12, `${confirmed.length} turns`);
  assert.deepEqual(handed, confirmed);
  // each with the rhythm's period, 2 x minPeriodS (the verdicts expire by it)
  assert.deepEqual([...periods], [3000]);
});

test('move form: a moving movement\'s frame check, judged on the frames counted as moving, after the warm-up', () => {
  const FORMS = { made_up_dance: [{ id: 'lean', name: 'trunk up', label: 'leaning far forward', part: 'torso',
    needs: ['trunk'], at: 'frame', order: 1, value: m => m.trunkLeanFwd, bad: v => v > 30, ok: v => v <= 25,
    measured: v => `trunk ${Math.round(v)} degrees forward`, target: 'upright', cue: 'Lift your chest.' }] };
  const tr = new MovementTracker({ movement: MOVING, forms: FORMS });
  const dancing = t => pose({ knee: squatAt(t, 1200), arm: 60 + 50 * Math.sin(t / 300) });
  // standing still 10 s, leaning: nothing (still frames are never judged)
  assert.deepEqual(runLm(tr, () => pose(), () => rotationLm({ lean: 40 }), 10000), []);
  assert.deepEqual(tr.current().form, { checked: [], open: [], pending: [], unseen: [], wrongView: [] });
  // dancing, leaning: told once moving MOVING_MIN_MS, warmed up and lasted
  const evs = runLm(tr, dancing, () => rotationLm({ lean: 40 }), 45000, 10000 + DT);
  const fault = evs.find(e => e.type === 'form_fault');
  assert.ok(fault, 'told');
  assert.deepEqual([fault.fault, fault.part, fault.side, fault.measured],
    ['lean', 'torso', null, 'trunk 40 degrees forward']);
  const at = fault.at - 10000;
  assert.ok(at >= MOVE_TUNING.WARM_MS + MOVE_TUNING.FAULT_MS && at <= MOVE_TUNING.WARM_MS + MOVE_TUNING.FAULT_MS
    + TUNING.MOVING_MIN_MS + 500, `told ${at} ms into the dance`);
  const prog = evs.find(e => e.type === 'moving_progress');
  assert.deepEqual(prog.form.open.map(f => f.fault), ['lean']);
  // out of view 6 s (a pause), then dancing upright: the warm-up again, then the fix
  const away = run(tr, () => null, 51000, 45000 + DT);
  assert.deepEqual(away, []);
  const back = runLm(tr, dancing, () => rotationLm(), 60000, 51000 + DT);
  const fix = back.find(e => e.type === 'form_fix');
  assert.ok(fix && fix.at - 51000 >= MOVE_TUNING.WARM_MS, `fixed at ${fix?.at}`);
  assert.deepEqual(tr.summary().form.faults.map(f => [f.fault, f.fixed, f.told]), [['lean', true, true]]);
  assert.ok(tr.summary().seconds > 40, `${tr.summary().seconds} s moving`);
});

test('CycleCounter: the turn it confirms: which extreme, when, its half cycle, far end, counted or a wobble', () => {
  const wave = t => 130 - 40 * Math.cos((2 * Math.PI * t) / 1000);       // from its low (90) to 170 and back, 1 s
  const turns = (minPeriodMs) => {
    const c = new CycleCounter({ prominence: 30, minPeriodMs }), out = [];
    for (let t = 0; t <= 3000; t += 100) { c.update(wave(t), t); if (c.turn) out.push({ ...c.turn, at: t }); }
    return out;
  };
  const got = turns(700);
  // (cycleFrom: the turn of the same kind before, the start counting as the first trough; none for the first peak)
  assert.deepEqual(got.map(x => [x.kind, x.t, Math.round(x.v), x.from, x.cycleFrom, x.far, x.counted, x.wobble]), [
    ['peak', 500, 170, 0, 0, true, true, false], ['trough', 1000, 90, 500, 0, false, false, false],
    ['peak', 1500, 170, 1000, 500, true, true, false], ['trough', 2000, 90, 1500, 1000, false, false, false],
    ['peak', 2500, 170, 2000, 1500, true, true, false]]);
  assert.ok(got.every(x => x.at > x.t), 'confirmed after the extreme');
  // a far end sooner than minPeriodMs after the last count: a wobble, not counted
  assert.deepEqual(turns(1200).map(x => [x.kind, x.counted, x.wobble]), [['peak', true, false],
    ['trough', false, false], ['peak', false, true], ['trough', false, false], ['peak', true, false]]);
});

// --- a rhythm's fallback (moves.js FALLBACKS): counting with the signal's own parts out of view --------------------
const SWEEP = { key: 'made_up_sweep', display: 'Made-up sweep', kind: 'gym_reps', track: 'rhythm',
  rhythm: { signal: 'feetWidth', prominence: 1.3, minPeriodS: 1.1,
    fallback: { signal: 'thighOut', prominence: 19, minPeriodS: 1.1 } } };
/** A frame's landmarks of a person facing the camera (hips 0.3 m wide, legs 0.9 m, trunk 0.5 m), the left leg swept
 * out to the side `out` deg, straight; `hideFeet`: the ankles and feet not seen (below the picture's edge). */
function sweepLm({ out = 0, hideFeet = false } = {}) {
  const r = Math.PI / 180, P = { 23: [0.15, 0, 0], 24: [-0.15, 0, 0] };
  const legs = [[23, 25, 27, [Math.sin(out * r), Math.cos(out * r), 0]], [24, 26, 28, [0, 1, 0]]];
  for (const [hip, kn, an, d] of legs) {
    P[kn] = add3(P[hip], d, 0.45); P[an] = add3(P[hip], d, 0.9);
    P[an + 2] = add3(P[an], [0, 0.04, 0.05]); P[an + 4] = add3(P[an], [0, 0.06, -0.15]);
  }
  P[11] = [0.18, -0.5, 0]; P[12] = [-0.18, -0.5, 0];
  for (const [sh, el, wr] of [[11, 13, 15], [12, 14, 16]]) {
    P[el] = add3(P[sh], [0, 1, 0], 0.3); P[wr] = add3(P[sh], [0, 1, 0], 0.57);
    for (const h of [wr + 2, wr + 4, wr + 6]) P[h] = P[wr];
  }
  P[0] = [0, -0.75, -0.1]; P[7] = [0.07, -0.73, 0]; P[8] = [-0.07, -0.73, 0];
  const world = [], image = [], hidden = new Set([27, 28, 29, 30, 31, 32]);
  for (let i = 0; i < 33; i++) {
    const p = (P[i] ?? P[0]).map(v => v + 0.003 * rnd());
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (2.4 * 16 / 9), y: 0.5 + p[1] / 2.4, z: 0,
      visibility: hideFeet && hidden.has(i) ? 0 : 1 });
  }
  return { world, image, aspect: 16 / 9 };
}
const sweepAt = t => 30 * (1 - Math.cos((2 * Math.PI * t) / 2500));    // the leg 0 -> 60 deg out and back, 2.5 s
/** Frames of sweeps through a tracker (`hide(t)`: the feet out of view), with their landmarks or not: the count. */
function sweepRun(movement, hide, to, withLm = true) {
  const tr = new MovementTracker({ movement }), modes = new Set();
  for (let t = 0; t <= to; t += DT) {
    const lm = sweepLm({ out: sweepAt(t), hideFeet: hide(t) });
    tr.update(features(lm.world, lm.image, lm.aspect), t, withLm ? lm : null);
    if (hide(t) && hide(t - 1000)) modes.add(tr.counting);       // (out of view a second already)
  }
  return { tr, modes };
}

test('CycleCounter retune: another signal counted, the zigzag afresh, the count and its last time kept', () => {
  const c = new CycleCounter({ prominence: 30, minPeriodMs: 700 });
  const wave = (t, lo, hi) => lo + ((hi - lo) * (1 - Math.cos((2 * Math.PI * t) / 1000))) / 2;
  for (let t = 0; t <= 2000; t += 100) c.update(wave(t, 90, 170), t);
  assert.equal(c.count, 2);
  c.retune(0.5, 700);
  assert.deepEqual([c.p, c.minPeriod, c.dir, c.hi, c.turns, c.count], [0.5, 700, null, null, 0, 2]);
  // a turn of the new signal confirmed right after the switch is no cycle (the zigzag starts afresh), nor a cycle
  // sooner than minPeriodMs after the last one counted by the old signal
  let counted = 0;
  for (let t = 2100; t <= 4500; t += 100) if (c.update(wave(t, 0, 2), t)) counted += 1;
  assert.equal(counted, 2, 'the new signal\'s cycles, from its second turn');
});

test('rhythm fallback: the feet out of view, the sweeps counted on the thigh; none counted twice at a switch', () => {
  // 30 sweeps: 10 with the feet in view, 10 with them out (below the picture), 10 in view again
  const hidden = t => t >= 25000 && t < 50000;
  const { tr, modes } = sweepRun(SWEEP, hidden, 75000 - DT);
  assert.ok(tr.current().count >= 28 && tr.current().count <= 30, `${tr.current().count} counted of 30`);
  assert.deepEqual([...modes], ['fallback'], 'counted on the fallback while the feet were out');
  assert.equal(tr.counting, 'main', 'back on the feet\'s spread');
  // the feet in view throughout: the signal itself, every sweep (as without a fallback)
  const seen = sweepRun(SWEEP, () => false, 75000 - DT);
  assert.equal(seen.tr.current().count, 30);
  const plain = sweepRun({ ...SWEEP, rhythm: { ...SWEEP.rhythm, fallback: undefined } }, () => false, 75000 - DT);
  assert.equal(plain.tr.current().count, 30);
  // ...no fallback in the library entry, or no landmarks given: the sweeps with the feet out are not counted
  const none = sweepRun({ ...SWEEP, rhythm: { ...SWEEP.rhythm, fallback: undefined } }, hidden, 75000 - DT);
  const bare = sweepRun(SWEEP, hidden, 75000 - DT, false);
  for (const r of [none, bare]) assert.ok(r.tr.current().count <= 21, `${r.tr.current().count}`);
  // the feet out from the start: counted on the fallback from the first sweep
  const out = sweepRun(SWEEP, () => true, 25000 - DT);
  assert.ok(out.tr.current().count >= 9, `${out.tr.current().count} of 10`);
});

test('side-crunch attempts: visible feet and thigh lifts count once together; thigh lifts still count with feet width flat', () => {
  const mv = { ...SWEEP, key: 'standing_side_crunch', rhythm: { ...SWEEP.rhythm, preferFallback: true } };
  for (const feetFlat of [false, true]) {
    const tr = new MovementTracker({ movement: mv, forms: {} });
    for (let t = 0; t < 25000; t += DT) {
      const lm = sweepLm({ out: sweepAt(t) }), f = features(lm.world, lm.image, lm.aspect);
      if (feetFlat) f.feetWidth = 1;
      tr.update(f, t, lm);
    }
    assert.ok(tr.current().count >= 9 && tr.current().count <= 10, `ten attempts, counted ${tr.current().count}`);
    const count = tr.current().count;
    for (let t = 25000; t < 30000; t += DT) {
      const lm = sweepLm({ out: sweepAt(t) });
      for (const i of [23, 24, 25, 26, 27, 28]) lm.image[i].y = 1.2;
      tr.update(features(lm.world, lm.image, lm.aspect), t, lm);
    }
    assert.equal(tr.current().count, count, 'cropped thighs cannot invent attempts');
  }
});

test('a rhythm turn is cleared on an unseen or lost frame, without repeating its count', () => {
  const tr = new MovementTracker({ movement: SWEEP });
  let t = 0;
  for (; t < 10000; t += DT) {
    const lm = sweepLm({ out: sweepAt(t) });
    tr.update(features(lm.world, lm.image, lm.aspect), t, lm);
    if (tr.cycles.turn?.counted) break;
  }
  assert.ok(tr.cycles.turn?.counted);
  const count = tr.current().count;
  tr.lost(t + DT);
  assert.equal(tr.cycles.turn, null);
  assert.equal(tr.current().count, count);
});

test('build: a rhythm whose signal has a fallback gets its parameters from the reference, as the signal\'s own', () => {
  // the feet stepped out to the sides and back, the legs straight: counted on the feet's spread, its fallback the
  // thigh out from down
  const out = t => 50 * (1 - Math.cos((2 * Math.PI * t) / 2000)) / 2;
  const sk = skeletonOfPoints(t => {
    const P = bodyPoints({ stance: 0.25, tilt: 0, right: -180, left: 180 }), r = Math.PI / 180, a = out(t) * r;
    for (const [hip, kn, an, sx] of [[23, 25, 27, 1], [24, 26, 28, -1]]) {
      const d = [sx * Math.sin(a), Math.cos(a), 0];
      P[kn] = add3(P[hip], d, 0.45); P[an] = add3(P[hip], d, 0.9);
    }
    return P;
  }, 8);
  const r = rhythmOf(skeletonFeatures(sk), FPS);
  assert.equal(r.signal, 'feetWidth');
  assert.equal(r.fallback.signal, 'thighOut');
  assert.ok(r.fallback.prominence >= 3 * FALLBACKS.thighOut.unit, `${r.fallback.prominence}`);
  assert.ok(r.fallback.minPeriodS >= 0.8 && r.fallback.minPeriodS <= 1.2, `${r.fallback.minPeriodS}`);
  // a signal without one (the knee bends): none
  assert.equal(rhythmOf(skeletonFeatures(skeletonFromNpz(skelNpz(bendingSkeleton(4)))), FPS).fallback, undefined);
});

// --- frame rate ----------------------------------------------------------------------------------------------------
test('6 fps with uneven frame times (a slow camera): the hold, the time moving and the rhythm as at 30 fps', () => {
  // squats 4 s, still 36 s, squats again
  const script = t => (t < 4000 || t >= 40000 ? pose({ knee: squatAt(t) }) : pose());
  const at30 = run(new MovementTracker({ movement: HOLD }), script, 46000);
  const at6 = runAt(6, new MovementTracker({ movement: HOLD }), script, 46000);
  assert.deepEqual(types(at6), types(at30));
  assert.deepEqual(types(at6), ['hold_start', 'hold_progress', 'hold_progress', 'hold_progress', 'hold_end']);
  assert.ok(Math.abs(at6.at(-1).seconds - at30.at(-1).seconds) <= 1, `held ${at6.at(-1).seconds} s at 6 fps, ${at30.at(-1).seconds} s at 30`);
  assert.ok(Math.abs(at6.at(-1).seconds - 36) <= 1.5, `${at6.at(-1).seconds} s`);
  // moving 20 s, still 10 s, moving 15 s
  const dance = t => (t < 20000 || t >= 30000 ? pose({ knee: squatAt(t, 1200), arm: 60 + 50 * Math.sin(t / 300) }) : pose());
  const m30 = new MovementTracker({ movement: MOVING }), m6 = new MovementTracker({ movement: MOVING });
  run(m30, dance, 45000); runAt(6, m6, dance, 45000);
  assert.ok(Math.abs(m6.movingMs - m30.movingMs) <= 0.1 * m30.movingMs, `moving ${m6.movingMs} ms at 6 fps, ${m30.movingMs} at 30`);
  assert.ok(m6.summary().seconds >= 33 && m6.summary().seconds <= 37, `${m6.summary().seconds} s`);
  // 12 knee bends
  const r6 = new MovementTracker({ movement: RHYTHM });
  runAt(6, r6, t => pose({ knee: squatAt(t) }), 24000 - DT);
  assert.equal(r6.current().count, 12);
  // and down to 4 fps the hold still starts and ends
  assert.deepEqual(types(runAt(4, new MovementTracker({ movement: HOLD }), script, 46000)),
    ['hold_start', 'hold_progress', 'hold_progress', 'hold_progress', 'hold_end']);
});

// --- reps, construction --------------------------------------------------------------------------------------------
test('reps: nothing to track here (the engine counts them), no events', () => {
  const m = { key: 'made_up_squat', display: 'Made-up squat', kind: 'gym_counted', track: 'reps', engine: 'squat' };
  const tr = new MovementTracker({ movement: m });
  assert.deepEqual(run(tr, t => (t < 5000 ? pose() : pose({ knee: squatAt(t) })), 15000), []);
  assert.deepEqual(tr.finish(15000), []);
  assert.deepEqual(tr.summary(), { key: m.key, display: m.display, kind: m.kind, track: m.track });
  assert.equal(statusText(tr.current()), '');
});

test('construction: the track comes from the entry (or its kind); a rhythm needs a known signal', () => {
  assert.equal(new MovementTracker({ movement: { key: 'x', display: 'X', kind: 'transition' } }).track, 'moving');
  assert.throws(() => new MovementTracker({ movement: { key: 'x', display: 'X', kind: 'gym_reps', track: 'rhythm' } }), /rhythm/);
  assert.throws(() => new MovementTracker({ movement: { key: 'x', display: 'X', kind: 'gym_reps', track: 'rhythm', rhythm: { signal: 'nope', prominence: 1 } } }), /rhythm/);
  assert.throws(() => new MovementTracker({ movement: { key: 'x', display: 'X', kind: 'dance', track: 'counted' } }), /track/);
  assert.throws(() => new MovementTracker({}), /movement/);
  // a kind the library does not offer, or a track that does not exist, is no movement to follow
  assert.throws(() => new MovementTracker({ movement: { key: 'x', display: 'X', kind: 'idle' } }), /unknown track/);
  assert.throws(() => new MovementTracker({ movement: { key: 'x', display: 'X', kind: 'gesture', track: 'none' } }), /unknown track none/);
  assert.deepEqual(TRACKS, ['reps', 'rhythm', 'hold', 'moving', 'technique']);
  assert.deepEqual(new Set(Object.values(TRACK_OF_KIND)), new Set(TRACKS));
  for (const [k, s] of Object.entries(SIGNALS)) assert.ok(s.unit > 0 && ['legs', 'arms', 'torso'].includes(s.needs), k);
  assert.ok(TUNING.MOVE > TUNING.STILL);
});

// --- the build -----------------------------------------------------------------------------------------------------
/** A stored (uncompressed) zip of .npy arrays, as numpy's savez writes. */
function npz(arrays) {
  const npy = ({ descr, shape, bytes }) => {
    let h = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
    h += ' '.repeat(63 - ((h.length + 10) % 64)) + '\n';
    const head = Buffer.alloc(10); head.write('\x93NUMPY', 0, 'latin1'); head[6] = 1; head[7] = 0; head.writeUInt16LE(h.length, 8);
    return Buffer.concat([head, Buffer.from(h, 'latin1'), bytes]);
  };
  const parts = [], central = [];
  let off = 0;
  for (const [name, a] of Object.entries(arrays)) {
    const data = npy(a), fname = Buffer.from(`${name}.npy`);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fname.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(fname.length, 28); cen.writeUInt32LE(off, 42);
    parts.push(local, fname, data); central.push(cen, fname);
    off += 30 + fname.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(arrays).length, 8); end.writeUInt16LE(Object.keys(arrays).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const f32 = (shape, values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return { descr: '<f4', shape, bytes: b }; };
const unicode = (names, w = 14) => { const b = Buffer.alloc(names.length * w * 4); names.forEach((s, i) => [...s].forEach((c, j) => b.writeUInt32LE(c.codePointAt(0), (i * w + j) * 4))); return { descr: `<U${w}`, shape: [names.length], bytes: b }; };

const JOINTS = ['pelvis', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_foot', 'right_foot',
  'head', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'];
/** A made-up skeleton (SMPL joint names, Y-up metres, facing +z) doing `n` knee bends of `period` ms at 30 fps. */
function bendingSkeleton(n = 4, period = 2000) {
  const frames = Math.round((n * period * FPS) / 1000) + 1, out = [];
  for (let i = 0; i < frames; i++) {
    const phi = (25 * (1 - Math.cos((2 * Math.PI * i * DT) / period)) * Math.PI) / 180;   // 0..50 deg: knee 180 -> 80
    const pose = {};
    for (const [side, x] of [['left', 0.1], ['right', -0.1]]) {
      const ankle = [x, 0.08, 0], knee = [x, 0.08 + 0.42 * Math.cos(phi), 0.42 * Math.sin(phi)];
      const hip = [x, knee[1] + 0.42 * Math.cos(phi), 0];
      Object.assign(pose, { [`${side}_ankle`]: ankle, [`${side}_knee`]: knee, [`${side}_hip`]: hip, [`${side}_foot`]: [x, 0.02, 0.12] });
    }
    const y = pose.left_hip[1], lean = phi / 2;
    pose.pelvis = [0, y, 0];
    const up = (h, x) => [x, y + h * Math.cos(lean), h * Math.sin(lean)];
    Object.assign(pose, { left_shoulder: up(0.5, 0.18), right_shoulder: up(0.5, -0.18), head: up(0.72, 0),
      left_elbow: up(0.22, 0.2), right_elbow: up(0.22, -0.2), left_wrist: up(-0.02, 0.2), right_wrist: up(-0.02, -0.2) });
    out.push(JOINTS.map(k => pose[k]));
  }
  return { fps: FPS, names: JOINTS, frames: out };
}
const skelNpz = sk => npz({ joints_3d: f32([sk.frames.length, sk.names.length, 3], sk.frames.flat(2)), joint_names: unicode(sk.names), fps: f32([], [sk.fps]) });

test('build: the skeleton npz reader, and the skeleton seen as the page sees a person', () => {
  const sk = bendingSkeleton();
  const read = skeletonFromNpz(skelNpz(sk));
  assert.equal(read.fps, FPS);
  assert.equal(read.joints.left_knee.length, sk.frames.length);
  assert.ok(Math.abs(read.joints.head[0][1] - sk.frames[0][9][1]) < 1e-6);
  assert.deepEqual(Object.keys(readNpz(skelNpz(sk), ['fps'])), ['fps']);
  const fr = skeletonFeatures(read);
  assert.ok(fr[0].f.kneeMax > 170, `standing knee ${fr[0].f.kneeMax}`);
  const bottom = fr[Math.round(FPS)].f;                    // 1 s in: the bottom of the first bend
  assert.ok(bottom.kneeMax < 95, `bottom knee ${bottom.kneeMax}`);
  assert.equal(fr[0].f.view, 'front');
  assert.ok(fr[0].f.visLegs >= 0.6 && fr[0].f.visArms >= 0.6, 'in the picture');
});

test('build: the rhythm of a repeated movement comes from its reference skeleton and counts it', () => {
  const read = skeletonFromNpz(skelNpz(bendingSkeleton(4)));
  const fr = skeletonFeatures(read);
  const info = {};
  const r = rhythmOf(fr, FPS, info);
  assert.ok(['kneeMin', 'kneeMax', 'hipMin', 'hipAvg', 'hipHeight'].includes(r.signal), r.signal);
  assert.equal(info.cycles, 4, 'the reference itself shows its 4 bends');
  assert.ok(r.minPeriodS >= 0.8 && r.minPeriodS <= 1.2, `${r.minPeriodS}`);
  const tr = new MovementTracker({ movement: { ...RHYTHM, rhythm: r } });
  for (const x of fr) tr.update(x.f, x.t);
  assert.equal(tr.current().count, 4);
  // a reference with a single bend: its period is a guess from the swing, which the build reports (info.cycles < 2)
  const once = {};
  assert.ok(rhythmOf(skeletonFeatures(skeletonFromNpz(skelNpz(bendingSkeleton(1)))), FPS, once));
  assert.ok(once.cycles < 2, `${once.cycles}`);
  // a skeleton that does not move has no rhythm
  const still = bendingSkeleton(0);
  still.frames = Array.from({ length: 90 }, () => still.frames[0]);
  assert.equal(rhythmOf(skeletonFeatures(skeletonFromNpz(skelNpz(still))), FPS), null);
});

// A held pose's held part and its reference pose (heldOf): made-up skeletons of a triangle and a quad stretch, and the
// library's references (private, skipped when absent).
const SMPL_OF = { 11: 'left_shoulder', 12: 'right_shoulder', 13: 'left_elbow', 14: 'right_elbow', 15: 'left_wrist',
  16: 'right_wrist', 23: 'left_hip', 24: 'right_hip', 25: 'left_knee', 26: 'right_knee', 27: 'left_ankle',
  28: 'right_ankle' };
/** A made-up skeleton ({fps, joints}: SMPL joint names, Y-up metres, facing +z, the person's left +x) of `seconds` at
 * 30 fps from MediaPipe-style world points (`pointsAt(t ms)`: {index: [x, y, z]}, y down, x the person's left, z away
 * from the camera). */
function skeletonOfPoints(pointsAt, seconds) {
  const names = [...Object.values(SMPL_OF), 'pelvis', 'head', 'left_foot', 'right_foot'];
  const joints = Object.fromEntries(names.map(k => [k, []]));
  const up = p => [p[0], 1 - p[1], -p[2]];
  for (let i = 0; i <= Math.round(seconds * FPS); i++) {
    const P = pointsAt(i * DT);
    for (const [idx, name] of Object.entries(SMPL_OF)) joints[name].push(up(P[idx]));
    joints.pelvis.push(up(add3(P[23], add3(P[24], P[23], -1), 0.5)));
    joints.head.push(up(P[0]));
    joints.left_foot.push(up(add3(P[27], [0, 0.05, -0.12]))); joints.right_foot.push(up(add3(P[28], [0, 0.05, -0.12])));
  }
  return { fps: FPS, joints };
}
/** The same skeleton mirrored: left for right (x flipped, the joints' sides swapped). */
const mirrorSkeleton = sk => ({ fps: sk.fps, joints: Object.fromEntries(Object.entries(sk.joints).map(([k, v]) => [
  k.replace(/^(left|right)_/, (_, s) => (s === 'left' ? 'right_' : 'left_')), v.map(p => [-p[0], p[1], p[2]])])) });
/** A person facing the camera (legs 0.9 m, trunk 0.5 m, arms 0.6 m, as triangleLm): the feet `stance` leg lengths
 * apart, the trunk tipped `tilt` deg over the left leg, the right and left arms `right` and `left` deg from straight up
 * in the body's plane (positive toward the person's left); the right knee bent to `knee` deg with the shin back (the
 * quad stretch's heel). The triangle: right 10, left 190; standing: tilt 0, right -180, left 180. */
function bodyPoints({ stance = 1.1, tilt = 60, right = 10, left = 190, knee = 180 } = {}) {
  const r = Math.PI / 180, a = Math.asin((stance * 0.9 - 0.2) / 1.8), t = tilt * r;
  const P = { 23: [0.1, 0, 0], 24: [-0.1, 0, 0] };
  for (const [hip, kn, an, sx, bend] of [[23, 25, 27, 1, 0], [24, 26, 28, -1, (180 - knee) * r]]) {
    const d = [sx * Math.sin(a), Math.cos(a), 0];
    P[kn] = add3(P[hip], d, 0.45); P[an] = add3(P[kn], [d[0], d[1] * Math.cos(bend), d[1] * Math.sin(bend)], 0.45);
  }
  const sh = [0.5 * Math.sin(t), -0.5 * Math.cos(t), 0], e = [Math.cos(t), Math.sin(t), 0];
  P[11] = add3(sh, e, 0.18); P[12] = add3(sh, e, -0.18);
  const dir = deg => [Math.sin(deg * r), -Math.cos(deg * r), 0];
  P[14] = add3(P[12], dir(right), 0.3); P[16] = add3(P[12], dir(right), 0.6);
  P[13] = add3(P[11], dir(left), 0.3); P[15] = add3(P[11], dir(left), 0.6);
  P[0] = add3(sh, [0.22 * Math.sin(t), -0.22 * Math.cos(t), -0.1]);
  return P;
}
const lerp = (a, b, u) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + (b[k] - a[k]) * u]));
const ease = u => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, u)))) / 2;
/** A made-up clip of a held pose: standing still 1 s, into `pose` over 1 s, held 2-5.5 s (swaying `sway(t)` over its
 * first 1.5 s, still after: `late` changes the still part), back up over 1 s, standing 1 s. */
function holdClip(pose, sway, late = {}) {
  const stand = { stance: 0.45, tilt: 0, right: -180, left: 180, knee: 180 };
  const full = { ...stand, ...pose };
  return skeletonOfPoints(t => {
    const s = t / 1000;
    if (s < 2) return bodyPoints(lerp(stand, full, ease(s - 1)));
    if (s < 3.5) return bodyPoints(sway(full, s - 2));
    if (s < 5.5) return bodyPoints({ ...full, ...late });
    return bodyPoints(lerp(stand, full, 1 - ease(s - 5.5)));
  }, 7.5);
}
const TRIANGLE_SKEL = { pose: { stance: 1.1, tilt: 60, right: 10, left: 190 },
  sway: (p, s) => ({ ...p, tilt: p.tilt + 8 * Math.sin(4 * Math.PI * s) }) };       // 2 Hz, 8 deg: not still
const QUAD_SKEL = { pose: { stance: 0.2 / 0.9, right: -175, left: 175, knee: 45 },
  sway: (p, s) => { const w = Math.sin(4 * Math.PI * s);                          // the knee and both arms, 2 Hz
    return { ...p, knee: p.knee + 15 * w, right: p.right + 30 * w, left: p.left - 30 * w }; } };

test('build: a held pose\'s held part: its stillest second in the pose with its form right, grown while still', () => {
  const skel = holdClip(TRIANGLE_SKEL.pose, TRIANGLE_SKEL.sway);
  const info = {};
  const h = heldOf(skel, 'triangle_pose', info);
  // the still part of the hold (3.5-5.5 s), give or take the stillness measure's half window and the slow start of
  // getting up: not the swaying part before it, nor the standing still before and after (as still, but out of the pose)
  const { start, end } = h.held;
  assert.ok(start >= 3.5 && start <= 3.9 && end >= 5.1 && end <= 5.75, `${start}-${end}`);
  assert.ok(info.score <= TUNING.STILL, `${info.score}`);
  // every frame of it right, and the held frames through the form: nothing told, every check fine
  const frames = skeletonLandmarks(skel).filter(f => f.t >= start * 1000 - 1e-6 && f.t <= end * 1000 + 1e-6);
  const hf = new HoldForm({ key: 'triangle_pose' });
  for (const f of frames) {
    const m = poseMetrics(f.world, f.image, 16 / 9);
    assert.ok(poseRight('triangle_pose', m), `${f.t}`);
    assert.deepEqual(hf.update(m, f.t), [], `${f.t}`);
  }
  assert.deepEqual(hf.summary(), { checked: HOLD_FORMS.triangle_pose.map(c => c.name), faults: [] });
  // the pose: the middle frame's 33 image landmarks, as the skeleton is seen (16:9, normalised, to 4 decimals)
  const off = f => Math.abs(f.t - (start + end) * 500);
  const mid = skeletonLandmarks(skel).reduce((b, f) => (off(f) < off(b) ? f : b));
  assert.deepEqual(h.pose.image, mid.image.map(p => [+p.x.toFixed(4), +p.y.toFixed(4)]));
  assert.equal(h.pose.image.length, 33);
  assert.ok(h.pose.image.flat().every(v => v > 0 && v < 1), 'in the picture');
  // facing the camera: the person's left on the picture's right; tipped over the left leg, the left shoulder lower
  const I = h.pose.image;
  assert.ok(I[27][0] > I[28][0] && I[11][1] > I[12][1] && I[16][1] < I[15][1],
    'the front (left) leg, the top (right) arm');
  assert.equal(h.pose.side, 'left');
  // mirrored: the same held part, the other side
  const m = heldOf(mirrorSkeleton(skel), 'triangle_pose');
  assert.deepEqual(m.held, h.held);
  assert.equal(m.pose.side, 'right');
  const J = m.pose.image;
  assert.ok(J[12][1] > J[11][1] && J[15][1] < J[16][1], 'tipped over the right leg, the left arm on top');
});

test('build: the quad stretch\'s side is its bent leg; a pose without a working side has none', () => {
  const skel = holdClip(QUAD_SKEL.pose, QUAD_SKEL.sway);
  const h = heldOf(skel, 'quad_stretch');
  // (the swaying ends at 3.5 s: the measure's window, trimmed of its extremes, calls the frames still a little before)
  assert.ok(h.held.start >= 3.4 && h.held.end <= 5.75 && h.held.end - h.held.start >= 1, JSON.stringify(h.held));
  assert.equal(h.pose.side, 'right');                     // the right heel to the glute
  assert.equal(heldOf(mirrorSkeleton(skel), 'quad_stretch').pose.side, 'left');
  assert.deepEqual(Object.keys(WORKING_SIDE).sort(), Object.keys(HOLD_FORMS).sort());
  // a hold with no form check nor in-pose test: its stillest part (standing still counts too), no working side
  const bare = heldOf(skel, 'made_up_stretch');
  assert.ok(bare.held.end - bare.held.start >= 1);
  assert.equal(bare.pose.side, null);
});

test('build: a stiller part with a fault is not the held part; no right second, no held part', () => {
  // the triangle's still part with the top arm 40 deg off straight up: only the swaying part is right, the stillest
  // second of it alone (not still by the page's measure: nothing to grow into), and the build says so (info.score)
  const off = holdClip(TRIANGLE_SKEL.pose, TRIANGLE_SKEL.sway, { right: 40, left: 220 });
  const info = {};
  const h = heldOf(off, 'triangle_pose', info);
  assert.ok(h.held.start >= 2 && h.held.end <= 3.5, JSON.stringify(h.held));
  assert.ok(Math.abs(h.held.end - h.held.start - 1) < 0.04, JSON.stringify(h.held));
  assert.ok(info.score > TUNING.STILL, `${info.score}`);
  // the feet together all along: never right
  assert.equal(heldOf(holdClip({ ...TRIANGLE_SKEL.pose, stance: 0.5 }, TRIANGLE_SKEL.sway), 'triangle_pose'), null);
  // (a frame with nobody is never right)
  assert.equal(poseRight('triangle_pose', null), false);
});

// The library's references of the held poses (private): each held part right and still, its pose the middle frame,
// its side the working side all through it, and mirrored the other side.
const MOVES_DATA = path.join(ROOT, '.data', 'moves');
const readIf = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const refSlugs = readIf(path.join(MOVES_DATA, 'slugs.json')) ?? {};
const refCatalog = readIf(path.join(MOVES_DATA, 'catalog.json'));
/** A held pose's reference skeleton, from its dump or its npz (as the build); null if neither is here. */
function referenceOf(key) {
  const id = Object.keys(refSlugs).find(k => refSlugs[k] === key);
  if (!id) return null;
  const dump = readIf(path.join(MOVES_DATA, 'skel', `${id}.json`));
  if (dump) return dump;
  const npzFile = refCatalog && path.join(refCatalog.source, id, 'source', 'skeleton_motion.npz');
  return npzFile && fs.existsSync(npzFile) ? skeletonFromNpz(fs.readFileSync(npzFile)) : null;
}
for (const key of Object.keys(HOLD_FORMS)) {
  const skel = referenceOf(key);
  test(`build: ${key}'s reference: a held part right and still, its pose and working side`,
    { skip: !skel && 'no reference skeleton here' }, () => {
      const info = {};
      const h = heldOf(skel, key, info);
      const all = skeletonLandmarks(skel);
      assert.ok(h, 'a held part');
      const { start, end } = h.held;
      assert.ok(start >= 0 && end <= all.at(-1).t / 1000 + 1e-3 && end - start >= 1, `${start}-${end}`);
      assert.ok(info.score <= TUNING.STILL, `the stillest second scores ${info.score}`);
      const frames = all.filter(f => f.t >= start * 1000 - 1e-6 && f.t <= end * 1000 + 1e-6);
      const hf = new HoldForm({ key }), sides = new Set();
      for (const f of frames) {
        const m = poseMetrics(f.world, f.image, 16 / 9);
        assert.ok(poseRight(key, m), `${f.t}`);
        assert.deepEqual(hf.update(m, f.t), [], `${f.t}`);
        sides.add(WORKING_SIDE[key](m));
      }
      assert.deepEqual(hf.summary(), { checked: HOLD_FORMS[key].map(c => c.name), faults: [] });
      assert.equal(sides.size, 1, 'one working side all through the held part');
      assert.equal(h.pose.side, { L: 'left', R: 'right' }[[...sides][0]]);
      assert.equal(h.pose.image.length, 33);
      assert.ok(h.pose.image.flat().every(v => v > 0 && v < 1), 'in the picture');
      const m = heldOf(mirrorSkeleton(skel), key);
      assert.deepEqual(m.held, h.held);
      assert.equal(m.pose.side, h.pose.side === 'left' ? 'right' : 'left');
    });
}

test('build: keys and spoken names', () => {
  assert.equal(slugify('Overhead kettlebell squat'), 'overhead_kettlebell_squat');
  assert.equal(slugify('Push-up (slow, side view)'), 'push_up_slow_side_view');
  assert.deepEqual(synonymsOf({ display: 'Made-up stretch (left leg)', key: 'made_up_stretch' }, ["Stretch it's"]),
    ['made up stretch', 'stretch its']);
  assert.deepEqual(synonymsOf({ display: 'Twirl', key: 'twirl', track: 'moving' }, ['Spinning', 'twirl']), ['spinning', 'twirl']);
});

const CAT = {
  source: '/nowhere',
  motions: [
    { id: 'm-squat', display: 'Made-up goblet squat', kind: 'gym_counted', engine: 'squat', coach: 'Count squats.', durationSec: 5 },
    { id: 'm-bend', display: 'Made-up knee bends', kind: 'gym_reps', engine: null, coach: 'About how many.', durationSec: 8 },
    { id: 'm-hold', display: 'Made-up stretch (right leg)', kind: 'hold', engine: null, coach: 'Hold it.', durationSec: 6 },
    { id: 'm-dance', display: 'Made-up dance', kind: 'dance', engine: null, coach: 'Time moving.', durationSec: 6 },
    { id: 'm-wave', display: 'Made-up wave', kind: 'gesture', engine: null, coach: 'Nothing.', durationSec: 4 },
    { id: 'm-other', display: 'Not cleared', kind: 'dance', engine: null, coach: '', durationSec: 4 },
  ],
};
const SLUGS = { 'm-bend': 'made_up_bends', 'm-hold': 'made_up_stretch', 'm-dance': 'made_up_dance', 'm-wave': 'made_up_wave' };
const CLEARED = ['m-squat', 'm-bend', 'm-hold', 'm-dance', 'm-wave'];
const POLICY = { exclude: {}, confirm: {}, reviewed: [...CLEARED, 'm-other'] };
const BUILT = ['made_up_goblet_squat', 'made_up_bends', 'made_up_stretch', 'made_up_dance'];

test('build plan: one entry per cleared motion of the kinds offered, as the contract has it', () => {
  const info = {};
  const p = plan({ catalog: CAT, cleared: CLEARED, slugs: SLUGS, synonyms: { made_up_stretch: ['stretchy'] }, policy: POLICY }, info);
  assert.deepEqual(p.map(m => [m.key, m.track, m.engine ?? null, m.glb]), [
    ['made_up_goblet_squat', 'reps', 'squat', 'glb/made_up_goblet_squat.glb'],
    ['made_up_bends', 'rhythm', null, 'glb/made_up_bends.glb'],
    ['made_up_stretch', 'hold', null, 'glb/made_up_stretch.glb'],
    ['made_up_dance', 'moving', null, 'glb/made_up_dance.glb']]);
  assert.deepEqual(info.leftOut, { gesture: 1 });
  assert.deepEqual(p[2].synonyms, ['made up stretch', 'stretchy']);
  assert.deepEqual(Object.keys(p[2]), ['key', 'id', 'display', 'kind', 'track', 'coach', 'glb', 'durationSec', 'synonyms']);
});

test('build: a rhythm the catalog gives (a reference too short to show its own) is taken as it is, if valid', () => {
  const cat = r => ({ motions: [{ id: 'm-one-two', rhythm: r }, { id: 'm-other' }] });
  assert.deepEqual(catalogRhythm(cat({ signal: 'armMax', minPeriodS: 0.4, prominence: 16, extra: 1 }), 'm-one-two'),
    { signal: 'armMax', minPeriodS: 0.4, prominence: 16 });
  assert.equal(catalogRhythm(cat({ signal: 'armMax', minPeriodS: 0.4, prominence: 16 }), 'm-other'), null);
  const bad = [{ signal: 'nope', minPeriodS: 0.4, prominence: 16 }, { signal: 'armMax', minPeriodS: 0, prominence: 16 },
    { signal: 'armMax', minPeriodS: 0.4 }, null];
  for (const r of bad) assert.equal(catalogRhythm(cat(r), 'm-one-two'), null, JSON.stringify(r));
});

test('build plan: a cleared motion of a kind LEFT_OUT is skipped and counted; an unknown kind still refuses', () => {
  assert.deepEqual(LEFT_OUT, ['sport', 'locomotion', 'gesture', 'idle']);
  for (const k of LEFT_OUT) assert.equal(TRACK_OF_KIND[k], undefined, `${k} has no track`);
  const more = [
    { id: 'm-pitch', display: 'Made-up pitch', kind: 'sport', engine: null, coach: '', durationSec: 4 },
    { id: 'm-jog', display: 'Made-up jog', kind: 'locomotion', engine: null, coach: '', durationSec: 4 },
    { id: 'm-wait', display: 'Made-up wait', kind: 'idle', engine: null, coach: '', durationSec: 4 },
    { id: 'm-pose', display: 'Made-up pose', kind: 'idle', engine: null, coach: '', durationSec: 4 }];
  const catalog = { ...CAT, motions: [...CAT.motions, ...more] }, cleared = [...CLEARED, ...more.map(m => m.id)];
  const policy = { ...POLICY, reviewed: [...POLICY.reviewed, ...more.map(m => m.id)] };
  // (left out: no key needed in slugs.json, and the names synonyms.json keeps for one are not a problem)
  const info = {};
  const p = plan({ catalog, cleared, slugs: { ...SLUGS, 'm-wait': 'made_up_wait' }, policy,
    synonyms: { made_up_wave: ['waving'], made_up_wait: ['waiting around'] } }, info);
  assert.deepEqual(p.map(m => m.key), BUILT);
  assert.deepEqual(info.leftOut, { sport: 1, locomotion: 1, gesture: 1, idle: 2 });
  // a left-out motion is still under the clip policy
  assert.throws(() => plan({ catalog, cleared, slugs: SLUGS, policy: { ...policy, exclude: { 'm-jog': 'licence' } } }), /m-jog is excluded/);
  // a kind neither built nor left out stops the build
  const odd = { id: 'm-juggle', display: 'Made-up juggling', kind: 'juggling', engine: null, coach: '', durationSec: 4 };
  assert.throws(() => plan({ catalog: { ...catalog, motions: [...catalog.motions, odd] }, cleared: [...cleared, 'm-juggle'],
    slugs: { ...SLUGS, 'm-juggle': 'made_up_juggling' }, policy: { ...policy, reviewed: [...policy.reviewed, 'm-juggle'] } }),
  /m-juggle: unknown kind juggling/);
});

test('build plan: refuses what the policy or cleared.json does not clear, and keys that clash', () => {
  const refuse = (args, re) => assert.throws(() => plan({ catalog: CAT, cleared: CLEARED, slugs: SLUGS, policy: POLICY, ...args }), re);
  refuse({ slugs: { ...SLUGS, 'm-other': 'not_cleared' } }, /m-other, which cleared.json does not clear/);
  refuse({ cleared: [...CLEARED, 'm-missing'] }, /m-missing is not a Ready motion/);
  refuse({ policy: { ...POLICY, exclude: { 'm-hold': 'licence' } } }, /m-hold is excluded/);
  refuse({ policy: { ...POLICY, confirm: { 'm-wave': 'consent' } } }, /m-wave needs the owner's confirmation/);
  refuse({ policy: { ...POLICY, reviewed: ['m-squat'] } }, /m-bend has not been reviewed/);
  refuse({ slugs: { ...SLUGS, 'm-hold': 'made_up_bends' } }, /key made_up_bends is used by/);
  refuse({ slugs: { 'm-bend': 'made_up_bends', 'm-hold': 'made_up_stretch', 'm-wave': 'made_up_wave' } }, /m-dance \(dance\) has no key/);
  refuse({ synonyms: { nobody: ['x'] } }, /synonyms.json names nobody/);
  // a spoken name two movements share goes from both
  const p = plan({ catalog: CAT, cleared: CLEARED, slugs: SLUGS, policy: POLICY, synonyms: { made_up_stretch: ['shared name'], made_up_dance: ['shared name'] } });
  assert.ok(!p.some(m => m.synonyms.includes('shared name')));
});

test('build: writes library.json and the GLBs, is idempotent, removes what is no longer built', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moves-test-'));
  try {
    const moves = path.join(dir, 'moves'), lib = path.join(dir, 'lib');
    fs.mkdirSync(moves);
    for (const m of CAT.motions) {
      fs.mkdirSync(path.join(lib, m.id, 'variants', 'mixamo-y-bot'), { recursive: true });
      fs.mkdirSync(path.join(lib, m.id, 'source'), { recursive: true });
      fs.writeFileSync(path.join(lib, m.id, 'variants', 'mixamo-y-bot', 'animation.glb'), Buffer.concat([Buffer.from('glTF'), Buffer.from(m.id.padEnd(16))]));
    }
    fs.writeFileSync(path.join(lib, 'm-bend', 'source', 'skeleton_motion.npz'), skelNpz(bendingSkeleton(4)));
    const held = holdClip(TRIANGLE_SKEL.pose, TRIANGLE_SKEL.sway), names = Object.keys(held.joints);
    fs.writeFileSync(path.join(lib, 'm-hold', 'source', 'skeleton_motion.npz'), skelNpz({ fps: held.fps, names,
      frames: held.joints.pelvis.map((_, i) => names.map(k => held.joints[k][i])) }));
    const write = (name, v) => fs.writeFileSync(path.join(moves, name), JSON.stringify(v));
    write('catalog.json', CAT); write('cleared.json', CLEARED); write('slugs.json', SLUGS); write('policy.json', POLICY);
    // a GLB an earlier build copied for the wave, a kind now left out
    fs.mkdirSync(path.join(moves, 'glb'));
    fs.writeFileSync(path.join(moves, 'glb', 'made_up_wave.glb'), 'glTF old copy');
    const build = () => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build_moves.mjs'), '--moves', moves, '--library', lib,
      '--policy', path.join(moves, 'policy.json')], { encoding: 'utf8' });
    const first = build();
    assert.match(first,
      /4 movements .*; left out 1 \(gesture 1\); GLBs copied 4, unchanged 0, removed 1 stale; library.json written/);
    assert.match(first, /\n  held made_up_stretch: [\d.]+-[\d.]+ s of 6, working side none\n/);
    const out = JSON.parse(fs.readFileSync(path.join(moves, 'library.json'), 'utf8'));
    assert.match(out.built, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(out.movements.map(m => m.key), BUILT);
    assert.deepEqual(out.movements.map(m => m.track), ['reps', 'rhythm', 'hold', 'moving']);
    assert.ok(SIGNALS[out.movements[1].rhythm.signal] && out.movements[1].rhythm.prominence > 0 && out.movements[1].rhythm.minPeriodS > 0);
    assert.ok(!out.movements.some((m, i) => i !== 1 && m.rhythm));
    // the hold: its held part and pose from its reference skeleton (as heldOf, read back from the npz), nothing else's
    const hold = out.movements[2];
    const holdNpz = fs.readFileSync(path.join(lib, 'm-hold', 'source', 'skeleton_motion.npz'));
    assert.deepEqual({ held: hold.held, pose: hold.pose }, heldOf(skeletonFromNpz(holdNpz), 'made_up_stretch'));
    assert.ok(hold.held.end - hold.held.start >= 1 && hold.pose.image.length === 33 && hold.pose.side === null);
    assert.ok(!out.movements.some((m, i) => i !== 2 && (m.held || m.pose)));
    assert.deepEqual(fs.readdirSync(path.join(moves, 'glb')).sort(), ['made_up_bends.glb', 'made_up_dance.glb', 'made_up_goblet_squat.glb', 'made_up_stretch.glb']);
    assert.ok(!fs.readdirSync(path.join(moves, 'glb')).some(f => f.includes('other')));
    const before = fs.readFileSync(path.join(moves, 'library.json'), 'utf8');
    assert.match(build(), /GLBs copied 0, unchanged 4; library.json unchanged/);
    assert.equal(fs.readFileSync(path.join(moves, 'library.json'), 'utf8'), before);
    // a motion that cannot be read this time (an evicted file that stalls; here not a GLB): reported, exit 1, and the
    // previous build of it stays
    const holdSrc = path.join(lib, 'm-hold', 'variants', 'mixamo-y-bot', 'animation.glb'), good = fs.readFileSync(holdSrc);
    fs.writeFileSync(holdSrc, 'nope');
    assert.throws(() => build(), e => e.status === 1 && /skipped made_up_stretch .*previous build of it is kept/.test(String(e.stderr)));
    const kept = JSON.parse(fs.readFileSync(path.join(moves, 'library.json'), 'utf8'));
    assert.deepEqual(kept.movements.map(m => m.key), BUILT);
    assert.equal(kept.skipped[0].key, 'made_up_stretch');
    assert.ok(fs.existsSync(path.join(moves, 'glb', 'made_up_stretch.glb')));
    fs.writeFileSync(holdSrc, good);
    assert.match(build(), /4 movements .*library.json written/);
    // the dance is no longer cleared: its entry and its GLB go
    write('cleared.json', CLEARED.filter(id => id !== 'm-dance'));
    write('slugs.json', { 'm-bend': 'made_up_bends', 'm-hold': 'made_up_stretch', 'm-wave': 'made_up_wave' });
    assert.match(build(), /3 movements .*removed 1 stale/);
    assert.ok(!fs.existsSync(path.join(moves, 'glb', 'made_up_dance.glb')));
    // a cleared motion the policy excludes: nothing is written
    write('policy.json', { ...POLICY, exclude: { 'm-hold': 'licence' } });
    const lib1 = fs.readFileSync(path.join(moves, 'library.json'), 'utf8');
    assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build_moves.mjs'), '--moves', moves, '--library', lib,
      '--policy', path.join(moves, 'policy.json')], { stdio: 'pipe' }), e => e.status === 2 && /excluded by the clip policy/.test(String(e.stderr)));
    assert.equal(fs.readFileSync(path.join(moves, 'library.json'), 'utf8'), lib1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
