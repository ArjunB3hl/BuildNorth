// The page inside the BuildNorth app: who may be the app, the workout it gets, and the messages both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, embedded, parentOrigin, workoutOf } from '../web/js/embed.js';

test('only a page on this machine can be the app', () => {
  assert.equal(embedded('?embed=1'), true);
  assert.equal(embedded('?embed=0'), false);
  assert.equal(embedded(''), false);
  assert.equal(parentOrigin('?embed=1'), 'http://localhost:8081');
  assert.equal(parentOrigin('?parent=http://localhost:8082'), 'http://localhost:8082');
  assert.equal(parentOrigin('?parent=http%3A%2F%2F127.0.0.1%3A8081'), 'http://127.0.0.1:8081');
  for (const bad of ['https://evil.example', 'http://localhost.evil.example', 'http://localhost:8081/x', 'http://localhost:8081@evil.example',
    'https://localhost:8081', 'null', 'http://localhost:'])
    assert.equal(parentOrigin(`?parent=${encodeURIComponent(bad)}`), null, bad);
});

test('the workout: the sets auto mode settled on, with the faults and per-side counts of their set_end', () => {
  const sets = [
    { exercise: 'squat', label: 'Squat', set: 1, reps: 8, partials: 1, startT: 1, endT: 2 },
    { exercise: 'lunge', label: 'Lunge', set: 1, reps: 6, partials: 0 },
    { exercise: 'squat', label: 'Squat', set: 2, reps: 5 },
    { exercise: 'pushup', label: 'Push-up', set: 1, reps: 0 },            // nothing to save
  ];
  const ended = [
    { type: 'set_end', exercise: 'squat', set: 1, reps: 7, faults: { knees_in: 2 }, perSide: {} },   // counts: summary()'s
    { type: 'set_end', exercise: 'lunge', set: 1, reps: 6, faults: {}, perSide: { L: 3, R: 3 } },
  ];
  const w = workoutOf(sets, ended, '2026-10-23T10:00:00.000Z', '2026-10-23T10:05:00.000Z');
  assert.deepEqual(w, {
    startedAt: '2026-10-23T10:00:00.000Z', finishedAt: '2026-10-23T10:05:00.000Z',
    sets: [
      { exercise: 'squat', label: 'Squat', set: 1, reps: 8, partials: 1, faults: { knees_in: 2 }, perSide: {} },
      { exercise: 'lunge', label: 'Lunge', set: 1, reps: 6, partials: 0, faults: {}, perSide: { L: 3, R: 3 } },
      { exercise: 'squat', label: 'Squat', set: 2, reps: 5, partials: 0, faults: {}, perSide: {} },
    ],
    totals: { squat: { label: 'Squat', sets: 2, reps: 13 }, lunge: { label: 'Lunge', sets: 1, reps: 6 } },
  });
  ended[0].faults.knees_in = 9;                                              // a copy, not the engine's live object
  assert.equal(w.sets[0].faults.knees_in, 2);
  assert.deepEqual(workoutOf([], [], 'a', 'b'), { startedAt: 'a', finishedAt: 'b', sets: [], totals: {} });
});

/** A window in a frame: its parent records what it was sent; `deliver` plays a message event. */
function framed() {
  const listeners = [], sent = [];
  const parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const win = { parent, addEventListener: (type, fn) => type === 'message' && listeners.push(fn) };
  const deliver = (data, origin = 'http://localhost:8081', source = parent) => listeners.forEach(fn => fn({ data, origin, source }));
  return { win, parent, sent, deliver };
}

test('messages go only to the app, and only the app can start or stop the page', () => {
  const f = framed();
  const link = connect(f.win, 'http://localhost:8081');
  link.send('set', { exercise: 'squat', reps: 8, type: 'not this' });
  assert.deepEqual(f.sent, [{ data: { exercise: 'squat', reps: 8, type: 'pose-coach/set' }, origin: 'http://localhost:8081' }]);

  const got = [];
  link.on('start', m => got.push(['start', m.exercise]));
  link.on('stop', () => got.push(['stop']));
  f.deliver({ type: 'pose-coach/start', exercise: 'auto' });
  f.deliver({ type: 'pose-coach/stop' });
  f.deliver({ type: 'pose-coach/start' }, 'http://localhost:9999');              // another origin
  f.deliver({ type: 'pose-coach/start' }, 'http://localhost:8081', {});          // another window of the same origin
  f.deliver({ type: 'start' });                                                   // not ours
  f.deliver({ type: 'pose-coach/unknown' });
  f.deliver(null);
  f.deliver('pose-coach/start');
  assert.deepEqual(got, [['start', 'auto'], ['stop']]);
});
