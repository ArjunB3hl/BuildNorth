// Exercise engine: MediaPipe pose landmarks -> joint-angle signals -> reps -> per-rep form checks -> coaching events.
// Pure ES module (no DOM): the browser pages and the Node tests use the same code.
//
// Landmarks: BlazePose 33-point layout. `world` = metric 3D landmarks centred on the hips (used for joint angles, which
// then do not depend on the camera angle); `image` = normalised image landmarks (used for left/right and height
// relations on screen, e.g. knees caving in on a front view).

export const LM = {
  nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
};

const sub = (a, b) => [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norm = u => Math.hypot(u[0], u[1], u[2]);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 });
const deg = r => (r * 180) / Math.PI;

/** Angle at b (degrees) between b->a and b->c. */
export function angle(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const n = norm(u) * norm(v);
  return n === 0 ? NaN : deg(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / n))));
}

/** Angle (degrees) between vector a->b and straight up. World landmarks have y pointing down. */
function fromVertical(a, b) {
  const u = sub(b, a);
  const n = norm(u);
  return n === 0 ? NaN : deg(Math.acos(Math.max(-1, Math.min(1, -u[1] / n))));
}

/** Per-frame features from one pose. Returns null when the pose is missing. */
export function features(world, image, aspect = 16 / 9) {
  if (!world || !image) return null;
  const W = i => world[i], I = i => ({ x: image[i].x * aspect, y: image[i].y, z: 0 });
  // a landmark outside the frame is a guess, whatever its visibility score says
  const vis = i => (image[i].x > 0.01 && image[i].x < 0.99 && image[i].y > 0.01 && image[i].y < 0.985 ? image[i].visibility ?? 1 : 0);
  const f = {
    kneeL: angle(W(LM.lHip), W(LM.lKnee), W(LM.lAnkle)), kneeR: angle(W(LM.rHip), W(LM.rKnee), W(LM.rAnkle)),
    hipL: angle(W(LM.lShoulder), W(LM.lHip), W(LM.lKnee)), hipR: angle(W(LM.rShoulder), W(LM.rHip), W(LM.rKnee)),
    elbowL: angle(W(LM.lShoulder), W(LM.lElbow), W(LM.lWrist)), elbowR: angle(W(LM.rShoulder), W(LM.rElbow), W(LM.rWrist)),
    // upper arm vs torso: 0 = arm down by the side, 90 = horizontal (any plane: raise to the side or the front)
    armL: angle(W(LM.lHip), W(LM.lShoulder), W(LM.lElbow)), armR: angle(W(LM.rHip), W(LM.rShoulder), W(LM.rElbow)),
    torsoLean: fromVertical(mid(W(LM.lHip), W(LM.rHip)), mid(W(LM.lShoulder), W(LM.rShoulder))),
    bodyLineL: angle(W(LM.lShoulder), W(LM.lHip), W(LM.lAnkle)), bodyLineR: angle(W(LM.rShoulder), W(LM.rHip), W(LM.rAnkle)),
  };
  const iShW = Math.abs(I(LM.lShoulder).x - I(LM.rShoulder).x);
  const iHipW = Math.abs(I(LM.lHip).x - I(LM.rHip).x);
  const iSh = mid(I(LM.lShoulder), I(LM.rShoulder)), iHp = mid(I(LM.lHip), I(LM.rHip));
  // torso length on screen (not just its height: a push-up body is horizontal)
  const iTorso = Math.hypot(iSh.x - iHp.x, iSh.y - iHp.y) || 1e-6;
  // body scale for positions on screen: the torso foreshortens when it pitches towards the camera (bottom of a squat
  // jump: hip height read -46 torso lengths), so take the largest of the trunk, shoulder width and shin length, which
  // agree while standing. The trunk is measured from the ears, not the shoulders: raising the arms lifts the shoulder
  // points (arm circles: shoulder-to-hip length varied 18%, ear-to-hip 3%), and a changing scale reads as the body moving.
  const shin = (Math.hypot(I(LM.lKnee).x - I(LM.lAnkle).x, I(LM.lKnee).y - I(LM.lAnkle).y)
    + Math.hypot(I(LM.rKnee).x - I(LM.rAnkle).x, I(LM.rKnee).y - I(LM.rAnkle).y)) / 2;
  const iEar = mid(I(LM.lEar), I(LM.rEar));
  const trunk = Math.max(vis(LM.lEar), vis(LM.rEar)) >= 0.5 ? 0.72 * Math.hypot(iEar.x - iHp.x, iEar.y - iHp.y) : iTorso;
  const scale = Math.max(trunk, 1.5 * iShW, 1.1 * shin) || 1e-6;
  // facing the camera: shoulders/hips wide on screen relative to the torso length; side view: narrow
  f.frontness = Math.max(iShW, iHipW) / iTorso;
  f.view = f.frontness > 0.45 ? 'front' : f.frontness < 0.22 ? 'side' : 'angled';
  // feet apart, in hip widths. The hip points can collapse onto each other for a frame (on a 3D mannequin with the arms
  // overhead, hip width fell from 0.38 to 0.07 of the body scale while the feet stayed put, which read as the feet
  // jumping apart); real hips measured 0.21-0.48 of the body scale, so the hip width used is never below 0.3 of it
  f.feetWidth = Math.abs(I(LM.lAnkle).x - I(LM.rAnkle).x) / Math.max(iHipW, 0.3 * scale);
  // knees caving in (front view): knee gap relative to ankle gap; < 1 means the knees are closer than the feet
  const kneeGap = Math.abs(I(LM.lKnee).x - I(LM.rKnee).x), ankleGap = Math.abs(I(LM.lAnkle).x - I(LM.rAnkle).x);
  f.kneeToAnkleGap = ankleGap > 1e-6 ? kneeGap / ankleGap : NaN;
  // hands above the head (image y grows downwards), in torso lengths
  f.wristsOverHead = (image[LM.nose].y - (image[LM.lWrist].y + image[LM.rWrist].y) / 2) / scale;
  // wrist height relative to its shoulder, in torso lengths: about -1 hanging at the thigh, about 0 at the shoulder.
  // A 2D measure: a front camera sees the curl's height reliably, but not the forearm swinging towards it (depth).
  f.wristUpL = (image[LM.lShoulder].y - image[LM.lWrist].y) / scale;
  f.wristUpR = (image[LM.rShoulder].y - image[LM.rWrist].y) / scale;
  // hip-to-ankle height on screen: a squat or lunge folds the legs (compared with standing; turning does not change it)
  f.legHeight = (image[LM.lAnkle].y + image[LM.rAnkle].y - image[LM.lHip].y - image[LM.rHip].y) / 2;
  f.legHeightL = image[LM.lAnkle].y - image[LM.lHip].y; f.legHeightR = image[LM.rAnkle].y - image[LM.rHip].y;
  // a lunge splits the feet front to back (world z, metres) and bends one hip much more than the other
  f.feetSplit = Math.abs(world[LM.lAnkle].z - world[LM.rAnkle].z);
  // hip height in the push-up line: + = hips sag below the shoulder-ankle line, - = hips piked up (side view). Only
  // where that line lies closer to horizontal than vertical: standing, it is nearly vertical and the measure blows up
  // (a live set read -0.9 to -28000 while getting down to the floor)
  const sh = mid(I(LM.lShoulder), I(LM.rShoulder)), hp = mid(I(LM.lHip), I(LM.rHip)), an = mid(I(LM.lAnkle), I(LM.rAnkle));
  const t = (hp.x - sh.x) / ((an.x - sh.x) || 1e-6);
  f.hipSag = Math.abs(an.x - sh.x) > Math.abs(an.y - sh.y)
    ? (hp.y - (sh.y + t * (an.y - sh.y))) / (Math.hypot(an.x - sh.x, an.y - sh.y) || 1e-6) : NaN;
  // which way the person faces on screen (side view): nose ahead of the hips
  f.facing = image[LM.nose].x > (image[LM.lHip].x + image[LM.rHip].x) / 2 ? 1 : -1;
  // front knee past the toes (side view), in shin lengths; positive = knee ahead of the toes
  f.kneeOverToeL = f.facing * (image[LM.lKnee].x - image[LM.lFoot].x) * aspect / (Math.hypot(I(LM.lKnee).x - I(LM.lAnkle).x, I(LM.lKnee).y - I(LM.lAnkle).y) || 1e-6);
  f.kneeOverToeR = f.facing * (image[LM.rKnee].x - image[LM.rFoot].x) * aspect / (Math.hypot(I(LM.rKnee).x - I(LM.rAnkle).x, I(LM.rKnee).y - I(LM.rAnkle).y) || 1e-6);
  f.frontLeg = f.facing * (image[LM.lFoot].x - image[LM.rFoot].x) > 0 ? 'L' : 'R';
  // at least one whole leg / arm visible (from the side the far limb is always hidden)
  f.visLegs = Math.max(Math.min(vis(LM.lKnee), vis(LM.lAnkle)), Math.min(vis(LM.rKnee), vis(LM.rAnkle)));
  f.visArms = Math.max(Math.min(vis(LM.lElbow), vis(LM.lWrist)), Math.min(vis(LM.rElbow), vis(LM.rWrist)));
  // shoulder and elbow of one arm (push-ups: hands on the floor are often just below the frame of a low camera; live,
  // the wrist sat at 0.97-1.02 of the frame height all set long, and the elbow angle needs no more than a good guess)
  f.visElbows = Math.max(Math.min(vis(LM.lShoulder), vis(LM.lElbow)), Math.min(vis(LM.rShoulder), vis(LM.rElbow)));
  f.visTorso = Math.max(Math.min(vis(LM.lShoulder), vis(LM.lHip)), Math.min(vis(LM.rShoulder), vis(LM.rHip)));
  f.kneeMin = Math.min(f.kneeL, f.kneeR); f.kneeAvg = (f.kneeL + f.kneeR) / 2; f.kneeMax = Math.max(f.kneeL, f.kneeR);
  f.hipMin = Math.min(f.hipL, f.hipR); f.hipAvg = (f.hipL + f.hipR) / 2;
  f.hipAsym = Math.abs(f.hipL - f.hipR); f.kneeAsym = Math.abs(f.kneeL - f.kneeR);
  f.elbowAvg = (f.elbowL + f.elbowR) / 2; f.armAvg = (f.armL + f.armR) / 2; f.armMax = Math.max(f.armL, f.armR);
  f.bodyLine = (f.bodyLineL + f.bodyLineR) / 2;
  // --- for telling exercises apart (auto mode) ---------------------------------------------------------------------
  // wrists apart, in shoulder widths: arms out to the sides (lateral raise) vs in front of the body (front raise)
  f.wristSpread = Math.abs(I(LM.lWrist).x - I(LM.rWrist).x) / (iShW || 1e-6);
  // the higher arm: its elbow, and the direction its upper arm points in the horizontal plane against the shoulder
  // line (world landmarks, so the camera's angle does not matter): ~0 deg out to the side, ~90 in front
  const left = f.armL >= f.armR;
  f.elbowRaised = left ? f.elbowL : f.elbowR;
  const wSh = W(left ? LM.lShoulder : LM.rShoulder), wEl = W(left ? LM.lElbow : LM.rElbow);
  const ax = wEl.x - wSh.x, az = (wEl.z ?? 0) - (wSh.z ?? 0), bx = W(LM.rShoulder).x - W(LM.lShoulder).x, bz = (W(LM.rShoulder).z ?? 0) - (W(LM.lShoulder).z ?? 0);
  const na = Math.hypot(ax, az), nb = Math.hypot(bx, bz);
  f.armPlane = na > 0.05 && nb > 0 ? deg(Math.acos(Math.min(1, Math.abs(ax * bx + az * bz) / (na * nb)))) : NaN;
  // positions on screen (aspect-corrected image units) and the body scale: hips, shoulders, the lower foot (both feet
  // leave the floor in a jump; a knee raise lifts only one), feet side to side (walking). Distances a rule measures
  // over a rep (hip travel, foot lift) are taken from these raw positions over the rep's own scale (`span`), so they
  // do not depend on where the person stands; the per-frame body-length versions feed the rep detectors.
  f.scale = scale;
  f.hipXImg = iHp.x; f.hipYImg = iHp.y; f.shoulderYImg = iSh.y;
  f.ankleXImg = (I(LM.lAnkle).x + I(LM.rAnkle).x) / 2; f.ankleYImg = Math.max(image[LM.lAnkle].y, image[LM.rAnkle].y);
  steadyPositions(f, scale);
  // hands below the knees (positive) or above (negative), in torso lengths: a deadlift takes the weight to the floor
  f.wristBelowKnee = ((image[LM.lWrist].y + image[LM.rWrist].y) - (image[LM.lKnee].y + image[LM.rKnee].y)) / 2 / scale;
  // torso angle on screen (0 = upright, 90 = horizontal); facing the camera a horizontal body has a very short torso
  // on screen compared with its shoulders, so both count as lying horizontal (push-ups, planks)
  f.imageTorsoAngle = deg(Math.atan2(Math.abs(iSh.x - iHp.x), Math.abs(iHp.y - iSh.y)));
  // ...and the body lying along the floor: hips straight (plank, push-up), or the line from the feet to the shoulders
  // far from vertical with a leg stretched out (mountain climbers, bicycle crunches, piked push-ups). In 3D (world
  // landmarks), so a camera at the head or the feet sees it too. A squat or deadlift leaning far forward has the
  // shoulders above the feet (side view, 58-65 deg lean: still upright); a floor dip has both knees bent.
  f.bodyTilt = fromVertical(mid(W(LM.lAnkle), W(LM.rAnkle)), mid(W(LM.lShoulder), W(LM.rShoulder)));
  f.posture = (f.imageTorsoAngle > 55 || (f.frontness > 1.3 && f.torsoLean > 55))
    && (f.hipAvg >= 140 || (f.bodyTilt > 50 && f.kneeMax > 120)) ? 'horizontal' : 'upright';
  return f;
}

