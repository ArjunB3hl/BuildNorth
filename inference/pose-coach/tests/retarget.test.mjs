// The person's rep on a 3D character (web/js/retarget.js): a Mixamo skeleton with the Y Bot's rest positions, posed
// from MediaPipe-style world landmarks. Needs three.js from tools/fetch_assets.sh (skipped without it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LM, faultBones, faultParts, makeRetarget, mirrorSide, mirrorWorld, smoothWorld } from '../web/js/retarget.js';

const THREE_PATH = new URL('../web/vendor/three-0.170.0/build/three.module.js', import.meta.url);
const have = fs.existsSync(THREE_PATH);
const THREE = have ? await import(THREE_PATH) : null;
const R = have ? makeRetarget(THREE) : null;
const opt = { skip: have ? false : 'three.js not fetched (bash tools/fetch_assets.sh)' };

// the Y Bot's rest pose (world positions in metres, read from the demos' GLB): T-pose, facing +z, its left on +x
const REST = {
  Hips: [0, 0.998, 0], Spine: [0, 1.1, 0], Spine1: [0, 1.22, 0], Spine2: [0, 1.36, 0], Neck: [0, 1.5, 0], Head: [0, 1.601, -0.003],
  HeadTop_End: [0, 1.786, 0.063],
  LeftShoulder: [0.06, 1.43, -0.06], LeftArm: [0.188, 1.436, -0.062], LeftForeArm: [0.462, 1.436, -0.062], LeftHand: [0.738, 1.436, -0.062],
  LeftUpLeg: [0.091, 0.931, -0.001], LeftLeg: [0.094, 0.525, -0.006], LeftFoot: [0.091, 0.105, -0.026], LeftToeBase: [0.095, 0.033, 0.113],
  LeftToe_End: [0.094, 0.031, 0.213],
  LeftHandMiddle1: [0.866, 1.436, -0.062], LeftHandMiddle2: [0.902, 1.436, -0.062], LeftHandMiddle3: [0.936, 1.436, -0.062],
  LeftHandMiddle4: [0.973, 1.436, -0.062],
};
for (const [k, v] of Object.entries(REST)) if (k.startsWith('Left')) REST[k.replace('Left', 'Right')] = [-v[0], v[1], v[2]];
const PARENT = { Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop_End: 'Head' };
for (const s of ['Left', 'Right']) {
  Object.assign(PARENT, { [`${s}Shoulder`]: 'Spine2', [`${s}Arm`]: `${s}Shoulder`, [`${s}ForeArm`]: `${s}Arm`, [`${s}Hand`]: `${s}ForeArm`,
    [`${s}UpLeg`]: 'Hips', [`${s}Leg`]: `${s}UpLeg`, [`${s}Foot`]: `${s}Leg`, [`${s}ToeBase`]: `${s}Foot`, [`${s}ToeBase`]: `${s}Foot`,
    [`${s}Toe_End`]: `${s}ToeBase`, [`${s}HandMiddle1`]: `${s}Hand`, [`${s}HandMiddle2`]: `${s}HandMiddle1`,
    [`${s}HandMiddle3`]: `${s}HandMiddle2`, [`${s}HandMiddle4`]: `${s}HandMiddle3` });
}

