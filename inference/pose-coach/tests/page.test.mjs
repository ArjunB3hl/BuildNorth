// Recording dates in this file are fabricated test fixtures.
// The page itself (web/index.html, web/js/app.js): what app.js looks up by id is in the page, so that a renamed or
// forgotten element fails here and not as a null on someone's screen mid-workout. And the Movements card and the
// Now card have what the movement library needs (web/js/moves.js tracks the movement the user names).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACKS } from '../web/js/moves.js';
import { FORM_TUNING, HoldForm } from '../web/js/holdform.js';
import { EXERCISES } from '../web/js/engine.js';
import { bonesFor, describeFault, mirrorImage } from '../web/js/formcheck.js';
import { mirrorSide } from '../web/js/retarget.js';
import * as Mistakes from '../web/js/mistakes.js';
import { recordMovingIntervals, endAttempt } from '../web/js/movement-review.js';

// (a Windows checkout has CRLF line ends; the slices below look for LF)
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

test('every element app.js looks up by id is in the page (or made by app.js itself)', () => {
  const made = new Set([...app.matchAll(/\.id = '([^']+)'/g)].map(m => m[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  // ("conn-<brain>" rows are looked up by a template: each brain's row must be there)
  for (const b of ['eleven', 'claude', 'chatgpt']) used.add(`conn-${b}`);
  const missing = [...used].filter(id => !ids.has(id) && !made.has(id));
  assert.deepEqual(missing, []);
  assert.equal(new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])).size, [...html.matchAll(/\bid="([^"]+)"/g)].length,
    'an id used twice in the page');
});

test('the movement library: its card, the Now card line with Show in 3D, and "Other movement..." among the chips', () => {
  for (const id of ['library', 'libGroups', 'libCount', 'moveRow', 'moveNote', 'move3d']) assert.ok(ids.has(id), id);
  assert.match(app, /'Other movement\.\.\.'/);
  // the groups the card shows, in this order, and every kind of the library has one
  const groups = [...app.matchAll(/\['([A-Z][A-Za-z ]+)', \[((?:'[a-z_]+'(?:, )?)+)\]\]/g)].map(m => [m[1], m[2].match(/[a-z_]+/g)]);
  assert.deepEqual(groups.map(([g]) => g), ['Gym exercises', 'Gym moves', 'Holds', 'Flows and dance']);
  const kinds = groups.flatMap(([, k]) => k).sort();
  assert.deepEqual(kinds, ['dance', 'flow', 'gym_counted', 'gym_reps', 'hold', 'technique', 'transition']);
  // the library keeps only the movements of the kinds moves.js offers, on their kind's track (a library.json built
  // before may have others)
  assert.match(app, /const offered = mod\?\.TRACK_OF_KIND \? m => mod\.TRACK_OF_KIND\[m\.kind\] === m\.track/);
  assert.match(app, /&& offered\(m\) && /);
  // the agent's tool for the movements is registered with the session, next to its two others
  assert.match(app, /set_movement: \(\{ movement \} = \{\}, \{ byUser \} = \{\}\) => \(byUser \? chooseMovement\(/);
  // the tracker's events reach the coach, each with the engine's own sentence as its fallback
  for (const kind of ['movement_set', 'hold_start', 'hold_progress', 'hold_end', 'hold_fault', 'hold_fix',
    'moving_progress', 'rhythm_progress', 'form_fault', 'form_fix']) {
    assert.match(app, new RegExp(`\\n  ${kind}: `), `FALLBACK.${kind}`);
  }
});

// The engine's own sentences (app.js FALLBACK, with spokenTime): what is said when no coach answers in time, or with
// none connected. Taken from app.js as it is (the page needs a browser to load)
const fallbackSrc = app.slice(app.indexOf('const FALLBACK = {'), app.indexOf('\nconst mmss'));
const { FALLBACK, formFine, unseenLasts, unseenWords } = new Function(
  `${fallbackSrc}\nreturn { FALLBACK, formFine, unseenLasts, unseenWords };`)();

test('a movement named is said, with the set it ended, whatever its track', () => {
  const hold = { key: 'quad_stretch', display: 'Quad stretch', track: 'hold' };
  const dance = { key: 'hip_hop_dance', display: 'Hip-hop dance', track: 'moving' };
  assert.equal(FALLBACK.movement_set(hold), "Quad stretch: settle into it and hold still, I'll time it.");
  assert.equal(FALLBACK.movement_set(hold, { label: 'Squat', reps: 2 }), "Squat: 2 reps. Quad stretch: settle into it and hold still, I'll time it.");
  assert.equal(FALLBACK.movement_set(dance, { label: 'Squat', reps: 1 }), "Squat: 1 rep. Hip-hop dance: I'll time how long you keep moving.");
  // (every track but the reps, which the engine counts, has its sentence)
  for (const track of TRACKS.filter(t => t !== 'reps')) {
    assert.match(FALLBACK.movement_set({ display: 'Freestyle dance', track }), /^Freestyle dance: .+\.$/, track);
  }
  // (a short hold is a pause: nothing said)
  assert.equal(FALLBACK.hold_end({ seconds: 3 }), '');
});

test('dance encouragement does not display an elapsed-time counter', () => {
  assert.equal(FALLBACK.moving_progress({ kind: 'dance', seconds: 30 }), 'Keep exploring the movement at your own pace.');
  assert.doesNotMatch(FALLBACK.moving_progress({ movementKind: 'dance', seconds: 90 }), /\d|seconds|minutes/);
});

test('the workout summary leaves out a movement with nothing to show', () => {
  const totals = { squat: { label: 'Squat', reps: 7, sets: 2 } };
  const moves = [{ display: 'Quad stretch', track: 'hold', seconds: 47 }, { display: 'Y-to-W arm raise', track: 'rhythm', count: 0 },
    { display: 'Freestyle dance', track: 'moving', seconds: 0 }, { display: 'Kneel and stand', track: 'moving' }];
  assert.equal(FALLBACK.workout_summary({ totals }, moves), 'Workout done: 7 squat reps in 2 sets, quad stretch held 47 seconds.');
  assert.equal(FALLBACK.workout_summary({ totals: {} }, moves.slice(1)), 'Workout stopped. I did not see a full set of any exercise.');
  // (the page merges a movement named several times before: movesDone(), one entry each, none without a result)
  assert.match(app, /const movements = movesDone\(\)\.map/);
});

// A held pose's form (web/js/holdform.js through moves.js MovementTracker): the page passes the frame's landmarks to
// the tracker, sends its hold_fault and hold_fix to the coach after the hold's start (and re-settles the form's next
// correction then), tells the coach at hold_end which faults it heard, shows the form on the Now card once the start
// was told, and records the tracker's events. moveEvents() is taken from app.js as it is (a stand-in coach and tracker)
const trackSrc = app.match(/const TRACK_EVENTS = new Set\(\[[^\]]+\]\);/)[0];
const moveSrc = app.slice(app.indexOf('\nconst SHORT_HOLD_MS'), app.indexOf('\n/** What the tracker has now'));
const TRIANGLE = { key: 'triangle_pose', display: 'Triangle pose', kind: 'hold', track: 'hold' };
const FEET = { fault: 'stance_narrow', label: 'feet too close together', measured: 'feet 0.45 leg lengths apart',
  target: 'about one leg length', cue: "Step your feet wider, about a leg's length apart." };
const TOP_ARM = { fault: 'top_arm', label: 'top arm not straight up', measured: 'top arm 40 degrees from straight up',
  target: 'straight up, over the shoulder', cue: 'Reach your top arm straight up, stacked over your shoulder.' };
const TRUNK = { fault: 'trunk_tilt', label: 'trunk too upright', measured: 'trunk tipped 30 degrees',
  target: 'about 60 degrees, out over the front leg',
  cue: 'Reach out over your front leg, then tip your trunk further down.' };
const CHECKED = ['stance width', 'top arm'];
/** HoldForm state() as the page gets it: {checked, open, pending, unseen, wrongView}. */
const form = (over = {}) => ({ checked: CHECKED, open: [], pending: [], unseen: [], wrongView: [], ...over });
const fine = form(), faulty = form({ open: [FEET] });
const ev = (type, t, extra = {}) => ({ type, key: TRIANGLE.key, display: TRIANGLE.display, kind: TRIANGLE.kind, t,
  ...extra });
/** moveEvents() with a tracker whose current() is `now.cur` (and settle(t) recorded in `settled`; `tracker` in place
 * of that stand-in) for the movement `entry` named; what went to the coach, in order, with its fallback and the frame
 * time it went at (`at`), and what the side panel's form check was given (`aside`: holdCheck's type, event, movement
 * and frame time). */
function page(now, tracker = null, entry = TRIANGLE) {
  const told = [], settled = [], aside = [];
  const S = { move: { entry, tracker: tracker ?? { current: () => now.cur, settle: t => settled.push(t) } } };
  const make = new Function('S', 'log', 'coachEvent', 'FALLBACK', 'mmss', 'holdCheck', 'unseenLasts',
    `${trackSrc}\n${moveSrc}\nreturn moveEvents;`);
  let at = null;
  const moveEvents = make(S, () => {}, (e, fallback) => told.push({ ...e, fallback, at }), FALLBACK, String,
    (type, e, m, t) => aside.push({ type, e, m, t }), unseenLasts);
  return { told, settled, aside, x: S.move, moveEvents: (evs, t) => { at = t; moveEvents(evs, t); } };
}

test('technique: the page routes corrections and scoped results, and never speaks a legacy count', () => {
  const entry = { key: 'one_two_jab', display: 'Practice combo', kind: 'technique', track: 'technique' };
  const p = page({ cur: {} }, null, entry);
  const fault = { ...FEET, fault: 'punch_up', label: 'punch travelling upward', cue: 'Punch straight ahead.' };
  const result = { verdict: 'incomplete', sequence: 'same_hand', cue: 'Follow with the other hand.' };
  p.moveEvents([ev('form_fault', 800, fault), ev('technique_result', 1100, { ...result, cue: '' })], 1100);
  assert.deepEqual(p.told.map(e => e.kind), ['form_fault', 'technique_result']);
  assert.equal(p.told[1].fallback, '', 'the result updates the coach without repeating the correction');
  assert.equal(p.aside[0].e.fault, 'punch_up', 'the measured mistake reaches the replay panel');
  p.moveEvents([ev('technique_result', 2200, result)], 2200);
  assert.equal(p.told.at(-1).fallback, result.cue);
  assert.equal(p.told.at(-1).track, 'technique');
  assert.match(FALLBACK.movement_set(entry), /without counting/);
  const spoken = FALLBACK.workout_summary({ totals: {} }, [{ ...entry, reviewed: true, count: 13 }]);
  assert.match(spoken, /technique reviewed/);
  assert.doesNotMatch(spoken, /13|about|clean|correct/);
});

test("a held pose's form: the engine's words never call an unmeasured hold good", () => {
  assert.equal(FALLBACK.hold_fault(FEET), FEET.cue);
  assert.match(FALLBACK.hold_fix({ fault: FEET.fault, label: FEET.label }), /^That's it\b/);
  assert.ok(FALLBACK.hold_fix({}).length <= 30, 'a short praise');
  assert.equal(FALLBACK.hold_start({ form: faulty }), FEET.cue);          // (the first open fault's cue)
  assert.equal(FALLBACK.hold_start({ form: fine }), 'Good, hold it there.');
  assert.ok(formFine(fine));
  // "Good" only when every check was measured and found nothing: none out of the frame (the user's ankles sat at
  // 0.95-0.98 of the picture's height, just past where a landmark counts as in it), none the view cannot judge, and
  // no fault measured and waiting its turn (it is told a second or two later)
  const notFine = [null, undefined, form({ checked: [], unseen: CHECKED }), form({ checked: [], wrongView: CHECKED }),
    form({ checked: ['top arm', 'trunk tilt'], unseen: ['stance width', 'long legs'] }),
    form({ checked: ['sitting back', 'chest up'], wrongView: ['ankle above the knee'] }),
    form({ pending: ['trunk tilt'] })];
  for (const f of notFine) {
    assert.equal(FALLBACK.hold_start({ form: f }), 'Hold it there.', JSON.stringify(f));
    assert.doesNotMatch(FALLBACK.hold_start({ form: f }), /good|right|correct|perfect/i, JSON.stringify(f));
    assert.ok(!formFine(f), JSON.stringify(f));
  }
});

test("a held pose's form: a fault measured while the hold's start is held back goes with it, once", () => {
  const now = { cur: { holding: true, form: fine } }, { told, settled, moveEvents } = page(now);
  moveEvents([ev('hold_start', 1000, { form: fine })], 4000);           // (told by the tracker 3 s into the hold)
  now.cur = { holding: true, form: faulty };
  moveEvents([ev('hold_fault', 5500, FEET)], 5500);
  moveEvents([], 7400);
  assert.deepEqual(told, [], 'held back SHORT_HOLD_MS + HOLD_SURE_MS');
  moveEvents([], 7600);
  assert.equal(told.length, 1);
  assert.equal(told[0].kind, 'hold_start');
  assert.deepEqual(told[0].form.open.map(f => f.fault), ['stance_narrow'], 'its form as it is when it goes');
  assert.equal(told[0].fallback, FEET.cue);
  assert.equal(told[0].movement, 'triangle_pose');
  // (the form's next correction timed from when the start went, not from the tracker's start 3 s into the hold)
  assert.deepEqual(settled, [7600]);
  // then a fix goes at once, praised; and the hold's end
  now.cur = { holding: true, form: fine };
  moveEvents([ev('hold_fix', 9000, { fault: FEET.fault, label: FEET.label })], 9000);
  now.cur = { holding: false };
  const summary = { checked: CHECKED, faults: [{ fault: FEET.fault, label: FEET.label, fixed: true, told: true }] };
  moveEvents([ev('hold_end', 20000, { seconds: 19, form: summary })], 21500);
  assert.deepEqual(told.map(e => e.kind), ['hold_start', 'hold_fix', 'hold_end']);
  assert.equal(told[1].label, FEET.label);
  assert.match(told[1].fallback, /^That's it\b/);
  assert.deepEqual(told[2].form.faults, [{ fault: FEET.fault, label: FEET.label, fixed: true, told: true }],
    'heard in the start, then fixed: praised');
  for (const e of told) assert.equal(e.type, undefined, 'the tracker\'s own fields stay out of the coach event');
});

test("a held pose's form: a fault goes no further than its hold's start", () => {
  // a short hold: dropped, with what waited
  let now = { cur: { holding: true, form: fine } }, p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: fine })], 4000);
  now.cur = { holding: true, form: faulty };
  p.moveEvents([ev('hold_fault', 4500, FEET)], 4500);
  now.cur = { holding: false };
  p.moveEvents([ev('hold_end', 5000, { seconds: 4 })], 5000);
  p.moveEvents([ev('hold_fix', 5100, { fault: FEET.fault, label: FEET.label })], 5100);
  assert.deepEqual(p.told, []);
  // a hold of 5 to 6.5 s: its end alone (its form: the hold's summary)
  now = { cur: { holding: true, form: fine } }; p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: fine })], 4000);
  p.moveEvents([ev('hold_fault', 4500, FEET)], 4500);
  now.cur = { holding: false };
  p.moveEvents([ev('hold_end', 6500, { seconds: 5.5 })], 6500);
  assert.deepEqual(p.told.map(e => e.kind), ['hold_end']);
  // a tracker without current().form: what waited goes right after the start, in order
  now = { cur: { holding: true } }; p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: fine })], 4000);
  p.moveEvents([ev('hold_fault', 5500, FEET)], 5500);
  p.moveEvents([], 7600);
  assert.deepEqual(p.told.map(e => e.kind), ['hold_start', 'hold_fault']);
  assert.equal(p.told[1].fallback, FEET.cue);
  // a movement without a form check: form null, and the hold is not called good
  now = { cur: { holding: true, form: null } }; p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: null })], 4000);
  p.moveEvents([], 7600);
  assert.equal(p.told[0].form, null);
  assert.equal(p.told[0].fallback, 'Hold it there.');
});

