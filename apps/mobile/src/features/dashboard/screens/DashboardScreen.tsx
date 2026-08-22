import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Building2, Home } from '../../../components/ui/icons';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Text } from '../../../components/ui/Text';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { motion } from '../../../theme/tokens';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { useDashboard } from '../api';
import { OwnerDashboardView } from '../components/OwnerDashboardView';
import { RenterDashboardView } from '../components/RenterDashboardView';

/** Buckets local device time into a greeting — cosmetic only, so device time
 *  (rather than the business's Nepal Standard Time, §46) is the right clock:
 *  nothing here feeds accounting. */
function greetingKey(hour: number): 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  if (hour < 12) return 'greetingMorning';
  if (hour < 17) return 'greetingAfternoon';
  return 'greetingEvening';
}

/**
 * Home. CLAUDE.md §24, §41.
 *
 * Both sections may be present: a user can be a landlord and a tenant at once,
 * which is common in Nepal. `primaryRole` decides which is shown first rather
 * than which is shown at all.
 *
 * Pull to refresh is here because the figures change when someone else records
 * a payment, and a tenant checking whether their landlord logged it will
 * instinctively pull.
 */
export function DashboardScreen() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { user } = useCurrentUser();
  const router = useRouter();
  const { preference: format } = useDateFormat();
  const query = useDashboard();
  const [isRefreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  const firstName = (user?.profile?.fullName ?? user?.name ?? '').split(' ')[0] ?? '';
  const reducedMotion = useReducedMotion();
  const colors = useSemanticColors();

  return (
    <SafeAreaView className="bg-background flex-1" edges={['top', 'left', 'right']}>
      <QueryStateView query={query}>
        {(data) => {
          const sections =
            data.primaryRole === 'HOUSE_OWNER'
              ? ([data.owner, data.renter] as const)
              : ([data.renter, data.owner] as const);

          const hasAnything = data.owner !== null || data.renter !== null;

          return (
            <ScrollView
              contentContainerClassName="p-5 gap-4"
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} />
              }
            >
              {/* The animation lives on `Animated.View` itself, never on a
                  className passed to it — NativeWind's class-to-style
                  interop is not guaranteed for third-party animated
                  components, and silently not applying it here previously
                  dropped the row's `flex-row`/`flex-1`, leaving the greeting
                  free to render past the screen edge instead of truncating.
                  The actual layout stays on a plain nested `View`. */}
              <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(motion.slow)}>
                <View className="flex-row items-center gap-3">
                  <Avatar name={user?.profile?.fullName ?? user?.name ?? '?'} />
                  <View className="flex-1">
                    <Text variant="caption" tone="secondary">
                      {formatDate(data.asOf, { locale: currentLanguage(), format })}
                    </Text>
                    <Text variant="h1" numberOfLines={1}>
                      {t(`dashboard:${greetingKey(new Date().getHours())}`, { name: firstName })}
                    </Text>
                  </View>
                </View>
              </Animated.View>

              {sections.map((section, index) =>
                section === null ? null : (
                  <Animated.View
                    key={'properties' in section ? `owner-${index}` : `renter-${index}`}
                    entering={
                      reducedMotion
                        ? undefined
                        : FadeInDown.duration(motion.slow).delay(60 * (index + 1))
                    }
                  >
                    <View>
                      {'properties' in section ? (
                        <OwnerDashboardView data={section} />
                      ) : (
                        <RenterDashboardView data={section} />
                      )}
                    </View>
                  </Animated.View>
                ),
              )}

              {/* A brand-new account has neither section. Say what to do, not
                  "no data" (§42). */}
              {!hasAnything ? (
                <Card className="items-center gap-2 py-8">
                  {data.primaryRole === 'HOUSE_OWNER' ? (
                    <Building2 size={32} color={colors.primary} strokeWidth={1.5} />
                  ) : (
                    <Home size={32} color={colors.primary} strokeWidth={1.5} />
                  )}
                  <Text variant="h2" className="text-center">
                    {t(
                      data.primaryRole === 'HOUSE_OWNER'
                        ? 'dashboard:owner.emptyTitle'
                        : 'dashboard:renter.emptyTitle',
                    )}
                  </Text>
                  <Text variant="bodySm" tone="secondary" className="text-center">
                    {t(
                      data.primaryRole === 'HOUSE_OWNER'
                        ? 'dashboard:owner.emptyBody'
                        : 'dashboard:renter.emptyBody',
                    )}
                  </Text>
                  <Button
                    label={t(
                      data.primaryRole === 'HOUSE_OWNER'
                        ? 'dashboard:owner.addProperty'
                        : 'dashboard:renter.addRental',
                    )}
                    onPress={() =>
                      router.push(
                        data.primaryRole === 'HOUSE_OWNER' ? '/properties/new' : '/rentals/new',
                      )
                    }
                    className="mt-2"
                  />
                </Card>
              ) : null}
            </ScrollView>
          );
        }}
      </QueryStateView>
    </SafeAreaView>
  );
}
