import { useAuth } from '@clerk/expo';
import { useMemo } from 'react';

import { createApi, type Api } from '@/lib/api';

/** API client that attaches the signed-in user's Clerk session token to each request. */
export function useApi(): Api {
  const { getToken } = useAuth();
  return useMemo(() => createApi((fresh) => getToken(fresh ? { skipCache: true } : undefined)), [getToken]);
}
