import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/activity/icon';
import { GroupedList, useMeasuredWidth } from '@/components/activity/layout';
import { Accent } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/dates';
import { describeExercise } from '@/lib/exercise';
import type { Exercise } from '@/lib/types';

export type Stat = { label: string; value: string };

/** An exercise's targets in a fixed order (sets, reps or time, weight, rest), so lists line up. */
export function targetStats(e: Exercise): Stat[] {
  let effort: Stat;
  if (e.reps && e.durationSeconds) effort = { label: 'Reps · time', value: `${e.reps} · ${formatDuration(e.durationSeconds)}` };
  else if (e.durationSeconds) effort = { label: 'Time', value: formatDuration(e.durationSeconds) };
  else effort = { label: 'Reps', value: e.reps ? String(e.reps) : '—' };
  return [
    { label: 'Sets', value: e.sets ? String(e.sets) : '—' },
    effort,
    { label: 'Weight', value: e.weight ? `${e.weight} ${e.weightUnit ?? 'kg'}` : '—' },
    { label: 'Rest', value: e.restSeconds ? formatDuration(e.restSeconds) : '—' },
  ];
}

/**
 * Rough length of a routine in minutes: each set's work (its time, or about 3 seconds a rep),
 * rest between sets (45 seconds when none is set) and half a minute to change exercises.
 */
export function estimateMinutes(exercises: Exercise[]): number {
  if (!exercises.length) return 0;
  const seconds = exercises.reduce((total, e) => {
    const sets = Math.max(1, e.sets ?? 1);
    const work = e.durationSeconds || (e.reps ? e.reps * 3 : 30);
    const rest = e.restSeconds ?? 45;
    return total + sets * work + (sets - 1) * rest + 30;
  }, 0);
  const minutes = seconds / 60;
  return minutes < 15 ? Math.max(1, Math.round(minutes)) : Math.round(minutes / 5) * 5;
}

/** "45 min", "1 h 5 min", "2 h"; under a minute reads "< 1 min". */
export function formatMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Small labelled values side by side. `fill` spreads them across the row; otherwise they take fixed columns. */
export function StatColumns({ stats, fill = false }: { stats: Stat[]; fill?: boolean }) {
  return (
    <View style={[styles.stats, fill && styles.statsFill]}>
      {stats.map((stat) => (
        <View key={stat.label} style={fill ? styles.statFill : styles.statFixed}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel} numberOfLines={1}>
            {stat.label.toUpperCase()}
          </ThemedText>
          <ThemedText type="smallBold" style={[styles.tabular, stat.value === '—' && styles.empty]} numberOfLines={1}>
            {stat.value}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** A round step number; filled in once the step is done. */
export function NumberBadge({ n, done = false }: { n: number; done?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: done ? Accent : theme.backgroundSelected }]}>
      <ThemedText type="smallBold" style={[styles.badgeText, { color: done ? '#ffffff' : theme.textSecondary }]}>
        {n}
      </ThemedText>
    </View>
  );
}

/** An icon and a short fact, for a line of metadata under a title. */
export function MetaItem({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={18} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** A metadata line that wraps on narrow screens. */
export function MetaRow({ children }: { children: ReactNode }) {
  return <View style={styles.metaRow}>{children}</View>;
}

/** A page's headline numbers in one card, as equal columns divided by hairlines. */
export function SummaryStats({ stats }: { stats: Stat[] }) {
  const theme = useTheme();
  return (
    <Card style={styles.summary}>
      {stats.map((stat, i) => (
        <View
          key={stat.label}
          accessible
          accessibilityLabel={`${stat.label}: ${stat.value}`}
          style={[styles.summaryItem, i > 0 && [styles.summaryDivider, { borderLeftColor: theme.border }]]}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {stat.label}
          </ThemedText>
          <ThemedText style={[styles.summaryValue, styles.tabular]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {stat.value}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

/** A routine's exercises as one list; targets sit beside the name when there's room, otherwise below it. */
export function ExerciseList({ exercises }: { exercises: Exercise[] }) {
  const [width, onLayout] = useMeasuredWidth();
  const wide = width >= 600;
  return (
    <View onLayout={onLayout}>
      <GroupedList>
        {exercises.map((e, index) => (
          <View
            key={`${e.name}-${index}`}
            accessible
            accessibilityLabel={`${index + 1}. ${e.name}: ${describeExercise(e)}${e.notes ? `. ${e.notes}` : ''}`}
            style={[styles.item, wide && styles.itemWide]}>
            <View style={[styles.itemMain, wide && styles.itemMainWide]}>
              <NumberBadge n={index + 1} />
              <View style={styles.itemText}>
                <ThemedText type="smallBold">{e.name}</ThemedText>
                {e.notes ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {e.notes}
                  </ThemedText>
                ) : null}
              </View>
            </View>
            <View style={!wide && styles.itemStatsNarrow}>
              <StatColumns stats={targetStats(e)} fill={!wide} />
            </View>
          </View>
        ))}
      </GroupedList>
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', gap: Spacing.three },
  statsFill: { gap: Spacing.two },
  statFixed: { minWidth: 64, gap: Spacing.half },
  statFill: { flex: 1, minWidth: 0, gap: Spacing.half },
  statLabel: { fontSize: 11, lineHeight: 14, letterSpacing: 0.5 },
  empty: { opacity: 0.45 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 13, lineHeight: 16 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + Spacing.half },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.one },
  summary: { flexDirection: 'row', gap: 0, paddingHorizontal: 0 },
  summaryItem: { flex: 1, minWidth: 0, gap: Spacing.one, paddingHorizontal: Spacing.three },
  summaryDivider: { borderLeftWidth: StyleSheet.hairlineWidth },
  summaryValue: { fontSize: 22, lineHeight: 28, fontWeight: 700 },
  item: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three - Spacing.one, gap: Spacing.two + Spacing.one },
  itemWide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  itemMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three - Spacing.one },
  itemMainWide: { flex: 1, minWidth: 0, alignItems: 'center' },
  itemText: { flex: 1, minWidth: 0, gap: Spacing.half },
  itemStatsNarrow: { paddingLeft: 28 + Spacing.three - Spacing.one },
});
