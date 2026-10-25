import { StyleSheet } from 'react-native';

import { Accent } from '@/components/form';
import { ThemedText } from '@/components/themed-text';

/** The app name as a small text logo, used by the web layouts. */
export function Wordmark() {
  return (
    <ThemedText style={styles.wordmark} accessibilityRole="header">
      Build<ThemedText style={[styles.wordmark, { color: Accent }]}>North</ThemedText>
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  wordmark: { fontSize: 20, lineHeight: 28, fontWeight: 700, letterSpacing: -0.4 },
});
