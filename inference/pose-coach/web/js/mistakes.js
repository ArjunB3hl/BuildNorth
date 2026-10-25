// A workout's mistakes, kept to be shown again (app.js: the Workout card's Mistakes list). Each mistake the side
// panel's form check showed while the workout ran (an exercise's faulty rep: kind 'exercise'; a held pose's fault the
// coach was told: 'hold'; a moving or rhythm movement's, web/js/moveform.js: 'move') is kept with what it takes to show
// it the same way again: when, what, the fault, the frames shown as "You" and where "Like this" comes from (the
// exercise's demo; the movement's reference pose, by its key). Live, the panel goes away on the fix, at the hold's or
// the movement's end, after a few seconds or when the workout stops: the list keeps it until the next workout.
// A recording keeps them too, without frames (the recording has them: each mistake names its window of frame times);
// one saved before that has its mistakes derived from its events. Pure: no DOM, Node-testable.
import { describeFault } from './formcheck.js';

export const MAX_MISTAKES = 40;           // a long workout: the latest this many (the list says how many are left out)
// a fault's own fields, as the engine (an exercise's rep), web/js/holdform.js (a held pose) and web/js/moveform.js (a
// moving or rhythm movement: the same as a hold's) name them
const HELD = ['fault', 'label', 'measured', 'target', 'cue', 'part', 'side'];
const FIELDS = { exercise: ['code', 'message', 'value', 'severity', 'part'], hold: HELD, move: HELD };
// (as app.js: the replay of a rep pads its window by this much; a held pose's fault, and a moving movement's, replay
// the last HOLD_REPLAY_MS)
const PAD_MS = 150, HOLD_REPLAY_MS = 2000;
const SAME_MS = 3000;                     // app.js formCheck: the same fault again within this long is not shown again
// app.js: a hold is told (its faults shown) TOLD_MS after its stillness began, and one that ended within SHORT_HOLD_MS
// never was (the tracker takes a second or so to end a hold)
const SHORT_HOLD_MS = 5000, TOLD_MS = 6500;
// a hold's events after its start, timed to the frame they were said on (but hold_end: to when the hold ended)
const HOLD_EVENTS = new Set(['hold_fault', 'hold_fix', 'hold_progress', 'hold_end']);

const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));
const finite = x => typeof x === 'number' && Number.isFinite(x);

// A moving or rhythm movement's fault says which frames its verdict was based on (web/js/moveform.js form_fault `seen`
// {from, to}, frame times in ms: a cycle check's frames around the moment it measured, a frame check's last bad
// ones). It is told later than those: a cycle check when the rep counter confirms the turn, which can be seconds after
// it (the shoulder rotation's last 2 s showed the hands coming back in; a low kick at 0.75x speed, no kick at all).
// "You" replays those frames, SEEN_PAD_MS either side, at most SEEN_MAX_MS of them
export const SEEN_PAD_MS = 300, SEEN_MAX_MS = 3000;
/** The frames to replay for a fault whose `seen` is {from, to}, told at frame time `t` ({start, end}, inclusive: the
 * span padded by SEEN_PAD_MS, none after `t` (the page had no later frame when it showed it), at most SEEN_MAX_MS
 * about the span's middle), or null: no `seen` (a hold's fault, an event from before it), or not a span before `t`. */
export function seenWindow(seen, t = Infinity) {
  if (!finite(seen?.from) || !finite(seen?.to) || seen.to < seen.from) return null;
  const from = seen.from - SEEN_PAD_MS, to = Math.min(seen.to + SEEN_PAD_MS, t);
  if (!(to >= from)) return null;
  if (to - from <= SEEN_MAX_MS) return { start: from, end: to };
  const mid = (seen.from + Math.min(seen.to, t)) / 2;
  const start = Math.min(Math.max(mid - SEEN_MAX_MS / 2, from), to - SEEN_MAX_MS);
  return { start, end: start + SEEN_MAX_MS };
}

/** The mistakes of one workout, oldest first: at most `max`, the earliest left out (counted in `left`). */
export class MistakeList {
  constructor(max = MAX_MISTAKES) { this.max = max; this.items = []; this.left = 0; }
  add(m) {
    this.items.push(m);
    while (this.items.length > this.max) { this.items.shift(); this.left += 1; }
    return m;
  }
  clear() { this.items = []; this.left = 0; }
  get size() { return this.items.length; }
  newestFirst() { return this.items.slice().reverse(); }
}

/** A mistake as a recording keeps it: no frames (its window names them), the fault's fields spread. `m`: {t, at, kind,
 * what, exercise | movement, fault, side, turn, window}. */
export function recordOf(m) {
  const own = m.kind !== 'exercise' ? { movement: m.movement }
    : { exercise: m.exercise, ...(finite(m.turn) ? { turn: m.turn } : {}) };
  return { t: m.t, at: m.at, kind: m.kind, what: m.what, ...own, ...pick(m.fault, FIELDS[m.kind]),
    side: m.side ?? null, window: { start: m.window.start, end: m.window.end } };
}

