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
import { localDate } from '../src/lib/dates';

// The website's navigation and the screens it brings to Windows (Overview, Content library, Interests & sharing,
// Downloads, Camera workout), signed in against a stand-in for the Rhythm API with saved videos, interests and
// connections. What the website no longer shows (a Codex connection, the Memory tab, "Rhythm noticed…" prompts)
// stays hidden even when the server sends it.

jest.mock('../src/config', () => ({
  API_URL: 'https://api.rhythm.test',
  CLERK_PUBLISHABLE_KEY: '',
  WEB_URL: 'https://web.rhythm.test',
  DEV_SESSION_TOKEN: 'test-session-token',
  LOCAL_BACKEND: false,
  BACKEND_LABEL: 'Rhythm (api.rhythm.test)',
}));

const mockWide = { value: false };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: mockWide.value ? 1400 : 760,
    height: 900,
    scale: 1,
    fontScale: 1,
  }),
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

type Call = { method: string; path: string; body: any };
let calls: Call[];
let profile: any;
let learned: any;
let videos: any[];

function interestsResult() {
  return { status: 'ok', message: '', profileRevision: profile.profileRevision, profile, learned: {} };
}

function route(method: string, path: string, body: any): [number, unknown] {
  if (method === 'GET') {
    const slices: Record<string, unknown> = {
      '/me': { userId: 'user_test' },
      '/profile': {
        preferredName: 'Sam',
        goals: ['Move more'],
        dietaryPreferences: [],
        equipment: [],
        experienceLevel: null,
        routineTimes: [],
        onboardingCompleted: true,
      },
      '/preferences': { preferences: [], memoryAvailable: false },
      '/recipes': [],
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
      '/connections/access': {
        linked: true,
        claude: false,
        sharedClaude: true,
        textChat: true,
        elevenlabs: true,
        voiceProvider: 'elevenlabs',
      },
      '/rhythm/interests': interestsResult(),
      '/rhythm/learned': { status: 'ok', message: '', profileRevision: profile.profileRevision, learned },
      '/rhythm/saved': { status: 'ok', message: '', savedVideos: videos },
      '/rhythm/connections': {
        status: 'ok',
        message: '',
        agents: [
          { id: 'a1', label: 'Claude', clientId: 'assistant:claude', status: 'active', capabilities: ['interests', 'saved'] },
          { id: 'a2', label: 'Codex', clientId: 'assistant:codex', status: 'active', capabilities: ['interests'] },
        ],
      },
    };
    if (path in slices) {
      return [200, slices[path]];
    }
  }
  if (method === 'PUT' && path === '/rhythm/settings') {
    profile = {
      ...profile,
      profileRevision: profile.profileRevision + 1,
      consent: body.consent,
      enabledSites: body.enabledSites,
    };
    return [200, interestsResult()];
  }
  if (method === 'PUT' && path === '/rhythm/choices') {
    learned = {
      ...learned,
      choices: { ...learned.choices, pinned: body.pinned, blocked: body.blocked },
      interests: learned.interests.map((i: any) =>
        body.pinned.includes(i.topic) ? { ...i, state: 'pinned' } : i,
      ),
    };
    return [200, { status: 'ok', message: '', profileRevision: 3, learned }];
  }
  if (method === 'POST' && path === '/rhythm/saved/vid2/summary') {
    videos = videos.map(v =>
      v.videoId === 'vid2'
        ? { ...v, summaryState: 'ready', summary: 'Three rounds: jab, cross, slip.' }
        : v,
    );
    return [200, { status: 'ok', message: 'Notes ready.' }];
  }
  return [404, { detail: `No fake route for ${method} ${path}` }];
}

