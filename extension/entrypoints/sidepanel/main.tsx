import React, { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkFailed, ClerkLoading, ClerkProvider, Show, SignIn, UserButton, useAuth } from '@clerk/chrome-extension';
import { DEFAULT_WEB_APP_URL, differsFromWebsite, syncHostFor, watchWebsiteSignIn } from '../../lib/website-sign-in';
import { App } from './App';
import { Brand } from './ui';
import './style.css';

const key = import.meta.env.WXT_CLERK_PUBLISHABLE_KEY;
const url = chrome.runtime.getURL('/sidepanel.html');
const syncHost = syncHostFor(import.meta.env);
const signInPage = `${(import.meta.env.WXT_WEB_APP_URL || DEFAULT_WEB_APP_URL).replace(/\/+$/, '')}/sign-in`;

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const subscribe = (onChange: () => void) => {
  darkQuery.addEventListener('change', onChange);
  return () => darkQuery.removeEventListener('change', onChange);
};

/** Clerk in the web app's colours (style.css). Clerk needs plain colour values, so dark mode is passed in. */
function appearance(dark: boolean) {
  return {
    variables: {
      colorPrimary: '#208AEF', colorPrimaryForeground: '#FFFFFF', borderRadius: '12px', fontFamily: 'Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif',
      ...(dark
        ? { colorBackground: '#161619', colorForeground: '#EDEDEF', colorMutedForeground: '#A0A1AB', colorNeutral: '#FFFFFF',
          colorInput: '#0B0B0D', colorInputForeground: '#EDEDEF' }
        : { colorBackground: '#FFFFFF', colorForeground: '#16171A', colorMutedForeground: '#5F6470' }),
    },
    elements: { cardBox: { boxShadow: 'none', border: '1px solid var(--border)', borderRadius: '16px' } },
  };
}

// Clerk doesn't support OAuth or social sign-in in a side panel, so only the email and password form is shown.
const signInOnly = { elements: { socialButtonsRoot: { display: 'none' }, dividerRow: { display: 'none' }, footerAction: { display: 'none' } } };

function Welcome({ children }: { children: ReactNode }) {
  return <main className="welcome"><Brand size={40} />{children}</main>;
}

/**
 * Clerk reads the website's sign-in only when the panel opens. When it changes on the website (signed in, signed out,
 * another account), reload the panel so it shows the same.
 */
function FollowWebsite() {
  const { isLoaded, userId } = useAuth();
  const shown = useRef<string | null | undefined>(undefined);
  shown.current = isLoaded ? userId ?? null : undefined;
  useEffect(() => watchWebsiteSignIn(chrome.cookies, syncHost, (website) => {
    if (shown.current !== undefined && differsFromWebsite(shown.current, website)) location.reload();
  }), []);
  return null;
}

function SignedOut() {
  return <Welcome>
    <p>Rhythm uses your Rhythm sign-in. Sign in on the website, and this panel signs in with you.</p>
    <button type="button" className="primary" onClick={() => void chrome.tabs.create({ url: signInPage })}>
      Sign in on the Rhythm website
    </button>
    <p className="muted">Already signed in there, or still seeing this? Close this panel and open it again.</p>
    <details>
      <summary>Sign in here with email and password</summary>
      <SignIn routing="hash" appearance={signInOnly} />
    </details>
  </Welcome>;
}

function Root() {
  const dark = useSyncExternalStore(subscribe, () => darkQuery.matches);
  if (!key || key.includes('replace_with')) {
    return <Welcome><p>Finish the local setup to sign in.</p>
      <p>Add your public Clerk configuration to the extension’s environment file and rebuild.</p></Welcome>;
  }
  return <ClerkProvider publishableKey={key} syncHost={syncHost} afterSignOutUrl={url} signInFallbackRedirectUrl={url}
    signUpFallbackRedirectUrl={url} appearance={appearance(dark)}
    localization={{ signIn: { start: { title: 'Sign in to Rhythm', subtitle: 'Use your Rhythm account' } } }}>
    <FollowWebsite />
    <ClerkLoading><Welcome><p>Loading sign-in…</p></Welcome></ClerkLoading>
    <ClerkFailed><Welcome><p>Sign-in could not load. Check your connection and reopen Rhythm.</p></Welcome></ClerkFailed>
    <Show when="signed-out"><SignedOut /></Show>
    <Show when="signed-in"><App account={<UserButton />} /></Show>
  </ClerkProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
