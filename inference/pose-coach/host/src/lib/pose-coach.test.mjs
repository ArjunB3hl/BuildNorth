// Run: node --experimental-strip-types --test src/lib/*.test.mjs   (Node 22.6+; the flag is the default from 23.6)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTINUE_MS, NOTHING_COUNTED, POSE_URL, addRun, countMessage, countedSets, countedWorkout, endRun, freeze, poseFrameUrl, poseMessage,
  holdScreen, restoreWorkouts, serverHas, sessionFromWorkout, workoutLine,
} from './pose-coach.ts';

const set = (exercise, label, n, reps, extra = {}) => ({ exercise, label, set: n, reps, partials: 0, faults: {}, perSide: {}, ...extra });
const workout = (sets) => ({ startedAt: '2026-10-23T10:00:00.000Z', finishedAt: '2026-10-23T10:06:00.000Z', sets, totals: {} });

test('the frame address names this app as the parent and keeps the page', () => {
  assert.equal(poseFrameUrl('http://localhost:8765/web/index.html', 'http://localhost:8081'),
    'http://localhost:8765/web/index.html?embed=1&parent=http%3A%2F%2Flocalhost%3A8081');
  assert.equal(poseFrameUrl('http://localhost:8765/web/index.html?embed=1&source=rec%3Ax', 'http://localhost:8082'),
    'http://localhost:8765/web/index.html?embed=1&source=rec%3Ax&parent=http%3A%2F%2Flocalhost%3A8082');
});

test('only the framed page, from its own origin, is heard', () => {
  const frame = {};
  const ev = (data, origin = 'http://localhost:8765', source = frame) => ({ data, origin, source });
  assert.deepEqual(poseMessage(ev({ type: 'pose-coach/ready', version: 'abc' }), frame, 'http://localhost:8765'),
    { type: 'pose-coach/ready', version: 'abc' });
  assert.equal(poseMessage(ev({ type: 'pose-coach/ready' }, 'http://localhost:9999'), frame, 'http://localhost:8765'), null);
  assert.equal(poseMessage(ev({ type: 'pose-coach/ready' }, 'http://localhost:8765', {}), frame, 'http://localhost:8765'), null);
  assert.equal(poseMessage(ev({ type: 'pose-coach/ready' }), undefined, 'http://localhost:8765'), null);   // no frame yet
  assert.equal(poseMessage(ev({ type: 'other/ready' }), frame, 'http://localhost:8765'), null);
  assert.equal(poseMessage(ev(null), frame, 'http://localhost:8765'), null);
  assert.equal(poseMessage(ev('pose-coach/ready'), frame, 'http://localhost:8765'), null);
});

test('a camera workout becomes a session: one entry per exercise, in the order first done', () => {
  const s = sessionFromWorkout(workout([set('squat', 'Squat', 1, 8, { partials: 2 }), set('lunge', 'Lunge', 1, 6), set('squat', 'Squat', 2, 7)]),
    { localDate: '2026-10-23' });
  assert.deepEqual(s, {
    routineId: null, routineName: 'Camera workout', planItemId: null, localDate: '2026-10-23',
    startedAt: '2026-10-23T10:00:00.000Z', finishedAt: '2026-10-23T10:06:00.000Z',
    entries: [
      { name: 'Squat', skipped: false, sets: [{ reps: 8, completed: true }, { reps: 7, completed: true }] },
      { name: 'Lunge', skipped: false, sets: [{ reps: 6, completed: true }] },
    ],
    notes: 'Counted by the camera coach. 2 partial reps not counted.',
  });
  const r = sessionFromWorkout(workout([set('squat', 'Squat', 1, 5)]), { localDate: '2026-10-23', routineId: 'r1', routineName: 'Legs', planItemId: 'p1' });
  assert.deepEqual([r.routineId, r.routineName, r.planItemId, r.notes], ['r1', 'Legs', 'p1', 'Counted by the camera coach.']);
});

