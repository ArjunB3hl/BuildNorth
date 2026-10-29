import { readSecret, writeSecret } from '../../modules/north-win';

// Clerk sign-in for Windows. Clerk has no SDK for React Native for Windows, so this talks to the instance's
// Frontend API directly, the way @clerk/expo does on iPhone: requests carry `_is_native=1`, and the client
// token travels in the Authorization header (Clerk returns a new one in the response's Authorization header)
// instead of in cookies. The website's and phone app's flows are the reference (mobile/src/app/(auth)/sign-in.tsx
// and sign-up.tsx): a code emailed to you (or a password, then an emailed code when Clerk asks for a new-device
// check or a second factor), and a new account from an email address, a password and an emailed code. Session
// tokens for the BuildNorth API come from POST /client/sessions/{id}/tokens and last about a minute. The app holds
// only the publishable key: never a secret key, and never a browser's cookies.
//
// The client token is kept encrypted for the Windows user by NorthWin (DPAPI), like expo-secure-store's
// token cache on iPhone, so the app stays signed in across launches.

const CLIENT_SECRET = 'clerk-client';

export class ClerkError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type SignInResult =
  /** `isNew`: the account was created just now, in this app. */
  | { step: 'complete'; isNew?: boolean }
  | { step: 'code'; sentTo: string }
  | { step: 'unsupported'; status: string };

/** Clerk's error codes, said for people. Anything else shows Clerk's own message. */
const MESSAGES: Record<string, string> = {
  form_code_incorrect:
    'That code isn’t right. Check the newest email from Rhythm and try again.',
  verification_expired: 'That code has expired. Send a new code.',
  form_code_expired: 'That code has expired. Send a new code.',
  verification_failed: 'Too many wrong codes. Send a new code.',
  form_identifier_not_found:
    'There’s no Rhythm account for that email address.',
  form_password_incorrect: 'That password isn’t right.',
  form_identifier_exists:
    'There’s already a Rhythm account for that email address. Sign in instead.',
  form_password_pwned:
    'That password has appeared in a data breach. Choose a different one.',
  form_password_length_too_short: 'That password is too short.',
  form_param_format_invalid: 'Check the email address.',
  too_many_requests: 'Too many attempts. Wait a minute, then try again.',
};

export type ClerkUser = {
  id: string;
  email: string | null;
  firstName: string | null;
};

type SessionResource = {
  id: string;
  status: string;
  user?: {
    id: string;
    first_name?: string | null;
    primary_email_address_id?: string | null;
    email_addresses?: { id: string; email_address: string }[];
  };
};

type ClientResource = {
  sessions: SessionResource[];
  last_active_session_id: string | null;
};

type Factor = {
  strategy: string;
  email_address_id?: string;
  safe_identifier?: string;
};

type SignInResource = {
  id: string;
  status: string;
  created_session_id: string | null;
  supported_first_factors?: Factor[] | null;
  supported_second_factors?: Factor[] | null;
};

type SignUpResource = {
  id: string;
  status: string;
  created_session_id: string | null;
  missing_fields?: string[];
  unverified_fields?: string[];
};

/** The Frontend API host inside a publishable key (same rules as the backend's auth.py). */
export function frontendApiHost(publishableKey: string): string {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(
    publishableKey.trim(),
  );
  const decoded = match ? decodeBase64(match[2]) : '';
  const host = decoded.replace(/\$$/, '');
  if (!decoded.endsWith('$') || !host.includes('.') || host.includes('/')) {
    throw new ClerkError(
      'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key.',
    );
  }
  return host;
}

export class ClerkClient {
  private clientToken: string | null;
  private sessionId: string | null = null;
  private signIn: SignInResource | null = null;
  /** Which code the sign-in waits for: the emailed sign-in code, or a second factor / new-device check. */
  private factor: 'first' | 'second' = 'first';
  private signUp: SignUpResource | null = null;
  private codeAddressId: string | undefined;
  private sessionEnded: (() => void) | null = null;
  private cached: { jwt: string; expiresAt: number } | null = null;
  private user: ClerkUser | null = null;

  constructor(private readonly host: string) {
    this.clientToken = readSecret(CLIENT_SECRET);
  }

  get signedIn(): boolean {
    return this.sessionId != null;
  }

  get currentUser(): ClerkUser | null {
    return this.user;
  }

  /** Called when Clerk says the session is over (expired, revoked, or signed out elsewhere) while the app runs. */
  onSessionEnded(listener: (() => void) | null): void {
    this.sessionEnded = listener;
  }

  /** Restores the session saved by an earlier launch. Returns whether one is active. */
  async restore(): Promise<boolean> {
    if (!this.clientToken) {
      return false;
    }
    const { response } = await this.request<ClientResource>('GET', '/client');
    this.adoptClient(response);
    return this.signedIn;
  }

