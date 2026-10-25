// Auto mode's decisions (web/js/auto.js) with scripted engines: which exercise a rep belongs to, when sets start, end
// and switch. The engines' own rep detection is covered by engine.test.mjs and tools/auto_eval.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoTracker, ASK_REST_MS, REST_MS } from '../web/js/auto.js';

const KEYS = ['jumping_jack', 'jump', 'squat', 'lunge', 'hinge', 'pushup', 'overhead_press', 'lateral_raise', 'front_raise',
  'triceps_kickback', 'biceps_curl', 'knee_raise', 'squat_pulse'];
const rep = (t, extra = {}) => ({ type: 'rep', t, counted: true, distinct: true, stable: true, posture: 'upright', faults: [],
  metrics: { extreme: 1, durationMs: 1000 }, ...extra });

/** Run scripted engine events: script = [[exercise, emitAtMs, event], ...]; frames every 100 ms up to endMs.
 * `air`: [fromMs, toMs] spans with both feet off the floor; `bent`: spans not standing up straight. `pending` (exercise -> now => turning point or null): the
 * engines say whether they are in the middle of a rep, so reps need not wait the full time for rivals; without it
 * they cannot say, and every rep waits. `only`: the exercise the user named. `actions`: [frame time, auto => events]
 * run after that frame's update (the user's answers). `when`: [frame time, event] for each event. */
function run(script, endMs, { finish = true, air = [], lying = [], bent = [], pending = null, only = null, actions = [] } = {}) {
  let now = 0;
  const engines = Object.fromEntries(KEYS.map(k => [k, {
    update: (f, t) => script.filter(([x, at]) => x === k && at === t).map(([, , ev]) => ev), lost() {},
    ...(pending ? { pendingTurns: () => { const p = pending[k]?.(now); return p == null ? [] : Array.isArray(p) ? p : [p]; } } : {}),
  }]));
  const auto = new AutoTracker({ engines, only });
  const out = [], when = [];
  for (let t = 0; t <= endMs; t += 100) {
    now = t;
    const up = air.some(([a, b]) => t >= a && t <= b);
    const down = lying.some(([a, b]) => t >= a && t <= b), notUp = bent.some(([a, b]) => t >= a && t <= b);
    const evs = auto.update({ visLegs: 1, visArms: 1, visTorso: 1, scale: 0.2, ankleYImg: up ? 0.7 : 0.8,
      posture: down ? 'horizontal' : 'upright', kneeMax: notUp ? 140 : 170, hipAvg: notUp ? 140 : 170 }, t);   // standing between reps
    for (const [at, act] of actions) if (at === t) evs.push(...act(auto, t));
    out.push(...evs); for (const e of evs) when.push([t, e]);
  }
  if (finish) out.push(...auto.finish(endMs));
  const sets = auto.sets.map(s => `${s.key}#${s.set}=${s.count}`);
  return { out, sets, auto, when };
}
// a rep whose turning point is at t, reported by the engine 300 ms later (as the detectors do)
const at = (ex, t, extra, lat = 300) => [ex, t + lat, rep(t, extra)];

test('one squat is not a set; two in a row start one and both count', () => {
  assert.deepEqual(run([at('squat', 1000)], 30000).sets, []);
  const r = run([at('squat', 1000), at('squat', 3500), at('squat', 6000)], 30000);
  assert.deepEqual(r.sets, ['squat#1=3']);
  const start = r.out.find(e => e.type === 'set_start');
  assert.equal(start.count, 2);
  assert.deepEqual(r.out.filter(e => e.type === 'rep').map(e => [e.count, !!e.backfill]), [[1, true], [2, false], [3, false]]);
});

test('arm exercises need three reps in a steady rhythm', () => {
  assert.deepEqual(run([at('biceps_curl', 1000), at('biceps_curl', 3000)], 30000).sets, []);
  assert.deepEqual(run([at('biceps_curl', 1000), at('biceps_curl', 3000), at('biceps_curl', 5000)], 30000).sets, ['biceps_curl#1=3']);
  // hand to the chin, then twice to the chest: 4.1 s then 0.8 s apart
  assert.deepEqual(run([at('biceps_curl', 1000), at('biceps_curl', 5100), at('biceps_curl', 5900)], 30000).sets, []);
});

test('reps of a non-exercise that are not distinct or not stable never count', () => {
  const r = run([at('squat', 1000, { distinct: false }), at('squat', 3000, { stable: false }), at('squat', 5000, { counted: false })], 30000);
  assert.deepEqual(r.sets, []);
});

test('alternating push-ups and squats: sets per exercise, switches announced with the previous set', () => {
  const s = [];
  for (let i = 0; i < 4; i += 1) s.push(at('pushup', 1000 + i * 2000));          // push-ups 1-4
  for (let i = 0; i < 3; i += 1) s.push(at('squat', 10000 + i * 2500));         // squats right after (no 3 s pause)
  for (let i = 0; i < 3; i += 1) s.push(at('pushup', 20000 + i * 2000));        // push-ups again
  const r = run(s, 40000);
  assert.deepEqual(r.sets, ['pushup#1=4', 'squat#1=3', 'pushup#2=3']);
  const starts = r.out.filter(e => e.type === 'set_start');
  assert.deepEqual(starts.map(e => e.previous?.exercise ?? null), [null, 'pushup', 'squat']);
  assert.deepEqual(r.out.filter(e => e.type === 'set_end').map(e => e.reason), ['switch', 'switch', 'stop']);
});

test('one misread rep in the middle of a set does not end it', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('lunge', 6000), at('squat', 8500), at('lunge', 11000), at('squat', 13500)];
  assert.deepEqual(run(s, 40000).sets, ['squat#1=4']);
});

test('a long rest ends the set; the same exercise afterwards is set 2', () => {
  const r = run([at('squat', 1000), at('squat', 3500), at('squat', 40000), at('squat', 42500)], 60000);
  assert.deepEqual(r.sets, ['squat#1=2', 'squat#2=2']);
  assert.equal(r.out.find(e => e.type === 'set_end').reason, 'rest');
});

