import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { appDataDirectoryUri } from '../../modules/north-mac';
import type { SampleData } from '../data/sample';

// The store is saved in a SQLite database (expo-sqlite) so plans, check-ins and preferences
// survive quitting the app. It lives in ~/Library/Application Support/<bundle id>, given by the
// NorthMac module as a file:// URL: expo-sqlite's default directory is ~/Documents for an
// unsandboxed Mac app, and a plain path would lose the space in "Application Support".
// Without NorthMac (Jest) nothing is saved.

const KEY = 'state/v1';

let db: SQLiteDatabase | null | undefined;

function database(): SQLiteDatabase | null {
  if (db === undefined) {
    try {
      db = appDataDirectoryUri
        ? openDatabaseSync('buildnorth.db', undefined, appDataDirectoryUri)
        : null;
      db?.execSync(
        'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
      );
    } catch {
      db = null;
    }
  }
  return db;
}

export function loadState(): SampleData | null {
  try {
    const row = database()?.getFirstSync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      KEY,
    );
    const parsed = row ? JSON.parse(row.value) : null;
    return parsed && Array.isArray(parsed.plan) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(state: SampleData): void {
  database()
    ?.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      KEY,
      JSON.stringify(state),
    )
    .catch(() => {});
}
