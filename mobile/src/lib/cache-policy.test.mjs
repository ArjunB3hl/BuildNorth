// Run: node --experimental-strip-types --test src/lib/*.test.mjs   (Node 22.6+; the flag is the default from 23.6)
// Uses the app's real TanStack Query packages, wired the way query.tsx wires them, with an in-memory persister.
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { persistQueryClientSubscribe } from '@tanstack/query-persist-client-core';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { forgetDeletedData, shouldPersistQuery } from './cache-policy.ts';

const HEALTH = { date: '2026-10-21', sleepMinutes: 412, restingHeartRateBpm: 58, hrvSdnnMs: 42 };

/** A QueryClient persisted like UserQueryProvider does; `saved()` is what the device copy holds now. */
function persistedClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let stored = null;
  const unsubscribe = persistQueryClientSubscribe({
    queryClient,
    persister: {
      persistClient: async (client) => {
        stored = structuredClone(client);
      },
      restoreClient: async () => stored ?? undefined,
      removeClient: async () => {
        stored = null;
      },
    },
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
  const saved = () => Object.fromEntries((stored?.clientState.queries ?? []).map((q) => [q.queryHash, q.state.data]));
  const clear = async () => {
    stored = null;
  };
  return { queryClient, saved, clear, unsubscribe };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('shouldPersistQuery: watch health values, memory search and status never reach the device copy', () => {
  const query = (key, status = 'success') => ({ queryKey: key, state: { status } });
  assert.equal(shouldPersistQuery(query(['watch-health', '2026-10-21'])), false);
  assert.equal(shouldPersistQuery(query(['memory-search', 'sleep'])), false);
  assert.equal(shouldPersistQuery(query(['status'])), false);
  assert.equal(shouldPersistQuery(query(['pose-coach', 'live'])), false);
  assert.equal(shouldPersistQuery(query(['recipes'])), true);
  assert.equal(shouldPersistQuery(query(['watch-settings'])), true);
  assert.equal(shouldPersistQuery(query(['recipes'], 'error')), false);
  assert.equal(shouldPersistQuery(query(['recipes'], 'pending')), false);
});

test('persisting: an inactive watch-health query is kept in memory but never saved', async () => {
  const { queryClient, saved, unsubscribe } = persistedClient();
  queryClient.setQueryData(['watch-health', '2026-10-21'], { days: [HEALTH] });
  queryClient.setQueryData(['recipes'], [{ id: 'r1' }]);
  await settle();
  assert.deepEqual(Object.keys(saved()), ['["recipes"]']);
  unsubscribe();
});

test('forgetDeletedData: nothing deleted is written back after the device copy is cleared', async () => {
  const { queryClient, saved, clear, unsubscribe } = persistedClient();
  queryClient.setQueryData(['profile'], { name: 'Arjun' });
  queryClient.setQueryData(['recipes'], [{ id: 'r1' }]); // inactive: nothing shows it
  queryClient.setQueryData(['watch-health', '2026-10-21'], { days: [HEALTH] });
  // An active query, as on a mounted screen; the server now returns an empty plan.
  queryClient.setQueryData(['plan'], [{ id: 'p1' }]);
  const plan = new QueryObserver(queryClient, { queryKey: ['plan'], queryFn: async () => [], staleTime: Infinity });
  const shown = [];
  const stopObserving = plan.subscribe((result) => shown.push(result.data));
  await settle();
  assert.ok(saved()['["recipes"]'], 'precondition: the recipes were persisted');

  await forgetDeletedData(queryClient, clear);
  await settle();

  // Only the profile (kept so the deletion report stays on screen) and the refetched, now empty plan remain.
  assert.deepEqual(saved(), { '["profile"]': { name: 'Arjun' }, '["plan"]': [] });
  // Inactive queries are gone from memory too, health values included.
  assert.equal(queryClient.getQueryData(['recipes']), undefined);
  assert.equal(queryClient.getQueryData(['watch-health', '2026-10-21']), undefined);
  // The mounted screen stopped showing the deleted plan and got the fresh one.
  assert.deepEqual(shown.at(-1), []);
  assert.deepEqual(queryClient.getQueryData(['plan']), []);

  stopObserving();
  unsubscribe();
});

test('forgetDeletedData: clears the device copy only after the deleted queries are gone', async () => {
  const { queryClient, unsubscribe } = persistedClient();
  queryClient.setQueryData(['recipes'], [{ id: 'r1' }]);
  let leftWhenCleared;
  await forgetDeletedData(queryClient, async () => {
    leftWhenCleared = queryClient.getQueryCache().findAll().map((q) => q.queryKey[0]);
  });
  assert.deepEqual(leftWhenCleared, []);
  unsubscribe();
});