/** Positions on screen in body lengths (y up): hip and shoulder height (jumps, push-ups, deadlifts), the lower foot's
 * height, hips and feet side to side. `scale` is the body scale they are measured in. */
function steadyPositions(f, scale) {
  f.hipHeight = -f.hipYImg / scale; f.shoulderHeight = -f.shoulderYImg / scale; f.ankleHeight = -f.ankleYImg / scale;
  f.hipX = f.hipXImg / scale; f.ankleX = f.ankleXImg / scale;
  return f;
}

/** Exponential smoothing of every numeric feature (pose landmarks jitter by a few degrees frame to frame). */
export class Smoother {
  constructor(alpha = 0.45) { this.alpha = alpha; this.prev = null; }
  update(f) {
    if (!f) return null;
    if (!this.prev) { this.prev = { ...f }; return this.prev; }
    const out = { ...f };
    for (const k of Object.keys(f)) {
      if (typeof f[k] === 'number' && Number.isFinite(f[k]) && Number.isFinite(this.prev[k])) {
        out[k] = this.prev[k] + this.alpha * (f[k] - this.prev[k]);
      }
    }
    this.prev = out;
    return out;
  }
}

/**
 * Online zigzag rep detector. A rep is a swing of at least `prominence` degrees to the rep extreme and back:
 * `extreme: 'min'` counts valleys (squat knee angle, push-up elbow angle), `'max'` counts peaks (arm raise angle).
 * Works for any range of motion (full reps and pulses), since it needs no absolute angle thresholds.
 * Emits {t, value, start, end} when the return swing has covered `prominence`, i.e. during the way back.
 */
