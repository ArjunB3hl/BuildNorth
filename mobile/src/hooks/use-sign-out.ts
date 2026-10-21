import { useAuth, useClerk } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/hooks/use-api';
import { WatchConnectivity } from '@/hooks/use-watch';
import { clearUserCache } from '@/lib/query';

// Unlinking is best effort and must not hold up signing out when offline.
const WATCH_UNLINK_TIMEOUT_MS = 5_000;

/**
 * Signs out on this device. First, best effort, revokes the Apple Watch's tokens and tells the watch to
 * forget them, so it stops showing or writing this account's data; then forgets the offline copy.
 */
export function useSignOut(): () => Promise<void> {
  const api = useApi();
  const { userId } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  return async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The deadline wins even if a request ignores the abort, so signing out never waits longer than this.
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, WATCH_UNLINK_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        Promise.allSettled([api.watch.revokeAll(controller.signal), WatchConnectivity.unlink()]),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (userId) await clearUserCache(userId);
    queryClient.clear();
    await signOut();
  };
}
