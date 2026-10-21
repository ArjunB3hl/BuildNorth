import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';

import type { SessionEntry } from '@/lib/types';

/** An in-progress workout, kept on the device so closing the app doesn't lose it. */
export type ActiveSession = {
  routineId: string;
  routineName: string;
  planItemId: string | null;
  startedAt: string;
  current: number;
  entries: SessionEntry[];
};

export function useActiveSession() {
  const { userId } = useAuth();
  const key = `buildnorth-active-session-${userId}`;

  const load = useCallback(async (): Promise<ActiveSession | null> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as ActiveSession) : null;
    } catch {
      return null;
    }
  }, [key]);

  const save = useCallback(
    async (session: ActiveSession) => {
      try {
        await AsyncStorage.setItem(key, JSON.stringify(session));
      } catch {
        // Best effort only; the session itself is saved to the server on finish.
      }
    },
    [key],
  );

  const clear = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [key]);

  return { load, save, clear };
}
