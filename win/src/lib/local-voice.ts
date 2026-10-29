import * as NorthWin from '../../modules/north-win';

// Client for the opt-in local voice helper (win/local-voice/service.py): Parakeet hears and Kokoro speaks on this
// PC, and the Claude account signed in to Claude Code on this PC answers through one MCP tool. Before every request,
// the app checks that whoever answers on the port knows the token the helper left in this app's own data folder
// (HMAC of a fresh nonce), so another program on the port gets neither the token nor any speech text. The check is
// never skipped: a helper that was killed leaves its token file behind, and something else may have its port now. React Native's fetch on
// Windows sends no Origin header, which the helper requires; web pages (the camera WebView included) always send
// one, so they can't use the helper.

export const LOCAL_VOICE_URL = 'http://127.0.0.1:39765';

export interface LocalVoiceInfo {
  transcription: { installed: boolean; ready: boolean; error: string | null };
  speech: { installed: boolean; ready: boolean; error: string | null };
  microphone: { ok: boolean; name?: string; error?: string };
  claude: {
    installed: boolean;
    loggedIn: boolean;
    account: string | null;
    plan: string | null;
    error: string | null;
    /** Claude Code didn't say (too slow, unreadable): not the same as signed out. */
    checkFailed?: boolean;
  };
}

export type LocalVoiceCode =
  | 'not_running' // no token: the helper isn't started
  | 'untrusted' // something answered on the port without the helper's token
  | 'cancelled'
  | 'busy'
  | 'loading'
  | 'missing_models'
  | 'claude_unavailable'
  | 'no_microphone'
  | 'microphone_blocked'
  | 'slow'
  | 'invalid'
  | 'failed';

export class LocalVoiceError extends Error {
  constructor(
    readonly code: LocalVoiceCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocalVoiceError';
  }
}

export interface LocalVoiceDeps {
  readToken(): string | null;
  randomHex(bytes: number): string | null;
  hmac(key: string, message: string): string | null;
  fetch: typeof fetch;
}

const nativeDeps: LocalVoiceDeps = {
  readToken: NorthWin.readLocalVoiceToken,
  randomHex: NorthWin.randomHex,
  hmac: NorthWin.hmacSha256Hex,
  fetch: (...args) => fetch(...args),
};

export const NOT_RUNNING =
  'Local voice isn’t running. In PowerShell, run win\\local-voice\\start.ps1 from the BuildNorth folder and keep its window open.';

const KNOWN = new Set<string>([
  'cancelled',
  'busy',
  'loading',
  'missing_models',
  'claude_unavailable',
  'no_microphone',
  'microphone_blocked',
  'slow',
  'invalid',
]);

/** Same length and every character equal, comparing every character (no early exit). */
function sameHex(a: string, b: string) {
  let same = a.length === b.length;
  for (let i = 0; i < a.length; i++) same = a[i] === b[i] && same;
  return same;
}

export interface LocalVoiceClient {
  /** Checks the helper (proof first) and returns what is set up; throws not_running or untrusted. */
  info(signal?: AbortSignal): Promise<LocalVoiceInfo>;
  /** One utterance ended by a pause; heard=false after `waitS` seconds of quiet. */
  listen(
    waitS: number,
    signal?: AbortSignal,
  ): Promise<{ heard: boolean; text: string }>;
  /** Claude Code's spoken answer to `text`. */
  coach(text: string, signal?: AbortSignal): Promise<string>;
  /** Kokoro says `text` on this PC's speakers; resolves when it has finished. */
  speak(text: string, signal?: AbortSignal): Promise<void>;
  /** Stops whatever the helper is doing (listening, Claude, speaking). */
  cancel(): Promise<void>;
}

