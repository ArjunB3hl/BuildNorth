// Build the 3D demo clips the page shows when it corrects a fault: one Y Bot render per exercise, with the label bar
// cropped off, as WebM, plus demos.json with the clean rep to loop and the footage credit.
//
//   node tools/build_demos.mjs --spec <demos_spec.json> --out <POSE_DEMOS_DIR>
//
// The spec (kept outside the repo: it points at private renders and footage) lists, per exercise:
//   { "exercise", "render": <Y Bot render .mp4>, "landmarks": <pose results of the source footage, same timeline>,
//     "renderLandmarks": <pose results of the render itself, optional: crops the clip to the figure>,
//     "barPx": 33, "credit": { "title", "creator", "license", "url", "short" }, "note", "avoidFor": [fault codes],
//     "model": <the render's character and clip as a GLB, optional: the 3D form check plays it (view3d.js)> }
// The rep to loop is picked on the SOURCE footage's landmarks (the 3D clip plays on the same timeline): the engine
// counts the reps there, and the first one without a form fault is used (MediaPipe reads the 3D mannequin less
// reliably: deep squats look ~15 deg more leaned, low planks lose the elbows). A demo is never shown to correct a fault
// its own motion has: `avoidFor` = the faults the engine found on the source's reps, plus the spec's own (faults seen in
// the 3D skeleton, e.g. a push-up that never locks out).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EXERCISES, ExerciseEngine, features } from '../web/js/engine.js';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const spec = JSON.parse(fs.readFileSync(arg('spec'), 'utf8'));
const out = arg('out');
fs.mkdirSync(out, { recursive: true });
const obj = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));

function reps(results, exercise) {
  const eng = new ExerciseEngine(exercise), found = [];
  for (const fr of results.frames) {
    if (!fr.image || !fr.world) { eng.lost(fr.t); continue; }
    for (const e of eng.update(features(obj(fr.world), obj(fr.image), results.width / results.height), fr.t)) {
      if (e.type === 'rep' && e.counted !== false) found.push({ t: e.t / 1000, faults: e.faults.map(f => f.code) });
    }
  }
  return found;
}

const catalog = {};
for (const d of spec) {
  if (!EXERCISES[d.exercise]) throw new Error(`unknown exercise ${d.exercise}`);
  const results = JSON.parse(fs.readFileSync(d.landmarks, 'utf8'));
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', d.render]).toString());
  const all = reps(results, d.exercise);
  const i = Math.max(0, all.findIndex(r => !r.faults.length));
  const r = all[i];
  // the rep from halfway after the previous one to halfway before the next, within the clip; the first or last rep half
  // its gap to the next or previous one on its open side (2 s with none: a fixed 2 s took in a whole extra cycle of
  // 1-second reps, jumping jacks and pulses, which the 3D form check then stretched onto one rep)
  const half = i > 0 ? (r.t - all[i - 1].t) / 2 : i < all.length - 1 ? (all[i + 1].t - r?.t) / 2 : 2;
  const start = r ? Math.max(0, i > 0 ? (all[i - 1].t + r.t) / 2 : r.t - half) : 0;
  const end = r ? Math.min(duration, i < all.length - 1 ? (r.t + all[i + 1].t) / 2 : r.t + half) : duration;
  const file = `${d.exercise}.webm`;
  // crop to the figure (all its landmarks over the clip, plus a margin), below the render's label bar, so a small
  // figure in a wide shot still fills the demo panel
  const bar = d.barPx ?? 33;
  let crop = `crop=iw:ih-${bar}:0:${bar}`;
  if (d.renderLandmarks) {
    const rl = JSON.parse(fs.readFileSync(d.renderLandmarks, 'utf8'));
    const pts = rl.frames.filter(f => f.image).flatMap(f => f.image.filter(q => (q[3] ?? 1) > 0.3));
    const W = rl.width, H = rl.height;
    let x0 = Math.min(...pts.map(q => q[0])) * W, x1 = Math.max(...pts.map(q => q[0])) * W;
    let y0 = Math.min(...pts.map(q => q[1])) * H, y1 = Math.max(...pts.map(q => q[1])) * H;
    const m = 0.15 * Math.max(x1 - x0, y1 - y0);
    x0 = Math.max(0, x0 - m); x1 = Math.min(W, x1 + m); y0 = Math.max(bar, y0 - m); y1 = Math.min(H, y1 + m);
    const even = v => 2 * Math.floor(v / 2);
    crop = `crop=${even(x1 - x0)}:${even(y1 - y0)}:${even(x0)}:${even(y0)}`;
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', d.render, '-vf', crop,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-an', path.join(out, file)]);
  // the character and its clip (same timeline as the render) for the 3D form check
  const model = d.model ? `${d.exercise}.glb` : null;
  if (model) fs.copyFileSync(d.model, path.join(out, model));
  catalog[d.exercise] = {
    label: EXERCISES[d.exercise].label, file, ...(model ? { model } : {}), duration: +duration.toFixed(2),
    segment: { start: +start.toFixed(2), end: +end.toFixed(2), turn: r ? +r.t.toFixed(2) : null },
    repsInSource: all.length, cleanRep: r ? !r.faults.length : null, credit: d.credit, note: d.note || null,
    avoidFor: [...new Set([...all.flatMap(x => x.faults), ...(d.avoidFor || [])])],
  };
  console.log(`${d.exercise.padEnd(16)} ${file}  rep ${r ? r.t.toFixed(1) : '-'} s (${all.length} reps in the source${r && r.faults.length ? ', all with faults: ' + r.faults.join(',') : ''}), loop ${start.toFixed(1)}-${end.toFixed(1)} s`);
}
fs.writeFileSync(path.join(out, 'demos.json'), JSON.stringify(catalog, null, 1));
console.log(`${Object.keys(catalog).length} demos -> ${out}`);
