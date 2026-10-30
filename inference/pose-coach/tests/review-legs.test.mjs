// Bend-order anchoring for the feet/legs review: synthetic landmark streams with known knee bends and turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareFrames, sampleFrames, align, differences, settledEdges, legEvents, reviewWindows } from '../web/js/review-analysis.js';
import { kneeBends, footRise, anchoredPhrases, anchoredTime, anchoredReview, anchoredResult, anchoredDifferences } from '../web/js/review-legs.js';
import { referenceMotion } from '../web/js/reference-motion.js';

// A standing body facing the camera; each bend folds one shin backward and brings the thigh a little forward.
function body(t, { left = 170, right = 170, yaw = 0, hide = [] } = {}) {
  const world = Array(33).fill(null), r = yaw * Math.PI / 180;
  const thigh = k => (170 - k) * .3 * Math.PI / 180, knee = (x, k) => [x, .4 * Math.cos(thigh(k)), -.4 * Math.sin(thigh(k))];
  const shin = (x, k) => { const a = (180 - k) * Math.PI / 180 - thigh(k), q = knee(x, k); return [x, q[1] + .4 * Math.cos(a), q[2] + .4 * Math.sin(a)]; };
  Object.assign(world, { 0: [0, -.75, 0], 7: [.07, -.72, .05], 8: [-.07, -.72, .05], 11: [.18, -.5, 0], 12: [-.18, -.5, 0], 13: [.22, -.25, 0], 14: [-.22, -.25, 0],
    15: [.23, 0, 0], 16: [-.23, 0, 0], 23: [.1, 0, 0], 24: [-.1, 0, 0], 25: knee(.1, left), 26: knee(-.1, right), 27: shin(.1, left), 28: shin(-.1, right) });
  world[31] = [world[27][0], world[27][1] + .05, world[27][2] - .1]; world[32] = [world[28][0], world[28][1] + .05, world[28][2] - .1];
  const turned = world.map(p => p && [p[0] * Math.cos(r) - p[2] * Math.sin(r), p[1], p[0] * Math.sin(r) + p[2] * Math.cos(r)]);
  return { t, world: turned, image: turned.map((p, i) => p && [.5 + p[0] / 3, .45 + p[1] / 3, 0, hide.includes(i) ? .2 : .95]) };
}
// Bends: [{side, at (s), depth (knee°), yaw}] — each a 0.6 s cosine dip; yaw steps to the bend's value.
function stream(bends, duration, rate = 30, { hide = () => [] } = {}) {
  const frames = [];
  for (let i = 0; i <= duration * rate; i++) {
    const s = i / rate, knee = { left: 170, right: 170 };
    let yaw = 0;
    for (const b of bends) {
      if (s >= b.at - .6) yaw = b.yaw ?? yaw;
      const d = Math.abs(s - b.at);
      if (d < .3) knee[b.side] = Math.min(knee[b.side], 170 - (170 - b.depth) * (.5 + .5 * Math.cos(d / .3 * Math.PI)));
    }
    frames.push(body(s * 1000, { ...knee, yaw, hide: hide(s) }));
  }
  return prepareFrames(frames);
}
const REF = [{ side: 'right', at: .15, depth: 110, yaw: -15 }, { side: 'left', at: .8, depth: 85, yaw: -15 }, { side: 'left', at: 1.7, depth: 85, yaw: 22 }, { side: 'right', at: 2.7, depth: 55, yaw: 22 }];
const reference = () => stream(REF, 4.6, 10).map(f => ({ ...f, reference: true }));
const user = (bends, options) => stream(bends, 8, 30, options).map(f => ({ ...f, t: f.t + 50000 }));
const slower = (k = 1.4, change = {}) => REF.map((b, i) => ({ ...b, at: 1.5 + b.at * k, ...(change[i] ?? {}) }));
const run = frames => anchoredReview(frames, reference(), { start: frames[0].t, end: frames.at(-1).t, attempt: 1 }, 4600);

test('bend order, pace and turn anchor a phrase; a matching phrase with matching bends gives no cue', () => {
  const r = run(user(slower()));
  assert.equal(r.phrases.length, 1);const p = r.phrases[0];
  assert.equal(p.mirrored, false);assert.deepEqual(p.pairs.map(x => x.user.side), ['right', 'left', 'left', 'right']);
  assert.ok(Math.abs(p.pace - 1.4) < .1);assert.deepEqual(p.findings, []);
  // Timing map passes through each matched bend and stays inside the reference clip.
  for (const q of p.pairs) assert.ok(Math.abs(anchoredTime(p, q.user.t, 4600) - q.reference.t) < 1e-6);
  assert.equal(anchoredTime(p, p.start - 5000, 4600), 0);assert.equal(anchoredTime(p, p.end + 5000, 4600), 4600);
});

