// npm test   (from inference/pose-coach)
import assert from 'node:assert/strict';
import test from 'node:test';
import { EXERCISES, ExerciseEngine, RepDetector, angle, features } from '../web/js/engine.js';

test('angle: right angle and straight line', () => {
  assert.equal(Math.round(angle({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })), 90);
  assert.equal(Math.round(angle({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })), 180);
});

const wave = ({ reps, lo, hi, periodMs = 2000, fps = 30, noise = 0, startHigh = true }) => {
  const out = [];
  const n = Math.round((reps * periodMs * fps) / 1000);
  for (let i = 0; i <= n; i++) {
    const t = (i * 1000) / fps;
    const phase = (2 * Math.PI * t) / periodMs;
    const c = startHigh ? Math.cos(phase) : -Math.cos(phase);
    out.push({ t, v: lo + ((hi - lo) * (1 + c)) / 2 + noise * Math.sin(i * 12.9898) });
  }
  return out;
};
const count = (det, samples) => samples.map(s => det.update(s.v, s.t)).filter(Boolean);

test('valleys: 5 full squats (knee 175 -> 85) count 5', () => {
  assert.equal(count(new RepDetector({ prominence: 30, extreme: 'min' }), wave({ reps: 5, lo: 85, hi: 175 })).length, 5);
});

test('valleys: jitter of a few degrees does not add reps', () => {
  assert.equal(count(new RepDetector({ prominence: 30, extreme: 'min' }), wave({ reps: 6, lo: 90, hi: 170, noise: 4 })).length, 6);
});

test('valleys: small pulses only count with a small prominence', () => {
  const pulses = wave({ reps: 8, lo: 95, hi: 112, periodMs: 800 });
  assert.equal(count(new RepDetector({ prominence: 30, extreme: 'min' }), pulses).length, 0);
  assert.equal(count(new RepDetector({ prominence: 8, extreme: 'min', minGapMs: 250 }), pulses).length, 8);
});

test('peaks: 4 lateral raises (arm 15 -> 90) count 4', () => {
  assert.equal(count(new RepDetector({ prominence: 30, extreme: 'max' }), wave({ reps: 4, lo: 15, hi: 90, startHigh: false })).length, 4);
});

test('a clip that starts at the bottom does not count the half rep', () => {
  // starts at the bottom (85), stands up, then 3 full reps
  const s = wave({ reps: 3.5, lo: 85, hi: 175, startHigh: false });
  assert.equal(count(new RepDetector({ prominence: 30, extreme: 'min' }), s).length, 3);
});

test('engine: a cue after the same fault on 2 of 3 reps, not after one', () => {
  const eng = new ExerciseEngine('squat');
  const frame = knee => ({ kneeL: knee, kneeR: knee, kneeAvg: knee, kneeMin: knee, kneeMax: knee, torsoLean: 10, kneeToAnkleGap: 1,
    hipL: Math.min(178, knee + 5), hipR: Math.min(178, knee + 5), hipAvg: Math.min(178, knee + 5), hipAsym: 0,
    legHeight: 0.4 + 0.6 * (knee - 60) / 115, hipHeight: -1 - (175 - knee) / 100, view: 'side', visLegs: 1, visArms: 1, visElbows: 1, visTorso: 1 });
  const cues = [];
  for (let t = 0; t < 1000; t += 33) eng.update(frame(175), t);   // standing in view first (counting starts after 0.5 s)
  for (const s of wave({ reps: 3, lo: 125, hi: 175 })) {   // every rep too shallow (bottom 125 > 110)
    for (const e of eng.update(frame(s.v), s.t + 1000)) if (e.type === 'cue') cues.push(e);
  }
  assert.equal(eng.count, 0);              // too shallow to count (legs folded to ~0.74 of standing) ...
  assert.equal(eng.partials, 3);           // ... but each attempt is seen as a partial rep and coached
  assert.equal(cues.length, 1);
  assert.equal(cues[0].code, 'shallow');
});

