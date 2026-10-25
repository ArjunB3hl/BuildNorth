import { createClerkClient } from '@clerk/chrome-extension/client';
import { apiFor } from './api';
import type { LearningAccount } from './learning';
import { syncHostFor } from './website-sign-in';

/**
 * The service worker's view of the Clerk sign-in. Like the panel's, Clerk's background client reads the website's
 * Clerk cookie from the sync host first, and otherwise the client token the panel stores in chrome.storage.local, so
 * it is signed in exactly when the panel is. No token is kept here: each request asks Clerk for a fresh session token.
 * Docs: https://clerk.com/docs/reference/chrome-extension/create-clerk-client
 */
type Clerk = Awaited<ReturnType<typeof createClerkClient>>;
let loading: Promise<Clerk> | undefined;

export async function signedInAccount(): Promise<LearningAccount | null> {
  const publishableKey = import.meta.env.WXT_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey || publishableKey.includes('replace_with')) return null;
  loading ??= createClerkClient({ publishableKey, background: true, syncHost: syncHostFor(import.meta.env) });
  try {
    const clerk = await loading;
    const session = clerk.session, userId = clerk.user?.id;
    if (!session || !userId) { loading = undefined; return null; }
    const api = apiFor(async () => {
      try { return await session.getToken(); } catch { loading = undefined; return null; }
    });
    return { userId, recordSignal: (signal) => api.recordSignal(signal) };
  } catch {
    loading = undefined;
    return null;
  }
}

/** Sign-in changed on the website or in the panel: load it again next time. */
export function forgetSignedInAccount() {
  loading = undefined;
}
