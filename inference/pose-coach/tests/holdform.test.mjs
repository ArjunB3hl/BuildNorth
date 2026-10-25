// A held pose's form (web/js/holdform.js): the measures of one frame, on made-up MediaPipe-like landmarks (a triangle
// pose built from its angles, mirrored, turned to the side, partly out of view); the checks on the library's
// reference skeletons and on MediaPipe over the library's own footage of the three poses (private: .data/, skipped when
// not on this machine); faults told once they last, one at a time, and their fixes; what the form says now (pending,
// out of the frame, the wrong view); and the user's recorded triangle holds, through the movement tracker as the page
// runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { bonesFor } from '../web/js/formcheck.js';
import { FORM_TUNING, HOLD_FORMS, HoldForm, IN_POSE, InPose, SEEN, poseMetrics } from '../web/js/holdform.js';
import { MovementTracker, TUNING } from '../web/js/moves.js';
import { faultBones, faultParts } from '../web/js/retarget.js';
import { skeletonFromNpz } from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const FPS = 30, DT = 1000 / FPS, ASPECT = 16 / 9, S = 2.4;   // S: metres from the picture's top to its bottom

// --- made-up landmarks ---------------------------------------------------------------------------------------------
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const rad = d => (d * Math.PI) / 180;
/** v turned by `deg` in the picture's plane (about z; y down: positive turns +x towards down). */
const rotZ = (v, deg) => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
/** v turned by `deg` about the unit axis k (Rodrigues). */
function rot(v, k, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c));
}
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

/** MediaPipe-like landmarks from points {index: [x, y, z]}: world in metres around the hips' middle (y down, x the
 * person's left as a camera in front sees them), image from an orthographic camera in front, the hips at 55% of the
 * picture's height. `vis`: visibility by landmark index (default 1); `jitter`: metres of noise (MediaPipe's on a still
 * person is a few mm). */
function landmarks(P, { vis = {}, jitter = 0.003, turn = 0, shiftY = 0 } = {}) {
  const world = [], image = [];
  for (let i = 0; i < 33; i++) {
    let p = P[i] ?? P[0];
    const c = Math.cos(rad(turn)), s = Math.sin(rad(turn));
    if (turn) p = [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];         // turned about the vertical
    p = [p[0] + jitter * rnd(), p[1] + jitter * rnd(), p[2] + jitter * rnd()];
    world.push({ x: p[0], y: p[1], z: p[2] });
    image.push({ x: 0.5 + p[0] / (S * ASPECT), y: 0.55 + shiftY + p[1] / S, z: 0, visibility: vis[i] ?? 1 });
  }
  return { world, image, aspect: ASPECT };
}

/** The points of a triangle pose facing the camera (legs 0.9 m, trunk 0.5 m, arms 0.6 m): feet `stance` leg lengths
 * apart, the trunk tipped `tilt` deg over the `front` leg, the top arm `topArm` deg from straight up and the bottom one
 * `bottomArm` deg from straight down (the other way: the default, topArm, makes one line), the chest turned `chest` deg
 * about the trunk towards the floor (its facing then points asin(sin chest * sin tilt) below level: the trunk is
 * tipped, so the chest never faces straight down), the front knee bent by `kneeBend` deg (the back one: `bentLeg`
 * 'back'). tilt 0 and both arms down: standing. */
function triangle(o = {}) {
  const { stance = 1.1, tilt = 60, topArm = 10, bottomArm = null, chest = 0, kneeBend = 0, front = 'L' } = o;
  const sg = front === 'L' ? 1 : -1, bentSg = o.bentLeg === 'back' ? -sg : sg, P = {};
  P[23] = [0.1, 0, 0]; P[24] = [-0.1, 0, 0];
  const a = Math.asin(Math.max(0, Math.min(1, (stance * 0.9 - 0.2) / 1.8)));
  for (const [hip, kn, an, heel, toe, sx] of [[23, 25, 27, 29, 31, 1], [24, 26, 28, 30, 32, -1]]) {
    const d = [sx * Math.sin(a), Math.cos(a), 0], b = rad(sx === bentSg ? kneeBend / 2 : 0);
    P[kn] = add(P[hip], [d[0] * Math.cos(b), d[1] * Math.cos(b), -Math.sin(b)], 0.45);   // a bent knee comes forward
    P[an] = add(P[hip], d, 0.9 * Math.cos(b));
    P[heel] = add(P[an], [0, 0.04, 0.05]); P[toe] = add(P[an], [0, 0.06, -0.15]);
  }
  const u = rotZ([0, -1, 0], sg * tilt);                     // hips to shoulders
  let e = rotZ([1, 0, 0], sg * tilt);                        // right shoulder to left
  if (chest) e = rot(e, u, sg * chest);
  const sh = add([0, 0, 0], u, 0.5);
  P[11] = add(sh, e, 0.18); P[12] = add(sh, e, -0.18);
  const topSh = front === 'L' ? 12 : 11;                    // the shoulder away from the lean
  const up = rotZ([0, -1, 0], sg * topArm), down = rotZ([0, 1, 0], sg * (bottomArm ?? topArm));
  const arm = (shI, elI, wrI, dir) => { P[elI] = add(P[shI], dir, 0.3); P[wrI] = add(P[shI], dir, 0.6); };
  if (topSh === 12) { arm(12, 14, 16, up); arm(11, 13, 15, down); } else { arm(11, 13, 15, up); arm(12, 14, 16, down); }
  for (const [w, hs] of [[15, [17, 19, 21]], [16, [18, 20, 22]]]) for (const h of hs) P[h] = P[w];
  P[0] = add(add(sh, u, 0.22), [0, 0, -0.1]); P[7] = add(P[0], e, 0.07); P[8] = add(P[0], e, -0.07);
  return P;
}
const standing = (o = {}) => triangle({ stance: 0.25, tilt: 0, topArm: 180, bottomArm: 0, ...o });
/** The one-legged poses, from standing() (`o`: its options, e.g. the trunk's `tilt`): the quad stretch, the left heel
 * pulled up behind (the thigh straight down, or `thigh` deg forward of it; the knee bent to `knee` deg; the standing
 * knee bent by `standBend` deg); the figure-four, the left ankle crossed just in front of the right knee (or `drop`
 * metres below that), the left knee out to the side. */
function quad({ knee = 45, thigh = 0, standBend = 0, ...o } = {}) {
  const P = standing(standBend ? { kneeBend: standBend, front: 'R', ...o } : o);
  const fwd = v => rot(v, [1, 0, 0], -thigh);                 // turned about the hips' line: forward is -z
  P[25] = add(P[23], fwd([0, 1, 0]), 0.45);
  P[27] = add(P[25], fwd([0, -Math.cos(rad(knee)), Math.sin(rad(knee))]), 0.45);
  P[29] = P[27]; P[31] = P[27];
  return P;
}
function figureFour({ drop = 0, ...o } = {}) {
  const P = standing(o), H = P[23], A = add(P[26], [0.03, -0.03, -0.06]);
  // the knee a thigh's length (0.45 m) from the hip and a shin's from the ankle, out to the left and forward
  const d = add(A, H, -1), dl = Math.hypot(...d), u = d.map(v => v / dl), w = [1, 0, -0.3];
  const n = add(w, u, -(w[0] * u[0] + w[1] * u[1] + w[2] * u[2])), nl = Math.hypot(...n);
  P[25] = add(add(H, d, 0.5), n, Math.sqrt(0.45 ** 2 - (dl / 2) ** 2) / nl);
  P[27] = add(A, [0, drop, 0]); P[29] = P[27]; P[31] = P[27];
  return P;
}

/** Mirrored: the person's left and right swapped (the same pose on the other side). */
function mirror(lm) {
  const sw = Array.from({ length: 33 }, (_, i) => i);
  for (const [a, b] of PAIRS) { sw[a] = b; sw[b] = a; }
  return { aspect: lm.aspect, world: sw.map(j => ({ ...lm.world[j], x: -lm.world[j].x })),
    image: sw.map(j => ({ ...lm.image[j], x: 1 - lm.image[j].x })) };
}
const metricsOf = lm => poseMetrics(lm.world, lm.image, lm.aspect);

