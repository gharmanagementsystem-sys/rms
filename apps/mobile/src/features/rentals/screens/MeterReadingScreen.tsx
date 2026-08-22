import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Money } from '../../../components/ui/Money';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useRecordMeterReading, usePeriods, type PeriodChargeResponse } from '../api';

/**
 * Enter a meter reading. CLAUDE.md §60.
 *
 * Both readings are stored, not just the resulting amount, so a tenant who
 * queries their electricity bill can be shown where the figure came from rather
 * than being asked to take it on trust.
 *
 * The amount shown here is a preview. The server recalculates it and is the
 * authority — the client displaying a figure does not make it true (§54).
 */
export function MeterReadingScreen() {
  const { t } = useTranslation(['rentals', 'dashboard', 'common']);
  const router = useRouter();
  const { id, chargeId } = useLocalSearchParams<{ id: string; chargeId: string }>();
  const rentalId = String(id);
  const targetChargeId = String(chargeId);

  const periods = usePeriods(rentalId);
  const mutation = useRecordMeterReading(rentalId);

  const [previousText, setPreviousText] = useState('');
  const [currentText, setCurrentText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Locate the charge and the period it belongs to, so the screen can name the
  // dates the reading covers rather than showing a bare pair of numbers.
  const found = periods.data?.data
    .flatMap((period) => period.charges.map((charge) => ({ period, charge }) as const))
    .find((entry) => entry.charge.id === targetChargeId);

  const previousFromServer = found?.charge.previousReading;
  const currentFromServer = found?.charge.currentReading;

  // Prefills both readings once the data arrives, without overwriting an edit
  // the user has already made. `currentFromServer` is only set once a reading
  // has already been entered, so this also covers editing a finalized charge —
  // the user sees what was recorded rather than a blank field to retype.
  useEffect(() => {
    if (previousFromServer !== null && previousFromServer !== undefined && previousText === '') {
      setPreviousText(String(previousFromServer));
    }
    if (currentFromServer !== null && currentFromServer !== undefined && currentText === '') {
      setCurrentText(String(currentFromServer));
    }
  }, [previousFromServer, previousText, currentFromServer, currentText]);

  function handleSubmit() {
    setFormError(null);

    const previousReading = Number(previousText);
    const currentReading = Number(currentText);
    const errors: Record<string, string> = {};

    if (previousText.length === 0 || !Number.isInteger(previousReading)) {
      errors.previousReading = t('rentals:validation.readingRequired');
    }
    if (currentText.length === 0 || !Number.isInteger(currentReading)) {
      errors.currentReading = t('rentals:validation.readingRequired');
    }
    if (!errors.previousReading && !errors.currentReading && currentReading < previousReading) {
      // A meter runs forward. A lower current reading is a typo, or a replaced
      // meter — either way it must not silently produce a negative bill.
      errors.currentReading = t('rentals:validation.readingBackwards');
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    mutation.mutate(
      { chargeId: targetChargeId, previousReading, currentReading },
      {
        onSuccess: () => router.back(),
        onError: (error) => {
          if (error instanceof ApiError) {
            const fields = error.fieldErrors();
            if (Object.keys(fields).length > 0) {
              setFieldErrors(fields);
              return;
            }
            if (error.status === 403) {
              setFormError(t('rentals:errors.readingNotAllowed'));
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
  }

  return (
    <Screen
      padded={false}
      footer={
        <Button
          label={t('rentals:reading.submit')}
          onPress={handleSubmit}
          isBusy={mutation.isPending}
          disabled={!found}
          fullWidth
        />
      }
    >
      <ScreenHeader title={t('rentals:reading.title')} showBack />

      <QueryStateView query={periods}>
        {() =>
          found ? (
            <ScrollView
              contentContainerClassName="px-5 pb-6 gap-4"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <ReadingForm
                charge={found.charge}
                periodStart={found.period.periodStart}
                periodEnd={found.period.periodEnd}
                previousText={previousText}
                currentText={currentText}
                onPreviousChange={setPreviousText}
                onCurrentChange={setCurrentText}
                fieldErrors={fieldErrors}
              />

              {formError ? (
                <View className="bg-danger/10 rounded-xl p-3" accessibilityLiveRegion="polite">
                  <Text variant="bodySm" tone="danger">
                    {formError}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <View className="px-5">
              <Card className="items-center gap-2 py-6">
                <Text variant="bodySm" tone="secondary" className="text-center">
                  {t('rentals:reading.notFound')}
                </Text>
              </Card>
            </View>
          )
        }
      </QueryStateView>
    </Screen>
  );
}

function ReadingForm({
  charge,
  periodStart,
  periodEnd,
  previousText,
  currentText,
  onPreviousChange,
  onCurrentChange,
  fieldErrors,
}: {
  charge: PeriodChargeResponse;
  periodStart: string;
  periodEnd: string;
  previousText: string;
  currentText: string;
  onPreviousChange: (text: string) => void;
  onCurrentChange: (text: string) => void;
  fieldErrors: Record<string, string>;
}) {
  const { t } = useTranslation(['rentals', 'dashboard']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();

  const previous = Number(previousText);
  const current = Number(currentText);
  const hasBoth = previousText.length > 0 && currentText.length > 0;
  const consumed = hasBoth && current >= previous ? current - previous : null;

  const rate = charge.ratePaisaPerUnit ?? 0;
  // Integer paisa times a whole unit count — exact, no rounding involved.
  const previewPaisa = consumed === null ? null : consumed * rate;

  return (
    <>
      <Card className="gap-1">
        <Text variant="body" weight="600">
          {charge.label ?? t(`dashboard:charge.${charge.chargeType}`)}
        </Text>
        <Text variant="caption" tone="secondary">
          {formatDate(periodStart, { locale, style: 'short', format })} –{' '}
          {formatDate(periodEnd, { locale, style: 'short', format })}
        </Text>
        <View className="flex-row items-baseline gap-1 pt-1">
          <Money amountPaisa={rate} variant="bodySm" weight="600" />
          <Text variant="caption" tone="secondary">
            {t('rentals:charge.rateHint')}
          </Text>
        </View>
      </Card>

      <Input
        label={t('rentals:reading.previous')}
        value={previousText}
        onChangeText={(text) => onPreviousChange(text.replace(/\D/g, ''))}
        error={fieldErrors.previousReading}
        hint={charge.previousReading === null ? t('rentals:reading.noPreviousHint') : undefined}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={9}
        isRequired
      />

      <Input
        label={t('rentals:reading.current')}
        value={currentText}
        onChangeText={(text) => onCurrentChange(text.replace(/\D/g, ''))}
        error={fieldErrors.currentReading}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={9}
        isRequired
        autoFocus
      />

      {/* The whole calculation, shown as arithmetic rather than a bare total
          (§60, §61). */}
      {consumed !== null && previewPaisa !== null ? (
        <Card className="gap-2">
          <Text variant="bodySm" weight="600">
            {t('rentals:reading.previewTitle')}
          </Text>
          <View className="flex-row items-center justify-between">
            <Text variant="bodySm" tone="secondary">
              {t('rentals:reading.consumed', { units: consumed })}
            </Text>
            <Money amountPaisa={rate} variant="bodySm" />
          </View>
          <View className="border-border flex-row items-center justify-between border-t pt-2">
            <Text variant="bodySm" weight="600">
              {t('rentals:total')}
            </Text>
            <Money amountPaisa={previewPaisa} variant="body" weight="600" />
          </View>
          <Text variant="caption" tone="secondary">
            {t('rentals:reading.previewNote')}
          </Text>
        </Card>
      ) : null}
    </>
  );
}
