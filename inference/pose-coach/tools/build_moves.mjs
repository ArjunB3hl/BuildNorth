// Build the movement library the page names movements from (web/js/moves.js): POSE_MOVES_DIR/library.json, and each
// movement's 3D animation (the Y Bot GLB) copied to POSE_MOVES_DIR/glb/<key>.glb. Everything it reads and writes is
// private (licensed footage, the user's animations) and stays in the git-ignored .data/.
//
//   node tools/build_moves.mjs [--moves <dir>] [--library <dir>] [--policy <json>] [--dry-run]
//
// --moves (default POSE_MOVES_DIR, else .data/moves) holds the inputs: catalog.json (the library's Ready motions: id,
// display, kind, engine, coach, durationSec), cleared.json (the motion ids the clip policy clears: nothing else is ever
// read or copied), slugs.json (id -> key, for every cleared movement the engine does not count) and, optionally,
// synonyms.json (key -> more spoken names). --library (default: the catalog's `source`) holds the motions:
// <id>/variants/mixamo-y-bot/animation.glb, and <id>/source/skeleton_motion.npz, the reference skeleton a repeated
// movement's rhythm and a held pose's held part are derived from (<moves>/skel/<id>.json, a dump of it, if the npz
// cannot be read). --policy (default POSE_CLIP_POLICY, else .data/moves/clip-policy.json): a
// cleared id the policy excludes, leaves for confirmation or has not reviewed stops the build before anything is
// written.
//
// library.json: {built, movements: [{key, id, display, kind, track, engine?, coach, glb, durationSec, synonyms,
// rhythm?, held?, pose?, refPoses?}]}, one per cleared motion of the kinds offered: a cleared motion of a kind LEFT_OUT
// (below) is not built (its key in slugs.json and its names in synonyms.json go unused), and the line the build prints
// counts those by kind. key: the slug, or for the exercises the engine counts a readable key from the display name
// (engine: its EXERCISES key). track: TRACK_OF_KIND (web/js/moves.js). rhythm (track 'rhythm' only): {signal,
// minPeriodS, prominence, fallback?: {signal, minPeriodS, prominence}}, from the reference skeleton (rhythmOf below; a
// fallback, for a signal that has one, is counted while that signal's parts are out of view). held and pose (track
// 'hold' only), from the reference skeleton (heldOf below): held {start, end}, the held part in seconds of the GLB's
// animation (it runs at the skeleton's frames); pose {image: [[x, y], ...] the 33 landmarks at the middle of the held
// part, as skeletonLandmarks gives them, side: the pose's working side ('left' | 'right', null for a pose without
// one)}: the page draws it as the right form next to the user's. refPoses (tracks 'moving' and 'rhythm', a movement
// with guard rails: moveform.js MOVE_FORMS), from the reference skeleton (refPosesOf below): {[check id]: {image: [[x,
// y], ...] the 33 landmarks of the frame that best shows the check done right where it judges, as skeletonLandmarks
// gives them; side: the reference's side of the check's part there ('left' | 'right', null: both or none); t: that
// frame's time, seconds into the GLB's animation}}, the "Like this" next to the user's frames when the check finds a
// mistake; a check with no such frame has none, and the build says why. Idempotent: an unchanged library is not
// rewritten, and a GLB whose copy is identical is not copied again; GLBs of keys no longer built are removed.
// A file the library cannot read in time (cloud-synced assets may be evicted and stall) is skipped and reported, and
// the build then exits 1.
import { techniquePoses } from '../web/js/technique.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { EXERCISES, Smoother, features } from '../web/js/engine.js';
import { HOLD_FORMS, IN_POSE, poseMetrics } from '../web/js/holdform.js';
import { MOVE_FORMS, MOVE_TUNING, MoveForm, bodyMetrics } from '../web/js/moveform.js';
import { CycleCounter, FALLBACKS, MovementTracker, SIGNALS, TRACK_OF_KIND, TUNING } from '../web/js/moves.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READ_TIMEOUT_MS = 60000;      // an evicted file being fetched back from iCloud: give up on it after this

// --- reading the reference skeleton (numpy .npz: a zip of .npy arrays) ------------------------------------------------

/** The arrays of a .npz file (stored or deflated entries; `want`: only these): {name: {shape, data}}; `data` is a
 * Float32Array, Float64Array or an array of strings (dtypes <f4, <f8, <U: what the skeleton's arrays use). */
export function readNpz(buf, want = null) {
  const out = {};
  // the central directory: from the end-of-central-directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const key = name.replace(/\.npy$/, '');
    if (want && !want.includes(key)) continue;
    const raw = buf.subarray(start, start + csize);
    const body = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!body) throw new Error(`${name}: unsupported zip method ${method}`);
    out[key] = readNpy(Buffer.from(body));
  }
  return out;
}

export function readNpy(b) {
  if (b.toString('latin1', 1, 6) !== 'NUMPY') throw new Error('not a .npy array');
  const major = b[6];
  const hlen = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8);
  const off = major === 1 ? 10 : 12;
  const header = b.toString('latin1', off, off + hlen);
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
  if (/'fortran_order':\s*True/.test(header)) throw new Error('fortran-order arrays are not supported');
  const data = b.subarray(off + hlen);
  const count = shape.reduce((a, x) => a * x, 1);
  if (descr === '<f4' || descr === '<f8') {
    const size = descr === '<f4' ? 4 : 8, arr = descr === '<f4' ? new Float32Array(count) : new Float64Array(count);
    for (let i = 0; i < count; i++) arr[i] = size === 4 ? data.readFloatLE(i * 4) : data.readDoubleLE(i * 8);
    return { shape, data: arr };
  }
  const u = /^<U(\d+)$/.exec(descr ?? '');
  if (u) {
    const w = Number(u[1]), strs = [];
    for (let i = 0; i < count; i++) {
      let s = '';
      for (let j = 0; j < w; j++) { const c = data.readUInt32LE((i * w + j) * 4); if (!c) break; s += String.fromCodePoint(c); }
      strs.push(s);
    }
    return { shape, data: strs };
  }
  throw new Error(`unsupported dtype ${descr}`);
}

/** {fps, joints: {name: [[x, y, z], ...]}} (Y-up metres) from a skeleton_motion.npz buffer. */
export function skeletonFromNpz(buf) {
  const a = readNpz(buf, ['joints_3d', 'joint_names', 'fps']);
  if (!a.joints_3d || !a.joint_names || !a.fps) throw new Error('joints_3d, joint_names or fps missing');
  const [n, J] = a.joints_3d.shape, names = a.joint_names.data, d = a.joints_3d.data;
  const joints = {};
  names.forEach((name, j) => { joints[name] = Array.from({ length: n }, (_, i) => [d[(i * J + j) * 3], d[(i * J + j) * 3 + 1], d[(i * J + j) * 3 + 2]]); });
  return { fps: a.fps.data[0], joints };
}

