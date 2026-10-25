// "What went wrong": the user's own rep replayed as a stick figure with the faulty body part in red, the measurement in
// plain words with what to aim for, next to the 3D demo of the right form (app.js shows the two side by side); for a
// held pose, its last seconds next to the movement's reference pose, drawn the same way (still).
// Pure helpers plus a canvas player; the thresholds quoted are the engine's (web/js/engine.js checks).

const deg = v => `${Math.round(v)}°`;
const pct = v => `${Math.round(Math.abs(v) * 100)}%`;
// per fault code (exercise-specific first): what was measured, and what to aim for
const TEXT = {
  'squat/shallow': v => `Your knees bent to ${deg(v)} at the bottom. Aim for 110° or less.`,
  'squat/chest_down': v => `Your chest tipped ${deg(v)} forward. Keep it under 50°.`,
  'knees_in': v => `At the bottom your knees came ${pct(1 - v)} closer together than your feet. Keep them over your toes.`,
  'squat_pulse/too_high': v => `Your knees were at ${deg(v)}. Stay at 120° or lower.`,
  'pushup/shallow': v => `Your elbows bent to ${deg(v)}. Aim for 110° or less.`,
  'hips_sag': v => `Your hips dropped ${pct(v)} of your body length below the line from shoulders to heels.`,
  'hips_pike': v => `Your hips rose ${pct(v)} of your body length above the line from shoulders to heels.`,
  'pushup/no_lockout': v => `Your arms straightened only to ${deg(v)} at the top. Aim for 150° or more.`,
  'lunge/shallow': v => `Your knees bent to ${deg(v)}. Aim for 110° or less.`,
  'lean': v => `Your torso leaned ${deg(v)}. Keep it under 22°.`,
  'knee_past_toes': v => `Your front knee went ${pct(v)} of a shin past your toes.`,
  'lateral_raise/low': v => `Your arms reached ${deg(v)}. Lift to about shoulder height (65-110°).`,
  'lateral_raise/high': v => `Your arms reached ${deg(v)}. Stop at shoulder height (110° or less).`,
  'uneven': v => `Your arms were ${deg(v)} apart in height.`,
  'swing': v => `Your torso swung ${deg(v)} during the rep. Keep it under 10-12°.`,
  'front_raise/low': v => `Your arm reached ${deg(v)}. Raise it to shoulder height (65° or more).`,
  'short_top': () => 'Your hand stopped below your shoulder at the top.',
  'short_bottom': () => 'Your arm did not straighten at the bottom.',
  'elbow_drift': v => `Your elbow moved ${deg(v)} away from your side. Keep it under 40°.`,
  'no_extension': v => `Your arm straightened only to ${deg(v)}. Aim for 150° or more.`,
  'overhead_press/no_lockout': v => `Your arms reached ${deg(v)} overhead. Lock out to 155° or more.`,
  'arch': v => `You leaned back ${deg(v)} as you pressed. Keep it under 12°.`,
  'hinge/no_lockout': v => `Your hips opened only to ${deg(v)} at the top. Stand tall: 160° or more.`,
  'arms_low': v => `Your arms reached ${deg(v)}. Bring them all the way overhead (140° or more).`,
  'feet_narrow': v => `Your feet were ${v.toFixed(1)} hip widths apart. Jump them wider (1.6 or more).`,
  'low_knee': v => `Your thigh reached ${deg(v)} to your body. Drive it up to hip height (105° or less).`,
};

/** The measurement of one fault in plain words (falls back to the correction itself). */
export function describeFault(exercise, fault) {
  const f = TEXT[`${exercise}/${fault.code}`] || TEXT[fault.code];
  return f && Number.isFinite(fault.value) ? f(fault.value) : f && fault.value == null ? f() : fault.message;
}
export const describedCodes = () => Object.keys(TEXT);

// BlazePose bones, and the ones to colour for each body part a fault names
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30], [0, 11], [0, 12]];
// the parts on one side of the body, by side: a fault names the user's own side ('left' / 'right', as MediaPipe names
// the landmarks), or none for both (a held pose's top arm, its bent or lifted leg: web/js/holdform.js)
const ARM = { L: [[11, 13], [13, 15]], R: [[12, 14], [14, 16]] };
const KNEE = { L: [[23, 25], [25, 27]], R: [[24, 26], [26, 28]] };
const FOOT = { L: [[27, 31], [27, 29]], R: [[28, 32], [28, 30]] };
const LEG = { L: [...KNEE.L, ...FOOT.L], R: [...KNEE.R, ...FOOT.R] };
const SIDED = { arm: ARM, elbow: ARM, knee: KNEE, leg: LEG, foot: FOOT, ankle: FOOT };
const PART = {
  hips: [[11, 23], [12, 24], [23, 24], [23, 25], [24, 26]],
  chest: [[11, 12], [11, 23], [12, 24]], torso: [[11, 12], [11, 23], [12, 24]], trunk: [[11, 12], [11, 23], [12, 24]],
  'lower back': [[11, 23], [12, 24], [23, 24]],
  knees: [[23, 25], [25, 27], [24, 26], [26, 28]], 'front knee': [[23, 25], [25, 27], [24, 26], [26, 28]],
  arms: [...ARM.L, ...ARM.R], legs: [...LEG.L, ...LEG.R],
  // (and the gap between the ankles, drawn as a dashed line: the stance width a held pose's feet are measured by)
  feet: [...FOOT.L, ...FOOT.R, [27, 28]],
};
/** The bones to colour for a fault on `part` (`side` 'left'/'right' picks one limb: a per-arm exercise's arm, a knee
 * raise's knee, a held pose's top arm or bent leg; none, both). */
