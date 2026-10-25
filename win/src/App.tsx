import { CalendarScreen } from './screens/calendar';
import { StyleSheet, View } from 'react-native';

import { Sidebar } from './components/sidebar';
import { Button, Notice } from './components/ui';
import { StoreProvider, useStore } from './data/store';
import { AccountProvider } from './lib/account';
import { AccountScreen } from './screens/account';
import { NavigationProvider, useNav } from './navigation';
import {
  ActivityScreen,
  RoutineScreen,
  SessionScreen,
} from './screens/activity';
import { CoachScreen } from './screens/coach';
import { ConnectionsScreen } from './screens/connections';
import { ClaudeDemoProvider } from './lib/claude-demo';
import { MealsScreen, RecipeScreen, ShoppingScreen } from './screens/meals';
import { MemoryScreen, ProfileScreen } from './screens/profile';
import { TodayScreen } from './screens/today';
import { useTheme } from './theme';

export default function App() {
  return (
    <AccountProvider>
      <StoreProvider>
        <ClaudeDemoProvider>
          <NavigationProvider>
            <Shell />
          </NavigationProvider>
        </ClaudeDemoProvider>
      </StoreProvider>
    </AccountProvider>
  );
}

function Shell() {
  const theme = useTheme();
  return (
    <View style={[styles.window, { backgroundColor: theme.background }]}>
      <Sidebar />
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
    case 'account':
      return <AccountScreen />;
    case 'root':
      switch (section) {
        case 'today':
          return <TodayScreen />;
        case 'coach':
          return <CoachScreen />;
        case 'calendar':
          return <CalendarScreen />;
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