test('a shallower second left lift gives one left-knee cue only when knee angle and image foot height agree', () => {
  const r = run(user(slower(1.4, { 2: { depth: 125 } })));
  const f = r.phrases[0].findings;assert.equal(f.length, 1);
  assert.equal(f[0].part, 'left knee');assert.equal(f[0].ordinal, 2);assert.ok(f[0].userValue - f[0].referenceValue >= 25);
  assert.ok(f[0].referenceRise - f[0].userRise >= .1);assert.match(f[0].cue, /bend your left knee more/);
  // The highlight is limited to the measured bend.
  const bend = r.phrases[0].pairs[2].user;assert.equal(f[0].start, bend.start);assert.equal(f[0].end, bend.end);
  // A deeper lift is a freestyle choice, not a correction.
  assert.deepEqual(run(user(slower(1.4, { 2: { depth: 60 } }))).phrases[0].findings, []);
  // Same knee angle difference but no lower foot (e.g. thigh lifted instead): measurements disagree, no cue.
  const p = run(user(slower(1.4, { 2: { depth: 125 } }))).phrases[0];
  p.pairs[2].user.rise = p.pairs[2].reference.rise;assert.deepEqual(anchoredDifferences(p), []);
});

test('a bend whose deepest frames are low-confidence is marked hidden and never gives a straighter-knee cue', () => {
  const bends = slower(1.4, { 2: { depth: 115 } }), at = bends[2].at, near = s => Math.abs(s - at) < .04;
  const visible = run(user(bends));assert.equal(visible.phrases[0].findings.length, 1);
  // Hide the left ankle at the bend peak; its raw estimate there is deeper than the visible minimum.
  const frames = user(bends, { hide: s => near(s) ? [27] : [] });
  for (const f of frames) if (near((f.t - 50000) / 1000)) f.world[27] = body(0, { left: 80 }).world[27];
  const r = run(frames), bend = r.userBends.find(b => b.side === 'left' && Math.abs(b.t - 50000 - at * 1000) < 300);
  assert.equal(bend.hidden, true);assert.deepEqual(r.phrases.flatMap(p => p.findings), []);
});

test('a mirrored copy is reported as mirrored and gives no left/right cue; a wrong turn direction is not anchored', () => {
  const mirrored = slower(1.4, { 2: { depth: 125 } }).map(b => ({ ...b, side: b.side === 'left' ? 'right' : 'left', yaw: -b.yaw }));
  const r = run(user(mirrored));assert.ok(r.phrases.length);assert.ok(r.phrases.every(p => p.mirrored));
  assert.deepEqual(r.phrases.flatMap(p => anchoredDifferences(p)), []);
  const wrongTurn = slower().map(b => ({ ...b, yaw: -b.yaw }));
  assert.ok(run(user(wrongTurn)).phrases.every(p => p.mirrored === false ? false : true));
  assert.equal(run(user(wrongTurn)).phrases.filter(p => !p.mirrored).length, 0);
});

test('bends at an inconsistent pace, or alternating steps without the reference order, are not anchored', () => {
  assert.equal(run(user(slower(1.4, { 2: { at: 1.5 + 1.7 * 1.4 + 3 } }))).phrases.filter(p => !p.mirrored).length, 0);
  const alternating = [{ side: 'right', at: 1.5, depth: 95, yaw: -30 }, { side: 'left', at: 2.5, depth: 85, yaw: 0 }, { side: 'right', at: 3.3, depth: 110, yaw: 20 }, { side: 'left', at: 4.4, depth: 110, yaw: 30 }, { side: 'right', at: 5.4, depth: 90, yaw: -15 }];
  assert.equal(run(user(alternating)).phrases.filter(p => !p.mirrored).length, 0);
});