export function localVoiceClient(
  deps: LocalVoiceDeps = nativeDeps,
): LocalVoiceClient {
  async function request(path: string, body: object, token?: string, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await deps.fetch(`${LOCAL_VOICE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (signal?.aborted) throw new LocalVoiceError('cancelled', 'Stopped.');
      throw new LocalVoiceError('not_running', NOT_RUNNING);
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      // handled below
    }
    if (!response.ok) {
      const code = typeof data.code === 'string' && KNOWN.has(data.code) ? (data.code as LocalVoiceCode) : 'failed';
      const message = typeof data.error === 'string' ? data.error : `Local voice answered ${response.status}.`;
      if (response.status === 403) throw new LocalVoiceError('not_running', NOT_RUNNING);
      throw new LocalVoiceError(code, message);
    }
    return data;
  }

  async function verified(signal?: AbortSignal): Promise<string> {
    const token = deps.readToken();
    if (!token) throw new LocalVoiceError('not_running', NOT_RUNNING);
    const nonce = deps.randomHex(32);
    if (!nonce) throw new LocalVoiceError('failed', 'This app could not make a random check value.');
    const status = await request('/status', { nonce }, undefined, signal);
    const expected = deps.hmac(token, nonce);
    if (!expected || typeof status.proof !== 'string' || !sameHex(status.proof, expected)) {
      throw new LocalVoiceError(
        'untrusted',
        'Another program is answering on the local voice port, so nothing was sent to it. Stop it, then start win\\local-voice\\start.ps1 again.',
      );
    }
    return token;
  }

  async function call(path: string, body: object, signal?: AbortSignal) {
    const token = await verified(signal);
    return request(path, body, token, signal);
  }

  return {
    async info(signal) {
      return (await call('/info', {}, signal)) as unknown as LocalVoiceInfo;
    },
    async listen(waitS, signal) {
      const data = await call('/listen', { waitS }, signal);
      return { heard: data.heard === true, text: typeof data.text === 'string' ? data.text : '' };
    },
    async coach(text, signal) {
      const data = await call('/coach', { text }, signal);
      if (typeof data.text !== 'string' || !data.text.trim())
        throw new LocalVoiceError('claude_unavailable', 'Claude did not answer.');
      return data.text;
    },
    async speak(text, signal) {
      await call('/speak', { text: text.slice(0, 600) }, signal);
    },
    async cancel() {
      try {
        await call('/cancel', {});
      } catch {
        // nothing to stop, or the helper is gone
      }
    },
  };
}

/** What blocks a conversation, as one sentence for the screen; null when everything is ready. */
export function blocker(info: LocalVoiceInfo): string | null {
  if (!info.transcription.installed || !info.speech.installed)
    return 'The speech models aren’t set up on this PC. In Git Bash: cd inference/pose-coach && bash tools/setup_voice_windows.sh';
  if (!info.claude.installed)
    return 'Claude Code isn’t installed on this PC. Install it from claude.com/claude-code, then sign in with claude auth login.';
  if (!info.claude.loggedIn && info.claude.checkFailed)
    return info.claude.error ?? 'Claude Code’s sign-in couldn’t be checked. Check again in a moment.';
  if (!info.claude.loggedIn)
    return `${info.claude.error ?? 'Claude Code isn’t signed in.'} Open a terminal, run claude auth login and sign in there with your Claude account (never paste a password or code into Rhythm).`;
  if (!info.microphone.ok)
    return info.microphone.error ?? 'No microphone was found. Connect one and check again.';
  if (info.transcription.error) return `Parakeet: ${info.transcription.error}`;
  if (info.speech.error) return `Kokoro: ${info.speech.error}`;
  return null;
}

export const loading = (info: LocalVoiceInfo) =>
  !info.transcription.ready || !info.speech.ready;

export interface Turn {
  user: string;
  coach: string;
}

export type Phase = 'listening' | 'thinking' | 'speaking';

export interface ConversationEvents {
  phase(phase: Phase): void;
  heard(text: string): void;
  replied(turn: Turn): void;
}

const QUIET_S = 20;
const HISTORY = 4;

/** What Claude gets: the last few turns and what was just said, as plain text (at most 4000 characters). */
export function prompt(history: Turn[], text: string) {
  const previous = history
    .slice(-HISTORY)
    .map(t => `User: ${t.user}\nCoach: ${t.coach}`)
    .join('\n');
  return (previous ? `${previous}\nUser: ${text}` : `User: ${text}`).slice(-4000);
}

/**
 * Listen → (pause) → Claude → speak → listen again, until `signal` aborts or something fails. A quiet stretch
 * (nothing heard for 20 seconds) just listens again: it sends nothing to Claude and doesn't end the conversation.
 * One step runs at a time, so replies never overlap. Resolves when stopped; rejects with the error that ended it.
 */
export async function converse(
  client: LocalVoiceClient,
  signal: AbortSignal,
  events: ConversationEvents,
): Promise<void> {
  const history: Turn[] = [];
  const stopped = () => signal.aborted;
  try {
    while (!stopped()) {
      events.phase('listening');
      const { heard, text } = await whenIdle(() => client.listen(QUIET_S, signal));
      if (stopped()) return;
      if (!heard || !text.trim()) continue;
      events.heard(text);
      events.phase('thinking');
      const reply = await client.coach(prompt(history, text), signal);
      if (stopped()) return;
      const turn = { user: text, coach: reply };
      history.push(turn);
      if (history.length > HISTORY) history.shift();
      events.replied(turn);
      events.phase('speaking');
      await client.speak(reply, signal);
    }
  } catch (error) {
    if (stopped() || (error instanceof LocalVoiceError && error.code === 'cancelled')) return;
    throw error;
  }
}

/** Waits out a helper that is still finishing a stopped job (it answers busy for a moment). */
export async function whenIdle<T>(attempt: () => Promise<T>, tries = 10, delayMs = 300): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof LocalVoiceError && error.code === 'busy') || i >= tries) throw error;
      await new Promise<void>(resolve => setTimeout(() => resolve(), delayMs));
    }
  }
}
