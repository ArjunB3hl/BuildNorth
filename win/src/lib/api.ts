import { API_URL } from '../config';
import { createRhythmApi } from './rhythm';
import type {
  CheckIn,
  CoachMessage,
  PlanItem,
  Preference,
  PreferenceSource,
  Profile,
  Progress,
  Recipe,
  Routine,
  ActivitySession,
  SessionEntry,
  ShoppingItem,
} from '../data/types';

// The Rhythm (BuildNorth) API client for Windows, modelled on the phone app's mobile/src/lib/api.ts: the same
// paths and bodies, a Clerk session token as `Authorization: Bearer …`, and one retry with a fresh token after
// a 401 (Clerk session tokens last about a minute). Responses are read into the Windows app's types, which are
// a subset of the phone's (src/data/types.ts); fields the screens don't use are ignored.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout' | 'auth' | 'http',
    readonly status?: number,
  ) {
    super(message);
  }
}

export type TokenSource = (fresh: boolean) => Promise<string | null>;

/** A calendar entry as the backend returns it (GET /calendar). */
export type ApiCalendarEntry = {
  id: string;
  kind: 'meal' | 'activity' | 'sleep';
  title: string;
  occurredAt: string;
  localDate: string;
  localTime: string;
  durationMinutes: number | null;
  notes: string | null;
  source: string;
  editable: boolean;
};

export type ApiCalendarInput = {
  kind: 'meal' | 'activity';
  title: string;
  occurredAt: string;
  durationMinutes: number | null;
  notes: string | null;
};

export type AIAccess = {
  linked: boolean;
  claude: boolean;
  sharedClaude: boolean;
  textChat: boolean;
  /** An ElevenLabs agent is connected and usable (older servers leave it out). */
  elevenlabs?: boolean;
  /** The account's voice Coach, when one is connected (the website makes it the Coach's default). */
  voiceProvider?: 'elevenlabs' | 'parakeet_kokoro' | null;
};

/** POST /sessions: a finished workout. */
export type SessionInput = {
  routineId: string | null;
  routineName: string;
  planItemId: string | null;
  localDate: string;
  startedAt: string;
  finishedAt: string;
  entries: SessionEntry[];
  notes: string | null;
};

const DEFAULT_TIMEOUT_MS = 20_000;
/** Coach replies wait for the model, as on the phone. */
const AI_TIMEOUT_MS = 180_000;

