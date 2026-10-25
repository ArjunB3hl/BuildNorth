// The guard rails of kneeling on one knee and standing up, and of the half-kneel to stand
// (web/js/moveforms/transitions.js): on a made-up person kneeling (the phases, each fault on its own, its side, a fix,
// a kneel held still); then, private (.data/, skipped when not on this machine), the library's reference skeletons
// through the movement tracker as the page runs it (how much of each kneel it judges) and with every frame judged,
// faults put into them on purpose, MediaPipe on the library's footage, and the user's own recordings with each movement
// named over the whole of it.
//
// Both checks are `still` (web/js/moveform.js): judged on the kneeling frames moving or not, from the first movement
// after the movement was named. Without it the tracker judged frame checks only on frames it counts as moving, after
// each run's warm-up, and these movements are mostly held: at its own pace the kneel's reference holds its kneel still
// past PAUSE_MS, so each rise started a new run inside its warm-up, and nothing of either reference was judged. With
// every frame judged: MoveForm on its own, every frame moving, no warm-up (the lines wherever the person kneels).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { boneParts } from '../web/js/formcheck.js';
import { faultParts } from '../web/js/retarget.js';
import { MOVE_FORMS, MOVE_TUNING, MoveForm, bodyMetrics, checkProblems } from '../web/js/moveform.js';
import { MovementTracker } from '../web/js/moves.js';
import { skeletonFromNpz, skeletonLandmarks } from '../tools/build_moves.mjs';
import TRANSITIONS from '../web/js/moveforms/transitions.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const FPS = 30, DT = 1000 / FPS, ASPECT = 16 / 9, S = 2.4;   // S: metres from the picture's top to its bottom
const K = MOVE_TUNING;
const KEYS = ['kneel_and_stand', 'half_kneel_to_stand'];
const PARTS = boneParts().filter(p => faultParts().includes(p));

// --- geometry, mirroring, jitter -----------------------------------------------------------------------------------
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const crossP = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rad = d => (d * Math.PI) / 180;
const clamp01 = x => Math.max(0, Math.min(1, x));
/** v turned by `deg` about the unit axis k (Rodrigues). */
function rot(v, k, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = crossP(k, v);
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c));
}
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
  / (Math.hypot(...a) * Math.hypot(...b))))) * 180 / Math.PI;
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
/** Mirrored: the person's left and right swapped (the same movement on the other side). */
function mirror(lm) {
  const sw = Array.from({ length: 33 }, (_, i) => i);
  for (const [a, b] of PAIRS) { sw[a] = b; sw[b] = a; }
  return { aspect: lm.aspect, world: sw.map(j => ({ ...lm.world[j], x: -lm.world[j].x })),
    image: sw.map(j => ({ ...lm.image[j], x: 1 - lm.image[j].x })) };
}
let seed = 23;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
/** MediaPipe-sized jitter: up to a centimetre on each world coordinate (a few degrees on a joint), 0.3% of the
 * picture on the image (moves.js measures MediaPipe's on a still person: 0.02-0.04 body lengths in half a second). */
const jittered = lm => ({ aspect: lm.aspect,
  world: lm.world.map(p => ({ x: p.x + 0.02 * rnd(), y: p.y + 0.02 * rnd(), z: p.z + 0.02 * rnd() })),
  image: lm.image.map(p => ({ ...p, x: p.x + 0.006 * rnd(), y: p.y + 0.006 * rnd() })) });

// --- a made-up person kneeling -------------------------------------------------------------------------------------
/** MediaPipe-like landmarks of a made-up person facing the camera (legs 0.9 m, trunk 0.5 m, hips 0.3 m and shoulders
 * 0.38 m wide; world: y down, x the person's left, smaller z nearer the camera), kneeling on the left knee (its thigh
 * straight down, the shin back along the floor) with the right foot planted ahead (thigh forward, shin straight down):
 * `lean` the trunk forward (deg), `kneeIn` the right knee moved in toward the left leg (m), `turn` the person turned
 * about the vertical (deg); `stand` standing tall instead, `squat` both knees bent alike. */
