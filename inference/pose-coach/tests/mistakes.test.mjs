// Recording dates in this file are fabricated test fixtures.
// A workout's mistakes (web/js/mistakes.js): the list the Workout card shows (at most MAX_MISTAKES, saying how many
// were left out), a mistake as a recording keeps it (no frames: its window) and back, and the mistakes of a recording
// saved before they were kept, derived from its events (an exercise's reps, a held pose's faults, a moving or rhythm
// movement's). Synthetic events and frames only (no user data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MISTAKES, MistakeList, SEEN_MAX_MS, SEEN_PAD_MS, clock, deriveMistakes, framesIn, fromRecord, mistakesOf,
  recordOf, rowOf, savedName, seenWindow } from '../web/js/mistakes.js';

const LEAN = { fault: 'upright', label: 'leaning over', measured: 'trunk leaning 30 degrees',
  target: 'upright, within about 15 degrees', cue: 'Stand tall.', part: 'torso', side: null };
const HEEL = { fault: 'heel', label: 'heel far from the glute', measured: 'bent knee at 100 degrees',
  target: 'heel close to the glute', cue: 'Pull your heel in.', part: 'knee', side: 'left' };
const ev = (type, t, extra = {}) => ({ type, key: 'quad_stretch', display: 'Quad stretch', kind: 'hold', t, ...extra });
const SHALLOW = { code: 'shallow', part: 'hips', message: 'Go deeper', severity: 'moderate', value: 125 };
/** Recording frames every 100 ms from `from` to `to` (ms): [x, y, z, visibility] and [x, y, z], 33 each. */
const recFrames = (from, to) => {
  const out = [];
  for (let t = from; t <= to; t += 100) {
    out.push({ t, image: Array.from({ length: 33 }, (_, i) => [0.4 + i / 100, 0.2 + t / 1e5, 0, 0.9]),
      world: Array.from({ length: 33 }, (_, i) => [i / 100, -t / 1e5, 0]) });
  }
  return out;
};

test('the list keeps the latest MAX_MISTAKES, newest first, and counts the ones left out', () => {
  assert.equal(MAX_MISTAKES, 40);
  const list = new MistakeList(3);
  for (let i = 1; i <= 5; i++) list.add({ i });
  assert.equal(list.size, 3);
  assert.equal(list.left, 2, 'the two earliest are left out, and said so');
  assert.deepEqual(list.newestFirst().map(m => m.i), [5, 4, 3]);
  assert.deepEqual(list.items.map(m => m.i), [3, 4, 5], '(oldest first inside)');
  list.clear();
  assert.deepEqual([list.size, list.left], [0, 0]);
  const long = new MistakeList();
  for (let i = 0; i < 100; i++) long.add({ i });
  assert.deepEqual([long.size, long.left, long.newestFirst()[0].i], [40, 60, 99]);
});

test('a mistake as a recording keeps it: no frames, the fault fields spread, its window; and back', () => {
  const hold = { t: 42000, at: 34.4, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch', fault: HEEL,
    side: 'left', window: { start: 40010, end: 42000 }, frames: [{ t: 40010 }, { t: 42000 }], entry: { key: 'x' },
    aspect: 16 / 9, mirror: true, workSide: 'left' };
  const r = recordOf(hold);
  assert.deepEqual(r, { t: 42000, at: 34.4, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch', ...HEEL,
    window: { start: 40010, end: 42000 } });
  assert.ok(!('frames' in r) && !('entry' in r), 'no frames (the recording has them), nothing of the page');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'plain JSON');
  const back = fromRecord(r);
  assert.deepEqual(back, { t: 42000, at: 34.4, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch',
    fault: HEEL, side: 'left', window: { start: 40010, end: 42000 } });
  const rep = { t: 9000, at: 4, kind: 'exercise', what: 'Squat', exercise: 'squat', fault: SHALLOW, side: null,
    turn: 8800, window: { start: 7850, end: 9150 }, demo: { url: '/demos/squat.webm' } };
  const rr = recordOf(rep);
  assert.deepEqual(rr, { t: 9000, at: 4, kind: 'exercise', what: 'Squat', exercise: 'squat', turn: 8800, ...SHALLOW,
    side: null, window: { start: 7850, end: 9150 } });
  assert.deepEqual(fromRecord(rr).fault, SHALLOW);
  assert.equal(fromRecord(rr).turn, 8800);
  // not a mistake: none
  for (const bad of [null, {}, { ...rr, kind: 'cue' }, { ...rr, t: 'x' }, { ...rr, window: { start: 1 } }]) {
    assert.equal(fromRecord(bad), null, JSON.stringify(bad));
  }
});