test('two exercises claiming one movement: the more specific one wins, and the set in progress wins over both', () => {
  // a jumping jack also raises the arms (lateral raise) and lifts the knees a little
  const jj = [0, 1, 2].flatMap(i => [at('jumping_jack', 1000 + i * 1000), at('lateral_raise', 1100 + i * 1000)]);
  assert.deepEqual(run(jj, 30000).sets, ['jumping_jack#1=3']);
  // squats in progress: a lunge-looking rep at the same moment stays a squat
  const sq = [at('squat', 1000), at('squat', 3500), at('squat', 6000), at('lunge', 6100)];
  assert.deepEqual(run(sq, 30000).sets, ['squat#1=3']);
});

test('the squat before each jump is the take-off, not a squat', () => {
  const s = [0, 1, 2].flatMap(i => [at('squat', 1000 + i * 2000), at('jump', 1500 + i * 2000)]);
  assert.deepEqual(run(s, 30000).sets, ['jump#1=3']);
});

test('bounces at the bottom of a squat are not squat pulses', () => {
  const s = [];
  for (let i = 0; i < 4; i += 1) { s.push(at('squat', 1000 + i * 2500)); s.push(at('squat_pulse', 1900 + i * 2500)); }
  assert.deepEqual(run(s, 30000).sets, ['squat#1=4']);
});

test("only the current exercise's coaching reaches the page, tagged with exercise and set", () => {
  const cue = t => ({ type: 'cue', code: 'shallow', message: 'Go deeper', t });
  const s = [at('squat', 1000), at('squat', 3500), ['squat', 3800, cue(3800)], at('squat', 6000),
    ['squat', 6300, cue(6300)], ['biceps_curl', 6300, cue(6300)]];
  const cues = run(s, 30000).out.filter(e => e.type === 'cue');
  assert.deepEqual(cues.map(e => [e.exercise, e.set]), [['squat', 1], ['squat', 1]]);
});

test('finish closes the open set and sums every exercise', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('pushup', 30000), at('pushup', 32000), at('pushup', 34000)];
  const last = run(s, 40000).out.at(-1);
  assert.equal(last.type, 'workout_summary');
  assert.deepEqual(last.totals, { squat: { label: 'Squat', sets: 1, reps: 2 }, pushup: { label: 'Push-up', sets: 1, reps: 3 } });
});

// --- review of auto mode (2026-10-23) ----------------------------------------------------------------------------
test('squats, then squat jumps: each jump take-off and landing belongs to the jump, and the jumps take over', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000)];
  for (let i = 0; i < 6; i += 1) {
    s.push(at('squat', 10000 + i * 2000));                        // take-off
    s.push(at('jump', 10500 + i * 2000, {}, 400));                // peak, reported on landing
    s.push(at('squat', 11200 + i * 2000));                        // landing, after the peak
  }
  assert.deepEqual(run(s, 40000).sets, ['squat#1=3', 'jump#1=6']);
});

test('the next exercise begun just before a rest timeout keeps its first reps', () => {
  const s = [at('squat', 1000), at('squat', 3500)];
  for (let i = 0; i < 4; i += 1) s.push(at('biceps_curl', 21000 + i * 2000));   // first curl 17.5 s after the last squat
  assert.deepEqual(run(s, 40000).sets, ['squat#1=2', 'biceps_curl#1=4']);
});

test('arms taking turns close together (right 0.6 s after left) keep a rhythm', () => {
  const s = [];
  for (let i = 0; i < 6; i += 1) {
    s.push(at('biceps_curl', 1000 + i * 3000, { side: 'left' }));
    s.push(at('biceps_curl', 1600 + i * 3000, { side: 'right' }));
  }
  assert.deepEqual(run(s, 30000).sets, ['biceps_curl#1=12']);
});

test('a rival detected late (slow detector) still wins the movement it shares', () => {
  const s = [];
  for (let i = 0; i < 3; i += 1) {
    s.push(at('jumping_jack', 1500 + i * 1500, {}, 2000));        // reported 2 s after its turning point
    s.push(at('lateral_raise', 1000 + i * 1500));
  }
  assert.deepEqual(run(s, 30000).sets, ['jumping_jack#1=3']);
});

test('what the engine says about a rep auto mode did not count is not passed on', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000, { stable: false }),
    ['squat', 6300, { type: 'praise', t: 6300, count: 5 }],
    ['squat', 8000, { type: 'partial', t: 8000, distinct: false, faults: [] }],
    ['squat', 8000, { type: 'cue', t: 8000, code: 'shallow', message: 'Go deeper' }]];
  const out = run(s, 30000).out;
  assert.deepEqual(out.filter(e => ['praise', 'partial', 'cue'].includes(e.type)), []);
});

test('a rep of the set in progress is shown as soon as it is reported (a squat waits for a possible jump)', () => {
  // the set starts when its 2nd rep is decided (3 s after it: rivals of a rep outside a set may be slow to report)
  const script = [at('pushup', 1000), at('pushup', 3000), at('pushup', 5000), at('pushup', 7000),
    at('squat', 30000), at('squat', 32500), at('squat', 35000), at('squat', 37500)];
  const engines = Object.fromEntries(KEYS.map(k => [k, {
    update: (f, t) => script.filter(([x, when]) => x === k && when === t).map(([, , ev]) => ev), lost() {} }]));
  const auto = new AutoTracker({ engines });
  const shownAt = {};
  for (let t = 0; t <= 45000; t += 100)
    for (const e of auto.update({ visLegs: 1, visArms: 1, visTorso: 1, posture: 'upright', kneeMax: 170, hipAvg: 170 }, t))
      if (e.type === 'rep' && !e.backfill) shownAt[`${e.exercise}@${e.t}`] = t;
  assert.equal(shownAt['pushup@3000'], 6000);            // the set starts
  assert.equal(shownAt['pushup@5000'], 6100);            // reported before the set started: the next frame
  assert.equal(shownAt['pushup@7000'], 7300);            // reported at 7.3 s, shown in the same frame
  assert.equal(shownAt['squat@37500'], 38600);           // waits 1.1 s after its bottom: the feet never left the floor
});

