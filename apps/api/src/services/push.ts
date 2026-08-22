import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Push delivery via Firebase Cloud Messaging. CLAUDE.md §4, §20.
 *
 * FCM is the delivery layer only. The notification itself lives in PostgreSQL,
 * so a failed or undelivered push never loses the record (§17).
 *
 * The mobile app registers a NATIVE token (via expo-notifications'
 * `getDevicePushTokenAsync`) rather than an Expo push token, so messages go
 * from this server straight to FCM with no third party in the path.
 *
 * ⚠️ ANDROID ONLY, TODAY. `getDevicePushTokenAsync()` returns an FCM
 * registration token on Android but a raw APNs token on iOS, and the FCM v1
 * API used below accepts only the former. An iOS token therefore fails with
 * `messaging/invalid-argument`, is classified INVALID_TOKEN, and the device is
 * revoked — so iOS push silently never arrives.
 *
 * Fixing it needs infrastructure, not a change here: register the iOS app in
 * Firebase, upload an APNs auth key to it, add `ios.googleServicesFile` to
 * app.json, and obtain the token through the Firebase iOS SDK so that iOS
 * yields a real FCM token. FCM then bridges to APNs and this code path covers
 * both platforms unchanged.
 *
 * Server credentials never leave this process (§20, §32).
 */

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Stable navigation identifiers — never UI routes (§39). */
  data: Record<string, string>;
}

export type PushFailureReason = 'INVALID_TOKEN' | 'TRANSIENT' | 'PERMANENT';

export interface PushResult {
  token: string;
  ok: boolean;
  messageId?: string;
  reason?: PushFailureReason;
  error?: string;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

/**
 * FCM error codes meaning "this token will never work again".
 *
 * The device has been wiped, the app uninstalled, or the token rotated. These
 * must revoke the device rather than be retried — otherwise every future batch
 * carries a growing tail of dead tokens (§20).
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

function classify(code: string | undefined): PushFailureReason {
  if (code && DEAD_TOKEN_CODES.has(code)) return 'INVALID_TOKEN';
  if (code === 'messaging/server-unavailable' || code === 'messaging/internal-error') {
    return 'TRANSIENT';
  }
  return 'PERMANENT';
}

class FcmSender implements PushSender {
  private readonly app: App;

  constructor(serviceAccountJson: string) {
    const credentials: unknown = JSON.parse(serviceAccountJson);
    // Reuse an existing app on hot reload rather than throwing on re-init.
    const existing = getApps()[0];
    this.app =
      existing ??
      initializeApp({ credential: cert(credentials as Parameters<typeof cert>[0]) }, 'rms');
  }

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    if (messages.length === 0) return [];

    const messaging = getMessaging(this.app);
    const response = await messaging.sendEach(
      messages.map((message) => ({
        token: message.token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high' as const },
        apns: { payload: { aps: { sound: 'default' } } },
      })),
    );

    return response.responses.map((result, index) => {
      const token = messages[index]!.token;
      if (result.success) {
        return { token, ok: true, messageId: result.messageId };
      }
      const code = result.error?.code;
      return {
        token,
        ok: false,
        reason: classify(code),
        error: code ?? result.error?.message ?? 'unknown',
      };
    });
  }
}

/**
 * Used when FCM is not configured.
 *
 * Reports every message as delivered so the rest of the pipeline — records,
 * deduplication, delivery bookkeeping — can be developed and tested without
 * Firebase credentials. Never active in production: the environment refuses to
 * boot without credentials there.
 */
class NoopSender implements PushSender {
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    if (messages.length > 0) {
      logger.warn(
        { count: messages.length },
        'FCM is not configured — push messages were discarded, not sent',
      );
    }
    return messages.map((message) => ({ token: message.token, ok: true, messageId: 'noop' }));
  }
}

function createSender(): PushSender {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    if (env.isProduction) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is required in production');
    }
    if (!env.isTest) {
      logger.warn('FCM is not configured. Push notifications will not be delivered.');
    }
    return new NoopSender();
  }

  // Base64 so a multi-line JSON key survives an environment variable intact.
  const json = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
  return new FcmSender(json);
}

let sender: PushSender | undefined;

/** Lazily constructed so importing this module never requires credentials. */
export function pushSender(): PushSender {
  sender ??= createSender();
  return sender;
}

/** Test seam. */
export function setPushSender(replacement: PushSender): void {
  sender = replacement;
}
