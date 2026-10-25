import { MonthlyHealthReport } from '@/components/calendar/monthly-report';
import { WatchEntryDetail } from '@/components/calendar/health-detail';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Accent, Button, Notice } from '@/components/form';
import { CalendarEditor } from '@/components/calendar/editor';
import { ThemedText as Text } from '@/components/themed-text';
import { Card, ErrorState, Loading, Screen, errorMessage } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { calendarTimezone, changeMonth, clockLabel, dateAtNoon, monthDays } from '@/lib/calendar';
import { addDays, friendlyDate, localDate, weekStart } from '@/lib/dates';
import type { CalendarEntry } from '@/lib/types';

const mealColor = '#33B994';
const movementColor = '#629EFF';
const sleepColor = '#A68BFA';
const eventColor = (kind: string) => kind === 'meal' ? mealColor : kind === 'sleep' ? sleepColor : movementColor;
const sourceName = {
  manual: 'You logged',
  coach: 'Coach chat',
  session: 'Recorded workout',
  plan: 'Completed meal',
  watch: 'Apple Watch',
  demo: 'Demo',
};
const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function CalendarScreen() {
  const theme = useTheme();
  const api = useApi();
  const router = useRouter();
  const cache = useQueryClient();
  const width = useWindowDimensions().width;
  const wide = Platform.OS === 'web' && width >= 1150;
  const roomy = width >= 680;
  const today = localDate();
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today);
  const [view, setView] = useState<'month' | 'week'>(() => (width < 680 ? 'week' : 'month'));
  const [filter, setFilter] = useState<'all' | 'meal' | 'activity' | 'sleep'>('all');
  const [editor, setEditor] = useState<CalendarEntry | 'new' | null>(null);
  const timezone = calendarTimezone();
  const dates =
    view === 'month' ? monthDays(month) : Array.from({ length: 7 }, (_, i) => addDays(weekStart(selected), i));
  const start = dates[0];
  const query = useQuery({
    queryKey: ['calendar', start, dates.length, timezone],
    queryFn: () => api.calendar.list(start, dates.length, timezone),
    refetchInterval: 30_000,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ['calendar'] });
  const demo = useMutation({
    mutationFn: () => api.calendar.demo(today, timezone),
    onSuccess: () => {
      setSelected(today);
      setMonth(today);
      refresh();
    },
  });
  const clearDemo = useMutation({ mutationFn: api.calendar.clearDemo, onSuccess: refresh });
  const all = query.data ?? [];
  const entries = all.filter((e) => filter === 'all' || e.kind === filter);
  const dayEntries = entries.filter((e) => e.localDate === selected);
  const real = all.filter((e) => e.source !== 'demo');
  const dayReal = real.filter((e) => e.localDate === selected);
  const hasDemo = all.some((e) => e.source === 'demo');
  const heading = dateAtNoon(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const navigate = (step: number) => {
    if (view === 'week') {
      const day = addDays(selected, step * 7);
      setSelected(day);
      setMonth(day);
    } else {
      const day = changeMonth(month, step);
      setMonth(day);
      setSelected(day);
    }
  };
  const chooseDay = (day: string) => {
    setSelected(day);
    setMonth(day);
  };

  return (
    <Screen wide onRefresh={() => query.refetch()} refreshing={query.isRefetching}>
      <View style={[s.heading, !roomy && { flexDirection: 'column', alignItems: 'stretch' }]}>
        <View style={{ flex: roomy ? 1 : undefined, gap: 8 }}>
          <Text type="smallBold" style={{ color: Accent, letterSpacing: 2 }}>
            YOUR CALENDAR
          </Text>
          <Text style={[s.title, !roomy && { fontSize: 30, lineHeight: 37 }]}>Your days, in rhythm.</Text>
          <Text themeColor="textSecondary">Meals, movement, sleep. Your day, all together.</Text>
        </View>
        <Button title="＋ Log an entry" onPress={() => setEditor('new')} />
      </View>

      <View style={s.summary}>
        <Summary
          label="MEALS LOGGED"
          value={String(dayReal.filter((e) => e.kind === 'meal').length)}
          detail="on your selected day"
          color={mealColor}
        />
        <Summary
          label="MOVEMENT"
          value={`${dayReal.filter((e) => e.kind === 'activity').reduce((n, e) => n + (e.durationMinutes ?? 0), 0)}`}
          detail="minutes recorded"
          color={movementColor}
        />
        {roomy ? (
          <Summary
            label="CONNECTED TO YOU"
            value="Auto-saved"
            detail="from Coach, camera & Apple Watch"
            color="#B49AED"
          />
        ) : null}
      </View>

      <View style={[s.columns, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <Card style={[s.monthCard, { flex: wide ? 1.7 : undefined }]}>
          <View style={s.toolbar}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.monthTitle}>{heading}</Text>
              <Text type="small" themeColor="textSecondary">
                Make room for a good day.
              </Text>
            </View>
            <View style={[s.toggle, { backgroundColor: theme.background }]}>
              {(['month', 'week'] as const).map((v) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: view === v }}
                  onPress={() => setView(v)}
                  style={[s.toggleItem, view === v && { backgroundColor: theme.backgroundSelected }]}
                >
                  <Text type="smallBold">{v === 'month' ? 'Month' : 'Week'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={s.toolbar}>
            <View style={s.filters}>
              {(['all', 'meal', 'activity', 'sleep'] as const).map((f) => (
                <Pressable
                  key={f}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f }}
                  onPress={() => setFilter(f)}
                  style={[
                    s.filter,
                    {
                      borderColor: filter === f ? Accent : theme.border,
                      backgroundColor: filter === f ? `${Accent}18` : 'transparent',
                    },
                  ]}
                >
                  <View
                    style={[
                      s.dot,
                      { backgroundColor: f === 'all' ? Accent : eventColor(f) },
                    ]}
                  />
                  <Text type="small">{f === 'all' ? 'All' : f === 'meal' ? 'Meals' : f === 'sleep' ? 'Sleep' : 'Move'}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.arrows}>
              <Button
                title="‹"
                accessibilityLabel="Previous period"
                variant="secondary"
                size="small"
                onPress={() => navigate(-1)}
              />
              <Button title="Today" variant="quiet" size="small" onPress={() => chooseDay(today)} />
              <Button
                title="›"
                accessibilityLabel="Next period"
                variant="secondary"
                size="small"
                onPress={() => navigate(1)}
              />
            </View>
          </View>
          <View style={s.weekdays}>
            {weekdays.map((d, i) => (
              <Text key={i} type="smallBold" themeColor="textSecondary" style={s.weekday}>
                {d}
              </Text>
            ))}
          </View>
          <View style={s.grid}>
            {dates.map((day) => {
              const items = entries.filter((e) => e.localDate === day);
              const active = day === selected;
              const monthEnd = addDays(day, 1).slice(0, 7) !== day.slice(0, 7);
              const inMonth = day.slice(0, 7) === month.slice(0, 7);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={`${dateAtNoon(day).toLocaleDateString(undefined, { dateStyle: 'full' })}, ${
                    items.length
                  } entries`}
                  accessibilityState={{ selected: active }}
                  onPress={() => chooseDay(day)}
                  style={[
                    s.cell,
                    {
                      height: roomy ? (view === 'week' ? 156 : 90) : 64,
                      borderColor: theme.border,
                      backgroundColor: active ? `${Accent}16` : 'transparent',
                      opacity: inMonth || view === 'week' ? 1 : 0.4,
                    },
                    active && { borderColor: Accent },
                  ]}
                >
                  <View style={[s.dayNumber, day === today && { backgroundColor: Accent }]}>
                    <Text type="smallBold" style={day === today ? { color: '#fff' } : undefined}>
                      {Number(day.slice(-2))}
                    </Text>
                  </View>
                  {roomy ? (
                    items.slice(0, 2).map((e) => (
                      <View
                        key={e.id}
                        style={[s.miniEntry, { backgroundColor: `${eventColor(e.kind)}18` }]}
                      >
                        <View style={[s.miniDot, { backgroundColor: eventColor(e.kind) }]} />
                        <Text numberOfLines={1} style={s.miniText}>
                          {e.title}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <View style={s.dayDots}>
                      {items.slice(0, 4).map((e) => (
                        <View
                          key={e.id}
                          style={[s.miniDot, { backgroundColor: eventColor(e.kind) }]}
                        />
                      ))}
                    </View>
                  )}
                  {monthEnd ? <Text style={[s.miniText, { color: sleepColor }]}>{roomy ? '◈ Report' : '◈'}</Text> : null}
                  {roomy && items.length > 2 ? <Text style={s.more}>+{items.length - 2} more</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={s.legend}>
            <Text type="small" themeColor="textSecondary">
              {timezone.replaceAll('_', ' ')} · Tap a day to explore
            </Text>
            {hasDemo ? (
              <Text type="small" style={{ color: '#B49AED' }}>
                Includes demo entries
              </Text>
            ) : null}
          </View>
        </Card>

        <View style={[s.agenda, wide && { flex: 1 }]}>
          <Card style={{ gap: 22 }}>
            <View style={s.toolbar}>
              <View style={{ gap: 4 }}>
                <Text type="smallBold" themeColor="textSecondary">
                  YOUR DAY
                </Text>
                <Text style={s.monthTitle}>{friendlyDate(selected)}</Text>
              </View>
              <View style={[s.count, { backgroundColor: `${Accent}18` }]}>
                <Text style={{ color: Accent }}>{dayEntries.length}</Text>
              </View>
            </View>
            {query.isPending ? (
              <Loading label="Loading your calendar…" />
            ) : query.isError && !query.data ? (
              <ErrorState error={query.error} onRetry={() => query.refetch()} />
            ) : dayEntries.length ? (
              <View style={{ gap: 4 }}>
                {dayEntries.map((entry, i) => (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.timeEstimated && entry.source === 'coach' ? 'Time not specified' : (entry.localTime ? clockLabel(entry.localTime) : 'Night ending today')}, ${entry.title}${
                      entry.source === 'demo' ? ', demo' : ''
                    }`}
                    onPress={() =>
                      entry.editable
                        ? setEditor(entry)
                        : entry.sessionId
                        ? router.push(`/activity/session/${entry.sessionId}`)
                        : undefined
                    }
                    style={s.event}
                  >
                    <View style={s.rail}>
                      <View
                        style={[s.eventDot, { backgroundColor: eventColor(entry.kind) }]}
                      />
                      {i < dayEntries.length - 1 ? <View style={[s.line, { backgroundColor: theme.border }]} /> : null}
                    </View>
                    <View style={{ flex: 1, gap: 5, paddingBottom: 18 }}>
                      <View style={s.eventMeta}>
                        <Text type="smallBold" themeColor="textSecondary">
                          {entry.timeEstimated && entry.source === 'coach' ? 'Time not specified' : (entry.localTime ? clockLabel(entry.localTime) : 'Night ending today')}
                          {entry.timeEstimated && entry.source !== 'coach' && entry.kind !== 'sleep' ? ' · logged' : ''}
                        </Text>
                        {entry.source === 'demo' ? <Text style={s.demoBadge}>DEMO</Text> : null}
                      </View>
                      <Text style={{ fontSize: 17, fontWeight: '600', lineHeight: 24 }}>{entry.title}</Text>
                      <Text type="small" themeColor="textSecondary">
                        {entry.kind === 'meal' ? 'Meal' : entry.kind === 'sleep' ? 'Sleep' : 'Movement'}
                        {entry.durationMinutes ? ` · ${entry.durationMinutes} min` : ''} · {sourceName[entry.source]}
                      </Text>
                      {entry.source === 'watch' ? <WatchEntryDetail entry={entry} /> : null}
                      {entry.notes && entry.source !== 'demo' ? (
                        <Text type="small" themeColor="textSecondary" numberOfLines={2}>
                          {entry.notes}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={{ gap: 12, paddingVertical: 20 }}>
                <SymbolView
                  name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
                  size={34}
                  tintColor={Accent}
                />
                <Text style={{ fontSize: 20, fontWeight: '600' }}>A little space for your day.</Text>
                <Text themeColor="textSecondary">
                  {filter === 'all'
                    ? 'Tell Coach what you ate or record a workout. It will find its place here.'
                    : 'No entries in this category. Try All or log something new.'}
                </Text>
                <Button title="Log something" variant="secondary" onPress={() => setEditor('new')} />
              </View>
            )}
            {query.isError && query.data ? (
              <Notice tone="warning">Couldn’t refresh. Showing your last saved calendar.</Notice>
            ) : null}
          </Card>
          <View style={[s.connectCard, { backgroundColor: `${Accent}10`, borderColor: `${Accent}40` }]}>
            <Text type="smallBold" style={{ color: Accent }}>
              LESS TRACKING. MORE LIVING.
            </Text>
            <Text themeColor="textSecondary">
              Tell Coach “I had lunch at 12:30.” Completed meals and workouts go straight into your calendar.
            </Text>
            <View style={s.actions}>
              <Button title="Talk to Coach" size="small" onPress={() => router.push('/coach')} />
              {Platform.OS === 'web' ? (
                <Button
                  title="Open camera"
                  size="small"
                  variant="secondary"
                  onPress={() => router.push('/activity/camera')}
                />
              ) : null}
            </View>
          </View>
        </View>
      </View>
      <MonthlyHealthReport month={month} selected={selected} />
      <View style={s.bottom}>
        <View style={{ gap: 4 }}>
          <Text type="smallBold">Your kitchen & your training</Text>
          <Text type="small" themeColor="textSecondary">
            Recipes and routines, ready when you are.
          </Text>
        </View>
        <View style={s.actions}>
          <Button title="Recipe library ↗" variant="secondary" onPress={() => router.push('/meals')} />
          <Button title="Workout library ↗" variant="secondary" onPress={() => router.push('/activity')} />
        </View>
      </View>
      <View style={[s.bottom, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 18 }]}>
        <Text type="small" themeColor="textSecondary">
          {hasDemo
            ? 'Demo entries are samples and are excluded from your daily totals.'
            : 'Trying it out? Add a sample week to this account.'}
        </Text>
        <Button
          title={hasDemo ? 'Remove demo entries' : 'Load demo week'}
          size="small"
          variant="quiet"
          loading={demo.isPending || clearDemo.isPending}
          onPress={() => (hasDemo ? clearDemo.mutate() : demo.mutate())}
        />
      </View>
      {demo.isError || clearDemo.isError ? (
        <Notice tone="error">{errorMessage(demo.error || clearDemo.error)}</Notice>
      ) : null}
      {editor ? (
        <CalendarEditor entry={editor === 'new' ? undefined : editor} day={selected} onClose={() => setEditor(null)} />
      ) : null}
    </Screen>
  );
}

function Summary({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={[s.summaryCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={s.actions}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <Text style={s.eyebrow} themeColor="textSecondary">
          {label}
        </Text>
      </View>
      <Text style={{ fontSize: 27, fontWeight: '600', lineHeight: 35 }}>{value}</Text>
      <Text type="small" themeColor="textSecondary">
        {detail}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 20, paddingVertical: 12 },
  title: { fontSize: 40, lineHeight: 48, fontWeight: '600', letterSpacing: -1.4 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryCard: { flex: 1, minWidth: 150, padding: 20, borderWidth: 1, borderRadius: 18, gap: 7 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  columns: { gap: 20 },
  monthCard: { padding: 18, gap: 20, minWidth: 0 },
  agenda: { gap: 16, minWidth: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  monthTitle: { fontSize: 23, fontWeight: '600', lineHeight: 30, letterSpacing: -0.4 },
  toggle: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  toggleItem: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  filters: { flexWrap: 'wrap', flexDirection: 'row', gap: 6 },
  filter: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  arrows: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  weekdays: { flexDirection: 'row' },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: -9 },
  cell: { width: '14.2857%', borderWidth: 0.5, borderRadius: 8, padding: 4, gap: 3, overflow: 'hidden' },
  dayNumber: {
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  miniEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  miniDot: { width: 4, height: 4, borderRadius: 2 },
  miniText: { fontSize: 9, lineHeight: 12, flex: 1 },
  more: { fontSize: 9, lineHeight: 10, opacity: 0.65, paddingLeft: 3 },
  dayDots: { flexDirection: 'row', justifyContent: 'center', gap: 3, paddingTop: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  count: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  event: { flexDirection: 'row', gap: 14 },
  eventMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rail: { width: 12, alignItems: 'center', paddingTop: 5 },
  eventDot: { width: 9, height: 9, borderRadius: 5 },
  line: { flex: 1, width: 1, marginTop: 5, marginBottom: -1 },
  demoBadge: { fontSize: 9, lineHeight: 15, color: '#B49AED', fontWeight: '700', letterSpacing: 0.7 },
  connectCard: { padding: 20, gap: 14, borderWidth: 1, borderRadius: 18 },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  bottom: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
});