// --- the reference skeleton as the page sees a person: MediaPipe-style landmarks, then engine features ----------------

const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  add: (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]] };
const median = v => { const s = [...v].sort((x, y) => x - y); return s[s.length >> 1]; };

/** Every frame of a skeleton ({fps, joints} with SMPL joint names) as MediaPipe would give it, seen by a camera in
 * front of the person (facing it over the first second), orthographic, 16:9: image landmarks (normalised, visibility
 * 1; the clip's median hips at the middle, S metres from the top of the picture to the bottom) and world landmarks
 * (metres around the hips, y down). Returns [{t (ms), world, image}]. */
export function skeletonLandmarks(skel, aspect = 16 / 9) {
  const J = skel.joints, n = J.pelvis.length;
  for (const k of ['pelvis', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_foot', 'right_foot',
    'head', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist']) {
    if (!J[k] || J[k].length !== n) throw new Error(`skeleton joint ${k} missing`);
  }
  // facing: left = the shoulder line, forward = left x up (Y-up, right-handed)
  const first = Math.max(1, Math.min(n, Math.round(skel.fps)));
  let lx = 0, lz = 0;
  for (let i = 0; i < first; i++) { const d = v3.sub(J.left_shoulder[i], J.right_shoulder[i]); lx += d[0]; lz += d[2]; }
  const ln = Math.hypot(lx, lz) || 1;
  const L = [lx / ln, 0, lz / ln], F = [-L[2], 0, L[0]];      // L x (0, 1, 0)
  const cx = median(J.pelvis.map(p => v3.dot(p, L))), cy = median(J.pelvis.map(p => p[1]));
  const S = 2.4;                                              // metres from the top of the picture to the bottom
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = name => J[name][i];
    const head = P('head');
    const pts = {
      0: v3.add(head, F, 0.1), 7: v3.add(head, L, 0.075), 8: v3.add(head, L, -0.075),
      11: P('left_shoulder'), 12: P('right_shoulder'), 13: P('left_elbow'), 14: P('right_elbow'), 15: P('left_wrist'), 16: P('right_wrist'),
      23: P('left_hip'), 24: P('right_hip'), 25: P('left_knee'), 26: P('right_knee'), 27: P('left_ankle'), 28: P('right_ankle'),
      29: v3.add(P('left_ankle'), F, -0.05), 30: v3.add(P('right_ankle'), F, -0.05), 31: P('left_foot'), 32: P('right_foot'),
    };
    for (const k of [1, 2, 3, 4, 5, 6, 9, 10]) pts[k] = head;
    for (const k of [17, 19, 21]) pts[k] = P('left_wrist');
    for (const k of [18, 20, 22]) pts[k] = P('right_wrist');
    const hip = v3.add(P('left_hip'), v3.sub(P('right_hip'), P('left_hip')), 0.5);
    const image = [], world = [];
    for (let k = 0; k < 33; k++) {
      const p = pts[k];
      image.push({ x: 0.5 + (v3.dot(p, L) - cx) / (S * aspect), y: 0.5 - (p[1] - cy) / S, z: 0, visibility: 1 });
      const d = v3.sub(p, hip);
      world.push({ x: v3.dot(d, L), y: -d[1], z: -v3.dot(d, F) });
    }
    out.push({ t: (i * 1000) / skel.fps, world, image });
  }
  return out;
}

/** The one-two reference seen from the side, where projected punch direction can be judged. */
export function techniqueFrames(skel, aspect = 16 / 9) {
  return skeletonLandmarks(skel, aspect).map(f => ({ ...f, aspect,
    world: f.world.map(p => ({ ...p, x: p.z, z: -p.x })),
    image: f.image.map((p, i) => ({ ...p, x: .5 + f.world[i].z / (2.4 * aspect) })) }));
}

/** Engine features of every frame of a skeleton, seen as skeletonLandmarks sees it (smoothed as engine.js does),
 * with its landmarks (a rhythm's fallback is counted from them). Returns [{t (ms), f, lm: {world, image, aspect}}]. */
export function skeletonFeatures(skel, aspect = 16 / 9) {
  const sm = new Smoother();
  return skeletonLandmarks(skel, aspect).map(({ t, world, image }) => ({ t,
    f: sm.update(features(world, image, aspect)), lm: { world, image, aspect } }));
}

// --- the rhythm of a repeated movement --------------------------------------------------------------------------------

const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** How regular a series is: {regular: its autocorrelation at the period (0..1), lagMs: the period}, the period being
 * the shortest lag from 0.4 s to half the series whose autocorrelation is within 90% of the highest (a multiple of the
 * period correlates as well). */
function periodicity(v, fps) {
  const m = v.reduce((a, x) => a + x, 0) / v.length, d = v.map(x => x - m);
  const e = d.reduce((a, x) => a + x * x, 0);
  if (!(e > 0)) return { regular: 0, lagMs: null };
  const ac = [];
  for (let lag = Math.round(0.4 * fps); lag <= v.length / 2; lag++) {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    ac.push({ lag, r: (s / e) * (d.length / (d.length - lag)) });
  }
  // (a real peak: a series that only decays, slow and not repeating, has none)
  const peaks = ac.filter((x, i) => i > 0 && i < ac.length - 1 && x.r > ac[i - 1].r && x.r >= ac[i + 1].r);
  const top = Math.max(0, ...peaks.map(x => x.r));
  if (!(top > 0)) return { regular: 0, lagMs: null };
  const at = peaks.find(x => x.r >= 0.9 * top);
  return { regular: Math.max(0, Math.min(1, at.r)), lagMs: (at.lag * 1000) / fps };
}

/** The time the series takes to swing across the middle 80% of its range the first time (half a cycle), in ms
 * (`get(frame)` measures each frame of {t, f, lm}). */
function swingMs(frames, get, lo, hi) {
  let from = null;
  for (const r of frames) {
    const x = get(r);
    if (!Number.isFinite(x)) continue;
    if (from === null) { if (x <= lo) from = { side: 'lo', t: r.t }; else if (x >= hi) from = { side: 'hi', t: r.t }; continue; }
    if (from.side === 'lo' && x <= lo) from.t = r.t;
    else if (from.side === 'hi' && x >= hi) from.t = r.t;
    else if ((from.side === 'lo' && x >= hi) || (from.side === 'hi' && x <= lo)) return r.t - from.t;
  }
  return null;
}

