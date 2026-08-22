import type { MidPeriodEndPolicy } from '@rms/shared';
import { addDays, compareDates, daysBetween, type BusinessDate } from '../../lib/business-date';

/**
 * Rent period generation. CLAUDE.md §13, §16, ADR 0001.
 *
 * PURE: no database, no clock, no I/O. `asOf` is always passed in. That is what
 * makes the critical accounting matrix (§45) testable in milliseconds with no
 * fixtures, and it is why this file must never import from `db/`.
 *
 * Periods are FIXED-DURATION spans of elapsed days measured from the rental
 * start date — 30 for MONTHLY, 365 for YEARLY. There is no calendar-month,
 * month-end, February or leap-year logic anywhere in this file, by design.
 */

export interface PeriodPlan {
  /** 1-based and dense. The idempotency key for generation. */
  sequenceNumber: number;
  /** Inclusive first day. */
  periodStart: BusinessDate;
  /** Inclusive last day actually covered — truncated if the rental ended. */
  periodEnd: BusinessDate;
  /** The day rent falls due for this period. */
  dueDate: BusinessDate;
  /** Days the tenant is charged for. Equals `basisDays` for a full period. */
  coveredDays: number;
  /** The rental's full period length, i.e. the proration denominator. */
  basisDays: number;
  isProrated: boolean;
  /** True when this is the last period the rental will ever have. */
  isFinal: boolean;
}

export interface PlanPeriodsInput {
  startDate: BusinessDate;
  /** 30 or 365. Snapshotted on the rental, never re-derived from a constant. */
  periodDays: number;
  /** Days after the period starts that rent falls due. */
  dueOffsetDays: number;
  /** Inclusive last day of tenancy, once the rental has ended. */
  endDate?: BusinessDate | undefined;
  /** How to treat a final period the tenant only partly occupied. */
  midPeriodEndPolicy: MidPeriodEndPolicy;
  /** "Today" in Nepal Standard Time. Periods are generated on arrival. */
  asOf: BusinessDate;
}

/**
 * Hard ceiling on how many periods one call may produce.
 *
 * Protects against a corrupt `periodDays` or a nonsensical start date turning
 * generation into an unbounded loop. 200 years of monthly periods is far beyond
 * any real tenancy, so hitting this means the data is wrong, not the limit.
 */
const MAX_PERIODS = 2500;

/**
 * Plans every period that should exist for a rental as at `asOf`.
 *
 * Periods are generated **on arrival**: a period appears once its start date has
 * been reached, never in advance. That removes an entire class of bug — a
 * charge configuration changed today cannot retroactively alter an
 * already-generated future period, because there are none (§3.3).
 *
 * Deterministic and total: calling it repeatedly with the same inputs produces
 * an identical list, which is what makes the generation job idempotent (§16).
 */
export function planPeriods(input: PlanPeriodsInput): PeriodPlan[] {
  const { startDate, periodDays, dueOffsetDays, endDate, midPeriodEndPolicy, asOf } = input;

  if (!Number.isInteger(periodDays) || periodDays <= 0) {
    throw new RangeError(`periodDays must be a positive whole number, received ${periodDays}`);
  }
  if (!Number.isInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays >= periodDays) {
    throw new RangeError(
      `dueOffsetDays must be between 0 and ${periodDays - 1}, received ${dueOffsetDays}`,
    );
  }
  if (endDate && compareDates(endDate, startDate) < 0) {
    throw new RangeError('endDate cannot precede startDate');
  }

  const periods: PeriodPlan[] = [];

  for (let sequenceNumber = 1; sequenceNumber <= MAX_PERIODS; sequenceNumber += 1) {
    // Computed from the ORIGINAL start date rather than by stepping from the
    // previous period, so a period's boundaries never depend on how many times
    // this loop has run.
    const periodStart = addDays(startDate, (sequenceNumber - 1) * periodDays);

    // A period exists only once it has begun.
    if (compareDates(periodStart, asOf) > 0) break;

    // Nothing starts after the tenancy has ended.
    if (endDate && compareDates(periodStart, endDate) > 0) break;

    // Explicit inclusive boundary: end = start + (periodDays - 1).
    const fullPeriodEnd = addDays(periodStart, periodDays - 1);
    const endsInsideThisPeriod = endDate !== undefined && compareDates(endDate, fullPeriodEnd) < 0;

    if (!endsInsideThisPeriod) {
      const isFinal = endDate !== undefined && compareDates(endDate, fullPeriodEnd) === 0;
      periods.push({
        sequenceNumber,
        periodStart,
        periodEnd: fullPeriodEnd,
        dueDate: addDays(periodStart, dueOffsetDays),
        coveredDays: periodDays,
        basisDays: periodDays,
        isProrated: false,
        isFinal,
      });
      if (isFinal) break;
      continue;
    }

    // Final, partly-occupied period.
    if (midPeriodEndPolicy === 'FULL_PERIOD') {
      // The tenant is charged for the whole period despite leaving early. The
      // covered range still records what was actually occupied.
      periods.push({
        sequenceNumber,
        periodStart,
        periodEnd: fullPeriodEnd,
        dueDate: addDays(periodStart, dueOffsetDays),
        coveredDays: periodDays,
        basisDays: periodDays,
        isProrated: false,
        isFinal: true,
      });
    } else {
      const coveredDays = daysBetween(periodStart, endDate) + 1;
      periods.push({
        sequenceNumber,
        periodStart,
        periodEnd: endDate,
        dueDate: addDays(periodStart, dueOffsetDays),
        coveredDays,
        basisDays: periodDays,
        isProrated: coveredDays < periodDays,
        isFinal: true,
      });
    }
    break;
  }

  return periods;
}

/**
 * The periods missing from what already exists.
 *
 * Generation is expressed as a diff rather than an insert so that running the
 * job twice, or running it after a manual backfill, adds nothing the second
 * time. The unique constraint on (rentalId, sequenceNumber) is the real
 * guarantee; this keeps the common path from even attempting a duplicate (§16).
 */
export function periodsToCreate(
  planned: PeriodPlan[],
  existingSequenceNumbers: Iterable<number>,
): PeriodPlan[] {
  const existing = new Set(existingSequenceNumbers);
  return planned.filter((period) => !existing.has(period.sequenceNumber));
}
