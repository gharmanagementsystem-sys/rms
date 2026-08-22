import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DoorOpen, Pencil } from '../../../components/ui/icons';
import { UNIT_AVAILABILITIES, UNIT_TYPES, type UnitAvailability, type UnitType } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { useSemanticColors } from '../../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import {
  useArchiveUnit,
  useCreateUnit,
  useProperty,
  useUnits,
  useUpdateUnit,
  type UnitResponse,
} from '../api';

/**
 * A property and its units (CLAUDE.md §10, §22).
 *
 * Occupancy shown here is DERIVED by the server from active rentals, so it can
 * never contradict the rentals list.
 */
export function PropertyDetailScreen() {
  const { t } = useTranslation(['properties', 'common']);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const propertyId = String(id);

  const property = useProperty(propertyId);
  const units = useUnits(propertyId);
  const [isAdding, setAdding] = useState(false);
  const colors = useSemanticColors();

  return (
    <Screen padded={false}>
      <ScreenHeader
        title={property.data?.name ?? ''}
        subtitle={
          [property.data?.municipality, property.data?.district].filter(Boolean).join(', ') ||
          undefined
        }
        showBack
        action={
          <Pressable
            onPress={() => router.push(`/properties/${propertyId}/edit`)}
            accessibilityRole="button"
            accessibilityLabel={t('properties:edit.title')}
            hitSlop={12}
            style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
            className="items-end justify-center active:opacity-60"
          >
            <Pencil size={20} color={colors.textSecondary} strokeWidth={1.75} />
          </Pressable>
        }
      />

      <QueryStateView query={units}>
        {(page) => (
          <ScrollView
            contentContainerClassName="px-5 pb-6 gap-3"
            refreshControl={
              <RefreshControl
                refreshing={units.isRefetching}
                onRefresh={() => void units.refetch()}
              />
            }
          >
            <View className="flex-row items-center justify-between">
              <Text variant="h2">{t('properties:units')}</Text>
              <Text variant="caption" tone="secondary">
                {t('properties:unitSummary', {
                  total: page.data.length,
                  occupied: page.data.filter((u) => u.occupancy === 'OCCUPIED').length,
                })}
              </Text>
            </View>

            {page.data.length === 0 ? (
              <Card className="items-center gap-2 py-6">
                <Text variant="h2" className="text-center">
                  {t('properties:noUnitsTitle')}
                </Text>
                <Text variant="bodySm" tone="secondary" className="text-center">
                  {t('properties:noUnitsBody')}
                </Text>
              </Card>
            ) : (
              page.data.map((unit) => <UnitRow key={unit.id} unit={unit} propertyId={propertyId} />)
            )}

            {isAdding ? (
              <AddUnitForm propertyId={propertyId} onDone={() => setAdding(false)} />
            ) : (
              <Button
                label={t('properties:addUnit')}
                variant="secondary"
                onPress={() => setAdding(true)}
                fullWidth
                className="mt-1"
              />
            )}
          </ScrollView>
        )}
      </QueryStateView>
    </Screen>
  );
}

