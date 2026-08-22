import '../../global.css';

import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { createQueryClient } from '../api/query-client';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useCurrentUser } from '../features/auth/useCurrentUser';
import { i18n, restoreStoredLanguage } from '../i18n';
import { DateFormatProvider } from '../lib/calendar/DateFormatProvider';
import { ThemeProvider } from '../theme/ThemeProvider';

const queryClient = createQueryClient();

/**
 * Held up until both the language and the session are known (see the two
 * `hideAsync` call sites below), so a cold start shows the native splash the
 * whole time instead of a blank frame followed by a spinner. Called at
 * module scope so it runs before this component gets a chance to mount.
 */
void SplashScreen.preventAutoHideAsync();

/**
 * Routes the user to where they belong. CLAUDE.md §28, §31.
 *
 * Three states, checked in order:
 *   signed out          → (auth)
 *   onboarding pending  → (onboarding)
 *   ready               → the app
 *
 * This is UX only. Every protected resource is authorised server-side, so a
 * bug here cannot expose another user's data — it would only show the wrong
 * screen.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isSignedIn, needsOnboarding } = useCurrentUser();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Redirecting before the session is known would bounce a signed-in user to
    // the sign-in screen on every cold start.
    if (isLoading) return;

    const group = segments[0];
    const inAuth = group === '(auth)';
    const inOnboarding = group === '(onboarding)';

    if (!isSignedIn && !inAuth) {
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && needsOnboarding && !inOnboarding) {
      router.replace('/(onboarding)/welcome');
    } else if (isSignedIn && !needsOnboarding && (inAuth || inOnboarding)) {
      router.replace('/');
    }

    // Only once the destination is decided, so the native splash never drops
    // to reveal a route the app is about to navigate away from (§73).
    void SplashScreen.hideAsync();
  }, [isLoading, isSignedIn, needsOnboarding, segments, router]);

  // Nothing renders while this is true — the Stack below never mounts on a
  // default route it will immediately redirect away from, and there is
  // nothing to show anyway: the native splash still fully covers the screen
  // until the effect above hides it.
  if (isLoading) return null;

  return <>{children}</>;
}

export default function RootLayout() {
  const [isLanguageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void restoreStoredLanguage().finally(() => {
      if (!cancelled) setLanguageReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rendering before the stored language is known shows English that visibly
  // flips to Nepali a frame later.
  if (!isLanguageReady) return null;

  return (
    // Outermost, above every provider: a crash inside ThemeProvider or
    // DateFormatProvider must still land on the fallback rather than a blank
    // screen, which is why the boundary reads no context of its own.
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <DateFormatProvider>
                <SafeAreaProvider>
                  <AuthGate>
                    <Stack screenOptions={{ headerShown: false }} />
                  </AuthGate>
                  <StatusBar style="auto" />
                </SafeAreaProvider>
              </DateFormatProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </I18nextProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
