import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

function serviceOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Rhythm requires HTTPS except for a local development backend.');
  }
  if (url.username || url.password) throw new Error('Do not put credentials in a service URL.');
  return url.origin;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: () => {
    // A dashboard link needs no host permission and never transfers cookies or tokens.
    serviceOrigin(import.meta.env.WXT_WEB_APP_URL || 'http://localhost:8081');
    const backend = serviceOrigin(import.meta.env.WXT_API_URL || 'http://localhost:8000');
    const clerk = import.meta.env.WXT_CLERK_FRONTEND_API
      ? serviceOrigin(import.meta.env.WXT_CLERK_FRONTEND_API) : null;
    return {
      name: 'Rhythm — your interests, your videos',
      description: 'Choose YouTube videos that fit the interests Rhythm learns from your activity, with your own agent.',
      minimum_chrome_version: '116',
      // cookies is required by Clerk's extension SDK; alarms runs learning's 30-second playback checks.
      permissions: ['activeTab', 'scripting', 'sidePanel', 'storage', 'cookies', 'alarms'],
      // Host access is limited to Clerk and our backend.
      host_permissions: [backend, ...(clerk ? [clerk] : [])].map((origin) => `${origin}/*`),
      // Requested only when you turn on learning, and removed when you turn it off.
      optional_host_permissions: ['https://www.youtube.com/*'],
      action: { default_title: 'Use Rhythm on this page' },
      ...(import.meta.env.WXT_CRX_PUBLIC_KEY ? { key: import.meta.env.WXT_CRX_PUBLIC_KEY } : {}),
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
    };
  },
  hooks: {
    // The service worker uses only Clerk's background client (lib/worker-session.ts). Clerk's sign-in UI, which its
    // other code path loads with a dynamic import, never runs in a worker: replace it with an empty module so the
    // worker stays one small classic script (service workers can't use dynamic imports anyway).
    'vite:build:extendConfig': (entrypoints, config) => {
      if (!entrypoints.some((entry) => entry.type === 'background')) return;
      const empty = '\0rhythm:no-clerk-ui';
      config.plugins = [...(config.plugins ?? []), {
        name: 'rhythm:no-clerk-ui-in-worker', enforce: 'pre',
        resolveId: (id: string) => id === '@clerk/ui/no-rhc' ? empty : null,
        load: (id: string) => id === empty ? 'export const ui = undefined;' : null,
      }];
      config.build ??= {};
      config.build.rollupOptions ??= {};
      const output = config.build.rollupOptions.output;
      if (Array.isArray(output)) throw new Error('Unexpected background output configuration.');
      config.build.rollupOptions.output = { ...output, codeSplitting: false };
    },
  },
  vite: () => ({
    server: { fs: { allow: [
      fileURLToPath(new URL('.', import.meta.url)),
      fileURLToPath(new URL('../mobile/src/lib/rhythm.ts', import.meta.url)),
      fileURLToPath(new URL('../mobile/backend/app/rhythm/relevance-rules.json', import.meta.url)),
    ] } },
  }),
});