// --- regressions from the pre-test review -------------------------------------------------------------------------
const base = { kneeL: 170, kneeR: 170, kneeAvg: 170, kneeMin: 170, hipL: 170, hipR: 170, hipAvg: 170, hipMin: 170,
  kneeMax: 170, hipHeight: -1, shoulderHeight: -0.5, hipAsym: 0, kneeAsym: 0, legHeight: 1, feetSplit: 0.02, posture: 'upright',
  elbowL: 160, elbowR: 160, elbowAvg: 160, armL: 10, armR: 10, armAvg: 10, armMax: 10, torsoLean: 5, kneeToAnkleGap: 1,
  wristUpL: -1, wristUpR: -1, wristsOverHead: -1, view: 'front', visLegs: 1, visArms: 1, visElbows: 1, visTorso: 1 };
const run = (exercise, frames, { settle = true } = {}) => {
  const eng = new ExerciseEngine(exercise);
  const events = [];
  // a real set starts with the person standing still in view for a moment (counting begins after 0.5 s in view)
  const first = frames[0]?.f || {};
  if (settle) for (let t = -1000; t < 0; t += 33) events.push(...eng.update({ ...base, ...first }, t));
  for (const { t, f } of frames) events.push(...eng.update({ ...base, ...f }, t));
  return { eng, events };
};
const curlWave = (reps, phaseMs = 0, startMs = 0) => wave({ reps, lo: -1, hi: -0.15, startHigh: false })
  .map(s => ({ t: s.t + startMs, v: s.v, phaseMs }));

test('two-arm curls: both arms together count once per rep', () => {
  const frames = curlWave(6).map(s => ({ t: s.t, f: { wristUpL: s.v, wristUpR: s.v } }));
  const { eng } = run('biceps_curl', frames);
  assert.equal(eng.count, 6);
  assert.deepEqual(eng.perSide, { left: 6, right: 6 });
});

test('alternating curls: each arm counts', () => {
  const L = curlWave(3), R = curlWave(3, 0, 6000);
  const frames = [...L.map(s => ({ t: s.t, f: { wristUpL: s.v } })), ...R.map(s => ({ t: s.t, f: { wristUpR: s.v } }))];
  assert.equal(run('biceps_curl', frames).eng.count, 6);
});

test("switching arms does not report the other arm's fault as fixed", () => {
  // left arm: 3 reps that never come all the way down (short_bottom), then the right arm: 3 clean reps
  const L = wave({ reps: 3, lo: -0.6, hi: -0.1, startHigh: false }).map(s => ({ t: s.t, f: { wristUpL: s.v } }));
  const R = curlWave(3, 0, 6200).map(s => ({ t: s.t, f: { wristUpR: s.v } }));
  const { events } = run('biceps_curl', [...L, ...R]);
  assert.ok(events.some(e => e.type === 'cue' && e.code === 'short_bottom' && e.side === 'left'));
  assert.ok(!events.some(e => e.type === 'fixed'));
});

test('nothing is counted while the needed body parts are out of view', () => {
  const frames = wave({ reps: 4, lo: 85, hi: 175 }).map(s => ({ t: s.t, f: { ...squatFrame(s.v), visLegs: 0.2 } }));
  const { eng, events } = run('squat', frames);
  assert.equal(eng.count, 0);
  assert.ok(events.some(e => e.type === 'visibility'));
});

test('overhead press facing the camera: no lean-back cue from the depth-noisy torso angle', () => {
  const frames = wave({ reps: 4, lo: -0.6, hi: 1.2, startHigh: false })
    .map((s, i) => ({ t: s.t, f: { wristsOverHead: s.v, elbowAvg: 170, torsoLean: s.v > 0.8 ? 26 : 4 } }));
  const { eng, events } = run('overhead_press', frames);
  assert.equal(eng.count, 4);
  assert.ok(!events.some(e => e.type === 'cue' && e.code === 'arch'));
});

test('a cue and "fixed" are never raised on the same rep', () => {
  // 3 shallow squats (cue), 2 deep (fixed), then shallow again
  const shallow = wave({ reps: 3, lo: 125, hi: 175 });
  const deep = wave({ reps: 2, lo: 85, hi: 175 }).map(s => ({ t: s.t + 6100, v: s.v }));
  const again = wave({ reps: 2, lo: 125, hi: 175 }).map(s => ({ t: s.t + 10200, v: s.v }));
  const frames = [...shallow, ...deep, ...again].map(s => ({ t: s.t, f: { ...squatFrame(s.v), view: 'side' } }));
  const { events } = run('squat', frames);
  const fixed = events.filter(e => e.type === 'fixed');
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].message, 'Go deeper: thighs closer to parallel');
  const repAt = t => events.filter(e => e.type !== 'rep' && e.t === t).map(e => e.type);
  for (const e of events.filter(x => x.type === 'fixed')) assert.ok(!repAt(e.t).includes('cue'));
});

