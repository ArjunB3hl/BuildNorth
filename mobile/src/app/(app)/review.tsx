import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, ErrorState, Loading, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { addDays, localDate, weekdayShort, weekStart } from '@/lib/dates';
import type { ReviewDay, WeeklyReview } from '@/lib/types';

/** A look back at what was actually recorded. No AI: every line comes from saved records. */
export default function WeeklyReviewScreen() {
  const api = useApi();
  const router = useRouter();
  const today = localDate();
  const lastSunday = addDays(weekStart(today), -1);
  const [end, setEnd] = useState(today);
  const review = useQuery({ queryKey: ['review', end], queryFn: () => api.planner.review(end) });
  const data = review.data;

  return (
    <Screen aboveTabBar={false} refreshing={review.isRefetching} onRefresh={() => review.refetch()}>
      <ChipGroup
        options={[
          { value: today, label: 'Last 7 days' },
          { value: lastSunday, label: `Last week (${weekdayShort(addDays(lastSunday, -6))} – ${weekdayShort(lastSunday)})` },
        ]}
        multiple={false}
        selected={[end]}
        onChange={(v) => v[0] && setEnd(v[0])}
      />
      <StaleBanner visible={review.isError && !!data} />
      {review.isPending ? <Loading label="Gathering your records…" /> : null}
      {review.isError && !data ? <ErrorState error={review.error} onRetry={() => review.refetch()} /> : null}
      {data ? <ReviewBody data={data} onPlan={(params) => router.push({ pathname: '/planner', params })} /> : null}
    </Screen>
  );
}

function ReviewBody({ data, onPlan }: { data: WeeklyReview; onPlan: (params: Record<string, string>) => void }) {
  const t = data.totals;
  return (
    <>
      <Card>
        <ThemedText type="smallBold">What your records show</ThemedText>
        {data.observations.map((o) => (
          <ThemedText key={o} type="small">
            • {o}
          </ThemedText>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Only what you recorded is counted. A day with no records is missing data, not a day without activity.
        </ThemedText>
      </Card>

      <View style={styles.grid}>
        <Stat label="Sessions" value={t.sessions} />
        <Stat label="Active min" value={t.activeMinutes} />
        <Stat label="Check-ins" value={`${t.checkInDays}/7`} />
        <Stat label="No records" value={`${t.daysWithoutRecords} d`} />
      </View>

      <SectionHeader title="Day by day" />
      {data.days.map((d) => (
        <DayRow key={d.date} day={d} />
      ))}

      {data.adjustments.length ? (
        <>
          <SectionHeader title="Optional adjustments for next week" />
          {data.adjustments.map((a) => (
            <Card key={a.id}>
              <ThemedText type="smallBold">{a.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {a.description}
              </ThemedText>
              <Row>
                <Button
                  title="Plan next week with this"
                  size="small"
                  variant="secondary"
                  onPress={() =>
                    onPlan({
                      start: addDays(weekStart(localDate()), 7),
                      ...(a.preset.activityDays != null ? { activityDays: String(a.preset.activityDays) } : {}),
                      ...(a.preset.minutesPerDay != null ? { minutesPerDay: String(a.preset.minutesPerDay) } : {}),
                      ...(a.preset.mealSlots ? { mealSlots: a.preset.mealSlots.join(',') } : {}),
                    })
                  }
                />
              </Row>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card style={styles.stat}>
      <ThemedText type="subtitle">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Card>
  );
}

function DayRow({ day }: { day: ReviewDay }) {
  const parts: string[] = [];
  if (day.sessions) parts.push(`${day.sessions} session${day.sessions === 1 ? '' : 's'}, ${day.activeMinutes} min`);
  if (day.plannedActivities)
    parts.push(`activities ${day.doneActivities} done · ${day.skippedActivities} skipped · ${day.openActivities} open`);
  if (day.plannedMeals) parts.push(`meals ${day.doneMeals} done · ${day.skippedMeals} skipped · ${day.openMeals} open`);
  if (day.checkIn) parts.push(`check-in: energy ${day.checkIn.energy}/5, mood ${day.checkIn.mood}/5`);
  return (
    <Card>
      <ThemedText type="smallBold">{weekdayShort(day.date)}</ThemedText>
      <ThemedText type="small" themeColor={day.hasRecords ? undefined : 'textSecondary'}>
        {day.hasRecords ? parts.join('\n') || 'Records exist, but no activity was logged.' : 'No records (missing data)'}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stat: { flexGrow: 1, flexBasis: '45%', alignItems: 'center', gap: 0 },
});
