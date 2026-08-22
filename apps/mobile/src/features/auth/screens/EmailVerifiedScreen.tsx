import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useSemanticColors } from '../../../theme/colors';
import { useCurrentUser } from '../useCurrentUser';

/**
 * Where the verification email lands. CLAUDE.md §49, §73.
 *
 * The API validates the token and then redirects to `rms://email-verified`,
 * carrying the new session cookie in the URL. `@better-auth/expo` intercepts
 * that deep link and writes the cookie to SecureStore before this screen ever
 * renders — so there is nothing to do here but confirm the session and get out
 * of the way.
 *
 * The route must exist even though it does almost nothing. Without it Expo
 * Router shows "Unmatched Route", which is what a user sees at the single most
 * fragile moment in the whole sign-up flow: they did what the email asked and
 * the app told them the page does not exist.
 */
export function EmailVerifiedScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const { isSignedIn, isLoading, refetch } = useCurrentUser();
  const [hasRefetched, setHasRefetched] = useState(false);
  const colors = useSemanticColors();

  /**
   * Re-reads the session once on arrival.
   *
   * The cookie was stored by the deep-link handler moments ago, which is after
   * the cached `/users/me` result was fetched. Without this the app would sit
   * on a stale "signed out" answer until something else happened to refetch.
   */
  useEffect(() => {
    if (hasRefetched) return;
    setHasRefetched(true);
    refetch();
  }, [hasRefetched, refetch]);

  return (
    <Screen scrollable>
      <View className="flex-1 items-center justify-center gap-4 py-12">
        <View className="bg-success/10 h-20 w-20 items-center justify-center rounded-full">
          <CheckCircle2 size={40} color={colors.success} strokeWidth={1.5} />
        </View>

        <Text variant="display" className="text-center">
          {t('auth:emailVerified.title')}
        </Text>
        <Text variant="body" tone="secondary" className="text-center">
          {t('auth:emailVerified.body')}
        </Text>

        {isSignedIn ? (
          <Button
            label={t('auth:emailVerified.continue')}
            onPress={() => router.replace('/')}
            isBusy={isLoading}
            fullWidth
            className="mt-2"
          />
        ) : (
          <Card className="mt-2 w-full gap-3">
            {/* Verification can be completed on a different device from the one
                holding the session, so being signed out here is normal rather
                than a failure. */}
            <Text variant="bodySm" tone="secondary" className="text-center">
              {t('auth:emailVerified.signInPrompt')}
            </Text>
            <Button
              label={t('auth:signIn.submit')}
              onPress={() => router.replace('/(auth)/sign-in')}
              fullWidth
            />
          </Card>
        )}
      </View>
    </Screen>
  );
}