test("an old recording's held-pose mistakes, from its events: when the page told them, once until fixed", () => {
  const rec = { exercise: 'auto', frames: recFrames(0, 60000), events: [
    // a hold whose start carried a fault, a fault measured later, that one fixed and back: three mistakes
    ev('hold_start', 10000, { form: { checked: [], open: [LEAN] } }),
    ev('hold_fault', 12000, LEAN),                    // (the same fault still open: not again)
    ev('hold_fault', 20000, HEEL),
    ev('hold_fix', 22000, { fault: 'heel' }),
    ev('hold_fault', 25000, HEEL),
    ev('hold_progress', 26000, { seconds: 10, form: { open: [HEEL] } }),
    ev('hold_end', 30000, { seconds: 20 }),
    // a pause too short to be told: its fault was never shown
    ev('hold_start', 40000, { form: { open: [] } }),
    ev('hold_fault', 41000, HEEL),
    ev('hold_end', 43500, { seconds: 4 }),
    // a fault measured as the hold ended (after its end's time, said before it): shown
    ev('hold_start', 45000, { form: { open: [] } }),
    ev('hold_fault', 53100, HEEL),
    ev('hold_end', 53000, { seconds: 8 }),
    { type: 'workout_summary', t: 1000, sets: [], totals: {} },
  ] };
  const got = deriveMistakes(rec);
  assert.deepEqual(got.map(m => [m.t, m.fault]),
    [[16500, 'upright'], [20000, 'heel'], [25000, 'heel'], [53100, 'heel']],
    "the start's fault when the page told the start (6.5 s into the hold)");
  assert.deepEqual(got[0], { t: 16500, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch', ...LEAN,
    window: { start: 14500, end: 16500 } }, 'the last 2 s before it was shown');
  assert.equal(got[1].side, 'left');
  assert.equal(got[1].part, 'knee');
  // a hold still open when the recording ends (no hold_end): its faults count
  const open = deriveMistakes({ events: [ev('hold_start', 0), ev('hold_fault', 8000, HEEL)] });
  assert.deepEqual(open.map(m => m.fault), ['heel']);
});

test("an old recording's held-pose mistakes: the hold as the page told it, 6.5 s in, with its form as it was then",
  () => {
    const end = ev('hold_end', 30000, { seconds: 20 });
    const got = events => deriveMistakes({ events }).map(m => [m.t, m.fault]);
    // a fault fixed before the page told the hold was never shown (the start went with the form as it was then)
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [LEAN] } }), ev('hold_fix', 15000, { fault: 'upright' }),
      end]), [], "the start's fault, fixed by then");
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [] } }), ev('hold_fault', 14000, LEAN),
      ev('hold_fix', 15500, { fault: 'upright' }), end]), [], 'a fault told and fixed while the start waited');
    // of those still there then, the latest told (the form's first: the one the page shows), at 6.5 s
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [LEAN] } }), ev('hold_fix', 13000, { fault: 'upright' }),
      ev('hold_fault', 14500, HEEL), end]), [[16500, 'heel']]);
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [HEEL, LEAN] } }), end]), [[16500, 'heel']]);
    // ...and a fault waiting then is still open after: not told again until its fix
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [] } }), ev('hold_fault', 14000, LEAN),
      ev('hold_fault', 18000, LEAN), ev('hold_fix', 20000, { fault: 'upright' }), ev('hold_fault', 24000, LEAN), end]),
    [[16500, 'upright'], [24000, 'upright']]);
    // a hold whose end came before the page told it: its end went alone (app.js moveEvents), nothing was shown. Its
    // end is timed to when the hold ended and said a second or so later: 4.7 s in, it came before 6.5 s, though its
    // seconds round to 5
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [LEAN] } }),
      ev('hold_end', 14700, { seconds: 5 })]), []);
    // ...but an event of the hold from 6.5 s on (the end's fix, said as it was decided) says the page told it first
    assert.deepEqual(got([ev('hold_start', 10000, { form: { open: [LEAN] } }), ev('hold_fix', 16600, { fault: 'upright' }),
      ev('hold_end', 14900, { seconds: 5 })]), [[16500, 'upright']]);
    // a hold still open when the recording ends: told if its frames went on to 6.5 s
    const tail = [ev('hold_start', 10000, { form: { open: [LEAN] } })];
    assert.deepEqual(deriveMistakes({ frames: recFrames(9000, 16400), events: tail }), []);
    assert.deepEqual(deriveMistakes({ frames: recFrames(9000, 16500), events: tail }).map(m => m.t), [16500]);
  });