  /** Sign in with a code emailed to `email` (Clerk's email_code first factor): sends the code. */
  async sendEmailCode(email: string): Promise<SignInResult> {
    this.resetSignIn();
    let signIn: SignInResource;
    try {
      ({ response: signIn } = await this.request<SignInResource>(
        'POST',
        '/client/sign_ins',
        { identifier: email },
      ));
    } catch (error) {
      if (await this.alreadySignedIn(error)) {
        return { step: 'complete' };
      }
      throw error;
    }
    if (signIn.status === 'complete') {
      return this.continueSignIn(signIn);
    }
    const factor = signIn.supported_first_factors?.find(
      f => f.strategy === 'email_code',
    );
    if (!factor) {
      throw new ClerkError(
        'This account can’t sign in with an emailed code. Use its password instead.',
        'no_email_code',
      );
    }
    this.signIn = signIn;
    this.factor = 'first';
    this.codeAddressId = factor.email_address_id;
    await this.prepareCode();
    return { step: 'code', sentTo: factor.safe_identifier ?? email };
  }

  /** Email and password (then an emailed code if Clerk asks for one). */
  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<SignInResult> {
    this.resetSignIn();
    let response: SignInResource;
    try {
      ({ response } = await this.request<SignInResource>(
        'POST',
        '/client/sign_ins',
        { identifier: email, password, strategy: 'password' },
      ));
    } catch (error) {
      if (await this.alreadySignedIn(error)) {
        return { step: 'complete' };
      }
      throw error;
    }
    return this.continueSignIn(response);
  }

  /** A new account: email address and password, then the code Clerk emails to confirm the address. */
  async signUpWithEmail(
    email: string,
    password: string,
  ): Promise<SignInResult> {
    this.resetSignIn();
    let signUp: SignUpResource;
    try {
      ({ response: signUp } = await this.request<SignUpResource>(
        'POST',
        '/client/sign_ups',
        { email_address: email, password },
      ));
    } catch (error) {
      if (await this.alreadySignedIn(error)) {
        return { step: 'complete' };
      }
      throw error;
    }
    this.signUp = signUp;
    if (signUp.status === 'complete') {
      return this.continueSignUp(signUp);
    }
    await this.prepareCode();
    return { step: 'code', sentTo: email };
  }

  /** The emailed code, for whichever step is waiting for one. */
  async verifyEmailCode(code: string): Promise<SignInResult> {
    if (this.signUp) {
      const { response } = await this.request<SignUpResource>(
        'POST',
        `/client/sign_ups/${this.signUp.id}/attempt_verification`,
        { strategy: 'email_code', code },
      );
      return this.continueSignUp(response);
    }
    if (!this.signIn) {
      throw new ClerkError('Start over and sign in again.');
    }
    const { response } = await this.request<SignInResource>(
      'POST',
      `/client/sign_ins/${this.signIn.id}/attempt_${this.factor}_factor`,
      { strategy: 'email_code', code },
    );
    return this.continueSignIn(response);
  }

  /** Emails a new code (the one before stops working). */
  async resendCode(): Promise<void> {
    if (!this.signUp && !this.signIn) {
      throw new ClerkError('Start over and sign in again.');
    }
    await this.prepareCode();
  }

  /** Forgets an unfinished sign-in or sign-up (Start over). */
  resetSignIn(): void {
    this.signIn = null;
    this.signUp = null;
    this.factor = 'first';
    this.codeAddressId = undefined;
  }

  /**
   * A session token for the BuildNorth API (`Authorization: Bearer …`), reused until shortly before it expires.
   * `skipCache` forces a new one, as the phone app does after a 401.
   */
  async getToken(
    options: { skipCache?: boolean } = {},
  ): Promise<string | null> {
    if (!this.sessionId) {
      return null;
    }
    const now = Date.now();
    if (
      !options.skipCache &&
      this.cached &&
      this.cached.expiresAt - now > 10_000
    ) {
      return this.cached.jwt;
    }
    try {
      const body = await this.request<unknown>(
        'POST',
        `/client/sessions/${this.sessionId}/tokens`,
        {},
      );
      const jwt = (body as { jwt?: string }).jwt ?? body.response;
      if (typeof jwt !== 'string') {
        throw new ClerkError('Clerk returned no session token.');
      }
      this.cached = { jwt, expiresAt: jwtExpiry(jwt) ?? now + 50_000 };
      return jwt;
    } catch (error) {
      // The session ended elsewhere (signed out, revoked or expired): treat this app as signed out.
      if (
        error instanceof ClerkError &&
        (error.status === 401 || error.status === 404)
      ) {
        this.clearSession();
        this.sessionEnded?.();
        return null;
      }
      throw error;
    }
  }

  async signOut(): Promise<void> {
    const sessionId = this.sessionId;
    this.clearSession();
    this.resetSignIn();
    try {
      if (sessionId) {
        await this.request('POST', `/client/sessions/${sessionId}/remove`, {});
      }
    } finally {
      // A fresh client next time, like signing out of @clerk/expo clears its token cache.
      this.clientToken = null;
      writeSecret(CLIENT_SECRET, null);
    }
  }

  /** Single-session instances refuse a second sign-in while one session is active on this client. */
  private async alreadySignedIn(error: unknown): Promise<boolean> {
    if (error instanceof ClerkError && error.code === 'session_exists') {
      await this.restore();
      return this.signedIn;
    }
    return false;
  }

