import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Notice } from '@/components/form';
import { DestructiveButton, FormActions, ToggleRow } from '@/components/profile/controls';
import { BulletList, Divider, SectionCard } from '@/components/profile/section';
import { SettingsGroup, SettingsRow } from '@/components/profile/settings-list';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, errorMessage, Loading, Pill, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useWatchState, WatchConnectivity, type WatchState } from '@/hooks/use-watch';
import { API_URL } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { friendlyDate, localDate } from '@/lib/dates';
import { SHARING_OFF, shareConfirmation, sharingRecipients } from '@/lib/health-sharing';
import type { HealthDay, HealthWorkout } from '@/lib/types';
import { isActiveToken, linkWatch } from '@/lib/watch-link';
import { Stagger } from '@/components/motion';

/** Link the Rhythm Apple Watch app, choose whether its health summaries are shared, and see what it uploaded. */
export default function WatchScreen() {
  const api = useApi();
  const queryClient = useQueryClient();
  const watch = useWatchState();
  const today = localDate();
  const tokens = useQuery({ queryKey: ['watch-tokens'], queryFn: api.watch.tokens });
  const settings = useQuery({ queryKey: ['watch-settings'], queryFn: api.watch.settings });
  const health = useQuery({ queryKey: ['watch-health', today], queryFn: () => api.watch.health(today, 7) });
  // Names the Coach's AI provider in the sharing consent.
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
  const refreshTokens = () => queryClient.invalidateQueries({ queryKey: ['watch-tokens'] });

  const link = useMutation({
    // The plaintext token exists only inside this function: it goes from the server straight to the watch
    // and Rhythm never returns, caches or stores it. WatchConnectivity itself keeps the last application
    // context (token included) on this iPhone until the next link or unlink replaces it.
    mutationFn: async () => {
      // Don't mint for a watch that can't receive it.
      const blocked = readiness(WatchConnectivity.getState());
      if (!blocked.ready) throw new NotReadyError(blocked.message);
      // Earlier links are revoked only once the new one has been handed to the watch.
      return linkWatch({
        listTokens: api.watch.tokens,
        createToken: api.watch.createToken,
        revokeToken: api.watch.revokeToken,
        sendLink: (token) => WatchConnectivity.sendLink(API_URL, token),
      });
    },
    onSettled: refreshTokens,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.watch.revokeToken(id), onSuccess: refreshTokens });
  const unlink = useMutation({
    mutationFn: async () => {
      const [revoked] = await Promise.allSettled([api.watch.revokeAll(), WatchConnectivity.unlink()]);
      // Revoking is what counts: a watch that misses the message signs out on its next request.
      if (revoked.status === 'rejected') throw revoked.reason;
    },
    onSuccess: () => link.reset(),
    onSettled: refreshTokens,
  });
  const share = useMutation({
    mutationFn: (shareHealth: boolean) => api.watch.saveSettings({ shareHealth }),
    onSuccess: (saved) => queryClient.setQueryData(['watch-settings'], saved),
    // The server may have saved the choice even when the request failed (e.g. it timed out while updating
    // memory), so always reload what it holds. Each day's memory status changes with sharing too.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['watch-settings'] });
      queryClient.invalidateQueries({ queryKey: ['watch-health'] });
    },
  });

  async function confirmRevoke(id: string, name: string) {
    const ok = await confirmAction({
      title: 'Revoke this link?',
      message: `“${name}” signs out the next time it syncs.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (ok) revoke.mutate(id);
  }

  async function confirmShare() {
    const ok = await confirmAction({
      title: 'Share health summaries?',
      message: shareConfirmation(status.data?.aiProvider),
      confirmLabel: 'Share',
    });
    if (ok) share.mutate(true);
  }

  async function confirmUnlink() {
    const ok = await confirmAction({
      title: 'Unlink Apple Watch?',
      message:
        'Your watch signs out and stops showing your plan. Health summaries it already uploaded stay in Rhythm until you delete your data.',
      confirmLabel: 'Unlink',
      destructive: true,
    });
    if (ok) unlink.mutate();
  }

  const state = readiness(watch);
  const allTokens = tokens.data?.tokens ?? [];
  // An expired link no longer works on the watch, so it doesn't count as linked.
  const active = allTokens.filter((t) => isActiveToken(t));
  // Expired links are never revoked, so only the newest one (the list is newest first) says what happened last.
  const expired = !!allTokens[0] && !allTokens[0].revoked && !isActiveToken(allTokens[0]);
  const shareHealth = share.isPending ? share.variables : (settings.data?.shareHealth ?? false);
  const days = [...(health.data?.days ?? [])].reverse();

  return (
    <Screen
      aboveTabBar={false}
      refreshing={tokens.isRefetching || settings.isRefetching || health.isRefetching}
      onRefresh={() => {
        tokens.refetch();
        settings.refetch();
        health.refetch();
      }}>
      <Stagger>
        <ThemedText type="small" themeColor="textSecondary">
          See today&apos;s plan, tick items off and check in from your wrist. The watch can also upload a daily summary from
          Apple Health: sleep, resting heart rate, HRV, steps, active energy and workouts.
        </ThemedText>

        <SectionCard
          title="Apple Watch"
          icon={{ ios: 'applewatch', android: 'watch', web: 'watch' }}
          description={state.message}
          action={<Pill label={state.ready ? 'Ready to link' : 'Not ready'} tone={state.ready ? 'success' : 'muted'} />}>
          {link.isSuccess ? (
            <Notice tone="success">Link sent. Open Rhythm on your watch; it signs in by itself.</Notice>
          ) : null}
          {link.data?.notRevoked ? (
            <Notice tone="warning">An earlier link couldn&apos;t be revoked. It&apos;s still listed under Linked watches; revoke it there.</Notice>
          ) : null}
          {link.isError ? <Notice tone="error">{linkErrorMessage(link.error)}</Notice> : null}
          <ThemedText type="small" themeColor="textSecondary">
            The watch gets its own key, valid for 90 days, that only reaches your plan, check-ins and health summaries.
            Rhythm doesn&apos;t store it on this iPhone, though iOS holds on to the last link sent to the watch until
            you link again or unlink.
          </ThemedText>
          <FormActions>
            <Button
              title={active.length ? 'Link again' : 'Link Apple Watch'}
              onPress={() => link.mutate()}
              loading={link.isPending}
              disabled={!state.ready || link.isPending}
            />
          </FormActions>
        </SectionCard>

        <SectionCard title="Health sharing" icon={{ ios: 'heart.text.square', android: 'monitor_heart', web: 'monitor_heart' }}>
          <ToggleRow
            label="Share health summaries with AI services"
            value={shareHealth}
            // Turning it on asks first; turning it off takes effect straight away.
            onChange={(value) => (value ? void confirmShare() : share.mutate(false))}
            disabled={!settings.data || share.isPending}
          />
          <Divider />
          <ThemedText type="small" themeColor="textSecondary">
            When on, your daily summaries, including today so far, are:
          </ThemedText>
          <BulletList secondary items={sharingRecipients(status.data?.aiProvider)} />
          <ThemedText type="small" themeColor="textSecondary">
            {SHARING_OFF}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Watch measurements are context only. Rhythm doesn&apos;t diagnose or give medical advice.
          </ThemedText>
          {settings.isError && !settings.data ? <ErrorState error={settings.error} onRetry={() => settings.refetch()} /> : null}
          {share.isError ? <Notice tone="error">{errorMessage(share.error)}</Notice> : null}
        </SectionCard>

        <View style={styles.group}>
          {active.length ? null : <SectionHeader title="Linked watches" />}
          <StaleBanner visible={tokens.isError && !!tokens.data} />
          {tokens.isPending ? <Loading /> : null}
          {tokens.isError && !tokens.data ? <ErrorState error={tokens.error} onRetry={() => tokens.refetch()} /> : null}
          {tokens.data && active.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {expired ? "Your watch's link has expired. Link it again to keep using Rhythm on your wrist." : 'No watch is linked.'}
            </ThemedText>
          ) : null}
          {active.length ? (
            <SettingsGroup title="Linked watches">
              {active.map((t) => (
                <SettingsRow
                  key={t.id}
                  icon={{ ios: 'applewatch', android: 'watch', web: 'watch' }}
                  title={t.label}
                  subtitle={`…${t.hint} · linked ${friendlyDay(t.createdAt)} · last used ${t.lastUsedAt ? friendlyDay(t.lastUsedAt) : 'not yet'} · expires ${friendlyDay(t.expiresAt)}`}
                  trailing={
                    <DestructiveButton
                      title="Revoke"
                      accessibilityLabel={`Revoke ${t.label}`}
                      loading={revoke.isPending && revoke.variables === t.id}
                      onPress={() => void confirmRevoke(t.id, t.label)}
                    />
                  }
                />
              ))}
            </SettingsGroup>
          ) : null}
          {revoke.isError ? <Notice tone="error">{errorMessage(revoke.error)}</Notice> : null}
          {active.length ? (
            <>
              {unlink.isError ? <Notice tone="error">{errorMessage(unlink.error)}</Notice> : null}
              <FormActions>
                <DestructiveButton title="Unlink Apple Watch" size="regular" onPress={() => void confirmUnlink()} loading={unlink.isPending} />
              </FormActions>
            </>
          ) : null}
        </View>

        <View style={styles.group}>
          <SectionHeader title="Last 7 days" />
          <StaleBanner visible={health.isError && !!health.data} />
          {health.isPending ? <Loading label="Loading health summaries…" /> : null}
          {health.isError && !health.data ? <ErrorState error={health.error} onRetry={() => health.refetch()} /> : null}
          {health.data && days.length === 0 ? (
            <EmptyState
              title="No health summaries yet"
              body="Open Rhythm on your watch and allow Health access. It uploads yesterday and today each time it syncs."
            />
          ) : null}
          {days.length ? (
            <Card style={styles.days}>
              {days.map((day, i) => (
                <Fragment key={day.date}>
                  {i > 0 ? <Divider /> : null}
                  <HealthDayRow day={day} shareHealth={shareHealth} />
                </Fragment>
              ))}
            </Card>
          ) : null}
        </View>
      </Stagger>
    </Screen>
  );
}

class NotReadyError extends Error {}

/** Server timestamps are UTC; show the day they fall on here. */
function friendlyDay(timestamp: string): string {
  return friendlyDate(localDate(new Date(timestamp)));
}

function readiness(watch: WatchState): { ready: boolean; message: string } {
  if (!WatchConnectivity.available) {
    return {
      ready: false,
      message:
        Platform.OS === 'ios'
          ? "This version of the app can't talk to Apple Watch (Expo Go can't). Use the installed Rhythm app to link your watch."
          : 'Apple Watch works with Rhythm on iPhone.',
    };
  }
  if (!watch.supported) return { ready: false, message: "This device can't pair with an Apple Watch." };
  if (!watch.activated) return { ready: false, message: 'Connecting to your Apple Watch…' };
  if (!watch.paired) return { ready: false, message: 'No Apple Watch is paired with this iPhone. Pair one in the Watch app first.' };
  if (!watch.watchAppInstalled) {
    return {
      ready: false,
      message: 'Install Rhythm on your watch: open the Watch app on this iPhone and find Rhythm under Available Apps.',
    };
  }
  return {
    ready: true,
    message: watch.reachable
      ? 'Your Apple Watch is connected.'
      : "Your Apple Watch is paired. If it's out of range, the link arrives the next time it connects.",
  };
}

function linkErrorMessage(error: unknown): string {
  if (error instanceof NotReadyError) return error.message;
  if (error instanceof WatchConnectivity.WatchConnectivityError) {
    switch (error.code) {
      case 'not_paired':
        return 'No Apple Watch is paired with this iPhone.';
      case 'app_not_installed':
        return "Rhythm isn't installed on your Apple Watch yet.";
      case 'inactive':
        return "The connection to your Apple Watch isn't ready yet. Try again in a moment.";
      case 'unavailable':
      case 'unsupported':
        return "This app can't link an Apple Watch.";
      default:
        return "Couldn't send the link to your Apple Watch. Try again.";
    }
  }
  return errorMessage(error);
}

function capitalize(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

function healthFacts(day: HealthDay): string[] {
  const facts: string[] = [];
  if (day.sleepMinutes != null) facts.push(`slept ${Math.floor(day.sleepMinutes / 60)} h ${day.sleepMinutes % 60} min`);
  if (day.restingHeartRateBpm != null) facts.push(`resting heart rate ${day.restingHeartRateBpm} bpm`);
  if (day.hrvSdnnMs != null) facts.push(`HRV ${Math.round(day.hrvSdnnMs)} ms`);
  if (day.steps != null) facts.push(`${day.steps.toLocaleString()} steps`);
  if (day.activeEnergyKcal != null) facts.push(`${Math.round(day.activeEnergyKcal).toLocaleString()} kcal active energy`);
  return facts.map(capitalize);
}

function workoutLabel(workout: HealthWorkout): string {
  return `${Math.round(workout.durationMinutes)} min ${workout.activityType.replace(/_/g, ' ')}`;
}

function memoryLabel(day: HealthDay, shareHealth: boolean): { label: string; tone: 'success' | 'muted' } {
  if (day.memoryStatus === 'synced') return { label: 'In memory', tone: 'success' };
  if (day.memoryStatus === 'pending') return { label: 'Memory sync pending', tone: 'muted' };
  if (!shareHealth) return { label: 'Not shared', tone: 'muted' };
  // Today so far already reaches the Coach and assistants; memory only takes finished days.
  return { label: day.complete ? 'Not in memory' : 'In memory when the day ends', tone: 'muted' };
}

function HealthDayRow({ day, shareHealth }: { day: HealthDay; shareHealth: boolean }) {
  const facts = healthFacts(day);
  const memory = memoryLabel(day, shareHealth);
  return (
    <View style={styles.day}>
      <Row>
        <ThemedText type="smallBold" style={styles.fill}>
          {friendlyDate(day.date)}
          {day.complete ? '' : ' (so far)'}
        </ThemedText>
        <Pill label={memory.label} tone={memory.tone} />
      </Row>
      <ThemedText type="small">{facts.length ? facts.join(' · ') : 'No measurements for this day.'}</ThemedText>
      {day.workouts.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          Workouts: {day.workouts.map(workoutLabel).join(', ')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { gap: Spacing.two },
  days: { gap: Spacing.three },
  day: { gap: Spacing.one },
});