/** Each candidate signal on the reference: its range (5th to 95th percentile) and that range in jitter units, how
 * regular it is and at what period, and the cycles a counter at the prominence below finds, with their median period. */
export function rhythmCandidates(frames, fps) {
  const rows = [];
  for (const [name, sig] of Object.entries(SIGNALS)) {
    const row = candidate(name, r => sig.get(r.f), sig.unit, frames, fps);
    if (row) rows.push(row);
  }
  return rows;
}
/** One signal (`get(frame)` on the reference's frames {t, f, lm}) as a candidate, as rhythmCandidates' rows; null when
 * it is not measured on most of the frames. */
function candidate(name, get, unit, frames, fps) {
  const v = frames.map(get).filter(Number.isFinite);
  if (v.length < frames.length * 0.9) return null;
  const lo = pct(v, 0.05), hi = pct(v, 0.95), range = hi - lo;
  const prominence = Math.max(PROM_SHARE * range, PROM_UNITS * unit);
  const cc = new CycleCounter({ prominence });
  const at = [];
  frames.forEach(r => { if (cc.update(get(r), r.t)) at.push(r.t); });
  const periods = at.slice(1).map((t, i) => t - at[i]);
  const { regular, lagMs } = periodicity(v, fps);
  return { signal: name, range, snr: range / unit, regular, lagMs, prominence, cycles: at.length,
    periodMs: periods.length ? median(periods) : null,
    swingMs: swingMs(frames, get, lo + 0.1 * range, hi - 0.1 * range) };
}

const PROM_SHARE = 0.4;     // a cycle swings at least this share of the reference's range (people move less than it)
const PROM_UNITS = 3;       // ...and never less than this many jitter units
/** The rhythm of a repeated movement from its reference skeleton's frames: the signal that moves most against its
 * jitter (at least 2 x PROM_UNITS), weighted by how regular it is, and halved when its counter splits the movement's
 * period into parts (a combo's squat and knee drive in one round: two counts of the signal per period of the whole),
 * when it does not cycle on the reference, and when it is a width across the picture (seen from the front only);
 * its prominence (PROM_SHARE of its range, at least PROM_UNITS jitter units) and the shortest period a cycle may take:
 * half the reference's period (a reference showing less than two cycles: its swing across the range), 0.4 to 1.5 s.
 * `info.cycles`: the cycles the reference itself shows. Under two, the shortest period is a guess from one swing and
 * the rhythm was never seen counting a run of full reps: the build says so, and the count wants checking on a
 * repeated performance (one way: the reference played out to its far end and back, a few times, at its own speed and
 * faster, which must count once a round). */
export function rhythmOf(frames, fps, info = {}) {
  const rows = rhythmCandidates(frames, fps).filter(r => r.snr >= 2 * PROM_UNITS);
  if (!rows.length) return null;
  const split = r => r.cycles >= 2 && r.lagMs && r.periodMs && r.periodMs < 0.75 * r.lagMs;
  const score = r => r.snr * (0.25 + r.regular) * (split(r) ? 0.5 : 1) * (r.cycles >= 1 ? 1 : 0.5) * (SIGNALS[r.signal].view ? 0.5 : 1);
  const best = rows.reduce((a, b) => (score(b) > score(a) ? b : a));
  info.cycles = best.cycles;
  const round = x => +x.toPrecision(2);
  const shortest = r => {
    const period = r.cycles >= 2 ? r.periodMs : r.swingMs ? 2 * r.swingMs : 2000;
    return round(Math.min(1.5, Math.max(0.4, period / 2000)));
  };
  const rhythm = { signal: best.signal, minPeriodS: shortest(best), prominence: round(best.prominence) };
  // its fallback (moves.js FALLBACKS: counted while the signal's parts are out of view), by the same rule, from the
  // same frames' landmarks: its prominence and shortest period; none if it does not swing clearly on the reference
  const name = SIGNALS[best.signal].fallback, fb = name && FALLBACKS[name];
  if (fb && frames.every(r => r.lm)) {
    const row = candidate(name, r => fb.get(r.f, r.lm), fb.unit, frames, fps);
    if (row && row.snr >= 2 * PROM_UNITS) {
      rhythm.fallback = { signal: name, minPeriodS: shortest(row), prominence: round(row.prominence) };
    }
  }
  return rhythm;
}

// --- the held part of a held pose -------------------------------------------------------------------------------------

/** How still the body is on each frame ([{t, world, image}]): the page's own measure (moves.js MovementTracker score(),
 * in jitter units, still at most TUNING.STILL), each frame scored on the window centred on it (the tracker's score
 * trails its frame by WINDOW_MS); Infinity where it cannot tell. */
export function stillnessOf(frames, aspect = 16 / 9) {
  const n = frames.length;
  // (a key with no form check of its own: the tracker measures stillness alone)
  const tr = new MovementTracker({ movement: { key: 'reference', display: '', kind: 'hold', track: 'hold' } });
  const trailing = frames.map(fr => {
    tr.update(features(fr.world, fr.image, aspect), fr.t);
    return tr.score()?.score ?? null;
  });
  return frames.map(fr => {
    const j = frames.findIndex(x => x.t >= fr.t + TUNING.WINDOW_MS / 2);
    return trailing[j < 0 ? n - 1 : j] ?? Infinity;
  });
}

/** The working side of each held pose, from holdform.js poseMetrics ('L' | 'R'): the triangle's front leg (the one
 * the trunk leans over), the quad stretch's bent leg and the figure-four's crossed one (the leg with the higher
 * ankle). The page turns the reference to the user's side by it. A pose not here has none (side null). */
export const WORKING_SIDE = {
  triangle_pose: m => m.front, quad_stretch: m => m.lift, figure_four_balance: m => m.lift,
};
const HELD_MIN_MS = 1000;   // the held part lasts at least this

/** Whether one frame (poseMetrics) shows the pose `key` right: clearly in it (its IN_POSE test's `back` line, inside
 * the line it is left at) and every form check of HOLD_FORMS that applies on the fine side of its line (`ok`, a little
 * inside the fault's), so the reference shown as the right form is clear of every line. A test or check the frame
 * cannot judge (its parts out of view, a view that cannot see it) neither passes nor fails it, as on the page. A pose
 * without either: any frame. */
export function poseRight(key, m) {
  if (!m) return false;
  const judged = x => (x.needs ?? []).every(p => m.seen[p]) && (!x.views || x.views.includes(m.view));
  const ip = IN_POSE[key];
  if (ip && judged(ip) && !ip.back(m)) return false;
  for (const c of HOLD_FORMS[key] ?? []) {
    if (!judged(c) || (c.when && !c.when(m))) continue;
    const v = c.value(m);
    if (Number.isFinite(v) && !(c.ok ?? (x => !c.bad(x)))(v)) return false;
  }
  return true;
}

