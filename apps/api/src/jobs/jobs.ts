import { DEFAULT_RENT_REMINDER_DAYS, formatAmount, paisa } from '@rms/shared';
import { prisma } from '../db/client';
import { addDays, todayInNepal } from '../lib/business-date';
import { resolvePlaceLabel } from '../lib/rental-display';
import { paisaToNumber } from '../lib/serialize';
import { ensurePeriods } from '../modules/accounting/accounting.service';
import { balanceOf } from '../modules/accounting/settlement';
import {
  buildDeepLinkData,
  composeContent,
  planPeriodNotifications,
} from '../modules/notifications/notification-policy';
import { logger } from '../services/logger';
import { pushSender } from '../services/push';
import { runJob, type JobResult } from './runner';

/**
 * Scheduled work. CLAUDE.md §16, §18, §19.
 *
 * These are ORCHESTRATION ONLY. Every financial decision comes from the pure
 * accounting modules and every notification decision from the pure policy
 * module — no rule is restated here, so there is nothing to drift.
 */

export const JOB_NAMES = [
  'generate-periods',
  'rent-reminders',
  'dispatch-push',
  'prune-devices',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

/**
 * Creates any rent period whose start date has arrived.
 *
 * Idempotent through `ensurePeriods`, which diffs against existing sequence
 * numbers — so this is safe to run any number of times per day.
 */
export async function runGeneratePeriods(asOf = todayInNepal()): Promise<JobResult> {
  return runJob({
    name: 'generate-periods',
    runKey: asOf,
    run: async () => {
      const rentals = await prisma.rental.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });

      let created = 0;
      for (const rental of rentals) {
        try {
          created += await ensurePeriods(rental.id, asOf);
        } catch (error) {
          // One broken rental must not stop the rest of the portfolio being
          // billed. Logged loudly so it is not lost.
          logger.error({ err: error, rentalId: rental.id }, 'Failed to generate periods');
        }
      }
      return created;
    },
  });
}

/**
 * Creates notification records for rent that is approaching, due, or late.
 *
 * Creates records only — delivery is a separate job, so a push failure never
 * costs the user their in-app notification history (§17).
 */
export async function runRentReminders(asOf = todayInNepal()): Promise<JobResult> {
  return runJob({
    name: 'rent-reminders',
    runKey: asOf,
    run: async () => {
      // Only periods that could plausibly need chasing today: due within the
      // furthest reminder window, or already past due.
      const horizon = addDays(asOf, 30);

      const periods = await prisma.rentalPeriod.findMany({
        where: {
          settlementStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
          dueDate: { lte: new Date(`${horizon}T00:00:00.000Z`) },
          rental: { status: 'ACTIVE' },
        },
        include: {
          rental: {
            select: {
              id: true,
              overdueAfterDays: true,
              ownerUserId: true,
              renterUserId: true,
              placeLabel: true,
              unit: { select: { label: true } },
            },
          },
        },
      });

      let created = 0;

      for (const period of periods) {
        const balancePaisa = balanceOf(
          paisaToNumber(period.totalAmountPaisa),
          paisaToNumber(period.paidAmountPaisa),
        );

        // Both parties are told about the same money.
        const recipients = [period.rental.ownerUserId, period.rental.renterUserId].filter(
          (id): id is string => id !== null,
        );
        if (recipients.length === 0) continue;

        // Fetched WITHOUT filtering on notificationsEnabled, so that "no
        // preferences row" and "notifications switched off" stay
        // distinguishable. A user who has never opened settings must still be
        // reminded about rent — silence is not a safe default here.
        const preferences = await prisma.userPreferences.findMany({
          where: { userId: { in: recipients } },
          select: { userId: true, rentReminderDays: true, notificationsEnabled: true },
        });

        for (const userId of recipients) {
          const preference = preferences.find((p) => p.userId === userId);

          // Only an explicit opt-out silences a user.
          if (preference && !preference.notificationsEnabled) continue;

          const reminderDays = preference?.rentReminderDays ?? [...DEFAULT_RENT_REMINDER_DAYS];

          const planned = planPeriodNotifications({
            periodId: period.id,
            rentalId: period.rental.id,
            dueDate: period.dueDate.toISOString().slice(0, 10),
            balancePaisa,
            overdueAfterDays: period.rental.overdueAfterDays,
            reminderDays,
            asOf,
          });

          for (const notification of planned) {
            const content = composeContent(notification.type, {
              amountLabel: formatAmount(paisa(balancePaisa)),
              placeLabel: resolvePlaceLabel(period.rental, 'your rental'),
              daysUntilDue: notification.daysUntilDue,
            });

            // The unique constraint on dedupeKey is what makes duplicate
            // delivery impossible, whatever the scheduler does (§18).
            const result = await prisma.notification.createMany({
              data: [
                {
                  userId,
                  type: notification.type,
                  title: content.title,
                  body: content.body,
                  data: buildDeepLinkData(notification),
                  // Scoped per user: both parties must each get their own copy.
                  dedupeKey: `${notification.dedupeKey}:${userId}`,
                  rentalId: notification.rentalId,
                  periodId: notification.periodId,
                },
              ],
              skipDuplicates: true,
            });
            created += result.count;
          }
        }
      }

      return created;
    },
  });
}

