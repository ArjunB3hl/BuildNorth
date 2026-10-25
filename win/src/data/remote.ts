import type { Api, ApiCalendarEntry } from '../lib/api';
import { addDays, localDate, weekStart } from '../lib/dates';
import { randomUUID } from '../lib/ids';
import type { DemoCalendarEntry } from './calendar';
import type { Action, State } from './store';
import type { PlanItem } from './types';

// The account side of the store: which API calls fill each part of the state, and which call each action
// makes. Signed in, the store applies an action locally first (so the screen responds at once), sends it with
// syncAction, then reloads the parts it touched from the server, so server ids and server-side rules
// (scaling, merging, done items reaching the Calendar) win. A failed call reloads those parts too, which
// undoes the local change.

export type Slice =
  | 'profile'
  | 'preferences'
  | 'recipes'
  | 'routines'
  | 'sessions'
  | 'plan'
  | 'today'
  | 'shopping'
  | 'coach'
  | 'calendar'
  | 'progress';

export const ALL_SLICES: Slice[] = [
  'profile',
  'preferences',
  'recipes',
  'routines',
  'sessions',
  'plan',
  'today',
  'shopping',
  'coach',
  'calendar',
  'progress',
];

/** Plan items from four weeks back to about five weeks ahead (the API serves at most 31 days per call). */
async function loadPlan(api: Api, today: string): Promise<PlanItem[]> {
  const start = addDays(weekStart(today), -28);
  const [first, second] = await Promise.all([
    api.plan.range(start, 31),
    api.plan.range(addDays(start, 31), 31),
  ]);
  return [...first.items, ...second.items];
}

/** The Calendar shows months, so load the previous month and this one (the API serves up to 62 days). */
function calendarStart(today: string): string {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  return `${addDays(firstOfMonth, -1).slice(0, 7)}-01`;
}

export function fromApiCalendar(entry: ApiCalendarEntry): DemoCalendarEntry {
  return {
    id: entry.id,
    kind: entry.kind === 'meal' ? 'meal' : 'activity',
    title: entry.title,
    date: entry.localDate,
    time: entry.localTime.slice(0, 5),
    minutes: entry.durationMinutes,
    readOnly: !entry.editable,
  };
}

async function loadSlice(
  api: Api,
  slice: Slice,
  today: string,
): Promise<Partial<State>> {
  switch (slice) {
    case 'profile':
      return { profile: await api.profile() };
    case 'preferences':
      return { preferences: (await api.preferences.list()).preferences };
    case 'recipes':
      return { recipes: await api.recipes.list() };
    case 'routines':
      return { routines: await api.routines.list() };
    case 'sessions':
      return { sessions: await api.sessions.list() };
    case 'plan':
      return { plan: await loadPlan(api, today) };
    case 'today': {
      // There's no check-in list endpoint; the Today screen only needs today's.
      const day = await api.today(today);
      return { checkIns: day.checkIn ? [day.checkIn] : [] };
    }
    case 'shopping':
      return { shopping: (await api.shopping.list()).items };
    case 'coach':
      return { coach: (await api.coach.history()).messages };
    case 'calendar': {
      const entries = await api.calendar.list(calendarStart(today), 62);
      return {
        calendarEntries: entries
          .filter(e => e.kind !== 'sleep')
          .map(fromApiCalendar),
      };
    }
    case 'progress':
      return { serverProgress: await api.progress(today) };
  }
}

export async function loadSlices(
  api: Api,
  slices: Slice[],
  today = localDate(),
): Promise<Partial<State>> {
  const parts = await Promise.all(slices.map(s => loadSlice(api, s, today)));
  return Object.assign({}, ...parts);
}

/** Everything the screens show, for a fresh sign-in. */
export async function loadAccountState(api: Api): Promise<State> {
  const loaded = await loadSlices(api, ALL_SLICES);
  return {
    calendarEntries: [],
    profile: {
      preferredName: null,
      goals: [],
      dietaryPreferences: [],
      equipment: [],
      experienceLevel: null,
      routineTimes: [],
    },
    preferences: [],
    recipes: [],
    shopping: [],
    routines: [],
    sessions: [],
    plan: [],
    checkIns: [],
    coach: [],
    serverProgress: null,
    ...loaded,
  };
}