test("a held pose's form: the landmarks go to the tracker, its events are recorded, the fault shows aside", () => {
  assert.match(app, /tracker\.update\(f, t, \{ world: r\.world, image: r\.image, aspect: w \/ h \}\)/);
  // (the movement tracker's events in the recording too, not only auto mode's: update, lost and finish)
  assert.match(app, /tracker\.update\([^\n]+\n[^]*?catch[^\n]+\n\s+if \(S\.rec\) S\.rec\.events\.push\(\.\.\.evs\);/);
  assert.match(app, /tracker\?\.lost\(t\) \?\? \[\];[^]*?if \(S\.rec\) S\.rec\.events\.push\(\.\.\.evs\);/);
  assert.match(app,
    /tracker\?\.finish\(S\.lastFrameT\) \?\? \[\];\n\s+if \(S\.rec\) S\.rec\.events\.push\(\.\.\.ending\);/);
  // the Now card's form line: in the side panel's Now card, not over the camera view
  const at = html.indexOf('id="moveForm"');
  assert.ok(at > html.indexOf('<aside>') && at > html.indexOf('id="now"') && at < html.indexOf('id="demo"'),
    'in the Now card');
  assert.match(app, /raw = cue \?\? formLine\(st\.form\), el = \$\('moveForm'\)/);
});

// The Now card's form line (app.js moveStatus and formLine, taken as they are)
const statusSrc = app.slice(app.indexOf('function moveStatus('), app.indexOf('\n/** The Now card:'));
const { moveStatus, formLine } = new Function('S', 'mmss', 'formFine',
  `${statusSrc}\nreturn { moveStatus, formLine };`)({ lastFrameT: 0, statusText: () => 'Hold 0:05' }, String, formFine);

test("a held pose's form on the Now card: only once the coach was told the hold's start", () => {
  const x = { told: false, tracker: { current: () => ({ track: 'hold', holding: true, seconds: 5, form: faulty }) } };
  // (the tracker's timer runs from 1.5 s into the stillness, the start goes 6.5 s in: a fault nobody said yet, or a
  // pause the coach never hears of, shows nothing)
  assert.equal(moveStatus(x).form, null);
  x.told = true;
  assert.equal(moveStatus(x).form, faulty);
  // and through moveEvents: told once the start goes, not when the tracker told it; untold at the hold's end
  const now = { cur: { holding: true, form: faulty } }, p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: faulty })], 4000);
  assert.equal(p.x.told, false);
  assert.equal(moveStatus(p.x).form, null, 'held back: not shown');
  p.moveEvents([], 7600);
  assert.equal(p.x.told, true);
  now.cur = { holding: false };
  p.moveEvents([ev('hold_end', 20000, { seconds: 19 })], 21500);
  assert.equal(p.x.told, false);
});

test("a held pose's form on the Now card: the fault told, checked only when fine, and why a check was not made", () => {
  assert.equal(formLine(null), null);
  assert.equal(formLine(faulty).text, 'Form: feet too close together');
  assert.equal(formLine(faulty).cls, 'fault');
  assert.equal(formLine(faulty).title, `${FEET.measured} (aim for ${FEET.target})`);
  assert.deepEqual(formLine(fine), { cls: 'ok', text: 'Form checked', title: 'Checked for: stance width, top arm' });
  // a fault measured, waiting its turn: not "checked", and not shown before it is said
  const waits = formLine(form({ pending: ['trunk tilt'] }));
  assert.equal(waits.cls, 'pending');
  assert.equal(waits.text, 'Form: checking...');
  assert.doesNotMatch(waits.text, /checked|trunk/);
  // parts out of the frame: step back; a view that cannot judge it: turn (stepping back changes nothing)
  assert.deepEqual(formLine(form({ checked: [], unseen: CHECKED })),
    { cls: 'unseen', text: 'Form not checked: step back so I can see all of you',
      title: 'Not checked: stance width (out of the frame), top arm (out of the frame)' });
  assert.equal(formLine(form({ checked: [], wrongView: CHECKED })).text, 'Form not checked: turn to face the camera');
  const partly = formLine(form({ checked: ['top arm', 'trunk tilt'], unseen: ['stance width', 'long legs'] }));
  assert.equal(partly.cls, 'unseen');
  assert.equal(partly.text, 'Form partly checked: step back so I can see all of you');
  assert.equal(partly.title,
    'Checked for: top arm, trunk tilt. Not checked: stance width (out of the frame), long legs (out of the frame)');
  // (the figure-four seen from the side, as the library's own footage of it: its ankle check needs the front)
  const side = formLine(form({ checked: ['sitting back', 'chest up'], wrongView: ['ankle above the knee'] }));
  assert.equal(side.text, 'Form partly checked: turn to face the camera');
  assert.match(side.title, /ankle above the knee \(needs the camera in front\)/);
  assert.equal(formLine(form({ checked: ['chest up'], unseen: ['sitting back'], wrongView: ['ankle above the knee'] }))
    .text, 'Form partly checked: turn to face the camera and step back so I can see all of you');
  assert.equal(formLine(form({ pending: ['trunk tilt'], unseen: ['stance width'] })).text,
    'Form: checking... (step back so I can see all of you)');
  assert.equal(formLine(form({ checked: [] })), null);
});

test("a held pose's form: a fix folded into the start is not praised, a fault waiting its turn not called fine", () => {
  // the tracker told the start 3 s into the hold with the top arm open; the arm was fixed at 5.4 s, while the start
  // waited, and the trunk's fault waits AFTER_FIX_MS to be told
  const now = { cur: { holding: true, form: form({ open: [TOP_ARM] }) } }, p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: now.cur.form })], 4000);
  now.cur = { holding: true, form: form({ checked: ['stance width', 'top arm'], pending: ['trunk tilt'] }) };
  p.moveEvents([ev('hold_fix', 6400, { fault: TOP_ARM.fault, label: TOP_ARM.label })], 6400);
  p.moveEvents([], 7600);
  assert.deepEqual(p.told.map(e => e.kind), ['hold_start'], 'the fix is in the start, not said');
  assert.deepEqual(p.told[0].form.open, []);
  assert.deepEqual(p.told[0].form.pending, ['trunk tilt'], 'the start carries the fault waiting its turn');
  assert.equal(p.told[0].fallback, 'Hold it there.', 'never "Good" with a fault about to be told');
  // the trunk's fault is told; at the hold's end the coach hears only of what it heard: the arm's fix it never
  // mentioned is left out (no praise for it), the trunk's fault was told, and a fault still there never said is not
  now.cur = { holding: true, form: form({ open: [TRUNK] }) };
  p.moveEvents([ev('hold_fault', 9000, TRUNK)], 9000);
  now.cur = { holding: false };
  const faults = [{ fault: 'top_arm', label: TOP_ARM.label, fixed: true, told: true },
    { fault: 'trunk_tilt', label: TRUNK.label, fixed: false, told: true },
    { fault: 'knees', label: 'knee bent', fixed: false, told: false }];
  p.moveEvents([ev('hold_end', 20000, { seconds: 19, form: { checked: ['stance width'], faults } })], 21500);
  assert.deepEqual(p.told.map(e => e.kind), ['hold_start', 'hold_fault', 'hold_end']);
  assert.deepEqual(p.told[2].form.faults, [{ fault: 'trunk_tilt', label: TRUNK.label, fixed: false, told: true },
    { fault: 'knees', label: 'knee bent', fixed: false, told: false }]);
  assert.deepEqual(p.told[2].form.checked, ['stance width']);
  assert.equal(faults[0].told, true, "(the tracker's own summary is left as it is)");
  // a hold whose start never went (5 to 6.5 s): nothing heard, so a fix is not praised and a fault is not told
  now.cur = { holding: true, form: form({ open: [TOP_ARM] }) };
  const q = page(now);
  q.moveEvents([ev('hold_start', 1000, { form: now.cur.form })], 4000);
  now.cur = { holding: false };
  q.moveEvents([ev('hold_end', 6500, { seconds: 5.5, form: { checked: [], faults: faults.slice(0, 2) } })], 6500);
  assert.deepEqual(q.told[0].form.faults, [{ fault: 'trunk_tilt', label: TRUNK.label, fixed: false, told: false }]);
});

test("a held pose's form: the correction after the start's comes NEXT_MS after the page told the start", () => {
  // the real HoldForm behind a stand-in tracker that tells the start 3 s into the hold (as moves.js HOLD_TOLD_MS,
  // settling the form then) and passes the form's events on after it. The feet are too close from the start (told
  // with it), the top arm off from 2 s: its correction waits NEXT_MS from when the start was heard, 6.5 s in (the
  // user's recording had it 4.5 s after the first one spoken)
  const hf = new HoldForm({ key: 'triangle_pose' });
  const tracker = { current: () => ({ holding: true, form: hf.state() }), settle: t => hf.settle(t) };
  const p = page(null, tracker), seen = { legs: true, arms: true, trunk: true, topArm: true };
  let started = false;
  for (let t = 0; t <= 16000; t += 33) {
    const m = { view: 'front', seen, stance: 0.45, kneeMin: 170, topArmFromUp: t < 2000 ? 10 : 40, trunkTilt: 60,
      armsLine: 165, chestDown: 10 };
    const evs = [];
    for (const { type, ...e } of hf.update(m, t)) if (started) evs.push(ev(type, t, e));
    if (!started && t >= 3000) { started = true; hf.settle(t); evs.push(ev('hold_start', 0, { form: hf.state() })); }
    p.moveEvents(evs, t);
  }
  const start = p.told.find(e => e.kind === 'hold_start'), next = p.told.find(e => e.kind === 'hold_fault');
  assert.ok(start && start.at >= 6500 && start.at < 6600, `the start at ${start?.at}`);
  assert.equal(start.form.open[0]?.fault, 'stance', 'the start carries the feet');
  assert.equal(start.fallback, "Step your feet wider, about a leg's length apart.");
  assert.ok(next, 'the top arm is told');
  assert.equal(next.fault, 'top_arm');
  assert.ok(next.at >= start.at + FORM_TUNING.NEXT_MS, `told at ${next.at}, the start at ${start.at}`);
});

// A held pose's fault shown aside (app.js holdCheck, showHold): told to the coach, it shows in the side panel's form
// check ("You": the last seconds replayed, the part in red; "Like this": the movement's reference pose), and goes on
// its fix or the hold's end. The panel's words and the library's reference (app.js, taken as they are)
test("a held pose's form check: shown aside when the coach is told the fault, on what the coach heard", () => {
  const now = { cur: { holding: true, form: faulty } }, p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: faulty })], 4000);
  assert.deepEqual(p.aside, [], 'not while the start is held back');
  p.moveEvents([], 7600);
  assert.deepEqual(p.aside.map(a => [a.type, a.t, a.m.key]), [['hold_start', 7600, 'triangle_pose']]);
  assert.equal(p.aside[0].e.form.open[0].fault, FEET.fault, 'the fault the start carries');
  now.cur = { holding: true, form: form({ open: [TOP_ARM, FEET] }) };
  p.moveEvents([ev('hold_fault', 16000, { ...TOP_ARM, part: 'arm', side: 'right' })], 16000);
  assert.equal(p.aside[1].type, 'hold_fault');
  assert.deepEqual([p.aside[1].e.fault, p.aside[1].e.part, p.aside[1].e.side], ['top_arm', 'arm', 'right']);
  now.cur = { holding: false };
  p.moveEvents([ev('hold_end', 20000, { seconds: 19 })], 21500);
  assert.deepEqual(p.aside.map(a => a.type), ['hold_start', 'hold_fault', 'hold_end']);
  // a fault in a hold whose start never went: never shown (nor told)
  const q = page({ cur: { holding: true, form: faulty } });
  q.moveEvents([ev('hold_start', 1000, { form: faulty }), ev('hold_fault', 4500, FEET)], 4500);
  q.moveEvents([ev('hold_end', 5000, { seconds: 4 })], 5000);
  assert.deepEqual(q.aside, []);
  // in the page: the panel is the exercises' (#demo, in the side panel), with a canvas for the reference pose
  const at = html.indexOf('id="likeCanvas"');
  assert.ok(at > html.indexOf('id="demo"') && at > html.indexOf('<aside>'), 'in the side panel\'s form check');
  const again = html.indexOf('id="holdAgain"');
  assert.ok(again > html.indexOf('id="now"') && again < html.indexOf('id="demo"'), '"See it again" in the Now card');
  assert.match(app, /holdCheck\(type, rest, m, t\);/);
  // (the panel's 3D button: the mistake it shows, automatic or opened from the Mistakes list)
  assert.match(app, /\$\('demo3d'\)\.addEventListener\('click', \(\) => open3D\(S\.form\?\.three\)\)/);
});

const holdSrc = app.slice(app.indexOf('const cap = '), app.indexOf('\n/** The coach was told an event'));
const holdFns = S => new Function('S',
  `${holdSrc}\nreturn { holdCaption, holdDetail, workingSide, refPose, heldOf };`)(S);

test("a held pose's form check: the fault's words, the library's reference pose and held part", () => {
  const { holdCaption, holdDetail, refPose, heldOf } = holdFns({});
  assert.equal(holdCaption(FEET), 'Feet too close together: feet 0.45 leg lengths apart');
  assert.equal(holdDetail(FEET), "Step your feet wider, about a leg's length apart. Aim for about one leg length.");
  assert.equal(holdCaption({ fault: 'stance' }), 'Stance');
  assert.equal(holdDetail({ cue: 'Stand tall.' }), 'Stand tall.');
  // the reference: 33 landmarks [x, y] (library.json pose.image), drawn as the user's (visibility 1); none built, or
  // anything else: none, and "You" shows alone
  const image = Array.from({ length: 33 }, (_, i) => [0.4 + i / 100, 0.2 + i / 50]);
  assert.deepEqual(refPose({ pose: { image, side: 'left' } })[5], { x: image[5][0], y: image[5][1], visibility: 1 });
  const bad = [{}, null, { pose: {} }, { pose: { image: image.slice(0, 20) } },
    { pose: { image: [...image.slice(1), [NaN, 0]] } }];
  for (const m of bad) {
    assert.equal(refPose(m), null, JSON.stringify(m));
  }
  assert.deepEqual(heldOf({ held: { start: 1.2, end: 3.4 } }), { start: 1.2, end: 3.4 });
  for (const held of [undefined, null, { start: 2 }, { start: 3, end: 2 }]) assert.equal(heldOf({ held }), null);
});