beforeEach(() => {
  calls = [];
  mockWide.value = false;
  profile = {
    ownerUserId: 'user_test',
    profileRevision: 2,
    updatedAt: '2026-10-29T08:00:00Z',
    confirmed: true,
    enabledSites: [],
    consent: { metadata: false, transcripts: false, agent: true, memory: false, learn: true },
  };
  learned = {
    learning: true,
    confirmed: true,
    interests: [
      { topic: 'boxing', state: 'learned', score: 0.8, videos: 5, saved: 1, chats: 2, feedback: 0, notInterested: 0 },
      { topic: 'food', state: 'noticed', score: 0.2, videos: 1, saved: 0, chats: 0, feedback: 0, notInterested: 0 },
    ],
    experienceLevel: { value: 'beginner', source: 'learned' },
    preferredDurationMinutes: { value: null, source: null },
    availableEquipment: { value: [], source: null },
    avoid: [],
    choices: {
      pinned: [],
      blocked: [],
      acknowledged: [],
      experience_level: null,
      preferred_duration_minutes: null,
      available_equipment: null,
    },
    // The server may still send a prompt; the app doesn't show it.
    suggestion: { topic: 'food', text: 'Rhythm noticed you watch cooking videos. Add Food?' },
    counts: {},
    learnedAt: null,
  };
  videos = [
    {
      videoId: 'vid1',
      url: 'https://www.youtube.com/watch?v=vid1',
      title: '20-minute dumbbell workout',
      channel: 'Coach Kim',
      durationSeconds: 1230,
      topics: ['gym'],
      description: 'A full-body session.',
      summary: 'Warm up, then three circuits of squats, rows and presses.',
      hasTranscript: true,
      summaryState: 'ready',
      summarizedAt: '2026-10-28T10:00:00Z',
      savedAt: '2026-10-28T09:00:00Z',
    },
    {
      videoId: 'vid2',
      url: 'https://evil.example/watch?v=vid2',
      title: 'Boxing footwork basics',
      channel: 'Ring School',
      durationSeconds: 600,
      topics: ['boxing'],
      description: null,
      summary: null,
      hasTranscript: true,
      summaryState: 'not_ready',
      summarizedAt: null,
      savedAt: '2026-10-27T09:00:00Z',
    },
  ];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    if (parsed.host === '127.0.0.1:8765') {
      throw new TypeError('Network request failed'); // no camera coach running in the test
    }
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path: parsed.pathname, body });
    const [status, data] = route(method, parsed.pathname, body);
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

async function press(renderer: Renderer, label: string) {
  const target = renderer.root.findAll(
    n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
  )[0];
  if (!target) {
    throw new Error(`Nothing to press labelled "${label}"`);
  }
  await ReactTestRenderer.act(() => target.props.onPress());
}

async function start() {
  let renderer!: Renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const text = () => allText(renderer.root);
  await waitFor(() => text().includes(', Sam'), 'the account to load');
  return { renderer, text };
}

test('the website’s navigation, on a wide window and a narrow one', async () => {
  mockWide.value = true;
  const wide = await start();
  // Rhythm · Demo version, the groups and every link
  expect(wide.text()).toContain('Rhythm');
  expect(wide.text()).toContain('Demo version');
  expect(wide.text()).toContain('DISCOVER');
  for (const label of [
    'Overview',
    'Coach',
    'Calendar',
    'Camera workout',
    'Content library',
    'Interests & sharing',
    'Downloads',
    'Profile',
  ]) {
    expect(wide.renderer.root.findAll(n => n.props.accessibilityLabel === label).length).toBeGreaterThan(0);
  }
  ReactTestRenderer.act(() => wide.renderer.unmount());

  mockWide.value = false;
  const narrow = await start();
  expect(narrow.text()).not.toContain('DISCOVER'); // a bar of links across the top instead
  expect(narrow.text()).toContain('Demo version');
  await press(narrow.renderer, 'Downloads');
  await waitFor(() => narrow.text().includes('Rhythm for Windows'), 'Downloads');
  ReactTestRenderer.act(() => narrow.renderer.unmount());
});

