// The arm movements' guard rails (web/js/moveforms/arms.js): shoulder external rotation, the Y-to-W raise and the step
// touch with overhead arm swings. Public: the group's shape, and each measure, its side and the movement's shape on
// made-up landmarks. Private (.data/, skipped when not on this machine), each through the movement tracker with its
// landmarks, as the page runs it: the library's reference skeleton of the movement (at its own pace, twice it,
// mirrored, with MediaPipe-sized jitter) and MediaPipe on the library's footage of it, with no fault; the reference
// with each fault put in, caught by its own check only, on its side; the reference held still and paused; the
// references through a pinhole camera, turned and high or low (nothing told; a hop still caught); and every live
// recording of the user's (none of them of these movements) with the movement named over the whole of it: nothing
// judged of walking up to the camera, nothing judged bad without the body moving, nothing told (also over a drift
// nearer and further, and with pauses between sets of jumping jacks), and what each check did printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { boneParts } from '../web/js/formcheck.js';
import { faultParts } from '../web/js/retarget.js';
import ARMS from '../web/js/moveforms/arms.js';
import { MOVE_FORMS, MOVE_TUNING, MoveForm, bodyMetrics, checkProblems } from '../web/js/moveform.js';
import { MovementTracker } from '../web/js/moves.js';
import { skeletonFromNpz, skeletonLandmarks } from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const ASPECT = 16 / 9, S = 2.4;                      // S: metres from the picture's top to its bottom (as the build)
const KEYS = ['shoulder_external_rotation', 'y_to_w_raise', 'step_touch_arm_swings'];
const PARTS = boneParts().filter(p => faultParts().includes(p));
const SIDED = ['arm', 'elbow', 'knee', 'leg', 'foot', 'ankle'];          // formcheck.js / retarget.js SIDED
const checkOf = (key, id) => ARMS[key].find(c => c.id === id);

// --- the group ------------------------------------------------------------------------------------------------------
test('arms group: its three movements in MOVE_FORMS, each check of the shape, a part the page can show, a side for '
  + 'a one-sided part, judged only in the movement\'s shape', () => {
  assert.deepEqual(Object.keys(ARMS).sort(), [...KEYS].sort());
  assert.deepEqual(checkProblems(ARMS, PARTS), []);
  for (const key of KEYS) {
    assert.equal(MOVE_FORMS[key], ARMS[key], key);
    for (const c of ARMS[key]) {
      assert.equal(typeof c.side === 'function', SIDED.includes(c.part), `${key}/${c.id}: side for part ${c.part}`);
      assert.equal(typeof c.phase, 'function', `${key}/${c.id}: phase`);
      assert.ok(c.at === 'peak' || c.at === 'trough', `${key}/${c.id}: a cycle check (track rhythm)`);
    }
  }
});

// --- made-up landmarks ----------------------------------------------------------------------------------------------
const rad = d => (d * Math.PI) / 180;
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
/** A limb's direction from straight down, `out` deg out to the person's side `sx` (1 left, -1 right), `fwd` forward
 * (world: y down, x the person's left, forward -z). */
const limb = (sx, out, fwd = 0) => [sx * Math.sin(rad(out)), Math.cos(rad(out)) * Math.cos(rad(fwd)),
  -Math.cos(rad(out)) * Math.sin(rad(fwd))];
/** A made-up person facing the camera, standing (hips 0.3 m wide, shoulders 0.36, legs 0.9 m, trunk 0.5, upper arms
 * 0.3, forearms 0.27). Per side (`L` / `R` suffix, or both): `arm` the upper arm out from straight down, `armFwd`
 * forward (as `limb`); the forearm `turn` deg out from pointing straight ahead (level: the elbow bent to 90 deg at the
 * side), or `fore` [out, fwd] a direction as `limb`, or 'straight' (on from the upper arm: the default); `knee` the
 * knees forward (m), `feet` the ankles' extra spread (m). Image: an orthographic camera in front, the hips at 55% of
 * the picture's height. */
