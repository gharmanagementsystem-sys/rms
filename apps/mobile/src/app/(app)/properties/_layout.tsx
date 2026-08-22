import { Stack } from 'expo-router';

/** Properties own their stack so a detail screen can push over the list. */
export default function PropertiesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
