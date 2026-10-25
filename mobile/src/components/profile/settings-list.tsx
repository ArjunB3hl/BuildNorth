import { SymbolView } from 'expo-symbols';
import { Children, Fragment, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Danger } from '@/components/form';
import { IconTile, type IconName } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { Card, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Enter, webTransition } from '@/components/motion';

const ROW_PADDING = Platform.OS === 'web' ? Spacing.four - Spacing.one : Spacing.three;
const TILE = 32;
const GAP = Spacing.three - Spacing.one;

/**
 * A titled group of rows in one card, separated by inset hairlines. With an `index` (its place in the
 * page's entrance stagger) it rises in once when it first appears; without one it simply appears.
 */
export function SettingsGroup({ title, index, children }: { title?: string; index?: number; children: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  const body = (
    <>
      {title ? <SectionHeader title={title} /> : null}
      <Card style={styles.card}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
            {row}
          </Fragment>
        ))}
      </Card>
    </>
  );
  return index == null ? (
    <View style={styles.group}>{body}</View>
  ) : (
    <Enter index={index} style={styles.group}>
      {body}
    </Enter>
  );
}

/** A tappable settings row: icon, label, optional description and a chevron. */
export function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  trailing,
  tone = 'default',
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  tone?: 'default' | 'danger';
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      disabled={!onPress}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.row,
        rowTransition,
        (hovered || pressed) && onPress ? { backgroundColor: Platform.OS === 'web' ? theme.background : theme.backgroundSelected } : null,
      ]}>
      <IconTile name={icon} tone={tone} size={TILE} />
      <View style={styles.text}>
        <ThemedText type="smallBold" style={tone === 'danger' ? { color: Danger } : undefined}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={18}
            tintColor={theme.textSecondary}
          />
        ) : null)}
    </Pressable>
  );
}

const rowTransition = webTransition('background-color');

/** Free-form content inside a SettingsGroup, padded like its rows. */
export function SettingsBlock({ children }: { children: ReactNode }) {
  return <View style={styles.block}>{children}</View>;
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  card: { padding: 0, gap: 0, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: ROW_PADDING + TILE + GAP },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
    paddingHorizontal: ROW_PADDING,
    paddingVertical: Spacing.three - Spacing.one,
    minHeight: 60,
  },
  text: { flex: 1, minWidth: 0, gap: Spacing.half },
  block: { padding: ROW_PADDING, gap: Spacing.two },
});
