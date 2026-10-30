// The person's rep on a 3D character: MediaPipe world landmarks (metres, origin between the hips; x to the image's
// right, y down, smaller z nearer the camera) pose a Mixamo-rigged character (the Y Bot of the 3D demos; T-pose rest,
// facing +z, its left on +x, y up). Each bone is swung to point the way the body segment did; the hips and chest take
// their turn from the hip and shoulder lines; the hands point at the knuckles (flat on the floor when the forearm
// points down: a push-up). One camera gives no twist along a limb, and the fingers keep their rest pose. three.js is
// passed in (`makeRetarget(THREE)`) so the same code runs in the browser and in the tests.

export const LM = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lPinky: 17,
  rPinky: 18, lIdx: 19, rIdx: 20, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lFt: 31, rFt: 32 };

// [bone, the child joint it points at, from landmark, to landmark]; parents first
const LIMBS = [
  ['LeftArm', 'LeftForeArm', LM.lSh, LM.lEl], ['LeftForeArm', 'LeftHand', LM.lEl, LM.lWr],
  ['RightArm', 'RightForeArm', LM.rSh, LM.rEl], ['RightForeArm', 'RightHand', LM.rEl, LM.rWr],
  ['LeftUpLeg', 'LeftLeg', LM.lHip, LM.lKn], ['LeftLeg', 'LeftFoot', LM.lKn, LM.lAn], ['LeftFoot', 'LeftToeBase', LM.lAn, LM.lFt],
  ['RightUpLeg', 'RightLeg', LM.rHip, LM.rKn], ['RightLeg', 'RightFoot', LM.rKn, LM.rAn], ['RightFoot', 'RightToeBase', LM.rAn, LM.rFt],
];
// the joints that can touch the floor (feet flat, on the toes, kneeling, hands down in a push-up, lying), with how far
// the skin below each is from the joint (the Y Bot standing: soles at 0, toe tips' joints 3.1 cm up, ankles 10.5 cm)
// (one camera cannot tell which way a palm faces: a hand on the floor may rest on its edge, the thumb or little finger
// lowest)
const GROUND = { Toe_End: 0.031, ToeBase: 0.033, Foot: 0.105, Leg: 0.06, Hand: 0.03, HandMiddle1: 0.02, HandMiddle4: 0.012,
  HandIndex4: 0.01, HandPinky4: 0.01, HandThumb4: 0.01 };
const GROUND_MID = { Hips: 0.11, Head: 0.1, HeadTop_End: 0.01 };

// the bones (and everything below them) that show each body part a fault names (engine.js F(code, part, ...), and a
// held pose's faults: web/js/holdform.js)
const PARTS = {
  hips: ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'], 'lower back': ['Hips', 'Spine', 'Spine1'],
  chest: ['Spine', 'Spine1', 'Spine2'], torso: ['Spine', 'Spine1', 'Spine2'], trunk: ['Spine', 'Spine1', 'Spine2'],
  knees: ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'],
  'front knee': ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'], feet: ['LeftFoot', 'RightFoot'],
  arms: ['LeftArm', 'RightArm'], legs: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'],
};
// the parts on one side of the body ('Left' / 'Right' prefixed): `side` picks one, none both
const SIDED = { arm: ['Arm'], elbow: ['Arm'], knee: ['UpLeg', 'Leg'], leg: ['UpLeg', 'Leg', 'Foot'], foot: ['Foot'],
  ankle: ['Foot'] };
const WHOLE = new Set(['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftFoot', 'RightFoot']);   // with their children
/** Mixamo bone names (without the "mixamorig" prefix) to colour for a fault on `part`; `side` picks one limb. */
export function faultBones(part, side) {
  if (SIDED[part]) {
    const sides = side === 'left' ? ['Left'] : side === 'right' ? ['Right'] : ['Left', 'Right'];
    return sides.flatMap(s => SIDED[part].map(b => `${s}${b}`));
  }
  return PARTS[part] || [];
}
export const faultParts = () => [...Object.keys(PARTS), ...Object.keys(SIDED)];

// MediaPipe's left/right landmark pairs (eyes, ears, mouth, arms, hands, legs, feet)
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
/** The pose as a mirror shows it (the camera view is shown mirrored): x flipped, and the person's left then reads as
 * the figure's right. (A mirrored parent would do it for the eye, but a bone's rotation cannot be read back from a
 * reflected transform, which posing needs.) */
