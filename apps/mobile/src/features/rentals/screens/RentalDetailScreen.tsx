import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Copy,
  Gauge,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
} from '../../../components/ui/icons';
import { ApiError } from '../../../api/client';
import { BsDateField } from '../../../components/ui/BsDateField';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Money } from '../../../components/ui/Money';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Text } from '../../../components/ui/Text';
import { DueProgressBar } from '../../dashboard/components/DueProgressBar';
import { HeroMoneyCard } from '../../dashboard/components/HeroMoneyCard';
import { currentLanguage } from '../../../i18n';
import { formatDate, todayAd } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { useCurrentUser } from '../../auth/useCurrentUser';
import {
  useActivateRental,
  useDeleteRental,
  useEndRental,
  usePeriods,
  useRental,
  useRentalSummary,
  type PeriodResponse,
  type RentalResponse,
} from '../api';

/**
 * A rental and its billing history (CLAUDE.md §14, §61).
 *
 * Every period shows the charges that produced its total. A user is never given
 * a figure they cannot take apart — that is what makes the accounting
 * trustworthy rather than merely presented.
 */
export function RentalDetailScreen() {
  const { t } = useTranslation(['rentals', 'dashboard', 'common']);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rentalId = String(id);

  const rental = useRental(rentalId);
  const periods = usePeriods(rentalId);
  const summary = useRentalSummary(rentalId);
  const { user } = useCurrentUser();
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();

  const place = rental.data?.unit?.label ?? rental.data?.placeLabel ?? '';

  /**
   * Who may change the agreement's terms.
   *
   * Mirrors the server's rule: the owner manages an owner-recorded rental, and
   * the tenant manages one they recorded themselves (§58). This only decides
   * what to render — every endpoint re-checks independently (§31).
   */
  const managerId = rental.data ? (rental.data.ownerUserId ?? rental.data.renterUserId) : null;
  const canManage = Boolean(user && managerId && managerId === user.id);
  const isActive = rental.data?.status === 'ACTIVE';

  /**
   * The oldest unpaid period, mirroring the "oldest unpaid first" allocation
   * order (§payment.rentNote) — the same period a payment would settle next.
   * `isOverdue` comes straight from the server (§54); only the day count for
   * the progress bar's fill is computed here, which is display-only and never
   * feeds back into a financial figure.
   */
  const duePeriod = (periods.data?.data ?? []).find((period) => period.balancePaisa > 0) ?? null;
  const daysUntilDue = duePeriod ? daysBetweenAd(todayAd(), duePeriod.dueDate) : null;

  // Newest first: the current period is what a user came to see. Memoized so
  // a multi-year tenancy's periods are reversed once per data change rather
  // than on every render (§36) — `periods.isRefetching` alone toggling for
  // the pull-to-refresh spinner used to re-run this over the full list.
  const orderedPeriods = useMemo(() => [...(periods.data?.data ?? [])].reverse(), [periods.data]);

  const onEnterReading = useCallback(
    (chargeId: string) => router.push(`/rentals/${rentalId}/reading?chargeId=${chargeId}`),
    [router, rentalId],
  );

  return (
    <Screen
      padded={false}
      footer={
        isActive ? (
          <Button
            label={t('rentals:payment.record')}
            onPress={() => router.push(`/rentals/${rentalId}/record-payment`)}
            fullWidth
          />
        ) : null
      }
    >
      <ScreenHeader
        title={rental.data?.counterpartyName ?? place}
        subtitle={rental.data?.counterpartyName ? place : undefined}
        showBack
        action={
          <View className="flex-row items-center">
            {canManage && rental.data ? (
              <>
                {/* Duplicating copies configuration only (§53), so it makes
                    sense regardless of this rental's own status. */}
                <Pressable
                  onPress={() => router.push(`/rentals/new?duplicateFrom=${rentalId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={t('rentals:duplicate.action')}
                  hitSlop={12}
                  style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                  className="items-center justify-center active:opacity-60"
                >
                  <Copy size={20} color={colors.textSecondary} strokeWidth={1.75} />
                </Pressable>
                {rental.data.status !== 'ENDED' ? (
                  <Pressable
                    onPress={() => router.push(`/rentals/${rentalId}/edit`)}
                    accessibilityRole="button"
                    accessibilityLabel={t('rentals:edit.title')}
                    hitSlop={12}
                    style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
                    className="items-center justify-center active:opacity-60"
                  >
                    <Pencil size={20} color={colors.textSecondary} strokeWidth={1.75} />
                  </Pressable>
                ) : null}
              </>
            ) : null}
            {/* Reaching this screen directly (e.g. from the dashboard's "My
                rental" tile) pushes onto the rentals tab's stack without ever
                visiting the list, so its own "add rental" affordance never
                appears. A second rental must always be one tap away from
                wherever this feature leaves the user (§73). */}
            <Pressable
              onPress={() => router.push('/rentals/new')}
              accessibilityRole="button"
              accessibilityLabel={t('rentals:create.title')}
              hitSlop={12}
              style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
              className="items-center justify-center active:opacity-60"
            >
              <Plus size={22} color={colors.textSecondary} strokeWidth={1.75} />
            </Pressable>
          </View>
        }
      />

      <QueryStateView query={periods}>
        {() => (
          <FlatList
            className="flex-1"
            contentContainerClassName="px-5 pb-6 gap-3"
            data={orderedPeriods}
            keyExtractor={(period) => period.id}
            renderItem={({ item }) => (
              <PeriodCard period={item} canManage={canManage} onEnterReading={onEnterReading} />
            )}
            refreshControl={
              <RefreshControl
                refreshing={periods.isRefetching}
                onRefresh={() => void periods.refetch()}
              />
            }
            ListHeaderComponent={
              <View className="gap-3">
                {/* A draft has no periods and bills nothing. Saying so, with the
                    action that changes it, is the whole of §73. */}
                {rental.data && rental.data.status === 'DRAFT' ? (
                  <DraftCard rental={rental.data} canManage={canManage} />
                ) : null}

                {/* Same hero treatment as the dashboard (§24, §73): one brand-
                    coloured card leading with the figure, with a progress bar
                    reading down to the due date rather than a bare "N days" —
                    people scan a bar faster than a number. */}
                <HeroMoneyCard
                  icon={Banknote}
                  label={t('rentals:outstanding')}
                  amountPaisa={summary.data?.outstandingPaisa ?? 0}
                  subtitle={
                    <View className="gap-2">
                      {duePeriod && daysUntilDue !== null ? (
                        <DueProgressBar
                          daysUntilDue={daysUntilDue}
                          isOverdue={duePeriod.isOverdue}
                          label={`${
                            daysUntilDue < 0
                              ? t('dashboard:row.daysLate', { count: Math.abs(daysUntilDue) })
                              : daysUntilDue === 0
                                ? t('dashboard:row.dueToday')
                                : t('dashboard:row.dueInDays', { count: daysUntilDue })
                          } · ${formatDate(duePeriod.dueDate, { locale, style: 'short', format })}`}
                          variant="inverse"
                        />
                      ) : (
                        <Text variant="caption" tone="inverse" className="opacity-80">
                          {t('rentals:settledBody')}
                        </Text>
                      )}
                      {rental.data ? (
                        <Text variant="caption" tone="inverse" className="opacity-70">
                          {/* Stated in days, because that is literally the rule (ADR 0001). */}
                          {t('rentals:everyNDays', { count: rental.data.periodDays })} ·{' '}
                          {t('rentals:since', {
                            date: formatDate(rental.data.startDate, {
                              locale,
                              style: 'short',
                              format,
                            }),
                          })}
                        </Text>
                      ) : null}
                    </View>
                  }
                />

                {/* Credit is surfaced deliberately: an overpayment that vanished
                    from view would read as the app losing money (§74). */}
                {summary.data && summary.data.creditPaisa > 0 ? (
                  <Card className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text variant="bodySm">{t('rentals:credit')}</Text>
                      <Text variant="caption" tone="secondary">
                        {t('rentals:creditNote')}
                      </Text>
                    </View>
                    <Money amountPaisa={summary.data.creditPaisa} variant="body" weight="600" />
                  </Card>
                ) : null}

                {summary.data && summary.data.depositHeldPaisa > 0 ? (
                  <Card className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text variant="bodySm">{t('rentals:deposit')}</Text>
                      {/* Stated explicitly: a deposit is never used to clear rent. */}
                      <Text variant="caption" tone="secondary">
                        {t('rentals:depositNote')}
                      </Text>
                    </View>
                    <Money
                      amountPaisa={summary.data.depositHeldPaisa}
                      variant="body"
                      weight="600"
                    />
                  </Card>
                ) : null}

                {/* Payment history: every payment and where it was applied (§61). */}
                <Pressable
                  onPress={() => router.push(`/rentals/${rentalId}/payments`)}
                  accessibilityRole="button"
                  accessibilityLabel={t('rentals:payments.title')}
                  style={{ minHeight: MIN_TOUCH_TARGET }}
                >
                  <Card className="flex-row items-center gap-3">
                    <ReceiptText size={18} color={colors.textSecondary} strokeWidth={1.75} />
                    <Text variant="body" className="flex-1">
                      {t('rentals:payments.title')}
                    </Text>
                    <Text variant="caption" tone="accent" weight="600">
                      {t('rentals:payments.view')}
                    </Text>
                  </Card>
                </Pressable>

                <Text variant="h2" className="mt-1">
                  {t('rentals:periods')}
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Card className="items-center gap-1 py-6">
                <Text variant="bodySm" tone="secondary" className="text-center">
                  {t('rentals:noPeriods')}
                </Text>
              </Card>
            }
            ListFooterComponent={
              canManage && isActive ? <EndRentalCard rentalId={rentalId} /> : null
            }
          />
        )}
      </QueryStateView>
    </Screen>
  );
}

/** Whole days between two AD (`YYYY-MM-DD`) calendar dates, `to - from`. */
function daysBetweenAd(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** A rental that exists but has not started. */
function DraftCard({ rental, canManage }: { rental: RentalResponse; canManage: boolean }) {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();
  const activate = useActivateRental();
  const deleteRental = useDeleteRental();
  const [error, setError] = useState<string | null>(null);

  /**
   * Deleting is offered only here, for a DRAFT — never for an ACTIVE or ENDED
   * rental, which the server would refuse anyway (§21, §34: history is ended,
   * never destroyed). A draft has generated no periods and no payments, so
   * there is nothing to protect.
   */
  function handleDelete() {
    Alert.alert(t('rentals:delete.confirmTitle'), t('rentals:delete.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('rentals:delete.confirmAction'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          deleteRental.mutate(rental.id, {
            onSuccess: () => router.replace('/rentals'),
            onError: (err) => {
              setError(
                err instanceof ApiError && err.code === 'RENTAL_NOT_DRAFT'
                  ? t('rentals:errors.notDraft')
                  : t('rentals:errors.deleteFailed'),
              );
            },
          });
        },
      },
    ]);
  }

  function runActivate() {
    setError(null);
    activate.mutate(rental.id, {
      onError: (err) => {
        // A unit taken by another tenant is the expected failure here,
        // and the reason must reach the user rather than be swallowed.
        setError(
          err instanceof ApiError && err.code === 'UNIT_ALREADY_OCCUPIED'
            ? t('rentals:errors.unitOccupied')
            : t('rentals:errors.startFailed'),
        );
      },
    });
  }

  /**
   * Starting is a separate, deliberate step from creation (see the note on
   * `RentalFormScreen`), which means a draft can sit for days before someone
   * taps "Start" — and `startDate` is fixed at creation, not re-picked here.
   * Without this check the rental activates silently with its first period
   * already due, and the dashboard's first thing the user sees is arrears on
   * a tenancy they just started (§57: confirm before a consequential action).
   */
  function handleStart() {
    const today = todayAd();
    if (rental.startDate < today) {
      Alert.alert(
        t('rentals:draft.pastStartTitle'),
        t('rentals:draft.pastStartBody', {
          date: formatDate(rental.startDate, { locale, format }),
          days: daysBetweenAd(rental.startDate, today),
        }),
        [
          { text: t('common:actions.cancel'), style: 'cancel' },
          { text: t('rentals:draft.startAnyway'), onPress: runActivate },
        ],
      );
      return;
    }
    runActivate();
  }

  return (
    <Card className="gap-2">
      <Text variant="h2">{t('rentals:draft.title')}</Text>
      <Text variant="bodySm" tone="secondary">
        {t('rentals:draft.body', {
          date: formatDate(rental.startDate, { locale, format }),
          days: rental.periodDays,
        })}
      </Text>

      {canManage ? (
        <Button
          label={t('rentals:draft.start')}
          isBusy={activate.isPending}
          onPress={handleStart}
          fullWidth
        />
      ) : null}

      {canManage ? (
        <Pressable
          onPress={handleDelete}
          disabled={deleteRental.isPending}
          accessibilityRole="button"
          accessibilityLabel={t('rentals:delete.action')}
          hitSlop={8}
          style={{ minHeight: MIN_TOUCH_TARGET, opacity: deleteRental.isPending ? 0.6 : 1 }}
          className="flex-row items-center justify-center gap-1.5 active:opacity-70"
        >
          <Trash2 size={16} color={colors.danger} strokeWidth={1.75} />
          <Text variant="bodySm" weight="600" tone="danger">
            {t('rentals:delete.action')}
          </Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text variant="bodySm" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

/** Ending a rental: confirmed, explained, and never destructive (§21, §57). */
function EndRentalCard({ rentalId }: { rentalId: string }) {
  const { t } = useTranslation(['rentals', 'common']);
  const endRental = useEndRental(rentalId);

  const [isOpen, setOpen] = useState(false);
  const [endDate, setEndDate] = useState(() => todayAd());
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    Alert.alert(t('rentals:end.confirmTitle'), t('rentals:end.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('rentals:end.confirmAction'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          endRental.mutate(
            { endDate },
            {
              onSuccess: () => setOpen(false),
              onError: (err) => {
                setError(
                  err instanceof ApiError && err.status === 422
                    ? (err.fieldErrors().endDate ?? t('rentals:errors.endFailed'))
                    : t('rentals:errors.endFailed'),
                );
              },
            },
          );
        },
      },
    ]);
  }

  if (!isOpen) {
    return (
      <Button
        label={t('rentals:end.action')}
        variant="ghost"
        onPress={() => setOpen(true)}
        className="mt-2"
      />
    );
  }

  return (
    <Card className="mt-2 gap-3">
      <Text variant="h2">{t('rentals:end.action')}</Text>
      <Text variant="bodySm" tone="secondary">
        {t('rentals:end.explain')}
      </Text>

      <BsDateField
        label={t('rentals:end.lastDay')}
        value={endDate}
        onChange={setEndDate}
        hint={t('rentals:end.lastDayHint')}
        isRequired
      />

      {error ? (
        <Text variant="bodySm" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            label={t('rentals:end.action')}
            variant="danger"
            isBusy={endRental.isPending}
            onPress={confirm}
            fullWidth
          />
        </View>
        <View className="flex-1">
          <Button
            label={t('common:actions.cancel')}
            variant="ghost"
            onPress={() => setOpen(false)}
            fullWidth
          />
        </View>
      </View>
    </Card>
  );
}

const PeriodCard = memo(function PeriodCard({
  period,
  canManage,
  onEnterReading,
}: {
  period: PeriodResponse;
  canManage: boolean;
  onEnterReading: (chargeId: string) => void;
}) {
  const { t } = useTranslation(['rentals', 'dashboard']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 gap-0.5">
          <Text variant="body" weight="600">
            {t('rentals:periodNumber', { number: period.sequenceNumber })}
          </Text>
          {/* Explicit inclusive boundaries, shown as such (§13). */}
          <Text variant="caption" tone="secondary">
            {formatDate(period.periodStart, { locale, style: 'short', format })} –{' '}
            {formatDate(period.periodEnd, { locale, style: 'short', format })}
          </Text>
          <Text variant="caption" tone={period.isOverdue ? 'danger' : 'secondary'}>
            {t('rentals:dueOn', {
              date: formatDate(period.dueDate, { locale, style: 'short', format }),
            })}
          </Text>
        </View>
        <StatusBadge
          status={period.settlementStatus}
          isOverdue={period.isOverdue}
          chargesComplete={period.chargesComplete}
        />
      </View>

      {period.isProrated ? (
        <Text variant="caption" tone="accent">
          {t('rentals:prorated', { covered: period.coveredDays, basis: period.basisDays })}
        </Text>
      ) : null}

      {/* The breakdown. §61 — never a total without the lines behind it. */}
      <View className="border-border gap-1 border-t pt-2">
        {period.charges.map((charge) => {
          const needsReading = !charge.isFinalized && charge.pricingModel === 'PER_UNIT';

          return (
            <View key={charge.id} className="flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <Text variant="caption" tone="secondary">
                  {charge.label ?? t(`dashboard:charge.${charge.chargeType}`)}
                </Text>
                {charge.pricingModel === 'PER_UNIT' && charge.consumedUnits !== null ? (
                  <Text variant="caption" tone="secondary">
                    {t('rentals:meterReading', {
                      previous: charge.previousReading,
                      current: charge.currentReading,
                      units: charge.consumedUnits,
                    })}
                  </Text>
                ) : null}
              </View>

              {charge.isFinalized ? (
                <View className="flex-row items-center gap-2">
                  <Money amountPaisa={charge.amountPaisa ?? 0} variant="caption" />
                  {charge.pricingModel === 'PER_UNIT' && canManage ? (
                    // A finalized reading is still a correctable typo, not a
                    // locked historical fact — unlike a period's charges once
                    // billed (§3.3), a wrong meter reading before payment
                    // settles it should be fixable rather than lived with.
                    <Pressable
                      onPress={() => onEnterReading(charge.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('rentals:reading.edit')}
                      hitSlop={8}
                      style={{ minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET }}
                      className="items-center justify-center active:opacity-60"
                    >
                      <Pencil size={14} color={colors.textSecondary} strokeWidth={1.75} />
                    </Pressable>
                  ) : null}
                </View>
              ) : needsReading && canManage ? (
                // The period's total cannot be final until this is entered, so
                // the fix is offered right where the gap is visible.
                <Pressable
                  onPress={() => onEnterReading(charge.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('rentals:reading.enter')}
                  hitSlop={8}
                  style={{ minHeight: MIN_TOUCH_TARGET }}
                  className="flex-row items-center gap-1.5 justify-end active:opacity-70"
                >
                  <Gauge size={14} color={colors.accent} strokeWidth={2} />
                  <Text variant="caption" tone="accent" weight="600">
                    {t('rentals:reading.enter')}
                  </Text>
                </Pressable>
              ) : (
                <Text variant="caption" tone="accent">
                  {t('dashboard:row.awaitingReading')}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      <View className="border-border gap-1 border-t pt-2">
        <Row label={t('rentals:total')} amountPaisa={period.totalPaisa} />
        <Row label={t('rentals:paid')} amountPaisa={period.paidPaisa} />
        <Row
          label={t('rentals:balance')}
          amountPaisa={period.balancePaisa}
          emphasis={period.balancePaisa > 0 ? 'owed' : 'settled'}
          weight="600"
        />
      </View>
    </Card>
  );
});

function Row({
  label,
  amountPaisa,
  emphasis = 'none',
  weight,
}: {
  label: string;
  amountPaisa: number;
  emphasis?: 'none' | 'owed' | 'settled';
  weight?: '400' | '500' | '600';
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text variant="bodySm" tone="secondary">
        {label}
      </Text>
      <Money
        amountPaisa={amountPaisa}
        variant="bodySm"
        emphasis={emphasis}
        {...(weight ? { weight } : {})}
      />
    </View>
  );
}
