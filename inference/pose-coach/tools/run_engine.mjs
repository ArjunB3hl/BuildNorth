// Replay saved landmark series (web/eval.html -> POSE_DATA_DIR/results/<model>/<id>.json) through the exercise engine
// and score rep counts against the ground-truth labels.
//
//   node tools/run_engine.mjs --data <POSE_DATA_DIR> [--model full] [--gt <labels.json>] [--out <report.json>]
import fs from 'node:fs';
import path from 'node:path';
import { ExerciseEngine, features } from '../web/js/engine.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const data = arg('data', process.env.POSE_DATA_DIR);
const model = arg('model', 'full');
const gtPath = arg('gt', data && path.join(data, 'gt_labels.json'));
const outPath = arg('out', data && path.join(data, `engine_report_${model}.json`));
if (!data) { console.error('--data <POSE_DATA_DIR> is required'); process.exit(2); }

const evalSet = JSON.parse(fs.readFileSync(path.join(data, 'eval_set.json'), 'utf8'));
const gt = fs.existsSync(gtPath) ? Object.fromEntries(JSON.parse(fs.readFileSync(gtPath, 'utf8')).map(l => [l.id, l])) : {};
const obj = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));

export function runClip(result, exercise) {
  const eng = new ExerciseEngine(exercise);
  const aspect = result.width / result.height;
  const events = [];
  let missing = 0;
  for (const fr of result.frames) {
    if (!fr.image || !fr.world) { missing += 1; eng.lost(fr.t); continue; }
    events.push(...eng.update(features(obj(fr.world), obj(fr.image), aspect), fr.t));
  }
  return { summary: eng.summary(), events, missing };
}

const rows = [];
for (const c of evalSet) {
  if (!c.exercise) continue;
  const f = path.join(data, 'results', model, `${c.id}.json`);
  if (!fs.existsSync(f)) { rows.push({ id: c.id, exercise: c.exercise, error: 'no landmark results' }); continue; }
  const result = JSON.parse(fs.readFileSync(f, 'utf8'));
  const { summary, events, missing } = runClip(result, c.exercise);
  const label = gt[c.id];
  const truth = label ? label.rep_count : null;
  const recount = label?.recount?.rep_count ?? null;
  const reps = events.filter(e => e.type === 'rep');
  rows.push({
    id: c.id, exercise: c.exercise, gt_exercise: label?.exercise, view: summary.view,
    reps: summary.reps, perSide: summary.perSide, truth, recount, truthAgree: label?.counts_agree ?? null,
    error: truth == null ? null : summary.reps - truth,
    repTimes: reps.map(r => +(r.t / 1000).toFixed(2)), truthTimes: label?.rep_times ?? null,
    faultsPerRep: reps.map(r => r.faults.map(x => x.code)),
    cues: events.filter(e => e.type === 'cue').map(e => ({ t: +(e.t / 1000).toFixed(2), code: e.code, message: e.message })),
    other: events.filter(e => !['rep', 'cue'].includes(e.type)).map(e => ({ type: e.type, t: +(e.t / 1000).toFixed(2), ...(e.parts ? { parts: e.parts } : {}), ...(e.code ? { code: e.code } : {}) })),
    framesWithoutPose: missing, detectRate: result.detectRate, msPerFrame: result.msPerFrame,
  });
}

const scored = rows.filter(r => r.error != null);
const summary = {
  model, clips: rows.length, scored: scored.length,
  exact: scored.filter(r => r.error === 0).length,
  within1: scored.filter(r => Math.abs(r.error) <= 1).length,
  meanAbsError: scored.length ? +(scored.reduce((s, r) => s + Math.abs(r.error), 0) / scored.length).toFixed(2) : null,
  repsCounted: scored.reduce((s, r) => s + r.reps, 0), repsTrue: scored.reduce((s, r) => s + r.truth, 0),
};
fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary));
for (const r of rows) {
  if (r.error === undefined || r.reps === undefined) { console.log(`${r.id.padEnd(32)} ${r.exercise.padEnd(16)} ${r.error}`); continue; }
  console.log(`${r.id.padEnd(32)} ${r.exercise.padEnd(16)} view=${r.view.padEnd(6)} reps ${String(r.reps).padStart(2)} truth ${String(r.truth).padStart(2)}`
    + `${r.recount != null && r.recount !== r.truth ? ` (recount ${r.recount})` : ''}  cues: ${r.cues.map(c => c.code).join(', ') || '-'}`);
}