  /** Has Clerk email the code for the step that is waiting. */
  private async prepareCode(): Promise<void> {
    if (this.signUp) {
      await this.request(
        'POST',
        `/client/sign_ups/${this.signUp.id}/prepare_verification`,
        { strategy: 'email_code' },
      );
      return;
    }
    if (!this.signIn) {
      throw new ClerkError('Start over and sign in again.');
    }
    const form: Record<string, string> = { strategy: 'email_code' };
    if (this.codeAddressId) {
      form.email_address_id = this.codeAddressId;
    }
    await this.request(
      'POST',
      `/client/sign_ins/${this.signIn.id}/prepare_${this.factor}_factor`,
      form,
    );
  }

  private async adoptSession(sessionId: string): Promise<void> {
    this.resetSignIn();
    // Load the client so the session's user (name, email) is known.
    await this.restore();
    if (!this.signedIn) {
      this.sessionId = sessionId;
    }
  }

  private async continueSignUp(signUp: SignUpResource): Promise<SignInResult> {
    this.signUp = signUp;
    if (signUp.status === 'complete' && signUp.created_session_id) {
      await this.adoptSession(signUp.created_session_id);
      return { step: 'complete', isNew: true };
    }
    const missing = [
      ...(signUp.missing_fields ?? []),
      ...(signUp.unverified_fields ?? []),
    ];
    throw new ClerkError(
      `Your account isn’t complete yet (Clerk still needs: ${
        missing.join(', ') || signUp.status
      }). Create it on the Rhythm website instead.`,
      'sign_up_incomplete',
    );
  }

  private async continueSignIn(signIn: SignInResource): Promise<SignInResult> {
    this.signIn = signIn;
    if (signIn.status === 'complete' && signIn.created_session_id) {
      await this.adoptSession(signIn.created_session_id);
      return { step: 'complete' };
    }
    // New-device check (Client Trust) or email-code MFA: verify with a code sent by email.
    const emailCode = signIn.supported_second_factors?.find(
      f => f.strategy === 'email_code',
    );
    if (
      (signIn.status === 'needs_client_trust' ||
        signIn.status === 'needs_second_factor') &&
      emailCode
    ) {
      this.factor = 'second';
      this.codeAddressId = emailCode.email_address_id;
      await this.prepareCode();
      return {
        step: 'code',
        sentTo: emailCode.safe_identifier ?? 'your email',
      };
    }
    return { step: 'unsupported', status: signIn.status };
  }

  private adoptClient(client: ClientResource): void {
    const session =
      client.sessions.find(
        s => s.id === client.last_active_session_id && s.status === 'active',
      ) ?? client.sessions.find(s => s.status === 'active');
    if (!session) {
      this.clearSession();
      return;
    }
    this.sessionId = session.id;
    const u = session.user;
    const primary =
      u?.email_addresses?.find(e => e.id === u.primary_email_address_id) ??
      u?.email_addresses?.[0];
    this.user = u
      ? {
          id: u.id,
          email: primary?.email_address ?? null,
          firstName: u.first_name ?? null,
        }
      : null;
  }

  private clearSession(): void {
    this.sessionId = null;
    this.cached = null;
    this.user = null;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
  ): Promise<{ response: T }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.clientToken) {
      headers.Authorization = this.clientToken;
    }
    let body: string | undefined;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = Object.entries(form)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    }
    let res: Response;
    try {
      res = await fetch(`https://${this.host}/v1${path}?_is_native=1`, {
        method,
        headers,
        body,
      });
    } catch {
      throw new ClerkError(
        'Can’t reach the Rhythm sign-in service (Clerk). Check your internet connection.',
        'network',
      );
    }
    const nextClient = res.headers.get('authorization');
    if (nextClient && nextClient !== this.clientToken) {
      this.clientToken = nextClient;
      writeSecret(CLIENT_SECRET, nextClient);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const first = json?.errors?.[0];
      const code: string | undefined =
        first?.code ?? (res.status === 429 ? 'too_many_requests' : undefined);
      throw new ClerkError(
        (code && MESSAGES[code]) ??
          first?.long_message ??
          first?.message ??
          (res.status >= 500
            ? 'The Rhythm sign-in service (Clerk) isn’t answering right now. Try again in a moment.'
            : `Sign-in failed (Clerk error ${res.status}).`),
        code,
        res.status,
      );
    }
    return json as { response: T };
  }
}

/** `exp` of a JWT in milliseconds, or null if it can't be read. */
function jwtExpiry(jwt: string): number | null {
  try {
    const payload = JSON.parse(decodeBase64(jwt.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 or base64url to a string (ASCII/UTF-8), without relying on atob. */
function decodeBase64(input: string): string {
  const clean = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[=]+$/, '');
  const bytes: number[] = [];
  // Six bits per character in, eight per byte out; `buffer` holds the `bits` not yet emitted.
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) {
      return '';
    }
    buffer = buffer * 64 + value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const rest = 2 ** bits;
      bytes.push(Math.floor(buffer / rest));
      buffer %= rest;
    }
  }
  return decodeURIComponent(
    bytes.map(b => `%${b.toString(16).padStart(2, '0')}`).join(''),
  );
}
