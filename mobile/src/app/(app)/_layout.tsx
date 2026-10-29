import { useAuth } from '@clerk/expo';
import { useQuery } from '@tanstack/react-query';
import { Redirect, Stack } from 'expo-router';

import { Button, FormScreen, LoadingScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { useSignOut } from '@/hooks/use-sign-out';
import { useStackOptions } from '@/hooks/use-stack-options';
import { UserQueryProvider } from '@/lib/query';

/** Every screen in this group requires a signed-in Clerk session. */
export default function ProtectedLayout() {
  const { isLoaded, isSignedIn, userId } = useAuth();

  if (!isLoaded) return <LoadingScreen label="Checking your session…" />;
  if (!isSignedIn || !userId) return <Redirect href="/sign-in" />;

  // Keyed by user so a different account on this device never sees another's cache.
  return (
    <UserQueryProvider key={userId} userId={userId}>
      <OnboardingGate />
    </UserQueryProvider>
  );
}

function OnboardingGate() {
  const api = useApi();
  const signOut = useSignOut();
  const stackOptions = useStackOptions();
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile.get });

  if (profile.isPending) return <LoadingScreen label="Loading your profile…" />;
  if (profile.isError && !profile.data) {
    return (
      <FormScreen>
        <ThemedText type="subtitle">We can&apos;t load your profile</ThemedText>
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        <Button title="Sign out" variant="quiet" onPress={signOut} />
      </FormScreen>
    );
  }
  return (
    <Stack screenOptions={{ ...stackOptions, headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="plan-add" options={{ headerShown: true, title: 'Add to plan', presentation: 'modal' }} />
      <Stack.Screen name="planner" options={{ headerShown: true, title: 'Plan my week' }} />
      <Stack.Screen name="planner-review" options={{ headerShown: true, title: 'Your draft week' }} />
      <Stack.Screen name="review" options={{ headerShown: true, title: 'Weekly review' }} />
      <Stack.Screen name="approvals" options={{ headerShown: true, title: 'Waiting for your approval' }} />
    </Stack>
  );
}