function person(o = {}) {
  const g = (k, s, d) => o[`${k}${s}`] ?? o[k] ?? d;
  const P = { 23: [0.15, 0, 0], 24: [-0.15, 0, 0], 11: [0.18, -0.5, 0], 12: [-0.18, -0.5, 0], 0: [0, -0.75, -0.1],
    7: [0.07, -0.73, 0], 8: [-0.07, -0.73, 0] };
  for (const [hip, kn, an, heel, toe, sx] of [[23, 25, 27, 29, 31, 1], [24, 26, 28, 30, 32, -1]]) {
    const spread = (sx * (o.feet ?? 0)) / 2;
    P[kn] = add(P[hip], [spread / 2, 0.44, -(o.knee ?? 0)]); P[an] = add(P[hip], [spread, 0.9, 0]);
    P[heel] = add(P[an], [0, 0.04, 0.05]); P[toe] = add(P[an], [0, 0.06, -0.15]);
  }
  for (const [s, sx, sh, el, wr, hands] of [['L', 1, 11, 13, 15, [17, 19, 21]], ['R', -1, 12, 14, 16, [18, 20, 22]]]) {
    const up = limb(sx, g('arm', s, 10), g('armFwd', s, 0));
    P[el] = add(P[sh], up, 0.3);
    const turn = g('turn', s, null), fore = g('fore', s, 'straight');
    const d = turn !== null ? [sx * Math.sin(rad(turn)), 0, -Math.cos(rad(turn))]
      : fore === 'straight' ? up : limb(sx, ...fore);
    P[wr] = add(P[el], d, 0.27);
    for (const i of hands) P[i] = P[wr];
  }
  for (const i of [1, 2, 3, 4, 5, 6, 9, 10]) P[i] = P[0];
  const world = [], image = [];
  for (let i = 0; i < 33; i++) {
    world.push({ x: P[i][0], y: P[i][1], z: P[i][2] });
    image.push({ x: 0.5 + P[i][0] / (S * ASPECT), y: 0.55 + P[i][1] / S, z: 0, visibility: 1 });
  }
  return { world, image, aspect: ASPECT };
}
/** A frame's metrics as a check sees them (MoveForm adds the floor: here the feet on it). */
const metricsOf = lm => ({ ...bodyMetrics(lm.world, lm.image, lm.aspect), feetLift: 0, airborne: false });
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} (want ${b})`);
const sideOf = (c, lm) => c.side(metricsOf(lm), lm);

test('shoulder external rotation on made-up landmarks: the forearm\'s turn, the lesser one\'s side, its shape', () => {
  const fa = checkOf('shoulder_external_rotation', 'forearm_not_out');
  const at = o => { const lm = person(o); return fa.value(metricsOf(lm), lm); };
  near(at({ turn: 0 }), 0, 0.01, 'straight ahead');
  near(at({ turn: 40 }), 40, 0.01, '40 out');
  near(at({ turn: -30 }), -30, 0.01, 'across the body');
  near(at({ turnL: 40, turnR: 5 }), 5, 0.01, 'the lesser');
  assert.equal(sideOf(fa, person({ turnL: 40, turnR: 5 })), 'R');
  assert.equal(sideOf(fa, person({ turnL: 0, turnR: 40 })), 'L');
  assert.equal(sideOf(fa, person({ turn: 0 })), null, 'both');
  // (the elbows' drift: the further upper arm)
  const eo = checkOf('shoulder_external_rotation', 'elbows_out');
  // (from the torso: the shoulder sits 3 cm outside the hip, so an arm 50 deg out from straight down reads 53.4)
  near(eo.value(metricsOf(person({ armL: 50, armR: 20, turn: 30 }))), 53.4, 0.1, 'the further elbow');
  assert.equal(eo.side(metricsOf(person({ armL: 50, armR: 20, turn: 30 }))), 'L');
  // the shape: standing, both elbows bent, the upper arms below level; not with an arm let down, raised, or the knees
  // bent
  const shape = o => { const lm = person(o); return fa.phase(metricsOf(lm), lm); };
  assert.equal(shape({ turn: 30 }), true);
  assert.equal(shape({ turnL: 30 }), false, 'the right arm hanging straight');
  assert.equal(shape({ turn: 30, armL: 80 }), false, 'an arm raised');
  assert.equal(shape({ turn: 30, knee: 0.25 }), false, 'knees bent');
  assert.equal(fa.phase({ ...metricsOf(person({ turn: 30 })), feetLift: NaN }), false, 'the floor not known');
  assert.match(fa.measured(5), /^forearm turned only 5 degrees out/);
  assert.match(fa.measured(-20), /not turning out/);
});

test('Y-to-W and step touch on made-up landmarks: each measure, its side, the movement\'s shape', () => {
  // the Y: the lower arm, and the arm further forward
  const y = checkOf('y_to_w_raise', 'short_of_y'), fwd = checkOf('y_to_w_raise', 'arms_forward');
  const Y = o => metricsOf(person({ armL: 140, armR: 140, ...o }));
  near(y.value(Y({ armR: 100 })), 103.4, 0.1, 'the lower arm');
  assert.equal(y.side(Y({ armR: 100 })), 'R');
  assert.equal(y.side(Y({ armL: 100, armR: 100 })), null);
  assert.equal(y.bad(50), false, 'no Y before the W (the highest is the W\'s own): neither');
  assert.equal(y.ok(50), false);
  near(fwd.value(Y()), 0, 0.01, 'out to the sides');
  near(fwd.value(Y({ armL: 0, armFwdL: 140 })), 90, 0.01, 'the left raised in front');
  assert.equal(fwd.side(Y({ armL: 0, armFwdL: 140 })), 'L');
  assert.equal(fwd.value(Y({ armR: 90 })), -1, 'not up in the Y: no reading');
  assert.deepEqual([fwd.bad(-1), fwd.ok(-1)], [false, false]);
  // the shape: both arms up (a Y), or a W (the elbows bent, the forearms out), standing; nothing else
  const phase = o => { const lm = person(o); return y.phase(metricsOf(lm), lm); };
  assert.equal(phase({ arm: 140 }), true, 'the Y');
  assert.equal(phase({ armL: 140, armR: 30 }), false, 'one arm raised is not a Y');
  assert.equal(phase({ arm: 25, fore: [150, 0] }), true, 'a W: the forearms up and out, the elbows at 55');
  assert.equal(phase({ arm: 25, fore: [-150, 0] }), false, 'the elbows bent, the hands across in front');
  assert.equal(phase({ arm: 10 }), false, 'the arms let down straight');
  assert.equal(phase({ arm: 25, fore: [150, 0], knee: 0.25 }), false, 'knees bent');
  assert.equal(fwd.phase, y.phase);
  // the step touch: the lower arm at the top; the swing (both arms up) and the feet's lift
  const oh = checkOf('step_touch_arm_swings', 'arms_not_overhead'), jump = checkOf('step_touch_arm_swings', 'jumping');
  const topLm = person({ armL: 95, armR: 140, feet: 0.3 }), top = metricsOf(topLm);
  assert.equal(oh.side(top), 'L');
  assert.equal(oh.phase(top), true);
  assert.equal(oh.phase(metricsOf(person({ armL: 20, armR: 140, feet: 0.3 }))), false, 'one arm raised');
  assert.equal(oh.phase(metricsOf(person({ armL: 95, armR: 140 }))), false, 'the feet not stepped apart');
  assert.equal(jump.value({ ...top, feetLift: 0.3 }), 0.3);
  assert.equal(jump.phase({ ...top, feetLift: 0.3 }, topLm), true);
  assert.equal(jump.phase({ ...top, feetLift: 1.2 }, topLm), false, 'too high for a jump');
  const apart = { ...topLm, world: topLm.world.map((p, i) => (i === 27 ? { ...p, z: p.z - 0.2 } : p)) };
  assert.equal(jump.phase({ ...top, feetLift: 0.3 }, apart), false, 'the feet apart in depth');
  assert.equal(jump.side, undefined, 'both feet');
});

// --- the library's references (private) ---------------------------------------------------------------------------
const libFile = path.join(DATA, 'moves', 'library.json');
const library = fs.existsSync(libFile) ? JSON.parse(fs.readFileSync(libFile, 'utf8')).movements : [];
const catalogFile = path.join(DATA, 'moves', 'catalog.json');
const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : null;
const movement = key => library.find(x => x.key === key);
/** The reference skeleton of a library movement ({fps, joints}), from its dump or its npz; null if neither is here. */
function skeletonOf(key) {
  const m = movement(key);
  if (!m) return null;
  const dump = path.join(DATA, 'moves', 'skel', `${m.id}.json`);
  if (fs.existsSync(dump)) return JSON.parse(fs.readFileSync(dump, 'utf8'));
  const npz = catalog && path.join(catalog.source, m.id, 'source', 'skeleton_motion.npz');
  return npz && fs.existsSync(npz) ? skeletonFromNpz(fs.readFileSync(npz)) : null;
}
/** MediaPipe (full model) on the library's footage of a movement: {aspect, frames: [{t, world, image}]}; null if not
 * here. */
function footageOf(key) {
  const m = movement(key), file = m && path.join(DATA, 'posedata', 'results', 'full', `${m.id}.json`);
  if (!file || !fs.existsSync(file)) return null;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')), t0 = rec.frames[0].t;
  return { aspect: rec.width / rec.height, frames: rec.frames.filter(f => f.world && f.image)
    .map(f => ({ t: f.t - t0, world: objs(f.world), image: objs(f.image) })) };
}
const objs = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));

const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
/** Mirrored: the person's left and right swapped (the movement done on the other side). */
function mirror(x) {
  const sw = Array.from({ length: 33 }, (_, i) => i);
  for (const [a, b] of PAIRS) { sw[a] = b; sw[b] = a; }
  return { ...x, world: sw.map(j => ({ ...x.world[j], x: -x.world[j].x })),
    image: sw.map(j => ({ ...x.image[j], x: 1 - x.image[j].x })) };
}
// MediaPipe's jitter: on the user's still stretches each landmark lies within 4-6 mm of its 9-frame median on 90% of
// frames, 2-3 cm on 1%. Here every landmark of every frame moves up to 1.5 cm each way, in the world and on screen
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const JITTER = 0.03;
const jittered = (x, j = JITTER) => ({ ...x,
  world: x.world.map(p => ({ ...p, x: p.x + j * rnd(), y: p.y + j * rnd(), z: p.z + j * rnd() })),
  image: x.image.map(p => ({ ...p, x: p.x + (j * rnd()) / (S * ASPECT), y: p.y + (j * rnd()) / S })) });

/** The part of a reference that repeats, played out and back: the shoulder rotation from where its hands start apart
 * (it holds them together before), the Y-to-W up to the end of its W (after it the arms start up again, half way: a
 * peak of half a Y, played back); the step touch whole. By the clip's own measures, so no clip's times are written
 * here. */
function partOf(key, frames) {
  const f = frames.map(x => features(x.world, x.image, x.aspect ?? ASPECT));
  if (key === 'shoulder_external_rotation') {
    // (from the last frame, before the widest, within a tenth of the spread's range of its narrowest)
    const spread = f.map(x => x.wristSpread), top = spread.indexOf(Math.max(...spread)), lo = Math.min(...spread);
    return frames.slice(spread.slice(0, top + 1).findLastIndex(v => v <= lo + 0.1 * (spread[top] - lo)));
  }
  if (key === 'y_to_w_raise') {
    const arm = f.map(x => x.armMax), low = Math.min(...arm);
    return frames.slice(0, arm.findLastIndex(v => v <= low + 5) + 1);
  }
  return frames;
}
/** Frames ({world, image}) played out and back `rounds` times at `speed` times `fps`, as {t, world, image}. */
function outAndBack(frames, { rounds = 5, speed = 1, fps = 30 } = {}) {
  const seq = [];
  for (let r = 0; r < rounds; r++) seq.push(...frames, ...[...frames].reverse());
  return seq.map((x, i) => ({ ...x, t: (i * 1000) / fps / speed }));
}
/** Frames ({t, world, image}; null world: nobody) through the movement tracker with their landmarks, as the page. The
 * events (`at`: the frame's time); the cycles each check judged ({id, t: the extreme, from: the turn before, at: when
 * judged, v, verdict, side, run: the run of movement's start}); and each frame's stillness (MovementTracker state(),
 * and whether its form is paused). */
function run(key, seq, { aspect = ASPECT } = {}) {
  const tr = new MovementTracker({ movement: movement(key) });
  const evs = [], judged = [], still = [];
  for (const x of seq) {
    if (!x.world) { evs.push(...tr.lost(x.t).map(e => ({ ...e, at: x.t }))); continue; }
    const lm = { world: x.world, image: x.image, aspect };
    evs.push(...tr.update(features(lm.world, lm.image, aspect), x.t, lm).map(e => ({ ...e, at: x.t })));
    still.push({ t: x.t, st: tr.state(), paused: tr.mf.paused(x.t) });
    const turn = tr.cycles.turn;
    for (const c of tr.mf.checks) {
      const s = tr.mf.s[c.id];
      if (turn && c.at === turn.kind && s.measuredT === x.t) {
        judged.push({ id: c.id, t: turn.t, from: turn.from, at: x.t, v: s.value, verdict: s.hist.at(-1),
          side: s.cycleSide, run: tr.mf.runStart });
      }
    }
  }
  return { tr, evs, judged, still };
}
const forms = evs => evs.filter(e => e.type.startsWith('form_'));
const told = evs => evs.filter(e => e.type === 'form_fault').map(e => [e.fault, e.part, e.side]);
const names = key => ARMS[key].map(c => c.name);

const REF = Object.fromEntries(KEYS.map(key => [key, skeletonOf(key)]));
const playRef = (key, skel, o = {}) => {
  const lm = skeletonLandmarks(skel).map(x => ({ ...x, aspect: ASPECT }));
  return outAndBack(partOf(key, lm), o);
};

for (const key of KEYS) {
  const skel = REF[key];
  test(`${key}: the reference passes every check on every cycle, at its own pace and twice it, mirrored, with jitter`,
    { skip: !skel && 'no reference skeleton here' }, () => {
      const cases = [];
      for (const speed of [1, 2]) for (const mirrored of [false, true]) cases.push({ speed, mirrored, jitter: false });
      cases.push({ speed: 1, mirrored: false, jitter: true }, { speed: 2, mirrored: true, jitter: true });
      for (const { speed, mirrored, jitter } of cases) {
        const what = `${speed}x${mirrored ? ' mirrored' : ''}${jitter ? ' jitter' : ''}`;
        let seq = playRef(key, skel, { speed });
        if (mirrored) seq = seq.map(mirror);
        if (jitter) seq = seq.map(x => jittered(x));
        const { tr, evs, judged } = run(key, seq);
        assert.deepEqual(forms(evs), [], what);
        assert.deepEqual(tr.summary().form, { checked: names(key), faults: [] }, what);
        for (const c of ARMS[key]) {
          // (each check judged on the cycles after the warm-up, every one fine)
          const mine = judged.filter(x => x.id === c.id);
          assert.ok(mine.length >= 3, `${what} ${c.id}: ${mine.length} cycles judged`);
          assert.deepEqual(mine.filter(x => x.verdict !== 'ok'), [], `${what} ${c.id}`);
        }
        // (the floor known with the arms overhead: the feet judged on every swing the arms are)
        if (key === 'step_touch_arm_swings') {
          const n = id => judged.filter(x => x.id === id).length;
          assert.equal(n('jumping'), n('arms_not_overhead'), `${what}: swings judged for the feet`);
        }
      }
    });

  const rec = footageOf(key);
  test(`${key}: MediaPipe on the library's footage of it passes every check, at its own pace and twice it`,
    { skip: !rec && 'no footage here' }, () => {
      for (const speed of [1, 2]) {
        const { tr, evs, judged } = run(key, outAndBack(partOf(key, rec.frames.map(x => ({ ...x,
          aspect: rec.aspect }))), { speed }), { aspect: rec.aspect });
        assert.deepEqual(forms(evs), [], `${speed}x`);
        assert.deepEqual(tr.summary().form, { checked: names(key), faults: [] }, `${speed}x`);
        for (const c of ARMS[key]) assert.ok(judged.filter(x => x.id === c.id).length >= 3, `${speed}x ${c.id}`);
      }
    });
}

