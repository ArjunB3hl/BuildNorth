// Auto mode (web/js/auto.js) against saved landmark series: does it name the exercise, count the reps and split the
// sets, without inventing sets when nobody exercises?
//   1. each exercise clip alone (and looped 3x, so short clips reach the reps a set needs)
//   2. no-exercise clips (idle, gestures, walking, jogging; dance and sports reported only): no set may start
//   3. recorded live sets (results/live/*.json)
//   4. workouts stitched from clips: alternating exercises with short rests (switches) and long rests (new sets)
// Offline nobody answers "Done with this set?" (set_end_pending), so a set ends after its rest exactly as before the
// question existed; each run also counts the questions: asked, withdrawn by a rep, and rest ends asked about first.
//
//   node tools/auto_eval.mjs --data <POSE_DATA_DIR> [--model full] [--workouts <private-json>] [--report <json>] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { readWorkoutCases } from './workout_cases.mjs';
import { EXERCISES, features } from '../web/js/engine.js';
import { AutoTracker, repsToStart } from '../web/js/auto.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const data = arg('data', process.env.POSE_DATA_DIR);
const model = arg('model', 'full');
const verbose = process.argv.includes('--verbose');
if (!data) { console.error('--data <POSE_DATA_DIR> is required'); process.exit(2); }
const evalSet = JSON.parse(fs.readFileSync(path.join(data, 'eval_set.json'), 'utf8'));
const gt = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(data, 'gt_labels.json'), 'utf8')).map(l => [l.id, l]));
const obj = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));

// Stitched workouts put clips from different videos one after another; real workouts keep one camera and one person.
// So stitched clips are re-framed to a common camera: the person's median hip position and median body scale (as the
// engine measures it) are mapped to the same place and size in a 16:9 frame. World landmarks (angles) are unchanged.
const REF_ASPECT = 16 / 9, REF_SCALE = 0.17, REF_HIP = { x: 0.5 * REF_ASPECT, y: 0.55 };
function reframe(r) {
  const asp = r.width / r.height, hips = [], scales = [];
  const P = (im, i) => ({ x: im[i][0] * asp, y: im[i][1] });
  for (const fr of r.frames) {
    const im = fr.image; if (!im) continue;
    const hp = { x: (P(im, 23).x + P(im, 24).x) / 2, y: (P(im, 23).y + P(im, 24).y) / 2 };
    const ear = { x: (P(im, 7).x + P(im, 8).x) / 2, y: (P(im, 7).y + P(im, 8).y) / 2 };
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    hips.push(hp);
    scales.push(Math.max(0.72 * d(ear, hp), 1.5 * Math.abs(P(im, 11).x - P(im, 12).x), 1.1 * (d(P(im, 25), P(im, 27)) + d(P(im, 26), P(im, 28))) / 2));
  }
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const hx = med(hips.map(h => h.x)), hy = med(hips.map(h => h.y)), k = REF_SCALE / med(scales);
  const frames = r.frames.map(fr => ({ ...fr, image: fr.image && fr.image.map(p => [((p[0] * asp - hx) * k + REF_HIP.x) / REF_ASPECT,
    (p[1] - hy) * k + REF_HIP.y, p[2], p[3]]) }));
  return { ...r, width: 1280, height: 720, frames };
}

const cache = new Map();
function load(id, { from = 0, to = Infinity, frame = false } = {}) {
  const key = JSON.stringify([id, from, to, frame]);
  if (cache.has(key)) return cache.get(key);
  const file = id.endsWith('.json') ? id : path.join(data, 'results', model, `${id}.json`);
  let r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const t0 = r.frames[0].t;
  r = { ...r, frames: r.frames.filter(fr => fr.t - t0 >= from * 1000 && fr.t - t0 <= to * 1000) };
  if (frame) r = reframe(r);
  const aspect = r.width / r.height;
  const frames = r.frames.map(fr => ({ t: fr.t, f: fr.image && fr.world ? features(obj(fr.world), obj(fr.image), aspect) : null }));
  cache.set(key, frames);
  return frames;
}

