import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api';
import { shouldPersistQuery } from '@/lib/cache-policy';
import { planDraftKeyFor } from '@/lib/plan-draft';

const CACHE_PREFIX = 'buildnorth-cache-v1-';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function cacheKeyFor(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

/** Forget a user's offline copy and unsaved plan draft (on sign-out or data deletion). */
export async function clearUserCache(userId: string) {
  try {
    await AsyncStorage.multiRemove([cacheKeyFor(userId), planDraftKeyFor(userId)]);
  } catch {
    // Nothing cached or storage unavailable; nothing to clear.
  }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: WEEK_MS,
        retry: (failureCount, error) =>
          failureCount < 2 && !(error instanceof ApiError && error.kind === 'http' && (error.status ?? 500) < 500),
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Query cache for one signed-in user. Saved content (recipes, routines, plan…) is
 * persisted per user so it stays readable offline; it is keyed by the Clerk user ID
 * so accounts on the same device never see each other's cache.
 */
export function UserQueryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [client] = useState(makeClient);
  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: AsyncStorage, key: cacheKeyFor(userId), throttleTime: 1000 }),
  );
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: WEEK_MS,
        dehydrateOptions: {
          // Only persist successful reads of saved content; never AI drafts, memory search or watch health values.
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}>
      {children}
    </PersistQueryClientProvider>
  );
}