function kneelBody({ lean = 0, kneeIn = 0, turn = 0, stand = false, squat = false } = {}) {
  const P = { 23: [0.15, 0, 0], 24: [-0.15, 0, 0] };
  if (stand) Object.assign(P, { 25: [0.15, 0.45, 0], 27: [0.15, 0.9, 0], 26: [-0.15, 0.45, 0], 28: [-0.15, 0.9, 0] });
  else if (squat) {
    Object.assign(P, { 25: [0.2, 0.15, -0.42], 27: [0.2, 0.55, -0.25], 26: [-0.2, 0.15, -0.42],
      28: [-0.2, 0.55, -0.25] });
  } else Object.assign(P, { 25: [0.15, 0.45, 0], 27: [0.15, 0.47, 0.43], 26: [-0.15 + kneeIn, 0.05, -0.45],
    28: [-0.15, 0.5, -0.45] });
  const flatBack = !stand && !squat;                    // (the kneeling foot lies on its top, the toes behind)
  for (const [an, heel, toe] of [[27, 29, 31], [28, 30, 32]]) {
    const back = an === 27 && flatBack;
    P[heel] = add(P[an], back ? [0, -0.05, 0.03] : [0, 0.04, 0.05]);
    P[toe] = add(P[an], back ? [0, 0.03, 0.17] : [0, 0.06, -0.15]);
  }
  const up = [0, -Math.cos(rad(lean)), -Math.sin(rad(lean))];            // hips to shoulders, forward with the lean
  const along = (k, x) => [x, up[1] * k, up[2] * k];
  Object.assign(P, { 11: along(0.5, 0.19), 12: along(0.5, -0.19), 13: along(0.22, 0.21), 14: along(0.22, -0.21) });
  P[15] = [0.21, 0.05, up[2] * 0.5]; P[16] = [-0.21, 0.05, up[2] * 0.5];
  P[0] = add(along(0.75, 0), [0, 0, -0.1]); P[7] = add(P[0], [0.07, 0, 0.1]); P[8] = add(P[0], [-0.07, 0, 0.1]);
  for (const i of [1, 2, 3, 4, 5, 6, 9, 10]) P[i] = P[0];
  for (const i of [17, 19, 21]) P[i] = P[15];
  for (const i of [18, 20, 22]) P[i] = P[16];
  const c = Math.cos(rad(turn)), s = Math.sin(rad(turn)), world = [], image = [];
  for (let i = 0; i < 33; i++) {
    const p = [P[i][0] * c + P[i][2] * s, P[i][1], -P[i][0] * s + P[i][2] * c];
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (S * ASPECT), y: 0.45 + p[1] / S, z: 0, visibility: 1 });
  }
  return { world, image, aspect: ASPECT };
}
const metricsOf = lm => bodyMetrics(lm.world, lm.image, lm.aspect);
const checkOf = (key, id) => TRANSITIONS[key].find(c => c.id === id);
/** The made-up frames `at(t)` (landmarks) from 0 to `to` ms at 30 fps through a MoveForm, every frame moving unless
 * `moving(t)` says otherwise: the events, each with `at`. */
function feed(mf, at, to, moving = () => true) {
  const out = [];
  for (let t = 0; t <= to + 1e-6; t += DT) {
    const lm = at(t);
    out.push(...mf.update(lm && metricsOf(lm), lm, t, null, moving(t)).map(e => ({ ...e, at: t })));
  }
  return out;
}
const kinds = evs => evs.map(e => [e.type, e.fault, e.part ?? null, e.side ?? null]);

test('the transitions\' checks: their shape, parts the page can show, frame checks with a phase, in MOVE_FORMS', () => {
  assert.deepEqual(checkProblems(TRANSITIONS, PARTS), []);
  for (const key of KEYS) {
    assert.ok(TRANSITIONS[key], key);
    assert.equal(MOVE_FORMS[key], TRANSITIONS[key], `${key} merged into MOVE_FORMS`);
    assert.deepEqual(TRANSITIONS[key].map(c => c.id), ['torso_fold', 'front_knee_in'], key);
    for (const c of TRANSITIONS[key]) {
      assert.equal(c.at, 'frame', `${key}/${c.id}: no cycles on a moving track`);
      assert.equal(typeof c.phase, 'function', `${key}/${c.id}: judged in its part of the movement only`);
      assert.equal(c.still, true, `${key}/${c.id}: judged on the kneel held still too`);
    }
    new MoveForm({ key });
  }
  // (the knee names its side; the trunk is both)
  assert.equal(checkOf('kneel_and_stand', 'torso_fold').side, undefined);
  assert.equal(typeof checkOf('kneel_and_stand', 'front_knee_in').side, 'function');
});

