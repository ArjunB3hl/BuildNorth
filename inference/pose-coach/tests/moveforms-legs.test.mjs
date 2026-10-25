// The leg movements' guard rails (web/js/moveforms/legs.js): side_kick_knee_raise, standing_side_crunch,
// wall_side_leg_raise and boxing_cardio_combo. The shape of every check and what each one's phase lets through, on
// made-up MediaPipe-like landmarks (a person built from its angles); then, private (.data/, skipped when not on this
// machine), each movement one by one through the movement tracker with its landmarks, as the page runs it: its
// reference skeleton (its own pace, twice it and half, mirrored, MediaPipe-sized jitter) tells nothing; each fault put
// into it on purpose is caught by its own check alone, on the right side, a milder one by none, and its fix is
// noticed; MediaPipe on the library's footage of it tells nothing; and the user's live recordings, with the movement
// named over the whole of each, tell nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { boneParts } from '../web/js/formcheck.js';
import { faultParts } from '../web/js/retarget.js';
import { MOVE_FORMS, MOVE_FORM_GROUPS, bodyMetrics, checkProblems } from '../web/js/moveform.js';
import LEGS from '../web/js/moveforms/legs.js';
import { MovementTracker } from '../web/js/moves.js';
import { skeletonFromNpz, skeletonLandmarks } from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const ASPECT = 16 / 9, S = 2.4;                        // S: metres from the picture's top to its bottom
const KEYS = ['side_kick_knee_raise', 'standing_side_crunch', 'wall_side_leg_raise', 'boxing_cardio_combo'];
const PARTS = boneParts().filter(p => faultParts().includes(p));
const SIDED = ['arm', 'elbow', 'knee', 'leg', 'foot', 'ankle'];
const checkOf = (key, id) => LEGS[key].find(c => c.id === id);

// --- vectors -------------------------------------------------------------------------------------------------------
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossP = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const rad = d => (d * Math.PI) / 180;
const deg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / Math.hypot(...a) / Math.hypot(...b)))) / rad(1);
/** v turned by `d` deg about the unit axis k (Rodrigues). */
function rot(v, k, d) {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d)), kv = dot(k, v), x = crossP(k, v);
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * kv * (1 - c));
}

// --- made-up landmarks (as tests/moveform.test.mjs builds a person) ------------------------------------------------
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
/** A limb's direction from straight down (world, y down; x the person's left, -z forward), `out` deg out to the
 * side `sx` (1 left, -1 right) and `fwd` deg forward. */
const limb = (sx, out, fwd = 0) => [sx * Math.sin(rad(out)), Math.cos(rad(out)) * Math.cos(rad(fwd)),
  -Math.cos(rad(out)) * Math.sin(rad(fwd))];
/** A person facing the camera (hips 0.3 m wide, thighs and shins 0.45 m, trunk 0.5 m, arms hanging), per side (L, R):
 * `thigh` forward and `legOut` out to the side (deg from straight down), `knee` bent by (the shin folding back); the
 * trunk leant `side` deg toward the person's left; `feet` the ankles' extra spread (m). */
function body(o = {}) {
  const g = (k, s) => o[`${k}${s}`] ?? o[k] ?? 0;
  const P = { 23: [0.15, 0, 0], 24: [-0.15, 0, 0] };
  for (const [s, sx, hip, kn, an, heel, toe] of [['L', 1, 23, 25, 27, 29, 31], ['R', -1, 24, 26, 28, 30, 32]]) {
    const th = limb(sx, g('legOut', s), g('thigh', s));
    P[kn] = add(P[hip], th, 0.45);
    P[an] = add(add(P[kn], rot(th, [1, 0, 0], g('knee', s)), 0.45), [sx * (o.feet ?? 0) / 2, 0, 0]);
    P[heel] = add(P[an], [0, 0.04, 0.05]); P[toe] = add(P[an], [0, 0.06, -0.15]);
  }
  const sd = rad(o.side ?? 0), u = [Math.sin(sd), -Math.cos(sd), 0], e = [Math.cos(sd), Math.sin(sd), 0];
  const sm = add([0, 0, 0], u, 0.5);
  P[11] = add(sm, e, 0.15); P[12] = add(sm, e, -0.15);
  for (const [sh, el, wr, hand] of [[11, 13, 15, [17, 19, 21]], [12, 14, 16, [18, 20, 22]]]) {
    P[el] = add(P[sh], u, -0.3); P[wr] = add(P[el], u, -0.27);
    for (const i of hand) P[i] = P[wr];
  }
  P[0] = add(add(sm, u, 0.25), [0, 0, -0.1]); P[7] = add(P[0], e, 0.07); P[8] = add(P[0], e, -0.07);
  return P;
}
/** MediaPipe-like landmarks of points {index: [x, y, z]} (world metres around the hips' middle; image from an
 * orthographic camera in front, the hips at 55% of the picture's height). */
