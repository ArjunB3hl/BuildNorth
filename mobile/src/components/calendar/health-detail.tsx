import { View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import type { CalendarEntry, HealthDay, SleepPattern } from '@/lib/types';

export const minutesLabel = (n: number | null | undefined) => n == null ? 'Not recorded' : `${Math.floor(Math.round(n) / 60)} h ${Math.round(n) % 60} min`;
const timeLabel = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function SleepDetail({ pattern }: { pattern?: SleepPattern | null }) {
  if (!pattern) return <Text type="small" themeColor="textSecondary">Sleep stages and timing weren’t included in this upload.</Text>;
  const stages = [['Core', pattern.coreMinutes], ['Deep', pattern.deepMinutes], ['REM', pattern.remMinutes], ['Awake', pattern.awakeMinutes], ['Unspecified', pattern.unspecifiedMinutes]] as const;
  return <View style={{ gap: 6 }}>
    {pattern.startedAt && pattern.endedAt ? <Text type="small">{timeLabel(pattern.startedAt)} → {timeLabel(pattern.endedAt)} · sleep window</Text> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{stages.filter(([, n]) => n != null).map(([label, n]) =>
      <Text key={label} type="small" style={{ color: label === 'Deep' ? '#A68BFA' : label === 'REM' ? '#E39DCE' : '#75A9EF' }}>{label} {n} min</Text>)}</View>
    <Text type="small" themeColor="textSecondary">Stages can overlap between sources; durations are not additive.</Text>
  </View>;
}

export function WatchEntryDetail({ entry }: { entry: CalendarEntry }) {
  const w = entry.workout;
  return <View style={{ gap: 6 }}>
    {w ? <>
      <Text type="small">Heart rate · {w.averageHeartRateBpm == null ? 'not recorded' : `${Math.round(w.averageHeartRateBpm)} bpm average`}</Text>
      {w.minHeartRateBpm != null && w.maxHeartRateBpm != null ? <Text type="small" themeColor="textSecondary">{Math.round(w.minHeartRateBpm)}–{Math.round(w.maxHeartRateBpm)} bpm range</Text> : null}
      {w.distanceMeters != null ? <Text type="small">{(w.distanceMeters / 1000).toFixed(2)} km</Text> : null}
      {w.energyKcal != null ? <Text type="small">{Math.round(w.energyKcal)} kcal active energy</Text> : null}
    </> : null}
    {entry.kind === 'sleep' ? <SleepDetail pattern={entry.sleepPattern} /> : null}
    {entry.partial ? <Text type="small" themeColor="textSecondary">Day still in progress · updates after Watch sync</Text> : null}
  </View>;
}

export function HealthReadings({ day }: { day: HealthDay }) {
  const values = [day.restingHeartRateBpm == null ? null : `Resting heart rate ${day.restingHeartRateBpm} bpm`,
    day.hrvSdnnMs == null ? null : `HRV ${day.hrvSdnnMs} ms`, day.steps == null ? null : `${day.steps.toLocaleString()} steps`,
    day.activeEnergyKcal == null ? null : `${Math.round(day.activeEnergyKcal)} kcal active energy`].filter(Boolean);
  return <>{values.map(v => <Text type="small" key={v}>{v}</Text>)}</>;
}
