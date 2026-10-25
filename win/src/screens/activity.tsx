import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ListItem,
  Notice,
  Pill,
  Row,
  Screen,
  SectionHeader,
  ThemedText,
} from '../components/ui';
import { useStore } from '../data/store';
import type { Exercise, SetResult } from '../data/types';
import {
  formatDuration,
  friendlyDate,
  friendlyDateInline,
  localDate,
} from '../lib/dates';
import { useNav } from '../navigation';

export function ActivityScreen() {
  const { state } = useStore();
  const nav = useNav();
  const sessions = [...state.sessions].sort((a, b) =>
    b.localDate.localeCompare(a.localDate),
  );

  return (
    <Screen title="Activity">
      <SectionHeader title="Your routines" />
      {state.routines.length === 0 ? (
        <EmptyState
          title="No routines yet"
          body="Routines you create on iPhone show up here."
        />
      ) : null}
      {state.routines.map(r => (
        <ListItem
          key={r.id}
          title={r.name}
          subtitle={r.exercises.map(e => e.name).join(', ')}
          onPress={() => nav.push({ name: 'routine', id: r.id })}
        />
      ))}

      <SectionHeader title="Recent sessions" />
      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          body="Finished sessions show up here."
        />
      ) : null}
      {sessions.slice(0, 15).map(s => (
        <ListItem
          key={s.id}
          title={s.routineName}
          subtitle={`${friendlyDate(s.localDate)} · ${formatDuration(
            s.durationSeconds,
          )} · ${s.entries.filter(e => !e.skipped).length} exercises`}
          onPress={() => nav.push({ name: 'session', id: s.id })}
        />
      ))}
    </Screen>
  );
}

function describeExercise(e: Exercise): string {
  const amount = e.durationSeconds
    ? e.durationSeconds >= 120
      ? `${Math.round(e.durationSeconds / 60)} min`
      : `${e.durationSeconds} s`
    : e.reps
    ? `${e.reps} reps`
    : null;
  return [
    e.sets && e.sets > 1 ? `${e.sets} sets` : null,
    amount,
    e.weight ? `${e.weight} ${e.weightUnit ?? 'kg'}` : null,
  ]
    .filter(Boolean)
    .join(' × ');
}

export function RoutineScreen({ id }: { id: string }) {
  const { state, dispatch } = useStore();
  const routine = state.routines.find(r => r.id === id);
  if (!routine) {
    return (
      <Screen title="Routine">
        <EmptyState title="This routine was deleted" />
      </Screen>
    );
  }
  const today = localDate();
  const plannedToday = state.plan.some(
    i => i.routineId === routine.id && i.date === today,
  );
  const lastSession = state.sessions
    .filter(s => s.routineId === routine.id)
    .sort((a, b) => b.localDate.localeCompare(a.localDate))[0];

  return (
    <Screen
      title={routine.name}
      subtitle={routine.notes ?? undefined}
      actions={
        <Button
          title={plannedToday ? 'Planned for today' : 'Plan for today'}
          disabled={plannedToday}
          onPress={() =>
            dispatch({
              type: 'plan/add',
              item: {
                date: today,
                kind: 'activity',
                title: routine.name,
                timeSlot: 'evening',
                recipeId: null,
                routineId: routine.id,
                minutes: 30,
                note: null,
              },
            })
          }
        />
      }
    >
      {lastSession ? (
        <ThemedText themeColor="textSecondary">
          Last done {friendlyDateInline(lastSession.localDate)} ·{' '}
          {Math.round(lastSession.durationSeconds / 60)} min
        </ThemedText>
      ) : null}
      <SectionHeader title="Exercises" />
      {routine.exercises.map((e, i) => (
        <Card key={i}>
          <Row>
            <View style={styles.fill}>
              <ThemedText type="smallBold">{e.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {describeExercise(e)}
              </ThemedText>
            </View>
            {e.restSeconds ? (
              <Pill label={`${e.restSeconds} s rest`} tone="muted" />
            ) : null}
          </Row>
        </Card>
      ))}
      <Notice tone="info">
        Running a session with set logging and rest timers is on iPhone for now.
      </Notice>
    </Screen>
  );
}

function describeSet(set: SetResult, unit: string | null | undefined): string {
  if (set.durationSeconds) {
    return set.durationSeconds >= 120
      ? `${Math.round(set.durationSeconds / 60)} min`
      : `${set.durationSeconds} s`;
  }
  const reps = set.reps ? `${set.reps} reps` : '';
  return set.weight ? `${reps} × ${set.weight} ${unit ?? 'kg'}` : reps;
}

export function SessionScreen({ id }: { id: string }) {
  const { state } = useStore();
  const session = state.sessions.find(s => s.id === id);
  if (!session) {
    return (
      <Screen title="Session">
        <EmptyState title="This session was deleted" />
      </Screen>
    );
  }
  return (
    <Screen
      title={session.routineName}
      subtitle={`${friendlyDate(session.localDate)} · ${formatDuration(
        session.durationSeconds,
      )}`}
    >
      {session.entries.map((entry, i) => (
        <Card key={i}>
          <Row>
            <ThemedText type="smallBold" style={styles.fill}>
              {entry.name}
            </ThemedText>
            {entry.skipped ? <Pill label="Skipped" tone="muted" /> : null}
          </Row>
          {entry.sets.map((set, n) => (
            <Row key={n}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.setLabel}
              >
                Set {n + 1}
              </ThemedText>
              <ThemedText type="small" style={styles.fill}>
                {describeSet(set, entry.weightUnit)}
              </ThemedText>
              {set.completed ? <Pill label="Done" tone="success" /> : null}
            </Row>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  setLabel: { width: 56 },
});