test('a session stays within the API limits', () => {
  const many = [];
  for (let e = 0; e < 60; e++) for (let n = 1; n <= 20; n++) many.push(set(`ex${e}`, 'X'.repeat(200), n, 900));
  const s = sessionFromWorkout(workout([...many, set('zero', 'Zero', 1, 0)]), { localDate: '2026-10-23' });
  assert.equal(s.entries.length, 50);
  assert.ok(s.entries.every((x) => x.sets.length === 20 && x.name.length === 120 && x.sets.every((y) => y.reps === 500)));
  assert.ok(!s.entries.some((x) => x.name === 'Zero'));
  const backwards = sessionFromWorkout({ ...workout([]), finishedAt: '2026-10-23T09:00:00.000Z' }, { localDate: '2026-10-23' });
  assert.equal(backwards.finishedAt, backwards.startedAt);              // never before the start (the API's rule)
});

test('the line that says what will be saved', () => {
  assert.equal(workoutLine([set('squat', 'Squat', 1, 8), set('lunge', 'Lunge', 1, 6), set('squat', 'Squat', 2, 8)]), 'Squat 2 × 8 · Lunge 1 × 6');
  assert.equal(workoutLine([set('squat', 'Squat', 1, 8), set('squat', 'Squat', 2, 7)]), 'Squat 8, 7');
  assert.equal(workoutLine([]), '');
});

test('the page is on 127.0.0.1 by default, so the browser sends it none of the app\'s localhost cookies', () => {
  assert.equal(new URL(POSE_URL).hostname, '127.0.0.1');
});

test('runs on the same screen add up until saved', () => {
  const first = addRun(null, { startedAt: '2026-10-23T10:00:00.000Z', finishedAt: '2026-10-23T10:04:00.000Z', sets: [set('squat', 'Squat', 1, 8)] });
  assert.deepEqual(first.totals, { squat: { label: 'Squat', sets: 1, reps: 8 } });
  const both = addRun(first, { startedAt: '2026-10-23T10:06:00.000Z', finishedAt: '2026-10-23T10:09:00.000Z',
    sets: [set('squat', 'Squat', 1, 6), set('lunge', 'Lunge', 1, 4)] });
  assert.deepEqual([both.startedAt, both.finishedAt], ['2026-10-23T10:00:00.000Z', '2026-10-23T10:09:00.000Z']);
  assert.deepEqual(both.sets.map((s) => `${s.exercise}:${s.reps}`), ['squat:8', 'squat:6', 'lunge:4']);
  assert.deepEqual(both.totals, { squat: { label: 'Squat', sets: 2, reps: 14 }, lunge: { label: 'Lunge', sets: 1, reps: 4 } });
  assert.deepEqual(sessionFromWorkout(both, { localDate: '2026-10-23' }).entries.map((e) => [e.name, e.sets.map((x) => x.reps)]),
    [['Squat', [8, 6]], ['Lunge', [4]]]);
  const empty = addRun(first, { startedAt: '2026-10-23T10:05:00.000Z', finishedAt: '2026-10-23T10:05:30.000Z', sets: [] });
  assert.equal(empty.sets.length, 1);
});


test('more than 20 sets of one exercise go on in another entry of the same name, none dropped', () => {
  const emom = Array.from({ length: 30 }, (_, i) => set('squat', 'Squat', i + 1, 10));
  const s = sessionFromWorkout(workout([...emom, set('lunge', 'Lunge', 1, 6)]), { localDate: '2026-10-23' });
  assert.deepEqual(s.entries.map((e) => [e.name, e.sets.length]), [['Squat', 20], ['Squat', 10], ['Lunge', 1]]);
});

// --- what the screen counts, message by message -----------------------------------------------------------------
const T0 = '2026-10-23T10:00:00.000Z', T1 = '2026-10-23T10:10:00.000Z', NOW = '2026-10-23T10:20:00.000Z';
const msg = {
  ready: { type: 'pose-coach/ready', version: 'v' },
  start: (startedAt) => ({ type: 'pose-coach/state', running: true, startedAt }),
  stopping: (startedAt) => ({ type: 'pose-coach/state', running: false, startedAt }),
  progress: (s) => ({ type: 'pose-coach/progress', ...s }),
  set: (s) => ({ type: 'pose-coach/set', ...s }),
  summary: (startedAt, sets) => ({ type: 'pose-coach/summary', startedAt, finishedAt: NOW, sets, totals: {} }),
};
/** The messages in order; returns the last state and the flags of every step. */
function play(messages, c = NOTHING_COUNTED) {
  const steps = [];
  for (const m of messages) {
    const r = countMessage(c, m, NOW);
    steps.push({ started: r.started, ended: r.ended });
    c = r.counted;
  }
  return { c, steps };
}
const reps = (c) => {
  const r = (countedWorkout(c, NOW)?.sets ?? []).map((s) => `${s.exercise}:${s.reps}`);
  assert.deepEqual(countedSets(c).map((s) => `${s.exercise}:${s.reps}`), r);   // what the screen shows is what it saves
  return r;
};

