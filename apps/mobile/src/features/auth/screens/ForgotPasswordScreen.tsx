import { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MailCheck } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { authClient } from '../../../lib/auth-client';
import { useSemanticColors } from '../../../theme/colors';
import { toAuthFailure } from '../errors';

/**
 * Password reset request.
 *
 * Always reports success, whether or not the address is registered. Confirming
 * which emails have accounts would turn this screen into an account-enumeration
 * oracle — hence the deliberately conditional wording of the confirmation.
 */
export function ForgotPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const colors = useSemanticColors();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit() {
    setFormError(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setFieldError(t('auth:validation.emailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFieldError(t('auth:validation.emailInvalid'));
      return;
    }
    setFieldError(undefined);

    setBusy(true);
    try {
      await authClient.requestPasswordReset({
        email: trimmed,
        /**
         * Where the emailed link lands after the API validates the token.
         *
         * No `auth/` segment: Expo Router's (auth) folder is a grouping device
         * that never appears in a URL, so app/(auth)/reset-password.tsx is
         * reached at rms://reset-password. Prefixing it produced an
         * "Unmatched Route" screen at the end of the reset flow.
         */
        redirectTo: 'rms://reset-password',
      });
      // Shown regardless of the result, by design.
      setSentTo(trimmed);
    } catch (error) {
      // Only a transport failure is worth reporting — the user can retry that.
      const failure = toAuthFailure(error, t);
      if (failure.key === 'NETWORK' || failure.key === 'RATE_LIMITED') {
        setFormError(failure.message);
      } else {
        setSentTo(trimmed);
      }
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <Screen scrollable>
        <Card className="mt-8 items-center gap-3 py-8">
          <MailCheck size={40} color={colors.primary} strokeWidth={1.5} />
          <Text variant="h1" className="text-center">
            {t('auth:forgotPassword.sentTitle')}
          </Text>
          <Text variant="body" tone="secondary" className="text-center">
            {t('auth:forgotPassword.sentBody', { email: sentTo })}
          </Text>
        </Card>

        <Link href="/(auth)/sign-in" asChild>
          <Text
            variant="bodySm"
            tone="accent"
            weight="600"
            className="text-center"
            accessibilityRole="link"
          >
            {t('auth:forgotPassword.backToSignIn')}
          </Text>
        </Link>
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <View className="mb-2 mt-6">
        <Text variant="display">{t('auth:forgotPassword.title')}</Text>
        <Text variant="body" tone="secondary" className="mt-1">
          {t('auth:forgotPassword.subtitle')}
        </Text>
      </View>

      <Input
        label={t('auth:fields.email')}
        placeholder={t('auth:fields.emailPlaceholder')}
        value={email}
        onChangeText={setEmail}
        error={fieldError}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="go"
        onSubmitEditing={() => void handleSubmit()}
        isRequired
      />

      {formError ? (
        <View className="bg-danger/10 rounded-xl p-3" accessibilityLiveRegion="polite">
          <Text variant="bodySm" tone="danger">
            {formError}
          </Text>
        </View>
      ) : null}

      <Button
        label={t('auth:forgotPassword.submit')}
        onPress={() => void handleSubmit()}
        isBusy={isBusy}
        fullWidth
      />

      <Link href="/(auth)/sign-in" asChild>
        <Text variant="bodySm" tone="accent" className="mt-2 text-center" accessibilityRole="link">
          {t('auth:forgotPassword.backToSignIn')}
        </Text>
      </Link>
    </Screen>
  );
}