/** A recording's mistake back as the page keeps one (without its frames), or null if it is not one. */
export function fromRecord(r) {
  if (!r || !FIELDS[r.kind] || !finite(r.t) || !finite(r.window?.start) || !finite(r.window?.end)) return null;
  const own = r.kind !== 'exercise' ? { movement: r.movement }
    : { exercise: r.exercise, turn: finite(r.turn) ? r.turn : r.t };
  return { t: r.t, at: finite(r.at) ? r.at : null, kind: r.kind, what: r.what ?? '', ...own,
    fault: pick(r, FIELDS[r.kind]), side: r.side ?? null, window: { start: r.window.start, end: r.window.end } };
}

/**
 * The mistakes of a recording saved before they were kept, from its events, as recordOf() has them: what the page
 * showed. A held pose's fault (in its start's form.open, or a hold_fault), once until its hold_fix, with the last
 * HOLD_REPLAY_MS of frames before it was shown. The page tells a hold on its first frame TOLD_MS into it (the
 * recording's, else TOLD_MS in), with its form as that frame left it (app.js moveEvents reads it after the tracker
 * took the frame: a fault or a fix said on that frame is in it): of the faults told by then, one fixed by then is not
 * shown, and of those still there only the latest told (the form's first), then; one told after that frame, when it
 * was measured. None of a hold that ended before the page told it: one of its events after that frame says it did
 * not; else its end within SHORT_HOLD_MS of its start (an end is timed to when the hold ended, and the tracker says
 * it a second or so later). And an exercise's faulty rep or partial rep (its window, or about the rep), the same
 * fault within SAME_MS once; a faulty rep a new set counts back, when the rep counted with it is clean (app.js
 * handleAuto shows that one then). And a moving or rhythm movement's fault (form_fault): each one when it was told,
 * with the frames its verdict was based on (seenWindow of its `seen`), or without `seen` (an event from before it) the
 * last HOLD_REPLAY_MS of frames before it. The page tells and shows those on the frame they come (no start
 * held back, nothing like a hold's 6.5 s), and the tracker tells a fault once until it is fixed: a form_fix takes back
 * nothing shown, and the same fault told again after it is a new mistake. `known(exercise)`: one the page has;
 * `label(exercise)`: its name; `pick(exercise, faults)`: the fault the page shows (the first one its demo does not
 * have, else the first).
 */
