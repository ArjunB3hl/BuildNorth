// Phrase-anchored leg comparison. Timing comes from the order and side of measured knee bends, not from pose
// similarity, so a still stance or a mirrored copy cannot be matched to the reference's motion. Read-only.
import { legEvents, median, angle } from './review-analysis.js';

const SIDES = { left: { knee: 2, ankle: 27, other: 28 }, right: { knee: 3, ankle: 28, other: 27 } };
const flip = side => side === 'left' ? 'right' : 'left';

// Height of one ankle above the other, divided by leg length. The user's is in image y, which needs no depth
// estimate; the reference's is in its world y. Both use the same vertical axis (y down). It is a relative foot
// height, not a floor-contact or weight-transfer measurement.
export function footRise(samples, reference = false) {
  const ys = f => reference ? f.world : f.image, ok = f => [23, 24, 27, 28].every(i => f.valid?.[i] && Number.isFinite(ys(f)?.[i]?.[1]));
  const leg = f => ((ys(f)[27][1] - ys(f)[23][1]) + (ys(f)[28][1] - ys(f)[24][1])) / 2;
  const legs = samples.map(f => ok(f) ? leg(f) : null);
  let lo = 0, hi = 0;
  return samples.map((f, i) => {
    while (samples[lo].t < f.t - 3000) lo++;
    while (hi < samples.length && samples[hi].t <= f.t + 3000) hi++;
    if (!ok(f)) return null;
    const size = median(legs.slice(lo, hi).filter(x => x > 0));
    if (!size) return null;
    return { left: (ys(f)[28][1] - ys(f)[27][1]) / size, right: (ys(f)[27][1] - ys(f)[28][1]) / size };
  });
}

// Knee bends at most 200 ms apart (a brief uncertain or near-threshold sample) belong to one bend. `hidden`
// marks a bend whose deepest part may be unmeasured: within 300 ms, a frame with an uncertain hip, knee or ankle
// has a raw knee estimate at least 10° deeper than the measured minimum. Such a bend never yields a cue.
export function kneeBends(samples, rises, { gap = 200, minSamples = 3 } = {}) {
  const merged = [];
  for (const e of legEvents(samples, 135, { minSamples, minMs: 60 })) {
    const last = merged.findLast(x => x.side === e.side);
    if (last && e.start - last.end <= gap && !merged.some(x => x.side !== e.side && x.t > last.t && x.t < e.t)) {
      if (e.kneeMin < last.kneeMin) Object.assign(last, { t: e.t, peak: e.peak, kneeMin: e.kneeMin });
      last.end = e.end;
    } else merged.push({ ...e });
  }
  for (const e of merged) {
    const span = samples.map((f, i) => [f, i]).filter(([f]) => f.t >= e.start && f.t <= e.end);
    const r = span.map(([, i]) => rises[i]?.[e.side]).filter(Number.isFinite);
    e.rise = r.length ? Math.max(...r) : null;
    e.visible = span.filter(([f]) => [SIDES[e.side].ankle, SIDES[e.side].other].every(i => f.valid?.[i])).length / span.length;
    // Shoulder-line yaw in the camera frame (monocular depth); only its larger changes are used, as a turn direction.
    e.yaw = median(span.filter(([f]) => f.valid?.[11] && f.valid?.[12]).map(([f]) => Math.atan2(-(f.world[11][2] - f.world[12][2]), f.world[11][0] - f.world[12][0]) * 180 / Math.PI));
    const ids = e.side === 'left' ? [23, 25, 27] : [24, 26, 28];
    e.hidden = samples.some(f => f.t >= e.start - 300 && f.t <= e.end + 300 && !ids.every(i => f.valid?.[i])
      && ids.every(i => f.world?.[i]) && angle(...ids.map(i => f.world[i])) < e.kneeMin - 10);
  }
  return merged.sort((a, b) => a.t - b.t);
}

// Find runs of consecutive user bends whose sides follow at least three consecutive reference bends, with one
// plausible pace (each gap 0.6–2.2× the reference's, gaps within 2.2× of each other). Where the reference turns
// by 15° or more between two bends, the user's turn must go the same way. A mirrored order (sides and turn
// reversed) is reported separately and never produces a left/right cue.
const TURN = 15;
export function anchoredPhrases(user, reference, { min = 3 } = {}) {
  const out = [];
  for (const mirrored of [false, true]) {
    for (let a = 0; a + min <= reference.length; a++) for (let u = 0; u + min <= user.length; u++) {
      let k = 0, paces = [];
      while (a + k < reference.length && u + k < user.length && user[u + k].side === (mirrored ? flip(reference[a + k].side) : reference[a + k].side)) {
        if (k) {
          const p = (user[u + k].t - user[u + k - 1].t) / (reference[a + k].t - reference[a + k - 1].t);
          if (p < .6 || p > 2.2 || (paces.length && Math.max(...paces, p) / Math.min(...paces, p) > 2.2)) break;
          const turn = reference[a + k].yaw - reference[a + k - 1].yaw, own = user[u + k].yaw - user[u + k - 1].yaw;
          if (Math.abs(turn) >= TURN && !(Math.sign(own) === Math.sign(turn) * (mirrored ? -1 : 1) && Math.abs(own) >= TURN)) break;
          paces.push(p);
        }
        k++;
      }
      if (k < min) continue;
      const pairs = Array.from({ length: k }, (_, i) => ({ user: user[u + i], reference: reference[a + i] }));
      if (out.some(x => x.pairs.some(p => pairs.some(q => q.user === p.user)) && x.pairs.length >= k)) continue;
      out.push({ mirrored, pairs, pace: paces.reduce((s, p) => s + p, 0) / paces.length });
    }
  }
  return out.sort((x, y) => x.pairs[0].user.t - y.pairs[0].user.t);
}

