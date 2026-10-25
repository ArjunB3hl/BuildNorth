// The guard rails of the dances and the flow (web/js/moveforms/flow.js): the group's shape; the forward fold roll-up's
// reach on made-up MediaPipe-like landmarks (judged only standing tall with the arms raised, the lower arm measured,
// its side) and through MoveForm (a `still` check: judged at rest too, once the person has moved); on the library's
// reference skeleton through the movement tracker as the page runs it (at half its pace, its own, 1.5 and 2 times it,
// mirrored, with MediaPipe-sized jitter: nothing; its arms put lower: caught at the first reach where it lasts long
// enough, on the side put in; back up: fixed), on MediaPipe of the library's footage of it, and over every recording
// of the user's with each of the four movements named (nothing told). The Bharatanatyam's hands, raised by the face
// instead of brought in to the chest: on made-up landmarks (judged with the other forearm across the chest, the hand
// up at the upper chest or higher, upright, facing the camera; the forearm's direction in the picture), through
// MoveForm (a gesture held about a second told; the chest gestures lower down never fix it; the hand brought in does),
// on its reference (nothing; a forearm put up by the face in its last gesture: told on that side, then fixed), its
// footage, and the user's own recordings of it (the raised hand told on its side, nothing else). The dances have no
// check, so no form.
// Private data (.data/: the library, its skeletons and footage, the recordings) is skipped when not on this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { boneParts } from '../web/js/formcheck.js';
import { faultParts } from '../web/js/retarget.js';
import { MOVE_FORMS, MOVE_FORM_GROUPS, MOVE_TUNING, MoveForm, bodyMetrics, checkProblems }
  from '../web/js/moveform.js';
import FLOW from '../web/js/moveforms/flow.js';
import { MovementTracker } from '../web/js/moves.js';
import { skeletonFromNpz, skeletonLandmarks } from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const FPS = 30, DT = 1000 / FPS, ASPECT = 16 / 9, S = 2.4;   // S: metres from the picture's top to its bottom
const KEYS = ['bharatanatyam_arms', 'freestyle_dance', 'hip_hop_dance', 'forward_fold_roll_up'];
const NO_CHECK = ['freestyle_dance', 'hip_hop_dance'];
const BHARAT = 'bharatanatyam_arms', RAISED = { L: 'hand_raised_left', R: 'hand_raised_right' };
const FOLD = 'forward_fold_roll_up', REACH = 'reach_short', REACH_NAME = 'arms overhead at the top';
const PARTS = boneParts().filter(p => faultParts().includes(p));

// --- made-up landmarks ---------------------------------------------------------------------------------------------
const rad = d => (d * Math.PI) / 180;
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossP = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
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
 * forward (world y down). */
const limb = (sx, out, fwd = 0) => [sx * Math.sin(rad(out)), Math.cos(rad(out)) * Math.cos(rad(fwd)),
  -Math.cos(rad(out)) * Math.sin(rad(fwd))];
/** A made-up person standing straight, facing the camera (hips and shoulders 0.3 m wide, legs 0.9 m, trunk 0.5 m,
 * upper arms 0.3 m, forearms 0.27 m), per side (L, R): `arm` the upper arm out to the side from straight down, `armFwd`
 * forward, `elbow` bent by (the forearm towards forward), or `fore` the forearm's direction itself ([x, y, z]: x the
 * person's left, y down, z towards the camera negative); the trunk `lean` forward. */
function body(o = {}) {
  const g = (k, s) => o[`${k}${s}`] ?? o[k] ?? 0;
  const P = {};
  P[23] = [0.15, 0, 0]; P[24] = [-0.15, 0, 0];
  for (const [sx, hip, kn, an, heel, toe] of [[1, 23, 25, 27, 29, 31], [-1, 24, 26, 28, 30, 32]]) {
    P[kn] = add(P[hip], [0, 0.45, 0]); P[an] = add(P[kn], [0, 0.45, 0]);
    P[heel] = add(P[an], [0, 0.04, 0.05]); P[toe] = add(P[an], [0, 0.06, -0.15]);
  }
  const lean = rad(o.lean ?? 0), u = [0, -Math.cos(lean), -Math.sin(lean)];          // hips to shoulders
  const sm = add([0, 0, 0], u, 0.5);
  P[11] = add(sm, [0.15, 0, 0]); P[12] = add(sm, [-0.15, 0, 0]);
  for (const [s, sx, sh, el, wr, hs] of [['L', 1, 11, 13, 15, [17, 19, 21]], ['R', -1, 12, 14, 16, [18, 20, 22]]]) {
    const d = limb(sx, g('arm', s), g('armFwd', s));
    let k = crossP(d, FWD);
    if (Math.hypot(...k) < 1e-6) k = crossP(d, [0, -1, 0]);
    P[el] = add(P[sh], d, 0.3);
    P[wr] = add(P[el], o[`fore${s}`] ? norm(o[`fore${s}`]) : rot(d, norm(k), g('elbow', s)), 0.27);
    for (const i of hs) P[i] = P[wr];
  }
  P[0] = add(add(sm, u, 0.25), FWD, 0.1); P[7] = add(P[0], [0.07, 0, 0]); P[8] = add(P[0], [-0.07, 0, 0]);
  return P;
}
/** MediaPipe-like landmarks of points {index: [x, y, z]} (an orthographic camera in front, the hips at 60% of the
 * picture's height); `vis` visibility by index. */