// --- second review (2026-10-23) ----------------------------------------------------------------------------------
test('squats, then slower squat jumps: a landing 1 s after the peak and a jump reported late still make a jump set', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000)], air = [];
  for (let i = 0; i < 6; i += 1) {
    const t0 = 10000 + i * 3000;                                   // take-off bottom
    s.push(at('squat', t0));
    s.push(at('jump', t0 + 1100, {}, 500));                         // peak 1.1 s later, reported 0.5 s after it
    s.push(at('squat', t0 + 2100));                                 // landing 1.0 s after the peak
    air.push([t0 + 800, t0 + 1400]);
  }
  assert.deepEqual(run(s, 45000, { air }).sets, ['squat#1=3', 'jump#1=6']);
});

test('squat pulses, then squats: the squats take over (a pulse never beats a squat)', () => {
  const s = [];
  for (let i = 0; i < 6; i += 1) s.push(at('squat_pulse', 1000 + i * 800));
  for (let i = 0; i < 4; i += 1) { s.push(at('squat', 12000 + i * 2500)); s.push(at('squat_pulse', 12000 + i * 2500)); }
  assert.deepEqual(run(s, 40000).sets, ['squat_pulse#1=6', 'squat#1=4']);
});

test('a series of pulses ending at its deepest point keeps its last pulses (the squat engine sees the series as one squat)', () => {
  const s = [];
  for (const start of [1000, 12000]) {
    for (let i = 0; i < 8; i += 1) s.push(at('squat_pulse', start + i * 800));
    // the squat engine: one squat from going down to standing up, turning point at the last (deepest) pulse
    s.push(['squat', start + 7 * 800 + 900, rep(start + 7 * 800, { distinct: false, metrics: { extreme: 90, durationMs: 7500 } })]);
  }
  assert.deepEqual(run(s, 40000).sets, ['squat_pulse#1=16']);
});

test('three hand movements taking turns (right, left, right) are not a curl set without a rhythm', () => {
  const g = [at('biceps_curl', 1000, { side: 'right' }), at('biceps_curl', 5100, { side: 'left' }), at('biceps_curl', 5900, { side: 'right' })];
  assert.deepEqual(run(g, 30000).sets, []);
});

test('two-arm curls whose first-reported arm is not clearly a curl still count through the other arm', () => {
  const s = [];
  for (let i = 0; i < 4; i += 1) {
    s.push(at('biceps_curl', 1000 + i * 2500, { side: 'left', distinct: false }));
    s.push(at('biceps_curl', 1100 + i * 2500, { side: 'right', counted: false }));
  }
  assert.deepEqual(run(s, 30000).sets, ['biceps_curl#1=4']);
});

test('two-arm curls count both arms per side', () => {
  const s = [];
  for (let i = 0; i < 4; i += 1) {
    s.push(at('biceps_curl', 1000 + i * 2500, { side: i % 2 ? 'left' : 'right' }));
    s.push(at('biceps_curl', 1100 + i * 2500, { side: i % 2 ? 'right' : 'left', counted: false }));
  }
  const end = run(s, 30000).out.find(e => e.type === 'set_end');
  assert.deepEqual(end.perSide, { left: 4, right: 4 });
});

test('a rep just under the rest limit, still being decided, stays in the set', () => {
  assert.deepEqual(run([at('squat', 1000), at('squat', 3500), at('squat', 23300)], 50000).sets, ['squat#1=3']);
});

test('two misread reps right after a set, then a rest, do not become a set of their own', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000), at('lunge', 7500), at('lunge', 10000)];
  assert.deepEqual(run(s, 50000).sets, ['squat#1=3']);
});

test('"fixed" is passed on only for a fault that was cued in this set', () => {
  const fixed = t => ({ type: 'fixed', code: 'knees_in', message: 'Push your knees out', t });
  const cue = t => ({ type: 'cue', code: 'shallow', message: 'Go deeper', t });
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000), ['squat', 6300, fixed(6300)],
    at('squat', 8500), ['squat', 8800, cue(8800)], at('squat', 11000), ['squat', 11300, { ...fixed(11300), code: 'shallow' }]];
  const out = run(s, 40000).out;
  assert.deepEqual(out.filter(e => e.type === 'fixed').map(e => e.code), ['shallow']);
});

test('finish is idempotent', () => {
  const engines = Object.fromEntries(KEYS.map(k => [k, { update: () => [], lost() {} }]));
  const auto = new AutoTracker({ engines });
  assert.equal(auto.finish(0).at(-1).type, 'workout_summary');
  assert.deepEqual(auto.finish(0), []);
});

// --- third round (2026-10-23) ------------------------------------------------------------------------------------
test('squat pulses, then slow squats reported late (1.4 s after the bottom): the squats still take over', () => {
  const s = [];
  for (let i = 0; i < 6; i += 1) s.push(at('squat_pulse', 1000 + i * 800));
  for (let i = 0; i < 4; i += 1) {
    s.push(at('squat', 12000 + i * 4000, { metrics: { extreme: 90, durationMs: 2500 } }, 1400));
    s.push(at('squat_pulse', 12000 + i * 4000));                      // the pulse detector fires at each squat's bottom too
  }
  assert.deepEqual(run(s, 40000).sets, ['squat_pulse#1=6', 'squat#1=4']);
});

test('squats with two bounces at the bottom, after a pulse set, are squats', () => {
  const s = [];
  for (let i = 0; i < 6; i += 1) s.push(at('squat_pulse', 1000 + i * 800));
  for (let i = 0; i < 4; i += 1) {
    const b = 12000 + i * 4000;
    s.push(at('squat', b, { metrics: { extreme: 90, durationMs: 2500 } }));
    for (const dt of [0, 500, 1000]) s.push(at('squat_pulse', b + dt));
  }
  assert.deepEqual(run(s, 40000).sets, ['squat_pulse#1=6', 'squat#1=4']);
});