/** Feed a HoldForm frames from `frameAt(t)` (landmarks, or null for nobody) from `from` to `to` ms at 30 fps; returns
 * its events, each with `at`. */
function feed(hf, frameAt, to, from = 0) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += DT) {
    const lm = frameAt(t);
    out.push(...hf.update(lm ? metricsOf(lm) : null, t).map(e => ({ ...e, at: t })));
  }
  return out;
}
const faultsOf = evs => evs.filter(e => e.type === 'hold_fault').map(e => e.fault);

// --- one frame's measures ------------------------------------------------------------------------------------------
test('poseMetrics: a made-up triangle measures as it was built, either side', () => {
  const m = metricsOf(landmarks(triangle({ stance: 1.1, tilt: 60, topArm: 10 }), { jitter: 0 }));
  assert.ok(Math.abs(m.stance - 1.1) < 0.01, `stance ${m.stance}`);
  assert.ok(Math.abs(m.topArmFromUp - 10) < 0.5, `top arm ${m.topArmFromUp}`);
  assert.ok(m.armsLine > 179, `arms ${m.armsLine}`);
  assert.ok(Math.abs(m.trunkTilt - 60) < 0.5, `tilt ${m.trunkTilt}`);
  assert.ok(Math.abs(m.chestDown) < 1, `chest ${m.chestDown}`);
  assert.ok(m.kneeMin > 179, `knees ${m.kneeMin}`);
  assert.deepEqual([m.front, m.top], ['L', 'R']);
  assert.ok(Object.values(m.seen).every(Boolean));
  assert.equal(m.view, 'angled');                            // stacked shoulders are narrow on screen
  // the other side: the same numbers, the sides swapped
  for (const lm of [landmarks(triangle({ front: 'R' }), { jitter: 0 }), mirror(landmarks(triangle(), { jitter: 0 }))]) {
    const q = metricsOf(lm);
    assert.deepEqual([q.front, q.top], ['R', 'L']);
    for (const k of ['stance', 'topArmFromUp', 'armsLine', 'trunkTilt', 'chestDown', 'kneeMin']) {
      assert.ok(Math.abs(q[k] - m[k]) < 0.5, `${k}`);
    }
  }
  // each fault measures as built
  const f = o => metricsOf(landmarks(triangle(o), { jitter: 0 }));
  assert.ok(Math.abs(f({ stance: 0.45 }).stance - 0.45) < 0.01);
  assert.ok(Math.abs(f({ topArm: 60 }).topArmFromUp - 60) < 0.5);
  assert.ok(Math.abs(f({ topArm: 0, bottomArm: -60 }).armsLine - 120) < 0.5);
  const down = (c, t = 60) => (Math.asin(Math.sin(rad(c)) * Math.sin(rad(t))) * 180) / Math.PI;
  assert.ok(Math.abs(f({ chest: 60 }).chestDown - down(60)) < 1, `${f({ chest: 60 }).chestDown}`);
  assert.ok(Math.abs(f({ chest: -30 }).chestDown - down(-30)) < 1, 'turned up: negative');
  assert.ok(Math.abs(f({ kneeBend: 60 }).kneeMin - 120) < 0.5);
  assert.ok(Math.abs(f({ kneeBend: 60 }).kneeFront - 120) < 0.5);
  assert.equal(poseMetrics(null, null), null);
});

test('poseMetrics: a part out of the frame or barely visible is unseen; from the side the view says so', () => {
  const ok = metricsOf(landmarks(triangle()));
  assert.equal(ok.seen.legs, true);
  // an ankle below the picture's edge: unseen whatever its score (as engine.js)
  const low = metricsOf(landmarks(triangle(), { shiftY: 0.1 }));
  assert.equal(low.seen.legs, false);
  assert.equal(low.seen.arms, true);
  // the visibility score: SEEN and above counts
  assert.equal(metricsOf(landmarks(triangle(), { vis: { 28: SEEN - 0.05 } })).seen.legs, false);
  assert.equal(metricsOf(landmarks(triangle(), { vis: { 28: SEEN + 0.05 } })).seen.legs, true);
  // the top arm hidden: topArm and arms unseen
  const arm = metricsOf(landmarks(triangle(), { vis: { 16: 0.1 } }));
  assert.deepEqual([arm.seen.topArm, arm.seen.arms, arm.seen.trunk], [false, false, true]);
  // turned a quarter: a side view
  assert.equal(metricsOf(landmarks(triangle(), { turn: 90 })).view, 'side');
  assert.equal(metricsOf(landmarks(standing())).view, 'front');
});

// --- the checks ----------------------------------------------------------------------------------------------------
test('HOLD_FORMS: every check has what the coach and the page need', () => {
  for (const [key, checks] of Object.entries(HOLD_FORMS)) {
    const ids = new Set();
    for (const c of checks) {
      for (const f of ['id', 'name', 'label', 'target', 'cue']) assert.equal(typeof c[f], 'string', `${c.id}.${f}`);
      for (const f of ['value', 'bad', 'ok', 'measured']) assert.equal(typeof c[f], 'function', `${key}.${c.id}.${f}`);
      assert.ok(Number.isFinite(c.order) && Array.isArray(c.needs) && c.needs.length, `${key}.${c.id}`);
      assert.ok(!ids.has(c.id)); ids.add(c.id);
      for (const id of c.after ?? []) assert.ok(checks.some(x => x.id === id), `${key}.${c.id} after ${id}`);
      assert.ok(c.label.split(' ').length <= 6 && c.cue.length < 90, `${key}.${c.id}: short words`);
    }
  }
  assert.deepEqual(Object.keys(HOLD_FORMS).sort(), ['figure_four_balance', 'quad_stretch', 'triangle_pose']);
  assert.throws(() => new HoldForm({ key: 'made_up' }));
});

test('a good triangle, either side: nothing told, every check measured and fine', () => {
  for (const front of ['L', 'R']) {
    const hf = new HoldForm({ key: 'triangle_pose' });
    const good = triangle({ front, stance: 1.1, topArm: 12, bottomArm: 25, tilt: 58, chest: 10 });
    const evs = feed(hf, () => landmarks(good), 20000);
    assert.deepEqual(evs, []);
    assert.deepEqual(hf.state(), { checked: HOLD_FORMS.triangle_pose.map(c => c.name), open: [], pending: [],
      unseen: [], wrongView: [] });
    assert.deepEqual(hf.summary(), { checked: HOLD_FORMS.triangle_pose.map(c => c.name), faults: [] });
  }
});

test('each triangle fault alone is caught, measured and told with its cue and the part to show', () => {
  // the part's side: of the front leg's side or the back one's (the top arm: away from the lean), or none
  const cases = [
    [{ stance: 0.45 }, 'stance', /feet 0\.4\d leg lengths apart/, 'feet', null],
    [{ kneeBend: 60 }, 'knees', /knee bent to 12\d degrees/, 'knee', 'front'],
    [{ kneeBend: 60, bentLeg: 'back' }, 'knees', /knee bent to 12\d degrees/, 'knee', 'back'],
    [{ topArm: 60 }, 'top_arm', /top arm 6\d degrees from straight up/, 'arm', 'back'],
    [{ tilt: 25 }, 'trunk_tilt', /trunk tipped 2\d degrees/, 'torso', null],
    [{ topArm: 5, bottomArm: -55 }, 'arms_line', /arms 6\d degrees off one line/, 'arms', null],
    [{ chest: 70 }, 'chest', /chest turned 5\d degrees toward the floor/, 'chest', null],
  ];
  for (const [o, id, measured, part, of] of cases) {
    for (const front of ['L', 'R']) {
      const hf = new HoldForm({ key: 'triangle_pose' });
      const evs = feed(hf, () => landmarks(triangle({ front, ...o })), 20000);
      assert.deepEqual(faultsOf(evs), [id], `${JSON.stringify(o)} ${front}: ${faultsOf(evs)}`);
      const e = evs[0], c = HOLD_FORMS.triangle_pose.find(x => x.id === id);
      assert.ok(e.at >= FORM_TUNING.FAULT_MS && e.at <= FORM_TUNING.FAULT_MS + 300, `told at ${e.at}`);
      assert.match(e.measured, measured);
      assert.deepEqual([e.label, e.target, e.cue], [c.label, c.target, c.cue]);
      const side = of && ((of === 'front') === (front === 'L') ? 'left' : 'right');
      assert.deepEqual([e.part, e.side], [part, side], `${id} ${front}`);
      const st = hf.state();
      assert.deepEqual(st.open.map(f => f.fault), [id]);
      assert.deepEqual([st.open[0].part, st.open[0].side], [part, side]);   // (hold_start's form.open: the same)
      // the rest measured and fine (the chest only once tipped into the pose)
      const rest = HOLD_FORMS.triangle_pose.filter(x => x.id !== id && (x.id !== 'chest' || (o.tilt ?? 60) >= 35));
      assert.deepEqual(st.checked, rest.map(x => x.name));
      assert.deepEqual(hf.summary().faults, [{ fault: id, label: c.label, fixed: false, told: true }]);
    }
  }
});

