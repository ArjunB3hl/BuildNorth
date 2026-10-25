import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { Accent, Danger } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useContentWidth } from '@/components/profile/layout';
import { Card } from '@/components/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Collapse } from '@/components/motion';

export type IconName = SymbolViewProps['name'];
type Tone = 'default' | 'danger';

/** A small rounded tile holding an icon, used at the start of rows and card headings. */
export function IconTile({ name, tone = 'default', size = 32 }: { name: IconName; tone?: Tone; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: theme.backgroundSelected }]}>
      <SymbolView name={name} size={Math.round(size * 0.56)} tintColor={tone === 'danger' ? Danger : Accent} />
    </View>
  );
}

/** A titled card that holds one group of related settings or content. */
export function SectionCard({
  title,
  description,
  icon,
  leading,
  action,
  tone = 'default',
  children,
  style,
}: {
  title?: string;
  description?: string;
  icon?: IconName;
  /** Shown instead of the icon tile, e.g. the AI orb. Should be 32 high, like the tile. */
  leading?: ReactNode;
  /** Shown at the end of the heading, e.g. a status pill. */
  action?: ReactNode;
  tone?: Tone;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const hasLeading = !!(leading || icon);
  return (
    <Card style={[styles.card, style]}>
      {title ? (
        // With a description, the icon lines up with the title rather than the middle of the block.
        <View style={[styles.heading, description ? styles.headingTop : null]}>
          {leading ?? (icon ? <IconTile name={icon} tone={tone} /> : null)}
          <View style={[styles.headingText, description && hasLeading ? styles.headingTextOffset : null]}>
            <ThemedText type="smallBold" style={[styles.title, tone === 'danger' && { color: Danger }]} accessibilityRole="header">
              {title}
            </ThemedText>
            {description ? (
              <ThemedText type="small" themeColor="textSecondary">
                {description}
              </ThemedText>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </Card>
  );
}

/** A hairline between blocks inside a card. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }, style]} />;
}

/** A label and its value side by side, for summaries. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  const wide = useContentWidth() >= 560;
  return (
    <View style={styles.detail} accessible accessibilityLabel={typeof value === 'string' ? `${label}: ${value}` : undefined}>
      <ThemedText type="small" themeColor="textSecondary" style={[styles.detailLabel, wide && styles.detailLabelWide]}>
        {label}
      </ThemedText>
      {typeof value === 'string' ? (
        <ThemedText type="small" style={styles.fill}>
          {value}
        </ThemedText>
      ) : (
        <View style={styles.fill}>{value}</View>
      )}
    </View>
  );
}

/** A list of short facts, each led by an icon. */
export function FactList({ items }: { items: { icon: IconName; text: ReactNode }[] }) {
  const theme = useTheme();
  return (
    <View style={styles.facts}>
      {items.map((item, i) => (
        <View key={i} style={styles.fact}>
          <SymbolView name={item.icon} size={18} tintColor={theme.textSecondary} style={styles.factIcon} />
          <ThemedText type="small" style={styles.fill}>
            {item.text}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** Short lines, each led by a dot. */
export function BulletList({ items, secondary = false }: { items: ReactNode[]; secondary?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.bullets}>
      {items.map((item, i) => (
        <View key={i} style={styles.bullet}>
          <View style={[styles.dot, { backgroundColor: secondary ? theme.textSecondary : theme.text }]} />
          <ThemedText type="small" themeColor={secondary ? 'textSecondary' : 'text'} style={styles.fill}>
            {item}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** A selectable value in a monospaced box, such as an address or a one-time token. */
export function CodeBox({ value, accessibilityLabel }: { value: string; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.code, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText selectable style={styles.codeText} accessibilityLabel={accessibilityLabel}>
        {value}
      </ThemedText>
    </View>
  );
}

/** Hides a longer explanation until the reader asks for it. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
        style={styles.disclosureButton}>
        <Animated.View
          style={[
            { transform: [{ rotate: open ? '90deg' : '0deg' }] },
            !reduced && { transitionProperty: 'transform', transitionDuration: '200ms', transitionTimingFunction: 'ease-out' },
          ]}>
          <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} tintColor={Accent} />
        </Animated.View>
        <ThemedText type="smallBold" style={{ color: Accent }}>
          {label}
        </ThemedText>
      </Pressable>
      <Collapse open={open} style={styles.disclosureBody}>
        {children}
      </Collapse>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  tile: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  card: { gap: Spacing.three },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - Spacing.one },
  headingTop: { alignItems: 'flex-start' },
  headingText: { flex: 1, minWidth: 0, gap: Spacing.half },
  // Centres the 22-high title line on the 32-high icon tile.
  headingTextOffset: { paddingTop: 5 },
  title: { fontSize: 16, lineHeight: 22 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  detailLabel: { width: 130 },
  detailLabelWide: { width: 160 },
  facts: { gap: Spacing.three - Spacing.one },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three - Spacing.one },
  factIcon: { marginTop: 1 },
  bullets: { gap: Spacing.one + Spacing.half },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.half },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 8, marginLeft: Spacing.one },
  code: { borderRadius: 10, paddingHorizontal: Spacing.three - Spacing.one, paddingVertical: Spacing.two + Spacing.one },
  codeText: { fontFamily: Fonts?.mono, fontSize: 13, lineHeight: 20 },
  disclosure: { gap: Spacing.two },
  disclosureButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start', minHeight: 32 },
  disclosureBody: { gap: Spacing.two, paddingLeft: Spacing.four - Spacing.one },
});
