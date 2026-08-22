import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  RENT_FREQUENCIES,
  periodDaysFor,
  type CreateRentalInput,
  type MidPeriodEndPolicy,
  type RentFrequency,
} from '@rms/shared';
import { ApiError } from '../../../api/client';
import { BsDateField } from '../../../components/ui/BsDateField';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Money } from '../../../components/ui/Money';
import { MoneyInput } from '../../../components/ui/MoneyInput';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { todayAd } from '../../../lib/calendar';
import { parseRupeesToPaisa, paisaToInputText } from '../../../lib/money-input';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { useCreateRental, useRental, type RentalResponse } from '../api';
import {
  OPTIONAL_CHARGE_TYPES,
  buildCharges,
  chargeDraftsFromResponse,
  fixedChargesTotalPaisa,
  hasMeteredCharge,
  initialChargeDrafts,
  type ChargeDraftError,
  type ChargeDrafts,
} from '../charge-draft';
import { ChargeEditor } from '../components/ChargeEditor';
import { UnitPicker } from '../components/UnitPicker';

/**
 * Create a rental agreement, or a duplicate of an existing one. CLAUDE.md
 * §11, §12, §29, §53.
 *
 * The rental is created as a DRAFT and is NOT started automatically. Starting
 * it is a separate action on the rental's own screen, for two reasons:
 *
 *  • The server treats activation as its own step so the "one active rental per
 *    unit" check happens at a defined moment. Chaining the two calls here would
 *    mean a failed activation left a rental created but not started, with the
 *    reason lost on a screen the user had already navigated away from.
 *  • Starting a rental begins generating billing periods. A review step before
 *    money starts accruing is worth one tap (§57).
 *
 * Client-side validation here is a convenience only. The server revalidates
 * every field and is the sole authority on what is accepted (§30, §54).
 *
 * `?duplicateFrom=<rentalId>` pre-fills the form from an existing rental's
 * terms — the case this exists for is a landlord setting up ten near-identical
 * rooms, who should not have to re-type the same frequency, charges, and
 * policies ten times. It is purely a client-side convenience: submitting still
 * goes through the exact same `POST /rentals` as a blank form, so there is no
 * separate "duplicate" concept on the server to keep in sync.
 */
export function RentalFormScreen() {
  const { duplicateFrom } = useLocalSearchParams<{ duplicateFrom?: string }>();

  if (!duplicateFrom) return <RentalForm source={null} />;
  return <DuplicateSourceGate sourceId={duplicateFrom} />;
}

/**
 * Loads the rental being duplicated before the form can seed its state from
 * it. Split out from `RentalForm` because a `useState` initializer runs once,
 * at mount — it cannot wait for a query, so this component exists purely to
 * delay mounting `RentalForm` until the source data is actually in hand.
 */
function DuplicateSourceGate({ sourceId }: { sourceId: string }) {
  const source = useRental(sourceId);
  return (
    <QueryStateView query={source}>{(rental) => <RentalForm source={rental} />}</QueryStateView>
  );
}

