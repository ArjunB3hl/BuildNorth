import { createRhythmApi } from '../../mobile/src/lib/rhythm';

export function apiFor(getToken: () => Promise<string | null>) {
  const base = (import.meta.env.WXT_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
  return createRhythmApi(async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    // Credentials never leave an extension page. Injected scripts receive only bounded operation arguments.
    const token = await getToken();
    if (!token) throw new Error('Sign in again to continue.');
    const response = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000), credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Your sign-in expired. Sign in again.');
      if (response.status === 422) throw new Error('Some details need correcting. Refresh and try again.');
      throw new Error("Rhythm couldn't reach your account. Check the server connection.");
    }
    return response.json() as Promise<T>;
  });
}