test("a held pose's form check: the reference turned to the user's working side, as the library finds its own", () => {
  // holdform.js poseMetrics on the user's frames: the triangle's front leg, the other poses' lifted leg; what most
  // frames say (none measured: null, and the reference is not turned)
  const S = { aspect: 16 / 9, poseMetrics: w => (w.front ? { front: w.front, lift: w.lift } : null) };
  const { workingSide } = holdFns(S);
  const fr = (front, lift) => ({ world: { front, lift }, image: [] });
  assert.equal(workingSide('triangle_pose', [fr('R', 'L'), fr('R', 'L'), fr('L', 'L')]), 'right');
  assert.equal(workingSide('quad_stretch', [fr('R', 'L'), fr('R', 'L'), fr('L', 'R')]), 'left');
  assert.equal(workingSide('figure_four_balance', [fr('R', 'R')]), 'right');
  assert.equal(workingSide('triangle_pose', [fr(null), { world: null, image: null }]), null);
  assert.equal(holdFns({}).workingSide('triangle_pose', [fr('R', 'L')]), null, 'holdform.js not loaded');
  // and the build's own (tools/build_moves.mjs): with the same measures, for the same keys
  assert.match(app, /const WORKING = \{ triangle_pose: 'front' \};/);
});

test("a held pose's form check: put away a moment after its fault's fix, at the hold's end; a later fault replaces it",
  () => {
    const src = app.slice(app.indexOf('function holdCheck('), app.indexOf('\n/** The panel for the fault'));
    const calls = [], timers = [], S = { form: null, demoTimer: null };
    const holdCheck = new Function('S', 'showHold', 'hideForm', 'setTimeout', 'clearTimeout', 'performance',
      'HOLD_FIXED_MS', `${src}\nreturn holdCheck;`)(S,
      (m, f, t) => { calls.push(['show', f.fault, t]); S.form = { library: true, code: f.fault, at: t }; return true; },
      () => { calls.push(['hide']); S.form = null; }, (fn, ms) => { timers.push(ms); return fn; }, () => {},
      { now: () => S.now }, 1500);
    holdCheck('hold_start', { form: form() }, TRIANGLE, 1000);
    assert.deepEqual(calls, [], 'a start with nothing open: nothing shown');
    holdCheck('hold_start', { form: faulty }, TRIANGLE, 7600);
    holdCheck('hold_fix', { fault: TOP_ARM.fault }, TRIANGLE, 8000);
    assert.deepEqual(timers, [], "another fault's fix: no change");
    S.now = 8100;
    holdCheck('hold_fix', { fault: FEET.fault }, TRIANGLE, 8100);
    assert.deepEqual(timers, [2000], 'up 2.5 s before it goes (as a clean rep)');
    S.now = 20000;
    holdCheck('hold_fault', { ...TOP_ARM, part: 'arm', side: 'left' }, TRIANGLE, 20000);
    S.now = 30000;
    holdCheck('hold_fix', { fault: TOP_ARM.fault }, TRIANGLE, 30000);
    assert.equal(timers.at(-1), 1500, 'up long enough: HOLD_FIXED_MS after the fix');
    holdCheck('hold_end', { seconds: 30 }, TRIANGLE, 31000);
    holdCheck('hold_end', { seconds: 30 }, TRIANGLE, 31000);
    assert.deepEqual(calls, [['show', FEET.fault, 7600], ['show', TOP_ARM.fault, 20000], ['hide']]);
  });

// --- the Mistakes list: every mistake the form check shows in a workout is kept (S.mistakes, and the recording's
// `mistakes`), listed in the Workout card newest first, shown again pinned (no timer, not put away by a fix or a hold's
// end) until closed or another is shown, cleared only when the next workout starts; a saved workout's can be reviewed,
// derived from its events if it was saved before they were kept. app.js from FORM_MS to the engine's form events,
// taken as it is, on a stand-in page: elements by id, a canvas player, a clock and timers
class El {
  constructor(id = null, tag = 'div') {
    Object.assign(this, { id, tag, children: [], textContent: '', className: '', title: '', style: {}, value: '',
      disabled: false, hidden: false, checked: false, options: [], listeners: {} });
    const cls = new Set();
    this.classList = { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
      contains: c => cls.has(c) };
  }
  append(...k) { this.children.push(...k); }
  replaceChildren(...k) { this.children = k; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click ?? []) fn(); }
  add(o, at = this.options.length) { this.options.splice(at, 0, o); }
  pause() {} play() { return Promise.resolve(); } scrollIntoView() {}
}
class Replay {
  constructor(canvas) { this.canvas = canvas; this.frames = null; this.image = null; this.opts = null; }
  play(frames, opts = {}) { this.frames = frames; this.opts = opts; return frames.filter(f => f.image).length >= 2; }
  show(image, opts = {}) { this.image = image; this.opts = opts; return true; }
  stop() { this.frames = null; this.image = null; }
}
const formSrc = app.slice(app.indexOf('\nconst FORM_MS'), app.indexOf('\n/** Form events from the engine'));
const DEPS = { EXERCISES, bonesFor, describeFault, mirrorImage, mirrorSide, ...Mistakes };
function formPage({ demos = {}, library = new Map(), fetch = null } = {}) {
  const els = new Map(), $ = id => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); };
  $('useDemos').checked = true;
  $('youCanvas').parentElement = new El(null, 'figure');           // ("You": the canvas and its label, in a figure)
  $('reviewPick').options = [{ text: 'This workout', value: '' }];
  const clock = { now: 0 }, timers = new Map(), logs = [], opened = [], replays = [];
  let n = 0;
  const S = { running: true, trail: [], demos, aspect: 16 / 9, form: null, demoTimer: null, lastFrameT: 0, t0: 0,
    libByKey: library, rec: null, poseMetrics: null, startedAt: '2026-01-15T12:00:00.000Z' };
  const env = { HOSTED: false, S, $, document: { createElement: tag => new El(null, tag) },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    RepReplay: class extends Replay { constructor(c) { super(c); replays.push(this); } },
    modelFor: () => '/demos/ybot.glb', log: (m, cls) => logs.push([m, cls]), performance: { now: () => clock.now },
    setTimeout: (fn, ms) => { timers.set(++n, { fn, at: clock.now + ms }); return n; },
    clearTimeout: id => timers.delete(id), open3D: form => opened.push(form), fetch,
    libraryReady: Promise.resolve(), holdformReady: Promise.resolve(), ...DEPS };
  const fns = new Function(...Object.keys(env), `${formSrc}\nreturn { formCheck, hideForm, cleanRep, holdCheck,
    showHold, showForm, threeOf, keepMistake, resetMistakes, renderMistakes, pinMistake, reviewSaved,
    savedWorkouts };`)(...Object.values(env));
  const advance = ms => {
    clock.now += ms;
    for (const [id, x] of [...timers]) if (x.at <= clock.now) { timers.delete(id); x.fn(); }
  };
  const rows = () => $('mistakeList').children.map(({ children: [when, text, acts] }) => ({ when: when.textContent,
    what: text.children[0].textContent, label: text.children[1].textContent,
    measured: text.children[2]?.textContent ?? '', show: acts.children[0], d3: acts.children[1] }));
  const marked = () => $('mistakeList').children.map(r => r.className.includes(' on'));
  return { S, $, fns, logs, opened, timers, advance, rows, marked, you: () => replays[0], like: () => replays[1] };
}
/** The page's frames every 33 ms from `from` to `to` (ms), as MediaPipe gives them. */
const pageFrames = (from, to) => {
  const out = [];
  for (let t = from; t <= to; t += 33) {
    out.push({ t, image: Array.from({ length: 33 }, (_, i) => ({ x: 0.4 + i / 200, y: 0.1 + i / 50, z: 0,
      visibility: 0.9 })), world: Array.from({ length: 33 }, (_, i) => ({ x: i / 100, y: -i / 60, z: 0 })) });
  }
  return out;
};
const SQUAT_DEMO = { url: '/demos/squat.webm', segment: { start: 0, end: 2 }, avoidFor: ['knees_in'],
  modelUrl: '/demos/squat.glb', credit: { short: 'demo credit' } };
const SHALLOW = { code: 'shallow', part: 'hips', message: 'Go deeper', value: 125 };
const KNEES_IN = { code: 'knees_in', part: 'knees', message: 'Knees out', value: 0.8 };
const HEEL = { fault: 'heel', label: 'heel far from the glute', measured: 'bent knee at 100 degrees',
  target: 'heel close to the glute', cue: 'Pull your heel in.', part: 'knee', side: 'left' };
const QUAD = { key: 'quad_stretch', display: 'Quad stretch', kind: 'hold', track: 'hold', glb: 'glb/quad_stretch.glb',
  held: { start: 1, end: 2 }, pose: { side: 'right', image: Array.from({ length: 33 }, (_, i) => [0.5, i / 40]) } };

test('the Mistakes list: every mistake the form check shows is kept, with its frames, when and its "Like this"', () => {
  const p = formPage({ demos: { squat: SQUAT_DEMO } }), { S, fns } = p;
  S.trail = pageFrames(0, 12000); S.rec = { mistakes: [] }; S.lastFrameT = 5000;
  const rep = { faults: [KNEES_IN, SHALLOW], t: 4800, window: { start: 4000, end: 5000 }, side: null };
  assert.equal(fns.formCheck('squat', rep), true, 'its demo, for the fault the demo itself does not have');
  assert.equal(S.mistakes.size, 1);
  const m = S.mistakes.items[0];
  assert.deepEqual([m.kind, m.exercise, m.what, m.fault, m.demo, m.t, m.at], ['exercise', 'squat', 'Squat', SHALLOW,
    SQUAT_DEMO, 5000, 5]);
  assert.deepEqual(m.frames, S.trail.filter(x => x.t >= 3850 && x.t <= 5150), 'the frames shown as "Your rep"');
  assert.notEqual(m.frames, S.trail);
  assert.deepEqual(m.window, { start: m.frames[0].t, end: m.frames.at(-1).t });
  assert.equal(p.you().frames, m.frames, 'shown as it is kept');
  // the recording keeps it without its frames
  assert.deepEqual(S.rec.mistakes, [Mistakes.recordOf(m)]);
  assert.ok(!('frames' in S.rec.mistakes[0]) && S.rec.mistakes[0].window.start === m.frames[0].t);
  // the same fault within 3 s: the panel stays as it is, nothing new; then again: a new one
  p.advance(1000); S.lastFrameT = 6000;
  fns.formCheck('squat', { ...rep, t: 5800 });
  assert.equal(S.mistakes.size, 1);
  p.advance(3000); S.lastFrameT = 9000;
  fns.formCheck('squat', { ...rep, t: 8800, window: { start: 8000, end: 9000 } });
  assert.equal(S.mistakes.size, 2);
  // a held pose's fault: kept with its movement (its reference pose: "Like this"), and the user's working side
  S.lastFrameT = 11000;
  assert.equal(fns.showHold(QUAD, HEEL, 11000), true);
  const h = S.mistakes.items[2];
  assert.deepEqual([h.kind, h.movement, h.what, h.entry, h.fault, h.side, h.at],
    ['hold', 'quad_stretch', 'Quad stretch', QUAD, HEEL, 'left', 11]);
  assert.deepEqual(h.frames, S.trail.filter(x => x.t > 9000 && x.t <= 11000));
  assert.ok(p.$('demo').classList.contains('pose') && p.like().image, 'its reference pose drawn');
  assert.deepEqual(S.rec.mistakes[2], Mistakes.recordOf(h));
  assert.equal(S.rec.mistakes[2].movement, 'quad_stretch');
  // "See it again" (the same fault, still there) is not a new one; told again after its fix, it is
  fns.showHold(QUAD, HEEL, 11500, { again: true });
  assert.equal(S.mistakes.size, 3);
  fns.holdCheck('hold_fix', { fault: 'heel' }, QUAD, 11800);
  S.lastFrameT = 12000;
  fns.holdCheck('hold_fault', HEEL, QUAD, 12000);
  assert.equal(S.mistakes.size, 4);
  // the list: newest first, when into the workout, what, the fault and its measurement
  assert.deepEqual(p.rows().map(r => [r.when, r.what, r.label]), [['0:12', 'Quad stretch', 'Heel far from the glute'],
    ['0:11', 'Quad stretch', 'Heel far from the glute'], ['0:09', 'Squat', 'Go deeper'],
    ['0:05', 'Squat', 'Go deeper']]);
  assert.equal(p.rows()[0].measured, 'bent knee at 100 degrees');
  assert.match(p.rows()[3].measured, /^Your knees bent to 125°/);
  assert.equal(p.$('mistakesOf').textContent, 'This workout');
  // 3D: the stored frames, as the 3D view takes them
  p.rows()[3].d3.click();
  assert.equal(p.opened.length, 1);
  assert.deepEqual([p.opened[0].exercise, p.opened[0].fault, p.opened[0].turn, p.opened[0].demo, p.opened[0].frames],
    ['squat', SHALLOW, 4800, SQUAT_DEMO, m.frames]);
  p.rows()[0].d3.click();
  assert.deepEqual([p.opened[1].library, p.opened[1].key, p.opened[1].demo.model, p.opened[1].demo.segment],
    [true, 'quad_stretch', '/moves/glb/quad_stretch.glb', { start: 1, end: 2 }]);
  // no workout running: nothing shown, nothing kept
  S.running = false;
  assert.equal(fns.formCheck('squat', { ...rep, t: 20000 }), false);
  assert.equal(fns.showHold(QUAD, HEEL, 12000), false);
  assert.equal(S.mistakes.size, 4);
});

test('the Mistakes list: a long workout keeps the latest, and says how many were left out', () => {
  const p = formPage(), { S, fns } = p;
  S.mistakes = new Mistakes.MistakeList(3);
  for (let i = 1; i <= 5; i++) {
    S.lastFrameT = i * 1000;
    fns.keepMistake({ kind: 'hold', movement: 'quad_stretch', what: 'Quad stretch', fault: HEEL, side: 'left',
      frames: pageFrames(i * 1000 - 500, i * 1000) });
  }
  assert.deepEqual(p.rows().map(r => r.when), ['0:05', '0:04', '0:03']);
  assert.equal(p.$('mistakesLeft').textContent, '2 earlier mistakes are not listed (the list keeps the last 3)');
  S.mistakes = new Mistakes.MistakeList(3);
  fns.renderMistakes();
  assert.equal(p.$('mistakesLeft').textContent, '', '(none left out: nothing said)');
});

