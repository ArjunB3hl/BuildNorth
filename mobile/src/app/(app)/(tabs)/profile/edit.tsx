import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Enter, SkeletonCard } from '@/components/motion';
import { ProfileForm, type ProfileDraft } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { ErrorState, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';

export default function EditProfile() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile.get });

  if (profile.isPending) {
    return (
      <Screen>
        <View style={styles.skeletons} accessibilityLabel="Loading your profile">
          {[1, 2, 2, 3].map((lines, i) => <SkeletonCard key={i} lines={lines} />)}
        </View>
      </Screen>
    );
  }
  if (profile.isError && !profile.data) {
    return <Screen><ErrorState error={profile.error} onRetry={() => profile.refetch()} /></Screen>;
  }
  const { onboardingCompleted, ...initial } = profile.data!;
  void onboardingCompleted;

  async function save(draft: ProfileDraft) {
    const saved = await api.profile.save({ ...draft, onboardingCompleted: true });
    queryClient.setQueryData(['profile'], saved);
    router.back();
  }

  return (
    <Screen>
      <Enter>
        <ThemedText type="small" themeColor="textSecondary">
          Every field is optional. These details tailor meals, routines and coaching.
        </ThemedText>
      </Enter>
      <ProfileForm initial={initial} submitLabel="Save" onSubmit={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: Spacing.three },
});