/** Stitch segments into one timeline: {clip, loops, from, to, join} plays a clip (seconds from..to), {rest: clip, ms} loops a
 * still clip, {gone: ms} nobody. Different segments, and the copies of a looped clip, are separated by SEAM_MS with
 * nobody in view: a person teleporting across the frame is not something a camera ever shows, and the engines restart
 * after a gap, so a looped clip holds exactly loops x its reps (a rep cut off at the clip's ends stays cut off). The
 * still `rest` clip plays forwards and backwards alternately instead. */
const SEAM_MS = 600;
function stitch(segments) {
  const out = [];
  let t0 = 0;
  const put = (frames, maxMs = Infinity, backwards = false) => {
    const seq = backwards ? [...frames].reverse() : frames;
    const base = seq[0].t;
    for (const fr of seq) {
      if (Math.abs(fr.t - base) > maxMs) break;
      out.push({ t: t0 + Math.abs(fr.t - base), f: fr.f });
    }
    t0 = out.at(-1).t + 33;
  };
  const gone = ms => { for (let t = 0; t < ms; t += 33) out.push({ t: t0 + t, f: null }); t0 = out.at(-1).t + 33; };
  const several = segments.length > 1;     // a workout: re-frame every clip to one camera
  segments.forEach((s, k) => {
    if (k > 0 && !s.gone && !s.join && !segments[k - 1].gone) gone(SEAM_MS);   // join: straight on, no gap
    if (s.clip) for (let i = 0; i < (s.loops || 1); i += 1) {
      if (i > 0) gone(SEAM_MS);
      put(load(s.clip, { from: s.from, to: s.to, frame: several }));
    }
    else if (s.rest) {
      const fr = load(s.rest, { frame: several });
      for (let left = s.ms, i = 0; left > 0; left -= fr.at(-1).t - fr[0].t + 33, i += 1) put(fr, left, i % 2 === 1);
    } else if (s.gone) gone(s.gone);
  });
  return out;
}

const questions = { asked: 0, withdrawn: 0, restEnds: 0, restEndsAsked: 0 };
/** The questions in one run: a set is asked about once at a time, a rep of it withdraws the question, and its set_end
 * closes it. Counted into `questions`; returns this run's own. */
function countQuestions(events) {
  const q = { asked: 0, withdrawn: 0, restEnds: 0, restEndsAsked: 0 }, open = new Set();
  for (const e of events) {
    const id = `${e.exercise}#${e.set}`;
    if (e.type === 'set_end_pending') {
      if (open.has(id)) throw new Error(`${id} asked about twice`);
      open.add(id); q.asked += 1;
    } else if (e.type === 'set_end_cancelled') {
      if (!open.delete(id)) throw new Error(`${id}: a question withdrawn that was not asked`);
      q.withdrawn += 1;
    } else if (e.type === 'rep' && !e.backfill && open.has(id)) throw new Error(`${id}: a rep while asked about`);
    else if (e.type === 'set_end') {
      if (e.reason === 'rest') { q.restEnds += 1; if (open.has(id)) q.restEndsAsked += 1; }
      open.delete(id);
    }
  }
  for (const k of Object.keys(q)) questions[k] += q[k];
  return q;
}
const asked = q => `asked ${q.asked}, withdrawn ${q.withdrawn}`;

function run(frames) {
  const auto = new AutoTracker();
  const events = [];
  for (const fr of frames) events.push(...(fr.f ? auto.update(fr.f, fr.t) : auto.lost(fr.t)));
  events.push(...auto.finish(frames.at(-1).t));
  const summary = events.at(-1);
  const reasons = events.filter(e => e.type === 'set_end').map(e => e.reason);
  return { events, sets: summary.sets, text: summary.sets.map(s => `${s.exercise}#${s.set}=${s.reps}`).join(' ') || '-',
    withReasons: summary.sets.map((s, i) => `${s.exercise}#${s.set}=${s.reps}/${reasons[i]}`),
    startCounts: events.filter(e => e.type === 'set_start').map(e => e.count), questions: countQuestions(events) };
}