test('the Mistakes list: Show pins it (no timer; a fix, a clean rep or the hold\'s end leaves it) until closed', () => {
  const p = formPage({ demos: { squat: SQUAT_DEMO } }), { S, fns } = p, demo = p.$('demo');
  S.trail = pageFrames(0, 30000); S.lastFrameT = 5000;
  fns.formCheck('squat', { faults: [SHALLOW], t: 4800, window: { start: 4000, end: 5000 } });
  S.lastFrameT = 9000;
  fns.showHold(QUAD, HEEL, 9000);
  const [rep, hold] = S.mistakes.items;
  assert.deepEqual(p.marked(), [false, false], 'one shown as it happens: no row marked (only one opened from it)');
  // the workout stops: the automatic panel goes as today, the list stays
  S.running = false;
  fns.hideForm();
  assert.ok(!demo.classList.contains('show'));
  assert.equal(p.rows().length, 2);
  assert.deepEqual(p.marked(), [false, false]);
  // Show: pinned, after the workout too, its replay looping (RepReplay loops what it plays)
  p.rows()[1].show.click();
  assert.ok(demo.classList.contains('show') && demo.classList.contains('pinned'));
  assert.deepEqual([S.form.pinned, S.form.mistake], [true, rep]);
  assert.equal(p.you().frames, rep.frames);
  assert.equal(p.$('demoWhen').textContent, 'Mistake at 0:05 · Squat');
  assert.equal(p.$('demoCaption').textContent, 'Go deeper');
  assert.deepEqual(p.marked(), [false, true], 'its row marked');
  assert.deepEqual([...p.timers.values()].filter(x => x.fn === fns.hideForm), [], 'no timer puts it away');
  p.advance(60000);
  fns.cleanRep('squat'); fns.hideForm();
  fns.holdCheck('hold_fix', { fault: 'heel' }, QUAD, 0); fns.holdCheck('hold_end', { seconds: 20 }, QUAD, 0);
  p.advance(60000);
  assert.ok(demo.classList.contains('show') && S.form?.mistake === rep, 'still there');
  // showing another replaces it
  p.rows()[0].show.click();
  assert.equal(S.form.mistake, hold);
  assert.ok(demo.classList.contains('pose') && p.$('youLabel').textContent === 'You');
  assert.equal(p.$('demoWhen').textContent, 'Mistake at 0:09 · Quad stretch');
  fns.holdCheck('hold_end', { seconds: 20 }, QUAD, 0);
  assert.equal(S.form?.mistake, hold, "a hold's end leaves it");
  // Close
  p.$('demoClose').click();
  assert.ok(!demo.classList.contains('show') && !demo.classList.contains('pinned'));
  assert.equal(S.form, null);
  assert.deepEqual(p.marked(), [false, false]);
  // while a workout runs, a new fault shows over a pinned one as it always did (the pinned one's fault too), and is
  // kept; when it goes (after FORM_MS, its fix, the hold's end, Stop) the pinned one is back as it was
  S.running = true;
  p.rows()[1].show.click();
  S.lastFrameT = 10000;
  fns.formCheck('squat', { faults: [SHALLOW], t: 9800, window: { start: 9000, end: 10000 } });
  assert.equal(S.mistakes.size, 3);
  assert.deepEqual([S.form.pinned, S.form.mistake], [false, S.mistakes.items[2]]);
  assert.deepEqual(p.marked(), [false, false, false], "(the pinned one's row unmarked while it is covered)");
  p.advance(10000);
  const pinnedRep = () => demo.classList.contains('show') && demo.classList.contains('pinned') && S.form?.pinned
    && S.form.mistake === rep && p.you().frames === rep.frames && p.$('demoWhen').textContent === 'Mistake at 0:05 · Squat';
  assert.ok(pinnedRep(), 'after FORM_MS: the pinned one back');
  assert.deepEqual(p.marked(), [false, false, true]);
  assert.deepEqual([...p.timers.values()].filter(x => x.fn === fns.hideForm), [], '(no timer on it)');
  // the user's quad stretch: a held pose's fault told, and the hold's end in the same frame
  S.lastFrameT = 12000;
  fns.holdCheck('hold_fault', HEEL, QUAD, 12000);
  assert.deepEqual([S.form.pinned, S.form.mistake], [false, S.mistakes.items[3]]);
  fns.holdCheck('hold_end', { seconds: 15 }, QUAD, 12000);
  assert.ok(pinnedRep(), "the hold's end: the pinned one back");
  // its fix (a moment after); Stop
  S.lastFrameT = 15000;
  fns.holdCheck('hold_fault', HEEL, QUAD, 15000);
  p.advance(3000);
  fns.holdCheck('hold_fix', { fault: 'heel' }, QUAD, 18000);
  assert.ok(!pinnedRep());
  p.advance(1500);
  assert.ok(pinnedRep(), 'its fix: the pinned one back');
  S.lastFrameT = 19000;
  fns.formCheck('squat', { faults: [KNEES_IN], t: 18800, window: { start: 18000, end: 19000 } });
  S.running = false;
  fns.hideForm();
  assert.ok(pinnedRep(), 'Stop: the pinned one back');
  // the 3 s check is the automatic showing's, not the panel's: the mistake just shown opened from the list, the same
  // fault a second later is not shown again over it, nor kept again
  S.running = true;
  p.$('demoClose').click();
  p.advance(5000); S.lastFrameT = 25000;
  fns.formCheck('squat', { faults: [SHALLOW], t: 24800, window: { start: 24000, end: 25000 } });
  const shown = S.mistakes.items.at(-1), n = S.mistakes.size;
  p.rows()[0].show.click();
  assert.deepEqual([S.form.pinned, S.form.mistake], [true, shown]);
  p.advance(1000); S.lastFrameT = 26000;
  fns.formCheck('squat', { faults: [SHALLOW], t: 25800, window: { start: 25000, end: 26000 } });
  assert.deepEqual([S.mistakes.size, S.form.pinned, S.form.mistake], [n, true, shown]);
  // another one opened over one shown as it happens: the pinned one before is gone for good (Close: nothing back)
  p.advance(5000); S.lastFrameT = 27000;
  fns.formCheck('squat', { faults: [KNEES_IN], t: 26800, window: { start: 26000, end: 27000 } });
  p.rows().at(-1).show.click();
  assert.equal(S.form.mistake, rep);
  p.$('demoClose').click();
  p.advance(20000);
  assert.ok(!demo.classList.contains('show') && S.form === null);
  assert.deepEqual(p.marked(), p.rows().map(() => false));
});

test('the form check: a mistake with nothing tracked to replay shows without "You", and blanks no panel', async () => {
  // ("You" is the canvas's own figure in the page: the one left out)
  assert.match(html, /<figure><figcaption id="youLabel">[^<]*<\/figcaption>\s*<canvas id="youCanvas"[^>]*>/);
  assert.match(html, /<canvas id="youCanvas"[^>]*><\/canvas><\/figure>/);
  const p = formPage({ demos: { squat: SQUAT_DEMO }, library: new Map([['quad_stretch', QUAD]]) }), { S, fns } = p;
  const demo = p.$('demo'), you = () => !p.$('youCanvas').parentElement.hidden;
  S.trail = pageFrames(0, 6000); S.lastFrameT = 5000;
  fns.formCheck('squat', { faults: [SHALLOW], t: 4800, window: { start: 4000, end: 5000 } });
  const rep = S.mistakes.items[0];
  p.rows()[0].show.click();
  assert.ok(you() && p.you().frames === rep.frames && S.form.pinned, 'pinned, its replay looping');
  // a held pose's fault told as the user stepped out of view (its last 2 s: frames without landmarks): its words and
  // reference over the pinned one, without "You"; kept. RepReplay.play is never given them (it clears the canvas)
  S.trail.push(...pageFrames(6033, 9000).map(f => ({ ...f, image: null, world: null })));
  S.lastFrameT = 9000;
  assert.equal(fns.showHold(QUAD, HEEL, 9000), true, 'shown');
  const hold = S.mistakes.items[1];
  assert.deepEqual([S.mistakes.size, S.form.mistake, S.form.pinned, S.under], [2, hold, false, rep]);
  assert.ok(!you() && p.you().frames !== hold.frames, '"You" left out, not blank');
  assert.equal(p.$('demoCaption').textContent, 'Heel far from the glute: bent knee at 100 degrees');
  assert.equal(p.$('demoDetail').textContent, 'Pull your heel in. Aim for heel close to the glute.');
  assert.ok(demo.classList.contains('pose') && !demo.classList.contains('alone') && p.like().image, 'its reference');
  assert.equal(p.$('demo3d').style.display, 'none', '(nothing to see in 3D either)');
  assert.match(p.logs.at(-1)[0], /^form check: Quad stretch, heel far from the glute .*\(nothing tracked to replay\)$/);
  // when it goes, the pinned one is back as it was: "You" replaying its frames
  p.advance(10000);
  assert.ok(S.form.pinned && S.form.mistake === rep && you() && p.you().frames === rep.frames);
  // Show on a saved workout's mistakes whose windows have no frames (the recording's end cut off): pinned, the words
  // and what "Like this" has, without "You"; with no demo either, the cue alone. None is an error
  S.running = false;
  const rec = { source: 'camera', width: 1280, height: 720, frames: pageFrames(1000, 4000).map(f => ({ t: f.t,
    image: f.image.map(q => [q.x, q.y, q.z, 0.9]), world: f.world.map(q => [q.x, q.y, q.z]) })), mistakes: [
    { t: 4000, at: 3, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch', ...HEEL,
      window: { start: 2000, end: 4000 } },
    { t: 12000, at: 11, kind: 'hold', what: 'Quad stretch', movement: 'quad_stretch', ...HEEL,
      window: { start: 10000, end: 12000 } },
    { t: 21000, at: 20, kind: 'exercise', what: 'Squat', exercise: 'squat', turn: 20800, ...KNEES_IN, side: null,
      window: { start: 20000, end: 21000 } }] };
  const q = formPage({ demos: { squat: SQUAT_DEMO }, library: new Map([['quad_stretch', QUAD]]),
    fetch: async () => ({ ok: true, json: async () => rec }) });
  const qdemo = q.$('demo'), qyou = () => !q.$('youCanvas').parentElement.hidden;
  q.S.running = false;
  await q.fns.reviewSaved('live-20000115120000-auto');
  assert.deepEqual(q.rows().map(r => r.when), ['0:20', '0:11', '0:03']);
  q.rows()[2].show.click();
  assert.ok(qyou() && q.you().frames.length > 2, 'one with frames: replayed');
  q.rows()[1].show.click();
  assert.ok(qdemo.classList.contains('show') && q.S.form.pinned && q.S.form.mistake === q.S.review.list.items[1]);
  assert.ok(!qyou() && q.you().frames === null, 'without "You" (the one before stopped, not blanked)');
  assert.equal(q.$('demoWhen').textContent, 'Mistake at 0:11 of the saved workout · Quad stretch');
  assert.equal(q.$('demoCaption').textContent, 'Heel far from the glute: bent knee at 100 degrees');
  assert.ok(qdemo.classList.contains('pose') && !qdemo.classList.contains('alone') && q.like().image);
  q.rows()[0].show.click();
  assert.deepEqual([qyou(), qdemo.classList.contains('nodemo'), qdemo.classList.contains('alone')], [false, true, true],
    'a rep without frames or a demo: the cue alone');
  assert.deepEqual([q.$('demoCaption').textContent, q.$('demoDetail').textContent], ['Knees out',
    describeFault('squat', KNEES_IN)]);
  assert.deepEqual(q.logs.filter(([, cls]) => cls === 'err'), []);
  q.rows()[2].show.click();
  assert.ok(qyou() && !qdemo.classList.contains('alone') && q.you().frames.length > 2, '"You" again');
});

