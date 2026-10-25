import type { QueryClient } from '@tanstack/react-query';

/** Refresh everything that shows plan items after a plan change. */
export async function invalidatePlan(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['calendar'] }),
    queryClient.invalidateQueries({ queryKey: ['plan'] }),
    queryClient.invalidateQueries({ queryKey: ['today'] }),
    queryClient.invalidateQueries({ queryKey: ['progress'] }),
    queryClient.invalidateQueries({ queryKey: ['assistant-proposals'] }),
  ]);
}
