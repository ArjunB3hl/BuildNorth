import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';

import type { StoredWorkout } from '@/lib/pose-coach';

/**
 * The camera workouts counted but not saved yet, kept on the device as reps arrive: leaving the screen, reloading or
 * closing the tab doesn't lose them, and the camera workout screen offers them again (lib/pose-coach.ts
 * restoreWorkouts). `load` returns what is stored as is, for restoreWorkouts to check.
 */
export function useCameraWorkout() {
  const { userId } = useAuth();
  const key = `buildnorth-camera-workouts-${userId}`;

  const load = useCallback(async (): Promise<unknown> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [key]);

  const save = useCallback(
    async (workouts: StoredWorkout[]) => {
      try {
        await AsyncStorage.setItem(key, JSON.stringify(workouts));
      } catch {
        // Best effort only; the workouts themselves are saved to the server with Save workout.
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