test("an old recording's held-pose mistakes: told on its first frame 6.5 s in, with that frame's events in its form",
  () => {
    const end = ev('hold_end', 30000, { seconds: 20 }), start = ev('hold_start', 10000, { form: { open: [LEAN] } });
    const got = (frames, ...evs) => deriveMistakes({ frames, events: [start, ...evs, end] }).map(m => [m.t, m.fault]);
    // (app.js moveEvents reads the hold's form after the tracker took the frame: what it said on it, the form has)
    const every100 = recFrames(0, 60000);
    assert.deepEqual(got(every100, ev('hold_fault', 16500, HEEL)), [[16500, 'heel']],
      'a fault said on that frame: the latest told, the one shown (the one waiting is not)');
    assert.deepEqual(got(every100, ev('hold_fix', 16500, { fault: 'upright' })), [], 'a fix said on it: none shown');
    assert.deepEqual(got(every100, ev('hold_fault', 16600, HEEL)), [[16500, 'upright'], [16600, 'heel']],
      '(the frame after: after the start)');
    // frames every 33 ms: the first one from 6.5 s in is 16501, and the page told the hold on it
    const every33 = Array.from({ length: 900 }, (_, i) => ({ t: 10000 + 33 * i }));
    assert.deepEqual(got(every33, ev('hold_fault', 16501, HEEL)), [[16501, 'heel']]);
    assert.deepEqual(got(every33, ev('hold_fix', 16501, { fault: 'upright' })), []);
    assert.deepEqual(got(every33, ev('hold_fault', 16468, HEEL)), [[16501, 'heel']], '(the frame before: waiting)');
    assert.deepEqual(got(every33, ev('hold_fault', 16534, HEEL)), [[16501, 'upright'], [16534, 'heel']]);
    const told = deriveMistakes({ frames: every33, events: [start, end] });
    assert.deepEqual(told.map(m => [m.t, m.window]), [[16501, { start: 14501, end: 16501 }]],
      'when that frame came, with the last 2 s before it');
    // (no frames: 6.5 s in, as before)
    assert.deepEqual(got(undefined, ev('hold_fault', 16500, HEEL)), [[16500, 'heel']]);
    assert.deepEqual(got([], ev('hold_fix', 16500, { fault: 'upright' })), []);
  });

test("an old recording's exercise mistakes, from its events: faulty reps and partial reps, as formCheck showed them",
  () => {
    const rep = (t, extra = {}) => ({ type: 'rep', t, count: 1, faults: [SHALLOW], ...extra });
    const rec = { exercise: 'auto', frames: [], events: [
      rep(5000, { exercise: 'squat', label: 'Squat', backfill: true }),       // (counted back: not shown then)
      rep(8000, { exercise: 'squat', label: 'Squat', window: { start: 7000, end: 8500 } }),
      rep(10000, { exercise: 'squat', label: 'Squat' }),                     // (within 3 s: the panel stayed)
      rep(12000, { exercise: 'squat', label: 'Squat', faults: [] }),
      rep(14000, { exercise: 'squat', label: 'Squat', side: 'left' }),
      { type: 'partial', t: 20000, exercise: 'squat', label: 'Squat', faults: [SHALLOW], fold: 0.8 },
      rep(30000, { exercise: 'jumping_jack', label: 'Jumping jack', faults: [{ code: 'arms_low', part: 'arms',
        message: 'Arms up', value: 100 }] }),
      rep(31000),                                                             // (no exercise: auto, none named)
      { type: 'set_end', t: 32000, exercise: 'squat', faults: { shallow: 3 } },
    ] };
    const got = deriveMistakes(rec, { known: k => k !== 'auto' });
    assert.deepEqual(got.map(m => [m.t, m.exercise, m.code]), [[8000, 'squat', 'shallow'], [14000, 'squat', 'shallow'],
      [20000, 'squat', 'shallow'], [30000, 'jumping_jack', 'arms_low']]);
    assert.deepEqual(got[0], { t: 8000, kind: 'exercise', what: 'Squat', exercise: 'squat', turn: 8000, ...SHALLOW,
      side: null, window: { start: 6850, end: 8650 } }, 'its window, padded as the replay pads it');
    assert.deepEqual(got[1].window, { start: 12350, end: 14950 }, 'about the rep, without a window');
    assert.equal(got[1].side, 'left');
    // an old recording of one exercise named: its events name none
    const old = deriveMistakes({ exercise: 'squat', events: [rep(8000)] },
      { label: k => (k === 'squat' ? 'Squat' : k) });
    assert.deepEqual(old.map(m => [m.exercise, m.what]), [['squat', 'Squat']]);
    // the fault the page shows: the first one the demo does not have
    const two = { exercise: 'squat', events: [rep(8000, { faults: [SHALLOW, { code: 'knees_in', part: 'knees' }] })] };
    const notShallow = (k, faults) => faults.find(f => f.code !== 'shallow');
    assert.equal(deriveMistakes(two, { pick: notShallow })[0].code, 'knees_in');
    assert.equal(deriveMistakes(two, { pick: () => undefined })[0].code, 'shallow', 'none usable: the first');
  });

