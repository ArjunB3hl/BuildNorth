import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OneTwoTechnique, techniquePoses } from '../web/js/technique.js';
import { MovementTracker, statusText } from '../web/js/moves.js';
import { features } from '../web/js/engine.js';
import { skeletonFromNpz, techniqueFrames } from '../tools/build_moves.mjs';
const movement = { key: 'one_two_jab', display: 'Practice one-two', kind: 'technique', track: 'technique' };
const clone = (x) => structuredClone(x);
function pose({
  punch = 'R',
  extension = 0,
  angle = 0,
  drop = false,
  frontal = false,
  mirror = false,
  cropped = false,
} = {}) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: -0.7, z: 0 }));
  const set = (i, x, y, z = 0) => (w[i] = { x, y, z });
  set(0, 0.1, -0.75);
  set(11, -0.03, -0.5, 0.15);
  set(12, 0.03, -0.5, -0.15);
  set(23, -0.02, 0, 0.12);
  set(24, 0.02, 0, -0.12);
  for (const [s, i] of [
    ['L', 11],
    ['R', 12],
  ]) {
    const e = s === punch ? extension : 0,
      z = w[i].z;
    set(i + 2, 0.1 + 0.25 * e, -0.25 - 0.25 * e, z);
    set(i + 4, 0.2 + 0.45 * e, -0.5 - Math.tan((angle * Math.PI) / 180) * 0.62 * e, z);
    if (drop && s !== punch) {
      w[i + 4].y += 0.45 * extension;
      w[i + 2].y += 0.1 * extension;
    }
    set(i + 14, 0.02, 0.5, z);
    set(i + 16, 0.02, 1, z);
    set(i + 18, 0.02, 1, z);
    set(i + 20, 0.12, 1, z);
  }
  if (frontal)
    for (const p of w) {
      const x = p.x;
      p.x = p.z;
      p.z = -x;
    }
  const image = w.map((p) => ({ ...p, x: 0.5 + p.x / ((2.4 * 16) / 9), y: 0.5 + p.y / 2.4, visibility: 1 }));
  if (cropped) image[16].visibility = 0;
  if (mirror) {
    for (const p of w) p.x = -p.x;
    for (const p of image) p.x = 1 - p.x;
    for (let i = 11; i < 33; i += 2) {
      [w[i], w[i + 1]] = [w[i + 1], w[i]];
      [image[i], image[i + 1]] = [image[i + 1], image[i]];
    }
  }
  return { world: w, image, aspect: 16 / 9 };
}
function run({
  same = false,
  angle = 0,
  drop = false,
  frontal = false,
  cropped = false,
  mirror = false,
  pace = 1,
  missing = false,
  returnMissing = false,
} = {}) {
  const tr = new MovementTracker({ movement }),
    events = [];
  for (let t = 0; t < 6500 / pace; t += 1000 / 30) {
    const clock = t * pace,
      which = clock < 1250 ? 'R' : same ? 'R' : 'L',
      start = clock < 1250 ? 300 : 1400;
    let e = clock >= start && clock < start + 800 ? Math.sin(((clock - start) / 800) * Math.PI) : 0;
    if (returnMissing && clock >= 1800) e = 0.8;
    const lm = pose({ punch: which, extension: e, angle, drop, frontal, cropped, mirror });
    const out =
      missing && clock > 700 && clock < 1500 ? tr.lost(t) : tr.update(features(lm.world, lm.image, lm.aspect), t, lm);
    events.push(...out);
  }
  return { tr, events };
}
const faults = (es) => es.filter((e) => e.type === 'form_fault');
test('technique track: a single jab–cross is assessed with no count, time or rhythm events', () => {
  const { tr, events } = run();
  assert.equal(faults(events).length, 0);
  assert.ok(events.some((e) => e.type === 'technique_result' && e.sequence === 'jab_cross' && e.verdict === 'partial'));
  for (const e of [tr.current(), tr.summary(), ...events]) {
    assert.ok(!('count' in e));
    assert.ok(!('seconds' in e));
  }
  assert.ok(!events.some((e) => e.type === 'rhythm_progress'));
  assert.doesNotMatch(statusText(tr.current()), /About|\d/);
  assert.ok(tr.current().result.unmeasured.some((x) => /rotation/.test(x)));
});
test('upward punches: the first punch alone is corrected, with its measured window and side, at varied pace and mirrored', () => {
  for (const pace of [0.5, 1, 2])
    for (const mirror of [false, true]) {
      const { events } = run({ angle: 30, pace, mirror });
      const fs = faults(events);
      assert.ok(fs.some((e) => e.fault === 'punch_up' && e.t < 1400 / pace));
      assert.equal(fs[0].side, mirror ? 'left' : 'right');
      assert.ok(fs[0].seen.from < fs[0].seen.to);
      assert.match(fs[0].measured, /3\d degrees upward/);
    }
});
test('a new attempt is assessed independently; two jabs never pass as a complete one-two', () => {
  const { events } = run({ same: true });
  const results = events.filter((e) => e.type === 'technique_result');
  assert.ok(results.some((e) => e.sequence === 'same_hand' && e.verdict === 'incomplete'));
  assert.ok(!results.some((e) => e.sequence === 'jab_cross'));
  const tr = new OneTwoTechnique(),
    es = [];
  for (let t = 0; t < 6000; t += 1000 / 30) {
    const start = [300, 1400, 3100, 4200].find((s) => t >= s && t < s + 800);
    const extension = start == null ? 0 : Math.sin(((t - start) / 800) * Math.PI);
    es.push(
      ...tr.update(
        pose({ punch: start === 1400 || start === 4200 ? 'L' : 'R', extension, angle: t < 2500 ? 30 : 0 }),
        t
      )
    );
  }
  assert.deepEqual(
    es.filter((e) => e.type === 'technique_result').map((e) => e.verdict),
    ['fault', 'partial']
  );
  assert.deepEqual(tr.current().form.open, [], 'the earlier attempt does not contaminate the next verdict');
});
test('guard drop and a missing return are measured separately from punch direction', () => {
  assert.ok(faults(run({ drop: true }).events).some((e) => e.fault === 'guard_drop'));
  assert.ok(faults(run({ returnMissing: true }).events).some((e) => e.fault === 'guard_return'));
  const tr = new OneTwoTechnique(),
    events = [];
  for (let t = 0; t < 4000; t += 1000 / 30)
    events.push(...tr.update(pose({ extension: Math.min(1, Math.max(0, (t - 300) / 400)) }), t));
  assert.ok(
    faults(events).some((e) => e.fault === 'guard_return'),
    'a hand held extended never turns back'
  );
});
test('frontal punches request a side view; cropped hands and tracking gaps cannot yield a clean attempt', () => {
  const front = run({ frontal: true });
  assert.ok(front.events.some((e) => e.type === 'form_unseen'));
  assert.equal(faults(front.events).length, 0);
  for (const options of [{ cropped: true }, { missing: true }])
    assert.ok(!run(options).events.some((e) => e.sequence === 'jab_cross'));
});
const data = new URL('../.data/', import.meta.url),
  read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : null);
