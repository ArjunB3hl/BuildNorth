import { useRouter } from 'expo-router';

import { Button } from '@/components/form';
import { EmptyState, Screen } from '@/components/ui';

/**
 * Camera workouts run in the web app for now (camera.web.tsx): the pose coach is a browser page on the computer.
 * Expo Router needs this platform-neutral file next to the web one; no phone screen links here.
 */
export default function CameraWorkout() {
  const router = useRouter();
  return (
    <Screen aboveTabBar={false}>
      <EmptyState
        title="Camera workouts are on the web for now"
        body="Open BuildNorth in a browser on your computer to count reps and sets with the camera."
        action={<Button title="Back" variant="secondary" onPress={() => router.back()} />}
      />
    </Screen>
  );
}
