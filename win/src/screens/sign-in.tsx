import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Notice, TextField, ThemedText } from '../components/ui';
import { BACKEND_LABEL } from '../config';
import { describe, useAccount } from '../lib/account';
import { ClerkError, type SignInResult } from '../lib/clerk';
import { MaxContentWidth, Spacing, useTheme } from '../theme';

// The whole window while signed out (sign-in is configured in every real build): the website's and phone app's
// steps, inside the app. By default a code emailed to you; or your password (then an emailed code if Clerk asks
// for a new-device check); or a new account (email, password, emailed code), which then gets the welcome step.
// What you type goes only to Rhythm's sign-in service (Clerk); this PC keeps the sign-in encrypted for your
// Windows account (src/lib/clerk.ts).

type Mode = 'code' | 'password' | 'create';

const TITLES: Record<Mode, string> = {
  code: 'Sign in to Rhythm',
  password: 'Sign in to Rhythm',
  create: 'Create your Rhythm account',
};

export function SignInScreen() {
  const theme = useTheme();
  const {
    account,
    sendCode,
    signInWithPassword,
    signUp,
    verifyCode,
    resendCode,
    resetSignIn,
  } = useAccount();
  const [mode, setMode] = useState<Mode>('code');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(
    null,
  );
  const [info, setInfo] = useState<string | null>(null);

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await step();
    } catch (e) {
      setError({
        text: describe(e),
        code: e instanceof ClerkError ? e.code : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  // ('complete' needs nothing here: the account changes, and the app replaces this screen)
  const handle = (result: SignInResult) => {
    if (result.step === 'code') {
      setCodeSentTo(result.sentTo);
      setCode('');
    } else if (result.step === 'unsupported') {
      throw new Error(
        `Sign-in needs a step this app doesn’t support yet (${result.status}). Sign in on the Rhythm website.`,
      );
    }
  };

  const submit = () =>
    run(async () => {
      const address = email.trim();
      if (!address) {
        throw new Error('Enter your email address.');
      }
      if (mode === 'code') {
        handle(await sendCode(address));
        return;
      }
      if (!password) {
        throw new Error(
          mode === 'create' ? 'Choose a password.' : 'Enter your password.',
        );
      }
      handle(
        await (mode === 'create'
          ? signUp(address, password)
          : signInWithPassword(address, password)),
      );
    });

  const verify = () =>
    run(async () => {
      if (!code.trim()) {
        throw new Error('Enter the code from the email.');
      }
      handle(await verifyCode(code.trim()));
    });

  const resend = () =>
    run(async () => {
      await resendCode();
      setCode('');
      setInfo('A new code is on its way. Only the newest code works.');
    });

  const startOver = () => {
    resetSignIn();
    setCodeSentTo(null);
    setCode('');
    setPassword('');
    setError(null);
    setInfo(null);
  };

  const switchTo = (next: Mode) => {
    startOver();
    setMode(next);
  };

  const problem = account.status === 'signed-out' ? account.problem : null;

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.column}>
        <ThemedText type="title" accessibilityRole="header">
          {codeSentTo ? 'Check your email' : TITLES[mode]}
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Your Rhythm account keeps Today, Calendar, meals, routines and the
          Coach the same on this PC, your phone and the website.
        </ThemedText>
        {problem ? <Notice tone="warning">{problem}</Notice> : null}

        {codeSentTo ? (
          <Card style={styles.card}>
            <ThemedText>
              {`We emailed a code to ${codeSentTo}. Enter it here; it works for a few minutes.`}
            </ThemedText>
            <TextField
              label="Code from the email"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={12}
              onSubmitEditing={verify}
            />
            {error ? <Notice tone="error">{error.text}</Notice> : null}
            {info ? <Notice tone="info">{info}</Notice> : null}
            <View style={styles.row}>
              <Button
                title={mode === 'create' ? 'Create account' : 'Sign in'}
                onPress={verify}
                loading={busy}
                disabled={!code.trim()}
              />
              <Button
                title="Send a new code"
                variant="secondary"
                onPress={resend}
                disabled={busy}
              />
              <Button
                title="Start over"
                variant="quiet"
                onPress={startOver}
                disabled={busy}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.card}>
            <TextField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              onSubmitEditing={mode === 'code' ? submit : undefined}
            />
            {mode !== 'code' ? (
              <TextField
                label={mode === 'create' ? 'Choose a password' : 'Password'}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={mode === 'create' ? 'At least 8 characters' : ''}
                onSubmitEditing={submit}
              />
            ) : null}
            {error ? <Notice tone="error">{error.text}</Notice> : null}
            {error?.code === 'form_identifier_not_found' ? (
              <View style={styles.start}>
                <Button
                  title="Create an account with this email"
                  variant="secondary"
                  size="small"
                  onPress={() => {
                    const address = email;
                    switchTo('create');
                    setEmail(address);
                  }}
                />
              </View>
            ) : null}
            <View style={styles.row}>
              <Button
                title={
                  mode === 'code'
                    ? 'Email me a sign-in code'
                    : mode === 'create'
                    ? 'Create account'
                    : 'Sign in'
                }
                onPress={submit}
                loading={busy}
              />
              {mode === 'create' ? (
                <Button
                  title="I already have an account"
                  variant="quiet"
                  onPress={() => switchTo('code')}
                  disabled={busy}
                />
              ) : (
                <Button
                  title={
                    mode === 'code'
                      ? 'Use my password instead'
                      : 'Use an emailed code instead'
                  }
                  variant="quiet"
                  onPress={() => switchTo(mode === 'code' ? 'password' : 'code')}
                  disabled={busy}
                />
              )}
            </View>
            {mode !== 'create' ? (
              <View style={styles.start}>
                <Button
                  title="New to Rhythm? Create an account"
                  variant="quiet"
                  size="small"
                  onPress={() => switchTo('create')}
                  disabled={busy}
                />
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                We’ll email you a code to confirm the address.
              </ThemedText>
            )}
          </Card>
        )}

        <ThemedText type="small" themeColor="textSecondary">
          {`Signing in to ${BACKEND_LABEL}. Your email, password and codes go only to Rhythm’s sign-in service (Clerk); this PC keeps your sign-in encrypted for your Windows account.`}
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.five, paddingVertical: Spacing.six },
  column: {
    width: '100%',
    maxWidth: Math.min(MaxContentWidth, 560),
    alignSelf: 'center',
    gap: Spacing.three,
  },
  card: { gap: Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  start: { alignItems: 'flex-start' },
});