export class RepDetector {
  constructor({ prominence = 25, extreme = 'min', minGapMs = 350 } = {}) {
    this.p = prominence; this.sign = extreme === 'min' ? -1 : 1; this.minGap = minGapMs;
    this.mode = 'toRest'; this.best = null; this.rest = null; this.lastRepT = -Infinity; this.windowStart = null;
    this.nearRestT = null;                  // last time the signal was still at the rest position
  }
  update(v, t) {
    if (!Number.isFinite(v)) return null;
    const s = this.sign * v;                // the rep extreme is a peak of s
    if (this.best === null) { this.best = { s, t }; this.rest = { s, t }; this.windowStart = t; this.nearRestT = t; return null; }
    if (this.mode === 'toRest') {           // moving away from the extreme: track the rest position (lowest s)
      if (s < this.rest.s) this.rest = { s, t };
      if (s <= this.rest.s + 0.3 * this.p) this.nearRestT = t;
      if (s >= this.rest.s + this.p) { this.mode = 'toExtreme'; this.best = { s, t }; this.windowStart = this.nearRestT; this.restT = this.rest.t; }
      return null;
    }
    if (s > this.best.s) this.best = { s, t }; // moving into the rep: track the extreme
    if (s <= this.best.s - this.p) {         // came back by `prominence`: one rep
      const rep = { t: this.best.t, value: this.sign * this.best.s, start: this.windowStart, end: t, restT: this.restT };
      this.mode = 'toRest'; this.rest = { s, t }; this.nearRestT = t;
      if (rep.t - this.lastRepT < this.minGap) return null;
      this.lastRepT = rep.t;
      return rep;
    }
    return null;
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Exercises. signal(f) -> number fed to the rep detector; checks(stats, ctx) -> list of faults for one rep.
// stats = min/max of every feature over the rep window (start..end), plus the value at the rep extreme.
// lying: false when `distinct` requires not lying down at the turning point, true when it requires lying (push-ups).

const F = (code, part, message, severity = 'moderate', value = null) => ({ code, part, message, severity, value });

// --- helpers for telling look-alike exercises apart (`distinct`, used when the exercise is detected automatically) ---
const range = (s, k) => (s.max[k] ?? NaN) - (s.min[k] ?? NaN);
// how far something moved on screen over the rep's own frames, in body lengths: the raw image positions over the rep's
// body scale (dividing each frame's position by a scale first would make the distance depend on where the person
// stands); rows without raw positions (synthetic tests) use the normalised feature
const RAW = { hipX: 'hipXImg', ankleX: 'ankleXImg' };
const span = (s, k) => {
  if (!(Number.isFinite(s.scale) && RAW[k] in s.max)) return range(s, k);
  const v = s.rows.map(r => r[RAW[k]]).filter(Number.isFinite);
  return v.length ? (Math.max(...v) - Math.min(...v)) / s.scale : NaN;
};
const upright = s => s.at.posture !== 'horizontal';
// standing in place with straight, still legs (arm exercises; walking, jogging or squatting is not one): both knees
// straight throughout (an angle, so no standing height is needed: after walking up to the camera that reference was
// wrong for ~13 s), legs still. Foot width only means something when the camera sees both feet side by side; with the
// legs out of the picture only the hips count.
const feetPlanted = (s, ctx) => span(s, 'hipX') < 0.45 && (!(s.min.visLegs >= 0.6)      // legs out of view: hips only
  || (s.min.kneeMin > 145 && (ctx.view === 'side' || range(s, 'feetWidth') < 0.5) && Math.max(range(s, 'kneeL'), range(s, 'kneeR')) < 25));
// tracking that holds together over the rep (half out of frame it produces impossible jumps and folds)
// (leg fold only means something standing up: lying horizontal the hip-to-ankle height is near zero)
// (hip travel over a real rep on the clips: at most 0.54 body lengths, in a reverse lunge; dancing: up to 2.1)
export const stableTracking = s => span(s, 'hipX') < 1.0 && (s.at.posture === 'horizontal' || s.minFold > 0.2);
// which way the raised arm points while it passes shoulder height (median, degrees from the shoulder line): lateral
// raises measured ~4, front and front-to-overhead raises 60-78. One arm or two.
function planeAtShoulder(s) {
  const v = s.rows.filter(r => r.armMax > 65 && r.armMax < 115).map(r => r.armPlane).filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}
// a raise is lifted under control: from leaving the rest position to one prominence back down took at least 0.75 s
// (overhead arm swings: 0.47-0.67 s; raises at about 2 s per rep: 0.82 s and up)
const controlled = s => s.rows.length > 1 && s.rows.at(-1).t - s.rows[0].t >= 750;

export const EXERCISES = {
  squat: {
    // counted on the straighter knee (a squat bends both knees; a step bends one). Measured on 4 live squats, a lunge and
    // a random turn: a squat has both hips bent alike (asymmetry <= 15 deg) and the legs folded to <= 0.70 of standing;
    // a lunge bends one hip ~60 deg more than the other; turning on the spot leaves the hips nearly straight.
    label: 'Squat', signal: f => f.kneeMax, extreme: 'min', prominence: 30, needs: ['legs'], lying: false,
    valid: s => s.at.hipAsym < 30 && s.at.hipAvg < 150 && s.fold < 0.85,
    distinct: s => upright(s),
    full: s => s.fold < 0.72,               // a valid but shallower attempt is a partial rep: coached, not counted
    checks: (s, ctx) => {
      const out = [];
      if (s.at.kneeAvg > 110) out.push(F('shallow', 'hips', 'Go deeper: thighs closer to parallel', 'moderate', s.at.kneeAvg));
      // forward lean is depth for a front camera (and people lean towards the laptop): only judged from the side
      if (ctx.view !== 'front' && s.max.torsoLean > 50) out.push(F('chest_down', 'chest', 'Keep your chest up', 'moderate', s.max.torsoLean));
      // knees vs ankles at the BOTTOM (standing in a wide stance, knees are naturally inside the ankles)
      if (ctx.view === 'front' && s.at.kneeToAnkleGap < 0.8) out.push(F('knees_in', 'knees', 'Push your knees out over your toes', 'major', s.at.kneeToAnkleGap));
      return out;
    },
  },
  squat_pulse: {
    label: 'Squat pulses', signal: f => f.kneeMax, extreme: 'min', prominence: 8, minGapMs: 250, needs: ['legs'], lying: false,
    // pulses happen low in the squat: both knees bent and both legs folded on screen compared with standing (jogging
    // or a one-leg balance folds one leg); ratios, so they do not depend on how far away the person stands
    valid: s => s.at.kneeMax < 135 && s.foldMax < 0.85,
    distinct: s => upright(s),
    checks: (s, ctx) => {
      const out = [];
      if (s.at.kneeAvg > 120) out.push(F('too_high', 'hips', 'Stay low: keep the pulses near parallel', 'minor', s.at.kneeAvg));
      if (ctx.view === 'front' && s.at.kneeToAnkleGap < 0.8) out.push(F('knees_in', 'knees', 'Push your knees out over your toes', 'major', s.at.kneeToAnkleGap));
      return out;
    },
  },
  pushup: {
    label: 'Push-up', signal: f => f.elbowAvg, extreme: 'min', prominence: 30, needs: ['elbows', 'torso'], lying: true,
    // the chest really goes down (lying horizontal is checked in auto mode only)
    valid: s => s.start.shoulderHeight - s.at.shoulderHeight > 0.12,
    distinct: s => s.at.posture === 'horizontal',     // (manual mode also counts wall and incline push-ups)
    checks: (s, ctx) => {
      const out = [];
      if (s.at.elbowAvg > 110) out.push(F('shallow', 'chest', 'Lower your chest closer to the floor', 'moderate', s.at.elbowAvg));
      if (ctx.view !== 'front' && s.max.hipSag > 0.08) out.push(F('hips_sag', 'hips', 'Lift your hips: keep a straight line from shoulders to heels', 'major', s.max.hipSag));
      if (ctx.view !== 'front' && s.min.hipSag < -0.1) out.push(F('hips_pike', 'hips', 'Lower your hips into a straight line', 'moderate', s.min.hipSag));
      if (s.max.elbowAvg < 150) out.push(F('no_lockout', 'arms', 'Press all the way up', 'minor', s.max.elbowAvg));
      return out;
    },
  },
  lunge: {
    // counted on the straighter knee like the squat: in a lunge the back knee bends nearly as much as the front one
    // (live 99/79 deg, clip 72/74), while a walking step keeps the standing leg straight
    label: 'Lunge', signal: f => f.kneeMax, extreme: 'min', prominence: 30, needs: ['legs'], lying: false,
    // split stance (one hip bent far more than the other, or the feet apart front to back) and the legs really folded
    valid: s => (s.at.hipAsym > 30 || s.at.feetSplit > 0.2) && s.fold < 0.8 && s.at.kneeMax < 130,
    // one hip bent far more than the other (lunges measured 55-64 deg apart, squats 0-15, jogging ~7); the feet's
    // front-to-back split is the stance width when the camera is at the side
    distinct: s => upright(s) && s.at.hipAsym > 30,
    side: s => (s.at.kneeL < s.at.kneeR ? 'left' : 'right'),
    checks: (s, ctx) => {
      const out = [];
      if (s.at.kneeMin > 110) out.push(F('shallow', 'knees', 'Drop your back knee lower', 'moderate', s.at.kneeMin));
      if (ctx.view !== 'front' && s.max.torsoLean > 22) out.push(F('lean', 'chest', 'Keep your torso upright as you step back', 'minor', s.max.torsoLean));
      if (ctx.view === 'side') {
        // the FRONT leg is the one whose foot is further forward in the facing direction (the back knee is always
        // ahead of the back foot)
        const k = s.at.frontLeg === 'L' ? s.at.kneeOverToeL : s.at.kneeOverToeR;
        if (k > 0.25) out.push(F('knee_past_toes', 'front knee', 'Keep your front knee over your ankle', 'minor', k));
      }
      return out;
    },
  },
  lateral_raise: {
    label: 'Lateral raise', signal: f => f.armAvg, extreme: 'max', prominence: 30, needs: ['arms'],
    // arms nearly straight at the top (a hand brought up to the face lifts the elbow with the arm bent), and stopping
    // near shoulder height (raises measured 114-116 deg; arm circles and swings pass overhead, 150-170)
    distinct: (s, ctx) => feetPlanted(s, ctx) && range(s, 'elbowRaised') < 50 && ctx.view !== 'side' && s.at.armMax >= 60 && s.at.armMax <= 135
      && s.at.elbowRaised >= 130 && planeAtShoulder(s) < 35 && controlled(s),
    valid: s => !(s.at.torsoLean > 50),     // bending over to pick up or put down the weights

    checks: (s, ctx) => {
      const out = [];
      if (s.at.armAvg < 65) out.push(F('low', 'arms', 'Raise your arms to shoulder height', 'moderate', s.at.armAvg));
      if (s.at.armAvg > 110) out.push(F('high', 'arms', 'Stop at shoulder height', 'minor', s.at.armAvg));
      if (Math.abs(s.at.armL - s.at.armR) > 20) out.push(F('uneven', 'arms', 'Lift both arms evenly', 'minor', Math.abs(s.at.armL - s.at.armR)));
      if (ctx.view !== 'front' && s.max.torsoLean - s.min.torsoLean > 12) out.push(F('swing', 'torso', 'Stop swinging: lift with your shoulders', 'moderate', s.max.torsoLean - s.min.torsoLean));
      return out;
    },
  },
  front_raise: {
    label: 'Front raise', signal: f => f.armMax, extreme: 'max', prominence: 30, needs: ['arms'],
    // (raises measured up to 147 deg at the top; arm circles pass overhead at 165-170)
    // (front-to-overhead raises peak at 143-147 deg; overhead arm swings reach 151-159 too, but take ~0.5 s)
    distinct: (s, ctx) => feetPlanted(s, ctx) && range(s, 'elbowRaised') < 50 && s.at.armMax >= 60 && s.at.armMax <= 155 && s.at.elbowRaised >= 130
      && (ctx.view === 'side' || !(planeAtShoulder(s) < 35)) && controlled(s),
    valid: s => !(s.at.torsoLean > 50),     // bending over to pick up or put down the weights

    checks: (s, ctx) => {
      const out = [];
      if (s.at.armMax < 65) out.push(F('low', 'arms', 'Raise to shoulder height', 'moderate', s.at.armMax));
      if (ctx.view !== 'front' && s.max.torsoLean - s.min.torsoLean > 12) out.push(F('swing', 'torso', 'Keep your torso still', 'moderate', s.max.torsoLean - s.min.torsoLean));
      return out;
    },
  },
  biceps_curl: {
    // counted on wrist height (2D), not the elbow angle: facing the camera, the forearm swings towards it and the
    // measured elbow angle understates the curl by ~50 degrees
    label: 'Biceps curl', perArm: true, signalArm: (f, a) => f['wristUp' + a], extreme: 'max', prominence: 0.35, needs: ['arms'],
    // the curling arm straightens at the bottom (measured 148-151 deg; jogging keeps the elbows bent, ~100)
    distinct: (s, ctx, a) => feetPlanted(s, ctx) && s.at.hipAvg > 150 && s.max['arm' + a] < 60 && s.at['wristUp' + a] > -0.5 && s.min['wristUp' + a] < -0.6
      && s.max['elbow' + a] >= 130,
    checks: (s, ctx, arm) => {
      const out = [];
      if (s.at['wristUp' + arm] < -0.55) out.push(F('short_top', 'arm', 'Curl the weight all the way up to your shoulder', 'minor', s.at['wristUp' + arm]));
      if (s.min['wristUp' + arm] > -0.7) out.push(F('short_bottom', 'arm', 'Lower the weight all the way down', 'minor', s.min['wristUp' + arm]));
      if (ctx.view === 'side' && s.max['arm' + arm] > 40) out.push(F('elbow_drift', 'elbow', 'Keep your elbow pinned to your side', 'moderate', s.max['arm' + arm]));
      if (ctx.view !== 'front' && s.max.torsoLean - s.min.torsoLean > 10) out.push(F('swing', 'torso', 'Stand still: no body swing', 'moderate', s.max.torsoLean - s.min.torsoLean));
      return out;
    },
  },
  triceps_kickback: {
    label: 'Triceps kickback', perArm: true, signalArm: (f, a) => f['elbow' + a], extreme: 'max', prominence: 40, needs: ['arms'],
    // bent over (measured 48 deg; punching stands upright, ~5) and standing in place; the upper arm stays still and the
    // arm straightens at the back (a balance pose with the arms drifting moved the upper arm ~40 deg)
    distinct: (s, ctx, a) => s.at.hipAvg < 145 && s.at.torsoLean >= 35 && s.at.kneeMax > 120 && span(s, 'hipX') < 0.3
      && range(s, 'arm' + a) < 25 && s.at['elbow' + a] >= 140,
    checks: (s, ctx, arm) => {
      const out = [];
      if (s.at['elbow' + arm] < 150) out.push(F('no_extension', 'arm', 'Straighten your arm fully at the back', 'moderate', s.at['elbow' + arm]));
      return out;
    },
  },
  overhead_press: {
    label: 'Overhead press', signal: f => f.wristsOverHead, extreme: 'max', prominence: 0.6, minGapMs: 500, needs: ['arms'],
    distinct: s => span(s, 'ankleX') < 0.35 && range(s, 'elbowAvg') >= 45 && s.min.wristUpL > -0.6 && s.min.wristUpR > -0.6,
    checks: (s, ctx) => {
      const out = [];
      if (s.at.elbowAvg < 155) out.push(F('no_lockout', 'arms', 'Lock your arms out overhead', 'moderate', s.at.elbowAvg));
      // leaning back = more lean at lockout than at the rack; only judged when the camera sees the torso from the side
      const lean = s.at.torsoLean - s.start.torsoLean;
      if (ctx.view !== 'front' && lean > 12) out.push(F('arch', 'lower back', "Ribs down: don't lean back", 'moderate', lean));
      return out;
    },
  },
  hinge: {
    // a deadlift rep is floor -> lockout -> floor: counted at the lockout (hip angle peak)
    label: 'Deadlift / hinge', signal: f => f.hipAvg, extreme: 'max', prominence: 35, needs: ['legs', 'torso'], lying: false,
    distinct: s => {                // standing at the lockout; shoulders drop more than the hips; hands go past the knees
      if (!upright(s)) return false;
      const bottom = s.rows.reduce((b, r) => (r.shoulderHeight < b.shoulderHeight ? r : b), s.rows[0]);
      return (s.at.shoulderHeight - s.min.shoulderHeight) > 1.15 * Math.max(0.05, s.at.hipHeight - s.min.hipHeight) && bottom.wristBelowKnee > -0.15;
    },
    valid: s => s.at.shoulderHeight - s.min.shoulderHeight > 0.3,      // the shoulders really came up from the floor
    checks: s => {
      const out = [];
      if (s.at.hipAvg < 160) out.push(F('no_lockout', 'hips', 'Stand tall and squeeze your glutes at the top', 'minor', s.at.hipAvg));
      return out;
    },
  },
  jump: {
    // jumps (squat jumps, tuck jumps): the hips rise in flight; counted at the highest point
    label: 'Jump', signal: f => f.hipHeight, extreme: 'max', prominence: 0.5, minGapMs: 600, needs: ['legs'],
    distinct: s => {
      // flight: both feet clearly off the floor (tuck jumps bend the knees in the air), and short: the hips stay near
      // their highest point (within the prominence) for under a second. (The whole rep window is no measure: it can
      // include standing still before the take-off; a tuck jump's read 4.3 s.)
      // the lower foot against the floor where the rep starts and ends (feet down before the take-off and after the
      // landing), so a step forward or back before jumping does not move the floor (image y grows downwards)
      const floor = Math.max(s.rows[0]?.ankleYImg, s.rows.at(-1)?.ankleYImg);
      const lift = Number.isFinite(s.scale) && Number.isFinite(floor)
        ? (floor - s.at.ankleYImg) / s.scale : s.at.ankleHeight - s.standingAnkle;
      const i = s.rows.findIndex(r => r.t >= s.at.t), lo = s.at.hipHeight - 0.5;
      let a = i, b = i;
      while (a > 0 && s.rows[a - 1].hipHeight > lo) a -= 1;
      while (b >= 0 && b < s.rows.length - 1 && s.rows[b + 1].hipHeight > lo) b += 1;
      const flight = i < 0 ? Infinity : s.rows[b].t - s.rows[a].t;
      return flight < 1000 && lift >= 0.15;
    },
    checks: () => [],
  },
  jumping_jack: {
    label: 'Jumping jack', signal: f => f.armAvg, extreme: 'max', prominence: 60, needs: ['arms', 'legs'],
    // feet apart and together, arms overhead, knees nearly straight throughout (a jump with the arms up squats first)
    // feet apart and together; arms out to at least shoulder height (live, a user's jacks reached 104-115 deg, not
    // overhead), and straight (jacks: elbows >= 129 deg) or with the hands above the head (hands behind the head while
    // stepping a leg out: elbows 44-98, hands at head height); both knees fairly straight (jacks: 135-157 deg; a side
    // lunge with the arms out bends one to ~104; the user's take-off dip reached 142)
    // The feet are wider with the arms up than at the start (jacks: 3.4-4.6 vs 0.5-0.7 hip widths; narrow step jacks
    // +0.9); landmark jitter alone moves them both ways (a 3D mannequin doing arm swings: feet width 1.0-2.1, no trend)
    distinct: (s, ctx) => ctx.view !== 'side' && range(s, 'feetWidth') >= 0.5 && s.at.feetWidth - s.start.feetWidth >= 0.6
      && s.at.armAvg >= 90 && s.min.kneeMax > 125
      && s.min.kneeMin > 120 && (s.min.elbowAvg >= 115 || s.at.wristsOverHead >= 0.3),
    checks: s => {
      const out = [];
      if (s.at.armAvg < 140) out.push(F('arms_low', 'arms', 'Bring your arms all the way overhead', 'minor', s.at.armAvg));
      if (s.max.feetWidth < 1.6) out.push(F('feet_narrow', 'feet', 'Jump your feet wider', 'minor', s.max.feetWidth));
      return out;
    },
  },
  knee_raise: {
    label: 'Knee raise', signal: f => f.hipMin, extreme: 'min', prominence: 35, needs: ['legs'], lying: false,
    // one thigh up to about horizontal (normal walking reaches ~145 deg) while the standing leg stays straight, in place
    // (bending forward folds both hips: live, hips 113/141 with the torso leaning 37 deg)
    distinct: s => upright(s) && s.at.kneeMax > 150 && s.at.hipMin < 115 && s.at.hipAsym >= 45 && span(s, 'hipX') < 0.8,
    side: s => (s.at.hipL < s.at.hipR ? 'left' : 'right'),
    checks: s => {
      const out = [];
      if (s.at.hipMin > 105) out.push(F('low_knee', 'knee', 'Drive your knee up to hip height', 'minor', s.at.hipMin));
      return out;
    },
  },
};

const VIS = { legs: 'visLegs', arms: 'visArms', elbows: 'visElbows', torso: 'visTorso' };
const GRACE_MS = 400;     // a part out of view this briefly (a hand crossing the frame edge, a flicker) keeps the count

/**
 * Engine for one set of one exercise. update(features, tMs) returns events:
 *   {type: 'rep', count, side, t, faults: [...], metrics}   every counted rep
 *   {type: 'cue', code, part, message, t, reason}           a fault seen on 2 of the last 3 reps (cooldown per fault)
 *   {type: 'fixed', code, message, t}                        a cued fault absent for the last 2 reps
 *   {type: 'praise', t, count}                               every 5th clean rep in a row
 *   {type: 'visibility', parts, t}                           body parts the exercise needs are not visible
 */
export class ExerciseEngine {
  constructor(exercise, { cueCooldownMs = 8000 } = {}) {
    const ex = EXERCISES[exercise];
    if (!ex) throw new Error(`unknown exercise ${exercise}`);
    this.key = exercise; this.ex = ex; this.cooldown = cueCooldownMs;
    this.smoother = new Smoother();
    const mk = () => new RepDetector({ prominence: ex.prominence, extreme: ex.extreme, minGapMs: ex.minGapMs ?? 350 });
    this.detectors = ex.perArm ? { L: mk(), R: mk() } : { all: mk() };
    this.history = [];          // smoothed features with t, for per-rep window stats
    this.count = 0; this.perSide = {}; this.partials = 0;
    this.armState = {};         // per arm ('L', 'R') or 'all': fault history, open cues, clean streak
    this.lastArmRep = {};       // per arm: the last rep, to merge the two arms of one two-arm rep
    this.lastVisWarn = -Infinity; this.lastT = 0;
    this.inView = false; this.inViewSince = null; this.missSince = null; this.missing = ex.needs || [];
    this.mkDetectors = () => (ex.perArm ? { L: mk(), R: mk() } : { all: mk() });
  }

  state(arm) {
    if (!this.armState[arm]) this.armState[arm] = { recent: [], cued: new Map(), lastCue: {}, clean: 0 };
    return this.armState[arm];
  }

  /** The turning points of the reps this engine may still report (one per detector at most): a detector that has
   * moved a full prominence into a rep reports it on the way back, and its turning point only moves later. A detector
   * at rest can only report a rep that turns after now. (Auto mode need not wait for a rival rep that cannot happen.) */
  pendingTurns() {
    const out = [];
    for (const d of Object.values(this.detectors)) {
      if (d.mode !== 'toExtreme') continue;
      // a turning point in a posture the exercise's `distinct` rules out: never a rep auto mode counts (a deadlift
      // detector holding its turn while lying in the plank)
      if (this.ex.lying !== undefined && (this.rowAt(d.best.t)?.posture === 'horizontal') !== this.ex.lying) continue;
      out.push(d.best.t);
    }
    return out;
  }

  rowAt(t) {
    return this.history.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best), this.history[0]);
  }