test('the Mistakes list: cleared only when the next workout starts; the recording keeps them', () => {
  const p = formPage(), { S, fns } = p;
  S.trail = pageFrames(0, 6000); S.lastFrameT = 5000;
  fns.showHold(QUAD, HEEL, 5000);
  p.rows()[0].show.click();
  S.review = { id: 'live-20000115120000-auto', list: new Mistakes.MistakeList() };
  p.$('reviewPick').value = 'live-20000115120000-auto';
  fns.resetMistakes();
  assert.deepEqual([S.mistakes.size, S.mistakes.left, S.review, p.$('reviewPick').value, S.form],
    [0, 0, null, '', null]);
  assert.ok(!p.$('demo').classList.contains('show'), 'a mistake shown pinned goes too');
  assert.equal(S.t0, undefined, 'the next workout is timed from its own first frame');
  // in the page: when the next workout actually starts (a start that fails keeps the last one), not at Stop (the list
  // stays after the summary); the frames' clock starts at the workout's first frame; the recording has them
  const startSrc = app.slice(app.indexOf('async function start()'), app.indexOf('/** The app asked to stop'));
  const stopSrc = app.slice(app.indexOf('async function stop()'), app.indexOf("video.addEventListener('ended'"));
  assert.match(startSrc, /\n\s+resetMistakes\(\);[^\n]*\n\s+S\.running = true;/);
  assert.doesNotMatch(stopSrc, /resetMistakes|mistakes\.clear/);
  assert.match(stopSrc, /handleAuto\(ending, \{ final: true \}\);[^]*renderMistakes\(\);/);
  assert.match(stopSrc, /post\('\/api\/results\?model=live', \{ id, \.\.\.rec, /);
  assert.match(stopSrc, /savedWorkouts\(\[\{ id \}\]\);/, 'a workout just saved can be reviewed');
  assert.match(startSrc, /frames: \[\], events: \[\], mistakes: \[\], attempts: \[\], movementIntervals: \[\]/);
  assert.match(app, /S\.lastFrameT = t;\n\s+S\.t0 \?\?= t;/);
  // the Mistakes list replaces "See the last mistake in 3D", in the Workout card
  assert.ok(!ids.has('last3d'));
  const at = html.indexOf('id="mistakes"');
  assert.ok(at > html.indexOf('<h2>Workout</h2>') && at < html.indexOf('<h2>What happened</h2>'));
  for (const id of ['reviewPick', 'mistakesOf', 'mistakeList', 'mistakesLeft', 'demoWhen', 'demoClose']) {
    assert.ok(ids.has(id), id);
  }
});

test("the Mistakes list: an older recording's held-pose mistakes, derived from its events, are what the page showed",
  () => {
    // the tracker's events at the frames it said them on (every `step` ms), through the page's own moveEvents: the
    // faults it shows aside (holdCheck), against those derived from the same events and frames as a recording has them
    const run = (said, until, step = 100) => {
      const now = { cur: { holding: true, form: fine } }, p = page(now), events = [], frames = [];
      for (let t = 13000; t <= until; t += step) {
        const [evs = [], cur] = said[t] ?? [];
        if (cur) now.cur = cur;
        events.push(...evs); frames.push({ t });
        p.moveEvents(evs, t);
      }
      // (holdCheck shows the start's first open fault, and a hold_fault)
      const shown = p.aside.filter(a => a.type === 'hold_fault' || (a.type === 'hold_start' && a.e.form?.open?.length))
        .map(a => [a.t, a.type === 'hold_fault' ? a.e.fault : a.e.form.open[0].fault]);
      return [shown, Mistakes.deriveMistakes({ frames, events }).map(m => [m.t, m.fault])];
    };
    const end = (t, seconds) => [[ev('hold_end', t, { seconds })], { holding: false }];
    const fix = (t, f) => [[ev('hold_fix', t, { fault: f.fault, label: f.label })], { holding: true, form: fine }];
    const fault = (t, f) => [[ev('hold_fault', t, f)], { holding: true, form: form({ open: [f] }) }];
    const start = { 13000: [[ev('hold_start', 10000, { form: faulty })], { holding: true, form: faulty }] };
    const cases = [
      // the start's fault fixed before the page told the hold (6.5 s in): never shown
      [{ ...start, 15000: fix(15000, FEET), 31500: end(30000, 20) }, 31500, []],
      // fixed, and another one told: that one, when the page told the hold
      [{ ...start, 13500: fix(13500, FEET), 14500: fault(14500, TOP_ARM), 31500: end(30000, 20) }, 31500,
        [[16500, 'top_arm']]],
      // still there: when the page told the hold; a later one when it was measured
      [{ ...start, 20000: fault(20000, TOP_ARM), 31500: end(30000, 20) }, 31500,
        [[16500, 'stance_narrow'], [20000, 'top_arm']]],
      // its end said before the page told it (4.7 s in, said 1.5 s later): its end alone, nothing shown
      [{ ...start, 16200: end(14700, 5) }, 16500, []],
      // on the frame the page tells the hold (6.5 s in) it reads the form after the tracker took that frame: a fault
      // said then is in the start (the latest told: the one shown, not the one waiting), and so is a fix
      [{ ...start, 16500: fault(16500, TOP_ARM), 31500: end(30000, 20) }, 31500, [[16500, 'top_arm']]],
      [{ ...start, 16500: fix(16500, FEET), 31500: end(30000, 20) }, 31500, []],
      // (the frame after: told after the start, the start's own fault shown first)
      [{ ...start, 16600: fault(16600, TOP_ARM), 31500: end(30000, 20) }, 31500,
        [[16500, 'stance_narrow'], [16600, 'top_arm']]],
    ];
    for (const [said, until, want] of cases) {
      const [shown, derived] = run(said, until);
      assert.deepEqual(shown, want, JSON.stringify(said));
      assert.deepEqual(derived, want, `derived: ${JSON.stringify(said)}`);
    }
    // frames every 33 ms, as a camera gives them: the page tells the hold on the first frame from 6.5 s in (16531,
    // after 16498), and so does the derivation from the recording's frames
    const at = k => 13000 + 33 * k, tell = at(107), last = at(561);
    assert.deepEqual([at(106), tell], [16498, 16531]);
    const frames33 = [
      [{ ...start, [tell]: fault(tell, TOP_ARM), [last]: end(30000, 20) }, [[tell, 'top_arm']]],
      [{ ...start, [tell]: fix(tell, FEET), [last]: end(30000, 20) }, []],
      [{ ...start, [at(106)]: fault(at(106), TOP_ARM), [last]: end(30000, 20) }, [[tell, 'top_arm']]],
      [{ ...start, [at(108)]: fault(at(108), TOP_ARM), [last]: end(30000, 20) },
        [[tell, 'stance_narrow'], [at(108), 'top_arm']]],
    ];
    for (const [said, want] of frames33) {
      const [shown, derived] = run(said, last, 33);
      assert.deepEqual(shown, want, JSON.stringify(said));
      assert.deepEqual(derived, want, `derived: ${JSON.stringify(said)}`);
    }
  });

test("the Mistakes list: a saved workout reviewed, its mistakes from the recording's frames (or its events)",
  async () => {
    const recFrames = (from, to) => pageFrames(from, to).map(f => ({ t: f.t,
      image: f.image.map(q => [q.x, q.y, q.z, 0.9]), world: f.world.map(q => [q.x, q.y, q.z]) }));
    const ev = (type, t, extra = {}) => ({ type, key: 'quad_stretch', display: 'Quad stretch', kind: 'hold', t,
      ...extra });
    const old = { source: 'camera', width: 1280, height: 720, exercise: 'auto', frames: recFrames(1000, 40000),
      events: [
        ev('hold_start', 5000, { form: { open: [] } }), ev('hold_fault', 20000, HEEL),
        ev('hold_end', 30000, { seconds: 25 }),
        { type: 'rep', t: 35000, exercise: 'squat', label: 'Squat', faults: [SHALLOW],
          window: { start: 34000, end: 35500 } },
      ] };
    const fetched = [];
    let rec = old;
    const p = formPage({ demos: { squat: SQUAT_DEMO }, library: new Map([['quad_stretch', QUAD]]),
      fetch: async url => { fetched.push(url); return { ok: true, json: async () => rec }; } }), { S, fns } = p;
    S.running = false;
    fns.savedWorkouts([{ id: 'live-20000115120000-auto' }, { id: 'live-20000116120000-auto' }]);
    assert.deepEqual(p.$('reviewPick').options.map(o => o.value), ['', 'live-20000116120000-auto',
      'live-20000115120000-auto'], 'newest first, after "This workout"');
    await fns.reviewSaved('live-20000115120000-auto');
    assert.deepEqual(fetched, ['/api/recording?id=live-20000115120000-auto']);
    assert.match(p.$('mistakesOf').textContent, /^Saved workout of Jan 1[456], .+ \(auto\), from its events/);
    assert.deepEqual(p.rows().map(r => [r.when, r.what, r.label]), [['0:34', 'Squat', 'Go deeper'],
      ['0:19', 'Quad stretch', 'Heel far from the glute']]);
    const [hold, rep] = S.review.list.items;
    assert.deepEqual(hold.frames.map(f => f.t), old.frames.filter(f => f.t >= 18000 && f.t <= 20000).map(f => f.t),
      "the hold's last 2 s, from the recording");
    const [x, y, z, visibility] = old.frames.find(f => f.t === hold.frames[0].t).image[2];
    assert.deepEqual(hold.frames[0].image[2], { x, y, z, visibility }, 'as the page has its frames');
    assert.deepEqual([hold.entry, hold.mirror, hold.aspect, hold.saved],
      [QUAD, true, 1280 / 720, 'live-20000115120000-auto']);
    assert.equal(rep.demo, SQUAT_DEMO);
    assert.deepEqual([rep.frames[0].t >= 33850, rep.frames.at(-1).t <= 35650], [true, true]);
    // shown from the review, pinned; the live list is still this workout's
    p.rows()[1].show.click();
    assert.equal(p.$('demoWhen').textContent, 'Mistake at 0:19 of the saved workout · Quad stretch');
    assert.equal(S.mistakes.size, 0);
    // one saved with its own mistakes: those, by their windows
    rec = { ...old, events: [], mistakes: [{ t: 12000, at: 11, kind: 'hold', what: 'Quad stretch',
      movement: 'quad_stretch', ...HEEL, window: { start: 10000, end: 12000 } }] };
    await fns.reviewSaved('live-20000116120000-auto');
    assert.equal(S.review.derived, false);
    assert.doesNotMatch(p.$('mistakesOf').textContent, /from its events/);
    assert.deepEqual(p.rows().map(r => r.when), ['0:11']);
    assert.deepEqual([S.review.list.items[0].frames[0].t, S.review.list.items[0].frames.at(-1).t], [10009, 11989]);
    // back to this workout's; and no review while a workout runs (its own list shows)
    await fns.reviewSaved('');
    assert.equal(S.review, null);
    S.running = true;
    await fns.reviewSaved('live-20000115120000-auto');
    assert.equal(S.review, null);
    assert.equal(p.$('reviewPick').disabled, true);
    // a recording that cannot be read: said so in the list
    S.running = false;
    const q = formPage({ fetch: async () => ({ ok: false, status: 404 }) });
    q.S.running = false;
    await q.fns.reviewSaved('live-20000115120000-auto');
    assert.match(q.$('mistakesOf').textContent, /could not load it \(HTTP 404\)/);
  });

// --- a moving or rhythm movement's form (web/js/moveform.js, through moves.js MovementTracker): its form_fault and
// form_fix go to the coach as they come (no start held back, none of the hold's 6.5 s), each fault is shown aside as a
// hold's ("You": the last 2 s, its part in red on its side; "Like this": the library's refPoses for the check, if
// built) and kept in the Mistakes list; the Now card shows its form as it is. A stand-in tracker emits the events as
// MovementTracker does ({type, key, display, kind, t, ...})
const SHOULDER = { key: 'shoulder_external_rotation', display: 'Shoulder external rotation', kind: 'gym_reps',
  track: 'rhythm', glb: 'glb/shoulder_external_rotation.glb', durationSec: 6.97 };
const ELBOWS = { fault: 'elbows_out', label: 'elbows drifting off the sides',
  measured: 'elbow 63 degrees out from your side as your hands turn out',
  target: 'elbows tucked in at your sides, within about 30 degrees',
  cue: 'Keep your elbows pinned to your sides as you turn your hands out.', part: 'elbow', side: 'right' };
const ELBOWS_FIX = { fault: ELBOWS.fault, label: ELBOWS.label };
const mev = (type, t, extra = {}) => ({ type, key: SHOULDER.key, display: SHOULDER.display, kind: SHOULDER.kind, t,
  ...extra });
/** MoveForm state() as the tracker gives it on rhythm_progress, moving_progress and current(). */
const mform = (over = {}) => ({ checked: ['elbows at your sides'], open: [], pending: [], unseen: [], wrongView: [],
  ...over });
/** The Now card of the stand-in page `p` (app.js renderMove and moveEvents, taken as they are) for the movement `entry`
 * named, its tracker's current() `cur`: render(t) renders it at frame time t; line() what its form line shows ("cls:
 * text", or null: hidden); moveEvents(evs, t) as the page passes the tracker's events (`told`: what went to the
 * coach, with its fallback). */
function nowCard(p, entry, cur) {
  const { S } = p;
  const renderSrc = app.slice(app.indexOf('function renderMove()'), app.indexOf("\n$('move3d').addEventListener"));
  const { moveStatus, formLine } = new Function('S', 'mmss', 'formFine',
    `${statusSrc}\nreturn { moveStatus, formLine };`)(S, String, formFine);
  const renderMove = new Function('S', '$', 'document', 'moveStatus', 'formLine', 'trackLabel', 'unseenLasts',
    'unseenWords', `${renderSrc}\nreturn renderMove;`)(S, p.$, { createElement: tag => new El(null, tag) }, moveStatus,
    formLine, () => 'tracked', unseenLasts, unseenWords);
  const told = [];
  const moveEvents = new Function('S', 'log', 'coachEvent', 'FALLBACK', 'mmss', 'holdCheck', 'unseenLasts',
    `${trackSrc}\n${moveSrc}\nreturn moveEvents;`)(S, () => {}, (e, fallback) => told.push({ ...e, fallback }),
    FALLBACK, String, p.fns.holdCheck, unseenLasts);
  S.statusText = c => `About ${c.count}`;
  S.reference = entry; S.move = { entry, tracker: { current: () => cur } };
  const el = p.$('moveForm');
  return { render: t => { S.lastFrameT = t; renderMove(); }, told,
    line: () => (el.hidden ? null : `${el.className}: ${el.textContent}`),
    moveEvents: (evs, t) => { S.lastFrameT = t; moveEvents(evs, t); } };
}

test("a moving movement's form: its faults and fixes go to the coach as they come, with the engine's own words", () => {
  assert.match(trackSrc, /'form_fault', 'form_fix'/, 'the page forwards them (TRACK_EVENTS)');
  assert.equal(FALLBACK.form_fault(ELBOWS), ELBOWS.cue);
  assert.equal(FALLBACK.form_fault({}), '', 'no cue: nothing said');
  assert.match(FALLBACK.form_fix(ELBOWS_FIX), /^That's it\b/);
  assert.ok(FALLBACK.form_fix({}).length <= 30, 'a short praise');
  assert.doesNotMatch(FALLBACK.form_fix({}), /there/, 'still moving: not "keep it there"');
  // (its checks look for a few mistakes only: nothing calls the movement's form good as a whole)
  for (const said of [FALLBACK.form_fix({}), FALLBACK.rhythm_progress({ count: 5, form: mform() }),
    FALLBACK.moving_progress({ seconds: 30, form: mform() })]) {
    assert.doesNotMatch(said, /good|right|correct|perfect/i, said);
  }
  const now = { cur: { track: 'rhythm', count: 3, approximate: true, form: mform() } };
  const p = page(now, null, SHOULDER);
  // told on the frame it comes, 3.4 s into the movement: nothing held back
  p.moveEvents([mev('form_fault', 3400, ELBOWS)], 3400);
  assert.equal(p.told.length, 1);
  const f = p.told[0];
  assert.deepEqual([f.kind, f.at, f.fallback, f.movement, f.display, f.movementKind, f.track],
    ['form_fault', 3400, ELBOWS.cue, SHOULDER.key, SHOULDER.display, 'gym_reps', 'rhythm']);
  for (const k of Object.keys(ELBOWS)) assert.equal(f[k], ELBOWS[k], k);
  assert.ok(!('type' in f) && !('t' in f) && !('key' in f), "the tracker's own fields stay out of the coach event");
  assert.deepEqual(p.aside.map(a => [a.type, a.t, a.m.key, a.e.fault, a.e.side]),
    [['form_fault', 3400, SHOULDER.key, 'elbows_out', 'right']], 'shown aside as it is told');
  // its progress carries the form; the fix, then the same fault again, each as it comes, in the tracker's order
  now.cur = { ...now.cur, count: 5, form: mform({ checked: [], open: [ELBOWS] }) };
  p.moveEvents([mev('rhythm_progress', 9000, { count: 5, approximate: true, form: now.cur.form })], 9000);
  p.moveEvents([mev('form_fix', 12000, ELBOWS_FIX), mev('rhythm_progress', 12000, { count: 10, form: mform() })],
    12000);
  p.moveEvents([mev('form_fault', 21000, { ...ELBOWS, side: 'left' })], 21000);
  assert.deepEqual(p.told.map(e => [e.kind, e.at]), [['form_fault', 3400], ['rhythm_progress', 9000],
    ['form_fix', 12000], ['rhythm_progress', 12000], ['form_fault', 21000]]);
  assert.deepEqual(p.told[1].form.open, [ELBOWS], "the progress's form, as the tracker gave it");
  assert.equal(p.told[1].fallback, 'About 5 so far. Keep going.');
  assert.deepEqual([p.told[2].fault, p.told[2].label, p.told[2].fallback], ['elbows_out', ELBOWS.label,
    "That's it. Keep it up."]);
  assert.equal(p.told[4].side, 'left');
  assert.deepEqual(p.aside.filter(a => a.type.startsWith('form_')).map(a => [a.type, a.t]),
    [['form_fault', 3400], ['form_fix', 12000], ['form_fault', 21000]]);
  assert.deepEqual(p.settled, [], '(nothing to settle: told as it came)');
  // a moving one (a flow, a dance) the same way
  const q = page({ cur: { track: 'moving', seconds: 4, form: mform() } }, null,
    { key: 'sun_salutation', display: 'Sun salutation', kind: 'flow', track: 'moving' });
  q.moveEvents([{ type: 'form_fault', key: 'sun_salutation', display: 'Sun salutation', kind: 'flow', t: 4100,
    ...ELBOWS }], 4100);
  assert.deepEqual(q.told.map(e => [e.kind, e.track, e.at]), [['form_fault', 'moving', 4100]]);
});

test("a moving movement's form on the Now card: the fault told, checked only when fine, in the side panel", () => {
  const st = cur => moveStatus({ told: false, tracker: { current: () => cur } });
  const open = mform({ checked: [], open: [ELBOWS] });
  // (no hold's start to wait for: its open faults are the ones told)
  assert.equal(st({ track: 'rhythm', count: 7, approximate: true, form: open }).form, open);
  assert.equal(st({ track: 'rhythm', count: 7, form: open }).big, '~7');
  assert.equal(st({ track: 'moving', seconds: 65, form: open }).form, open);
  assert.equal(st({ track: 'moving', seconds: 65, form: open }).big, '65', '(mmss: a stand-in here)');
  assert.deepEqual(formLine(open), { cls: 'fault', text: 'Form: elbows drifting off the sides',
    title: `${ELBOWS.measured} (aim for ${ELBOWS.target})` });
  // "Form checked" only when fully clear: measured, and nothing open, waiting its turn, out of view or seen side-on
  assert.deepEqual(formLine(mform()), { cls: 'ok', text: 'Form checked', title: 'Checked for: elbows at your sides' });
  assert.equal(formLine(mform({ checked: [], pending: ['elbows at your sides'] })).text, 'Form: checking...');
  assert.equal(formLine(mform({ checked: [], wrongView: ['elbows at your sides'] })).text,
    'Form not checked: turn to face the camera');
  assert.equal(formLine(mform({ checked: [], unseen: ['elbows at your sides'] })).cls, 'unseen');
  // in its warm-up and pauses nothing is judged (none of the lists): nothing shown; no check, no landmarks: none
  assert.equal(formLine(mform({ checked: [] })), null);
  assert.equal(st({ track: 'rhythm', count: 0, form: null }).form, null);
  assert.equal(st({ track: 'moving', seconds: 3 }).form, null, '(a tracker from before the checks)');
  // the page's Now card (app.js renderMove, taken as it is on the stand-in page): the line in the Now card, and "See
  // it again" while the fault is still there and its panel has gone
  const p = formPage({ library: new Map([[SHOULDER.key, SHOULDER]]) }), { S, fns } = p;
  const cur = { track: 'rhythm', key: SHOULDER.key, count: 4, approximate: true, form: mform() };
  const card = nowCard(p, SHOULDER, cur);
  card.render(0);
  assert.equal(card.line(), null, '"Form checked" waits LINE_CHECKED_MS of a clear form');
  for (let t = 33; t < 1500; t += 33) card.render(t);
  assert.equal(card.line(), null);
  card.render(1500);
  assert.equal(card.line(), 'ok: Form checked');
  assert.equal(p.$('holdAgain').hidden, true);
  assert.equal(p.$('reps').textContent, '~4');
  S.trail = pageFrames(0, 20000);
  cur.form = open;
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 6000);
  card.render(6000);
  assert.equal(card.line(), 'fault: Form: elbows drifting off the sides', 'a fault told: at once');
  assert.equal(p.$('holdAgain').hidden, true, 'its panel is up');
  p.advance(10000);                                           // (FORM_MS: the panel goes, the fault is still there)
  card.render(16000);
  assert.equal(p.$('holdAgain').hidden, false, '"See it again"');
  fns.showHold(SHOULDER, cur.form.open[0], 16000, { again: true });
  card.render(16033);
  assert.equal(p.$('holdAgain').hidden, true);
  assert.equal(S.mistakes.size, 1, '(the same fault, still there: not a new mistake)');
  card.moveEvents([mev('form_fix', 17000, ELBOWS_FIX)], 17000);
  cur.form = mform({ checked: [] });                          // (fixed, then a pause: nothing judged)
  card.render(17000);
  assert.equal(card.line(), null, 'its fix: the fault goes at once');
  // in the page: the Now card's line, in the side panel (not over the camera view)
  const at = html.indexOf('id="moveForm"');
  assert.ok(at > html.indexOf('<aside>') && at > html.indexOf('id="now"') && at < html.indexOf('id="demo"'));
});

const finishSrc = app.slice(app.indexOf('function finishMovement('),
  app.indexOf('\n// A hold goes to the coach (hold_start)'));
/** app.js finishMovement() on the stand-in page `p`, for the movement `entry` named (its tracker's summary: `sum`). */
const finishOn = (p, entry, sum = {}) => {
  p.S.move = { entry, tracker: { finish: () => [], summary: () => sum } }; p.S.moves ??= [];
  return new Function('S', 'log', 'mmss', 'doneText', 'hideForm', 'recordMovingIntervals', 'endAttempt', `${finishSrc}\nreturn finishMovement;`)(p.S,
    () => {}, String, () => '', p.fns.hideForm, recordMovingIntervals, endAttempt)();
};

test("a moving movement's form check: shown aside as a hold's, kept, put away on its fix or the movement's end", () => {
  const p = formPage({ library: new Map([[SHOULDER.key, SHOULDER]]) }), { S, fns } = p, demo = p.$('demo');
  p.$('stage').classList.add('mirror');                       // (the camera's view is mirrored)
  S.trail = pageFrames(0, 40000); S.rec = { mistakes: [], events: [] }; S.lastFrameT = 10000;
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 10000);
  assert.equal(S.mistakes.size, 1);
  const m = S.mistakes.items[0];
  assert.deepEqual([m.kind, m.movement, m.what, m.entry, m.fault, m.side, m.mirror, m.at],
    ['move', SHOULDER.key, SHOULDER.display, SHOULDER, ELBOWS, 'right', true, 10]);
  // "You": the last 2 s, the faulty part in red on the side of the fault, mirrored as the camera view is
  assert.deepEqual(m.frames, S.trail.filter(x => x.t > 8000 && x.t <= 10000));
  assert.equal(p.you().frames, m.frames);
  assert.deepEqual([p.you().opts.bones, p.you().opts.mirror], [bonesFor('elbow', 'right'), true]);
  assert.equal(p.$('youLabel').textContent, 'You');
  assert.equal(p.$('demoCaption').textContent,
    'Elbows drifting off the sides: elbow 63 degrees out from your side as your hands turn out');
  assert.equal(p.$('demoDetail').textContent, `${ELBOWS.cue} Aim for ${ELBOWS.target}.`);
  // no reference pose of the check in the library (none built yet): "You" alone with the cue
  assert.ok(demo.classList.contains('show') && demo.classList.contains('alone') && !demo.classList.contains('pose'));
  assert.equal(p.like().image, null);
  assert.match(p.logs.at(-1)[0],
    /^form check: Shoulder external rotation, elbows drifting off the sides \(no reference pose of this check/);
  // kept: in the list, and in the recording without its frames
  assert.deepEqual(S.rec.mistakes, [Mistakes.recordOf(m)]);
  assert.deepEqual([S.rec.mistakes[0].kind, S.rec.mistakes[0].movement, S.rec.mistakes[0].fault],
    ['move', SHOULDER.key, 'elbows_out']);
  assert.deepEqual(p.rows().map(r => [r.when, r.what, r.label, r.measured]),
    [['0:10', SHOULDER.display, 'Elbows drifting off the sides', ELBOWS.measured]]);
  // "See it in 3D": the frames on the Y Bot next to the library's clip, played whole (no reference moment built)
  const three = S.form.three;
  assert.equal(p.$('demo3d').style.display, '');
  assert.deepEqual([three.library, three.key, three.side, three.mirror, three.frames.length, three.demo],
    [true, SHOULDER.key, 'right', true, m.frames.length,
      { model: '/moves/glb/shoulder_external_rotation.glb', segment: null, face: true, mirror: false }]);
  p.rows()[0].d3.click();
  assert.deepEqual([p.opened[0].library, p.opened[0].fault, p.opened[0].frames], [true, ELBOWS, m.frames]);
  // another check's fix: no change; its own: put away a moment after, once up 2.5 s (as a hold's)
  p.advance(1000);
  fns.holdCheck('form_fix', { fault: 'wrists_bent', label: 'wrists bent' }, SHOULDER, 11000);
  fns.holdCheck('form_fix', ELBOWS_FIX, SHOULDER, 11000);
  p.advance(1400);
  assert.ok(demo.classList.contains('show'), 'up 2.5 s first');
  p.advance(200);
  assert.ok(!demo.classList.contains('show') && S.form === null, 'then put away');
  // told again after its fix: shown and kept again, now on the left
  S.lastFrameT = 20000;
  fns.holdCheck('form_fault', { ...ELBOWS, side: 'left' }, SHOULDER, 20000);
  assert.equal(S.mistakes.size, 2);
  assert.deepEqual(p.you().opts.bones, bonesFor('elbow', 'left'));
  // FORM_MS: put away
  p.advance(10000);
  assert.ok(!demo.classList.contains('show'));
  // the movement ends (another named, or Stop): put away, its count kept
  S.lastFrameT = 30000;
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 30000);
  assert.ok(demo.classList.contains('show'));
  finishOn(p, SHOULDER, { count: 12 });
  assert.ok(!demo.classList.contains('show') && S.form === null && S.move === null);
  assert.deepEqual(S.moves.at(-1), { movement: SHOULDER.key, display: SHOULDER.display, movementKind: 'gym_reps',
    track: 'rhythm', count: 12 });
  assert.equal(S.mistakes.size, 3, 'the list keeps them');
  // the form check off, or no workout running: nothing shown, nothing kept
  p.$('useDemos').checked = false;
  assert.equal(fns.showHold(SHOULDER, ELBOWS, 31000), false);
  p.$('useDemos').checked = true; S.running = false;
  assert.equal(fns.showHold(SHOULDER, ELBOWS, 31000), false);
  assert.equal(S.mistakes.size, 3);
});

test("a moving movement's form check: \"Like this\" is the check's reference pose if the library has one", () => {
  const image = Array.from({ length: 33 }, (_, i) => [0.3 + i / 100, 0.1 + i / 40]);
  const drawn = image.map(([x, y]) => ({ x, y, visibility: 1 }));
  const withRef = (ref, over = {}) => ({ ...SHOULDER, ...over, refPoses: { elbows_out: ref } });
  const show = (entry, fault, { mirror = false } = {}) => {
    const p = formPage({ library: new Map([[entry.key, entry]]) });
    if (mirror) p.$('stage').classList.add('mirror');
    p.S.trail = pageFrames(0, 12000); p.S.lastFrameT = 10000;
    p.fns.showHold(entry, fault, 10000);
    return p;
  };
  // the reference's part is on its left, the user's fault on their right: turned to their side (left and right
  // swapped), its part in red on that side, drawn as "You" is (the camera view's mirror too)
  let p = show(withRef({ image, side: 'left', t: 2.5 }), ELBOWS, { mirror: true });
  assert.ok(p.$('demo').classList.contains('pose') && !p.$('demo').classList.contains('alone'));
  assert.deepEqual(p.like().image, mirrorImage(drawn));
  assert.deepEqual([p.like().opts.bones, p.like().opts.mirror, p.like().opts.aspect],
    [bonesFor('elbow', 'right'), true, 16 / 9]);
  assert.match(p.logs.at(-1)[0], /\(its reference pose, turned to your side\)$/);
  // in 3D: its clip around the reference moment (AROUND_S either side, within the clip), turned to face as the user
  // does; mirrored when the user's side as the 3D view shows it (mirrored like the camera view) is the other one
  assert.deepEqual(p.S.form.three.demo, { model: '/moves/glb/shoulder_external_rotation.glb',
    segment: { start: 1, end: 4 }, face: true, mirror: false }, "(the user's right, mirrored: shown as the left)");
  p = show(withRef({ image, side: 'left', t: 2.5 }), ELBOWS);
  assert.equal(p.S.form.three.demo.mirror, true);
  // the same side, or a check of both sides (side null, either way): never turned
  for (const [refSide, side] of [['left', 'left'], [null, 'right'], ['left', null]]) {
    p = show(withRef({ image, side: refSide }), { ...ELBOWS, side });
    assert.deepEqual(p.like().image, drawn, `${refSide} / ${side}`);
    assert.equal(p.S.form.three.demo.mirror, false, `${refSide} / ${side}`);
    assert.equal(p.S.form.three.demo.segment, null, 'no moment given: the whole clip');
  }
  // the moment near the clip's end, or past it (not of this clip), or none
  assert.deepEqual(show(withRef({ image, side: null, t: 6.5 }), ELBOWS).S.form.three.demo.segment,
    { start: 5, end: 6.97 });
  assert.equal(show(withRef({ image, side: null, t: 9 }), ELBOWS).S.form.three.demo.segment, null);
  assert.deepEqual(show(withRef({ image, t: 0.5 }, { durationSec: undefined }), ELBOWS).S.form.three.demo.segment,
    { start: 0, end: 2 });
  // read defensively: anything else is no reference ("You" alone with the cue), and nothing fails
  const bad = [undefined, null, 'x', [], { image: image.slice(0, 20) }, { image: [...image.slice(1), [NaN, 0]] },
    { side: 'left' }];
  for (const ref of bad) {
    p = show(withRef(ref), ELBOWS);
    assert.ok(p.$('demo').classList.contains('alone') && p.like().image === null, JSON.stringify(ref));
    assert.equal(p.S.form.three.demo.segment, null);
  }
  for (const refPoses of [undefined, null, 'elbows_out', [], { other_check: { image, side: 'left' } }]) {
    p = show({ ...SHOULDER, refPoses }, ELBOWS);
    assert.ok(p.$('demo').classList.contains('alone'), JSON.stringify(refPoses));
  }
  p = show({ ...SHOULDER, refPoses: {} }, { ...ELBOWS, fault: 'constructor' });
  assert.ok(p.$('demo').classList.contains('alone'), "(a check id that is an object's own: not a reference)");
  // an odd side or moment: the pose shown, not turned; the whole clip
  p = show(withRef({ image, side: 'up', t: -1 }), ELBOWS);
  assert.deepEqual([p.like().image, p.S.form.three.demo.segment, p.S.form.three.demo.mirror], [drawn, null, false]);
});

test("a moving movement's form check: with a mistake the user opened from the list, exactly as a hold's", () => {
  const p = formPage({ library: new Map([[SHOULDER.key, SHOULDER], ['quad_stretch', QUAD]]) }), { S, fns } = p;
  const demo = p.$('demo');
  S.trail = pageFrames(0, 60000); S.lastFrameT = 5000;
  fns.showHold(QUAD, HEEL, 5000);
  const held = S.mistakes.items[0];
  p.rows()[0].show.click();
  const pinnedBack = () => demo.classList.contains('show') && demo.classList.contains('pinned') && S.form?.pinned
    && S.form.mistake === held && S.under === null;
  assert.ok(pinnedBack(), 'the held pose\'s mistake, opened');
  // a moving movement's fault shows over it (and is kept), its row unmarked meanwhile; its fix brings it back
  S.lastFrameT = 9000;
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 9000);
  const moving = S.mistakes.items[1];
  assert.deepEqual([S.form.pinned, S.form.mistake, S.under], [false, moving, held]);
  assert.deepEqual(p.marked(), [false, false]);
  p.advance(3000);
  fns.holdCheck('form_fix', ELBOWS_FIX, SHOULDER, 12000);
  p.advance(1500);
  assert.ok(pinnedBack(), 'its fix: the opened one back');
  assert.deepEqual(p.marked(), [false, true]);
  // ...the movement's end too, and FORM_MS
  S.lastFrameT = 20000;
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 20000);
  assert.equal(S.under, held);
  finishOn(p, SHOULDER, { count: 3 });
  assert.ok(pinnedBack(), "the movement's end: the opened one back");
  S.lastFrameT = 25000;
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 25000);
  p.advance(10000);
  assert.ok(pinnedBack(), 'after FORM_MS: the opened one back');
  // the moving one opened from the list: no fix, end, hold's end or timer puts it away; Close does
  p.rows().find(r => r.what === SHOULDER.display).show.click();
  assert.deepEqual([S.form.pinned, S.form.mistake.kind, p.$('demoWhen').textContent],
    [true, 'move', `Mistake at ${Mistakes.clock(S.form.mistake.at)} · ${SHOULDER.display}`]);
  fns.holdCheck('form_fix', ELBOWS_FIX, SHOULDER, 26000);
  fns.holdCheck('hold_end', { seconds: 20 }, QUAD, 26000);
  finishOn(p, SHOULDER);
  p.advance(60000);
  assert.ok(demo.classList.contains('pinned') && S.form?.pinned && S.form.mistake.kind === 'move', 'still there');
  // ...a hold's fault shows over it, and its end brings it back
  S.lastFrameT = 40000;
  fns.holdCheck('hold_fault', HEEL, QUAD, 40000);
  assert.equal(S.under.kind, 'move');
  fns.holdCheck('hold_end', { seconds: 15 }, QUAD, 40000);
  assert.ok(S.form?.pinned && S.form.mistake.kind === 'move' && S.under === null);
  p.$('demoClose').click();
  assert.ok(!demo.classList.contains('show') && S.form === null);
  // after the workout: each one shown again from the list, its frames replayed
  S.running = false;
  for (const row of p.rows()) {
    row.show.click();
    assert.ok(S.form.pinned && p.you().frames.length >= 2 && S.form.mistake.frames === p.you().frames);
  }
});

