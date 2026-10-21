import type { Href, useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

type FinalizeNavigateParams = {
  session: { currentTask?: { key: string } } | null;
  decorateUrl: (url: string) => string;
};

/**
 * `navigate` callback for signIn.finalize() / signUp.finalize(), following
 * Clerk's custom-flow guide: stop on pending session tasks, otherwise go home.
 */
export function navigateAfterAuth(router: Router, onPendingTask: (message: string) => void) {
  return ({ session, decorateUrl }: FinalizeNavigateParams) => {
    if (session?.currentTask) {
      onPendingTask(
        `Your account has a pending step (${session.currentTask.key}) that this app doesn't handle yet.`,
      );
      return;
    }
    const url = decorateUrl('/');
    if (url.startsWith('http') && typeof window !== 'undefined') {
      window.location.href = url;
    } else {
      router.replace(url as Href);
    }
  };
}
