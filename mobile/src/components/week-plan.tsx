import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Notice } from '@/components/form';
import { PlanChangeComposer } from '@/components/plan-change';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Pill, Row, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { addDays, localDate, weekdayShort, weekStart } from '@/lib/dates';
import { invalidatePlan } from '@/lib/plan-cache';
import type { ChangePreview, PlanItem } from '@/lib/types';

const SLOT_LABEL = { morning: 'Breakfast', midday: 'Lunch', evening: 'Dinner' } as const;

/** Seven days of the saved plan: add, move, mark done or skipped, and change it by asking. */
export function WeekPlan({ initialStart }: { initialStart?: string }) {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = localDate();
  const [start, setStart] = useState(() => weekStart(initialStart ?? today));
  const [focus, setFocus] = useState<{ key: string; title: string } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const query = useQuery({ queryKey: ['plan', start], queryFn: () => api.plan.range(start, 7) });
  const items = query.data?.items ?? [];

  async function applyChanges(preview: ChangePreview) {
    await api.planner.applyChanges(
      preview.changeSetId,
      preview.changes.map(({ op, targetKey, after }) => ({ op, targetKey, after })),
    );
    await invalidatePlan(queryClient);
  }

  const isThisWeek = start === weekStart(today);
  const nextWeek = addDays(weekStart(today), 7);
  // Plan the rest of this week while most of it is ahead; otherwise next week.
  const suggestedStart = isThisWeek && addDays(start, 6) >= addDays(today, 3) ? today : start <= today ? nextWeek : start;

  return (
    <View style={styles.column}>
      <Row>
        <Button title="‹" size="small" variant="secondary" onPress={() => setStart(addDays(start, -7))} accessibilityLabel="Previous week" />
        <ThemedText type="smallBold" style={styles.weekLabel} accessibilityRole="header">
          {weekdayShort(start)} – {weekdayShort(addDays(start, 6))}
        </ThemedText>
        <Button title="›" size="small" variant="secondary" onPress={() => setStart(addDays(start, 7))} accessibilityLabel="Next week" />
      </Row>
      {!isThisWeek ? <Button title="Back to this week" size="small" variant="quiet" onPress={() => setStart(weekStart(today))} /> : null}

      <Row style={styles.wrap}>
        <View style={styles.fill}>
          <Button title="Help plan my week" onPress={() => router.push({ pathname: '/planner', params: { start: suggestedStart } })} />
        </View>
        <Button title="Weekly review" variant="secondary" onPress={() => router.push('/review')} />
      </Row>

      <StaleBanner visible={query.isError && !!query.data} />
      {query.isPending ? <Loading label="Loading the week…" /> : null}
      {query.isError && !query.data ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {query.data
        ? days.map((day) => (
            <DayCard
              key={day}
              day={day}
              today={today}
              items={items.filter((i) => i.date === day)}
              weekDays={days}
              onAdd={() => router.push({ pathname: '/plan-add', params: { date: day } })}
              focusedKey={focus?.key ?? null}
              onFocus={(item) => setFocus({ key: item.id, title: item.title })}
            />
          ))
        : null}

      {query.data ? (
        <PlanChangeComposer
          scope="plan"
          startDate={start}
          days={7}
          focus={focus}
          onClearFocus={() => setFocus(null)}
          onConfirm={applyChanges}
          confirmLabel="Confirm changes"
        />
      ) : null}
    </View>
  );
}

function DayCard({
  day,
  today,
  items,
  weekDays,
  onAdd,
  focusedKey,
  onFocus,
}: {
  day: string;
  today: string;
  items: PlanItem[];
  weekDays: string[];
  onAdd: () => void;
  focusedKey: string | null;
  onFocus: (item: PlanItem) => void;
}) {
  return (
    <Card style={day === today && styles.today}>
      <Row>
        <ThemedText type="smallBold" style={styles.fill}>
          {weekdayShort(day)}
          {day === today ? ' · Today' : ''}
        </ThemedText>
        <Button title="Add" size="small" variant="quiet" onPress={onAdd} accessibilityLabel={`Add to ${weekdayShort(day)}`} />
      </Row>
      {items.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing planned.
        </ThemedText>
      ) : (
        items.map((item) => (
          <WeekItem key={item.id} item={item} weekDays={weekDays} focused={item.id === focusedKey} onFocus={() => onFocus(item)} />
        ))
      )}
    </Card>
  );
}

function WeekItem({ item, weekDays, focused, onFocus }: { item: PlanItem; weekDays: string[]; focused: boolean; onFocus: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.plan.update>[1]) => api.plan.update(item.id, patch),
    onMutate: () => setError(null),
    onSuccess: () => invalidatePlan(queryClient),
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.plan.remove(item.id),
    onSuccess: () => invalidatePlan(queryClient),
    onError: (e) => setError(errorMessage(e)),
  });

  function move() {
    const options = weekDays.filter((d) => d !== item.date);
    Alert.alert('Move to another day', item.title, [
      ...options.map((d) => ({ text: weekdayShort(d), onPress: () => update.mutate({ date: d }) })),
      { text: 'Same day next week', onPress: () => update.mutate({ date: addDays(item.date, 7) }) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function confirmRemove() {
    Alert.alert('Remove from plan?', item.title, [
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const planned = item.status === 'planned';
  return (
    <View style={styles.item}>
      <ThemedText type="small" style={!planned && styles.doneText}>
        {item.title}
      </ThemedText>
      <Row style={styles.wrap}>
        <Pill label={item.kind === 'meal' ? 'Meal' : 'Activity'} tone="accent" />
        {item.kind === 'meal' && item.timeSlot ? <Pill label={SLOT_LABEL[item.timeSlot]} tone="muted" /> : null}
        {item.minutes ? <Pill label={`${item.minutes} min`} tone="muted" /> : null}
        {item.status === 'done' ? <Pill label="Done" tone="success" /> : null}
        {item.status === 'skipped' ? <Pill label="Skipped" tone="muted" /> : null}
      </Row>
      {item.note ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {item.note}
        </ThemedText>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {focused ? <Notice tone="info">Describe the change in “Change your plan” at the end of the week.</Notice> : null}
      {planned ? (
        <Row style={styles.wrap}>
          <Button title="Done" size="small" variant="secondary" onPress={() => update.mutate({ status: 'done' })} accessibilityLabel={`Mark ${item.title} done`} />
          <Button title="Skip" size="small" variant="secondary" onPress={() => update.mutate({ status: 'skipped' })} accessibilityLabel={`Skip ${item.title}`} />
          <Button title="Move" size="small" variant="quiet" onPress={move} accessibilityLabel={`Move ${item.title}`} />
          <Button title="Change…" size="small" variant="quiet" onPress={onFocus} accessibilityLabel={`Ask to change ${item.title}`} />
          <Button title="Remove" size="small" variant="quiet" onPress={confirmRemove} accessibilityLabel={`Remove ${item.title}`} />
        </Row>
      ) : (
        <Button title="Undo" size="small" variant="quiet" onPress={() => update.mutate({ status: 'planned' })} accessibilityLabel={`Undo ${item.status} for ${item.title}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: Spacing.three },
  fill: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  weekLabel: { flex: 1, textAlign: 'center' },
  today: { borderWidth: 1, borderColor: '#208AEF' },
  item: { gap: Spacing.one, paddingVertical: Spacing.one },
  doneText: { opacity: 0.6, textDecorationLine: 'line-through' },
});