test("the Mistakes list: an older recording's moving-movement mistakes, derived from its events, are what the page "
  + 'showed', () => {
  // the tracker's events at the frames it said them on, through the page's own moveEvents: the faults it shows aside
  // (holdCheck) against those derived from the same events and frames as a recording has them
  const said = {
    3400: [mev('form_fault', 3400, ELBOWS)],
    9000: [mev('rhythm_progress', 9000, { count: 5, approximate: true, form: mform({ checked: [], open: [ELBOWS] }) })],
    12000: [mev('form_fix', 12000, ELBOWS_FIX)],
    12100: [mev('form_fault', 12100, { ...ELBOWS, side: 'left' })],     // (back at once: shown again)
    30000: [mev('form_fault', 30000, { ...ELBOWS, fault: 'wrists_bent', label: 'wrists bent', side: null })],
  };
  const p = page({ cur: { track: 'rhythm', count: 0, form: mform() } }, null, SHOULDER), events = [], frames = [];
  for (let t = 0; t <= 31000; t += 100) {
    const evs = said[t] ?? [];
    events.push(...evs); frames.push({ t });
    p.moveEvents(evs, t);
  }
  const shown = p.aside.filter(a => a.type === 'form_fault').map(a => [a.t, a.e.fault, a.e.side ?? null]);
  const derived = Mistakes.deriveMistakes({ frames, events });
  assert.deepEqual(shown, [[3400, 'elbows_out', 'right'], [12100, 'elbows_out', 'left'], [30000, 'wrists_bent', null]]);
  assert.deepEqual(derived.map(m => [m.t, m.fault, m.side]), shown);
  assert.deepEqual(derived[0], { t: 3400, kind: 'move', what: SHOULDER.display, movement: SHOULDER.key, ...ELBOWS,
    window: { start: 1400, end: 3400 } }, 'the last 2 s before it was shown, as the page kept it');
});

