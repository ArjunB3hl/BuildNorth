import { demoCalendar, type DemoCalendarEntry } from './calendar';
import { randomUUID } from 'expo-crypto';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import { addDays, localDate } from '../lib/dates';
import { loadState, saveState } from '../lib/persist';
import { createSampleData, type SampleData } from './sample';
import type {
  CheckIn,
  Ingredient,
  PlanItem,
  PreferenceSource,
  Progress,
  ProgressWindow,
} from './types';

// Local store standing in for the BuildNorth API, saved on this Mac (src/lib/persist.ts).
// Every change here maps to one API call in the iPhone app, so swapping this for real
// requests later keeps the screens as is.

type State = SampleData;

type Action =
  | { type: 'calendar/save'; entry: DemoCalendarEntry }
  | { type: 'calendar/remove'; id: string }
  | {
      type: 'plan/update';
      id: string;
      patch: Partial<Pick<PlanItem, 'status' | 'date'>>;
    }
  | { type: 'plan/add'; item: Omit<PlanItem, 'id' | 'status'> }
  | { type: 'plan/remove'; id: string }
  | { type: 'checkin/save'; checkIn: CheckIn }
  | { type: 'shopping/toggle'; id: string }
  | { type: 'shopping/clearChecked' }
  | { type: 'shopping/add'; recipeId: string; ingredients: Ingredient[] }
  | { type: 'preference/add'; text: string; source: PreferenceSource }
  | { type: 'preference/correct'; id: string; text: string }
  | { type: 'preference/remove'; id: string }
  | { type: 'memory/erase' }
  | { type: 'coach/clear' }
  | { type: 'coach/exchange'; message: string; reply: string }
  | { type: 'store/reset' };

// UUIDs rather than a counter: saved items outlive the app process.
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
const now = () => new Date().toISOString();

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'coach/exchange':
      return { ...state, coach: [...state.coach,
        { id: newId('message'), role: 'user', content: action.message, suggestions: [] },
        { id: newId('message'), role: 'assistant', content: action.reply, suggestions: [],
          context: { memory: 'not_configured', preferences: state.preferences.length, recalled: 0,
            recipes: 0, routines: 0, planItems: state.plan.length } },
      ] };
    case 'calendar/save':
      return {
        ...state,
        calendarEntries: [
          ...state.calendarEntries.filter(e => e.id !== action.entry.id),
          action.entry,
        ],
      };
    case 'calendar/remove':
      return {
        ...state,
        calendarEntries: state.calendarEntries.filter(e => e.id !== action.id),
      };
    case 'plan/update': {
      let calendarEntries = state.calendarEntries;
      const item = state.plan.find(i => i.id === action.id);
      if (item && action.patch.status) {
        const id = `plan-${item.id}`;
        if (
          action.patch.status === 'done' &&
          !calendarEntries.some(e => e.id === id)
        ) {
          const at = new Date();
          calendarEntries = [
            ...calendarEntries,
            {
              id,
              kind: item.kind,
              title: item.title,
              date: localDate(at),
              time: `${String(at.getHours()).padStart(2, '0')}:${String(
                at.getMinutes(),
              ).padStart(2, '0')}`,
              minutes: item.minutes,
            },
          ];
        } else if (action.patch.status !== 'done') {
          calendarEntries = calendarEntries.filter(e => e.id !== id);
        }
      }
      return {
        ...state,
        calendarEntries,
        plan: state.plan.map(i =>
          i.id === action.id ? { ...i, ...action.patch } : i,
        ),
      };
    }
    case 'plan/add':
      return {
        ...state,
        plan: [
          ...state.plan,
          { ...action.item, id: newId('p'), status: 'planned' },
        ],
      };
    case 'plan/remove':
      return { ...state, plan: state.plan.filter(i => i.id !== action.id) };
    case 'checkin/save':
      return {
        ...state,
        checkIns: [
          ...state.checkIns.filter(c => c.date !== action.checkIn.date),
          action.checkIn,
        ],
      };
    case 'shopping/toggle':
      return {
        ...state,
        shopping: state.shopping.map(i =>
          i.id === action.id ? { ...i, checked: !i.checked } : i,
        ),
      };
    case 'shopping/clearChecked':
      return { ...state, shopping: state.shopping.filter(i => !i.checked) };
    case 'shopping/add': {
      // Same rule as the backend: only combine an unchecked item with the same name and unit.
      const shopping = [...state.shopping];
      for (const ing of action.ingredients) {
        const match = shopping.findIndex(
          i =>
            !i.checked &&
            i.name.toLowerCase() === ing.name.toLowerCase() &&
            i.unit === ing.unit,
        );
        if (
          match >= 0 &&
          shopping[match].quantity != null &&
          ing.quantity != null
        ) {
          shopping[match] = {
            ...shopping[match],
            quantity: shopping[match].quantity! + ing.quantity,
          };
        } else {
          shopping.push({
            id: newId('sh'),
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            checked: false,
            recipeId: action.recipeId,
          });
        }
      }
      return { ...state, shopping };
    }
    case 'preference/add':
      return {
        ...state,
        preferences: [
          ...state.preferences,
          {
            id: newId('pref'),
            text: action.text,
            memoryStatus: 'pending',
            source: action.source,
            updatedAt: now(),
          },
        ],
      };
    case 'preference/correct':
      return {
        ...state,
        preferences: state.preferences.map(p =>
          p.id === action.id
            ? { ...p, text: action.text, source: 'app', updatedAt: now() }
            : p,
        ),
      };
    case 'preference/remove':
      return {
        ...state,
        preferences: state.preferences.filter(p => p.id !== action.id),
      };
    case 'memory/erase':
      return { ...state, preferences: [] };
    case 'coach/clear':
      return { ...state, coach: [] };
    case 'store/reset':
      return createSampleData();
  }
}

