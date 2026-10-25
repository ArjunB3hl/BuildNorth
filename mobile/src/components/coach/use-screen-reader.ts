import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Whether VoiceOver or TalkBack is running, as a ref for event handlers. Phones can skip views that
 * are still transparent, so the coach shows a new reply whole for them instead of fading it in.
 * Always false on the web, where faded text stays in the accessibility tree (and react-native-web
 * reports a screen reader as always on).
 */
export function useScreenReaderRef() {
  const enabled = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (live) enabled.current = on;
    });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => {
      enabled.current = on;
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}