test('the top arm off bends the arms\' line too: told once, as the top arm', () => {
  const hf = new HoldForm({ key: 'triangle_pose' });
  // top arm 50 deg off, the bottom one straight down: the arms 130 deg apart, a fault of its own were it alone
  let evs = feed(hf, () => landmarks(triangle({ topArm: 50, bottomArm: 0 })), 30000);
  assert.ok(metricsOf(landmarks(triangle({ topArm: 50, bottomArm: 0 }))).armsLine < 140);
  assert.deepEqual(faultsOf(evs), ['top_arm']);
  assert.deepEqual(hf.summary().faults.map(f => f.fault), ['top_arm']);
  // the top arm straightened: both fixed, the top arm's fix praised, nothing more told
  evs = feed(hf, () => landmarks(triangle({ topArm: 10 })), 40000, 30000 + DT);
  assert.deepEqual(evs.map(e => `${e.type}:${e.fault}`), ['hold_fix:top_arm']);
  assert.deepEqual(hf.summary().faults, [{ fault: 'top_arm', label: 'top arm not straight up', fixed: true,
    told: true }]);
});

test('a part out of view is unseen, neither bad nor good; nothing frontal is judged from the side', () => {
  // the feet below the picture's edge, the stance far too narrow: not told, listed unseen (not wrong-view: stepping
  // back shows them)
  let hf = new HoldForm({ key: 'triangle_pose' });
  let evs = feed(hf, () => landmarks(triangle({ stance: 0.3 }), { shiftY: 0.1 }), 15000);
  assert.deepEqual(evs, []);
  assert.deepEqual([hf.state().unseen, hf.state().wrongView], [['stance width', 'long legs'], []]);
  assert.ok(!hf.state().checked.includes('stance width'));
  assert.ok(!hf.summary().checked.includes('stance width'));
  // in view again: measured, told
  evs = feed(hf, () => landmarks(triangle({ stance: 0.3 })), 20000, 15000 + DT);
  assert.deepEqual(faultsOf(evs), ['stance']);
  // a fault told, then out of view: not fixed (still open) and not told again; back in view, still there: the same
  evs = feed(hf, () => landmarks(triangle({ stance: 0.3 }), { shiftY: 0.1 }), 30000, 20000 + DT);
  assert.deepEqual(evs, []);
  assert.deepEqual(hf.state().open.map(f => f.fault), ['stance']);
  evs = feed(hf, () => landmarks(triangle({ stance: 0.3 })), 40000, 30000 + DT);
  assert.deepEqual(evs, []);
  // seen from the side: every triangle check needs the front (they lie in the body's frontal plane): wrong-view, not
  // unseen (stepping back changes nothing; turning to the camera does)
  hf = new HoldForm({ key: 'triangle_pose' });
  evs = feed(hf, () => landmarks(triangle({ stance: 0.3, topArm: 60 }), { turn: 90 }), 15000);
  assert.deepEqual(evs, []);
  assert.deepEqual(hf.state(), { checked: [], open: [], pending: [], unseen: [],
    wrongView: HOLD_FORMS.triangle_pose.map(c => c.name) });
  // from the side with the feet below the edge too: the legs' checks need the feet in the frame first
  hf = new HoldForm({ key: 'triangle_pose' });
  feed(hf, () => landmarks(triangle(), { turn: 90, shiftY: 0.1 }), 5000);
  assert.deepEqual([hf.state().unseen, hf.state().wrongView],
    [['stance width', 'long legs'], ['top arm', 'trunk tilt', 'arms in one line', 'open chest']]);
  // turned back to the camera: measured, fine
  feed(hf, () => landmarks(triangle()), 8000, 5000 + DT);
  assert.deepEqual(hf.state(), { checked: HOLD_FORMS.triangle_pose.map(c => c.name), open: [], pending: [],
    unseen: [], wrongView: [] });
  // nobody at all: unseen, nothing told
  hf = new HoldForm({ key: 'triangle_pose' });
  assert.deepEqual(feed(hf, () => null, 5000), []);
  assert.equal(hf.state().unseen.length, HOLD_FORMS.triangle_pose.length);
});

test('persistence: a half-second glitch raises nothing; a fault lasting FAULT_MS is told', () => {
  const hf = new HoldForm({ key: 'triangle_pose' });
  // a good pose with a narrow-stance glitch of 0.5 s every 4 s, and a one-frame wild landmark every second
  const evs = feed(hf, t => {
    if (t % 1000 < DT) return landmarks(triangle({ stance: 0.2, topArm: 90 }));
    return landmarks(triangle(t % 4000 < 500 ? { stance: 0.4 } : {}));
  }, 30000);
  assert.deepEqual(evs, []);
  // 2 s of it: told
  const hf2 = new HoldForm({ key: 'triangle_pose' });
  const evs2 = feed(hf2, t => landmarks(triangle(t >= 3000 && t < 5000 ? { stance: 0.4 } : {})), 12000);
  assert.deepEqual(faultsOf(evs2), ['stance']);
  const { FAULT_MS, FIX_MS } = FORM_TUNING;
  assert.ok(evs2[0].at >= 3000 + FAULT_MS && evs2[0].at <= 3000 + FAULT_MS + 700, `${evs2[0].at}`);
  // ...and fixed FIX_MS after it is gone (the median takes about half its window to turn)
  const fix = evs2.find(e => e.type === 'hold_fix');
  assert.ok(fix && fix.fault === 'stance' && fix.at >= 5000 + FIX_MS && fix.at <= 5000 + FIX_MS + 700, `${fix?.at}`);
});

test('one fault told at a time: the most important first, the next NEXT_MS later or once the first is fixed', () => {
  const K = FORM_TUNING;
  // the stance and the trunk tilt both off from the start: the stance first, the tilt NEXT_MS after it
  let hf = new HoldForm({ key: 'triangle_pose' });
  let evs = feed(hf, () => landmarks(triangle({ stance: 0.4, tilt: 25 })), 20000);
  assert.deepEqual(faultsOf(evs), ['stance', 'trunk_tilt']);
  assert.ok(evs[1].at - evs[0].at >= K.NEXT_MS && evs[1].at - evs[0].at <= K.NEXT_MS + 100, `${evs[1].at - evs[0].at}`);
  assert.deepEqual(hf.state().open.map(f => f.fault), ['trunk_tilt', 'stance']);   // the latest told first
  // the stance fixed at 4 s: its fix, then the tilt AFTER_FIX_MS after it (not NEXT_MS after the stance)
  hf = new HoldForm({ key: 'triangle_pose' });
  evs = feed(hf, t => landmarks(triangle({ stance: t < 4000 ? 0.4 : 1.1, tilt: 25 })), 20000);
  const said = list => list.map(e => `${e.type}:${e.fault}`);
  assert.deepEqual(said(evs), ['hold_fault:stance', 'hold_fix:stance', 'hold_fault:trunk_tilt']);
  assert.ok(Math.abs(evs[2].at - evs[1].at - K.AFTER_FIX_MS) <= 2 * DT, `${evs[2].at - evs[1].at}`);
  assert.deepEqual(hf.summary().faults.map(f => [f.fault, f.fixed]), [['stance', true], ['trunk_tilt', false]]);
  // a fault fixed that comes back is told again; one that stays is told once
  hf = new HoldForm({ key: 'triangle_pose' });
  evs = feed(hf, t => landmarks(triangle({ topArm: t < 5000 || t > 10000 ? 60 : 10 })), 30000);
  assert.deepEqual(said(evs), ['hold_fault:top_arm', 'hold_fix:top_arm', 'hold_fault:top_arm']);
  // settle(): the hold told with a fault open: the next one waits NEXT_MS from then
  hf = new HoldForm({ key: 'triangle_pose' });
  evs = feed(hf, () => landmarks(triangle({ stance: 0.4, tilt: 25 })), 3000);
  hf.settle(3000);
  evs = feed(hf, () => landmarks(triangle({ stance: 0.4, tilt: 25 })), 20000, 3000 + DT);
  assert.equal(evs[0].fault, 'trunk_tilt');
  assert.ok(evs[0].at >= 3000 + K.NEXT_MS, `${evs[0].at}`);
  // reset(): a new hold, nothing told or measured
  hf.reset();
  assert.deepEqual(hf.summary(), { checked: [], faults: [] });
});

