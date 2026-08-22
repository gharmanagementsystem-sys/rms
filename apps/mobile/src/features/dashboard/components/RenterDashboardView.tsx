import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { RenterDashboard } from '@rms/shared';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Text } from '../../../components/ui/Text';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { RentalCarousel } from './RentalCarousel';

/**
 * The tenant's home screen. CLAUDE.md §24, §61, §73.
 *
 * A renter with more than one ACTIVE rental is a real, supported situation —
 * not just a brief transition between tenancies — so this never picks one to
 * lead with. Every active rental gets its own card in `RentalCarousel`; a
 * single rental still renders through the same component, so there is only
 * one code path to keep correct rather than a "one rental" layout and a
 * separate "many rentals" layout that could quietly drift apart.
 *
 * The full breakdown for any one rental — what it covers, its payment
 * history — lives on that rental's own detail screen, reached by tapping its
 * card. Repeating that depth here, once per rental, would turn the dashboard
 * into the "giant analytics screen" §24 explicitly rules out.
 */
export function RenterDashboardView({ data }: { data: RenterDashboard }) {
  const { t } = useTranslation(['dashboard', 'rentals']);
  const router = useRouter();

  const hasActive = data.activeRentals.length > 0;

  return (
    <View className="gap-4">
      {hasActive ? (
        <RentalCarousel rentals={data.activeRentals} label={t('dashboard:renter.outstanding')} />
      ) : data.draftRental ? (
        <DraftRentalCard draft={data.draftRental} />
      ) : null}

      <View className="gap-3">
        {hasActive ? (
          <Button
            label={t('dashboard:renter.payRent')}
            size="lg"
            fullWidth
            // Straight to the one rental this is about, UNLESS there is more
            // than one — then a direct jump would silently guess which one
            // the payment is for, so it goes to a picker instead (§31, §73).
            onPress={() =>
              router.push(
                data.activeRentals.length > 1
                  ? '/rentals/pay'
                  : `/rentals/${data.activeRentals[0]!.rentalId}/record-payment`,
              )
            }
          />
        ) : null}
        <View className="flex-row gap-3">
          <Button
            label={t('dashboard:renter.viewAllRentals')}
            variant="secondary"
            className="flex-1"
            onPress={() => router.push('/rentals')}
          />
          <Button
            label={t('rentals:create.title')}
            variant={hasActive ? 'secondary' : 'primary'}
            className="flex-1"
            onPress={() => router.push('/rentals/new')}
          />
        </View>
      </View>
    </View>
  );
}

/** A rental that exists but has not started yet — no periods, no balance, so
 *  it cannot be shown as one of the carousel's money cards. */
function DraftRentalCard({ draft }: { draft: NonNullable<RenterDashboard['draftRental']> }) {
  const { t } = useTranslation(['dashboard', 'rentals']);
  const router = useRouter();
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();

  return (
    <Pressable
      onPress={() => router.push(`/rentals/${draft.id}`)}
      accessibilityRole="button"
      style={{ minHeight: MIN_TOUCH_TARGET }}
    >
      <Card className="gap-1">
        <Text variant="h2">{draft.placeLabel}</Text>
        <Text variant="bodySm" tone="secondary">
          {t('rentals:draft.body', {
            date: formatDate(draft.startDate, { locale, format }),
            days: draft.periodDays,
          })}
        </Text>
      </Card>
    </Pressable>
  );
}
