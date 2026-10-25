import { Stack } from 'expo-router';

import { useStackOptions } from '@/hooks/use-stack-options';

export default function ProfileLayout() {
  const options = useStackOptions();
  return (
    <Stack screenOptions={options}>
      <Stack.Screen name="index" options={{ title: 'Profile', headerLargeTitle: true }} />
      <Stack.Screen name="edit" options={{ title: 'Preferences & goals' }} />
      <Stack.Screen name="memory" options={{ title: 'What Rhythm remembers' }} />
      <Stack.Screen name="data" options={{ title: 'Your data' }} />
      <Stack.Screen name="connections" options={{ title: 'AI connections' }} />
      <Stack.Screen name="downloads" options={{ title: 'Get Rhythm' }} />
      <Stack.Screen name="watch" options={{ title: 'Apple Watch' }} />
      <Stack.Screen name="interests" options={{ title: 'Interests & sharing' }} />
      <Stack.Screen name="videos" options={{ title: 'Content library' }} />
    </Stack>
  );
}
