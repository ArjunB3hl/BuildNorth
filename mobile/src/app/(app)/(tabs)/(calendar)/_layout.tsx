import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { useStackOptions } from '@/hooks/use-stack-options';

export const unstable_settings = { initialRouteName: 'calendar' };
export default function CalendarStack() {
  const options = useStackOptions();
  return <Stack screenOptions={options}>
    <Stack.Screen name="calendar" options={{ title: 'Calendar', headerShown: Platform.OS !== 'web' }} />
    <Stack.Screen name="meals" options={{ headerShown: false }} />
    <Stack.Screen name="activity" options={{ headerShown: false }} />
  </Stack>;
}
