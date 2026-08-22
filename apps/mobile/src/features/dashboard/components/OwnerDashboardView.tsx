import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Building2, DoorOpen, ReceiptText, TrendingUp, Users } from '../../../components/ui/icons';
import type { OwnerDashboard } from '@rms/shared';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Text } from '../../../components/ui/Text';
import { AttentionRowCard } from './AttentionRowCard';
import { RentalCarousel } from './RentalCarousel';
import { StatTile } from './StatTile';

/**
 * The landlord's home screen. CLAUDE.md §24.
 *
 * Leads with the carousel — every rental at a glance — rather than an
 * aggregate money figure or shortcut icons: with the carousel already one
 * swipe away from every tenant's own detail screen, a separate "add
 * property"/"add rental" shortcut earns its place less than it used to, and
 * an aggregate "still owed" figure duplicates what each card already shows
 * for its own rental.
 *
 * What still needs a phone call today — arrears, then what is coming — stays
 * directly under the carousel rather than buried below the standing figures,
 * per §73. A "nothing overdue" reassurance card is deliberately not shown in
 * its place: the common case does not need celebrating, only the exceptional
 * one needs surfacing.
 */
export function OwnerDashboardView({ data }: { data: OwnerDashboard }) {
  const { t } = useTranslation(['dashboard', 'rentals']);
  const router = useRouter();

  return (
    <View className="gap-4">
      {data.activeRentals.length > 0 ? (
        <View className="gap-3">
          <Text variant="h2">{t('dashboard:owner.yourRentals')}</Text>
          <RentalCarousel rentals={data.activeRentals} label={t('rentals:outstanding')} />
        </View>
      ) : null}

      {data.overdue.length > 0 ? (
        <Card padded={false} className="px-4 py-2">
          <Text variant="h2" tone="danger" className="py-2">
            {t('dashboard:owner.overdueTitle')}
          </Text>
          {data.overdue.map((row) => (
            <AttentionRowCard
              key={row.periodId}
              row={row}
              onPress={() => router.push(`/rentals/${row.rentalId}`)}
            />
          ))}
        </Card>
      ) : null}

      {data.dueSoon.length > 0 ? (
        <Card padded={false} className="px-4 py-2">
          <Text variant="h2" className="py-2">
            {t('dashboard:owner.dueSoonTitle')}
          </Text>
          {data.dueSoon.map((row) => (
            <AttentionRowCard
              key={row.periodId}
              row={row}
              onPress={() => router.push(`/rentals/${row.rentalId}`)}
            />
          ))}
        </Card>
      ) : null}

      <View className="flex-row gap-3">
        <Button
          label={t('dashboard:owner.manageProperties')}
          variant="secondary"
          className="flex-1"
          onPress={() => router.push('/properties')}
        />
        <Button
          label={t('dashboard:owner.manageRentals')}
          variant="secondary"
          className="flex-1"
          onPress={() => router.push('/rentals')}
        />
      </View>

      <Card className="gap-3">
        <Text variant="h2">{t('dashboard:owner.title')}</Text>
        <View className="gap-2">
          <StatTile
            icon={Building2}
            label={t('dashboard:owner.properties')}
            count={data.properties.total}
          />
          <StatTile
            icon={ReceiptText}
            label={t('dashboard:owner.activeRentals')}
            count={data.rentals.active}
          />
          <StatTile
            icon={Users}
            label={t('dashboard:owner.occupied')}
            count={data.units.occupied}
          />
          <StatTile
            icon={DoorOpen}
            label={t('dashboard:owner.available')}
            count={data.units.available}
          />
          <StatTile
            icon={TrendingUp}
            label={t('dashboard:owner.collected')}
            amountPaisa={data.money.collectedRecentPaisa}
            emphasis="settled"
          />
        </View>
      </Card>
    </View>
  );
}