function RentalForm({ source }: { source: RentalResponse | null }) {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const { user } = useCurrentUser();
  const mutation = useCreateRental();

  const [side, setSide] = useState<'OWNER' | 'RENTER'>(() => {
    if (source) return source.ownerUserId !== null ? 'OWNER' : 'RENTER';
    return user?.profile?.primaryRole === 'RENTER' ? 'RENTER' : 'OWNER';
  });

  // Unit, place and counterparty are deliberately NOT copied when duplicating
  // — each of the ten rooms needs its own unit and its own tenant, which is
  // the entire reason duplication exists rather than just re-submitting the
  // same rental again.
  const [unitId, setUnitId] = useState<string | null>(null);
  const [usePlaceText, setUsePlaceText] = useState(false);
  const [placeLabel, setPlaceLabel] = useState('');
  const [placeAddress, setPlaceAddress] = useState('');

  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyPhone, setCounterpartyPhone] = useState('');

  const [frequency, setFrequency] = useState<RentFrequency>(source?.frequency ?? 'MONTHLY');
  // The start date is also never copied — a duplicate is a new tenancy
  // starting now, not a re-run of whenever the source rental began.
  const [startDate, setStartDate] = useState(() => todayAd());
  const [depositText, setDepositText] = useState(() =>
    source?.securityDepositPaisa != null ? paisaToInputText(source.securityDepositPaisa) : '',
  );

  const [drafts, setDrafts] = useState<ChargeDrafts>(() =>
    source ? chargeDraftsFromResponse(source.charges) : initialChargeDrafts(),
  );

  // Opened by default when duplicating, so the copied due-offset and overdue
  // settings are visible rather than silently carried over (§57).
  const [isAdvancedOpen, setAdvancedOpen] = useState(source !== null);
  /**
   * `null` means "use the server's default" — rent due on the period's last
   * day (pay in arrears), which depends on `periodDays` and so cannot be a
   * fixed initial string the way `overdueAfterText` can. Left unset rather
   * than pre-filled so the field never has to guess before `frequency` is
   * even chosen, and so switching frequency doesn't need to silently
   * overwrite something the user already typed. When duplicating, the source
   * always has a concrete value, so that value is carried over exactly.
   */
  const [dueOffsetText, setDueOffsetText] = useState<string | null>(
    source ? String(source.dueOffsetDays) : null,
  );
  const [overdueAfterText, setOverdueAfterText] = useState(String(source?.overdueAfterDays ?? 5));
  const [midPeriodEndPolicy, setMidPeriodEndPolicy] = useState<MidPeriodEndPolicy>(
    source?.midPeriodEndPolicy ?? 'PRORATE',
  );
  const [notes, setNotes] = useState(source?.notes ?? '');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [chargeErrors, setChargeErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // A free-text place is the only option for a tenant recording their own
  // tenancy — they do not own the building, so there is no unit to pick (§58).
  const isPlaceFreeText = side === 'RENTER' || usePlaceText;
  const periodDays = periodDaysFor(frequency);

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

  function handleSubmit() {
    setFormError(null);
    const nextFieldErrors: Record<string, string> = {};

    if (isPlaceFreeText) {
      if (!placeLabel.trim()) nextFieldErrors.placeLabel = t('rentals:validation.placeRequired');
    } else if (!unitId) {
      nextFieldErrors.unitId = t('rentals:validation.unitRequired');
    }

    const hasCustomDueOffset = dueOffsetText !== null && dueOffsetText !== '';
    // The default (last day of the period) is always in range by
    // construction, so it only needs validating when the user overrode it.
    const dueOffsetDays = hasCustomDueOffset ? Number(dueOffsetText) : periodDays - 1;
    if (
      hasCustomDueOffset &&
      (!Number.isInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays >= periodDays)
    ) {
      nextFieldErrors.dueOffsetDays = t('rentals:validation.dueOffsetRange', { days: periodDays });
    }

    const overdueAfterDays = Number(overdueAfterText || '0');
    if (!Number.isInteger(overdueAfterDays) || overdueAfterDays < 0 || overdueAfterDays > 120) {
      nextFieldErrors.overdueAfterDays = t('rentals:validation.overdueRange');
    }

    let securityDepositPaisa: number | undefined;
    if (depositText.trim().length > 0) {
      const parsed = parseRupeesToPaisa(depositText);
      if (!parsed.ok) {
        nextFieldErrors.securityDepositPaisa = chargeErrorText(parsed.reason);
      } else {
        securityDepositPaisa = parsed.paisa;
      }
    }

    const built = buildCharges(drafts);
    if (!built.ok) {
      const translated: Record<string, string> = {};
      for (const [chargeType, reason] of Object.entries(built.errors)) {
        if (reason) translated[chargeType] = chargeErrorText(reason);
      }
      setChargeErrors(translated);
    } else {
      setChargeErrors({});
    }

    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0 || !built.ok) {
      // Anything invalid is now marked on its own field; nothing typed is lost.
      setFormError(t('rentals:validation.fixHighlighted'));
      return;
    }

    const input: CreateRentalInput = {
      side,
      ...(isPlaceFreeText ? { placeLabel: placeLabel.trim() } : { unitId: unitId as string }),
      ...(isPlaceFreeText && placeAddress.trim() ? { placeAddress: placeAddress.trim() } : {}),
      ...(counterpartyName.trim() ? { counterpartyName: counterpartyName.trim() } : {}),
      ...(counterpartyPhone.trim() ? { counterpartyPhone: counterpartyPhone.trim() } : {}),
      frequency,
      startDate,
      // Omitted rather than always sent: leaving it out lets the server apply
      // its own authoritative default (§54) instead of the client hard-coding
      // one, so a future change to that default needs no client update.
      ...(hasCustomDueOffset ? { dueOffsetDays } : {}),
      overdueAfterDays,
      midPeriodEndPolicy,
      ...(securityDepositPaisa !== undefined ? { securityDepositPaisa } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      charges: built.charges,
    };

    mutation.mutate(input, {
      onSuccess: (rental) => router.replace(`/rentals/${rental.id}`),
      onError: (error) => {
        if (error instanceof ApiError) {
          const fields = error.fieldErrors();
          if (Object.keys(fields).length > 0) {
            setFieldErrors(fields);
            setFormError(t('rentals:validation.fixHighlighted'));
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

  const fixedTotal = fixedChargesTotalPaisa(drafts);

  return (
    <Screen
      padded={false}
      footer={
        <Button
          label={t('rentals:create.submit')}
          onPress={handleSubmit}
          isBusy={mutation.isPending}
          fullWidth
        />
      }
    >
      <ScreenHeader
        title={t(source ? 'rentals:create.duplicateTitle' : 'rentals:create.title')}
        showBack
      />

      <ScrollView
        contentContainerClassName="px-5 pb-6 gap-5"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="bodySm" tone="secondary">
          {t(source ? 'rentals:create.duplicateSubtitle' : 'rentals:create.subtitle')}
        </Text>

        {/* Which side of the agreement. Both are offered regardless of the
            profile role, because subletting a rented flat is common here and
            one person can legitimately be both (§8, §58). */}
        <Section title={t('rentals:create.sideTitle')}>
          <View className="flex-row gap-2">
            <Button
              label={t('rentals:create.sideOwner')}
              size="sm"
              variant={side === 'OWNER' ? 'primary' : 'secondary'}
              onPress={() => setSide('OWNER')}
            />
            <Button
              label={t('rentals:create.sideRenter')}
              size="sm"
              variant={side === 'RENTER' ? 'primary' : 'secondary'}
              onPress={() => setSide('RENTER')}
            />
          </View>
        </Section>

        <Section title={t('rentals:create.placeTitle')}>
          {side === 'OWNER' && !usePlaceText ? (
            <>
              <UnitPicker selectedUnitId={unitId} onSelect={setUnitId} error={fieldErrors.unitId} />
              <Button
                label={t('rentals:create.placeByNameInstead')}
                variant="ghost"
                size="sm"
                onPress={() => {
                  setUsePlaceText(true);
                  setUnitId(null);
                }}
              />
            </>
          ) : (
            <>
              <Input
                label={t('rentals:create.placeLabel')}
                placeholder={t('rentals:create.placePlaceholder')}
                value={placeLabel}
                onChangeText={setPlaceLabel}
                error={fieldErrors.placeLabel}
                isRequired
                maxLength={120}
              />
              <Input
                label={t('rentals:create.placeAddress')}
                value={placeAddress}
                onChangeText={setPlaceAddress}
                error={fieldErrors.placeAddress}
                maxLength={200}
              />
              {side === 'OWNER' ? (
                <Button
                  label={t('rentals:create.pickUnitInstead')}
                  variant="ghost"
                  size="sm"
                  onPress={() => setUsePlaceText(false)}
                />
              ) : null}
            </>
          )}
        </Section>

        <Section
          title={
            side === 'OWNER' ? t('rentals:create.tenantTitle') : t('rentals:create.ownerTitle')
          }
          hint={t('rentals:create.counterpartyHint')}
        >
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
        </Section>

        <Section title={t('rentals:create.termsTitle')}>
          <View className="gap-2">
            <Text variant="bodySm" weight="500" tone="secondary">
              {t('rentals:create.frequency')}
            </Text>
            <View className="flex-row gap-2">
              {RENT_FREQUENCIES.map((option) => (
                <Button
                  key={option}
                  // Labelled in days, because that is literally the rule: a
                  // period is 30 or 365 elapsed days, not a calendar month
                  // (ADR 0001).
                  label={t(`rentals:frequency.${option}`, { days: periodDaysFor(option) })}
                  size="sm"
                  variant={frequency === option ? 'primary' : 'secondary'}
                  onPress={() => setFrequency(option)}
                />
              ))}
            </View>
            <Text variant="caption" tone="secondary">
              {t('rentals:create.frequencyNote', { days: periodDays })}
            </Text>
          </View>

          <BsDateField
            label={t('rentals:create.startDate')}
            value={startDate}
            onChange={setStartDate}
            error={fieldErrors.startDate}
            hint={t('rentals:create.startDateHint', { days: periodDays })}
            isRequired
          />

          <MoneyInput
            label={t('rentals:create.deposit')}
            value={depositText}
            onChangeText={setDepositText}
            error={fieldErrors.securityDepositPaisa}
            unitHint={t('rentals:create.depositHint')}
          />
        </Section>

        <Section title={t('rentals:create.chargesTitle')} hint={t('rentals:create.chargesHint')}>
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
        </Section>

        {/* A running total, clearly labelled as a preview. The server computes
            the authoritative figure for every period (§54, §61). */}
        <Card className="gap-1">
          <Text variant="bodySm" tone="secondary">
            {t('rentals:create.perPeriodTotal', { days: periodDays })}
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

        <Button
          label={
            isAdvancedOpen ? t('rentals:create.hideAdvanced') : t('rentals:create.showAdvanced')
          }
          variant="ghost"
          onPress={() => setAdvancedOpen((open) => !open)}
        />

        {isAdvancedOpen ? (
          <Section title={t('rentals:create.advancedTitle')}>
            <Input
              label={t('rentals:create.dueOffset')}
              value={dueOffsetText ?? String(periodDays - 1)}
              onChangeText={(text) => setDueOffsetText(text.replace(/\D/g, ''))}
              error={fieldErrors.dueOffsetDays}
              hint={t('rentals:create.dueOffsetHint')}
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
              hint={t('rentals:create.midPeriodEndHint')}
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
          </Section>
        ) : null}

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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="gap-0.5">
        <Text variant="h2">{title}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
