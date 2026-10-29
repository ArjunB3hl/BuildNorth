import { useSignUp } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { Button, FormScreen, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Wordmark } from '@/components/wordmark';
import { navigateAfterAuth } from '@/lib/auth-navigation';
import { describeError } from '@/lib/errors';

export default function SignUpScreen() {
  const { signUp, fetchStatus } = useSignUp();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const busy = fetchStatus === 'fetching';

  async function onSignUp() {
    setFormError(null);
    if (!emailAddress.trim() || !password) {
      setFormError('Enter an email address and a password.');
      return;
    }
    const { error } = await signUp.password({ emailAddress: emailAddress.trim(), password });
    if (error) {
      setFormError(describeError(error));
      return;
    }
    const { error: sendError } = await signUp.verifications.sendEmailCode();
    if (sendError) {
      setFormError(describeError(sendError));
      return;
    }
    setAwaitingCode(true);
  }

  async function onVerify() {
    setFormError(null);
    setInfo(null);
    const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (error) {
      setFormError(describeError(error));
      return;
    }
    if (signUp.status !== 'complete') {
      const missing = signUp.missingFields.join(', ') || 'unknown fields';
      setFormError(`Sign-up isn't complete yet. Clerk still needs: ${missing}.`);
      return;
    }
    const { error: finalizeError } = await signUp.finalize({
      navigate: navigateAfterAuth(router, setFormError, '/onboarding'),
    });
    if (finalizeError) setFormError(describeError(finalizeError));
  }

  async function onResend() {
    setFormError(null);
    const { error } = await signUp.verifications.sendEmailCode();
    if (error) setFormError(describeError(error));
    else setInfo('A new code is on its way.');
  }

  return (
    <FormScreen>
      {Platform.OS !== 'web' ? <Wordmark /> : null}
      <ThemedText type="subtitle">Create account</ThemedText>

      {awaitingCode ? (
        <>
          <ThemedText themeColor="textSecondary">
            Enter the code we emailed to {emailAddress.trim()}.
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
          {info && <Notice tone="info">{info}</Notice>}
          <Button title="Verify email" onPress={onVerify} loading={busy} disabled={!code.trim()} />
          <Button title="Send a new code" variant="secondary" onPress={onResend} disabled={busy} />
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
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="Create a password"
          />
          {formError && <Notice tone="error">{formError}</Notice>}
          <Button title="Continue" onPress={onSignUp} loading={busy} />
          <ThemedText type="small" themeColor="textSecondary">
            Already have an account?{' '}
            <Link href="/sign-in" replace>
              <ThemedText type="linkPrimary">Sign in</ThemedText>
            </Link>
          </ThemedText>
        </>
      )}

      {/* Clerk's bot protection renders here on web; harmless on native. */}
      <View nativeID="clerk-captcha" />
    </FormScreen>
  );
}
