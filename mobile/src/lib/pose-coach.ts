import type { SessionInput } from '@/lib/types';

/**
 * The browser pose coach (inference/pose-coach), framed by the camera workout screen. It runs on its own local
 * server and counts reps from the camera; this app saves what it counted. Messages are `{ type: 'pose-coach/<name>' }`
 * (inference/pose-coach/docs/INTEGRATION.md). The page never gets the sign-in: only this app calls the API.
 * 127.0.0.1, not localhost: cookies ignore ports, so on localhost the page would get this app's Clerk cookies.
 */
export const POSE_URL = process.env.EXPO_PUBLIC_POSE_URL || 'http://127.0.0.1:8765/web/index.html?embed=1';

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
  | { type: 'pose-coach/error'; message: string };

/** The page's address with this app's origin, so the page answers only to this window. */
export function poseFrameUrl(base: string, parentOrigin: string): string {
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password)
    throw new Error('The camera coach must use a local HTTP address without credentials.');
  const parent = new URL(parentOrigin);
  if (parent.origin !== parentOrigin || parent.protocol !== 'http:' || parent.hostname !== 'localhost')
    throw new Error('Open the website on localhost to keep its cookies separate from the camera coach.');
  url.hostname = '127.0.0.1';
  // Allow replay settings only. Account details, tokens, hashes and unrelated query fields never enter the frame.
  const source = url.searchParams.get('source');
  const speed = url.searchParams.get('replay_speed');
  url.search = '';
  url.hash = '';
  url.searchParams.set('embed', '1');
  url.searchParams.set('parent', parentOrigin);
  if (source) url.searchParams.set('source', source);
  if (speed) url.searchParams.set('replay_speed', speed);
  return url.toString();
}

/** A message from the page, or null for anything else (another frame, another origin, or not ours). */
export function poseMessage(event: { data: unknown; origin: string; source: unknown }, frame: unknown, poseOrigin: string): PoseMessage | null {
  if (event.origin !== poseOrigin || event.source !== frame || !frame) return null;
  const data = event.data as { type?: unknown } | null;
  return typeof data?.type === 'string' && data.type.startsWith('pose-coach/') ? (data as PoseMessage) : null;
}

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
      const { type: _, ...current } = m;
      return { counted: { ...c, run: { ...c.run, current } }, started: false, ended: false };
    }
    case 'pose-coach/set': {
      if (!c.run) return unchanged(c);
      const { type: _, ...set } = m;
      const current = c.run.current && sameSet(c.run.current, set) ? null : c.run.current;
      return { counted: { ...c, run: { ...c.run, sets: [...c.run.sets, set], current } }, started: false, ended: false };
    }
    case 'pose-coach/summary': {
      const { type: _, totals: __, ...w } = m;
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

// --- unsaved workouts kept on the device -----------------------------------------------------------------------
/**
 * A workout kept on the device. `sent`: a save of it went out and no success was seen (an error, a timeout, the tab
 * closed): the server may have it, so it is checked before it is offered or saved again. `routine`: the routine and
 * plan item it was counted for, if any.
 */
export type StoredWorkout = PoseWorkout & {
  sent?: boolean;
  handedOver?: boolean;          // handed over for saving (never resumed as a visit's counting: it keeps its routine)
  routine?: { routineId?: string; routineName?: string; planItemId?: string };
};
/** A workout kept from a visit this recent (the same day) continues on this screen; older ones are saved apart. */
export const CONTINUE_MS = 30 * 60 * 1000;

const isWorkout = (w: unknown): w is StoredWorkout =>
  !!w && typeof w === 'object' && typeof (w as PoseWorkout).startedAt === 'string' && typeof (w as PoseWorkout).finishedAt === 'string' &&
  Array.isArray((w as PoseWorkout).sets) && (w as PoseWorkout).sets.length > 0;
const dayOf = (iso: string) => new Date(iso).toDateString();

/**
 * What was kept on the device, split into the workouts saved apart (`earlier`, each its own session) and the one
 * this visit continues (left a moment ago, the same day), if any. Accepts the old single-workout format.
 */
export function restoreWorkouts(stored: unknown, now: Date): { earlier: StoredWorkout[]; resume: StoredWorkout | null } {
  const list = (Array.isArray(stored) ? stored : [stored]).filter(isWorkout);
  const last = list.at(-1);
  const resume =
    last && !last.sent && !last.handedOver && now.getTime() - Date.parse(last.finishedAt) < CONTINUE_MS && dayOf(last.finishedAt) === dayOf(now.toISOString())
      ? last
      : null;
  return { earlier: resume ? list.slice(0, -1) : list, resume };
}

/**
 * Whether the server has a kept workout (a save whose answer never came): a session with its start time. Exact, since
 * a workout handed over for saving never grows (`freeze`). `sessions` is GET /sessions: the newest by finish time, at
 * most `limit`. If the list is full and all of it finished after the workout, the answer is not in it: null.
 */
export function serverHas(w: PoseWorkout, sessions: { startedAt: string; finishedAt: string }[], limit = 50): boolean | null {
  const t = Date.parse(w.startedAt);
  if (sessions.some((s) => Date.parse(s.startedAt) === t)) return true;
  const covers = sessions.length < limit || sessions.some((s) => Date.parse(s.finishedAt) <= Date.parse(w.finishedAt));
  return covers ? false : null;
}

// --- one camera workout screen at a time --------------------------------------------------------------------------
/**
 * Tabs share what is kept on the device, so only one camera workout screen works at a time: the one holding the Web
 * Lock `name`, for as long as it is open. A screen opened while another holds it waits (`waiting`) and takes over by
 * itself (`held`) when that one closes. Returns the release (on unmount); a waiting screen then stops queueing.
 * `lost`: the browser took the lock away or dropped the request without being asked (Safari does when the page goes
 * into its back/forward cache); the screen must claim again before it does anything.
 */
export function holdScreen(
  locks: Pick<LockManager, 'request'>,
  name: string,
  on: { held: () => void; waiting: () => void; lost: () => void },
): () => void {
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = new AbortController();
  const hold = async () => {
    on.held();
    await open;
  };
  locks
    .request(name, { ifAvailable: true }, async (lock) => {
      if (lock) return hold();
      on.waiting();
      return locks.request(name, { signal: stop.signal }, hold);
    })
    .catch(() => {
      if (!stop.signal.aborted) on.lost();       // (aborted by the release: the screen closed, nothing to tell)
    });
  return () => {
    stop.abort();
    release();
  };
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