function UnitRow({ unit, propertyId }: { unit: UnitResponse; propertyId: string }) {
  const { t } = useTranslation(['properties', 'common']);
  const colors = useSemanticColors();
  const updateUnit = useUpdateUnit(propertyId);
  const archiveUnit = useArchiveUnit(propertyId);

  const [isExpanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Occupied outranks the stored availability, because a tenant being in place
  // is the fact that matters (§22).
  const stateKey =
    unit.occupancy === 'OCCUPIED'
      ? 'occupied'
      : unit.occupancy === 'AVAILABLE'
        ? 'available'
        : 'unavailable';

  const tone =
    unit.occupancy === 'OCCUPIED'
      ? 'accent'
      : unit.occupancy === 'AVAILABLE'
        ? 'success'
        : 'secondary';

  // A tenant is in place: availability is derived and cannot be overridden by
  // hand, and archiving is refused by the server (§22, §57).
  const isOccupied = unit.occupancy === 'OCCUPIED';

  function setAvailability(availability: UnitAvailability) {
    setError(null);
    updateUnit.mutate(
      { unitId: unit.id, input: { availability } },
      {
        onError: (err) =>
          setError(
            err instanceof ApiError && err.status === 409
              ? err.message
              : t('properties:errors.saveFailed'),
          ),
      },
    );
  }

  function confirmArchive() {
    Alert.alert(t('properties:archiveUnit.confirmTitle'), t('properties:archiveUnit.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('properties:archiveUnit.action'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          archiveUnit.mutate(unit.id, {
            onError: (err) =>
              setError(
                err instanceof ApiError && err.status === 409
                  ? err.message
                  : t('properties:errors.archiveFailed'),
              ),
          });
        },
      },
    ]);
  }

  return (
    <Card className="gap-3">
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`${unit.label}. ${t(`properties:occupancy.${stateKey}`)}`}
        style={{ minHeight: MIN_TOUCH_TARGET }}
        className="flex-row items-center gap-3"
      >
        <View className="bg-surfaceElevated h-10 w-10 items-center justify-center rounded-xl">
          <DoorOpen size={20} color={colors.textSecondary} strokeWidth={1.75} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="body" weight="600">
            {unit.label}
          </Text>
          <Text variant="caption" tone="secondary">
            {t(`properties:unitType.${unit.type}`)}
            {unit.floor ? ` · ${unit.floor}` : ''}
          </Text>
        </View>
        {/* Text, not just colour (§43). */}
        <Text variant="caption" weight="600" tone={tone}>
          {t(`properties:occupancy.${stateKey}`)}
        </Text>
      </Pressable>

      {isExpanded ? (
        <View className="border-border gap-3 border-t pt-3">
          {isOccupied ? (
            <Text variant="caption" tone="secondary">
              {t('properties:unitOccupiedNote')}
            </Text>
          ) : (
            <>
              <View className="gap-2">
                <Text variant="bodySm" weight="500" tone="secondary">
                  {t('properties:fields.availability')}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {UNIT_AVAILABILITIES.map((option) => (
                    <Button
                      key={option}
                      label={t(`properties:availability.${option}`)}
                      size="sm"
                      variant={unit.availability === option ? 'primary' : 'secondary'}
                      disabled={updateUnit.isPending}
                      onPress={() => setAvailability(option)}
                    />
                  ))}
                </View>
              </View>

              <Button
                label={t('properties:archiveUnit.action')}
                size="sm"
                variant="ghost"
                isBusy={archiveUnit.isPending}
                onPress={confirmArchive}
              />
            </>
          )}

          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function AddUnitForm({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const { t } = useTranslation(['properties', 'common']);
  const mutation = useCreateUnit(propertyId);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<UnitType>('ROOM');
  const [error, setError] = useState<string | undefined>();

  function handleSubmit() {
    if (!label.trim()) {
      setError(t('properties:validation.unitLabelRequired'));
      return;
    }
    setError(undefined);
    mutation.mutate(
      { label: label.trim(), type },
      {
        onSuccess: () => {
          setLabel('');
          onDone();
        },
        onError: (err) => {
          setError(
            err instanceof ApiError
              ? (err.fieldErrors().label ?? t('properties:errors.saveFailed'))
              : t('properties:errors.saveFailed'),
          );
        },
      },
    );
  }

  return (
    <Card className="gap-3">
      <Text variant="h2">{t('properties:addUnit')}</Text>
      <Input
        label={t('properties:fields.unitLabel')}
        placeholder={t('properties:fields.unitLabelPlaceholder')}
        value={label}
        onChangeText={setLabel}
        error={error}
        isRequired
        autoFocus
      />
      <View className="gap-2">
        <Text variant="bodySm" weight="500" tone="secondary">
          {t('properties:fields.unitType')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {UNIT_TYPES.map((option) => (
            <Button
              key={option}
              label={t(`properties:unitType.${option}`)}
              size="sm"
              variant={type === option ? 'primary' : 'secondary'}
              onPress={() => setType(option)}
            />
          ))}
        </View>
      </View>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            label={t('common:actions.save')}
            onPress={handleSubmit}
            isBusy={mutation.isPending}
            fullWidth
          />
        </View>
        <View className="flex-1">
          <Button label={t('common:actions.cancel')} variant="ghost" onPress={onDone} fullWidth />
        </View>
      </View>
    </Card>
  );
}
