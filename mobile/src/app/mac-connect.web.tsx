import { useAuth, useClerk, useUser } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, FormScreen, LoadingScreen, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { API_URL } from '@/lib/api';

const KEY = 'rhythm-mac-sign-in';

export default function MacConnect() {
  const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const clerk = useClerk();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    let restored = '';
    if (/^[A-Za-z0-9_-]{43}$/.test(fragment)) {
      sessionStorage.setItem(KEY, JSON.stringify({ code: fragment, until: Date.now() + 180000 }));
      restored = fragment;
    } else {
      try {
        const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (saved?.until > Date.now() && /^[A-Za-z0-9_-]{43}$/.test(saved.code)) restored = saved.code;
        else sessionStorage.removeItem(KEY);
      } catch { sessionStorage.removeItem(KEY); }
    }
    const timer = window.setTimeout(() => setCode(restored), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function approve() {
    setBusy(true); setError('');
    try {
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error('Please sign in first.');
      const result = await fetch(`${API_URL}/mac-sign-in/approve`, { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, expected_user_id: userId, expected_session_id: sessionId }) });
      if (result.status === 409) throw new Error('Your browser account changed. Review it and try again.');
      if (result.status === 429) throw new Error('Too many attempts. Please wait before trying again.');
      if (result.status === 503) throw new Error('Browser sign-in is currently unavailable.');
      if (!result.ok) throw new Error('This request expired or was already used. Start again in the Mac app.');
      sessionStorage.removeItem(KEY); setCode(''); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect. Try again.'); }
    finally { setBusy(false); }
  }

  if (!isLoaded) return <LoadingScreen label="Checking your session…" />;
  if (isSignedIn && (!userLoaded || !user || user.id !== userId || !sessionId)) return <LoadingScreen label="Checking your account…" />;
  return <FormScreen>
    <ThemedText type="subtitle">Connect Rhythm on your Mac</ThemedText>
    {done ? <Notice tone="success">Approved. Return to the Rhythm Mac app to finish signing in.</Notice> :
      !code ? <Notice tone="error">This request is missing or expired. Start again in the Mac app.</Notice> :
      !isSignedIn ? <>
        <ThemedText>Sign in to your Rhythm account in this browser, then approve the Mac request.</ThemedText>
        <Link href="/sign-in"><ThemedText type="linkPrimary">Sign in to Rhythm</ThemedText></Link>
      </> : <>
        <ThemedText>Continue as {user?.primaryEmailAddress?.emailAddress ?? user?.username ?? userId}?</ThemedText>
        <ThemedText themeColor="textSecondary">Only approve this if you started sign-in in the Rhythm Mac app.</ThemedText>
        <Button title="Approve Mac sign-in" onPress={approve} loading={busy} />
        <Button title="Sign out in this browser to switch accounts" variant="secondary" disabled={busy} onPress={async () => {
          await clerk.signOut(); router.replace('/sign-in');
        }} />
      </>}
    {error ? <Notice tone="error">{error}</Notice> : null}
  </FormScreen>;
}