test('made-up: kneeling is one knee down and the other foot planted ahead; standing, a squat are not', () => {
  const tall = checkOf('kneel_and_stand', 'torso_fold'), knee = checkOf('kneel_and_stand', 'front_knee_in');
  const at = o => { const lm = kneelBody(o); return { lm, m: metricsOf(lm) }; };
  for (const o of [{}, { lean: 30 }, { lean: 70 }, { kneeIn: 0.2 }]) {
    const { lm, m } = at(o);
    assert.ok(tall.phase(m, lm) && knee.phase(m, lm), JSON.stringify(o));
  }
  for (const o of [{ stand: true }, { squat: true }, { stand: true, lean: 70 }, { squat: true, lean: 70 }]) {
    const { lm, m } = at(o);
    assert.ok(!tall.phase(m, lm) && !knee.phase(m, lm), JSON.stringify(o));
  }
  // the measures as built: upright, the knee over the foot; the front leg the right, mirrored the left
  const { lm, m } = at({});
  assert.ok(Math.abs(tall.value(m, lm)) < 0.5 && Math.abs(knee.value(m, lm)) < 0.01);
  assert.equal(knee.side(m), 'R');
  const mm = mirror(lm);
  assert.equal(knee.side(metricsOf(mm)), 'L');
  assert.ok(Math.abs(knee.value(metricsOf(mm), mm)) < 0.01);
  const leaning = at({ lean: 70 }), caving = at({ kneeIn: 0.2 });
  assert.ok(Math.abs(tall.value(leaning.m, leaning.lm) - 70) < 0.5);
  assert.ok(knee.value(caving.m, caving.lm) > 0.2, 'the knee 0.2 m in: past 0.2 leg lengths');
});

test('made-up: a torso folded forward kneeling is told once it lasts, alone, and its fix noticed', () => {
  for (const key of KEYS) {
    // upright and leaning 30 deg: nothing; folded 70 deg from 5 s to 12 s: told after the warm-up, fixed after
    const calm = feed(new MoveForm({ key }), t => kneelBody({ lean: t < 6000 ? 0 : 30 }), 14000);
    assert.deepEqual(calm, [], key);
    const evs = feed(new MoveForm({ key }), t => kneelBody({ lean: t >= 5000 && t < 12000 ? 70 : 5 }), 18000);
    assert.deepEqual(kinds(evs), [['form_fault', 'torso_fold', 'trunk', null], ['form_fix', 'torso_fold', null, null]],
      key);
    assert.match(evs[0].measured, /^torso leaning 70 degrees forward while kneeling$/);
    assert.ok(evs[0].at >= 5000 + K.SMOOTH_MS / 2 + K.FAULT_MS - 2 * DT && evs[0].at < 8000, `${evs[0].at}`);
    // the same lean standing, or in a squat, is not this movement's fault
    const standing = feed(new MoveForm({ key }), () => kneelBody({ stand: true, lean: 70 }), 12000);
    const squatting = feed(new MoveForm({ key }), () => kneelBody({ squat: true, lean: 70 }), 12000);
    assert.deepEqual([...standing, ...squatting], [], key);
  }
});