// --- faults put in (private) ---------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** v turned by `deg` about the unit axis k (Rodrigues). */
function rot(v, k, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)), d = dot(k, v), x = cross(k, v);
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c));
}
const UP = [0, 1, 0];                                  // SMPL joints: y up
const BOTH = ['left', 'right'];
/** A skeleton with `edit(joints, i, left)` applied to a copy of each frame's joints (`left`: the hips' line, level). */
function edited(skel, edit) {
  const J = {};
  for (const [k, v] of Object.entries(skel.joints)) J[k] = v.map(p => [...p]);
  for (let i = 0; i < J.pelvis.length; i++) {
    const l = sub(J.left_hip[i], J.right_hip[i]);
    edit(J, i, norm([l[0], 0, l[2]]));
  }
  return { fps: skel.fps, joints: J };
}
/** Side `s`'s elbow and wrist turned `deg` about the unit `axis` through its shoulder (`at` 'elbow': the wrist alone,
 * about the elbow). */
const turnArm = (J, i, s, axis, deg, at = 'shoulder') => {
  const o = J[`${s}_${at}`][i], move = at === 'shoulder' ? ['elbow', 'wrist'] : ['wrist'];
  for (const p of move) J[`${s}_${p}`][i] = rot(sub(J[`${s}_${p}`][i], o), axis, deg).map((v, k) => v + o[k]);
};
/** The upper arms turned `deg` out from the sides (as tests/moveform.test.mjs elbowsOut). */
const elbowsOut = (skel, deg, sides = BOTH) => edited(skel, (J, i, left) => {
  for (const s of sides) turnArm(J, i, s, norm(cross([0, -1, 0], s === 'left' ? left : left.map(v => -v))), deg);
});
/** The forearm's turn out to its side (the outward part over its length, as arms.js forearmsOut). */
const forearmOut = (J, i, s, left) => {
  const d = sub(J[`${s}_wrist`][i], J[`${s}_elbow`][i]), o = s === 'left' ? left : left.map(v => -v);
  return Math.asin(Math.max(-1, Math.min(1, dot(d, o) / Math.hypot(...d)))) / rad(1);
};
/** The forearms kept from turning more than `cap` deg out: turned back about the vertical through the elbow. */
const forearmsHeld = (skel, cap, sides = BOTH) => edited(skel, (J, i, left) => {
  for (const s of sides) {
    const a = forearmOut(J, i, s, left);
    if (a <= cap) continue;
    const before = J[`${s}_wrist`][i];
    turnArm(J, i, s, UP, a - cap, 'elbow');
    if (Math.abs(forearmOut(J, i, s, left) - cap) > 1) {     // (the other way round)
      J[`${s}_wrist`][i] = before; turnArm(J, i, s, UP, cap - a, 'elbow');
    }
  }
});
/** Each upper arm's rise from straight down scaled by `k` (a smaller raise, at the same time), the elbow kept. */
const armsScaled = (skel, k, sides = BOTH) => edited(skel, (J, i) => {
  for (const s of sides) {
    const u = sub(J[`${s}_elbow`][i], J[`${s}_shoulder`][i]), ax = cross(u, [0, -1, 0]);
    if (Math.hypot(...ax) < 1e-9) continue;
    const fromDown = Math.acos(Math.max(-1, Math.min(1, -u[1] / Math.hypot(...u)))) / rad(1);
    turnArm(J, i, s, norm(ax), (1 - k) * fromDown);
  }
});
/** Each upper arm raised past `cap` deg from straight down lowered to it, in its own plane. */
const armsHeld = (skel, cap, sides = BOTH) => edited(skel, (J, i) => {
  for (const s of sides) {
    const u = sub(J[`${s}_elbow`][i], J[`${s}_shoulder`][i]), ax = cross(u, [0, -1, 0]);
    const fromDown = Math.acos(Math.max(-1, Math.min(1, -u[1] / Math.hypot(...u)))) / rad(1);
    if (fromDown > cap && Math.hypot(...ax) > 1e-9) turnArm(J, i, s, norm(ax), fromDown - cap);
  }
});
/** Each arm raised over 90 deg from straight down turned `deg` forward about the vertical through its shoulder. */
const armsForward = (skel, deg, sides = BOTH) => edited(skel, (J, i, left) => {
  const fwd = cross(UP, left).map(v => -v);
  for (const s of sides) {
    const u = sub(J[`${s}_elbow`][i], J[`${s}_shoulder`][i]);
    if (Math.acos(Math.max(-1, Math.min(1, -u[1] / Math.hypot(...u)))) / rad(1) < 90) continue;
    const ahead = d => dot(rot(u, UP, d), fwd);
    turnArm(J, i, s, UP, ahead(deg) > ahead(-deg) ? deg : -deg);
  }
});
/** The elbows straightened: the wrist on along the upper arm, the forearm's length kept. */
const elbowsStraight = (skel, sides = BOTH) => edited(skel, (J, i) => {
  for (const s of sides) {
    const sh = J[`${s}_shoulder`][i], el = J[`${s}_elbow`][i], fl = Math.hypot(...sub(J[`${s}_wrist`][i], el));
    J[`${s}_wrist`][i] = el.map((v, k) => v + fl * norm(sub(el, sh))[k]);
  }
});
/** The whole body lifted off the floor `h` m twice a swing of the step touch (a hop of 0.3 s every 0.6 s). */
const hopping = (skel, h) => edited(skel, (J, i) => {
  const t = i / skel.fps, y = h * Math.max(0, 1 - (((t % 0.6) - 0.3) / 0.15) ** 2);
  for (const k of Object.keys(J)) J[k][i][1] += y;
});

