import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Check } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Text } from '../../../components/ui/Text';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { useProperties, useUnits } from '../../properties/api';

/**
 * Choose which unit a rental is for. CLAUDE.md §10, §22.
 *
 * Two steps rather than one long list, because a landlord with four buildings
 * would otherwise scroll through forty rooms to find one (§3.1).
 *
 * A unit that already has an active tenant is shown but not selectable. Hiding
 * it would leave the landlord wondering where the room went; the server would
 * reject it anyway with UNIT_ALREADY_OCCUPIED, and finding that out after
 * filling in the whole form is worse than being told here.
 */
export interface UnitPickerProps {
  selectedUnitId: string | null;
  onSelect: (unitId: string | null) => void;
  error?: string | undefined;
}

export function UnitPicker({ selectedUnitId, onSelect, error }: UnitPickerProps) {
  const { t } = useTranslation(['rentals', 'properties']);
  const router = useRouter();

  const properties = useProperties();
  const [propertyId, setPropertyId] = useState<string | null>(null);

  // Preselect when there is only one property — asking someone to choose from a
  // list of one is a tap that teaches nothing.
  const onlyPropertyId =
    properties.data?.data.length === 1 ? (properties.data.data[0]?.id ?? null) : null;
  useEffect(() => {
    if (propertyId === null && onlyPropertyId !== null) setPropertyId(onlyPropertyId);
  }, [onlyPropertyId, propertyId]);

  const units = useUnits(propertyId ?? '');

  if (properties.isPending) {
    return (
      <Card className="items-center py-6">
        <ActivityIndicator />
      </Card>
    );
  }

  if ((properties.data?.data.length ?? 0) === 0) {
    return (
      <Card className="gap-2">
        <Text variant="body" weight="600">
          {t('rentals:picker.noPropertiesTitle')}
        </Text>
        <Text variant="bodySm" tone="secondary">
          {t('rentals:picker.noPropertiesBody')}
        </Text>
        <Button
          label={t('properties:add')}
          variant="secondary"
          onPress={() => router.push('/properties/new')}
          fullWidth
        />
      </Card>
    );
  }

  return (
    <View className="gap-3">
      <View className="gap-2">
        <Text variant="bodySm" weight="500" tone="secondary">
          {t('rentals:picker.property')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {properties.data?.data.map((property) => (
            <Button
              key={property.id}
              label={property.name}
              size="sm"
              variant={propertyId === property.id ? 'primary' : 'secondary'}
              onPress={() => {
                setPropertyId(property.id);
                // The previous selection belonged to another building.
                onSelect(null);
              }}
            />
          ))}
        </View>
      </View>

      {propertyId === null ? null : units.isPending ? (
        <Card className="items-center py-6">
          <ActivityIndicator />
        </Card>
      ) : (units.data?.data.length ?? 0) === 0 ? (
        <Card className="gap-2">
          <Text variant="bodySm" tone="secondary">
            {t('rentals:picker.noUnits')}
          </Text>
          <Button
            label={t('properties:addUnit')}
            variant="secondary"
            onPress={() => router.push(`/properties/${propertyId}`)}
            fullWidth
          />
        </Card>
      ) : (
        <View className="gap-2">
          <Text variant="bodySm" weight="500" tone="secondary">
            {t('rentals:picker.unit')}
          </Text>
          {units.data?.data.map((unit) => {
            const isTaken = unit.occupancy === 'OCCUPIED';
            const isSelected = unit.id === selectedUnitId;

            return (
              <Pressable
                key={unit.id}
                onPress={() => onSelect(isSelected ? null : unit.id)}
                disabled={isTaken}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: isTaken }}
                accessibilityLabel={
                  isTaken ? `${unit.label}. ${t('rentals:picker.alreadyRented')}` : unit.label
                }
                style={{ minHeight: MIN_TOUCH_TARGET, opacity: isTaken ? 0.5 : 1 }}
                className={`flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border bg-surface'
                }`}
              >
                <View className="flex-1 gap-0.5">
                  <Text variant="body" weight={isSelected ? '600' : '400'}>
                    {unit.label}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {t(`properties:unitType.${unit.type}`)}
                    {isTaken ? ` · ${t('rentals:picker.alreadyRented')}` : ''}
                  </Text>
                </View>

                <View
                  className={`h-6 w-6 items-center justify-center rounded-full border ${
                    isSelected ? 'border-primary bg-primary' : 'border-border'
                  }`}
                >
                  {isSelected ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
