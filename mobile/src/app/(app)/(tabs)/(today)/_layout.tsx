import { Stack } from 'expo-router';

import { useStackOptions } from '@/hooks/use-stack-options';

export default function TodayLayout() {
  const options = useStackOptions();
  return (
    <Stack screenOptions={options}>
      <Stack.Screen name="index" options={{ title: 'Today', headerLargeTitle: true }} />
    </Stack>
  );
}
