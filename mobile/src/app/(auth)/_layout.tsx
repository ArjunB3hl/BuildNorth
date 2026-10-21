import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

import { LoadingScreen } from '@/components/form';

/** Sign-in and sign-up are only for signed-out users. */
export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <LoadingScreen label="Loading…" />;
  if (isSignedIn) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
