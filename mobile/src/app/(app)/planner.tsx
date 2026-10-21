import { useAuth } from '@clerk/expo';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, errorMessage, ListItem, Loading, Row, Screen, SectionHeader, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';
import { addDays, localDate, weekdayShort, weekStart } from '@/lib/dates';
import { clearPlanDraft, draftFromProposal, loadPlanDraft, savePlanDraft, type PlanDraft } from '@/lib/plan-draft';
import type { TimeSlot } from '@/lib/types';

const SLOTS = [
  { value: 'morning', label: 'Breakfast' },
  { value: 'midday', label: 'Lunch' },
  { value: 'evening', label: 'Dinner' },
] as const;
const LIMITS = ['10', '15', '20', '30', '45', '60'];
const EQUIPMENT = ['Dumbbells', 'Resistance bands', 'Kettlebell', 'Yoga mat', 'Exercise bike', 'Pull-up bar'];

function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((d) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  });
  return Math.round((b - a) / 86_400_000);
}

/** Set up a weekly plan: which days, meals, activity time and saved items to use. Nothing is saved here. */
export default function PlannerSetup() {
  const api = useApi();
  const router = useRouter();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ start?: string; activityDays?: string; minutesPerDay?: string; mealSlots?: string }>();
  const today = localDate();
  const thisSunday = addDays(weekStart(today), 6);
  const nextMonday = addDays(weekStart(today), 7);
  const restDays = daysBetween(today, thisSunday) + 1;

  const periods = [
    {
      value: 'rest',
      label: restDays === 7 ? 'This week' : `Rest of this week (${weekdayShort(today)} – ${weekdayShort(thisSunday)})`,
      start: today,
      days: restDays,
    },
    { value: 'next', label: `Next week (${weekdayShort(nextMonday)} – ${weekdayShort(addDays(nextMonday, 6))})`, start: nextMonday, days: 7 },
  ];
  if (params.start && params.start > nextMonday) {
    periods.push({ value: 'later', label: `Week of ${weekdayShort(params.start)}`, start: params.start, days: 7 });
  }
  const defaultPeriod =
    params.start === today ? 'rest' : params.start === nextMonday ? 'next' : params.start && params.start > nextMonday ? 'later' : restDays >= 4 ? 'rest' : 'next';

  const [period, setPeriod] = useState(defaultPeriod);
  const [mealSlots, setMealSlots] = useState<TimeSlot[]>(
    (params.mealSlots?.split(',').filter((s) => ['morning', 'midday', 'evening'].includes(s)) as TimeSlot[] | undefined) ?? ['evening'],
  );
  const [activityDays, setActivityDays] = useState(params.activityDays ? Number(params.activityDays) : 3);
  const [limit, setLimit] = useState<string | null>(params.minutesPerDay ?? null);
  const [recipeSel, setRecipeSel] = useState<string[] | null>(null); // null = all saved recipes
  const [routineSel, setRoutineSel] = useState<string[] | null>(null);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [existingDraft, setExistingDraft] = useState<PlanDraft | null>(null);
  const abort = useRef<AbortController | null>(null);

  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile.get });
  const recipes = useQuery({ queryKey: ['recipes', ''], queryFn: () => api.recipes.list() });
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 0 });

  useEffect(() => {
    let alive = true;
    if (userId) loadPlanDraft(userId).then((d) => alive && setExistingDraft(d && d.accepted.length < d.items.length ? d : null));
    return () => {
      alive = false;
    };
  }, [userId]);

  const chosen = periods.find((p) => p.value === period) ?? periods[0];
  const days = chosen.days;
  const allRecipeIds = (recipes.data ?? []).slice(0, 30).map((r) => r.id);
  const allRoutineIds = (routines.data ?? []).slice(0, 20).map((r) => r.id);
  const recipeIds = recipeSel ?? allRecipeIds;
  const routineIds = routineSel ?? allRoutineIds;
  const profileEquipment = profile.data?.equipment ?? [];
  const aiOff = status.data ? !status.data.aiAvailable : status.isError;
  const nothingSelected = recipeIds.length === 0 && routineIds.length === 0;
  const nothingToPlan = mealSlots.length === 0 && activityDays === 0;

  const propose = useMutation({
    mutationFn: () => {
      abort.current = new AbortController();
      return api.planner.propose(
        {
          startDate: chosen.start,
          days,
          mealSlots,
          activityDays: Math.min(activityDays, days),
          minutesPerDay: limit ? Number(limit) : null,
          recipeIds,
          routineIds,
          equipment: profileEquipment.length === 0 && equipment.length ? equipment : null,
          note: note.trim() || null,
        },
        abort.current.signal,
      );
    },
    onSuccess: async (proposal) => {
      if (userId) await savePlanDraft(userId, draftFromProposal(proposal));
      router.replace('/planner-review');
    },
  });
  const cancelled = propose.error instanceof ApiError && propose.error.kind === 'cancelled';

  if (profile.isPending || recipes.isPending || routines.isPending) return <Screen aboveTabBar={false}><Loading label="Loading your recipes and routines…" /></Screen>;

  return (
    <Screen
      aboveTabBar={false}
      footer={
        propose.isPending ? (
          <Row>
            <View style={styles.fill}>
              <Button title="Drafting your week…" loading disabled onPress={() => undefined} />
            </View>
            <Button title="Cancel" variant="quiet" onPress={() => abort.current?.abort()} />
          </Row>
        ) : (
          <Button
            title="Draft my week"
            onPress={() => propose.mutate()}
            disabled={nothingToPlan || (aiOff && nothingSelected)}
            accessibilityHint="Creates a draft you can review and edit. Nothing is saved yet."
          />
        )
      }>
      {existingDraft ? (
        <Card>
          <ThemedText type="smallBold">You have a draft in progress</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {weekdayShort(existingDraft.proposal.startDate)} – {weekdayShort(addDays(existingDraft.proposal.startDate, existingDraft.proposal.days - 1))}:{' '}
            {existingDraft.items.length - existingDraft.accepted.length} items not saved yet.
          </ThemedText>
          <Row>
            <Button title="Continue reviewing" size="small" onPress={() => router.replace('/planner-review')} />
            <Button
              title="Discard it"
              size="small"
              variant="quiet"
              onPress={async () => {
                if (userId) await clearPlanDraft(userId);
                setExistingDraft(null);
              }}
            />
          </Row>
        </Card>
      ) : null}

      {aiOff ? (
        <Notice tone="info">
          {`Automatic suggestions are off right now${status.data?.aiUnavailableReason ? ` (${status.data.aiUnavailableReason.replace(/[.\s]+$/, '')})` : ''}. Your week will be filled only from the recipes and routines you select below, and you can always add items yourself in the week view.`}
        </Notice>
      ) : null}

      <SectionHeader title="Which days" />
      <ChipGroup options={periods} multiple={false} selected={[period]} onChange={(v) => v[0] && setPeriod(v[0])} />

      <SectionHeader title="Meals to plan" />
      <ChipGroup options={SLOTS} selected={mealSlots} onChange={(v) => setMealSlots(v as TimeSlot[])} />

      <SectionHeader title="Activity" />
      <Stepper label="Activity days" value={Math.min(activityDays, days)} onChange={setActivityDays} min={0} max={days} />
      {activityDays > 0 ? (
        <View style={styles.section}>
          <ThemedText type="small">Time available per activity</ThemedText>
          <ChipGroup
            options={[...LIMITS.map((m) => ({ value: m, label: `${m} min` })), { value: 'none', label: 'No limit' }]}
            multiple={false}
            selected={[limit ?? 'none']}
            onChange={(v) => setLimit(!v[0] || v[0] === 'none' ? null : v[0])}
          />
        </View>
      ) : null}
      {activityDays > 0 && profileEquipment.length === 0 ? (
        <View style={styles.section}>
          <ThemedText type="small">
            Your profile doesn&apos;t list any equipment. Pick anything you can use this week (for this plan only), or leave it empty for bodyweight exercises.
          </ThemedText>
          <ChipGroup options={EQUIPMENT.map((e) => ({ value: e, label: e }))} selected={equipment} onChange={setEquipment} />
        </View>
      ) : null}

      <SectionHeader
        title={`Your recipes (${recipeIds.length} selected)`}
        action={
          allRecipeIds.length ? (
            <Button
              title={recipeIds.length ? 'None' : 'All'}
              size="small"
              variant="quiet"
              onPress={() => setRecipeSel(recipeIds.length ? [] : allRecipeIds)}
            />
          ) : undefined
        }
      />
      {allRecipeIds.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No saved recipes yet. {aiOff ? 'Meals will be left open for you to fill in.' : 'Meals will be new ideas you can review.'}
        </ThemedText>
      ) : (
        (recipes.data ?? []).slice(0, 30).map((r) => (
          <ListItem
            key={r.id}
            title={r.title}
            subtitle={r.tags.length ? r.tags.join(', ') : undefined}
            onPress={() => setRecipeSel(toggle(recipeIds, r.id))}
            trailing={<ThemedText type="smallBold">{recipeIds.includes(r.id) ? '✓' : ' '}</ThemedText>}
            accessibilityHint={recipeIds.includes(r.id) ? 'Selected. Tap to leave it out.' : 'Tap to include it.'}
          />
        ))
      )}

      <SectionHeader
        title={`Your routines (${routineIds.length} selected)`}
        action={
          allRoutineIds.length ? (
            <Button
              title={routineIds.length ? 'None' : 'All'}
              size="small"
              variant="quiet"
              onPress={() => setRoutineSel(routineIds.length ? [] : allRoutineIds)}
            />
          ) : undefined
        }
      />
      {allRoutineIds.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No saved routines yet.
        </ThemedText>
      ) : (
        (routines.data ?? []).slice(0, 20).map((r) => (
          <ListItem
            key={r.id}
            title={r.name}
            subtitle={`${r.exercises.length} exercise${r.exercises.length === 1 ? '' : 's'}`}
            onPress={() => setRoutineSel(toggle(routineIds, r.id))}
            trailing={<ThemedText type="smallBold">{routineIds.includes(r.id) ? '✓' : ' '}</ThemedText>}
            accessibilityHint={routineIds.includes(r.id) ? 'Selected. Tap to leave it out.' : 'Tap to include it.'}
          />
        ))
      )}

      <TextField
        label="Anything just for this week? (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="e.g. vegetarian this week, busy Thursday"
        maxLength={500}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Used for this plan only — it isn&apos;t remembered. Your goals, diet and saved preferences from Profile are used
        automatically, and the draft shows which ones.
      </ThemedText>

      {nothingToPlan ? <Notice tone="info">Choose at least one meal or one activity day.</Notice> : null}
      {aiOff && nothingSelected && !nothingToPlan ? (
        <Notice tone="info">Select at least one saved recipe or routine, or plan your week manually from the week view.</Notice>
      ) : null}
      {propose.isError && !cancelled ? <Notice tone="error">{errorMessage(propose.error)}</Notice> : null}
      {propose.isPending ? (
        <ThemedText type="small" themeColor="textSecondary">
          This can take a minute with a local model. Nothing is saved until you accept the draft.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { gap: Spacing.two },
});