test("an old recording's exercise mistakes: a faulty rep a new set counts back, shown when the rep counted with it is "
  + 'clean', () => {
  const ARMS = { code: 'arms_low', part: 'arms', message: 'Arms up', value: 100 };
  const FEET = { code: 'feet_narrow', part: 'feet', message: 'Jump your feet wider', value: 1.2 };
  const jack = (t, extra = {}) => ({ type: 'rep', t, exercise: 'jumping_jack', label: 'Jumping jack', faults: [],
    ...extra });
  const start = { type: 'set_start', t: 28900, exercise: 'jumping_jack', label: 'Jumping jack', set: 1, count: 3 };
  // (as auto.js startSet records them: the set's start, the reps it counts back, then the last one, counted)
  const got = deriveMistakes({ exercise: 'auto', events: [start,
    jack(24400, { backfill: true, faults: [ARMS], window: { start: 23900, end: 24800 } }),
    jack(26600, { backfill: true }),
    jack(28900),
    jack(31000)] });                                        // (the next clean rep: nothing more)
  assert.deepEqual(got, [{ t: 28900, kind: 'exercise', what: 'Jumping jack', exercise: 'jumping_jack', turn: 24400,
    ...ARMS, side: null, window: { start: 23750, end: 24950 } }], 'shown with the set counted, its own frames');
  // the rep counted with them has a fault of its own: that one, as before
  const own = deriveMistakes({ exercise: 'auto', events: [start,
    jack(24400, { backfill: true, faults: [ARMS] }), jack(28900, { faults: [FEET] })] });
  assert.deepEqual(own.map(m => [m.turn, m.code]), [[28900, 'feet_narrow']]);
});

test("a recording's own mistakes, else derived; with seconds into the workout; its frames by window", () => {
  const frames = recFrames(5000, 20000);
  const own = { t: 12000, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch', ...HEEL,
    window: { start: 10000, end: 12000 } };
  const saved = mistakesOf({ frames, mistakes: [own, { kind: 'nonsense' }], events: [ev('hold_start', 0)] });
  assert.equal(saved.derived, false);
  assert.deepEqual(saved.records, [{ ...own, at: 7 }], 'its own (the events are not used), timed from the first frame');
  const old = mistakesOf({ frames,
    events: [ev('hold_start', 5000), ev('hold_fault', 12000, HEEL), ev('hold_end', 19000)] });
  assert.equal(old.derived, true);
  assert.deepEqual(old.records.map(r => [r.fault, r.at]), [['heel', 7]]);
  // the frames shown as "You": the recording's within the window, as the page has them
  const shown = framesIn(frames, own.window);
  assert.deepEqual(shown.map(f => f.t), [10000, 10100, 10200, 10300, 10400, 10500, 10600, 10700, 10800, 10900, 11000,
    11100, 11200, 11300, 11400, 11500, 11600, 11700, 11800, 11900, 12000]);
  assert.deepEqual(shown[0].image[3], { x: frames[50].image[3][0], y: frames[50].image[3][1], z: 0, visibility: 0.9 });
  assert.deepEqual(shown[0].world[2], { x: 0.02, y: frames[50].world[2][1], z: 0, visibility: 1 });
  assert.deepEqual(framesIn([{ t: 1, image: null, world: null }], { start: 0, end: 2 }),
    [{ t: 1, image: null, world: null }]);
  assert.deepEqual(framesIn(undefined, { start: 0, end: 2 }), []);
});

