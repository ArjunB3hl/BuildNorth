import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCountdown, sessionIntroEvent, SESSION_INTRO_TEXT } from '../web/js/session-start.js';

test('the visible countdown lasts five seconds and never announces tracking success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const ticks = []; let finished = false;
  const done = waitForCountdown({ now: () => Date.now(), onTick: n => ticks.push(n) }).then(ok => { finished = ok; });
  assert.deepEqual(ticks, [5]);
  for (let second = 1; second < 5; second++) { t.mock.timers.tick(1000); await Promise.resolve(); }
  assert.equal(finished, false);
  assert.deepEqual(ticks, [5, 4, 3, 2, 1]);
  t.mock.timers.tick(999); await Promise.resolve(); assert.equal(finished, false);
  t.mock.timers.tick(1); await done; assert.equal(finished, true);
  assert.deepEqual(ticks, [5, 4, 3, 2, 1]);
});

test('cancelling stops the countdown immediately and leaves no later start or ticks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const controller = new AbortController(), ticks = [];
  const done = waitForCountdown({ signal: controller.signal, now: () => Date.now(), onTick: n => ticks.push(n) });
  t.mock.timers.tick(1000); controller.abort();
  assert.equal(await done, false);
  t.mock.timers.tick(10000); assert.deepEqual(ticks, [5, 4]);
  assert.equal(await waitForCountdown({ signal: controller.signal, onTick: () => assert.fail('already cancelled') }), false);
});

test('a delayed browser callback uses elapsed time instead of adding extra countdown seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0; const ticks = [];
  const done = waitForCountdown({ now: () => now, onTick: n => ticks.push(n) });
  now = 6000; t.mock.timers.tick(100);
  assert.equal(await done, true); assert.deepEqual(ticks, [5]);
});

test('the session introduction asks for a choice and declares that tracking is not yet confirmed', () => {
  const event = sessionIntroEvent();
  assert.equal(event.kind, 'ask_exercise');
  assert.equal(event.trackingStatus, 'awaiting_pose');
  assert.ok(event.summary.includes(SESSION_INTRO_TEXT));
  assert.match(SESSION_INTRO_TEXT, /What would you like to do today\?$/);
  assert.match(event.summary, /No successful tracking update or restart is confirmed/);
  assert.match(event.summary, /until the user chooses/);
  assert.match(event.summary, /do not announce a movement timer/);
});
