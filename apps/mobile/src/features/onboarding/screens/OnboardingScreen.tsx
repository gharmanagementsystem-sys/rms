import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Home } from '../../../components/ui/icons';
import {
  DISCOVERY_SOURCES,
  type CompleteOnboardingInput,
  type CurrentUser,
  type DateFormatPreference,
  type DiscoverySource,
  type Language,
  type ThemePreference,
  type UserRole,
} from '@rms/shared';
import { ApiError, api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ChoiceCard } from '../../../components/ui/ChoiceCard';
import { Input } from '../../../components/ui/Input';
import { Screen } from '../../../components/ui/Screen';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { Text } from '../../../components/ui/Text';
import { currentLanguage, setLanguage } from '../../../i18n';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { useTheme } from '../../../theme/ThemeProvider';
import { currentUserKey, useCurrentUser } from '../../auth/useCurrentUser';

/**
 * Onboarding. CLAUDE.md §9.
 *
 * Four short steps rather than one long form, submitted as a single atomic
 * request at the end so the app never has to reason about a half-configured
 * account.
 *
 * **Language is asked first, before anything else.** Asking a Nepali speaker
 * three screens of questions in English and only then offering them their own
 * language is backwards — by the time the choice appears, the damage is done.
 * §9 lists language as the first step for exactly this reason, and every screen
 * after this one is rendered in whatever they pick here.
 *
 * Nothing is asked that the app already knows or can derive later: the name
 * comes prefilled from the account, and there are no unit counts or occupancy
 * figures, because those come from the records the user creates (§9).
 */

/** Ordered. The index of each is what `step` refers to. */
const STEPS = ['language', 'role', 'profile', 'finish'] as const;
const TOTAL_STEPS = STEPS.length;

/** Which step a server-side field error belongs to, so we can jump back to it. */
const FIELD_STEP: Record<string, number> = {
  fullName: 2,
  phone: 2,
  district: 2,
  municipality: 2,
};

