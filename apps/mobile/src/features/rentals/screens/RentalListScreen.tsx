import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { useRentals, type RentalResponse } from '../api';

/** 'ENDED' also covers 'CANCELLED' — both mean "no longer current", and
 *  cancelled is otherwise unused in the product today. */
type RentalFilter = 'ALL' | 'DRAFT' | 'ACTIVE' | 'ENDED';

function matchesFilter(rental: RentalResponse, filter: RentalFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'ENDED') return rental.status === 'ENDED' || rental.status === 'CANCELLED';
  return rental.status === filter;
}

/**
 * Every rental the caller is a party to.
 *
 * The same screen serves both roles — a landlord sees their tenancies, a tenant
 * sees their own — because the API scopes by ownership rather than by role
 * (§31). Only the wording differs.
 *
 * Filtered client-side rather than by re-querying per tab: the list is already
 * bounded to a reasonable size in one request, so switching tabs is instant
 * rather than a network round trip, and "Ended" can combine two statuses
 * without the API needing a multi-status filter (§35).
 */
export function RentalListScreen() {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const { user } = useCurrentUser();
  const query = useRentals();
  const [filter, setFilter] = useState<RentalFilter>('ALL');

  const isOwner = user?.profile?.primaryRole === 'HOUSE_OWNER';
  const all = query.data?.data ?? [];

  // Lifted out of the `QueryStateView` render prop, which only runs on the
  // success path — a hook cannot live there without breaking the rule that
  // hooks run unconditionally on every render (§36 — a landlord with many
  // rentals would otherwise re-filter the full list on every render).
  const filtered = useMemo(
    () => all.filter((rental) => matchesFilter(rental, filter)),
    [all, filter],
  );

  const handleRowPress = useCallback(
    (rental: RentalResponse) => router.push(`/rentals/${rental.id}`),
    [router],
  );

  return (
    <Screen padded={false}>
      <ScreenHeader
        title={isOwner ? t('rentals:title') : t('rentals:myRental')}
        action={
          all.length > 0 ? (
            <Pressable
              onPress={() => router.push('/rentals/new')}
              accessibilityRole="button"
              accessibilityLabel={t('rentals:create.title')}
              hitSlop={12}
              className="bg-primary h-11 w-11 items-center justify-center rounded-full active:opacity-80"
            >
              <Plus size={22} color="#fff" strokeWidth={2.5} />
            </Pressable>
          ) : null
        }
      />

      {/* Stays put while the list below scrolls, so switching tabs never
          requires scrolling back up first. */}
      {all.length > 0 ? <FilterTabs rentals={all} value={filter} onChange={setFilter} /> : null}

      <QueryStateView
        query={query}
        isEmpty={(page) => page.data.length === 0}
        empty={{
          title: t('rentals:emptyTitle'),
          body: isOwner ? t('rentals:emptyBodyOwner') : t('rentals:emptyBodyRenter'),
          actionLabel: t('rentals:create.title'),
          onAction: () => router.push('/rentals/new'),
        }}
      >
        {() => (
          <ScrollView
            contentContainerClassName="px-5 pb-6 gap-3"
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
              />
            }
          >
            {filtered.length > 0 ? (
              filtered.map((rental) => (
                <RentalRow key={rental.id} rental={rental} onPress={handleRowPress} />
              ))
            ) : (
              <Text variant="bodySm" tone="secondary">
                {t('rentals:filter.empty')}
              </Text>
            )}

            <Button
              label={t('rentals:create.title')}
              variant="secondary"
              onPress={() => router.push('/rentals/new')}
              fullWidth
              className="mt-2"
            />
          </ScrollView>
        )}
      </QueryStateView>
    </Screen>
  );
}

function FilterTabs({
  rentals,
  value,
  onChange,
}: {
  rentals: RentalResponse[];
  value: RentalFilter;
  onChange: (filter: RentalFilter) => void;
}) {
  const { t } = useTranslation(['rentals']);

  const options: { filter: RentalFilter; label: string }[] = [
    { filter: 'ALL', label: t('rentals:filter.all') },
    { filter: 'DRAFT', label: t('rentals:status.DRAFT') },
    { filter: 'ACTIVE', label: t('rentals:status.ACTIVE') },
    { filter: 'ENDED', label: t('rentals:status.ENDED') },
  ];

  // One pass over `rentals` for every tab's count, rather than one full
  // `.filter()` per tab (4 passes) on every render (§36).
  const counts = useMemo(() => {
    const tally: Record<RentalFilter, number> = { ALL: 0, DRAFT: 0, ACTIVE: 0, ENDED: 0 };
    for (const rental of rentals) {
      for (const filter of Object.keys(tally) as RentalFilter[]) {
        if (matchesFilter(rental, filter)) tally[filter] += 1;
      }
    }
    return tally;
  }, [rentals]);

  return (
    <View className="flex-row flex-wrap gap-2 px-5 pb-3">
      {options.map(({ filter, label }) => (
        <Button
          key={filter}
          label={`${label} (${counts[filter]})`}
          size="sm"
          variant={value === filter ? 'primary' : 'secondary'}
          onPress={() => onChange(filter)}
        />
      ))}
    </View>
  );
}

export const RentalRow = memo(function RentalRow({
  rental,
  onPress,
}: {
  rental: RentalResponse;
  onPress: (rental: RentalResponse) => void;
}) {
  const { t } = useTranslation(['rentals']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();

  const place = rental.unit?.label ?? rental.placeLabel ?? '—';
  const who = rental.counterpartyName;

  // Status is text, not a colour swatch (§43, §62).
  const statusTone =
    rental.status === 'ACTIVE'
      ? 'success'
      : rental.status === 'ENDED'
        ? 'secondary'
        : rental.status === 'CANCELLED'
          ? 'danger'
          : 'warning';

  return (
    <Pressable
      onPress={() => onPress(rental)}
      accessibilityRole="button"
      style={{ minHeight: MIN_TOUCH_TARGET }}
    >
      <Card className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="body" weight="600" numberOfLines={1}>
            {who ?? place}
          </Text>
          {who ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {place}
            </Text>
          ) : null}
          <Text variant="caption" tone="secondary">
            {t('rentals:since', {
              date: formatDate(rental.startDate, { locale, style: 'short', format }),
            })}
          </Text>
        </View>

        <View className="items-end gap-1">
          <Text variant="caption" weight="600" tone={statusTone}>
            {t(`rentals:status.${rental.status}`)}
          </Text>
          {/* 30 or 365 days — never "monthly" as a calendar month (ADR 0001). */}
          <Text variant="caption" tone="secondary">
            {t('rentals:everyNDays', { count: rental.periodDays })}
          </Text>
        </View>

        <ChevronRight size={18} color={colors.muted} />
      </Card>
    </Pressable>
  );
});