test("a moving movement's form on the Now card: steady, however the form flips from frame to frame", () => {
  // a stand-in tracker whose form changes on every frame (33 ms), as a check's parts slip out of the frame and back,
  // or the view reads side-on for a frame: the line shows only what has lasted, and never flickers
  const p = formPage({ library: new Map([[SHOULDER.key, SHOULDER]]) }), { S } = p;
  const NAME = 'elbows at your sides';
  const UNSEEN = mform({ checked: [], unseen: [NAME] }), SIDE_ON = mform({ checked: [], wrongView: [NAME] });
  const NONE = mform({ checked: [] }), FINE = mform(), WAITS = mform({ checked: [], pending: [NAME] });
  const FAULT = mform({ checked: [], open: [ELBOWS] });
  const cur = { track: 'rhythm', key: SHOULDER.key, count: 0, approximate: true, form: NONE };
  const card = nowCard(p, SHOULDER, cur);
  let t = 0;
  /** `ms` of frames, the form on each from `forms` in turn: the line after each frame. */
  const frames = (ms, ...forms) => {
    const seen = [];
    for (let k = 0, end = t + ms; t < end; t += 33, k += 1) {
      cur.form = forms[k % forms.length]; card.render(t); seen.push(card.line());
    }
    return seen;
  };
  // (frames every 33 ms: a line that must last 1 s shows on the 32nd frame of it, 1023 ms in; one of 1.5 s on the
  // 47th, 1518 ms in)
  const changes = seen => seen.filter((x, i) => i && x !== seen[i - 1]).length;
  // out of the frame, seen side-on, nothing judged, a frame each, 5 s: nothing shown, not once
  let seen = frames(5000, UNSEEN, SIDE_ON, NONE);
  assert.deepEqual([...new Set(seen)], [null], 'hidden throughout');
  // fine one frame, a fault waiting its turn the next: never "Form checked"
  seen = frames(5000, FINE, WAITS);
  assert.deepEqual([...new Set(seen)], [null]);
  // out of the frame for a second: shown then (not before), and kept through a flipping form
  seen = frames(1033, UNSEEN);
  assert.equal(seen.length, 32);
  assert.equal(seen.at(-2), null, 'not before LINE_STEADY_MS');
  assert.equal(seen.at(-1), 'unseen: Form not checked: step back so I can see all of you');
  seen = frames(5000, SIDE_ON, FINE, NONE, WAITS);
  assert.equal(changes(seen), 0, 'no flicker');
  assert.equal(seen[0], 'unseen: Form not checked: step back so I can see all of you');
  // fully clear: "Form checked" after LINE_CHECKED_MS of it, the line before kept until then
  frames(33, UNSEEN);                                          // (the flipping ends on a frame out of the frame)
  seen = frames(1551, FINE);
  assert.equal(seen.length, 47);
  assert.deepEqual([changes(seen), seen.at(-2), seen.at(-1)],
    [1, 'unseen: Form not checked: step back so I can see all of you', 'ok: Form checked']);
  seen = frames(3000, FINE);
  assert.equal(changes(seen), 0);
  // a fault told: at once, and kept through a form flipping under it (a tracker's glitch) until its fix
  seen = frames(33, FAULT);
  assert.equal(seen[0], 'fault: Form: elbows drifting off the sides');
  seen = frames(5000, FAULT, NONE, UNSEEN, FINE);
  assert.deepEqual([...new Set(seen)], ['fault: Form: elbows drifting off the sides']);
  // its fix (form_fix): gone at once, then the line after it once it has lasted
  card.moveEvents([mev('form_fix', t, ELBOWS_FIX)], t);
  seen = frames(1033, WAITS);
  assert.deepEqual([seen[0], seen.at(-2), seen.at(-1)], [null, null, 'pending: Form: checking...']);
  // a fault the form drops without a fix said (another tracker): kept LINE_STEADY_MS, then gone
  frames(33, FAULT);
  seen = frames(1100, NONE);
  assert.equal(seen.filter(x => x?.startsWith('fault')).length, 31, '(the frames of its first second)');
  assert.equal(seen.at(-1), null);
  // a held pose's line is not held back: it shows once the coach was told the hold's start, as it is
  const q = formPage({ library: new Map([['quad_stretch', QUAD]]) });
  const hold = { track: 'hold', key: 'quad_stretch', holding: true, seconds: 8, form: form({ checked: ['heel'] }) };
  const held = nowCard(q, QUAD, hold);
  q.S.move.told = true;
  held.render(0);
  assert.equal(held.line(), 'ok: Form checked', 'at once');
  hold.form = form({ checked: [], unseen: ['heel'] });
  held.render(33);
  assert.equal(held.line(), 'unseen: Form not checked: step back so I can see all of you');
});

test("a moving movement's form check: \"You\" replays the frames its verdict was based on (`seen`)", () => {
  // a cycle check's fault is told when the rep counter confirms the turn, seconds after the moment it measured: a
  // stand-in fault whose `seen` lies 3 s before it was told
  const p = formPage({ library: new Map([[SHOULDER.key, SHOULDER]]) }), { S, fns } = p;
  const SEEN = { ...ELBOWS, seen: { from: 20000, to: 21000 } };
  S.trail = pageFrames(12000, 24000); S.rec = { mistakes: [] }; S.lastFrameT = 24000;   // (the page keeps 12 s)
  fns.holdCheck('form_fault', SEEN, SHOULDER, 24000);
  const m = S.mistakes.items[0];
  const seen = S.trail.filter(x => x.t >= 20000 - 300 && x.t <= 21000 + 300);
  assert.deepEqual(m.frames, seen, 'the seen frames, 0.3 s either side');
  assert.ok(!m.frames.some(x => x.t > 22000), 'none of the 2 s before it was told');
  assert.equal(p.you().frames, m.frames, '"You" replays them');
  // the Mistakes list and the recording keep that window; the 3D view poses those frames
  assert.deepEqual(m.window, { start: seen[0].t, end: seen.at(-1).t });
  assert.deepEqual(S.rec.mistakes[0].window, m.window);
  assert.deepEqual(S.form.three.frames.map(x => x.t), seen.map(x => x.t));
  S.running = false;
  p.rows()[0].show.click();
  assert.equal(p.you().frames, m.frames, 'shown again from the list: the same frames');
  // a saved workout of it reviewed: the same frames, from the recording's mistakes or derived from its events
  const recorded = S.trail.map(f => ({ t: f.t, image: f.image.map(q => [q.x, q.y, q.z, q.visibility]),
    world: f.world.map(q => [q.x, q.y, q.z]) }));
  const derived = Mistakes.deriveMistakes({ frames: recorded, events: [mev('form_fault', 24000, SEEN)] });
  assert.deepEqual(Mistakes.framesIn(recorded, derived[0].window).map(f => f.t), seen.map(x => x.t));
  assert.deepEqual(Mistakes.framesIn(recorded, S.rec.mistakes[0].window).map(f => f.t), seen.map(x => x.t));
  // at most 3 s of them
  S.running = true;
  fns.holdCheck('form_fault', { ...ELBOWS, seen: { from: 13000, to: 18000 } }, SHOULDER, 24000);
  const long = S.mistakes.items[1].frames;
  assert.ok(long.at(-1).t - long[0].t <= 3000 && long[0].t >= 14000 && long.at(-1).t <= 17000,
    `${long[0].t}-${long.at(-1).t}: 3 s about the span's middle`);
  // without `seen` (an event from before it), or its frames no longer kept ("See it again" 12 s on): the last 2 s
  fns.holdCheck('form_fault', ELBOWS, SHOULDER, 24000);
  assert.deepEqual(S.mistakes.items[2].frames, S.trail.filter(x => x.t > 22000 && x.t <= 24000));
  S.trail = pageFrames(25000, 37000); S.lastFrameT = 37000;
  fns.showHold(SHOULDER, SEEN, 37000, { again: true });
  assert.deepEqual(p.you().frames, S.trail.filter(x => x.t > 35000 && x.t <= 37000), '"You" is never left blank');
  // a held pose's fault (no `seen`): the last 2 s before it was told, as ever
  S.trail = pageFrames(0, 12000); S.lastFrameT = 11000;
  fns.showHold(QUAD, { ...HEEL, seen: undefined }, 11000);
  assert.deepEqual(S.mistakes.items.at(-1).frames, S.trail.filter(x => x.t > 9000 && x.t <= 11000));
});

// --- the form unchecked a while (form_unseen: every check out of the frame, or seen side-on, about 6 s of a moving or
// rhythm movement, 4 s of a hold): its cue to the coach, spoken by the engine if no coach answers, and on the Now card
// while it lasts. Not a mistake. A stand-in tracker emits it as moves.js does ({type, key, display, kind, t, ...})
const CRUNCH = { key: 'standing_side_crunch', display: 'Standing side crunch', kind: 'gym_reps', track: 'rhythm' };
const BEND = 'side bend';
const FEET_OUT = { missing: [BEND], parts: ['feet'], why: 'frame', cue: 'Step back so I can see your feet.' };
const cev = (type, t, extra = {}) => ({ type, key: CRUNCH.key, display: CRUNCH.display, kind: CRUNCH.kind, t,
  ...extra });
const cform = (over = {}) => ({ checked: [], open: [], pending: [], unseen: [], wrongView: [], ...over });

