import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Notice } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { Card, ErrorState, Loading } from '@/components/ui';
import { HealthReadings, minutesLabel, SleepDetail } from './health-detail';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { calendarTimezone } from '@/lib/calendar';
import { localDate } from '@/lib/dates';
import type { ReportMetric } from '@/lib/types';

export function MonthlyHealthReport({ month, selected }: { month: string; selected: string }) {
  const api = useApi(), theme = useTheme();
  const [expanded, setExpanded] = useState(false), [message, setMessage] = useState('');
  const timezone = calendarTimezone(), key = month.slice(0, 7);
  const query = useQuery({ queryKey: ['monthly-report', key, timezone], queryFn: () => api.calendar.report(key, timezone),
    enabled: key <= localDate().slice(0, 7), refetchInterval: 30_000 });
  if (key > localDate().slice(0, 7)) return null;
  const r = query.data, day = r?.healthDays.find(h => h.date === selected);
  const avg = (m: ReportMetric, unit: string) => m.average == null ? 'Not recorded' : `${m.average} ${unit} · ${m.samples} ${m.samples === 1 ? 'day' : 'days'}`;
  return <Card style={{ gap: 18, borderColor: '#8C78D366' }}>
    <View style={{ gap: 6 }}>
      <Text type="smallBold" style={{ color: '#A68BFA', letterSpacing: 1 }}>YOUR MONTH IN RHYTHM</Text>
      <Text type="subtitle">Monthly health report</Text>
      <Text type="small" themeColor="textSecondary">{r?.status === 'monthEnded' ? `Month ended · ${r.reportDate}` : `In progress · month ends ${r?.reportDate ?? 'soon'}`}. Updates automatically as your data syncs.</Text>
    </View>
    {query.isPending ? <Loading /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
    {r ? <>
      {r.demoSummary && r.demoSummary.entries > 0 ? <View style={{ gap: 14, padding: 20, borderRadius: 16, backgroundColor: '#8C78D31A', borderWidth: 1, borderColor: '#8C78D366' }}>
        <Text type="smallBold" style={{ color: '#A68BFA', letterSpacing: 1 }}>DEMO MONTH SUMMARY</Text>
        <Text type="subtitle">{new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} in rhythm</Text>
        <Text type="small">{r.demoSummary.recordedDays} of {r.daysInPeriod} days filled · {r.demoSummary.entries} sample entries</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {[[r.demoSummary.meals, 'MEALS'], [r.demoSummary.workouts, 'WORKOUTS & WALKS'], [r.demoSummary.minutes, 'MOVEMENT MINUTES']].map(([value, label]) =>
            <View key={label} style={{ flex: 1, minWidth: 130, borderRadius: 12, backgroundColor: theme.background, padding: 14, gap: 8 }}>
              <Text type="subtitle">{value}</Text><Text type="small" themeColor="textSecondary">{label}</Text>
            </View>)}
        </View>
        <Text type="small" themeColor="textSecondary">Sample meals and movement for the demo. These entries are excluded from your real health totals.</Text>
      </View> : null}
      {r.demoSummary && r.demoSummary.entries > 0 ? <Text type="smallBold">Your recorded health data</Text> : null}
      <Text type="small">{r.recordedDays} of {r.daysInPeriod} days have records · {r.meals} meals · {r.watchWorkouts} Watch workouts · {r.recordedSets} app sets</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[['AVERAGE SLEEP', minutesLabel(r.sleep.average)], ['WATCH MOVEMENT', r.watchDays ? `${r.watchMinutes} min` : 'Not recorded'], ['CHECK-INS', `${r.checkIns}`]].map(([label, value]) =>
          <View key={label} style={{ flex: 1, minWidth: 130, borderRadius: 12, backgroundColor: theme.background, padding: 14, gap: 8 }}>
            <Text type="small" themeColor="textSecondary">{label}</Text><Text type="smallBold">{value}</Text>
          </View>)}
      </View>
      {r.healthDays.some(h => h.sleepMinutes != null) ? <View style={{ gap: 8 }}>
        <Text type="smallBold">Sleep across the month</Text>
        <View accessibilityLabel="Sleep duration by night; gaps mean no upload" style={{ flexDirection: 'row', alignItems: 'flex-end', height: 72, gap: 3 }}>
          {Array.from({ length: r.daysInPeriod }, (_, i) => {
            const date = `${key}-${String(i + 1).padStart(2, '0')}`, h = r.healthDays.find(v => v.date === date);
            return <View key={date} accessibilityLabel={`${date}: ${minutesLabel(h?.sleepMinutes)}`} style={{ flex: 1, borderRadius: 3,
              height: h?.sleepMinutes == null ? 3 : Math.max(4, Math.min(72, h.sleepMinutes / 12)), backgroundColor: h?.sleepMinutes == null ? theme.border : h.complete ? '#A68BFA' : '#64748B' }} />;
          })}
        </View>
        <Text type="small" themeColor="textSecondary">1 → {r.daysInPeriod} · purple: completed day · gray: partial or missing. Average uses {r.sleep.samples} complete nights.</Text>
      </View> : <Text type="small" themeColor="textSecondary">No sleep readings yet. Link your Watch from Profile and sync Health data.</Text>}
      {day ? <View style={{ gap: 6 }}><Text type="smallBold">Watch readings · {selected}</Text><HealthReadings day={day} /><Text type="small">Sleep: {minutesLabel(day.sleepMinutes)}</Text><SleepDetail pattern={day.sleepPattern} /></View> : null}
      <Button title={expanded ? 'Hide full report' : 'Read full report'} variant="secondary" size="small" onPress={() => setExpanded(!expanded)} />
      {expanded ? <View style={{ gap: 12 }}>
        <Text>Meals & movement</Text>
        <Text type="small">{r.meals} meals logged · {r.appWorkouts} app workouts / {r.appMinutes} minutes · {r.recordedSets} recorded sets.</Text>
        <Text type="small">Apple Watch: {r.watchWorkouts} workouts / {r.watchMinutes} minutes. Kept separate from app workouts to avoid double-counting.</Text>
        {r.workoutTypes.map(w => <Text key={w.type} type="small">{w.type.replaceAll('_', ' ')} · {w.count} workouts · {w.minutes} min · {w.heartRate.average == null ? 'heart rate unavailable' : `${w.heartRate.average} bpm mean workout average`}</Text>)}
        <Text>Health & check-ins</Text>
        <Text type="small">Resting heart rate: {avg(r.restingHeartRate, 'bpm')}{'\n'}HRV: {avg(r.hrv, 'ms')}{'\n'}Steps: {avg(r.steps, '/ day')}{'\n'}Active energy: {avg(r.activeEnergy, 'kcal / day')}</Text>
        <Text type="small">Energy: {avg(r.energy, '/ 5')}{'\n'}Mood: {avg(r.mood, '/ 5')}{'\n'}Self-reported sleep: {avg(r.reportedSleep, 'hours')}</Text>
        <Text type="small">Plan: {r.plans.done} completed / {r.plans.total} items · {r.plans.skipped} skipped.</Text>
        <Text type="small">Watch coverage: {r.watchDays} uploaded days, {r.completeWatchDays} complete. {r.demoEntriesExcluded} demo entries excluded.</Text>
        {r.notes.map(n => <Text key={n} type="small" themeColor="textSecondary">{n}</Text>)}
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Button title="Copy report data" size="small" variant="secondary" onPress={() => void Clipboard.setStringAsync(JSON.stringify(r, null, 2)).then(() => setMessage('Report copied.')).catch(() => setMessage('Could not copy report.'))} />
          {Platform.OS === 'web' ? <Button title="Download report" size="small" onPress={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = `rhythm-health-${key}.json`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }} /> : null}
        </View>
      </View> : null}
      {message ? <Notice tone="info">{message}</Notice> : null}
    </> : null}
  </Card>;
}
