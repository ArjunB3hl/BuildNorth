import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { PendingApprovalsBanner } from '@/components/pending-approvals';
import { WeekPlan } from '@/components/week-plan';
import { Card, ChipGroup, EmptyState, ErrorState, errorMessage, Loading, Pill, Rating, Row, Screen, SectionHeader, StaleBanner, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { invalidatePlan } from '@/lib/plan-cache';
import { addDays, greeting, localDate } from '@/lib/dates';
import type { CheckIn, PlanItem, Today } from '@/lib/types';

const SLOT_LABEL = { morning: 'Morning', midday: 'Midday', evening: 'Evening' } as const;

export default function TodayScreen() {
  const api = useApi();
  const router = useRouter();
  const today = localDate();
  // `view`/`week` let other screens (e.g. after accepting a plan) open the week view.
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ view?: 'today' | 'week'; week?: string }>();
  const [view, setView] = useState<'today' | 'week'>(params.view ?? 'today');
  const [shownParams, setShownParams] = useState(params);
  if (params.view !== shownParams.view || params.week !== shownParams.week) {
    setShownParams(params);
    if (params.view) setView(params.view);
  }
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile.get });
  const todayQuery = useQuery({ queryKey: ['today', today], queryFn: () => api.today(today) });

  const name = profile.data?.preferredName;
  const data = todayQuery.data;
  const planned = data?.items ?? [];
  const remaining = planned.filter((i) => i.status === 'planned').length;

  return (
    <Screen refreshing={todayQuery.isRefetching} onRefresh={() => invalidatePlan(queryClient)}>
      <View style={styles.hero}>
        <ThemedText type="subtitle">
          {greeting()}
          {name ? `, ${name}` : ''}
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          {data ? (planned.length ? `${remaining} of ${planned.length} planned items left today.` : 'Nothing planned yet today.') : ' '}
        </ThemedText>
      </View>

      <PendingApprovalsBanner />

      <ChipGroup
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Week' },
        ]}
        multiple={false}
        selected={[view]}
        onChange={(v) => v[0] && setView(v[0] as 'today' | 'week')}
      />

      {view === 'week' ? <WeekPlan key={shownParams.week ?? 'current'} initialStart={shownParams.week} /> : null}

      {view === 'today' ? <StaleBanner visible={todayQuery.isError && !!data} /> : null}
      {view === 'today' && todayQuery.isPending ? <Loading label="Loading today…" /> : null}
      {view === 'today' && todayQuery.isError && !data ? <ErrorState error={todayQuery.error} onRetry={() => todayQuery.refetch()} /> : null}

      {view === 'today' && data ? (
        <>
          <CheckInCard day={today} existing={data.checkIn} />

          <SectionHeader
            title="Planned for today"
            action={<Button title="Add" size="small" variant="quiet" onPress={() => router.push('/plan-add')} accessibilityLabel="Add to today's plan" />}
          />
          {planned.length === 0 ? (
            <EmptyState
              title="Nothing planned for today"
              body="Add a meal or an activity, or ask the coach for ideas."
              action={
                <Row>
                  <Button title="Plan a meal" size="small" onPress={() => router.push({ pathname: '/plan-add', params: { kind: 'meal' } })} />
                  <Button title="Plan an activity" size="small" variant="secondary" onPress={() => router.push({ pathname: '/plan-add', params: { kind: 'activity' } })} />
                </Row>
              }
            />
          ) : (
            planned.map((item) => <PlanItemCard key={item.id} item={item} day={today} />)
          )}

          <SectionHeader title="Quick actions" />
          <View style={styles.quickGrid}>
            <Button title="Help plan my week" variant="secondary" onPress={() => router.push('/planner')} />
            <Button title="Ask the coach" variant="secondary" onPress={() => router.push('/coach')} />
            <Button title="Add a recipe" variant="secondary" onPress={() => router.push('/meals/import')} />
            <Button title="Start a routine" variant="secondary" onPress={() => router.push('/activity')} />
            <Button title="Shopping list" variant="secondary" onPress={() => router.push('/meals/shopping')} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function PlanItemCard({ item, day }: { item: PlanItem; day: string }) {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.plan.update>[1]) => api.plan.update(item.id, patch),
    onMutate: () => setError(null),
    onSuccess: () => invalidatePlan(queryClient),
    onError: (e) => setError(errorMessage(e)),
  });

  function reschedule() {
    Alert.alert('Move to another day', item.title, [
      { text: 'Tomorrow', onPress: () => update.mutate({ date: addDays(day, 1) }) },
      { text: 'In 2 days', onPress: () => update.mutate({ date: addDays(day, 2) }) },
      { text: 'Next week', onPress: () => update.mutate({ date: addDays(day, 7) }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const open = () => {
    if (item.kind === 'meal' && item.recipeId) router.push({ pathname: '/meals/[id]', params: { id: item.recipeId } });
    if (item.kind === 'activity' && item.routineId)
      router.push({ pathname: '/activity/run', params: { routineId: item.routineId, planItemId: item.id } });
  };

  return (
    <Card>
      <Row>
        <View style={styles.fill}>
          <ThemedText type="smallBold" style={item.status !== 'planned' && styles.doneText}>
            {item.title}
          </ThemedText>
          <Row style={styles.pills}>
            <Pill label={item.kind === 'meal' ? 'Meal' : 'Activity'} tone="accent" />
            {item.timeSlot ? <Pill label={SLOT_LABEL[item.timeSlot]} tone="muted" /> : null}
            {item.minutes ? <Pill label={`${item.minutes} min`} tone="muted" /> : null}
            {item.status === 'done' ? <Pill label="Done" tone="success" /> : null}
            {item.status === 'skipped' ? <Pill label="Skipped" tone="muted" /> : null}
          </Row>
        </View>
      </Row>
      {item.note ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {item.note}
        </ThemedText>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {item.status === 'planned' ? (
        <Row style={styles.actions}>
          {(item.recipeId || item.routineId) && (
            <Button title={item.kind === 'meal' ? 'Open recipe' : 'Start'} size="small" onPress={open} />
          )}
          <Button title="Done" size="small" variant="secondary" onPress={() => update.mutate({ status: 'done' })} loading={update.isPending && update.variables?.status === 'done'} accessibilityLabel={`Mark ${item.title} done`} />
          <Button title="Skip" size="small" variant="secondary" onPress={() => update.mutate({ status: 'skipped' })} accessibilityLabel={`Skip ${item.title}`} />
          <Button title="Move" size="small" variant="quiet" onPress={reschedule} accessibilityLabel={`Move ${item.title} to another day`} />
        </Row>
      ) : (
        <Button title="Undo" size="small" variant="quiet" onPress={() => update.mutate({ status: 'planned' })} accessibilityLabel={`Undo ${item.status} for ${item.title}`} />
      )}
    </Card>
  );
}

function CheckInCard({ day, existing }: { day: string; existing: CheckIn | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!existing);
  const [energy, setEnergy] = useState<number | null>(existing?.energy ?? null);
  const [mood, setMood] = useState<number | null>(existing?.mood ?? null);
  const [trackSleep, setTrackSleep] = useState(existing?.sleepHours != null);
  const [sleep, setSleep] = useState(existing?.sleepHours ?? 7);
  const [note, setNote] = useState(existing?.note ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.checkins.save(day, { energy: energy!, mood: mood!, sleepHours: trackSleep ? sleep : null, note: note.trim() || null }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Today>(['today', day], (old) => (old ? { ...old, checkIn: saved } : old));
      queryClient.invalidateQueries({ queryKey: ['progress'] });
      setEditing(false);
    },
  });

  if (existing && !editing) {
    return (
      <Card>
        <Row>
          <ThemedText type="smallBold" style={styles.fill}>
            Today&apos;s check-in
          </ThemedText>
          <Button title="Edit" size="small" variant="quiet" onPress={() => setEditing(true)} accessibilityLabel="Edit today's check-in" />
        </Row>
        <ThemedText type="small" themeColor="textSecondary">
          Energy {existing.energy}/5 · Mood {existing.mood}/5
          {existing.sleepHours != null ? ` · Sleep ${existing.sleepHours} h` : ''}
        </ThemedText>
        {existing.note ? <ThemedText type="small">{existing.note}</ThemedText> : null}
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">How are you today?</ThemedText>
      <Rating label="Energy" value={energy} onChange={setEnergy} lowLabel="Drained" highLabel="Energised" />
      <Rating label="Mood" value={mood} onChange={setMood} lowLabel="Low" highLabel="Great" />
      {trackSleep ? (
        <Stepper label="Sleep last night" value={sleep} onChange={setSleep} min={0} max={14} step={0.5} suffix="h" />
      ) : null}
      <Button
        title={trackSleep ? "Don't record sleep" : 'Add sleep (optional)'}
        size="small"
        variant="quiet"
        onPress={() => setTrackSleep((v) => !v)}
      />
      <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything worth remembering?" maxLength={1000} />
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      <Row>
        <View style={styles.fill}>
          <Button title="Save check-in" onPress={() => save.mutate()} loading={save.isPending} disabled={!energy || !mood} />
        </View>
        {existing ? <Button title="Cancel" variant="quiet" onPress={() => setEditing(false)} /> : null}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { gap: Spacing.one },
  pills: { flexWrap: 'wrap', marginTop: Spacing.one },
  actions: { flexWrap: 'wrap' },
  doneText: { opacity: 0.6 },
  quickGrid: { gap: Spacing.two },
});
