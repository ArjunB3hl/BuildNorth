import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { describeExercise } from '@/lib/exercise';

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

  return (
    <Screen refreshing={routine.isRefetching} onRefresh={() => routine.refetch()}>
      <Stack.Screen options={{ title: r.name }} />
      <StaleBanner visible={routine.isError} />
      <ThemedText type="subtitle">{r.name}</ThemedText>
      {r.notes ? <ThemedText themeColor="textSecondary">{r.notes}</ThemedText> : null}
      <Row style={styles.wrap}>
        <Button title="Start session" onPress={() => router.push({ pathname: '/activity/run', params: { routineId: r.id } })} />
        <Button
          title="Plan it"
          variant="secondary"
          onPress={() => router.push({ pathname: '/plan-add', params: { kind: 'activity', routineId: r.id, title: r.name } })}
        />
      </Row>
      <SectionHeader title={`${r.exercises.length} exercises`} />
      {r.exercises.map((e, index) => (
        <Card key={`${e.name}-${index}`}>
          <ThemedText type="smallBold">{e.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {describeExercise(e)}
          </ThemedText>
          {e.notes ? <ThemedText type="small">{e.notes}</ThemedText> : null}
        </Card>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Warm up first and stop if anything hurts. BuildNorth can&apos;t judge whether an exercise is safe for you.
      </ThemedText>
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      <Row style={styles.wrap}>
        <Button title="Edit" variant="secondary" onPress={() => router.push({ pathname: '/activity/edit', params: { id: r.id } })} />
        <Button
          title="Delete"
          variant="quiet"
          loading={remove.isPending}
          onPress={() =>
            Alert.alert('Delete this routine?', 'Past sessions stay in your history.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
            ])
          }
        />
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({ wrap: { flexWrap: 'wrap' } });
