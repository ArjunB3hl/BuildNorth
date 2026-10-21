import { Stack } from 'expo-router';

import { useStackOptions } from '@/hooks/use-stack-options';

export default function MealsLayout() {
  const options = useStackOptions();
  return (
    <Stack screenOptions={options}>
      <Stack.Screen name="index" options={{ title: 'Meals', headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: 'Recipe' }} />
      <Stack.Screen name="import" options={{ title: 'Add a recipe' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit recipe' }} />
      <Stack.Screen name="cook" options={{ title: 'Cooking', presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="shopping" options={{ title: 'Shopping list' }} />
    </Stack>
  );
}
