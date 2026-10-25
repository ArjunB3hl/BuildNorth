import { demoCalendar, type DemoCalendarEntry } from './calendar';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, ThemedText } from '../components/ui';
import { describe, useAccount } from '../lib/account';
import type { Api } from '../lib/api';
import { addDays, localDate } from '../lib/dates';
import { randomUUID } from '../lib/ids';
import { loadState, saveState } from '../lib/persist';
import { Spacing, useTheme } from '../theme';
import {
  loadAccountState,
  loadSlices,
  slicesFor,
  syncAction,
  type Slice,
} from './remote';
import { createSampleData, type SampleData } from './sample';
import type {
  CheckIn,
  CoachMessage,
  Ingredient,
  PlanItem,
  PreferenceSource,
  Progress,
  ProgressWindow,
} from './types';

// One store, two sources. Signed out, it's local demo data saved on this PC (src/lib/persist.ts), as in the
// Mac app. Signed in, the same state comes from the Rhythm API and every action is also sent there
// (src/data/remote.ts); each action maps to one API call, as in the iPhone app, so the screens don't change.

export type State = SampleData & {
  /** Signed in: the server's numbers (GET /progress); the demo computes them from local data. */
  serverProgress?: Progress | null;
};

export type Action =
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
  | {
      type: 'shopping/add';
      recipeId: string;
      ingredients: Ingredient[];
      servings?: number;
    }
  | { type: 'preference/add'; text: string; source: PreferenceSource }
  | { type: 'preference/correct'; id: string; text: string }
  | { type: 'preference/remove'; id: string }
  | { type: 'memory/erase' }
  | { type: 'coach/clear' }
  | { type: 'coach/exchange'; message: string; reply: string }
  | { type: 'coach/append'; messages: CoachMessage[] }
  | { type: 'store/reset' }
  | { type: 'store/replace'; patch: Partial<State> };

// UUIDs rather than a counter: saved items outlive the app process.
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
const now = () => new Date().toISOString();

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'coach/exchange':
      return {
        ...state,
        coach: [
          ...state.coach,
          {
            id: newId('message'),
            role: 'user',
            content: action.message,
            suggestions: [],
          },
          {
            id: newId('message'),
            role: 'assistant',
            content: action.reply,
            suggestions: [],
            context: {
              memory: 'not_configured',
              preferences: state.preferences.length,
              recalled: 0,
              recipes: 0,
              routines: 0,
              planItems: state.plan.length,
            },
          },
        ],
      };
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
    case 'coach/append':
      return { ...state, coach: [...state.coach, ...action.messages] };
    case 'store/reset':
      return createSampleData();
    case 'store/replace':
      return { ...state, ...action.patch };
  }
}

type Store = {
  state: State;
  dispatch: (action: Action) => void;
  /** 'account' while signed in (the Rhythm API), 'demo' otherwise (local sample data). */
  mode: 'demo' | 'account';
  /** Signed in only. */
  api: Api | null;
  /** The last change the server refused or couldn't receive (signed in only). */
  syncError: string | null;
  dismissSyncError: () => void;
};
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { account, api } = useAccount();
  if (account.status === 'loading') {
    return <Splash message="Starting Rhythm…" />;
  }
  if (account.status === 'signed-in' && api) {
    // Keyed by user, so switching accounts never shows the previous account's data.
    return (
      <AccountStore key={account.user.id} api={api}>
        {children}
      </AccountStore>
    );
  }
  return <DemoStore>{children}</DemoStore>;
}

function DemoStore({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const saved = loadState();
    return saved
      ? { ...saved, calendarEntries: saved.calendarEntries ?? demoCalendar() }
      : createSampleData();
  });
  useEffect(() => saveState(state), [state]);
  const value = useMemo<Store>(
    () => ({
      state,
      dispatch,
      mode: 'demo',
      api: null,
      syncError: null,
      dismissSyncError: () => {},
    }),
    [state],
  );
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

function AccountStore({ api, children }: { api: Api; children: ReactNode }) {
  const { signOut } = useAccount();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  // The latest state, for building API calls outside render.
  const latest = useRef<State | null>(null);
  latest.current = state;

  const load = useCallback(() => {
    setLoadError(null);
    loadAccountState(api)
      .then(setState)
      .catch(error => setLoadError(describe(error)));
  }, [api]);
  useEffect(load, [load]);

  const reload = useCallback(
    async (slices: Slice[]) => {
      if (!slices.length) {
        return;
      }
      try {
        const patch = await loadSlices(api, slices);
        setState(prev => (prev ? { ...prev, ...patch } : prev));
      } catch (error) {
        setSyncError(`Couldn’t refresh from Rhythm: ${describe(error)}`);
      }
    },
    [api],
  );

  const dispatch = useCallback(
    (action: Action) => {
      const before = latest.current;
      if (!before || action.type === 'store/reset') {
        return;
      }
      setState(prev => (prev ? reducer(prev, action) : prev));
      syncAction(api, action, before)
        .then(reload)
        .catch(error => {
          setSyncError(describe(error));
          reload(slicesFor(action));
        });
    },
    [api, reload],
  );

  const value = useMemo<Store | null>(
    () =>
      state && {
        state,
        dispatch,
        mode: 'account',
        api,
        syncError,
        dismissSyncError: () => setSyncError(null),
      },
    [state, dispatch, api, syncError],
  );

  if (!value) {
    return loadError ? (
      <Splash message="Couldn’t load your Rhythm account" detail={loadError}>
        <Button title="Try again" onPress={load} />
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </Splash>
    ) : (
      <Splash message="Loading your Rhythm account…" />
    );
  }
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

/** Full-window message while the store isn't ready. */
function Splash({
  message,
  detail,
  children,
}: {
  message: string;
  detail?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: theme.background }]}>
      <ThemedText type="subtitle">{message}</ThemedText>
      {detail ? <Notice tone="error">{detail}</Notice> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
});

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