type Store = { state: State; dispatch: (action: Action) => void };
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const saved = loadState();
    return saved
      ? { ...saved, calendarEntries: saved.calendarEntries ?? demoCalendar() }
      : createSampleData();
  });
  useEffect(() => saveState(state), [state]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used inside StoreProvider');
  }
  return store;
}

// --- derived data -------------------------------------------------------------------------

function windowStats(state: State, from: string, to: string): ProgressWindow {
  const inRange = (d: string) => d >= from && d <= to;
  const sessions = state.sessions.filter(s => inRange(s.localDate));
  const checkIns = state.checkIns.filter(c => inRange(c.date));
  const avg = (values: number[]) =>
    values.length
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
        10
      : null;
  const sleep = checkIns
    .map(c => c.sleepHours)
    .filter((h): h is number => h != null);
  return {
    sessionsCompleted: sessions.length,
    activeMinutes: Math.round(
      sessions.reduce((a, s) => a + s.durationSeconds, 0) / 60,
    ),
    planDone: state.plan.filter(i => inRange(i.date) && i.status === 'done')
      .length,
    checkIns: checkIns.length,
    averageEnergy: avg(checkIns.map(c => c.energy)),
    averageMood: avg(checkIns.map(c => c.mood)),
    averageSleepHours: avg(sleep),
  };
}

/** Same windows as the backend's /progress: the last 7 and 30 days including today. */
export function computeProgress(state: State, today: string): Progress {
  const activeOn = (d: string) =>
    state.sessions.some(s => s.localDate === d) ||
    state.checkIns.some(c => c.date === d) ||
    state.plan.some(i => i.date === d && i.status === 'done');
  // A streak counts back from today, or from yesterday if today has nothing yet.
  let streakDays = 0;
  let cursor = activeOn(today) ? today : addDays(today, -1);
  while (activeOn(cursor)) {
    streakDays++;
    cursor = addDays(cursor, -1);
  }
  return {
    week: windowStats(state, addDays(today, -6), today),
    month: windowStats(state, addDays(today, -29), today),
    streakDays,
    last7: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i - 6);
      const seconds = state.sessions
        .filter(s => s.localDate === date)
        .reduce((a, s) => a + s.durationSeconds, 0);
      return { date, activeMinutes: Math.round(seconds / 60) };
    }),
  };
}

export function formatQuantity(
  quantity: number | null,
  unit: string | null,
): string {
  if (quantity == null) {
    return unit ?? '';
  }
  const rounded = Math.round(quantity * 100) / 100;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}
