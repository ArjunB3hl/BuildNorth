// The reference poses of the guard rails: "Like this", next to the user's frames ("You") when a check of a moving or
// rhythm movement (web/js/moveform.js MOVE_FORMS) finds a mistake. tools/build_moves.mjs refPosesOf picks, for each
// check, the reference skeleton's frame that best shows it done right at the moment the check judges it: a turn of the
// rhythm's signal for a peak or trough check, a frame in its phase (the stillest) for a frame check. Public: made-up
// skeletons with made-up checks. Private (.data/moves/, skipped when not on this machine): the library's references
// with the real checks, every pose passing its check on its frame, in the picture, on its side, and the other side
// mirrored.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOVE_FORMS, bodyMetrics } from '../web/js/moveform.js';
import { mirrorSkeleton, okMargin, refPosesOf, referenceFrames, referenceTurns, skeletonFromNpz, skeletonLandmarks }
  from '../tools/build_moves.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30, ASPECT = 16 / 9;
const rad = d => (d * Math.PI) / 180;
const add = (a, b, s = 1) => a.map((v, k) => v + s * b[k]);
const r4 = v => +v.toFixed(4);
const SIDE = { L: 'left', R: 'right' };
const flip = s => (s === 'left' ? 'right' : s === 'right' ? 'left' : null);

// --- made-up skeletons ----------------------------------------------------------------------------------------------
/** One frame's SMPL joints (Y-up metres, facing +z, the person's left +x) of a person standing, the feet 0.2 m apart:
 * both knees bent to `knee` deg (thigh and shin 0.42 m, the hips straight over the ankles), the trunk upright (0.5 m
 * to the shoulders, 0.36 m wide), each arm straight (0.3 m to the elbow, 0.6 m to the wrist) raised `armL` / `armR` deg
 * from straight down, out to its side. `wristR`: the right wrist put there instead (a landmark thrown out). */
function joints({ knee = 180, armL = 5, armR = 5, wristR = null } = {}) {
  const phi = rad((180 - knee) / 2), J = {};
  for (const [s, x] of [['left', 0.1], ['right', -0.1]]) {
    const kn = [x, 0.08 + 0.42 * Math.cos(phi), 0.42 * Math.sin(phi)];
    Object.assign(J, { [`${s}_ankle`]: [x, 0.08, 0], [`${s}_knee`]: kn, [`${s}_foot`]: [x, 0.02, 0.12],
      [`${s}_hip`]: [x, kn[1] + 0.42 * Math.cos(phi), 0] });
  }
  const y = J.left_hip[1];
  J.pelvis = [0, y, 0]; J.head = [0, y + 0.72, 0];
  for (const [s, sx, a] of [['left', 1, armL], ['right', -1, armR]]) {
    const sh = [sx * 0.18, y + 0.5, 0], d = [sx * Math.sin(rad(a)), -Math.cos(rad(a)), 0];
    Object.assign(J, { [`${s}_shoulder`]: sh, [`${s}_elbow`]: add(sh, d, 0.3), [`${s}_wrist`]: add(sh, d, 0.6) });
  }
  if (wristR) J.right_wrist = wristR;
  return J;
}
/** A made-up clip ({fps, joints}) of `seconds` at 30 fps: `at(s)`, the joints() options at s seconds. */
function clip(seconds, at) {
  const out = { fps: FPS, joints: {} };
  for (let i = 0; i <= Math.round(seconds * FPS); i++) {
    for (const [k, p] of Object.entries(joints(at(i / FPS)))) (out.joints[k] ??= []).push(p);
  }
  return out;
}
const ease = u => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, u)))) / 2;
/** a, to b and back to a over [t0, t1] (a cosine); a outside it. */
const dip = (s, t0, t1, a, b) => (s <= t0 || s >= t1 ? a
  : a + ((b - a) * (1 - Math.cos((2 * Math.PI * (s - t0)) / (t1 - t0)))) / 2);

// Knee bends: standing 1 s; a bend to 100 deg (1-3 s); down to 70 over 3-4 s, held there to 5 s, up by 6 s, the left
// arm raised all through it (3-6 s); a bend to 90 (6-8 s, its bottom at 7 s); standing to 9.5 s.
const bendKnee = s => (s < 3 ? dip(s, 1, 3, 180, 100) : s < 4 ? 180 - 110 * ease(s - 3) : s < 5 ? 70
  : s < 6 ? 70 + 110 * ease(s - 5) : dip(s, 6, 8, 180, 90));
