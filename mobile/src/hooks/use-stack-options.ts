import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import { createElement } from 'react';

import { Accent } from '@/components/form';
import { DemoBadge } from '@/components/wordmark';
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
    headerRight: () => createElement(DemoBadge),
    contentStyle: { backgroundColor: theme.background },
  };
}