test('Overview shows the website’s cards from the account’s data, then today', async () => {
  const { renderer, text } = await start();
  await waitFor(() => text().includes('Ask your coach'), 'Overview');
  await waitFor(() => text().includes('Boxing'), 'the interests');
  expect(text()).toContain('Learning');
  expect(text()).toContain('YouTube sharing');
  expect(text()).toContain('Personalisation');
  expect(text()).toContain('Rhythm in Chrome');
  expect(text()).toContain('Nothing planned for today');
  expect(text()).not.toContain('Rhythm noticed');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('Content library: saved videos with notes and YouTube links; connections without Codex; no Memory tab', async () => {
  const { renderer, text } = await start();
  await press(renderer, 'Content library');
  await waitFor(() => text().includes('20-minute dumbbell workout'), 'the saved videos');
  expect(text()).toContain('Warm up, then three circuits of squats, rows and presses.');
  expect(text()).toContain('Coach Kim · 20:30');
  expect(text()).toContain('https://www.youtube.com/watch?v=vid1');
  // a link that isn't YouTube's is never shown or opened: the video's own YouTube address instead
  expect(text()).not.toContain('evil.example');
  expect(text()).toContain('https://www.youtube.com/watch?v=vid2');
  expect(text()).not.toContain('Memory');

  await press(renderer, 'Prepare notes');
  await waitFor(() => text().includes('Three rounds: jab, cross, slip.'), 'the prepared notes');
  expect(calls.some(c => c.method === 'POST' && c.path === '/rhythm/saved/vid2/summary')).toBe(true);

  await press(renderer, 'Connections');
  await waitFor(() => text().includes('Can use: Your interests, Saved videos'), 'the connections');
  expect(text()).toContain('Claude');
  expect(text()).not.toContain('Codex');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('Interests & sharing shows the saved settings and saves changes', async () => {
  const { renderer, text } = await start();
  await press(renderer, 'Interests & sharing');
  await waitFor(() => text().includes('What Rhythm learned'), 'the interests');
  const switchState = (label: string) =>
    renderer.root.findAll(
      n => n.props.accessibilityLabel === label && n.props.accessibilityRole === 'switch',
    )[0].props.accessibilityState.checked;
  expect(switchState('Learn my interests automatically')).toBe(true);
  expect(switchState('YouTube with page details')).toBe(false);
  expect(switchState('Share with my chosen agent')).toBe(true);
  expect(switchState('Private long-term memory')).toBe(false);
  expect(text()).toContain('5 videos · 1 saved · 2 chats');
  expect(text()).toContain('Rhythm learned it'); // the level's source
  expect(text()).not.toContain('Rhythm noticed');

  await press(renderer, 'YouTube with page details');
  await waitFor(() => switchState('YouTube with page details') === true, 'YouTube on');
  const put = calls.find(c => c.method === 'PUT' && c.path === '/rhythm/settings')!;
  expect(put.body).toEqual({
    enabledSites: ['youtube'],
    consent: { metadata: true, transcripts: false, agent: true, memory: false, learn: true },
    expectedRevision: 2,
  });

  await press(renderer, 'Keep');
  await waitFor(() => calls.some(c => c.method === 'PUT' && c.path === '/rhythm/choices'), 'the choice');
  const choices = calls.find(c => c.path === '/rhythm/choices')!.body;
  expect(choices.pinned).toEqual(['boxing']);
  await waitFor(() => text().includes('You chose it'), 'boxing kept');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('Camera workout explains when the local camera coach isn’t running', async () => {
  const { renderer, text } = await start();
  await press(renderer, 'Camera workout');
  await waitFor(() => text().includes('Unavailable right now'), 'the unavailable state');
  expect(text()).toContain('camera.ps1');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('Coach says the ElevenLabs voice Coach is on the website, not this app', async () => {
  const { renderer, text } = await start();
  await press(renderer, 'Coach');
  await waitFor(() => text().includes('Your account’s voice Coach is your ElevenLabs agent'), 'the ElevenLabs label');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('Profile is grouped as on the website', async () => {
  const { renderer, text } = await start();
  await press(renderer, 'Profile');
  await waitFor(() => text().includes('PREFERENCES & GOALS'), 'Profile');
  for (const heading of ['DISCOVER', 'CONNECTIONS', 'MEMORY & DATA']) {
    expect(text()).toContain(heading);
  }
  ReactTestRenderer.act(() => renderer.unmount());
});