/** The faults put into each reference: [what, edit, the faults told ([id, part, side]) as the user's own side, and
 * (optional) the checks found fine at the end, by name (else all the others)]. A fault on one side is told on it, and
 * mirrored on the other; nothing else is told. */
const FAULTS = {
  shoulder_external_rotation: [
    ['elbows turned 20 deg out', s => elbowsOut(s, 20), [['elbows_out', 'elbow', null]]],
    ['the left elbow 30 deg out', s => elbowsOut(s, 30, ['left']), [['elbows_out', 'elbow', 'left']]],
    ['forearms not turning past straight ahead', s => forearmsHeld(s, 0), [['forearm_not_out', 'arm', null]]],
    ['the left forearm held at 5 deg', s => forearmsHeld(s, 5, ['left']), [['forearm_not_out', 'arm', 'left']]],
    ['the right forearm held at 20 deg (a small turn: passes)', s => forearmsHeld(s, 20, ['right']), []],
  ],
  y_to_w_raise: [
    ['arms raised three quarters of the way', s => armsScaled(s, 0.75), [['short_of_y', 'arm', null]]],
    ['the left arm three quarters', s => armsScaled(s, 0.75, ['left']), [['short_of_y', 'arm', 'left']]],
    ['arms held at 125 deg (passes)', s => armsHeld(s, 125), []],
    ['arms turned 50 deg forward', s => armsForward(s, 50), [['arms_forward', 'arm', null]]],
    ['the left arm 60 deg forward', s => armsForward(s, 60, ['left']), [['arms_forward', 'arm', 'left']]],
    ['arms turned 30 deg forward (passes)', s => armsForward(s, 30), []],
    // (no check of the W: arms lowered straight look like arms at rest; web/js/moveforms/arms.js says why)
    // ...and with no W the Ys are not judged either (arms let down straight look the same): nothing checked
    ['elbows straight through the W (not checked)', s => elbowsStraight(s), [], []],
  ],
  step_touch_arm_swings: [
    ['arms swung seven tenths of the way', s => armsScaled(s, 0.7), [['arms_not_overhead', 'arm', null]]],
    ['the left arm seven tenths', s => armsScaled(s, 0.7, ['left']), [['arms_not_overhead', 'arm', 'left']]],
    ['hopping 12 cm off the floor', s => hopping(s, 0.12), [['jumping', 'feet', null]]],
    ['hopping 4 cm (passes: too close to the jitter)', s => hopping(s, 0.04), []],
  ],
};
const otherSide = f => f.map(([id, part, side]) => [id, part, side === 'left' ? 'right' : side === 'right' ? 'left'
  : side]);