function landmarks(P, { vis = {} } = {}) {
  const hips = [0, 0, 0], world = [], image = [];
  for (let i = 0; i < 33; i++) {
    const p = sub(P[i] ?? P[0], hips);
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (S * ASPECT), y: 0.6 + p[1] / S, z: 0, visibility: vis[i] ?? 1 });
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
const reach = () => FLOW[FOLD].find(c => c.id === REACH);

// --- the group ------------------------------------------------------------------------------------------------------
test('flow: the forward fold and the Bharatanatyam have guard rails of the shape the page needs; the dances none',
  () => {
  assert.equal(MOVE_FORM_GROUPS.flow, FLOW);
  assert.deepEqual(Object.keys(FLOW), [BHARAT, FOLD]);
  assert.deepEqual(checkProblems(FLOW, PARTS), []);
  assert.deepEqual(FLOW[BHARAT].map(c => [c.id, c.part, c.side()]), [[RAISED.L, 'arm', 'L'], [RAISED.R, 'arm', 'R']]);
  for (const c of [...FLOW[FOLD], ...FLOW[BHARAT]]) {
    assert.equal(c.at, 'frame', `${c.id}: a moving movement has no cycles`);
    assert.equal(typeof c.phase, 'function', `${c.id}: judged in its part of the movement only`);
    // (a part on one side of the body: its side is said)
    assert.equal(typeof c.side, 'function', c.id);
  }
  assert.equal(MOVE_FORMS[FOLD], FLOW[FOLD]);
  assert.equal(MOVE_FORMS[BHARAT], FLOW[BHARAT]);
  // no check: no form, and the coach does not call it right or wrong
  for (const key of NO_CHECK) {
    assert.equal(MOVE_FORMS[key], undefined, key);
    assert.throws(() => new MoveForm({ key }), /no form check/);
    const tr = new MovementTracker({ movement: { key, display: key, kind: 'dance', track: 'moving' } });
    const lm = landmarks(body());
    tr.update(features(lm.world, lm.image, ASPECT), 0, lm);
    assert.equal(tr.current().form, null, key);
    assert.equal('form' in tr.summary(), false, key);
  }
});

// --- the reach, frame by frame ---------------------------------------------------------------------------------------
test('reach: judged standing tall with every arm in view raised past level, elbows fairly straight; nowhere else',
  () => {
  const c = reach(), at = o => metricsOf(landmarks(body(o)));
  // arms straight up: judged and fine; up forward, a little over level: judged and short
  const up = at({ arm: 170 }), fwd = at({ armFwd: 100 });
  assert.ok(c.phase(up) && c.phase(fwd));
  assert.ok(Math.abs(c.value(up) - 170) < 0.01 && c.ok(c.value(up)) && !c.bad(c.value(up)));
  assert.ok(Math.abs(c.value(fwd) - 100) < 0.01 && c.bad(c.value(fwd)));
  assert.match(c.measured(c.value(fwd)), /^arms raised 100 degrees at the top/);
  // not the movement's top: arms down, level ahead, hands on the head (elbows bent 120), folded or leaning in with the
  // arms up, one arm hanging
  for (const [what, o] of [['arms down', {}], ['arms level ahead', { armFwd: 88 }], ['hands on the head',
    { arm: 150, elbow: 120 }], ['folded, arms hanging', { lean: 120 }], ['leaning in, arms up', { lean: 30, arm: 170 }],
  ['one arm hanging', { armL: 170 }]]) {
    assert.equal(c.phase(at(o)), false, what);
  }
  // 115 is short, 125 fine, between the two neither (no flicker on the line)
  assert.ok(c.bad(109) && !c.bad(110) && !c.ok(119) && c.ok(120));
});