// --- live-test failures (2026-10-22): legs mostly out of view, steps counted as squats -----------------------------
// a squat as measured live: both hips bend with the knees, the legs fold (1 standing, ~0.45 at ~90 deg knees)
const squatFrame = (knee, extra = {}) => {
  const hip = Math.min(178, knee + 5);
  return { kneeL: knee, kneeR: knee, kneeAvg: knee, kneeMin: knee, kneeMax: knee, hipL: hip, hipR: hip, hipAvg: hip,
    hipMin: hip, hipAsym: 0, kneeAsym: 0, legHeight: 0.4 + 0.6 * (knee - 60) / 115, feetSplit: 0.02,
    hipHeight: -1 - (175 - knee) / 100, ...extra };
};

test('walking in place (one knee at a time, hips level) is not a squat', () => {
  const frames = wave({ reps: 8, lo: 100, hi: 172, periodMs: 1200 }).map((s, i) => {
    const left = Math.floor(s.t / 600) % 2 === 0;           // alternate legs
    const kL = left ? s.v : 172, kR = left ? 172 : s.v;
    return { t: s.t, f: { kneeL: kL, kneeR: kR, kneeAvg: (kL + kR) / 2, kneeMin: Math.min(kL, kR), kneeMax: Math.max(kL, kR), hipHeight: -1.02 } };
  });
  assert.equal(run('squat', frames).eng.count, 0);
});

test('knee angles that swing while the hips stay put (guessed legs) are not squats', () => {
  const frames = wave({ reps: 5, lo: 95, hi: 170 }).map(s => ({ t: s.t, f: { ...squatFrame(s.v), hipL: 168, hipR: 166,
    hipAvg: 167, legHeight: 1 } }));
  assert.equal(run('squat', frames).eng.count, 0);
});

test('legs flickering in and out of view: the gaps never make reps, and counting waits for a steady view', () => {
  // standing still; every 400 ms the legs vanish for 300 ms and come back with a guessed bent knee
  const frames = [];
  for (let t = 0; t < 10000; t += 33) {
    const gap = t % 700 >= 400;
    frames.push({ t, f: gap ? { ...squatFrame(95), visLegs: 0.3 } : squatFrame(171) });
  }
  const { eng, events } = run('squat', frames, { settle: false });
  assert.equal(eng.count, 0);
  assert.ok(!events.some(e => e.type === 'ready'));          // never 0.5 s in view in one piece
});

test('real squats after stepping into view are counted once the view is steady', () => {
  const frames = [];
  for (let t = 0; t < 2000; t += 33) frames.push({ t, f: { ...squatFrame(171), visLegs: 0.2 } });   // walking into frame
  for (const s of wave({ reps: 5, lo: 90, hi: 172 })) frames.push({ t: s.t + 2500, f: squatFrame(s.v) });
  const { eng, events } = run('squat', frames);
  assert.equal(eng.count, 5);
  assert.ok(events.some(e => e.type === 'ready'));
});

test('leaving the picture entirely resets counting: a squat half done before and half after is not a rep', () => {
  const eng = new ExerciseEngine('squat');
  let t = 0;
  for (; t < 1500; t += 33) eng.update({ ...base, ...squatFrame(172) }, t);          // in view, standing
  for (const k of [160, 140, 120]) { eng.update({ ...base, ...squatFrame(k) }, t); t += 33; }   // going down...
  for (let i = 0; i < 30; i++, t += 33) eng.lost(t);                                  // ...nobody found for 1 s
  for (; t < 4000; t += 33) eng.update({ ...base, ...squatFrame(172) }, t);          // back, standing
  assert.equal(eng.count, 0);
});

test('squat pulses: jogging-like knee bends with the hips near standing height are not pulses', () => {
  const frames = [];
  for (let t = 0; t < 1500; t += 33) frames.push({ t, f: squatFrame(172) });
  for (let t = 1500; t < 9000; t += 33) {
    const k = 125 + 10 * Math.sin(t / 120);                 // bent knees bouncing, hips barely lower than standing
    frames.push({ t, f: { ...squatFrame(k), hipHeight: -1.05 + 0.02 * Math.sin(t / 120), legHeight: 0.93 + 0.02 * Math.sin(t / 120) } });
  }
  assert.equal(run('squat_pulse', frames).eng.count, 0);
});