for (const key of KEYS) {
  const skel = REF[key];
  test(`${key}: each fault put into the reference is caught by its own check alone, on its side, mirrored too`,
    { skip: !skel && 'no reference skeleton here' }, () => {
      for (const [what, edit, want, fine] of FAULTS[key]) {
        const faulty = edit(skel);
        for (const mirrored of [false, true]) {
          let seq = playRef(key, faulty);
          if (mirrored) seq = seq.map(mirror);
          const { tr, evs } = run(key, seq);
          const label = `${what}${mirrored ? ' mirrored' : ''}`;
          assert.deepEqual(told(evs), mirrored ? otherSide(want) : want, label);
          assert.deepEqual(evs.filter(e => e.type === 'form_fix'), [], `${label}: no fix`);
          // (the other checks: measured and fine)
          const others = fine ?? ARMS[key].filter(c => !want.some(([id]) => id === c.id)).map(c => c.name);
          assert.deepEqual(tr.summary().form.checked, others, label);
          for (const e of evs.filter(x => x.type === 'form_fault')) {
            const c = checkOf(key, e.fault);
            assert.deepEqual([typeof e.measured, e.target, e.cue], ['string', c.target, c.cue], label);
          }
        }
      }
    });
}

test('a fault put in, then the reference: told, then fixed', { skip: KEYS.some(k => !REF[k]) && 'no references here' },
  () => {
    const cases = { shoulder_external_rotation: s => forearmsHeld(s, 0), y_to_w_raise: s => armsScaled(s, 0.75),
      step_touch_arm_swings: s => hopping(s, 0.12) };
    for (const [key, edit] of Object.entries(cases)) {
      const bad = playRef(key, edit(REF[key]), { rounds: 4 }), good = playRef(key, REF[key], { rounds: 4 });
      const end = bad.at(-1).t + 1000 / 30;
      const { evs } = run(key, [...bad, ...good.map(x => ({ ...x, t: x.t + end }))]);
      assert.deepEqual(forms(evs).map(e => e.type), ['form_fault', 'form_fix'], key);
    }
  });

