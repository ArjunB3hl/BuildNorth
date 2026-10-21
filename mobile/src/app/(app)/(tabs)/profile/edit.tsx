import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { ProfileForm, type ProfileDraft } from '@/components/profile-form';
import { ErrorState, Loading, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';

export default function EditProfile() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile.get });

  if (profile.isPending) return <Loading label="Loading your profile…" />;
  if (profile.isError && !profile.data) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  const { onboardingCompleted, ...initial } = profile.data!;
  void onboardingCompleted;

  async function save(draft: ProfileDraft) {
    const saved = await api.profile.save({ ...draft, onboardingCompleted: true });
    queryClient.setQueryData(['profile'], saved);
    router.back();
  }

  return (
    <Screen>
      <ProfileForm initial={initial} submitLabel="Save" onSubmit={save} />
    </Screen>
  );
}
