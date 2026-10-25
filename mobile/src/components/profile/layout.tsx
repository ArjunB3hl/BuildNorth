import { Children, isValidElement, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, WideContentWidth } from '@/constants/theme';
import { Enter } from '@/components/motion';

// Mirrors the web shell: a 240-wide sidebar from 900 px, and the page's side padding.
const SIDEBAR_FROM = 900;
const SIDEBAR_WIDTH = 240;
const GAP = Spacing.three;
const pageGutter = (width: number) => (Platform.OS === 'web' && width >= 600 ? Spacing.five : Spacing.three);

/** About how wide the page's content column is, for choosing a grid's column count. */
export function useContentWidth(maxWidth = WideContentWidth): number {
  const { width } = useWindowDimensions();
  const sidebar = Platform.OS === 'web' && width >= SIDEBAR_FROM ? SIDEBAR_WIDTH : 0;
  return Math.min(maxWidth, width - sidebar - pageGutter(width) * 2);
}

/** How many columns fit, given the narrowest a column may be. Phones always get one. */
export function useColumns(minColumnWidth: number, maxColumns = 2, maxWidth = WideContentWidth): number {
  const content = useContentWidth(maxWidth);
  if (Platform.OS !== 'web') return 1;
  const gap = Spacing.three;
  return Math.max(1, Math.min(maxColumns, Math.floor((content + gap) / (minColumnWidth + gap))));
}

/**
 * Lays children out in `columns` equal columns; cells in a row share its height. Cells wrap in one
 * flat row keyed by each child's key, so a refetch or a new column count never remounts a card,
 * and each card rises in once, staggered, when it first appears.
 */
export function Grid({ columns, delay = 0, children }: {
  columns: number;
  /** Milliseconds before the first card enters, so cards follow the controls above them. */
  delay?: number;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const width = `${100 / Math.max(1, columns)}%` as const;
  if (!items.length) return null;
  return (
    <View style={styles.grid}>
      {items.map((item, i) => (
        <Enter key={isValidElement(item) && item.key != null ? item.key : i} index={Math.min(i, 6)} delay={delay} style={[styles.cell, { width }]}>
          {item}
        </Enter>
      ))}
    </View>
  );
}

/** The intro at the top of a page, with an optional action at the end. The title bar already names the page, so a title is rarely needed. */
export function PageIntro({ title, body, action, meta }: { title?: string; body?: string; action?: ReactNode; meta?: string }) {
  const wide = useContentWidth() >= 560;
  return (
    <View style={[styles.intro, wide && styles.introWide]}>
      <View style={styles.introText}>
        {title ? (
          <ThemedText type="subtitle" style={styles.introTitle}>
            {title}
          </ThemedText>
        ) : null}
        {body ? <ThemedText themeColor="textSecondary">{body}</ThemedText> : null}
        {meta ? (
          <ThemedText type="small" themeColor="textSecondary">
            {meta}
          </ThemedText>
        ) : null}
      </View>
      {action ? <View style={wide ? styles.introAction : undefined}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Negative margins cancel the cells' outer padding, so the gaps sit only between cards.
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', marginHorizontal: -GAP / 2, marginBottom: -GAP },
  cell: { minWidth: 0, paddingHorizontal: GAP / 2, paddingBottom: GAP },
  intro: { gap: Spacing.three },
  introWide: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  introText: { flex: 1, minWidth: 0, gap: Spacing.one },
  introTitle: Platform.select({ web: {}, default: { fontSize: 26, lineHeight: 34 } }),
  introAction: { flexShrink: 0 },
});
