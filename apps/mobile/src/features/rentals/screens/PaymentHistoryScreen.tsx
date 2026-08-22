import { memo, useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from '../../../components/ui/icons';
import { Card } from '../../../components/ui/Card';
import { Money } from '../../../components/ui/Money';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { usePayments, type PaymentResponse } from '../api';

/**
 * Every payment recorded against a rental. CLAUDE.md §34, §41, §42, §61.
 *
 * Uses the existing `usePayments` query rather than a second fetching path.
 *
 * Each row shows where the money went — the periods it settled, and anything
 * left over as credit. A payment the user cannot account for is exactly the
 * kind of thing that erodes trust in a financial app, so the allocation is
 * always inspectable (§61).
 *
 * The API returns the full history in one response (no cursor is issued for
 * this endpoint), so there is no pagination to drive here. If it starts
 * paginating, `meta.nextCursor` is already carried on the response.
 */
export function PaymentHistoryScreen() {
  const { t } = useTranslation(['rentals', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const rentalId = String(id);

  const query = usePayments(rentalId);

  // Lifted out of the `QueryStateView` render prop, which only runs on the
  // success path — a hook cannot live there without breaking the rule that
  // hooks run unconditionally on every render (§36 — avoid recomputing a
  // full-history reduce on every render once a rental has years of payments).
  const posted = useMemo(
    () => (query.data?.data ?? []).filter((payment) => payment.status === 'POSTED'),
    [query.data],
  );
  const total = useMemo(
    () => posted.reduce((sum, payment) => sum + payment.amountPaisa, 0),
    [posted],
  );

  return (
    <Screen padded={false}>
      <ScreenHeader title={t('rentals:payments.title')} showBack />

      <QueryStateView
        query={query}
        isEmpty={(page) => page.data.length === 0}
        empty={{
          title: t('rentals:payments.emptyTitle'),
          body: t('rentals:payments.emptyBody'),
        }}
      >
        {(page) => (
          <FlatList
            className="flex-1"
            contentContainerClassName="px-5 pb-6 gap-3"
            data={page.data}
            keyExtractor={(payment) => payment.id}
            renderItem={({ item }) => <PaymentRow payment={item} />}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
              />
            }
            ListHeaderComponent={
              <Card className="mb-3 gap-1">
                <Text variant="bodySm" tone="secondary">
                  {t('rentals:payments.totalReceived')}
                </Text>
                <Money amountPaisa={total} variant="display" />
                <Text variant="caption" tone="secondary">
                  {t('rentals:payments.count', { count: posted.length })}
                </Text>
              </Card>
            }
          />
        )}
      </QueryStateView>
    </Screen>
  );
}

const PaymentRow = memo(function PaymentRow({ payment }: { payment: PaymentResponse }) {
  const { t } = useTranslation(['rentals']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();

  const isReversed = payment.status === 'REVERSED';

  return (
    <Card className={`gap-2 ${isReversed ? 'opacity-70' : ''}`}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="body" weight="600">
            {t(`rentals:purpose.${payment.purpose}`)}
          </Text>
          <Text variant="caption" tone="secondary">
            {formatDate(payment.paidOn, { locale, style: 'short', format })} ·{' '}
            {t(`rentals:method.${payment.method}`)}
          </Text>
          {payment.reference ? (
            <Text variant="caption" tone="secondary">
              {t('rentals:payments.reference', { reference: payment.reference })}
            </Text>
          ) : null}
        </View>

        <View className="items-end gap-1">
          <Money
            amountPaisa={payment.amountPaisa}
            variant="body"
            weight="600"
            tone={isReversed ? 'secondary' : undefined}
          />
          {/* Reversal is stated in words with an icon, never by styling alone
              (§43, §62). */}
          {isReversed ? (
            <View className="flex-row items-center gap-1">
              <RotateCcw size={12} color={colors.danger} strokeWidth={2} />
              <Text variant="caption" tone="danger" weight="600">
                {t('rentals:payments.reversed')}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {payment.note ? (
        <Text variant="caption" tone="secondary">
          {payment.note}
        </Text>
      ) : null}

      {/* Where the money actually went (§61). */}
      {payment.allocations.length > 0 ? (
        <View className="border-border gap-1 border-t pt-2">
          <Text variant="caption" tone="secondary">
            {t('rentals:payments.appliedTo')}
          </Text>
          {payment.allocations.map((allocation) => (
            <View key={allocation.periodId} className="flex-row items-center justify-between">
              <Text variant="caption" tone="secondary">
                {t('rentals:payments.periodShort')}
              </Text>
              <Money amountPaisa={allocation.amountPaisa} variant="caption" />
            </View>
          ))}
        </View>
      ) : null}

      {payment.unallocatedPaisa > 0 ? (
        <View className="border-border flex-row items-center justify-between border-t pt-2">
          <Text variant="caption" tone="success">
            {payment.purpose === 'RENT'
              ? t('rentals:payments.heldAsCredit')
              : t('rentals:payments.notAppliedToRent')}
          </Text>
          <Money amountPaisa={payment.unallocatedPaisa} variant="caption" emphasis="settled" />
        </View>
      ) : null}
    </Card>
  );
});
