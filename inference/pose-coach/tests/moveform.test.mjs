// A moving or rhythm movement's form (web/js/moveform.js): the measures of one frame on made-up MediaPipe-like
// landmarks (a person built from its angles, mirrored, turned to the side, partly out of view); the timing of a frame
// check and of a cycle check on made-up checks and measures (a fault once it lasts, or on 2 of the last 3 cycles; its
// fix; one at a time; the warm-up; a pause; out of view; the wrong view); the floor; the shape of every check in
// MOVE_FORMS; and the example check (shoulder external rotation's elbows at the sides) on the library's reference
// skeleton, through the movement tracker as the page runs it (private: .data/, skipped when not on this machine).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { boneParts } from '../web/js/formcheck.js';
import { faultParts } from '../web/js/retarget.js';
import { FRONTAL, MOVE_FORMS, MOVE_FORM_GROUPS, MOVE_TUNING, MoveForm, NEEDS_LANDMARKS, SEEN_PARTS, UNSEEN_TUNING,
  bodyMetrics, checkProblems, outOfView, unseenCue } from '../web/js/moveform.js';
import { MovementTracker } from '../web/js/moves.js';
import { skeletonFromNpz, skeletonLandmarks } from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const FPS = 30, DT = 1000 / FPS, ASPECT = 16 / 9, S = 2.4;   // S: metres from the picture's top to its bottom
const K = MOVE_TUNING;

// --- made-up landmarks ---------------------------------------------------------------------------------------------
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const rad = d => (d * Math.PI) / 180;
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const crossP = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** v turned by `deg` about the unit axis k (Rodrigues). */
function rot(v, k, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = crossP(k, v);
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c));
}
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const FWD = [0, 0, -1];                                      // world: forward, towards a camera the person faces
/** A limb's direction from straight down, `out` deg out to the person's side `sx` (1 left, -1 right) and `fwd` deg
 * forward. */
const limb = (sx, out, fwd = 0) => [sx * Math.sin(rad(out)), Math.cos(rad(out)) * Math.cos(rad(fwd)),
  -Math.cos(rad(out)) * Math.sin(rad(fwd))];
/** An upper arm's direction d bent by `deg` at the elbow, the forearm towards forward. */
const bendElbow = (d, deg) => {
  let k = crossP(d, FWD);
  if (Math.hypot(...k) < 1e-6) k = crossP(d, [0, -1, 0]);
  return rot(d, norm(k), deg);
};
/** A thigh's direction bent by `deg` at the knee, the shin folding back (about the hips' line). */
const bendKnee = (d, deg) => rot(d, [1, 0, 0], deg);

/** The points of a made-up person facing the camera (hips and shoulders 0.3 m wide, the shoulders over the hips;
 * thighs and shins 0.45 m, trunk 0.5 m, upper arms 0.3 m, forearms 0.27 m), from angles in degrees, per side (L, R):
 * `arm` the upper arm out to the side from straight down, `armFwd` forward; `elbow` and `knee` bent by; `thigh` the
 * thigh forward, `legOut` out to the side; the trunk `lean` forward (negative: back), `side` to the person's left,
 * `twist` the shoulders turned about the vertical; `hike` the left hip raised; `feet` the ankles' extra spread (m);
 * `shoulderW` half the shoulders' width (m; default 0.15, the hips'). */
function body(o = {}) {
  const g = (k, s, d = 0) => o[`${k}${s}`] ?? o[k] ?? d;
  const P = {}, w = 0.15, h = rad(o.hike ?? 0);
  P[23] = [w * Math.cos(h), -w * Math.sin(h), 0]; P[24] = [-w * Math.cos(h), w * Math.sin(h), 0];
  for (const [s, sx, hip, kn, an, heel, toe] of [['L', 1, 23, 25, 27, 29, 31], ['R', -1, 24, 26, 28, 30, 32]]) {
    const th = limb(sx, g('legOut', s), g('thigh', s));
    P[kn] = add(P[hip], th, 0.45);
    P[an] = add(add(P[kn], bendKnee(th, g('knee', s)), 0.45), [sx * (o.feet ?? 0) / 2, 0, 0]);
    P[heel] = add(P[an], [0, 0.04, 0.05]); P[toe] = add(P[an], [0, 0.06, -0.15]);
  }
  const lean = rad(o.lean ?? 0), sd = rad(o.side ?? 0), tw = rad(o.twist ?? 0);
  const u = [Math.sin(sd), -Math.cos(sd) * Math.cos(lean), -Math.cos(sd) * Math.sin(lean)];   // hips to shoulders
  const e0 = [Math.cos(tw), 0, Math.sin(tw)], du = e0[0] * u[0] + e0[1] * u[1] + e0[2] * u[2];
  const e = norm(add(e0, u, -du));                                                            // right to left
  const sm = add([0, 0, 0], u, 0.5);
  P[11] = add(sm, e, o.shoulderW ?? w); P[12] = add(sm, e, -(o.shoulderW ?? w));
  for (const [s, sx, sh, el, wr, hs] of [['L', 1, 11, 13, 15, [17, 19, 21]], ['R', -1, 12, 14, 16, [18, 20, 22]]]) {
    const d = limb(sx, g('arm', s), g('armFwd', s));
    P[el] = add(P[sh], d, 0.3);
    P[wr] = add(P[el], bendElbow(d, g('elbow', s)), 0.27);
    for (const i of hs) P[i] = P[wr];
  }
  P[0] = add(add(sm, u, 0.25), FWD, 0.1); P[7] = add(P[0], e, 0.07); P[8] = add(P[0], e, -0.07);
  return P;
}
/** MediaPipe-like landmarks of points {index: [x, y, z]} (world metres around the hips' middle, y down; image from an
 * orthographic camera in front, the hips at 55% of the picture's height, or `shiftY` lower), turned `turn` deg about
 * the vertical; `vis` visibility by index, `jitter` metres of noise. */