export function deriveMistakes(rec, { known = () => true, label = k => k,
  pick: choose = (_, faults) => faults[0] } = {}) {
  const out = [], last = new Map();
  // the recording's frame times, in order: the page ran moveEvents on each frame it recorded, the user seen or not
  const times = (Array.isArray(rec?.frames) ? rec.frames : []).map(f => f?.t).filter(finite), lastFrame = times.at(-1);
  const tellAt = t => {                               // the page told a hold that started at t: on this frame
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t + TOLD_MS) lo = mid + 1; else hi = mid; }
    return lo < times.length ? times[lo] : t + TOLD_MS;
  };
  // the hold under way: its start, and the frame the page told it on (`tellT`); until it told it (`said`), the faults
  // told and still there (`pending`, the latest told last); its mistakes, and the faults told since and still open
  let hold = null;
  let earlier = null;                                 // a faulty rep a new set counted back (handleAuto's `earlier`)
  const mistake = (f, t) => ({ t, kind: 'hold', what: hold.start.display ?? hold.start.key, movement: hold.start.key,
    ...pick(f, FIELDS.hold), side: f.side ?? null, window: { start: t - HOLD_REPLAY_MS, end: t } });
  const told = (f, t) => {
    if (!hold.said) { hold.pending.delete(f.fault); hold.pending.set(f.fault, f); return; }
    if (hold.open.has(f.fault)) return;
    hold.open.add(f.fault);
    hold.items.push(mistake(f, t));
  };
  const say = () => {                                 // the page tells the hold: the latest fault still there shown
    hold.said = true;
    for (const k of hold.pending.keys()) hold.open.add(k);
    const f = [...hold.pending.values()].at(-1);
    if (f) hold.items.push(mistake(f, hold.tellT));
  };
  const faultsOf = e => (Array.isArray(e.faults) ? e.faults.filter(f => typeof f?.code === 'string') : []);
  const shown = (e, t) => {                           // a rep's fault shown at t (formCheck)
    const exercise = e.exercise ?? rec.exercise, faults = faultsOf(e);
    if (!faults.length || !exercise || !known(exercise)) return;
    const f = choose(exercise, faults) ?? faults[0], id = `${exercise}/${f.code}`;
    if (last.has(id) && t - last.get(id) < SAME_MS) return;
    last.set(id, t);
    const w = finite(e.window?.start) && finite(e.window?.end) ? e.window : { start: e.t - 1500, end: e.t + 800 };
    out.push({ t, kind: 'exercise', what: e.label ?? label(exercise) ?? exercise, exercise, turn: e.t,
      ...pick(f, FIELDS.exercise), side: e.side ?? null, window: { start: w.start - PAD_MS, end: w.end + PAD_MS } });
  };
  for (const e of Array.isArray(rec?.events) ? rec.events : []) {
    if (!e || !finite(e.t)) continue;
    // (an event of the hold timed after the frame the page told it on came after; one on that frame is in its form)
    if (hold && !hold.said && HOLD_EVENTS.has(e.type) && e.t > hold.tellT) say();
    if (e.type === 'hold_start') {
      hold = { start: e, tellT: tellAt(e.t), said: false, pending: new Map(), items: [], open: new Set() };
      for (const f of (e.form?.open ?? []).slice().reverse()) if (f?.fault) told(f, e.t);  // (the latest told first)
    } else if (e.type === 'hold_fault' && hold) {
      told(e, e.t);
    } else if (e.type === 'hold_fix' && hold) {
      hold.pending.delete(e.fault); hold.open.delete(e.fault);    // (the same fault again later: a new mistake)
    } else if (e.type === 'hold_end' && hold) {
      // (in the order the tracker said them: a fault measured as the hold ended comes before its end)
      if (!hold.said && e.t - hold.start.t >= SHORT_HOLD_MS) say();
      if (hold.said) out.push(...hold.items);
      hold = null;
    } else if (e.type === 'rep' && e.backfill) {
      if (faultsOf(e).length) earlier = e;           // (not shown then)
    } else if (e.type === 'rep') {
      // (the rep counted with those a new set counts back: its own fault shown, else theirs)
      shown(!faultsOf(e).length && earlier ? earlier : e, e.t);
      earlier = null;
    } else if (e.type === 'partial') {
      shown(e, e.t);
    } else if (e.type === 'form_fault' && typeof e.fault === 'string') {
      const window = seenWindow(e.seen, e.t) ?? { start: e.t - HOLD_REPLAY_MS, end: e.t };
      out.push({ t: e.t, kind: 'move', what: e.display ?? e.key ?? '', movement: e.key, ...pick(e, FIELDS.move),
        side: e.side ?? null, window });
    }
  }
  if (hold) {                                         // (a hold still open when the recording ends)
    if (!hold.said && finite(lastFrame) && lastFrame >= hold.tellT) say();
    if (hold.said) out.push(...hold.items);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A recording's mistakes (recordOf() entries, oldest first, each with `at`: seconds into the workout): its own, or
 * derived from its events (`derived`) if it was saved before they were kept. */
export function mistakesOf(rec, opts = {}) {
  const own = Array.isArray(rec?.mistakes), t0 = rec?.frames?.[0]?.t ?? 0;
  const list = own ? rec.mistakes.filter(r => fromRecord(r)) : deriveMistakes(rec, opts);
  return { derived: !own, records: list.map(r => ({ ...r, at: finite(r.at) ? r.at : Math.max(0, (r.t - t0) / 1000) }))
    .sort((a, b) => a.t - b.t) };
}

/** A recording's frames ([{t, image: [[x, y, z, visibility]], world: [[x, y, z]]}]) within `window` (inclusive), as the
 * page's own ({t, image: [{x, y, z, visibility}], world: [{x, y, z}]}). */
export function framesIn(frames, window) {
  const pts = a => (Array.isArray(a) ? a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 })) : null);
  return (Array.isArray(frames) ? frames : []).filter(f => f && f.t >= window.start && f.t <= window.end)
    .map(f => ({ t: f.t, image: pts(f.image), world: pts(f.world) }));
}

/** Seconds as the list shows them: "0:42", "12:05". */
export const clock = sec => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const cap = s => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : '');

/** A mistake's row in the list: when (into the workout), what, the fault's label and its measurement. */
export function rowOf(m) {
  const f = m.fault ?? {};
  if (m.kind === 'hold' || m.kind === 'move') {
    return { when: clock(m.at), what: m.what, label: cap(f.label ?? f.fault), measured: f.measured ?? '' };
  }
  const label = f.message ?? f.code ?? '', measured = describeFault(m.exercise, f);
  return { when: clock(m.at), what: m.what, label, measured: measured && measured !== label ? measured : '' };
}

/** A saved recording's name as the list says it: "Oct 25, 02:00 (auto)" from live-<UTC time>-<mode>, or its id. */
export function savedName(id, locale = undefined) {
  const m = /^live-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-(.+)$/.exec(String(id));
  if (!m) return String(id);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const when = d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${when} (${m[7].replace(/_/g, ' ')})`;
}