export function bonesFor(part, side) {
  const s = SIDED[part];
  if (s) return side === 'right' ? s.R : side === 'left' ? s.L : [...s.L, ...s.R];
  return PART[part] || [];
}
export const boneParts = () => [...Object.keys(PART), ...Object.keys(SIDED)];

// MediaPipe's left/right landmark pairs (eyes, ears, mouth, arms, hands, legs, feet)
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
/** Image landmarks ([{x, y, visibility}]) of the same pose done on the other side: x flipped and each left landmark
 * swapped with its right one, so the person's left is still what MediaPipe calls left (a held pose's reference turned
 * to the user's working side: its front leg, its top arm then where the user's are). */
export function mirrorImage(image) {
  const out = image.map(p => ({ ...p, x: 1 - p.x }));
  for (const [a, b] of PAIRS) if (out[a] && out[b]) [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/** Loops a recorded rep (frames [{t, image: [{x, y, visibility}]}]) on a canvas, 3/4 speed, faulty bones in red; or
 * shows one pose still (show(): a held pose's reference), drawn the same way. */
export class RepReplay {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.raf = 0; }

  /** Sizes the canvas to the frames' shape and returns its drawing of one frame's landmarks, or null (none seen). */
  layout(frames, { aspect, mirror, bones }) {
    const pts = frames.flatMap(f => f.image.filter(p => (p.visibility ?? 1) > 0.3).map(p => [p.x * aspect, p.y]));
    if (!pts.length) return null;
    const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
    const y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    // the frame takes the rep's shape: landscape for a body lying along the floor (push-ups), portrait standing
    const wide = (x1 - x0) > 1.2 * (y1 - y0);
    this.canvas.width = wide ? 360 : 240; this.canvas.height = wide ? 220 : 300;
    const { width: W, height: H } = this.canvas, pad = 0.1;
    const k = Math.min(W / ((x1 - x0) * (1 + 2 * pad) || 1), H / ((y1 - y0) * (1 + 2 * pad) || 1));
    const ox = W / 2 - ((x0 + x1) / 2) * k, oy = H / 2 - ((y0 + y1) / 2) * k;
    const P = p => { let x = p.x * aspect * k + ox; if (mirror) x = W - x; return [x, p.y * k + oy]; };
    const hot = new Set(bones.map(([a, b]) => `${a}-${b}`));
    // a part's bones that are no bone of the figure (the gap between the feet): dashed, as a measure
    const gaps = bones.filter(([a, b]) => !BONES.some(([u, v]) => u === a && v === b));
    return image => {
      const c = this.ctx;
      c.fillStyle = '#1e2124'; c.fillRect(0, 0, W, H);
      c.lineCap = 'round';
      for (const [a, b] of BONES) {
        const pa = image[a], pb = image[b];
        if (!pa || !pb) continue;
        const isHot = hot.has(`${a}-${b}`);
        c.strokeStyle = isHot ? '#fc8181' : 'rgba(232, 234, 240, .8)'; c.lineWidth = isHot ? 6 : 3;
        c.beginPath(); c.moveTo(...P(pa)); c.lineTo(...P(pb)); c.stroke();
      }
      c.strokeStyle = '#fc8181'; c.lineWidth = 3; c.setLineDash([6, 5]);
      for (const [a, b] of gaps) {
        if (!image[a] || !image[b]) continue;
        c.beginPath(); c.moveTo(...P(image[a])); c.lineTo(...P(image[b])); c.stroke();
      }
      c.setLineDash([]);
      if (image[0]) {
        const head = P(image[0]);
        c.fillStyle = 'rgba(232, 234, 240, .8)'; c.beginPath(); c.arc(head[0], head[1], 5, 0, 2 * Math.PI); c.fill();
      }
      return { W, H };
    };
  }

  play(frames, { aspect = 16 / 9, mirror = false, bones = [], speed = 0.75 } = {}) {
    this.stop();
    const fr = frames.filter(f => f.image);
    if (fr.length < 2) { this.clear(); return false; }
    const draw = this.layout(fr, { aspect, mirror, bones });
    if (!draw) { this.clear(); return false; }
    const t0 = fr[0].t, dur = fr.at(-1).t - t0, hold = 500;              // a short pause before it loops
    const start = performance.now();
    const frame = now => {
      const el = ((now - start) * speed) % (dur + hold);
      const at = t0 + Math.min(el, dur);
      const f = fr.reduce((b, x) => (Math.abs(x.t - at) < Math.abs(b.t - at) ? x : b), fr[0]);
      const { W, H } = draw(f.image);
      // (the progress through the rep)
      this.ctx.fillStyle = '#4fd1c5'; this.ctx.fillRect(0, H - 3, (W * Math.min(el, dur)) / (dur || 1), 3);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    return true;
  }

  /** One pose ([{x, y, visibility}]), still. */
  show(image, { aspect = 16 / 9, mirror = false, bones = [] } = {}) {
    this.stop();
    const draw = image?.length ? this.layout([{ image }], { aspect, mirror, bones }) : null;
    if (!draw) { this.clear(); return false; }
    draw(image);
    return true;
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  clear() { this.stop(); this.ctx.fillStyle = '#1e2124'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
}