function landmarks(P) {
  const hips = [(P[23][0] + P[24][0]) / 2, (P[23][1] + P[24][1]) / 2, (P[23][2] + P[24][2]) / 2];
  const world = [], image = [];
  for (let i = 0; i < 33; i++) {
    const p = sub(P[i] ?? P[0], hips);
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (S * ASPECT), y: 0.55 + p[1] / S, z: 0, visibility: 1 });
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
const frameOf = o => { const lm = landmarks(body(o)); return { lm, m: bodyMetrics(lm.world, lm.image, lm.aspect) }; };
/** Whether a check's phase lets the frame through (a check without one: always). */
const judged = (c, { m, lm }) => !c.phase || c.phase(m, lm);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} (want ${b})`);

// --- the checks' shape ---------------------------------------------------------------------------------------------
test('legs.js: the four movements, every check of the shape with a part the page can show, sided where one-sided',
  () => {
    assert.deepEqual(Object.keys(LEGS).sort(), [...KEYS].sort());
    assert.deepEqual(checkProblems(LEGS, PARTS), []);
    assert.equal(MOVE_FORM_GROUPS.legs, LEGS);
    for (const key of KEYS) {
      assert.equal(MOVE_FORMS[key], LEGS[key], `${key}: merged as its group has it`);
      for (const c of LEGS[key]) {
        // (a part on one side of the body says which; a part of both does not)
        assert.equal(typeof c.side === 'function', SIDED.includes(c.part), `${key}/${c.id}: side`);
        assert.ok(c.needs.length > 0, `${key}/${c.id}: needs`);
      }
    }
  });

// --- what each phase lets through, on made-up frames ---------------------------------------------------------------
test('a knee drive is judged on the driving leg; a stride, a skip and a squat are not knee drives', () => {
  for (const key of ['side_kick_knee_raise', 'boxing_cardio_combo']) {
    const c = checkOf(key, 'knee_drive_low');
    const drive = frameOf({ thighL: 90, kneeL: 90 });
    assert.ok(judged(c, drive), `${key}: the drive`);
    near(c.value(drive.m, drive.lm), 90, 0.01, `${key}: thigh level`);
    assert.equal(c.side(drive.m, drive.lm), 'L');
    const low = frameOf({ thighR: 50, kneeR: 85 });
    assert.ok(judged(c, low) && c.bad(c.value(low.m, low.lm)), `${key}: a low drive`);
    assert.equal(c.side(low.m, low.lm), 'R');
    assert.equal(c.side(bodyMetrics(mirror(low.lm).world, mirror(low.lm).image, ASPECT)), 'L', `${key}: mirrored`);
    // a walking stride's swing (thigh 30 deg forward, knee at 120); a skip (thigh 50, the knee folded only to 115); a
    // squat (both knees bent, the feet down)
    for (const [what, o] of [['stride', { thighL: 30, kneeL: 60 }], ['skip', { thighL: 50, kneeL: 65 }],
      ['squat', { thigh: 70, knee: 80, feet: 0.1 }]]) {
      assert.ok(!judged(c, frameOf(o)), `${key}: a ${what} is no knee drive`);
    }
  }
});

test('a kick is judged on a straight leg 40 deg or more out to the side; lower, forward or a drive: not', () => {
  const c = checkOf('side_kick_knee_raise', 'kick_low');
  const kick = frameOf({ legOutL: 80 });
  assert.ok(judged(c, kick));
  near(c.value(kick.m, kick.lm), 80, 0.01, 'kick height');
  assert.equal(c.side(kick.m, kick.lm), 'L');
  assert.equal(c.side(bodyMetrics(mirror(kick.lm).world, mirror(kick.lm).image, ASPECT)), 'R', 'mirrored');
  const low = frameOf({ legOutL: 45 });
  assert.ok(judged(c, low) && c.bad(c.value(low.m, low.lm)), 'a kick to 45 deg');
  for (const [what, o] of [['a kick 35 deg up', { legOutL: 35 }], ['a straight leg forward', { thighL: 70 }],
    ['a knee drive', { thighL: 90, kneeL: 90 }]]) {
    assert.ok(!judged(c, frameOf(o)), what);
  }
});

test('the lean over the standing leg is judged on a kick well up, a straight leg out to the side; signed by side',
  () => {
    const lean = checkOf('side_kick_knee_raise', 'lean_over');
    // leaning 35 deg toward the standing (right) leg while kicking with the left; mirrored, the same
    const over = frameOf({ legOutL: 70, side: -35 });
    assert.ok(judged(lean, over) && lean.bad(lean.value(over.m, over.lm)));
    near(lean.value(over.m, over.lm), 35, 0.5, 'lean');
    const m2 = mirror(over.lm);
    near(lean.value(bodyMetrics(m2.world, m2.image, ASPECT), m2), 35, 0.5, 'mirrored');
    // leaning toward the kick is no lean over the standing leg
    assert.ok(!lean.bad(lean.value(frameOf({ legOutL: 70, side: 35 }).m)), 'toward the kick');
    // not judged: a kick only 35 deg up, a straight leg raised forward, a knee drive (the twisting raise leans the
    // trunk to the knee)
    for (const [what, o] of [['a low kick', { legOutL: 35, side: -35 }], ['forward', { thighL: 70, side: -35 }],
      ['a knee drive', { thighL: 90, kneeL: 90, side: -35 }]]) {
      assert.ok(!judged(lean, frameOf(o)), what);
    }
  });

test('a sweep is judged at its top, a leg well out to the side; a jumping jack and a small step are not', () => {
  for (const key of ['standing_side_crunch', 'wall_side_leg_raise']) {
    const c = checkOf(key, 'standing_knee');
    const sweep = frameOf({ legOutR: 60 });
    assert.ok(judged(c, sweep), key);
    near(c.value(sweep.m, sweep.lm), 180, 0.01, `${key}: standing knee straight`);
    assert.equal(c.side(sweep.m), 'L', `${key}: the standing leg`);
    // the standing knee bent to 100 (the thigh forward 40, the shin back): bad
    const bent = frameOf({ legOutR: 60, thighL: 40, kneeL: 80 });
    assert.ok(judged(c, bent) && c.bad(c.value(bent.m, bent.lm)), `${key}: bent`);
    for (const [what, o] of [['jumping jack', { legOut: 25 }], ['small step', { legOutR: 25 }],
      ['leg forward', { thighR: 60 }]]) {
      assert.ok(!judged(c, frameOf(o)), `${key}: a ${what} is no sweep`);
    }
  }
  const lean = checkOf('wall_side_leg_raise', 'lean_side');
  const f = frameOf({ legOutL: 60, side: -45 });
  assert.ok(judged(lean, f) && lean.bad(lean.value(f.m, f.lm)), 'leaning on the wall');
});

test('the sweeping knee: judged by its own side\'s check, the leg well out; a knee raise or a low sweep is not', () => {
  const R = checkOf('standing_side_crunch', 'swept_knee_right'), L = checkOf('standing_side_crunch', 'swept_knee_left');
  const sweep = frameOf({ legOutR: 60 });
  assert.ok(judged(R, sweep) && !judged(L, sweep), 'the right leg swept');
  near(R.value(sweep.m, sweep.lm), 180, 0.01, 'straight');
  assert.deepEqual([R.side(sweep.m), L.side(sweep.m), R.needs, L.needs], ['R', 'L', ['legR'], ['legL']]);
  // the shin folded back 60 deg at the knee: 120, bad; 30: 150, fine
  const fold = d => {
    const P = body({ legOutR: 60 }), shin = sub(P[28], P[26]), k = norm(crossP(shin, [0, 0, 1]));
    for (const i of [28, 30, 32]) P[i] = add(P[26], rot(sub(P[i], P[26]), k, d));
    const lm = landmarks(P);
    return { lm, m: bodyMetrics(lm.world, lm.image, lm.aspect) };
  };
  const bentSweep = fold(60), little = fold(30);
  near(R.value(bentSweep.m, bentSweep.lm), 120, 0.01, 'folded 60');
  assert.ok(judged(R, bentSweep) && R.bad(R.value(bentSweep.m, bentSweep.lm)), 'bent');
  assert.ok(judged(R, little) && R.ok(R.value(little.m, little.lm)), 'a little bent');
  const stronglyBent = fold(100);
  near(R.value(stronglyBent.m, stronglyBent.lm), 80, 0.01, 'strongly bent');
  assert.ok(judged(R, stronglyBent) && R.bad(R.value(stronglyBent.m, stronglyBent.lm)),
    'a knee bent past 100 is still judged on an outward sweep');
  const m2 = mirror(bentSweep.lm), mm = bodyMetrics(m2.world, m2.image, ASPECT);
  assert.ok(judged(L, { m: mm, lm: m2 }) && L.bad(L.value(mm, m2)), 'mirrored: the left one');
  for (const [what, o] of [['knee raise', { thighR: 90, kneeR: 90 }], ['sweep 40 deg out', { legOutR: 40, kneeR: 60 }],
    ['jumping jack', { legOut: 25 }]]) {
    assert.ok(!judged(R, frameOf(o)) && !judged(L, frameOf(o)), what);
  }
});

test('side-crunch height: low and excessive straight lifts, with a margin around the reference', () => {
  const low = checkOf('standing_side_crunch', 'sweep_low'), high = checkOf('standing_side_crunch', 'sweep_high');
  for (const [height, expected] of [[40, 'low'], [60, 'ok'], [80, 'ok'], [110, 'high']]) {
    const f = frameOf({ legOutR: height });
    assert.ok(judged(low, f) && judged(high, f));
    assert.equal(low.bad(low.value(f.m)), expected === 'low');
    assert.equal(high.bad(high.value(f.m)), expected === 'high');
  }
  for (const o of [{ legOut: 25 }, { thighR: 90, kneeR: 90 }, { legOutR: 25 }]) {
    assert.ok(!judged(low, frameOf(o)) && !judged(high, frameOf(o)), 'no height verdict on a jack, drive or step');
  }
});

test('the combo\'s squat: knees over the feet fine, caving in bad, a knee drive or the feet together not judged',
  () => {
    const c = checkOf('boxing_cardio_combo', 'knees_in');
    const squat = frameOf({ thigh: 70, knee: 80 });
    assert.ok(judged(c, squat));
    near(c.value(squat.m, squat.lm), 1, 0.01, 'knees over the feet');
    // the knees drawn in to half the feet's spread
    const P = body({ thigh: 70, knee: 80 });
    P[25] = [P[25][0] / 2, P[25][1], P[25][2]]; P[26] = [P[26][0] / 2, P[26][1], P[26][2]];
    const lm = landmarks(P), m = bodyMetrics(lm.world, lm.image, lm.aspect);
    near(c.value(m, lm), 0.5, 0.01, 'caving in');
    assert.ok(c.bad(c.value(m, lm)));
    assert.ok(!judged(c, frameOf({ thighL: 90, kneeL: 90, kneeR: 40 })), 'a knee drive on a bent knee');
    const together = frameOf({ thigh: 70, knee: 80, feet: -0.2 });
    assert.ok(Number.isNaN(c.value(together.m, together.lm)), 'feet together: no ratio');
  });

// --- the library's references, its footage and the user's recordings (private) -----------------------------------
const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const library = readJson(path.join(DATA, 'moves', 'library.json'))?.movements ?? [];
const catalog = readJson(path.join(DATA, 'moves', 'catalog.json'));
const mpIndex = readJson(path.join(DATA, 'moves', 'mp', 'index.json')) ?? [];
const movementOf = key => library.find(x => x.key === key);
/** The reference skeleton of a library movement ({fps, joints}, SMPL joints, y up), from its dump or its npz. */
function skeletonOf(key) {
  const m = movementOf(key);
  if (!m) return null;
  const dump = readJson(path.join(DATA, 'moves', 'skel', `${m.id}.json`));
  if (dump) return dump;
  const npz = catalog && path.join(catalog.source, m.id, 'source', 'skeleton_motion.npz');
  return npz && fs.existsSync(npz) ? skeletonFromNpz(fs.readFileSync(npz)) : null;
}
/** MediaPipe on the library's footage of a movement: [{t, lm}] (lm null: nobody), or null if not here. */
function footageOf(key) {
  const m = movementOf(key), entry = m && mpIndex.find(e => e.id === m.id);
  const rec = entry?.series && readJson(path.join(ROOT, entry.series));
  return rec && framesOf(rec);
}
const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
/** A recording's frames ({t, image, world}: arrays) as [{t, lm}]. */
const framesOf = rec => rec.frames.map(f => ({ t: f.t, lm: f.world && f.image
  ? { world: obj(f.world), image: obj(f.image), aspect: rec.width / rec.height } : null }));

/** Frames [{t, lm}] through the movement tracker as the page runs it: {tr, evs} (the guard rails' events, form_fault
 * and form_fix; the framework's form_unseen, a "step back" with every check out of view, is no guard rail's), and
 * `unseen` (the form_unseen events). */
function track(key, frames) {
  const tr = new MovementTracker({ movement: movementOf(key) }), evs = [], unseen = [];
  for (const { t, lm } of frames) {
    const f = lm && features(lm.world, lm.image, lm.aspect);
    for (const e of f ? tr.update(f, t, lm) : tr.lost(t)) {
      if (e.type === 'form_fault' || e.type === 'form_fix') evs.push(e);
      else if (e.type === 'form_unseen') unseen.push(e);
    }
  }
  return { tr, evs, unseen };
}
/** A one-sided check's id on the other side (the side crunch's sweeping knee: swept_knee_left, swept_knee_right). */
const mirrorId = id => id.replace(/_(left|right)$/, (_, s) => (s === 'left' ? '_right' : '_left'));
/** Every check judged: each, or its other side's (one side is swept). */
const allJudged = (tr, key, what) => {
  for (const c of LEGS[key]) {
    assert.ok(tr.mf.s[c.id].measuredEver || tr.mf.s[mirrorId(c.id)]?.measuredEver, `${what}: ${c.id} judged`);
  }
};
let seed = 5;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
/** MediaPipe-sized jitter: each point moved up to 1 cm either way (sd 5.8 mm), its image with it; MediaPipe's own on
 * the user standing still: sd 2-3.5 mm. */
const jitter = lm => ({ aspect: lm.aspect,
  world: lm.world.map(p => ({ x: p.x + 0.02 * rnd(), y: p.y + 0.02 * rnd(), z: p.z + 0.02 * rnd() })),
  image: lm.image.map(p => ({ ...p, x: p.x + (0.02 / (S * ASPECT)) * rnd(), y: p.y + (0.02 / S) * rnd() })) });
/** The stretch of a clip to loop: the two frames at least 3.5 s apart whose poses are nearest (the movement's cycles
 * then follow on from one another), as [first, last) frame indices. */
function loopOf(fr) {
  const gap = (a, b) => [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].reduce((s, j) => s + Math.hypot(
    a.world[j].x - b.world[j].x, a.world[j].y - b.world[j].y, a.world[j].z - b.world[j].z), 0);
  let best = null;
  for (let i = 0; i < fr.length; i++) {
    for (let j = i + 1; j < fr.length; j++) {
      if (fr[j].t - fr[i].t < 3500) continue;
      const d = gap(fr[i], fr[j]);
      if (!best || d < best.d) best = { i, j, d };
    }
  }
  return [best.i, best.j];
}
/** A reference played as a person doing it: its loop `rounds` times (or the whole clip out and back), at `speed`
 * times its pace, mirrored, jittered: [{t, lm}]. */
function play(skel, { speed = 1, rounds = 6, mirrored = false, jit = false, back = false, loop = null } = {}) {
  const fr = skeletonLandmarks(skel), [i0, i1] = back ? [0, fr.length] : loop ?? loopOf(fr);
  const part = fr.slice(i0, i1), seq = [];
  for (let r = 0; r < rounds; r++) seq.push(...part, ...(back ? [...part].reverse() : []));
  return seq.map((x, i) => {
    let lm = { world: x.world, image: x.image, aspect: ASPECT };
    if (mirrored) lm = mirror(lm);
    if (jit) lm = jitter(lm);
    return { t: (i * 1000) / skel.fps / speed, lm };
  });
}

// faults put into a skeleton (SMPL joints, metres, y up), frame by frame where `when(J, i)` holds
const UPDOWN = [0, -1, 0];
const copy = skel => ({ fps: skel.fps, joints: Object.fromEntries(Object.entries(skel.joints)
  .map(([k, v]) => [k, v.map(p => [...p])])) });
/** The body's own left (along the hips, level) and forward on frame i. */
const axes = (J, i) => {
  const L = norm([J.left_hip[i][0] - J.right_hip[i][0], 0, J.left_hip[i][2] - J.right_hip[i][2]]);
  return { L, F: crossP(L, [0, 1, 0]) };
};
const turnAbout = (p, o, k, d) => add(o, rot(sub(p, o), k, d));
const kneeAt = (J, side, i) => deg(sub(J[`${side}_hip`][i], J[`${side}_knee`][i]),
  sub(J[`${side}_ankle`][i], J[`${side}_knee`][i]));
const thighAt = (J, side, i) => deg(sub(J[`${side}_knee`][i], J[`${side}_hip`][i]), UPDOWN);
/** A leg (`side`: 'left', 'right') lifted less: its thigh's angle from straight down above `from` deg kept to `k` of
 * the rest, the whole leg turned about the hip in the plane of the thigh and the vertical. */
function lowerLeg(skel, side, from, k, when) {
  const out = copy(skel), J = out.joints;
  J.pelvis.forEach((_, i) => {
    const a = thighAt(skel.joints, side, i);
    if (a <= from || !when(skel.joints, i)) return;
    const hip = J[`${side}_hip`][i], ax = norm(crossP(sub(J[`${side}_knee`][i], hip), UPDOWN));
    for (const j of ['knee', 'ankle', 'foot']) {
      J[`${side}_${j}`][i] = turnAbout(J[`${side}_${j}`][i], hip, ax, (a - from) * (1 - k));
    }
  });
  return out;
}
/** A knee bent `2 d` deg more: its thigh turned `d` forward about the hip and the shin `d` back (the foot about under
 * the hip, the body lower). */
function bendKnee(skel, side, d) {
  const out = copy(skel), J = out.joints;
  J.pelvis.forEach((_, i) => {
    const { L, F } = axes(J, i), s = dot(rot(UPDOWN, L, 10), F) > 0 ? 1 : -1;
    const hip = J[`${side}_hip`][i], knee0 = J[`${side}_knee`][i], knee = turnAbout(knee0, hip, L, s * d);
    for (const j of ['ankle', 'foot']) {
      J[`${side}_${j}`][i] = turnAbout(add(knee, sub(J[`${side}_${j}`][i], knee0)), knee, L, -s * d);
    }
    J[`${side}_knee`][i] = knee;
  });
  return out;
}
/** The upper body (neck, head, arms) leant `d` deg more toward the person's `side` (`d` a number, or a function of the
 * frame (J, i)), about the hips' middle (where `when` holds: every frame without it). */
function leanTrunk(skel, side, d, when = () => true) {
  const out = copy(skel), J = out.joints;
  const upper = ['neck', 'head', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist',
    'right_wrist'].filter(j => J[j]);
  J.pelvis.forEach((_, i) => {
    if (!when(skel.joints, i)) return;
    const { L, F } = axes(J, i), o = add(J.left_hip[i], sub(J.right_hip[i], J.left_hip[i]), 0.5);
    const to = side === 'left' ? L : L.map(x => -x), s = dot(rot([0, 1, 0], F, 10), to) > 0 ? 1 : -1;
    const by = typeof d === 'function' ? d(skel.joints, i) : d;
    for (const j of upper) J[j][i] = turnAbout(J[j][i], o, F, s * by);
  });
  return out;
}
/** The knees drawn in toward each other (along the body's left) to `k` of their spread about the feet's middle, on the
 * frames with both knees bent (the squats). */
function kneesIn(skel, k) {
  const out = copy(skel), J = out.joints;
  J.pelvis.forEach((_, i) => {
    if (!(kneeAt(skel.joints, 'left', i) < 150 && kneeAt(skel.joints, 'right', i) < 150)) return;
    const { L } = axes(J, i), mid = add(J.left_ankle[i], sub(J.right_ankle[i], J.left_ankle[i]), 0.5);
    for (const side of ['left', 'right']) {
      const p = J[`${side}_knee`][i];
      J[`${side}_knee`][i] = add(p, L, -(1 - k) * dot(sub(p, mid), L));
    }
  });
  return out;
}
/** The swept leg (`side`) kept bent: its shin folded `d` deg back about the knee (toward behind the body) on every
 * frame. */
function bendSweep(skel, side, d) {
  const out = copy(skel), J = out.joints;
  J.pelvis.forEach((_, i) => {
    const { F } = axes(J, i), knee = J[`${side}_knee`][i], shin = sub(J[`${side}_ankle`][i], knee);
    const k = norm(crossP(shin, F.map(x => -x)));
    for (const j of ['ankle', 'foot']) J[`${side}_${j}`][i] = turnAbout(J[`${side}_${j}`][i], knee, k, d);
  });
  return out;
}
const bent = (side, below = 150) => (J, i) => kneeAt(J, side, i) < below;
const straight = side => (J, i) => kneeAt(J, side, i) >= 150;
/** A knee drive of `side` alone: its knee bent, the other leg standing. */
const drive = side => (J, i) => kneeAt(J, side, i) < 140 && kneeAt(J, side === 'left' ? 'right' : 'left', i) > 140;
/** Both of the combo's knee drives lifted less: the thigh's angle above 35 deg kept to `kl` (left), `kr` (right). */
const drives = (kl, kr) => s => lowerLeg(lowerLeg(s, 'left', 35, kl, drive('left')), 'right', 35, kr, drive('right'));
/** A lean growing with the raised (left) leg, to `d` deg from a thigh 60 deg up: leant over all the way down, the
 * skeleton's hips (0.2 m apart, MediaPipe's about 0.3) leave the feet's spread too few hip widths across to count. */
const rising = d => (J, i) => d * Math.max(0, Math.min(1, (thighAt(J, 'left', i) - 30) / 30));

// Each movement's faults: [what, the check that must catch it (null: none may), the side it must name for the
// reference (null: none, or either for the combo's alternating drives), the fault put in]. Each reference works one
// side: the side kick and the wall leg raise its left leg, the side crunch its right (its left standing).
const FAULTS = {
  side_kick_knee_raise: [
    ['the knee driven to about 50 deg', 'knee_drive_low', 'left', s => lowerLeg(s, 'left', 35, 0.22, bent('left'))],
    ['the knee driven to about 65 deg', null, null, s => lowerLeg(s, 'left', 35, 0.42, bent('left'))],
    ['the kick to about 45 deg', 'kick_low', 'left', s => lowerLeg(s, 'left', 25, 0.31, straight('left'))],
    ['the kick to about 62 deg', null, null, s => lowerLeg(s, 'left', 25, 0.58, straight('left'))],
    ['leaning 40 deg more toward the standing leg', 'lean_over', null, s => leanTrunk(s, 'right', 40)],
    ['...as it kicks only', 'lean_over', null, s => leanTrunk(s, 'right', 40,
      (J, i) => kneeAt(J, 'left', i) >= 150 && thighAt(J, 'left', i) > 30)],
    ['leaning 15 deg more toward the standing leg', null, null, s => leanTrunk(s, 'right', 15)],
  ],
  standing_side_crunch: [
    ['the standing knee bent 48 deg more', 'standing_knee', 'left', s => bendKnee(s, 'left', 24)],
    ['the standing knee bent 26 deg more', null, null, s => bendKnee(s, 'left', 13)],
    ['the sweeping knee bent 30 deg', 'swept_knee_right', 'right', s => bendSweep(s, 'right', 30)],
    ['the sweeping knee bent 6 deg', null, null, s => bendSweep(s, 'right', 6)],
    ['the leg only lifted to about 45 deg', 'sweep_low', 'right', s => lowerLeg(s, 'right', 20, 0.4, () => true)],
    ['the leg lifted to about 115 deg', 'sweep_high', 'right', s => lowerLeg(s, 'right', 20, 1.65, () => true)],
  ],
  wall_side_leg_raise: [
    ['leaning 40 deg more toward the wall as the leg rises', 'lean_side', null, s => leanTrunk(s, 'right', rising(40))],
    ['leaning 12 deg more toward the wall', null, null, s => leanTrunk(s, 'right', 12)],
    ['the standing knee bent 48 deg more', 'standing_knee', 'right', s => bendKnee(s, 'right', 24)],
    ['the standing knee bent 10 deg more', null, null, s => bendKnee(s, 'right', 5)],
  ],
  boxing_cardio_combo: [
    ['the knees caving in to half the feet\'s spread', 'knees_in', null, s => kneesIn(s, 0.5)],
    ['the knees in to 0.85 of it', null, null, s => kneesIn(s, 0.85)],
    ['both knee drives to about 50 deg', 'knee_drive_low', null, drives(0.2, 0.25)],
    ['the left knee drive alone to about 50 deg', 'knee_drive_low', 'left', s => lowerLeg(s, 'left', 35, 0.2,
      drive('left'))],
    ['both knee drives to about 68 deg', null, null, drives(0.45, 0.6)],
  ],
};
const mirrorSide = s => (s === 'left' ? 'right' : s === 'right' ? 'left' : s);

for (const key of KEYS) {
  const skel = skeletonOf(key);
  const noRef = !skel && 'no reference skeleton here';
  test(`${key}: the reference tells nothing at its own pace, half and twice it, mirrored, with jitter; every check is `
    + 'judged', { skip: noRef }, () => {
    for (const o of [{}, { speed: 2 }, { speed: 0.5 }, { mirrored: true }, { jit: true },
      { speed: 2, mirrored: true, jit: true }, { back: true, rounds: 4 },
      { back: true, rounds: 4, speed: 2, jit: true }]) {
      const what = JSON.stringify(o);
      const { tr, evs } = track(key, play(skel, o));
      assert.ok(tr.current().count >= 4, `${what}: ${tr.current().count} cycles`);
      assert.deepEqual(evs, [], what);
      assert.deepEqual(tr.summary().form.faults, [], what);
      allJudged(tr, key, what);
    }
  });

  test(`${key}: each fault put in is caught by its own check alone, on the right side; a milder one by none`,
    { skip: noRef }, () => {
      const loop = loopOf(skeletonLandmarks(skel));
      for (const [what, want, side, fault] of FAULTS[key]) {
        const bad = fault(skel);
        for (const o of [{}, { mirrored: true }, { speed: 2, jit: true }]) {
          const at = `${what} ${JSON.stringify(o)}`;
          const { tr, evs } = track(key, play(bad, { ...o, loop }));
          const told = evs.filter(e => e.type === 'form_fault');
          if (!want) { assert.deepEqual(told, [], at); continue; }
          const id = o.mirrored && checkOf(key, mirrorId(want)) ? mirrorId(want) : want;
          assert.deepEqual(told.map(e => e.fault), [id], at);
          const c = checkOf(key, id);
          assert.equal(told[0].part, c.part, at);
          if (side) assert.equal(told[0].side, o.mirrored ? mirrorSide(side) : side, at);
          else if (c.side) assert.ok(['left', 'right'].includes(told[0].side), at);
          else assert.equal(told[0].side, null, at);
          assert.match(told[0].measured, /\d/, at);
          assert.deepEqual(tr.summary().form.faults.map(f => [f.fault, f.fixed]), [[id, false]], at);
        }
      }
    });

  test(`${key}: each fault, then the movement done right: told, then its fix noticed`, { skip: noRef }, () => {
    const loop = loopOf(skeletonLandmarks(skel));
    for (const [what, want, , fault] of FAULTS[key].filter(f => f[1])) {
      const a = play(fault(skel), { loop }), b = play(skel, { loop }), t0 = a.at(-1).t + 1000 / skel.fps;
      const { tr, evs } = track(key, [...a, ...b.map(x => ({ ...x, t: t0 + x.t }))]);
      assert.deepEqual(evs.map(e => [e.type, e.fault]), [['form_fault', want], ['form_fix', want]], what);
      assert.deepEqual(tr.summary().form.faults.map(f => [f.fault, f.fixed]), [[want, true]], what);
    }
  });

  const mp = footageOf(key);
  test(`${key}: MediaPipe on the library's footage of it tells nothing, looped out and back`,
    { skip: !mp && 'no footage here' }, () => {
      const seq = [];
      for (let r = 0; r < 4; r++) seq.push(...mp, ...[...mp].reverse());
      const { tr, evs } = track(key, seq.map((x, i) => ({ t: (i * 1000) / 30, lm: x.lm })));
      assert.ok(tr.current().count >= 6, `${tr.current().count} cycles`);
      assert.deepEqual(evs, []);
      allJudged(tr, key, 'footage');
    });
}

