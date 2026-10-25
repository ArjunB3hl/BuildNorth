import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { NumberBadge } from '@/components/activity/exercise';
import { AddButton, IconButton } from '@/components/activity/icon';
import { FormActions, Section, useMeasuredWidth } from '@/components/activity/layout';
import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, ErrorState, errorMessage, Loading, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { dropDraft, getDraft, type RoutineDraftHandoff } from '@/lib/drafts';
import type { Exercise, Routine, RoutineInput } from '@/lib/types';
import { Enter } from '@/components/motion';

const isWeb = Platform.OS === 'web';

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
  // The row added last gets the cursor, so adding an exercise flows straight into naming it.
  const [focusKey, setFocusKey] = useState<string | null>(null);

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
  const addRow = () => {
    const row = blank();
    setRows((all) => [...all, row]);
    setFocusKey(row.key);
  };
  // Phones put inputs on a white field inside the grey card; the web matches the shared TextField.
  const onCard = isWeb ? undefined : { backgroundColor: theme.background, borderColor: theme.backgroundSelected };

  return (
    <Screen
      footer={
        <>
          {validation ? <Notice tone="error">{validation}</Notice> : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          <FormActions primary={<Button title={routine ? 'Save changes' : 'Save routine'} onPress={submit} loading={save.isPending} />} />
        </>
      }>
      <Stack.Screen options={{ title: routine ? 'Edit routine' : handoff ? 'Review routine' : 'New routine' }} />
      {handoff?.warnings.length ? <Notice tone="info">{handoff.warnings.join('\n')}</Notice> : null}
      <Enter>
        <ThemedText themeColor="textSecondary">
          {handoff
            ? 'Check the exercises we read from your description, then save.'
            : 'Name the routine, then add its exercises. Leave any number empty if it doesn’t apply.'}
        </ThemedText>
      </Enter>

      <Enter index={1}>
        <Section>
          <SectionHeader title="Details" />
          <Card style={styles.card}>
            <TextField label="Routine name" value={name} onChangeText={setName} placeholder="e.g. Morning mobility" maxLength={120} style={onCard} />
            <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} style={[styles.notes, onCard]} />
          </Card>
        </Section>
      </Enter>

      <Enter index={2}>
        <Section>
          <SectionHeader
            title="Exercises"
            action={
              rows.length ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {rows.length}
                </ThemedText>
              ) : null
            }
          />
          {rows.map((row, index) => (
            <ExerciseEditor
              key={row.key}
              row={row}
              index={index}
              count={rows.length}
              autoFocus={row.key === focusKey}
              onChange={(patch) => update(row.key, patch)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => setRows((all) => all.filter((r) => r.key !== row.key))}
            />
          ))}
          {!rows.length ? (
            <ThemedText type="small" themeColor="textSecondary">
              No exercises yet. A routine needs at least one.
            </ThemedText>
          ) : null}
          <AddButton label="Add exercise" onPress={addRow} />
        </Section>
      </Enter>
    </Screen>
  );
}

type NumberProp = 'sets' | 'reps' | 'duration' | 'weight' | 'rest';

function ExerciseEditor({
  row,
  index,
  count,
  autoFocus,
  onChange,
  onMove,
  onRemove,
}: {
  row: ExerciseRow;
  index: number;
  count: number;
  autoFocus: boolean;
  onChange: (patch: Partial<ExerciseRow>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const [width, onLayout] = useMeasuredWidth();
  // All targets fit on one line in a wide card; phones split them over two.
  const oneLine = width >= 560;
  const label = row.name || 'exercise';
  const inputStyle = [
    styles.input,
    isWeb
      ? { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }
      : { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
  ];

  const field = (title: string, prop: NumberProp, placeholder: string) => (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {title}
      </ThemedText>
      <TextInput
        value={row[prop]}
        onChangeText={(t) => onChange({ [prop]: t })}
        keyboardType={prop === 'weight' ? 'decimal-pad' : 'number-pad'}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={`${title} for ${label}`}
        style={inputStyle}
      />
    </View>
  );
  const unit = (
    <View style={styles.unitField}>
      <ThemedText type="small" themeColor="textSecondary">
        Unit
      </ThemedText>
      <View style={styles.unit}>
        <ChipGroup
          options={[
            { value: 'kg', label: 'kg' },
            { value: 'lb', label: 'lb' },
          ]}
          multiple={false}
          selected={[row.weightUnit]}
          onChange={(v) => v[0] && onChange({ weightUnit: v[0] as 'kg' | 'lb' })}
        />
      </View>
    </View>
  );

  return (
    <Card>
      <View style={styles.cardHeader}>
        <NumberBadge n={index + 1} />
        <ThemedText type="smallBold" style={styles.fill} numberOfLines={1}>
          Exercise {index + 1}
        </ThemedText>
        <IconButton icon="up" label={`Move ${label} up`} disabled={index === 0} onPress={() => onMove(-1)} />
        <IconButton icon="down" label={`Move ${label} down`} disabled={index === count - 1} onPress={() => onMove(1)} />
        <IconButton icon="remove" tone="danger" label={`Remove ${label}`} onPress={onRemove} />
      </View>
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Name
        </ThemedText>
        <TextInput
          value={row.name}
          onChangeText={(t) => onChange({ name: t })}
          placeholder="e.g. Squats"
          placeholderTextColor={theme.textSecondary}
          maxLength={120}
          autoFocus={autoFocus}
          accessibilityLabel={`Exercise ${index + 1} name`}
          style={inputStyle}
        />
      </View>
      <View onLayout={onLayout} style={styles.fields}>
        {oneLine ? (
          <View style={styles.fieldRow}>
            {field('Sets', 'sets', '3')}
            {field('Reps', 'reps', '10')}
            {field('Time (s)', 'duration', '—')}
            {field('Weight', 'weight', '—')}
            {unit}
            {field('Rest (s)', 'rest', '—')}
          </View>
        ) : (
          <>
            <View style={styles.fieldRow}>
              {field('Sets', 'sets', '3')}
              {field('Reps', 'reps', '10')}
              {field('Time (s)', 'duration', '—')}
            </View>
            <View style={styles.fieldRow}>
              {field('Weight', 'weight', '—')}
              {unit}
              {field('Rest (s)', 'rest', '—')}
            </View>
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  card: { gap: Spacing.three },
  notes: { minHeight: 88, textAlignVertical: 'top' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  fields: { gap: Spacing.three - Spacing.one },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two + Spacing.one },
  field: { flex: 1, minWidth: 0, gap: Spacing.one },
  unitField: { gap: Spacing.one },
  unit: { minHeight: 44, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: isWeb ? 12 : 10, paddingHorizontal: Spacing.two + Spacing.one, minHeight: 44, fontSize: 16 },
});
