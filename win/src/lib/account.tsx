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

// Who is using the app. Signed out, the Windows app runs on its local demo data (as the Mac app does). Signed
// in, the store loads from and writes to the Rhythm API with the account's Clerk session (src/data/remote.ts).

export type AccountUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export type Account =
  | { status: 'loading' }
  | { status: 'signed-out'; problem: string | null }
  | { status: 'signed-in'; user: AccountUser; via: 'clerk' | 'dev-token' };

type AccountContextValue = {
  account: Account;
  /** The API client while signed in. */
  api: Api | null;
  /** Whether this build can sign in at all (a Clerk publishable key is configured). */
  signInAvailable: boolean;
  signIn(email: string, password: string): Promise<SignInResult>;
  verifyCode(code: string): Promise<SignInResult>;
  resetSignIn(): void;
  signOut(): Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

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

  const tokenSource = useCallback(
    async (fresh: boolean) =>
      DEV_SESSION_TOKEN ||
      (clerk ? clerk.getToken({ skipCache: fresh }) : null),
    [clerk],
  );
  const api = useMemo(() => createApi(tokenSource), [tokenSource]);

  const adoptClerkUser = useCallback(() => {
    const user = clerk?.currentUser;
    setAccount({
      status: 'signed-in',
      via: 'clerk',
      user: {
        id: user?.id ?? '',
        email: user?.email ?? null,
        name: user?.firstName ?? null,
      },
    });
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
        if (active) {
          setAccount({
            status: 'signed-out',
            problem: `Couldn’t restore your sign-in: ${describe(error)}`,
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [api, clerk, setup.problem, adoptClerkUser]);

  const value = useMemo<AccountContextValue>(
    () => ({
      account,
      api: account.status === 'signed-in' ? api : null,
      signInAvailable: clerk != null,
      async signIn(email, password) {
        if (!clerk) {
          throw new ClerkError('Sign-in isn’t configured in this build.');
        }
        const result = await clerk.signInWithPassword(email, password);
        if (result.step === 'complete') {
          adoptClerkUser();
        }
        return result;
      },
      async verifyCode(code) {
        if (!clerk) {
          throw new ClerkError('Sign-in isn’t configured in this build.');
        }
        const result = await clerk.verifyEmailCode(code);
        if (result.step === 'complete') {
          adoptClerkUser();
        }
        return result;
      },
      resetSignIn() {
        clerk?.resetSignIn();
      },
      async signOut() {
        setAccount({ status: 'signed-out', problem: null });
        await clerk?.signOut().catch(() => {});
      },
    }),
    [account, api, clerk, adoptClerkUser],
  );

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
