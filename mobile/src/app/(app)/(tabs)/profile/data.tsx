import { useAuth } from '@clerk/expo';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button, Notice } from '@/components/form';
import { FormActions } from '@/components/profile/controls';
import { DetailRow, FactList, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { errorMessage, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { useSignOut } from '@/hooks/use-sign-out';
import { WatchConnectivity } from '@/hooks/use-watch';
import { forgetDeletedData } from '@/lib/cache-policy';
import { confirmAction } from '@/lib/confirm';
import { clearUserCache } from '@/lib/query';
import { Stagger } from '@/components/motion';

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

  async function confirm() {
    const ok = await confirmAction({
      title: 'Delete all your BuildNorth data?',
      message:
        'This permanently deletes your profile, recipes, shopping list, routines, sessions, check-ins, plan, coach conversation, Apple Watch links and health summaries, and everything long-term memory holds about you. It cannot be undone.',
      confirmLabel: 'Delete everything',
      destructive: true,
    });
    if (ok) remove.mutate();
  }

  const result = remove.data;
  const deleted = result ? Object.entries(result.deletedRecords).filter(([, n]) => n > 0) : [];
  return (
    <Screen>
      <Stagger>
        <SectionCard title="What BuildNorth stores" icon={{ ios: 'tray.full', android: 'database', web: 'database' }}>
          <FactList
            items={[
              {
                icon: { ios: 'person', android: 'person', web: 'person' },
                text: "Your profile, recipes, shopping list, routines, activity sessions, check-ins, plan and coach conversation, in BuildNorth's database.",
              },
              {
                icon: { ios: 'applewatch', android: 'watch', web: 'watch' },
                text: "If you link an Apple Watch: daily health summaries it uploads (sleep, resting heart rate, HRV, steps, active energy and workouts) and the watch's link, in BuildNorth's database.",
              },
              {
                icon: { ios: 'brain', android: 'psychology', web: 'psychology' },
                text: 'Preferences you save or confirm, in long-term memory, so the coach can personalise its replies. Apple Watch health summaries are added only if you turn on health sharing (Profile → Apple Watch).',
              },
              {
                icon: { ios: 'iphone', android: 'devices', web: 'devices' },
                text: 'A copy of saved content on this device, so it stays readable offline. Signing out removes it.',
              },
              {
                icon: { ios: 'lock', android: 'lock', web: 'lock' },
                text: 'Your sign-in account (email and password) is managed by our sign-in provider, Clerk.',
              },
            ]}
          />
        </SectionCard>

        {result ? (
          <SectionCard title="Deleted" icon={{ ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }}>
            {deleted.map(([table, n]) => (
              <DetailRow key={table} label={LABELS[table] ?? table} value={String(n)} />
            ))}
            {deleted.length === 0 ? <ThemedText type="small">No app records were stored.</ThemedText> : null}
            <Notice tone={result.memoryStatus === 'failed' ? 'error' : 'success'}>{result.memoryDetail}</Notice>
            <ThemedText type="small" themeColor="textSecondary">
              Your sign-in account itself still exists. You can keep using BuildNorth with a fresh start, or sign out.
            </ThemedText>
            <FormActions>
              <Button title="Sign out" variant="secondary" onPress={signOut} />
            </FormActions>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Delete your data"
          tone="danger"
          icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
          description="This doesn't delete your sign-in account. You'll see exactly what was removed, including whether long-term memory could be erased.">
          {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
          <FormActions>
            <Button title="Delete all my data" variant="danger" onPress={() => void confirm()} loading={remove.isPending} />
          </FormActions>
        </SectionCard>
      </Stagger>
    </Screen>
  );
}