const bendArm = s => (s < 3 || s > 6 ? 5 : 5 + 95 * Math.min(ease((s - 3) / 0.3), ease((6 - s) / 0.3)));
const BENDS = clip(9.5, s => ({ knee: bendKnee(s), armL: bendArm(s) }));
const BEND = { key: 'made_up_bends', display: 'Made-up bends', kind: 'gym_reps', track: 'rhythm',
  rhythm: { signal: 'kneeMax', prominence: 30, minPeriodS: 0.8 } };
const knee = m => Math.max(m.kneeL, m.kneeR);
const deep = { id: 'deep', at: 'trough', needs: ['legs'], value: knee, bad: v => v > 120, ok: v => v <= 115 };
const BEND_FORMS = { made_up_bends: [
  deep,
  { ...deep, id: 'deep_arms_down', phase: m => m.armL < 45 },
  { ...deep, id: 'deeper_than_any', bad: v => v > 50, ok: v => v <= 45 },
  { id: 'bent', at: 'frame', needs: ['legs'], phase: m => knee(m) < 150, value: knee, bad: v => v > 140,
    ok: v => v <= 135 },
  { id: 'never_judged', at: 'frame', needs: ['legs'], phase: m => knee(m) < 40, value: knee, bad: v => v > 30,
    ok: v => v <= 25 },
] };

// One arm raised out to the side three times, the left: to 120 deg (1-3 s), 160 (3-5 s, its top at 4 s), 140 (5-7 s);
// standing to 9 s.
const raiseArm = s => (s < 3 ? dip(s, 1, 3, 5, 120) : s < 5 ? dip(s, 3, 5, 5, 160) : dip(s, 5, 7, 5, 140));
const RAISES = clip(9, s => ({ armL: raiseArm(s) }));
const RAISE = { key: 'made_up_raises', display: 'Made-up raises', kind: 'gym_reps', track: 'rhythm',
  rhythm: { signal: 'armMax', prominence: 40, minPeriodS: 0.8 } };
const armMax = m => Math.max(m.armL, m.armR);
const high = { id: 'high', at: 'peak', needs: ['arms'], value: armMax, bad: v => v < 100, ok: v => v >= 110,
  // the side of the higher hand, from the landmarks (world y is down): the build must give side() both arguments
  side: (m, lm) => (lm.world[15].y < lm.world[16].y ? 'L' : 'R') };
const RAISE_FORMS = { made_up_raises: [
  high,
  { id: 'over_head', at: 'peak', take: 'max', needs: ['arms'], value: m => Math.max(m.wristOverHeadL,
    m.wristOverHeadR), bad: v => v < 0, ok: v => v >= 0.05 },
] };

const frameOf = (skel, t) => skeletonLandmarks(skel)[Math.round(t * skel.fps)];
const imageOf = fr => fr.image.map(p => [r4(p.x), r4(p.y)]);

test('refposes: how clearly a value is ok, its distance to the nearest bad value either way', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} (want ${b})`);
  near(okMargin({ bad: v => v > 45 }, 29), 16);
  near(okMargin({ bad: v => v < 120 }, 137), 17);
  near(okMargin({ bad: v => v < 0.7 }, 1.05), 0.35);
  near(okMargin({ bad: v => v < 0 || v > 10 }, 3), 3);
  assert.equal(okMargin({ bad: () => false }, 3), Infinity);
});

test('refposes: the reference\'s frames as a guard rail sees them, the floor known from the first frame on', () => {
  const frames = referenceFrames(BENDS);
  assert.equal(frames.length, BENDS.joints.pelvis.length);
  const lm = skeletonLandmarks(BENDS);
  for (const fr of frames) {
    assert.deepEqual(fr.lm.image, lm[fr.i].image);
    assert.equal(fr.m.kneeL, bodyMetrics(fr.lm.world, fr.lm.image, ASPECT).kneeL);
    // (the ankles never leave the floor: the knees bend, the hips go down)
    assert.ok(Math.abs(fr.m.feetLift) < 0.02 && fr.m.airborne === false, `${fr.t}: ${fr.m.feetLift}`);
  }
});

test('refposes: a trough check: the most clearly ok of the frames at the rhythm\'s troughs, its phase holding', () => {
  const info = {};
  const poses = refPosesOf(BENDS, BEND, info, { forms: BEND_FORMS });
  const said = id => info.checks.find(x => x.id === id);
  // the deepest bend, held at 70 deg 4-5 s (the frames there all alike: the first of them)
  assert.ok(poses.deep.t >= 4 && poses.deep.t <= 5, `${poses.deep.t}`);
  assert.ok(Math.abs(said('deep').value - 70) < 0.01, `${said('deep').value}`);
  // the arm raised through the deepest bend is out of the phase: the next deepest, the bottom of the 90-degree one
  assert.ok(Math.abs(poses.deep_arms_down.t - 7) < 0.05, `${poses.deep_arms_down.t}`);
  assert.ok(Math.abs(said('deep_arms_down').value - 90) < 0.1, `${said('deep_arms_down').value}`);
  // a line no bend passes: no pose, and the build says why
  assert.equal(poses.deeper_than_any, undefined);
  assert.match(said('deeper_than_any').why, /no trough of the reference it calls ok/);
  // each pose: that frame's 33 image landmarks to 4 decimals, in the picture; no side() gives none
  for (const id of ['deep', 'deep_arms_down', 'bent']) {
    assert.deepEqual(Object.keys(poses[id]), ['image', 'side', 't']);
    assert.deepEqual(poses[id].image, imageOf(frameOf(BENDS, poses[id].t)), id);
    assert.equal(poses[id].image.length, 33);
    assert.ok(poses[id].image.flat().every(v => v > 0 && v < 1), id);
    assert.equal(poses[id].side, null, id);
    // (its time a frame's, in seconds of the clip: frame / fps to the millisecond)
    assert.equal(poses[id].t, Math.round((Math.round(poses[id].t * FPS) / FPS) * 1000) / 1000, `${id}: a frame's time`);
  }
  assert.deepEqual(info.checks.map(x => x.id), BEND_FORMS.made_up_bends.map(c => c.id));
});