test('in a running two-arm curl set, the arm reported a frame later still counts per side and passes its cue', () => {
  const s = [];
  for (let i = 0; i < 6; i += 1) {
    s.push(at('biceps_curl', 1000 + i * 2500, { side: 'left' }));
    s.push(['biceps_curl', 1000 + i * 2500 + 400, rep(1000 + i * 2500 + 60, { side: 'right', counted: false,
      faults: i === 5 ? [{ code: 'short_bottom' }] : [] })]);
  }
  s.push(['biceps_curl', 13900, { type: 'cue', code: 'short_bottom', side: 'right', message: 'Lower all the way', t: 13900 }]);
  const out = run(s, 40000).out;
  const end = out.find(e => e.type === 'set_end');
  assert.deepEqual(end.perSide, { left: 6, right: 6 });
  assert.deepEqual(end.faults, { short_bottom: 1 });
  assert.equal(out.filter(e => e.type === 'cue').length, 1);
});

test('four alternating hand movements at an irregular pace are not a curl set; alternating curls with a lag are', () => {
  const g = [at('biceps_curl', 1000, { side: 'right' }), at('biceps_curl', 5100, { side: 'left' }),
    at('biceps_curl', 5900, { side: 'right' }), at('biceps_curl', 9000, { side: 'left' })];
  assert.deepEqual(run(g, 30000).sets, []);
});

test('praise comes from the set\'s own clean reps, every fifth', () => {
  const s = [];
  for (let i = 0; i < 6; i += 1) s.push(at('squat', 1000 + i * 2500, i === 2 ? { faults: [{ code: 'shallow' }] } : {}));
  for (let i = 6; i < 9; i += 1) s.push(at('squat', 1000 + i * 2500));
  const praise = run(s, 40000).out.filter(e => e.type === 'praise');
  assert.deepEqual(praise.map(e => e.reps), [8]);                    // reps 4-8 are the first five clean in a row
});

test('a deadlift set, then tuck jumps: the stand-up after each landing belongs to the jump', () => {
  const s = [at('hinge', 1000), at('hinge', 5000), at('hinge', 9000)], air = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = 14000 + i * 3500;
    s.push(at('jump', t0, {}, 400)); air.push([t0 - 300, t0 + 300]);
    s.push(at('hinge', t0 + 1800));                                    // standing up from the deep landing
  }
  assert.deepEqual(run(s, 45000, { air }).sets, ['hinge#1=3', 'jump#1=5']);
});

test('getting down to the floor for push-ups (and up again) is not a squat', () => {
  const s = [at('squat', 1000), at('squat', 3500)];                 // a real squat set
  s.push(at('squat', 30000), at('squat', 32500));                   // crouching down, then legs back into the plank
  for (let i = 0; i < 4; i += 1) s.push(at('pushup', 35000 + i * 2500));
  s.push(at('squat', 47000));                                       // getting up
  assert.deepEqual(run(s, 70000, { lying: [[32000, 46000]] }).sets, ['squat#1=2', 'pushup#1=4']);
});

test('squats right before getting down for push-ups still count (the person stood up in between)', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 30000), at('squat', 32500)];
  for (let i = 0; i < 4; i += 1) s.push(at('pushup', 37000 + i * 2500));
  // standing everywhere except a crouch right after the last squat and the plank from 34 s
  const sets = run(s, 70000, { lying: [[34000, 47000]] }).sets;
  assert.deepEqual(sets, ['squat#1=2', 'squat#2=2', 'pushup#1=4']);
});

// --- deciding early (live, 2026-10-23: every set appeared 3 s after its second rep) ---------------------------------
const startAt = r => r.when.find(([, e]) => e.type === 'set_start')?.[0];

test('a set starts as soon as no rival can still claim its second rep', () => {
  const jj = [at('jumping_jack', 1000), at('jumping_jack', 2000)];
  assert.equal(startAt(run(jj, 10000)), 5000);                       // engines that cannot say: the full 3 s
  assert.equal(startAt(run(jj, 10000, { pending: {} })), 2300);      // nothing outranks a jumping jack: when reported
  const pu = [at('pushup', 1000), at('pushup', 3500)];
  assert.equal(startAt(run(pu, 10000)), 6500);                       // engines that cannot say: the full 3 s
  assert.equal(startAt(run(pu, 10000, { pending: {} })), 4300);      // once a rival would have turned (0.7 s)
  const sq = [at('squat', 1000), at('squat', 3500)];
  assert.equal(startAt(run(sq, 10000, { pending: {} })), 4800);      // a squat: once a jump would have peaked (1.2 s)
});

test('a rival in the middle of a rep that may turn next to it holds the decision until it reports', () => {
  // two lunges; a squat (ranked above the lunge) turns 0.3 s after the second one and is reported 1.5 s later
  const s = [at('lunge', 1000), at('lunge', 3500), at('squat', 3800, {}, 1500)];
  assert.deepEqual(run(s, 20000, { pending: { squat: now => (now >= 3500 && now < 5300 ? 3800 : null) } }).sets, []);
  // (an engine that did not say so would lose: the lunge is decided before the squat is reported)
  assert.deepEqual(run(s, 20000, { pending: {} }).sets, ['lunge#1=2']);
});

test('a jump detector holding standing up as its peak holds up a squat only if the feet left the floor', () => {
  const s = [at('squat', 1000), at('squat', 3500)];
  const stuck = { jump: () => 4000 };                               // standing up after the squat: a possible peak
  assert.equal(startAt(run(s, 10000, { pending: stuck })), 4800);
  assert.equal(startAt(run(s, 10000, { pending: stuck, air: [[3900, 4100]] })), 6500);   // a jump may still be reported
  // a turn long before the rep (a detector stuck since the last movement) can only move later: no rival
  assert.equal(startAt(run(s, 10000, { pending: { jumping_jack: () => 500 } })), 4800);
});

