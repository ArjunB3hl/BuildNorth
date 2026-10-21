import { useUser } from '@clerk/expo';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Accent, Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, ListItem, Loading, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useSignOut } from '@/hooks/use-sign-out';
import { useTheme } from '@/hooks/use-theme';
import { localDate } from '@/lib/dates';
import type { Progress } from '@/lib/types';

export default function ProfileScreen() {
  const api = useApi();
  const router = useRouter();
  const { user } = useUser();
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);
  const today = localDate();
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile.get });
  const progress = useQuery({ queryKey: ['progress', today], queryFn: () => api.progress(today) });

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  const p = profile.data;
  return (
    <Screen refreshing={progress.isRefetching} onRefresh={() => { progress.refetch(); profile.refetch(); }}>
      <View style={styles.header}>
        <ThemedText type="subtitle">{p?.preferredName || 'Your profile'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {user?.primaryEmailAddress?.emailAddress ?? ''}
        </ThemedText>
      </View>

      <SectionHeader title="This week" />
      <StaleBanner visible={progress.isError && !!progress.data} />
      {progress.isPending ? <Loading label="Calculating progress…" /> : null}
      {progress.isError && !progress.data ? <ErrorState error={progress.error} onRetry={() => progress.refetch()} /> : null}
      {progress.data ? <ProgressCard progress={progress.data} /> : null}

      <SectionHeader title="About you" />
      {p ? (
        <Card>
          <Summary label="Goals" values={p.goals} />
          <Summary label="Dietary preferences" values={p.dietaryPreferences} />
          <Summary label="Equipment" values={p.equipment} />
          <Summary label="Experience" values={p.experienceLevel ? [p.experienceLevel[0].toUpperCase() + p.experienceLevel.slice(1)] : []} />
          <Summary label="Routine times" values={p.routineTimes.map((t) => t[0].toUpperCase() + t.slice(1))} />
        </Card>
      ) : null}
      <ListItem title="Edit preferences & goals" onPress={() => router.push('/profile/edit')} />
      <ListItem
        title="What BuildNorth remembers"
        subtitle="View, correct or delete remembered preferences"
        onPress={() => router.push('/profile/memory')}
      />
      <ListItem
        title="Connect AI assistants"
        subtitle="OpenCode, ChatGPT or Claude over MCP"
        onPress={() => router.push('/profile/connections')}
      />
      {Platform.OS === 'ios' ? (
        <ListItem
          title="Apple Watch"
          subtitle="Today's plan, check-ins and health summaries on your wrist"
          onPress={() => router.push('/profile/watch')}
        />
      ) : null}
      <ListItem title="Your data" subtitle="What's stored and how to delete it" onPress={() => router.push('/profile/data')} />

      <Button title="Sign out" variant="secondary" onPress={handleSignOut} loading={signingOut} />
    </Screen>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function Summary({ label, values }: { label: string; values: string[] }) {
  return (
    <Row style={styles.summary}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.fill}>
        {values.length ? values.join(', ') : 'Not set'}
      </ThemedText>
    </Row>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText type="subtitle" style={styles.statValue}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ProgressCard({ progress }: { progress: Progress }) {
  const theme = useTheme();
  const w = progress.week;
  const maxMinutes = Math.max(1, ...progress.last7.map((d) => d.activeMinutes));
  const nothingYet = w.sessionsCompleted === 0 && w.checkIns === 0 && w.planDone === 0;
  return (
    <Card>
      {nothingYet ? (
        <ThemedText type="small" themeColor="textSecondary">
          Complete a session, a planned item or a daily check-in and your progress shows up here.
        </ThemedText>
      ) : null}
      <Row style={styles.stats}>
        <Stat label="Sessions" value={String(w.sessionsCompleted)} />
        <Stat label="Active min" value={String(w.activeMinutes)} />
        <Stat label="Day streak" value={String(progress.streakDays)} />
      </Row>
      <Row style={styles.stats}>
        <Stat label="Check-ins" value={String(w.checkIns)} />
        <Stat label="Avg energy" value={w.averageEnergy != null ? `${w.averageEnergy}/5` : '—'} />
        <Stat label="Avg mood" value={w.averageMood != null ? `${w.averageMood}/5` : '—'} />
      </Row>
      {w.averageSleepHours != null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Average sleep logged: {w.averageSleepHours} h
        </ThemedText>
      ) : null}
      <View style={styles.chart} accessibilityLabel="Active minutes over the last 7 days">
        {progress.last7.map((d) => (
          <View key={d.date} style={styles.barColumn}>
            <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View style={[styles.bar, { height: `${(d.activeMinutes / maxMinutes) * 100}%`, backgroundColor: Accent }]} />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.barLabel}>
              {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
            </ThemedText>
          </View>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Last 30 days: {plural(progress.month.sessionsCompleted, 'session')} · {plural(progress.month.activeMinutes, 'active minute')} ·{' '}
        {plural(progress.month.planDone, 'planned item')} done
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { gap: Spacing.one },
  summary: { alignItems: 'flex-start' },
  summaryLabel: { width: 130 },
  stats: { justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 24, lineHeight: 30 },
  chart: { flexDirection: 'row', height: 90, gap: Spacing.two, marginTop: Spacing.two },
  barColumn: { flex: 1, alignItems: 'center', gap: Spacing.one },
  barTrack: { flex: 1, width: '70%', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 6 },
  barLabel: { fontSize: 11, lineHeight: 14 },
});
