import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Spacing } from '@/constants/theme';

/**
 * Bottom padding for a fixed bar (composer, save button) on a screen inside the native tabs.
 * Native tabs float over content, so the bar must clear the tab bar and the home indicator;
 * while the keyboard is open it covers the tab bar, so only a small gap is needed.
 */
export function useBottomBarInset(aboveTabBar = true): number {
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardOpen) return Spacing.two;
  return insets.bottom + (aboveTabBar ? BottomTabInset : 0) + Spacing.two;
}