test('reps waiting for rivals are decided in the order they happened', () => {
  // a jumping jack mid-rep next to the first squat only: the second squat must not be decided before it
  const r = run([at('squat', 1000), at('squat', 2500), at('squat', 4000)], 15000,
    { pending: { jumping_jack: now => (now < 4500 ? 1200 : null) } });
  assert.deepEqual(r.sets, ['squat#1=3']);
  assert.deepEqual(r.out.filter(e => e.type === 'rep').map(e => e.t), [1000, 2500, 4000]);
});

test('the first rep of an exercise is shown at once as tentative; from halfway for exercises that need 3-4 reps', () => {
  const r = run([at('squat', 1000), at('squat', 3500)], 10000, { pending: {} });
  assert.deepEqual(r.when.filter(([, e]) => e.type === 'tentative').map(([w, e]) => [w, e.exercise, e.count, e.need]),
    [[2300, 'squat', 1, 2]]);
  const k = run([1000, 2000, 3000, 4000].map(x => at('knee_raise', x)), 10000).out.filter(e => e.type === 'tentative');
  assert.deepEqual(k.map(e => e.count), [2, 3]);
  // another exercise during a set (no pause: it needs one more rep to take over)
  const sw = run([at('squat', 1000), at('squat', 3500), at('squat', 6000), at('jumping_jack', 7000),
    at('jumping_jack', 8000), at('jumping_jack', 9000)], 20000).out;
  assert.deepEqual(sw.filter(e => e.type === 'tentative').map(e => [e.exercise, e.count, e.need, !!e.switching]),
    [['squat', 1, 2, false], ['jumping_jack', 2, 3, true]]);
});

// review of deciding early (2026-10-23): a rep decided before an earlier one still waiting was cleared when that one was
// accepted. Expected: what the full 3 s wait gave.
test('reps decided early never overtake an earlier rep still waiting (of the set in progress, or a pulse)', () => {
  const pulses = Array.from({ length: 11 }, (_, i) => at('squat_pulse', 1000 + i * 500));
  const jj = t0 => [0, 1000, 2000, 3000].map(d => at('jumping_jack', t0 + d));
  // a pulse set, then jumping jacks 1.3 s after its last pulse (which waits 2 s for a squat around it)
  assert.deepEqual(run([...pulses, ...jj(7300)], 30000, { pending: {} }).sets, ['squat_pulse#1=11', 'jumping_jack#1=4']);
  // a squat set, then jumping jacks whose hops put the feet off the floor (the last squat waits 1.9 s for a jump)
  const sq = [1000, 3500, 6000, 8500].map(x => at('squat', x));
  const air = [9600, 10600, 11600, 12600].map(x => [x, x + 100]);
  assert.deepEqual(run([...sq, ...jj(9800)], 40000, { pending: {}, air }).sets, ['squat#1=4', 'jumping_jack#1=4']);
  // four pulses (no set yet: each waits for a squat around it), then squats
  const p4 = [1000, 1500, 2000, 2500].map(x => at('squat_pulse', x));
  assert.deepEqual(run([...p4, ...[4100, 6600, 9100].map(x => at('squat', x))], 40000, { pending: {} }).sets,
    ['squat_pulse#1=4', 'squat#1=3']);
  // a squat set, then lateral raises without standing up straight first (the last squat waits to see the person stand)
  const lr = [7000, 8500, 10000, 11500, 13000].map(x => at('lateral_raise', x));
  assert.deepEqual(run([...[1000, 3500, 6000].map(x => at('squat', x)), ...lr], 40000, { pending: {}, bent: [[6001, 8600]] }).sets,
    ['squat#1=3', 'lateral_raise#1=5']);
});

test('tentative reps say how many reps the set really needs (arms taking turns unevenly: two more)', () => {
  const s = [];
  for (let i = 0; i < 3; i += 1) s.push(at('biceps_curl', 1000 + i * 3000, { side: 'left' }), at('biceps_curl', 1600 + i * 3000, { side: 'right' }));
  const t = run(s, 20000).out.filter(e => e.type === 'tentative');
  assert.deepEqual(t.map(e => [e.count, e.need]), [[2, 3], [3, 5], [4, 5]]);
});

// second review (2026-10-23): random workouts, the fixed 3 s wait against deciding early, with engines that say which
// reps they are in the middle of (from 0.5 s before the turn until reported, as the detectors are). Expected: the sets
// of the fixed wait.
function inProgress(reps) {
  const by = {};
  for (const [ex, t, lat] of reps) (by[ex] ||= []).push({ s: t - 500, t, r: t + lat });
  return Object.fromEntries(Object.entries(by).map(([k, l]) => [k, now => l.filter(x => now >= x.s && now < x.r)
    .map(x => (now < x.t ? now - 50 : x.t))]));
}
const LEGS = new Set(['squat', 'lunge', 'squat_pulse', 'hinge']);
/** reps: [exercise, turn, report latency, rep duration?]; not standing up straight while a leg exercise is under way */
function scripted(reps, endMs, extra = {}) {
  const script = reps.map(([ex, t, lat, dur]) => at(ex, t, { metrics: { extreme: 1, durationMs: dur ?? lat + 800 } }, lat));
  const bent = reps.filter(([ex]) => LEGS.has(ex)).map(([, t, lat]) => [t - 500, t + lat - 200]);
  return run(script, endMs, { pending: inProgress(reps), bent, ...extra });
}

test('reps of a set that started early, which a squat or jump around them can still claim, are decided as before', () => {
  const p4 = [1000, 1500, 2000, 2500].map(t => ['squat_pulse', t, 300]);
  assert.deepEqual(scripted([...p4, ['squat_pulse', 3700, 300], ['squat', 4200, 1500, 1500]], 20000).sets, ['squat_pulse#1=5']);
  assert.deepEqual(scripted([...p4, ['squat_pulse', 4500, 300], ['squat', 4600, 1300, 1500]], 20000).sets, ['squat_pulse#1=5']);
  const series = [1000, 1500, 2000, 2500, 3000, 3500].map(t => ['squat_pulse', t, 300]);
  const squats = [5000, 7500, 10000].flatMap(t => [['squat_pulse', t - 100, 300], ['squat', t, 1200, 1500]]);
  assert.deepEqual(scripted([...series, ...squats], 30000).sets, ['squat_pulse#1=7', 'squat#1=3']);
  const knees = [1000, 2000, 3000, 4000, 5000].map(t => ['knee_raise', t, 400]);
  assert.deepEqual(scripted([...knees, ['jumping_jack', 6100, 200]], 20000).sets, ['knee_raise#1=4']);   // a step jack's take-off
});

