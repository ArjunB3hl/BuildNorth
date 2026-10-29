import { CalendarScreen } from './screens/calendar';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Sidebar, TopBar } from './components/sidebar';
import { Button, Notice, ThemedText } from './components/ui';
import { DEV_SESSION_TOKEN } from './config';
import { StoreProvider, useStore } from './data/store';
import { AccountProvider, useAccount } from './lib/account';
import { AccountScreen } from './screens/account';
import { NavigationProvider, useNav } from './navigation';
import {
  ActivityScreen,
  RoutineScreen,
  SessionScreen,
} from './screens/activity';
import { CameraScreen } from './screens/camera';
import { CoachScreen } from './screens/coach';
import { ConnectionsScreen } from './screens/connections';
import { ClaudeDemoProvider } from './lib/claude-demo';
import { MealsScreen, RecipeScreen, ShoppingScreen } from './screens/meals';
import { DownloadsScreen } from './screens/downloads';
import { InterestsScreen } from './screens/interests';
import { LibraryScreen } from './screens/library';
import { OverviewScreen } from './screens/overview';
import { MemoryScreen, ProfileScreen } from './screens/profile';
import { SignInScreen } from './screens/sign-in';
import {
  EditProfileScreen,
  needsWelcome,
  WelcomeScreen,
} from './screens/welcome';
import { useTheme } from './theme';

export default function App() {
  return (
    <AccountProvider>
      <Gate />
    </AccountProvider>
  );
}

/**
 * Signed out, a build with sign-in shows only the sign-in screen: no screen of the app, and no account's data.
 * Signed in, everything below is keyed by the account, so switching accounts starts the store, the navigation and
 * every screen afresh (nothing of the previous account shows). Builds without sign-in run on demo data.
 */
function Gate() {
  const { account, signInAvailable, retry, signOut } = useAccount();
  const theme = useTheme();
  const requiresSignIn = signInAvailable || DEV_SESSION_TOKEN !== '';
  if (requiresSignIn && account.status !== 'signed-in') {
    if (account.status === 'loading') {
      return (
        <View style={[styles.centre, { backgroundColor: theme.background }]}>
          <ThemedText type="subtitle">Checking your sign-in…</ThemedText>
        </View>
      );
    }
    if (account.status === 'offline') {
      return (
        <View style={[styles.centre, { backgroundColor: theme.background }]}>
          <ThemedText type="subtitle">Can’t check your sign-in</ThemedText>
          <Notice tone="warning">{account.problem}</Notice>
          <ThemedText themeColor="textSecondary">
            You’re still signed in on this PC. Try again when you’re online, or
            sign out to use another account.
          </ThemedText>
          <View style={styles.actions}>
            <Button title="Try again" onPress={retry} />
            <Button title="Sign out" variant="secondary" onPress={signOut} />
          </View>
        </View>
      );
    }
    return <SignInScreen />;
  }
  return (
    <SignedInApp
      key={account.status === 'signed-in' ? account.user.id : 'demo'}
    />
  );
}

function SignedInApp() {
  return (
    <StoreProvider>
      <ClaudeDemoProvider>
        <NavigationProvider>
          <Shell />
        </NavigationProvider>
      </ClaudeDemoProvider>
    </StoreProvider>
  );
}

function Shell() {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= 900;
  const { account } = useAccount();
  const { state } = useStore();
  if (
    account.status === 'signed-in' &&
    needsWelcome(account.isNew, state.profile)
  ) {
    return (
      <View style={[styles.window, { backgroundColor: theme.background }]}>
        <WelcomeScreen />
      </View>
    );
  }
  // The website's breakpoint: a sidebar from 900 points wide, a bar of links across the top below that.
  return (
    <View
      style={[
        styles.window,
        !wide && styles.column,
        { backgroundColor: theme.background },
      ]}
    >
      {wide ? <Sidebar /> : <TopBar />}
      <View style={styles.content}>
        <SyncBanner />
        <CurrentPage />
      </View>
    </View>
  );
}

function CurrentPage() {
  const { section, route } = useNav();
  switch (route.name) {
    case 'recipe':
      return <RecipeScreen key={route.id} id={route.id} />;
    case 'shopping':
      return <ShoppingScreen />;
    case 'routine':
      return <RoutineScreen key={route.id} id={route.id} />;
    case 'session':
      return <SessionScreen key={route.id} id={route.id} />;
    case 'memory':
      return <MemoryScreen />;
    case 'connections':
      return <ConnectionsScreen />;
    case 'edit-profile':
      return <EditProfileScreen />;
    case 'account':
      return <AccountScreen />;
    case 'root':
      switch (section) {
        case 'overview':
          return <OverviewScreen />;
        case 'coach':
          return <CoachScreen />;
        case 'calendar':
          return <CalendarScreen />;
        case 'camera':
          return <CameraScreen />;
        case 'library':
          return <LibraryScreen />;
        case 'interests':
          return <InterestsScreen />;
        case 'downloads':
          return <DownloadsScreen />;
        case 'meals':
          return <MealsScreen />;
        case 'activity':
          return <ActivityScreen />;
        case 'profile':
          return <ProfileScreen />;
      }
  }
}

const styles = StyleSheet.create({
  window: { flex: 1, flexDirection: 'row' },
  column: { flexDirection: 'column' },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  actions: { flexDirection: 'row', gap: 8 },
  content: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
});

/** Signed in: a change the server refused or never got (it has been undone on screen). */
function SyncBanner() {
  const { syncError, dismissSyncError } = useStore();
  if (!syncError) {
    return null;
  }
  return (
    <View style={styles.banner}>
      <View style={styles.content}>
        <Notice tone="error">
          {`Not saved to your Rhythm account: ${syncError}`}
        </Notice>
      </View>
      <Button
        title="Dismiss"
        size="small"
        variant="quiet"
        onPress={dismissSyncError}
      />
    </View>
  );
}