test('refposes: a frame check: the stillest of its frames ok (its value and its value smoothed); none judged, none',
  () => {
    const info = {};
    const poses = refPosesOf(BENDS, BEND, info, { forms: BEND_FORMS });
    // still: the 70-degree bend held 4-5 s, the stillness window (half a second) all inside it
    assert.ok(poses.bent.t >= 4.2 && poses.bent.t <= 4.8, `${poses.bent.t}`);
    assert.equal(poses.never_judged, undefined);
    assert.match(info.checks.find(x => x.id === 'never_judged').why, /no frame it judges/);
    // a moving movement (no rhythm) has its frame checks all the same, and its cycle checks none
    const moving = { key: 'made_up_bends', display: '', kind: 'dance', track: 'moving' };
    const info2 = {};
    const p2 = refPosesOf(BENDS, moving, info2, { forms: BEND_FORMS });
    assert.deepEqual(p2.bent, poses.bent);
    assert.equal(p2.deep, undefined);
    assert.match(info2.checks.find(x => x.id === 'deep').why, /no rhythm/);
  });

test('refposes: a peak check\'s side, from side(m, lm) on the chosen frame; mirrored, the same moment, the other side',
  () => {
    const info = {};
    const poses = refPosesOf(RAISES, RAISE, info, { forms: RAISE_FORMS });
    // the highest raise (160 deg, its top at 4 s), on the left
    assert.ok(Math.abs(poses.high.t - 4) < 0.05, `${poses.high.t}`);
    const top = Math.max(...referenceFrames(RAISES).map(f => armMax(f.m)));
    assert.ok(Math.abs(info.checks[0].value - top) < 1e-9, `${info.checks[0].value} (the clip's highest: ${top})`);
    assert.equal(poses.high.side, 'left');
    // take 'max': the largest over the half cycle up to the peak, the same raise's top
    assert.ok(Math.abs(poses.over_head.t - 4) < 0.05, `${poses.over_head.t}`);
    assert.equal(poses.over_head.side, null);
    const mirrored = refPosesOf(mirrorSkeleton(RAISES), RAISE, {}, { forms: RAISE_FORMS });
    for (const id of ['high', 'over_head']) {
      assert.equal(mirrored[id].t, poses[id].t, id);
      assert.equal(mirrored[id].side, flip(poses[id].side), id);
    }
    // (the right hand higher in the mirrored pose: the person's right on the picture's left)
    const I = mirrored.high.image;
    assert.ok(I[16][1] < I[15][1] && I[16][0] < I[15][0]);
  });

