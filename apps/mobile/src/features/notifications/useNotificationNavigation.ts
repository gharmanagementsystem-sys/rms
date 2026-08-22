import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { resolveNotificationTarget } from '../../lib/push-registration';

/**
 * Opens the relevant rental when a push notification is tapped (CLAUDE.md §39).
 *
 * The payload carries only stable identifiers (`rentalId`, `periodId`), never
 * a screen name — `resolveNotificationTarget` is the one place that maps them
 * to a destination, so a notification delivered days ago still opens correctly
 * even if navigation has changed since.
 *
 * Two paths, because expo-notifications reports a tap differently depending on
 * what the app was doing when it happened:
 *   - already running (foreground or backgrounded): the live listener fires.
 *   - the tap itself launched the app from killed: the listener is never
 *     called for that one, so the last response has to be read once on mount.
 */
export function useNotificationNavigation(): void {
  const router = useRouter();

  useEffect(() => {
    function handleResponse(response: Notifications.NotificationResponse): void {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const target = resolveNotificationTarget(data);
      if (target) router.push(`/rentals/${target.rentalId}`);
    }

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleResponse(response);
      // Otherwise the same cold-start tap would navigate again on every
      // remount — a fast refresh in development, or this hook re-running.
      void Notifications.clearLastNotificationResponseAsync();
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, [router]);
}
