import { StyleSheet, View } from 'react-native';

import { Accent } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** Shared branding, independent of the signed-in account. */
export function Wordmark() {
  return (
    <View style={styles.brand}>
      <ThemedText style={[styles.wordmark, { color: Accent }]} accessibilityRole="header">Rhythm</ThemedText>
      <DemoBadge />
    </View>
  );
}

export function DemoBadge() {
  const theme = useTheme();
  return <View style={[styles.badge, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
    <ThemedText style={styles.badgeText} themeColor="textSecondary">Demo version</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  wordmark: { fontSize: 20, lineHeight: 28, fontWeight: 700, letterSpacing: -0.4 },
  badge: { alignSelf: 'center', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
});
