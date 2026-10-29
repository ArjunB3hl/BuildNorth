/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, {
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';

import App from '../src/App';
import { addDays, localDate } from '../src/lib/dates';

// Signed in, the same screens run on the Rhythm API. This walks the account mode against a small in-memory
// stand-in for the backend: data loads from it, a change is sent to it, a refused change is undone on screen
// with a message, and the Coach replies through it. (A development token stands in for the Clerk sign-in,
// which clerk.test.ts covers.)

jest.mock('../src/config', () => ({
  API_URL: 'http://api.test',
  CLERK_PUBLISHABLE_KEY: '',
  WEB_URL: 'https://web.test',
  DEV_SESSION_TOKEN: 'test-session-token',
  LOCAL_BACKEND: false,
  BACKEND_LABEL: 'Rhythm (api.test)',
}));

const today = localDate();
const windowStats = {
  days: 7,
  sessionsCompleted: 0,
  activeMinutes: 0,
  planDone: 0,
  planSkipped: 0,
  checkIns: 0,
  averageEnergy: null,
  averageMood: null,
  averageSleepHours: null,
};

const curry = {
  id: 'r1',
  title: 'Server curry',
  servings: 4,
  description: null,
  ingredients: [
    { name: 'chickpeas', quantity: 800, unit: 'g' },
    { name: 'spinach', quantity: 200, unit: 'g' },
  ],
  steps: [{ text: 'Simmer.', timerSeconds: null }],
  tags: [],
};

type Request = { method: string; path: string; body: any };
let requests: Request[];
let failPlanChanges: boolean;
let plan: Record<string, unknown>[];

function planItem(id: string, title: string, kind: 'meal' | 'activity') {
  return {
    id,
    date: today,
    kind,
    title,
    timeSlot: kind === 'meal' ? 'morning' : 'evening',
    recipeId: null,
    routineId: null,
    status: 'planned',
    completedAt: null,
    minutes: kind === 'activity' ? 20 : null,
    note: null,
    source: 'manual',
  };
}

function route(method: string, url: URL, body: any): [number, unknown] {
  const path = url.pathname;
  if (method === 'GET') {
    switch (path) {
      case '/me':
        return [200, { userId: 'user_test' }];
      case '/profile':
        return [
          200,
          {
            preferredName: 'Sam',
            goals: ['Move more'],
            dietaryPreferences: [],
            equipment: [],
            experienceLevel: null,
            routineTimes: [],
            onboardingCompleted: true,
          },
        ];
      case '/preferences':
        return [200, { preferences: [], memoryAvailable: false }];
      case '/recipes':
        return [200, [curry]];
      case '/routines':
      case '/sessions':
        return [200, []];
      case '/plan': {
        const start = url.searchParams.get('start')!;
        const end = addDays(start, Number(url.searchParams.get('days')) - 1);
        return [
          200,
          {
            start,
            items: plan.filter(
              i => (i.date as string) >= start && (i.date as string) <= end,
            ),
          },
        ];
      }
      case '/today':
        return [200, { date: today, items: plan, checkIn: null }];
      case '/shopping':
        return [200, { items: [] }];
      case '/coach/messages':
        return [200, { messages: [] }];
      case '/calendar':
        return [200, []];
      case '/progress':
        return [
          200,
          {
            today,
            week: windowStats,
            month: { ...windowStats, days: 30 },
            streakDays: 3,
            last7: [],
          },
        ];
      case '/connections/access':
        return [
          200,
          { linked: true, claude: false, sharedClaude: true, textChat: true },
        ];
    }
  }
  if (method === 'PATCH' && path.startsWith('/plan/')) {
    if (failPlanChanges) {
      return [503, { detail: 'Rhythm is busy. Try again shortly.' }];
    }
    const item = plan.find(i => i.id === path.split('/')[2]);
    Object.assign(item!, body);
    return [200, item];
  }
  if (method === 'POST' && path === `/recipes/${curry.id}/shopping`) {
    return [200, { items: [], added: 2, combined: 0 }];
  }
  if (method === 'POST' && path === '/calendar') {
    return [
      201,
      {
        id: 'c1',
        kind: body.kind,
        title: body.title,
        occurredAt: body.occurredAt,
        localDate: today,
        localTime: '12:30',
        durationMinutes: null,
        notes: null,
        source: 'manual',
        editable: true,
      },
    ];
  }
  if (method === 'POST' && path === '/coach/messages') {
    const message = (role: string, content: string) => ({
      id: `${role}-1`,
      role,
      content,
      suggestions: [],
      context: null,
      createdAt: new Date().toISOString(),
    });
    return [
      200,
      {
        userMessage: message('user', body.content),
        reply: message('assistant', 'Try the server oats with berries.'),
        memoryAvailable: false,
      },
    ];
  }
  return [404, { detail: `No fake route for ${method} ${path}` }];
}

beforeEach(() => {
  requests = [];
  failPlanChanges = false;
  plan = [
    planItem('p1', 'Server oats', 'meal'),
    planItem('p2', 'Server run', 'activity'),
  ];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    requests.push({
      method: init.method ?? 'GET',
      path: parsed.pathname,
      body,
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-session-token',
    );
    const [status, data] = route(init.method ?? 'GET', parsed, body);
    return {
      ok: status < 300,
      status,
      headers: { get: () => null },
      json: async () => data,
    };
  }) as unknown as typeof fetch;
});