test('a rep that would switch the set waits the full time: a rep of the set\'s exercise reported meanwhile cancels it', () => {
  const sq = [1000, 3500, 6000].map(t => ['squat', t, 1100]), lu = [8000, 10500, 13000].map(t => ['lunge', t, 1100]);
  assert.deepEqual(scripted([...sq, ...lu, ['squat', 14200, 1100]], 40000).sets, ['squat#1=4']);
  const jj = [1000, 2000, 3000, 4000].map(t => ['jumping_jack', t, 300]), lr = [5500, 7000, 8500, 10000].map(t => ['lateral_raise', t, 700]);
  assert.deepEqual(scripted([...jj, ...lr, ['jumping_jack', 10900, 300]], 30000).sets, ['jumping_jack#1=5']);
  const ohp = [1000, 3500, 6000, 8500].map(t => ['overhead_press', t, 2200]), jj2 = [9500, 10500, 11500, 12500, 13500].map(t => ['jumping_jack', t, 300]);
  assert.deepEqual(scripted([...ohp, ...jj2], 30000).sets, ['overhead_press#1=4', 'jumping_jack#1=5']);
});

test('a rep still being reported that turned earlier is decided first; a pulse waits for a squat under way next to it', () => {
  assert.deepEqual(scripted([['hinge', 1000, 2000], ['front_raise', 1800, 500], ['front_raise', 3200, 500], ['hinge', 4000, 2000],
    ['front_raise', 5000, 500]], 20000).sets, ['hinge#1=2']);
  // four bounces on the way down, the squat's bottom 1 s after the last, reported 1.2 s after it
  const p4 = [1000, 1500, 2000, 2500].map(t => ['squat_pulse', t, 300]);
  assert.deepEqual(scripted([...p4, ['squat', 3500, 1200, 2000]], 20000).sets, []);
});


// --- asking the user (2026-10-24: "it must ask the user after the assumption"; "it asks what exercise") -----------
// (finish's own events are not in `when`: `out` has them)
const asks = r => r.when.filter(([, e]) => e.type.startsWith('set_end')).map(([w, e]) => [w, e.type, e.reason ?? e.reps]);
const reasons = r => r.out.filter(e => e.type === 'set_end').map(e => e.reason);

test('a rest asks whether the set is done; with no answer the set still ends after the rest, as before', () => {
  assert.equal(ASK_REST_MS, 8000); assert.equal(REST_MS, 20000);
  const r = run([at('squat', 1000), at('squat', 3500)], 40000, { pending: {} });
  assert.deepEqual(asks(r), [[11600, 'set_end_pending', 2], [26600, 'set_end', 'rest']]);   // 8 s, then 20 s + 3 s
  assert.deepEqual(r.when[r.when.findIndex(([, e]) => e.type === 'set_end_pending')][1],
    { type: 'set_end_pending', exercise: 'squat', label: 'Squat', set: 1, reps: 2, t: 11600 });
});

test('a rep while the question is open withdraws it; the set goes on and is asked about after its next rest', () => {
  const r = run([at('squat', 1000), at('squat', 3500), at('squat', 13000)], 40000, { pending: {} });
  assert.deepEqual(asks(r), [[11600, 'set_end_pending', 2], [14100, 'set_end_cancelled', 2], [21100, 'set_end_pending', 3],
    [36100, 'set_end', 'rest']]);
  const i = r.out.findIndex(e => e.type === 'set_end_cancelled');
  assert.deepEqual([r.out[i].t, r.out[i + 1].type, r.out[i + 1].count], [13000, 'rep', 3]);     // withdrawn, then the rep
  assert.deepEqual(r.sets, ['squat#1=3']);
});

test('"done" ends the set (confirmed); the same exercise afterwards is the next set', () => {
  const answered = [];
  const r = run([at('squat', 1000), at('squat', 3500), at('squat', 30000), at('squat', 32500)], 50000,
    { pending: {}, actions: [[12000, a => { const ev = a.answerSetEnd(true); answered.push(...ev); return ev; }]] });
  assert.deepEqual(answered.map(e => [e.type, e.reason, e.reps, e.t]), [['set_end', 'confirmed', 2, 12000]]);
  assert.deepEqual(r.sets, ['squat#1=2', 'squat#2=2']);
  assert.equal(r.auto.answerSetEnd(true, 50000).length, 0);                // finished: nothing left to answer
  assert.throws(() => r.auto.answerSetEnd('false'), /true or false/);       // never a truthy string ending the set
});

test('"not yet" keeps the set open: not asked again until its next rep, and the rest counts from the answer', () => {
  const notYet = [[12000, a => a.answerSetEnd(false)]];
  const quiet = run([at('squat', 1000), at('squat', 3500)], 60000, { pending: {}, actions: notYet });
  assert.deepEqual(asks(quiet), [[11600, 'set_end_pending', 2], [35100, 'set_end', 'rest']]);   // 12 s + 20 s + 3 s
  const again = run([at('squat', 1000), at('squat', 3500), at('squat', 30000)], 70000, { pending: {}, actions: notYet });
  assert.deepEqual(asks(again), [[11600, 'set_end_pending', 2], [38100, 'set_end_pending', 3], [53100, 'set_end', 'rest']]);
  assert.deepEqual(again.sets, ['squat#1=3']);
  // a long break after it: the next squats are a set of their own, not more reps of this one
  const later = run([at('squat', 1000), at('squat', 3500), at('squat', 100000), at('squat', 102500)], 120000, { pending: {}, actions: notYet });
  assert.deepEqual(later.sets, ['squat#1=2', 'squat#2=2']);
});

