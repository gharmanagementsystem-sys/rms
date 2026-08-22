import { useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { api, ApiError } from '../../api/client';
import { getFcmToken, getPushPermission } from '../../lib/push-registration';
import { logDiagnostic } from '../../lib/diagnostics';

/**
 * Device lifecycle for push. CLAUDE.md §20, §39.
 *
 * The contract this implements:
 *
 *   sign in  → register this device's FCM token against the signed-in user
 *   sign out → revoke it, so the next person to use the handset does not
 *              receive the previous user's rent reminders
 *   switch user → re-register, which reassigns the token server-side
 *
 * Reassignment is handled by the server: registration is an upsert keyed on the
 * token, and it moves ownership to whoever is signed in now. That is what makes
 * a shared or resold phone safe, and it is why the client does not attempt to
 * diff the previous owner itself.
 *
 * ⚠️ This registers nothing in Expo Go — `getFcmToken` returns null there, and
 * on a simulator. That is expected and is not an error state; it means real
 * delivery cannot be verified until a development build runs on real hardware.
 */

/** Sent for support triage: which build a token came from. */
function appVersion(): string | undefined {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version.length > 0 ? version : undefined;
}

export interface RegisteredDeviceRecord {
  id: string;
  platform: 'ANDROID' | 'IOS';
  notificationsEnabled: boolean;
}

/**
 * Registers the current device. Safe to call repeatedly.
 *
 * Returns the server's device record, or null when there is no token to
 * register — which is the normal case in Expo Go and on simulators.
 */
export async function registerDevice(): Promise<RegisteredDeviceRecord | null> {
  const device = await getFcmToken();
  if (!device) return null;

  const permission = await getPushPermission();

  return api.post<RegisteredDeviceRecord>('/api/v1/devices', {
    token: device.token,
    platform: device.platform,
    ...(appVersion() ? { appVersion: appVersion() } : {}),
    // The OS permission state travels with the token, so the server can stop
    // targeting a device whose owner turned notifications off at the OS level.
    notificationsEnabled: permission === 'granted',
  });
}

/**
 * Revokes a device on sign-out.
 *
 * Deliberately best-effort and non-blocking: a user tapping "sign out" must be
 * signed out even if the network is down. The server also reassigns the token
 * on the next registration, so a missed revoke self-corrects the moment anyone
 * signs in on this handset again.
 */
export async function revokeDevice(deviceId: string): Promise<void> {
  try {
    await api.delete<void>(`/api/v1/devices/${deviceId}`);
  } catch (error) {
    // Not surfaced to the user — there is no action they could take, and
    // blocking sign-out on it would be worse than the stale registration.
    logDiagnostic('device.revoke.failed', {
      status: error instanceof ApiError ? error.status : 0,
    });
  }
}

/**
 * Registers the device once per signed-in session.
 *
 * Keyed on the user id so that switching accounts on one handset re-registers
 * and reassigns the token, rather than leaving it pointed at the previous user.
 */
export function useDeviceRegistration(userId: string | null): void {
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      // Signed out: forget, so signing back in registers again.
      registeredFor.current = null;
      return;
    }
    if (registeredFor.current === userId) return;

    registeredFor.current = userId;

    void registerDevice()
      .then((device) => {
        if (device) rememberDeviceId(device.id);
      })
      .catch((error: unknown) => {
        // A failed registration must never block the app. It retries on the
        // next sign-in, and the notification history screen works regardless.
        registeredFor.current = null;
        logDiagnostic('device.register.failed', {
          status: error instanceof ApiError ? error.status : 0,
        });
      });
  }, [userId]);
}

/**
 * The last device id this install registered.
 *
 * Held in module scope rather than persisted: it is only needed to revoke on
 * sign-out within the same app session, and a stale id from a previous launch
 * would revoke the wrong record.
 */
let lastRegisteredDeviceId: string | null = null;

function rememberDeviceId(id: string): void {
  lastRegisteredDeviceId = id;
}

export function currentDeviceId(): string | null {
  return lastRegisteredDeviceId;
}

export function forgetDeviceId(): void {
  lastRegisteredDeviceId = null;
}