const report = { clips: [], negatives: [], live: [], workouts: [] };
// a labelled clip trimmed to its counted reps (2 s before the first, 3 s after the last: a rep is reported on the
// way back, a deadlift's lockout about 1.5 s after the labelled bottom), so that its copies in a loop are about as far
// apart as reps in a set (a 7 s clip with one jump, looped, has jumps 7 s apart: no set ever)
function around(id) {
  const times = gt[id]?.rep_times;
  return times?.length ? { clip: id, from: Math.max(0, Math.min(...times) - 2), to: Math.max(...times) + 3 } : { clip: id };
}

// 1. exercise clips ------------------------------------------------------------------------------------------------
console.log('== exercise clips (alone | looped 3x) ==');
let named = 0, wrong = 0, scorable = 0, countErr = 0;
for (const c of evalSet.filter(c => c.exercise)) {
  const truth = gt[c.id]?.rep_count;
  const one = run(load(c.id)), three = run(stitch([{ ...around(c.id), loops: 3 }]));
  const other = [...one.sets, ...three.sets].filter(s => s.exercise !== c.exercise);
  const own = one.sets.filter(s => s.exercise === c.exercise).reduce((n, s) => n + s.reps, 0);
  const own3 = three.sets.filter(s => s.exercise === c.exercise).reduce((n, s) => n + s.reps, 0);
  const canStart = truth != null && 3 * truth >= repsToStart(c.exercise);
  if (canStart) { scorable += 1; if (own3 > 0) named += 1; }
  if (truth != null) countErr += Math.abs(own3 - 3 * truth);     // a clip with no complete rep must count none
  if (other.length) wrong += 1;
  report.clips.push({ id: c.id, exercise: c.exercise, truth, alone: one.text, looped: three.text });
  console.log(`${c.id.padEnd(32)} ${c.exercise.padEnd(16)} truth ${String(truth).padStart(2)} | alone: ${one.text.padEnd(22)} | x3 (truth ${3 * truth}): ${three.text}${other.length ? '   <-- WRONG EXERCISE' : ''}`);
}
console.log(`named ${named}/${scorable} (looped clips with enough reps for a set), clips with a set of the wrong exercise: ${wrong}, looped count abs error ${countErr}`);

// movement clips the engines have no exercise for (arm circles, balance holds, combos...): every set here names an
// exercise that was not done, though some are close relatives (a kneel-and-stand is squat-like); counted, not hidden
console.log('\n== other movement clips (no engine for them): every set is a wrong name ==');
const otherSets = [];
for (const c of evalSet.filter(c => !c.exercise && !c.negative)) {
  const r = run(stitch([{ clip: c.id, loops: 3 }]));
  if (r.sets.length) otherSets.push(`${c.id}: ${r.text}`);
  console.log(`${c.id.padEnd(32)} ${String(gt[c.id]?.exercise ?? '').slice(0, 40).padEnd(40)} x3: ${r.text}`);
}

