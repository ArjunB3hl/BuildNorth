import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ResumeCard, RoutineCard, RoutineCardSkeleton, SessionRow, SessionRowSkeleton } from '@/components/activity/cards';
import { Grid, GroupedList, PageIntro, Section } from '@/components/activity/layout';
import { Button } from '@/components/form';
import { Enter, FadeIn } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorState, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useActiveSession } from '@/hooks/use-active-session';

export default function ActivityScreen() {
  const api = useApi();
  const router = useRouter();
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions.list });
  const { load } = useActiveSession();
  const [resume, setResume] = useState<{ routineId: string; routineName: string; planItemId: string | null } | null>(null);
  // Wide web windows put recent sessions in a column beside the routines.
  const { width } = useWindowDimensions();
  const twoColumns = Platform.OS === 'web' && width >= 1240;

  // Offer to resume a session that was in progress when the app closed.
  useFocusEffect(
    useCallback(() => {
      load().then((s) => setResume(s ? { routineId: s.routineId, routineName: s.routineName, planItemId: s.planItemId } : null));
    }, [load]),
  );

  // The most recent day each routine was done, for its card.
  const lastDone = new Map<string, string>();
  for (const s of sessions.data ?? []) {
    const seen = s.routineId ? lastDone.get(s.routineId) : undefined;
    if (s.routineId && (!seen || s.localDate > seen)) lastDone.set(s.routineId, s.localDate);
  }

  const newRoutine = () => router.push('/activity/edit');
  const describe = () => router.push('/activity/import');

  return (
    <Screen
      wide
      refreshing={routines.isRefetching || sessions.isRefetching}
      onRefresh={() => {
        routines.refetch();
        sessions.refetch();
      }}>
      <Enter>
        <PageIntro
          text="Build routines, run them as sessions and keep a record of what you did."
          primary={<Button title="New routine" onPress={newRoutine} />}
          secondary={<Button title="Describe a workout" variant="secondary" onPress={describe} />}
        />
      </Enter>

      {resume ? (
        <FadeIn>
          <ResumeCard
            routineName={resume.routineName}
            onResume={() =>
              router.push({ pathname: '/activity/run', params: { routineId: resume.routineId, planItemId: resume.planItemId ?? undefined } })
            }
          />
        </FadeIn>
      ) : null}

      <View style={twoColumns ? styles.columns : styles.stacked}>
        <View style={twoColumns ? styles.main : undefined}>
          <Section>
            {/* The cards below have their own staggered entrance, so only the heading rises in here. */}
            <Enter index={1}>
              <SectionHeader title="Your routines" action={<Count n={routines.data?.length} />} />
            </Enter>
            <StaleBanner visible={routines.isError && !!routines.data} />
            {routines.isPending ? (
              <View accessibilityLabel="Loading routines">
                <Grid maxColumns={twoColumns ? 2 : 3}>
                  {[0, 1, 2].map((i) => <RoutineCardSkeleton key={i} />)}
                </Grid>
              </View>
            ) : null}
            {routines.isError && !routines.data ? <ErrorState error={routines.error} onRetry={() => routines.refetch()} /> : null}
            {routines.data?.length === 0 ? (
              <FadeIn index={2}>
                <EmptyState
                  title="No routines yet"
                  body="Create a routine with exercises, sets and reps, then start a session to log it. Or describe a workout in your own words."
                  action={
                    <Row style={styles.wrap}>
                      <Button title="Create a routine" size="small" onPress={newRoutine} />
                      <Button title="Describe a workout" size="small" variant="quiet" onPress={describe} />
                    </Row>
                  }
                />
              </FadeIn>
            ) : null}
            {routines.data?.length ? (
              <Grid maxColumns={twoColumns ? 2 : 3} delay={100}>
                {routines.data.map((r) => (
                  <RoutineCard
                    key={r.id}
                    routine={r}
                    lastDone={lastDone.get(r.id)}
                    onPress={() => router.push({ pathname: '/activity/[id]', params: { id: r.id } })}
                  />
                ))}
              </Grid>
            ) : null}
          </Section>
        </View>

        <View style={twoColumns ? styles.aside : undefined}>
          <Section>
            <Enter index={2}>
              <SectionHeader title="Recent sessions" />
            </Enter>
            {sessions.isPending ? (
              <View accessibilityLabel="Loading sessions">
                <GroupedList>{[0, 1, 2].map((i) => <SessionRowSkeleton key={i} />)}</GroupedList>
              </View>
            ) : null}
            {sessions.isError && !sessions.data ? <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} /> : null}
            {sessions.data?.length === 0 ? (
              <FadeIn index={3}>
                <EmptyState title="No sessions yet" body="Start a session from a routine. Finished sessions show up here." />
              </FadeIn>
            ) : null}
            {sessions.data?.length ? (
              <FadeIn index={3}>
                <GroupedList>
                  {sessions.data.slice(0, 15).map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      onPress={() => router.push({ pathname: '/activity/session/[id]', params: { id: s.id } })}
                    />
                  ))}
                </GroupedList>
              </FadeIn>
            ) : null}
          </Section>
        </View>
      </View>
    </Screen>
  );
}

function Count({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {n}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap', justifyContent: 'center' },
  stacked: { gap: Spacing.four },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  main: { flex: 1, minWidth: 0 },
  aside: { width: 360 },
});
