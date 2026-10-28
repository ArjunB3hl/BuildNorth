import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isResting, REST_PAUSE_MS } from '../web/js/rest-state.js';

test('framing guidance is available before exercise and during an active set', () => {
  assert.equal(isResting({ active: null, sets: [] }, 50000), false);
  assert.equal(isResting({ active: { lastRepT: 1000 }, sets: [{}] }, 1000 + REST_PAUSE_MS - 1), false);
});

test('a pause, a question about ending the set, and time between completed sets are treated as rest', () => {
  assert.equal(isResting({ active: { lastRepT: 1000 }, sets: [{}] }, 1000 + REST_PAUSE_MS), true);
  assert.equal(isResting({ active: { lastRepT: 1000, asking: true }, sets: [{}] }, 1200), true);
  assert.equal(isResting({ active: null, sets: [{}] }, 50000), true);
});

test('a new rep or set resumes normal framing guidance', () => {
  const tracker = { active: { lastRepT: 1000 }, sets: [{}] };
  assert.equal(isResting(tracker, 5000), true);
  tracker.active.lastRepT = 5000;
  assert.equal(isResting(tracker, 5000), false);
  tracker.active = { lastRepT: 9000 };
  assert.equal(isResting(tracker, 9000), false);
});

test('the page forwards visibility cues at setup or during activity, but not during a rest', () => {
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('function coaching(e, who, repsLabel)'), app.indexOf('// --- auto mode'));
  const sent = [], state = { auto: { active: null, sets: [] }, exercise: 'squat' };
  const coaching = new Function('S', 'isResting', 'coachEvent', 'FALLBACK', `${source}; return coaching;`)(
    state, isResting, event => sent.push(event), { visibility: () => 'Step back' });
  const missing = t => ({ type: 'visibility', parts: ['legs'], t });
  coaching(missing(100), {}, '');
  state.auto = { active: { lastRepT: 1000 }, sets: [{}] };
  coaching(missing(1500), {}, '');
  coaching(missing(5000), {}, '');
  state.auto.active = null;
  coaching(missing(15000), {}, '');
  state.auto.active = { lastRepT: 20000 };
  coaching(missing(20500), {}, '');
  assert.deepEqual(sent.map(event => event.kind), ['visibility', 'visibility', 'visibility']);
});
