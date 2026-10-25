// The form check's text and highlighting cover every fault the engine can raise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXERCISES } from '../web/js/engine.js';
import { boneParts, bonesFor, describeFault, mirrorImage } from '../web/js/formcheck.js';

// every F('code', 'part', ...) in each exercise's checks, read from the engine's source
const src = fs.readFileSync(new URL('../web/js/engine.js', import.meta.url), 'utf8');
const keys = Object.keys(EXERCISES);
const faults = [];
for (const [i, key] of keys.entries()) {
  const from = src.indexOf(`\n  ${key}: {`), to = i + 1 < keys.length ? src.indexOf(`\n  ${keys[i + 1]}: {`) : src.indexOf('\n};', from);
  for (const m of src.slice(from, to).matchAll(/F\('([a-z_]+)', '([a-z ]+)', '([^']+|[^"]+)'/g)) faults.push({ exercise: key, code: m[1], part: m[2], message: m[3] });
}

test('the engine has faults to describe (parser sanity)', () => {
  assert.ok(faults.length >= 25, `found ${faults.length}`);
  assert.ok(faults.some(f => f.exercise === 'squat' && f.code === 'shallow'));
});

test('every fault has its measurement in plain words with what to aim for', () => {
  for (const f of faults) {
    const text = describeFault(f.exercise, { ...f, value: 0.5 });
    assert.notEqual(text, f.message, `${f.exercise}/${f.code} has no description`);
    assert.ok(!/NaN|undefined/.test(text), `${f.exercise}/${f.code}: ${text}`);
  }
});

test('every fault colours some body part on the replay', () => {
  for (const f of faults) assert.ok(bonesFor(f.part, 'left').length > 0, `${f.exercise}/${f.code} part "${f.part}"`);
  assert.notDeepEqual(bonesFor('arm', 'left'), bonesFor('arm', 'right'));
});

test('a squat that stopped short reads as degrees against the goal', () => {
  assert.equal(describeFault('squat', { code: 'shallow', value: 118.4, message: '' }), 'Your knees bent to 118° at the bottom. Aim for 110° or less.');
});

// A held pose's faults (web/js/holdform.js `part`, with the user's own `side` for a part on one side of the body): each
// colours that part, one limb when a side is named; the stance's feet with the gap between them
const holdSrc = fs.readFileSync(new URL('../web/js/holdform.js', import.meta.url), 'utf8');
const holdParts = new Set(['feet', 'legs', 'arm', 'arms', 'torso', 'chest', 'knee', 'hips',
  ...[...holdSrc.matchAll(/\bpart: '([a-z ]+)'/g)].map(m => m[1])]);

test("every body part a held pose's fault names colours some bones, one limb when a side is named", () => {
  for (const p of holdParts) {
    assert.ok(boneParts().includes(p), `no bones for part '${p}'`);
    assert.ok(bonesFor(p, null).length > 0, `no bones for part '${p}'`);
  }
  for (const p of ['arm', 'knee', 'leg']) {
    const L = bonesFor(p, 'left'), R = bonesFor(p, 'right'), both = bonesFor(p, null);
    assert.ok(L.flat().every(i => i % 2 === 1), `${p}: the left side's landmarks only`);
    assert.ok(R.flat().every(i => i % 2 === 0), `${p}: the right side's landmarks only`);
    assert.deepEqual(both, [...L, ...R], `${p}: no side, both`);
  }
  assert.deepEqual(bonesFor('knee', 'right'), [[24, 26], [26, 28]]);
  assert.ok(bonesFor('feet').some(([a, b]) => a === 27 && b === 28), 'the gap between the ankles (the stance)');
});

test("a held pose's reference turned to the other side: x flipped, its left and right landmarks swapped", () => {
  const image = Array.from({ length: 33 }, (_, i) => ({ x: i / 64, y: i / 33, visibility: 1 }));   // (exact in binary)
  const m = mirrorImage(image);
  assert.equal(m[0].x, 1 - image[0].x);                                     // (the nose has no pair)
  assert.deepEqual(m[27], { x: 1 - image[28].x, y: image[28].y, visibility: 1 }, "the left ankle: the right one's");
  assert.deepEqual(m[28], { x: 1 - image[27].x, y: image[27].y, visibility: 1 });
  assert.deepEqual(mirrorImage(m), image, 'twice: as it was');
  assert.equal(image[27].x, 27 / 64, '(the reference itself is left as it is)');
});
