import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { estimateMinutes, formatMinutes, MetaItem, MetaRow, plural } from '@/components/activity/exercise';
import { Icon, IconTile } from '@/components/activity/icon';
import { Accent, Button } from '@/components/form';
import { liftStyle, Skeleton, webTransition } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { friendlyDate } from '@/lib/dates';
import type { ActivitySession, Routine } from '@/lib/types';

const isWeb = Platform.OS === 'web';

function lastDoneLabel(day: string | undefined): string {
  if (!day) return 'Not done yet';
  const date = friendlyDate(day);
  return date === 'Today' || date === 'Yesterday' || date === 'Tomorrow' ? `Done ${date.toLowerCase()}` : `Done ${date}`;
}

/** A routine in the Activity grid: what it contains, roughly how long it takes and when it was last done. */
export function RoutineCard({ routine, lastDone, onPress }: { routine: Routine; lastDone?: string; onPress: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const count = routine.exercises.length;
  const minutes = estimateMinutes(routine.exercises);
  const names = routine.exercises.map((e) => e.name).join(', ');
  const facts = [plural(count, 'exercise'), minutes ? `about ${minutes} min` : null, lastDoneLabel(lastDone)].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${routine.name}. ${facts.join(', ')}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.fill, pressed && styles.pressed]}>
      <Card style={[styles.card, isWeb && hovered && styles.cardHover, liftStyle(hovered)]}>
        <View style={styles.top}>
          <IconTile name="routine" />
          <View style={styles.titleBlock}>
            <ThemedText type="smallBold" style={styles.name} numberOfLines={2}>
              {routine.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {names || 'No exercises yet'}
            </ThemedText>
          </View>
          <Icon name="chevron" size={20} color={hovered ? Accent : theme.textSecondary} />
        </View>
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <MetaRow>
            <MetaItem icon="exercises" label={plural(count, 'exercise')} />
            {minutes ? <MetaItem icon="time" label={`~${minutes} min`} /> : null}
            <MetaItem icon="history" label={lastDoneLabel(lastDone)} />
          </MetaRow>
        </View>
      </Card>
    </Pressable>
  );
}

/** A finished session in a list: date, routine, what was done and how long it took. */
export function SessionRow({ session, onPress }: { session: ActivitySession; onPress: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const exercises = session.entries.filter((e) => !e.skipped).length;
  const sets = session.entries.reduce((n, e) => n + (e.skipped ? 0 : e.sets.filter((s) => s.completed).length), 0);
  const [y, m, d] = session.localDate.split('-').map(Number);
  const month = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  const date = friendlyDate(session.localDate);
  const duration = formatMinutes(session.durationSeconds);
  const summary = `${plural(exercises, 'exercise')} · ${plural(sets, 'set')}`;
  // The tile shows the calendar date; "Today" and "Yesterday" still read faster.
  const recent = date === 'Today' || date === 'Yesterday' ? `${date} · ` : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${session.routineName}, ${date}, ${duration}, ${summary}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.row,
        rowTransition,
        (hovered || pressed) && { backgroundColor: isWeb ? theme.background : theme.backgroundSelected },
      ]}>
      <View style={[styles.date, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.month}>
          {month}
        </ThemedText>
        <ThemedText type="smallBold" style={styles.day}>
          {d}
        </ThemedText>
      </View>
      <View style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {session.routineName}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {recent}
          {summary}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.duration}>
        {duration}
      </ThemedText>
      <Icon name="chevron" size={20} color={hovered ? Accent : theme.textSecondary} />
    </Pressable>
  );
}

/** Placeholder routine cards, shaped like the real ones, while routines load. */
export function RoutineCardSkeleton() {
  const theme = useTheme();
  return (
    <Card style={[styles.card, styles.fill]}>
      <View style={styles.top}>
        <Skeleton width={40} height={40} radius={12} />
        <View style={styles.titleBlock}>
          <Skeleton width="60%" height={18} />
          <Skeleton width="85%" height={12} style={styles.skeletonGap} />
        </View>
      </View>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Skeleton width="70%" height={12} />
      </View>
    </Card>
  );
}

/** A placeholder session row while sessions load. */
export function SessionRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={44} height={44} radius={10} />
      <View style={styles.rowText}>
        <Skeleton width="50%" height={14} />
        <Skeleton width="35%" height={12} style={styles.skeletonGap} />
      </View>
    </View>
  );
}

const rowTransition = webTransition('background-color');

/** Offers to pick up a session that was still running when the app closed. */
export function ResumeCard({ routineName, onResume }: { routineName: string; onResume: () => void }) {
  return (
    <Card style={styles.resume}>
      <IconTile name="resume" />
      <View style={styles.resumeText}>
        <ThemedText type="smallBold">Unfinished session</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          You have an unfinished “{routineName}” session on this device.
        </ThemedText>
      </View>
      <Button title="Resume session" size="small" onPress={onResume} />
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  pressed: { opacity: 0.8 },
  card: { flexGrow: 1, gap: Spacing.three },
  cardHover: { borderColor: `${Accent}66`, boxShadow: '0 6px 16px rgba(16, 24, 40, 0.08)' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three - Spacing.one, flexGrow: 1 },
  titleBlock: { flex: 1, minWidth: 0, gap: Spacing.half },
  name: { fontSize: 16, lineHeight: 22 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three - Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - Spacing.one, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three - Spacing.one, minHeight: 64 },
  date: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 10, lineHeight: 12, letterSpacing: 0.5 },
  day: { fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1, minWidth: 0, gap: Spacing.half },
  duration: { fontVariant: ['tabular-nums'] },
  skeletonGap: { marginTop: Spacing.one },
  resume: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three - Spacing.one },
  resumeText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: Spacing.half },
});