test('squat pulses low in a real squat are counted', () => {
  const frames = [];
  for (let t = 0; t < 1500; t += 33) frames.push({ t, f: squatFrame(172) });          // standing
  for (let t = 1500; t < 2500; t += 33) frames.push({ t, f: squatFrame(172 - (t - 1500) * 0.07) });   // down to ~102
  for (const s of wave({ reps: 6, lo: 98, hi: 115, periodMs: 1000 })) frames.push({ t: s.t + 2500, f: squatFrame(s.v) });
  assert.equal(run('squat_pulse', frames).eng.count, 6);
});

// --- second live test (2026-10-22): a lunge and a random turn counted as squats ------------------------------------
const lungeFrame = knee => {        // front hip bends with the knees, the back hip stays nearly straight, feet split
  const front = Math.min(178, knee + 15), back = 168;
  return { ...squatFrame(knee), hipL: front, hipR: back, hipAvg: (front + back) / 2, hipMin: front,
    hipAsym: Math.abs(front - back), feetSplit: 0.5 };
};

test('a lunge is not a squat (one hip bent ~60 deg more than the other, feet split front to back)', () => {
  const frames = wave({ reps: 4, lo: 85, hi: 172 }).map(s => ({ t: s.t, f: lungeFrame(s.v) }));
  assert.equal(run('squat', frames).eng.count, 0);
  assert.equal(run('lunge', frames).eng.count, 4);
});

test('a squat is not a lunge (both hips alike, feet side by side)', () => {
  const frames = wave({ reps: 4, lo: 88, hi: 172 }).map(s => ({ t: s.t, f: squatFrame(s.v) }));
  assert.equal(run('lunge', frames).eng.count, 0);
  assert.equal(run('squat', frames).eng.count, 4);
});

test('turning on the spot (knees soften, hips stay nearly straight, legs barely fold) is not a squat', () => {
  // live rep 5: knees 130/133, hips 170/162, legs at 0.78 of standing height
  const frames = wave({ reps: 3, lo: 128, hi: 172 }).map(s => ({ t: s.t, f: { ...squatFrame(s.v),
    hipL: 168 - (172 - s.v) * 0.1, hipR: 164 - (172 - s.v) * 0.1, hipAvg: 166 - (172 - s.v) * 0.1, legHeight: 1 - (172 - s.v) * 0.005 } }));
  const { eng } = run('squat', frames);
  assert.equal(eng.count, 0);
  assert.equal(eng.partials, 0);
});

test('shallow but real squat attempts are partial reps, not counted and not ignored', () => {
  const frames = wave({ reps: 4, lo: 122, hi: 172 }).map(s => ({ t: s.t, f: squatFrame(s.v) }));
  const { eng, events } = run('squat', frames);
  assert.equal(eng.count, 0);
  assert.equal(eng.partials, 4);
  assert.ok(events.some(e => e.type === 'cue' && e.code === 'shallow'));
});

test('stepping in place (one knee bends, hips asymmetric, the standing leg straight) is not a lunge', () => {
  const frames = wave({ reps: 8, lo: 110, hi: 170, periodMs: 800 }).map(s => ({ t: s.t, f: { ...squatFrame(172),
    kneeL: s.v, kneeMin: s.v, kneeAvg: (s.v + 172) / 2, kneeMax: 172, hipL: s.v + 10, hipAsym: 172 - s.v, legHeight: 0.92 } }));
  assert.equal(run('lunge', frames).eng.count, 0);
});

test('push-up lockout held before the first rep counts as locked out', () => {
  // top at 158 deg (locked out), then two reps; the window of rep 1 starts once lowering began
  const frames = [];
  for (let t = 0; t < 1500; t += 33) frames.push({ t, f: { elbowAvg: 158, shoulderHeight: -0.5, view: 'side', posture: 'horizontal' } });
  for (const s of wave({ reps: 2, lo: 92, hi: 158, periodMs: 3000 })) {
    frames.push({ t: s.t + 1500, f: { elbowAvg: s.v, shoulderHeight: -0.5 - (158 - s.v) / 200, view: 'side', posture: 'horizontal' } });
  }
  const { eng, events } = run('pushup', frames);
  assert.equal(eng.count, 2);
  assert.ok(!events.some(e => e.type === 'rep' && e.faults.some(f => f.code === 'no_lockout')));
});

