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
import { writeSecret } from '../modules/north-win';
import { localDate } from '../src/lib/dates';

// The whole app with sign-in on, against small stand-ins for Clerk's Frontend API and the Rhythm API: the sign-in
// screen is all there is while signed out; an emailed code signs in; a wrong code is explained; sign-out returns to
// sign-in; a restart stays signed in (the client token is kept by NorthWin, in memory under Jest); a second account
// sees none of the first's data; an ended session and an unreachable Clerk are explained; and only an account
// created in the app gets the welcome step.

jest.mock('../src/config', () => ({
  API_URL: 'https://api.rhythm.test',
  CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsucmh5dGhtLnRlc3Qk', // (clerk.rhythm.test$ in base64)
  WEB_URL: 'https://web.rhythm.test',
  DEV_SESSION_TOKEN: '',
  LOCAL_BACKEND: false,
  BACKEND_LABEL: 'Rhythm (api.rhythm.test)',
}));

const CODE = '424242';
const today = localDate();

type User = {
  id: string;
  email: string;
  name: string;
  recipe: string;
  onboarded: boolean;
};

let users: Record<string, User>;
let session: { id: string; user: User } | null;
let clientToken: string | null;
let clients = 0;
let clerkDown: boolean;
let revoked: boolean;
let apiDown: boolean;
let codesSent: number;
let attempt: { kind: 'sign_in' | 'sign_up'; email: string; password?: string };
let apiCalls: { method: string; path: string; user: string; body: any }[];

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function clientResource() {
  return {
    sessions: session
      ? [
          {
            id: session.id,
            status: 'active',
            user: {
              id: session.user.id,
              first_name: session.user.name,
              primary_email_address_id: `idn_${session.user.id}`,
              email_addresses: [
                { id: `idn_${session.user.id}`, email_address: session.user.email },
              ],
            },
          },
        ]
      : [],
    last_active_session_id: session?.id ?? null,
  };
}

function form(body: unknown): Record<string, string> {
  return Object.fromEntries(
    String(body ?? '')
      .split('&')
      .filter(Boolean)
      .map(pair => pair.split('=').map(decodeURIComponent)),
  );
}

function clerk(method: string, path: string, body: Record<string, string>) {
  const complete = (user: User) => {
    session = { id: `sess_${user.id}`, user };
    return reply(200, {
      response: { id: 'sia_1', status: 'complete', created_session_id: session.id },
    });
  };
  if (method === 'GET' && path === '/v1/client') {
    return reply(200, { response: clientResource() });
  }
  if (method === 'POST' && path === '/v1/client/sign_ins') {
    if (session) {
      return reply(400, { errors: [{ code: 'session_exists' }] });
    }
    const user = users[body.identifier];
    if (!user) {
      return reply(422, { errors: [{ code: 'form_identifier_not_found' }] });
    }
    attempt = { kind: 'sign_in', email: user.email };
    return reply(200, {
      response: {
        id: 'sia_1',
        status: 'needs_first_factor',
        created_session_id: null,
        supported_first_factors: [
          {
            strategy: 'email_code',
            email_address_id: `idn_${user.id}`,
            safe_identifier: user.email,
          },
        ],
      },
    });
  }
  if (method === 'POST' && path === '/v1/client/sign_ins/sia_1/prepare_first_factor') {
    codesSent += 1;
    return reply(200, { response: { id: 'sia_1', status: 'needs_first_factor' } });
  }
  if (method === 'POST' && path === '/v1/client/sign_ins/sia_1/attempt_first_factor') {
    if (body.code !== CODE) {
      return reply(422, { errors: [{ code: 'form_code_incorrect' }] });
    }
    return complete(users[attempt.email]);
  }
  if (method === 'POST' && path === '/v1/client/sign_ups') {
    if (users[body.email_address]) {
      return reply(422, { errors: [{ code: 'form_identifier_exists' }] });
    }
    attempt = { kind: 'sign_up', email: body.email_address, password: body.password };
    return reply(200, {
      response: {
        id: 'sua_1',
        status: 'missing_requirements',
        created_session_id: null,
        unverified_fields: ['email_address'],
      },
    });
  }
  if (method === 'POST' && path === '/v1/client/sign_ups/sua_1/prepare_verification') {
    codesSent += 1;
    return reply(200, { response: { id: 'sua_1', status: 'missing_requirements' } });
  }
  if (method === 'POST' && path === '/v1/client/sign_ups/sua_1/attempt_verification') {
    if (body.code !== CODE) {
      return reply(422, { errors: [{ code: 'form_code_incorrect' }] });
    }
    const user: User = {
      id: 'user_new',
      email: attempt.email,
      name: 'New',
      recipe: 'Nothing yet',
      onboarded: false,
    };
    users[user.email] = user;
    session = { id: `sess_${user.id}`, user };
    return reply(200, {
      response: { id: 'sua_1', status: 'complete', created_session_id: session.id },
    });
  }
  const tokens = /^\/v1\/client\/sessions\/(.+)\/tokens$/.exec(path);
  if (method === 'POST' && tokens) {
    if (!session || session.id !== tokens[1] || revoked) {
      return reply(401, { errors: [{ code: 'authentication_invalid' }] });
    }
    return reply(200, { object: 'token', jwt: `jwt.${session.user.id}` });
  }
  if (method === 'POST' && /\/remove$/.test(path)) {
    session = null;
    return reply(200, { response: {} });
  }
  return reply(404, { errors: [{ code: 'not_found', message: `${method} ${path}` }] });
}

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

