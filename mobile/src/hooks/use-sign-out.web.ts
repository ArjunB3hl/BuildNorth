import { useAuth, useClerk } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { clearUserCache } from '@/lib/query';

/** Signing out of a browser must not unlink the user's Apple Watch. */
export function useSignOut(): () => Promise<void> {
  const { userId } = useAuth();
  const { signOut } = useClerk();
  const client = useQueryClient();
  return async () => {
    if (userId) await clearUserCache(userId);
    client.clear();
    await signOut();
  };
}
