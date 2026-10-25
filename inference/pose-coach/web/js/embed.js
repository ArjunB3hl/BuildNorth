// The page inside the BuildNorth app (?embed=1, docs/INTEGRATION.md): the app frames this page, hears about each set
// and saves the workout itself. Only the app holds the sign-in; this page never sees it. Messages are
// {type: 'pose-coach/<name>', ...}, sent only to the app's exact origin and taken only from it and from the frame's
// parent window. The app must be a page on this machine, as for the backend's CORS: the pose page has no sign-in.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
export const DEFAULT_PARENT = 'http://localhost:8081';

export const embedded = search => new URLSearchParams(search).get('embed') === '1';

/** The app's origin from ?parent= (default: the Expo web app), or null if it is not a page on this machine. */
export function parentOrigin(search) {
  const p = new URLSearchParams(search).get('parent') || DEFAULT_PARENT;
  return LOCAL.test(p) ? p : null;
}

/**
 * The workout as the app gets it. `sets`: auto mode's summary() sets (the counts it settled on), with the faults and
 * per-side counts of their set_end events (`ended`); `startedAt`/`finishedAt`: wall-clock ISO times.
 */
export function workoutOf(sets, ended, startedAt, finishedAt) {
  const out = sets.filter(s => s.reps > 0).map(s => {
    const e = ended.find(x => x.exercise === s.exercise && x.set === s.set);
    return { exercise: s.exercise, label: s.label, set: s.set, reps: s.reps, partials: s.partials ?? 0,
      faults: { ...(e?.faults || {}) }, perSide: { ...(e?.perSide || {}) } };
  });
  const totals = {};
  for (const s of out) {
    const x = totals[s.exercise] ??= { label: s.label, sets: 0, reps: 0 };
    x.sets += 1; x.reps += s.reps;
  }
  return { startedAt, finishedAt, sets: out, totals };
}

/** The link to the app: `send(name, fields)`, and `on(name, fn)` for the app's messages (start, stop). */
export function connect(win, parent) {
  const handlers = {};
  win.addEventListener('message', ev => {
    if (ev.origin !== parent || ev.source !== win.parent || typeof ev.data?.type !== 'string') return;
    const name = ev.data.type.startsWith('pose-coach/') && ev.data.type.slice('pose-coach/'.length);
    if (name && handlers[name]) handlers[name](ev.data);
  });
  return {
    send: (name, fields = {}) => win.parent.postMessage({ ...fields, type: `pose-coach/${name}` }, parent),
    on: (name, fn) => { handlers[name] = fn; },
  };
}
