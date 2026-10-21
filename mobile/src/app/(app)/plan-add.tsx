import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, EmptyState, errorMessage, ListItem, Loading, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { invalidatePlan } from '@/lib/plan-cache';
import { addDays, friendlyDate, localDate } from '@/lib/dates';
import { newKey } from '@/lib/keys';
import type { TimeSlot } from '@/lib/types';

type Kind = 'meal' | 'activity';

export default function PlanAdd() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ kind?: Kind; recipeId?: string; routineId?: string; title?: string; date?: string }>();
  const today = localDate();
  // One key per screen visit: a double tap or a retry after a timeout returns the same item instead of a duplicate.
  const [clientKey] = useState(() => `m:${newKey()}`);

  const [kind, setKind] = useState<Kind>(params.kind ?? (params.routineId ? 'activity' : 'meal'));
  const [linkedId, setLinkedId] = useState<string | null>(params.recipeId ?? params.routineId ?? null);
  const [title, setTitle] = useState(params.title ?? '');
  const [date, setDate] = useState(params.date ?? today);
  const [slot, setSlot] = useState<TimeSlot | null>(null);

  const recipes = useQuery({ queryKey: ['recipes', ''], queryFn: () => api.recipes.list(), enabled: kind === 'meal' });
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list, enabled: kind === 'activity' });
  const saved = kind === 'meal' ? recipes : routines;
  const options = (saved.data ?? []).map((r) => ({ id: r.id, title: 'title' in r ? r.title : r.name }));

  const add = useMutation({
    mutationFn: () =>
      api.plan.add({
        date,
        kind,
        title: title.trim(),
        timeSlot: slot,
        recipeId: kind === 'meal' ? linkedId : null,
        routineId: kind === 'activity' ? linkedId : null,
        clientKey,
      }),
    onSuccess: async () => {
      await invalidatePlan(queryClient);
      router.back();
    },
  });

  // The next seven days, plus the day this was opened for (it can be earlier in the week being planned).
  const first = params.date && params.date < today ? params.date : today;
  const dayOptions = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const day = addDays(first, n);
    return { value: day, label: friendlyDate(day, today) };
  });
  if (params.date && !dayOptions.some((o) => o.value === params.date)) {
    dayOptions.push({ value: params.date, label: friendlyDate(params.date, today) });
  }

  return (
    <Screen>
      <ChipGroup
        options={[
          { value: 'meal', label: 'Meal' },
          { value: 'activity', label: 'Activity' },
        ]}
        multiple={false}
        selected={[kind]}
        onChange={(v) => {
          if (v[0]) {
            setKind(v[0] as Kind);
            setLinkedId(null);
          }
        }}
      />

      <SectionHeader title={kind === 'meal' ? 'From your recipes' : 'From your routines'} />
      {saved.isPending ? <Loading /> : null}
      {saved.isError ? <Notice tone="error">{errorMessage(saved.error)}</Notice> : null}
      {saved.data && options.length === 0 ? (
        <EmptyState
          title={kind === 'meal' ? 'No saved recipes yet' : 'No saved routines yet'}
          body="You can still type a name below."
        />
      ) : null}
      {options.map((o) => (
        <ListItem
          key={o.id}
          title={o.title}
          onPress={() => {
            setLinkedId(o.id);
            setTitle(o.title);
          }}
          trailing={linkedId === o.id ? <ThemedText type="smallBold">✓</ThemedText> : undefined}
          accessibilityHint="Selects this for the plan"
        />
      ))}

      <TextField
        label="Name"
        value={title}
        onChangeText={(t) => {
          setTitle(t);
          setLinkedId(null);
        }}
        placeholder={kind === 'meal' ? 'e.g. Leftover curry' : 'e.g. 20-minute walk'}
        maxLength={200}
      />

      <View style={styles.section}>
        <ThemedText type="smallBold">Day</ThemedText>
        <ChipGroup options={dayOptions} multiple={false} selected={[date]} onChange={(v) => v[0] && setDate(v[0])} />
      </View>
      <View style={styles.section}>
        <ThemedText type="smallBold">Time of day (optional)</ThemedText>
        <ChipGroup
          options={[
            { value: 'morning', label: 'Morning' },
            { value: 'midday', label: 'Midday' },
            { value: 'evening', label: 'Evening' },
          ]}
          multiple={false}
          selected={slot ? [slot] : []}
          onChange={(v) => setSlot((v[0] as TimeSlot) ?? null)}
        />
      </View>

      {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
      <Button title="Add to plan" onPress={() => add.mutate()} loading={add.isPending} disabled={!title.trim() || add.isPending} />
    </Screen>
  );
}

const styles = StyleSheet.create({ section: { gap: Spacing.two } });
