import { useAuth } from '@clerk/expo';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Screen, SectionHeader } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { useSignOut } from '@/hooks/use-sign-out';
import { WatchConnectivity } from '@/hooks/use-watch';
import { forgetDeletedData } from '@/lib/cache-policy';
import { clearUserCache } from '@/lib/query';

const LABELS: Record<string, string> = {
  profiles: 'Profile',
  remembered_preferences: 'Saved preferences',
  memory_tombstones: 'Pending memory deletions',
  recipes: 'Recipes',
  shopping_items: 'Shopping items',
  routines: 'Routines',
  activity_sessions: 'Activity sessions',
  checkins: 'Check-ins',
  plan_items: 'Plan items',
  coach_messages: 'Coach messages',
  watch_tokens: 'Apple Watch links',
  health_days: 'Apple Watch health summaries',
};

export default function DataScreen() {
  const api = useApi();
  const { userId } = useAuth();
  const signOut = useSignOut();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: api.account.deleteData,
    onSuccess: async () => {
      // The watch's links were deleted too; tell it now rather than on its next sync.
      WatchConnectivity.unlink().catch(() => undefined);
      // Drops everything but the profile from memory before clearing the device copy, so the deleted data
      // (health summaries included) isn't persisted again.
      await forgetDeletedData(queryClient, async () => {
        if (userId) await clearUserCache(userId);
      });
    },
  });

  const confirm = () =>
    Alert.alert(
      'Delete all your BuildNorth data?',
      'This permanently deletes your profile, recipes, shopping list, routines, sessions, check-ins, plan, coach conversation, Apple Watch links and health summaries, and everything long-term memory holds about you. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: () => remove.mutate() },
      ],
    );

  const result = remove.data;
  return (
    <Screen>
      <SectionHeader title="What BuildNorth stores" />
      <Card>
        <ThemedText type="small">
          • Your profile, recipes, shopping list, routines, activity sessions, check-ins, plan and coach conversation, in BuildNorth&apos;s
          database.
        </ThemedText>
        <ThemedText type="small">
          • If you link an Apple Watch: daily health summaries it uploads (sleep, resting heart rate, HRV, steps, active
          energy and workouts) and the watch&apos;s link, in BuildNorth&apos;s database.
        </ThemedText>
        <ThemedText type="small">
          • Preferences you save or confirm, in long-term memory, so the coach can personalise its replies. Apple Watch health
          summaries are added only if you turn on health sharing (Profile → Apple Watch).
        </ThemedText>
        <ThemedText type="small">• A copy of saved content on this device, so it stays readable offline. Signing out removes it.</ThemedText>
        <ThemedText type="small">• Your sign-in account (email and password) is managed by our sign-in provider, Clerk.</ThemedText>
      </Card>

      <SectionHeader title="Delete your data" />
      {result ? (
        <Card>
          <ThemedText type="smallBold">Deleted</ThemedText>
          {Object.entries(result.deletedRecords)
            .filter(([, n]) => n > 0)
            .map(([table, n]) => (
              <ThemedText key={table} type="small">
                • {LABELS[table] ?? table}: {n}
              </ThemedText>
            ))}
          {Object.values(result.deletedRecords).every((n) => n === 0) ? (
            <ThemedText type="small">No app records were stored.</ThemedText>
          ) : null}
          <Notice tone={result.memoryStatus === 'failed' ? 'error' : 'success'}>{result.memoryDetail}</Notice>
          <ThemedText type="small" themeColor="textSecondary">
            Your sign-in account itself still exists. You can keep using BuildNorth with a fresh start, or sign out.
          </ThemedText>
          <Button title="Sign out" variant="secondary" onPress={signOut} />
        </Card>
      ) : null}
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      <Button title="Delete all my data" variant="danger" onPress={confirm} loading={remove.isPending} />
      <ThemedText type="small" themeColor="textSecondary">
        This doesn&apos;t delete your sign-in account. You&apos;ll see exactly what was removed, including whether long-term memory
        could be erased.
      </ThemedText>
    </Screen>
  );
}
