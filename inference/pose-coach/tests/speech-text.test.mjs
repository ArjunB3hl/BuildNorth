// How a cue is cut for speech synthesis: the page's rule, and the server worker's copy of it, agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sentences } from '../web/js/speech-text.js';

const CASES = [
  'Nice work. Keep your hips level and press all the way up.',
  'Now lunges. Step forward, keep your front knee over your ankle, and lower with control.',
  "Your arms are stopping short on the last two reps. Drive them all the way overhead, and watch the demo on screen.",
  'Set done: 2 reps. Next set, aim to lower until your chest nearly touches the floor, and keep your hips level.',
  'Workout complete.',
  'Squats now, nice work. Keep the pace steady.',
  'Lift your hips and keep a straight line from shoulders to heels; watch the demo.',
  '',
  'Hold the bottom for 1.5 seconds, then drive up.',
  'Your feet are only about 1.2 hip widths apart. Jump them out wider on the next rep.',
  'Turn your toes out a little, e.g. like the demo. Then sit back.',
  'Wait... what was that? Keep going.',
  'Rep 3. 4 more to go, keep the pace.',
  'Great job!\nNext up: squats.\n',
  'Nice. ... Keep going, all the way down to parallel.',
  '...',
  ' ?! ',
];

test('a short first sentence goes with the next; the first chunk ends at a clause when both sides are long enough', () => {
  assert.deepEqual(sentences(CASES[0]), ['Nice work. Keep your hips level and press all the way up.']);
  assert.deepEqual(sentences(CASES[1]), ['Now lunges. Step forward,', 'keep your front knee over your ankle, and lower with control.']);
  assert.deepEqual(sentences(CASES[2]), ['Your arms are stopping short on the last two reps.', 'Drive them all the way overhead, and watch the demo on screen.']);
  assert.deepEqual(sentences(CASES[4]), ['Workout complete.']);
  assert.deepEqual(sentences(CASES[6]), ['Lift your hips and keep a straight line from shoulders to heels;', 'watch the demo.']);
  assert.deepEqual(sentences(''), []);
});

test('a sentence does not end inside a number or after an abbreviation that goes on in lowercase', () => {
  assert.deepEqual(sentences(CASES[8]), ['Hold the bottom for 1.5 seconds,', 'then drive up.']);
  assert.deepEqual(sentences(CASES[9]), ['Your feet are only about 1.2 hip widths apart.', 'Jump them out wider on the next rep.']);
  assert.deepEqual(sentences(CASES[10]), ['Turn your toes out a little,', 'e.g. like the demo.', 'Then sit back.']);
  assert.deepEqual(sentences(CASES[11]), ['Wait... what was that? Keep going.']);
  assert.deepEqual(sentences(CASES[12]), ['Rep 3. 4 more to go,', 'keep the pace.']);          // a digit after a space starts one
  assert.deepEqual(sentences(CASES[13]), ['Great job! Next up: squats.']);
});

test('a piece with no letter or digit has nothing to say: dropped, and a cue of only such pieces has no chunk', () => {
  assert.deepEqual(sentences(CASES[14]), ['Nice. Keep going,', 'all the way down to parallel.']);
  assert.deepEqual(sentences(CASES[15]), []);
  assert.deepEqual(sentences(CASES[16]), []);
});

test('the server worker (Python) cuts every cue the same way', () => {
  const py = `import json, sys; sys.path.insert(0, 'server'); from kokoro_worker import sentences; print(json.dumps([sentences(t) for t in json.loads(sys.stdin.read())]))`;
  const out = execFileSync('python3', ['-c', py], { input: JSON.stringify(CASES), cwd: new URL('..', import.meta.url) });
  assert.deepEqual(JSON.parse(out), CASES.map(sentences));
});