test('made-up: the front knee caving in is told on its side, mirrored the other; not from the side', () => {
  for (const key of KEYS) {
    const only = (o, f = x => x) => kinds(feed(new MoveForm({ key }), () => f(kneelBody(o)), 10000));
    assert.deepEqual(only({ kneeIn: 0.2 }), [['form_fault', 'front_knee_in', 'knee', 'right']], key);
    assert.deepEqual(only({ kneeIn: 0.2 }, mirror), [['form_fault', 'front_knee_in', 'knee', 'left']], key);
    // 0.1 m in (0.11 leg lengths): inside the line; and turned side-on the knee's place side to side is a guess
    assert.deepEqual(only({ kneeIn: 0.1 }), [], key);
    const side = new MoveForm({ key });
    assert.deepEqual(feed(side, () => kneelBody({ kneeIn: 0.2, turn: 90 }), 10000), [], key);
    assert.deepEqual(side.state().wrongView, ['front knee over the foot'], key);
    // ...and both at once: the torso first (order), the knee NEXT_MS later
    const both = feed(new MoveForm({ key }), () => kneelBody({ kneeIn: 0.2, lean: 70 }), 16000);
    assert.deepEqual(kinds(both), [['form_fault', 'torso_fold', 'trunk', null],
      ['form_fault', 'front_knee_in', 'knee', 'right']], key);
    assert.ok(Math.abs(both[1].at - both[0].at - K.NEXT_MS) <= DT, key);
  }
});

test('made-up: a kneel held still is judged once the person has moved, through a pause; never before', () => {
  for (const key of KEYS) {
    // kneeling folded and still from the start, never moving since the movement was named: nothing
    const rest = new MoveForm({ key });
    assert.deepEqual(feed(rest, () => kneelBody({ lean: 70 }), 12000, () => false), [], key);
    // a second of movement getting down, then the fold held still 10 s (a pause from 6 s): told FAULT_MS after the
    // first SETTLE_MS of the kneel (no warm-up), and its fix still noticed, held still in the pause
    const held = new MoveForm({ key });
    const evs = feed(held, t => (t < 1000 ? kneelBody({ stand: true }) : kneelBody({ lean: t < 8000 ? 70 : 5 })),
      14000, t => t < 1000);
    assert.deepEqual(kinds(evs), [['form_fault', 'torso_fold', 'trunk', null], ['form_fix', 'torso_fold', null, null]],
      key);
    assert.ok(Math.abs(evs[0].at - (1000 + K.SETTLE_MS + K.FAULT_MS)) <= 2 * DT, `${key}: told at ${evs[0].at}`);
    assert.ok(evs[1].at > 8000 + K.FIX_MS && evs[1].at < 8000 + K.SMOOTH_MS + K.FIX_MS, `${key}: fixed ${evs[1].at}`);
    // standing still after moving is no kneel: nothing judged
    const stand = new MoveForm({ key });
    feed(stand, () => kneelBody({ stand: true, lean: 70 }), 8000, t => t < 1000);
    assert.deepEqual(stand.summary(), { checked: [], faults: [] }, key);
  }
});

// --- the library's references (private) ----------------------------------------------------------------------------
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const libFile = path.join(DATA, 'moves', 'library.json');
const library = fs.existsSync(libFile) ? readJson(libFile).movements : [];
const catalogFile = path.join(DATA, 'moves', 'catalog.json');
const catalog = fs.existsSync(catalogFile) ? readJson(catalogFile) : null;
const movementOf = key => library.find(x => x.key === key)
  ?? { key, display: key, kind: 'transition', track: 'moving' };
/** The reference skeleton of a library movement ({fps, joints}), from its dump or its npz; null if neither is here. */
function skeletonOf(key) {
  const m = library.find(x => x.key === key);
  if (!m) return null;
  const dump = path.join(DATA, 'moves', 'skel', `${m.id}.json`);
  if (fs.existsSync(dump)) return readJson(dump);
  const npz = catalog && path.join(catalog.source, m.id, 'source', 'skeleton_motion.npz');
  return npz && fs.existsSync(npz) ? skeletonFromNpz(fs.readFileSync(npz)) : null;
}
const mpIndexFile = path.join(DATA, 'moves', 'mp', 'index.json');
const mpIndex = fs.existsSync(mpIndexFile) ? readJson(mpIndexFile) : [];
/** MediaPipe on the library's footage of an index entry ({frames: [{t, image, world}], width, height}), or null. */
const seriesOf = entry => {
  const file = entry?.series && path.join(ROOT, entry.series);
  return file && fs.existsSync(file) ? readJson(file) : null;
};
const footageOf = key => {
  const m = library.find(x => x.key === key);
  return m ? seriesOf(mpIndex.find(e => e.id === m.id)) : null;
};
const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
/** A recording's frames as [{t (ms from its first), lm (null: nobody)}]. */
const framesOf = rec => rec.frames.map(fr => ({ t: fr.t - rec.frames[0].t,
  lm: fr.world && fr.image ? { world: obj(fr.world), image: obj(fr.image), aspect: rec.width / rec.height } : null }));