test('reach: the lower arm in view is measured, and its side said when it alone is short; from the side, the near arm',
  () => {
    const c = reach();
    const lm = landmarks(body({ armL: 170, armFwdR: 100 }));
    const m = metricsOf(lm), mm = metricsOf(mirror(lm));
    assert.ok(c.phase(m) && Math.abs(c.value(m) - 100) < 0.01);
    assert.deepEqual([c.side(m), c.side(mm)], ['R', 'L']);
    // both short: both (no side); nor with the other one just over the line (jitter puts arms held alike apart)
    assert.equal(c.side(metricsOf(landmarks(body({ armFwd: 100 })))), null);
    assert.equal(c.side(metricsOf(landmarks(body({ armFwdL: 112, armFwdR: 100 })))), null);
    // the right arm out of view (its wrist unseen, as the far arm from the side): the left one alone, no side
    const near = metricsOf(landmarks(body({ armFwdL: 100, armR: 170 }), { vis: { 16: 0.1 } }));
    assert.deepEqual([near.seen.armL, near.seen.armR], [true, false]);
    assert.ok(c.phase(near) && Math.abs(c.value(near) - 100) < 0.01 && c.side(near) === null);
    // neither arm in view: not measurable (as out of view)
    const none = metricsOf(landmarks(body({ arm: 170 }), { vis: { 15: 0.1, 16: 0.1 } }));
    assert.ok(Number.isNaN(c.value(none)));
  });

test('reach through MoveForm: judged held still (once moved), arms short told after SETTLE_MS and FAULT_MS; up, down '
  + 'or on the head, nothing', () => {
  assert.equal(reach().still, true);
  /** 10 s at 30 fps of one made-up pose, moving on its first frame only (`moved`), then still: the events (each with
   * `at`) and the state at the end. */
  const hold = (o, moved = true) => {
    const mf = new MoveForm({ key: FOLD }), m = metricsOf(landmarks(body(o))), evs = [];
    for (let t = 0; t <= 10000; t += DT) {
      evs.push(...mf.update(m, null, t, null, moved && t === 0).map(e => ({ ...e, at: t })));
    }
    return { evs, state: mf.state() };
  };
  const short = hold({ armFwd: 100 });
  assert.deepEqual(short.evs.map(e => [e.type, e.fault, e.part, e.side]), [['form_fault', REACH, 'arm', null]]);
  const due = MOVE_TUNING.SETTLE_MS + MOVE_TUNING.FAULT_MS;                    // (no warm-up for a still check)
  assert.ok(short.evs[0].at >= due - 100 && short.evs[0].at <= due + 100, `${short.evs[0].at}`);
  // never judged before the person has moved since the movement was named
  assert.deepEqual(hold({ armFwd: 100 }, false), { evs: [], state: { checked: [], open: [], pending: [], unseen: [],
    wrongView: [] } });
  assert.equal(short.evs[0].cue, 'At the top, reach both arms all the way up overhead.');
  // one arm short: its side, as the user's own
  assert.deepEqual(hold({ armL: 170, armFwdR: 100 }).evs.map(e => e.side), ['right']);
  const up = hold({ arm: 170 });
  assert.deepEqual([up.evs, up.state.checked], [[], [REACH_NAME]]);
  for (const o of [{}, { arm: 150, elbow: 120 }]) {
    const r = hold(o);
    assert.deepEqual([r.evs, r.state], [[], { checked: [], open: [], pending: [], unseen: [], wrongView: [] }]);
  }
});

// --- the Bharatanatyam's hands, frame by frame -----------------------------------------------------------------------
const raised = s => FLOW[BHARAT].find(c => c.id === RAISED[s]);
// made-up poses (forearms 0.27 m, the shoulders 0.5 m above the hips): the left forearm across the chest (the upper arm
// out 60 deg, the hand 0.3 trunk heights under the shoulder) and the right hand...
const ACROSS_L = { armL: 60, foreL: [-1, 0, -0.2] };
const POSE = {
  salute: { ...ACROSS_L, armR: 60, foreR: [0.42, -0.91, 0] },          // ...raised by the face, the forearm 65 deg up
  upper: { ...ACROSS_L, armR: 80, foreR: [1, 0, -0.2] },               // ...in at the upper chest, the forearm level
  low: { ...ACROSS_L, armR: 50, foreR: [1, 0, -0.2] },                 // ...in at the chest lower down
  down: {},                                                             // arms hanging
};
const poseLm = (name, o = {}) => landmarks(body({ ...POSE[name], ...o }));
test('Bharatanatyam: a hand held up by the face is bad, in at the chest fine, the forearm\'s direction measured in the '
  + 'picture; judged with the other forearm across the chest, the hand up at the upper chest or higher, upright', () => {
  const c = raised('R'), at = lm => [metricsOf(lm), lm];
  const [sm, slm] = at(poseLm('salute')), [um, ulm] = at(poseLm('upper'));
  assert.ok(c.phase(sm, slm) && c.phase(um, ulm));
  assert.ok(Math.abs(c.value(sm, slm) - 65) < 1 && c.bad(c.value(sm, slm)), `${c.value(sm, slm)}`);
  assert.ok(Math.abs(c.value(um, ulm)) < 1 && c.ok(c.value(um, ulm)));
  assert.match(c.measured(c.value(sm, slm)), /^forearm raised 65 degrees above level \(straight up is 90\)$/);
  // not its moment: the hand in at the chest lower down (never judged, so never calling a raised hand fixed), arms
  // hanging, the other forearm up too (a boxing guard), leaning, side-on
  for (const [what, lm] of [['lower down', poseLm('low')], ['arms hanging', poseLm('down')],
    ['both forearms up', poseLm('salute', { foreL: [-0.42, -0.91, 0] })], ['leaning', poseLm('salute', { lean: 35 })]]) {
    assert.equal(c.phase(metricsOf(lm), lm), false, what);
  }
  assert.equal(sm.view, 'front');
  assert.deepEqual(c.views, ['front', 'angled']);
  // the other arm out of the picture: not this check's moment, nor its parts unseen (a plank from the side is no call
  // to step back)
  const far = landmarks(body(POSE.salute), { vis: { 15: 0.1 } });
  assert.equal(c.phase(metricsOf(far), far), false);
  assert.deepEqual(c.needs, ['armR', 'trunk']);
  // mirrored: the left hand raised, the left check's; the right one's not its moment
  const mlm = mirror(poseLm('salute')), mm = metricsOf(mlm);
  assert.ok(raised('L').phase(mm, mlm) && raised('L').bad(raised('L').value(mm, mlm)));
  assert.equal(c.phase(mm, mlm), false);
  // 45 is bad, 30 fine, between the two neither
  assert.ok(c.bad(46) && !c.bad(45) && !c.ok(31) && c.ok(30));
});