function character() {
  const root = new THREE.Group(), bones = {};
  for (const name of Object.keys(REST)) { bones[name] = new THREE.Bone(); bones[name].name = `mixamorig${name}`; }
  for (const [name, b] of Object.entries(bones)) {
    const p = PARENT[name], at = REST[name], from = p ? REST[p] : [0, 0, 0];
    b.position.set(at[0] - from[0], at[1] - from[1], at[2] - from[2]);
    (p ? bones[p] : root).add(b);
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

// MediaPipe-style world landmarks (origin between the hips, y down, nearer the camera = smaller z) from points given
// in the character's frame (y up, facing +z): the inverse of retarget.js's conversion
const lm = pts => {
  const out = Array.from({ length: 33 }, () => [0, 0, 0]);
  const hip = [(pts.lHip[0] + pts.rHip[0]) / 2, (pts.lHip[1] + pts.rHip[1]) / 2, (pts.lHip[2] + pts.rHip[2]) / 2];
  for (const [k, p] of Object.entries(pts)) out[LM[k]] = [p[0] - hip[0], -(p[1] - hip[1]), -(p[2] - hip[2])];
  return out;
};
const restPts = () => ({
  lSh: REST.LeftArm, rSh: REST.RightArm, lEl: REST.LeftForeArm, rEl: REST.RightForeArm, lWr: REST.LeftHand, rWr: REST.RightHand,
  lHip: REST.LeftUpLeg, rHip: REST.RightUpLeg, lKn: REST.LeftLeg, rKn: REST.RightLeg, lAn: REST.LeftFoot, rAn: REST.RightFoot,
  lFt: REST.LeftToeBase, rFt: REST.RightToeBase, lEar: [0.07, 1.6, 0], rEar: [-0.07, 1.6, 0], nose: [0, 1.6, 0.1],
  lIdx: [0.86, 1.433, -0.033], rIdx: [-0.86, 1.433, -0.033], lPinky: [0.847, 1.433, -0.109], rPinky: [-0.847, 1.433, -0.109],
});
const dir = (rig, a, b) => rig.at(b).sub(rig.at(a)).normalize();
const v3 = a => new THREE.Vector3(...a).normalize();
const near = (u, w, msg, tol = 0.999) => assert.ok(u.dot(w) > tol, `${msg}: ${u.toArray().map(x => x.toFixed(2))} vs ${w.toArray().map(x => x.toFixed(2))}`);

test('standing in a T-pose leaves the character in its rest pose, on the floor', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  rig.pose(lm(restPts()));
  near(dir(rig, 'LeftArm', 'LeftForeArm'), v3([1, 0, 0]), 'left upper arm out to its left');
  near(dir(rig, 'RightLeg', 'RightFoot'), v3([0, -1, 0]), 'right shin down', 0.99);
  near(dir(rig, 'Hips', 'Neck'), v3([0, 1, 0]), 'spine up');
  // the soles on the floor: the toe tips' joints 3.1 cm above it, as in the rest pose
  assert.ok(Math.abs(rig.at('LeftToe_End').y - 0.031) < 0.005, `toes on the floor (${rig.at('LeftToe_End').y.toFixed(3)})`);
});

test('the person\'s left arm moves the character\'s left arm (no mirror swap, axes the right way round)', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  const p = restPts();
  p.lEl = [0.2, 1.7, -0.06]; p.lWr = [0.21, 1.97, -0.06];          // left arm straight up
  rig.pose(lm(p));
  near(dir(rig, 'LeftArm', 'LeftForeArm'), v3([0.012, 0.264, 0.002]), 'left upper arm up');
  near(dir(rig, 'LeftForeArm', 'LeftHand'), v3([0.01, 0.27, 0]), 'left forearm up');
  near(dir(rig, 'RightArm', 'RightForeArm'), v3([-1, 0, 0]), 'right arm still out');
});

test('a jumping jack\'s top: arms overhead and feet wide, as the landmarks show them', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  const p = restPts();
  Object.assign(p, { lEl: [0.4, 1.65, -0.05], lWr: [0.5, 1.9, -0.05], rEl: [-0.4, 1.65, -0.05], rWr: [-0.5, 1.9, -0.05],
    lKn: [0.25, 0.52, 0], lAn: [0.4, 0.1, 0], lFt: [0.42, 0.03, 0.13], rKn: [-0.25, 0.52, 0], rAn: [-0.4, 0.1, 0], rFt: [-0.42, 0.03, 0.13] });
  rig.pose(lm(p));
  const L = (a, b) => v3(p[b].map((x, i) => x - p[a][i]));
  near(dir(rig, 'LeftArm', 'LeftForeArm'), L('lSh', 'lEl'), 'left upper arm');
  near(dir(rig, 'RightForeArm', 'RightHand'), L('rEl', 'rWr'), 'right forearm');
  near(dir(rig, 'LeftUpLeg', 'LeftLeg'), L('lHip', 'lKn'), 'left thigh');
  near(dir(rig, 'RightLeg', 'RightFoot'), L('rKn', 'rAn'), 'right shin');
});