function api(method: string, path: string, auth: string | undefined, body: any) {
  const user = Object.values(users).find(u => auth === `Bearer jwt.${u.id}`);
  apiCalls.push({ method, path, user: user?.id ?? 'none', body });
  if (!user || revoked) {
    return reply(401, { detail: 'Not signed in' });
  }
  const profile = {
    preferredName: user.name,
    goals: [],
    dietaryPreferences: [],
    equipment: [],
    experienceLevel: null,
    routineTimes: [],
    onboardingCompleted: user.onboarded,
  };
  if (method === 'PUT' && path === '/profile') {
    user.onboarded = true;
    return reply(200, { ...profile, ...body, onboardingCompleted: true });
  }
  const routes: Record<string, unknown> = {
    '/profile': profile,
    '/preferences': { preferences: [], memoryAvailable: false },
    '/recipes': [
      {
        id: `r_${user.id}`,
        title: user.recipe,
        servings: 2,
        description: null,
        ingredients: [],
        steps: [],
        tags: [],
      },
    ],
    '/routines': [],
    '/sessions': [],
    '/plan': { start: today, items: [] },
    '/today': { date: today, items: [], checkIn: null },
    '/shopping': { items: [] },
    '/coach/messages': { messages: [] },
    '/calendar': [],
    '/progress': {
      today,
      week: windowStats,
      month: { ...windowStats, days: 30 },
      streakDays: 0,
      last7: [],
    },
    '/connections/access': { linked: false, claude: false, sharedClaude: false, textChat: false },
  };
  return path in routes ? reply(200, routes[path]) : reply(404, { detail: path });
}

beforeEach(() => {
  writeSecret('clerk-client', null);
  users = {
    'ada@example.com': {
      id: 'user_ada',
      email: 'ada@example.com',
      name: 'Ada',
      recipe: 'Ada’s lentil curry',
      onboarded: true,
    },
    'bo@example.com': {
      id: 'user_bo',
      email: 'bo@example.com',
      name: 'Bo',
      recipe: 'Bo’s green salad',
      // never went through onboarding: signing in still goes straight to Today
      onboarded: false,
    },
  };
  session = null;
  clientToken = null;
  clerkDown = false;
  revoked = false;
  apiDown = false;
  codesSent = 0;
  apiCalls = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (parsed.host === 'clerk.rhythm.test') {
      if (clerkDown) {
        throw new TypeError('Network request failed');
      }
      // A request without this client's token starts a new client (as after sign-out), with no session.
      let issued: Record<string, string> = {};
      if (!clientToken || headers.Authorization !== clientToken) {
        clients += 1;
        clientToken = `client_${clients}`;
        session = null;
        issued = { authorization: clientToken };
      }
      const result = clerk(init.method ?? 'GET', parsed.pathname, form(init.body));
      return {
        ...result,
        headers: { get: (n: string) => issued[n.toLowerCase()] ?? null },
      };
    }
    if (apiDown) {
      throw new TypeError('Network request failed');
    }
    return api(
      init.method ?? 'GET',
      parsed.pathname,
      headers.Authorization,
      init.body ? JSON.parse(init.body as string) : undefined,
    );
  }) as unknown as typeof fetch;
});

