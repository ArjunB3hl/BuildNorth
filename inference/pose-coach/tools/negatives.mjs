// Phantom reps: run every exercise engine over clips in which nobody does that exercise (standing idle, gestures,
// walking, jogging; dance and sports are reported but not scored) and count the reps it reports.
//
//   node tools/negatives.mjs --data <POSE_DATA_DIR> [--model full]
import fs from 'node:fs';
import path from 'node:path';
import { EXERCISES, ExerciseEngine, features } from '../web/js/engine.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const data = arg('data', process.env.POSE_DATA_DIR);
const model = arg('model', 'full');
const evalSet = JSON.parse(fs.readFileSync(path.join(data, 'eval_set.json'), 'utf8'));
const obj = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));

// exercises a clip of this kind must never count (jogging does lift the knees, so knee_raise is not scored there)
const LEG_EXERCISES = Object.keys(EXERCISES).filter(k => (EXERCISES[k].needs || []).includes('legs'));
const STRICT = {
  idle: Object.keys(EXERCISES), gesture: Object.keys(EXERCISES),
  // a camera that only sees down to the knees ("crop60-*"): nothing that needs the legs may count
  cropped60: LEG_EXERCISES,
  walk: Object.keys(EXERCISES).filter(k => k !== 'knee_raise'),
  run: Object.keys(EXERCISES).filter(k => !['knee_raise', 'biceps_curl', 'jump'].includes(k)),
};

const rows = [];
let phantom = 0, scored = 0;
for (const c of evalSet.filter(c => c.negative)) {
  const f = path.join(data, 'results', model, `${c.id}.json`);
  if (!fs.existsSync(f)) { console.log(`${c.id}: no landmark results`); continue; }
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const counts = {};
  for (const ex of Object.keys(EXERCISES)) {
    const eng = new ExerciseEngine(ex);
    for (const fr of r.frames) {
      if (fr.image && fr.world) eng.update(features(obj(fr.world), obj(fr.image), r.width / r.height), fr.t); else eng.lost(fr.t);
    }
    counts[ex] = eng.count;
  }
  const kind = c.negative === 'cropped' ? `cropped${c.keep}` : c.negative;
  const strict = STRICT[kind] || [];
  const bad = strict.filter(ex => counts[ex] > 0);
  phantom += bad.reduce((s, ex) => s + counts[ex], 0);
  scored += strict.length;
  rows.push({ id: c.id, kind, counts, phantomIn: bad });
  const shown = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}${strict.includes(k) ? '!' : ''}`).join(' ');
  console.log(`${c.id.padEnd(40)} ${kind.padEnd(9)} ${shown || '-'}`);
}
console.log(JSON.stringify({ model, phantomReps: phantom, strictChecks: scored }));
fs.writeFileSync(path.join(data, `negatives_${model}.json`), JSON.stringify({ phantom, rows }, null, 1));
