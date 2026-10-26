import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Notice,
  Screen,
  TextField,
  ThemedText,
} from '../components/ui';
import { API_URL, WEB_URL } from '../config';
import { describe, useAccount } from '../lib/account';
import { useNav } from '../navigation';
import { Spacing } from '../theme';

// Sign in to a Rhythm account (Profile › Rhythm account). The same steps as the phone app's sign-in screen:
// email and password, then an emailed code when Clerk asks for one. Accounts are created on the website or
// the phone; the Windows app only signs in.

export function AccountScreen() {
  const { account, signInAvailable, signIn, verifyCode, resetSignIn, signOut } =
    useAccount();
  const nav = useNav();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.status === 'signed-in') {
    return (
      <Screen title="Rhythm account">
        <Card>
          <ThemedText type="smallBold">
            Signed in
            {account.user.email ? ` as ${account.user.email}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {account.via === 'dev-token'
              ? `Development token for ${account.user.id} on ${API_URL}.`
              : `Today, Calendar, meals, routines, Coach and memory come from your account on ${API_URL}.`}
          </ThemedText>
        </Card>
        <View style={styles.start}>
          <Button
            title="Sign out"
            variant="secondary"
            onPress={async () => {
              await signOut();
              nav.back();
            }}
          />
        </View>
      </Screen>
    );
  }

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const handle = (result: Awaited<ReturnType<typeof signIn>>) => {
    if (result.step === 'complete') {
      nav.back();
    } else if (result.step === 'code') {
      setCodeSentTo(result.sentTo);
    } else {
      setError(
        `Sign-in needs a step this app doesn’t support yet (${result.status}). Sign in on the website or phone.`,
      );
    }
  };

  const onSignIn = () =>
    run(async () => {
      if (!email.trim() || !password) {
        throw new Error('Enter your email address and password.');
      }
      handle(await signIn(email.trim(), password));
    });

  const onVerify = () => run(async () => handle(await verifyCode(code.trim())));

  return (
    <Screen
      title="Sign in"
      subtitle="Use your Rhythm account to sync this PC with your phone and the website."
    >
      {account.status === 'signed-out' && account.problem ? (
        <Notice tone="error">{account.problem}</Notice>
      ) : null}
      {!signInAvailable ? (
        <Notice tone="info">
          Sign-in isn’t configured in this build. Set
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in win/.env and restart the dev
          server (see win/README.md). Until then the app uses local demo data.
        </Notice>
      ) : codeSentTo ? (
        <Card>
          <ThemedText>We sent a verification code to {codeSentTo}.</ThemedText>
          <TextField
            label="Verification code"
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            accessibilityLabel="Verification code"
            onSubmitEditing={onVerify}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <View style={styles.row}>
            <Button
              title="Verify"
              onPress={onVerify}
              loading={busy}
              disabled={!code.trim()}
            />
            <Button
              title="Start over"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                resetSignIn();
                setCodeSentTo(null);
                setCode('');
                setError(null);
              }}
            />
          </View>
        </Card>
      ) : (
        <Card>
          <TextField
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            accessibilityLabel="Email address"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Your password"
            accessibilityLabel="Password"
            onSubmitEditing={onSignIn}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <View style={styles.row}>
            <Button title="Sign in" onPress={onSignIn} loading={busy} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            No account yet? Create one on the website or the phone app, then
            sign in here.
          </ThemedText>
          <View style={styles.start}>
            <Button
              title="Open the Rhythm website"
              variant="quiet"
              size="small"
              onPress={() => Linking.openURL(`${WEB_URL}/sign-up`)}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  start: { alignItems: 'flex-start' },
});