  stats(start, end) {
    const rows = this.history.filter(r => r.t >= start && r.t <= end);
    const min = {}, max = {};
    for (const r of rows) for (const [k, v] of Object.entries(r)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (!(k in min) || v < min[k]) min[k] = v;
      if (!(k in max) || v > max[k]) max[k] = v;
    }
    return { min, max, n: rows.length };
  }

  /** Camera view by majority over [a, b] (a rep's own frames, not the set-up before it). */
  viewBetween(a, b) {
    const c = { front: 0, side: 0, angled: 0 };
    for (const r of this.history) if (r.t >= a && r.t <= b) c[r.view] += 1;
    return c.side > c.front && c.side > c.angled ? 'side' : c.front > c.angled ? 'front' : 'angled';
  }

  view() { return this.viewBetween(this.lastT - 3000, this.lastT); }

  update(raw, t) {
    const events = [];
    const prevSmooth = this.smoother.prev;
    const f = this.smoother.update(raw);
    if (!f) return events;
    this.lastT = t;
    this.history.push({ ...f, t });
    while (this.history.length && this.history[0].t < t - 15000) this.history.shift();
    // never count or judge what the camera cannot see: the needed joints must be in the picture and clearly visible
    // for 0.5 s before counting (re)starts, and losing them for longer than GRACE_MS resets the rep detectors. During
    // the grace the frame is dropped entirely (not smoothed in, not kept): its guessed joints must not reach a rep.
    const missing = (this.ex.needs || []).filter(p => !(raw[VIS[p]] >= 0.6));
    this.missing = missing;
    if (missing.length) {
      this.missSince ??= t;
      if (this.inView && t - this.missSince < GRACE_MS) {               // a brief drop: skip the frame, keep counting
        this.smoother.prev = prevSmooth; this.history.pop();
        return events;
      }
      this.inViewSince = null;
      if (this.inView) { this.inView = false; this.detectors = this.mkDetectors(); }
      if (t - this.lastVisWarn > 10000) { this.lastVisWarn = t; events.push({ type: 'visibility', parts: missing, t }); }
      return events;
    }
    this.missSince = null;
    if (!this.inView) {
      this.inViewSince ??= t;
      if (t - this.inViewSince < 500) return events;
      this.inView = true;
      this.detectors = this.mkDetectors();
      events.push({ type: 'ready', t });
    }
    for (const [arm, det] of Object.entries(this.detectors)) {
      const v = this.ex.perArm ? this.ex.signalArm(f, arm) : this.ex.signal(f);
      const rep = det.update(v, t);
      if (!rep) continue;
      const start = Math.max(rep.start, rep.t - 4000);
      const s = this.stats(start, rep.end);
      const restRow = rep.restT != null && rep.restT < start ? this.rowAt(rep.restT) : null;
      // include the rest position held before the rep (a push-up's locked-out plank), if it was in the rep's posture:
      // before the first rep it may be a while back, standing up before getting down to the floor
      if (restRow && restRow.posture === this.rowAt(rep.t).posture) {
        for (const [k, v] of Object.entries(restRow)) {
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          if (!(k in s.min) || v < s.min[k]) s.min[k] = v;
          if (!(k in s.max) || v > s.max[k]) s.max[k] = v;
        }
      }
      s.at = this.rowAt(rep.t); s.start = this.rowAt(start);
      s.rows = this.history.filter(r => r.t >= start && r.t <= rep.end);
      const scales = s.rows.map(r => r.scale).filter(Number.isFinite).sort((a, b) => a - b);
      s.scale = scales.length ? scales[Math.floor(scales.length / 2)] : NaN;        // the body's scale over the rep
      // leg fold: hip-to-ankle height on screen against standing, the tallest of the last 15 s among frames that really
      // show the legs (guessed legs off-screen read long) and were taken at about this distance from the camera
      // (someone who walked up to the laptop reads tall for a while). Raw heights: the body scale itself wobbles with
      // the arms (~20% in a cross jack), which would make the fold wobble.
      const near = r => !(r.visLegs < 0.6) && !(Math.abs(r.scale / s.scale - 1) > 0.15);
      const standing = (k = '') => this.history.reduce((m, r) => (near(r) ? Math.max(m, r['legHeight' + k] ?? -Infinity) : m), -Infinity);
      const standingLeg = standing();
      s.fold = standingLeg > 0 ? s.at.legHeight / standingLeg : 1;     // 1 = standing, ~0.4 = deep squat
      // the straighter leg's fold, each leg against its own standing height (standing on one leg folds only the other)
      const legFold = k => { const top = standing(k); return top > 0 && Number.isFinite(s.at['legHeight' + k]) ? s.at['legHeight' + k] / top : NaN; };
      s.foldMax = Math.max(legFold('L'), legFold('R'));
      if (!Number.isFinite(s.foldMax)) s.foldMax = s.fold;
      s.minFold = standingLeg > 0 ? Math.min(...s.rows.map(r => r.legHeight)) / standingLeg : 1;
      const ankles = this.history.map(r => r.ankleHeight).filter(Number.isFinite).sort((a, b) => a - b);
      s.standingAnkle = ankles.length ? ankles[Math.floor(ankles.length / 2)] : NaN;          // median: on the floor
      const ctx = { view: this.viewBetween(Math.max(start, rep.end - 3000), rep.end) };
      if (this.ex.valid && !this.ex.valid(s, ctx)) continue;
      const faults = this.ex.checks(s, ctx, arm);
      const stable = stableTracking(s);
      const distinct = stable && (this.ex.distinct ? !!this.ex.distinct(s, ctx, arm) : true);
      if (this.ex.full && !this.ex.full(s, ctx)) {
        // the right movement but not deep enough to count: tell the page, and let it feed the "go deeper" cue
        this.partials += 1;
        events.push({ type: 'partial', t: rep.t, faults, fold: s.fold, view: ctx.view, distinct, stable, window: { start, end: rep.end } });
        this.cueFrom(arm, faults, t, null, events);
        continue;
      }
      // two-arm reps (both arms curl together): the two arms' turning points within 500 ms are one rep
      let counted = true;
      if (this.ex.perArm) {
        const other = this.lastArmRep[arm === 'L' ? 'R' : 'L'];
        if (other && !other.paired && Math.abs(other.t - rep.t) < 500) { counted = false; other.paired = true; }
        this.lastArmRep[arm] = { t: rep.t, paired: !counted };
      }
      if (counted) this.count += 1;
      const side = this.ex.perArm ? (arm === 'L' ? 'left' : 'right') : this.ex.side ? this.ex.side(s) : null;
      if (side) this.perSide[side] = (this.perSide[side] || 0) + 1;
      events.push({ type: 'rep', count: this.count, counted, side, t: rep.t, faults, view: ctx.view, distinct, stable,
        hipTravel: +span(s, 'hipX').toFixed(2), minFold: +s.minFold.toFixed(2), posture: s.at.posture,
        metrics: { extreme: rep.value, durationMs: rep.end - start }, window: { start, end: rep.end } });
      // cues are decided per arm: "2 of the last 3 reps" and "fixed" compare reps of the same arm
      const st = this.state(arm);
      const cuedNow = this.cueFrom(arm, faults, t, side, events);
      if (!faults.length && !cuedNow) {      // "fixed" only on a clean rep, never next to a new correction
        const last2 = st.recent.slice(-2);
        for (const [code, message] of [...st.cued]) {
          if (last2.length === 2 && last2.every(codes => !codes.includes(code))) {
            st.cued.delete(code);
            events.push({ type: 'fixed', code, message, t, side });
          }
        }
      }
      st.clean = faults.length ? 0 : st.clean + 1;
      if (counted && st.clean > 0 && st.clean % 5 === 0) events.push({ type: 'praise', t, count: this.count });
    }
    return events;
  }