// A fault measured and not told yet was in neither `open` nor `checked`, so the page called the form good ("Good, hold
// it there.", coach.py's "measured and fine so far") a second or two before telling that fault.
test('pending: a fault measured and not told yet (waiting its turn, or to last) is pending, never checked', () => {
  const K = FORM_TUNING, at = (hf, frameAt, t, from) => { feed(hf, frameAt, t, from); return hf.state(); };
  // the stance and the trunk tilt off from the start: both pending while they last FAULT_MS, then the stance told
  // and the tilt pending until NEXT_MS after it
  let hf = new HoldForm({ key: 'triangle_pose' });
  const both = () => landmarks(triangle({ stance: 0.4, tilt: 25 }));
  let st = at(hf, both, 800);
  assert.deepEqual([st.open, st.pending], [[], ['stance width', 'trunk tilt']]);
  assert.deepEqual(st.checked, ['long legs', 'top arm', 'arms in one line']);   // (the chest: not tipped into it)
  st = at(hf, both, 5000, 800 + DT);
  assert.deepEqual([st.open.map(f => f.fault), st.pending], [['stance'], ['trunk tilt']]);
  assert.ok(!st.checked.includes('trunk tilt'));
  st = at(hf, both, 2000 + K.NEXT_MS, 5000 + DT);
  assert.deepEqual([st.open.map(f => f.fault), st.pending], [['trunk_tilt', 'stance'], []]);
  // the stance fixed: the tilt pending AFTER_FIX_MS more (the fix praised first), then told
  hf = new HoldForm({ key: 'triangle_pose' });
  const fixing = t => landmarks(triangle({ stance: t < 4000 ? 0.4 : 1.1, tilt: 25 }));
  let evs = feed(hf, fixing, 7000);                  // (the stance fixed about 6 s: FIX_MS after the median turns)
  const fix = evs.find(e => e.type === 'hold_fix');
  assert.ok(fix && fix.at < 7000 && fix.at + K.AFTER_FIX_MS > 7000 && faultsOf(evs).join() === 'stance', `${fix?.at}`);
  st = hf.state();
  assert.deepEqual([st.open, st.pending, st.checked.includes('stance width')], [[], ['trunk tilt'], true]);
  evs = feed(hf, fixing, 20000, 7000 + DT);
  assert.deepEqual(faultsOf(evs), ['trunk_tilt']);
  assert.ok(Math.abs(evs[0].at - fix.at - K.AFTER_FIX_MS) <= 2 * DT, `${fix.at} ${evs[0].at}`);
  // bad on its smoothed value, not lasted FAULT_MS yet: pending (a glitch's half second is not: the median)
  hf = new HoldForm({ key: 'triangle_pose' });
  const narrowFrom = from => t => landmarks(triangle({ stance: t >= from ? 0.4 : 1.1 }));
  st = at(hf, narrowFrom(3000), 3000 + K.FAULT_MS / 2);
  assert.deepEqual([st.open, st.pending], [[], ['stance width']]);
  assert.ok(!st.checked.includes('stance width'));
  hf = new HoldForm({ key: 'triangle_pose' });
  st = at(hf, t => landmarks(triangle(t >= 3000 && t < 3100 ? { stance: 0.4 } : {})), 3200);
  assert.deepEqual([st.pending, st.checked.length], [[], HOLD_FORMS.triangle_pose.length]);
  // the arms' line off only because the top arm is: not pending of its own (told as the top arm)
  hf = new HoldForm({ key: 'triangle_pose' });
  const arm = () => landmarks(triangle({ topArm: 50, bottomArm: 0 }));
  st = at(hf, arm, 800);
  assert.deepEqual([st.pending, st.checked.includes('arms in one line')], [['top arm'], false]);
  st = at(hf, arm, 5000, 800 + DT);
  assert.deepEqual([st.open.map(f => f.fault), st.pending], [['top_arm'], []]);
});

// `when` on the last raw frame: one frame of the trunk below 35 deg dropped the chest from `checked`, and hid the
// chest's fault once told.
test('a check\'s `when` is judged on the smoothed values; a fault told and still there is never hidden by it', () => {
  const all = HOLD_FORMS.triangle_pose.map(c => c.name);
  let hf = new HoldForm({ key: 'triangle_pose' });
  const good = { stance: 1.1, topArm: 12, bottomArm: 25, tilt: 58, chest: 10 };
  feed(hf, () => landmarks(triangle(good)), 5000);
  hf.update(metricsOf(landmarks(triangle({ ...good, tilt: 30 }))), 5000 + DT);    // one frame upright
  assert.deepEqual([hf.state().checked, hf.state().pending], [all, []]);
  // the chest turned to the floor: told; the trunk coming up (out of the chest's `when`): still open, not fixed
  hf = new HoldForm({ key: 'triangle_pose' });
  assert.deepEqual(faultsOf(feed(hf, () => landmarks(triangle({ chest: 70 })), 5000)), ['chest']);
  hf.update(metricsOf(landmarks(triangle({ chest: 70, tilt: 30 }))), 5000 + DT);
  assert.deepEqual(hf.state().open.map(f => f.fault), ['chest']);
  const evs = feed(hf, () => landmarks(triangle({ chest: 70, tilt: 30 })), 9000, 5000 + 2 * DT);
  assert.ok(!evs.some(e => e.type === 'hold_fix'));
  assert.ok(hf.state().open.some(f => f.fault === 'chest'), JSON.stringify(hf.state()));
  assert.deepEqual(hf.summary().faults.find(f => f.fault === 'chest'),
    { fault: 'chest', label: 'chest turned to the floor', fixed: false, told: true });
});

test('the figure-four from the side: its ankle check is wrong-view (it needs the front), the rest judged', () => {
  const name = 'ankle above the knee';
  const front = new HoldForm({ key: 'figure_four_balance' });
  feed(front, () => landmarks(figureFour()), 5000);
  assert.ok(front.state().checked.includes(name), JSON.stringify(front.state()));
  const side = new HoldForm({ key: 'figure_four_balance' });
  feed(side, () => landmarks(figureFour(), { turn: 90 }), 5000);
  assert.equal(metricsOf(landmarks(figureFour(), { turn: 90 })).view, 'side');
  const st = side.state();
  assert.deepEqual([st.wrongView, st.unseen], [[name], []]);
  // the others judged from any view: the chest up (fine), sitting back (figureFour() stands tall: told)
  assert.deepEqual([st.checked, st.open.map(f => f.fault), st.pending], [['chest up'], ['sit_back'], []]);
});

// --- what to show in red ------------------------------------------------------------------------------------------
// Each fault names its body part, for the page to colour in its replay of the user's held frames (formcheck.js
// bonesFor) and on the Y Bot (retarget.js faultBones), and the user's side of it for a part on one side.
const PARTS = ['arm', 'arms', 'chest', 'feet', 'hips', 'knee', 'leg', 'torso'];
/** The parts on one side of the body: a bone of each side's, in the replay (landmarks) and on the Y Bot. */
const SIDED = { arm: { left: [[11, 13], 'LeftArm'], right: [[12, 14], 'RightArm'] },
  knee: { left: [[23, 25], 'LeftUpLeg'], right: [[24, 26], 'RightUpLeg'] },
  leg: { left: [[23, 25], 'LeftUpLeg'], right: [[24, 26], 'RightUpLeg'] } };