test('a "not yet" after a rep withdrew the question changes nothing: the set is asked about after its next rest', () => {
  // "not yet, one more" and the rep: the rep is counted before the voice answer comes
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 13000), at('squat', 140000), at('squat', 142500)];
  const late = run(s, 160000, { pending: {}, actions: [[15000, a => a.answerSetEnd(false)]] });
  assert.deepEqual(asks(late), asks(run(s, 160000, { pending: {} })));
  assert.deepEqual(late.sets, ['squat#1=3', 'squat#2=2']);
  const named = [1000, 3500, 6000, 15000, 80000, 82500, 85000].map(t => at('squat', t));
  const n = run(named, 110000, { only: 'squat', actions: [[16500, a => a.answerSetEnd(false)]] });
  assert.deepEqual(n.sets, ['squat#1=4', 'squat#2=3']);
  assert.deepEqual(asks(n).slice(0, 4), [[14100, 'set_end_pending', 3], [15300, 'set_end_cancelled', 3], [23100, 'set_end_pending', 4],
    [38100, 'set_end', 'rest']]);
  // nothing asked yet: nothing to answer
  const early = run([at('squat', 1000), at('squat', 3500)], 6000, { pending: {}, finish: false });
  assert.deepEqual(early.auto.answerSetEnd(false), []);
  assert.deepEqual(early.auto.update({}, 40000).map(e => [e.type, e.reason]), [['set_end', 'rest']]);
});

test('the same "done" twice (a tap, then the voice) ends one set, not the next one too', () => {
  const s = [1000, 3500, 14000, 16500, 19000].map(t => at('squat', t));
  const done = t => [t, a => a.answerSetEnd(true)];
  const twice = run(s, 50000, { only: 'squat', actions: [done(12500), done(14500)] });
  assert.deepEqual([twice.sets, reasons(twice)], [['squat#1=2', 'squat#2=3'], ['confirmed', 'rest']]);
  // a "done" later on, asked or not, is the user's about this set
  const own = run(s, 50000, { only: 'squat', actions: [done(12500), done(19500)] });
  assert.deepEqual([own.sets, reasons(own)], [['squat#1=2', 'squat#2=3'], ['confirmed', 'confirmed']]);
});

test('"done" counts the reps of the set still being decided (a squat waits to see the person stand up)', () => {
  const r = run([at('squat', 1000), at('squat', 3500), at('squat', 6000)], 20000, { pending: {}, actions: [[6500, a => a.answerSetEnd(true)]] });
  assert.deepEqual(r.when.filter(([w]) => w === 6500).map(([, e]) => [e.type, e.count ?? e.reason]), [['rep', 3], ['set_end', 'confirmed']]);
  assert.deepEqual(r.sets, ['squat#1=3']);
  // asked about, then answered: the page reads whether the question is open
  const asked = run([at('squat', 1000), at('squat', 3500)], 12000, { pending: {}, finish: false });
  assert.equal(asked.auto.current().asking, true);
  assert.deepEqual(asked.auto.answerSetEnd(false), []);
  assert.equal(asked.auto.current().asking, false);
});

test('not asked while a rep of the set is under way (a slow squat on its way down)', () => {
  const script = [at('squat', 1000), at('squat', 3500), at('squat', 12500, {}, 1300)];
  const down = { squat: now => (now >= 11000 && now < 13800 ? Math.min(now, 12500) : null) };
  assert.deepEqual(asks(run(script, 25000, { pending: down })), [[20600, 'set_end_pending', 3]]);
  // an engine that cannot say: asked, then withdrawn by the rep
  assert.deepEqual(asks(run(script, 15000)).slice(0, 2), [[11600, 'set_end_pending', 2], [13800, 'set_end_cancelled', 2]]);
});

test('a named exercise: its first rep starts a set at once, its distinct rules are not used, other exercises are ignored', () => {
  const s = [at('squat', 1000, { distinct: false }), at('jumping_jack', 2000), at('jumping_jack', 3000), at('jumping_jack', 4000),
    at('squat', 20000), at('squat', 21000, { stable: false })];          // (tracking that fell apart never counts)
  const r = run(s, 30000, { only: 'squat' });
  assert.equal(r.auto.only, 'squat');
  assert.deepEqual(r.sets, ['squat#1=2']);
  assert.deepEqual(r.when.filter(([, e]) => ['set_start', 'rep', 'tentative'].includes(e.type)).map(([w, e]) => [w, e.type, e.count, !!e.backfill]),
    [[1300, 'set_start', 1, false], [1300, 'rep', 1, false], [20300, 'rep', 2, false]]);   // decided when reported
  assert.deepEqual(asks(r).slice(0, 2), [[9100, 'set_end_pending', 1], [20300, 'set_end_cancelled', 1]]);
  // slow squats far apart (live: 7-35 s apart, never a set in auto mode) each count
  assert.deepEqual(run([at('squat', 1000), at('squat', 40000)], 50000, { only: 'squat' }).sets, ['squat#1=1', 'squat#2=1']);
});

test('a named exercise: two-arm reps count once, both arms per side; its partials and visibility come out between sets', () => {
  const curls = [at('biceps_curl', 1000, { side: 'left' }), ['biceps_curl', 1400, rep(1060, { side: 'right', counted: false })],
    at('biceps_curl', 3500, { side: 'right', distinct: false })];
  const end = run(curls, 10000, { only: 'biceps_curl' }).out.find(e => e.type === 'set_end');
  assert.deepEqual([end.reps, end.perSide], [2, { left: 1, right: 2 }]);
  const partial = (t, stable) => ['squat', t + 300, { type: 'partial', t, distinct: false, stable, faults: [] }];
  const s = [partial(1000, true), partial(2000, false), ['squat', 5300, { type: 'visibility', parts: ['legs'], t: 5300 }]];
  assert.deepEqual(run(s, 8000, { only: 'squat' }).out.filter(e => e.type !== 'workout_summary')
    .map(e => [e.type, e.t, e.exercise, e.label, e.set]), [['partial', 1000, 'squat', 'Squat', undefined], ['visibility', 5300, 'squat', 'Squat', undefined]]);
  assert.deepEqual(run(s, 8000).out.filter(e => e.type !== 'workout_summary'), []);        // detecting: whose would they be?
});

