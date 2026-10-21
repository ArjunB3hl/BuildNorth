import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Countdown } from '@/components/countdown';
import { Accent, Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Pill, Row, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useActiveSession, type ActiveSession } from '@/hooks/use-active-session';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, localDate } from '@/lib/dates';
import { describeExercise } from '@/lib/exercise';
import type { Routine, SetResult } from '@/lib/types';

function freshSession(routine: Routine, planItemId: string | null): ActiveSession {
  return {
    routineId: routine.id,
    routineName: routine.name,
    planItemId,
    startedAt: new Date().toISOString(),
    current: 0,
    entries: routine.exercises.map((e) => ({
      name: e.name,
      weightUnit: e.weight != null ? (e.weightUnit ?? 'kg') : null,
      skipped: false,
      sets: Array.from({ length: Math.max(1, e.sets ?? 1) }, () => ({
        reps: e.reps ?? null,
        weight: e.weight ?? null,
        durationSeconds: e.durationSeconds ?? null,
        completed: false,
      })),
    })),
  };
}

export default function RunSession() {
  const params = useLocalSearchParams<{ routineId: string; planItemId?: string }>();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const store = useActiveSession();
  const routine = useQuery({ queryKey: ['routine', params.routineId], queryFn: () => api.routines.get(params.routineId) });
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restFor, setRestFor] = useState<number | null>(null);

  // Resume an in-progress session for this routine, or start a new one.
  useEffect(() => {
    if (!routine.data || session) return;
    store.load().then((saved) => {
      setSession(saved && saved.routineId === routine.data.id ? saved : freshSession(routine.data, params.planItemId ?? null));
    });
  }, [routine.data, session, store, params.planItemId]);

  useEffect(() => {
    if (session) store.save(session);
  }, [session, store]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const finish = useMutation({
    mutationFn: (s: ActiveSession) =>
      api.sessions.create({
        routineId: s.routineId,
        routineName: s.routineName,
        localDate: localDate(new Date(s.startedAt)),
        startedAt: s.startedAt,
        finishedAt: new Date().toISOString(),
        planItemId: s.planItemId,
        entries: s.entries.map((e) => ({ ...e, sets: e.skipped ? [] : e.sets })),
      }),
    onSuccess: async (saved) => {
      await store.clear();
      for (const key of ['sessions', 'progress', 'today']) queryClient.invalidateQueries({ queryKey: [key] });
      router.replace({ pathname: '/activity/session/[id]', params: { id: saved.id, justFinished: '1' } });
    },
  });

  if (routine.isPending || (routine.data && !session)) return <Loading label="Getting your session ready…" />;
  if (routine.isError && !routine.data) return <ErrorState error={routine.error} onRetry={() => routine.refetch()} />;
  if (!session || !routine.data) return null;

  const exercise = routine.data.exercises[session.current];
  const entry = session.entries[session.current];
  const last = session.current === session.entries.length - 1;
  const elapsed = (now - new Date(session.startedAt).getTime()) / 1000;
  const completedSets = session.entries.reduce((n, e) => n + (e.skipped ? 0 : e.sets.filter((s) => s.completed).length), 0);

  const updateSet = (index: number, patch: Partial<SetResult>) =>
    setSession((s) =>
      s && {
        ...s,
        entries: s.entries.map((e, i) =>
          i === s.current ? { ...e, sets: e.sets.map((set, j) => (j === index ? { ...set, ...patch } : set)) } : e,
        ),
      },
    );
  const go = (delta: number) => {
    setRestFor(null);
    setSession((s) => s && { ...s, current: Math.min(s.entries.length - 1, Math.max(0, s.current + delta)) });
  };

  const confirmFinish = () =>
    Alert.alert('Finish and save this session?', `${completedSets} set${completedSets === 1 ? '' : 's'} completed in ${formatDuration(elapsed)}.`, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', onPress: () => finish.mutate(session) },
    ]);
  const confirmDiscard = () =>
    Alert.alert('Discard this session?', 'Nothing from this session will be saved.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await store.clear();
          router.back();
        },
      },
    ]);

  return (
    <Screen aboveTabBar={false}
      footer={
        <>
          {finish.isError ? <Notice tone="error">{`${errorMessage(finish.error)} Your session is kept on this device, so you can try again.`}</Notice> : null}
          <Row>
            <View style={styles.fill}>
              <Button title="Previous" variant="secondary" onPress={() => go(-1)} disabled={session.current === 0} />
            </View>
            <View style={styles.fill}>
              {last ? <Button title="Finish" onPress={confirmFinish} loading={finish.isPending} /> : <Button title="Next exercise" onPress={() => go(1)} />}
            </View>
          </Row>
        </>
      }>
      <Stack.Screen
        options={{
          title: session.routineName,
          headerLeft: () => <Button title="Discard" size="small" variant="quiet" onPress={confirmDiscard} />,
          headerRight: () => (last ? null : <Button title="Finish" size="small" variant="quiet" onPress={confirmFinish} />),
        }}
      />
      <Row>
        <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
          Exercise {session.current + 1} of {session.entries.length}
        </ThemedText>
        <ThemedText type="smallBold" accessibilityLabel={`Elapsed ${formatDuration(elapsed)}`}>
          {formatDuration(elapsed)}
        </ThemedText>
      </Row>

      <View style={styles.heading}>
        <ThemedText type="subtitle">{entry.name}</ThemedText>
        {exercise ? (
          <ThemedText themeColor="textSecondary">Target: {describeExercise(exercise)}</ThemedText>
        ) : null}
        {entry.skipped ? <Pill label="Skipped" tone="muted" /> : null}
      </View>

      {!entry.skipped && exercise?.durationSeconds ? (
        <Countdown key={`work-${session.current}`} seconds={exercise.durationSeconds} label="Exercise timer" />
      ) : null}
      {restFor ? <Countdown key={`rest-${session.current}-${restFor}`} seconds={exercise?.restSeconds ?? 60} label="Rest" /> : null}

      {!entry.skipped
        ? entry.sets.map((set, index) => (
            <SetRow
              key={index}
              index={index}
              set={set}
              weightUnit={entry.weightUnit ?? null}
              timed={!!exercise?.durationSeconds}
              onChange={(patch) => {
                updateSet(index, patch);
                if (patch.completed && exercise?.restSeconds) setRestFor(Date.now());
              }}
            />
          ))
        : null}

      <Button
        title={entry.skipped ? 'Do this exercise' : 'Skip this exercise'}
        size="small"
        variant="quiet"
        onPress={() =>
          setSession((s) => s && { ...s, entries: s.entries.map((e, i) => (i === s.current ? { ...e, skipped: !e.skipped } : e)) })
        }
      />
      <ThemedText type="small" themeColor="textSecondary">
        Stop if you feel pain, dizziness or shortness of breath.
      </ThemedText>
    </Screen>
  );
}