test('a squat lowers the hips and keeps the feet on the floor', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  const p = restPts();
  // thighs about horizontal, shins forward, torso leaning forward
  Object.assign(p, { lKn: [0.12, 0.93, 0.4], rKn: [-0.12, 0.93, 0.4], lAn: [0.1, 0.52, 0.25], rAn: [-0.1, 0.52, 0.25],
    lFt: [0.1, 0.45, 0.38], rFt: [-0.1, 0.45, 0.38], lSh: [0.19, 1.33, 0.3], rSh: [-0.19, 1.33, 0.3],
    lEl: [0.2, 1.3, 0.58], rEl: [-0.2, 1.3, 0.58], lWr: [0.2, 1.3, 0.85], rWr: [-0.2, 1.3, 0.85], lEar: [0.07, 1.5, 0.42], rEar: [-0.07, 1.5, 0.42] });
  rig.pose(lm(p));
  // the soles on the floor (toe tips' joints 3.1 cm above it, ankles 10.5 cm)
  const low = Math.min(rig.at('LeftToe_End').y - 0.031, rig.at('RightToe_End').y - 0.031, rig.at('LeftFoot').y - 0.105);
  assert.ok(Math.abs(low) < 0.01, `lowest point on the floor (${low.toFixed(3)})`);
  assert.ok(rig.at('Hips').y < 0.75, `hips lowered (${rig.at('Hips').y.toFixed(2)} m, standing 1.0)`);
  assert.ok(dir(rig, 'Hips', 'Neck').z > 0.4, 'torso leaning forward');
});

test('a push-up plank seen from the side lies along the floor', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  // body along -x (head to the left of the screen), facing down
  const P = (x, y, z) => [x, y, z];
  const pts = { lSh: P(-0.55, 0.42, 0.18), rSh: P(-0.55, 0.42, -0.18), lEl: P(-0.55, 0.15, 0.2), rEl: P(-0.55, 0.15, -0.2),
    lWr: P(-0.55, 0, 0.2), rWr: P(-0.55, 0, -0.2), lHip: P(0, 0.33, 0.1), rHip: P(0, 0.33, -0.1), lKn: P(0.42, 0.22, 0.1),
    rKn: P(0.42, 0.22, -0.1), lAn: P(0.85, 0.1, 0.1), rAn: P(0.85, 0.1, -0.1), lFt: P(0.92, 0, 0.1), rFt: P(0.92, 0, -0.1),
    lEar: P(-0.78, 0.45, 0.07), rEar: P(-0.78, 0.45, -0.07), nose: P(-0.8, 0.38, 0) };
  rig.pose(lm(pts));
  const body = dir(rig, 'Hips', 'Neck');
  assert.ok(Math.abs(body.y) < 0.35 && body.x < -0.9, `body horizontal, head towards -x (${body.toArray().map(x => x.toFixed(2))})`);
  const low = Math.min(...['LeftHand', 'RightHand', 'LeftToe_End', 'RightToe_End'].map(n => rig.at(n).y));
  assert.ok(low > 0 && low < 0.06, `hands and toes on the floor (${low.toFixed(3)})`);
  // the hands lie flat on it (not straight on along the forearm, through the floor): fingertips above the floor
  for (const s of ['Left', 'Right']) {
    const tip = rig.at(`${s}HandMiddle4`).y, hand = dir(rig, `${s}Hand`, `${s}HandMiddle1`);
    assert.ok(tip > -0.002, `${s} fingertips above the floor (${tip.toFixed(3)})`);
    assert.ok(Math.abs(hand.y) < 0.2, `${s} hand flat (${hand.y.toFixed(2)})`);
  }
});

test('turned to the side, the hips and chest turn with the person', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  // a quarter turn to the character's left: its left side now points away from the camera (-z)
  const turn = ([x, y, z]) => [z, y, -x];
  const p = Object.fromEntries(Object.entries(restPts()).map(([k, v]) => [k, turn(v)]));
  rig.pose(lm(p));
  near(rig.at('LeftUpLeg').sub(rig.at('RightUpLeg')).normalize(), v3([0, 0, 1]).negate(), 'hip line along -z', 0.99);
  near(rig.at('LeftArm').sub(rig.at('RightArm')).normalize(), v3([0, 0, -1]), 'shoulder line along -z', 0.99);
});