/** The held part of a held pose's reference skeleton (`key`: its HOLD_FORMS and IN_POSE key, if it has them): the
 * stillest second in which every frame shows the pose right (poseRight), grown on either side while the frames stay
 * right and still. Still: the page's own measure (moves.js MovementTracker score(), in jitter units, still at most
 * TUNING.STILL) on the frames seen as skeletonLandmarks sees them, each frame scored on the window centred on it (the
 * tracker's score trails its frame by WINDOW_MS). On the library's three references the stillest second scores
 * 0.4-0.5 and the held part grows to 2-3.5 s: the GLB's held segment loops a few seconds of the pose, not one.
 * Returns {held: {start, end} (seconds into the clip: its first and last frame's time, to the millisecond), pose:
 * {image: [[x, y], ...] (the 33 image landmarks of the frame nearest the middle of the held part, to 4 decimals),
 * side: WORKING_SIDE on that frame, 'left' | 'right' (null for a pose without one)}}, or null when no second of it is
 * right. `info.score`: the stillest second's mean score (above TUNING.STILL: the reference is never still by the
 * page's measure, and its held part is that second alone). */
export function heldOf(skel, key, info = {}, aspect = 16 / 9) {
  const frames = skeletonLandmarks(skel, aspect), n = frames.length;
  const metrics = frames.map(fr => poseMetrics(fr.world, fr.image, aspect));
  const right = metrics.map(m => poseRight(key, m));
  const still = stillnessOf(frames, aspect);
  // the stillest second (the first of equals) of frames all right
  let best = null;
  for (let a = 0; a < n; a++) {
    let b = a;
    while (b < n && frames[b].t - frames[a].t < HELD_MIN_MS - 1e-6) b++;
    if (b >= n) break;
    if (right.slice(a, b + 1).some(r => !r)) continue;
    const mean = still.slice(a, b + 1).reduce((s, x) => s + x, 0) / (b - a + 1);
    if (Number.isFinite(mean) && (!best || mean < best.mean)) best = { a, b, mean };
  }
  if (!best) return null;
  info.score = best.mean;
  let { a, b } = best;
  const holds = i => right[i] && still[i] <= TUNING.STILL;
  while (a > 0 && holds(a - 1)) a--;
  while (b < n - 1 && holds(b + 1)) b++;
  const midT = (frames[a].t + frames[b].t) / 2;
  const mid = frames.reduce((k, fr, i) => (Math.abs(fr.t - midT) < Math.abs(frames[k].t - midT) ? i : k), a);
  const s = WORKING_SIDE[key]?.(metrics[mid]);
  // (to the millisecond outward: a second's part stays a second)
  const r4 = v => +v.toFixed(4), down = ms => Math.floor(ms + 1e-6) / 1000, up = ms => Math.ceil(ms - 1e-6) / 1000;
  return {
    held: { start: down(frames[a].t), end: up(frames[b].t) },
    pose: { image: frames[mid].image.map(p => [r4(p.x), r4(p.y)]),
      side: s === 'L' ? 'left' : s === 'R' ? 'right' : null },
  };
}

// --- the reference poses of a moving or rhythm movement's guard rails ------------------------------------------------

/** Every frame of a reference skeleton as a guard rail sees it: [{i, t (ms), lm: {world, image, aspect}, m}], `m`
 * moveform.js bodyMetrics with the floor MoveForm finds from the frames before (feetLift, airborne; standing still
 * and a jump are judged by it). On its own the clip's first second has too few frames before it for a floor (MoveForm
 * wants FLOOR_MS / 4 of them), so the floor is found over the clip played back to its start, then forward: each
 * frame's from the frames around it, as the movement done again gives it. */
export function referenceFrames(skel, aspect = 16 / 9) {
  const frames = skeletonLandmarks(skel, aspect), n = frames.length, dt = 1000 / skel.fps;
  // (a MoveForm of no checks: its floor alone)
  const floor = new MoveForm({ key: 'reference', forms: { reference: [] } });
  const metrics = frames.map(fr => bodyMetrics(fr.world, fr.image, aspect));
  for (let i = n - 1; i > 0; i--) floor.withFloor(metrics[i], (n - 1 - i) * dt);
  return frames.map((fr, i) => ({ i, t: fr.t, lm: { world: fr.world, image: fr.image, aspect },
    m: floor.withFloor(metrics[i], (n - 1 + i) * dt) }));
}

// A turn at an end of the clip (played back from there) is the movement's far end only when the clip dwells there: its
// rhythm signal over the DWELL_MS at that end spans at most DWELL_SHARE of the rhythm's prominence. The shoulder
// rotation's reference ends holding the hands at their widest (its last half second spans 1% of the prominence) and
// the Y-to-W's starts in the Y (11%), while the Y-to-W's ends half way up again into the next Y (109%; the boxing
// combo's, on the way down into a squat, 161%): played back, the Y-to-W's would be a peak of half a Y, and the arms
// there passed "arms out to the sides" more clearly than in the Y.
const DWELL_MS = 500, DWELL_SHARE = 0.25;

/** The turns of a rhythm movement's signal on its reference frames (referenceFrames), as the page finds them: the
 * frames through a MovementTracker of the movement with their landmarks, the turns its CycleCounter confirms (`turn`;
 * a wobble is never judged). The clip is played back from its end, forward, and back again, so that its two ends turn
 * too, as the guard rails' own measurements play the references out and back; a turn at an end counts only where the
 * clip dwells there (DWELL_MS). Returns [{kind, e (the clip frame of the extreme), play (the clip frame of each frame
 * played), p (the extreme's place in it), t, from, cycleFrom (the played times, ms: CycleCounter's)}]. */