test('standing before getting down is not the rest position of a push-up (a live set read a 94% pike on rep 1)', () => {
  // standing with straight arms (the straightest the elbows get), then a 6 s plank, then two clean reps
  const frames = [];
  for (let t = 0; t < 1500; t += 33) frames.push({ t, f: { elbowAvg: 175, hipSag: -0.94, view: 'side', posture: 'upright' } });
  for (let t = 1500; t < 7500; t += 33) frames.push({ t, f: { elbowAvg: 158, hipSag: 0.02, shoulderHeight: -0.5, view: 'side', posture: 'horizontal' } });
  for (const s of wave({ reps: 2, lo: 92, hi: 158, periodMs: 3000 })) {
    frames.push({ t: s.t + 7500, f: { elbowAvg: s.v, hipSag: 0.02, shoulderHeight: -0.5 - (158 - s.v) / 200, view: 'side', posture: 'horizontal' } });
  }
  const { eng, events } = run('pushup', frames);
  assert.equal(eng.count, 2);
  assert.deepEqual(events.filter(e => e.type === 'rep').map(e => e.faults.map(f => f.code)), [[], []]);
  assert.ok(Number.isNaN(squatPose(0, 0).hipSag), 'standing: no shoulder-to-ankle line to measure the hips against');
});

// --- review of auto mode (2026-10-23) ----------------------------------------------------------------------------
// synthetic side-view squat landmarks: depth 0 = standing, 1 = bottom, with the torso leaning `lean` degrees at the
// bottom; `dx` moves the person sideways in the frame
const rad = d => (d * Math.PI) / 180;
function squatPose(depth, lean, dx = 0, aspect = 16 / 9) {
  const a = rad(30 * depth), b = rad(75 * depth), c = rad(lean * depth);
  const P = { ankle: [0, 0] };
  P.knee = [0.45 * Math.sin(a), 0.45 * Math.cos(a)];
  P.hip = [P.knee[0] - 0.45 * Math.sin(b), P.knee[1] + 0.45 * Math.cos(b)];
  P.sh = [P.hip[0] + 0.5 * Math.sin(c), P.hip[1] + 0.5 * Math.cos(c)];
  P.ear = [P.sh[0] + 0.2 * Math.sin(c) + 0.03, P.sh[1] + 0.2 * Math.cos(c)];
  P.nose = [P.ear[0] + 0.1, P.ear[1] - 0.02];
  P.elbow = [P.sh[0] + 0.28, P.sh[1]]; P.wrist = [P.sh[0] + 0.55, P.sh[1]];
  P.heel = [-0.05, -0.03]; P.foot = [0.18, -0.05];
  const map = { 0: 'nose', 7: 'ear', 8: 'ear', 11: 'sh', 12: 'sh', 13: 'elbow', 14: 'elbow', 15: 'wrist', 16: 'wrist',
    25: 'knee', 26: 'knee', 27: 'ankle', 28: 'ankle', 29: 'heel', 30: 'heel', 31: 'foot', 32: 'foot' };
  const world = [], image = [];
  for (let i = 0; i < 33; i += 1) {
    const [x, y] = P[map[i] || 'hip'], z = i % 2 ? 0.12 : -0.12;
    world.push({ x: x - P.hip[0], y: -(y - P.hip[1]), z, visibility: 0.99 });
    image.push({ x: 0.5 + dx + (x * 0.4) / aspect + (i % 2 ? 0.002 : -0.002), y: 0.85 - y * 0.4, z: 0, visibility: 0.99 });
  }
  return features(world, image, aspect);
}
function leaningSquats(lean, dx = 0) {
  const eng = new ExerciseEngine('squat'), events = [];
  for (let t = 0; t < 20000; t += 33) {
    const depth = t < 2000 || t > 17000 ? 0 : (1 - Math.cos((2 * Math.PI * (t - 2000)) / 3000)) / 2;
    events.push(...eng.update(squatPose(depth, lean, dx), t));
  }
  return { eng, events };
}