const lib = read(new URL('moves/library.json', data)),
  entry = lib?.movements.find((m) => m.key === 'one_two_jab');
const catalog = read(new URL('moves/catalog.json', data));
const source = entry && catalog?.source ? path.join(catalog.source, entry.id, 'source/skeleton_motion.npz') : null;
const objects = (a) => a?.map(([x, y, z, visibility = 1]) => ({ x, y, z, visibility }));
function recording(rec) {
  return rec.frames.map((f) => ({
    t: f.t,
    lm:
      f.image && f.world ? { world: objects(f.world), image: objects(f.image), aspect: rec.width / rec.height } : null,
  }));
}
function replay(frames) {
  const tr = new OneTwoTechnique(),
    es = [];
  for (const f of frames) es.push(...tr.update(f.lm, f.t));
  es.push(...tr.finish(frames.at(-1).t));
  return { tr, es };
}
test('private reference: no faults at varied pace, mirrored and jittered; reference poses match each correction', (t) => {
  if (!source || !fs.existsSync(source)) return t.skip('no private reference');
  const ref = techniqueFrames(skeletonFromNpz(fs.readFileSync(source)));
  assert.deepEqual(Object.keys(techniquePoses(ref)).sort(), ['guard_drop', 'guard_return', 'punch_up']);
  for (const pace of [0.5, 1, 2])
    for (const mirror of [false, true])
      for (const jitter of [0, 0.001]) {
        const frames = ref.map((f) => {
          const lm = clone(f);
          for (const [i, p] of lm.world.entries()) {
            p.x += jitter * Math.sin(i + f.t);
            p.y += jitter * Math.cos(i + f.t);
          }
          if (mirror) {
            for (const p of lm.world) p.x = -p.x;
            for (const p of lm.image) p.x = 1 - p.x;
            for (let i = 11; i < 33; i += 2) {
              [lm.world[i], lm.world[i + 1]] = [lm.world[i + 1], lm.world[i]];
              [lm.image[i], lm.image[i + 1]] = [lm.image[i + 1], lm.image[i]];
            }
          }
          return { t: f.t / pace, lm };
        });
        const { es } = replay(frames);
        assert.deepEqual(faults(es), []);
        assert.ok(
          es.some((e) => e.sequence === 'jab_cross' && e.verdict === 'partial'),
          'reference attempt measured'
        );
        assert.ok(es.every((e) => e.type === 'technique_result' && e.sequence === 'jab_cross'));
      }
});
test('private source footage: no corrections on the measured reference footage', (t) => {
  const spec = read(new URL('moves/one_two_cases.json', data));
  const rec = spec && read(new URL(spec.footage, data));
  if (!rec) return t.skip('no private footage');
  assert.ok(rec.detectRate > 0.95, 'actual human footage tracked');
  const { es } = replay(recording(rec));
  assert.deepEqual(faults(es), []);
  assert.ok(
    es.some((e) => e.sequence === 'jab_cross' && e.verdict === 'partial'),
    'actual footage attempt measured'
  );
});
test('private recording: upward punches corrected in their measured windows; no false complete one-twos', (t) => {
  const spec = read(new URL('moves/one_two_cases.json', data));
  const rec = spec && read(new URL(spec.recording, data));
  if (!rec) return t.skip('no private recording');
  const { es, tr } = replay(recording(rec)),
    t0 = rec.frames[0].t;
  for (const [a, b] of spec.upward)
    assert.ok(es.some((e) => e.fault === 'punch_up' && (e.t - t0) / 1000 >= a && (e.t - t0) / 1000 <= b));
  assert.ok(tr.punches.length >= spec.punches - 1 && tr.punches.length <= spec.punches + 1);
  assert.ok(!es.some((e) => e.sequence === 'jab_cross'));
  assert.ok(es.every((e) => e.type !== 'form_fault' || e.fault === 'punch_up'));
});
test('private negatives: other recorded exercises produce no technique verdicts or corrections', (t) => {
  const dir = new URL('posedata/results/live/', data);
  if (!fs.existsSync(dir)) return t.skip('no private recordings');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const rec = read(new URL(f, dir));
    if (rec.movements?.some((m) => m.movement === 'one_two_jab')) continue;
    assert.deepEqual(replay(recording(rec)).es, [], 'unrelated workout');
  }
});
test('private library: technique mode has no rhythm metadata and every fault has a reference pose', (t) => {
  if (!entry) return t.skip('no private library');
  assert.equal(entry.track, 'technique');
  assert.equal(entry.rhythm, undefined);
  for (const id of ['punch_up', 'guard_drop', 'guard_return']) assert.equal(entry.refPoses[id].image.length, 33);
});