// The user's live recordings (2026-10-23 to 25: squats, lunges, knee raises, skips, jumping jacks, push-ups, held
// poses, standing, resting, walking to and from the camera; none of them one of these movements), each movement named
// over the whole of each: nothing told. A recording naming one of them (the user doing it) may be told its faults:
// each with its part and, for a one-sided part, its side.
const liveDir = path.join(DATA, 'posedata', 'results', 'live');
const liveFiles = fs.existsSync(liveDir) ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')) : [];
test('the user\'s recordings, each movement named over the whole of each: nothing told but in the movement named',
  { skip: !(liveFiles.length && library.length) && 'no recordings or library here' }, () => {
    for (const f of liveFiles) {
      const rec = readJson(path.join(liveDir, f)), frames = framesOf(rec);
      for (const key of KEYS) {
        const { evs } = track(key, frames);
        const doing = (rec.movements ?? []).some(m => m.movement === key);
        if (!doing) {
          assert.deepEqual(evs.map(e => [e.type, e.fault]), [], `${key} named over a recording`);
          continue;
        }
        for (const e of evs.filter(x => x.type === 'form_fault')) {
          const c = checkOf(key, e.fault);
          assert.equal(e.part, c.part);
          assert.ok(c.side ? ['left', 'right'].includes(e.side) : e.side === null, `${e.fault}: ${e.side}`);
        }
      }
    }
  });

