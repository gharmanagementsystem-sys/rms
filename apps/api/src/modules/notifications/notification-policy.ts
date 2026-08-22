import { addDays, compareDates, daysBetween, type BusinessDate } from '../../lib/business-date';

/**
 * When a rent notification is due, and what identifies it uniquely.
 * CLAUDE.md §18.
 *
 * PURE: no database, no clock, no I/O. The scheduled job supplies `asOf`.
 *
 * Keeping this separate from the job is what allows deduplication to be proven
 * by test rather than hoped for — the job itself is only orchestration.
 */

export type RentNotificationType = 'RENT_DUE_SOON' | 'RENT_DUE_TODAY' | 'RENT_OVERDUE';

export interface PeriodNotificationInput {
  periodId: string;
  rentalId: string;
  dueDate: BusinessDate;
  /** Outstanding balance in paisa. Nothing owed means nothing to chase. */
  balancePaisa: number;
  /** Grace days after the due date before the period counts as overdue. */
  overdueAfterDays: number;
  /**
   * Days before the due date on which to remind, from the user's preferences.
   * A 0 means "on the due date itself".
   */
  reminderDays: readonly number[];
  asOf: BusinessDate;
}

export interface PlannedNotification {
  type: RentNotificationType;
  periodId: string;
  rentalId: string;
  /**
   * The day this notification fires.
   *
   * Deliberately the firing day rather than the due date. Keying a reminder to
   * the due date would give the 7-day and 1-day reminders the SAME key, so the
   * second would be silently swallowed as a duplicate and the tenant would
   * never be reminded again. Using the firing day keeps every reminder
   * distinct while staying stable across repeated runs on the same day.
   */
  targetDate: BusinessDate;
  /**
   * `TYPE:periodId:targetDate` — unique per logical notification.
   *
   * This is the whole deduplication mechanism (§18). Running the scheduler
   * hourly must not produce "rent due" at 10:00, 11:00 and 12:00, and a unique
   * constraint on this key is what guarantees it, independently of how many
   * times the job runs or how many instances run it.
   */
  dedupeKey: string;
  /** Days until due; negative once past. Used to compose the message. */
  daysUntilDue: number;
}

/**
 * How often an unpaid period is chased once it is overdue.
 *
 * Weekly rather than daily: a tenant who is late already knows, and a daily
 * push is how an app gets its notifications turned off entirely.
 */
const OVERDUE_REPEAT_DAYS = 7;

function key(type: RentNotificationType, periodId: string, targetDate: BusinessDate): string {
  return `${type}:${periodId}:${targetDate}`;
}

/**
 * Decides which notifications a single period warrants today.
 *
 * Returns at most one: a period is either approaching, due, or late, and
 * sending two messages about the same money on the same day is noise.
 */
export function planPeriodNotifications(input: PeriodNotificationInput): PlannedNotification[] {
  const { periodId, rentalId, dueDate, balancePaisa, overdueAfterDays, reminderDays, asOf } = input;

  // Nothing owed, nothing to say.
  if (balancePaisa <= 0) return [];

  const daysUntilDue = daysBetween(asOf, dueDate);
  const base = { periodId, rentalId, daysUntilDue };

  // Due today.
  if (daysUntilDue === 0) {
    return [
      {
        ...base,
        type: 'RENT_DUE_TODAY',
        targetDate: dueDate,
        dedupeKey: key('RENT_DUE_TODAY', periodId, dueDate),
      },
    ];
  }

  // Approaching: fires only on the exact configured days, so a user who opens
  // the app on day 5 of a 7-day reminder does not get a stale notice.
  if (daysUntilDue > 0) {
    if (!reminderDays.includes(daysUntilDue)) return [];
    return [
      {
        ...base,
        type: 'RENT_DUE_SOON',
        // The firing day, so a 7-day and a 1-day reminder do not collide.
        targetDate: asOf,
        dedupeKey: key('RENT_DUE_SOON', periodId, asOf),
      },
    ];
  }

  // Past due. Silent during the grace period.
  const graceEnds = addDays(dueDate, overdueAfterDays);
  if (compareDates(asOf, graceEnds) <= 0) return [];

  // Chase on a weekly cadence measured from the end of grace, so the target
  // date — and therefore the key — is stable no matter when the job runs.
  const daysSinceGrace = daysBetween(graceEnds, asOf);
  if (daysSinceGrace % OVERDUE_REPEAT_DAYS !== 0) return [];

  return [
    {
      ...base,
      type: 'RENT_OVERDUE',
      targetDate: asOf,
      dedupeKey: key('RENT_OVERDUE', periodId, asOf),
    },
  ];
}

export interface NotificationContent {
  title: string;
  body: string;
}

/**
 * Message text.
 *
 * Composed as whole sentences per case rather than assembled from fragments,
 * because Nepali word order differs from English and concatenation would not
 * translate (§27). These English strings are the fallback; the client renders
 * a translated version from `type` and `data`.
 */
export function composeContent(
  type: RentNotificationType,
  input: { amountLabel: string; placeLabel: string; daysUntilDue: number },
): NotificationContent {
  const { amountLabel, placeLabel, daysUntilDue } = input;

  switch (type) {
    case 'RENT_DUE_SOON':
      return {
        title: 'Rent due soon',
        body: `${amountLabel} for ${placeLabel} is due in ${daysUntilDue} ${
          daysUntilDue === 1 ? 'day' : 'days'
        }.`,
      };
    case 'RENT_DUE_TODAY':
      return {
        title: 'Rent due today',
        body: `${amountLabel} for ${placeLabel} is due today.`,
      };
    case 'RENT_OVERDUE': {
      const late = Math.abs(daysUntilDue);
      return {
        title: 'Rent overdue',
        body: `${amountLabel} for ${placeLabel} is ${late} ${late === 1 ? 'day' : 'days'} overdue.`,
      };
    }
  }
}

/**
 * The payload the app uses to navigate.
 *
 * Stable identifiers only — never a UI route. The app decides which screen a
 * `rentalId` and `periodId` resolve to, so a navigation change does not
 * invalidate notifications already delivered (§39).
 */
export function buildDeepLinkData(notification: PlannedNotification): Record<string, string> {
  return {
    type: notification.type,
    rentalId: notification.rentalId,
    periodId: notification.periodId,
  };
}
