import { Stack } from 'expo-router';

import { useStackOptions } from '@/hooks/use-stack-options';

export default function ActivityLayout() {
  const options = useStackOptions();
  return (
    <Stack screenOptions={options}>
      <Stack.Screen name="index" options={{ title: 'Activity', headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: 'Routine' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit routine' }} />
      <Stack.Screen name="import" options={{ title: 'Describe a workout' }} />
      <Stack.Screen name="run" options={{ title: 'Session', presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="session/[id]" options={{ title: 'Session' }} />
    </Stack>
  );
}
