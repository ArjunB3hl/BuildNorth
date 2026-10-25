// Automatic exercise detection for a whole workout. Every exercise engine watches the same frames; a movement counts
// only once it is clearly one exercise (that exercise's `distinct` rule) and it repeats: a set starts after a few such
// reps (which are then counted), and ends when the user says it is done, after a rest, or when another exercise takes
// over. Each exercise numbers its own sets, so alternating push-ups and squats gives push-ups set 1, squats set 1,
// push-ups set 2, ...
//
//   const auto = new AutoTracker();       // or new AutoTracker({ only: 'squat' }): the user said what they are doing
//   events = auto.update(features, tMs)   // or auto.lost(tMs) when no person is found
//   events = auto.setExercise(key, tMs)   // the user named the exercise (an EXERCISES key), or 'auto' to detect again
//   events = auto.answerSetEnd(done, tMs) // the user's answer to set_end_pending ("Done with this set?")
//   events = auto.finish(tMs)             // end of the workout: closes the open set, adds a workout_summary
//
// Events: set_start {exercise, label, set, count, previous?}, rep {exercise, label, set, count, backfill?, ...},
// set_end {exercise, label, set, reps, partials, faults, perSide, reason: confirmed|rest|switch|stop}, workout_summary
// {sets, totals}, tentative {exercise, label, count, need, switching?} (a rep of an exercise without a set yet: `count`
// of the `need` reps in a row that start one), set_end_pending and set_end_cancelled {exercise, label, set, reps, t}
// (below) and the active set's own cue / fixed / praise / partial / visibility events (tagged with exercise).
//
// A set never ends on a guess alone. With no rep of the set's exercise for ASK_REST_MS (and none under way), the set
// stays open and set_end_pending asks the user (current().asking: the question is open). A rep of it withdraws the
// question (set_end_cancelled, then the rep), and so does any set_end of it. answerSetEnd(true) ends the set in
// progress, asked about or not (confirmed: the reps of it still being decided count), except within ECHO_MS of another
// "done", for a set nobody asked about (the same answer twice: a tap, then the voice). answerSetEnd(false)
// answers the open question only (after a rep withdrew it, it changes nothing): the set goes on, is not asked about
// again until its next rep, and with none ends by a rest REST_MS after the answer. With no answer, the rest ends it as
// before the question existed (REST_MS after its last rep, reason rest).
//
// A named exercise (`only`, or setExercise mid-workout; `auto.only` says which, null while detecting): only that
// exercise's engine counts, every rep it counts with tracking that held together (its `distinct` rules tell
// exercises apart, so they are not used), and a set starts on its first rep: no reps in a row, no rivals. Between its
// sets, its partial, cue and visibility events still come out, tagged with exercise and label but no set. Naming
// another exercise ends the set in progress (switch: its reps still being decided count); its reps seen just before
// (while auto mode was waiting for a few in a row, or for them to take over) start the named one's set, so no rep is
// lost while the user was being asked, and the next set_start, of whatever exercise, carries the ended set as
// `previous`. 'auto' detects again; the set in progress goes on. Every engine keeps watching either way, so going back
// to 'auto' starts warm.
import { EXERCISES, ExerciseEngine } from './engine.js';

// two exercises claiming the same movement: the set in progress wins, then this order (the more specific movement
// first: a jumping jack also raises the arms, a jump starts with a squat, squat pulses happen inside squats)
export const PRIORITY = ['jumping_jack', 'jump', 'squat', 'lunge', 'hinge', 'pushup', 'overhead_press', 'lateral_raise',
  'front_raise', 'triceps_kickback', 'biceps_curl', 'knee_raise', 'squat_pulse'];