test('one run: the set in progress counts at once, finished sets as they come, then the summary has the last word', () => {
  const sq = set('squat', 'Squat', 1, 8), lu = set('lunge', 'Lunge', 1, 6);
  const mid = play([msg.ready, msg.start(T0), msg.progress({ ...sq, reps: 3 })]);
  assert.deepEqual(reps(mid.c), ['squat:3']);                                  // a rep in, already kept
  const ended = play([msg.progress(sq), msg.set(sq), msg.progress({ ...lu, reps: 2 })], mid.c);
  assert.deepEqual(reps(ended.c), ['squat:8', 'lunge:2']);
  const { c, steps } = play([msg.set(lu), msg.stopping(T0), msg.summary(T0, [sq, { ...lu, reps: 7 }])], ended.c);
  assert.equal(c.run, null);
  assert.deepEqual(reps(c), ['squat:8', 'lunge:7']);                           // the summary's counts
  assert.deepEqual(steps.map((s) => s.ended), [false, false, true]);
});

test('a summary sent again (asked to stop after it had stopped) is not counted twice', () => {
  const sq = set('squat', 'Squat', 1, 8);
  const { c, steps } = play([msg.start(T0), msg.set(sq), msg.summary(T0, [sq]), msg.summary(T0, [sq])]);
  assert.deepEqual(reps(c), ['squat:8']);
  assert.equal(steps.at(-1).ended, true);                                      // still answers a waiting Finish and save
});

test('runs on the same screen add up; a new run never drops the earlier ones', () => {
  const a = set('squat', 'Squat', 1, 8), b = set('squat', 'Squat', 1, 5);
  const { c } = play([msg.start(T0), msg.summary(T0, [a]), msg.start(T1), msg.progress(b)]);
  assert.deepEqual(reps(c), ['squat:8', 'squat:5']);
  const done = play([msg.set(b), msg.summary(T1, [b])], c).c;
  assert.deepEqual(reps(done), ['squat:8', 'squat:5']);
  assert.equal(countedWorkout(done, NOW).startedAt, T0);
  assert.equal(play([msg.start(T1)], c).steps[0].started, false);              // the same start again: nothing new
});

test('the page reloads mid-run: what it had counted, the set in progress too, is kept and the run is over', () => {
  const a = set('squat', 'Squat', 1, 8);
  const { c, steps } = play([msg.start(T0), msg.set(a), msg.progress(set('lunge', 'Lunge', 1, 4)), msg.ready]);
  assert.equal(c.run, null);
  assert.deepEqual(reps(c), ['squat:8', 'lunge:4']);
  assert.equal(steps.at(-1).ended, true);
  assert.equal(play([msg.ready]).steps[0].ended, false);                       // the first ready ends nothing
});

test('a late answer to stop: the run kept by the timeout is replaced by its summary, late sets do not open a run', () => {
  const sq = set('squat', 'Squat', 1, 8), lu = set('lunge', 'Lunge', 1, 10);
  const timedOut = endRun(play([msg.start(T0), msg.set(sq), msg.progress({ ...lu, reps: 6 })]).c, NOW);
  assert.deepEqual(reps(timedOut), ['squat:8', 'lunge:6']);
  const late = play([msg.set(lu), msg.progress(lu), msg.stopping(T0)], timedOut);
  assert.equal(late.c.run, null);                                              // no phantom run
  const { c, steps } = play([msg.summary(T0, [sq, lu])], late.c);
  assert.deepEqual(reps(c), ['squat:8', 'lunge:10']);                          // the full count, once
  assert.equal(steps[0].ended, true);
  assert.deepEqual(reps(play([msg.summary(T0, [sq, lu])], c).c), ['squat:8', 'lunge:10']);
  assert.equal(endRun(NOTHING_COUNTED, NOW), NOTHING_COUNTED);
});

