import { useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { displayCookie, readDisplayPreference, type DisplayPreference } from '@/lib/browser-preferences';

function snapshot() {
  try { return readDisplayPreference(document.cookie); } catch { return null; }
}
function subscribe(notify: () => void) {
  window.addEventListener('buildnorth-cookie-change', notify);
  window.addEventListener('focus', notify);
  return () => {
    window.removeEventListener('buildnorth-cookie-change', notify);
    window.removeEventListener('focus', notify);
  };
}

export function WebCookieSettings() {
  const preference = useSyncExternalStore(subscribe, snapshot, () => null);
  const [message, setMessage] = useState('');

  function save(value: DisplayPreference | null) {
    try {
      document.cookie = displayCookie(value, location.protocol === 'https:');
      const stored = readDisplayPreference(document.cookie);
      window.dispatchEvent(new Event('buildnorth-cookie-change'));
      setMessage(stored === value ? (value ? 'Display preference remembered for 30 days.' : 'Optional cookie removed.') : 'Your browser blocked the preference cookie.');
    } catch { setMessage('Cookies are unavailable in this browser.'); }
  }

  return <Card style={preference === 'compact' && styles.compact}>
    <ThemedText type="smallBold">Cookies</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">Sign-in uses essential authentication storage. Optionally remember this panel’s compact display for 30 days. This cookie contains no health data or browsing history. Video sharing is controlled separately in your interests.</ThemedText>
    <View style={styles.actions}>
      <Button size="small" variant="secondary" title={preference ? 'Use essential only' : 'Continue with essential only'} onPress={() => save(null)} />
      <Button size="small" title={preference ? 'Compact display remembered' : 'Remember compact display'} disabled={preference === 'compact'} onPress={() => save('compact')} />
    </View>
    {message ? <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{message}</ThemedText> : null}
  </Card>;
}

const styles = StyleSheet.create({
  compact: { paddingVertical: Spacing.two + Spacing.half },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