const swapSide = s => (s === 'left' ? 'right' : s === 'right' ? 'left' : s);

test('every check names a body part the page colours, in the replay and on the Y Bot; a sided part, its side', () => {
  const used = new Set();
  for (const [key, checks] of Object.entries(HOLD_FORMS)) {
    for (const c of checks) {
      used.add(c.part);
      assert.ok(bonesFor(c.part).length && faultBones(c.part).length && faultParts().includes(c.part),
        `${key}.${c.id}: ${c.part}`);
      assert.equal(typeof c.side === 'function', c.part in SIDED, `${key}.${c.id}: a side only for a sided part`);
      for (const [side, [bone, bot]] of Object.entries(SIDED[c.part] ?? {})) {
        assert.ok(bonesFor(c.part, side).some(b => b.join() === bone.join()), `${c.part} ${side}`);
        assert.ok(faultBones(c.part, side).includes(bot), `${c.part} ${side} on the Y Bot`);
      }
    }
  }
  assert.deepEqual([...used].sort(), PARTS);
});

test('quad stretch and figure-four: each fault names its part, on the bent or the standing leg, either side', () => {
  // (the left leg lifted; mirrored, the right one)
  const cases = [
    ['quad_stretch', quad({ knee: 100 }), [['heel', 'knee', 'left']]],
    ['quad_stretch', quad({ thigh: 60 }), [['knees_together', 'knee', 'left']]],
    ['quad_stretch', quad({ tilt: 40 }), [['upright', 'torso', null]]],
    ['quad_stretch', quad({ standBend: 60 }), [['standing_knee', 'knee', 'right']]],
    // the crossed ankle on the shin, standing tall: the ankle, then (NEXT_MS later) the hips
    ['figure_four_balance', figureFour({ drop: 0.35 }),
      [['ankle_on_knee', 'leg', 'left'], ['sit_back', 'hips', null]]],
    ['figure_four_balance', figureFour({ tilt: 65 }), [['chest_up', 'torso', null]]],
  ];
  for (const [key, P, want] of cases) {
    for (const flip of [false, true]) {
      const hf = new HoldForm({ key });
      const evs = feed(hf, () => (flip ? mirror : x => x)(landmarks(P)), 12000);
      const told = evs.filter(e => e.type === 'hold_fault').map(e => [e.fault, e.part, e.side]);
      const what = `${key} ${want.map(w => w[0])}${flip ? ' mirrored' : ''}`;
      assert.deepEqual(told, want.map(([id, part, side]) => [id, part, flip ? swapSide(side) : side]), what);
      assert.deepEqual(hf.state().open.map(f => [f.fault, f.part, f.side]), told.toReversed(), what);
    }
  }
});

test('a fault\'s side is the one on the frame it is told on: fixed and told again on the other side, that side', () => {
  const hf = new HoldForm({ key: 'triangle_pose' });
  // the top arm off leaning over the left leg (the right arm up), straightened at 5 s, off again over the right leg
  const pose = t => (t < 5000 ? { topArm: 60 } : t < 10000 ? {} : { front: 'R', topArm: 60 });
  const evs = feed(hf, t => landmarks(triangle(pose(t))), 20000);
  assert.deepEqual(evs.map(e => `${e.type}:${e.fault}`),
    ['hold_fault:top_arm', 'hold_fix:top_arm', 'hold_fault:top_arm']);
  assert.deepEqual(evs.filter(e => e.type === 'hold_fault').map(e => e.side), ['right', 'left']);
  assert.equal(hf.state().open[0].side, 'left');
});

test('the chest is judged only tipped into the pose; standing tall is not a chest fault', () => {
  const hf = new HoldForm({ key: 'triangle_pose' });
  const evs = feed(hf, () => landmarks(standing()), 40000);
  assert.ok(!faultsOf(evs).includes('chest'));
  assert.ok(!hf.state().unseen.includes('open chest') && !hf.state().checked.includes('open chest'));
  // standing with the feet together, arms down: the stance first (getting into the pose), then the top arm
  assert.deepEqual(faultsOf(evs).slice(0, 2), ['stance', 'top_arm']);
});

// (The checks alone. Through the tracker, standing on both feet is out of the pose, below: no hold, nothing told.)
test('quad stretch and figure-four: standing on both feet fails the first check', () => {
  for (const [key, first] of [['quad_stretch', 'heel'], ['figure_four_balance', 'ankle_on_knee']]) {
    const hf = new HoldForm({ key });
    const evs = feed(hf, () => landmarks(standing()), 12000);
    assert.equal(faultsOf(evs)[0], first, key);
  }
});

// --- in the pose at all --------------------------------------------------------------------------------------------
/** InPose's decision on frames from `frameAt(t)` (landmarks, or null) from `from` to `to` ms at 30 fps: [{t, d}]. */
function decide(ip, frameAt, to, from = 0) {
  const out = [];
  for (let t = from; t <= to + 1e-6; t += DT) {
    const lm = frameAt(t);
    out.push({ t, d: ip.update(lm ? metricsOf(lm) : null, t) });
  }
  return out;
}
const only = (ds, from, to) => [...new Set(ds.filter(x => x.t >= from && x.t < to).map(x => x.d))];

test('poseMetrics: footUp, the lifted ankle above the other, in leg lengths', () => {
  assert.ok(Math.abs(metricsOf(landmarks(standing(), { jitter: 0 })).footUp) < 0.01);
  const q = metricsOf(landmarks(quad({ knee: 45 }), { jitter: 0 }));
  assert.ok(Math.abs(q.footUp - 0.85) < 0.01 && Math.abs(q.kneeLift - 45) < 0.5, `${q.footUp} ${q.kneeLift}`);
  assert.equal(q.lift, 'L');
  const f = metricsOf(landmarks(figureFour(), { jitter: 0 }));
  assert.ok(Math.abs(f.footUp - 0.53) < 0.01 && f.ankleToKnee < 0.1, `${f.footUp} ${f.ankleToKnee}`);
  assert.equal(metricsOf(mirror(landmarks(quad(), { jitter: 0 }))).lift, 'R');
});

test('IN_POSE: every pose with a form check has one; out and back in never both hold', () => {
  assert.deepEqual(Object.keys(IN_POSE).sort(), Object.keys(HOLD_FORMS).sort());
  const parts = Object.keys(metricsOf(landmarks(standing())).seen);
  for (const [key, p] of Object.entries(IN_POSE)) {
    assert.equal(typeof p.label, 'string', key);
    assert.ok(p.needs.length && p.needs.every(n => parts.includes(n)), key);
    for (const f of ['out', 'back']) assert.equal(typeof p[f], 'function', `${key}.${f}`);
    for (const P of [standing(), triangle(), triangle({ tilt: 22 }), quad(), quad({ knee: 125 }), figureFour()]) {
      const m = metricsOf(landmarks(P));
      assert.ok(!(p.out(m) && p.back(m)), key);
    }
  }
  assert.throws(() => new InPose({ key: 'made_up' }));
});

