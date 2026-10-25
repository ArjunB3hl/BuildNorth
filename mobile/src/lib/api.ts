import Constants from 'expo-constants';
import { createRhythmApi } from '@/lib/rhythm';

import type {
  MonthlyReport, AIAccess, ElevenLabsConnection,
  CalendarEntry,
  CalendarInput,
  AcceptResult,
  AssistantProposal,
  ConnectionsInfo,
  ClaudeConnection,
  ConnectionToken,
  ActivitySession,
  ChangePreview,
  ChangeRequest,
  CheckIn,
  CheckInPatch,
  CoachMessage,
  CreatedWatchToken,
  DeleteDataResult,
  HealthDay,
  HealthDayInput,
  MemoryHit,
  PlanChange,
  PlanItem,
  PlanItemInput,
  PlannerRequest,
  Preference,
  Profile,
  Progress,
  Proposal,
  ProposalItem,
  Recipe,
  RecipeDraft,
  RecipeInput,
  Routine,
  RoutineInput,
  ServiceStatus,
  SessionInput,
  ShoppingItem,
  Today,
  WatchSettings,
  WatchToday,
  WatchToken,
  WeeklyReview,
} from '@/lib/types';

/**
 * Base URL of the Rhythm backend. EXPO_PUBLIC_API_URL wins; otherwise, in
 * development, use the machine serving the JS bundle so Expo Go on a phone on
 * the same Wi-Fi reaches the backend without extra configuration.
 */
export const API_URL = resolveApiUrl();

function resolveApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost || 'localhost'}:8000`;
}

const DEFAULT_TIMEOUT_MS = 20_000;
// Model calls run on the server and can take a minute on a local model.
export const AI_TIMEOUT_MS = 180_000;

export type ApiErrorKind = 'network' | 'timeout' | 'cancelled' | 'http';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
    /** Server detail; shown only in development builds. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

function friendlyHttpMessage(status: number, detail: string | undefined, path: string): string {
  if (path.startsWith('/connections/') && detail && [400, 422, 429, 502, 503].includes(status)) return detail;
  const isAi = path.startsWith('/coach') || path.endsWith('/extract');
  // Planner errors carry a specific, user-facing explanation (what still works without AI, stale plans…).
  const isPlanner = path.startsWith('/planner') || path.startsWith('/plan/changes');
  if (isPlanner && detail && !detail.startsWith('[') && [409, 422, 502, 503, 504].includes(status)) return detail;
  // e.g. "You can link up to 5 watches."
  if (path.startsWith('/watch') && status === 409 && detail) return detail;
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 404) return "That item couldn't be found. It may have been deleted.";
  if (status === 422) return detail && !detail.startsWith('[') ? detail : 'Some details need fixing. Check the form and try again.';
  if (status === 429) return isAi ? 'The coach is busy right now. Try again in a moment.' : 'Too many requests. Try again shortly.';
  if (status === 504) return isAi ? 'The coach took too long to answer. Try again, or ask something shorter.' : 'The server took too long to respond.';
  if (status === 503 && isAi) return 'The coach is unavailable right now. Everything else keeps working.';
  if (status === 503 && path.startsWith('/memory')) return 'Memory is temporarily unavailable. Your saved data is safe.';
  if (status === 502 && isAi) return "The coach's answer couldn't be read. Try again.";
  return 'Something went wrong on our side. Please try again.';
}

type RequestOptions = { body?: unknown; timeoutMs?: number; signal?: AbortSignal; auth?: boolean };

/** Once the caller has given up, nothing more is sent: an abort listener added after the abort never fires. */
function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ApiError('Cancelled.', 'cancelled');
}

/** Returns the Clerk session token; `fresh` bypasses Clerk's token cache. */
export type TokenGetter = (fresh?: boolean) => Promise<string | null>;

export function createApi(getToken: TokenGetter) {
  async function request<T>(method: string, path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
    const { body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, auth = true } = options;
    throwIfCancelled(signal);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      // The backend derives the user from this Clerk session token; the app never sends a user ID.
      const token = await getToken(isRetry);
      if (!token) throw new ApiError('Your session has expired. Please sign in again.', 'http', 401);
      headers.Authorization = `Bearer ${token}`;
      // Fetching the token can take a while; the caller may have aborted meanwhile.
      throwIfCancelled(signal);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        ...(path.startsWith('/connections/') ? { redirect: 'error' as const } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) throw new ApiError('Cancelled.', 'cancelled');
      if (timedOut) throw new ApiError('This is taking longer than expected. Please try again.', 'timeout');
      if (__DEV__) console.warn(`[api] ${method} ${path}: can't reach ${API_URL}`);
      throw new ApiError("Can't connect right now. Check your connection and try again.", 'network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    // Session tokens are short-lived; a cached one can expire in transit on a slow device or network.
    // Retry once with a freshly minted token before treating the session as signed out.
    if (response.status === 401 && auth && !isRetry) {
      throwIfCancelled(signal);
      return request<T>(method, path, options, true);
    }
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch(() => null);
    if (!response.ok && data === null) {
      // The backend always answers errors with JSON. Anything else came from something in between,
      // e.g. a tunnel whose endpoint is offline (ngrok answers 404 with an HTML page) or a captive portal.
      if (__DEV__) console.warn(`[api] ${method} ${path} -> ${response.status} from outside the backend (${response.headers.get('ngrok-error-code') ?? 'non-JSON'})`);
      throw new ApiError("Can't reach the Rhythm server right now. Check your connection and try again.", 'network', response.status);
    }
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : undefined;
      if (__DEV__ && detail) console.warn(`[api] ${method} ${path} -> ${response.status}: ${detail}`);
      throw new ApiError(friendlyHttpMessage(response.status, detail, path), 'http', response.status, detail);
    }
    return data as T;
  }

  const get = <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options);
  const send = <T>(method: string, path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(method, path, { ...options, body });
  const q = (params: Record<string, string | number | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
  };

  return {
    rhythm: createRhythmApi((method, path, body) => request(method, path, {
      body, timeoutMs: path.startsWith('/rhythm/saved/') && path.endsWith('/summary') ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    })),
    status: () => get<ServiceStatus>('/status', { auth: false }),

    profile: {
      get: () => get<Profile>('/profile'),
      save: (profile: Omit<Profile, 'onboardingCompleted'> & { onboardingCompleted?: boolean }) =>
        send<Profile>('PUT', '/profile', profile),
    },

    preferences: {
      list: () => get<{ preferences: Preference[]; memoryAvailable: boolean }>('/preferences'),
      add: (text: string, source: 'app' | 'coach' | 'planner' = 'app') => send<Preference>('POST', '/preferences', { text, source }),
      correct: (id: string, text: string) => send<Preference>('PATCH', `/preferences/${id}`, { text }),
      remove: (id: string) => send<void>('DELETE', `/preferences/${id}`),
    },

    memory: {
      search: (query: string) => get<{ hits: MemoryHit[] }>(`/memory/search${q({ q: query })}`),
      erase: () => send<{ forgotten: number }>('DELETE', '/memory'),
    },

    recipes: {
      list: (search?: string) => get<Recipe[]>(`/recipes${q({ q: search })}`),
      get: (id: string) => get<Recipe>(`/recipes/${id}`),
      create: (recipe: RecipeInput) => send<Recipe>('POST', '/recipes', recipe),
      update: (id: string, recipe: RecipeInput) => send<Recipe>('PUT', `/recipes/${id}`, recipe),
      remove: (id: string) => send<void>('DELETE', `/recipes/${id}`),
      extract: (text: string, signal?: AbortSignal) =>
        send<{ draft: RecipeDraft; warnings: string[] }>('POST', '/recipes/extract', { text }, { timeoutMs: AI_TIMEOUT_MS, signal }),
      addToShopping: (id: string, servings?: number) =>
        send<{ items: ShoppingItem[]; added: number; combined: number }>('POST', `/recipes/${id}/shopping`, { servings }),
    },

    shopping: {
      list: () => get<{ items: ShoppingItem[] }>('/shopping'),
      add: (item: { name: string; quantity?: number | null; unit?: string | null }) =>
        send<{ items: ShoppingItem[] }>('POST', '/shopping', item),
      update: (id: string, patch: Partial<Pick<ShoppingItem, 'name' | 'quantity' | 'unit' | 'checked'>> & { clearQuantity?: boolean }) =>
        send<ShoppingItem>('PATCH', `/shopping/${id}`, patch),
      remove: (id: string) => send<void>('DELETE', `/shopping/${id}`),
      clearChecked: () => send<{ items: ShoppingItem[] }>('DELETE', '/shopping'),
    },

    routines: {
      list: () => get<Routine[]>('/routines'),
      get: (id: string) => get<Routine>(`/routines/${id}`),
      create: (routine: RoutineInput) => send<Routine>('POST', '/routines', routine),
      update: (id: string, routine: RoutineInput) => send<Routine>('PUT', `/routines/${id}`, routine),
      remove: (id: string) => send<void>('DELETE', `/routines/${id}`),
      extract: (text: string, signal?: AbortSignal) =>
        send<{ draft: RoutineInput; warnings: string[] }>('POST', '/routines/extract', { text }, { timeoutMs: AI_TIMEOUT_MS, signal }),
    },

    calendar: {
      report: (month: string, timezone: string) => get<MonthlyReport>(`/calendar/report${q({ month, timezone })}`),
      list: (start: string, days: number, timezone: string) => get<CalendarEntry[]>(`/calendar${q({ start, days, timezone })}`),
      create: (body: CalendarInput & { clientKey: string }) => send<CalendarEntry>('POST', '/calendar', body),
      update: (id: string, body: CalendarInput) => send<CalendarEntry>('PUT', `/calendar/${id}`, body),
      remove: (id: string) => send<void>('DELETE', `/calendar/${id}`),
      demo: (date: string, timezone: string) => send<{ entries: number }>('POST', '/calendar/demo', { date, timezone }),
      clearDemo: () => send<void>('DELETE', '/calendar/demo/all'),
    },

    sessions: {
      list: () => get<ActivitySession[]>('/sessions'),
      get: (id: string) => get<ActivitySession>(`/sessions/${id}`),
      create: (session: SessionInput) => send<ActivitySession>('POST', '/sessions', session),
    },

    today: (date: string) => get<Today>(`/today${q({ date })}`),
    plan: {
      range: (start: string, days = 7) => get<{ start: string; days: number; items: PlanItem[] }>(`/plan${q({ start, days })}`),
      add: (item: PlanItemInput) => send<PlanItem>('POST', '/plan', item),
      update: (id: string, patch: Partial<Pick<PlanItem, 'status' | 'date' | 'timeSlot'>>) =>
        send<PlanItem>('PATCH', `/plan/${id}`, patch),
      remove: (id: string) => send<void>('DELETE', `/plan/${id}`),
    },
    planner: {
      /** Drafts a week; nothing is saved. */
      propose: (body: PlannerRequest, signal?: AbortSignal) =>
        send<Proposal>('POST', '/planner/proposals', body, { timeoutMs: AI_TIMEOUT_MS, signal }),
      /** Saves accepted items in one transaction; repeating the same proposal/item keys never duplicates. */
      accept: (proposalId: string, items: Omit<ProposalItem, 'reasons' | 'warnings'>[]) =>
        send<AcceptResult>('POST', '/planner/accept', { proposalId, items }),
      /** Turns a request into exact proposed changes; nothing is saved. */
      previewChanges: (body: ChangeRequest, signal?: AbortSignal) =>
        send<ChangePreview>('POST', '/planner/changes', body, { timeoutMs: AI_TIMEOUT_MS, signal }),
      /** Applies confirmed changes all-or-nothing; a retry with the same change set is a no-op. */
      applyChanges: (changeSetId: string, changes: Pick<PlanChange, 'op' | 'targetKey' | 'after'>[]) =>
        send<{ alreadyApplied: boolean; items: PlanItem[] }>('POST', '/plan/changes', { changeSetId, changes }),
      review: (end: string) => get<WeeklyReview>(`/review/week${q({ end })}`),
    },
    connections: {
      access: () => get<AIAccess>('/connections/access'),
      elevenlabs: () => get<ElevenLabsConnection>('/connections/elevenlabs'),
      connectElevenLabs: (apiKey: string, agentId: string) => send<ElevenLabsConnection>('PUT', '/connections/elevenlabs', { apiKey, agentId }),
      disconnectElevenLabs: () => send<void>('DELETE', '/connections/elevenlabs'),
      elevenLabsSession: () => send<{ signedUrl: string }>('POST', '/connections/elevenlabs/session'),
      claude: () => get<ClaudeConnection>('/connections/claude'),
      connectClaude: (apiKey: string, model: string) => send<ClaudeConnection>('PUT', '/connections/claude', { apiKey, model }),
      disconnectClaude: () => send<void>('DELETE', '/connections/claude'),
      info: () => get<ConnectionsInfo>('/connections'),
      createToken: (label: string) => send<ConnectionToken & { token: string }>('POST', '/connections/tokens', { label }),
      revokeToken: (id: string) => send<void>('DELETE', `/connections/tokens/${id}`),
    },
    watch: {
      tokens: () => get<{ tokens: WatchToken[] }>('/watch/tokens'),
      /**
       * Returns the plaintext token once. Pass it straight to the watch; never cache or store it. Minting revokes
       * the user's other active links with the same `label`, so use a fresh one per link (see watch-link.ts).
       */
      createToken: (label: string) => send<CreatedWatchToken>('POST', '/watch/tokens', { label }),
      revokeToken: (id: string) => send<void>('DELETE', `/watch/tokens/${id}`),
      /** Revokes every active watch token (unlink, sign-out). */
      revokeAll: (signal?: AbortSignal) => send<void>('DELETE', '/watch/tokens', undefined, { signal }),
      settings: () => get<WatchSettings>('/watch/settings'),
      saveSettings: (settings: WatchSettings) => send<WatchSettings>('PUT', '/watch/settings', settings),
      today: (date: string) => get<WatchToday>(`/watch/today${q({ date })}`),
      updatePlan: (id: string, status: PlanItem['status']) => send<PlanItem>('PATCH', `/watch/plan/${id}`, { status }),
      checkIn: (date: string, patch: CheckInPatch) => send<CheckIn>('PATCH', `/watch/checkins/${date}`, patch),
      saveHealth: (date: string, day: HealthDayInput) => send<HealthDay>('PUT', `/watch/health/${date}`, day),
      /** Days with a summary, oldest first, in the `days` days ending on `end`. */
      health: (end: string, days = 7) => get<{ days: HealthDay[] }>(`/watch/health${q({ end, days })}`),
    },
    assistant: {
      pending: () => get<{ proposals: AssistantProposal[] }>('/assistant/proposals/pending'),
      recent: () => get<{ proposals: AssistantProposal[] }>('/assistant/proposals'),
      /** The user's explicit approval of the exact changes shown; applies them at most once. */
      approve: (id: string) => send<AssistantProposal>('POST', `/assistant/proposals/${id}/approve`),
      reject: (id: string) => send<AssistantProposal>('POST', `/assistant/proposals/${id}/reject`),
    },
    checkins: {
      save: (date: string, checkIn: Omit<CheckIn, 'date'>) => send<CheckIn>('PUT', `/checkins/${date}`, checkIn),
    },
    progress: (today: string) => get<Progress>(`/progress${q({ today })}`),

    coach: {
      history: () => get<{ messages: CoachMessage[] }>('/coach/messages'),
      send: (content: string, localDate: string, signal?: AbortSignal, clientKey?: string) =>
        send<{ userMessage: CoachMessage; reply: CoachMessage; memoryAvailable: boolean }>(
          'POST',
          '/coach/messages',
          { content, localDate, clientKey, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
          { timeoutMs: AI_TIMEOUT_MS, signal },
        ),
      clear: () => send<void>('DELETE', '/coach/messages'),
    },

    account: {
      deleteData: () => send<DeleteDataResult>('DELETE', '/account/data'),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
