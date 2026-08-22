import { Stack } from 'expo-router';

/** Signed-out routes. No tab bar and no back-to-app affordance. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
