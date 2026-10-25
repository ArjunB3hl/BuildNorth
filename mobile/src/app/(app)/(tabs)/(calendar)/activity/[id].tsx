import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { estimateMinutes, ExerciseList, MetaItem, MetaRow, plural } from '@/components/activity/exercise';
import { Section } from '@/components/activity/layout';
import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, errorMessage, Loading, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { confirmAction } from '@/lib/confirm';
import { Enter } from '@/components/motion';

const isWeb = Platform.OS === 'web';

export default function RoutineDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const routine = useQuery({ queryKey: ['routine', id], queryFn: () => api.routines.get(id) });
  const remove = useMutation({
    mutationFn: () => api.routines.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routines'] });
      router.back();
    },
  });

  if (routine.isPending) return <Loading label="Loading routine…" />;
  if (routine.isError && !routine.data) return <ErrorState error={routine.error} onRetry={() => routine.refetch()} />;
  const r = routine.data!;
  const minutes = estimateMinutes(r.exercises);

  async function confirmDelete() {
    const confirmed = await confirmAction({
      title: 'Delete this routine?',
      message: 'Past sessions stay in your history.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (confirmed) remove.mutate();
  }

  return (
    <Screen refreshing={routine.isRefetching} onRefresh={() => routine.refetch()}>
      <Stack.Screen options={{ title: r.name }} />
      <StaleBanner visible={routine.isError} />

      <Enter style={styles.header}>
        <ThemedText type="subtitle">{r.name}</ThemedText>
        <MetaRow>
          <MetaItem icon="exercises" label={plural(r.exercises.length, 'exercise')} />
          {minutes ? <MetaItem icon="time" label={`About ${minutes} min`} /> : null}
        </MetaRow>
        {r.notes ? <ThemedText themeColor="textSecondary">{r.notes}</ThemedText> : null}
      </Enter>

      <Enter index={1} style={styles.actions}>
        <View style={[styles.group, !isWeb && styles.groupFull]}>
          <View style={!isWeb && styles.grow}>
            <Button title="Start session" onPress={() => router.push({ pathname: '/activity/run', params: { routineId: r.id } })} />
          </View>
          <Button
            title="Plan it"
            variant="secondary"
            onPress={() => router.push({ pathname: '/plan-add', params: { kind: 'activity', routineId: r.id, title: r.name } })}
          />
        </View>
        <View style={[styles.group, isWeb && styles.pushRight]}>
          <Button title="Edit" variant="secondary" onPress={() => router.push({ pathname: '/activity/edit', params: { id: r.id } })} />
          <Button title="Delete" variant="quiet" loading={remove.isPending} onPress={() => void confirmDelete()} />
        </View>
      </Enter>
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}

      <Enter index={2}>
        <Section>
          <SectionHeader title="Exercises" />
          {r.exercises.length ? (
            <ExerciseList exercises={r.exercises} />
          ) : (
            <EmptyState title="No exercises yet" body="Edit this routine to add exercises with their sets and reps." />
          )}
        </Section>
      </Enter>

      <Enter index={3}>
        <ThemedText type="small" themeColor="textSecondary">
          Warm up first and stop if anything hurts. Rhythm can&apos;t judge whether an exercise is safe for you.
        </ThemedText>
      </Enter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  group: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  groupFull: { width: '100%' },
  grow: { flex: 1 },
  pushRight: { marginLeft: 'auto' },
});
