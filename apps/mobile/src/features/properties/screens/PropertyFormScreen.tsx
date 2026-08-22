import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useCreateProperty } from '../api';

/**
 * Create a property.
 *
 * Only the name is required. Address parts are optional because §9 warns
 * against asking for what the user can add later — and a landlord adding their
 * first property at speed should not be blocked by a ward number.
 */
export function PropertyFormScreen() {
  const { t } = useTranslation(['properties', 'common']);
  const router = useRouter();
  const mutation = useCreateProperty();

  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [ward, setWard] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit() {
    setFormError(null);

    if (!name.trim()) {
      setFieldErrors({ name: t('properties:validation.nameRequired') });
      return;
    }
    setFieldErrors({});

    mutation.mutate(
      {
        name: name.trim(),
        ...(district.trim() ? { district: district.trim() } : {}),
        ...(municipality.trim() ? { municipality: municipality.trim() } : {}),
        ...(ward.trim() ? { ward: Number(ward.trim()) } : {}),
        ...(addressLine.trim() ? { addressLine: addressLine.trim() } : {}),
      },
      {
        onSuccess: (property) => router.replace(`/properties/${property.id}`),
        onError: (error) => {
          // Field-level messages land on their fields; anything else is a
          // banner. Input is never cleared (§29).
          if (error instanceof ApiError) {
            const fields = error.fieldErrors();
            if (Object.keys(fields).length > 0) {
              setFieldErrors(fields);
              return;
            }
          }
          setFormError(t('properties:errors.saveFailed'));
        },
      },
    );
  }

  return (
    <Screen
      scrollable
      footer={
        <Button
          label={t('properties:add')}
          onPress={handleSubmit}
          isBusy={mutation.isPending}
          disabled={!name.trim()}
          fullWidth
        />
      }
    >
      <View className="mb-1 mt-4">
        <Text variant="display">{t('properties:newTitle')}</Text>
        <Text variant="bodySm" tone="secondary" className="mt-1">
          {t('properties:newSubtitle')}
        </Text>
      </View>

      <Input
        label={t('properties:fields.name')}
        placeholder={t('properties:fields.namePlaceholder')}
        value={name}
        onChangeText={setName}
        error={fieldErrors.name}
        isRequired
        returnKeyType="next"
      />
      <Input
        label={t('properties:fields.district')}
        placeholder={t('properties:fields.districtPlaceholder')}
        value={district}
        onChangeText={setDistrict}
        error={fieldErrors.district}
      />
      <Input
        label={t('properties:fields.municipality')}
        value={municipality}
        onChangeText={setMunicipality}
        error={fieldErrors.municipality}
      />
      <Input
        label={t('properties:fields.ward')}
        value={ward}
        onChangeText={setWard}
        error={fieldErrors.ward}
        keyboardType="number-pad"
        maxLength={3}
      />
      <Input
        label={t('properties:fields.addressLine')}
        placeholder={t('properties:fields.addressPlaceholder')}
        value={addressLine}
        onChangeText={setAddressLine}
        error={fieldErrors.addressLine}
      />

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
