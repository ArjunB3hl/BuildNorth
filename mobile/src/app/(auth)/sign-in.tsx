import { useSignIn } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { Button, FormScreen, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Wordmark } from '@/components/wordmark';
import { navigateAfterAuth } from '@/lib/auth-navigation';
import { API_URL } from '@/lib/api';
import { describeError } from '@/lib/errors';

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [codeKind, setCodeKind] = useState<'first' | 'second'>('first');
  const [usePassword, setUsePassword] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = fetchStatus === 'fetching';
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserFinishing, setBrowserFinishing] = useState(false);
  const handoff = useRef<{ code: string; proof: string; cancelled: boolean } | null>(null);
  const handoffGeneration = useRef(0);
  const finishingRef = useRef(false);

  function macBridge(): { postMessage: (code: string) => void } | undefined {
    return (window as unknown as { webkit?: { messageHandlers?: { rhythmAuth?: { postMessage: (code: string) => void } } } })
      .webkit?.messageHandlers?.rhythmAuth;
  }

  async function cancelBrowser(force = false) {
    if (finishingRef.current && !force) return;
    handoffGeneration.current += 1;
    const active = handoff.current;
    setBrowserBusy(false);
    if (!active) return;
    active.cancelled = true;
    handoff.current = null;
    await fetch(`${API_URL}/mac-sign-in/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: active.code, proof: active.proof }), cache: 'no-store' }).catch(() => {});
  }

  useEffect(() => () => { void cancelBrowser(true); }, []); // A restart abandons the in-memory proof.

  async function continueInBrowser() {
    const bridge = macBridge();
    if (!bridge || browserBusy) return;
    const generation = ++handoffGeneration.current;
    setFormError(null); setBrowserBusy(true);
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const proof = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof));
      const challenge = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      const start = await fetch(`${API_URL}/mac-sign-in/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge }), cache: 'no-store' });
      if (start.status === 429) throw new Error('Too many sign-in attempts. Please wait and try again.');
      if (!start.ok) throw new Error('Browser sign-in is unavailable. Try email code or password.');
      const { code, expires_in: expiresIn } = await start.json();
      if (!/^[A-Za-z0-9_-]{43}$/.test(code) || typeof expiresIn !== 'number') throw new Error('Browser sign-in is unavailable.');
      if (handoffGeneration.current !== generation) {
        await fetch(`${API_URL}/mac-sign-in/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, proof }), cache: 'no-store' }).catch(() => {});
        return;
      }
      const active = { code, proof, cancelled: false };
      handoff.current = active;
      bridge.postMessage(code);
      const deadline = Date.now() + Math.min(expiresIn, 180) * 1000;
      while (!active.cancelled && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (active.cancelled) return;
        const result = await fetch(`${API_URL}/mac-sign-in/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, proof }), cache: 'no-store' });
        if (result.status === 429) throw new Error('Too many sign-in attempts. Please wait and try again.');
        if (!result.ok) throw new Error('Browser sign-in expired or could not finish. Start again.');
        const data = await result.json();
        if (active.cancelled || handoffGeneration.current !== generation) return;
        if (data.status === 'pending') continue;
        if (data.status !== 'ready' || typeof data.ticket !== 'string') throw new Error('Browser sign-in could not finish.');
        handoff.current = null;
        finishingRef.current = true;
        setBrowserFinishing(true);
        const { error } = await signIn.ticket({ ticket: data.ticket });
        if (handoffGeneration.current !== generation) {
          await signIn.reset();
          return;
        }
        if (error) throw new Error(describeError(error));
        if (signIn.status !== 'complete') throw new Error('Sign-in needs an additional step. Use email code or password.');
        await finish();
        return;
      }
      if (!active.cancelled) throw new Error('Browser sign-in expired. Start again.');
    } catch (error) {
      if (handoffGeneration.current === generation) {
        if (handoff.current) await cancelBrowser();
        setFormError(error instanceof Error ? error.message : 'Browser sign-in could not finish.');
      }
    } finally {
      finishingRef.current = false;
      if (handoffGeneration.current === generation) { setBrowserBusy(false); setBrowserFinishing(false); }
    }
  }

  async function finish() {
    const { error } = await signIn.finalize({ navigate: navigateAfterAuth(router, setFormError) });
    if (error) setFormError(describeError(error));
  }

  async function onSignIn() {
    setFormError(null);
    if (!emailAddress.trim() || !password) {
      setFormError('Enter your email address and password.');
      return;
    }
    const { error } = await signIn.password({ emailAddress: emailAddress.trim(), password });
    if (error) {
      setFormError(describeError(error));
      return;
    }
    if (signIn.status === 'complete') {
      await finish();
      return;
    }
    // New-device check (Client Trust) or email-code MFA: verify with a code sent by email.
    const canUseEmailCode = signIn.supportedSecondFactors.some((f) => f.strategy === 'email_code');
    if (
      (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') &&
      canUseEmailCode
    ) {
      const { error: sendError } = await signIn.mfa.sendEmailCode();
      if (sendError) {
        setFormError(describeError(sendError));
        return;
      }
      setCodeKind('second');
      setNeedsCode(true);
      return;
    }
    setFormError(`Sign-in needs a step this app doesn't support yet (${signIn.status}).`);
  }

  async function onSendCode() {
    setFormError(null);
    if (!emailAddress.trim()) {
      setFormError('Enter your email address.');
      return;
    }
    const { error } = await signIn.emailCode.sendCode({ emailAddress: emailAddress.trim() });
    if (error) { setFormError(describeError(error)); return; }
    setCodeKind('first');
    setNeedsCode(true);
  }

  async function onVerify() {
    setFormError(null);
    const { error } = codeKind === 'first'
      ? await signIn.emailCode.verifyCode({ code: code.trim() })
      : await signIn.mfa.verifyEmailCode({ code: code.trim() });
    if (error) {
      setFormError(describeError(error));
      return;
    }
    if (signIn.status === 'complete') {
      await finish();
    } else if (codeKind === 'first' &&
      (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') &&
      signIn.supportedSecondFactors.some((f) => f.strategy === 'email_code')) {
      const { error: sendError } = await signIn.mfa.sendEmailCode();
      if (sendError) { setFormError(describeError(sendError)); return; }
      setCodeKind('second');
      setCode('');
    } else {
      setFormError(`Sign-in isn't complete yet (${signIn.status}).`);
    }
  }

  async function onStartOver() {
    await signIn.reset();
    setNeedsCode(false);
    setCode('');
    setFormError(null);
  }

  return (
    <FormScreen>
      {Platform.OS !== 'web' ? <Wordmark /> : null}
      <ThemedText type="subtitle">Sign in</ThemedText>

      {needsCode ? (
        <>
          <ThemedText themeColor="textSecondary">
            We sent a verification code to {emailAddress.trim()}.
          </ThemedText>
          <TextField
            label="Verification code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="123456"
          />
          {formError && <Notice tone="error">{formError}</Notice>}
          <Button title="Verify" onPress={onVerify} loading={busy} disabled={!code.trim() || browserBusy} />
          <Button title="Start over" variant="secondary" onPress={onStartOver} disabled={busy || browserBusy} />
        </>
      ) : (
        <>
          <TextField
            label="Email address"
            value={emailAddress}
            onChangeText={setEmailAddress}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
            editable={!browserBusy}
          />
          {usePassword ? <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            placeholder="Your password"
            editable={!browserBusy}
          /> : null}
          {formError && <Notice tone="error">{formError}</Notice>}
          <Button title={usePassword ? 'Sign in' : 'Send sign-in code'} onPress={usePassword ? onSignIn : onSendCode} loading={busy} disabled={browserBusy} />
          <Button title={usePassword ? 'Use an email code' : 'Use a password'} variant="secondary" onPress={() => { setUsePassword(!usePassword); setFormError(null); }} disabled={busy || browserBusy} />
          {Platform.OS === 'web' && typeof window !== 'undefined' && macBridge() ? (
            <Button title={browserFinishing ? 'Finishing sign-in…' : browserBusy ? 'Cancel browser sign-in' : 'Continue in browser'} variant="secondary"
              onPress={browserBusy ? () => { void cancelBrowser(); } : continueInBrowser} disabled={busy || browserFinishing} />
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            No account yet?{' '}
            <Link href="/sign-up" replace>
              <ThemedText type="linkPrimary">Create one</ThemedText>
            </Link>
          </ThemedText>
        </>
      )}
    </FormScreen>
  );
}