test('Bharatanatyam through MoveForm: a hand held up by the face about a second is told on its side; the chest '
  + 'gestures lower down never fix it, the hand brought in to the upper chest does', () => {
  for (const c of FLOW[BHARAT]) assert.deepEqual([c.still, c.smoothMs, c.faultMs], [true, 400, 800]);
  /** Repetitions of 4 s (arms down, the right hand in at the chest lower down, then `last` for 1.2 s, arms down),
   * moving on the first frame only: the events, each with `at`. */
  const reps = (mf, last, n, t0 = 0, mirrored = false) => {
    const lms = Object.fromEntries(Object.keys(POSE).map(k => [k, mirrored ? mirror(poseLm(k)) : poseLm(k)]));
    const evs = [];
    for (let t = t0; t < t0 + n * 4000; t += DT) {
      const p = (t - t0) % 4000, lm = lms[p < 500 ? 'down' : p < 2000 ? 'low' : p < 3200 ? last : 'down'];
      evs.push(...mf.update(metricsOf(lm), lm, t, null, t === 0).map(e => ({ ...e, at: t })));
    }
    return evs;
  };
  const mf = new MoveForm({ key: BHARAT });
  const bad = reps(mf, 'salute', 3);
  assert.deepEqual(bad.map(e => [e.type, e.fault, e.part, e.side]), [['form_fault', RAISED.R, 'arm', 'right']]);
  // told in the first one: its phase from 2 s, SETTLE_MS not judged, then faultMs bad
  const due = 2000 + MOVE_TUNING.SETTLE_MS + 800;
  assert.ok(Math.abs(bad[0].at - due) <= 2 * DT, `${bad[0].at}`);
  assert.equal(bad[0].cue, 'Bring that hand in to your chest, the forearm across your body, not up by your face.');
  assert.deepEqual(mf.state().open.map(f => f.fault), [RAISED.R]);
  // brought in to the upper chest: 0.9 s of each judged (1.2 s less SETTLE_MS), FIX_MS of them: fixed in the second
  const good = reps(mf, 'upper', 3, 12000);
  assert.deepEqual(good.map(e => [e.type, e.fault]), [['form_fix', RAISED.R]]);
  assert.ok(good[0].at > 16000 && good[0].at < 20000, `${good[0].at}`);
  // mirrored: the left hand
  assert.deepEqual(reps(new MoveForm({ key: BHARAT }), 'salute', 2, 0, true).map(e => [e.fault, e.side]),
    [[RAISED.L, 'left']]);
  // in at the upper chest throughout: nothing, and both said measured and fine where judged
  const fine = new MoveForm({ key: BHARAT });
  assert.deepEqual(reps(fine, 'upper', 3), []);
  assert.deepEqual(fine.summary().faults, []);
});

