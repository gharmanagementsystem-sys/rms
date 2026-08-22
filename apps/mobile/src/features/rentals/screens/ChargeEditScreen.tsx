import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ChargeType } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Money } from '../../../components/ui/Money';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { paisaToInputText } from '../../../lib/money-input';
import { useRental, useReplaceCharges, type RentalResponse } from '../api';
import {
  OPTIONAL_CHARGE_TYPES,
  buildCharges,
  fixedChargesTotalPaisa,
  hasMeteredCharge,
  initialChargeDrafts,
  type ChargeDraftError,
  type ChargeDrafts,
} from '../charge-draft';
import { ChargeEditor } from '../components/ChargeEditor';

/**
 * Change what a rental is billed for. CLAUDE.md §3.3, §12, §14.
 *
 * The financial rule this screen must not violate, and the reason it warns
 * before saving:
 *
 *   **Editing charges changes FUTURE periods only.**
 *
 * Each period snapshots its charges when it is generated and is never
 * recomputed from the current configuration. If electricity was रु 15/unit in
 * one period and becomes रु 20 today, that period stays priced at 15 — which is
 * exactly what §3.3 requires, and what makes past bills defensible in a
 * dispute. The UI states this plainly so a landlord does not raise the rent
 * expecting last month's invoice to change, or fear that it will.
 */
export function ChargeEditScreen() {
  const { t } = useTranslation(['rentals', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const rentalId = String(id);
  const query = useRental(rentalId);

  return (
    <Screen padded={false}>
      <ScreenHeader title={t('rentals:charges.title')} showBack />
      <QueryStateView query={query}>
        {(rental) => <ChargeForm rental={rental} rentalId={rentalId} />}
      </QueryStateView>
    </Screen>
  );
}

/** Rebuilds the editable draft from what the rental is currently configured with. */
function draftsFromRental(rental: RentalResponse): ChargeDrafts {
  const drafts = initialChargeDrafts();

  // Start from a clean slate: anything not on the rental is off, including
  // electricity, which the create form defaults on.
  for (const type of Object.keys(drafts) as ChargeType[]) {
    drafts[type] = { ...drafts[type], isEnabled: false };
  }

  for (const charge of rental.charges) {
    const existing = drafts[charge.chargeType];
    drafts[charge.chargeType] = {
      ...existing,
      isEnabled: true,
      pricingModel: charge.pricingModel,
      amountText: charge.amountPaisa === null ? '' : paisaToInputText(charge.amountPaisa),
      rateText: charge.ratePaisaPerUnit === null ? '' : paisaToInputText(charge.ratePaisaPerUnit),
      prorationPolicy: charge.prorationPolicy ?? 'PRORATE',
      label: charge.label ?? '',
    };
  }

  // Rent is never optional.
  drafts.RENT = { ...drafts.RENT, isEnabled: true, pricingModel: 'FIXED' };
  return drafts;
}

function ChargeForm({ rental, rentalId }: { rental: RentalResponse; rentalId: string }) {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const mutation = useReplaceCharges(rentalId);

  const [drafts, setDrafts] = useState<ChargeDrafts>(() => draftsFromRental(rental));
  const [chargeErrors, setChargeErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isLocked = rental.status === 'ENDED' || rental.status === 'CANCELLED';

  function chargeErrorText(reason: ChargeDraftError): string {
    return reason === 'MISSING_LABEL'
      ? t('rentals:validation.chargeNameRequired')
      : reason === 'EMPTY'
        ? t('rentals:validation.amountRequired')
        : reason === 'TOO_MANY_DECIMALS'
          ? t('rentals:validation.amountTooPrecise')
          : reason === 'TOO_LARGE'
            ? t('rentals:validation.amountTooLarge')
            : t('rentals:validation.amountInvalid');
  }

  function handleSave() {
    setFormError(null);

    const built = buildCharges(drafts);
    if (!built.ok) {
      const translated: Record<string, string> = {};
      for (const [chargeType, reason] of Object.entries(built.errors)) {
        if (reason) translated[chargeType] = chargeErrorText(reason);
      }
      setChargeErrors(translated);
      setFormError(t('rentals:validation.fixHighlighted'));
      return;
    }
    setChargeErrors({});

    // Confirmed, because this changes what the tenant will be billed (§57).
    Alert.alert(t('rentals:charges.confirmTitle'), t('rentals:charges.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('common:actions.save'),
        onPress: () => {
          mutation.mutate(
            { charges: built.charges },
            {
              onSuccess: () => router.back(),
              onError: (error) => {
                if (error instanceof ApiError) {
                  const fields = error.fieldErrors();
                  if (Object.keys(fields).length > 0) {
                    setFormError(Object.values(fields)[0] ?? t('rentals:errors.saveFailed'));
                    return;
                  }
                  if (error.code === 'RENTAL_ALREADY_ENDED') {
                    setFormError(t('rentals:edit.endedLocked'));
                    return;
                  }
                  if (error.isRetryable) {
                    setFormError(t('common:states.errorBody'));
                    return;
                  }
                }
                setFormError(t('rentals:errors.saveFailed'));
              },
            },
          );
        },
      },
    ]);
  }

  if (isLocked) {
    return (
      <View className="px-5">
        <Card className="items-center gap-2 py-6">
          <Text variant="h2" className="text-center">
            {t('rentals:edit.endedTitle')}
          </Text>
          <Text variant="bodySm" tone="secondary" className="text-center">
            {t('rentals:edit.endedLocked')}
          </Text>
        </Card>
      </View>
    );
  }

  const fixedTotal = fixedChargesTotalPaisa(drafts);

  return (
    <>
      <ScrollView
        contentContainerClassName="px-5 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* The single most important thing on this screen. */}
        <Card className="gap-1">
          <Text variant="body" weight="600">
            {t('rentals:charges.futureOnlyTitle')}
          </Text>
          <Text variant="bodySm" tone="secondary">
            {t('rentals:charges.futureOnlyBody')}
          </Text>
        </Card>

        <ChargeEditor
          chargeType="RENT"
          draft={drafts.RENT}
          onChange={(draft) => setDrafts((current) => ({ ...current, RENT: draft }))}
          error={chargeErrors.RENT}
          isLocked
        />
        {OPTIONAL_CHARGE_TYPES.map((chargeType) => (
          <ChargeEditor
            key={chargeType}
            chargeType={chargeType}
            draft={drafts[chargeType]}
            onChange={(draft) => setDrafts((current) => ({ ...current, [chargeType]: draft }))}
            error={chargeErrors[chargeType]}
          />
        ))}

        <Card className="gap-1">
          <Text variant="bodySm" tone="secondary">
            {t('rentals:create.perPeriodTotal', { days: rental.periodDays })}
          </Text>
          <Money amountPaisa={fixedTotal} variant="h1" />
          {hasMeteredCharge(drafts) ? (
            <Text variant="caption" tone="accent">
              {t('rentals:create.plusMetered')}
            </Text>
          ) : null}
          <Text variant="caption" tone="secondary">
            {t('rentals:create.totalIsPreview')}
          </Text>
        </Card>

        {formError ? (
          <View className="bg-danger/10 rounded-xl p-3" accessibilityLiveRegion="polite">
            <Text variant="bodySm" tone="danger">
              {formError}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View className="border-border bg-background border-t px-5 pb-2 pt-3">
        <Button
          label={t('common:actions.save')}
          onPress={handleSave}
          isBusy={mutation.isPending}
          fullWidth
        />
      </View>
    </>
  );
}
