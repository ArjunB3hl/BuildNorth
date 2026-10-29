import { API_URL, DEV_SESSION_TOKEN } from '../config';
import type { SessionInput } from './api';

// The camera coach (inference/pose-coach) inside the Windows app. The app shows the local camera page at the top of
// its own WebView2 (http://127.0.0.1:8765/web/index.html?embed=1&parent=windows-app) and plays the part the website
// plays around its frame: it hears about each set over `window.chrome.webview` and saves the workout itself. The page
// never gets the sign-in. Messages are `{ type: 'pose-coach/<name>' }` (inference/pose-coach/docs/INTEGRATION.md).
// The counting below is the phone/website app's (mobile/src/lib/pose-coach.ts), unchanged.

export const POSE_ORIGIN = 'http://127.0.0.1:8765';
const POSE_PATH = '/web/index.html';

/** The camera page, told it is in the Windows app. */
export function poseUrl(theme: 'light' | 'dark'): string {
  return `${POSE_ORIGIN}${POSE_PATH}?embed=1&parent=windows-app&theme=${theme}`;
}

/** Whether `url` is the local camera page: the only page whose messages the app takes. */
export function trustedPoseUrl(url: string | undefined): boolean {
  const match = /^(http:\/\/[^/?#]+)(\/[^?#]*)/.exec(url ?? '');
  return !!match && match[1].toLowerCase() === POSE_ORIGIN && match[2] === POSE_PATH;
}

/** Where a saved workout goes, said plainly: a local test backend is never the live Calendar. */
export function saveTarget(mode: 'demo' | 'account', apiUrl = API_URL, devToken = DEV_SESSION_TOKEN) {
  if (mode === 'demo') return 'Saves to this PC’s demo Calendar only (not signed in).';
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiUrl);
  if (local)
    return `Saves to the local test backend at ${apiUrl}${
      devToken ? ' (fictional test user)' : ''
    }, not your live Rhythm Calendar.`;
  return `Saves to your Rhythm account’s Calendar (${apiUrl}).`;
}

/** A message from the WebView, or null for anything else (another page, not JSON, not ours). */
export function poseMessage(event: { url?: string; data: string }): PoseMessage | null {
  if (!trustedPoseUrl(event.url) || typeof event.data !== 'string' || event.data.length > 200_000) return null;
  try {
    const data = JSON.parse(event.data) as { type?: unknown } | null;
    return typeof data?.type === 'string' && data.type.startsWith('pose-coach/') ? (data as PoseMessage) : null;
  } catch {
    return null;
  }
}

export type PoseSet = {
  exercise: string;
  label: string;
  set: number;
  reps: number;
  partials: number;
  faults: Record<string, number>;
  perSide: Record<string, number>;
};
export type PoseWorkout = {
  startedAt: string;
  finishedAt: string;
  sets: PoseSet[];
  totals: Record<string, { label: string; sets: number; reps: number }>;
};
export type PoseMessage =
  | { type: 'pose-coach/resize'; height: number }
  | { type: 'pose-coach/ready'; version: string | null }
  | { type: 'pose-coach/state'; running: boolean; startedAt: string | null }
  | ({ type: 'pose-coach/progress' } & PoseSet)
  | ({ type: 'pose-coach/set' } & PoseSet)
  | ({ type: 'pose-coach/summary' } & PoseWorkout)
  | { type: 'pose-coach/error'; message: string }
  | { type: 'pose-coach/elevenlabs-session-request'; requestId: string };

/** Another run of the camera (Stop, then Start again on the same screen) added to the sets not saved yet. */
export function addRun(kept: PoseWorkout | null, run: { startedAt: string; finishedAt: string; sets: PoseSet[] }): PoseWorkout {
  const sets = [...(kept?.sets ?? []), ...run.sets];
  const totals: PoseWorkout['totals'] = {};
  for (const s of sets) {
    const x = (totals[s.exercise] ??= { label: s.label, sets: 0, reps: 0 });
    x.sets += 1;
    x.reps += s.reps;
  }
  const startedAt = kept && kept.startedAt < run.startedAt ? kept.startedAt : run.startedAt;
  const finishedAt = kept && kept.finishedAt > run.finishedAt ? kept.finishedAt : run.finishedAt;
  return { startedAt, finishedAt, sets, totals };
}

/**
 * The camera run in progress (Start in the frame): when it started, the sets it has finished, and the set it is in
 * the middle of (`current`, from the page's progress messages), so a run cut short loses no counted rep.
 */
export type Run = { startedAt: string; sets: PoseSet[]; current: PoseSet | null };
/**
 * A finished run: its sets from the page's summary (`final`), or what was counted when it ended without one (the page
 * reloaded, or did not answer a stop in time). A late summary replaces the latter; a summary sent again is ignored.
 */
export type RunRecord = { startedAt: string; finishedAt: string; sets: PoseSet[]; final: boolean };
/**
 * What a camera workout screen has counted and not saved: its finished runs and the run in progress. `closed`: the
 * start times of runs handed over for saving (`freeze`), whose late summaries must not count again.
 */
export type Counted = { runs: RunRecord[]; run: Run | null; closed: string[] };
export const NOTHING_COUNTED: Counted = { runs: [], run: null, closed: [] };

const sameSet = (a: PoseSet, b: PoseSet) => a.exercise === b.exercise && a.set === b.set;
/** A run's sets so far: the finished ones, and the one in progress if it has reps. */
function runSets(run: Run): PoseSet[] {
  const c = run.current;
  return c && c.reps > 0 && !run.sets.some((s) => sameSet(s, c)) ? [...run.sets, c] : run.sets;
}

/** The sets counted so far, finished runs first, then the run in progress (with the set it is in the middle of). */
export function countedSets(c: Counted): PoseSet[] {
  return [...c.runs.flatMap((r) => r.sets), ...(c.run ? runSets(c.run) : [])];
}

/** Everything counted, finished runs and the run in progress, as one workout: what saving would save now. */
export function countedWorkout(c: Counted, now: string): PoseWorkout | null {
  const parts = [...c.runs, ...(c.run ? [{ startedAt: c.run.startedAt, finishedAt: now, sets: runSets(c.run) }] : [])];
  return parts.filter((r) => r.sets.length).reduce<PoseWorkout | null>((w, r) => addRun(w, r), null);
}

/** The run in progress is over without its summary (the page reloaded, or did not answer a stop): keep its sets. */
export function endRun(c: Counted, now: string): Counted {
  if (!c.run) return c;
  return { ...c, runs: [...c.runs, { startedAt: c.run.startedAt, finishedAt: now, sets: runSets(c.run), final: false }], run: null };
}

/**
 * The counted workout is handed over for saving (it becomes a stored workout of its own, which never grows): start
 * counting afresh, and ignore anything that comes late for the runs handed over.
 */
export function freeze(c: Counted): Counted {
  return { runs: [], run: null, closed: [...c.closed, ...c.runs.map((r) => r.startedAt), ...(c.run ? [c.run.startedAt] : [])] };
}

/** A progress or set message's set, without its `type`. */
const setOf = (m: PoseSet): PoseSet => ({
  exercise: m.exercise,
  label: m.label,
  set: m.set,
  reps: m.reps,
  partials: m.partials,
  faults: m.faults,
  perSide: m.perSide,
});

const unchanged = (c: Counted) => ({ counted: c, started: false, ended: false });

/**
 * A message from the page applied to what is counted. `started`: a run began. `ended`: a run is over, so a pending
 * "Finish and save" can save. Sets and progress outside a run (late, after the run was ended here) are ignored: the
 * run's summary brings them.
 */
export function countMessage(c: Counted, m: PoseMessage, now: string): { counted: Counted; started: boolean; ended: boolean } {
  switch (m.type) {
    case 'pose-coach/ready':                     // also after the page reloaded: a run it had going is over
      return { counted: endRun(c, now), started: false, ended: !!c.run };
    case 'pose-coach/state': {                   // (stopping: the summary follows)
      const startedAt = m.startedAt ?? now;
      if (!m.running || c.run?.startedAt === startedAt || c.closed.includes(startedAt)) return unchanged(c);
      return { counted: { ...endRun(c, now), run: { startedAt, sets: [], current: null } }, started: true, ended: false };
    }
    case 'pose-coach/progress': {
      if (!c.run) return unchanged(c);
      const current = setOf(m);
      return { counted: { ...c, run: { ...c.run, current } }, started: false, ended: false };
    }
    case 'pose-coach/set': {
      if (!c.run) return unchanged(c);
      const set = setOf(m);
      const current = c.run.current && sameSet(c.run.current, set) ? null : c.run.current;
      return { counted: { ...c, run: { ...c.run, sets: [...c.run.sets, set], current } }, started: false, ended: false };
    }
    case 'pose-coach/summary': {
      const w = { startedAt: m.startedAt, finishedAt: m.finishedAt, sets: m.sets };
      if (c.closed.includes(w.startedAt)) return { counted: c, started: false, ended: true };   // already handed over
      const record: RunRecord = { ...w, final: true };
      const i = c.runs.findIndex((r) => r.startedAt === w.startedAt);
      if (i >= 0) {
        if (c.runs[i].final) return { counted: c, started: false, ended: true };          // sent again
        return { counted: { ...c, runs: c.runs.map((r, j) => (j === i ? record : r)) }, started: false, ended: true };
      }
      return {
        counted: { ...c, runs: [...c.runs, record], run: c.run && c.run.startedAt !== w.startedAt ? c.run : null },
        started: false,
        ended: true,
      };
    }
    default:
      return unchanged(c);
  }
}

/**
 * The counted workout as an Activity session: one entry per exercise, in the order first done, each set completed
 * with its reps. Within the API's limits: 50 entries of 20 sets (an exercise with more sets gets more entries), 0-500
 * reps, names up to 120 characters.
 */
export function sessionFromWorkout(
  workout: PoseWorkout,
  opts: { localDate: string; routineId?: string | null; routineName?: string | null; planItemId?: string | null },
): SessionInput {
  const byExercise = new Map<string, PoseSet[]>();
  for (const s of workout.sets) if (s.reps > 0) byExercise.set(s.exercise, [...(byExercise.get(s.exercise) ?? []), s]);
  const partials = workout.sets.reduce((n, s) => n + (s.partials || 0), 0);
  const finishedAt = workout.finishedAt < workout.startedAt ? workout.startedAt : workout.finishedAt;
  return {
    routineId: opts.routineId ?? null,
    routineName: (opts.routineName || 'Camera workout').slice(0, 120),
    planItemId: opts.planItemId ?? null,
    localDate: opts.localDate,
    startedAt: workout.startedAt,
    finishedAt,
    // more than 20 sets of one exercise (the API's limit per entry) go on in another entry of the same name
    entries: [...byExercise.values()]
      .flatMap((sets) => Array.from({ length: Math.ceil(sets.length / 20) }, (_, i) => sets.slice(i * 20, i * 20 + 20)))
      .slice(0, 50)
      .map((sets) => ({
        name: sets[0].label.slice(0, 120),
        skipped: false,
        sets: sets.map((s) => ({ reps: Math.min(500, Math.max(0, Math.round(s.reps))), completed: true })),
      })),
    notes: `Counted by the camera coach.${partials ? ` ${partials} partial ${partials === 1 ? 'rep' : 'reps'} not counted.` : ''}`,
  };
}

/** "Squat 2 × 8, Lunge 1 × 6": what will be saved. */
export function workoutLine(sets: PoseSet[]): string {
  const byExercise = new Map<string, { label: string; reps: number[] }>();
  for (const s of sets) {
    const x = byExercise.get(s.exercise) ?? { label: s.label, reps: [] };
    x.reps.push(s.reps);
    byExercise.set(s.exercise, x);
  }
  return [...byExercise.values()]
    .map((x) => (x.reps.every((r) => r === x.reps[0]) ? `${x.label} ${x.reps.length} × ${x.reps[0]}` : `${x.label} ${x.reps.join(', ')}`))
    .join(' · ');
}