  /** Record one rep's faults for this arm and raise at most one cue (fault on 2 of the last 3 reps, or a major one). */
  cueFrom(arm, faults, t, side, events) {
    const st = this.state(arm);
    st.recent.push(faults.map(x => x.code));
    if (st.recent.length > 3) st.recent.shift();
    for (const fl of faults) {
      const seen = st.recent.filter(codes => codes.includes(fl.code)).length;
      const urgent = fl.severity === 'major';
      if ((seen >= 2 || urgent) && t - (st.lastCue[fl.code] ?? -Infinity) > this.cooldown) {
        st.lastCue[fl.code] = t; st.cued.set(fl.code, fl.message);
        events.push({ type: 'cue', code: fl.code, part: fl.part, message: fl.message, t, value: fl.value, side,
          reason: urgent ? 'major fault' : `${seen} of the last ${st.recent.length} reps` });
        return true;                        // one cue per rep
      }
    }
    return false;
  }

  /** No person found in this frame: same as losing every needed part (the rep detectors restart when seen again). */
  lost(t) {
    // no person at all: restart (MediaPipe's re-detection after a dropout need not continue where it left off)
    this.missing = this.ex.needs || [];
    this.missSince ??= t;
    this.lastT = t;
    this.inViewSince = null;
    if (this.inView) { this.inView = false; this.detectors = this.mkDetectors(); }
  }

  summary() {
    return { exercise: this.key, reps: this.count, partials: this.partials, perSide: this.perSide, view: this.view() };
  }
}