test('squats leaning far forward (side view) still count in manual mode and get the chest-up cue', () => {
  for (const lean of [52, 58, 65]) {
    const { eng, events } = leaningSquats(lean);
    assert.equal(eng.count, 5, `lean ${lean}`);
    assert.ok(events.some(e => e.type === 'cue' && e.code === 'chest_down'), `lean ${lean}`);
    assert.equal(squatPose(1, lean).posture, 'upright', `lean ${lean}: folded at the hips is not lying down`);
  }
});

test("how far the hips travel over a rep does not depend on where the person stands in the frame", () => {
  const travel = dx => leaningSquats(40, dx).events.filter(e => e.type === 'rep').map(e => e.hipTravel);
  const centre = travel(0);
  assert.equal(centre.length, 5);
  assert.deepEqual(travel(-0.3), centre);
  assert.deepEqual(travel(0.3), centre);
});

test('lying horizontal is required of push-ups only in auto mode (manual mode counts incline and wall push-ups)', () => {
  const frames = [];
  for (let t = 0; t < 1500; t += 33) frames.push({ t, f: { elbowAvg: 158, shoulderHeight: -0.5, view: 'side', posture: 'upright' } });
  for (const s of wave({ reps: 3, lo: 80, hi: 158 }))
    frames.push({ t: s.t + 1500, f: { elbowAvg: s.v, shoulderHeight: -0.5 - (158 - s.v) / 200, view: 'side', posture: 'upright' } });
  const { eng, events } = run('pushup', frames);
  assert.equal(eng.count, 3);
  assert.ok(events.filter(e => e.type === 'rep').every(e => e.distinct === false));
});

// --- third live test (2026-10-23): push-ups and jumping jacks not counted -----------------------------------------
test('push-ups count with the hands just below the frame (shoulder and elbow in view are enough)', () => {
  const frames = [];
  for (let t = 0; t < 1500; t += 33) frames.push({ t, f: { elbowAvg: 158, shoulderHeight: -0.5, view: 'side', posture: 'horizontal', visArms: 0 } });
  for (const s of wave({ reps: 4, lo: 90, hi: 158 }))
    frames.push({ t: s.t + 1500, f: { elbowAvg: s.v, shoulderHeight: -0.5 - (158 - s.v) / 200, view: 'side', posture: 'horizontal', visArms: 0 } });
  assert.equal(run('pushup', frames).eng.count, 4);
});

test('a body part dropping out of view for a moment does not reset the count; a longer gap does', () => {
  const frames = gap => wave({ reps: 4, lo: 88, hi: 172 }).map(s => ({ t: s.t,
    f: { ...squatFrame(s.v), visLegs: Math.floor(s.t / 1000) % 2 === 1 && s.t % 1000 < gap ? 0 : 1 } }));
  assert.equal(run('squat', frames(300)).eng.count, 4);
  assert.ok(run('squat', frames(900)).eng.count < 4);
});

test('jumping jacks with the arms out to shoulder height count; hands behind the head while stepping out do not', () => {
  const jack = (elbow, feetOpen) => wave({ reps: 4, lo: 15, hi: 110, periodMs: 1200, startHigh: false }).map(s => {
    const open = (s.v - 15) / 95;
    return { t: s.t, f: { armAvg: s.v, armL: s.v, armR: s.v, elbowAvg: elbow, elbowL: elbow, elbowR: elbow, feetWidth: 0.7 + open * (feetOpen - 0.7),
      kneeMax: 165, kneeMin: 162, view: 'front', hipX: 0 } };
  });
  const distinct = frames => run('jumping_jack', frames).events.filter(e => e.type === 'rep').map(e => e.distinct);
  assert.deepEqual(distinct(jack(160, 3.8)), [true, true, true, true]);
  assert.deepEqual(distinct(jack(160, 1.6)), [true, true, true, true]);   // narrow / low-impact jacks count too
  assert.ok(distinct(jack(60, 3.8)).every(d => !d));          // elbows bent with the hands at head height: behind the head
});