/**
 * Pushes notifications that have no delivery record yet.
 *
 * Runs on every invocation rather than once per window, because it is a queue
 * drain: `PENDING` is the state, and re-running simply picks up what is left.
 */
export async function runDispatchPush(limit = 200): Promise<JobResult> {
  return runJob({
    name: 'dispatch-push',
    run: async () => {
      const pending = await prisma.notification.findMany({
        where: { deliveries: { none: {} } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true, userId: true, title: true, body: true, data: true },
      });
      if (pending.length === 0) return 0;

      const devices = await prisma.device.findMany({
        where: {
          userId: { in: [...new Set(pending.map((n) => n.userId))] },
          revokedAt: null,
          notificationsEnabled: true,
        },
        select: { id: true, userId: true, token: true, platform: true },
      });

      const messages: {
        notificationId: string;
        deviceId: string;
        token: string;
        platform: 'ANDROID' | 'IOS';
        title: string;
        body: string;
        data: Record<string, string>;
      }[] = [];

      for (const notification of pending) {
        const targets = devices.filter((device) => device.userId === notification.userId);

        if (targets.length === 0) {
          // No device to push to. Recorded as SKIPPED against no device is not
          // possible, so the notification simply stays in the in-app list —
          // which is the point of storing it (§17). Mark it handled by
          // creating no delivery and excluding it next time via createdAt.
          continue;
        }

        for (const device of targets) {
          messages.push({
            notificationId: notification.id,
            deviceId: device.id,
            token: device.token,
            platform: device.platform,
            title: notification.title,
            body: notification.body,
            data: notification.data as Record<string, string>,
          });
        }
      }

      if (messages.length === 0) return 0;

      const results = await pushSender().send(
        messages.map((m) => ({ token: m.token, title: m.title, body: m.body, data: m.data })),
      );

      const deadTokens: string[] = [];
      let rejectedIosCount = 0;
      let sent = 0;

      for (const [index, result] of results.entries()) {
        const message = messages[index]!;
        const ok = result.ok;
        if (ok) sent += 1;
        if (result.reason === 'INVALID_TOKEN') {
          deadTokens.push(message.token);
          // Counted separately because on iOS this is far more likely to mean
          // "the token is not an FCM token at all" than "this device is gone"
          // — see the warning below.
          if (message.platform === 'IOS') rejectedIosCount += 1;
        }

        await prisma.notificationDelivery.upsert({
          where: {
            notificationId_deviceId: {
              notificationId: message.notificationId,
              deviceId: message.deviceId,
            },
          },
          create: {
            notificationId: message.notificationId,
            deviceId: message.deviceId,
            status: ok ? 'SENT' : 'FAILED',
            attempts: 1,
            messageId: result.messageId ?? null,
            lastError: result.error ?? null,
            sentAt: ok ? new Date() : null,
          },
          update: {
            status: ok ? 'SENT' : 'FAILED',
            attempts: { increment: 1 },
            messageId: result.messageId ?? null,
            lastError: result.error ?? null,
            sentAt: ok ? new Date() : null,
          },
        });
      }

      if (deadTokens.length > 0) {
        // FCM says these will never work again. Revoking stops every future
        // batch carrying a growing tail of dead tokens (§20).
        const revoked = await prisma.device.updateMany({
          where: { token: { in: deadTokens }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        logger.info({ count: revoked.count }, 'Revoked devices rejected by FCM');

        /**
         * An iOS token rejected by FCM is a CONFIGURATION signal, not a dead
         * device, and it must not disappear into the line above.
         *
         * `expo-notifications`' `getDevicePushTokenAsync()` returns an FCM
         * registration token on Android but a raw APNs token on iOS. FCM's
         * v1 API only accepts the former, so an unconfigured iOS build
         * registers a token that is rejected on first send and then revoked
         * here — push silently never works on iOS, and the evidence is
         * cleaned up automatically.
         *
         * Delivering to iOS requires a genuine FCM token, which means
         * registering the iOS app in Firebase, uploading an APNs auth key,
         * and obtaining the token through the Firebase iOS SDK.
         */
        if (rejectedIosCount > 0) {
          logger.error(
            { count: rejectedIosCount },
            'iOS device tokens were rejected by FCM — iOS push is very likely misconfigured (APNs token sent where an FCM token is required)',
          );
        }
      }

      return sent;
    },
  });
}

/** Revokes devices that have not been seen for 90 days. */
export async function runPruneDevices(asOf = todayInNepal()): Promise<JobResult> {
  return runJob({
    name: 'prune-devices',
    runKey: asOf,
    run: async () => {
      const cutoff = new Date(`${addDays(asOf, -90)}T00:00:00.000Z`);
      const result = await prisma.device.updateMany({
        where: { revokedAt: null, lastSeenAt: { lt: cutoff } },
        data: { revokedAt: new Date() },
      });
      return result.count;
    },
  });
}

export async function runJobByName(name: JobName): Promise<JobResult> {
  switch (name) {
    case 'generate-periods':
      return runGeneratePeriods();
    case 'rent-reminders':
      return runRentReminders();
    case 'dispatch-push':
      return runDispatchPush();
    case 'prune-devices':
      return runPruneDevices();
  }
}
