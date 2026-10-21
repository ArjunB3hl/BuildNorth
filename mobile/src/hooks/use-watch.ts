import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import * as WatchConnectivity from '../../modules/watch-connectivity';

export { WatchConnectivity };
export type { WatchState } from '../../modules/watch-connectivity';

// useSyncExternalStore needs the same object back while nothing changed.
let snapshot = WatchConnectivity.getState();

function getSnapshot(): WatchConnectivity.WatchState {
  const next = WatchConnectivity.getState();
  const keys = Object.keys(next) as (keyof WatchConnectivity.WatchState)[];
  if (keys.some((key) => next[key] !== snapshot[key])) snapshot = next;
  return snapshot;
}

function subscribe(onChange: () => void): () => void {
  const stopListening = WatchConnectivity.addStateListener(onChange);
  // Pairing and installing the watch app happen in Apple's Watch app, so check again on return.
  const appState = AppState.addEventListener('change', (status) => {
    if (status === 'active') onChange();
  });
  return () => {
    stopListening();
    appState.remove();
  };
}

/** Live Apple Watch connection state; all false when this build has no watch bridge (Expo Go, Android, web). */
export function useWatchState(): WatchConnectivity.WatchState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