const ARMS = new Set(['overhead_press', 'lateral_raise', 'front_raise', 'triceps_kickback', 'biceps_curl']);
const TAKEOFF = new Set(['squat', 'squat_pulse', 'lunge', 'hinge', 'knee_raise']);   // what a jump starts and lands with
const FLIGHT = new Set(['jump', 'jumping_jack']);
const ARB_MS = 700;           // reps of different exercises closer than this are one movement
const TAKEOFF_MS = 1200;      // a jump's peak comes up to 1.2 s after its take-off...
// ...and up to 1.1 s before its landing (2.2 s before a deadlift's "lockout": standing up after landing deep)
const landingMs = key => (key === 'hinge' ? 2200 : 1100);
// When a rep is decided, counted from its turning point. A rep of the set in progress wins against any rival, so it
// counts at once, except one that could be a jump's take-off or landing: it waits until the jump would have left the
// floor, and if the feet did leave the floor around it, until the jump is reported (peak <= 1.2 s, report <= 0.6 s
// after). Any other rep is decided once waiting longer could not change the outcome (`settled`: no rival can still
// claim it, and every rep before it is decided); rivals report up to ~2.2 s after their turning point (overhead press;
// push-ups 1.2 s, squats 1.1 s), so RIVAL_WAIT_MS is the most any rep waits, and a rep that would switch the set still
// waits it. Live, a fixed 3 s wait showed every set 3 s after its second rep; now a jumping jack is decided ~0.3 s after
// its turning point, a push-up ~0.7 s and a squat once the person stands up (~1.2 s).
const TAKEOFF_WAIT_MS = 1100;
const JUMP_WAIT_MS = 1900;
const PULSE_WAIT_MS = 2000;   // a pulse of the set in progress: until a squat or lunge around it is reported (up to ~1.6 s)
const RIVAL_WAIT_MS = 3000;
const SERIES = 4;             // pulse reports inside one squat-engine rep that make it a pulse series, not a squat
const LYING_MS = 2500;        // a squat-like rep this close to lying on the floor, with no standing between, is getting down or up
const GROUND = new Set(['squat', 'squat_pulse', 'lunge']);   // what getting down to or up from the floor looks like
const GAP_MS = 6000;          // reps further apart than this are not one set
// no rep of the set's exercise for this long: ask the user whether the set is done (live: a 13 s pause mid-set, and
// slow squats 7 s apart; a rep withdraws the question)
export const ASK_REST_MS = 8000;
// no rep of the set's exercise for this long, and no answer, ends the set (live: a 13 s pause mid-set); after "not
// yet", this long after the answer
export const REST_MS = 20000;
// a "done" this soon after another one ended a set is the same answer given twice: the user taps Done and says "yes",
// and the voice tool's call comes 2-3 s after the words (a set started on one rep meanwhile must not end with it)
const ECHO_MS = 6000;
const REST_MARGIN_MS = 3000;  // ...plus the time a rep can take to be reported and decided
const SWITCH_REST_MS = 3000;  // the set's exercise paused at least this long: another exercise takes over with K reps
const PAIR_MS = 500;          // the two arms of a two-arm rep (as the engine pairs them)
const BOUNCE_MS = 1500;       // a pulse this close to a squat or lunge with fewer than SERIES pulses is a bounce in it
// a detector still in a rep this long after its turn holds a position (arms kept forward after a squat), not a rep
// about to be reported: RIVAL_WAIT_MS was the most any rep outside a set waited for one to be reported
const REPORT_MS = RIVAL_WAIT_MS;
// K: reps of one exercise in a row before a set starts (arm movements are easy to make by accident)
export const repsToStart = ex => (ARMS.has(ex) ? 3 : ex === 'knee_raise' || ex === 'squat_pulse' ? 4 : 2);

// A set keeps a rhythm: talking with the hands (hand to chin, then twice to the chest: 4.1 s, then 0.8 s apart) does
// not. Arms taking turns can follow each other closely (right curl 0.6 s after the left, then 2.4 s to the next left):
// then it takes two more reps to see the rhythm: each arm's own, and the same offset between the arms every time.
// reps at a steady pace: no gap more than 2.5x another (2x for arm exercises, which hands make by accident)
const regular = (gaps, key) => gaps.length < 2 || Math.max(...gaps) <= (ARMS.has(key) ? 2 : 2.5) * Math.min(...gaps);
const gapsOf = (reps, step = 1) => reps.slice(step).map((c, i) => c.t - reps[i].t);
// one arm at a time, taking turns (a two-arm rep has no side of its own: which arm the engine reported first is chance)
const alternating = reps => reps.length > 1 && reps.every((c, i) => !c.pairs.length && c.event.side
  && (i === 0 || c.event.side !== reps[i - 1].event.side));
/** Can these reps in a row (all of them: they all count if a set starts) start a set of `key` (needing k)? 'yes',
 * 'no' (drop the oldest and look again) or 'wait'. */
