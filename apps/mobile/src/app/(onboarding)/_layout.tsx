import { Stack } from 'expo-router';

/** Onboarding runs as its own stack so the app's tabs are not reachable yet. */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
