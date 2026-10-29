// App settings from win/.env (and .env.local), inlined at bundle time by Expo CLI: only EXPO_PUBLIC_* values,
// which are public. See .env.example. Restart `npm start` after changing them.

/** The Rhythm (BuildNorth) API, e.g. https://buildnorth.onrender.com or a local backend. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

/** Clerk publishable key (pk_test_… / pk_live_…). Without it, sign-in is off and the app stays in demo mode. */
export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

/** The Rhythm website, for what the Windows app links out to (account connections, sign-up). */
export const WEB_URL = (
  process.env.EXPO_PUBLIC_WEB_URL || 'https://rhythm-buildnorth.expo.app'
).replace(/\/+$/, '');

/**
 * Development only: a ready-made session token, used instead of a Clerk sign-in. It's for the local test
 * backend (tools/local-backend/serve.py), which signs tokens for a fictional user; real Clerk tokens expire
 * within a minute, so this is no way around signing in to a real backend. Ignored in release bundles.
 */
export const DEV_SESSION_TOKEN = __DEV__
  ? process.env.EXPO_PUBLIC_DEV_SESSION_TOKEN || ''
  : '';

/** Whether API_URL is a backend on this PC (the local test backend): test data, never a live Rhythm account. */
export const LOCAL_BACKEND = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
  API_URL,
);

/** Where this build's data lives, said plainly (sign-in screen, sidebar, account page). */
export const BACKEND_LABEL = LOCAL_BACKEND
  ? `Local test backend (${API_URL}): test data only, not your live Rhythm account`
  : `Rhythm (${API_URL.replace(/^https?:\/\//, '')})`;