test('bent-arm jacks with the hands meeting above the head count; a side lunge with the arms out does not', () => {
  const frames = extra => wave({ reps: 4, lo: 15, hi: 150, periodMs: 1200, startHigh: false }).map(s => {
    const open = (s.v - 15) / 135;
    return { t: s.t, f: { armAvg: s.v, armL: s.v, armR: s.v, elbowAvg: 165 - open * 60, feetWidth: 0.7 + open * 3, kneeMax: 168, kneeMin: 165,
      wristsOverHead: -1 + open * 1.4, view: 'front', hipX: 0, ...extra(open) } };
  });
  const distinct = fr => run('jumping_jack', fr).events.filter(e => e.type === 'rep').map(e => e.distinct);
  assert.deepEqual(distinct(frames(() => ({}))), [true, true, true, true]);
  assert.ok(distinct(frames(o => ({ kneeMin: 172 - o * 68, elbowAvg: 168 }))).every(d => !d));   // one knee bends to ~104
});

// --- 3D demo clips (2026-10-23): MediaPipe on a mannequin --------------------------------------------------------
test('arm swings with jittery foot width (hip points collapsing for a frame) are not jumping jacks', () => {
  // feet stay put (~1.7 hip widths) but read 1.0-2.1, with no trend between the arms' start and top
  const frames = wave({ reps: 6, lo: 15, hi: 160, periodMs: 1000, startHigh: false }).map((s, i) => ({ t: s.t, f: {
    armAvg: s.v, armL: s.v, armR: s.v, elbowAvg: 160, elbowL: 160, elbowR: 160, kneeMax: 168, kneeMin: 165, view: 'front', hipX: 0,
    wristsOverHead: -1 + (s.v - 15) / 100, feetWidth: 1.7 + 0.4 * Math.sin(i * 1.7) } }));
  assert.ok(run('jumping_jack', frames).events.filter(e => e.type === 'rep').every(e => !e.distinct));
});

test('foot width is measured against a hip width of at least 0.3 body scales (collapsed hip points)', () => {
  const lm = (x, y) => ({ x, y, z: 0, visibility: 0.99 });
  const image = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  Object.assign(image, { 0: lm(0.5, 0.2), 7: lm(0.49, 0.2), 8: lm(0.51, 0.2), 11: lm(0.45, 0.3), 12: lm(0.55, 0.3), 23: lm(0.499, 0.55),
    24: lm(0.501, 0.55), 25: lm(0.48, 0.7), 26: lm(0.52, 0.7), 27: lm(0.47, 0.85), 28: lm(0.53, 0.85), 13: lm(0.43, 0.42), 14: lm(0.57, 0.42),
    15: lm(0.43, 0.52), 16: lm(0.57, 0.52) });
  const world = image.map(p => ({ x: p.x - 0.5, y: p.y - 0.55, z: 0, visibility: 0.99 }));
  const f = features(world, image, 1);
  assert.ok(f.feetWidth < 3, `feet 0.06 apart with hips collapsed to 0.002 read ${f.feetWidth.toFixed(1)} hip widths`);
});

// --- auto mode deciding early (2026-10-23) ------------------------------------------------------------------------
test('pendingTurns: the turning points of reps in progress, unless the posture rules the exercise out', () => {
  // the hips open from 100 to 170 deg (a deadlift coming up to its lockout), standing or lying
  const rising = posture => Array.from({ length: 46 }, (_, i) => ({ t: i * 33, f: { hipAvg: 100 + i * 1.6, posture } }));
  assert.deepEqual(run('hinge', rising('upright')).eng.pendingTurns(), [45 * 33]);
  assert.deepEqual(run('hinge', rising('horizontal')).eng.pendingTurns(), []);   // a deadlift is not done lying down
  assert.deepEqual(run('hinge', rising('upright').slice(0, 5)).eng.pendingTurns(), []);   // not a full prominence yet
  // per arm: one turning point per arm in a rep (one arm held up must not hide the other)
  const curl = Array.from({ length: 30 }, (_, i) => ({ t: i * 33, f: { wristUpL: -1 + i * 0.03, wristUpR: i < 15 ? -1 + i * 0.06 : -0.16 } }));
  assert.equal(run('biceps_curl', curl).eng.pendingTurns().length, 2);
});

test('`lying` says what each exercise\'s distinct rule requires of the posture at the turning point', () => {
  const marked = Object.entries(EXERCISES).filter(([, ex]) => ex.lying !== undefined);
  assert.ok(marked.length >= 6);
  for (const [k, ex] of marked) {
    const s = { at: { posture: ex.lying ? 'upright' : 'horizontal' }, start: {}, min: {}, max: {}, rows: [] };
    assert.equal(!!ex.distinct(s, { view: 'side' }, 'L'), false, k);
  }
});