const skeletonFrames = skel => skeletonLandmarks(skel).map(x => ({ t: x.t,
  lm: { world: x.world, image: x.image, aspect: ASPECT } }));
/** One kneel and stand-up of a movement's clip: kneel_and_stand's starts and ends standing; the half-kneel's starts
 * kneeling, so it is played backwards first (standing, kneeling down into it), then as it is (the rise). */
function oneRep(key, frames) {
  if (key !== 'half_kneel_to_stand') return frames;
  const dt = frames[1].t - frames[0].t;
  return [...[...frames].reverse(), ...frames].map((x, i) => ({ t: i * dt, lm: x.lm }));
}
/** Frames played `rounds` times, `speed` times their pace, `mirrored`, `jitter` added. */
function play(frames, { speed = 1, rounds = 1, mirrored = false, jitter = false } = {}) {
  const seq = [];
  for (let r = 0; r < rounds; r++) seq.push(...frames);
  const dt = (frames[1].t - frames[0].t) / speed;
  return seq.map((x, i) => {
    let lm = x.lm && (mirrored ? mirror(x.lm) : x.lm);
    if (lm && jitter) lm = jittered(lm);
    return { t: i * dt, lm };
  });
}
/** Frames `b` played after frames `a`. */
const then = (a, b) => {
  const t0 = a.at(-1).t + (a[1].t - a[0].t);
  return [...a, ...b.map(x => ({ ...x, t: x.t + t0 }))];
};
/** Through the movement tracker with the landmarks, as the page runs it: its form events and, per check, the frames it
 * was judged on, and the time it was judged (`judgedMs`) of the time it could have been (`phaseMs`: its parts in view,
 * from a view it takes, its phase holding). */
// what the guard rails tell (a fault, its fix); form_unseen (the movement's parts out of view: "step back") is the
// framework's prompt, not a guard rail's verdict
const TOLD = new Set(['form_fault', 'form_fix']);
function tracked(key, frames) {
  const tr = new MovementTracker({ movement: movementOf(key) }), evs = [], judged = {}, judgedMs = {}, phaseMs = {};
  let lastT = null;
  for (const { t, lm } of frames) {
    const dt = lastT === null ? 0 : t - lastT;
    lastT = t;
    const out = lm ? tr.update(features(lm.world, lm.image, lm.aspect), t, lm) : tr.lost(t);
    evs.push(...out.filter(e => TOLD.has(e.type)).map(e => ({ ...e, at: t })));
    const m = lm && metricsOf(lm);
    for (const c of tr.mf.checks) {
      if (m && c.needs.every(p => m.seen[p]) && (!c.views || c.views.includes(m.view)) && c.phase(m, lm)) {
        phaseMs[c.id] = (phaseMs[c.id] ?? 0) + dt;
      }
      if (tr.mf.s[c.id].measuredT !== t) continue;
      judged[c.id] = (judged[c.id] ?? 0) + 1;
      judgedMs[c.id] = (judgedMs[c.id] ?? 0) + dt;
    }
  }
  return { tr, evs, judged, judgedMs, phaseMs };
}
/** How much of each kneel the tracker judged (`tracked`): the share of the time each check could be judged, at the
 * least. Not all: a still check waits for the person's first movement since the movement was named, and each time its
 * phase starts holding its first SETTLE_MS are not judged. */