export function referenceTurns(frames, movement, fps) {
  const n = frames.length, dt = 1000 / fps, r = movement.rhythm;
  const play = [];
  for (let i = n - 1; i > 0; i--) play.push(i);
  for (let i = 0; i < n; i++) play.push(i);
  for (let i = n - 2; i >= 0; i--) play.push(i);
  const feats = frames.map(fr => features(fr.lm.world, fr.lm.image, fr.lm.aspect));
  // (the turns alone: no form check of its own, so the tracker follows the rhythm's signal and nothing else)
  const tr = new MovementTracker({ movement, forms: {} });
  const sig = SIGNALS[r.signal];
  const dwells = idx => {
    const v = idx.map(i => sig.get(feats[i]));
    return v.every(Number.isFinite) && Math.max(...v) - Math.min(...v) <= DWELL_SHARE * r.prominence;
  };
  const head = frames.filter(fr => fr.t <= DWELL_MS).map(fr => fr.i);
  const tail = frames.filter(fr => frames[n - 1].t - fr.t <= DWELL_MS).map(fr => fr.i);
  const out = [];
  play.forEach((i, p) => {
    tr.update(feats[i], p * dt, frames[i].lm);
    const turn = tr.cycles.turn;
    if (!turn || turn.wobble) return;
    const pe = Math.round(turn.t / dt), e = play[pe];
    if (frames[e].t < DWELL_MS && !dwells(head)) return;
    if (frames[n - 1].t - frames[e].t < DWELL_MS && !dwells(tail)) return;
    out.push({ kind: turn.kind, e, play, p: pe, t: turn.t, from: turn.from, cycleFrom: turn.cycleFrom ?? turn.from });
  });
  return out;
}

/** How clearly a check's value `v` is on its ok side: its distance to the nearest value the check calls bad (either
 * way; Infinity: none). By search, so a check's lines need not be read out of its code. */
export function okMargin(c, v) {
  let best = Infinity;
  for (const dir of [1, -1]) {
    let hi = 1e-6;
    while (hi < 1e9 && !c.bad(v + dir * hi)) hi *= 2;
    if (hi >= 1e9) continue;
    let lo = hi / 2;
    for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (c.bad(v + dir * mid)) hi = mid; else lo = mid; }
    best = Math.min(best, hi);
  }
  return best;
}

const isCycle = c => c.at === 'peak' || c.at === 'trough';
const r4 = v => +v.toFixed(4);
/** All 33 landmarks inside the picture (to 4 decimals, as stored): the page draws the pose whole. */
const inPicture = image => image.every(p => r4(p.x) > 0 && r4(p.x) < 1 && r4(p.y) > 0 && r4(p.y) < 1);

/** The skeleton mirrored ({fps, joints}): the person's left for their right (the joints' sides swapped, x negated), as
 * the movement done on the other side. */
export const mirrorSkeleton = skel => ({ fps: skel.fps, joints: Object.fromEntries(Object.entries(skel.joints).map(
  ([k, v]) => [k.replace(/^(left|right)_/, (_, s) => (s === 'left' ? 'right_' : 'left_')),
    v.map(p => [-p[0], p[1], p[2]])])) });

/** The reference poses of a moving or rhythm movement's guard rails (`movement`: its library entry, with its `rhythm`
 * for a rhythm one; `forms`: moveform.js MOVE_FORMS): for each check, the frame of the reference skeleton that best
 * shows it done right, at the moment the check judges it. A frame is judged as MoveForm judges it: its parts in view
 * (`needs`), from a view it is judged from (`views`), its `phase` holding, its `value` a number.
 *   peak / trough: at the rhythm's turns of that kind (referenceTurns), the frames the check takes there (`take` 'at':
 *   within PEAK_MS / 2 of the extreme; 'max' / 'min': the half cycle up to it, or with `over` 'cycle' the whole cycle,
 *   and the frame it picks, its value the median of it and its neighbours), on turns the check calls ok; of those the
 *   frame whose own value is most clearly ok (okMargin), the first of equals.
 *   frame: a frame judged after its phase settled (SETTLE_MS), its value and its value smoothed (the median over
 *   SMOOTH_MS, as MoveForm smooths it) both ok; of those the stillest (stillnessOf: the pose shown still reads best),
 *   the more clearly ok of equals.
 * Either way the chosen frame's own value is ok, its phase holds, and the whole body is in the picture. A check of one
 * side of the body (a side()) that finds no frame, as a check of the side the reference does not move (the side
 * crunch's left sweeping knee: the reference sweeps its right leg only), is tried once more on the reference mirrored
 * (mirrorSkeleton), by the same rules: a user doing the movement on that side still sees the right form, the
 * reference's frame turned to that side. Returns {[check id]: {image: [[x, y], ...] (its 33 image landmarks, to 4
 * decimals, as heldOf's pose; of the mirrored frame if `mirrored`), side: the check's side(m, lm) on it ('L' -> 'left',
 * 'R' -> 'right'; no side(), or both: null), t (seconds into the GLB's animation: its frame over fps, to the
 * millisecond; the same frame mirrored or not), mirrored?: true (found on the reference mirrored: the GLB at `t` shows
 * the other side, and its 3D is to be turned for it)}}; a check without such a frame has none. `info.checks`: per
 * check, {id, t, side, value, mirrored?} or {id, why} (why it has none). */
export function refPosesOf(skel, movement, info = {}, { forms = MOVE_FORMS, aspect = 16 / 9 } = {}) {
  const checks = forms[movement.key] ?? [];
  const ref = prepare(skel, movement, checks, aspect);
  let mirror = null;                    // the reference mirrored, once a check needs it
  const out = {};
  info.checks = [];
  for (const c of checks) {
    let on = ref, r = pickOn(c, ref);
    if (r.i === null && typeof c.side === 'function') {
      mirror ??= prepare(mirrorSkeleton(skel), movement, checks, aspect);
      const rm = pickOn(c, mirror);
      if (rm.i !== null) { on = mirror; r = rm; } else r = { ...r, why: `${r.why}; mirrored, ${rm.why}` };
    }
    if (r.i === null) { info.checks.push({ id: c.id, why: r.why }); continue; }
    const { m, lm } = on.frames[r.i];
    c.value(m, lm);                     // (a side() may read what its value() worked out on the same frame)
    const s = c.side?.(m, lm) ?? null;
    const pose = { image: lm.image.map(p => [r4(p.x), r4(p.y)]), side: s === 'L' ? 'left' : s === 'R' ? 'right' : null,
      t: Math.round((r.i / skel.fps) * 1000) / 1000, ...(on === mirror ? { mirrored: true } : {}) };
    out[c.id] = pose;
    info.checks.push({ id: c.id, t: pose.t, side: pose.side, value: r.value,
      ...(on === mirror ? { mirrored: true } : {}) });
  }
  return out;
}

/** A reference skeleton ready for its checks to pick from: its frames (referenceFrames), the rhythm's turns on them if
 * a check judges at turns (referenceTurns; `noTurns`: why none), and their stillness when a frame check asks
 * (stillnessOf, once). */
function prepare(skel, movement, checks, aspect) {
  const frames = referenceFrames(skel, aspect);
  let turns = [], noTurns = null, still = null;
  if (checks.some(isCycle)) {
    try { turns = referenceTurns(frames, movement, skel.fps); } catch (e) { noTurns = `no rhythm (${e.message})`; }
  }
  return { frames, turns, noTurns, fps: skel.fps,
    still: () => (still ??= stillnessOf(frames.map(f => ({ t: f.t, world: f.lm.world, image: f.lm.image })), aspect)) };
}