// --- the library's reference skeletons and footage (private) -----------------------------------------------------
const libFile = path.join(DATA, 'moves', 'library.json');
const library = fs.existsSync(libFile) ? JSON.parse(fs.readFileSync(libFile, 'utf8')).movements : [];
const catalogFile = path.join(DATA, 'moves', 'catalog.json');
const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : null;
const movementOf = key => library.find(x => x.key === key);
/** The reference skeleton of a library movement ({fps, joints}), from its dump or its npz; null if neither is here. */
function skeletonOf(key) {
  const m = movementOf(key);
  if (!m) return null;
  const dump = path.join(DATA, 'moves', 'skel', `${m.id}.json`);
  if (fs.existsSync(dump)) return JSON.parse(fs.readFileSync(dump, 'utf8'));
  const npz = catalog && path.join(catalog.source, m.id, 'source', 'skeleton_motion.npz');
  return npz && fs.existsSync(npz) ? skeletonFromNpz(fs.readFileSync(npz)) : null;
}
/** MediaPipe on the library's footage of a movement ({width, height, frames: [{t, world, image}]}), or null. */
function footageOf(key) {
  const m = movementOf(key), index = path.join(DATA, 'moves', 'mp', 'index.json');
  if (!m || !fs.existsSync(index)) return null;
  const file = JSON.parse(fs.readFileSync(index, 'utf8')).find(e => e.id === m.id)?.series;
  const at = file && path.join(ROOT, file);
  return at && fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, 'utf8')) : null;
}
const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));

/** The skeleton with each arm's angle from straight down scaled by `k` about its shoulder (the elbow's bend kept):
 * k 0.7 reaches 70% as high. `sides`: 'left', 'right' (the person's own). */
function armsLower(skel, k, sides = ['left', 'right']) {
  const J = skel.joints, joints = { ...J };
  for (const side of sides) {
    const el = [], wr = [];
    J.pelvis.forEach((_, i) => {
      const sh = J[`${side}_shoulder`][i], u = sub(J[`${side}_elbow`][i], sh);
      const ax = crossP(u, [0, -1, 0]), n = Math.hypot(...ax);                 // (SMPL: y up)
      const a = Math.acos(Math.max(-1, Math.min(1, -u[1] / Math.hypot(...u)))) / rad(1);
      const turn = p => (n < 1e-9 ? p : add(rot(sub(p, sh), ax.map(x => x / n), (1 - k) * a), sh));
      el.push(turn(J[`${side}_elbow`][i])); wr.push(turn(J[`${side}_wrist`][i]));
    });
    joints[`${side}_elbow`] = el; joints[`${side}_wrist`] = wr;
  }
  return { fps: skel.fps, joints };
}
/** The reference played forward and back (fold, roll up, reach; back down again) `rounds` times at `speed` times its
 * pace, mirrored or with `jitter` metres of noise (a seeded uniform ±jitter on every world coordinate, the same on the
 * picture), through `tr` (a new tracker of the movement if none) from `t0`, as the page runs it: {tr, evs, end}. */
function play(key, skel, { speed = 1, rounds = 4, mirrored = false, jitter = 0, seed = 7, tr = null, t0 = 0 } = {}) {
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return 2 * (r / 2147483647) - 1; };
  const fr = skeletonLandmarks(skel), seq = [];
  for (let i = 0; i < rounds; i++) seq.push(...(i % 2 ? [...fr].reverse() : fr));
  tr ??= new MovementTracker({ movement: movementOf(key) });
  const evs = [], dt = 1000 / skel.fps / speed;
  seq.forEach((x, i) => {
    let lm = { aspect: ASPECT, world: x.world.map(p => ({ x: p.x + jitter * rnd(), y: p.y + jitter * rnd(),
      z: p.z + jitter * rnd() })), image: x.image.map(p => ({ ...p, x: p.x + (jitter * rnd()) / (S * ASPECT),
      y: p.y + (jitter * rnd()) / S })) };
    if (mirrored) lm = mirror(lm);
    const t = t0 + i * dt;
    evs.push(...tr.update(features(lm.world, lm.image, ASPECT), t, lm).map(e => ({ ...e, at: t })));
  });
  return { tr, evs, end: t0 + seq.length * dt };
}
const formEvents = evs => evs.filter(e => e.type.startsWith('form_'));
const fold = skeletonOf(FOLD), noFold = !fold && 'no reference skeleton here';
// MediaPipe's jitter on a still person: 2-6 deg, 0.02-0.04 body lengths over half a second (moves.js): ±1.5 cm here
const JITTER = 0.015;

const SPEEDS = [0.5, 1, 1.5, 2];
test('forward fold: the reference reaches overhead: nothing told at half its pace, its own, 1.5 and 2 times it, '
  + 'mirrored, with MediaPipe-sized jitter; judged and fine', { skip: noFold }, () => {
  for (const speed of SPEEDS) {
    for (const o of [{}, { mirrored: true }, { jitter: JITTER }, { jitter: JITTER, mirrored: true, seed: 3 }]) {
      const what = `${speed}x ${JSON.stringify(o)}`;
      const { tr, evs } = play(FOLD, fold, { speed, rounds: 6, ...o });
      assert.deepEqual(formEvents(evs), [], what);
      assert.deepEqual(tr.summary().form, { checked: [REACH_NAME], faults: [] }, what);
      // (its last value: the last second of the reach judged, the arms on their way down at the slower paces)
      const v = tr.mf.s[REACH].value;
      assert.ok(v >= 120 && v < 155, `${what}: ${v}`);
    }
  }
});