const coverage = r => Math.min(...r.tr.mf.checks.map(c => (r.judgedMs[c.id] ?? 0) / (r.phaseMs[c.id] ?? NaN)));
/** Every frame judged (MoveForm on its own: every frame moving, no warm-up): its events and, per check, the frames
 * judged, those whose smoothed value was not fine (`c.ok`), and the largest smoothed value. */
function everyFrame(key, frames) {
  const mf = new MoveForm({ key, tuning: { WARM_MS: 0 } }), evs = [], judged = {}, notOk = {}, worst = {};
  for (const { t, lm } of frames) {
    evs.push(...mf.update(lm && metricsOf(lm), lm, t).filter(e => TOLD.has(e.type)).map(e => ({ ...e, at: t })));
    for (const c of mf.checks) {
      const s = mf.s[c.id];
      if (s.measuredT !== t) continue;
      judged[c.id] = (judged[c.id] ?? 0) + 1;
      if (!c.ok(s.value)) notOk[c.id] = (notOk[c.id] ?? 0) + 1;
      worst[c.id] = Math.max(worst[c.id] ?? -Infinity, s.value);
    }
  }
  return { mf, evs, judged, notOk, worst };
}
// the front leg of each reference, as the person's own: the kneel's on its left knee, the half-kneel's on its right
const FRONT = { kneel_and_stand: 'right', half_kneel_to_stand: 'left' };
const PLAYS = [{}, { speed: 2 }, { mirrored: true }, { jitter: true }, { rounds: 3 }, { rounds: 3, speed: 2 },
  { rounds: 3, mirrored: true, jitter: true }, { rounds: 3, speed: 2, mirrored: true, jitter: true }];
const refs = Object.fromEntries(KEYS.map(k => [k, skeletonOf(k)]));

for (const key of KEYS) {
  const skel = refs[key];
  test(`${key}: the reference raises nothing at its own pace or twice it, mirrored, with jitter, once or round after `
    + 'round, through the tracker (most of each kneel judged) or with every frame judged',
  { skip: !skel && 'no reference skeleton here' }, t => {
    const frames = oneRep(key, skeletonFrames(skel));
    for (const o of PLAYS) {
      const what = JSON.stringify(o), seq = play(frames, o);
      const r = tracked(key, seq);
      assert.deepEqual(r.evs, [], `tracker ${what}`);
      assert.deepEqual(r.tr.summary().form.faults, [], `tracker ${what}`);
      // (judged without the still flag: none of the kneel of either reference played once, 11-40% of the kneels
      // played round after round; with it, 79-96%)
      assert.ok(coverage(r) >= 0.75, `${what}: ${coverage(r)} of the kneel judged`);
      t.diagnostic(`${what}: ${Math.round(100 * coverage(r))}% of the kneel judged`);
      // every kneeling frame judged: each check measured on most of the kneel, and fine on every frame of it
      const all = everyFrame(key, seq);
      assert.deepEqual(all.evs, [], `every frame ${what}`);
      for (const c of TRANSITIONS[key]) {
        assert.ok(all.judged[c.id] >= 80 * (o.rounds ?? 1), `${c.id} ${what}: ${all.judged[c.id]} frames judged`);
        assert.equal(all.notOk[c.id] ?? 0, 0, `${c.id} ${what}: not fine on ${all.notOk[c.id]} frames`);
      }
    }
  });
}

// --- faults put in on purpose (private) ----------------------------------------------------------------------------
// The reference skeletons (SMPL joints, y up) changed: the trunk folded forward, or the front knee moved in, on the
// frames where they kneel.
const copyJoints = J => Object.fromEntries(Object.entries(J).map(([k, v]) => [k, v.map(p => [...p])]));
/** How far into the kneel frame i is: 1 with the lower knee within 0.3 leg lengths of the lowest foot joint, 0 from
 * 0.5 (standing: about 0.55). */