test('refposes: an end of the clip is a turn only where the clip dwells there; a frame out of the picture is not shown',
  () => {
    // the clip ends half way up a raise to 160: played back, a peak there would be the most clearly ok; it is no turn
    // of the movement, and the 120-degree raise before it is the pose
    const cut = clip(4, s => ({ armL: s < 3 ? dip(s, 1, 3, 5, 120) : 5 + 155 * (s - 3) }));
    const frames = referenceFrames(cut);
    const peaks = referenceTurns(frames, RAISE, FPS).filter(x => x.kind === 'peak');
    assert.ok(peaks.length && peaks.every(x => Math.abs(frames[x.e].t - 2000) < 200),
      JSON.stringify(peaks.map(x => frames[x.e].t)));
    assert.ok(Math.abs(refPosesOf(cut, RAISE, {}, { forms: RAISE_FORMS }).high.t - 2) < 0.05);
    // ...held at 160 for its last second: its far end, and the pose
    const held = clip(5, s => ({ armL: s < 3 ? dip(s, 1, 3, 5, 120) : 5 + 155 * ease(s - 3) }));
    const t = refPosesOf(held, RAISE, {}, { forms: RAISE_FORMS }).high.t;
    assert.ok(t >= 4 && t <= 5, `${t}`);
    // the right wrist thrown out of the picture through the deepest bend: a pose shows the whole body, so the next
    const out = clip(9.5, s => ({ knee: bendKnee(s), armL: bendArm(s),
      wristR: s > 3.5 && s < 5.5 ? [-3, 1, 0] : null }));
    const p = refPosesOf(out, BEND, {}, { forms: BEND_FORMS });
    assert.ok(Math.abs(p.deep.t - 7) < 0.05, `${p.deep.t}`);
  });

test('refposes: a check of one side the reference never moves: found on it mirrored, its side and its clip time',
  () => {
    // the right arm raised (as RAISES, the other arm); a check of the left arm alone, as one check per side is
    const right = clip(9, s => ({ armR: raiseArm(s) }));
    const leftHigh = { id: 'left_high', at: 'peak', needs: ['armL'], side: () => 'L', phase: m => m.armL > 60,
      value: m => m.armL, bad: v => v < 100, ok: v => v >= 110 };
    const forms = { made_up_raises: [high, leftHigh, { ...leftHigh, id: 'left_never', side: undefined },
      { ...leftHigh, id: 'left_too_high', ok: v => v >= 179, bad: v => v < 178 }] };
    const info = {};
    const poses = refPosesOf(right, RAISE, info, { forms });
    // the reference raises its right arm: found directly, on the right, as before
    assert.equal(poses.high.mirrored, undefined);
    assert.equal(poses.high.side, 'right');
    // the left arm alone: found on the reference mirrored, the highest raise's top (4 s into the clip), on the left
    const p = poses.left_high;
    assert.equal(p.mirrored, true);
    assert.equal(p.side, 'left');
    assert.ok(Math.abs(p.t - 4) < 0.05, `${p.t}`);
    assert.equal(p.t, poses.high.t, 'the same moment of the clip as the right arm\'s');
    // its image the mirrored frame's: the left hand up, on the picture's right (the person faces the camera)
    assert.deepEqual(p.image, imageOf(frameOf(mirrorSkeleton(right), p.t)));
    assert.ok(p.image[15][1] < p.image[16][1] && p.image[15][0] > p.image[16][0]);
    // ...while the clip at that time raises the right
    const I = imageOf(frameOf(right, p.t));
    assert.ok(I[16][1] < I[15][1]);
    const said = id => info.checks.find(x => x.id === id);
    assert.equal(said('left_high').mirrored, true);
    assert.equal(said('high').mirrored, undefined);
    // a check without a side is not tried mirrored; one that finds nothing either way says both
    assert.equal(poses.left_never, undefined);
    assert.doesNotMatch(said('left_never').why, /mirrored/);
    assert.equal(poses.left_too_high, undefined);
    assert.match(said('left_too_high').why, /; mirrored, no peak of the reference it calls ok/);
    // on the left arm's own clip, the same check is found directly, at the same moment
    const direct = refPosesOf(RAISES, RAISE, {}, { forms }).left_high;
    assert.equal(direct.mirrored, undefined);
    assert.equal(direct.side, 'left');
    assert.equal(direct.t, p.t);
  });

// --- the library's references (private) ---------------------------------------------------------------------------
const MOVES_DATA = path.join(ROOT, '.data', 'moves');
const readIf = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const library = readIf(path.join(MOVES_DATA, 'library.json'))?.movements ?? [];
const catalog = readIf(path.join(MOVES_DATA, 'catalog.json'));
/** A library movement's reference skeleton, from its dump or its npz; null if neither is here. */
function referenceOf(entry) {
  const dump = readIf(path.join(MOVES_DATA, 'skel', `${entry.id}.json`));
  if (dump) return dump;
  const npz = catalog && path.join(catalog.source, entry.id, 'source', 'skeleton_motion.npz');
  return npz && fs.existsSync(npz) ? skeletonFromNpz(fs.readFileSync(npz)) : null;
}

