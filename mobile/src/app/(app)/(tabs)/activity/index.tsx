import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { Button, Notice } from '@/components/form';
import { EmptyState, ErrorState, ListItem, Loading, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { useActiveSession } from '@/hooks/use-active-session';
import { formatDuration, friendlyDate } from '@/lib/dates';

export default function ActivityScreen() {
  const api = useApi();
  const router = useRouter();
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });
  const { load } = useActiveSession();
  const [resume, setResume] = useState<{ routineId: string; routineName: string; planItemId: string | null } | null>(null);

  // Offer to resume a session that was in progress when the app closed.
  useFocusEffect(
    useCallback(() => {
      load().then((s) => setResume(s ? { routineId: s.routineId, routineName: s.routineName, planItemId: s.planItemId } : null));
    }, [load]),
  );

  return (
    <Screen
      refreshing={routines.isRefetching || sessions.isRefetching}
      onRefresh={() => {
        routines.refetch();
        sessions.refetch();
      }}>
      {resume ? (
        <Notice tone="info">You have an unfinished “{resume.routineName}” session.</Notice>
      ) : null}
      {resume ? (
        <Button
          title="Resume session"
          onPress={() =>
            router.push({ pathname: '/activity/run', params: { routineId: resume.routineId, planItemId: resume.planItemId ?? undefined } })
          }
        />
      ) : null}

      <Row>
        <Button title="New routine" onPress={() => router.push('/activity/edit')} />
        <Button title="Describe a workout" variant="secondary" onPress={() => router.push('/activity/import')} />
      </Row>

      <SectionHeader title="Your routines" />
      <StaleBanner visible={routines.isError && !!routines.data} />
      {routines.isPending ? <Loading label="Loading routines…" /> : null}
      {routines.isError && !routines.data ? <ErrorState error={routines.error} onRetry={() => routines.refetch()} /> : null}
      {routines.data?.length === 0 ? (
        <EmptyState
          title="No routines yet"
          body="Create a routine with exercises, sets and reps, then start a session to log it."
          action={<Button title="Create a routine" size="small" onPress={() => router.push('/activity/edit')} />}
        />
      ) : null}
      {routines.data?.map((r) => (
        <ListItem
          key={r.id}
          title={r.name}
          subtitle={r.exercises.map((e) => e.name).join(', ')}
          onPress={() => router.push({ pathname: '/activity/[id]', params: { id: r.id } })}
        />
      ))}

      <SectionHeader title="Recent sessions" />
      {sessions.isError && !sessions.data ? <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} /> : null}
      {sessions.data?.length === 0 ? (
        <EmptyState title="No sessions yet" body="Finished sessions show up here." />
      ) : null}
      {sessions.data?.slice(0, 15).map((s) => (
        <ListItem
          key={s.id}
          title={s.routineName}
          subtitle={`${friendlyDate(s.localDate)} · ${formatDuration(s.durationSeconds)} · ${s.entries.filter((e) => !e.skipped).length} exercises`}
          onPress={() => router.push({ pathname: '/activity/session/[id]', params: { id: s.id } })}
        />
      ))}
    </Screen>
  );
}
