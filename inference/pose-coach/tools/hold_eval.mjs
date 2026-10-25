// A held pose's form (web/js/holdform.js) over a recording: runs the movement tracker (web/js/moves.js) with the
// frames' landmarks, as the page does, and prints its events with their times (seconds from the recording's start),
// the form each hold was told with, and each hold's form summary; a hold that ended out of the pose (holdform.js
// IN_POSE: e.g. standing up out of the triangle) says since when. An eval tool, like tools/auto_eval.mjs: it reads a
// recording and writes nothing.
//
//   node tools/hold_eval.mjs <recording.json> <movement key> [--from s] [--to s] [--state s] [--settle s]
//
// The movement comes from POSE_MOVES_DIR/library.json (default .data/moves) when it is there, else it is taken as a
// hold of that key (enough for the form: HOLD_FORMS is keyed by it). --from: the time the movement was named (frames
// before it are skipped). --state: also print the form's state and whether the person is in the pose every this many
// seconds while a hold is under way, and when the person leaves or gets back into the pose. --settle: as the page,
// which says a hold's start this many seconds into it (web/js/app.js SHORT_HOLD_MS + HOLD_SURE_MS: 6.5), settle the
// tracker's form then (MovementTracker settle(): the next correction NEXT_MS from there), and print it with the form
// as the page would send it. A form "fine" (the page's formFine): something checked, nothing open, pending, unseen or
// in the wrong view.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../web/js/engine.js';
import { HOLD_FORMS, IN_POSE, InPose, poseMetrics } from '../web/js/holdform.js';
import { MovementTracker } from '../web/js/moves.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const [file, key] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file || !key) {
  console.error('usage: node tools/hold_eval.mjs <recording.json> <movement key> [--from s] [--to s] [--state s] '
    + '[--settle s]');
  process.exit(2);
}
const from = Number(arg('from', 0)), to = Number(arg('to', Infinity)), every = Number(arg('state', 0));
const settleS = Number(arg('settle', 0));

const libFile = path.join(process.env.POSE_MOVES_DIR || path.join(HERE, '..', '.data', 'moves'), 'library.json');
const lib = fs.existsSync(libFile) ? JSON.parse(fs.readFileSync(libFile, 'utf8')).movements : [];
const movement = lib.find(m => m.key === key) ?? { key, display: key, kind: 'hold', track: 'hold' };
if (movement.track !== 'hold') { console.error(`${key} is tracked as ${movement.track}, not a hold`); process.exit(2); }
if (!HOLD_FORMS[key]) console.log(`(${key} has no form check: the holds are timed, form: null)`);

const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
const aspect = rec.width / rec.height, t0 = rec.frames[0].t;
const obj = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
const sec = t => ((t - t0) / 1000).toFixed(1).padStart(6);

const formText = f => {
  if (f === null || f === undefined) return 'form not measured';
  const parts = [];
  const open = x => `${x.label} (${x.measured}; aim: ${x.target})`;
  const fault = x => `${x.label}${x.fixed ? ' (fixed)' : ''}${x.told ? '' : ' (not told)'}`;
  if (f.open) {
    const fine = f.checked?.length && !['open', 'pending', 'unseen', 'wrongView'].some(k => f[k]?.length);
    parts.push(f.open.length ? `open: ${f.open.map(open).join('; ')}` : fine ? 'nothing open (form fine)'
      : 'nothing open');
  }
  if (f.faults) parts.push(f.faults.length ? `faults: ${f.faults.map(fault).join('; ')}` : 'no faults');
  if (f.pending?.length) parts.push(`pending: ${f.pending.join(', ')}`);
  if (f.checked?.length) parts.push(`fine: ${f.checked.join(', ')}`);
  if (f.unseen?.length) parts.push(`unseen: ${f.unseen.join(', ')}`);
  if (f.wrongView?.length) parts.push(`wrong view: ${f.wrongView.join(', ')}`);
  return parts.join(' | ');
};

const tr = new MovementTracker({ movement });
// in the pose at all, on the same frames as the tracker (its own InPose: the tracker's is not exposed)
const ip = IN_POSE[key] ? new InPose({ key }) : null;
let lastState = -Infinity, n = 0, pose = null, settled = null;
const poseText = () => (pose === 'out' ? `out of the pose since ${sec(ip.leftT).trim()} s: ${IN_POSE[key].label}`
  : pose === 'in' ? 'in the pose' : 'pose not decided');
const print = e => {
  const at = e.type === 'hold_start' ? `${sec(e.t)} (told at ${sec(e.at).trim()})` : sec(e.at);
  const what = { hold_start: '', hold_progress: `${e.seconds} s`,
    hold_end: `${e.seconds} s held, to ${sec(e.t).trim()} s${pose === 'out' ? ` (${poseText()})` : ''}`,
    hold_fault: `${e.label}: ${e.measured} (aim: ${e.target}) -> "${e.cue}"`,
    hold_fix: `fixed: ${e.label}` }[e.type] ?? '';
  const form = 'form' in e ? `  [${formText(e.form)}]` : '';
  console.log(`${at}  ${e.type.padEnd(13)} ${what}${form}`);
};
for (const fr of rec.frames) {
  const s = (fr.t - t0) / 1000;
  if (s < from || s > to) continue;
  const lm = fr.image && fr.world ? { world: obj(fr.world), image: obj(fr.image), aspect } : null;
  const f = lm ? features(lm.world, lm.image, aspect) : null;
  if (f && ip) {
    const was = pose;
    pose = ip.update(poseMetrics(lm.world, lm.image, aspect), fr.t) ?? pose;
    if (every > 0 && was !== null && pose !== was) console.log(`${sec(fr.t)}    (${poseText()})`);
  }
  const evs = f ? tr.update(f, fr.t, lm) : tr.lost(fr.t);
  for (const e of evs) { print({ ...e, at: fr.t }); n += 1; }
  const cur = tr.current(fr.t);
  // the page says the start settleS into the hold (a hold ended before: never), and settles the form then
  if (settleS > 0 && tr.holding && tr.told && settled !== tr.holdStart && fr.t - tr.holdStart >= settleS * 1000) {
    settled = tr.holdStart;
    tr.settle(fr.t);
    console.log(`${sec(fr.t)}  (page's start, settled)  [${formText(cur.form)}]`);
  }
  if (every > 0 && cur.holding && s - lastState >= every) {
    lastState = s;
    console.log(`${sec(fr.t)}    (now: ${formText(cur.form)}${ip ? `; ${poseText()}` : ''})`);
  }
}
for (const e of tr.finish()) { print({ ...e, at: tr.lastT }); n += 1; }
const sum = tr.summary();
console.log(`${n} events; ${sum.holds} holds, ${sum.seconds} s held, longest ${sum.longest} s`);
