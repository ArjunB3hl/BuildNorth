import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { NumberBadge, plural, StatColumns, targetStats } from '@/components/activity/exercise';
import { Icon } from '@/components/activity/icon';

import { Countdown } from '@/components/countdown';
import { Accent, Button, Notice } from '@/components/form';
import { FadeIn, FillBar, Pop } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Pill, Row, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useActiveSession, type ActiveSession } from '@/hooks/use-active-session';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { formatDuration, localDate } from '@/lib/dates';
import type { Routine, SetResult } from '@/lib/types';

const isWeb = Platform.OS === 'web';

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
  const theme = useTheme();
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
      for (const key of ['calendar', 'sessions', 'progress', 'today']) queryClient.invalidateQueries({ queryKey: [key] });
      router.replace({ pathname: '/activity/session/[id]', params: { id: saved.id, justFinished: '1' } });
    },
  });

  if (routine.isPending || (routine.data && !session)) return <Loading label="Getting your session ready…" />;
  if (routine.isError && !routine.data) return <ErrorState error={routine.error} onRetry={() => routine.refetch()} />;
  if (!session || !routine.data) return null;

  const exercise = routine.data.exercises[session.current];
  const entry = session.entries[session.current];
  const next = session.entries[session.current + 1];
  const last = session.current === session.entries.length - 1;
  const elapsed = (now - new Date(session.startedAt).getTime()) / 1000;
  const completedSets = session.entries.reduce((n, e) => n + (e.skipped ? 0 : e.sets.filter((s) => s.completed).length), 0);
  const totalSets = session.entries.reduce((n, e) => n + (e.skipped ? 0 : e.sets.length), 0);
  const progress = totalSets ? completedSets / totalSets : 0;
  const timed = !!exercise?.durationSeconds;

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

  const confirmFinish = async () => {
    const confirmed = await confirmAction({
      title: 'Finish and save this session?',
      message: `${completedSets} set${completedSets === 1 ? '' : 's'} completed in ${formatDuration(elapsed)}.`,
      confirmLabel: 'Finish',
      cancelLabel: 'Keep going',
    });
    if (confirmed) finish.mutate(session);
  };
  const confirmDiscard = async () => {
    const confirmed = await confirmAction({
      title: 'Discard this session?',
      message: 'Nothing from this session will be saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep going',
      destructive: true,
    });
    if (!confirmed) return;
    await store.clear();
    router.back();
  };

  return (
    <Screen
      aboveTabBar={false}
      footer={
        <>
          {finish.isError ? <Notice tone="error">{`${errorMessage(finish.error)} Your session is kept on this device, so you can try again.`}</Notice> : null}
          <Row>
            <View style={styles.fill}>
              <Button title="Previous" variant="secondary" onPress={() => go(-1)} disabled={session.current === 0} />
            </View>
            <View style={styles.fill}>
              {last ? (
                <Button title="Finish session" onPress={() => void confirmFinish()} loading={finish.isPending} />
              ) : (
                <Button title="Next exercise" onPress={() => go(1)} />
              )}
            </View>
          </Row>
        </>
      }>
      <Stack.Screen
        options={{
          title: session.routineName,
          headerLeft: () => <Button title="Discard" size="small" variant="quiet" onPress={() => void confirmDiscard()} />,
          headerRight: () => (last ? null : <Button title="Finish" size="small" variant="quiet" onPress={() => void confirmFinish()} />),
        }}
      />

      <View style={styles.progress}>
        <Row>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.fill}>
            Exercise {session.current + 1} of {session.entries.length}
          </ThemedText>
          <Icon name="timer" size={18} />
          <ThemedText type="smallBold" style={styles.tabular} accessibilityLabel={`Elapsed ${formatDuration(elapsed)}`}>
            {formatDuration(elapsed)}
          </ThemedText>
        </Row>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Sets completed"
          accessibilityValue={{ min: 0, max: totalSets, now: completedSets }}
          style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <FillBar progress={progress} color={Accent} style={styles.trackFill} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {completedSets} of {plural(totalSets, 'set')} done
        </ThemedText>
      </View>

      {/* Keyed by exercise, so moving to the next one eases its card in. */}
      <FadeIn key={`exercise-${session.current}`}>
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <ThemedText type="subtitle" style={styles.fill}>
              {entry.name}
            </ThemedText>
            {entry.skipped ? <Pill label="Skipped" tone="muted" /> : null}
          </View>
          {exercise ? <StatColumns stats={targetStats(exercise)} fill /> : null}
          {exercise?.notes ? (
            <ThemedText type="small" themeColor="textSecondary">
              {exercise.notes}
            </ThemedText>
          ) : null}
        </Card>
      </FadeIn>

      {!entry.skipped && exercise?.durationSeconds ? (
        <Countdown key={`work-${session.current}`} seconds={exercise.durationSeconds} label="Exercise timer" />
      ) : null}
      {restFor ? <Countdown key={`rest-${session.current}-${restFor}`} seconds={exercise?.restSeconds ?? 60} label="Rest before your next set" /> : null}

      {!entry.skipped ? (
        <Card style={styles.sets}>
          <View style={[styles.setRow, styles.setHeader]}>
            <ThemedText type="small" themeColor="textSecondary" style={[styles.colSet, styles.headerLabel]}>
              SET
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={[styles.colInput, styles.headerLabel, styles.center]}>
              {timed ? 'SECONDS' : 'REPS'}
            </ThemedText>
            {entry.weightUnit ? (
              <ThemedText type="small" themeColor="textSecondary" style={[styles.colInput, styles.headerLabel, styles.center]}>
                {`WEIGHT (${entry.weightUnit.toUpperCase()})`}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary" style={[styles.colDone, styles.headerLabel, styles.center]}>
              DONE
            </ThemedText>
          </View>
          {entry.sets.map((set, index) => (
            <SetRow
              // Keyed by exercise too, so the inputs' starting values refresh when moving to the next exercise.
              key={`${session.current}-${index}`}
              index={index}
              set={set}
              weightUnit={entry.weightUnit ?? null}
              timed={timed}
              onChange={(patch) => {
                updateSet(index, patch);
                if (patch.completed && exercise?.restSeconds) setRestFor(Date.now());
              }}
            />
          ))}
        </Card>
      ) : null}

      <View style={styles.after}>
        <Button
          title={entry.skipped ? 'Do this exercise' : 'Skip this exercise'}
          size="small"
          variant="quiet"
          onPress={() =>
            setSession((s) => s && { ...s, entries: s.entries.map((e, i) => (i === s.current ? { ...e, skipped: !e.skipped } : e)) })
          }
        />
        {next ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.upNext} numberOfLines={1}>
            Up next: {next.name}
          </ThemedText>
        ) : null}
      </View>
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
  // Counts ticks made here, so the check mark pops when ticked but not when a resumed session loads.
  const [ticks, setTicks] = useState(0);
  const inputStyle = [
    styles.input,
    isWeb
      ? { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }
      : { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
  ];
  const num = (v: string, int = true) => {
    if (!v.trim()) return null;
    const n = int ? Math.round(Number(v)) : Number(v.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return (
    <View style={[styles.setRow, { borderTopColor: theme.border }, styles.setDivider, set.completed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.colSet}>
        <NumberBadge n={index + 1} done={set.completed} />
      </View>
      <View style={styles.colInput}>
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
      </View>
      {weightUnit ? (
        <View style={styles.colInput}>
          <TextInput
            defaultValue={set.weight == null ? '' : String(set.weight)}
            onChangeText={(t) => onChange({ weight: num(t, false) })}
            keyboardType="decimal-pad"
            placeholder={weightUnit}
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={`Weight in ${weightUnit} for set ${index + 1}`}
            style={inputStyle}
          />
        </View>
      ) : null}
      <View style={styles.colDone}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: set.completed }}
          accessibilityLabel={`Set ${index + 1} done`}
          onPress={() => {
            if (!set.completed) setTicks((n) => n + 1);
            onChange({ completed: !set.completed });
          }}
          hitSlop={4}
          style={({ pressed }) => [styles.checkTarget, pressed && styles.pressed]}>
          <Pop
            count={set.completed ? ticks : 0}
            style={[
              styles.check,
              { transitionProperty: ['backgroundColor', 'borderColor'], transitionDuration: '160ms' },
              { borderColor: set.completed ? Accent : theme.textSecondary, backgroundColor: set.completed ? Accent : 'transparent' },
            ]}>
            <Icon name="check" size={22} color={set.completed ? '#ffffff' : theme.textSecondary} />
          </Pop>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  progress: { gap: Spacing.two },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { borderRadius: 3 },
  hero: { gap: Spacing.three },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sets: { padding: 0, gap: 0, overflow: 'hidden' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - Spacing.one, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  setHeader: { paddingVertical: Spacing.two },
  setDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  headerLabel: { fontSize: 11, lineHeight: 14, letterSpacing: 0.5 },
  center: { textAlign: 'center' },
  colSet: { width: 40 },
  colInput: { flex: 1, minWidth: 0 },
  colDone: { width: 52, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, minHeight: 52, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  checkTarget: { width: 52, height: 52, borderRadius: 26 },
  check: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  after: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  upNext: { flexShrink: 1 },
});