export function mirrorWorld(world) {
  const pts = world.map(p => (Array.isArray(p) ? [-p[0], p[1], p[2]] : [-p.x, p.y, p.z]));
  for (const [a, b] of PAIRS) [pts[a], pts[b]] = [pts[b], pts[a]];
  return pts;
}
export const mirrorSide = side => (side === 'left' ? 'right' : side === 'right' ? 'left' : side);

/** Landmark frames ([{t, world: [[x, y, z], ...] | [{x, y, z}, ...], image?: with visibility}]) smoothed over `k`
 * frames either side, each point weighted by how visible it was; a point barely seen (a far arm from the side, which
 * MediaPipe guesses from frame to frame) over 3k frames, so it does not flail. */
export function smoothWorld(frames, k = 2) {
  const pts = frames.map(f => f.world && f.world.map(p => (Array.isArray(p) ? p : [p.x, p.y, p.z])));
  const vis = frames.map(f => (f.world ? f.world.map((_, j) => {
    const q = f.image?.[j];
    const v = q == null ? 1 : Array.isArray(q) ? q[3] : q.visibility;
    return Number.isFinite(v) ? v : 1;
  }) : null));
  return frames.map((f, i) => {
    if (!pts[i]) return { ...f, world: null };
    return { ...f, world: pts[i].map((_, j) => {
      const r = vis[i][j] < 0.5 ? 3 * k : k, acc = [0, 0, 0];
      let wsum = 0;
      for (let n = Math.max(0, i - r); n <= Math.min(frames.length - 1, i + r); n += 1) {
        if (!pts[n]) continue;
        const w = vis[n][j] + 0.05;
        for (let a = 0; a < 3; a += 1) acc[a] += w * pts[n][j][a];
        wsum += w;
      }
      return acc.map(x => x / wsum);
    }) };
  });
}