for (const key of Object.keys(MOVE_FORMS)) {
  const entry = library.find(x => x.key === key);
  const skel = entry && (entry.track !== 'rhythm' || entry.rhythm) ? referenceOf(entry) : null;
  test(`refposes: ${key}'s reference: each pose its check done right on its frame, in the picture, on its side`,
    { skip: !skel && 'no reference skeleton here' }, () => {
      const info = {};
      const poses = refPosesOf(skel, entry, info);
      const direct = referenceFrames(skel);
      let mirror = null;
      assert.deepEqual(info.checks.map(x => x.id), MOVE_FORMS[key].map(c => c.id));
      for (const c of MOVE_FORMS[key]) {
        const p = poses[c.id], said = info.checks.find(x => x.id === c.id);
        if (!p) { assert.ok(said.why, `${c.id}: why none`); continue; }
        // (found on the reference mirrored: a check of one side, the side the reference does not move; its frame the
        // mirrored skeleton's, at the same time)
        assert.equal(p.mirrored ?? false, said.mirrored ?? false, `${c.id}: said mirrored`);
        if (p.mirrored) {
          assert.equal(p.mirrored, true);
          assert.equal(typeof c.side, 'function', `${c.id}: mirrored, with no side`);
        }
        const frames = p.mirrored ? (mirror ??= referenceFrames(mirrorSkeleton(skel))) : direct;
        const i = Math.round(p.t * skel.fps);
        assert.ok(i >= 0 && i < frames.length && Math.abs(i / skel.fps - p.t) < 1e-3, `${c.id}: a frame's time`);
        // its measures from its own landmarks (the floor as MoveForm finds it over the clip)
        const { lm } = frames[i];
        const m = { ...bodyMetrics(lm.world, lm.image, lm.aspect), feetLift: frames[i].m.feetLift,
          airborne: frames[i].m.airborne };
        assert.ok((c.needs ?? []).every(q => m.seen[q]), `${c.id}: its parts in view`);
        assert.ok(!c.views || c.views.includes(m.view), `${c.id}: judged from the ${m.view}`);
        assert.ok(!c.phase || c.phase(m, lm), `${c.id}: its phase`);
        const v = c.value(m, lm);
        assert.ok(Number.isFinite(v) && c.ok(v) && !c.bad(v), `${c.id}: ok (${v})`);
        assert.equal(v, said.value, c.id);
        assert.equal(p.side, SIDE[c.side?.(m, lm)] ?? null, `${c.id}: its side`);
        assert.deepEqual(p.image, lm.image.map(q => [r4(q.x), r4(q.y)]), c.id);
        assert.equal(p.image.length, 33);
        assert.ok(p.image.every(q => q.length === 2 && q.every(x => x > 0 && x < 1)), `${c.id}: in the picture`);
      }
      // mirrored: the same moment of the movement for each check, on the other side; a check found on the reference
      // mirrored in one run is found on it directly in the other, the same side. A pair of one-sided checks (ids
      // ending _left and _right) on a movement whose sides do different things (the Bharatanatyam's hands: the left
      // comes in at 4.4 s, the right rises at 5.8) may each find, mirrored, the other one's moment, on its own side
      const mirrored = refPosesOf(mirrorSkeleton(skel), entry);
      assert.deepEqual(Object.keys(mirrored), Object.keys(poses));
      const partner = id => id.replace(/_(left|right)$/, (_, s) => (s === 'left' ? '_right' : '_left'));
      for (const [id, p] of Object.entries(poses)) {
        const q = mirrored[id], o = partner(id) !== id ? poses[partner(id)] : null;
        if (o && Math.abs(q.t - p.t) > 2 / skel.fps) {
          assert.ok(Math.abs(q.t - o.t) <= 2 / skel.fps, `${id}: mirrored at neither its moment nor its pair's`);
          assert.ok(!p.mirrored && !q.mirrored && !o.mirrored, `${id}: its sides found directly`);
          assert.equal(q.side, flip(o.side), `${id}: mirrored, its pair's side flipped`);
          continue;
        }
        assert.ok(Math.abs(q.t - p.t) <= 2 / skel.fps, `${id}: mirrored at another moment`);
        if (p.mirrored || q.mirrored) {
          assert.ok(!p.mirrored !== !q.mirrored, `${id}: mirrored in both runs`);
          assert.equal(q.side, p.side, `${id}: mirrored`);
        } else assert.equal(q.side, flip(p.side), `${id}: mirrored`);
      }
    });
}
