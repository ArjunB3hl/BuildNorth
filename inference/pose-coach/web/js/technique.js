// A single named jab–cross attempt, measured independently. No repetition counter or run warm-up.
// Image-space reach and direction are used only when the punch is visible across the picture; world depth is not
// used to infer an unseen extension. The reference jab is short in its recovered skeleton, and hip/shoulder yaw in
// the live recording is unstable, so neither full extension nor rotation is graded or called correct.
import { bodyMetrics } from './moveform.js';

const SIDES = ['L', 'R'],
  other = (s) => (s === 'L' ? 'R' : 'L');
const median = (a) => {
  const v = a.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
};
export const TECHNIQUE_LIMITS = ['Full jab extension and hip/shoulder rotation were not assessed.'];
export const TECHNIQUE_CHECKS = {
  punch_up: {
    label: 'punch travelling upward',
    part: 'arm',
    target: 'a straight punch toward shoulder height',
    cue: 'Punch straight ahead at shoulder height, rather than upward.',
  },
  guard_drop: {
    label: 'guard hand dropped',
    part: 'arm',
    target: 'the other hand near the chin',
    cue: 'Keep your other hand up by your chin as you punch.',
  },
  guard_return: {
    label: 'hand not returned to guard',
    part: 'arm',
    target: 'both hands back near the chin',
    cue: 'Bring your punching hand back to your chin.',
  },
};

/** Torso-normalised measures. `profile` allows the shoulders to turn during a cross; a frontal punch has too little
 * projected reach to grade. The source footage's extended punches slope -10 to +6 degrees, the side-projected
 * reference -4 to +4; the deliberate live upward punches reach 23–29. A 20-degree line leaves a substantial margin.
 * The guard's reference wrists stay above 0.33 torso lengths below the shoulder. */
export function punchMetrics(lm) {
  if (!lm?.world || !lm?.image) return null;
  const { world: w, image: im, aspect: a = 16 / 9 } = lm,
    m = bodyMetrics(w, im, a);
  if (!m) return null;
  const p = (i) => [im[i].x * a, im[i].y],
    dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const sh = mid(p(11), p(12)),
    hip = mid(p(23), p(24)),
    torso = dist(sh, hip);
  if (!(torso > 0.02)) return null;
  const out = {
    seen: m.seen.trunk && m.seen.head,
    upright: m.trunkTilt < 30,
    profile: dist(p(23), p(24)) / torso < 0.48 && dist(p(11), p(12)) / torso < 0.68,
    shoulderYaw: (Math.atan2(w[11].z - w[12].z, w[11].x - w[12].x) * 180) / Math.PI,
    hipYaw: (Math.atan2(w[23].z - w[24].z, w[23].x - w[24].x) * 180) / Math.PI,
  };
  for (const [s, i] of [
    ['L', 11],
    ['R', 12],
  ]) {
    const shoulder = p(i),
      wrist = p(i + 4),
      dx = (wrist[0] - shoulder[0]) / torso,
      up = (shoulder[1] - wrist[1]) / torso;
    out[s] = {
      seen: m.seen[`arm${s}`],
      elbow: m[`elbow${s}`],
      reach: dist(shoulder, wrist) / torso,
      x: dx,
      up,
      angle: (Math.atan2(up, Math.abs(dx)) * 180) / Math.PI,
      guard: dist(wrist, p(0)) / torso,
    };
    out[s].home = out[s].seen && out[s].guard < 0.85 && up > -0.45 && out[s].elbow < 125;
  }
  return out;
}

