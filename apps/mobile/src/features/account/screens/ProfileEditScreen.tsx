import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { USER_ROLES, type UpdateProfileInput, type UserRole } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { useUpdateProfile } from '../api';

/**
 * Edit the signed-in user's profile. CLAUDE.md §23, §29, §30.
 *
 * Only fields `updateProfileSchema` accepts are shown. Email is displayed but
 * not editable: changing it would change the identity the account is verified
 * against, and the schema deliberately refuses it — rendering a disabled-looking
 * field the server would reject is worse than not offering it (§30).
 *
 * The role IS editable. In Nepal one person commonly rents a flat and sublets
 * rooms within it, so being locked into the choice made during onboarding is a
 * real trap. It drives navigation only — authorization is always by ownership
 * (§31), so changing it grants nothing.
 */
export function ProfileEditScreen() {
  const { t } = useTranslation(['account', 'common']);
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const mutation = useUpdateProfile();

  const profile = user?.profile;

  // Seeded once from the loaded profile. If /users/me is still resolving the
  // fields start empty and fill in when it arrives, rather than the screen
  // refusing to render.
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [primaryRole, setPrimaryRole] = useState<UserRole>(profile?.primaryRole ?? 'HOUSE_OWNER');
  const [district, setDistrict] = useState(profile?.district ?? '');
  const [municipality, setMunicipality] = useState(profile?.municipality ?? '');
  const [ward, setWard] = useState(
    profile?.ward === null || profile?.ward === undefined ? '' : String(profile.ward),
  );
  const [addressLine, setAddressLine] = useState(profile?.addressLine ?? '');

  const [seeded, setSeeded] = useState(profile !== null && profile !== undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Fill the form once the profile arrives, without clobbering an edit already
  // in progress. Adjusting state during render is React's documented pattern
  // for reacting to changed input.
  if (!seeded && profile) {
    setSeeded(true);
    setFullName(profile.fullName);
    setPhone(profile.phone ?? '');
    setPrimaryRole(profile.primaryRole);
    setDistrict(profile.district ?? '');
    setMunicipality(profile.municipality ?? '');
    setWard(profile.ward === null ? '' : String(profile.ward));
    setAddressLine(profile.addressLine ?? '');
  }

  function handleSubmit() {
    setFormError(null);

    if (!fullName.trim()) {
      setFieldErrors({ fullName: t('account:validation.nameRequired') });
      return;
    }
    setFieldErrors({});

    /**
     * Only changed fields are sent.
     *
     * The schema rejects an empty object with "provide at least one field", and
     * sending everything unchanged would rewrite values the user never touched
     * — including clearing an address they had set elsewhere.
     */
    const input: UpdateProfileInput = {
      ...(fullName.trim() !== profile?.fullName ? { fullName: fullName.trim() } : {}),
      ...(phone.trim() && phone.trim() !== profile?.phone ? { phone: phone.trim() } : {}),
      ...(primaryRole !== profile?.primaryRole ? { primaryRole } : {}),
      ...(district.trim() !== (profile?.district ?? '') ? { district: district.trim() } : {}),
      ...(municipality.trim() !== (profile?.municipality ?? '')
        ? { municipality: municipality.trim() }
        : {}),
      ...(ward.trim() !==
      (profile?.ward === null || profile?.ward === undefined ? '' : String(profile.ward))
        ? { ward: Number(ward.trim()) }
        : {}),
      ...(addressLine.trim() !== (profile?.addressLine ?? '')
        ? { addressLine: addressLine.trim() }
        : {}),
    };

    if (Object.keys(input).length === 0) {
      // Nothing to save is not an error — just leave.
      router.back();
      return;
    }

    mutation.mutate(input, {
      onSuccess: () => router.back(),
      onError: (error) => {
        if (error instanceof ApiError) {
          const fields = error.fieldErrors();
          if (Object.keys(fields).length > 0) {
            setFieldErrors(fields);
            setFormError(t('account:validation.fixHighlighted'));
            return;
          }
          if (error.isRetryable) {
            setFormError(t('common:states.errorBody'));
            return;
          }
        }
        setFormError(t('account:errors.saveFailed'));
      },
    });
  }

  return (
    <Screen
      padded={false}
      footer={
        <Button
          label={t('common:actions.save')}
          onPress={handleSubmit}
          isBusy={mutation.isPending}
          disabled={isLoading}
          fullWidth
        />
      }
    >
      <ScreenHeader title={t('account:editProfile')} showBack />

      <ScrollView
        contentContainerClassName="px-5 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Shown, not editable — and the reason is stated rather than left to
            be discovered by a rejected save. */}
        <Card className="gap-1">
          <Text variant="bodySm" tone="secondary">
            {t('account:fields.email')}
          </Text>
          <Text variant="body">{user?.email}</Text>
          <Text variant="caption" tone="secondary">
            {t('account:fields.emailLocked')}
          </Text>
        </Card>

        <Input
          label={t('account:fields.fullName')}
          value={fullName}
          onChangeText={setFullName}
          error={fieldErrors.fullName}
          isRequired
          maxLength={120}
        />

        <Input
          label={t('account:fields.phone')}
          value={phone}
          onChangeText={setPhone}
          error={fieldErrors.phone}
          hint={t('account:fields.phoneHint')}
          keyboardType="phone-pad"
          inputMode="tel"
          prefix="+977"
          maxLength={14}
        />

        <View className="gap-2">
          <Text variant="bodySm" weight="500" tone="secondary">
            {t('account:fields.role')}
          </Text>
          <View className="flex-row gap-2">
            {USER_ROLES.map((role) => (
              <Button
                key={role}
                label={role === 'HOUSE_OWNER' ? t('account:roleOwner') : t('account:roleRenter')}
                size="sm"
                variant={primaryRole === role ? 'primary' : 'secondary'}
                onPress={() => setPrimaryRole(role)}
              />
            ))}
          </View>
          <Text variant="caption" tone="secondary">
            {t('account:fields.roleHint')}
          </Text>
        </View>

        <Input
          label={t('account:fields.district')}
          value={district}
          onChangeText={setDistrict}
          error={fieldErrors.district}
          maxLength={80}
        />
        <Input
          label={t('account:fields.municipality')}
          value={municipality}
          onChangeText={setMunicipality}
          error={fieldErrors.municipality}
          maxLength={120}
        />
        <Input
          label={t('account:fields.ward')}
          value={ward}
          onChangeText={(text) => setWard(text.replace(/\D/g, ''))}
          error={fieldErrors.ward}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
        />
        <Input
          label={t('account:fields.addressLine')}
          value={addressLine}
          onChangeText={setAddressLine}
          error={fieldErrors.addressLine}
          maxLength={200}
        />

        {formError ? (
          <View className="bg-danger/10 rounded-xl p-3" accessibilityLiveRegion="polite">
            <Text variant="bodySm" tone="danger">
              {formError}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