export function makeRetarget(THREE) {
  const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
  const toThree = p => new THREE.Vector3(p[0], -p[1], -p[2]);
  const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
  /** The rotation of the frame whose x axis is `left` and whose y axis is `up` (made orthogonal to it). */
  const basis = (left, up) => {
    const x = left.clone().normalize();
    const y = up.clone().sub(x.clone().multiplyScalar(up.dot(x))).normalize();
    const z = V().crossVectors(x, y);
    return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };

  class Rig {
    /** `root`: the character (a clone of the GLB scene); its current pose is the rest pose (T-pose). */
    constructor(root) {
      this.root = root;
      this.bones = {};
      root.traverse(o => { if (o.isBone) this.bones[o.name.replace(/^mixamorig:?/, '')] = o; });
      for (const n of ['Hips', 'Spine', 'Neck', 'Head', ...LIMBS.flatMap(l => [l[0], l[1]])]) {
        if (!this.bones[n]) throw new Error(`the character has no bone ${n}`);
      }
      this.rest = new Map(Object.values(this.bones).map(b => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
      this.baseY = root.position.y;
      root.updateMatrixWorld(true);
      this.hipsRest = this.chest(this.bones.Hips);
    }

    pos(name) { return this.bones[name].getWorldPosition(V()); }
    /** From the hips to between the shoulders: the same points as the landmarks' "up" (the Y Bot's shoulder joints sit
     * 6 cm behind its hips; its neck does not). */
    up() { return mid(this.pos('LeftArm'), this.pos('RightArm')).sub(this.pos('Hips')); }
    /** The frame of the pelvis (`at` = Hips: hip line) or of the chest (shoulder line), up the spine, as it is now. */
    chest(at) {
      const left = at === this.bones.Hips ? this.pos('LeftUpLeg').sub(this.pos('RightUpLeg')) : this.pos('LeftArm').sub(this.pos('RightArm'));
      return basis(left, this.up());
    }

    /** Turn `bone` (in world space) by `dq`, keeping its parent where it is. */
    turn(bone, dq) {
      const wq = dq.clone().multiply(bone.getWorldQuaternion(Q()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(Q()).invert().multiply(wq));
      bone.updateMatrixWorld(true);
    }

    /** Swing `bone` so the direction to its `child` joint is `dir` (world, unit). */
    aim(bone, child, dir) {
      const cur = this.pos(child).sub(bone.getWorldPosition(V()));
      if (cur.lengthSq() < 1e-12 || !(dir.lengthSq() > 1e-12)) return;
      this.turn(bone, Q().setFromUnitVectors(cur.normalize(), dir.clone().normalize()));
    }

    /** Pose from a frame's world landmarks. Review disables floor placement and the hand-floor heuristic; it also
     * passes `skip`, bone names whose landmarks are unmeasured, which are then not aimed at all (never guessed). */
    pose(world, { ground = true, measuredHands = false, skip = new Set() } = {}) {
      for (const [b, r] of this.rest) { b.quaternion.copy(r.q); b.position.copy(r.p); }
      this.root.position.y = this.baseY;
      this.root.updateMatrixWorld(true);
      const P = world.map(p => p && toThree(Array.isArray(p) ? p : [p.x, p.y, p.z]));
      const hipMid = mid(P[LM.lHip], P[LM.rHip]), shMid = mid(P[LM.lSh], P[LM.rSh]);
      const up = shMid.clone().sub(hipMid);
      // pelvis: from its rest frame to the hip line and the way the spine points
      const hips = basis(P[LM.lHip].clone().sub(P[LM.rHip]), up);
      this.turn(this.bones.Hips, hips.multiply(this.hipsRest.clone().invert()));
      // chest: what is left of the spine's lean (bent at the waist) and of the shoulders' turn against the hips (a twist)
      this.turn(this.bones.Spine, Q().setFromUnitVectors(this.up().normalize(), up.clone().normalize()));
      const chest = basis(P[LM.lSh].clone().sub(P[LM.rSh]), up);
      this.turn(this.bones.Spine, chest.multiply(this.chest(this.bones.Spine).invert()));
      // head: the neck points from between the shoulders to between the ears
      if (!skip.has('Neck')) this.aim(this.bones.Neck, 'Head', mid(P[LM.lEar], P[LM.rEar]).sub(shMid));
      for (const [bone, child, a, b] of LIMBS) if (!skip.has(bone)) this.aim(this.bones[bone], child, P[b].clone().sub(P[a]));
      // hands: towards the knuckles; a hand on the floor (the forearm pointing down) lies flat, fingers along it
      for (const [s, el, wr, idx, pk] of [['Left', LM.lEl, LM.lWr, LM.lIdx, LM.lPinky], ['Right', LM.rEl, LM.rWr, LM.rIdx, LM.rPinky]]) {
        const hand = this.bones[`${s}Hand`];
        if (!hand || !this.bones[`${s}HandMiddle1`] || skip.has(`${s}Hand`)) continue;
        const d = mid(P[idx], P[pk]).sub(P[wr]);
        if (!measuredHands && P[wr].clone().sub(P[el]).normalize().y < -0.5) {
          d.y = 0;
          if (d.lengthSq() < 1e-4) d.set(up.x, 0, up.z);                     // no knuckles to go by: towards the head
        }
        this.aim(hand, `${s}HandMiddle1`, d);
      }
      // stand on the floor: the lowest skin that can touch it at y = baseY (MediaPipe's origin is between the hips)
      if (ground) {
        const below = (n, r) => (this.bones[n] ? this.pos(n).y - r : Infinity);
        const low = Math.min(...Object.entries(GROUND).flatMap(([n, r]) => [below(`Left${n}`, r), below(`Right${n}`, r)]),
          ...Object.entries(GROUND_MID).map(([n, r]) => below(n, r)));
        this.root.position.y = this.baseY - (low - this.baseY);
      }
      this.root.updateMatrixWorld(true);
    }

    /** Where a bone is now (world), for the tests and for framing the view. */
    at(name) { return this.pos(name); }
  }

  /** Colour the character's mesh: `hot` bones (and their children, for whole limbs) red, the rest as it was. */
  function tint(root, hot, { red = new THREE.Color(0xfc8181) } = {}) {
    const names = new Set(hot);
    root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const bones = o.skeleton.bones.map(b => b.name.replace(/^mixamorig:?/, ''));
      const isHot = bones.map((n, i) => names.has(n) || [...names].some(h => WHOLE.has(h) && isBelow(o.skeleton.bones[i], h)));
      o.geometry = o.geometry.clone();
      const idx = o.geometry.attributes.skinIndex, w = o.geometry.attributes.skinWeight, n = idx.count;
      const colors = new Float32Array(n * 3), base = o.material.color.clone(), c = new THREE.Color();
      for (let v = 0; v < n; v += 1) {
        let h = 0;
        for (let k = 0; k < 4; k += 1) if (isHot[idx.getComponent(v, k)]) h += w.getComponent(v, k);
        c.copy(base).lerp(red, Math.min(1, h * 1.4));
        colors.set([c.r, c.g, c.b], v * 3);
      }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      o.material = o.material.clone(); o.material.vertexColors = true; o.material.color.set(0xffffff);
    });
  }
  const isBelow = (bone, name) => {
    for (let b = bone; b && b.isBone; b = b.parent) if (b.name.replace(/^mixamorig:?/, '') === name) return true;
    return false;
  };

  return { Rig, tint, toThree };
}