function allText(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map(t => [t.props.children].flat(Infinity).join(''))
    .join('\n');
}

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 150; i++) {
    if (check()) {
      return;
    }
    await ReactTestRenderer.act(
      () => new Promise<void>(resolve => setTimeout(resolve, 10)),
    );
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function find(renderer: Renderer, label: string, prop: 'onPress' | 'onChangeText') {
  const target = renderer.root.findAll(
    n => n.props.accessibilityLabel === label && typeof n.props[prop] === 'function',
  )[0];
  if (!target) {
    throw new Error(`Nothing labelled "${label}"`);
  }
  return target;
}

async function press(renderer: Renderer, label: string) {
  const target = find(renderer, label, 'onPress');
  await ReactTestRenderer.act(() => target.props.onPress());
}

async function type(renderer: Renderer, label: string, value: string) {
  const target = find(renderer, label, 'onChangeText');
  await ReactTestRenderer.act(() => target.props.onChangeText(value));
}

async function start(): Promise<{ renderer: Renderer; text: () => string }> {
  let renderer!: Renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  return { renderer, text: () => allText(renderer.root) };
}

async function signInWithCode(renderer: Renderer, text: () => string, email: string) {
  await waitFor(() => text().includes('Sign in to Rhythm'), 'the sign-in screen');
  await type(renderer, 'Email address', email);
  await press(renderer, 'Email me a sign-in code');
  await waitFor(() => text().includes(`We emailed a code to ${email}`), 'the code step');
  await type(renderer, 'Code from the email', CODE);
  await press(renderer, 'Sign in');
}

test('sign-in is required; an emailed code signs in; sign-out, restart and a second account', async () => {
  const first = await start();
  const { renderer, text } = first;

  // Signed out: only the sign-in screen, and no request to the Rhythm API.
  await waitFor(() => text().includes('Sign in to Rhythm'), 'the sign-in screen');
  expect(text()).not.toContain('Synced with Rhythm'); // (no sidebar, no app screens)
  expect(text()).not.toContain('Profile');
  expect(text()).toContain('Signing in to Rhythm (api.rhythm.test)');
  expect(apiCalls).toEqual([]);

  // A wrong code is explained, and the right one signs in to Today.
  await type(renderer, 'Email address', 'ada@example.com');
  await press(renderer, 'Email me a sign-in code');
  await waitFor(() => text().includes('We emailed a code to ada@example.com'), 'the code step');
  expect(codesSent).toBe(1);
  await type(renderer, 'Code from the email', '000000');
  await press(renderer, 'Sign in');
  await waitFor(() => text().includes('That code isn’t right'), 'the wrong-code message');
  await press(renderer, 'Send a new code');
  await waitFor(() => text().includes('A new code is on its way'), 'the resend');
  expect(codesSent).toBe(2);
  await type(renderer, 'Code from the email', CODE);
  await press(renderer, 'Sign in');
  await waitFor(() => text().includes(', Ada'), 'Ada’s Today');
  expect(text()).toContain('ada@example.com');
  expect(text()).not.toContain('Welcome to Rhythm');
  expect(apiCalls.every(c => c.user === 'user_ada')).toBe(true);

  // A restart (a new app on the same PC) is still signed in, without the sign-in screen.
  ReactTestRenderer.act(() => renderer.unmount());
  const second = await start();
  await waitFor(() => second.text().includes('ada@example.com'), 'the restored session');
  expect(second.text()).not.toContain('Sign in to Rhythm');

  // Sign-out goes back to sign-in.
  await press(second.renderer, 'Profile');
  await press(
    second.renderer,
    'Signed in as ada@example.com, Synced with your Rhythm account · sign out',
  );
  await waitFor(() => second.text().includes('Claude Code on this PC is separate'), 'the account page');
  await press(second.renderer, 'Sign out');
  await waitFor(() => second.text().includes('Sign in to Rhythm'), 'sign-in after sign-out');
  expect(second.text()).not.toContain('ada@example.com');

  // A second account sees its own data and none of the first's; an account that skipped onboarding elsewhere
  // isn't sent through the welcome step.
  apiCalls = [];
  await signInWithCode(second.renderer, second.text, 'bo@example.com');
  await waitFor(() => second.text().includes(', Bo'), 'Bo’s Today');
  expect(second.text()).toContain('bo@example.com');
  expect(second.text()).not.toContain('Welcome to Rhythm');
  expect(second.text()).not.toContain('Ada');
  expect(second.text()).not.toContain('ada@example.com');
  expect(apiCalls.length).toBeGreaterThan(0);
  expect(apiCalls.every(c => c.user === 'user_bo')).toBe(true);
  ReactTestRenderer.act(() => second.renderer.unmount());
});

test('an unknown address can create an account, which gets the welcome step once', async () => {
  const { renderer, text } = await start();
  await waitFor(() => text().includes('Sign in to Rhythm'), 'the sign-in screen');
  await type(renderer, 'Email address', 'new@example.com');
  await press(renderer, 'Email me a sign-in code');
  await waitFor(() => text().includes('There’s no Rhythm account for that email address.'), 'not found');
  await press(renderer, 'Create an account with this email');
  await waitFor(() => text().includes('Create your Rhythm account'), 'the create step');
  await type(renderer, 'Choose a password', 'a long password');
  await press(renderer, 'Create account');
  await waitFor(() => text().includes('We emailed a code to new@example.com'), 'the code step');
  await type(renderer, 'Code from the email', CODE);
  await press(renderer, 'Create account');
  await waitFor(() => text().includes('Welcome to Rhythm'), 'the welcome step');
  await press(renderer, 'Skip for now');
  await waitFor(() => !text().includes('Welcome to Rhythm') && text().includes('new@example.com'), 'Today');
  expect(apiCalls.some(c => c.method === 'PUT' && c.path === '/profile' && c.body.onboardingCompleted === true)).toBe(true);
  ReactTestRenderer.act(() => renderer.unmount());
});

test('a session that ends while the app runs goes back to sign-in and says why', async () => {
  const { renderer, text } = await start();
  await signInWithCode(renderer, text, 'ada@example.com');
  await waitFor(() => text().includes(', Ada'), 'Ada’s Today');
  // Signed out elsewhere: the API refuses the cached token, the app asks Clerk for a new one, and Clerk says the
  // session is gone.
  revoked = true;
  await press(renderer, 'Coach'); // (the Coach checks the account's AI access through the API)
  await waitFor(() => text().includes('Your Rhythm session has ended'), 'the session-ended message');
  expect(text()).toContain('Sign in to Rhythm');
  expect(text()).not.toContain(', Ada');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('Clerk out of reach at start: explained, with Try again and Sign out; the saved sign-in is kept', async () => {
  // Signed in earlier on this PC.
  const first = await start();
  await signInWithCode(first.renderer, first.text, 'ada@example.com');
  await waitFor(() => first.text().includes('ada@example.com'), 'Ada’s account');
  ReactTestRenderer.act(() => first.renderer.unmount());

  clerkDown = true;
  const { renderer, text } = await start();
  await waitFor(() => text().includes('Can’t check your sign-in'), 'the offline screen');
  expect(text()).toContain('Can’t reach the Rhythm sign-in service (Clerk)');
  clerkDown = false;
  await press(renderer, 'Try again');
  await waitFor(() => text().includes('ada@example.com'), 'the restored session');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('the Rhythm API out of reach: explained, with Try again and Sign out', async () => {
  const { renderer, text } = await start();
  apiDown = true;
  await signInWithCode(renderer, text, 'ada@example.com');
  await waitFor(
    () => text().includes('Couldn’t load your Rhythm account'),
    'the load error',
  );
  expect(text()).toContain('Can’t reach the Rhythm server at https://api.rhythm.test');
  apiDown = false;
  await press(renderer, 'Try again');
  await waitFor(() => text().includes(', Ada'), 'Ada’s Today');
  ReactTestRenderer.act(() => renderer.unmount());
});