test('a start without a summary of the run before it keeps that run', () => {
  const a = set('squat', 'Squat', 1, 8);
  const { c, steps } = play([msg.start(T0), msg.set(a), msg.start(T1)]);
  assert.deepEqual(reps(c), ['squat:8']);
  assert.equal(c.run.startedAt, T1);
  assert.equal(steps.at(-1).started, true);
  assert.deepEqual(reps(play([msg.set(a), msg.progress(a)]).c), []);           // outside any run: ignored
});

test('an empty run (cancelled, or no full set) adds nothing but still ends a waiting finish', () => {
  const kept = play([msg.start(T0), msg.summary(T0, [set('squat', 'Squat', 1, 8)])]).c;
  const { c, steps } = play([msg.start(T1), msg.progress(set('lunge', 'Lunge', 1, 0)), msg.stopping(T1), msg.summary(T1, [])], kept);
  assert.deepEqual(reps(c), ['squat:8']);
  assert.equal(c.run, null);
  assert.equal(steps.at(-1).ended, true);
  assert.equal(countedWorkout(NOTHING_COUNTED, NOW), null);
});

test('errors and unknown messages change nothing', () => {
  const c = play([msg.start(T0)]).c;
  assert.equal(countMessage(c, { type: 'pose-coach/error', message: 'no camera' }, NOW).counted, c);
  assert.equal(countMessage(c, { type: 'pose-coach/other' }, NOW).counted, c);
});

// --- workouts kept on the device -----------------------------------------------------------------------------
test('a workout left a moment ago continues; older ones, or another day, are saved apart', () => {
  const at = (iso, sets = [set('squat', 'Squat', 1, 8)]) => ({ startedAt: iso, finishedAt: iso, sets, totals: {} });
  const now = new Date('2026-10-23T12:00:00');
  const old = at(new Date('2026-10-21T22:00:00').toISOString()), recent = at(new Date(now.getTime() - 10 * 60000).toISOString());
  assert.deepEqual(restoreWorkouts([old, recent], now), { earlier: [old], resume: recent });
  assert.deepEqual(restoreWorkouts([recent, old], now), { earlier: [recent, old], resume: null });   // the last one decides
  const stale = at(new Date(now.getTime() - CONTINUE_MS - 1000).toISOString());
  assert.deepEqual(restoreWorkouts([stale], now), { earlier: [stale], resume: null });
  const lateNight = new Date('2026-10-23T00:05:00'), beforeMidnight = at(new Date('2026-10-22T23:55:00').toISOString());
  assert.deepEqual(restoreWorkouts([beforeMidnight], lateNight), { earlier: [beforeMidnight], resume: null });
  assert.deepEqual(restoreWorkouts(recent, now), { earlier: [], resume: recent });                 // the old single format
  assert.deepEqual(restoreWorkouts([{ ...recent, sent: true }], now), { earlier: [{ ...recent, sent: true }], resume: null });  // a save went out
  assert.deepEqual(restoreWorkouts([{ ...recent, handedOver: true }], now).resume, null);              // keeps its routine
  for (const junk of [null, undefined, 'x', 3, {}, [{}], [at(recent.startedAt, [])]])
    assert.deepEqual(restoreWorkouts(junk, now), { earlier: [], resume: null });
});

test('a kept workout whose save went out is recognised by its start time, or not known when the list cannot tell', () => {
  const w = { startedAt: '2026-10-23T10:00:00.000Z', finishedAt: '2026-10-23T10:05:00.000Z', sets: [], totals: {} };
  const s = (startedAt, finishedAt = '2026-10-23T11:00:00Z') => ({ startedAt, finishedAt });
  assert.equal(serverHas(w, [s('2026-10-23T10:00:00Z')]), true);                         // the API's own format
  assert.equal(serverHas(w, [s('2026-10-23T10:00:01.000Z')]), false);
  assert.equal(serverHas(w, []), false);
  const newer = Array.from({ length: 50 }, (_, i) => s(`2026-10-24T0${i % 10}:00:00Z`, `2026-10-24T1${i % 10}:00:00Z`));
  assert.equal(serverHas(w, newer), null);                                                 // 50 newer sessions: can't tell
  assert.equal(serverHas(w, [...newer.slice(1), s('2026-10-22T09:00:00Z', '2026-10-22T10:00:00Z')]), false);
  assert.equal(serverHas(w, [...newer, s('2026-10-23T10:00:00.000Z')], 51), true);
});

