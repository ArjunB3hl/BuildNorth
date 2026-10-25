import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { FormScreen } from '@/components/form';
import { EMPTY_PROFILE, ProfileForm, type ProfileDraft } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { Wordmark } from '@/components/wordmark';
import { useApi } from '@/hooks/use-api';

export default function Onboarding() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function finish(profile: ProfileDraft) {
    const saved = await api.profile.save({ ...profile, onboardingCompleted: true });
    queryClient.setQueryData(['profile'], saved);
    router.replace('/');
  }

  return (
    <FormScreen>
      <Wordmark />
      <ThemedText type="subtitle">Welcome to Rhythm</ThemedText>
      <ThemedText themeColor="textSecondary">
        A few optional details help tailor meals, routines and coaching. Skip anything you like and change it later in Profile.
      </ThemedText>
      <ProfileForm initial={EMPTY_PROFILE} submitLabel="Save and continue" onSubmit={finish} allowSkip />
    </FormScreen>
  );
}
