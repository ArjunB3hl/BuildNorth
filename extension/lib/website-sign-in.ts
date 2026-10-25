/**
 * The BuildNorth website's sign-in, shared with the extension through Clerk's Sync Host
 * (https://clerk.com/docs/guides/sessions/sync-host). The panel's and the worker's Clerk read the website's Clerk
 * cookie from the sync host with chrome.cookies, so whoever is signed in on the website is signed in here too. A
 * development instance keeps that cookie (`__clerk_db_jwt`) on the website's own host, whatever its port; a production
 * instance keeps its client cookie on the Frontend API domain.
 */

export const DEFAULT_WEB_APP_URL = 'http://localhost:8081';

type SyncHostEnv = {
  readonly [name: string]: unknown;
  WXT_CLERK_SYNC_HOST?: string; WXT_WEB_APP_URL?: string; WXT_CLERK_PUBLISHABLE_KEY?: string; WXT_CLERK_FRONTEND_API?: string;
};

/** WXT_CLERK_SYNC_HOST if set; otherwise the website's host for a development key, or the Frontend API for a live one. */
export function syncHostFor(env: SyncHostEnv): string {
  if (env.WXT_CLERK_SYNC_HOST) return new URL(env.WXT_CLERK_SYNC_HOST).origin;
  const key = env.WXT_CLERK_PUBLISHABLE_KEY ?? '';
  if (key.startsWith('pk_live_')) {
    return new URL(env.WXT_CLERK_FRONTEND_API || `https://${atob(key.slice('pk_live_'.length)).replace(/\$$/, '')}`).origin;
  }
  const web = new URL(env.WXT_WEB_APP_URL || DEFAULT_WEB_APP_URL);
  return `${web.protocol}//${web.hostname}`;
}

// Clerk's cookies on the website: `__client_uat` changes when its sign-in does ("0" while signed out), and `__session`
// holds the signed-in session's token. Their suffixed copies (`__client_uat_…`) change at the same time.
const SIGNED_IN_AT = '__client_uat', SESSION = '__session';

export type WebsiteSignIn = { signedIn: false } | { signedIn: true; userId?: string };

/** What the website's cookies say. The token is only decoded to compare users; it's never verified, kept or sent. */
export function websiteSignIn(signedInAt?: string, session?: string): WebsiteSignIn {
  if (!signedInAt || signedInAt === '0') return { signedIn: false };
  try {
    const { sub } = JSON.parse(atob(session!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return { signedIn: true, userId: typeof sub === 'string' ? sub : undefined };
  } catch {
    return { signedIn: true };
  }
}

/** Whether a panel signed in as `userId` (null when signed out) shows something other than the website's sign-in. */
export function differsFromWebsite(userId: string | null, website: WebsiteSignIn): boolean {
  if (!website.signedIn) return userId !== null;
  return userId === null || (website.userId !== undefined && website.userId !== userId);
}

type CookieChange = { cookie: { name: string; domain: string }; removed: boolean; cause: string };

/**
 * Whether a cookie change is the website's sign-in changing on the sync host. Chrome reports an overwritten cookie as
 * a removal followed by the new cookie; only the new one counts.
 */
export function isSignInChange(change: CookieChange, syncHost: string, names: readonly string[] = [SIGNED_IN_AT]): boolean {
  if (!names.includes(change.cookie.name) || (change.removed && change.cause === 'overwrite')) return false;
  const host = new URL(syncHost).hostname, domain = change.cookie.domain.replace(/^\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

type Cookies = {
  get(details: { url: string; name: string }): Promise<{ value: string } | null | undefined>;
  onChanged: {
    addListener(listener: (change: CookieChange) => void): void;
    removeListener(listener: (change: CookieChange) => void): void;
  };
};

export async function readWebsiteSignIn(cookies: Cookies, syncHost: string): Promise<WebsiteSignIn> {
  const [signedInAt, session] = await Promise.all([SIGNED_IN_AT, SESSION].map((name) =>
    cookies.get({ url: syncHost, name }).catch(() => null)));
  return websiteSignIn(signedInAt?.value, session?.value);
}

/** Calls `onChange` with the website's sign-in once its cookies settle after a change. Returns the unsubscribe. */
export function watchWebsiteSignIn(cookies: Cookies, syncHost: string, onChange: (website: WebsiteSignIn) => void, settleMs = 750) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listener = (change: CookieChange) => {
    if (!isSignInChange(change, syncHost, [SIGNED_IN_AT, SESSION])) return;
    clearTimeout(timer);
    timer = setTimeout(() => void readWebsiteSignIn(cookies, syncHost).then(onChange), settleMs);
  };
  cookies.onChanged.addListener(listener);
  return () => {
    clearTimeout(timer);
    cookies.onChanged.removeListener(listener);
  };
}
