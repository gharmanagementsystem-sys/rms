import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { MidPeriodEndPolicy, UpdateRentalInput } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { MoneyInput } from '../../../components/ui/MoneyInput';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { paisaToInputText, parseRupeesToPaisa } from '../../../lib/money-input';
import { useRental, useUpdateRental, type RentalResponse } from '../api';

/**
 * Edit a rental's terms. CLAUDE.md §3.3, §14, §29.
 *
 * What is deliberately NOT here: start date and frequency. Both determine the
 * period schedule, and periods that already exist carry their own boundaries
 * and their own charge snapshot. Letting either be edited would either
 * invalidate generated history or silently renumber it — the schema refuses
 * them, and this screen explains why rather than hiding the limitation.
 *
 * Charges are edited on their own screen, because replacing them is a
 * different operation with a different blast radius.
 */
export function RentalEditScreen() {
  const { t } = useTranslation(['rentals', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const rentalId = String(id);
  const query = useRental(rentalId);

  return (
    <Screen padded={false}>
      <ScreenHeader title={t('rentals:edit.title')} showBack />
      <QueryStateView query={query}>
        {(rental) => <EditForm rental={rental} rentalId={rentalId} />}
      </QueryStateView>
    </Screen>
  );
}

function EditForm({ rental, rentalId }: { rental: RentalResponse; rentalId: string }) {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const mutation = useUpdateRental(rentalId);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();

  const [counterpartyName, setCounterpartyName] = useState(rental.counterpartyName ?? '');
  const [counterpartyPhone, setCounterpartyPhone] = useState(rental.counterpartyPhone ?? '');
  const [placeLabel, setPlaceLabel] = useState(rental.placeLabel ?? '');
  const [placeAddress, setPlaceAddress] = useState(rental.placeAddress ?? '');
  const [dueOffsetText, setDueOffsetText] = useState(String(rental.dueOffsetDays));
  const [overdueAfterText, setOverdueAfterText] = useState(String(rental.overdueAfterDays));
  const [midPeriodEndPolicy, setMidPeriodEndPolicy] = useState<MidPeriodEndPolicy>(
    rental.midPeriodEndPolicy,
  );
  const [depositText, setDepositText] = useState(
    rental.securityDepositPaisa ? paisaToInputText(rental.securityDepositPaisa) : '',
  );
  const [notes, setNotes] = useState(rental.notes ?? '');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // The server refuses edits once a rental has ended; saying so up front beats
  // a rejected save.
  const isLocked = rental.status === 'ENDED' || rental.status === 'CANCELLED';
  // A unit-backed rental takes its place from the unit, so the free-text
  // fields would be ignored.
  const hasUnit = rental.unit !== null;

  function handleSave() {
    setFormError(null);
    const errors: Record<string, string> = {};

    const dueOffsetDays = Number(dueOffsetText || '0');
    if (
      !Number.isInteger(dueOffsetDays) ||
      dueOffsetDays < 0 ||
      dueOffsetDays >= rental.periodDays
    ) {
      errors.dueOffsetDays = t('rentals:validation.dueOffsetRange', { days: rental.periodDays });
    }

    const overdueAfterDays = Number(overdueAfterText || '0');
    if (!Number.isInteger(overdueAfterDays) || overdueAfterDays < 0 || overdueAfterDays > 120) {
      errors.overdueAfterDays = t('rentals:validation.overdueRange');
    }

    let securityDepositPaisa: number | undefined;
    if (depositText.trim().length > 0) {
      const parsed = parseRupeesToPaisa(depositText);
      if (!parsed.ok) {
        errors.securityDepositPaisa = t('rentals:validation.amountInvalid');
      } else {
        securityDepositPaisa = parsed.paisa;
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError(t('rentals:validation.fixHighlighted'));
      return;
    }

    const input: UpdateRentalInput = {
      ...(counterpartyName.trim() && counterpartyName.trim() !== (rental.counterpartyName ?? '')
        ? { counterpartyName: counterpartyName.trim() }
        : {}),
      ...(counterpartyPhone.trim() && counterpartyPhone.trim() !== (rental.counterpartyPhone ?? '')
        ? { counterpartyPhone: counterpartyPhone.trim() }
        : {}),
      ...(!hasUnit && placeLabel.trim() && placeLabel.trim() !== (rental.placeLabel ?? '')
        ? { placeLabel: placeLabel.trim() }
        : {}),
      ...(!hasUnit && placeAddress.trim() && placeAddress.trim() !== (rental.placeAddress ?? '')
        ? { placeAddress: placeAddress.trim() }
        : {}),
      ...(dueOffsetDays !== rental.dueOffsetDays ? { dueOffsetDays } : {}),
      ...(overdueAfterDays !== rental.overdueAfterDays ? { overdueAfterDays } : {}),
      ...(midPeriodEndPolicy !== rental.midPeriodEndPolicy ? { midPeriodEndPolicy } : {}),
      ...(securityDepositPaisa !== undefined &&
      securityDepositPaisa !== (rental.securityDepositPaisa ?? undefined)
        ? { securityDepositPaisa }
        : {}),
      ...(notes.trim() !== (rental.notes ?? '') ? { notes: notes.trim() } : {}),
    };

    if (Object.keys(input).length === 0) {
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
            setFormError(t('rentals:validation.fixHighlighted'));
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
    });
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

  return (
    <>
      <ScrollView
        contentContainerClassName="px-5 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* The schedule is fixed once periods exist. Stated, not hidden. */}
        <Card className="gap-1">
          <Text variant="bodySm" weight="600">
            {t('rentals:edit.scheduleFixedTitle')}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('rentals:edit.scheduleFixedBody', {
              date: formatDate(rental.startDate, { locale, format }),
              days: rental.periodDays,
            })}
          </Text>
        </Card>

        <Input
          label={t('rentals:create.counterpartyName')}
          value={counterpartyName}
          onChangeText={setCounterpartyName}
          error={fieldErrors.counterpartyName}
          maxLength={120}
        />
        <Input
          label={t('rentals:create.counterpartyPhone')}
          value={counterpartyPhone}
          onChangeText={setCounterpartyPhone}
          error={fieldErrors.counterpartyPhone}
          keyboardType="phone-pad"
          inputMode="tel"
          prefix="+977"
          maxLength={14}
        />

        {hasUnit ? (
          <Card className="gap-1">
            <Text variant="bodySm" tone="secondary">
              {t('rentals:edit.placeFromUnit')}
            </Text>
            <Text variant="body">{rental.unit?.label}</Text>
          </Card>
        ) : (
          <>
            <Input
              label={t('rentals:create.placeLabel')}
              value={placeLabel}
              onChangeText={setPlaceLabel}
              error={fieldErrors.placeLabel}
              maxLength={120}
            />
            <Input
              label={t('rentals:create.placeAddress')}
              value={placeAddress}
              onChangeText={setPlaceAddress}
              error={fieldErrors.placeAddress}
              maxLength={200}
            />
          </>
        )}

        <MoneyInput
          label={t('rentals:create.deposit')}
          value={depositText}
          onChangeText={setDepositText}
          error={fieldErrors.securityDepositPaisa}
          unitHint={t('rentals:create.depositHint')}
        />

        <Input
          label={t('rentals:create.dueOffset')}
          value={dueOffsetText}
          onChangeText={(text) => setDueOffsetText(text.replace(/\D/g, ''))}
          error={fieldErrors.dueOffsetDays}
          hint={t('rentals:edit.dueOffsetFutureOnly')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
        />
        <Input
          label={t('rentals:create.overdueAfter')}
          value={overdueAfterText}
          onChangeText={(text) => setOverdueAfterText(text.replace(/\D/g, ''))}
          error={fieldErrors.overdueAfterDays}
          hint={t('rentals:create.overdueAfterHint')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
        />

        <SegmentedChoice
          label={t('rentals:create.midPeriodEnd')}
          options={[
            { value: 'PRORATE', label: t('rentals:charge.prorate') },
            { value: 'FULL_PERIOD', label: t('rentals:charge.chargeFull') },
          ]}
          value={midPeriodEndPolicy}
          onChange={setMidPeriodEndPolicy}
        />

        <Input
          label={t('rentals:create.notes')}
          value={notes}
          onChangeText={setNotes}
          error={fieldErrors.notes}
          multiline
          numberOfLines={3}
          maxLength={1000}
        />

        <Button
          label={t('rentals:edit.editCharges')}
          variant="secondary"
          onPress={() => router.push(`/rentals/${rentalId}/charges`)}
          fullWidth
          className="mt-1"
        />

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