// [speed, rounds played, the reach a short one is told at]: a quick reach that short is in its phase about a second
// at twice the pace (its first SETTLE_MS not judged), so its bad time adds up over reaches
const TOLD_AT = [[0.5, 2, 1], [1, 2, 1], [1.5, 4, 2], [2, 6, 3]];
test('forward fold: arms put to reach 70% as high are caught at the first reach up to its own pace (the second at '
  + '1.5 times it, the third at 2), on the side put in; nothing else told', { skip: noFold }, () => {
  for (const [speed, rounds, reaches] of TOLD_AT) {
    for (const o of [{}, { jitter: JITTER }, { jitter: JITTER, mirrored: true, seed: 3 }]) {
      const what = `${speed}x ${JSON.stringify(o)}`;
      const { tr, evs, end } = play(FOLD, armsLower(fold, 0.7), { speed, rounds, ...o });
      const told = formEvents(evs);
      assert.deepEqual(told.map(e => [e.type, e.fault, e.part, e.side, e.key]), [['form_fault', REACH, 'arm', null,
        FOLD]], what);
      assert.match(told[0].measured, /^arms raised (9\d|10\d) degrees at the top \(straight up is 180\)$/, what);
      // (each reach is the end of a round played forward: told at the reach-th one, not before)
      const reach = (end / rounds) * (2 * reaches - 1);
      assert.ok(told[0].at > reach - (end / rounds) * 2 + 1000 && told[0].at < reach + 2000, `${what}: ${told[0].at}`);
      assert.deepEqual(tr.summary().form.faults, [{ fault: REACH, label: 'arms short of overhead at the top',
        fixed: false, told: true }], what);
    }
  }
  // one arm short: that side, as the user's own; mirrored, the other
  for (const [speed, rounds] of TOLD_AT) {
    for (const [sides, mirrored, want] of [[['left'], false, 'left'], [['right'], false, 'right'],
      [['left'], true, 'right']]) {
      const { evs } = play(FOLD, armsLower(fold, 0.7, sides), { speed, rounds, mirrored });
      assert.deepEqual(formEvents(evs).map(e => [e.fault, e.side]), [[REACH, want]], `${speed}x ${sides} ${mirrored}`);
    }
  }
});

test('forward fold: the arms back up to full height after: the fix is noticed at the first good reach (the second at '
  + '1.5 and 2 times the pace)', { skip: noFold }, () => {
  for (const [speed, rounds] of TOLD_AT) {
    for (const o of [{}, { jitter: JITTER }, { jitter: JITTER, mirrored: true, seed: 3 }]) {
      const what = `${speed}x ${JSON.stringify(o)}`;
      const bad = play(FOLD, armsLower(fold, 0.7), { speed, rounds, ...o });
      const good = play(FOLD, fold, { speed, rounds: 4, ...o, tr: bad.tr, t0: bad.end, seed: 11 });
      const evs = formEvents([...bad.evs, ...good.evs]);
      assert.deepEqual(evs.map(e => e.type), ['form_fault', 'form_fix'], what);
      // (the good part's reaches end its rounds 1 and 3)
      const round = (good.end - bad.end) / 4, reach = speed >= 1.5 ? 3 : 1;
      assert.ok(evs[1].at > bad.end && evs[1].at < bad.end + reach * round + 2000, `${what}: ${evs[1].at}`);
      assert.deepEqual(good.tr.summary().form, { checked: [REACH_NAME], faults: [{ fault: REACH,
        label: 'arms short of overhead at the top', fixed: true, told: true }] }, what);
    }
  }
});

const foldFootage = footageOf(FOLD);
test('forward fold: MediaPipe on the library\'s footage of it (from the side): nothing told, the reach judged on the '
  + 'near arm', { skip: !foldFootage && 'no footage here' }, () => {
  const rec = foldFootage, aspect = rec.width / rec.height, t0 = rec.frames[0].t;
  const tr = new MovementTracker({ movement: movementOf(FOLD) }), evs = [];
  for (const fr of rec.frames) {
    const lm = fr.world && fr.image ? { world: obj(fr.world), image: obj(fr.image), aspect } : null;
    evs.push(...(lm ? tr.update(features(lm.world, lm.image, aspect), fr.t - t0, lm) : tr.lost(fr.t - t0)));
  }
  assert.deepEqual(formEvents(evs), []);
  assert.deepEqual(tr.summary().form, { checked: [REACH_NAME], faults: [] });
  const v = tr.mf.s[REACH].value;
  assert.ok(v > 135 && v < 160, `${v}`);
});

