import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, ErrorState, errorMessage, Loading, Row, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { dropDraft, getDraft, type RoutineDraftHandoff } from '@/lib/drafts';
import type { Exercise, Routine, RoutineInput } from '@/lib/types';

type ExerciseRow = {
  key: string;
  name: string;
  sets: string;
  reps: string;
  duration: string;
  weight: string;
  weightUnit: 'kg' | 'lb';
  rest: string;
};

let counter = 0;
const key = () => `ex${++counter}`;
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

function toRow(e: Exercise): ExerciseRow {
  return {
    key: key(),
    name: e.name,
    sets: str(e.sets),
    reps: str(e.reps),
    duration: str(e.durationSeconds),
    weight: str(e.weight),
    weightUnit: e.weightUnit ?? 'kg',
    rest: str(e.restSeconds),
  };
}

const blank = (): ExerciseRow => ({ key: key(), name: '', sets: '3', reps: '10', duration: '', weight: '', weightUnit: 'kg', rest: '' });

export default function EditRoutine() {
  const api = useApi();
  const params = useLocalSearchParams<{ id?: string; draftId?: string }>();
  const existing = useQuery({ queryKey: ['routine', params.id], queryFn: () => api.routines.get(params.id!), enabled: !!params.id });
  if (params.id) {
    if (existing.isPending) return <Loading label="Loading routine…" />;
    if (existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
    return <RoutineEditor routine={existing.data} />;
  }
  return <RoutineEditor handoff={getDraft<RoutineDraftHandoff>(params.draftId)} draftId={params.draftId} />;
}

function RoutineEditor({ routine, handoff, draftId }: { routine?: Routine; handoff?: RoutineDraftHandoff; draftId?: string }) {
  const api = useApi();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = routine ?? handoff?.draft;
  const [name, setName] = useState(base?.name ?? '');
  const [notes, setNotes] = useState(base?.notes ?? '');
  const [rows, setRows] = useState<ExerciseRow[]>(base?.exercises.length ? base.exercises.map(toRow) : [blank()]);
  const [validation, setValidation] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: RoutineInput) => (routine ? api.routines.update(routine.id, body) : api.routines.create(body)),
    onSuccess: (saved) => {
      dropDraft(draftId);
      queryClient.setQueryData(['routine', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['routines'] });
      if (routine) router.back();
      else router.replace({ pathname: '/activity/[id]', params: { id: saved.id } });
    },
  });

  function submit() {
    setValidation(null);
    const toInt = (v: string) => (v.trim() ? Math.round(Number(v)) : null);
    const toNum = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
    const exercises: Exercise[] = rows
      .filter((r) => r.name.trim())
      .map((r) => {
        const weight = toNum(r.weight);
        return {
          name: r.name.trim(),
          sets: toInt(r.sets),
          reps: toInt(r.reps),
          durationSeconds: toInt(r.duration),
          weight,
          weightUnit: weight != null ? r.weightUnit : null,
          restSeconds: toInt(r.rest),
        };
      });
    const numbers = exercises.flatMap((e) => [e.sets, e.reps, e.durationSeconds, e.weight, e.restSeconds]);
    if (!name.trim()) return setValidation('Give the routine a name.');
    if (!exercises.length) return setValidation('Add at least one exercise.');
    if (numbers.some((n) => n != null && (!Number.isFinite(n) || n < 0))) return setValidation('Numbers must be positive, like 3 or 12.');
    if (exercises.some((e) => e.sets === 0 || e.reps === 0 || e.durationSeconds === 0))
      return setValidation('Sets, reps and durations must be at least 1, or left empty.');
    save.mutate({ name: name.trim(), notes: notes.trim() || null, exercises });
  }

  const update = (k: string, patch: Partial<ExerciseRow>) => setRows((all) => all.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const move = (index: number, delta: number) =>
    setRows((all) => {
      const next = [...all];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row);
      return next;
    });
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }];

  const field = (row: ExerciseRow, label: string, prop: 'sets' | 'reps' | 'duration' | 'weight' | 'rest', placeholder: string) => (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={row[prop]}
        onChangeText={(t) => update(row.key, { [prop]: t })}
        keyboardType={prop === 'weight' ? 'decimal-pad' : 'number-pad'}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={`${label} for ${row.name || 'exercise'}`}
        style={inputStyle}
      />
    </View>
  );

  return (
    <Screen
      footer={
        <>
          {validation ? <Notice tone="error">{validation}</Notice> : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          <Button title={routine ? 'Save changes' : 'Save routine'} onPress={submit} loading={save.isPending} />
        </>
      }>
      <Stack.Screen options={{ title: routine ? 'Edit routine' : handoff ? 'Review routine' : 'New routine' }} />
      {handoff?.warnings.length ? <Notice tone="info">{handoff.warnings.join('\n')}</Notice> : null}
      <TextField label="Routine name" value={name} onChangeText={setName} placeholder="e.g. Morning mobility" maxLength={120} />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <SectionHeader title="Exercises" />
      {rows.map((row, index) => (
        <Card key={row.key}>
          <TextField label={`Exercise ${index + 1}`} value={row.name} onChangeText={(t) => update(row.key, { name: t })} placeholder="e.g. Squats" maxLength={120} />
          <Row>
            {field(row, 'Sets', 'sets', '3')}
            {field(row, 'Reps', 'reps', '10')}
            {field(row, 'Seconds', 'duration', '—')}
          </Row>
          <Row>
            {field(row, 'Weight', 'weight', '—')}
            <View style={styles.unit}>
              <ChipGroup
                options={[
                  { value: 'kg', label: 'kg' },
                  { value: 'lb', label: 'lb' },
                ]}
                multiple={false}
                selected={[row.weightUnit]}
                onChange={(v) => v[0] && update(row.key, { weightUnit: v[0] as 'kg' | 'lb' })}
              />
            </View>
            {field(row, 'Rest (s)', 'rest', '—')}
          </Row>
          <Row>
            <View style={styles.fill} />
            <Button title="↑" size="small" variant="secondary" disabled={index === 0} onPress={() => move(index, -1)} accessibilityLabel={`Move ${row.name || 'exercise'} up`} />
            <Button title="↓" size="small" variant="secondary" disabled={index === rows.length - 1} onPress={() => move(index, 1)} accessibilityLabel={`Move ${row.name || 'exercise'} down`} />
            <Button title="Remove" size="small" variant="quiet" onPress={() => setRows((all) => all.filter((r) => r.key !== row.key))} accessibilityLabel={`Remove ${row.name || 'exercise'}`} />
          </Row>
        </Card>
      ))}
      <Button title="Add exercise" size="small" variant="secondary" onPress={() => setRows((all) => [...all, blank()])} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  field: { flex: 1, gap: Spacing.one },
  unit: { justifyContent: 'flex-end', paddingTop: Spacing.three },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two + Spacing.one, minHeight: 44, fontSize: 16 },
});
