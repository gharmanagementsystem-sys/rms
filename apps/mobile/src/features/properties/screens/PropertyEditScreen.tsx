import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { UpdatePropertyInput } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { useArchiveProperty, useProperty, useUpdateProperty, type PropertyResponse } from '../api';

/**
 * Edit or archive a property. CLAUDE.md §29, §57.
 *
 * Archiving is not deletion and is not presented as one. The server refuses
 * while active rentals exist and only stamps `archivedAt`, so the accounting
 * history of everyone who ever rented here survives (§34).
 */
export function PropertyEditScreen() {
  const { t } = useTranslation(['properties', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const propertyId = String(id);
  const query = useProperty(propertyId);

  return (
    <Screen padded={false}>
      <ScreenHeader title={t('properties:edit.title')} showBack />
      <QueryStateView query={query}>
        {(property) => <EditForm property={property} propertyId={propertyId} />}
      </QueryStateView>
    </Screen>
  );
}

function EditForm({ property, propertyId }: { property: PropertyResponse; propertyId: string }) {
  const { t } = useTranslation(['properties', 'common']);
  const router = useRouter();
  const update = useUpdateProperty(propertyId);
  const archive = useArchiveProperty(propertyId);

  const [name, setName] = useState(property.name);
  const [district, setDistrict] = useState(property.district ?? '');
  const [municipality, setMunicipality] = useState(property.municipality ?? '');
  const [ward, setWard] = useState(property.ward === null ? '' : String(property.ward));
  const [addressLine, setAddressLine] = useState(property.addressLine ?? '');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isArchived = property.archivedAt !== null;

  function handleSave() {
    setFormError(null);

    if (!name.trim()) {
      setFieldErrors({ name: t('properties:validation.nameRequired') });
      return;
    }
    setFieldErrors({});

    // Only what changed — the schema rejects an empty patch, and resending
    // untouched fields would overwrite values edited elsewhere.
    const input: UpdatePropertyInput = {
      ...(name.trim() !== property.name ? { name: name.trim() } : {}),
      ...(district.trim() !== (property.district ?? '') ? { district: district.trim() } : {}),
      ...(municipality.trim() !== (property.municipality ?? '')
        ? { municipality: municipality.trim() }
        : {}),
      ...(ward.trim() !== (property.ward === null ? '' : String(property.ward))
        ? { ward: Number(ward.trim()) }
        : {}),
      ...(addressLine.trim() !== (property.addressLine ?? '')
        ? { addressLine: addressLine.trim() }
        : {}),
    };

    if (Object.keys(input).length === 0) {
      router.back();
      return;
    }

    update.mutate(input, {
      onSuccess: () => router.back(),
      onError: (error) => {
        if (error instanceof ApiError) {
          const fields = error.fieldErrors();
          if (Object.keys(fields).length > 0) {
            setFieldErrors(fields);
            setFormError(t('properties:validation.fixHighlighted'));
            return;
          }
          if (error.isRetryable) {
            setFormError(t('common:states.errorBody'));
            return;
          }
        }
        setFormError(t('properties:errors.saveFailed'));
      },
    });
  }

  function confirmArchive() {
    Alert.alert(t('properties:archive.confirmTitle'), t('properties:archive.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('properties:archive.action'),
        style: 'destructive',
        onPress: () => {
          setFormError(null);
          archive.mutate(undefined, {
            // Back to the list: the detail screen it came from now shows an
            // archived record, which is not where the user wants to land.
            onSuccess: () => router.replace('/properties'),
            onError: (error) => {
              // The expected refusal: rentals are still running here.
              setFormError(
                error instanceof ApiError && error.status === 409
                  ? error.message
                  : t('properties:errors.archiveFailed'),
              );
            },
          });
        },
      },
    ]);
  }

  return (
    <>
      <ScrollView
        contentContainerClassName="px-5 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {isArchived ? (
          <Card className="gap-1">
            <Text variant="body" weight="600">
              {t('properties:archive.archivedTitle')}
            </Text>
            <Text variant="bodySm" tone="secondary">
              {t('properties:archive.archivedBody')}
            </Text>
          </Card>
        ) : null}

        <Input
          label={t('properties:fields.name')}
          value={name}
          onChangeText={setName}
          error={fieldErrors.name}
          isRequired
          maxLength={120}
        />
        <Input
          label={t('properties:fields.district')}
          value={district}
          onChangeText={setDistrict}
          error={fieldErrors.district}
          maxLength={80}
        />
        <Input
          label={t('properties:fields.municipality')}
          value={municipality}
          onChangeText={setMunicipality}
          error={fieldErrors.municipality}
          maxLength={120}
        />
        <Input
          label={t('properties:fields.ward')}
          value={ward}
          onChangeText={(text) => setWard(text.replace(/\D/g, ''))}
          error={fieldErrors.ward}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
        />
        <Input
          label={t('properties:fields.addressLine')}
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

        {!isArchived ? (
          <Card className="mt-2 gap-2">
            <Text variant="body" weight="600">
              {t('properties:archive.action')}
            </Text>
            {/* Says what archiving actually does, before it is done (§57). */}
            <Text variant="bodySm" tone="secondary">
              {t('properties:archive.explain')}
            </Text>
            <Button
              label={t('properties:archive.action')}
              variant="danger"
              isBusy={archive.isPending}
              onPress={confirmArchive}
              fullWidth
            />
          </Card>
        ) : null}
      </ScrollView>

      <View className="border-border bg-background border-t px-5 pb-2 pt-3">
        <Button
          label={t('common:actions.save')}
          onPress={handleSave}
          isBusy={update.isPending}
          fullWidth
        />
      </View>
    </>
  );
}
