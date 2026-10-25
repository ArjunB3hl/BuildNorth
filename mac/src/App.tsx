import { CalendarScreen } from './screens/calendar';
import { StyleSheet, View } from 'react-native';

import { Sidebar } from './components/sidebar';
import { StoreProvider } from './data/store';
import { NavigationProvider, useNav } from './navigation';
import {
  ActivityScreen,
  RoutineScreen,
  SessionScreen,
} from './screens/activity';
import { CoachScreen } from './screens/coach';
import { MealsScreen, RecipeScreen, ShoppingScreen } from './screens/meals';
import { MemoryScreen, ProfileScreen } from './screens/profile';
import { TodayScreen } from './screens/today';
import { useTheme } from './theme';

export default function App() {
  return (
    <StoreProvider>
      <NavigationProvider>
        <Shell />
      </NavigationProvider>
    </StoreProvider>
  );
}

function Shell() {
  const theme = useTheme();
  return (
    <View style={[styles.window, { backgroundColor: theme.background }]}>
      <Sidebar />
      <View style={styles.content}>
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
});
