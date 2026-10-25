import { useUser } from '@clerk/expo';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from 'react-native-reanimated';

import { Accent, Button } from '@/components/form';
import { easeOut, Enter, Skeleton } from '@/components/motion';
import { DetailRow } from '@/components/profile/section';
import { SettingsBlock, SettingsGroup, SettingsRow } from '@/components/profile/settings-list';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useSignOut } from '@/hooks/use-sign-out';
import { useTheme } from '@/hooks/use-theme';
import { localDate } from '@/lib/dates';
import { RECOMMENDATIONS_ENABLED } from '@/lib/rhythm';
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
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  return (
    <Screen refreshing={progress.isRefetching} onRefresh={() => { progress.refetch(); profile.refetch(); }}>
      <Enter>
        <AccountCard
          name={p?.preferredName || 'Your profile'}
          initial={(p?.preferredName || email).trim().charAt(0).toUpperCase()}
          email={email}
          signingOut={signingOut}
          onSignOut={handleSignOut}
        />
      </Enter>

      <Enter index={1} style={styles.group}>
        <SectionHeader title="This week" />
        <StaleBanner visible={progress.isError && !!progress.data} />
        {progress.isPending ? <ProgressSkeleton /> : null}
        {progress.isError && !progress.data ? <ErrorState error={progress.error} onRetry={() => progress.refetch()} /> : null}
        {progress.data ? <ProgressCard progress={progress.data} /> : null}
      </Enter>

      <SettingsGroup title="Preferences & goals" index={2}>
        {profile.isPending ? (
          <SettingsBlock>
            <View accessibilityLabel="Loading your preferences" style={styles.skeletonRows}>
              {[0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <Skeleton width={110} height={12} />
                  <Skeleton width={`${50 - i * 6}%`} height={12} />
                </View>
              ))}
            </View>
          </SettingsBlock>
        ) : null}
        {p ? (
          <SettingsBlock>
            <DetailRow label="Goals" value={list(p.goals)} />
            <DetailRow label="Dietary preferences" value={list(p.dietaryPreferences)} />
            <DetailRow label="Equipment" value={list(p.equipment)} />
            <DetailRow label="Experience" value={list(p.experienceLevel ? [capitalize(p.experienceLevel)] : [])} />
            <DetailRow label="Routine times" value={list(p.routineTimes.map(capitalize))} />
          </SettingsBlock>
        ) : null}
        <SettingsRow
          icon={{ ios: 'pencil', android: 'edit', web: 'edit' }}
          title="Edit preferences & goals"
          onPress={() => router.push('/profile/edit')}
        />
      </SettingsGroup>

      <SettingsGroup title="Rhythm" index={3}>
        <SettingsRow
          icon={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
          title="Interests & sharing"
          subtitle="AI learns your interests · sharing permissions"
          onPress={() => router.push('/profile/interests')}
        />
        <SettingsRow
          icon={{ ios: 'play.rectangle.on.rectangle', android: 'video_library', web: 'video_library' }}
          title="Content library"
          subtitle={RECOMMENDATIONS_ENABLED ? 'Recommendations, chosen agents and browser connections' : 'Chosen agents and remembered context'}
          onPress={() => router.push('/profile/videos')}
        />
      </SettingsGroup>

      <SettingsGroup title="Connections" index={4}>
        <SettingsRow
          icon={{ ios: 'link', android: 'link', web: 'link' }}
          title="AI connections"
          subtitle="ChatGPT, Claude and your demo API key"
          onPress={() => router.push('/profile/connections')}
        />
        {Platform.OS === 'ios' ? (
          <SettingsRow
            icon={{ ios: 'applewatch', android: 'watch', web: 'watch' }}
            title="Apple Watch"
            subtitle="Today's plan, check-ins and health summaries on your wrist"
            onPress={() => router.push('/profile/watch')}
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Memory & data" index={5}>
        <SettingsRow
          icon={{ ios: 'brain', android: 'psychology', web: 'psychology' }}
          title="What BuildNorth remembers"
          subtitle="View, correct or delete remembered preferences"
          onPress={() => router.push('/profile/memory')}
        />
        <SettingsRow
          icon={{ ios: 'hand.raised', android: 'privacy_tip', web: 'privacy_tip' }}
          title="Your data"
          subtitle="What's stored and how to delete it"
          onPress={() => router.push('/profile/data')}
        />
      </SettingsGroup>
    </Screen>
  );
}

function AccountCard({
  name,
  initial,
  email,
  signingOut,
  onSignOut,
}: {
  name: string;
  initial: string;
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.account}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]} accessibilityElementsHidden importantForAccessibility="no">
          {initial ? (
            <ThemedText style={[styles.avatarText, { color: Accent }]}>{initial}</ThemedText>
          ) : (
            <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={26} tintColor={Accent} />
          )}
        </View>
        <View style={styles.accountText}>
          <ThemedText style={styles.name} numberOfLines={1} accessibilityRole="header">
            {name}
          </ThemedText>
          {email ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {email}
            </ThemedText>
          ) : null}
        </View>
        <Button title="Sign out" size="small" variant="secondary" onPress={onSignOut} loading={signingOut} />
      </View>
    </Card>
  );
}