// --- standing and pausing (private: the references' own poses) ----------------------------------------------------
test('standing still in the movement\'s own pose, and a pause, judge nothing', {
  skip: KEYS.some(k => !REF[k]) && 'no references here' }, () => {
  for (const key of KEYS) {
    const lm = partOf(key, skeletonLandmarks(REF[key]).map(x => ({ ...x, aspect: ASPECT })));
    // its first pose (the hands together, the Y, the arms up) held 20 s, with jitter: no cycle, nothing listed wrong
    const held = Array.from({ length: 600 }, (_, i) => ({ ...jittered(lm[0]), t: (i * 1000) / 30 }));
    const still = run(key, held);
    assert.deepEqual([forms(still.evs), still.judged], [[], []], `${key}: standing`);
    const st = still.tr.current().form;
    assert.deepEqual([st.open, st.pending], [[], []], key);
    // the reference out and back, on to its far end, held there 15 s with MediaPipe's usual jitter (4-6 mm: a pause,
    // longer than the longest a rhythm's hold at its far end may last, MOVE_TUNING.PAUSE_MAX_MS, and than the
    // slowest reference's period played out and back, the Y-to-W's 10.9 s), and on: the pause seen as one, no cycle
    // judged of it, nothing told
    const DT = 1000 / 30, back = part => [...part].reverse(), HOLD = Math.ceil(15000 / DT);
    assert.ok(HOLD * DT > MOVE_TUNING.PAUSE_MAX_MS + 2000);
    const frames = [...outAndBack(lm, { rounds: 2 }), ...lm];
    const from = frames.length;
    frames.push(...Array.from({ length: HOLD }, () => jittered(lm.at(-1), 0.01)), ...back(lm), ...outAndBack(lm));
    const seq = frames.map((x, i) => ({ ...x, t: i * DT }));
    const paused = run(key, seq), p0 = from * DT, p1 = (from + HOLD) * DT;
    assert.deepEqual(forms(paused.evs), [], `${key}: paused`);
    assert.ok(paused.still.some(x => x.t > p0 && x.t < p1 && x.paused), `${key}: a pause`);
    assert.deepEqual(paused.judged.filter(x => x.t > p0 + 1000 && x.t <= p1), [], `${key}: judged in the pause`);
    assert.ok(paused.judged.some(x => x.t > p1 + 3000), `${key}: judged again after it`);
  }
});

// --- a real camera (private: the references) -----------------------------------------------------------------------
// The references above are seen by an orthographic camera straight in front. A real one is a pinhole a few metres
// away, a little above or below the hips, the person not always square to it: a step toward it moves the feet down the
// picture as a jump moves them up. A reviewer's sweep found "both feet off the floor" told every few swings of the
// step touch, which never leaves the floor, turned 20-45 deg to such a camera. Here: each reference turned -45 to 45
// deg, the camera 0.5-1.5 m up and pitched to the hips (or level), 2.8 m away, 70 deg wide.
const BODY = { L: 'left_', R: 'right_' };
/** The skeleton's frames as MediaPipe would give them from a pinhole camera: `h` m above the floor (the skeleton's
 * lowest point), the person `D` m away and turned `yaw` deg (positive: to their own left), the camera pitched to look
 * at `aimY` m up at that distance (`level`: its world landmarks level all the same), `hfov` deg wide. World landmarks
 * in the camera's axes (x right in the picture, y down, z away), around the hips. `lift(t)`: the whole body raised
 * that many metres at t s (a hop); `drift(t)`: moved that far away from the camera. */