function kneelWeight(J, i) {
  const floor = Math.min(...['left_ankle', 'right_ankle', 'left_foot', 'right_foot'].map(k => J[k][i][1]));
  const legOf = s => Math.hypot(...sub(J[`${s}_hip`][i], J[`${s}_knee`][i]))
    + Math.hypot(...sub(J[`${s}_knee`][i], J[`${s}_ankle`][i]));
  const low = (Math.min(J.left_knee[i][1], J.right_knee[i][1]) - floor) / ((legOf('left') + legOf('right')) / 2);
  return clamp01((0.5 - low) / 0.2);
}
/** The trunk, head and arms folded forward `deg` about the hips' line, as far as the frame kneels. */
function foldedForward(skel, deg) {
  const J = skel.joints, out = copyJoints(J);
  for (let i = 0; i < J.pelvis.length; i++) {
    const w = kneelWeight(J, i);
    if (!w) continue;
    const hl = sub(J.left_hip[i], J.right_hip[i]), axis = norm([hl[0], 0, hl[2]]);
    const c = add(J.left_hip[i], sub(J.right_hip[i], J.left_hip[i]), 0.5);
    for (const k of ['neck', 'head', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist',
      'right_wrist']) out[k][i] = add(rot(sub(J[k][i], c), axis, deg * w), c);
  }
  return { fps: skel.fps, joints: out };
}
/** The knee of `side` ('left' / 'right') moved `metres` in toward the other leg, as far as it is bent (fully from 120
 * deg, not at all straight). */
function kneeMovedIn(skel, side, metres) {
  const J = skel.joints, out = copyJoints(J), o = side === 'left' ? 'right' : 'left';
  for (let i = 0; i < J.pelvis.length; i++) {
    const kn = J[`${side}_knee`][i], bend = angle(sub(J[`${side}_hip`][i], kn), sub(J[`${side}_ankle`][i], kn));
    const inward = sub(J[`${o}_hip`][i], J[`${side}_hip`][i]);
    out[`${side}_knee`][i] = add(kn, norm([inward[0], 0, inward[2]]), metres * clamp01((150 - bend) / 30));
  }
  return { fps: skel.fps, joints: out };
}
const otherSide = s => (s === 'left' ? 'right' : 'left');

for (const key of KEYS) {
  const skel = refs[key];
  test(`${key}: a torso folded 60 deg forward kneeling, and the front knee 20 cm in, are each told alone and on its `
    + 'side through the tracker at the movement\'s own pace and twice it, and fixed', {
    skip: !skel && 'no reference skeleton here' }, () => {
    const faults = [['torso_fold', 'trunk', null, foldedForward(skel, 60)],
      ['front_knee_in', 'knee', FRONT[key], kneeMovedIn(skel, FRONT[key], 0.2)]];
    const clean = oneRep(key, skeletonFrames(skel));
    for (const [id, part, side, bad] of faults) {
      const frames = oneRep(key, skeletonFrames(bad));
      for (const o of PLAYS) {
        const mirrored = !!o.mirrored, what = `${id} ${JSON.stringify(o)}`;
        const want = [['form_fault', id, part, side && mirrored ? otherSide(side) : side]];
        // through the tracker, as the page runs it: told on the first kneel, the summary saying so
        const { tr, evs } = tracked(key, play(frames, o));
        assert.deepEqual(kinds(evs), want, `tracker ${what}`);
        assert.equal(evs[0].key, key);
        assert.ok(evs[0].at < play(frames, { ...o, rounds: 1 }).at(-1).t, `${what}: told at ${evs[0].at}`);
        assert.deepEqual(tr.summary().form.faults, [{ fault: id, label: checkOf(key, id).label, fixed: false,
          told: true }], what);
        // ...then the reference's own form: fixed
        const fixed = tracked(key, then(play(frames, o), play(clean, o)));
        assert.deepEqual(kinds(fixed.evs), [...want, ['form_fix', id, null, null]], `fixed ${what}`);
        // with every frame judged, the same, and nothing else even close to its line
        const all = everyFrame(key, play(frames, o));
        assert.deepEqual(kinds(all.evs), want, `every frame ${what}`);
        for (const c of TRANSITIONS[key]) if (c.id !== id) assert.equal(all.notOk[c.id] ?? 0, 0, `${what}: ${c.id}`);
      }
    }
  });
}