test('a workout handed over for saving never grows: later runs count afresh, late messages of its runs are ignored', () => {
  const sq = set('squat', 'Squat', 1, 8), lu = set('lunge', 'Lunge', 1, 10);
  // run T0 ended by the stop timeout (its summary not seen), then handed over for saving
  const timedOut = endRun(play([msg.start(T0), msg.set(sq)]).c, NOW);
  const handed = countedWorkout(timedOut, NOW);
  const after = freeze(timedOut);
  assert.equal(countedWorkout(after, NOW), null);
  const late = play([msg.summary(T0, [sq, lu]), msg.start(T0)], after);
  assert.equal(countedWorkout(late.c, NOW), null);                             // T0's late summary: already handed over
  assert.equal(late.steps[0].ended, true);
  assert.equal(late.steps[1].started, false);
  const next = play([msg.start(T1), msg.set(lu), msg.summary(T1, [lu])], late.c).c;
  assert.deepEqual(reps(next), ['lunge:10']);                                  // a new workout, saved on its own
  assert.deepEqual(handed.sets.map((s) => s.reps), [8]);
  assert.deepEqual(freeze(play([msg.start(T1)], after).c).closed, [T0, T1]);   // a run in progress is handed over too
});

/** An exclusive lock manager like the browser's navigator.locks (request, ifAvailable, signal). */
function fakeLocks() {
  let holder = null;
  const queue = [];
  const grant = () => {
    if (holder || !queue.length) return;
    holder = queue.shift();
    const q = holder;
    Promise.resolve()
      .then(() => q.cb({ name: 'lock' }))
      .then(q.resolve, q.reject)
      .finally(() => {
        if (q.dropped) return;
        holder = null;
        grant();
      });
  };
  return {
    /** What Safari does when the holder's page goes into the back/forward cache: its request fails, the next gets it. */
    dropHolder() {
      const q = holder;
      holder = null;
      q.reject(new Error('AbortError'));
      q.dropped = true;
      grant();
    },
    request(name, opts, cb) {
      return new Promise((resolve, reject) => {
        if (opts.ifAvailable && (holder || queue.length)) return void Promise.resolve().then(() => cb(null)).then(resolve, reject);
        if (opts.signal?.aborted) return void reject(new Error('AbortError'));
        const q = { cb, resolve, reject };
        opts.signal?.addEventListener('abort', () => {
          const i = queue.indexOf(q);
          if (i >= 0) {
            queue.splice(i, 1);
            reject(new Error('AbortError'));
          }
        });
        queue.push(q);
        grant();
      });
    },
  };
}

test('one camera workout screen at a time: the first keeps it, a later one waits and takes over when it closes', async () => {
  const locks = fakeLocks();
  const log = [];
  const screen = (label) => holdScreen(locks, 'camera', {
    held: () => log.push(`${label} works`),
    waiting: () => log.push(`${label} waits`),
    lost: () => log.push(`${label} lost it`),
  });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const a = screen('A');
  await settle();
  const b = screen('B');
  await settle();
  assert.deepEqual(log, ['A works', 'B waits']);
  a();                                                          // A closes (a save, Discard, a reload)
  await settle();
  assert.deepEqual(log, ['A works', 'B waits', 'B works']);     // B takes over by itself
  const a2 = screen('A2');                                      // A opened again: now it waits, and only it
  await settle();
  assert.deepEqual(log.slice(3), ['A2 waits']);
  const c = screen('C');
  await settle();
  c();                                                          // a waiting screen that closes stops queueing
  b();
  await settle();
  assert.deepEqual(log.slice(3), ['A2 waits', 'C waits', 'A2 works']);
  a2();
  await settle();
  const d = screen('D');
  await settle();
  assert.equal(log.at(-1), 'D works');                          // all closed: the next one works at once
  const e = screen('E');
  await settle();
  locks.dropHolder();                                           // D's page into Safari's back/forward cache
  await settle();
  assert.deepEqual(log.slice(-3), ['E waits', 'D lost it', 'E works']);   // D is told, E takes over
  d();
  e();
  await settle();
  assert.ok(!log.slice(-3).includes('E lost it'));              // closing is not losing
});