function readiness(reps, key, k) {
  if (reps.length < k) return 'wait';
  const g = gapsOf(reps);
  if (regular(g, key)) return 'yes';
  if (!(EXERCISES[key]?.perArm && alternating(reps))) return 'no';
  if (reps.length < k + 2) return 'wait';
  // arms taking turns: each arm's own rhythm, and the same offset between the arms every time
  return regular(gapsOf(reps, 2), key) && g.every((x, i) => i < 2 || regular([x, g[i - 2]], key)) ? 'yes' : 'no';
}
/** How many reps in a row a run that is not ready yet needs (arms taking turns unevenly: two more, see readiness). */
const needOf = (reps, key, k) => (EXERCISES[key]?.perArm && alternating(reps) && !regular(gapsOf(reps), key) ? k + 2 : k);
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export class AutoTracker {
  constructor({ exercises = Object.keys(EXERCISES), engines = null, only = null } = {}) {
    // `engines` (exercise -> object with update/lost) replaces the real engines in tests
    this.engines = engines || Object.fromEntries(exercises.map(k => [k, new ExerciseEngine(k)]));
    if (only && !this.engines[only]) throw new Error(`unknown exercise ${only}`);
    this.only = only;         // the exercise the user named, or null: detect it
    this.switched = null;     // the set naming another exercise ended: `previous` of the next set_start
    this.doneAt = -Infinity;  // when "done" last ended a set (ECHO_MS)
    this.queue = [];          // candidate reps waiting to be decided
    this.recent = [];         // every candidate of the last few seconds (the rivals a candidate is compared with)
    this.legMoves = [];       // every squat or lunge turning point (counted or not), with its rep window
    this.pulses = [];         // every squat-pulse turning point the engine reported
    this.lastArm = {};        // per-arm exercises: the last counted arm rep {t, cand}, to pair the other arm with it
    this.feet = []; this.floor = NaN; this.floorAt = -Infinity; this.airborne = [];   // feet off the floor (jumps)
    this.lying = [];          // times the body was lying along the floor (push-up position) for 0.3 s or more
    this.standing = [];       // times the person stood tall (upright, knees and hips straight)
    this.flat = 0;            // consecutive horizontal frames
    this.pending = {};        // no set running: exercise -> its accepted reps in a row
    this.challengers = {};    // a set running: other exercise -> its reps since the set's last rep
    this.active = null;       // the set in progress
    this.sets = [];
    this.setNo = {};          // exercise -> sets so far
    this.vis = { legs: false, arms: false, torso: false };
    this.lastT = 0;
    this.finished = false;
  }

  update(f, t) {
    const out = [];
    this.lastT = t;
    this.vis = { legs: f.visLegs >= 0.6, arms: f.visArms >= 0.6, elbows: f.visElbows >= 0.6, torso: f.visTorso >= 0.6 };
    this.watchFeet(f, t);
    this.flat = f.posture === 'horizontal' ? this.flat + 1 : 0;          // (a frame or two of it is a flicker)
    if (this.flat >= 9) this.lying.push(t);
    if (f.posture === 'upright' && f.kneeMax > 150 && f.hipAvg > 150) this.standing.push(t);
    for (const list of [this.lying, this.standing]) while (list.length && list[0] < t - 15000) list.shift();
    for (const [key, eng] of Object.entries(this.engines)) {
      let cand = null;
      for (const e of eng.update(f, t)) cand = this.take(key, e, cand, out);
    }
    this.decide(t, out);
    return out;
  }

  lost(t) {
    const out = [];
    this.lastT = t;
    this.vis = { legs: false, arms: false, elbows: false, torso: false };
    for (const eng of Object.values(this.engines)) eng.lost(t);
    this.decide(t, out);
    return out;
  }

  /** End of the workout: decide the reps still waiting, close the open set, and summarise every set. Once only. */
  finish(t = this.lastT) {
    if (this.finished) return [];
    this.finished = true;
    const out = [];
    this.decide(Infinity, out);
    this.endSet('stop', t, out);
    out.push({ type: 'workout_summary', t, ...this.summary() });
    return out;
  }

  summary() {
    const sets = this.sets.map(s => ({ exercise: s.key, label: s.label, set: s.set, reps: s.count, partials: s.partials,
      startT: s.startT, endT: s.lastRepT }));
    const totals = {};
    for (const s of sets) {
      const x = totals[s.exercise] ??= { label: s.label, sets: 0, reps: 0 };
      x.sets += 1; x.reps += s.reps;
    }
    return { sets, totals };
  }

  current() {
    const a = this.active;
    return a && { exercise: a.key, label: a.label, set: a.set, count: a.count, perSide: a.perSide, asking: !!a.asking };
  }

  /** The user named the exercise (a key of EXERCISES), or 'auto' to detect it again. Returns the events this causes:
   * the set of another exercise ends (switch), and the reps of the named one seen just before start its set. */
  setExercise(key, now = this.lastT) {
    if (key !== 'auto' && !this.engines[key]) throw new Error(`unknown exercise ${key}`);
    const only = key === 'auto' ? null : key, was = this.only, out = [];
    if (this.finished || only === was) return out;
    this.only = only;
    // what auto mode was holding back is either counted now or no longer applies (rivals, runs, challengers)
    const a = this.active;
    const run = !only ? null : a ? (a.key === only ? null : this.challengers[only]) : this.pending[only];
    this.pending = {}; this.challengers = {};
    if (!only) return out;                                  // detect again: the set in progress goes on
    // the reps of it seen just before were the user doing it (no rep is lost while the question was open), unless a
    // rest's worth of time has passed since
    const carried = run?.length && now - run.at(-1).t <= REST_MS ? run : [];
    if (a && a.key !== only) {
      // its last reps were done before the user named another exercise (a squat waits to see the person stand up)
      a.asking = false;
      this.settle(a, was === a.key, out);
      // (kept until a set starts: naming a third exercise, or 'auto', before the named one's first rep must not lose it,
      // as the page announces a switch with the next set)
      this.switched = { exercise: a.key, label: a.label, set: a.set, reps: a.count };
      this.endSet('switch', now, out);
    }
    // its reps still waiting are decided now (nothing can claim them any more); no other exercise's rep counts
    this.queue = this.queue.filter(c => c.key === only);
    for (const c of this.queue) { c.due = c.t; c.early = false; c.after = undefined; }
    if (carried.length) this.startSet(only, carried, out, this.switched);
    this.decide(now, out);
    return out;
  }

  /** The user's answer to set_end_pending, or a "done" said unasked. Returns the events: done ends the set in progress
   * (confirmed); not done keeps the asked-about set open (not asked again until its next rep). */
  answerSetEnd(done, now = this.lastT) {
    // (a voice tool's argument may arrive as a string: "false" must not end the set)
    if (typeof done !== 'boolean') throw new TypeError(`done must be true or false, not ${JSON.stringify(done)}`);
    const a = this.active, out = [];
    if (!a || this.finished) return out;
    if (!done) {
      // only an open question takes it: "not yet, one more" and the rep, counted before the voice answer comes (2-3 s
      // later), already kept the set going, and it is asked about after its next rest as usual. The rest still ends
      // the set, counted from the answer: a misheard or forgotten "not yet" must not join the next set to this one
      if (a.asking) { a.asking = false; a.notYetT = now; }
      return out;
    }
    if (!a.asked && now - this.doneAt < ECHO_MS) return out;   // the "done" that ended the set before this one, again
    a.asking = false;
    this.settle(a, !!this.only, out);
    this.doneAt = now;
    this.endSet('confirmed', now, out);
    return out;
  }

  /** The set ends now: its reps still being decided (a squat waits for a possible jump, or to see the person stand
   * up) were done before, so they count, unless a rival beats them (`named`: nothing claims them). */
  settle(a, named, out) {
    const left = this.queue.filter(c => c.key === a.key).sort((x, y) => x.t - y.t);
    this.queue = this.queue.filter(c => !left.includes(c));
    for (const c of left) if (named || !this.beaten(c)) this.addRep(a, c, out, false);
  }

  /** Feet off the floor: the lower foot 0.15 body lengths above its usual height (the median of the last 3 s: short,
   * so a step forward or back moves the floor with the person; jumping, the feet are still down most of the time). */
  watchFeet(f, t) {
    if (!Number.isFinite(f.ankleYImg) || !Number.isFinite(f.scale)) return;
    this.feet.push({ t, y: f.ankleYImg });
    while (this.feet[0].t < t - 3000) this.feet.shift();
    if (!(t - this.floorAt < 500)) { this.floor = median(this.feet.map(x => x.y)); this.floorAt = t; }
    if ((this.floor - f.ankleYImg) / f.scale >= 0.15) this.airborne.push(t);       // (image y grows downwards)
    while (this.airborne.length && this.airborne[0] < t - 15000) this.airborne.shift();
  }

  // --- one engine event --------------------------------------------------------------------------------------------
  take(key, e, cand, out) {
    const win = { from: e.metrics?.durationMs ? this.lastT - e.metrics.durationMs : e.t - 1500, to: this.lastT };   // rep window
    if ((key === 'squat' || key === 'lunge') && (e.type === 'rep' || e.type === 'partial')) this.legMoves.push({ t: e.t, ...win });
    if (key === 'squat_pulse' && e.type === 'rep') this.pulses.push(e.t);
    if (this.only && key !== this.only) return cand;       // another exercise was named: this one only keeps watching
    const named = this.only === key;
    if (e.type === 'rep') {
      const perArm = EXERCISES[key]?.perArm;
      // (a named exercise: what its engine counts, as long as the tracking held together. With one rep starting a set,
      // that keeps walking up to the laptop from starting one; no rep of the clips or live sets was unstable.)
      const ok = e.stable && (named || e.distinct);
      if (e.counted === false) {
        // the other arm of a two-arm rep: one rep with the first. Its form events go with the first arm's rep if that
        // one is a candidate; if the first arm was not one, this arm can stand for the rep instead.
        const first = this.lastArm[key];
        if (!first || Math.abs(first.t - e.t) >= PAIR_MS) return ok ? null : { rejected: true, extras: [] };
        if (first.cand) {
          if (!ok) return { rejected: true, extras: [] };
          const a = this.active;
          if (first.cand.added && a === first.cand.added) {    // the first arm is already in the set: add this arm now
            if (e.side) a.perSide[e.side] = (a.perSide[e.side] || 0) + 1;
            for (const fl of e.faults || []) a.faults[fl.code] = (a.faults[fl.code] || 0) + 1;
            return null;                                       // its form events go out as the set's own
          }
          first.cand.pairs.push({ side: e.side, faults: e.faults || [] });
          return first.cand;
        }
        first.cand = undefined;                    // fall through, once: judged as the rep itself
        if (!ok) return { rejected: true, extras: [] };
      } else if (!ok) {
        // a candidate only if the tracking held together and the movement is this exercise's own (posture included:
        // only push-ups are done lying down). What the engine says about a rep that is not one is dropped with it.
        if (perArm) this.lastArm[key] = { t: e.t, cand: null };
        return { rejected: true, extras: [] };
      }
      const now = this.active?.key === key;
      // (a rep of a named exercise has no rival to wait for: decided in this frame, after the events said about it)
      const wait = named ? 0 : !now ? RIVAL_WAIT_MS : key === 'squat_pulse' ? PULSE_WAIT_MS : TAKEOFF.has(key) ? TAKEOFF_WAIT_MS : 0;
      const c = { key, t: e.t, due: e.t + wait, early: !now && !named, event: e, extras: [], pairs: [], ...win };
      if (now && !named) this.asBefore(c, this.active);
      if (perArm && e.counted !== false) this.lastArm[key] = { t: e.t, cand: c };
      this.queue.push(c); this.recent.push(c);
      return c;
    }
    if (!['cue', 'fixed', 'praise', 'partial', 'visibility'].includes(e.type)) return cand;
    // not this exercise (or, named, not tracked well enough): say nothing
    if (e.type === 'partial' && !(named ? (e.stable ?? e.distinct) : e.distinct)) return { rejected: true, extras: [] };
    if (cand) { cand.extras.push(e); return cand; }        // said about this rep: goes out with it, if it counts
    const a = this.active;
    if (a && a.key === key && e.t >= a.startT) this.forward(e, a, out);
    // a named exercise between its sets: a rep not deep enough to count, and what the camera cannot see, still matter
    // (no set to tag them with; "fixed" refers to a cue of a set, and praise is the set's own)
    else if (named && !a && ['partial', 'cue', 'visibility'].includes(e.type)) out.push({ ...e, exercise: key, label: EXERCISES[key].label });
    return cand;
  }

  /** Pass one of the set's coaching events on: a "fixed" only for a fault (of that arm) that was cued in this set; the
   * engine's own praise is not used (its clean streak counts reps auto mode did not count, and earlier sets). */
  forward(e, a, out) {
    const code = `${e.code}|${e.side || ''}`;
    if (e.type === 'praise') return;
    if (e.type === 'fixed') { if (!a.cued.has(code)) return; a.cued.delete(code); }
    if (e.type === 'cue') a.cued.add(code);
    if (e.type === 'partial') a.partials += 1;
    out.push(this.tag(e, a));
  }

  tag(e, a) { return { ...e, exercise: a.key, label: a.label, set: a.set, reps: a.count }; }

  // --- deciding candidates -----------------------------------------------------------------------------------------
  decide(now, out) {
    const horizon = Number.isFinite(now) ? now : this.lastT;
    this.recent = this.recent.filter(c => horizon - c.t < 8000);
    this.legMoves = this.legMoves.filter(x => horizon - x.to < 8000);
    this.pulses = this.pulses.filter(x => horizon - x < 15000);
    // the frame a set that started early would have started in (see asBefore)
    for (const s of this.sets) if (s.lateFrame === undefined && now >= s.lateStart) s.lateFrame = now;
    // every rep that is due, in the order the reps happened (one waiting longer must not hold up the others). A rep
    // waiting for rivals is decided early only when no earlier rep is still waiting, so reps are decided in the order
    // they happened, as when every rep outside a set waited the full time (a live set: a knee raise decided before the
    // one 0.9 s earlier made the run look irregular, and no set started; squats joined into jumping jacks: a squat of
    // the set in progress decided after the first jack had been taken as a challenger cleared it, losing a jack)
    const due = [];
    let held = false;
    for (const c of [...this.queue].sort((x, y) => x.t - y.t)) {
      if (c.due <= now && (!c.after || !Number.isFinite(now) || now > c.after.lateFrame)) due.push(c);
      else if (c.early && !held && this.settled(c, now)) due.push(c);
      else held = true;
    }
    if (due.length) this.queue = this.queue.filter(c => !due.includes(c));
    // the reps after an earlier one that went back to waiting, or after a set started or switched in this pass (the
    // rankings and runs they were judged against changed), that were only settled: judged again in the next frame
    let requeued = false;
    const active = this.active;
    for (const c of due) {
      if ((requeued || this.active !== active) && c.due > now) {
        if (c.early && this.active?.key === c.key) this.joinSet(c, this.active);     // a rep of the new set now
        this.queue.push(c); continue;
      }
      const n = this.queue.length;
      this.decideOne(c, now, out);
      if (this.queue.length > n) requeued = true;
    }
    // the set's exercise has rested: ask (once) whether the set is done, and with no answer end it after REST_MS as
    // before. Not while a rep of it is being decided or under way (slow squats: asked on the way down, then withdrawn);
    // never after the user said it is not done, until its next rep (the rest then counts from the answer).
    const a = this.active;
    if (!a || !Number.isFinite(now) || this.queue.some(q => q.key === a.key)) return;
    if (now - Math.max(a.lastRepT, a.notYetT ?? -Infinity) > REST_MS + REST_MARGIN_MS) this.endSet('rest', now, out);
    else if (!a.asking && a.notYetT === undefined && now - a.lastRepT > ASK_REST_MS && !this.inRep(a, now)) {
      a.asking = true; a.asked = true;
      out.push({ type: 'set_end_pending', exercise: a.key, label: a.label, set: a.set, reps: a.count, t: now });
    }
  }

  /** Is the set's engine in the middle of a rep that turned after the set's last one (as pendingTurns says; one still
   * held REPORT_MS after its turn is a position held, not a rep about to be reported)? */
  inRep(a, now) {
    return (this.engines[a.key].pendingTurns?.() || []).some(p => p > a.lastRepT && now - p < REPORT_MS);
  }

  /** One rep that is due: wait some more (put back in the queue), or accept it unless a rival beats it. */
  decideOne(c, now, out) {
    if (this.only) {             // the user named it: nothing claims its reps, and its first one starts a set
      if (this.active) this.addRep(this.active, c, out, false); else this.startSet(c.key, [c], out, this.switched);
      return;
    }
    // a take-off or landing of the set in progress with the feet off the floor around it: wait for the jump; and a
    // jump around it that is still waiting to be decided is waited for too (a jump after a squat set waits longer)
    // a squat or lunge of the set in progress waits until the person stands up again (or long enough to know they
    // went down to the floor instead), so getting down for push-ups is not counted as a squat
    if (Number.isFinite(now) && (c.key === 'squat' || c.key === 'lunge') && this.active?.key === c.key
      && now - c.t < LYING_MS && !this.standing.some(x => x > c.t)) {
      c.due = now + 50; this.queue.push(c);
      return;
    }
    if (Number.isFinite(now) && TAKEOFF.has(c.key)) {
      if (!c.waitedForJump && c.due - c.t < JUMP_WAIT_MS && this.airborne.some(x => x > c.t - landingMs(c.key) && x <= now)) {
        c.waitedForJump = true; c.due = c.t + JUMP_WAIT_MS; this.queue.push(c);
        return;
      }
      const jump = this.queue.filter(q => FLIGHT.has(q.key) && q.t - c.t > -landingMs(c.key) && q.t - c.t < TAKEOFF_MS);
      if (jump.length) { c.due = Math.max(...jump.map(q => q.due)); this.queue.push(c); return; }
    }
    if (!this.beaten(c)) this.accept(c, out, now);
  }

  rank(key) { return key === this.active?.key ? -1 : PRIORITY.indexOf(key); }

  /** Can this rep (one that is not of the set in progress) be decided before RIVAL_WAIT_MS, with the outcome that
   * wait gave? Two things decided the outcome then: what beats it, and the order reps were decided in.
   * - Whatever could beat it (`beaten`) must turn inside a window around it: that time must have passed, and no rival
   *   engine may be in the middle of a rep turning inside it (a turn outside can only move later, out of the window).
   * - A rep of any exercise that turned before it and is still in progress is decided first (reps outside a set were
   *   decided in the order they happened; accepting one can clear another), unless this rep beats it anyway.
   * Engines say which reps they are in the middle of (`pendingTurns`). A jump also needs the feet off the floor at its
   * peak (its `distinct`; as for a take-off of the set in progress): after a squat, the jump detector holds standing
   * up as a possible peak until the next squat. An earlier rep whose detector is still in it REPORT_MS after its turn
   * holds a position (arms kept forward after a squat) and is not waited for (a rival that could beat this rep is, up
   * to RIVAL_WAIT_MS, as before). A squat or lunge also waits until the person stands up (or long enough to know they
   * got down to the floor instead), one arm of a two-arm rep for the other arm, and a pulse until a squat or lunge
   * around it is reported unless it is already a bounce in one. An engine that cannot say (scripted engines in tests)
   * is waited for. */
  settled(c, now) {
    // a bounce at the bottom of a squat already reported is beaten whatever else turns up (its pulses are reported
    // before the squat: both count on the knee, a pulse at a smaller rise), so it need not hold up the squat
    if (this.bounce(c)) return true;
    const takeoff = TAKEOFF.has(c.key);
    if (takeoff && now - c.t < TAKEOFF_MS) return false;          // a jump's peak comes up to 1.2 s after its take-off
    // a jump around it that is reported but still undecided: decided first (decideOne would put it back to wait)
    if (takeoff && this.queue.some(q => FLIGHT.has(q.key) && q.t - c.t > -landingMs(c.key) && q.t - c.t < TAKEOFF_MS)) return false;
    if (GROUND.has(c.key) && now - c.t < LYING_MS && !this.standing.some(x => x > c.t)) return false;
    if (c.key === 'squat_pulse' && now - c.t < PULSE_WAIT_MS) return false;
    if (EXERCISES[c.key]?.perArm && now - c.t < PAIR_MS) return false;      // the other arm of a two-arm rep
    // while jumps are being done, a jump detector in a rep is a jump (the feet-off-the-floor check is for one holding
    // standing up as its peak; with the feet in the air half the time, the floor it measures from is not reliable)
    const jumping = this.active?.key === 'jump' || this.recent.some(d => d.key === 'jump');
    for (const [k, eng] of Object.entries(this.engines)) {
      // the window around it in which a rep of k would beat it (or, for a pulse, make it a bounce)
      const jumpWindow = FLIGHT.has(k) && takeoff;
      const bounceWindow = c.key === 'squat_pulse' && (k === 'squat' || k === 'lunge');
      const rival = k !== c.key && !(FLIGHT.has(c.key) && TAKEOFF.has(k))  // a take-off or landing never beats a jump
        && (jumpWindow || bounceWindow || this.rank(k) < this.rank(c.key));
      const lo = jumpWindow ? landingMs(c.key) : bounceWindow ? BOUNCE_MS : ARB_MS;
      const hi = jumpWindow ? TAKEOFF_MS : bounceWindow ? BOUNCE_MS : ARB_MS;
      if (rival && now - c.t <= hi) return false;                 // it could still turn inside the window
      const turns = eng.pendingTurns?.();
      if (!turns) return false;
      for (const p of turns) {
        if (k === 'jump' && !jumping && !this.flew(p)) continue;  // feet never left the floor: not a jump
        if (k === c.key && Math.abs(p - c.t) < PAIR_MS) return false;        // the other arm of the same rep
        if (rival && p >= c.t - lo && p <= c.t + hi) return false;           // a rival that may beat it
        // an earlier rep: decided first, unless this one beats it anyway or it is a position held (REPORT_MS)
        if (p < c.t && now - p < REPORT_MS && !this.beats(c, k, p)) return false;
      }
    }
    // a pulse that would beat it, while a squat or lunge around that pulse may still be reported: that would make the
    // pulse a bounce, which beats nothing (`beaten` skips it)
    for (const d of this.recent) {
      if (d.key !== 'squat_pulse' || d.key === c.key || Math.abs(d.t - c.t) > ARB_MS
        || !(this.rank(d.key) < this.rank(c.key)) || this.bounce(d)) continue;
      if (now - d.t <= BOUNCE_MS) return false;
      for (const k of ['squat', 'lunge']) {
        const turns = this.engines[k].pendingTurns?.();
        if (!turns || turns.some(p => Math.abs(p - d.t) < BOUNCE_MS)) return false;
      }
    }
    return true;
  }

  /** Would rep c beat a rep of exercise k turning at p, so that rep can never count (`beaten` with c as the rival)? */
  beats(c, k, p) {
    if (k === c.key) return false;
    const peakAfter = FLIGHT.has(c.key) && TAKEOFF.has(k) ? c.t - p : FLIGHT.has(k) && TAKEOFF.has(c.key) ? p - c.t : NaN;
    if (peakAfter > -landingMs(TAKEOFF.has(k) ? k : c.key) && peakAfter < TAKEOFF_MS) return TAKEOFF.has(k);
    if (c.key === 'squat_pulse' && (k === 'squat' || k === 'lunge')) return false;   // a pulse never beats a squat
    return Math.abs(c.t - p) <= ARB_MS && this.rank(c.key) < this.rank(k);
  }

  /** Feet off the floor around a jump's possible peak (its `distinct` needs them clearly off the floor there). */
  flew(p) { return this.airborne.some(x => x >= p - 600 && x <= p + 600); }

  /** A bounce or two at the bottom of a squat or lunge is not a squat pulse; pulses in a series are (the squat engine
   * sees a whole series, down, pulses and up, as one squat whose turning point is the deepest pulse). */
  bounce(c) {
    if (c.key !== 'squat_pulse') return false;
    return this.legMoves.some(m => Math.abs(m.t - c.t) < BOUNCE_MS && this.pulsesIn(m) < SERIES);
  }

  pulsesIn(w) { return this.pulses.filter(p => p >= w.from && p <= w.to).length; }

  beaten(c) {
    if (this.bounce(c)) return true;
    // getting down to the floor (crouch, then legs back into the plank) or up from it is not a squat (live: a squat
    // "set" of 2 while getting into position for push-ups): lying shortly after it with no standing up in between, or
    // shortly before it with no standing in between. A squat that ended standing before getting down is a squat.
    if (GROUND.has(c.key)) {
      const stoodBetween = (a, b) => this.standing.some(x => x > a && x < b);
      if (this.lying.some(x => x > c.t && x - c.t < LYING_MS && !stoodBetween(c.t, x))) return true;
      if (this.lying.some(x => x < c.t && c.t - x < LYING_MS && !stoodBetween(x, c.t))) return true;
    }
    // and that one "squat" around a whole series of pulses is the series, not a squat
    if ((c.key === 'squat' || c.key === 'lunge') && this.pulsesIn(c) >= SERIES) return true;
    for (const d of this.recent) {
      if (d.key === c.key || this.bounce(d)) continue;          // a rival that is itself not a rep does not count
      // a jump and the squat (hip hinge, knee drive) on either side of it: the take-off before the peak and the landing
      // after it belong to the jump, whatever set is in progress (squats, then squat jumps)
      const peakAfter = FLIGHT.has(d.key) && TAKEOFF.has(c.key) ? d.t - c.t : FLIGHT.has(c.key) && TAKEOFF.has(d.key) ? c.t - d.t : NaN;
      const ground = TAKEOFF.has(c.key) ? c.key : d.key;
      if (peakAfter > -landingMs(ground) && peakAfter < TAKEOFF_MS) {
        if (TAKEOFF.has(c.key)) return true;
        continue;
      }
      if (d.key === 'squat_pulse' && (c.key === 'squat' || c.key === 'lunge')) continue;   // a pulse never beats a squat
      if (Math.abs(d.t - c.t) <= ARB_MS && this.rank(d.key) < this.rank(c.key)) return true;
    }
    return false;
  }

  accept(c, out, now = this.lastT) {
    const a = this.active;
    if (a && a.key === c.key) { this.challengers = {}; this.addRep(a, c, out, false); return; }
    if (a) {
      // another exercise during a set: it takes over after K reps in a row with none of the set's exercise between
      // (one more if the set's exercise had not paused first, so one misread movement cannot split a set)
      if (c.t < a.lastRepT) return;              // the set's exercise came after it (decided later: it waited longer)
      let ch = this.challengers[c.key] || [];
      if (ch.length && c.t - ch.at(-1).t > GAP_MS) ch = [];
      const need = repsToStart(c.key) + ((ch[0] ?? c).t - a.lastRepT >= SWITCH_REST_MS ? 0 : 1);
      // the rep that would switch sets is decided when every rep outside a set was (RIVAL_WAIT_MS after it), so a rep
      // of the set's exercise reported meanwhile still cancels the switch, as it did then (a switch shows after 3 s)
      if (c.early && Number.isFinite(now) && now < c.t + RIVAL_WAIT_MS && this.ready([...ch, c], c.key, need)) {
        c.early = false; c.due = c.t + RIVAL_WAIT_MS; this.queue.push(c);
        return;
      }
      ch.push(c); this.challengers[c.key] = ch;
      if (this.ready(ch, c.key, need)) {
        const previous = { exercise: a.key, label: a.label, set: a.set, reps: a.count };
        this.endSet('switch', ch[0].t, out);
        this.startSet(c.key, ch, out, previous);
      } else this.tentative(c, ch.length, needOf(ch, c.key, need), true, out);
      return;
    }
    let p = this.pending[c.key] || [];
    if (p.length && c.t - p.at(-1).t > GAP_MS) p = [];
    p.push(c); this.pending[c.key] = p;
    // (`switched`: the user named an exercise, ending a set, then went back to detecting before its first rep)
    if (this.ready(p, c.key, repsToStart(c.key))) this.startSet(c.key, p, out, this.switched);
    else this.tentative(c, p.length, needOf(p, c.key, repsToStart(c.key)), false, out);
  }

  /** A rep of an exercise that has no set yet, said at once (live: one rep, then nothing on screen until the next);
   * from halfway for the exercises that need 3-4 reps, which a single stray movement makes (a squat "pulse" bending
   * down to the laptop, a hand raised). */
  tentative(c, count, need, switching, out) {
    if (2 * count < need) return;
    out.push({ type: 'tentative', exercise: c.key, label: EXERCISES[c.key].label, count, need, t: c.t, ...(switching ? { switching } : {}) });
  }

  /** Enough steady reps in a row (dropping the oldest while the run is irregular)? */
  ready(reps, key, k) {
    for (;;) {
      const r = readiness(reps, key, k);
      if (r !== 'no') return r === 'yes';
      reps.shift();
      if (reps.length < 2) return false;
    }
  }

  startSet(key, reps, out, previous) {
    const set = this.setNo[key] = (this.setNo[key] || 0) + 1;
    const a = { key, label: EXERCISES[key].label, set, count: 0, partials: 0, startT: reps[0].t, lastRepT: reps[0].t,
      faults: {}, perSide: {}, cued: new Set() };
    this.active = a; this.sets.push(a);
    this.pending = {}; this.challengers = {}; this.switched = null;
    // when the set would have started had its last rep waited RIVAL_WAIT_MS (see asBefore)
    a.lateStart = reps.at(-1).t + RIVAL_WAIT_MS;
    if (this.lastT >= a.lateStart) a.lateFrame = this.lastT;          // not early: it starts in this frame either way
    // reps of it still waiting are now reps of the set in progress: decided as such (a named exercise's at once)
    if (!this.only) for (const q of this.queue) if (q.key === key) this.joinSet(q, a);
    out.push({ type: 'set_start', exercise: key, label: a.label, set, count: reps.length, t: reps.at(-1).t,
      ...(previous ? { previous } : {}) });
    reps.forEach((c, i) => this.addRep(a, c, out, i < reps.length - 1));
    // a cue the engine raised on one of the earlier reps (now counted) is said now: the engine will not repeat it
    // for a while (cooldown), and a later "fixed" refers to it
    const cue = reps.slice(0, -1).flatMap(c => c.extras).filter(x => x.type === 'cue').at(-1);
    if (cue && !reps.at(-1).extras.some(x => x.type === 'cue')) this.forward(cue, a, out);
  }

  /** A rep of the set's exercise still waiting when the set starts: now a rep of the set in progress. */
  joinSet(q, a) {
    q.early = false;
    q.due = Math.min(q.due, q.t + (TAKEOFF.has(q.key) ? TAKEOFF_WAIT_MS : 0));
    this.asBefore(q, a);
  }

  /** A rep of a set that started early, reported before the set would have started had its last rep waited
   * RIVAL_WAIT_MS: if a jump or a squat around it can still claim it (a take-off or landing, a pulse), it is decided as
   * then: the take-off wait from its turn, not before that time (the set's own reps that nothing can claim count at
   * once). Otherwise pulse clips joined into squats lost a pulse, and knee raises before step jacks gained one. */
  asBefore(c, a) {
    // (that set started in decide(), after the frame's reps were taken: a rep taken in that frame was not yet in it,
    // and the reps waiting then were decided from the next frame on)
    if (!TAKEOFF.has(c.key) || a.lateFrame !== undefined) return;
    c.due = c.t + TAKEOFF_WAIT_MS; c.after = a;
  }

  addRep(a, c, out, backfill) {
    // a rep of the set while the user is being asked whether it is done: the question is withdrawn; and after "not
    // yet", the set is asked about (and can rest) again from this rep on
    if (!backfill && a.asking) out.push({ type: 'set_end_cancelled', exercise: a.key, label: a.label, set: a.set, reps: a.count, t: c.t });
    if (!backfill) { a.asking = false; a.notYetT = undefined; }
    a.count += 1; a.lastRepT = Math.max(a.lastRepT, c.t); c.added = a;
    const e = c.event, arms = [{ side: e.side, faults: e.faults || [] }, ...c.pairs];
    for (const arm of arms) {
      for (const fl of arm.faults) a.faults[fl.code] = (a.faults[fl.code] || 0) + 1;
      if (arm.side) a.perSide[arm.side] = (a.perSide[arm.side] || 0) + 1;
    }
    out.push({ ...this.tag(e, a), type: 'rep', counted: true, count: a.count, ...(backfill ? { backfill: true } : {}) });
    if (!backfill) for (const x of c.extras) this.forward(x, a, out);   // the cue this rep raised, if any
    // praise from auto mode's own counting: every 5th clean rep in a row of this set
    a.clean = arms.some(arm => arm.faults.length) ? 0 : (a.clean || 0) + 1;
    if (!backfill && a.clean > 0 && a.clean % 5 === 0) out.push(this.tag({ type: 'praise', t: c.t, count: a.count }, a));
  }

  endSet(reason, t, out) {
    const a = this.active;
    if (!a) return;
    // after a rest (or the user saying the set is done), the reps of another exercise seen meanwhile carry over (the
    // next one in a row can start its set)
    this.active = null; this.pending = reason === 'rest' || reason === 'confirmed' ? this.challengers : {}; this.challengers = {};
    out.push({ type: 'set_end', exercise: a.key, label: a.label, set: a.set, reps: a.count, partials: a.partials,
      faults: a.faults, perSide: a.perSide, reason, t });
  }
}