test("a mistake's row: when into the workout, what, the fault's label and measurement", () => {
  assert.deepEqual(rowOf({ kind: 'hold', at: 42.9, what: 'Quad stretch', fault: HEEL }),
    { when: '0:42', what: 'Quad stretch', label: 'Heel far from the glute', measured: 'bent knee at 100 degrees' });
  assert.deepEqual(rowOf({ kind: 'exercise', at: 75, what: 'Squat', exercise: 'squat', fault: SHALLOW }),
    { when: '1:15', what: 'Squat', label: 'Go deeper',
      measured: 'Your knees bent to 125° at the bottom. Aim for 110° or less.' });
  // (a fault without words of its own: the measurement is not the label again)
  assert.equal(rowOf({ kind: 'exercise', at: 1, what: 'Squat', exercise: 'squat', fault: { code: 'x', message: 'Hm' } })
    .measured, '');
  assert.equal(clock(605.5), '10:05');
  assert.equal(clock(null), '0:00');
  // (the id's time is UTC; it is shown in the viewer's own)
  assert.match(savedName('live-20000115120000-auto', 'en-US'), /^Jan 1[456], \d\d:\d\d [AP]M \(auto\)$/);
  assert.match(savedName('live-20000115120000-jumping_jack', 'en-US'), /\(jumping jack\)$/);
  assert.equal(savedName('my-own'), 'my-own');
});

// A moving or rhythm movement's fault (web/js/moveform.js, through moves.js: form_fault and form_fix), kind 'move'
const ELBOWS = { fault: 'elbows_out', label: 'elbows drifting off the sides',
  measured: 'elbow 63 degrees out from your side as your hands turn out',
  target: 'elbows tucked in at your sides, within about 30 degrees',
  cue: 'Keep your elbows pinned to your sides as you turn your hands out.', part: 'elbow', side: 'right' };
const mev = (type, t, extra = {}) => ({ type, key: 'shoulder_external_rotation', display: 'Shoulder external rotation',
  kind: 'gym_reps', t, ...extra });

test("a moving movement's mistake as a recording keeps it, and back; its row", () => {
  const m = { t: 24200, at: 20.1, kind: 'move', what: 'Shoulder external rotation',
    movement: 'shoulder_external_rotation', fault: ELBOWS, side: 'right', window: { start: 22210, end: 24200 },
    frames: [{ t: 22210 }, { t: 24200 }], entry: { key: 'x' }, aspect: 16 / 9, mirror: true, workSide: null };
  const r = recordOf(m);
  assert.deepEqual(r, { t: 24200, at: 20.1, kind: 'move', what: 'Shoulder external rotation',
    movement: 'shoulder_external_rotation', ...ELBOWS, window: { start: 22210, end: 24200 } });
  assert.ok(!('frames' in r) && !('entry' in r) && !('exercise' in r) && !('turn' in r));
  assert.deepEqual(fromRecord(r), { t: 24200, at: 20.1, kind: 'move', what: 'Shoulder external rotation',
    movement: 'shoulder_external_rotation', fault: ELBOWS, side: 'right', window: { start: 22210, end: 24200 } });
  assert.deepEqual(rowOf({ kind: 'move', at: 20.1, what: 'Shoulder external rotation', fault: ELBOWS }),
    { when: '0:20', what: 'Shoulder external rotation', label: 'Elbows drifting off the sides',
      measured: ELBOWS.measured });
});

