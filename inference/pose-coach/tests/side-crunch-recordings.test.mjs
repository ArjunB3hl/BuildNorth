// Private recording annotations live beside the private library, never in git. Each case names a recording,
// measured sweep count / window, expected fault windows and framing window. The newest also labels the cropped
// interval and the strongly bent sweeps. Missing data skips these checks; synthetic coverage lives in the group tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { features } from '../web/js/engine.js';
import { MovementTracker } from '../web/js/moves.js';
import { bodyMetrics, MOVE_FORMS } from '../web/js/moveform.js';

const data = new URL('../.data/', import.meta.url);
const read = url => fs.existsSync(url) ? JSON.parse(fs.readFileSync(url, 'utf8')) : null;
const movement = read(new URL('moves/library.json', data))?.movements.find(m => m.key === 'standing_side_crunch');
const cases = read(new URL('moves/side_crunch_cases.json', data))?.cases ?? [];
const inWindow = (t, [a, b]) => t >= a && t <= b;
const objects = a => a.map(([x, y, z, visibility = 1]) => ({ x, y, z, visibility }));
const cache = new Map();
function replay(c) {
  if (cache.has(c)) return cache.get(c);
  const rec = read(new URL(`posedata/results/live/${c.file}`, data));
  if (!rec || !movement) return null;
  const tr = new MovementTracker({ movement }), events = [], counted = [], rows = [], t0 = rec.frames[0].t;
  for (const fr of rec.frames) {
    const t = (fr.t - t0) / 1000, before = tr.cycles.count;
    const lm = fr.world && fr.image ? { world: objects(fr.world), image: objects(fr.image), aspect: rec.width / rec.height } : null;
    for (const e of lm ? tr.update(features(lm.world, lm.image, lm.aspect), fr.t, lm) : tr.lost(fr.t)) {
      events.push({ ...e, at: t });
    }
    if (tr.cycles.count > before) counted.push(t);
    if (lm) rows.push({ t, lm, m: bodyMetrics(lm.world, lm.image, lm.aspect) });
  }
  const result = { tr, events, counted, rows }; cache.set(c, result); return result;
}

test('private side crunches: each annotated fault is told in its measured interval, with no unrelated fault', t => {
  if (!cases.length || !movement) return t.skip('no private cases or library');
  for (const c of cases) {
    const r = replay(c); if (!r) return t.skip('recording absent');
    const faults = r.events.filter(e => e.type === 'form_fault');
    for (const want of c.faults) assert.ok(faults.some(e => e.fault === want.fault && inWindow(e.at, want.window)), want.fault);
    assert.ok(faults.every(e => c.faults.some(w => w.fault === e.fault)), 'only annotated fault kinds');
  }
});

test('private side crunches: counts stay within one measured sweep, including alternating legs and high lifts', t => {
  if (!cases.length || !movement) return t.skip('no private cases or library');
  for (const c of cases) {
    const r = replay(c); if (!r) return t.skip('recording absent');
    const count = r.counted.filter(at => inWindow(at, c.window)).length;
    assert.ok(Math.abs(count - c.sweeps) <= 1, `${count} counted, ${c.sweeps} measured sweeps`);
    if (c.cropped) assert.ok(r.counted.every(at => !inWindow(at, c.cropped)), 'never count inferred cropped legs');
  }
});

test('private side crunches: ask to step back during the cropped interval, with hips and knees included', t => {
  if (!cases.length || !movement) return t.skip('no private cases or library');
  for (const c of cases) {
    const r = replay(c); if (!r) return t.skip('recording absent');
    const unseen = r.events.filter(e => e.type === 'form_unseen' && inWindow(e.at, c.unseen));
    assert.ok(unseen.length, 'framing request during the set');
    if (c.cropped) {
      assert.ok(unseen.some(e => e.parts.includes('legs')), 'the knees, not just the ankles');
      assert.ok(r.events.every(e => e.type !== 'form_fault' || !inWindow(e.at, c.cropped)), 'no guessed form verdict');
    }
  }
});

test('private side crunch: strongly bent outward sweeps remain eligible below a 100 degree knee angle', t => {
  const c = cases.find(c => c.strong_bend);
  if (!c || !movement) return t.skip('no annotated strong bends');
  const r = replay(c); if (!r) return t.skip('recording absent');
  const checks = MOVE_FORMS.standing_side_crunch.filter(c => c.id.startsWith('swept_knee'));
  assert.ok(r.rows.some(({ t, m, lm }) => inWindow(t, c.strong_bend) && checks.some(check =>
    check.needs.every(p => m.seen[p]) && check.value(m) < 100 && check.phase(m, lm))), 'measured strong bend eligible');
});