export function OnboardingScreen() {
  const { t } = useTranslation(['onboarding', 'common', 'auth']);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { preference, setPreference } = useTheme();
  const { preference: dateFormat, setPreference: setDateFormat } = useDateFormat();
  const colors = useSemanticColors();
  const { user } = useCurrentUser();

  const [step, setStep] = useState(0);
  const [role, setRole] = useState<UserRole | null>(null);

  /**
   * Seeded from the account rather than asked again.
   *
   * The name was already given at sign-up. Presenting an empty box makes the
   * app look like it forgot, so it arrives filled in and the user simply
   * confirms — while staying editable, since a display name and a full legal
   * name are not always the same thing.
   */
  const [fullName, setFullName] = useState('');
  const [nameSeeded, setNameSeeded] = useState(false);

  if (!nameSeeded && user) {
    setNameSeeded(true);
    setFullName(user.profile?.fullName ?? user.name ?? '');
  }

  const [phone, setPhone] = useState('');
  const [district, setDistrict] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [discoverySource, setDiscoverySource] = useState<DiscoverySource | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: CompleteOnboardingInput) =>
      api.post<CurrentUser>('/api/v1/users/me/onboarding', input),
    onSuccess: (completed) => {
      // Seed the cache so the router's gate sees the completed state without a
      // refetch, avoiding a flash of the onboarding screen.
      queryClient.setQueryData(currentUserKey, completed);
      router.replace('/');
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors();
        if (Object.keys(fields).length > 0) {
          setFieldErrors(fields);
          // Land on the step that actually owns the first bad field, rather
          // than a hardcoded one that may not contain it.
          const firstField = Object.keys(fields)[0];
          setStep(FIELD_STEP[firstField ?? ''] ?? 2);
          return;
        }
        if (error.status === 409) {
          setFieldErrors({ phone: t('onboarding:errors.phoneTaken') });
          setStep(2);
          return;
        }
        if (error.isRetryable) {
          setFormError(t('common:states.errorBody'));
          return;
        }
      }
      setFormError(t('onboarding:errors.saveFailed'));
    },
  });

  function canContinue(): boolean {
    if (step === 1) return role !== null;
    if (step === 2) return fullName.trim().length > 0;
    return true;
  }

  function handleNext() {
    setFormError(null);

    if (step === 2 && !fullName.trim()) {
      setFieldErrors({ fullName: t('auth:validation.nameRequired') });
      return;
    }
    setFieldErrors({});

    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
      return;
    }

    if (!role) {
      setStep(1);
      return;
    }

    mutation.mutate({
      fullName: fullName.trim(),
      primaryRole: role,
      language: currentLanguage(),
      theme: preference,
      dateFormat,
      notificationsEnabled,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(district.trim() ? { district: district.trim() } : {}),
      ...(municipality.trim() ? { municipality: municipality.trim() } : {}),
      ...(discoverySource ? { discoverySource } : {}),
    });
  }

  return (
    <Screen
      scrollable
      footer={
        <View className="gap-2">
          <Button
            label={step === TOTAL_STEPS - 1 ? t('onboarding:finish') : t('onboarding:next')}
            onPress={handleNext}
            isBusy={mutation.isPending}
            disabled={!canContinue()}
            fullWidth
          />
          {step > 0 ? (
            <Button
              label={t('onboarding:back')}
              variant="ghost"
              onPress={() => setStep(step - 1)}
              fullWidth
            />
          ) : null}
        </View>
      }
    >
      {/* Progress is stated in words as well as shown, so it is announced. */}
      <View className="mt-4 gap-2">
        <Text variant="caption" tone="secondary">
          {t('onboarding:progress', { current: step + 1, total: TOTAL_STEPS })}
        </Text>
        <View className="bg-surfaceElevated h-1 flex-row overflow-hidden rounded-full">
          <View
            className="bg-primary h-full rounded-full"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </View>
      </View>

      {/* ---- 0. Language and appearance, before anything is asked in words -- */}
      {step === 0 ? (
        <View className="gap-5">
          <Header
            title={t('onboarding:language.title')}
            subtitle={t('onboarding:language.subtitle')}
          />

          <SegmentedChoice<Language>
            label={t('common:settings.language')}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ne', label: 'नेपाली' },
            ]}
            value={currentLanguage()}
            onChange={(language) => void setLanguage(language)}
          />

          <SegmentedChoice<ThemePreference>
            label={t('common:settings.theme')}
            options={[
              { value: 'light', label: t('common:settings.themeLight') },
              { value: 'dark', label: t('common:settings.themeDark') },
              { value: 'system', label: t('common:settings.themeSystem') },
            ]}
            value={preference}
            onChange={setPreference}
          />

          <SegmentedChoice<DateFormatPreference>
            label={t('common:settings.dateFormat')}
            options={[
              { value: 'BS', label: t('common:settings.dateFormatBs') },
              { value: 'AD', label: t('common:settings.dateFormatAd') },
            ]}
            value={dateFormat}
            onChange={setDateFormat}
          />
        </View>
      ) : null}

      {/* ---- 1. Role ------------------------------------------------------- */}
      {step === 1 ? (
        <View className="gap-3">
          <Header title={t('onboarding:role.title')} subtitle={t('onboarding:role.subtitle')} />
          <ChoiceCard
            label={t('onboarding:role.owner')}
            hint={t('onboarding:role.ownerHint')}
            icon={<Building2 size={24} color={colors.primary} strokeWidth={1.75} />}
            isSelected={role === 'HOUSE_OWNER'}
            onPress={() => setRole('HOUSE_OWNER')}
          />
          <ChoiceCard
            label={t('onboarding:role.renter')}
            hint={t('onboarding:role.renterHint')}
            icon={<Home size={24} color={colors.primary} strokeWidth={1.75} />}
            isSelected={role === 'RENTER'}
            onPress={() => setRole('RENTER')}
          />
        </View>
      ) : null}

      {/* ---- 2. Profile ---------------------------------------------------- */}
      {step === 2 ? (
        <View className="gap-4">
          <Header
            title={t('onboarding:profile.title')}
            subtitle={t('onboarding:profile.subtitle')}
          />
          <Input
            label={t('auth:fields.name')}
            placeholder={t('auth:fields.namePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            error={fieldErrors.fullName}
            autoComplete="name"
            isRequired
          />
          <Input
            label={t('onboarding:profile.phone')}
            placeholder="9801234567"
            hint={t('onboarding:profile.phoneHint')}
            value={phone}
            onChangeText={setPhone}
            error={fieldErrors.phone}
            keyboardType="phone-pad"
            inputMode="tel"
            autoComplete="tel"
            maxLength={14}
          />
          <Input
            label={t('onboarding:profile.district')}
            placeholder={t('onboarding:profile.districtPlaceholder')}
            value={district}
            onChangeText={setDistrict}
            error={fieldErrors.district}
          />
          <Input
            label={t('onboarding:profile.municipality')}
            value={municipality}
            onChangeText={setMunicipality}
            error={fieldErrors.municipality}
          />
        </View>
      ) : null}

      {/* ---- 3. Notifications and discovery -------------------------------- */}
      {step === 3 ? (
        <View className="gap-4">
          <Header
            title={t('onboarding:preferences.title')}
            subtitle={t('onboarding:preferences.subtitle')}
          />

          <ChoiceCard
            label={t('onboarding:preferences.notifications')}
            hint={t('onboarding:preferences.notificationsHint')}
            isSelected={notificationsEnabled}
            onPress={() => setNotificationsEnabled((value) => !value)}
          />

          <View className="gap-2">
            <Text variant="bodySm" weight="500" tone="secondary">
              {t('onboarding:preferences.discovery')}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {DISCOVERY_SOURCES.map((source) => (
                <Button
                  key={source}
                  label={t(`onboarding:discovery.${source}`)}
                  size="sm"
                  variant={discoverySource === source ? 'primary' : 'secondary'}
                  onPress={() =>
                    setDiscoverySource((current) => (current === source ? null : source))
                  }
                />
              ))}
            </View>
            <Text variant="caption" tone="secondary">
              {t('onboarding:preferences.discoveryOptional')}
            </Text>
          </View>
        </View>
      ) : null}

      {formError ? (
        <View className="bg-danger/10 rounded-xl p-3" accessibilityLiveRegion="polite">
          <Text variant="bodySm" tone="danger">
            {formError}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View className="mt-2 gap-1">
      <Text variant="display">{title}</Text>
      <Text variant="bodySm" tone="secondary">
        {subtitle}
      </Text>
    </View>
  );
}