/** `YYYY-MM-DD` + `HH:mm` on this PC's clock, as an ISO instant (what POST /calendar needs). */
function localInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Sends one action to the API. Returns the parts of the state to reload afterwards; an error means nothing
 * was saved (the caller reloads the same parts to undo the local change).
 */
export async function syncAction(
  api: Api,
  action: Action,
  before: State,
): Promise<Slice[]> {
  switch (action.type) {
    case 'plan/update':
      await api.plan.update(action.id, action.patch);
      // Done meals and reschedules show up in the Calendar and the progress numbers.
      return ['plan', 'today', 'progress', 'calendar'];
    case 'plan/add':
      await api.plan.add({ ...action.item, clientKey: `w:${randomUUID()}` });
      return ['plan'];
    case 'plan/remove':
      await api.plan.remove(action.id);
      return ['plan', 'progress'];
    case 'checkin/save':
      await api.checkIns.save(action.checkIn);
      return ['today', 'progress'];
    case 'shopping/toggle': {
      const item = before.shopping.find(i => i.id === action.id);
      await api.shopping.setChecked(action.id, !item?.checked);
      return ['shopping'];
    }
    case 'shopping/clearChecked':
      await api.shopping.clearChecked();
      return ['shopping'];
    case 'shopping/add': {
      // The server scales the recipe and merges compatible units itself, so send servings, not quantities.
      const recipe = before.recipes.find(r => r.id === action.recipeId);
      await api.recipes.addToShopping(
        action.recipeId,
        action.servings ?? recipe?.servings ?? 1,
      );
      return ['shopping'];
    }
    case 'preference/add':
      await api.preferences.add(
        action.text,
        action.source === 'assistant' ? 'app' : action.source,
      );
      return ['preferences'];
    case 'preference/correct':
      await api.preferences.correct(action.id, action.text);
      return ['preferences'];
    case 'preference/remove':
      await api.preferences.remove(action.id);
      return ['preferences'];
    case 'memory/erase':
      await api.memory.erase();
      return ['preferences'];
    case 'coach/clear':
      await api.coach.clear();
      return ['coach'];
    case 'calendar/save': {
      const { entry } = action;
      const input = {
        kind: entry.kind,
        title: entry.title,
        occurredAt: localInstant(entry.date, entry.time),
        durationMinutes: entry.minutes,
        notes: null,
      };
      if (before.calendarEntries.some(e => e.id === entry.id)) {
        await api.calendar.update(entry.id, input);
      } else {
        // The new entry's local id doubles as the idempotency key, so a retry can't add it twice.
        await api.calendar.create(input, entry.id.slice(0, 80));
      }
      return ['calendar'];
    }
    case 'calendar/remove':
      await api.calendar.remove(action.id);
      return ['calendar'];
    // Local only: coach replies come from the API already (coach/append), and a signed-in account has no
    // sample data to reset.
    case 'coach/exchange':
    case 'coach/append':
    case 'store/reset':
    case 'store/replace':
      return [];
  }
}

/** The parts an action touches, reloaded to undo it when its API call fails. */
export function slicesFor(action: Action): Slice[] {
  switch (action.type) {
    case 'plan/update':
    case 'plan/add':
    case 'plan/remove':
      return ['plan'];
    case 'checkin/save':
      return ['today'];
    case 'shopping/toggle':
    case 'shopping/clearChecked':
    case 'shopping/add':
      return ['shopping'];
    case 'preference/add':
    case 'preference/correct':
    case 'preference/remove':
    case 'memory/erase':
      return ['preferences'];
    case 'coach/clear':
      return ['coach'];
    case 'calendar/save':
    case 'calendar/remove':
      return ['calendar'];
    default:
      return [];
  }
}
