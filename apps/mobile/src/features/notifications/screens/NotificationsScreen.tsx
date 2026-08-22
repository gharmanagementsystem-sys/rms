import { memo, useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  Info,
  KeyRound,
} from '../../../components/ui/icons';
import type { NotificationType } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { resolveNotificationTarget } from '../../../lib/push-registration';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationResponse,
} from '../api';

/**
 * Notification history. CLAUDE.md §17, §39, §41, §42.
 *
 * Reads from PostgreSQL, not from the OS notification tray. A reminder that
 * arrived while the phone was off, or that was never delivered because push
 * permission was denied, is still here — which is the entire reason the server
 * persists notifications rather than treating FCM as the record.
 */
export function NotificationsScreen() {
  const { t } = useTranslation(['notifications', 'common']);
  const router = useRouter();

  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [actionError, setActionError] = useState<string | null>(null);

  const unreadCount = query.data?.meta.unreadCount ?? 0;

  const handlePress = useCallback(
    (notification: NotificationResponse) => {
      setActionError(null);

      // Marked read optimistically, so navigating away immediately still leaves
      // the row correct when the user comes back.
      if (notification.readAt === null) {
        markRead.mutate(notification.id, {
          onError: (error) => {
            setActionError(
              error instanceof ApiError && error.isRetryable
                ? t('common:states.errorBody')
                : t('notifications:errors.markFailed'),
            );
          },
        });
      }

      // The payload carries identifiers, never a route. This is the one place
      // that maps them to a destination (§39).
      const target =
        resolveNotificationTarget(notification.data ?? undefined) ??
        (notification.rentalId ? { rentalId: notification.rentalId } : null);

      if (target) router.push(`/rentals/${target.rentalId}`);
    },
    [markRead, router, t],
  );

  return (
    <Screen padded={false}>
      <ScreenHeader
        title={t('notifications:title')}
        subtitle={
          unreadCount > 0 ? t('notifications:unreadCount', { count: unreadCount }) : undefined
        }
      />

      <QueryStateView
        query={query}
        isEmpty={(page) => page.data.length === 0}
        empty={{
          title: t('notifications:emptyTitle'),
          body: t('notifications:emptyBody'),
        }}
      >
        {(page) => (
          <FlatList
            className="flex-1"
            contentContainerClassName="px-5 pb-6 gap-2"
            data={page.data}
            keyExtractor={(notification) => notification.id}
            renderItem={({ item }) => <NotificationRow notification={item} onPress={handlePress} />}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
              />
            }
            ListHeaderComponent={
              unreadCount > 0 || actionError ? (
                <View className="gap-2 pb-2">
                  {unreadCount > 0 ? (
                    <Button
                      label={t('notifications:markAllRead')}
                      variant="secondary"
                      size="sm"
                      isBusy={markAllRead.isPending}
                      onPress={() => {
                        setActionError(null);
                        markAllRead.mutate(undefined, {
                          onError: () => setActionError(t('notifications:errors.markAllFailed')),
                        });
                      }}
                      className="self-end"
                    />
                  ) : null}

                  {actionError ? (
                    <View className="bg-danger/10 rounded-xl p-3" accessibilityLiveRegion="polite">
                      <Text variant="bodySm" tone="danger">
                        {actionError}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null
            }
          />
        )}
      </QueryStateView>
    </Screen>
  );
}

/** Icon and tone per type. Never colour alone — the type is also named (§43). */
function iconFor(type: NotificationType, color: string) {
  const props = { size: 20, color, strokeWidth: 1.75 } as const;
  switch (type) {
    case 'RENT_DUE_SOON':
      return <CalendarClock {...props} />;
    case 'RENT_DUE_TODAY':
      return <BellRing {...props} />;
    case 'RENT_OVERDUE':
      return <AlertTriangle {...props} />;
    case 'PAYMENT_RECORDED':
      return <CheckCircle2 {...props} />;
    case 'RENTAL_STARTED':
      return <KeyRound {...props} />;
    case 'RENTAL_ENDED':
      return <DoorOpen {...props} />;
    default:
      return <Info {...props} />;
  }
}

const NotificationRow = memo(function NotificationRow({
  notification,
  onPress,
}: {
  notification: NotificationResponse;
  onPress: (notification: NotificationResponse) => void;
}) {
  const { t } = useTranslation(['notifications']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();

  const isUnread = notification.readAt === null;
  const isUrgent = notification.type === 'RENT_OVERDUE';
  const iconColor = isUrgent ? '#B3261E' : '#5C625F';

  // A tappable row only when there is somewhere to go.
  const hasDestination =
    notification.rentalId !== null ||
    resolveNotificationTarget(notification.data ?? undefined) !== null;

  const body = (
    <Card className={`flex-row gap-3 ${isUnread ? 'border-primary/40' : ''}`}>
      <View className="bg-surfaceElevated h-10 w-10 items-center justify-center rounded-xl">
        {iconFor(notification.type, iconColor)}
      </View>

      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text variant="body" weight={isUnread ? '600' : '400'} className="flex-1">
            {notification.title}
          </Text>
          {/* Unread is stated in text for screen readers, not shown by weight
              and a dot alone (§43). */}
          {isUnread ? (
            <View className="bg-primary h-2 w-2 rounded-full" accessibilityElementsHidden />
          ) : null}
        </View>

        <Text variant="bodySm" tone="secondary">
          {notification.body}
        </Text>

        <Text variant="caption" tone="secondary">
          {t(`notifications:type.${notification.type}`)} ·{' '}
          {formatDate(notification.createdAt.slice(0, 10), { locale, style: 'short', format })}
          {isUnread ? ` · ${t('notifications:unread')}` : ''}
        </Text>
      </View>
    </Card>
  );

  if (!hasDestination) {
    // Still needs to be markable as read, so it stays pressable.
    return (
      <Pressable
        onPress={() => onPress(notification)}
        accessibilityRole="button"
        accessibilityLabel={`${notification.title}. ${notification.body}`}
        style={{ minHeight: MIN_TOUCH_TARGET }}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(notification)}
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}. ${notification.body}. ${t('notifications:opensRental')}`}
      style={{ minHeight: MIN_TOUCH_TARGET }}
    >
      {body}
    </Pressable>
  );
});
