import { Children, isValidElement, useCallback, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Enter } from '@/components/motion';

const isWeb = Platform.OS === 'web';
const GAP = Spacing.three;

/** Width of a view once it has been laid out (0 before the first layout). */
export function useMeasuredWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  }, []);
  return [width, onLayout];
}

/**
 * The top of a page: a one-line introduction and the page's main actions.
 * On the web the actions sit to the right with the primary one last; on phones they follow the text.
 */
export function PageIntro({ text, primary, secondary }: { text: string; primary: ReactNode; secondary?: ReactNode }) {
  return (
    <View style={isWeb ? styles.introWeb : styles.intro}>
      <ThemedText themeColor="textSecondary" style={isWeb && styles.introText}>
        {text}
      </ThemedText>
      <View style={styles.actionRow}>
        {isWeb ? secondary : primary}
        {isWeb ? primary : secondary}
      </View>
    </View>
  );
}

/**
 * A form's buttons: stacked at full width on phones; a right-aligned row on the web
 * with the primary action last.
 */
export function FormActions({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  if (!isWeb) {
    return (
      <View style={styles.stack}>
        {primary}
        {secondary}
      </View>
    );
  }
  return (
    <View style={[styles.actionRow, styles.alignEnd]}>
      {secondary}
      {primary}
    </View>
  );
}

/**
 * Equal-width cards in rows: as many columns as fit (each at least `minItemWidth`), up to `maxColumns`.
 * Cells wrap in one flat row keyed by each child's key, so measuring the width or a refetch never
 * remounts a card, and each card rises in once, staggered, when it first appears.
 */
export function Grid({ children, minItemWidth = 280, maxColumns = 3, delay = 0 }: {
  children: ReactNode;
  minItemWidth?: number;
  maxColumns?: number;
  /** Milliseconds before the first card enters, so cards follow the heading above them. */
  delay?: number;
}) {
  const [width, onLayout] = useMeasuredWidth();
  const items = Children.toArray(children);
  const columns = width ? Math.max(1, Math.min(maxColumns, Math.floor((width + GAP) / (minItemWidth + GAP)))) : 1;
  return (
    <View onLayout={onLayout}>
      <View style={styles.grid}>
        {items.map((item, i) => (
          <Enter
            key={isValidElement(item) && item.key != null ? item.key : i}
            index={Math.min(i, 6)}
            delay={delay}
            style={[styles.gridCell, { width: `${100 / columns}%` }]}>
            {item}
          </Enter>
        ))}
      </View>
    </View>
  );
}

/** One card holding a list of rows, separated by hairlines. */
export function GroupedList({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const items = Children.toArray(children);
  return (
    <Card style={styles.grouped}>
      {items.map((item, i) => (
        <View
          key={isValidElement(item) && item.key != null ? item.key : i}
          style={i > 0 && [styles.separator, { borderTopColor: theme.border }]}>
          {item}
        </View>
      ))}
    </Card>
  );
}

/** A labelled group of page content (header, then its items), spaced a little tighter than the page. */
export function Section({ children }: { children: ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.three },
  introWeb: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  introText: { flexShrink: 1, flexGrow: 1, flexBasis: 320, maxWidth: 560 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  alignEnd: { justifyContent: 'flex-end' },
  stack: { gap: Spacing.two },
  // Negative margins cancel the cells' outer padding, so the gaps sit only between cards.
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', marginHorizontal: -GAP / 2, marginBottom: -GAP },
  gridCell: { minWidth: 0, paddingHorizontal: GAP / 2, paddingBottom: GAP },
  grouped: { padding: 0, gap: 0, overflow: 'hidden' },
  separator: { borderTopWidth: StyleSheet.hairlineWidth },
  section: { gap: Spacing.three - Spacing.one },
});