function pinhole(skel, { yaw = 0, h = 1.0, D = 2.8, aimY = 0.9, hfov = 70, level = false, lift = () => 0,
  drift = () => 0 } = {}) {
  const J = skel.joints, n = J.pelvis.length, first = Math.max(1, Math.min(n, Math.round(skel.fps)));
  let lx = 0, lz = 0;
  for (let i = 0; i < first; i++) {
    lx += J.left_shoulder[i][0] - J.right_shoulder[i][0]; lz += J.left_shoulder[i][2] - J.right_shoulder[i][2];
  }
  const ln = Math.hypot(lx, lz) || 1, L = [lx / ln, 0, lz / ln], F = [-L[2], 0, L[0]], o = J.pelvis[0];
  const MAP = { 0: 'head', 7: 'head', 8: 'head', 11: 'shoulder', 12: 'shoulder', 13: 'elbow', 14: 'elbow', 15: 'wrist',
    16: 'wrist', 23: 'hip', 24: 'hip', 25: 'knee', 26: 'knee', 27: 'ankle', 28: 'ankle', 29: 'ankle', 30: 'ankle',
    31: 'foot', 32: 'foot' };
  const sideOf = i => (i === 0 ? '' : [7, 11, 13, 15, 23, 25, 27, 29, 31].includes(i) ? BODY.L : BODY.R);
  const point = (i, k) => {
    const name = MAP[i] ? `${sideOf(i)}${MAP[i]}` : 'head', p = J[name] ? J[name][k] : J.head[k];
    const d = sub(p, o), q = [dot(d, L), d[1], dot(d, F)];
    if (i === 0) q[2] += 0.1;                                          // (the nose before the head)
    if (i === 7 || i === 8) q[0] += i === 7 ? 0.075 : -0.075;          // (the ears either side)
    if (i === 29 || i === 30) q[2] -= 0.05;                            // (the heels behind the ankles)
    return q;
  };
  const pts = Array.from({ length: n }, (_, k) => Array.from({ length: 33 }, (_, i) => point(i, k)));
  const floor = Math.min(...pts.flatMap(f => f.map(p => p[1])));
  const f = 0.5 / Math.tan(rad(hfov) / 2), c = Math.cos(rad(yaw)), sn = Math.sin(rad(yaw));
  const pitch = Math.atan2(h - aimY, D), pc = Math.cos(pitch), ps = Math.sin(pitch);
  return pts.map((frame, k) => {
    const t = (k * 1000) / skel.fps;
    const cam = frame.map(([x, y, z]) => {
      const X = x * c + z * sn, zr = -x * sn + z * c;
      const Y = h - (y - floor + lift(t / 1000)), Z = D + drift(t / 1000) - zr;
      return { level: [X, Y, Z], pitched: [X, Y * pc - Z * ps, Y * ps + Z * pc] };
    });
    const image = cam.map(({ pitched: [X, Y, Z] }) => ({ x: 0.5 + (f * X) / Z, y: 0.5 + (f * ASPECT * Y) / Z, z: 0,
      visibility: 1 }));
    const w = cam.map(q => (level ? q.level : q.pitched)), hip = w[23].map((v, i) => (v + w[24][i]) / 2);
    return { t, image, aspect: ASPECT, world: w.map(p => ({ x: p[0] - hip[0], y: p[1] - hip[1], z: p[2] - hip[2] })) };
  });
}
const CAMERAS = [];
for (const yaw of [-45, -30, -20, 0, 20, 30, 45]) for (const h of [0.5, 1.0, 1.5]) CAMERAS.push({ yaw, h });

test('the references through a real camera, turned and from any height: nothing told', {
  skip: KEYS.some(k => !REF[k]) && 'no references here' }, () => {
  for (const key of KEYS) {
    // (the step touch at every angle and height, pitched and level; the two done standing still at fewer)
    const cams = key === 'step_touch_arm_swings' ? [...CAMERAS, ...CAMERAS.map(x => ({ ...x, level: true }))]
      : CAMERAS.filter(x => [-45, 0, 30].includes(x.yaw) && x.h !== 0.5);
    for (const cam of cams) {
      const { evs, judged } = run(key, outAndBack(partOf(key, pinhole(REF[key], cam))));
      assert.deepEqual(told(evs), [], `${key} ${JSON.stringify(cam)}`);
      assert.ok(judged.length > 0, `${key} ${JSON.stringify(cam)}: judged`);
    }
  }
});

test('step touch through a real camera: a 12 cm hop is caught facing it, high or low', {
  skip: !REF.step_touch_arm_swings && 'no reference skeleton here' }, () => {
  const hop = t => 0.12 * Math.max(0, 1 - (((t % 0.6) - 0.3) / 0.15) ** 2);       // (twice a swing, as hopping())
  for (const h of [1.0, 1.5]) {
    const { evs } = run('step_touch_arm_swings', outAndBack(pinhole(REF.step_touch_arm_swings, { h, lift: hop })));
    assert.deepEqual(told(evs), [['jumping', 'feet', null]], `camera ${h} m up`);
  }
});

test('step touch through a real camera, drifting 0.2 m nearer and further: nothing told', {
  skip: !REF.step_touch_arm_swings && 'no reference skeleton here' },
() => {
  const skel = REF.step_touch_arm_swings, len = skel.joints.pelvis.length / skel.fps;
  for (const h of [1.0, 1.5]) {
    const drift = t => 0.2 * Math.sin((2 * Math.PI * t) / len);
    const { evs } = run('step_touch_arm_swings', outAndBack(pinhole(skel, { h, drift })));
    assert.deepEqual(told(evs), [], `camera ${h} m up`);
  }
});

// --- the user's recordings (private) -------------------------------------------------------------------------------
// Every live recording, with each movement named over the whole of it, as the page would follow it; none is of these
// movements. Walking up to the camera (the hand labels' 'close': .data/moves/live_labels.json) is never judged, nor is
// a cycle judged bad unless the body moved over it (the tracker's stillness measure), and nothing is told. Save one
// thing, for now: the step touch's faults on the user's jumping jacks, the step touch done with a jump (its reference
// is a stepped jumping jack: the feet out with the arms up, together with them down), where "both feet off the floor"
// and "arms not overhead" are what the jacks did (0.20-0.21 body lengths up; the arms to 97-106 deg). They came of a
// set of two or three jacks and the next, 9-10 s apart, the user standing still 5-7 s between; the pause rule's period
// of the turns, bounded by the rhythm's own (moveform.js pauseMs), makes that standing a pause, so the two sets'
// cycles never count together, and the test below checks nothing is told. What each check did is printed, by label.
const liveDir = path.join(DATA, 'posedata', 'results', 'live');
const liveFiles = fs.existsSync(liveDir) ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')).sort()
  .map(f => path.join(liveDir, f)) : [];