// 2. negatives -----------------------------------------------------------------------------------------------------
console.log('\n== no-exercise clips (alone and looped 3x): sets started ==');
const LEG = Object.keys(EXERCISES).filter(k => (EXERCISES[k].needs || []).includes('legs'));
// Every set is a phantom on idle, gesture, walking and jogging clips, and on any cropped copy of them; a copy of an
// exercise clip cropped to 60% (legs gone) may hold no set at all, one cropped to 85% only its own exercise.
// Dance and sports are reported, not scored.
const byId = Object.fromEntries(evalSet.map(c => [c.id, c]));
let phantomSets = 0, unscored = 0;
for (const c of evalSet.filter(c => c.negative)) {
  const src = c.negative === 'cropped' ? byId[c.source_id] : null;
  const kind = src ? `crop${c.keep}:${src.negative || src.exercise || 'other'}` : c.negative;
  const base = src ? src.negative : c.negative;
  const scored = ['idle', 'gesture', 'walk', 'run'].includes(base) || (src && src.exercise);
  const allowed = src && src.exercise && c.keep >= 85 ? [src.exercise] : [];
  const r = run(stitch([{ clip: c.id, loops: 3 }]));
  const bad = scored ? r.sets.filter(s => !allowed.includes(s.exercise)) : [];
  if (!scored) unscored += r.sets.length;
  phantomSets += bad.length;
  report.negatives.push({ id: c.id, kind, sets: r.text, phantom: bad.length });
  console.log(`${c.id.padEnd(40)} ${kind.padEnd(22)} ${r.text}${bad.length ? '   <-- PHANTOM' : scored ? '' : '   (not scored)'}`);
}
console.log(`phantom sets: ${phantomSets} (sets on dance/sports, not scored: ${unscored})`);

// 3. live recordings -----------------------------------------------------------------------------------------------
console.log('\n== live recordings ==');
const liveDir = path.join(data, 'results', 'live');
for (const f of fs.existsSync(liveDir) ? fs.readdirSync(liveDir).filter(f => f.endsWith('.json')) : []) {
  const r = run(load(path.join(liveDir, f)));
  report.live.push({ id: f, sets: r.text, questions: r.questions });
  console.log(`${f.padEnd(40)} ${r.text.padEnd(50)} (${asked(r.questions)})`);
}

// 4. stitched workouts ---------------------------------------------------------------------------------------------
console.log('\n== stitched workouts ==');
// Clip identities, recording intervals and expectations belong to private runtime data.
const casesPath = arg('workouts', path.join(data, 'workouts.json'));
const WORKOUTS = readWorkoutCases(casesPath, data, around);
if (!WORKOUTS.length) console.log('SKIP stitched workouts: no private cases configured');
let workoutsOk = 0;
for (const w of WORKOUTS) {
  const r = run(stitch(w.segs));
  const got = r.withReasons;
  const ok = JSON.stringify(got) === JSON.stringify(w.expect) && (!w.startCounts || JSON.stringify(r.startCounts) === JSON.stringify(w.startCounts));
  if (ok) workoutsOk += 1;
  report.workouts.push({ name: w.name, expect: w.expect, got, ok, questions: r.questions });
  console.log(`${ok ? 'OK  ' : 'DIFF'} ${w.name}\n       expect ${w.expect.join(' ')}\n       got    ${got.join(' ') || '-'}   (${asked(r.questions)})`);
  if (verbose) for (const e of r.events) if (['set_start', 'set_end', 'rep', 'set_end_pending', 'set_end_cancelled'].includes(e.type))
    console.log(`         ${(e.t / 1000).toFixed(2).padStart(7)} ${e.type.padEnd(9)} ${e.exercise}#${e.set} ${e.count ?? e.reps ?? ''}${e.reason ? ' ' + e.reason : ''}${e.backfill ? ' (backfill)' : ''}`);
}

const summary = { model, named: `${named}/${scorable}`, wrongExerciseClips: wrong, loopedCountAbsError: countErr, phantomSets,
  setsOnOtherMovements: otherSets,
  workouts: `${workoutsOk}/${WORKOUTS.length}`,
  questions: { asked: questions.asked, withdrawn: questions.withdrawn, restEndsAskedFirst: `${questions.restEndsAsked}/${questions.restEnds}` } };
console.log('\n' + JSON.stringify(summary));
fs.writeFileSync(arg('report', path.join(data, `auto_report_${model}.json`)), JSON.stringify({ summary, ...report }, null, 1));