function landmarks(P, { vis = {}, jitter = 0, turn = 0, shiftY = 0, scale = 1 } = {}) {
  const world = [], image = [], c = Math.cos(rad(turn)), s = Math.sin(rad(turn));
  const hips = [(P[23][0] + P[24][0]) / 2, (P[23][1] + P[24][1]) / 2, (P[23][2] + P[24][2]) / 2];
  for (let i = 0; i < 33; i++) {
    let p = add(P[i] ?? P[0], hips, -1);
    if (turn) p = [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    p = p.map(v => v + jitter * rnd());
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + (scale * p[0]) / (S * ASPECT), y: 0.55 + shiftY + (scale * p[1]) / S, z: 0,
      visibility: vis[i] ?? 1 });
  }
  return { world, image, aspect: ASPECT };
}
/** Mirrored: the person's left and right swapped (the same pose on the other side). */
function mirror(lm) {
  const sw = Array.from({ length: 33 }, (_, i) => i);
  for (const [a, b] of PAIRS) { sw[a] = b; sw[b] = a; }
  return { aspect: lm.aspect, world: sw.map(j => ({ ...lm.world[j], x: -lm.world[j].x })),
    image: sw.map(j => ({ ...lm.image[j], x: 1 - lm.image[j].x })) };
}
const metricsOf = lm => bodyMetrics(lm.world, lm.image, lm.aspect);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} (want ${b})`);

// --- one frame's measures ------------------------------------------------------------------------------------------
test('bodyMetrics: a made-up person standing measures as built: straight joints, level lines, front view', () => {
  const m = metricsOf(landmarks(body()));
  for (const k of ['kneeL', 'kneeR', 'elbowL', 'elbowR', 'hipL', 'hipR']) near(m[k], 180, 0.01, k);
  for (const k of ['armL', 'armR', 'armFromDownL', 'armFromDownR', 'thighFromDownL', 'thighFromDownR', 'pelvisTilt',
    'shoulderTilt', 'trunkTilt', 'trunkLeanFwd', 'trunkLeanSide', 'trunkTwist', 'ankleUpL', 'ankleUpR']) {
    near(m[k], 0, 0.01, k);
  }
  for (const k of ['armPlaneL', 'armPlaneR', 'thighPlaneL', 'thighPlaneR']) assert.ok(Number.isNaN(m[k]), k);
  near(m.wristUpL, -0.57 / 0.5, 1e-6, 'wristUpL');
  near(m.wristOverHeadR, (-0.75 - 0.07) / 0.5, 1e-6, 'wristOverHeadR');
  near(m.stance, 0.3 / 0.9, 1e-6, 'stance'); near(m.stanceWidth, 0.3 / 0.9, 1e-6, 'stanceWidth');
  near(m.kneeGap, 1, 1e-6, 'kneeGap');
  near(m.legLen, 0.9, 1e-6, 'legLen'); near(m.torsoLen, 0.5, 1e-6, 'torsoLen');
  assert.equal(m.view, 'front');
  assert.deepEqual(m.seen, { armL: true, armR: true, legL: true, legR: true, trunk: true, head: true, arms: true,
    legs: true });
  assert.equal(bodyMetrics(null, null), null);
  assert.equal(bodyMetrics([], []), null);
});

test('bodyMetrics: the joints, the limbs\' directions and the heights, as built, each on its own side', () => {
  const m = metricsOf(landmarks(body({ kneeL: 60, elbowR: 90, armL: 70, armFwdR: 90, armR: 0, thighL: 90,
    kneeR: 0 })));
  near(m.kneeL, 120, 0.01, 'kneeL'); near(m.elbowR, 90, 0.01, 'elbowR'); near(m.elbowL, 180, 0.01, 'elbowL');
  near(m.armL, 70, 0.01, 'armL'); near(m.armFromDownL, 70, 0.01, 'armFromDownL');
  near(m.armPlaneL, 0, 0.01, 'armPlaneL: out to the side');
  near(m.armR, 90, 0.01, 'armR'); near(m.armPlaneR, 90, 0.01, 'armPlaneR: forward');
  near(m.thighFromDownL, 90, 0.01, 'thighFromDownL'); near(m.thighPlaneL, 90, 0.01, 'thighPlaneL: forward');
  near(m.hipL, 90, 0.01, 'hipL'); near(m.hipR, 180, 0.01, 'hipR');
  // the knee raised, the shin hanging from it
  const raise = metricsOf(landmarks(body({ thighL: 90, kneeL: 90 })));
  near(raise.ankleUpL, 0.45 / 0.9, 1e-6, 'ankleUpL'); near(raise.ankleUpR, -0.5, 1e-6, 'ankleUpR');
  near(raise.kneeL, 90, 0.01, 'kneeL raised');
  // a leg out to the side; an arm straight up
  const side = metricsOf(landmarks(body({ legOutR: 40, armR: 180 })));
  near(side.thighPlaneR, 0, 0.01, 'thighPlaneR: out to the side'); near(side.thighFromDownR, 40, 0.01, 'thigh');
  near(side.wristUpR, 0.57 / 0.5, 1e-6, 'wristUpR overhead'); near(side.wristOverHeadR, (1.07 - 0.75) / 0.5, 1e-6,
    'wristOverHeadR');
  near(side.armFromDownR, 180, 0.01, 'armFromDownR');
});

test('bodyMetrics: the trunk\'s lean forward and to the side, the hips and shoulders tilted, the twist, signed', () => {
  const fwd = metricsOf(landmarks(body({ lean: 30 })));
  near(fwd.trunkLeanFwd, 30, 0.01, 'forward'); near(fwd.trunkTilt, 30, 0.01, 'tilt');
  near(fwd.trunkLeanSide, 0, 0.01, 'no side');
  near(metricsOf(landmarks(body({ lean: -15 }))).trunkLeanFwd, -15, 0.01, 'back');
  near(metricsOf(landmarks(body({ lean: 120 }))).trunkLeanFwd, 120, 0.01, 'folded, the head below the hips');
  const left = metricsOf(landmarks(body({ side: 20 })));
  near(left.trunkLeanSide, 20, 0.01, 'to the left'); near(left.trunkTilt, 20, 0.01, 'tilt');
  near(left.shoulderTilt, -20, 0.01, 'the left shoulder lower');
  near(metricsOf(landmarks(body({ hike: 10 }))).pelvisTilt, 10, 0.01, 'the left hip higher');
  near(metricsOf(landmarks(body({ twist: 30 }))).trunkTwist, 30, 0.01, 'twist');
});

test('bodyMetrics: the stance, side to side and in all; the knees caving in; feet together has no ratio', () => {
  const wide = metricsOf(landmarks(body({ feet: 0.3 })));
  near(wide.stanceWidth, 0.6 / wide.legLen, 1e-6, 'stanceWidth');
  // the knees in over the ankles: knees 0.2 m apart, ankles 0.6
  const P = body({ feet: 0.3 });
  P[25] = [0.1, 0.45, 0]; P[26] = [-0.1, 0.45, 0];
  near(metricsOf(landmarks(P)).kneeGap, 0.2 / 0.6, 1e-6, 'kneeGap');
  // feet together (ankles 0.1 m apart, 0.11 leg lengths): no ratio
  const T = body({ feet: -0.2 });
  assert.ok(Number.isNaN(metricsOf(landmarks(T)).kneeGap));
  // a split stance front to back: wide in all, not side to side
  const split = body();
  split[27] = add(split[27], [0, 0, -0.4]); split[28] = add(split[28], [0, 0, 0.4]);
  const sm = metricsOf(landmarks(split));
  assert.ok(sm.stance > 0.75 && sm.stanceWidth < 0.3, `${sm.stance} ${sm.stanceWidth}`);
});

test('bodyMetrics: mirrored, the sides swap and the signed measures change sign; the rest is the same', () => {
  const lm = landmarks(body({ kneeL: 50, armR: 80, thighR: 60, side: 15, hike: 8, lean: 20, twist: 25 }),
    { jitter: 0.003 });
  const a = metricsOf(lm), b = metricsOf(mirror(lm));
  for (const k of ['knee', 'elbow', 'hip', 'arm', 'armFromDown', 'thighFromDown', 'wristUp', 'wristOverHead',
    'ankleUp']) {
    near(b[`${k}L`], a[`${k}R`], 1e-6, `${k}L`); near(b[`${k}R`], a[`${k}L`], 1e-6, `${k}R`);
  }
  for (const k of ['pelvisTilt', 'shoulderTilt', 'trunkLeanSide']) near(b[k], -a[k], 1e-6, k);
  for (const k of ['trunkLeanFwd', 'trunkTilt', 'trunkTwist', 'stance', 'stanceWidth', 'kneeGap', 'frontness']) {
    near(b[k], a[k], 1e-6, k);
  }
  assert.equal(b.view, a.view);
});

test('bodyMetrics: turned to the camera\'s side the view changes, the 3D measures do not', () => {
  const P = body({ kneeL: 40, armR: 60, lean: 25, side: -10 });
  const front = metricsOf(landmarks(P));
  const views = [0, 30, 55, 90].map(turn => metricsOf(landmarks(P, { turn })).view);
  assert.deepEqual(views, ['front', 'front', 'angled', 'side']);
  const side = metricsOf(landmarks(P, { turn: 90 }));
  for (const k of ['kneeL', 'armR', 'trunkLeanFwd', 'trunkLeanSide', 'trunkTilt', 'stance']) {
    near(side[k], front[k], 1e-6, k);
  }
});

test('bodyMetrics: a part is seen with every landmark of it in the frame and visible (engine.js\'s rule)', () => {
  const m = metricsOf(landmarks(body(), { vis: { 15: 0.1 } }));
  assert.deepEqual([m.seen.armL, m.seen.armR, m.seen.arms], [false, true, false]);
  // (the feet below the picture's edge: unseen whatever their score)
  const low = metricsOf(landmarks(body(), { shiftY: 0.07 }));
  assert.deepEqual([low.seen.legL, low.seen.legs, low.seen.trunk], [false, false, true]);
  assert.equal(metricsOf(landmarks(body(), { vis: { 0: 0 } })).seen.head, false);
  assert.ok(SEEN_PARTS.every(p => p in m.seen));
});

// --- the timing, on made-up measures -------------------------------------------------------------------------------
const ALL = { armL: true, armR: true, arms: true, legL: true, legR: true, legs: true, trunk: true, head: true };
/** Made-up metrics: `x` (what the made-up checks measure), the view, the parts seen. */
const fake = ({ x = 0, y = 0, view = 'front', seen = {}, up = true, hint = null } = {}) =>
  ({ x, y, view, up, hint, seen: { ...ALL, ...seen } });
const check = (o = {}) => ({ id: 'a', name: 'measure a', label: 'a too high', part: 'arms', needs: ['arms'],
  at: 'frame', order: 1, value: m => m.x, bad: v => v > 10, ok: v => v <= 8, measured: v => `a at ${v}`,
  target: 'a under 8', cue: 'Bring a down.', ...o });
const formOf = (checks, o = {}) => new MoveForm({ key: 'made_up', forms: { made_up: checks }, ...o });
/** Frames from `at(t)` ({m, lm, moving, cycle}; m null: nobody) from `from` to `to` ms at 30 fps: the events, each
 * with `at`. */
function feed(mf, at, to, from = 0) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += DT) {
    const f = at(t);
    out.push(...mf.update(f.m === undefined ? fake() : f.m, f.lm ?? null, t, f.cycle ?? null, f.moving ?? true)
      .map(e => ({ ...e, at: t })));
  }
  return out;
}
const kinds = evs => evs.map(e => [e.type, e.fault]);

test('frame check: a fault once bad FAULT_MS after the warm-up, said with its measure; fixed after FIX_MS ok', () => {
  const mf = formOf([check()]);
  const evs = feed(mf, t => ({ m: fake({ x: t < 10000 ? 20 : 0 }) }), 15000);
  assert.deepEqual(kinds(evs), [['form_fault', 'a'], ['form_fix', 'a']]);
  const [fault, fix] = evs;
  near(fault.at, K.WARM_MS + K.FAULT_MS, 2 * DT, 'told');
  assert.deepEqual({ ...fault, at: 0, seen: null }, { type: 'form_fault', fault: 'a', label: 'a too high',
    measured: 'a at 20', target: 'a under 8', cue: 'Bring a down.', part: 'arms', side: null, at: 0, seen: null });
  // (what it rests on: its last FAULT_MS of bad frames, those of the warm-up's end on)
  near(fault.seen.to, fault.at, 1e-9, 'seen to'); near(fault.seen.from, fault.at - K.FAULT_MS, DT, 'seen from');
  // (the median turns half SMOOTH_MS after the change, then FIX_MS)
  near(fix.at, 10000 + K.SMOOTH_MS / 2 + K.FIX_MS, 3 * DT, 'fixed');
  assert.deepEqual(fix, { type: 'form_fix', fault: 'a', label: 'a too high', at: fix.at });
  assert.deepEqual(mf.summary(), { checked: ['measure a'], faults: [{ fault: 'a', label: 'a too high', fixed: true,
    told: true }] });
  // a second of it is a glitch: nothing
  const glitch = formOf([check()]);
  assert.deepEqual(feed(glitch, t => ({ m: fake({ x: t >= 5000 && t < 6000 ? 20 : 0 }) }), 12000), []);
  assert.deepEqual(glitch.state().checked, ['measure a']);
});

test('frame check: never judged in the warm-up, while still or paused; a pause starts the warm-up again', () => {
  // still 10 s with the fault there: nothing, and nothing listed; then moving: the warm-up first
  let mf = formOf([check()]);
  assert.deepEqual(feed(mf, () => ({ m: fake({ x: 20 }), moving: false }), 10000), []);
  assert.deepEqual(mf.state(), { checked: [], open: [], pending: [], unseen: [], wrongView: [] });
  const evs = feed(mf, () => ({ m: fake({ x: 20 }) }), 16000, 10000 + DT);
  near(evs[0].at, 10000 + K.WARM_MS + K.FAULT_MS, 2 * DT, 'after the warm-up');
  // moving fine, a pause (still PAUSE_MS), then the fault: the warm-up again before it is judged
  mf = formOf([check()]);
  const paused = feed(mf, t => (t < 6000 ? { m: fake() } : t < 12000 ? { m: fake({ x: 20 }), moving: false }
    : { m: fake({ x: 20 }) }), 20000);
  near(paused[0].at, 12000 + K.WARM_MS + K.FAULT_MS, 2 * DT, 'warm-up after the pause');
  // ...a stop shorter than PAUSE_MS is no pause: the fault as soon as it lasts
  mf = formOf([check()]);
  const stop = feed(mf, t => (t < 6000 ? { m: fake() } : t < 8000 ? { m: fake({ x: 20 }), moving: false }
    : { m: fake({ x: 20 }) }), 14000);
  // (the frames before the stop are older than SMOOTH_MS by then: the median is the new frames')
  near(stop[0].at, 8000 + K.FAULT_MS, 2 * DT, 'no warm-up after a short stop');
  // ...and nobody in view PAUSE_MS is a pause too
  mf = formOf([check()]);
  const gone = feed(mf, t => (t < 6000 ? { m: fake() } : t < 12000 ? { m: null } : { m: fake({ x: 20 }) }), 20000);
  near(gone[0].at, 12000 + K.WARM_MS + K.FAULT_MS, 2 * DT, 'warm-up after being away');
});

test('frame check: one correction at a time, NEXT_MS after the last one or AFTER_FIX_MS after its fix', () => {
  const two = () => formOf([check(), check({ id: 'b', name: 'measure b', label: 'b too high', order: 2,
    value: m => m.y })]);
  let mf = two(), mid = null;
  const evs = feed(mf, t => {
    if (Math.abs(t - 6000) < DT / 2) mid = mf.state();
    return { m: fake({ x: 20, y: 20 }) };
  }, 14000);
  assert.deepEqual(kinds(evs), [['form_fault', 'a'], ['form_fault', 'b']]);
  near(evs[1].at - evs[0].at, K.NEXT_MS, DT, 'the next one NEXT_MS later');
  // meanwhile: a told and open, b waiting its turn (never checked)
  assert.deepEqual(mid.open.map(f => f.fault), ['a']);
  assert.deepEqual([mid.pending, mid.checked], [['measure b'], []]);
  // a fixed first: b AFTER_FIX_MS after the fix
  mf = two();
  const fixed = feed(mf, t => ({ m: fake({ x: t < 6000 ? 20 : 0, y: 20 }) }), 14000);
  assert.deepEqual(kinds(fixed), [['form_fault', 'a'], ['form_fix', 'a'], ['form_fault', 'b']]);
  near(fixed[2].at - fixed[1].at, K.AFTER_FIX_MS, DT, 'after the praise');
  // settle(t): what is open counts as told then
  mf = two();
  const first = feed(mf, () => ({ m: fake({ x: 20, y: 20 }) }), 5000);
  mf.settle(7000);
  const next = feed(mf, () => ({ m: fake({ x: 20, y: 20 }) }), 16000, 5000 + DT);
  assert.deepEqual(kinds([...first, ...next]), [['form_fault', 'a'], ['form_fault', 'b']]);
  near(next[0].at, 7000 + K.NEXT_MS, DT, 'NEXT_MS from the settle');
  // `after`: b held back while a is a fault (the same fault in other words), never pending meanwhile
  mf = formOf([check(), check({ id: 'b', name: 'measure b', label: 'b too high', order: 2, value: m => m.y,
    after: ['a'] })]);
  const held = feed(mf, () => ({ m: fake({ x: 20, y: 20 }) }), 16000);
  assert.deepEqual(kinds(held), [['form_fault', 'a']]);
  assert.deepEqual(mf.state().pending, []);
  assert.deepEqual(mf.summary().faults.map(f => f.fault), ['a']);
});

test('frame check: out of view, the wrong view, its phase: not judged, and state() says why', () => {
  const mf = formOf([check(), check({ id: 'v', name: 'from the front', label: 'v', order: 2, views: ['front'],
    needs: ['trunk'] })]);
  feed(mf, () => ({ m: fake() }), 6000);
  assert.deepEqual(mf.state().checked, ['measure a', 'from the front']);
  const evs = feed(mf, () => ({ m: fake({ x: 20, view: 'side', seen: { armL: false, arms: false } }) }), 12000,
    6000 + DT);
  // (nothing judged; nor said: without landmarks no part can be named out of the picture, and not every check is
  // side-on: form_unseen, tests below)
  assert.deepEqual(evs, []);
  assert.deepEqual(mf.state(), { checked: [], open: [], pending: [], unseen: ['measure a'],
    wrongView: ['from the front'] });
  // (a measure MediaPipe could not give: as out of view)
  const nan = formOf([check()]);
  assert.deepEqual(feed(nan, () => ({ m: fake({ x: NaN }) }), 8000), []);
  assert.deepEqual(nan.state().unseen, ['measure a']);
  // judged only where its phase holds: bad there only (half the time), the fault after FAULT_MS of those frames
  const ph = formOf([check({ phase: m => m.up })]);
  const phased = feed(ph, t => ({ m: fake({ up: Math.floor(t / 1000) % 2 === 1, x: Math.floor(t / 1000) % 2 ? 20
    : 0 }) }), 12000);
  assert.deepEqual(kinds(phased), [['form_fault', 'a']]);
  assert.ok(phased[0].at >= K.WARM_MS + 2 * K.FAULT_MS - 1000 && phased[0].at < 7000, `${phased[0].at}`);
  // ...and a fault outside it alone is never one
  const outside = formOf([check({ phase: m => m.up })]);
  assert.deepEqual(feed(outside, t => ({ m: fake({ up: t % 2000 < 1000, x: t % 2000 < 1000 ? 0 : 20 }) }), 12000),
    []);
});

// cycle checks: peaks handed over every 2 s (each confirmed 400 ms after its extreme), the measure there `peaks[i]`
const PERIOD = 2000, LAG = 400;
/** A frame at t of a run of peaks at 2 s, 4 s, ... with `value(i)` around peak i (and `rest` between), confirmed LAG
 * ms later; `opts(t)`: more of the frame. */
function peaks(value, rest = 0, opts = () => ({})) {
  return t => {
    const i = Math.round(t / PERIOD), ext = i * PERIOD, o = opts(t);
    const x = Math.abs(t - ext) <= 200 && i > 0 ? value(i) : rest;
    const confirm = i > 0 && Math.abs(t - (ext + LAG)) < DT / 2;
    return { m: fake({ x, hint: o.hint ?? null, ...o.m }), moving: o.moving ?? true,
      cycle: confirm ? { kind: 'peak', t: ext, v: 1, from: ext - PERIOD, far: true, counted: true, wobble: !!o.wobble,
        count: i, signal: 'made_up' } : null };
  };
}
const peak = (o = {}) => check({ id: 'p', name: 'measure p', label: 'p too high', at: 'peak', ...o });

test('peak check: a fault on 2 of the last 3 cycles, told on a bad one; fixed on the last 2 ok', () => {
  // cycles 1 and 2 in the warm-up; then bad, ok, bad (2 of 3: at cycle 5), ok, ok (fixed at 7)
  const vals = { 3: 20, 4: 0, 5: 20, 6: 0, 7: 0 };
  const mf = formOf([peak()]);
  const evs = feed(mf, peaks(i => vals[i] ?? 0), 15000);
  assert.deepEqual(kinds(evs), [['form_fault', 'p'], ['form_fix', 'p']]);
  near(evs[0].at, 5 * PERIOD + LAG, DT, 'told on the cycle that made it 2 of 3');
  assert.equal(evs[0].measured, 'a at 20');
  near(evs[1].at, 7 * PERIOD + LAG, DT, 'fixed on the second ok one');
  // bad, line (between bad and ok), bad: 2 of 3; then line, ok: not fixed yet (the last 2 not both ok)
  const line = formOf([peak()]);
  const lv = { 3: 20, 4: 9, 5: 20, 6: 9, 7: 0 };
  assert.deepEqual(kinds(feed(line, peaks(i => lv[i] ?? 0), 15000)), [['form_fault', 'p']]);
  // one bad cycle in three: nothing; nor a single bad one
  const once = formOf([peak()]);
  assert.deepEqual(feed(once, peaks(i => (i % 3 === 0 ? 20 : 0)), 30000), []);
  // the value is the median around the extreme: one frame's glitch there makes no bad cycle
  const glitch = formOf([peak()]);
  const g = peaks(() => 0);
  assert.deepEqual(feed(glitch, t => {
    const f = g(t);
    return Math.abs(t % PERIOD) < DT / 2 ? { ...f, m: fake({ x: 50 }) } : f;
  }, 20000), []);
  assert.deepEqual(glitch.state().checked, ['measure p']);
});

test('peak check: not judged in the warm-up, in or before a pause, without frames near it, on a wobble', () => {
  const bad = () => 20;
  // the warm-up: cycles 1 (2 s) is in it, 2 and 3 are not: told at cycle 3
  let mf = formOf([peak()]);
  let evs = feed(mf, peaks(bad), 8000);
  near(evs[0].at, 3 * PERIOD + LAG, DT, 'cycles of the warm-up are not judged');
  // still from 8 s to 16 s, a pause from 13 s: its cycles are not judged (nor the one at 16 s, the new run's
  // warm-up), and the run after it warms up again: told at the second bad cycle after that, 22 s
  mf = formOf([peak()]);
  const stopped = t => t >= 8000 && t < 16000;
  evs = feed(mf, peaks(i => (i >= 7 ? 20 : 0), 0, t => ({ moving: !stopped(t) })), 30000);
  near(evs[0].at, 11 * PERIOD + LAG, DT, 'after the pause\'s warm-up');
  // a cycle whose extreme came before the pause, confirmed after it (in the new run): not judged
  mf = formOf([peak()]);
  feed(mf, t => ({ m: fake({ x: 20 }), moving: t < 8000 || t >= 16000,
    cycle: Math.abs(t - 6400) < DT / 2 ? { kind: 'peak', t: 6000 } : Math.abs(t - 17000) < DT / 2
      ? { kind: 'peak', t: 7900 } : null }), 18000);
  assert.deepEqual(mf.s.p.hist, [], 'the run after the pause starts afresh, and the old cycle is not its');
  // ...while a stop shorter than PAUSE_MS judges its cycles on (a turn dwells at its far end)
  mf = formOf([peak()]);
  evs = feed(mf, peaks(i => (i >= 5 ? 20 : 0), 0, t => ({ moving: !(t >= 8500 && t < 12000) })), 30000);
  near(evs[0].at, 6 * PERIOD + LAG, DT, 'a short stop is no pause');
  // the arms out of view around every extreme: nothing judged, and said unseen
  mf = formOf([peak()]);
  evs = feed(mf, peaks(bad, 0, t => ({ m: Math.abs(t - Math.round(t / PERIOD) * PERIOD) <= 300
    ? { seen: { arms: false } } : {} })), 20000);
  assert.deepEqual(evs, []);
  assert.deepEqual(mf.summary(), { checked: [], faults: [] });
  // a wobble (a far end too soon after the last count) is no cycle
  mf = formOf([peak()]);
  assert.deepEqual(feed(mf, peaks(bad, 0, () => ({ wobble: true })), 20000), []);
  // a trough check does not judge peaks; a frame check ignores cycles
  mf = formOf([peak({ at: 'trough' }), check({ id: 'f', order: 2, value: () => 0 })]);
  assert.deepEqual(feed(mf, peaks(bad), 20000), []);
  assert.deepEqual(mf.state().checked, ['measure a']);
  // ...and judged while still near the extreme (a turn dwells at its far end), not paused
  mf = formOf([peak()]);
  evs = feed(mf, peaks(bad, 0, t => ({ moving: Math.abs(t - Math.round(t / PERIOD) * PERIOD) > 500 })), 10000);
  near(evs[0].at, 3 * PERIOD + LAG, DT, 'a dwell at the extreme is judged');
});

test('peak check: `take` max is the largest over the half cycle, `at` the extreme\'s own; side from its frame', () => {
  // the measure high (30) mid-way through each half cycle, 5 at the extreme
  const script = t => {
    const f = peaks(() => 5)(t), phase = t % PERIOD;
    return phase > 800 && phase < 1100 ? { ...f, m: fake({ x: 30 }) } : f;
  };
  const at = formOf([peak()]), max = formOf([peak({ take: 'max' })]);
  assert.deepEqual(feed(at, script, 12000), []);
  const evs = feed(max, script, 12000);
  assert.deepEqual(kinds(evs), [['form_fault', 'p']]);
  assert.equal(evs[0].measured, 'a at 30');
  // `take` min: the smallest
  const min = formOf([peak({ take: 'min', bad: v => v < 1, ok: v => v >= 2 })]);
  assert.deepEqual(kinds(feed(min, t => ({ ...peaks(() => 5, 0)(t) }), 12000)), [['form_fault', 'p']]);
  // the side of the extreme's frame, as the user's own
  const sided = formOf([peak({ part: 'elbow', side: m => m.hint })]);
  const atExtreme = t => Math.abs(t - Math.round(t / PERIOD) * PERIOD) < 20;
  const told = feed(sided, peaks(() => 20, 0, t => ({ hint: atExtreme(t) ? 'R' : 'L' })), 9000);
  assert.deepEqual([told[0].part, told[0].side], ['elbow', 'right']);
  assert.deepEqual(sided.state().open.map(f => f.side), ['right']);
});

test('peak check: state() before its first cycle lists it nowhere; then checked, or pending, or unseen', () => {
  const mf = formOf([peak()]);
  feed(mf, peaks(() => 0), 4000);
  assert.deepEqual(mf.state(), { checked: [], open: [], pending: [], unseen: [], wrongView: [] });   // (warm-up)
  feed(mf, peaks(() => 0), 7000, 4000 + DT);
  assert.deepEqual(mf.state().checked, ['measure p']);
  // one bad cycle: pending (not a fault yet), never checked
  feed(mf, peaks(i => (i === 4 ? 20 : 0)), 8500, 7000 + DT);
  assert.deepEqual([mf.state().pending, mf.state().checked], [['measure p'], []]);
  // out of view now: unseen; from the side (a check judged from the front): wrong view
  feed(mf, () => ({ m: fake({ seen: { arms: false } }) }), 10000, 8500 + DT);
  assert.deepEqual(mf.state().unseen, ['measure p']);
  const fr = formOf([peak({ views: ['front'] })]);
  feed(fr, peaks(() => 0), 8000);
  feed(fr, () => ({ m: fake({ view: 'side' }) }), 10000, 8000 + DT);
  assert.deepEqual(fr.state().wrongView, ['measure p']);
  // reset(): the movement afresh (nothing seen yet: unseen, as HoldForm's)
  mf.reset();
  assert.deepEqual([mf.state(), mf.summary()], [{ checked: [], open: [], pending: [], unseen: ['measure p'],
    wrongView: [] }, { checked: [], faults: [] }]);
});

test('one correction at a time across frame and peak checks; a cycle fault waits for a bad cycle when due', () => {
  const mf = formOf([check(), peak({ order: 2 })]);
  const evs = feed(mf, t => ({ ...peaks(() => 20, 20)(t) }), 20000);
  assert.deepEqual(kinds(evs), [['form_fault', 'a'], ['form_fault', 'p']]);
  // the peak's fault came at its third cycle; told on the first bad cycle NEXT_MS after the frame check's
  assert.ok(evs[1].at - evs[0].at >= K.NEXT_MS, `${evs[1].at - evs[0].at}`);
  assert.equal(Math.round((evs[1].at - LAG) / PERIOD) * PERIOD + LAG, Math.round(evs[1].at));
});

test('a new cycle fault is told on the same cycle that fixes an older fault, once the correction gap has passed', () => {
  const mf = formOf([peak(), peak({ id: 'q', order: 2, value: m => -m.x })]);
  const evs = feed(mf, peaks(i => i < 7 ? 20 : -20), 18000);
  assert.deepEqual(kinds(evs), [['form_fault', 'p'], ['form_fix', 'p'], ['form_fault', 'q']]);
  near(evs[1].at, 8 * PERIOD + LAG, DT, 'second good cycle for p');
  assert.equal(evs[2].at, evs[1].at, 'q uses its fresh second bad cycle, not a stale verdict later');
  assert.ok(evs[2].at - evs[0].at >= K.NEXT_MS);
});

test('the floor: both feet off it in a hop; not known nearer or further from the camera', () => {
  const mf = formOf([check()]);
  const at = (t, o = {}) => mf.withFloor(metricsOf(landmarks(body(), { jitter: 0.002, ...o })), t);
  let t = 0;
  for (; t < 3000; t += DT) at(t);
  const stand = at(t);
  assert.ok(Math.abs(stand.feetLift) < 0.05 && stand.airborne === false, `${stand.feetLift}`);
  const hop = at((t += DT), { shiftY: -0.08 });
  assert.ok(hop.feetLift > 0.3 && hop.airborne === true, `${hop.feetLift}`);
  // one foot up (a knee raise) is no hop
  const knee = mf.withFloor(metricsOf(landmarks(body({ thighL: 90, kneeL: 90 }))), (t += DT));
  assert.equal(knee.airborne, false);
  // stepped well back from the camera (the body 40% smaller on screen): not known
  const back = at((t += DT), { scale: 0.6, shiftY: -0.05 });
  assert.equal(back.airborne, null);
  // the legs out of view: not known
  assert.equal(at((t += DT), { shiftY: 0.07 }).airborne, null);
});

test('the floor with the arms raised: the shoulders narrow on screen, the floor stays known, in the same units', () => {
  // wide shoulders (their width sets engine.js's body scale with the arms down), narrowed 27% with the arms overhead:
  // that scale 18% smaller, as on the step touch's reference; the trunk from the ears does not change
  const mf = formOf([check()]);
  const at = (t, o = {}, l = {}) => mf.withFloor(metricsOf(landmarks(body(o), { jitter: 0.002, ...l })), t);
  const down = { shoulderW: 0.22 }, up = { shoulderW: 0.16, arm: 170 };
  const a = metricsOf(landmarks(body(down))), b = metricsOf(landmarks(body(up)));
  near(b.bodyScaleImg / a.bodyScaleImg, 0.82, 0.01, 'the body scale with the arms up');
  near(b.steadyScaleImg / a.steadyScaleImg, 1, 1e-6, 'the steady size');
  let t = 0;
  for (; t < 3000; t += DT) at(t, down);
  const raised = at((t += DT), up);
  assert.ok(raised.airborne === false && Math.abs(raised.feetLift) < 0.05, `${raised.airborne} ${raised.feetLift}`);
  // a hop with the arms up: in body lengths of the arms down (the scale at its largest)
  const hop = at((t += DT), up, { shiftY: -0.08 });
  near(hop.feetLift, 0.08 / a.bodyScaleImg, 0.02, 'feetLift');
  assert.equal(hop.airborne, true);
});

test('still check: judged on frames not moving too, with no warm-up and through pauses, once moved at all', () => {
  // standing still from the start with the fault there: nothing (not moved since the movement was named)
  let mf = formOf([check({ still: true })]);
  assert.deepEqual(feed(mf, () => ({ m: fake({ x: 20 }), moving: false }), 8000), []);
  assert.deepEqual(mf.state().checked, []);
  // a moment of movement, then still on: judged at once (no warm-up), told FAULT_MS later, and on through a pause
  mf = formOf([check({ still: true })]);
  const evs = feed(mf, t => ({ m: fake({ x: t < 12000 ? 20 : 0 }), moving: t < 200 }), 16000);
  assert.deepEqual(kinds(evs), [['form_fault', 'a'], ['form_fix', 'a']]);
  near(evs[0].at, K.FAULT_MS, 2 * DT, 'no warm-up');
  near(evs[1].at, 12000 + K.SMOOTH_MS / 2 + K.FIX_MS, 3 * DT, 'fixed while still, in a pause');
  assert.deepEqual(mf.state().checked, ['measure a'], 'fresh through the pause');
  // ...and the same check without the flag: never (frames not moving are not judged)
  mf = formOf([check()]);
  assert.deepEqual(feed(mf, t => ({ m: fake({ x: 20 }), moving: t < 200 }), 16000), []);
  // a new run (moving again after the pause) does not start a still check afresh: its fault stays, told once
  mf = formOf([check({ still: true }), check({ id: 'b', name: 'measure b', order: 2, value: m => m.y })]);
  const runs = feed(mf, t => ({ m: fake({ x: 20 }), moving: t < 200 || t >= 9000 }), 14000);
  assert.deepEqual(kinds(runs), [['form_fault', 'a']]);
  // its parts out of view or the wrong view: not judged, as any check
  mf = formOf([check({ still: true, views: ['front'] })]);
  assert.deepEqual(feed(mf, t => ({ m: fake({ x: 20, view: 'side' }), moving: t < 200 }), 6000), []);
  assert.deepEqual(mf.state().wrongView, ['measure a']);
});

test('still check: its phase starting to hold is not judged for SETTLE_MS, its samples afresh: a reach\'s first frames '
  + 'do not break its fix', () => {
  // a reach every 2 s, its phase (the top) 1.2 s long; the first four short throughout (the fault), the next ones
  // short only for their first 200 ms (on the way up), then up
  const reach = t => {
    const p = t % 2000, i = Math.floor(t / 2000);
    return fake({ up: p < 1200, x: p >= 1200 ? 0 : i < 4 || p < 200 ? 20 : 0 });
  };
  const mf = formOf([check({ still: true, phase: m => m.up })]);
  const evs = feed(mf, t => ({ m: reach(t), moving: t < 1000 }), 20000);
  assert.deepEqual(kinds(evs), [['form_fault', 'a'], ['form_fix', 'a']]);
  // fixed on the second good reach: 0.9 s of each judged (1.2 s less SETTLE_MS), FIX_MS of them in a row
  near(evs[1].at, 10000 + K.SETTLE_MS + K.FIX_MS - (1200 - K.SETTLE_MS), 3 * DT, 'fixed');
  // (a reach shorter than SETTLE_MS is never judged)
  const brief = formOf([check({ still: true, phase: m => m.up })]);
  assert.deepEqual(feed(brief, t => ({ m: fake({ up: t % 2000 < 250, x: 20 }), moving: t < 1000 }), 20000), []);
});

test('frame check with its own smoothMs and faultMs: a gesture held about a second is told; with the defaults, not',
  () => {
  // a gesture every 4 s, in its phase 2 s: bad its first second, then ok (the hand brought in), then out of its phase
  const gesture = t => fake({ up: t % 4000 < 2000, x: t % 4000 < 1000 ? 20 : 0 });
  const quick = formOf([check({ still: true, phase: m => m.up, smoothMs: 400, faultMs: 700 })]);
  const evs = feed(quick, t => ({ m: gesture(t), moving: t < 200 }), 12000);
  assert.deepEqual(kinds(evs), [['form_fault', 'a']]);
  // told in the first: SETTLE_MS not judged, then faultMs bad (its median bad from its first sample)
  near(evs[0].at, K.SETTLE_MS + 700, 2 * DT, 'told');
  // (what it rests on: its last faultMs of bad frames)
  near(evs[0].seen.from, evs[0].at - 700, 2 * DT, 'seen from');
  // the defaults: each gesture's 0.7 s bad and half SMOOTH_MS after it short of FAULT_MS, its ok frames resetting it
  const slow = formOf([check({ still: true, phase: m => m.up })]);
  assert.deepEqual(feed(slow, t => ({ m: gesture(t), moving: t < 200 }), 12000), []);
  assert.deepEqual(slow.state().checked, []);
});

test('frame check with a phase: once its phase has not held for SMOOTH_MS, neither pending nor checked', () => {
  const mf = formOf([check({ phase: m => m.up })]);
  // the phase held 0.8 s at 5 s with the fault in it (too short to be one): pending then
  feed(mf, t => ({ m: fake({ up: t >= 5000, x: t >= 5000 ? 20 : 0 }) }), 5800);
  assert.deepEqual([mf.state().pending, mf.state().checked], [['measure a'], []]);
  feed(mf, () => ({ m: fake({ up: false }) }), 5800 + K.SMOOTH_MS + 100, 5800 + DT);
  assert.deepEqual(mf.state(), { checked: [], open: [], pending: [], unseen: [], wrongView: [] });
  // fine in its phase: checked, and likewise nothing once it has ended
  feed(mf, () => ({ m: fake({ up: true }) }), 9000, 5800 + K.SMOOTH_MS + 100 + DT);
  assert.deepEqual(mf.state().checked, ['measure a']);
  feed(mf, () => ({ m: fake({ up: false }) }), 9000 + K.SMOOTH_MS + 100, 9000 + DT);
  assert.deepEqual(mf.state().checked, []);
});

test('side(m, lm): a check\'s side is given the frame\'s landmarks too, as its value is', () => {
  const sided = o => check({ part: 'elbow', side: (m, lm) => lm?.side ?? null, ...o });
  const fr = formOf([sided()]);
  const evs = feed(fr, () => ({ m: fake({ x: 20 }), lm: { side: 'R' } }), 6000);
  assert.deepEqual(evs.map(e => e.side), ['right']);
  // a cycle check: the landmarks of its extreme's frame
  const atExtreme = t => Math.abs(t - Math.round(t / PERIOD) * PERIOD) < 20;
  const cy = formOf([peak({ part: 'elbow', side: (m, lm) => lm?.side ?? null })]);
  const p = peaks(() => 20);
  const told = feed(cy, t => ({ ...p(t), lm: { side: atExtreme(t) ? 'L' : 'R' } }), 9000);
  assert.deepEqual(told.map(e => e.side), ['left']);
});

// a rep: troughs of the signal every 2 s (at 2, 4, ...), a kick between them, 0.4-0.8 s after each trough: in the
// half cycle after it, not in the one leading to the next trough
const REP = 2000;
function kicks(height) {
  return t => {
    const k = Math.floor(t / REP), p = t - k * REP, i = Math.round(t / REP), kick = p >= 400 && p < 800;
    const confirm = i > 0 && Math.abs(t - (i * REP + LAG)) < DT / 2;
    return { m: fake({ x: kick ? height(k) : 0, up: kick }), cycle: confirm ? { kind: 'trough', t: i * REP, v: 0,
      from: i * REP - REP / 2, cycleFrom: (i - 1) * REP, far: true, counted: true, wobble: false, count: i } : null };
  };
}
const kick = (o = {}) => check({ id: 'k', name: 'kick height', label: 'kick too low', at: 'trough', take: 'max',
  over: 'cycle', phase: m => m.up, bad: v => v < 55, ok: v => v >= 62, ...o });

test('cycle check over the whole cycle: the most of its phase\'s frames since the turn of its kind before, judged '
  + 'with none near the turn', () => {
  // kicks well up: judged on every trough after the warm-up, fine
  let mf = formOf([kick()]);
  assert.deepEqual(feed(mf, kicks(() => 80), 20000), []);
  assert.deepEqual(mf.summary(), { checked: ['kick height'], faults: [] });
  near(mf.s.k.value, 80, 1e-9, 'the kick');
  // low kicks from the fourth: told on the second low one judged; good again: fixed on the second good one
  mf = formOf([kick()]);
  const evs = feed(mf, kicks(k => (k >= 3 && k < 7 ? 40 : 80)), 24000);
  assert.deepEqual(kinds(evs), [['form_fault', 'k'], ['form_fix', 'k']]);
  near(evs[0].at, 5 * REP + LAG, DT, 'the kicks of 6-8 s and 8-10 s, judged at 10 s');
  near(evs[1].at, 9 * REP + LAG, DT, 'fixed');
  // ...while over the half cycle (the default) no frame of its phase comes before a trough: never judged
  mf = formOf([kick({ over: undefined })]);
  assert.deepEqual(feed(mf, kicks(() => 40), 20000), []);
  assert.equal(mf.s.k.measuredEver, false);
  // a cycle reaching back before the run (the turn before it, before a pause): not judged
  mf = formOf([kick()]);
  feed(mf, t => ({ ...kicks(() => 40)(t), moving: t < 6000 || t >= 13000 }), 17000);
  assert.ok(mf.s.k.histT.every(x => x > 13000 + K.WARM_MS), `${mf.s.k.histT}`);
});

test('cycle verdicts expire: 2 bad of the last 3 only within VERDICT_PERIODS periods (VERDICT_MIN_MS at least)', () => {
  // bad peaks 13 s apart, the person moving all along: never two within 12 s, never a fault
  const every = (gap, periodMs, bad = () => true) => t => {
    const i = Math.round(t / gap), ext = i * gap, confirm = i > 0 && Math.abs(t - (ext + LAG)) < DT / 2;
    return { m: fake({ x: i > 0 && Math.abs(t - ext) <= 200 && bad(i) ? 20 : 0 }),
      cycle: confirm ? { kind: 'peak', t: ext, from: ext - gap / 2, periodMs } : null };
  };
  let mf = formOf([peak()]);
  assert.deepEqual(feed(mf, every(13000, 3000), 70000), []);
  // pending after a bad one, until it expires
  mf = formOf([peak()]);
  feed(mf, every(13000, 3000), 20000);
  assert.deepEqual(mf.state().pending, ['measure p']);
  feed(mf, every(13000, 3000), 13000 + LAG + K.VERDICT_MIN_MS + 200, 20000 + DT);
  assert.deepEqual(mf.state(), { checked: [], open: [], pending: [], unseen: [], wrongView: [] });
  // 10 s apart: two count, told
  mf = formOf([peak()]);
  assert.deepEqual(kinds(feed(mf, every(10000, 3000), 30000)), [['form_fault', 'p']]);
  // a longer period keeps them longer (3 periods of 5 s: 15 s)
  mf = formOf([peak()]);
  assert.deepEqual(kinds(feed(mf, every(13000, 5000), 40000)), [['form_fault', 'p']]);
  // an untold fault drops when its verdicts no longer say so; a fault told stays open until fixed
  mf = formOf([peak()]);
  feed(mf, every(10000, 3000), 21000);
  assert.deepEqual(mf.state().open.map(f => f.fault), ['p']);
  feed(mf, every(13000, 3000), 80000, 21000 + DT);
  assert.deepEqual(mf.state().open.map(f => f.fault), ['p'], 'told: open until two ok cycles');
});

test('form_fault seen: the span of frames its verdict rests on, though told on a later frame', () => {
  // a frame check: its last FAULT_MS of bad frames (bad from 5 s: its median from 5.5 s), not the ok ones before
  let mf = formOf([check()]);
  let evs = feed(mf, t => ({ m: fake({ x: t >= 5000 ? 20 : 0 }) }), 9000);
  near(evs[0].seen.to, evs[0].at, 1e-9, 'to: the frame it was told on');
  near(evs[0].seen.from, evs[0].at - K.FAULT_MS, DT, 'from');
  assert.ok(evs[0].seen.from >= 5000, `${evs[0].seen.from}`);
  // ...a phase's bad frames apart: the span holds its last FAULT_MS of them, gaps and all
  mf = formOf([check({ phase: m => m.up })]);
  evs = feed(mf, t => ({ m: fake({ up: t % 1000 < 500, x: 20 }) }), 12000);
  assert.ok(evs[0].seen.to - evs[0].seen.from >= 2 * K.FAULT_MS - 600, `${JSON.stringify(evs[0].seen)}`);
  // a peak check whose turn is confirmed 3 s after its extreme: the span around the extreme, none of it in the 2 s
  // before the event (what the page replayed)
  const late = t => {
    const i = Math.round(t / 4000), ext = i * 4000, j = Math.round((t - 3000) / 4000);
    const confirm = j > 0 && Math.abs(t - (j * 4000 + 3000)) < DT / 2;
    return { m: fake({ x: i > 0 && Math.abs(t - ext) <= 200 ? 20 : 0 }),
      cycle: confirm ? { kind: 'peak', t: j * 4000, from: j * 4000 - 2000 } : null };
  };
  mf = formOf([peak()]);
  evs = feed(mf, late, 20000);
  const [f] = evs, ext = Math.round((f.at - 3000) / 4000) * 4000;
  assert.ok(f.seen.from <= ext && ext <= f.seen.to, `${JSON.stringify(f.seen)} around ${ext}`);
  near(f.seen.to - f.seen.from, K.SEEN_MS, DT, 'SEEN_MS long');
  assert.ok(f.seen.to < f.at - 2000, 'all of it before the 2 s before the event');
  assert.deepEqual(mf.state().open[0].seen, f.seen);
  // over the whole cycle: around the frame of the largest value, the kick between the turns
  mf = formOf([kick()]);
  evs = feed(mf, kicks(k => (k >= 3 ? 40 : 80)), 14000);
  const kickAt = Math.floor((evs[0].at - LAG) / REP - 1) * REP;          // (the cycle judged: its kick 0.4-0.8 s in)
  assert.ok(evs[0].seen.from <= kickAt + 800 && evs[0].seen.to >= kickAt + 400, `${JSON.stringify(evs[0].seen)}`);
});

test('a rhythm\'s slow reps: a hold at the far end shorter than the period its turns show is no pause; a rest is',
  () => {
  // a rep every 10 s, its turns 5 s apart, the person still for 6 s around each top (the peaks: a hold longer than
  // PAUSE_MS): once two turns have shown the period, no new run, and each peak after the warm-up judged, the fault told
  const slow = (rest = () => false) => t => {
    const i = Math.round(t / 5000), ext = i * 5000, top = i % 2 === 1;
    const confirm = i > 0 && Math.abs(t - (ext + LAG)) < DT / 2;
    return { m: fake({ x: top && Math.abs(t - ext) <= 200 ? 20 : 0 }),
      moving: !rest(t) && !(top && Math.abs(t - ext) <= 3000),
      cycle: confirm && !rest(t) ? { kind: top ? 'peak' : 'trough', t: ext, from: ext - 5000 } : null };
  };
  let mf = formOf([peak()]);
  const runs = [], evs = [];
  for (let t = 0; t <= 40000; t += DT) {
    const f = slow()(t);
    evs.push(...mf.update(f.m, null, t, f.cycle, f.moving).map(e => ({ ...e, at: t })));
    if (runs.at(-1) !== mf.runStart) runs.push(mf.runStart);
  }
  // (a run at the start, and one after the first top's hold: the period not known yet, a pause of PAUSE_MS)
  assert.ok(runs.at(-1) < 10000, `runs at ${runs}`);
  assert.equal(mf.pauseMs(), 10000, 'the period the turns show');
  assert.deepEqual(kinds(evs), [['form_fault', 'p']]);
  near(evs[0].at, 25000 + LAG, DT, 'the tops of 15 and 25 s');
  // a rest of 20 s after it: a pause (longer than the period, under PAUSE_MAX_MS), a new run when moving again
  mf = formOf([peak()]);
  const resting = t => t >= 21000 && t < 41000;
  let pausedSeen = false;
  for (let t = 0; t <= 60000; t += DT) {
    const f = slow(resting)(t);
    mf.update(f.m, null, t, f.cycle, f.moving);
    if (resting(t) && mf.paused(t)) pausedSeen = true;
  }
  assert.ok(pausedSeen, 'the rest is a pause');
  assert.ok(mf.runStart >= 41000, `a new run after it: ${mf.runStart}`);
  // and the stretch is capped: a period of 40 s gives a pause of PAUSE_MAX_MS
  mf = formOf([peak()]);
  for (const t of [0, 20000, 40000]) mf.update(fake(), null, t, { kind: 'peak', t }, true);
  assert.equal(mf.pauseMs(), K.PAUSE_MAX_MS);
});

test('the floor at each distance: drifting nearer and further, the feet stay on it; a hop at the far end is caught',
  () => {
  // the body 8% bigger and smaller on screen every 4 s (0.2 m nearer and further at 2.6 m), the head held at one
  // height in the picture (a camera about head high: the feet lower in it the nearer the person comes)
  const mf = formOf([check()]);
  const sizeAt = t => 1 + 0.08 * Math.sin((2 * Math.PI * t) / 4000);
  const at = (t, hop = 0) => {
    const s = sizeAt(t);
    return mf.withFloor(metricsOf(landmarks(body(), { scale: s, shiftY: ((s - 1) * 0.75) / S - hop,
      jitter: 0.002 })), t);
  };
  const known = [];
  for (let t = 0; t <= 12000; t += DT) { const f = at(t); if (t > 1000 && f.airborne !== null) known.push(f); }
  assert.ok(known.length > 300, `${known.length} frames known`);
  assert.ok(known.every(f => f.airborne === false), `lifted to ${Math.max(...known.map(f => f.feetLift))}`);
  assert.ok(Math.max(...known.map(f => Math.abs(f.feetLift))) < 0.08, 'on the floor');
  // a 6 cm hop on screen (0.27 body lengths) at the far end of the drift (15 s): caught
  let t = 12000 + DT;
  for (; t < 15000 - DT / 2; t += DT) at(t);
  const far = at(t, 0.06);
  near(sizeAt(t), 0.92, 0.001, 'the far end');
  assert.equal(far.airborne, true, `${far.feetLift}`);
});

test('the pause between sets: turns far apart show no period longer than PAUSE_BOUND_PERIODS of the rhythm\'s', () => {
  // sets of a jack (two turns 0.6 s apart) every 9.5 s, standing still 6 s between; a rhythm of periodMs 1240 (the
  // step touch's): its turns' gaps (0.6, 8.9, 0.6, 8.9 s) would show a period of 17.8 s, a pause of PAUSE_MAX_MS
  const mf = formOf([peak()]);
  const turnAt = t => [0, 600].some(o => Math.abs((t % 9500) - (1000 + o)) < DT / 2);
  let pausedBetween = false;
  for (let t = 0; t <= 40000; t += DT) {
    const p = t % 9500, moving = p >= 500 && p < 2500;
    mf.update(fake(), null, t, turnAt(t) ? { kind: p < 1300 ? 'peak' : 'trough', t: t - LAG, periodMs: 1240 } : null,
      moving);
    if (t > 30000 && p > 2500 + K.PAUSE_MS + 1000 && mf.paused(t)) pausedBetween = true;
  }
  assert.equal(mf.pauseMs(), K.PAUSE_MS, 'bounded to 4 periods of 1.24 s: under PAUSE_MS');
  assert.ok(pausedBetween, 'standing 6 s between sets is a pause');
  // (with no periodMs given, the turns' own period stands: as made-up cycles before)
  const free = formOf([peak()]);
  for (const t of [0, 600, 9500, 10100, 19000]) free.update(fake(), null, t, { kind: 'peak', t }, true);
  assert.equal(free.pauseMs(), K.PAUSE_MAX_MS);
});

// --- form_unseen ----------------------------------------------------------------------------------------------------
const U = UNSEEN_TUNING;
const legsCheck = (o = {}) => check({ id: 'knee', name: 'standing leg long', needs: ['legs'], value: () => 0, ...o });
/** A frame of the made-up person, the feet below the picture (`out`) or in it, turned `turn` deg: {m, lm}. */
const framed = (out, o = {}) => {
  const lm = landmarks(body(), { shiftY: out ? 0.07 : 0, ...o });
  return { m: metricsOf(lm), lm };
};

test('cropped knees: recent visible standing permits a framing prompt, never a verdict; seated or expired does not', () => {
  const mf = formOf([legsCheck()]);
  const cropped = framed(true, { shiftY: 0.5 });
  assert.ok(cropped.lm.image[23].y >= 0.985 && cropped.lm.image[25].y >= 0.985);
  const evs = feed(mf, t => t < 2000 ? { ...framed(false), moving: false }
    : t < 2200 ? { m: null, lm: null, moving: false } : { ...cropped, moving: false }, 11000);
  assert.deepEqual(evs.map(e => e.type), ['form_unseen']);
  assert.ok(evs[0].parts.includes('legs'));
  assert.deepEqual(mf.summary().faults, []);
  const fresh = formOf([legsCheck()]);
  assert.deepEqual(feed(fresh, () => ({ ...cropped, moving: false }), 20000), [], 'starting cropped proves nothing');
  const expired = formOf([legsCheck()]);
  assert.deepEqual(feed(expired, t => t < 1000 ? { ...framed(false), moving: false }
    : t < 15000 ? { m: null, lm: null, moving: false } : { ...cropped, moving: false }, 24000), [], 'memory expires');
  const seatedLm = landmarks(body({ thigh: 90, knee: 90 }), { shiftY: 0.25 });
  const seated = formOf([legsCheck()]);
  assert.deepEqual(feed(seated, t => t < 1000 ? { ...framed(false), moving: false }
    : t < 2000 ? { m: metricsOf(seatedLm), lm: seatedLm, moving: false } : { ...cropped, moving: false }, 9000),
  [], 'seeing seated hips clears standing evidence');
});

test('outOfView: the body parts to show, as the user is asked: feet, legs, hands, arms, hips, shoulders, head', () => {
  const at = (vis, ids, o = {}) => outOfView(landmarks(body(), { vis, ...o }).image, ids);
  const legs = NEEDS_LANDMARKS.legs, arms = NEEDS_LANDMARKS.arms;
  assert.deepEqual(at({}, [...legs, ...arms, 0]), []);
  assert.deepEqual(at({}, legs, { shiftY: 0.07 }), ['feet'], 'the ankles below the picture');
  assert.deepEqual(at({ 25: 0, 27: 0 }, legs), ['legs'], 'a knee too: the legs (the feet with them)');
  assert.deepEqual(at({ 16: 0.1 }, arms), ['hands']);
  assert.deepEqual(at({ 13: 0, 16: 0 }, arms), ['arms']);
  assert.deepEqual(at({ 0: 0, 27: 0 }, [0, ...legs]), ['head', 'feet']);
  assert.deepEqual(at({ 27: 0 }, arms), [], 'only the landmarks asked about');
  assert.equal(unseenCue('frame', ['arms', 'feet']),
    'Step back so I can see your arms and feet: I can\'t check your form.');
  assert.equal(unseenCue('view', []), 'Turn to face the camera so I can check your form.');
});

test('form_unseen: standing in the picture, a part the checks need out of it: FRAME_WAIT_MS, moving or not', () => {
  // the feet below the picture, the person standing still (moving cannot be judged there): FRAME_WAIT_MS after the
  // movement was named, then once every EVERY_MS
  const out = framed(true);
  for (const moving of [true, false]) {
    const mf = formOf([legsCheck()]);
    const evs = feed(mf, () => ({ ...out, moving }), 40000);
    assert.deepEqual(evs.map(e => e.type), ['form_unseen', 'form_unseen'], `moving ${moving}`);
    near(evs[0].at, U.FRAME_WAIT_MS, 2 * DT, 'FRAME_WAIT_MS after the movement was named');
    near(evs[1].at - evs[0].at, U.EVERY_MS, 2 * DT, 'again EVERY_MS later');
    assert.deepEqual({ ...evs[0], at: 0 }, { type: 'form_unseen', missing: ['standing leg long'], parts: ['feet'],
      why: 'frame', cue: 'Step back so I can see your feet: I can\'t check your form.', at: 0 });
  }
  // side-on, every check judged facing the camera only: turn to it, after WAIT_MS of movement past the warm-up, or
  // three turns of the rhythm (at 3, 4 and 5 s)
  const side = formOf([legsCheck({ views: ['front'] })]), sideOn = framed(false, { turn: 90 });
  const turned = feed(side, () => ({ ...sideOn }), 12000);
  assert.deepEqual(turned.map(e => [e.why, e.parts, e.cue]), [['view', [], 'Turn to face the camera so I can check '
    + 'your form.']]);
  near(turned[0].at, K.WARM_MS + U.WAIT_MS, 2 * DT, 'side-on: WAIT_MS of movement after the warm-up');
  const cy = formOf([legsCheck({ at: 'peak', views: ['front'] })]);
  const onTurn = t => t > 100 && Math.abs(t - Math.round(t / 1000) * 1000) < DT / 2;
  const turns = feed(cy, t => ({ ...sideOn, cycle: onTurn(t) ? { kind: 'peak', t: t - 300 } : null }), 9000);
  near(turns[0].at, K.WARM_MS + 2000, 2 * DT, 'the third turn after the warm-up');
  // ...side-on standing still: not doing the movement, nothing
  const still = formOf([legsCheck({ views: ['front'] })]);
  assert.deepEqual(feed(still, t => ({ ...sideOn, moving: t < 100 }), 30000), []);
});

test('form_unseen: never sitting, nor close with the hips out of the picture, nor with nobody; only the checks the '
  + 'frame blocks; again sooner once seen', () => {
  // sitting, the feet out of the picture (the hips bent to 90 deg): at the laptop, not setting up
  const sitLm = landmarks(body({ thigh: 90, knee: 90 }), { shiftY: 0.25 });
  const sitting = { m: metricsOf(sitLm), lm: sitLm };
  assert.ok(sitting.lm.image[25].y < 0.985 && sitting.lm.image[27].y > 0.985, 'the knees in, the feet out');
  let mf = formOf([legsCheck()]);
  assert.deepEqual(feed(mf, () => ({ ...sitting }), 30000), []);
  // close to the camera, the hips out of the picture; nobody
  mf = formOf([legsCheck()]);
  assert.deepEqual(feed(mf, () => ({ ...framed(true, { shiftY: 0.5 }) }), 30000), []);
  mf = formOf([legsCheck()]);
  assert.deepEqual(feed(mf, t => ({ m: t < 1000 ? framed(true).m : null, lm: t < 1000 ? framed(true).lm : null,
    moving: false }), 30000), []);
  // the arms' check judged, the knee's blocked by the frame: said for the knee's alone
  mf = formOf([legsCheck(), check({ id: 'arm', name: 'arms', order: 2, needs: ['arms'], value: () => 0 })]);
  const part = feed(mf, () => ({ ...framed(true) }), 12000);
  assert.deepEqual(part.map(e => [e.missing, e.parts]), [[['standing leg long'], ['feet']]]);
  // a check judged lately is not blocked: the feet seen for 0.3 s at 3 s (the knee judged), said once it has not been
  // judged FRAME_WAIT_MS
  mf = formOf([legsCheck()]);
  const brief = feed(mf, t => ({ ...framed(!(t >= 3000 && t < 3300)) }), 15000);
  near(brief[0].at, 3300 + U.FRAME_WAIT_MS, 2 * DT, 'FRAME_WAIT_MS after the knee was judged');
  // seen for 2 s after the first, then out of the picture again: the next FRAME_WAIT_MS later, not EVERY_MS
  mf = formOf([legsCheck()]);
  const evs = feed(mf, t => ({ ...framed(!(t >= 12000 && t < 14000)) }), 30000);
  assert.deepEqual(evs.map(e => e.type), ['form_unseen', 'form_unseen']);
  near(evs[1].at, 14000 + U.FRAME_WAIT_MS, 2 * DT, 'a new spell');
  // ...a glitch of a frame seen is not "seen": the next still EVERY_MS after the first
  mf = formOf([legsCheck()]);
  const glitch = feed(mf, t => ({ ...framed(Math.abs(t - 12000) > DT / 2) }), 50000);
  near(glitch[1].at - glitch[0].at, U.EVERY_MS, 2 * DT, 'one glitch frame');
});

// --- MOVE_FORMS -----------------------------------------------------------------------------------------------------
// the movements the guard rails are for (keys only; their library entries are private), and their tracks
const RHYTHM_KEYS = ['boxing_cardio_combo', 'shoulder_external_rotation', 'side_kick_knee_raise', 'y_to_w_raise',
  'standing_side_crunch', 'step_touch_arm_swings', 'wall_side_leg_raise'];
const MOVING_KEYS = ['kneel_and_stand', 'half_kneel_to_stand', 'bharatanatyam_arms', 'freestyle_dance',
  'hip_hop_dance', 'forward_fold_roll_up'];
const PARTS = boneParts().filter(p => faultParts().includes(p));

test('MOVE_FORMS: every check has the shape, a part the page can show; no movement in two groups', () => {
  assert.deepEqual(checkProblems(MOVE_FORMS, PARTS), []);
  const keys = Object.values(MOVE_FORM_GROUPS).flatMap(g => Object.keys(g));
  assert.equal(new Set(keys).size, keys.length, 'a movement in two groups');
  for (const key of Object.keys(MOVE_FORMS)) {
    assert.ok([...RHYTHM_KEYS, ...MOVING_KEYS].includes(key), `${key}: not a moving or rhythm movement`);
    // (a moving movement has no cycles: frame checks only)
    if (MOVING_KEYS.includes(key)) assert.ok(MOVE_FORMS[key].every(c => c.at === 'frame'), key);
    new MoveForm({ key });                                     // (constructs)
  }
  assert.ok(MOVE_FORMS.shoulder_external_rotation, 'the example');
  assert.throws(() => new MoveForm({ key: 'triangle_pose' }), /no form check/);
  assert.deepEqual(FRONTAL, ['front', 'angled']);
});

test('checkProblems: catches a check of the wrong shape', () => {
  const bad = { x: [{ id: 'a', name: 'n', label: 'l', part: 'wing', needs: ['tail'], at: 'top', order: 'first',
    value: 1, bad: () => true, ok: () => true, measured: () => '', target: 't', cue: 'c', take: 'max',
    views: ['above'], after: ['zz'] }, { id: 'a' }], y: [] };
  const got = checkProblems(bad, PARTS).join('\n');
  for (const want of ['x/a: part wing cannot be shown', 'x/a: needs', 'x/a: at must be', 'x/a: order', 'x/a: value()',
    'x/a: take', 'x/a: views', 'x/a: after', 'x/a: id missing or repeated', 'x/a: cue missing', 'y: not a list']) {
    assert.ok(got.includes(want), want);
  }
  assert.deepEqual(checkProblems({ ok: [check()] }, PARTS), []);
  // still: a frame check's, true or false; over: half or cycle, with take max or min
  const more = { z: [check({ still: true, at: 'peak' }), check({ id: 'b', still: 'yes' }),
    check({ id: 'c', at: 'trough', take: 'at', over: 'cycle' }),
    check({ id: 'd', at: 'peak', take: 'max', over: 'rep' })] };
  const why = checkProblems(more, PARTS).join('\n');
  for (const want of ['z/a: still', 'z/b: still', 'z/c: over', 'z/d: over']) assert.ok(why.includes(want), want);
  assert.deepEqual(checkProblems({ ok: [check({ still: true }), check({ id: 'b', at: 'trough', take: 'min',
    over: 'cycle' }), check({ id: 'c', at: 'peak', take: 'max', over: 'half' }),
  check({ id: 'e', smoothMs: 400, faultMs: 700 })] }, PARTS), []);
  // smoothMs, faultMs: a frame check's own, times over 0
  const times = checkProblems({ t: [check({ faultMs: 0 }), check({ id: 'b', smoothMs: '400' }),
    check({ id: 'c', at: 'peak', faultMs: 700 })] }, PARTS).join('\n');
  for (const want of ['t/a: faultMs', 't/b: smoothMs', 't/c: faultMs']) assert.ok(times.includes(want), want);
});

// --- the library's references (private) ---------------------------------------------------------------------------
const libFile = path.join(DATA, 'moves', 'library.json');
const library = fs.existsSync(libFile) ? JSON.parse(fs.readFileSync(libFile, 'utf8')).movements : [];
const catalogFile = path.join(DATA, 'moves', 'catalog.json');
const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : null;
/** The reference skeleton of a library movement ({fps, joints}), from its dump or its npz; null if neither is here. */
function skeletonOf(key) {
  const m = library.find(x => x.key === key);
  if (!m) return null;
  const dump = path.join(DATA, 'moves', 'skel', `${m.id}.json`);
  if (fs.existsSync(dump)) return JSON.parse(fs.readFileSync(dump, 'utf8'));
  const npz = catalog && path.join(catalog.source, m.id, 'source', 'skeleton_motion.npz');
  return npz && fs.existsSync(npz) ? skeletonFromNpz(fs.readFileSync(npz)) : null;
}

test('the library: each movement with guard rails is there, on the track its checks are for', { skip: !library.length
  && 'no library here' }, () => {
  for (const key of Object.keys(MOVE_FORMS)) {
    const m = library.find(x => x.key === key);
    assert.ok(m, key);
    assert.equal(m.track, RHYTHM_KEYS.includes(key) ? 'rhythm' : 'moving', key);
    if (MOVE_FORMS[key].some(c => c.at !== 'frame')) assert.ok(m.rhythm?.signal, `${key}: a rhythm to judge on`);
  }
});

/** The skeleton with each upper arm (and the forearm with it) turned `deg` out from the side, about the shoulder:
 * `sides` 'left', 'right' (the person's own). */
function elbowsOut(skel, deg, sides = ['left', 'right']) {
  const J = skel.joints, n = J.pelvis.length, joints = { ...J };
  for (const side of sides) {
    const el = [], wr = [];
    for (let i = 0; i < n; i++) {
      const l = J.left_shoulder[i].map((v, k) => v - J.right_shoulder[i][k]);
      const out = norm([l[0], 0, l[2]]).map(v => (side === 'left' ? v : -v));
      const k = norm(crossP([0, -1, 0], out)), sh = J[`${side}_shoulder`][i];       // (SMPL: y up)
      const turn = p => add(rot(add(p, sh, -1), k, deg), sh);
      el.push(turn(J[`${side}_elbow`][i])); wr.push(turn(J[`${side}_wrist`][i]));
    }
    joints[`${side}_elbow`] = el; joints[`${side}_wrist`] = wr;
  }
  return { fps: skel.fps, joints };
}
/** The reference's rotation (from 2.6 s: the clip holds the hands together before) played out and back `rounds`
 * times, `speed` times its pace, through the movement tracker with its landmarks, as the page runs it. */
function rotations(skel, { speed = 1, rounds = 5, mirrored = false } = {}) {
  const mv = library.find(x => x.key === 'shoulder_external_rotation');
  const fr = skeletonLandmarks(skel), part = fr.slice(fr.findIndex(x => x.t >= 2600));
  const seq = [];
  for (let r = 0; r < rounds; r++) seq.push(...part, ...[...part].reverse());
  const tr = new MovementTracker({ movement: mv }), evs = [], dt = 1000 / skel.fps / speed;
  seq.forEach((x, i) => {
    const t = i * dt, own = { world: x.world, image: x.image, aspect: ASPECT };
    const lm = mirrored ? mirror(own) : own;
    // (each event with the check's cycles judged by then)
    evs.push(...tr.update(features(lm.world, lm.image, ASPECT), t, lm)
      .map(e => ({ ...e, at: t, judged: [...tr.mf.s.elbows_out.hist] })));
  });
  return { tr, evs };
}
// the floor through the step touch's arm swings (its reference played out and back): known on nearly every frame with
// both arms up, where the shoulders narrow on screen (by engine.js's body scale, it was not on half of them)
const stepTouch = skeletonOf('step_touch_arm_swings');
test('the floor: known through the step touch\'s reference with its arms up, its feet on it', {
  skip: !stepTouch && 'no reference skeleton here' }, () => {
  const fr = skeletonLandmarks(stepTouch), seq = [];
  for (let r = 0; r < 3; r++) seq.push(...fr, ...[...fr].reverse());
  const mf = new MoveForm({ key: 'step_touch_arm_swings' }), up = [];
  seq.forEach((x, i) => {
    const m = bodyMetrics(x.world, x.image, ASPECT), f = mf.withFloor(m, (i * 1000) / 30);
    if (i > 120 && Math.min(m.armL, m.armR) > 90) up.push(f);
  });
  const known = up.filter(f => f.airborne !== null);
  assert.ok(known.length >= 0.95 * up.length, `known on ${known.length} of ${up.length} frames with the arms up`);
  assert.ok(known.every(f => f.airborne === false && f.feetLift < 0.1), 'the feet on the floor');
});

// the two slowest references played slower than their own pace (half and 0.6 of it): their peaks judged, with a check
// measuring at each (the arms' own checks have their phases: tests/moveforms-arms.test.mjs), and a rest after still a
// pause
const SLOW = { key: null, forms: k => ({ [k]: [{ id: 'arm', name: 'arm up', label: 'arm', part: 'arm', needs: ['arms'],
  at: 'peak', order: 1, value: m => Math.max(m.armL, m.armR), bad: () => false, ok: () => true, measured: String,
  target: 't', cue: 'c' }] }) };
const slowRefs = ['shoulder_external_rotation', 'y_to_w_raise'].map(key => ({ key, skel: skeletonOf(key) }));
test('the shoulder rotation and the Y-to-W at half and 0.6 of their pace: their peaks judged; a rest after, a pause', {
  skip: slowRefs.some(r => !r.skel) && 'no reference skeletons here' }, () => {
  for (const { key, skel } of slowRefs) {
    const lm = skeletonLandmarks(skel), arm = lm.map(x => features(x.world, x.image, ASPECT));
    // (the part that repeats: the rotation from where its hands start apart, the Y-to-W up to the end of its W)
    let part = lm;
    if (key === 'shoulder_external_rotation') part = lm.slice(lm.findIndex(x => x.t >= 2600));
    else {
      const a = arm.map(x => x.armMax), low = Math.min(...a);
      part = lm.slice(0, a.findLastIndex(v => v <= low + 5) + 1);
    }
    for (const speed of [0.5, 0.6]) {
      const tr = new MovementTracker({ movement: library.find(x => x.key === key), forms: SLOW.forms(key) });
      const seq = [];
      for (let r = 0; r < 5; r++) seq.push(...part, ...[...part].reverse());
      let judged = 0, t = 0;
      const dt = 1000 / 30 / speed;
      for (const x of seq) {
        tr.update(features(x.world, x.image, ASPECT), t, { world: x.world, image: x.image, aspect: ASPECT });
        if (tr.mf.s.arm.measuredT === t) judged += 1;
        t += dt;
      }
      const peaks = Math.round(seq.length / part.length / 2);
      assert.ok(judged >= peaks - 2, `${key} ${speed}x: ${judged} of ${peaks} peaks judged`);
      // ...then a rest of 20 s, the last pose held: a pause, and a new run once moving again
      const before = tr.mf.runStart, end = seq.at(-1);
      let paused = false;
      for (let i = 0; i < 600; i++, t += 1000 / 30) {
        tr.update(features(end.world, end.image, ASPECT), t, { world: end.world, image: end.image, aspect: ASPECT });
        paused ||= tr.mf.paused(t);
      }
      assert.ok(paused, `${key} ${speed}x: the rest is a pause`);
      for (const x of seq.slice(0, part.length)) {
        tr.update(features(x.world, x.image, ASPECT), t, { world: x.world, image: x.image, aspect: ASPECT });
        t += dt;
      }
      assert.ok(tr.mf.runStart > before, `${key} ${speed}x: a new run after the rest`);
    }
  }
});

// The user's standing side crunches (2026-10-25: the recordings whose movements name it, found at run time), the feet
// below the picture through all or part of the set: asked to step back during it, the feet named; and the sweeps
// counted where the feet were out, by the rhythm's fallback (the thigh out from down), as many as the real ones. A
// real sweep, from the landmarks: a leg lifted (its ankle 0.08 leg lengths over the other, its thigh 30 deg or more
// from down, at most 100: sitting at the laptop reads 130-155) for 0.2 s or more; on the side with the most of them.
const liveDir = path.join(DATA, 'posedata', 'results', 'live');
const liveRecs = fs.existsSync(liveDir) ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')).sort()
  .map(f => ({ name: f.replace('.json', ''), file: path.join(liveDir, f) })) : [];
const recOf = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const crunchRecs = liveRecs.filter(r => { try { return recOf(r.file).movements?.some(m => m.movement ===
  'standing_side_crunch'); } catch { return false; } });
const objs = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
/** A recording through the tracker with `key` named over the whole of it, as the page: its events (`at`: seconds into
 * it), the cycles counted (their frames' seconds, and whether by the fallback) and each frame's metrics. */
function replay(rec, key) {
  const tr = new MovementTracker({ movement: library.find(x => x.key === key) }), t0 = rec.frames[0].t;
  const aspect = rec.width / rec.height, evs = [], counted = [], rows = [];
  for (const fr of rec.frames) {
    const lm = fr.world && fr.image ? { world: objs(fr.world), image: objs(fr.image), aspect } : null;
    const s = (fr.t - t0) / 1000, out = lm ? tr.update(features(lm.world, lm.image, aspect), fr.t, lm) : tr.lost(fr.t);
    evs.push(...out.map(e => ({ ...e, at: s })));
    if (tr.cycles?.count > counted.length) counted.push({ s, fallback: tr.counting === 'fallback' });
    if (lm) rows.push({ s, m: bodyMetrics(lm.world, lm.image, aspect) });
  }
  return { tr, evs, counted, rows };
}
function realSweeps(rows) {
  const out = [];
  let cur = null;
  for (const { s, m } of rows) {
    const side = m.ankleUpL > m.ankleUpR ? 'L' : 'R', th = m[`thighFromDown${side}`];
    const on = m[`ankleUp${side}`] >= 0.08 && th >= 30;
    if (on && (!cur || cur.side !== side || s - cur.end > 0.25)) {
      if (cur) out.push(cur);
      cur = { side, start: s, end: s, top: 0 };
    }
    if (on) { cur.end = s; cur.top = Math.max(cur.top, th); }
  }
  if (cur) out.push(cur);
  const real = out.filter(x => x.end - x.start >= 0.2 && x.top <= 100);
  const side = real.filter(x => x.side === 'L').length >= real.filter(x => x.side === 'R').length ? 'L' : 'R';
  return real.filter(x => x.side === side);
}
test('the user\'s standing side crunches, the feet below the picture: asked to step back in the set, the sweeps '
  + 'counted', { skip: (!crunchRecs.length || !library.length) && 'no recording of it here' }, () => {
  for (const { name, file } of crunchRecs) {
    const { evs, counted, rows } = replay(recOf(file), 'standing_side_crunch');
    // The simple one-side sweep oracle below is for the earlier steady-side recordings. Alternating / high lifts
    // need annotated windows: covered in side-crunch-recordings.test.mjs without dropping high or other-side reps.
    if (rows.some(r => r.m.seen.legs && Math.max(r.m.thighFromDownL, r.m.thighFromDownR) > 110)) continue;
    const sweeps = realSweeps(rows), from = sweeps[0].start - 0.5, to = sweeps.at(-1).end + 2;
    const inSet = counted.filter(c => c.s >= from && c.s <= to);
    assert.ok(Math.abs(inSet.length - sweeps.length) <= 1, `${name}: ${inSet.length} counted, ${sweeps.length} sweeps`);
    // (where the feet were out: by the fallback)
    assert.ok(inSet.some(c => c.fallback), `${name}: the fallback counted`);
    const unseen = evs.filter(e => e.type === 'form_unseen');
    assert.ok(unseen.length >= 1, `${name}: asked`);
    assert.ok(unseen.every(e => e.at >= from && e.at <= to && e.why === 'frame' && e.parts.includes('feet')),
      `${name}: ${JSON.stringify(unseen.map(e => [e.at, e.parts]))}`);
    // ...the first while the feet were still out (a sweep's ankle in the picture or not, the standing one never)
    const first = rows.find(r => r.s >= unseen[0].at);
    assert.equal(first.m.seen.legs, false, `${name}: the feet out at ${unseen[0].at}`);
  }
});

// The user's other recordings, the side crunch named over the whole of each: asked to step back only standing, the
// feet cut off: never more than a second into a stretch the hand labels call 'close' (sitting at or walking up to the
// laptop: the 5 s before the prompt then began standing)
const labelsFile = path.join(DATA, 'moves', 'live_labels.json');
const LABELS = fs.existsSync(labelsFile) ? JSON.parse(fs.readFileSync(labelsFile, 'utf8')).labels : {};
test('the user\'s other recordings, the side crunch named: never asked to step back at the laptop', {
  skip: (!liveRecs.some(r => LABELS[r.name]) || !library.length) && 'no labelled recording here' }, () => {
  for (const { name, file } of liveRecs.filter(r => LABELS[r.name])) {
    const { evs } = replay(recOf(file), 'standing_side_crunch'), labels = LABELS[name];
    const label = s => labels.find(x => s >= x[0] && s < x[1])?.[2];
    for (const e of evs.filter(x => x.type === 'form_unseen')) {
      assert.notEqual(label(e.at - 1), 'close', `${name}: asked ${e.at.toFixed(1)} s in, at the laptop`);
    }
  }
});

const ser = skeletonOf('shoulder_external_rotation');
const noSer = !ser && 'no reference skeleton here';

test('shoulder external rotation: the reference keeps its elbows at its sides at every peak, mirrored too, at its own '
  + 'pace and twice it', { skip: noSer }, () => {
  for (const speed of [1, 2]) for (const mirrored of [false, true]) {
    const what = `${speed}x${mirrored ? ' mirrored' : ''}`;
    const { tr, evs } = rotations(ser, { speed, mirrored });
    assert.ok(tr.current().count >= 4, `${what}: ${tr.current().count} cycles`);
    assert.deepEqual(evs.filter(e => e.type.startsWith('form_')), [], what);
    const names = MOVE_FORMS.shoulder_external_rotation.map(c => c.name);
    assert.deepEqual(tr.summary().form, { checked: names, faults: [] }, what);
    assert.deepEqual(tr.current().form.checked, names, what);
    // (each cycle judged: its peaks after the warm-up, all fine; at its own pace, 8.7 s apart, the last two count)
    const s = tr.mf.s.elbows_out;
    assert.ok(s.hist.length >= 2 && s.hist.every(x => x === 'ok'), `${what}: ${s.hist}`);
    assert.ok(s.value > 20 && s.value < 35, `${what}: ${s.value}`);
  }
});

test('shoulder external rotation: elbows put out from the sides are caught at the second bad peak, both sides or one',
  { skip: noSer }, () => {
    for (const deg of [20, 30]) {
      const { tr, evs } = rotations(elbowsOut(ser, deg));
      const faults = evs.filter(e => e.type === 'form_fault');
      assert.deepEqual(faults.map(e => [e.fault, e.part, e.side]), [['elbows_out', 'elbow', null]], `${deg} deg`);
      assert.match(faults[0].measured, /^elbow \d+ degrees out from your side/);
      assert.equal(faults[0].key, 'shoulder_external_rotation');
      // (told on the second peak judged: the first after the warm-up and the next)
      assert.deepEqual(faults[0].judged, ['bad', 'bad'], `${deg} deg`);
      assert.deepEqual(tr.mf.s.elbows_out.hist, ['bad', 'bad'], 'the last two peaks, 8.7 s apart, still count');
      assert.deepEqual(tr.summary().form.faults, [{ fault: 'elbows_out', label: 'elbows drifting off the sides',
        fixed: false, told: true }]);
    }
    // one arm only: that side, as the user's own (mirrored: the other)
    for (const mirrored of [false, true]) {
      const { evs } = rotations(elbowsOut(ser, 30, ['left']), { mirrored });
      assert.deepEqual(evs.filter(e => e.type === 'form_fault').map(e => e.side), [mirrored ? 'right' : 'left']);
    }
    // the elbows back in after: fixed
    const out = elbowsOut(ser, 30);
    const mv = library.find(x => x.key === 'shoulder_external_rotation');
    const tr = new MovementTracker({ movement: mv }), evs = [], dt = 1000 / ser.fps;
    const play = (sk, t0) => {
      const fr = skeletonLandmarks(sk), part = fr.slice(fr.findIndex(x => x.t >= 2600)), seq = [];
      for (let r = 0; r < 4; r++) seq.push(...part, ...[...part].reverse());
      seq.forEach((x, i) => {
        const lm = { world: x.world, image: x.image, aspect: ASPECT };
        evs.push(...tr.update(features(lm.world, lm.image, ASPECT), t0 + i * dt, lm));
      });
      return t0 + seq.length * dt;
    };
    play(ser, play(out, 0));
    assert.deepEqual(evs.filter(e => e.type.startsWith('form_')).map(e => e.type), ['form_fault', 'form_fix']);
    assert.deepEqual(tr.summary().form.faults.map(f => [f.fault, f.fixed, f.told]), [['elbows_out', true, true]]);
  });
