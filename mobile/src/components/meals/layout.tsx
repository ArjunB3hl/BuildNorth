import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A titled card: icon, title, optional count and a trailing action. */
export function SectionCard({
  title,
  icon,
  count,
  action,
  children,
  style,
}: {
  title: string;
  icon?: SymbolViewProps['name'];
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Card style={[styles.sectionCard, style]}>
      <View style={styles.sectionHead} accessibilityRole="header">
        {icon ? <SymbolView name={icon} size={18} tintColor={theme.textSecondary} /> : null}
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          {title}
        </ThemedText>
        {count != null ? (
          <ThemedText type="small" themeColor="textSecondary">
            {count}
          </ThemedText>
        ) : null}
        <View style={styles.fill} />
        {action}
      </View>
      {children}
    </Card>
  );
}

/** Empty state with an icon, a short explanation and its actions. */
export function EmptyPanel({
  icon,
  title,
  body,
  actions,
}: {
  icon: SymbolViewProps['name'];
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
        <SymbolView name={icon} size={24} tintColor={theme.textSecondary} />
      </View>
      <ThemedText type="smallBold" style={styles.emptyTitle}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          {body}
        </ThemedText>
      ) : null}
      {actions ? <View style={styles.emptyActions}>{actions}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sectionCard: { gap: Spacing.three },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 28 },
  sectionTitle: { fontSize: 16, lineHeight: 22 },
  empty: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.two },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  emptyTitle: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  emptyBody: { textAlign: 'center', maxWidth: 440 },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two, marginTop: Spacing.two },
});
