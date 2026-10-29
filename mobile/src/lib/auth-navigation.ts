import type { Href, useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

type FinalizeNavigateParams = {
  session: { currentTask?: { key: string } } | null;
  decorateUrl: (url: string) => string;
};

/**
 * `navigate` callback for signIn.finalize() / signUp.finalize(), following
 * Clerk's custom-flow guide: stop on pending session tasks, otherwise use the
 * caller's destination (home for sign-in, onboarding for sign-up).
 */
export function navigateAfterAuth(router: Router, onPendingTask: (message: string) => void, destinationAfterAuth = '/') {
  return ({ session, decorateUrl }: FinalizeNavigateParams) => {
    if (session?.currentTask) {
      onPendingTask(
        `Your account has a pending step (${session.currentTask.key}) that this app doesn't handle yet.`,
      );
      return;
    }
    // A browser handoff stores only its opaque request code in this tab, never a session token.
    let destination = destinationAfterAuth;
    try {
      if (typeof window !== 'undefined') {
        const stored = window.sessionStorage.getItem('rhythm-mac-sign-in');
        if (stored) {
          const pending = JSON.parse(stored);
          if (typeof pending.until === 'number' && pending.until > Date.now() &&
            typeof pending.code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(pending.code)) destination = '/mac-connect';
          else window.sessionStorage.removeItem('rhythm-mac-sign-in');
        }
      }
    } catch { /* Storage can be unavailable in a browser's privacy mode. */ }
    const url = decorateUrl(destination);
    if (url.startsWith('http') && typeof window !== 'undefined') {
      window.location.href = url;
    } else {
      router.replace(url as Href);
    }
  };
}