export class OneTwoTechnique {
  constructor() {
    this.history = [];
    this.active = null;
    this.first = null;
    this.last = null;
    this.open = [];
    this.reviewed = false;
    this.lastSeen = null;
    this.lastUnseen = -Infinity;
    this.punches = [];
    this.viewSince = {};
  }
  event(type, t, rest) {
    return { type, t, ...rest };
  }
  resetMotion() {
    this.history = [];
    this.active = null;
    this.first = null;
    this.viewSince = {};
  }
  fault(id, s, value, t, seen, out) {
    const c = TECHNIQUE_CHECKS[id];
    const f = { fault: id, ...c, side: s === 'L' ? 'left' : 'right', measured: value, seen };
    this.open = [f];
    out.push(this.event('form_fault', t, f));
    return f;
  }
  result(t, sequence, punches, out) {
    const faults = punches.flatMap((p) => p.faults),
      complete = sequence === 'jab_cross';
    const checked = [
      'punch direction',
      ...(punches.every((p) => p.guardSeen) ? ['guard hand'] : []),
      ...(punches.every((p) => p.returned) ? ['return to guard'] : []),
    ];
    const verdict = faults.length ? 'fault' : complete ? 'partial' : 'incomplete';
    const cue = faults.length
      ? ''
      : complete
        ? 'One-two seen. The measured direction and guard checks passed; hip turn was not assessed.'
        : sequence === 'same_hand'
          ? 'That was the same hand again. Follow the jab with the other hand, then return to guard.'
          : 'Jab seen. Add the cross with your other hand, then return to guard.';
    this.last = {
      verdict,
      sequence,
      checked,
      unmeasured: TECHNIQUE_LIMITS,
      faults,
      seen: { from: punches[0].start, to: t },
      cue,
    };
    this.reviewed = true;
    if (!faults.length) this.open = [];
    out.push(this.event('technique_result', t, this.last));
  }
  completed(p, t, out) {
    this.punches.push(p); // bounded diagnostic evidence, never a repetition count or user-facing total
    if (this.punches.length > 40) this.punches.shift();
    if (this.first) {
      this.result(t, this.first.side === p.side ? 'same_hand' : 'jab_cross', [this.first, p], out);
      this.first = null;
    } else this.first = p;
  }
  update(lm, t) {
    const out = [],
      m = punchMetrics(lm);
    if (!m?.seen || !m.upright || !m.L.seen || !m.R.seen) {
      if (t - (this.lastSeen ?? t) > 250) {
        this.resetMotion();
      }
      return out;
    }
    if (this.lastSeen !== null && t - this.lastSeen > 250) this.resetMotion();
    this.lastSeen = t;
    const home = m.L.home && m.R.home;
    this.history.push({ t, m });
    while (this.history.length && this.history[0].t < t - 900) this.history.shift();
    if (this.active) {
      const p = this.active,
        s = p.side,
        a = m[s];
      p.rows.push({ t, m });
      if (a.reach > p.peak.m[s].reach) p.peak = { t, m };
      const peak = p.peak.m[s];
      // A punch normally turns back. A held extension must also be judged, or never returning would evade the check.
      if (!p.judged && (peak.reach - a.reach > 0.12 || t - p.peak.t > 500) && t - p.start >= 90) {
        p.judged = true;
        const top = p.rows.filter((r) => r.m[s].reach >= peak.reach * 0.9);
        const angle = median(top.map((r) => r.m[s].angle));
        p.angle = angle;
        if (angle < -20) {
          this.active = null;
          this.history = [];
          return out;
        }
        if (!top.every((r) => r.m.profile)) {
          if (t - this.lastUnseen >= 10000) {
            this.lastUnseen = t;
            out.push(
              this.event('form_unseen', t, {
                why: 'view',
                missing: ['punch direction'],
                parts: [],
                cue: 'Turn sideways so I can see your punches extend and return to guard.',
              })
            );
          }
          this.resetMotion();
          return out;
        }
        p.guardSeen = top.every((r) => r.m[other(s)].seen);
        const seen = { from: p.start, to: t };
        if (angle > 20)
          p.faults.push(this.fault('punch_up', s, `punch angled ${Math.round(angle)} degrees upward`, t, seen, out));
        const drop = median(top.map((r) => -r.m[other(s)].up));
        if (p.guardSeen && drop > 0.5)
          p.faults.push(
            this.fault(
              'guard_drop',
              other(s),
              `guard wrist ${drop.toFixed(2)} torso lengths below its shoulder`,
              t,
              seen,
              out
            )
          );
      }
      if (p.judged && a.home && a.reach < peak.reach - 0.12) {
        p.returned = true;
        p.end = t;
        this.completed(p, t, out);
        this.active = null;
        this.history = [{ t, m }];
      } else if (p.judged && t - p.peak.t > 1800) {
        p.returned = false;
        p.end = t;
        p.faults.push(
          this.fault(
            'guard_return',
            s,
            `hand still away from guard after 1.8 seconds`,
            t,
            { from: p.peak.t, to: t },
            out
          )
        );
        this.completed(p, t, out);
        this.active = null;
        this.history = [];
      } else if (t - p.start > 5000) {
        this.active = null;
        this.history = [];
      }
    } else {
      const candidates = [];
      for (const s of SIDES) {
        const a = m[s],
          // Starting guard is stricter than the return window: a hand hanging below the shoulder and circling up
          // is not a straight punch. The source footage starts above -0.19 torso lengths; allow a margin to -0.25.
          past = this.history.filter(
            (r) => r.t < t - 60 && r.m[s].home && r.m[s].up > -0.25 && r.m[other(s)].home && r.m[other(s)].up > -0.25
          );
        if (!past.length) continue;
        const base = past.reduce((best, r) => (r.m[s].reach < best.m[s].reach ? r : best));
        const rise = a.reach - base.m[s].reach;
        const viewBlocked =
          (!m.profile || Math.abs(a.x) < 0.18) &&
          a.elbow > 135 &&
          a.elbow - base.m[s].elbow > 35 &&
          a.up > -0.25 &&
          m[other(s)].home;
        if (viewBlocked) this.viewSince[s] ??= t;
        else this.viewSince[s] = null;
        if (this.viewSince[s] != null && t - this.viewSince[s] >= 100 && t - this.lastUnseen >= 10000) {
          this.lastUnseen = t;
          out.push(
            this.event('form_unseen', t, {
              why: 'view',
              missing: ['punch direction'],
              parts: [],
              cue: 'Turn sideways so I can see your punches extend and return to guard.',
            })
          );
        }
        if (
          rise >= 0.12 &&
          a.reach >= 0.52 &&
          Math.abs(a.x) >= 0.38 &&
          a.up > -0.35 &&
          a.up < 1 &&
          a.elbow - base.m[s].elbow >= 18 &&
          m[other(s)].guard < 1.1
        )
          candidates.push({ s, rise, base });
      }
      candidates.sort((a, b) => b.rise - a.rise);
      if (candidates.length) {
        const { s, base } = candidates[0];
        this.active = { side: s, start: base.t, peak: { t, m }, rows: [base, { t, m }], faults: [] };
      }
    }
    if (this.first && !this.active && t - this.first.end > 2500) {
      this.result(t, 'jab_only', [this.first], out);
      this.first = null;
    }
    return out;
  }
  finish(t) {
    const out = [];
    if (this.first) this.result(t, 'jab_only', [this.first], out);
    this.resetMotion();
    return out;
  }
  current() {
    return {
      result: this.last,
      phase: this.active ? 'punch' : this.first ? 'cross' : 'ready',
      form: { open: this.open, checked: [], pending: [], unseen: [], wrongView: [], unmeasured: TECHNIQUE_LIMITS },
    };
  }
  summary() {
    return { reviewed: this.reviewed || this.open.length > 0, result: this.last };
  }
}

/** Correct reference moments for the same fault ids used by the replay and 3D viewer. */
export function techniquePoses(frames) {
  const rows = frames.map((f) => ({ ...f, m: punchMetrics(f) })).filter((f) => f.m?.seen && f.m.L.seen && f.m.R.seen);
  const choices = rows.flatMap((f) => SIDES.map((s) => ({ f, s, a: f.m[s] })));
  const extended = choices
    .filter((x) => Math.abs(x.a.x) > 0.38 && Math.abs(x.a.angle) < 12)
    .sort((a, b) => b.a.reach - a.a.reach)[0];
  const home = rows.filter((f) => f.m.L.home && f.m.R.home).at(-1);
  if (!extended || !home) throw new Error('reference lacks a visible straight punch and guard');
  const pose = (f, s) => ({
    image: f.image.map((p) => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]),
    side: s === 'L' ? 'left' : 'right',
    t: Math.round(f.t) / 1000,
  });
  return {
    punch_up: pose(extended.f, extended.s),
    guard_drop: pose(extended.f, other(extended.s)),
    guard_return: pose(home, extended.s),
  };
}