/** The user's IANA time zone, or UTC where Intl can't tell (the backend's default). */
export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function createApi(getToken: TokenSource, baseUrl = API_URL) {
  async function request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    for (const fresh of [false, true]) {
      const token = await getToken(fresh);
      if (!token) {
        throw new ApiError('You’re signed out. Sign in again.', 'auth', 401);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch {
        throw controller.signal.aborted
          ? new ApiError(
              'Rhythm took too long to answer. Try again.',
              'timeout',
            )
          : new ApiError(
              `Can’t reach the Rhythm server at ${baseUrl}.`,
              'network',
            );
      } finally {
        clearTimeout(timer);
      }
      // A 401 usually means the cached token just expired: try once more with a new one.
      if (res.status === 401 && !fresh) {
        continue;
      }
      if (res.status === 204) {
        return undefined as T;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : null;
        throw new ApiError(
          detail ?? `Rhythm answered with an error (${res.status}).`,
          res.status === 401 ? 'auth' : 'http',
          res.status,
        );
      }
      if (data === null) {
        throw new ApiError(
          `Can’t reach the Rhythm server at ${baseUrl}.`,
          'network',
        );
      }
      return data as T;
    }
    throw new ApiError('You’re signed out. Sign in again.', 'auth', 401);
  }

  const q = (params: Record<string, string | number>) =>
    '?' +
    Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');

  return {
    baseUrl,
    me: () => request<{ userId: string }>('GET', '/me'),
    profile: () => request<Profile>('GET', '/profile'),
    /** PUT /profile: the welcome step's details (it counts as done). */
    saveProfile: (profile: Profile) =>
      request<Profile>('PUT', '/profile', {
        ...profile,
        onboardingCompleted: true,
      }),
    preferences: {
      list: () =>
        request<{ preferences: Preference[]; memoryAvailable: boolean }>(
          'GET',
          '/preferences',
        ),
      add: (text: string, source: Exclude<PreferenceSource, 'assistant'>) =>
        request<Preference>('POST', '/preferences', { text, source }),
      correct: (id: string, text: string) =>
        request<Preference>('PATCH', `/preferences/${id}`, { text }),
      remove: (id: string) => request<void>('DELETE', `/preferences/${id}`),
    },
    memory: {
      erase: () => request<{ forgotten: number }>('DELETE', '/memory'),
    },
    recipes: {
      list: () => request<Recipe[]>('GET', '/recipes'),
      addToShopping: (id: string, servings: number) =>
        request<{ items: ShoppingItem[]; added: number; combined: number }>(
          'POST',
          `/recipes/${id}/shopping`,
          { servings },
        ),
    },
    shopping: {
      list: () => request<{ items: ShoppingItem[] }>('GET', '/shopping'),
      setChecked: (id: string, checked: boolean) =>
        request<ShoppingItem>('PATCH', `/shopping/${id}`, { checked }),
      clearChecked: () =>
        request<{ items: ShoppingItem[] }>('DELETE', '/shopping'),
    },
    routines: { list: () => request<Routine[]>('GET', '/routines') },
    sessions: {
      list: () => request<ActivitySession[]>('GET', '/sessions'),
      create: (session: SessionInput) =>
        request<ActivitySession>('POST', '/sessions', session),
    },
    today: (date: string) =>
      request<{ date: string; items: PlanItem[]; checkIn: CheckIn | null }>(
        'GET',
        `/today${q({ date })}`,
      ),
    plan: {
      range: (start: string, days: number) =>
        request<{ items: PlanItem[] }>('GET', `/plan${q({ start, days })}`),
      add: (item: Omit<PlanItem, 'id' | 'status'> & { clientKey: string }) =>
        request<PlanItem>('POST', '/plan', item),
      update: (
        id: string,
        patch: Partial<Pick<PlanItem, 'status' | 'date' | 'timeSlot'>>,
      ) => request<PlanItem>('PATCH', `/plan/${id}`, patch),
      remove: (id: string) => request<void>('DELETE', `/plan/${id}`),
    },
    checkIns: {
      save: (checkIn: CheckIn) => {
        const { date, ...body } = checkIn;
        return request<CheckIn>('PUT', `/checkins/${date}`, body);
      },
    },
    progress: (today: string) =>
      request<Progress>('GET', `/progress${q({ today })}`),
    coach: {
      history: () =>
        request<{ messages: CoachMessage[] }>('GET', '/coach/messages'),
      send: (content: string, localDate: string, clientKey: string) =>
        request<{
          userMessage: CoachMessage;
          reply: CoachMessage;
          memoryAvailable: boolean;
        }>(
          'POST',
          '/coach/messages',
          { content, localDate, clientKey, timezone: timeZone() },
          AI_TIMEOUT_MS,
        ),
      clear: () => request<void>('DELETE', '/coach/messages'),
    },
    calendar: {
      list: (start: string, days: number) =>
        request<ApiCalendarEntry[]>(
          'GET',
          `/calendar${q({ start, days, timezone: timeZone() })}`,
        ),
      create: (entry: ApiCalendarInput, clientKey: string) =>
        request<ApiCalendarEntry>('POST', '/calendar', {
          ...entry,
          clientKey,
        }),
      update: (id: string, entry: ApiCalendarInput) =>
        request<ApiCalendarEntry>('PUT', `/calendar/${id}`, entry),
      remove: (id: string) => request<void>('DELETE', `/calendar/${id}`),
    },
    access: () => request<AIAccess>('GET', '/connections/access'),
    /** Content library and personalisation (src/lib/rhythm.ts). */
    rhythm: createRhythmApi(request),
    /** A short-lived ElevenLabs conversation address for the account's own agent (camera workout). */
    elevenLabsSession: () =>
      request<{ signedUrl: string }>('POST', '/connections/elevenlabs/session'),
  };
}

export type Api = ReturnType<typeof createApi>;
