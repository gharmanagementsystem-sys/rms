import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
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
import { GoogleButton } from '../components/GoogleButton';

/** Matches the server's minimum. Kept as a constant so the hint cannot drift. */
const MIN_PASSWORD_LENGTH = 10;

/**
 * Account creation.
 *
 * Sign-up does NOT sign the user in: email verification is required, so the
 * screen switches to a "confirm your email" state rather than navigating on.
 * Pretending they were signed in and then bouncing them at the first request
 * would be worse than saying so plainly.
 */
export function SignUpScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const colors = useSemanticColors();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = t('auth:validation.nameRequired');
    if (!email.trim()) errors.email = t('auth:validation.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = t('auth:validation.emailInvalid');
    }
    if (!password) errors.password = t('auth:validation.passwordRequired');
    else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = t('auth:validation.passwordTooShort');
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;

    const normalisedEmail = email.trim().toLowerCase();
    setBusy(true);
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: normalisedEmail,
        password,
      });

      if (result.error) {
        const failure = toAuthFailure(result.error, t);
        // A breached password comes back against the password field, where the
        // user can act on it, rather than as a detached banner.
        if (failure.key === 'PASSWORD_COMPROMISED' || failure.key === 'PASSWORD_TOO_SHORT') {
          setFieldErrors({ password: failure.message });
        } else {
          setFormError(failure.message);
        }
        return;
      }

      setSentTo(normalisedEmail);
    } catch (error) {
      setFormError(toAuthFailure(error, t).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (!sentTo) return;
    setResent(false);
    try {
      await authClient.sendVerificationEmail({ email: sentTo });
      setResent(true);
    } catch {
      // Rate-limited or offline. The user still has the original email, so a
      // failed resend is not worth an alarming message.
      setResent(true);
    }
  }

  if (sentTo) {
    return (
      <Screen scrollable>
        <Card className="mt-8 items-center gap-3 py-8">
          <MailCheck size={40} color={colors.primary} strokeWidth={1.5} />
          <Text variant="h1" className="text-center">
            {t('auth:signUp.checkEmailTitle')}
          </Text>
          <Text variant="body" tone="secondary" className="text-center">
            {t('auth:signUp.checkEmailBody', { email: sentTo })}
          </Text>

          <Button
            label={t('auth:signUp.resend')}
            variant="ghost"
            onPress={() => void handleResend()}
          />
          {resent ? (
            <Text variant="caption" tone="success" accessibilityLiveRegion="polite">
              {t('auth:signUp.resent')}
            </Text>
          ) : null}
        </Card>

        <Link href="/(auth)/sign-in" asChild>
          <Text
            variant="bodySm"
            tone="accent"
            weight="600"
            className="text-center"
            accessibilityRole="link"
          >
            {t('auth:signUp.signInInstead')}
          </Text>
        </Link>
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <View className="mb-2 mt-6">
        <Text variant="display">{t('auth:signUp.title')}</Text>
        <Text variant="body" tone="secondary" className="mt-1">
          {t('auth:signUp.subtitle')}
        </Text>
      </View>

      <Input
        label={t('auth:fields.name')}
        placeholder={t('auth:fields.namePlaceholder')}
        value={name}
        onChangeText={setName}
        error={fieldErrors.name}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        isRequired
      />

      <Input
        ref={emailRef}
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
        hint={t('auth:fields.passwordHint')}
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
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

      <Button
        label={t('auth:signUp.submit')}
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
          {t('auth:signUp.haveAccount')}
        </Text>
        <Link href="/(auth)/sign-in" asChild>
          <Text variant="bodySm" tone="accent" weight="600" accessibilityRole="link">
            {t('auth:signUp.signInInstead')}
          </Text>
        </Link>
      </View>
    </Screen>
  );
}
