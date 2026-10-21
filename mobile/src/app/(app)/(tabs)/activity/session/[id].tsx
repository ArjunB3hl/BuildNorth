import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, Loading, Pill, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { formatDuration, friendlyDate } from '@/lib/dates';

export default function SessionDetail() {
  const { id, justFinished } = useLocalSearchParams<{ id: string; justFinished?: string }>();
  const api = useApi();
  const router = useRouter();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api.sessions.get(id) });

  if (session.isPending) return <Loading label="Loading session…" />;
  if (session.isError && !session.data) return <ErrorState error={session.error} onRetry={() => session.refetch()} />;
  const s = session.data!;
  const sets = s.entries.reduce((n, e) => n + e.sets.filter((x) => x.completed).length, 0);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: s.routineName,
          ...(justFinished ? { headerLeft: () => <Button title="Done" size="small" variant="quiet" onPress={() => router.dismissTo('/activity')} /> } : {}),
        }}
      />
      {justFinished ? <Notice tone="success">Session saved. Nice work!</Notice> : null}
      <ThemedText type="subtitle">{s.routineName}</ThemedText>
      <ThemedText themeColor="textSecondary">
        {friendlyDate(s.localDate)} · {formatDuration(s.durationSeconds)} · {sets} set{sets === 1 ? '' : 's'} completed
      </ThemedText>
      {s.entries.map((e, index) => (
        <Card key={`${e.name}-${index}`}>
          <ThemedText type="smallBold">{e.name}</ThemedText>
          {e.skipped ? (
            <Pill label="Skipped" tone="muted" />
          ) : (
            e.sets.map((set, n) => (
              <ThemedText key={n} type="small" themeColor={set.completed ? 'text' : 'textSecondary'}>
                Set {n + 1}:{' '}
                {[
                  set.reps != null && `${set.reps} reps`,
                  set.durationSeconds != null && formatDuration(set.durationSeconds),
                  set.weight != null && `${set.weight} ${e.weightUnit ?? 'kg'}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
                {set.completed ? ' ✓' : ' (not completed)'}
              </ThemedText>
            ))
          )}
        </Card>
      ))}
    </Screen>
  );
}
