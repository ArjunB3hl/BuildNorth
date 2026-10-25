import type { NativeStackNavigationOptions } from 'expo-router/native-stack';

import { Accent } from '@/components/form';
import { useTheme } from '@/hooks/use-theme';

/** Web pages get a slim, left-aligned title bar instead of the phone's large-title header. */
export function useStackOptions(): NativeStackNavigationOptions {
  const theme = useTheme();
  return {
    headerTintColor: Accent,
    headerTitleAlign: 'left',
    headerTitleStyle: { color: theme.text, fontSize: 17, fontWeight: '600' },
    headerStyle: { backgroundColor: theme.background },
    headerShadowVisible: true,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: theme.background },
  };
}
