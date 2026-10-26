import { readState, writeState } from '../../modules/north-win';
import type { SampleData } from '../data/sample';

// The store is saved as JSON by the NorthWin module, in the app package's local folder
// (LocalState\buildnorth.json), so plans, check-ins and preferences survive quitting the app.
// Expo's storage modules (expo-sqlite on the Mac) have no Windows implementation.
// Without NorthWin (Jest) nothing is saved.

export function loadState(): SampleData | null {
  try {
    const raw = readState();
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.plan) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(state: SampleData): void {
  writeState(JSON.stringify(state));
}