test("an old recording's moving-movement mistakes, from its events: each when it was told, a fix takes none back",
  () => {
    const rec = { exercise: 'auto', frames: recFrames(0, 120000), events: [
      // told 0.4 s into the recording: there is no start held back, nor a hold's 6.5 s
      mev('form_fault', 400, ELBOWS),
      mev('rhythm_progress', 49300, { count: 5, approximate: true,
        form: { checked: [], open: [ELBOWS], pending: [], unseen: [], wrongView: [] } }),   // (still open: not again)
      mev('form_fix', 53500, { fault: 'elbows_out', label: ELBOWS.label }),
      mev('form_fault', 66300, { ...ELBOWS, side: 'left' }),       // (back after its fix: a new mistake)
      mev('form_fix', 71500, { fault: 'elbows_out', label: ELBOWS.label }),
      { type: 'form_fault', key: 'sun_salutation', display: 'Sun salutation', kind: 'flow', t: 90000,
        fault: 'knees_locked', label: 'knees locked', part: 'knee', side: null },
      mev('form_fault', 100000, { label: 'no fault named' }),         // (not one: no fault id)
      { type: 'workout_summary', t: 120000, sets: [], totals: {} },
    ] };
    const got = deriveMistakes(rec);
    assert.deepEqual(got.map(m => [m.t, m.kind, m.movement, m.fault, m.side]), [
      [400, 'move', 'shoulder_external_rotation', 'elbows_out', 'right'],
      [66300, 'move', 'shoulder_external_rotation', 'elbows_out', 'left'],
      [90000, 'move', 'sun_salutation', 'knees_locked', null]]);
    assert.deepEqual(got[0], { t: 400, kind: 'move', what: 'Shoulder external rotation',
      movement: 'shoulder_external_rotation', ...ELBOWS, window: { start: -1600, end: 400 } },
    'the last 2 s before it was shown');
    assert.equal(got[2].what, 'Sun salutation');
    // with a held pose's in the same recording: each as before, oldest first
    const both = deriveMistakes({ frames: recFrames(0, 60000), events: [
      ev('hold_start', 10000, { form: { open: [LEAN] } }), ev('hold_end', 30000, { seconds: 20 }),
      mev('form_fault', 15000, ELBOWS), mev('form_fault', 40000, { ...ELBOWS, side: null })] });
    assert.deepEqual(both.map(m => [m.t, m.kind, m.fault]), [[15000, 'move', 'elbows_out'], [16500, 'hold', 'upright'],
      [40000, 'move', 'elbows_out']]);
    // as the Mistakes list reads a saved workout: derived, timed from its first frame
    const listed = mistakesOf({ frames: recFrames(5000, 60000), events: [mev('form_fault', 24200, ELBOWS)] });
    assert.equal(listed.derived, true);
    assert.deepEqual(listed.records.map(r => [r.kind, r.fault, r.at]), [['move', 'elbows_out', 19.2]]);
    assert.deepEqual(fromRecord(listed.records[0]).fault, ELBOWS, 'one the page can show');
  });

test("a moving movement's fault replays the frames its verdict was based on (`seen`), not the 2 s before it was told",
  () => {
    assert.deepEqual([SEEN_PAD_MS, SEEN_MAX_MS], [300, 3000]);
    // the span, SEEN_PAD_MS either side; none after the fault was told (the page had no later frame then)
    assert.deepEqual(seenWindow({ from: 20000, to: 21000 }, 24000), { start: 19700, end: 21300 });
    assert.deepEqual(seenWindow({ from: 22500, to: 24000 }, 24000), { start: 22200, end: 24000 });
    // at most SEEN_MAX_MS, about the span's middle (and within the padded span)
    assert.deepEqual(seenWindow({ from: 10000, to: 14000 }, 20000), { start: 10500, end: 13500 });
    assert.deepEqual(seenWindow({ from: 10000, to: 14000 }, 13500), { start: 10250, end: 13250 });
    // none: a hold's fault or an event from before `seen` (the 2 s before it, as always), or not a span before it
    for (const bad of [undefined, null, {}, { from: 1 }, { from: 2, to: 1 }, { from: '1', to: 3 }, { from: NaN, to: 3 },
      { from: 30000, to: 31000 }]) {
      assert.equal(seenWindow(bad, 24000), null, JSON.stringify(bad));
    }
    // an old recording's form_fault whose `seen` lies 3 s before it (a cycle check told when the turn was confirmed):
    // its frames are the seen ones, none of the 2 s before it was told
    const frames = recFrames(0, 40000);
    const rec = { frames, events: [mev('form_fault', 24000, { ...ELBOWS, seen: { from: 20000, to: 21000 } }),
      mev('form_fault', 30000, ELBOWS)] };
    const got = deriveMistakes(rec);
    assert.deepEqual(got.map(m => [m.t, m.window]), [[24000, { start: 19700, end: 21300 }],
      [30000, { start: 28000, end: 30000 }]], '(without `seen`: the 2 s before it)');
    assert.ok(!('seen' in got[0]), '(the window is what is kept)');
    const shown = framesIn(frames, got[0].window).map(f => f.t);
    assert.deepEqual([shown[0], shown.at(-1), shown.length], [19700, 21300, 17]);
    assert.ok(shown.every(t => t >= 20000 - SEEN_PAD_MS && t <= 21000 + SEEN_PAD_MS));
    assert.ok(!shown.some(t => t > 22000), 'none of the 2 s before it was told');
    // as the Mistakes list reads it, and as fromRecord gives it back
    const listed = mistakesOf(rec).records;
    assert.deepEqual(listed.map(r => r.window), got.map(m => m.window));
    assert.deepEqual(fromRecord(listed[0]).window, { start: 19700, end: 21300 });
  });
