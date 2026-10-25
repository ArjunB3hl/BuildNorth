import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkoutCases } from '../tools/workout_cases.mjs';

test('private workout cases are optional, and resolve recordings from their data directory', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pose-cases-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const file = path.join(data, 'workouts.json');
  assert.deepEqual(readWorkoutCases(file, data), []);
  fs.writeFileSync(file, JSON.stringify([{ name: 'synthetic sequence', segs: [
    { clip: 'results/live/example.json', from: 1, to: 3 },
    { clip: 'example-jump', around: true, loops: 4 }, { rest: 'example-idle', ms: 4000 }, { gone: 3000 },
  ], expect: ['jump#1=4/stop'], startCounts: [2] }]));
  const [workout] = readWorkoutCases(file, data, clip => ({ clip, from: 2, to: 5 }));
  assert.deepEqual(workout.segs, [
    { clip: path.join(data, 'results/live/example.json'), from: 1, to: 3 },
    { clip: 'example-jump', from: 2, to: 5, loops: 4 }, { rest: 'example-idle', ms: 4000 }, { gone: 3000 },
  ]);
  assert.deepEqual(workout.expect, ['jump#1=4/stop']);
  assert.deepEqual(workout.startCounts, [2]);
});

test('malformed private annotations fail instead of silently dropping regression checks', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pose-cases-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const file = path.join(data, 'workouts.json');
  for (const value of ['{', '{}', '[null]', JSON.stringify([{ name: 'synthetic', segs: [{}], expect: [] }])]) {
    fs.writeFileSync(file, value);
    assert.throws(() => readWorkoutCases(file, data));
  }
});
