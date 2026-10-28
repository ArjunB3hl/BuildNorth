import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostAgent, accountConnections, describeHostedEvent } from '../web/js/host-agent.js';

test('hosted agent receives measured events without depending on a local formatter', () => {
  const event = { kind: 'set_end', exercise: 'squat', reps: 8, summary: 'ignored incoming summary' };
  assert.match(describeHostedEvent(event, 'Eight repetitions counted.').summary, /may be resting.*do not ask them to reposition/i);
  assert.match(describeHostedEvent({ kind: 'confirm_set_end' }, 'Is your set done?').summary, /may be resting/i);
  assert.match(describeHostedEvent(event, null).summary, /do not assume good form/);
  assert.equal(event.summary, 'ignored incoming summary');
});

test('one authorization request at a time, stale replies ignored, secrets never requested from the host', async () => {
  const handlers = {}, sent = [];
  const session = hostAgent({ on: (n, f) => { handlers[n] = f; }, send: (n, fields) => sent.push([n, fields]) });
  const a = session(), b = session();
  assert.equal(a, b); assert.equal(sent.length, 1);
  handlers['elevenlabs-session']({ requestId: 'old', signedUrl: 'wss://api.elevenlabs.io/test' });
  handlers['elevenlabs-session']({ requestId: '1', signedUrl: 'wss://api.elevenlabs.io/test' });
  assert.equal(await a, 'wss://api.elevenlabs.io/test');
  assert.deepEqual(sent[0], ['elevenlabs-session-request', { requestId: '1' }]);
});
test('invalid or timed-out authorization fails closed', async () => {
  const handlers = {};
  const session = hostAgent({ on: (n, f) => { handlers[n] = f; }, send() {} }, 15);
  const a = session();
  handlers['elevenlabs-session']({ requestId: '1', signedUrl: 'wss://attacker.example/test' });
  await assert.rejects(a, /Reconnect/);
  await assert.rejects(session(), /did not authorize/);
});
test('embedded mode never borrows a local Claude or ChatGPT sign-in', () => {
  for (const connected of [true, false]) {
    const info = accountConnections(connected);
    assert.equal(info.eleven.connected, connected);
    assert.equal(info.claude.available, false);
    assert.equal(info.chatgpt.loggedIn, false);
  }
});
