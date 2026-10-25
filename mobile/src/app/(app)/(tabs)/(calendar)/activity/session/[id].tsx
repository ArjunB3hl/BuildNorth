import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatMinutes, MetaItem, MetaRow, NumberBadge, SummaryStats } from '@/components/activity/exercise';
import { Icon } from '@/components/activity/icon';
import { Section } from '@/components/activity/layout';
import { Button, Notice, Success } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, Loading, Pill, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, friendlyDate } from '@/lib/dates';
import type { SessionEntry } from '@/lib/types';
import { Enter, Stagger } from '@/components/motion';

export default function SessionDetail() {
  const { id, justFinished } = useLocalSearchParams<{ id: string; justFinished?: string }>();
  const api = useApi();
  const router = useRouter();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api.sessions.get(id) });

  if (session.isPending) return <Loading label="Loading session…" />;
  if (session.isError && !session.data) return <ErrorState error={session.error} onRetry={() => session.refetch()} />;
  const s = session.data!;
  const sets = s.entries.reduce((n, e) => n + e.sets.filter((x) => x.completed).length, 0);
  const done = s.entries.filter((e) => !e.skipped).length;
  const started = new Date(s.startedAt);
  const startedLabel = Number.isNaN(started.getTime())
    ? null
    : `Started ${started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: s.routineName,
          ...(justFinished ? { headerLeft: () => <Button title="Done" size="small" variant="quiet" onPress={() => router.dismissTo('/activity')} /> } : {}),
        }}
      />
      {justFinished ? (
        <Enter>
          <Notice tone="success">Session saved. Nice work!</Notice>
        </Enter>
      ) : null}

      <Enter style={styles.header}>
        <ThemedText type="subtitle">{s.routineName}</ThemedText>
        <MetaRow>
          <MetaItem icon="calendar" label={friendlyDate(s.localDate)} />
          {startedLabel ? <MetaItem icon="time" label={startedLabel} /> : null}
        </MetaRow>
      </Enter>

      <Enter index={1}>
        <SummaryStats
          stats={[
            { label: 'Duration', value: formatMinutes(s.durationSeconds) },
            { label: 'Exercises', value: `${done} of ${s.entries.length}` },
            { label: 'Sets done', value: String(sets) },
          ]}
        />
      </Enter>

      <Section>
        <Enter index={2}>
          <SectionHeader title="Exercise log" />
        </Enter>
        <Stagger delay={180} max={4}>
          {s.entries.map((e, index) => (
            <EntryLog key={`${e.name}-${index}`} entry={e} index={index} />
          ))}
        </Stagger>
      </Section>
    </Screen>
  );
}

function EntryLog({ entry, index }: { entry: SessionEntry; index: number }) {
  const theme = useTheme();
  const completed = entry.sets.filter((x) => x.completed).length;
  const allDone = !entry.skipped && entry.sets.length > 0 && completed === entry.sets.length;
  return (
    <Card style={styles.entry}>
      <View style={styles.entryHeader}>
        <NumberBadge n={index + 1} done={allDone} />
        <ThemedText type="smallBold" style={styles.fill}>
          {entry.name}
        </ThemedText>
        {entry.skipped ? (
          <Pill label="Skipped" tone="muted" />
        ) : (
          <Pill label={`${completed} of ${entry.sets.length} sets`} tone={allDone ? 'success' : 'neutral'} />
        )}
      </View>
      {!entry.skipped && entry.sets.length ? (
        <View style={[styles.setList, { borderColor: theme.border }]}>
          {entry.sets.map((set, n) => {
            const values =
              [
                set.reps != null && `${set.reps} reps`,
                set.durationSeconds != null && formatDuration(set.durationSeconds),
                set.weight != null && `${set.weight} ${entry.weightUnit ?? 'kg'}`,
              ]
                .filter(Boolean)
                .join(' · ') || '—';
            return (
              <View
                key={n}
                accessible
                accessibilityLabel={`Set ${n + 1}: ${values}, ${set.completed ? 'completed' : 'not completed'}`}
                style={[styles.setRow, n > 0 && [styles.setDivider, { borderTopColor: theme.border }]]}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.setLabel}>
                  Set {n + 1}
                </ThemedText>
                <ThemedText type="small" themeColor={set.completed ? 'text' : 'textSecondary'} style={[styles.fill, styles.tabular]}>
                  {values}
                </ThemedText>
                {set.completed ? (
                  <View style={styles.status}>
                    <Icon name="done" size={18} color={Success} />
                    <ThemedText type="small" style={{ color: Success }}>
                      Done
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Not completed
                  </ThemedText>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  header: { gap: Spacing.two },
  entry: { gap: Spacing.three - Spacing.one },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - Spacing.one },
  setList: { borderTopWidth: StyleSheet.hairlineWidth },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  setDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  setLabel: { width: 48 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