test('InPose, triangle: standing up is out from the first frame upright; a shallow or wobbly pose stays in', () => {
  const ip = new InPose({ key: 'triangle_pose' });
  // in the pose 3 s, standing 3 s, back in it 3 s
  let ds = decide(ip, t => landmarks(t >= 3000 && t < 6000 ? standing() : triangle()), 9000);
  assert.deepEqual(only(ds, 0, 3000), ['in']);
  const out = ds.find(x => x.d === 'out');
  assert.ok(out.t >= 3000 && out.t <= 3000 + FORM_TUNING.POSE_MS / 2 + 2 * DT, `out at ${out.t}`);   // most of POSE_MS
  assert.deepEqual(only(ds, out.t, 6000), ['out']);
  const back = ds.find(x => x.t >= 6000 && x.d === 'in');
  assert.ok(back.t <= 6000 + FORM_TUNING.POSE_MS / 2 + 2 * DT, `back at ${back.t}`);
  // while out: left at the first frame upright, out until the last
  ip.reset();
  ds = decide(ip, t => landmarks(t < 3000 ? triangle() : standing()), 5000);
  assert.ok(Math.abs(ip.leftT - 3000) <= DT && Math.abs(ip.lastOutT - 5000) <= DT, `${ip.leftT} ${ip.lastOutT}`);
  // a trunk too upright (28 deg: that fault is told) is in the pose; 22 deg (between the lines) keeps the decision
  for (const [P, d] of [[triangle({ tilt: 28 }), 'in'], [triangle({ tilt: 22 }), 'in']]) {
    assert.deepEqual(only(decide(new InPose({ key: 'triangle_pose' }), () => landmarks(P), 3000), 0, 3001), [d]);
  }
  ip.reset();
  ds = decide(ip, t => landmarks(t < 2000 ? standing() : triangle({ tilt: 22 })), 4000);
  assert.deepEqual(only(ds, 1000, 4001), ['out']);
  // a glitch (two frames upright, or a wild frame) decides nothing
  ip.reset();
  ds = decide(ip, t => landmarks(t % 1000 < 2 * DT ? standing() : triangle()), 6000);
  assert.deepEqual(only(ds, 0, 6001), ['in']);
  // nor do the first frames seen, over less than half of POSE_MS; and a frame back in the pose holds off the decision
  ip.reset();
  const up = metricsOf(landmarks(standing())), tri = metricsOf(landmarks(triangle()));
  assert.deepEqual([[up, 0], [up, 100], [up, 200], [tri, 300], [up, 350]].map(([m, t]) => ip.update(m, t)),
    ['in', 'in', 'in', 'in', 'out']);
  assert.equal(ip.leftT, 350);
});

test('InPose: no decision with its parts out of view, from the side, or nobody; the last one stands', () => {
  const ip = new InPose({ key: 'triangle_pose' });
  for (const lm of [landmarks(standing(), { vis: { 11: 0.1, 12: 0.1 } }), landmarks(standing(), { turn: 90 }), null]) {
    assert.deepEqual(only(decide(ip, () => lm, 3000), 0, 3001), [null]);
  }
  assert.equal(ip.out, false);                     // nothing seen: in the pose, as without the test
  decide(ip, () => landmarks(standing()), 1000);
  assert.deepEqual(only(decide(ip, () => null, 3000, 1000 + DT), 0, 3001), [null]);
  assert.equal(ip.update(metricsOf(landmarks(standing())), 3000 + DT), 'out');
  // the one-legged poses need both legs, from the front or angled
  for (const key of ['quad_stretch', 'figure_four_balance']) {
    const q = new InPose({ key });
    assert.deepEqual(only(decide(q, () => landmarks(standing(), { vis: { 28: 0.1 } }), 2000), 0, 2001), [null], key);
    assert.deepEqual(only(decide(q, () => landmarks(standing(), { turn: 90 }), 2000), 0, 2001), [null], key);
  }
});

test('InPose, quad stretch and figure-four: both feet down is out; the pose, done well or not, is in', () => {
  const cases = [
    ['quad_stretch', [quad(), quad({ knee: 100 })]],        // a heel let down to 100 deg, the foot up: the heel's fault
    ['figure_four_balance', [figureFour()]],
  ];
  for (const [key, poses] of cases) {
    for (const P of poses) {
      for (const flip of [false, true]) {
        const lm = t => (flip ? mirror : x => x)(landmarks(t < 3000 ? P : standing()));
        const ds = decide(new InPose({ key }), lm, 6000);
        assert.deepEqual(only(ds, 0, 3000), ['in'], `${key} ${flip}`);
        assert.deepEqual(only(ds, 3000 + FORM_TUNING.POSE_MS, 6001), ['out'], `${key} ${flip}`);
      }
    }
  }
});