function SetRow({
  index,
  set,
  weightUnit,
  timed,
  onChange,
}: {
  index: number;
  set: SetResult;
  weightUnit: 'kg' | 'lb' | null;
  timed: boolean;
  onChange: (patch: Partial<SetResult>) => void;
}) {
  const theme = useTheme();
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }];
  const num = (v: string, int = true) => {
    if (!v.trim()) return null;
    const n = int ? Math.round(Number(v)) : Number(v.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return (
    <Card style={set.completed && styles.doneCard}>
      <Row>
        <ThemedText type="smallBold" style={styles.setLabel}>
          Set {index + 1}
        </ThemedText>
        {timed ? (
          <TextInput
            defaultValue={set.durationSeconds == null ? '' : String(set.durationSeconds)}
            onChangeText={(t) => onChange({ durationSeconds: num(t) })}
            keyboardType="number-pad"
            placeholder="sec"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={`Seconds for set ${index + 1}`}
            style={inputStyle}
          />
        ) : (
          <TextInput
            defaultValue={set.reps == null ? '' : String(set.reps)}
            onChangeText={(t) => onChange({ reps: num(t) })}
            keyboardType="number-pad"
            placeholder="reps"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={`Reps for set ${index + 1}`}
            style={inputStyle}
          />
        )}
        {weightUnit ? (
          <TextInput
            defaultValue={set.weight == null ? '' : String(set.weight)}
            onChangeText={(t) => onChange({ weight: num(t, false) })}
            keyboardType="decimal-pad"
            placeholder={weightUnit}
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={`Weight in ${weightUnit} for set ${index + 1}`}
            style={inputStyle}
          />
        ) : null}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: set.completed }}
          accessibilityLabel={`Set ${index + 1} done`}
          onPress={() => onChange({ completed: !set.completed })}
          style={[styles.check, { borderColor: set.completed ? Accent : theme.textSecondary, backgroundColor: set.completed ? Accent : 'transparent' }]}>
          <ThemedText style={{ color: set.completed ? '#ffffff' : theme.textSecondary }}>✓</ThemedText>
        </Pressable>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  heading: { gap: Spacing.one },
  setLabel: { width: 56 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, minHeight: 44, fontSize: 16 },
  check: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  doneCard: { opacity: 0.75 },
});
