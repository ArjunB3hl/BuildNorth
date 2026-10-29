import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { CLERK_PUBLISHABLE_KEY, DEV_SESSION_TOKEN } from '../config';
import { createApi, type Api } from './api';
import {
  ClerkClient,
  ClerkError,
  frontendApiHost,
  type SignInResult,
} from './clerk';

// Who is using the app. With sign-in configured (a Clerk publishable key), the app needs a signed-in Rhythm
// account: signed out, it shows only the sign-in screen (src/screens/sign-in.tsx), and signed in, the store loads
// from and writes to the Rhythm API with the account's Clerk session (src/data/remote.ts). Builds without a key
// (development, tests) run on local demo data instead.

export type AccountUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export type Account =
  | { status: 'loading' }
  /** `problem`: why the app is signed out, when that needs saying (the session ended, for one). */
  | { status: 'signed-out'; problem: string | null }
  /** A sign-in saved on this PC couldn't be checked (no network, or Clerk down): Try again, or Sign out. */
  | { status: 'offline'; problem: string }
  /** `isNew`: the account was created in this app just now, so it gets the welcome (onboarding) step. */
  | {
      status: 'signed-in';
      user: AccountUser;
      via: 'clerk' | 'dev-token';
      isNew: boolean;
    };

type AccountContextValue = {
  account: Account;
  /** The API client while signed in. */
  api: Api | null;
  /** Whether this build can sign in at all (a Clerk publishable key is configured). */
  signInAvailable: boolean;
  /** Emails a sign-in code to `email`. */
  sendCode(email: string): Promise<SignInResult>;
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  signUp(email: string, password: string): Promise<SignInResult>;
  /** The emailed code, for the sign-in or sign-up waiting for it. */
  verifyCode(code: string): Promise<SignInResult>;
  resendCode(): Promise<void>;
  resetSignIn(): void;
  /** Checks a saved sign-in again (after `offline`). */
  retry(): void;
  /** The welcome step is done (or skipped). */
  finishWelcome(): void;
  signOut(): Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export const SESSION_ENDED =
  'Your Rhythm session has ended (it expired, or you signed out on another device). Sign in again to continue.';

function makeClerk(): { clerk: ClerkClient | null; problem: string | null } {
  if (!CLERK_PUBLISHABLE_KEY) {
    return { clerk: null, problem: null };
  }
  try {
    return {
      clerk: new ClerkClient(frontendApiHost(CLERK_PUBLISHABLE_KEY)),
      problem: null,
    };
  } catch (error) {
    return {
      clerk: null,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const setup = useRef(makeClerk()).current;
  const clerk = setup.clerk;
  const [account, setAccount] = useState<Account>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const tokenSource = useCallback(
    async (fresh: boolean) =>
      DEV_SESSION_TOKEN ||
      (clerk ? clerk.getToken({ skipCache: fresh }) : null),
    [clerk],
  );
  const api = useMemo(() => createApi(tokenSource), [tokenSource]);

  const adoptClerkUser = useCallback(
    (isNew = false) => {
      const user = clerk?.currentUser;
      setAccount({
        status: 'signed-in',
        via: 'clerk',
        isNew,
        user: {
          id: user?.id ?? '',
          email: user?.email ?? null,
          name: user?.firstName ?? null,
        },
      });
    },
    [clerk],
  );

  // Clerk ended the session while the app ran (it expired, or was signed out elsewhere): back to sign-in, saying why.
  useEffect(() => {
    clerk?.onSessionEnded(() =>
      setAccount({ status: 'signed-out', problem: SESSION_ENDED }),
    );
    return () => clerk?.onSessionEnded(null);
  }, [clerk]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (DEV_SESSION_TOKEN) {
        // Local test backend only (see src/config.ts): the token names its own user.
        try {
          const me = await api.me();
          if (active) {
            setAccount({
              status: 'signed-in',
              via: 'dev-token',
              isNew: false,
              user: { id: me.userId, email: null, name: 'Local test user' },
            });
          }
        } catch (error) {
          if (active) {
            setAccount({
              status: 'signed-out',
              problem: `The development token was refused: ${describe(error)}`,
            });
          }
        }
        return;
      }
      if (!clerk) {
        if (active) {
          setAccount({ status: 'signed-out', problem: setup.problem });
        }
        return;
      }
      try {
        const restored = await clerk.restore();
        if (!active) {
          return;
        }
        if (restored) {
          adoptClerkUser();
        } else {
          setAccount({ status: 'signed-out', problem: null });
        }
      } catch (error) {
        if (!active) {
          return;
        }
        // The saved sign-in is kept: it may well be fine once Clerk can be reached.
        setAccount(
          error instanceof ClerkError &&
            (error.code === 'network' || (error.status ?? 0) >= 500)
            ? { status: 'offline', problem: describe(error) }
            : {
                status: 'signed-out',
                problem: `Your saved sign-in couldn’t be used: ${describe(
                  error,
                )} Sign in again.`,
              },
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [api, clerk, setup.problem, adoptClerkUser, attempt]);

  const value = useMemo<AccountContextValue>(() => {
    const need = () => {
      if (!clerk) {
        throw new ClerkError('Sign-in isn’t configured in this build.');
      }
      return clerk;
    };
    const finish = (result: SignInResult) => {
      if (result.step === 'complete') {
        adoptClerkUser(result.isNew === true);
      }
      return result;
    };
    return {
      account,
      api: account.status === 'signed-in' ? api : null,
      signInAvailable: clerk != null,
      sendCode: async email => finish(await need().sendEmailCode(email)),
      signInWithPassword: async (email, password) =>
        finish(await need().signInWithPassword(email, password)),
      signUp: async (email, password) =>
        finish(await need().signUpWithEmail(email, password)),
      verifyCode: async code => finish(await need().verifyEmailCode(code)),
      resendCode: () => need().resendCode(),
      resetSignIn() {
        clerk?.resetSignIn();
      },
      retry() {
        setAccount({ status: 'loading' });
        setAttempt(a => a + 1);
      },
      finishWelcome() {
        setAccount(a =>
          a.status === 'signed-in' && a.isNew ? { ...a, isNew: false } : a,
        );
      },
      async signOut() {
        setAccount({ status: 'signed-out', problem: null });
        await clerk?.signOut().catch(() => {});
      },
    };
  }, [account, api, clerk, adoptClerkUser]);

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) {
    throw new Error('useAccount must be used inside AccountProvider');
  }
  return value;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