function capitalize(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

function list(values: string[]): string {
  return values.length ? values.join(', ') : 'Not set';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** Placeholder in the progress card's shape while it's calculated. */
function ProgressSkeleton() {
  const theme = useTheme();
  return (
    <Card style={styles.progress}>
      <View accessibilityLabel="Calculating progress" style={styles.progress}>
        {[0, 1].map((row) => (
          <Row key={row} style={styles.stats}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.stat}>
                <Skeleton width={36} height={24} style={styles.statSkeleton} />
                <Skeleton width={64} height={12} />
              </View>
            ))}
          </Row>
        ))}
        <View style={styles.chart}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} style={styles.barColumn}>
              <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]} />
              <Skeleton width={8} height={10} radius={3} />
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

const grow: CSSAnimationKeyframes = {
  from: { transform: [{ scaleY: 0 }] },
  to: { transform: [{ scaleY: 1 }] },
};

function ProgressCard({ progress }: { progress: Progress }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const w = progress.week;
  const maxMinutes = Math.max(1, ...progress.last7.map((d) => d.activeMinutes));
  const nothingYet = w.sessionsCompleted === 0 && w.checkIns === 0 && w.planDone === 0;
  return (
    <Card style={styles.progress}>
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
        {progress.last7.map((d, i) => (
          <View key={d.date} style={styles.barColumn}>
            <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
              {/* Bars grow up from the baseline, one after another, when the card first appears. */}
              <Animated.View
                style={[
                  styles.bar,
                  { height: `${(d.activeMinutes / maxMinutes) * 100}%`, backgroundColor: Accent },
                  !reduced && {
                    animationName: grow,
                    animationDuration: '520ms',
                    animationDelay: `${120 + i * 40}ms`,
                    animationFillMode: 'both',
                    animationTimingFunction: easeOut,
                  },
                ]}
              />
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
  group: { gap: Spacing.two },
  account: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, lineHeight: 28, fontWeight: 600 },
  accountText: { flex: 1, minWidth: 0, gap: Spacing.half },
  name: { fontSize: 20, lineHeight: 26, fontWeight: 600 },
  progress: { gap: Spacing.three },
  stats: { justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'center', gap: Spacing.half },
  statValue: { fontSize: 24, lineHeight: 30, fontWeight: 600 },
  chart: { flexDirection: 'row', height: 90, gap: Spacing.two },
  barColumn: { flex: 1, alignItems: 'center', gap: Spacing.one },
  barTrack: { flex: 1, width: '70%', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 6, transformOrigin: 'bottom' },
  statSkeleton: { marginVertical: 3 },
  skeletonRows: { gap: Spacing.three },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  barLabel: { fontSize: 11, lineHeight: 14 },
});