/** One check's frame on a reference (prepare): {i (null: none), why, value}. */
function pickOn(c, ref) {
  const { frames } = ref;
  // where it judges: its parts in view, from a view it is judged from, its phase holding; there, its value
  const phased = frames.map(({ m, lm }) => (c.needs ?? []).every(p => m.seen[p])
    && (!c.views || c.views.includes(m.view)) && (!c.phase || !!c.phase(m, lm)));
  const judged = frames.map(({ m, lm }, i) => {
    const v = phased[i] ? c.value(m, lm) : NaN;
    return Number.isFinite(v) ? v : null;
  });
  const margin = judged.map(v => (v === null ? null : okMargin(c, v)));
  // (a frame shown: ok on its own value, the whole body in the picture)
  const shown = i => judged[i] !== null && c.ok(judged[i]) && inPicture(frames[i].lm.image);
  if (isCycle(c) && ref.noTurns) return { i: null, why: ref.noTurns };
  const r = isCycle(c) ? cyclePick(c, judged, margin, shown, ref.turns, ref.fps)
    : framePick(c, phased, judged, margin, shown, frames, ref.still());
  return { ...r, value: r.i === null ? null : judged[r.i] };
}

/** A cycle check's reference frame (refPosesOf): {i (null: none), why}. The frames each turn of its kind gives it, as
 * MoveForm judges a cycle (its buffered frames are those judged; their times the played ones), on the turns it calls
 * ok; the most clearly ok of those, the first of equals. */
function cyclePick(c, judged, margin, shown, turns, fps) {
  const half = MOVE_TUNING.PEAK_MS / 2, mine = turns.filter(x => x.kind === c.at);
  let best = null, seen = 0, okTurns = 0;
  for (const x of mine) {
    // the frames played and judged from lo (after it, `open`) to hi: {i (the clip's frame), t (played), v}
    const within = (lo, hi, open = false) => x.play.map((i, p) => ({ i, t: (p * 1000) / fps, v: judged[i] }))
      .filter(f => f.v !== null && (open ? f.t > lo : f.t >= lo) && f.t <= hi);
    const near = within(x.t - half, x.t + half);
    let cycleV, picks;
    if ((c.take ?? 'at') === 'at') {
      if (!near.length) continue;                     // (no frame judged near the extreme: the turn is not judged)
      cycleV = median(near.map(f => f.v));
      picks = near.map(f => f.i);
    } else {
      // the half cycle up to the extreme (its extreme's frames judged), or (`over` 'cycle') the whole cycle since the
      // turn of this kind before; each value the median of three frames, the largest or smallest the cycle's
      if (c.over !== 'cycle' && !near.length) continue;
      const span = c.over === 'cycle' ? within(x.cycleFrom + half, x.t + half, true) : within(x.from, x.t + half);
      if (!span.length) continue;
      const sm = span.map((f, j) => ({ ...f, v: median(span.slice(Math.max(0, j - 1), j + 2).map(y => y.v)) }));
      const pick = sm.reduce((b, f) => ((c.take === 'max' ? f.v > b.v : f.v < b.v) ? f : b));
      cycleV = pick.v;
      picks = [pick.i];
    }
    seen += 1;
    if (!c.ok(cycleV)) continue;
    okTurns += 1;
    for (const i of picks) {
      if (shown(i) && (best === null || margin[i] > margin[best] || (margin[i] === margin[best] && i < best))) best = i;
    }
  }
  return { i: best, why: !mine.length ? `no ${c.at} of the rhythm's signal on the reference`
    : !seen ? `nothing it judges at the reference's ${c.at}s (its parts out of view, the view, or its phase)`
      : !okTurns ? `no ${c.at} of the reference it calls ok`
        : `no frame of its ok ${c.at}s ok on its own with the whole body in the picture` };
}

/** A frame check's reference frame (refPosesOf): {i (null: none), why}. Judged as MoveForm's frame() judges it (its
 * samples afresh when its phase starts holding, its first SETTLE_MS not judged, its value smoothed over SMOOTH_MS),
 * its value and its value smoothed both ok; the stillest of those (`still`: stillnessOf), the more clearly ok of
 * equals, the first of those. */
function framePick(c, phased, judged, margin, shown, frames, still) {
  const k = MOVE_TUNING, settle = k.SETTLE_MS ?? 0;
  let best = null, seen = 0, okFrames = 0, phaseFrom = null, phaseT = null, samples = [];
  const better = (i, j) => still[i] < still[j] || (still[i] === still[j]
    && (margin[i] > margin[j] || (margin[i] === margin[j] && i < j)));
  frames.forEach(({ t }, i) => {
    while (samples.length && samples[0].t <= t - k.SMOOTH_MS) samples.shift();
    if (!phased[i]) return;
    if (c.phase) {
      if (phaseT === null || t - phaseT > settle) { phaseFrom = t; samples = []; }
      phaseT = t;
      if (t - phaseFrom < settle) return;
    }
    if (judged[i] === null) return;
    samples.push({ t, v: judged[i] });
    seen += 1;
    if (!c.ok(median(samples.map(x => x.v))) || !c.ok(judged[i])) return;
    okFrames += 1;
    if (shown(i) && (best === null || better(i, best))) best = i;
  });
  return { i: best, why: !seen ? 'no frame it judges (its parts out of view, the view, or its phase)'
    : !okFrames ? 'no frame it judges is ok' : 'no ok frame with the whole body in the picture' };
}

// --- keys and spoken names --------------------------------------------------------------------------------------------

/** A readable key from a display name: "Overhead kettlebell squat" -> overhead_kettlebell_squat. */
export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Spoken names, as the page writes words down (lower case, no punctuation: intents.js words()): the display name
 * without its parenthesis ("Side stretch (left)" -> "side stretch"), the key's words, and the extra names given for
 * it. Longest first. */
