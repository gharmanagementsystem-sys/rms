import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldAlert } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { authClient } from '../../../lib/auth-client';
import { useSemanticColors } from '../../../theme/colors';
import { toAuthFailure } from '../errors';

/** Matches `minPasswordLength` in the server's Better Auth config. */
const MIN_PASSWORD_LENGTH = 10;

/**
 * Choose a new password, after the emailed link has been validated.
 *
 * The API checks the single-use token and redirects here with it attached, so
 * arriving at this screen means the token was good a moment ago. It is still
 * sent with the change — this screen never becomes the thing that authorises
 * the reset (§30).
 *
 * Completing a reset destroys every other session server-side, which is why the
 * user is sent back to sign in rather than dropped into the app.
 */
export function ResetPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const confirmRef = useRef<TextInput>(null);
  const colors = useSemanticColors();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  const token = typeof params.token === 'string' ? params.token : null;

  /**
   * An expired or already-used link.
   *
   * Better Auth redirects here with `?error=...` rather than a token when the
   * link is no longer valid. Saying so plainly beats presenting a form that
   * cannot possibly succeed.
   */
  if (!token) {
    return (
      <Screen scrollable>
        <Card className="mt-8 items-center gap-3 py-8">
          <ShieldAlert size={40} color={colors.danger} strokeWidth={1.5} />
          <Text variant="h1" className="text-center">
            {t('auth:resetPassword.invalidTitle')}
          </Text>
          <Text variant="body" tone="secondary" className="text-center">
            {t('auth:resetPassword.invalidBody')}
          </Text>
          <Button
            label={t('auth:forgotPassword.title')}
            onPress={() => router.replace('/(auth)/forgot-password')}
            fullWidth
            className="mt-2"
          />
        </Card>
      </Screen>
    );
  }

  async function handleSubmit() {
    setFormError(null);
    const errors: Record<string, string> = {};

    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = t('auth:validation.passwordTooShort', { count: MIN_PASSWORD_LENGTH });
    }
    // Checked before sending: a typo here would lock the user out of the
    // account they are in the middle of recovering.
    if (confirm !== password) {
      errors.confirm = t('auth:validation.passwordsDoNotMatch');
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token: token! });

      if (result.error) {
        setFormError(toAuthFailure(result.error, t).message);
        return;
      }

      // Every session was just revoked, so signing in again is the only way
      // forward — and it confirms the new password works.
      router.replace('/(auth)/sign-in?reset=1');
    } catch (error) {
      setFormError(toAuthFailure(error, t).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      scrollable
      footer={
        <Button
          label={t('auth:resetPassword.submit')}
          onPress={() => void handleSubmit()}
          isBusy={isBusy}
          disabled={!password || !confirm}
          fullWidth
        />
      }
    >
      <View className="mb-1 mt-6 items-center gap-2">
        <View className="bg-primary/10 h-16 w-16 items-center justify-center rounded-full">
          <KeyRound size={30} color={colors.primary} strokeWidth={1.5} />
        </View>
        <Text variant="display" className="text-center">
          {t('auth:resetPassword.title')}
        </Text>
        <Text variant="bodySm" tone="secondary" className="text-center">
          {t('auth:resetPassword.subtitle')}
        </Text>
      </View>

      <Input
        label={t('auth:resetPassword.newPassword')}
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        hint={t('auth:validation.passwordTooShort', { count: MIN_PASSWORD_LENGTH })}
        isPassword
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        isRequired
        autoFocus
      />

      <Input
        ref={confirmRef}
        label={t('auth:resetPassword.confirmPassword')}
        value={confirm}
        onChangeText={setConfirm}
        error={fieldErrors.confirm}
        isPassword
        autoComplete="new-password"
        textContentType="newPassword"
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

      {/* Sets the expectation before it happens, so being asked to sign in
          again does not read as the reset having failed. */}
      <Text variant="caption" tone="secondary" className="text-center">
        {t('auth:resetPassword.sessionsNote')}
      </Text>
    </Screen>
  );
}