const labelsFile = path.join(DATA, 'moves', 'live_labels.json');
const LABELS = fs.existsSync(labelsFile) ? JSON.parse(fs.readFileSync(labelsFile, 'utf8')).labels : {};
const noRecordings = key => (!liveFiles.length || !movement(key)) && 'no recordings here';
/** Each recording not of the movement, with it named over the whole: its number, the run's events, cycles judged
 * and stillness, its frames' metrics with the floor ({t, m}), its hand label at a time, and each fault told with the
 * cycles whose verdicts made it (of its run of movement, within the verdicts' time). */
const replays = new Map();
function recordings(key) {
  if (replays.has(key)) return replays.get(key);
  const keep = Math.max(MOVE_TUNING.VERDICT_MIN_MS, MOVE_TUNING.VERDICT_PERIODS * 2000
    * (movement(key).rhythm.minPeriodS ?? 0));
  const out = [];
  for (const [n, file] of liveFiles.entries()) {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (rec.movements?.some(m => m.movement === key)) continue;              // (a recording of it: not here)
    const aspect = rec.width / rec.height, t0 = rec.frames[0].t, labels = LABELS[path.basename(file, '.json')] ?? [];
    const labelAt = ms => labels.find(x => (ms - t0) / 1000 >= x[0] && (ms - t0) / 1000 < x[1])?.[2] ?? 'unlabelled';
    const seq = rec.frames.map(f => ({ t: f.t, world: f.world && f.image ? objs(f.world) : null,
      image: f.image && objs(f.image) }));
    const { evs, judged, still } = run(key, seq, { aspect });
    const floor = new MoveForm({ key: 'floor', forms: { floor: [ARMS[key][0]] } });
    const metrics = seq.filter(x => x.world).map(x => ({ t: x.t,
      m: floor.withFloor(bodyMetrics(x.world, x.image, aspect), x.t) }));
    const faults = evs.filter(e => e.type === 'form_fault').map(e => ({ e, behind: judged.filter(x => x.id === e.fault
      && x.at <= e.at && x.at > e.at - keep && x.run === judged.findLast(y => y.at <= e.at)?.run).slice(-3) }));
    out.push({ n: n + 1, evs, judged, still, metrics, labelAt, faults });
  }
  replays.set(key, out);
  return out;
}
/** A cycle that was a jumping jack, by the frames of its half cycle: the feet jumped out (the stance from under 0.4 leg
 * lengths to over 0.8) and both left the floor (feetLift AIRBORNE or more). */
const jack = (metrics, x) => {
  const ms = metrics.filter(f => f.t >= (x.from ?? x.t) - 300 && f.t <= x.t + 300).map(f => f.m);
  return ms.some(m => m.stanceWidth < 0.4) && ms.some(m => m.stanceWidth > 0.8)
    && ms.some(m => m.feetLift >= MOVE_TUNING.AIRBORNE);
};

for (const key of KEYS) {
  test(`${key} named over the user's recordings: nothing judged walking up to the camera, nothing bad standing still, `
    + 'nothing told', { skip: noRecordings(key) }, t => {
    const tally = {};
    for (const { n, judged, still, metrics, labelAt, faults } of recordings(key)) {
      for (const x of judged) {
        const k = `${x.id} ${labelAt(x.t)}`;
        tally[k] ??= { judged: 0, bad: 0 };
        tally[k].judged += 1; if (x.verdict === 'bad') tally[k].bad += 1;
        assert.notEqual(labelAt(x.t), 'close', `recording ${n}: ${x.id} judged walking up to the camera`);
        if (x.verdict === 'bad') {
          const over = still.filter(s => s.t >= (x.from ?? x.t) && s.t <= x.t);
          assert.ok(over.some(s => s.st !== 'still'), `recording ${n}: ${x.id} bad without moving`);
        }
      }
      for (const { e, behind } of faults) {
        const c = checkOf(key, e.fault);
        assert.equal(e.part, c.part);
        assert.ok(c.side ? [null, 'left', 'right'].includes(e.side) : e.side === null, `${e.fault}: ${e.side}`);
        const what = `recording ${n}: ${e.fault}${e.side ? ` (${e.side})` : ''}, "${e.measured}", from cycles of: `
          + behind.map(x => `${labelAt(x.t)}${jack(metrics, x) ? ' (a jack)' : ''}${x.verdict === 'bad' ? ' (bad)'
            : ''}`).join(', ');
        t.diagnostic(`${key}: told ${what}`);
        // (nothing told, but the step touch's faults on jumping jacks: above)
        const jacks = behind.filter(x => x.verdict === 'bad').every(x => jack(metrics, x));
        assert.ok(key === 'step_touch_arm_swings' && jacks, `told ${what}`);
      }
    }
    t.diagnostic(`${key}: cycles judged (bad) by hand label: ${Object.entries(tally).sort()
      .map(([k, v]) => `${k} ${v.judged} (${v.bad})`).join('; ') || 'none'}`);
  });
}
test('step touch named over the user\'s recordings: nothing told, jumping jacks either', {
  skip: noRecordings('step_touch_arm_swings') },
() => {
  for (const { n, faults } of recordings('step_touch_arm_swings')) {
    assert.deepEqual(faults.map(f => f.e.fault), [], `recording ${n}`);
  }
});