test('the dances: their references have no form, nothing told', {
  skip: !NO_CHECK.some(skeletonOf) && 'no reference skeleton here' }, () => {
  for (const key of NO_CHECK) {
    const skel = skeletonOf(key);
    if (!skel) continue;
    const { tr, evs } = play(key, skel, { rounds: 2 });
    assert.deepEqual(formEvents(evs), [], key);
    assert.equal(tr.current().form, null, key);
    assert.equal('form' in tr.summary(), false, key);
  }
});

/** The skeleton with its `side` ('left', 'right': the person's own) forearm turned `deg` above level from `fromS` on,
 * keeping its direction across (SMPL: y up): a hand raised by the face. */
function forearmRaised(skel, side, deg, fromS) {
  const J = skel.joints, c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  const wr = J[`${side}_wrist`].map((w, i) => {
    if (i / skel.fps < fromS) return w;
    const el = J[`${side}_elbow`][i], f = sub(w, el), n = Math.hypot(f[0], f[2]) || 1, l = Math.hypot(...f);
    return [el[0] + (l * c * f[0]) / n, el[1] + l * s, el[2] + (l * c * f[2]) / n];
  });
  return { fps: skel.fps, joints: { ...J, [`${side}_wrist`]: wr } };
}
const bharat = skeletonOf(BHARAT), noBharat = !bharat && 'no reference skeleton here';
// Played out and back the reference reads not moving at half its pace and its own (one arm gestures at a time, which
// moves.js counts LIMB times less): its still checks wait for a first movement there, and judge from 1.5 times it
test('Bharatanatyam: the reference brings its hands in near level: nothing told at half its pace to twice it, '
  + 'mirrored, with MediaPipe-sized jitter; both hands judged and fine once it reads moving', { skip: noBharat }, () => {
  const names = FLOW[BHARAT].map(c => c.name);
  for (const speed of SPEEDS) {
    for (const o of [{}, { mirrored: true }, { jitter: JITTER }, { jitter: JITTER, mirrored: true, seed: 3 }]) {
      const what = `${speed}x ${JSON.stringify(o)}`;
      const { tr, evs } = play(BHARAT, bharat, { speed, rounds: 6, ...o });
      assert.deepEqual(formEvents(evs), [], what);
      assert.deepEqual(tr.summary().form.faults, [], what);
      if (speed >= 1.5) assert.deepEqual(tr.summary().form.checked, names, what);
      for (const c of FLOW[BHARAT]) {
        const v = tr.mf.s[c.id].value;
        assert.ok(v === null || v === undefined || Number.isNaN(v) || c.ok(v), `${what} ${c.id}: ${v}`);
      }
    }
  }
});

test('Bharatanatyam: a forearm put up by the face in the reference\'s last gesture is told on its side once it reads '
  + 'moving (by its second turn at 1.5 and 2 times its pace); the hand brought back in: fixed', {
  skip: noBharat }, () => {
  for (const [side, want] of [['right', RAISED.R], ['left', RAISED.L]]) {
    const skel = forearmRaised(bharat, side, 65, 4.9);
    for (const speed of [1.5, 2]) {
      for (const o of [{}, { jitter: JITTER }]) {
        const what = `${side} ${speed}x ${JSON.stringify(o)}`;
        const { evs, end } = play(BHARAT, skel, { speed, rounds: 4, ...o });
        const told = formEvents(evs);
        assert.deepEqual(told.map(e => [e.type, e.fault, e.side, e.part]), [['form_fault', want, side, 'arm']], what);
        assert.match(told[0].measured, /^forearm raised (5\d|6\d|7\d|8\d) degrees above level/, what);
        // (the last gesture is at the end of each round played forward: its turns at rounds 1 and 3)
        assert.ok(told[0].at < (end / 4) * 3 + 2000, `${what}: ${told[0].at}`);
      }
      // mirrored: the other side
      const m = play(BHARAT, skel, { speed, rounds: 4, mirrored: true });
      assert.deepEqual(formEvents(m.evs).map(e => e.side), [side === 'right' ? 'left' : 'right'], `${side} mirrored`);
    }
  }
  // then the reference as it is: fixed (its last gesture brief, under a second judged a turn: by the third turn)
  const bad = play(BHARAT, forearmRaised(bharat, 'right', 65, 4.9), { speed: 1.5, rounds: 4 });
  const good = play(BHARAT, bharat, { speed: 1.5, rounds: 6, tr: bad.tr, t0: bad.end });
  assert.deepEqual(formEvents([...bad.evs, ...good.evs]).map(e => [e.type, e.fault]),
    [['form_fault', RAISED.R], ['form_fix', RAISED.R]]);
  assert.deepEqual(good.tr.summary().form.faults, [{ fault: RAISED.R,
    label: 'right hand raised by the face, not brought in to the chest', fixed: true, told: true }]);
});

