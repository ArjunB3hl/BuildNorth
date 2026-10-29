import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Notice, Screen, ThemedText } from '../components/ui';
import { BACKEND_LABEL } from '../config';
import { useAccount } from '../lib/account';
import { Spacing } from '../theme';

// Profile › Rhythm account: who is signed in, where the data lives, and Sign out. Signing in happens on the sign-in
// screen that replaces the app while signed out (src/screens/sign-in.tsx).

export function AccountScreen() {
  const { account, signInAvailable, signOut } = useAccount();
  const [busy, setBusy] = useState(false);

  if (account.status !== 'signed-in') {
    return (
      <Screen title="Rhythm account">
        <Notice tone="info">
          {signInAvailable
            ? 'You’re signed out.'
            : 'Sign-in isn’t configured in this build (no EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in win/.env; see win/README.md), so the app shows demo data saved on this PC. It isn’t a Rhythm account.'}
        </Notice>
      </Screen>
    );
  }

  const { user, via } = account;
  return (
    <Screen title="Rhythm account">
      <Card style={styles.card}>
        <ThemedText type="smallBold">
          {`Signed in${user.email ? ` as ${user.email}` : ''}`}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {via === 'dev-token'
            ? `A development token for the fictional user ${user.id}.`
            : 'Today, Calendar, meals, routines, the Coach and memory come from this account, the same as on your phone and the website.'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {`Data: ${BACKEND_LABEL}.`}
        </ThemedText>
      </Card>
      <Card style={styles.card}>
        <ThemedText type="smallBold">Claude Code on this PC is separate</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Talking with Claude in Coach and the Claude coach in Camera workout
          use the Claude account signed in to Claude Code on this PC, not your
          Rhythm account. Signing out of Rhythm doesn’t sign Claude Code out
          (use claude auth logout in a terminal for that).
        </ThemedText>
      </Card>
      <View style={styles.start}>
        <Button
          title="Sign out"
          variant="secondary"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            // The app returns to the sign-in screen; nothing of this account stays in the app.
            await signOut();
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  start: { alignItems: 'flex-start' },
});
