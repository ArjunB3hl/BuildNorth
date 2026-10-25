// What the on-device query cache may keep. Kept free of React Native imports (types only) so
// src/lib/cache-policy.test.mjs can run it under plain Node against a real QueryClient.
import type { Query, QueryClient } from '@tanstack/react-query';

/**
 * Never written to AsyncStorage: memory search results and server status (live answers, not saved content),
 * and Apple Watch health summaries (device-measured sleep, heart rate and HRV stay on the server only).
 */
const NOT_PERSISTED = new Set(['memory-search', 'status', 'watch-health', 'rhythm', 'rhythm-interests', 'pose-coach']);

/** Only successful reads of saved content are persisted for offline use. */
export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  return query.state.status === 'success' && !NOT_PERSISTED.has(String(query.queryKey[0]));
}

/**
 * After "Delete all my data": drop every cached query except the profile (so the deletion report stays on
 * screen; onboarding starts again the next time the profile loads), then clear the device copy.
 *
 * The order matters. The persister re-saves whatever the cache holds on every cache change, so clearing first
 * would write the deleted data straight back. Queries nothing is showing are removed; the ones on screen are
 * reset (no data) and refetched, so no screen keeps showing what was deleted.
 */
export async function forgetDeletedData(queryClient: QueryClient, clearPersisted: () => Promise<void>): Promise<void> {
  const deleted = (query: Query) => query.queryKey[0] !== 'profile';
  queryClient.removeQueries({ predicate: (query) => deleted(query) && query.getObserversCount() === 0 });
  void queryClient.resetQueries({ predicate: deleted });
  await clearPersisted();
}
