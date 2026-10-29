
import {
  blocker,
  converse,
  localVoiceClient,
  LocalVoiceError,
  prompt,
  type LocalVoiceClient,
  type LocalVoiceDeps,
  type LocalVoiceInfo,
  type Phase,
} from '../src/lib/local-voice';

// Node's crypto (Jest runs in Node; the app has no Node types)
const { createHmac, randomBytes } = require('crypto') as {
  createHmac(algorithm: string, key: string): { update(data: string): { digest(encoding: 'hex'): string } };
  randomBytes(size: number): { toString(encoding: 'hex'): string };
};

const TOKEN = 'a'.repeat(64);

type Handler = (path: string, body: any, headers: Record<string, string>) => { status: number; body: object };

function deps(handler: Handler, token: string | null = TOKEN, proofKey = TOKEN) {
  const calls: { path: string; headers: Record<string, string>; body: any }[] = [];
  const d: LocalVoiceDeps = {
    readToken: () => token,
    randomHex: n => randomBytes(n).toString('hex'),
    hmac: (key, message) => createHmac('sha256', key).update(message).digest('hex'),
    fetch: (async (url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new Error('aborted');
      const path = url.replace('http://127.0.0.1:39765', '');
      const headers = init.headers as Record<string, string>;
      const body = JSON.parse(init.body as string);
      calls.push({ path, headers, body });
      const answer =
        path === '/status'
          ? { status: 200, body: { proof: createHmac('sha256', proofKey).update(body.nonce).digest('hex'), transcription: true, speech: true } }
          : handler(path, body, headers);
      return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
    }) as unknown as typeof fetch,
  };
  return { d, calls };
}

describe('local voice client', () => {
  it('checks the helper’s proof before sending anything, then sends the token', async () => {
    const { d, calls } = deps(() => ({ status: 200, body: { text: 'Drink some water.' } }));
    const client = localVoiceClient(d);
    await expect(client.coach('hello')).resolves.toBe('Drink some water.');
    expect(calls.map(c => c.path)).toEqual(['/status', '/coach']);
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[1].headers.Origin).toBeUndefined();
    // checked again before every request, with a new nonce
    await client.coach('again');
    expect(calls.map(c => c.path)).toEqual(['/status', '/coach', '/status', '/coach']);
    expect(calls[2].body.nonce).not.toBe(calls[0].body.nonce);
  });

  it('gives nothing to a program that took the port of a helper that was killed', async () => {
    // the helper proves itself, then dies; its token file stays; an impostor takes the port
    let impostor = false;
    const calls: { path: string; headers: Record<string, string> }[] = [];
    const d: LocalVoiceDeps = {
      ...deps(() => ({ status: 200, body: {} })).d,
      fetch: (async (url: string, init: RequestInit) => {
        const path = url.replace('http://127.0.0.1:39765', '');
        const body = JSON.parse(init.body as string);
        calls.push({ path, headers: init.headers as Record<string, string> });
        const key = impostor ? 'f'.repeat(64) : TOKEN;
        const answer = path === '/status' ? { proof: createHmac('sha256', key).update(body.nonce).digest('hex') } : { text: 'ok' };
        return { ok: true, status: 200, json: async () => answer } as Response;
      }) as unknown as typeof fetch,
    };
    const client = localVoiceClient(d);
    await client.coach('first');
    impostor = true;
    const before = calls.length;
    await expect(client.coach('private words')).rejects.toMatchObject({ code: 'untrusted' });
    expect(calls.slice(before).map(c => c.path)).toEqual(['/status']);
    expect(calls.slice(before).some(c => c.headers.Authorization)).toBe(false);
  });

  it('sends nothing to a program that doesn’t know the token', async () => {
    const { d, calls } = deps(() => ({ status: 200, body: { text: 'stolen' } }), TOKEN, 'b'.repeat(64));
    await expect(localVoiceClient(d).coach('my private words')).rejects.toMatchObject({ code: 'untrusted' });
    expect(calls.map(c => c.path)).toEqual(['/status']);
    expect(JSON.stringify(calls)).not.toContain('my private words');
  });

  it('says how to start the helper when it isn’t running', async () => {
    const { d, calls } = deps(() => ({ status: 200, body: {} }), null);
    await expect(localVoiceClient(d).info()).rejects.toMatchObject({ code: 'not_running' });
    expect(calls).toEqual([]);
  });

  it('passes the helper’s error codes on', async () => {
    const { d } = deps(() => ({ status: 503, body: { code: 'claude_unavailable', error: 'Claude Code is not signed in.' } }));
    await expect(localVoiceClient(d).coach('hi')).rejects.toMatchObject({
      code: 'claude_unavailable',
      message: 'Claude Code is not signed in.',
    });
  });
});