// --- MediaPipe on the library's footage (private) ------------------------------------------------------------------
for (const key of KEYS) {
  const rec = footageOf(key);
  test(`${key}: MediaPipe on the library's footage of it raises nothing, through the tracker (most of each kneel `
    + 'judged) or with every frame judged, mirrored too', { skip: !rec && 'no footage here' }, () => {
    for (const o of [{}, { mirrored: true }, { rounds: 3 }, { rounds: 3, speed: 2 }]) {
      const seq = play(oneRep(key, framesOf(rec)), o), what = JSON.stringify(o), r = tracked(key, seq);
      assert.deepEqual(r.evs, [], `tracker ${what}`);
      assert.ok(coverage(r) >= 0.75, `${what}: ${coverage(r)} of the kneel judged`);
      const all = everyFrame(key, seq);
      assert.deepEqual(all.evs, [], `every frame ${what}`);
      for (const c of TRANSITIONS[key]) {
        assert.ok(all.judged[c.id] >= 60 * (o.rounds ?? 1), `${c.id} ${what}: ${all.judged[c.id]} judged`);
        assert.equal(all.notOk[c.id] ?? 0, 0, `${c.id} ${what}: not fine on ${all.notOk[c.id]} frames`);
      }
    }
  });
}
// The library's footage of a low lunge on the back knee, folding the hands down to the mat (not a library movement):
// a torso folded forward while kneeling, as MediaPipe sees it (from the side). Named as either movement, the fold is
// told and nothing else, through the tracker (held still, judged as a still check is) or with every frame judged.
const foldFootage = mpIndex.filter(e => /kneel/i.test(e.name) && /fold/i.test(e.name)).map(seriesOf).find(Boolean);
test('MediaPipe on the library\'s footage of a fold while kneeling: the torso told, nothing else',
  { skip: !foldFootage && 'no footage here' }, () => {
    for (const key of KEYS) {
      for (const mirrored of [false, true]) {
        const seq = play(framesOf(foldFootage), { mirrored }), what = `${key} ${mirrored}`;
        assert.deepEqual(kinds(tracked(key, seq).evs), [['form_fault', 'torso_fold', 'trunk', null]], what);
        const all = everyFrame(key, seq);
        assert.deepEqual(kinds(all.evs), [['form_fault', 'torso_fold', 'trunk', null]], what);
        assert.ok(all.worst.torso_fold > 60, `${all.worst.torso_fold}`);
      }
    }
  });

// --- the user's own recordings (private) ---------------------------------------------------------------------------
// None of them kneels: squats, lunges, push-ups, jumping jacks, held poses, standing, resting, walking to the camera.
// Each movement named over the whole of each recording: nothing told, through the tracker or with every frame judged.
// (On them the kneeling phase holds on the lunges, judged, the trunk within 7 deg of upright, the front knee within
// 0.02 leg lengths of the foot; and on a few frames at a time of bending to the floor or towards the camera,
// MediaPipe's trunk 56-72 deg forward there, each shorter than SETTLE_MS: never judged.)
const liveDir = path.join(DATA, 'posedata', 'results', 'live');
const liveFiles = fs.existsSync(liveDir)
  ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')).sort().map(f => path.join(liveDir, f)) : [];
test('the user\'s recordings, each movement named over the whole of each: nothing told', {
  skip: !liveFiles.length && 'no recording here' }, t => {
  for (const file of liveFiles) {
    const frames = framesOf(readJson(file)), name = path.basename(file, '.json');
    for (const key of KEYS) {
      const { tr, evs, judged } = tracked(key, frames);
      assert.deepEqual(evs, [], `${name} ${key}: tracker`);
      assert.deepEqual(tr.summary().form?.faults ?? [], [], `${name} ${key}`);
      const all = everyFrame(key, frames);
      assert.deepEqual(all.evs, [], `${name} ${key}: every frame`);
      const said = c => `${c.id} judged ${judged[c.id] ?? 0} (every frame: ${all.judged[c.id] ?? 0}, worst `
        + `${Number.isFinite(all.worst[c.id]) ? all.worst[c.id].toFixed(2) : '-'})`;
      t.diagnostic(`${name} ${key}: ${TRANSITIONS[key].map(said).join(', ')}`);
    }
  }
});