test('anchored phrases stay inside their saved attempt and the replay path is monotone', () => {
  const frames = user(slower(1.4, { 2: { depth: 125 } })), ref = reference(), cut = frames[0].t + 2600;
  const window = { start: frames[0].t, end: cut, attempt: 1 }, r = anchoredReview(frames, ref, window, 4600);
  assert.ok(r.phrases.every(p => p.start >= window.start && p.end <= window.end));
  const p = run(frames).phrases[0], sample = sampleFrames(frames, p.start, p.end), result = anchoredResult(sample, ref, p, 4600);
  assert.equal(result.supported, true);assert.equal(result.anchored, true);
  for (let k = 1; k < result.path.length; k++) assert.ok(result.path[k][1] >= result.path[k - 1][1]);
});

test('DTW: a window that opens with standing still cannot map the reference opening onto it', () => {
  const ref = reference(), moving = user(slower(1)), start = moving[0].t;
  // 1.5 s of standing before the phrase (bends start at 1.5 s): pinned and rejected.
  const pinned = sampleFrames(moving, start, start + 4600 * 1.35), p = align(pinned, ref, { focus: 'legs' });
  assert.ok(p.edges.lead >= 10);assert.equal(p.supported, false);assert.match(p.reason, /still/);assert.deepEqual(differences(pinned, ref, p), []);
  assert.ok(settledEdges(ref, 'legs').lead <= 1);
});

test('DTW: swapped sides that fit as well withhold timing cues; a bend on a straight reference leg is a conflict', () => {
  const ref = reference(), symmetric = REF.map(b => ({ ...b, depth: 85 }));
  const same = sampleFrames(user(symmetric.map(b => ({ ...b, at: b.at + 1.5 }))), 51500, 56100);
  const swapped = ref.map(f => ({ ...f, values: [1, 0, 3, 2, 5, 4, 7, 6].map(k => f.values[k]) }));
  const r = align(same.map(f => ({ ...f, values: [1, 0, 3, 2, 5, 4, 7, 6].map(k => f.values[k]) })), ref, { focus: 'legs' });
  if (r.lateral) assert.notEqual(r.lateral, 'direct');
  assert.equal(r.supported, false);assert.deepEqual(differences(same, swapped, r), []);
  assert.equal(legEvents(ref).length >= 3, true);
});

// Private recordings, never committed: RHYTHM_NEWEST points at the newest session's JSON (two attempts).
const newest = process.env.RHYTHM_NEWEST, glb = new URL('../.data/moves/glb/freestyle_dance.glb', import.meta.url);
test('newest session: no cue on stillness, one supported second-left-lift difference, hidden right bends silent', { skip: !newest || !fs.existsSync(newest) || !fs.existsSync(glb) }, async () => {
  const THREE = await import('../web/vendor/three-0.170.0/build/three.module.js'), b = fs.readFileSync(glb);
  const motion = referenceMotion(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), THREE, 4.6), ref = prepareFrames(motion.frames);
  const raw = fs.readFileSync(newest, 'utf8'), rec = JSON.parse(raw), frames = prepareFrames(rec.frames), origin = frames[0].t;
  const windows = reviewWindows(rec, 'freestyle_dance');assert.deepEqual(windows.map(w => [(w.start - origin) / 1000, (w.end - origin) / 1000]), [[20.819, 115.939], [115.939, 171.363]]);
  // The former cues compared standing at 1:03.3–1:04.1 and 1:57.4–1:59.6 with the reference opening.
  for (const [s, e] of [[63319, 67919], [117439, 120939]]) {
    const u = sampleFrames(frames, origin + s, origin + e), r = align(u, ref, { focus: 'legs' });
    assert.equal(r.supported, false);assert.deepEqual(differences(u, ref, r), []);
  }
  const [first, second] = windows.map(w => anchoredReview(frames, ref, w, motion.duration * 1000));
  const found = first.phrases.flatMap(p => p.findings);assert.equal(found.length, 1);
  assert.equal(found[0].part, 'left knee');assert.ok(Math.abs((found[0].t - origin) / 1000 - 98.4) < .3);
  assert.ok(found[0].userValue > 115 && found[0].referenceValue < 95);assert.ok(found[0].userRise < .25 && found[0].referenceRise > .35);
  assert.ok(second.phrases.length >= 1);assert.ok(second.phrases.every(p => p.start >= windows[1].start));
  // Right bends whose deepest frames lose the ankle never become cues.
  assert.ok([...first.userBends, ...second.userBends].filter(x => x.hidden).length >= 1);
  assert.ok([...first.phrases, ...second.phrases].flatMap(p => p.findings).every(f => f.part !== 'right knee'));
  assert.equal(JSON.stringify(rec), JSON.stringify(JSON.parse(raw)));
});