function allText(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map(t => [t.props.children].flat(Infinity).join(''))
    .join('\n');
}

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) {
      return;
    }
    await ReactTestRenderer.act(
      () => new Promise<void>(resolve => setTimeout(resolve, 10)),
    );
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function press(renderer: Renderer, label: string) {
  const target = renderer.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0];
  if (!target) {
    throw new Error(`Nothing to press labelled "${label}"`);
  }
  await ReactTestRenderer.act(() => target.props.onPress());
}

test('signed in, the screens load from and save to the Rhythm API', async () => {
  let renderer!: Renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const text = () => allText(renderer.root);

  await waitFor(() => text().includes('Server oats'), 'the account to load');
  expect(text()).toContain('Synced with Rhythm');
  expect(text()).toContain('2 of 2 planned items left today.');

  // A change shows at once, is sent as the phone app sends it, and the plan is reloaded from the server.
  await press(renderer, 'Mark Server oats done');
  expect(text()).toContain('1 of 2 planned items left today.');
  await waitFor(
    () => requests.some(r => r.method === 'PATCH' && r.path === '/plan/p1'),
    'the PATCH',
  );
  expect(requests.find(r => r.method === 'PATCH')!.body).toEqual({
    status: 'done',
  });
  await waitFor(
    () =>
      requests.filter(r => r.method === 'GET' && r.path === '/plan').length > 2,
    'the plan to reload',
  );
  expect(text()).toContain('1 of 2 planned items left today.');

  // A change the server refuses is undone on screen and explained.
  // (The fake server answers within the same tick, so the brief local "skipped" state isn't observable here.)
  failPlanChanges = true;
  await press(renderer, 'Skip Server run');
  await waitFor(
    () => text().includes('Not saved to your Rhythm account'),
    'the error banner',
  );
  await waitFor(
    () => text().includes('1 of 2 planned items left today.'),
    'the skip to be undone',
  );
  expect(text()).toContain('Rhythm is busy. Try again shortly.');
  await press(renderer, 'Dismiss');
  expect(text()).not.toContain('Not saved to your Rhythm account');

  // The Coach replies through the account (POST /coach/messages), not the demo Claude key.
  await press(renderer, 'Coach');
  await waitFor(
    () => text().includes('Your Rhythm Coach replies'),
    'the coach access check',
  );
  const input = renderer.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Message to coach' && n.props.onChangeText,
  )[0];
  await ReactTestRenderer.act(() =>
    input.props.onChangeText('What should I eat?'),
  );
  await press(renderer, 'Send');
  await waitFor(
    () => text().includes('Try the server oats with berries.'),
    'the coach reply',
  );
  const sent = requests.find(
    r => r.method === 'POST' && r.path === '/coach/messages',
  )!;
  expect(sent.body).toMatchObject({
    content: 'What should I eat?',
    localDate: today,
  });

  // The shopping list gets servings: the server scales the recipe and merges units itself.
  await press(renderer, 'Calendar');
  await press(renderer, 'Recipe library ↗');
  const recipeRow = renderer.root.findAll(
    n =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes('Server curry') &&
      typeof n.props.onPress === 'function',
  )[0];
  await ReactTestRenderer.act(() => recipeRow.props.onPress());
  await press(renderer, 'Increase Servings');
  await press(renderer, 'Add to shopping list');
  await waitFor(
    () => requests.some(r => r.path === '/recipes/r1/shopping'),
    'the shopping request',
  );
  expect(requests.find(r => r.path === '/recipes/r1/shopping')!.body).toEqual({
    servings: 5,
  });

  // A new Calendar entry is created once, keyed by its local id, at the local time it was logged for.
  await press(renderer, 'Calendar');
  await press(renderer, '＋ Log an entry');
  const title = renderer.root.findAll(
    n => n.props.accessibilityLabel === 'Title' && n.props.onChangeText,
  )[0];
  await ReactTestRenderer.act(() => title.props.onChangeText('Lunch salad'));
  await press(renderer, 'Save to your account');
  await waitFor(
    () => requests.some(r => r.method === 'POST' && r.path === '/calendar'),
    'the calendar request',
  );
  const created = requests.find(
    r => r.method === 'POST' && r.path === '/calendar',
  )!.body;
  expect(created).toMatchObject({
    kind: 'meal',
    title: 'Lunch salad',
    durationMinutes: null,
    notes: null,
  });
  expect(created.clientKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Date(created.occurredAt).getHours()).toBe(12);

  // Profile shows the account, and no demo reset.
  await press(renderer, 'Profile');
  expect(text()).toContain('Synced with your Rhythm account');
  expect(text()).toContain('Your Rhythm account on http://api.test');
  expect(text()).not.toContain('Reset to sample data');
  // A long walk through many screens; give it room on a busy machine.
}, 120_000);