// --- the form not checked at all, said (moves.js form_unseen) ------------------------------------------------------
test('a hold seen side-on, every check judged facing the camera: form_unseen asks to turn to it', () => {
  const tr = new MovementTracker({ movement: { key: 'triangle_pose', display: 'Triangle pose', kind: 'hold',
    track: 'hold' } });
  const evs = [];
  for (let t = 0; t <= 20000; t += DT) {
    const lm = landmarks(triangle(), { turn: 90 });
    evs.push(...tr.update(features(lm.world, lm.image, lm.aspect), t, lm).map(e => ({ ...e, at: t })));
  }
  const start = evs.find(e => e.type === 'hold_start'), unseen = evs.filter(e => e.type === 'form_unseen');
  assert.ok(start, 'a hold');
  assert.deepEqual(unseen.map(e => [e.why, e.parts, e.cue, e.missing]), [['view', [],
    'Turn to face the camera so I can check your form.', HOLD_FORMS.triangle_pose.map(c => c.name)]]);
  const after = unseen[0].at - start.at;
  assert.ok(Math.abs(after - 4000) <= 2 * DT, `${after} ms after the start was told`);
  // ...facing the camera: none
  const front = new MovementTracker({ movement: { key: 'triangle_pose', display: 'Triangle pose', kind: 'hold',
    track: 'hold' } });
  for (let t = 0; t <= 20000; t += DT) {
    const lm = landmarks(triangle());
    assert.deepEqual(front.update(features(lm.world, lm.image, lm.aspect), t, lm)
      .filter(e => e.type === 'form_unseen'), []);
  }
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
/** A skeleton's frames as MediaPipe landmarks, as tools/build_moves.mjs skeletonFeatures sees it: a camera in front of
 * the person over the first second (SMPL Y-up -> world y down around the hips, x the person's left). */
function skeletonLandmarks(skel) {
  const J = skel.joints, n = J.pelvis.length, first = Math.max(1, Math.min(n, Math.round(skel.fps)));
  let lx = 0, lz = 0;
  for (let i = 0; i < first; i++) {
    lx += J.left_shoulder[i][0] - J.right_shoulder[i][0]; lz += J.left_shoulder[i][2] - J.right_shoulder[i][2];
  }
  const ln = Math.hypot(lx, lz) || 1, L = [lx / ln, 0, lz / ln], F = [-L[2], 0, L[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const NAMES = { 11: 'left_shoulder', 12: 'right_shoulder', 13: 'left_elbow', 14: 'right_elbow', 15: 'left_wrist',
    16: 'right_wrist', 23: 'left_hip', 24: 'right_hip', 25: 'left_knee', 26: 'right_knee', 27: 'left_ankle',
    28: 'right_ankle', 31: 'left_foot', 32: 'right_foot', 0: 'head' };
  return Array.from({ length: n }, (_, i) => {
    const hip = J.left_hip[i].map((v, k) => (v + J.right_hip[i][k]) / 2);
    const P = {};
    for (const [idx, name] of Object.entries(NAMES)) {
      const d = J[name][i].map((v, k) => v - hip[k]);
      P[idx] = [dot(d, L), -d[1], -dot(d, F)];
    }
    P[29] = P[27]; P[30] = P[28]; P[7] = P[0]; P[8] = P[0];
    return { t: (i * 1000) / skel.fps, P };
  });
}
const REFS = ['triangle_pose', 'quad_stretch', 'figure_four_balance'].map(key => ({ key, skel: skeletonOf(key) }));

for (const { key, skel } of REFS) {
  const skip = !skel && 'no reference skeleton here';
  test(`${key}: the reference skeleton's held part passes, mirrored too`, { skip }, () => {
    const frames = skeletonLandmarks(skel);
    const held = frames.filter(f => f.t >= frames.at(-1).t / 2);       // the second half: the pose held
    for (const mirrored of [false, true]) {
      const hf = new HoldForm({ key });
      for (const f of held) {
        const lm = landmarks(f.P);
        const evs = hf.update(metricsOf(mirrored ? mirror(lm) : lm), f.t);
        assert.deepEqual(evs, [], `${key}${mirrored ? ' mirrored' : ''} at ${f.t}`);
      }
      const want = { checked: HOLD_FORMS[key].map(c => c.name), faults: [] };
      assert.deepEqual(hf.summary(), want, `${key}${mirrored ? ' mirrored' : ''}`);
    }
  });
}

const noRefs = REFS.some(r => !r.skel) && 'no reference skeletons here';
test('the reference skeletons with a fault put in are caught', { skip: noRefs }, () => {
  const run = (key, edit) => {
    const hf = new HoldForm({ key });
    const frames = skeletonLandmarks(REFS.find(r => r.key === key).skel);
    const evs = [];
    for (const f of frames.filter(x => x.t >= frames.at(-1).t / 2)) {
      evs.push(...hf.update(metricsOf(landmarks(edit(f.P))), f.t));
    }
    return faultsOf(evs);
  };
  // the triangle with its feet a third as far apart (each ankle moved in): the stance
  const inward = (a, b) => add(a, b, 0.5).map(v => v / 1.5);
  const narrow = P => ({ ...P, 27: inward(P[27], P[28]), 28: inward(P[28], P[27]) });
  assert.deepEqual(run('triangle_pose', narrow), ['stance']);
  // the quad stretch with the bent leg let down (the ankle below the knee): the heel
  const letDown = P => { const lift = P[27][1] < P[28][1] ? [23, 25, 27] : [24, 26, 28];
    return { ...P, [lift[2]]: add(P[lift[1]], add(P[lift[1]], P[lift[0]], -1)) }; };
  assert.deepEqual(run('quad_stretch', letDown), ['heel']);
  // the figure-four with the crossed ankle dropped 0.35 m (onto the shin): not on the knee
  const drop = P => { const a = P[27][1] < P[28][1] ? 27 : 28; return { ...P, [a]: add(P[a], [0, 0.35, 0]) }; };
  assert.equal(run('figure_four_balance', drop)[0], 'ankle_on_knee');
});

// MediaPipe on the library's own footage of the poses (private): the held part (its second half) passes. The
// figure-four's footage is a side view: its ankle check is not judged there.
const mpIndex = path.join(DATA, 'moves', 'mp', 'index.json');
const footage = key => {
  const m = library.find(x => x.key === key);
  const index = m && fs.existsSync(mpIndex) ? JSON.parse(fs.readFileSync(mpIndex, 'utf8')) : [];
  const entry = index.find(e => e.id === m.id);
  const file = entry?.series && path.join(ROOT, entry.series);
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
for (const key of ['triangle_pose', 'quad_stretch', 'figure_four_balance']) {
  const rec = footage(key);
  test(`${key}: MediaPipe on the library's footage of it passes`, { skip: !rec && 'no footage here' }, () => {
    const hf = new HoldForm({ key }), t0 = rec.frames[0].t, end = rec.frames.at(-1).t;
    const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
    const evs = [];
    for (const fr of rec.frames) {
      if (fr.t - t0 < (end - t0) / 2 || !fr.world) continue;
      evs.push(...hf.update(poseMetrics(obj(fr.world), obj(fr.image), rec.width / rec.height), fr.t));
    }
    assert.deepEqual(evs, []);
    const sum = hf.summary();
    assert.deepEqual(sum.faults, []);
    const expect = HOLD_FORMS[key].filter(c => !(key === 'figure_four_balance' && c.id === 'ankle_on_knee'));
    assert.deepEqual(sum.checked, expect.map(c => c.name));
    // ...and says why: the view (turning to the camera shows it), not the frame (stepping back would not)
    const side = key === 'figure_four_balance' ? ['ankle above the knee'] : [];
    assert.deepEqual(hf.state(), { checked: expect.map(c => c.name), open: [], pending: [], unseen: [],
      wrongView: side });
  });
}

// In the pose at all, on the same references: in it through the held part (the whole clip fed, as a camera would).
// The quad stretch's clips start standing on both feet: out. The figure-four's footage is a side view: no decision.
for (const { key, skel } of REFS) {
  test(`${key}: the reference skeleton stays in the pose through its held part, mirrored too`,
    { skip: !skel && 'no reference skeleton here' }, () => {
      const frames = skeletonLandmarks(skel), half = frames.at(-1).t / 2;
      for (const mirrored of [false, true]) {
        const ip = new InPose({ key });
        const ds = frames.map(f => {
          const lm = landmarks(f.P);
          return { t: f.t, d: ip.update(metricsOf(mirrored ? mirror(lm) : lm), f.t) };
        });
        assert.deepEqual(only(ds, half, Infinity), ['in'], `${key}${mirrored ? ' mirrored' : ''}`);
        if (key === 'quad_stretch') assert.ok(only(ds, 0, 1300).includes('out'), 'standing before the stretch');
        else assert.deepEqual(only(ds, 0, Infinity), ['in'], `${key}: getting into it too`);
      }
    });
}
for (const key of ['triangle_pose', 'quad_stretch', 'figure_four_balance']) {
  const rec = footage(key);
  test(`${key}: MediaPipe on the library's footage of it stays in the pose through its held part`,
    { skip: !rec && 'no footage here' }, () => {
      const ip = new InPose({ key }), t0 = rec.frames[0].t, half = (rec.frames.at(-1).t - t0) / 2;
      const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
      const ds = rec.frames.filter(fr => fr.world).map(fr => ({ t: fr.t - t0,
        d: ip.update(poseMetrics(obj(fr.world), obj(fr.image), rec.width / rec.height), fr.t) }));
      assert.deepEqual(only(ds, half, Infinity), [key === 'figure_four_balance' ? null : 'in']);
      if (key === 'quad_stretch') assert.ok(only(ds, 0, 1300).includes('out'), 'standing before the stretch');
    });
}

// --- the user's recorded triangle holds (private) ------------------------------------------------------------------
// Every live recording with Triangle pose named, through the movement tracker with its landmarks (as the page). The
// user's two long holds (2026-10-24, 21 and 26 s: the first ran 27 s before a hold ended once out of the pose) had the
// feet about half a leg length apart and the top arm 30-60 deg off straight up: both told in each. Nothing the
// recording cannot show (a knee bent, the chest turned) is told, and the arms' line is never told on top of the top
// arm.
const liveDir = path.join(DATA, 'posedata', 'results', 'live');
const named = f => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).movements?.some(m => m.movement === 'triangle_pose'); }
  catch { return false; }
};
const triangleRecs = fs.existsSync(liveDir)
  ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')).map(f => path.join(liveDir, f)).filter(named) : [];
test('the user\'s recorded triangle holds: the stance and the top arm told in each long hold, nothing absurd',
  { skip: !triangleRecs.length && 'no recording of it here' }, () => {
    const movement = library.find(m => m.key === 'triangle_pose')
      ?? { key: 'triangle_pose', display: 'Triangle pose', kind: 'hold', track: 'hold' };
    let long = 0;
    for (const file of triangleRecs) {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8')), aspect = rec.width / rec.height;
      const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
      const tr = new MovementTracker({ movement });
      const evs = [];
      for (const fr of rec.frames) {
        const lm = fr.world && fr.image ? { world: obj(fr.world), image: obj(fr.image), aspect } : null;
        evs.push(...(lm ? tr.update(features(lm.world, lm.image, aspect), fr.t, lm) : tr.lost(fr.t)));
      }
      evs.push(...tr.finish());
      let hold = null;
      for (const e of evs) {
        // each fault told names its part, and its side for a sided part
        const told = e.type === 'hold_start' ? e.form?.open ?? [] : e.type === 'hold_fault' ? [e] : [];
        for (const f of told) {
          const c = HOLD_FORMS.triangle_pose.find(x => x.id === f.fault);
          assert.equal(f.part, c.part, f.fault);
          assert.ok(c.side ? ['left', 'right'].includes(f.side) : f.side === null, `${f.fault}: ${f.side}`);
        }
        if (e.type === 'hold_start') { hold = { told: (e.form?.open ?? []).map(f => f.fault) }; continue; }
        if (e.type === 'hold_fault' || e.type === 'hold_fix') {
          assert.ok(hold, `${e.type} outside a told hold`);
          if (e.type === 'hold_fault') hold.told.push(e.fault);
          continue;
        }
        if (e.type !== 'hold_end') continue;
        for (const f of ['knees', 'chest', 'arms_line']) assert.ok(!hold.told.includes(f), `${f} (${e.seconds} s)`);
        assert.ok(e.form && Array.isArray(e.form.faults));
        if (e.seconds >= 20) {
          long += 1;
          assert.ok(hold.told.includes('stance') && hold.told.includes('top_arm'), `${e.seconds} s: told ${hold.told}`);
        }
        hold = null;
      }
    }
    assert.ok(long >= 2, `${long} long holds`);
  });

/** A recording through the tracker as the page runs it (frames with their landmarks), and an InPose of its own on the
 * same frames: the events (`s`: their time, `at`: the frame they came on, in seconds from the first frame) and each
 * frame's decision {s, d, outFor: ms clearly out of the pose so far}. */
function replay(file, key = 'triangle_pose', { settleMs = 0 } = {}) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')), aspect = rec.width / rec.height, t0 = rec.frames[0].t;
  const movement = library.find(m => m.key === key) ?? { key, display: key, kind: 'hold', track: 'hold' };
  const tr = new MovementTracker({ movement }), ip = new InPose({ key });
  const obj = a => a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
  const sec = t => (t - t0) / 1000, evs = [], frames = [];
  let settled = null;
  for (const fr of rec.frames) {
    const lm = fr.world && fr.image ? { world: obj(fr.world), image: obj(fr.image), aspect } : null;
    const f = lm && features(lm.world, lm.image, aspect);
    if (f) {
      const d = ip.update(poseMetrics(lm.world, lm.image, aspect), fr.t);
      frames.push({ s: sec(fr.t), d, outFor: d === 'out' ? ip.lastOutT - ip.leftT : 0 });
    }
    evs.push(...(f ? tr.update(f, fr.t, lm) : tr.lost(fr.t)).map(e => ({ ...e, s: sec(e.t), at: sec(fr.t) })));
    // (settleMs: as the page, which says a hold's start that far into it and settles the form then)
    if (settleMs && tr.holding && tr.told && settled !== tr.holdStart && fr.t - tr.holdStart >= settleMs) {
      settled = tr.holdStart; tr.settle(fr.t);
      evs.push({ type: 'settled', s: sec(fr.t), at: sec(fr.t) });
    }
  }
  evs.push(...tr.finish().map(e => ({ ...e, s: sec(e.t), at: sec(tr.lastT) })));
  return { rec, evs, frames };
}
/** The told holds of a replay's events: [{start, said: [hold_fault and hold_fix events], end}]. */
function holdsOf(evs) {
  const holds = [];
  let h = null;
  for (const e of evs) {
    if (e.type === 'hold_start') holds.push(h = { start: e, said: [] });
    else if (h && (e.type === 'hold_fault' || e.type === 'hold_fix')) h.said.push(e);
    else if (h && e.type === 'settled') h.settled = e;
    else if (h && e.type === 'hold_end') { h.end = e; h = null; }
  }
  return holds;
}

// In the pose at all, on the user's recordings: no hold runs on with the user out of the pose OUT_END_MS (before, one
// ran 7 s past standing up and one started standing still before the pose), and no fault is told on a frame out of
// it (before, "trunk too upright" 2 s after standing up).
test('the user\'s recorded triangle holds: none runs on out of the pose, nothing told of frames out of it',
  { skip: !triangleRecs.length && 'no recording of it here' }, () => {
    for (const file of triangleRecs) {
      const { evs, frames } = replay(file);
      const frameAt = s => frames.find(x => x.s >= s - 1e-9);
      for (const e of evs.filter(x => x.type === 'hold_fault')) {
        assert.notEqual(frameAt(e.at)?.d, 'out', `${e.fault} told at ${e.at.toFixed(1)} s`);
      }
      for (const h of holdsOf(evs)) {
        const out = frames.filter(x => x.s > h.start.s && x.s <= h.end.s && x.outFor >= TUNING.OUT_END_MS);
        assert.deepEqual(out.map(x => x.s), [], `the hold from ${h.start.s.toFixed(1)} s`);
      }
    }
  });

// The first recording of it (2026-10-24), times from its first frame. Hold A, about 78.5-99 s: the user stood up from
// 98.6 s in 0.9 s of movement (too little to end a hold), the trunk passing 20 deg off upright at 99.35 s, and stood
// still with it 12-17 deg off; the hold ran on to 106.5 s and the coach was told "trunk too upright" at 101.2 s.
// Hold B, about 190-217 s: the top arm off at its start, the stance told after. Standing still before the pose,
// 48.5-58 s (the trunk 6-18 deg off where in view: the shoulders were above the picture most of 55-58 s), started
// holds of 4 and 3 s.
const firstTriangle = triangleRecs.filter(f => JSON.parse(fs.readFileSync(f, 'utf8')).started?.startsWith('2026-10-24'))
  .sort()[0];
test('the user\'s first triangle recording: hold A ends as they stand up, no "trunk too upright"; hold B as before',
  { skip: !firstTriangle && 'no recording of it here' }, () => {
    const { evs } = replay(firstTriangle);
    const holds = holdsOf(evs), long = holds.filter(h => h.end.seconds >= 15);
    assert.equal(long.length, 2, holds.map(h => `${h.start.s.toFixed(1)}: ${h.end.seconds} s`).join(', '));
    const [a, b] = long;
    // A: ended where the trunk passed the line, said within about a second of it (by ~100 s, not 106.5)
    assert.ok(a.start.s > 78 && a.start.s < 79, `A from ${a.start.s}`);
    assert.ok(a.end.s >= 98.5 && a.end.s <= 99.6, `A to ${a.end.s}`);
    assert.ok(a.end.at <= 100.5, `A's end said at ${a.end.at}`);
    assert.ok(!a.said.some(e => e.fault === 'trunk_tilt') && !a.end.form.faults.some(f => f.fault === 'trunk_tilt'));
    assert.deepEqual([a.start.form.open.map(f => f.fault), a.said.map(e => `${e.type}:${e.fault}`)],
      [['stance'], ['hold_fault:top_arm']]);
    // no hold while standing still: after A (to 104 s), nor before the pose (48-58 s)
    assert.deepEqual(holds.filter(h => (h.start.s > a.end.s && h.start.s < 104) || (h.start.s > 48 && h.start.s < 58))
      .map(h => h.start.s), []);
    // B: its corrections as before, the top arm with its start, then the feet
    assert.ok(b.start.s > 189 && b.start.s < 191 && b.end.seconds >= 25, `B ${b.start.s}: ${b.end.seconds} s`);
    assert.deepEqual([b.start.form.open.map(f => f.fault), b.said.map(e => `${e.type}:${e.fault}`)],
      [['top_arm'], ['hold_fault:stance']]);
  });

// The same recording, the reviews' cases. A pause of about 3 s at 181.5 s: the stillness measure could not judge
// 184.1-184.8 s and 185.0-185.7 s (too little in view), and the movement that ended it began about 184.9 s; the form
// ran on those frames and after that end, told "trunk too upright" at 185.1 s and listed it at the end as not fixed.
// Hold B's start: the feet too close together measured and waiting NEXT_MS behind the top arm (pending: not "fine").
// And with the page's start 6.5 s into each hold (MovementTracker settle() then), the second correction comes NEXT_MS
// after it, not 4.5 s (NEXT_MS after the tracker's own start, 3.5 s before anyone heard it).
test('the user\'s first triangle recording: nothing told of frames after a hold\'s end, faults waiting are pending, '
  + 'the page\'s start settles the next correction', { skip: !firstTriangle && 'no recording of it here' }, () => {
  const holds = holdsOf(replay(firstTriangle).evs);
  const pause = holds.find(h => h.start.s > 181 && h.start.s < 182);
  assert.ok(pause && pause.end.s < 185.2, `${pause?.start.s}-${pause?.end.s}`);
  assert.deepEqual([pause.said, pause.end.form.faults], [[], []]);
  assert.deepEqual(pause.start.form.open, []);
  assert.ok(pause.start.form.pending.length, 'getting out of it: not called fine');
  const b = holds.find(h => h.start.s > 189 && h.start.s < 191);
  assert.deepEqual([b.start.form.open.map(f => f.fault), b.start.form.pending], [['top_arm'], ['stance width']]);
  // the page's start at 6.5 s
  const page = holdsOf(replay(firstTriangle, 'triangle_pose', { settleMs: 6500 }).evs).filter(h => h.end.seconds >= 15);
  assert.equal(page.length, 2);
  for (const h of page) {
    const next = h.said.find(e => e.type === 'hold_fault');
    assert.ok(h.settled && next, `${h.start.s}`);
    const after = next.at - h.settled.at;
    assert.ok(after >= FORM_TUNING.NEXT_MS / 1000 - 0.05 && after <= FORM_TUNING.NEXT_MS / 1000 + 1, `${after} s`);
  }
});