test('naming the exercise counts its reps seen just before (still being decided, or waiting for a second one)', () => {
  const named = t => run([at('squat', 1000), at('squat', 9000)], 20000, { actions: [[t, a => a.setExercise('squat')]] });
  for (const when of [2000, 6000]) {                     // queued (rivals may still claim it), then tentative
    const r = named(when);
    assert.deepEqual(r.sets, ['squat#1=2']);
    assert.deepEqual(r.when.filter(([, e]) => e.type === 'set_start').map(([w, e]) => [w, e.count, e.t]), [[when, 1, 1000]]);
  }
  // more than a rest's worth of time ago: not this set's
  const stale = run([at('squat', 1000)], 30000, { actions: [[25000, a => a.setExercise('squat')]] });
  assert.deepEqual(stale.sets, []);
});

test('naming another exercise ends the set in progress (switch); the named one\'s first set says which set it ended', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000), at('lunge', 15000), at('squat', 20000)];
  const r = run(s, 30000, { actions: [[10000, a => a.setExercise('lunge')]] });
  assert.deepEqual(r.sets, ['squat#1=3', 'lunge#1=1']);
  assert.deepEqual(r.when.filter(([, e]) => e.type === 'set_end').map(([w, e]) => [w, e.exercise, e.reason]), [[10000, 'squat', 'switch']]);
  assert.deepEqual(reasons(r), ['switch', 'stop']);
  assert.deepEqual(r.out.find(e => e.type === 'set_start' && e.exercise === 'lunge').previous,
    { exercise: 'squat', label: 'Squat', set: 1, reps: 3 });
  // reps of it already done during the set in progress (not yet enough to take over) start its set at once
  const p = [at('pushup', 1000), at('pushup', 3000), at('pushup', 5000), at('squat', 6500), at('squat', 9000)];
  const q = run(p, 20000, { actions: [[12500, a => a.setExercise('squat')]] });
  assert.deepEqual(q.sets, ['pushup#1=3', 'squat#1=2']);
  assert.deepEqual(q.when.filter(([w]) => w === 12500).map(([, e]) => [e.type, e.exercise, e.reason ?? e.count, e.previous?.exercise]),
    [['set_end', 'pushup', 'switch', undefined], ['set_start', 'squat', 2, 'pushup'], ['rep', 'squat', 1, undefined], ['rep', 'squat', 2, undefined]]);
});

test('naming another exercise counts the set\'s last reps still being decided, as "done" does', () => {
  // (the 8.5 s squat waits until 9.6 s for a possible jump: the user named lunges while getting up from it)
  const s = [1000, 3500, 6000, 8500].map(t => at('squat', t));
  for (const act of [a => a.setExercise('lunge'), a => a.answerSetEnd(true)]) {
    const r = run([...s, at('lunge', 12000)], 20000, { pending: {}, actions: [[9000, act]] });
    assert.equal(r.sets[0], 'squat#1=4');
    assert.deepEqual(r.when.filter(([w]) => w === 9000).map(([, e]) => [e.type, e.count ?? e.reason]), [['rep', 4], ['set_end', r.auto.only ? 'switch' : 'confirmed']]);
  }
  const r = run([...s, at('lunge', 12000)], 20000, { pending: {}, actions: [[9000, a => a.setExercise('lunge')]] });
  assert.deepEqual(r.out.find(e => e.type === 'set_start' && e.exercise === 'lunge').previous, { exercise: 'squat', label: 'Squat', set: 1, reps: 4 });
});

test('naming a third exercise, or "auto", before the named one\'s first rep: the next set_start still says which set ended', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000)];
  const starts = r => r.out.filter(e => e.type === 'set_start').map(e => [e.exercise, e.previous?.exercise, e.previous?.reps]);
  const p = run([...s, at('pushup', 20000), at('pushup', 22000)], 30000,
    { actions: [[10000, a => a.setExercise('lunge')], [12000, a => a.setExercise('pushup')]] });
  assert.deepEqual(starts(p), [['squat', undefined, undefined], ['pushup', 'squat', 3]]);
  const j = run([...s, ...[20000, 21000, 22000].map(t => at('jumping_jack', t)), at('squat', 30000), at('squat', 32500)], 60000,
    { actions: [[10000, a => a.setExercise('lunge')], [12000, a => a.setExercise('auto')]] });
  assert.deepEqual(starts(j), [['squat', undefined, undefined], ['jumping_jack', 'squat', 3], ['squat', 'jumping_jack', 3]]);
});

test('"auto" detects again: the set in progress goes on, and another exercise can take over', () => {
  const s = [at('squat', 1000), at('squat', 3500), at('squat', 6000), at('jumping_jack', 9000), at('jumping_jack', 10000), at('jumping_jack', 11000)];
  const r = run(s, 30000, { only: 'squat', actions: [[2000, a => a.setExercise('auto')]] });
  assert.equal(r.auto.only, null);
  assert.deepEqual(r.sets, ['squat#1=3', 'jumping_jack#1=3']);
  // naming what is already counted keeps the set; an unknown exercise is an error
  const same = run([at('squat', 1000), at('squat', 3500), at('squat', 6000)], 10000, { actions: [[5000, a => a.setExercise('squat')]] });
  assert.deepEqual(same.sets, ['squat#1=3']);
  assert.deepEqual(same.auto.setExercise('squat'), []);
  assert.throws(() => same.auto.setExercise('yoga'), /unknown exercise/);
  assert.throws(() => new AutoTracker({ engines: {}, only: 'yoga' }), /unknown exercise/);
});