test('the form unchecked a while: its cue goes to the coach as it comes, said by the engine, and is not a mistake',
  () => {
    assert.match(trackSrc, /'form_unseen'/, 'forwarded (TRACK_EVENTS)');
    assert.equal(FALLBACK.form_unseen(FEET_OUT), FEET_OUT.cue);
    // (no cue of its own: in words, from what is out of view, or the view)
    assert.equal(FALLBACK.form_unseen({ missing: [BEND], parts: ['feet', 'legs'], why: 'frame' }),
      'Step back so I can see your feet and legs.');
    assert.equal(FALLBACK.form_unseen({ why: 'view' }), 'Turn to face the camera so I can check your form.');
    assert.equal(unseenWords({}), 'Step back so I can see your whole body.');
    for (const e of [FEET_OUT, {}, { why: 'view' }]) {
      assert.doesNotMatch(FALLBACK.form_unseen(e), /good|wrong|fix|correct/i);
    }
    // a moving or rhythm movement's: told on the frame it comes, every field with it
    const unseen = { cur: { track: 'rhythm', count: 0, approximate: true, form: cform({ unseen: [BEND] }) } };
    const p = page(unseen, null, CRUNCH);
    p.moveEvents([cev('form_unseen', 6200, FEET_OUT)], 6200);
    p.moveEvents([cev('form_unseen', 36300, FEET_OUT)], 36300);
    assert.deepEqual(p.told.map(e => [e.kind, e.at, e.fallback, e.movement, e.track]),
      [['form_unseen', 6200, FEET_OUT.cue, CRUNCH.key, 'rhythm'], ['form_unseen', 36300, FEET_OUT.cue, CRUNCH.key,
        'rhythm']]);
    for (const k of ['missing', 'parts', 'why', 'cue']) assert.deepEqual(p.told[0][k], FEET_OUT[k], k);
    assert.ok(!('type' in p.told[0]) && !('t' in p.told[0]));
    // not a mistake: no form check aside, nothing kept, nothing derived from a recording of it
    const q = formPage({ library: new Map([[CRUNCH.key, CRUNCH]]) });
    q.S.trail = pageFrames(0, 7000); q.S.rec = { mistakes: [] }; q.S.lastFrameT = 6200;
    q.fns.holdCheck('form_unseen', cev('form_unseen', 6200, FEET_OUT), CRUNCH, 6200);
    assert.deepEqual([q.S.mistakes.size, q.S.rec.mistakes.length, q.S.form, q.$('demo').classList.contains('show')],
      [0, 0, null, false]);
    assert.deepEqual(Mistakes.deriveMistakes({ events: [cev('form_unseen', 6200, FEET_OUT)] }), []);
    // (recorded as every tracker event is: the page pushes them all before it handles them)
    assert.match(app,
      /tracker\.update\([^\n]+\n[^]*?catch[^\n]+\n\s+if \(S\.rec\) S\.rec\.events\.push\(\.\.\.evs\);\n\s+moveEvents\(evs, t\);/);
  });

test('the form unchecked in a hold: after its start, if it still holds; dropped with a hold too short to tell', () => {
  const OUT = { missing: ['stance width', 'top arm'], parts: ['feet'], why: 'frame',
    cue: 'Step back so I can see your feet.' };
  const blind = form({ checked: [], unseen: ['stance width', 'top arm'] });
  // 4 s into the hold, while its start is held back: it goes right after the start
  let now = { cur: { holding: true, form: blind } }, p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: blind })], 4000);
  p.moveEvents([ev('form_unseen', 5000, OUT)], 5000);
  assert.deepEqual(p.told, [], 'with the start');
  p.moveEvents([], 7600);
  assert.deepEqual(p.told.map(e => [e.kind, e.at]), [['hold_start', 7600], ['form_unseen', 7600]]);
  assert.equal(p.told[0].fallback, 'Hold it there.', '(the start never calls an unmeasured hold good)');
  assert.equal(p.told[1].fallback, OUT.cue);
  // ...unless the user stepped back meanwhile
  now = { cur: { holding: true, form: blind } }; p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: blind })], 4000);
  p.moveEvents([ev('form_unseen', 5000, OUT)], 5000);
  now.cur = { holding: true, form: fine };
  p.moveEvents([], 7600);
  assert.deepEqual(p.told.map(e => e.kind), ['hold_start']);
  // a hold too short to tell: dropped with it
  now = { cur: { holding: true, form: blind } }; p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: blind })], 4000);
  p.moveEvents([ev('form_unseen', 5000, OUT)], 5000);
  now.cur = { holding: false };
  p.moveEvents([ev('hold_end', 5500, { seconds: 4 })], 5500);
  assert.deepEqual(p.told, []);
  // once the start was told: at once
  now = { cur: { holding: true, form: fine } }; p = page(now);
  p.moveEvents([ev('hold_start', 1000, { form: fine })], 4000);
  p.moveEvents([], 7600);
  now.cur = { holding: true, form: blind };
  p.moveEvents([ev('form_unseen', 12000, OUT)], 12000);
  assert.deepEqual(p.told.map(e => [e.kind, e.at]), [['hold_start', 7600], ['form_unseen', 12000]]);
  assert.deepEqual(p.aside.filter(a => a.type === 'form_unseen').length, 1, '(holdCheck ignores it)');
});

test("the form unchecked a while: the Now card shows its cue, big, at once, steady while it lasts", () => {
  const p = formPage({ library: new Map([[CRUNCH.key, CRUNCH]]) });
  const UNSEEN = cform({ unseen: [BEND] }), SIDE_ON = cform({ wrongView: [BEND] });
  const FINE = cform({ checked: [BEND] }), NONE = cform();
  const cur = { track: 'rhythm', key: CRUNCH.key, count: 0, approximate: true, form: UNSEEN };
  const card = nowCard(p, CRUNCH, cur);
  let t = 0;
  const frames = (ms, ...forms) => {
    const seen = [];
    for (let k = 0, end = t + ms; t < end; t += 33, k += 1) {
      cur.form = forms[k % forms.length]; card.render(t); seen.push(card.line());
    }
    return seen;
  };
  const changes = seen => seen.filter((x, i) => i && x !== seen[i - 1]).length;
  // its feet out of the picture: the small line first (as before), then the tracker's form_unseen: its cue, at once
  let seen = frames(6000, UNSEEN);
  assert.equal(seen.at(-1), 'unseen: Form not checked: step back so I can see all of you');
  card.moveEvents([cev('form_unseen', t, FEET_OUT)], t);
  card.render(t);
  assert.equal(card.line(), 'alert: Step back so I can see your feet.');
  assert.equal(p.$('moveForm').title, `Not checked: ${BEND} (out of the frame)`);
  assert.deepEqual(card.told.map(e => [e.kind, e.fallback]), [['form_unseen', FEET_OUT.cue]]);
  // while it lasts (out of the frame or side-on), and through a frame now and then that measured it: steady
  seen = frames(5000, UNSEEN, SIDE_ON, UNSEEN, FINE, NONE);
  assert.deepEqual([...new Set(seen)], ['alert: Step back so I can see your feet.'], 'no flicker');
  // the user steps back: it goes once the line after it is due ("Form checked": 1.5 s of a clear form), no blank
  seen = frames(1551, FINE);
  assert.deepEqual([changes(seen), seen.at(-2), seen.at(-1)],
    [1, 'alert: Step back so I can see your feet.', 'ok: Form checked']);
  assert.equal(card.line(), 'ok: Form checked');
  // ...and is over: out of the frame again, the small line until the tracker says it again
  seen = frames(1100, UNSEEN);
  assert.equal(seen.at(-1), 'unseen: Form not checked: step back so I can see all of you');
  // seen side-on: the cue it gives
  const VIEW = { missing: [BEND], parts: [], why: 'view',
    cue: 'Turn to face the camera so I can check your side bend.' };
  card.moveEvents([cev('form_unseen', t, VIEW)], t);
  cur.form = SIDE_ON; card.render(t);
  assert.equal(card.line(), `alert: ${VIEW.cue}`);
  assert.equal(p.$('moveForm').title, `Not checked: ${BEND} (needs the camera in front)`);
  // in the side panel, never the form check aside or the Mistakes list
  assert.deepEqual([p.S.mistakes.size, p.$('demo').classList.contains('show')], [0, false]);
  // a held pose's: shown while it lasts, even before the coach was told the hold's start (its own line waits for it)
  const q = formPage({ library: new Map([['quad_stretch', QUAD]]) });
  const blind = form({ checked: [], unseen: ['heel'] });
  const hold = { track: 'hold', key: 'quad_stretch', holding: true, seconds: 4, form: blind };
  const held = nowCard(q, QUAD, hold);
  held.render(0);
  assert.equal(held.line(), null, '(its start not told: no line)');
  held.moveEvents([{ type: 'form_unseen', key: 'quad_stretch', display: 'Quad stretch', kind: 'hold', t: 33,
    missing: ['heel'], parts: ['legs'], why: 'frame', cue: 'Step back so I can see your legs.' }], 33);
  held.render(33);
  assert.equal(held.line(), 'alert: Step back so I can see your legs.');
  q.S.move.told = true;
  hold.form = form({ checked: ['heel'] });
  for (let k = 66; k < 1100; k += 33) held.render(k);
  assert.equal(held.line(), 'alert: Step back so I can see your legs.', '(the line after it not due yet)');
  for (let k = 1100; k <= 1700; k += 33) held.render(k);
  assert.equal(held.line(), 'ok: Form checked');
  hold.form = form({ checked: [], unseen: ['heel'] });
  held.render(1733);
  assert.equal(held.line(), 'unseen: Form not checked: step back so I can see all of you',
    "a hold's own line: as ever");
});

test("a moving movement's form check: a reference pose taken from the clip's mirror image (`mirrored`)", async () => {
  // a one-sided check the reference clip does on the other side only (the standing side crunch sweeps its right leg):
  // the left check's pose is the mirrored skeleton's, its image and side as the mirror shows them; the clip at `t`
  // still sweeps the right leg
  const image = Array.from({ length: 33 }, (_, i) => [0.3 + i / 100, 0.1 + i / 40]);
  const drawn = image.map(([x, y]) => ({ x, y, visibility: 1 }));
  const KNEE_L = { fault: 'swept_knee_left', label: 'left knee swept across', measured: 'knee 30 degrees across',
    target: 'knee straight up', cue: 'Lift your left knee straight up.', part: 'knee', side: 'left' };
  const entry = (mirrored = true) => ({ key: 'standing_side_crunch', display: 'Standing side crunch', kind: 'gym_reps',
    track: 'rhythm', glb: 'glb/standing_side_crunch.glb', durationSec: 8,
    refPoses: { swept_knee_left: { image, side: 'left', t: 2, ...(mirrored ? { mirrored: true } : {}) } } });
  const show = (e, { mirror = false } = {}) => {
    const p = formPage({ library: new Map([[e.key, e]]) });
    if (mirror) p.$('stage').classList.add('mirror');
    p.S.trail = pageFrames(0, 12000); p.S.lastFrameT = 10000;
    p.fns.showHold(e, KNEE_L, 10000);
    return p;
  };
  // 2D: drawn as it is, not turned (it already shows the left leg), its left knee in red
  let p = show(entry());
  assert.deepEqual([p.like().image, p.like().opts.bones], [drawn, bonesFor('knee', 'left')]);
  assert.match(p.logs.at(-1)[0], /\(its reference pose\)$/, '(not turned)');
  // 3D: the clip sweeps the right leg there: mirrored for the user's left as the 3D view shows it
  assert.deepEqual(p.S.form.three.demo, { model: '/moves/glb/standing_side_crunch.glb', segment: { start: 0.5,
    end: 3.5 }, face: true, mirror: true });
  // (the camera view mirrored: the user's left shows as the right, the clip's own side: not mirrored)
  p = show(entry(), { mirror: true });
  assert.deepEqual([p.like().image, p.S.form.three.demo.mirror], [drawn, false]);
  // the same pose not marked mirrored: as before (the clip's side is the pose's)
  p = show(entry(false));
  assert.deepEqual([p.like().image, p.S.form.three.demo.mirror], [drawn, false]);
  p = show(entry(false), { mirror: true });
  assert.equal(p.S.form.three.demo.mirror, true);
  // (only `mirrored: true` counts)
  const odd = entry(false);
  odd.refPoses.swept_knee_left.mirrored = 'yes';
  assert.equal(show(odd).S.form.three.demo.mirror, false);
  // a saved workout reviewed: the same, its mistake shown again from the list and in 3D
  const e = entry();
  const rec = { source: 'clip-1', width: 1280, height: 720, frames: pageFrames(1000, 4000).map(f => ({ t: f.t,
    image: f.image.map(q => [q.x, q.y, q.z, 0.9]), world: f.world.map(q => [q.x, q.y, q.z]) })), mistakes: [
    { t: 4000, at: 3, kind: 'move', what: e.display, movement: e.key, ...KNEE_L,
      window: { start: 2000, end: 4000 } }] };
  const q = formPage({ library: new Map([[e.key, e]]), fetch: async () => ({ ok: true, json: async () => rec }) });
  q.S.running = false;
  await q.fns.reviewSaved('live-20000115120000-auto');
  q.rows()[0].show.click();
  assert.deepEqual([q.like().image, q.S.form.three.demo.mirror], [drawn, true]);
  q.rows()[0].d3.click();
  assert.deepEqual([q.opened[0].demo.mirror, q.opened[0].demo.segment], [true, { start: 0.5, end: 3.5 }]);
});

// The movement library fetched again on a failure (a page loaded while the dev server restarted, or reading the file as
// a build rewrote it, said the server had no library): app.js fetchLibrary / loadLibrary and renderLibrary's words
const libLoadSrc = app.slice(app.indexOf('const LIB_TRIES'), app.indexOf('\n// (a saved workout reviewed waits for it'));
const libRenderSrc = app.slice(app.indexOf('function renderLibrary()'), app.indexOf('\n  const groups = new Map(GROUPS'));
test('the movement library: tried again after a failure, a 404 said at once, a lasting failure with Try again', async () => {
  const run = async answers => {
    const said = [], S = { library: [] };
    let text = '', calls = 0;
    const box = { kids: [], get textContent() { return text; }, set textContent(t) { text = t; said.push(t); },
      replaceChildren() { text = ''; this.kids = []; }, append(...k) { this.kids.push(...k); } };
    const els = { libGroups: box, libCount: { textContent: '' } };
    const document = { createElement: () => ({ on: {}, addEventListener(ev, f) { this.on[ev] = f; } }) };
    const fetch = async () => {
      const a = answers[Math.min(calls++, answers.length - 1)];
      if (a === 'down') throw new TypeError('Failed to fetch');
      if (a === 'half') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
      if (typeof a === 'number') return { ok: false, status: a };
      return { ok: true, status: 200, json: async () => a };
    };
    const env = { HOSTED: false, S, fetch, document, $: id => els[id], setTimeout: f => f(),
      movesJs: Promise.resolve({ TRACK_OF_KIND: { hold: 'hold' } }), TRACK_LABEL: {}, isCounted: () => false,
      movementNames: l => l.map(m => m.key) };
    const { loadLibrary } = new Function(...Object.keys(env),
      `${libLoadSrc}\n${libRenderSrc}\n}\nreturn { loadLibrary, libraryReady: null };`)(...Object.values(env));
    await loadLibrary();
    return { S, said, calls, text, box };
  };
  const lib = { movements: [{ key: 'quad_stretch', display: 'Quad stretch', kind: 'hold', track: 'hold' }] };
  // the server restarting (twice no answer), then the library: loaded, the wait said meanwhile, never "none"
  let r = await run(['down', 'down', lib]);
  assert.equal(r.calls, 3);
  assert.deepEqual(r.S.library.map(m => m.key), ['quad_stretch']);
  assert.equal(r.S.libState.status, 'ok');
  assert.match(r.said[0], /^Loading the movement library/);
  assert.ok(r.said.some(s => /trying again: Failed to fetch/.test(s)), r.said.join(' | '));
  assert.ok(!r.said.some(s => /No movement library|Could not load/.test(s)), r.said.join(' | '));
  // a file read half written (not JSON), then whole: loaded
  r = await run(['half', lib]);
  assert.equal(r.calls, 2);
  assert.equal(r.S.library.length, 1);
  // a 404: the server has none, said at once, not tried again
  r = await run([404]);
  assert.equal(r.calls, 1);
  assert.match(r.text, /^No movement library on this server/);
  // a 500: tried again like no answer
  r = await run([500, lib]);
  assert.equal(r.calls, 2);
  assert.equal(r.S.library.length, 1);
  // no answer however often: why, and a Try again button
  r = await run(['down']);
  assert.equal(r.calls, 6);
  assert.match(r.text, /^Could not load the movement library \(Failed to fetch\)/);
  assert.equal(r.box.kids.length, 1);
  assert.equal(r.box.kids[0].textContent, 'Try again');
});
