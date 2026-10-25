/** Reuse this repository's public Clerk configuration; no secret values are copied or printed. */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
const phone = read(fileURLToPath(new URL('../../mobile/.env', import.meta.url)));
const own = read(`${root}/.env`);
const key = process.env.WXT_CLERK_PUBLISHABLE_KEY || own.WXT_CLERK_PUBLISHABLE_KEY || phone.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (!key || key.includes('replace_with')) throw new Error('Configure the public Clerk key in extension/.env or mobile/.env.');
const host = Buffer.from(key.replace(/^pk_(test|live)_/, ''), 'base64').toString().replace(/\$$/, '');
// Without one, wxt.config.ts derives the sync host from the web app (http://localhost for http://localhost:8081).
const syncHost = process.env.WXT_CLERK_SYNC_HOST || own.WXT_CLERK_SYNC_HOST;
const result = spawnSync('npm', ['run', 'build'], {
  cwd: root, stdio: 'inherit',
  env: {
    ...process.env,
    WXT_CLERK_PUBLISHABLE_KEY: key,
    WXT_CLERK_FRONTEND_API: process.env.WXT_CLERK_FRONTEND_API || own.WXT_CLERK_FRONTEND_API || `https://${host}`,
    WXT_API_URL: process.env.WXT_API_URL || own.WXT_API_URL || 'http://localhost:8000',
    ...(syncHost ? { WXT_CLERK_SYNC_HOST: syncHost } : {}),
  },
});
process.exit(result.status ?? 1);
