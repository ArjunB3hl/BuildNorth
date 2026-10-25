import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Notice,
  Screen,
  TextField,
  ThemedText as Text,
} from '../components/ui';
import type { DemoCalendarEntry } from '../data/calendar';
import { useStore } from '../data/store';
import { addDays, friendlyDate, localDate, weekStart } from '../lib/dates';
import { useNav } from '../navigation';
import { Accent, useTheme } from '../theme';

const food = '#33B994';
const movement = '#629EFF';
export function CalendarScreen() {
  const { state, dispatch } = useStore();
  const theme = useTheme();
  const nav = useNav();
  const [selected, setSelected] = useState(localDate());
  const [month, setMonth] = useState(localDate());
  const [filter, setFilter] = useState<'all' | 'meal' | 'activity'>('all');
  const [edit, setEdit] = useState<DemoCalendarEntry | null>(null);
  const [error, setError] = useState('');
  const start = weekStart(`${month.slice(0, 7)}-01`);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const entries = state.calendarEntries.filter(
    e => filter === 'all' || e.kind === filter,
  );
  const selectedEntries = entries
    .filter(e => e.date === selected)
    .sort((a, b) => a.time.localeCompare(b.time));
  const move = (by: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = localDate(new Date(y, m - 1 + by, 1));
    setMonth(d);
    setSelected(d);
  };
  const save = () => {
    if (!edit) {
      return;
    }
    const d = new Date(`${edit.date}T${edit.time}:00`);
    if (
      !edit.title.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(edit.date) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(edit.time) ||
      !Number.isFinite(d.getTime()) ||
      localDate(d) !== edit.date
    ) {
      setError(
        'Add a title, a valid YYYY-MM-DD date, and a time in HH:mm format.',
      );
      return;
    }
    dispatch({
      type: 'calendar/save',
      entry: { ...edit, title: edit.title.trim() },
    });
    setSelected(edit.date);
    setMonth(edit.date);
    setEdit(null);
    setError('');
  };
  const newEntry = () => {
    setError('');
    setEdit({
      id: randomUUID(),
      kind: 'meal',
      title: '',
      date: selected,
      time: '12:30',
      minutes: null,
    });
  };

  return (
    <Screen
      title="Your days, in rhythm."
      subtitle="Everything you eat. Every way you move. One calendar."
      actions={<Button title="＋ Log an entry" onPress={newEntry} />}
    >
      <Notice tone="info">
        Demo on this Mac · Entries stay on this device. Your website and phone
        calendar use your signed-in account.
      </Notice>
      <Card style={s.cardGap}>
        <View style={s.row}>
          <Text type="subtitle" style={s.flex}>
            {new Date(`${month}T12:00:00`).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
          <Button
            title="‹"
            accessibilityLabel="Previous month"
            size="small"
            variant="secondary"
            onPress={() => move(-1)}
          />
          <Button
            title="Today"
            size="small"
            variant="quiet"
            onPress={() => {
              setSelected(localDate());
              setMonth(localDate());
            }}
          />
          <Button
            title="›"
            accessibilityLabel="Next month"
            size="small"
            variant="secondary"
            onPress={() => move(1)}
          />
        </View>
        <View style={s.row}>
          {(['all', 'meal', 'activity'] as const).map(f => (
            <Button
              key={f}
              title={f === 'all' ? 'All' : f === 'meal' ? 'Meals' : 'Movement'}
              size="small"
              variant={filter === f ? 'primary' : 'secondary'}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>
        <View style={s.grid}>
          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => (
            <Text
              key={d}
              type="smallBold"
              themeColor="textSecondary"
              style={s.weekday}
            >
              {d}
            </Text>
          ))}
        </View>
        <View style={s.grid}>
          {days.map(day => {
            const items = entries.filter(e => e.date === day);
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={`${day}, ${items.length} entries`}
                accessibilityState={{ selected: selected === day }}
                onPress={() => setSelected(day)}
                style={[
                  s.cell,
                  {
                    backgroundColor:
                      selected === day ? `${Accent}20` : theme.background,
                    borderColor:
                      selected === day ? Accent : theme.backgroundSelected,
                  },
                  day.slice(0, 7) !== month.slice(0, 7) && s.faded,
                ]}
              >
                <Text
                  type="smallBold"
                  style={day === localDate() ? { color: Accent } : undefined}
                >
                  {Number(day.slice(-2))}
                </Text>
                {items.slice(0, 2).map(e => (
                  <Text
                    key={e.id}
                    numberOfLines={1}
                    style={[
                      s.mini,
                      { color: e.kind === 'meal' ? food : movement },
                    ]}
                  >
                    {e.kind === 'meal' ? '●' : '◆'} {e.title}
                  </Text>
                ))}
                {items.length > 2 ? (
                  <Text style={s.more} themeColor="textSecondary">
                    +{items.length - 2} more
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <Text type="small" themeColor="textSecondary">
          ● Meals ◆ Movement · All entries are local demo data
        </Text>
      </Card>
      <Card>
        <View style={s.row}>
          <Text type="subtitle" style={s.flex}>
            {friendlyDate(selected)}
          </Text>
          <Text themeColor="textSecondary">
            {selectedEntries.length} moments
          </Text>
        </View>
        {selectedEntries.length ? (
          selectedEntries.map(e => (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${e.title}`}
              onPress={() => {
                setEdit(e);
                setError('');
              }}
              style={[s.event, { borderColor: theme.backgroundSelected }]}
            >
              <Text
                style={[s.time, { color: e.kind === 'meal' ? food : movement }]}
              >
                {e.time}
              </Text>
              <View style={s.eventBody}>
                <Text style={s.eventTitle}>{e.title}</Text>
                <Text type="small" themeColor="textSecondary">
                  {e.kind === 'meal' ? 'Meal' : 'Movement'}
                  {e.minutes ? ` · ${e.minutes} min` : ''} · Demo
                </Text>
              </View>
              <Text themeColor="textSecondary">Edit ↗</Text>
            </Pressable>
          ))
        ) : (
          <Text themeColor="textSecondary">
            A little space for your day. Add a meal or a workout.
          </Text>
        )}
      </Card>
      {edit ? (
        <Card>
          <Text type="subtitle">Edit a moment</Text>
          <View style={s.row}>
            <Button
              title="Meal"
              variant={edit.kind === 'meal' ? 'primary' : 'secondary'}
              onPress={() => setEdit({ ...edit, kind: 'meal' })}
            />
            <Button
              title="Movement"
              variant={edit.kind === 'activity' ? 'primary' : 'secondary'}
              onPress={() => setEdit({ ...edit, kind: 'activity' })}
            />
          </View>
          <TextField
            label="Title"
            value={edit.title}
            onChangeText={title => setEdit({ ...edit, title })}
            maxLength={120}
          />
          <View style={s.row}>
            <View style={s.flex}>
              <TextField
                label="Date · YYYY-MM-DD"
                value={edit.date}
                onChangeText={date => setEdit({ ...edit, date })}
              />
            </View>
            <View style={s.flex}>
              <TextField
                label="Time · HH:mm"
                value={edit.time}
                onChangeText={time => setEdit({ ...edit, time })}
              />
            </View>
          </View>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <View style={s.row}>
            <Button title="Save on this Mac" onPress={save} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setEdit(null)}
            />
            <Button
              title="Delete entry"
              variant="quiet"
              onPress={() => {
                dispatch({ type: 'calendar/remove', id: edit.id });
                setEdit(null);
              }}
            />
          </View>
        </Card>
      ) : null}
      <View style={s.row}>
        <Button
          title="Recipe library ↗"
          variant="secondary"
          onPress={() => nav.go('meals')}
        />
        <Button
          title="Workout library ↗"
          variant="secondary"
          onPress={() => nav.go('activity')}
        />
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  faded: { opacity: 0.4 },
  flex: { flex: 1 },
  cardGap: { gap: 20 },
  time: { width: 56 },
  eventBody: { flex: 1, gap: 3 },
  eventTitle: { fontSize: 17, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 10 },
  cell: {
    width: '14.2857%',
    height: 92,
    padding: 6,
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
  },
  mini: { fontSize: 10, lineHeight: 13 },
  more: { fontSize: 9, lineHeight: 12 },
  event: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    paddingVertical: 17,
    borderBottomWidth: 1,
  },
});
