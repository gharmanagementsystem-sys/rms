import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  type PaymentMethod,
  type PaymentPurpose,
  type RecordPaymentInput,
} from '@rms/shared';
import { ApiError } from '../../../api/client';
import { BsDateField } from '../../../components/ui/BsDateField';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Money } from '../../../components/ui/Money';
import { MoneyInput } from '../../../components/ui/MoneyInput';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { todayAd } from '../../../lib/calendar';
import { newIdempotencyKey } from '../../../lib/idempotency';
import { parseRupeesToPaisa } from '../../../lib/money-input';
import { useRecordPayment, useRentalSummary } from '../api';

/**
 * Record a payment. CLAUDE.md §15, §37, §55.
 *
 * Recording, not processing — no money moves through the app. This writes a
 * financial event, and the server decides where it lands: allocation is oldest
 * period first, and any surplus becomes rental credit rather than being
 * discarded. The client deliberately cannot choose a period (§54).
 *
 * Either party may record a payment, so this screen is not owner-only.
 */
export function RecordPaymentScreen() {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rentalId = String(id);

  const summary = useRentalSummary(rentalId);
  const mutation = useRecordPayment(rentalId);

  const [amountText, setAmountText] = useState('');
  const [purpose, setPurpose] = useState<PaymentPurpose>('RENT');
  const [paidOn, setPaidOn] = useState(() => todayAd());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * The idempotency key, and why it is derived rather than fixed.
   *
   * A key that never changed would be safe against a double tap but wrong after
   * an edit: the server deduplicates on the key alone, so resubmitting a
   * corrected amount under the old key would silently replay the ORIGINAL
   * payment and quietly discard the correction.
   *
   * Deriving it from the fields that define the payment gives both properties —
   * tapping twice without changing anything reuses the key and is deduplicated,
   * while changing the amount produces a genuinely different payment (§37).
   */
  const idempotencyKey = useMemo(
    () => newIdempotencyKey(),
    [amountText, purpose, paidOn, method, reference],
  );

  const parsedAmount = parseRupeesToPaisa(amountText);
  const outstanding = summary.data?.outstandingPaisa ?? 0;
  const willOverpay = purpose === 'RENT' && parsedAmount.ok && parsedAmount.paisa > outstanding;

  function handleSubmit() {
    setFormError(null);

    if (!parsedAmount.ok) {
      setFieldErrors({
        amountPaisa:
          parsedAmount.reason === 'EMPTY'
            ? t('rentals:validation.amountRequired')
            : parsedAmount.reason === 'TOO_MANY_DECIMALS'
              ? t('rentals:validation.amountTooPrecise')
              : parsedAmount.reason === 'TOO_LARGE'
                ? t('rentals:validation.amountTooLarge')
                : t('rentals:validation.amountInvalid'),
      });
      return;
    }
    if (parsedAmount.paisa === 0) {
      setFieldErrors({ amountPaisa: t('rentals:validation.amountPositive') });
      return;
    }
    setFieldErrors({});

    const input: RecordPaymentInput = {
      purpose,
      amountPaisa: parsedAmount.paisa,
      paidOn,
      method,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      idempotencyKey,
    };

    mutation.mutate(input, {
      // A replayed request is a success, not an error — the payment exists
      // either way, which is exactly what idempotency is for.
      onSuccess: () => router.back(),
      onError: (error) => {
        if (error instanceof ApiError) {
          const fields = error.fieldErrors();
          if (Object.keys(fields).length > 0) {
            setFieldErrors(fields);
            return;
          }
          if (error.code === 'RENTAL_NOT_ACTIVE') {
            setFormError(t('rentals:errors.notActive'));
            return;
          }
          if (error.isRetryable) {
            // Safe to say: the key is stable, so retrying cannot double-post.
            setFormError(t('rentals:errors.paymentRetryable'));
            return;
          }
        }
        setFormError(t('rentals:errors.paymentFailed'));
      },
    });
  }

  return (
    <Screen
      padded={false}
      footer={
        <Button
          label={t('rentals:payment.submit')}
          onPress={handleSubmit}
          isBusy={mutation.isPending}
          fullWidth
        />
      }
    >
      <ScreenHeader title={t('rentals:payment.title')} showBack />

      <ScrollView
        contentContainerClassName="px-5 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {summary.data ? (
          <Card className="gap-1">
            <Text variant="bodySm" tone="secondary">
              {t('rentals:outstanding')}
            </Text>
            <Money
              amountPaisa={summary.data.outstandingPaisa}
              variant="h1"
              emphasis={summary.data.outstandingPaisa > 0 ? 'owed' : 'settled'}
            />
            {summary.data.creditPaisa > 0 ? (
              <Text variant="caption" tone="success">
                {t('rentals:payment.existingCredit')}
              </Text>
            ) : null}
          </Card>
        ) : null}

        <MoneyInput
          label={t('rentals:payment.amount')}
          value={amountText}
          onChangeText={setAmountText}
          error={fieldErrors.amountPaisa}
          isRequired
          autoFocus
        />

        {/* Overpayment is allowed and becomes credit — but the user should know
            that before they tap, not discover it afterwards (§73). */}
        {willOverpay ? (
          <View className="bg-primary/10 rounded-xl p-3">
            <Text variant="bodySm" tone="accent">
              {t('rentals:payment.overpayNote')}
            </Text>
          </View>
        ) : null}

        <View className="gap-2">
          <Text variant="bodySm" weight="500" tone="secondary">
            {t('rentals:payment.purpose')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {PAYMENT_PURPOSES.map((option) => (
              <Button
                key={option}
                label={t(`rentals:purpose.${option}`)}
                size="sm"
                variant={purpose === option ? 'primary' : 'secondary'}
                onPress={() => setPurpose(option)}
              />
            ))}
          </View>
          {/* Stated plainly, because conflating the two is what causes disputes. */}
          <Text variant="caption" tone="secondary">
            {purpose === 'RENT' ? t('rentals:payment.rentNote') : t('rentals:payment.depositNote')}
          </Text>
        </View>

        <BsDateField
          label={t('rentals:payment.paidOn')}
          value={paidOn}
          onChange={setPaidOn}
          error={fieldErrors.paidOn}
          isRequired
        />

        <View className="gap-2">
          <Text variant="bodySm" weight="500" tone="secondary">
            {t('rentals:payment.method')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {PAYMENT_METHODS.map((option) => (
              <Button
                key={option}
                label={t(`rentals:method.${option}`)}
                size="sm"
                variant={method === option ? 'primary' : 'secondary'}
                onPress={() => setMethod(option)}
              />
            ))}
          </View>
        </View>

        <Input
          label={t('rentals:payment.reference')}
          placeholder={t('rentals:payment.referencePlaceholder')}
          value={reference}
          onChangeText={setReference}
          error={fieldErrors.reference}
          hint={t('rentals:payment.referenceHint')}
          maxLength={120}
        />

        <Input
          label={t('rentals:payment.note')}
          value={note}
          onChangeText={setNote}
          error={fieldErrors.note}
          multiline
          numberOfLines={2}
          maxLength={500}
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