test('the faulty part is coloured red on the mesh, the rest keeps its colour', opt, () => {
  const { root, bones } = character();
  const list = Object.values(bones);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const ix = name => list.indexOf(bones[name]);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([ix('LeftForeArm'), 0, 0, 0, ix('Spine'), 0, 0, 0, ix('RightHand'), 0, 0, 0], 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xdddfe5 }));
  mesh.bind(new THREE.Skeleton(list));
  root.add(mesh);
  R.tint(root, faultBones('arm', 'left'));
  const c = mesh.geometry.attributes.color;
  assert.ok(c.getX(0) > 0.9 && c.getY(0) < 0.6, 'left forearm (below the left upper arm) red');
  assert.ok(Math.abs(c.getX(1) - c.getY(1)) < 0.05, 'spine not red');
  assert.ok(Math.abs(c.getX(2) - c.getY(2)) < 0.05, 'right hand not red (left arm only)');
});

test('every body part a fault names has bones to colour', () => {
  const src = fs.readFileSync(new URL('../web/js/engine.js', import.meta.url), 'utf8');
  const parts = new Set([...src.matchAll(/F\('[a-z_]+', '([a-z ]+)'/g)].map(m => m[1]));
  assert.ok(parts.size >= 8);
  for (const p of parts) {
    assert.ok(faultParts().includes(p), `no bones for part '${p}'`);
    assert.ok(faultBones(p, 'left').length > 0, `no bones for part '${p}'`);
  }
});

test("every body part a held pose's fault names has bones to colour, one limb when a side is named", () => {
  const src = fs.readFileSync(new URL('../web/js/holdform.js', import.meta.url), 'utf8');
  const parts = new Set(['feet', 'legs', 'arm', 'arms', 'torso', 'chest', 'knee', 'hips',
    ...[...src.matchAll(/\bpart: '([a-z ]+)'/g)].map(m => m[1])]);
  for (const p of parts) {
    assert.ok(faultParts().includes(p), `no bones for part '${p}'`);
    assert.ok(faultBones(p, null).length > 0, `no bones for part '${p}'`);
  }
  assert.deepEqual(faultBones('knee', 'left'), ['LeftUpLeg', 'LeftLeg']);
  assert.deepEqual(faultBones('knee', 'right'), ['RightUpLeg', 'RightLeg']);
  assert.deepEqual(faultBones('knee'), ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']);
  assert.deepEqual(faultBones('arm', 'right'), ['RightArm']);
  assert.ok(faultBones('legs').includes('LeftFoot') && faultBones('legs').includes('RightUpLeg'));
});

test('landmarks are smoothed over the neighbouring frames (and missing frames stay missing)', () => {
  const f = (t, x) => ({ t, world: Array.from({ length: 33 }, () => [x, 0, 0]) });
  const s = smoothWorld([f(0, 0), f(33, 3), { t: 66, world: null }, f(99, 6)], 1);
  assert.equal(s[1].world[0][0], 1.5);       // frames 0 and 1 (the missing one does not count)
  assert.equal(s[2].world, null);
});

test('a point barely seen is smoothed over a wider window, weighted by how visible it was', () => {
  // a far arm guessed from frame to frame: jumping between -1 and +1 with visibility 0.05
  const frames = Array.from({ length: 13 }, (_, i) => ({ t: i * 33, world: Array.from({ length: 33 }, () => [i % 2 ? 1 : -1, 0, 0]),
    image: Array.from({ length: 33 }, (_, j) => ({ x: 0, y: 0, z: 0, visibility: j === 15 ? 0.05 : 0.99 })) }));
  const s = smoothWorld(frames, 2);
  assert.ok(Math.abs(s[6].world[15][0]) < 0.1, `hidden wrist steadied (${s[6].world[15][0].toFixed(2)})`);
  assert.ok(Math.abs(s[6].world[11][0]) > 0.15, 'a visible point keeps its own +-2 frames');
});

test('mirrored like the camera view: the person\'s left arm shows on the figure\'s right, on the same side of the screen', opt, () => {
  const { root } = character();
  const rig = new R.Rig(root);
  const p = restPts();
  p.lEl = [0.2, 1.7, -0.06]; p.lWr = [0.21, 1.97, -0.06];          // left arm straight up
  rig.pose(mirrorWorld(lm(p)));
  near(dir(rig, 'RightArm', 'RightForeArm'), v3([-0.012, 0.264, 0.002]), 'figure\'s right upper arm up');
  near(dir(rig, 'LeftArm', 'LeftForeArm'), v3([1, 0, 0]), 'figure\'s left arm still out');
  assert.equal(mirrorSide('left'), 'right');
  assert.equal(mirrorSide(undefined), undefined);
});