function fakeClient(script: ({ heard: boolean; text: string } | Error)[]) {
  const log: string[] = [];
  let active = 0,
    maxActive = 0;
  const step = async <T,>(name: string, value: () => T) => {
    active++;
    maxActive = Math.max(maxActive, active);
    log.push(name);
    await Promise.resolve();
    active--;
    return value();
  };
  const client: LocalVoiceClient = {
    info: async () => ({}) as LocalVoiceInfo,
    listen: () =>
      step('listen', () => {
        const next = script.shift();
        if (!next) throw new LocalVoiceError('cancelled', 'Stopped.');
        if (next instanceof Error) throw next;
        return next;
      }),
    coach: text => step(`coach:${text.split('\n').pop()}`, () => `reply to ${text.split('User: ').pop()}`),
    speak: text => step(`speak:${text}`, () => undefined),
    cancel: async () => undefined,
  };
  return { client, log, maxActive: () => maxActive };
}

describe('conversation turn-taking', () => {
  it('keeps listening through long quiet stretches without asking Claude', async () => {
    const quiet = { heard: false, text: '' };
    const { client, log } = fakeClient([quiet, quiet, quiet, { heard: true, text: 'Plan my lunch' }]);
    const phases: Phase[] = [];
    await converse(client, new AbortController().signal, {
      phase: p => phases.push(p),
      heard: () => {},
      replied: () => {},
    });
    // three 20-second silences (a minute) sent nothing to Claude and didn't end the conversation
    expect(log.slice(0, 4)).toEqual(['listen', 'listen', 'listen', 'listen']);
    expect(log.filter(l => l.startsWith('coach'))).toHaveLength(1);
    expect(phases.slice(-3)).toEqual(['thinking', 'speaking', 'listening']);
  });

  it('runs several turns one step at a time and gives Claude the turns before', async () => {
    const { client, log, maxActive } = fakeClient([
      { heard: true, text: 'one' },
      { heard: true, text: 'two' },
      { heard: true, text: 'three' },
    ]);
    const turns: string[] = [];
    await converse(client, new AbortController().signal, {
      phase: () => {},
      heard: () => {},
      replied: t => turns.push(t.user),
    });
    expect(turns).toEqual(['one', 'two', 'three']);
    expect(log).toEqual([
      'listen', 'coach:User: one', 'speak:reply to one',
      'listen', 'coach:User: two', 'speak:reply to two',
      'listen', 'coach:User: three', 'speak:reply to three',
      'listen',
    ]);
    expect(maxActive()).toBe(1);
  });

  it('stops cleanly when cancelled mid-turn', async () => {
    const stop = new AbortController();
    const { client, log } = fakeClient([{ heard: true, text: 'hello' }]);
    const coach = client.coach;
    client.coach = async text => {
      stop.abort();
      return coach(text);
    };
    await expect(
      converse(client, stop.signal, { phase: () => {}, heard: () => {}, replied: () => {} }),
    ).resolves.toBeUndefined();
    expect(log).toEqual(['listen', 'coach:User: hello']);
  });

  it('ends with the error that stopped it', async () => {
    const { client } = fakeClient([new LocalVoiceError('microphone_blocked', 'Windows is blocking the microphone.')]);
    await expect(
      converse(client, new AbortController().signal, { phase: () => {}, heard: () => {}, replied: () => {} }),
    ).rejects.toMatchObject({ code: 'microphone_blocked' });
  });

  it('waits out a helper that is still finishing a stopped turn', async () => {
    const { client, log } = fakeClient([new LocalVoiceError('busy', 'busy'), { heard: true, text: 'hi' }]);
    await converse(client, new AbortController().signal, { phase: () => {}, heard: () => {}, replied: () => {} });
    expect(log.slice(0, 3)).toEqual(['listen', 'listen', 'coach:User: hi']);
  });

  it('keeps only the last few turns in what it sends', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ user: `u${i}`, coach: `c${i}` }));
    const text = prompt(history, 'now');
    expect(text).not.toContain('u1');
    expect(text).toContain('u2');
    expect(text.endsWith('User: now')).toBe(true);
  });
});

describe('setup messages', () => {
  const ready: LocalVoiceInfo = {
    transcription: { installed: true, ready: true, error: null },
    speech: { installed: true, ready: true, error: null },
    microphone: { ok: true, name: 'Mic' },
    claude: { installed: true, loggedIn: true, account: 'me@example.com', plan: 'pro', error: null },
  };
  it('is clear about what is missing', () => {
    expect(blocker(ready)).toBeNull();
    expect(blocker({ ...ready, speech: { installed: false, ready: false, error: null } })).toMatch(/setup_voice_windows/);
    expect(blocker({ ...ready, claude: { ...ready.claude, installed: false } })).toMatch(/isn’t installed/);
    expect(
      blocker({ ...ready, claude: { installed: true, loggedIn: false, account: null, plan: null, error: 'Claude Code is not signed in.' } }),
    ).toMatch(/claude auth login/);
    expect(blocker({ ...ready, microphone: { ok: false, error: 'No microphone was found (PortAudioError).' } })).toMatch(/microphone/);
    const slow = { installed: true, loggedIn: false, account: null, plan: null, checkFailed: true,
      error: 'Claude Code took too long to report its sign-in. Check again in a moment.' };
    expect(blocker({ ...ready, claude: slow })).toBe(slow.error);
  });
});
