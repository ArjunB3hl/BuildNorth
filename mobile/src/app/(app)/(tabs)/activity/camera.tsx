import { Redirect } from 'expo-router';

/** Camera coaching is available on the website only. */
export default function CameraWorkout() {
  return <Redirect href="/activity" />;
}
