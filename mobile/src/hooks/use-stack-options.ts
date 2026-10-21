import type { NativeStackNavigationOptions } from 'expo-router/native-stack';

import { Accent } from '@/components/form';
import { useTheme } from '@/hooks/use-theme';

/** Consistent native headers for every tab's stack. */
export function useStackOptions(): NativeStackNavigationOptions {
  const theme = useTheme();
  return {
    headerTintColor: Accent,
    headerTitleStyle: { color: theme.text },
    headerLargeTitleStyle: { color: theme.text },
    headerStyle: { backgroundColor: theme.background },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: theme.background },
  };
}