const bharatFootage = footageOf(BHARAT);
test('Bharatanatyam: MediaPipe on the library\'s footage of it: nothing told', {
  skip: !bharatFootage && 'no footage here' }, () => {
  const rec = bharatFootage, aspect = rec.width / rec.height, t0 = rec.frames[0].t;
  const tr = new MovementTracker({ movement: movementOf(BHARAT) }), evs = [];
  for (const fr of rec.frames) {
    const lm = fr.world && fr.image ? { world: obj(fr.world), image: obj(fr.image), aspect } : null;
    evs.push(...(lm ? tr.update(features(lm.world, lm.image, aspect), fr.t - t0, lm) : tr.lost(fr.t - t0)));
  }
  assert.deepEqual(formEvents(evs), []);
  assert.deepEqual(tr.summary().form.faults, []);
});

// --- the user's own recordings (private) ---------------------------------------------------------------------------
// Every recording of the user's (frames {t, image, world}: squats, lunges, jumping jacks, skips, push-ups, holds, a
// boxing guard, and the standing, resting, walking to the camera and pauses between), each of the four movements
// named over the whole of it, through the movement tracker with its landmarks as the page runs it. None of them but
// the user's Bharatanatyam is these movements, so a fault told is one told wrongly: nothing is told. The reach is
// judged on a few moments only (arms raised past level, trunk upright: the top of a squat with the arms held out
// ahead, a jumping jack's arms on their way up), never long. Named the Bharatanatyam, a plank from the side, its hands
// below the picture, is asked to step back (form_unseen, a prompt and no verdict: a straight hip reads standing),
// as the other movements whose checks need the arms are.
const liveDir = path.join(DATA, 'posedata', 'results', 'live');
const recordings = fs.existsSync(liveDir)
  ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')).map(f => path.join(liveDir, f)) : [];
const doing = (rec, key) => (rec.movements ?? []).some(m => m.movement === key);
/** A recording through a tracker of `key` as the page runs it: {tr, evs (each with `at`, ms from its first frame)}. */
function trackRec(rec, key) {
  const aspect = rec.width / rec.height, t0 = rec.frames[0].t;
  const movement = movementOf(key) ?? { key, display: key, kind: key === FOLD ? 'flow' : 'dance', track: 'moving' };
  const tr = new MovementTracker({ movement }), evs = [];
  for (const fr of rec.frames) {
    const lm = fr.world && fr.image ? { world: obj(fr.world), image: obj(fr.image), aspect } : null;
    const out = lm ? tr.update(features(lm.world, lm.image, aspect), fr.t, lm) : tr.lost(fr.t);
    evs.push(...out.map(e => ({ ...e, at: fr.t - t0 })));
  }
  return { tr, evs };
}
const verdicts = evs => evs.filter(e => e.type === 'form_fault' || e.type === 'form_fix');
test('the user\'s recordings, each of the four movements named over the whole: nothing told (the Bharatanatyam: but '
  + 'over the user\'s own of it)', { skip: !recordings.length && 'no recording here' }, () => {
  for (const file of recordings) {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of KEYS) {
      if (key === BHARAT && doing(rec, key)) continue;
      const { tr, evs } = trackRec(rec, key), what = `${path.basename(file)} as ${key}`;
      assert.deepEqual(key === BHARAT ? verdicts(evs) : formEvents(evs), [], what);
      if (key === FOLD || key === BHARAT) assert.deepEqual(tr.summary().form.faults, [], what);
      else assert.equal(tr.current().form, null, what);
    }
  }
});

// Private recordings are discovered by their named movement; identities and workout notes stay in .data/.
const bharatRecs = recordings.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))).filter(rec => doing(rec, BHARAT));
test('the user\'s Bharatanatyam: the hand raised by the face told on its side, nothing else', {
  skip: !(bharatRecs.length && movementOf(BHARAT)) && 'no recording of it here' }, () => {
  for (const rec of bharatRecs) {
    const { tr, evs } = trackRec(rec, BHARAT), told = evs.filter(e => e.type === 'form_fault');
    assert.ok(told.length >= 1, 'told');
    for (const e of told) {
      assert.ok(Object.values(RAISED).includes(e.fault), e.fault);
      assert.deepEqual([e.part, e.side], ['arm', e.fault === RAISED.L ? 'left' : 'right']);
      // The raw threshold is >45; the displayed whole-degree measurement rounds 45.1 to 45.
      assert.ok(Number(e.measured.match(/\d+/)[0]) >= 45, e.measured);
      // (what it rests on: its last faultMs of bad frames, a held gesture)
      assert.ok(e.seen && e.seen.to - e.seen.from >= 600, JSON.stringify(e.seen));
    }
    // Recordings may exercise either arm and may correct a fault before Stop. Every fault told must reach the
    // saved summary; fixed/not-fixed timing is covered by the synthetic cases above.
    for (const event of told) assert.ok(tr.summary().form.faults.some(f => f.fault === event.fault && f.told),
      JSON.stringify(tr.summary().form));
  }
});
