import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { authClient } from '../../../lib/auth-client';
import { toAuthFailure } from '../errors';
import { currentUserKey } from '../useCurrentUser';
import { GoogleButton } from '../components/GoogleButton';

/**
 * Email and password sign-in.
 *
 * Errors are rendered from a translated key, never from the server's message —
 * that message is a developer fallback and is not localized (§27, §40).
 */
export function SignInScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const router = useRouter();
  const queryClient = useQueryClient();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = t('auth:validation.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = t('auth:validation.emailInvalid');
    }
    if (!password) errors.password = t('auth:validation.passwordRequired');

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });

      if (result.error) {
        const failure = toAuthFailure(result.error, t);
        setFormError(failure.message);
        return;
      }

      // The session cookie is set; make the router re-evaluate against the
      // server's answer rather than the local token alone.
      await queryClient.invalidateQueries({ queryKey: currentUserKey });
      router.replace('/');
    } catch (error) {
      setFormError(toAuthFailure(error, t).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scrollable>
      <View className="mb-2 mt-6">
        <Text variant="display">{t('auth:signIn.title')}</Text>
        <Text variant="body" tone="secondary" className="mt-1">
          {t('auth:signIn.subtitle')}
        </Text>
      </View>

      <Input
        label={t('auth:fields.email')}
        placeholder={t('auth:fields.emailPlaceholder')}
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        isRequired
      />

      <Input
        ref={passwordRef}
        label={t('auth:fields.password')}
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        isPassword
        autoComplete="current-password"
        textContentType="password"
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

      <Link href="/(auth)/forgot-password" asChild>
        <Text variant="bodySm" tone="accent" className="self-end" accessibilityRole="link">
          {t('auth:signIn.forgotPassword')}
        </Text>
      </Link>

      <Button
        label={t('auth:signIn.submit')}
        onPress={() => void handleSubmit()}
        isBusy={isBusy}
        fullWidth
        className="mt-1"
      />

      <View className="my-1 flex-row items-center gap-3">
        <View className="bg-border h-px flex-1" />
        <Text variant="caption" tone="secondary">
          {t('auth:google.or')}
        </Text>
        <View className="bg-border h-px flex-1" />
      </View>

      <GoogleButton onError={setFormError} />

      <View className="mt-4 flex-row items-center justify-center gap-1">
        <Text variant="bodySm" tone="secondary">
          {t('auth:signIn.noAccount')}
        </Text>
        <Link href="/(auth)/sign-up" asChild>
          <Text variant="bodySm" tone="accent" weight="600" accessibilityRole="link">
            {t('auth:signIn.createAccount')}
          </Text>
        </Link>
      </View>
    </Screen>
  );
}