// The user's live standing side crunches (the recordings whose movements name it, 2026-10-25: sweeps of one leg, the
// knee bent through the top of many, the feet at or below the picture's bottom edge through all of the first set and
// the bent part of the second; its straight sweeps after, the feet in view). Told: the sweeping leg bent, on the side
// the user swept (the leg lifted highest), and nothing else; the standing knee, its foot out of the picture, unseen
// while it is, and the framework asks the user to step back.
const crunchRecs = liveFiles.map(f => readJson(path.join(liveDir, f)))
  .filter(rec => (rec.movements ?? []).some(m => m.movement === 'standing_side_crunch'));
test('the user\'s live side crunch: the bent sweeping knee told on the swept side, with measured range faults only',
  { skip: !(crunchRecs.length && library.length) && 'no recording of it here' }, () => {
    for (const rec of crunchRecs) {
      const frames = framesOf(rec);
      // the swept side: the leg in view whose ankle rose clearly above the other (0.3 leg lengths) on the most frames
      // (sitting close to the camera before and after the set, the legs out of the picture, MediaPipe guesses them)
      const up = { L: 0, R: 0 };
      for (const { lm } of frames) {
        const m = lm && bodyMetrics(lm.world, lm.image, lm.aspect);
        for (const s of ['L', 'R']) if (m?.seen[`leg${s}`] && m[`ankleUp${s}`] >= 0.3) up[s] += 1;
      }
      const swept = up.L >= up.R ? 'left' : 'right';
      const { tr, evs, unseen } = track('standing_side_crunch', frames);
      const told = evs.filter(e => e.type === 'form_fault');
      const knees = told.filter(e => e.fault.startsWith('swept_knee'));
      assert.deepEqual(knees.map(e => [e.fault, e.side, e.part]), [[`swept_knee_${swept}`, swept, 'knee']]);
      const v = Number(knees[0].measured.match(/\d+/)[0]);
      assert.ok(v < 130, knees[0].measured);
      for (const e of told.filter(e => !e.fault.startsWith('swept_knee'))) {
        assert.ok(['sweep_low', 'sweep_high'].includes(e.fault));
        const value = Number(e.measured.match(/\d+/)[0]);
        assert.ok(checkOf('standing_side_crunch', e.fault).bad(value), e.measured);
      }
      // (the standing knee judged only if both feet were ever in view)
      const feet = frames.some(({ lm }) => lm && bodyMetrics(lm.world, lm.image, lm.aspect).seen.legs);
      if (!feet) assert.equal(tr.mf.s.standing_knee.measuredEver, false, 'the standing foot never in view');
      assert.ok(unseen.length >= 1 && unseen.every(e => e.parts.includes('feet') || e.parts.includes('legs')),
        'asked to show the cropped feet or legs');
      assert.deepEqual(tr.summary().form.faults.filter(f => f.fault.startsWith('swept_knee'))
        .map(f => [f.fault, f.told]), [[`swept_knee_${swept}`, true]]);
    }
  });