export function synonymsOf(entry, extra = []) {
  const norm = s => String(s).toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
  const names = [entry.display.replace(/\([^)]*\)/g, ' '), entry.key.replace(/_/g, ' '), ...extra].map(norm);
  return [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

// --- the build --------------------------------------------------------------------------------------------------------

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Read a file, giving up after `ms` (an evicted iCloud file can stall for minutes). */
async function readWithin(file, ms = READ_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([fs.promises.readFile(file),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`read stalled over ${ms / 1000} s`)), ms); })]);
  } finally { clearTimeout(timer); }
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Kinds of the library the coach does not offer, so not built: sport moves, walking and jogging, gestures and idle
 * poses (the user's choice, 2026-10-24). The clip policy may clear them; they are left out by kind, not un-cleared. */
export const LEFT_OUT = ['sport', 'locomotion', 'gesture', 'idle'];

/** The rhythm the catalog gives motion `id` (motions[].rhythm), or null: none, or not {signal: one of SIGNALS,
 * minPeriodS > 0, prominence > 0}. */
export function catalogRhythm(catalog, id) {
  const r = (catalog.motions ?? []).find(m => m.id === id)?.rhythm;
  if (!r || !SIGNALS[r.signal] || !(r.minPeriodS > 0) || !(r.prominence > 0)) return null;
  return { signal: r.signal, minPeriodS: r.minPeriodS, prominence: r.prominence };
}

/** The movements to build, checked: every cleared id is a Ready motion of the catalog, cleared by the policy, and has a
 * key; nothing else is let through. A cleared motion of a kind LEFT_OUT is not built: `info.leftOut` counts those by
 * kind ({gesture: 4, ...}). Throws with every problem found. */
export function plan({ catalog, cleared, slugs, synonyms = {}, policy = null }, info = {}) {
  const problems = [];
  const clearedSet = new Set(cleared);
  if (clearedSet.size !== cleared.length) problems.push('cleared.json lists an id twice');
  const motions = Object.fromEntries((catalog.motions ?? []).map(m => [m.id, m]));
  for (const id of Object.keys(slugs)) if (!clearedSet.has(id)) problems.push(`slugs.json names ${id}, which cleared.json does not clear`);
  if (policy) {
    const reviewed = new Set(policy.reviewed ?? []);
    for (const id of cleared) {
      if (policy.exclude?.[id]) problems.push(`${id} is excluded by the clip policy: ${policy.exclude[id]}`);
      if (policy.confirm?.[id]) problems.push(`${id} needs the owner's confirmation under the clip policy: ${policy.confirm[id]}`);
      if (!reviewed.has(id)) problems.push(`${id} has not been reviewed under the clip policy`);
    }
  }
  const out = [], keys = new Map(), leftOut = {}, leftOutKeys = new Set();
  for (const id of cleared) {
    const m = motions[id];
    if (!m) { problems.push(`${id} is not a Ready motion of the catalog`); continue; }
    if (LEFT_OUT.includes(m.kind)) {
      leftOut[m.kind] = (leftOut[m.kind] ?? 0) + 1;
      if (slugs[id]) leftOutKeys.add(slugs[id]);
      continue;
    }
    const track = TRACK_OF_KIND[m.kind];
    if (!track) { problems.push(`${id}: unknown kind ${m.kind}`); continue; }
    let key;
    if (m.kind === 'gym_counted') {
      if (!EXERCISES[m.engine]) { problems.push(`${id}: engine ${m.engine} is not an exercise the engine counts`); continue; }
      key = slugify(m.display);
    } else {
      if (m.engine) problems.push(`${id}: kind ${m.kind} with an engine`);
      key = slugs[id];
      if (!key) { problems.push(`${id} (${m.kind}) has no key in slugs.json`); continue; }
    }
    if (!/^[a-z][a-z0-9_]*$/.test(key)) problems.push(`${id}: bad key ${key}`);
    if (keys.has(key)) problems.push(`key ${key} is used by ${keys.get(key)} and ${id}`);
    keys.set(key, id);
    const entry = { key, id, display: m.display, kind: m.kind, track, ...(m.kind === 'gym_counted' ? { engine: m.engine } : {}),
      coach: m.coach, glb: `glb/${key}.glb`, durationSec: m.durationSec };
    entry.synonyms = synonymsOf(entry, synonyms[key] ?? []);
    out.push(entry);
  }
  info.leftOut = leftOut;
  // (the names of a movement left out stay in synonyms.json, unused)
  for (const k of Object.keys(synonyms)) {
    if (!keys.has(k) && !leftOutKeys.has(k)) problems.push(`synonyms.json names ${k}, which is not a movement built`);
  }
  // a spoken name that two movements share would be a guess: neither keeps it
  const owners = new Map();
  for (const e of out) for (const s of e.synonyms) owners.set(s, [...(owners.get(s) ?? []), e.key]);
  for (const e of out) e.synonyms = e.synonyms.filter(s => owners.get(s).length === 1);
  if (problems.length) { const err = new Error(`refused:\n  ${problems.join('\n  ')}`); err.problems = problems; throw err; }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const dry = args.includes('--dry-run');
  const movesDir = path.resolve(arg('moves', process.env.POSE_MOVES_DIR || path.join(HERE, '..', '.data', 'moves')));
  const policyPath = arg('policy', process.env.POSE_CLIP_POLICY || path.join(movesDir, 'clip-policy.json'));
  const catalog = readJson(path.join(movesDir, 'catalog.json'));
  const library = path.resolve(arg('library', catalog.source));
  const cleared = readJson(path.join(movesDir, 'cleared.json'));
  const slugs = readJson(path.join(movesDir, 'slugs.json'));
  const synFile = path.join(movesDir, 'synonyms.json');
  const synonyms = fs.existsSync(synFile) ? readJson(synFile) : {};
  let policy;
  try { policy = JSON.parse(await readWithin(policyPath)); } catch (e) {
    console.error(`the clip policy (${policyPath}) could not be read: ${e.message}. Nothing built.`); process.exit(2);
  }
  let movements;
  const info = {};
  try { movements = plan({ catalog, cleared, slugs, synonyms, policy }, info); } catch (e) {
    console.error(e.message); process.exit(2);
  }

  const glbDir = path.join(movesDir, 'glb');
  if (!dry) fs.mkdirSync(glbDir, { recursive: true });
  const libFile = path.join(movesDir, 'library.json');
  const old = fs.existsSync(libFile) ? readJson(libFile) : null;
  const skipped = [], untested = [], restless = [];
  let copied = 0, same = 0;
  const built = [];
  /** A movement's reference skeleton: its npz, else its dump. */
  const reference = async m => {
    try {
      return skeletonFromNpz(await readWithin(path.join(library, m.id, 'source', 'skeleton_motion.npz')));
    } catch (e) {
      const dump = path.join(movesDir, 'skel', `${m.id}.json`);
      if (!fs.existsSync(dump)) throw e;
      const rel = path.relative(movesDir, dump);
      console.warn(`${m.key}: the skeleton npz could not be read (${e.message}); using ${rel}`);
      return readJson(dump);
    }
  };
  const formed = new Map();               // key -> the reference poses' info.checks (refPosesOf)
  for (const m of movements) {
    try {
      const guarded = (m.track === 'moving' || m.track === 'rhythm') && MOVE_FORMS[m.key];
      const skel = m.track === 'rhythm' || m.track === 'hold' || m.track === 'technique' || guarded ? await reference(m) : null;
      if (m.track === 'rhythm') {
        const info = {};
        // a rhythm the catalog gives (catalog.json motions[].rhythm: {signal, minPeriodS, prominence}), for a reference
        // too short to show it: the one-two cut from shadow boxing (2 s) holds one jab and one cross, and derived, its
        // clearest swing was the hips bobbing (hipHeight), not the punches. Measured on the 9 s clip it was cut from,
        // the upper arm from the torso (armMax) reads 40-48 deg in guard, 59-68 at a jab and 76-79 at a cross
        const given = catalogRhythm(catalog, m.id);
        const rhythm = given ?? rhythmOf(skeletonFeatures(skel), skel.fps, info);
        if (given) info.cycles = Infinity;
        else if (catalog.motions?.some(c => c.id === m.id && c.rhythm)) throw new Error('its catalog rhythm: invalid');
        if (info.cycles < 2) untested.push({ key: m.key, cycles: info.cycles });
        if (!rhythm) throw new Error('no signal of the reference skeleton cycles clearly');
        if (m.key === 'standing_side_crunch' && rhythm.fallback?.signal === 'thighOut') rhythm.preferFallback = true;
        m.rhythm = rhythm;
      }
      if (m.track === 'hold') {
        const info = {};
        const h = heldOf(skel, m.key, info);
        if (!h) throw new Error('no second of the reference skeleton shows the pose right (in it, its checks passing)');
        if (!(info.score <= TUNING.STILL)) restless.push({ key: m.key, score: info.score });
        Object.assign(m, h);
      }
      if (m.track === 'technique') {
        if (m.key !== 'one_two_jab') throw new Error('unknown technique assessor');
        m.refPoses = techniquePoses(techniqueFrames(skel));
      }
      if (guarded) {
        const info = {};
        m.refPoses = refPosesOf(skel, m, info);
        formed.set(m.key, info.checks);
      }
      const src = path.join(library, m.id, 'variants', 'mixamo-y-bot', 'animation.glb');
      const glb = await readWithin(src);
      if (glb.length < 12 || glb.toString('latin1', 0, 4) !== 'glTF') throw new Error(`${src} is not a GLB`);
      const dest = path.join(movesDir, m.glb);
      if (fs.existsSync(dest) && fs.statSync(dest).size === glb.length && sha(fs.readFileSync(dest)) === sha(glb)) same += 1;
      else {
        if (!dry) { fs.writeFileSync(`${dest}.tmp`, glb); fs.renameSync(`${dest}.tmp`, dest); }
        copied += 1;
      }
      built.push(m);
    } catch (e) {
      // (a file that stalled this time: the movement as the last build made it stays, if that build had it)
      formed.delete(m.key);
      const before = old?.movements?.find(x => x.key === m.key && x.id === m.id);
      const kept = before && fs.existsSync(path.join(movesDir, before.glb));
      if (kept) built.push(before);
      skipped.push({ id: m.id, key: m.key, reason: e.message, ...(kept ? { kept: 'the previous build' } : {}) });
      console.error(`skipped ${m.key} (${m.id}): ${e.message}${kept ? ' (the previous build of it is kept)' : ''}`);
    }
  }
  // GLBs of keys no longer built (no longer cleared, left out, or renamed) go; one skipped this time keeps its copy
  const keep = new Set(movements.map(m => path.basename(m.glb)));
  const stale = fs.existsSync(glbDir) ? fs.readdirSync(glbDir).filter(f => f.endsWith('.glb') && !keep.has(f)) : [];
  if (!dry) for (const f of stale) fs.unlinkSync(path.join(glbDir, f));

  const body = { movements: built, ...(skipped.length ? { skipped } : {}) };
  const unchanged = old && JSON.stringify({ movements: old.movements, ...(old.skipped ? { skipped: old.skipped } : {}) }) === JSON.stringify(body);
  // (written whole, then renamed into place: the page fetching it while it is written gets the old file or the new one,
  // never half of one, which it took for no library)
  if (!unchanged && !dry) {
    fs.writeFileSync(`${libFile}.tmp`, `${JSON.stringify({ built: new Date().toISOString().slice(0, 10), ...body }, null, 1)}\n`);
    fs.renameSync(`${libFile}.tmp`, libFile);
  }
  const tracks = {};
  for (const m of built) tracks[m.track] = (tracks[m.track] ?? 0) + 1;
  const outKinds = LEFT_OUT.filter(k => info.leftOut[k]), nOut = outKinds.reduce((n, k) => n + info.leftOut[k], 0);
  console.log(`${dry ? '(dry run) ' : ''}${built.length} movements ${JSON.stringify(tracks)}`
    + `${nOut ? `; left out ${nOut} (${outKinds.map(k => `${k} ${info.leftOut[k]}`).join(', ')})` : ''}`
    + `; GLBs copied ${copied}, unchanged ${same}`
    + `${stale.length ? `, removed ${stale.length} stale` : ''}; library.json ${unchanged ? 'unchanged' : dry ? 'would be written' : 'written'}`
    + `${skipped.length ? `; ${skipped.length} skipped` : ''}`);
  for (const m of built.filter(x => x.rhythm)) {
    const u = untested.find(x => x.key === m.key);
    console.log(`  rhythm ${m.key}: ${JSON.stringify(m.rhythm)}${u ? ` (its reference shows ${u.cycles} cycle${u.cycles === 1 ? '' : 's'}:`
      + ' the period is a guess from one swing, and no run of full reps was counted with it)' : ''}`);
  }
  for (const m of built.filter(x => x.held)) {
    const r = restless.find(x => x.key === m.key);
    console.log(`  held ${m.key}: ${m.held.start}-${m.held.end} s of ${m.durationSec}`
      + `, working side ${m.pose.side ?? 'none'}`
      + `${r ? ` (never still by the page's measure: its stillest second scores ${r.score.toFixed(1)})` : ''}`);
  }
  // (a movement kept from the previous build this time has no line: its skip says why)
  for (const m of built.filter(x => formed.has(x.key))) {
    const checks = formed.get(m.key).map(c => (c.why ? `${c.id} none (${c.why})`
      : `${c.id} ${c.t} s${c.mirrored ? ' mirrored' : ''}, side ${c.side ?? 'none'}, ${+c.value.toPrecision(3)}`));
    console.log(`  form ${m.key}: ${checks.join('; ')}`);
  }
  // (a read that stalled may still hold a thread: exit explicitly)
  process.exit(skipped.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
