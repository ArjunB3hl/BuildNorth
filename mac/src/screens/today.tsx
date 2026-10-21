import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Notice,
  Pill,
  Rating,
  Row,
  Screen,
  SectionHeader,
  Stepper,
  TextField,
  ThemedText,
} from '../components/ui';
import { useStore } from '../data/store';
import type { CheckIn, PlanItem, TimeSlot } from '../data/types';
import {
  addDays,
  greeting,
  localDate,
  weekdayShort,
  weekStart,
} from '../lib/dates';
import { useNav } from '../navigation';
import { Accent, Spacing } from '../theme';

const SLOT_LABEL = {
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
} as const;
const MEAL_LABEL = {
  morning: 'Breakfast',
  midday: 'Lunch',
  evening: 'Dinner',
} as const;

export function TodayScreen() {
  const { state } = useStore();
  const nav = useNav();
  const today = localDate();
  const [view, setView] = useState<'today' | 'week'>('today');
  const [adding, setAdding] = useState(false);

  const name = state.profile.preferredName;
  const planned = state.plan.filter(i => i.date === today);
  const remaining = planned.filter(i => i.status === 'planned').length;
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Screen
      title={`${greeting()}${name ? `, ${name}` : ''}`}
      subtitle={`${dateLabel} · ${
        planned.length
          ? `${remaining} of ${planned.length} planned items left today.`
          : 'Nothing planned yet today.'
      }`}
    >
      <ChipGroup
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Week' },
        ]}
        multiple={false}
        selected={[view]}
        onChange={v => v[0] && setView(v[0])}
      />

      {view === 'week' ? <WeekPlan today={today} /> : null}

      {view === 'today' ? (
        <>
          <CheckInCard
            key={today}
            day={today}
            existing={state.checkIns.find(c => c.date === today) ?? null}
          />

          <SectionHeader
            title="Planned for today"
            action={
              <Button
                title={adding ? 'Cancel' : 'Add'}
                size="small"
                variant="quiet"
                onPress={() => setAdding(a => !a)}
                accessibilityLabel={
                  adding ? 'Cancel adding' : "Add to today's plan"
                }
              />
            }
          />
          {adding ? (
            <AddPlanItemCard date={today} onDone={() => setAdding(false)} />
          ) : null}
          {planned.length === 0 && !adding ? (
            <EmptyState
              title="Nothing planned for today"
              body="Add a meal or an activity, or ask the coach for ideas."
              action={
                <Button
                  title="Plan something"
                  size="small"
                  onPress={() => setAdding(true)}
                />
              }
            />
          ) : null}
          {planned.map(item => (
            <PlanItemCard key={item.id} item={item} day={today} />
          ))}

          <SectionHeader title="Quick actions" />
          <View style={styles.quickGrid}>
            <QuickAction
              title="Ask the coach"
              onPress={() => nav.go('coach')}
            />
            <QuickAction
              title="Browse recipes"
              onPress={() => nav.go('meals')}
            />
            <QuickAction
              title="Start a routine"
              onPress={() => nav.go('activity')}
            />
            <QuickAction
              title="Shopping list"
              onPress={() => nav.go('meals', { name: 'shopping' })}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function QuickAction({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.quickItem}>
      <Button title={title} variant="secondary" onPress={onPress} />
    </View>
  );
}

function PlanItemCard({ item, day }: { item: PlanItem; day: string }) {
  const { dispatch } = useStore();
  const nav = useNav();
  const update = (patch: Partial<Pick<PlanItem, 'status' | 'date'>>) =>
    dispatch({ type: 'plan/update', id: item.id, patch });

  function reschedule() {
    Alert.alert('Move to another day', item.title, [
      { text: 'Tomorrow', onPress: () => update({ date: addDays(day, 1) }) },
      { text: 'In 2 days', onPress: () => update({ date: addDays(day, 2) }) },
      { text: 'Next week', onPress: () => update({ date: addDays(day, 7) }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const open = () => {
    if (item.recipeId) {
      nav.go('meals', { name: 'recipe', id: item.recipeId });
    } else if (item.routineId) {
      nav.go('activity', { name: 'routine', id: item.routineId });
    }
  };

  return (
    <Card>
      <ThemedText
        type="smallBold"
        style={item.status !== 'planned' && styles.doneText}
      >
        {item.title}
      </ThemedText>
      <PlanPills item={item} />
      {item.note ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {item.note}
        </ThemedText>
      ) : null}
      {item.status === 'planned' ? (
        <Row style={styles.wrap}>
          {item.recipeId || item.routineId ? (
            <Button
              title={item.kind === 'meal' ? 'Open recipe' : 'Open routine'}
              size="small"
              onPress={open}
            />
          ) : null}
          <Button
            title="Done"
            size="small"
            variant="secondary"
            onPress={() => update({ status: 'done' })}
            accessibilityLabel={`Mark ${item.title} done`}
          />
          <Button
            title="Skip"
            size="small"
            variant="secondary"
            onPress={() => update({ status: 'skipped' })}
            accessibilityLabel={`Skip ${item.title}`}
          />
          <Button
            title="Move"
            size="small"
            variant="quiet"
            onPress={reschedule}
            accessibilityLabel={`Move ${item.title} to another day`}
          />
        </Row>
      ) : (
        <View style={styles.start}>
          <Button
            title="Undo"
            size="small"
            variant="quiet"
            onPress={() => update({ status: 'planned' })}
            accessibilityLabel={`Undo ${item.status} for ${item.title}`}
          />
        </View>
      )}
    </Card>
  );
}

function PlanPills({
  item,
  meals = false,
}: {
  item: PlanItem;
  /** Week view names meal slots Breakfast/Lunch/Dinner, like the iPhone app. */
  meals?: boolean;
}) {
  const slot = item.timeSlot
    ? (meals && item.kind === 'meal' ? MEAL_LABEL : SLOT_LABEL)[item.timeSlot]
    : null;
  return (
    <Row style={styles.wrap}>
      <Pill label={item.kind === 'meal' ? 'Meal' : 'Activity'} tone="accent" />
      {slot ? <Pill label={slot} tone="muted" /> : null}
      {item.minutes ? (
        <Pill label={`${item.minutes} min`} tone="muted" />
      ) : null}
      {item.status === 'done' ? <Pill label="Done" tone="success" /> : null}
      {item.status === 'skipped' ? <Pill label="Skipped" tone="muted" /> : null}
    </Row>
  );
}

function CheckInCard({
  day,
  existing,
}: {
  day: string;
  existing: CheckIn | null;
}) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(!existing);
  const [energy, setEnergy] = useState<number | null>(existing?.energy ?? null);
  const [mood, setMood] = useState<number | null>(existing?.mood ?? null);
  const [trackSleep, setTrackSleep] = useState(existing?.sleepHours != null);
  const [sleep, setSleep] = useState(existing?.sleepHours ?? 7);
  const [note, setNote] = useState(existing?.note ?? '');

  function save() {
    if (!energy || !mood) {
      return;
    }
    dispatch({
      type: 'checkin/save',
      checkIn: {
        date: day,
        energy,
        mood,
        sleepHours: trackSleep ? sleep : null,
        note: note.trim() || null,
      },
    });
    setEditing(false);
  }

  if (existing && !editing) {
    return (
      <Card>
        <Row>
          <ThemedText type="smallBold" style={styles.fill}>
            Today’s check-in
          </ThemedText>
          <Button
            title="Edit"
            size="small"
            variant="quiet"
            onPress={() => setEditing(true)}
            accessibilityLabel="Edit today's check-in"
          />
        </Row>
        <ThemedText type="small" themeColor="textSecondary">
          Energy {existing.energy}/5 · Mood {existing.mood}/5
          {existing.sleepHours != null
            ? ` · Sleep ${existing.sleepHours} h`
            : ''}
        </ThemedText>
        {existing.note ? (
          <ThemedText type="small">{existing.note}</ThemedText>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">How are you today?</ThemedText>
      <View style={styles.ratings}>
        <View style={styles.fill}>
          <Rating
            label="Energy"
            value={energy}
            onChange={setEnergy}
            lowLabel="Drained"
            highLabel="Energised"
          />
        </View>
        <View style={styles.fill}>
          <Rating
            label="Mood"
            value={mood}
            onChange={setMood}
            lowLabel="Low"
            highLabel="Great"
          />
        </View>
      </View>
      {trackSleep ? (
        <Stepper
          label="Sleep last night"
          value={sleep}
          onChange={setSleep}
          min={0}
          max={14}
          step={0.5}
          suffix="h"
        />
      ) : null}
      <View style={styles.start}>
        <Button
          title={trackSleep ? 'Don’t record sleep' : 'Add sleep (optional)'}
          size="small"
          variant="quiet"
          onPress={() => setTrackSleep(v => !v)}
        />
      </View>
      <TextField
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Anything worth remembering?"
        maxLength={1000}
      />
      <Row>
        <Button
          title="Save check-in"
          onPress={save}
          disabled={!energy || !mood}
        />
        {existing ? (
          <Button
            title="Cancel"
            variant="quiet"
            onPress={() => setEditing(false)}
          />
        ) : null}
      </Row>
    </Card>
  );
}

/** Inline version of the iPhone app's "Add to plan" sheet. */
function AddPlanItemCard({
  date,
  onDone,
}: {
  date: string;
  onDone: () => void;
}) {
  const { state, dispatch } = useStore();
  const [kind, setKind] = useState<'meal' | 'activity'>('meal');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [slot, setSlot] = useState<TimeSlot>('evening');
  const [minutes, setMinutes] = useState(30);

  const saved =
    kind === 'meal'
      ? state.recipes.map(r => ({ value: r.id, label: r.title }))
      : state.routines.map(r => ({ value: r.id, label: r.name }));
  const savedTitle = saved.find(s => s.value === savedId)?.label;
  const finalTitle = savedTitle ?? title.trim();

  function add() {
    dispatch({
      type: 'plan/add',
      item: {
        date,
        kind,
        title: finalTitle,
        timeSlot: slot,
        recipeId: kind === 'meal' ? savedId : null,
        routineId: kind === 'activity' ? savedId : null,
        minutes: kind === 'activity' ? minutes : null,
        note: null,
      },
    });
    onDone();
  }

  return (
    <Card>
      <ThemedText type="smallBold">Add to {weekdayShort(date)}</ThemedText>
      <ChipGroup
        options={[
          { value: 'meal', label: 'Meal' },
          { value: 'activity', label: 'Activity' },
        ]}
        multiple={false}
        selected={[kind]}
        onChange={v => {
          if (v[0]) {
            setKind(v[0]);
            setSavedId(null);
          }
        }}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {kind === 'meal' ? 'From your recipes' : 'From your routines'}
      </ThemedText>
      <ChipGroup
        options={saved}
        multiple={false}
        selected={savedId ? [savedId] : []}
        onChange={v => setSavedId(v[0] === savedId ? null : v[0] ?? null)}
      />
      {!savedId ? (
        <TextField
          label="Or describe it"
          value={title}
          onChangeText={setTitle}
          placeholder={
            kind === 'meal' ? 'e.g. Leftover curry' : 'e.g. 30-minute walk'
          }
          maxLength={200}
        />
      ) : null}
      <ChipGroup
        options={[
          {
            value: 'morning',
            label: kind === 'meal' ? 'Breakfast' : 'Morning',
          },
          { value: 'midday', label: kind === 'meal' ? 'Lunch' : 'Midday' },
          { value: 'evening', label: kind === 'meal' ? 'Dinner' : 'Evening' },
        ]}
        multiple={false}
        selected={[slot]}
        onChange={v => v[0] && setSlot(v[0])}
      />
      {kind === 'activity' ? (
        <Stepper
          label="Minutes"
          value={minutes}
          onChange={setMinutes}
          min={5}
          max={180}
          step={5}
          suffix="min"
        />
      ) : null}
      <View style={styles.start}>
        <Button title="Add to plan" onPress={add} disabled={!finalTitle} />
      </View>
    </Card>
  );
}

/** Seven days of the plan: add, move, mark done or skipped. */
function WeekPlan({ today }: { today: string }) {
  const { state } = useStore();
  const [start, setStart] = useState(() => weekStart(today));
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const isThisWeek = start === weekStart(today);

  return (
    <View style={styles.week}>
      <Row>
        <Button
          title="‹"
          size="small"
          variant="secondary"
          onPress={() => setStart(addDays(start, -7))}
          accessibilityLabel="Previous week"
        />
        <ThemedText
          type="smallBold"
          style={styles.weekLabel}
          accessibilityRole="header"
        >
          {weekdayShort(start)} – {weekdayShort(addDays(start, 6))}
        </ThemedText>
        <Button
          title="›"
          size="small"
          variant="secondary"
          onPress={() => setStart(addDays(start, 7))}
          accessibilityLabel="Next week"
        />
      </Row>
      {!isThisWeek ? (
        <View style={styles.center}>
          <Button
            title="Back to this week"
            size="small"
            variant="quiet"
            onPress={() => setStart(weekStart(today))}
          />
        </View>
      ) : null}
      {days.map(day => (
        <Card key={day} style={day === today && styles.todayCard}>
          <Row>
            <ThemedText type="smallBold" style={styles.fill}>
              {weekdayShort(day)}
              {day === today ? ' · Today' : ''}
            </ThemedText>
            <Button
              title={addingTo === day ? 'Cancel' : 'Add'}
              size="small"
              variant="quiet"
              onPress={() => setAddingTo(addingTo === day ? null : day)}
              accessibilityLabel={`Add to ${weekdayShort(day)}`}
            />
          </Row>
          {addingTo === day ? (
            <AddPlanItemCard date={day} onDone={() => setAddingTo(null)} />
          ) : null}
          {state.plan.filter(i => i.date === day).length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing planned.
            </ThemedText>
          ) : (
            state.plan
              .filter(i => i.date === day)
              .map(item => (
                <WeekItem key={item.id} item={item} weekDays={days} />
              ))
          )}
        </Card>
      ))}
      <Notice tone="info">
        “Help plan my week” and plan changes in your own words need the
        BuildNorth backend, so they aren’t in the Mac app yet.
      </Notice>
    </View>
  );
}

function WeekItem({ item, weekDays }: { item: PlanItem; weekDays: string[] }) {
  const { dispatch } = useStore();
  const update = (patch: Partial<Pick<PlanItem, 'status' | 'date'>>) =>
    dispatch({ type: 'plan/update', id: item.id, patch });

  function move() {
    Alert.alert('Move to another day', item.title, [
      ...weekDays
        .filter(d => d !== item.date)
        .map(d => ({
          text: weekdayShort(d),
          onPress: () => update({ date: d }),
        })),
      {
        text: 'Same day next week',
        onPress: () => update({ date: addDays(item.date, 7) }),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function remove() {
    Alert.alert('Remove from plan?', item.title, [
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => dispatch({ type: 'plan/remove', id: item.id }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const planned = item.status === 'planned';
  return (
    <View style={styles.weekItem}>
      <ThemedText type="small" style={!planned && styles.struck}>
        {item.title}
      </ThemedText>
      <PlanPills item={item} meals />
      {item.note ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {item.note}
        </ThemedText>
      ) : null}
      {planned ? (
        <Row style={styles.wrap}>
          <Button
            title="Done"
            size="small"
            variant="secondary"
            onPress={() => update({ status: 'done' })}
            accessibilityLabel={`Mark ${item.title} done`}
          />
          <Button
            title="Skip"
            size="small"
            variant="secondary"
            onPress={() => update({ status: 'skipped' })}
            accessibilityLabel={`Skip ${item.title}`}
          />
          <Button
            title="Move"
            size="small"
            variant="quiet"
            onPress={move}
            accessibilityLabel={`Move ${item.title}`}
          />
          <Button
            title="Remove"
            size="small"
            variant="quiet"
            onPress={remove}
            accessibilityLabel={`Remove ${item.title}`}
          />
        </Row>
      ) : (
        <View style={styles.start}>
          <Button
            title="Undo"
            size="small"
            variant="quiet"
            onPress={() => update({ status: 'planned' })}
            accessibilityLabel={`Undo ${item.status} for ${item.title}`}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  start: { alignItems: 'flex-start' },
  center: { alignItems: 'center' },
  doneText: { opacity: 0.6 },
  struck: { opacity: 0.6, textDecorationLine: 'line-through' },
  ratings: { flexDirection: 'row', gap: Spacing.four },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  quickItem: { flexBasis: '48%', flexGrow: 1 },
  week: { gap: Spacing.three },
  weekLabel: { flex: 1, textAlign: 'center' },
  todayCard: { borderWidth: 1, borderColor: Accent },
  weekItem: { gap: Spacing.one, paddingVertical: Spacing.one },
});
