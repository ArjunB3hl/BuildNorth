import { useSignIn } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, FormScreen, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { navigateAfterAuth } from '@/lib/auth-navigation';
import { describeError } from '@/lib/errors';

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = fetchStatus === 'fetching';

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
      setNeedsCode(true);
      return;
    }
    setFormError(`Sign-in needs a step this app doesn't support yet (${signIn.status}).`);
  }

  async function onVerify() {
    setFormError(null);
    const { error } = await signIn.mfa.verifyEmailCode({ code: code.trim() });
    if (error) {
      setFormError(describeError(error));
      return;
    }
    if (signIn.status === 'complete') {
      await finish();
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
          <Button title="Verify" onPress={onVerify} loading={busy} disabled={!code.trim()} />
          <Button title="Start over" variant="secondary" onPress={onStartOver} disabled={busy} />
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
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            placeholder="Your password"
          />
          {formError && <Notice tone="error">{formError}</Notice>}
          <Button title="Sign in" onPress={onSignIn} loading={busy} />
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
