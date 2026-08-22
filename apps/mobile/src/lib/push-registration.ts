import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Push registration. CLAUDE.md §20, §39.
 *
 * Registers the NATIVE device token (`getDevicePushTokenAsync`) rather than an
 * Expo push token, so the server delivers through FCM directly with no third
 * party in the path.
 *
 * ⚠️ DELIVERY WORKS ON ANDROID ONLY TODAY. `getDevicePushTokenAsync()` returns
 * an FCM registration token on Android but a raw APNs token on iOS, and the
 * server sends through FCM's v1 API, which accepts only the former. An iOS
 * token is therefore rejected on the first send and the device is revoked, so
 * push silently never arrives on iOS. See `apps/api/src/services/push.ts` for
 * what configuring iOS properly requires.
 *
 * ⚠️ Remote push does not work in Expo Go (removed in SDK 53). These functions
 * are safe to call there — they return null rather than throwing — but a
 * development build is required to actually receive a notification.
 *
 * No UI here by design: screens decide when to ask, this module only performs
 * the mechanics.
 */

/**
 * Without this, expo-notifications' documented default is to show NOTHING
 * while the app is in the foreground — a push still arrives and still lands
 * in the in-app history (§17), but no banner appears, which reads as "push is
 * broken" even though delivery succeeded. Background/killed delivery already
 * gets the OS's own tray notification regardless of this handler; this only
 * covers the foreground case.
 *
 * A module-level call rather than something a screen has to remember to run:
 * this module is imported the moment a device registers (`useDeviceRegistration`
 * imports it), which is also the earliest point a push could ever arrive.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    // The unread badge is already surfaced in-app via the tab bar (§39); the
    // OS icon badge has nothing that clears it when a notification is read,
    // so turning it on here would leave a stale count sitting on the icon.
    shouldSetBadge: false,
  }),
});

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export interface RegisteredDevice {
  token: string;
  platform: 'ANDROID' | 'IOS';
}

/**
 * Reads the current permission WITHOUT prompting.
 *
 * Separate from requesting so a screen can explain why the permission is wanted
 * before the OS dialog appears — a denied prompt is close to permanent, and
 * asking cold is how apps lose the permission for good.
 */
export async function getPushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function requestPushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/**
 * Fetches the device's FCM token, or null when unavailable.
 *
 * Returns null rather than throwing for the ordinary cases — a simulator, Expo
 * Go, or a denied permission — because none of those is an error the user can
 * act on, and an exception here would break app start-up.
 */
export async function getFcmToken(): Promise<RegisteredDevice | null> {
  // Push requires real hardware; a simulator has no token to give.
  if (!Device.isDevice) return null;

  const permission = await getPushPermission();
  if (permission !== 'granted') return null;

  try {
    const token = await Notifications.getDevicePushTokenAsync();
    if (typeof token.data !== 'string' || token.data.length === 0) return null;

    return {
      token: token.data,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    };
  } catch {
    // Expo Go, or missing native credentials. Not actionable by the user.
    return null;
  }
}

/**
 * Resolves the destination for a tapped notification.
 *
 * The payload carries stable identifiers only — never a screen name or path —
 * so changing navigation does not invalidate notifications already delivered
 * (§39). This function is the single place that maps identifiers to a route.
 */
export interface NotificationTarget {
  rentalId: string;
  periodId?: string | undefined;
}

export function resolveNotificationTarget(
  data: Record<string, unknown> | undefined,
): NotificationTarget | null {
  if (!data) return null;
  const rentalId = data['rentalId'];
  if (typeof rentalId !== 'string' || rentalId.length === 0) return null;

  const periodId = data['periodId'];
  return {
    rentalId,
    periodId: typeof periodId === 'string' && periodId.length > 0 ? periodId : undefined,
  };
}