// Piecewise-linear reference time between matched bend peaks, extrapolated at the phrase pace and clamped.
export function anchoredTime(phrase, t, duration) {
  const knots = phrase.pairs.map(p => [p.user.t, p.reference.t]), pace = phrase.pace;
  let r;
  if (t <= knots[0][0]) r = knots[0][1] - (knots[0][0] - t) / pace;
  else if (t >= knots.at(-1)[0]) r = knots.at(-1)[1] + (t - knots.at(-1)[0]) / pace;
  else { const i = knots.findIndex(k => k[0] >= t), [a, b] = [knots[i - 1], knots[i]]; r = a[1] + (t - a[0]) / (b[0] - a[0]) * (b[1] - a[1]); }
  return Math.max(0, Math.min(duration, r));
}

// A matched bend gives a cue only when the 3D knee angle and the depth-independent foot rise agree: knee at least
// 25° less bent and foot at least 0.1 leg lengths lower than the reference's matching bend, with both ankles
// visible for most of the bend. Deeper bends or higher feet are freestyle choices and give no cue.
export function anchoredDifferences(phrase) {
  if (phrase.mirrored) return [];
  return phrase.pairs.flatMap(({ user, reference }, index) => {
    if (user.hidden || user.visible < .7 || !Number.isFinite(user.rise) || !Number.isFinite(reference.rise)) return [];
    const knee = user.kneeMin - reference.kneeMin, rise = user.rise - reference.rise;
    if (!(knee >= 25 && rise <= -.1)) return [];
    const ids = user.side === 'left' ? [23, 25, 27] : [24, 26, 28], ordinal = phrase.pairs.slice(0, index + 1).filter(p => p.reference.side === reference.side).length;
    return [{ part: `${user.side} knee`, kind: 'anchored', ids, start: user.start, end: user.end, t: user.t, referenceT: reference.t,
      userValue: user.kneeMin, referenceValue: reference.kneeMin, userAngle: Math.round(user.kneeMin / 5) * 5, referenceAngle: Math.round(reference.kneeMin / 5) * 5,
      userRise: user.rise, referenceRise: reference.rise, delta: knee, strength: knee / 25, ordinal,
      cue: `To try the reference, bend your ${user.side} knee more on this lift so the foot comes up higher.` }];
  });
}

// A whole attempt, from its own saved frames only (never across a restart boundary).
export function anchoredReview(frames, referenceSamples, window, duration) {
  const own = frames.filter(f => f.t >= window.start && f.t <= window.end && f.values);
  if (own.length < 8) return { phrases: [], userBends: [], referenceBends: [] };
  // The 10 Hz reference needs two samples, the ~30 Hz recording three, for a comparable minimum duration.
  const referenceBends = kneeBends(referenceSamples, footRise(referenceSamples, true), { minSamples: 2 });
  const userBends = kneeBends(own, footRise(own));
  const phrases = anchoredPhrases(userBends, referenceBends).map(p => {
    const start = Math.max(window.start, p.pairs[0].user.t - p.pairs[0].reference.t * p.pace);
    const end = Math.min(window.end, p.pairs.at(-1).user.t + (duration - p.pairs.at(-1).reference.t) * p.pace);
    return { ...p, start, end, findings: anchoredDifferences(p) };
  });
  return { phrases, userBends, referenceBends };
}

// Adapts a phrase to the replay's DTW-shaped result, so playback, highlighting and readouts reuse one path.
export function anchoredResult(sample, reference, phrase, duration) {
  const path = sample.map((f, i) => {
    const rt = anchoredTime(phrase, f.t, duration);
    let j = 0; for (let k = 1; k < reference.length; k++) if (Math.abs(reference[k].t - rt) < Math.abs(reference[j].t - rt)) j = k;
    return [i, j];
  });
  return { supported: true, anchored: true, path, focus: 'legs', coverage: sample.filter(f => f.values?.some(Number.isFinite)).length / sample.length,
    ratio: phrase.pace, errorDeg: null,
    reason: `Timing anchored by the order of your measured knee bends (${phrase.pairs.map(p => p.user.side[0].toUpperCase()).join('→')}), matched to the reference’s, at ${phrase.pace.toFixed(2)}× its pace. This is not proof of the intended phrase.` };
}
