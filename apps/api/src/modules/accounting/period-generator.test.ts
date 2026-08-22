import { describe, expect, it } from 'vitest';
import { MONTHLY_PERIOD_DAYS, YEARLY_PERIOD_DAYS } from '@rms/shared';
import { daysBetween } from '../../lib/business-date';
import { periodsToCreate, planPeriods, type PlanPeriodsInput } from './period-generator';

/**
 * The critical accounting matrix (CLAUDE.md §45), rewritten for fixed-duration
 * periods. The question is never "what does the calendar do here" but "is this
 * period still exactly 30 (or 365) days".
 */

const monthly = (overrides: Partial<PlanPeriodsInput> = {}): PlanPeriodsInput => ({
  startDate: '2026-08-01',
  periodDays: MONTHLY_PERIOD_DAYS,
  dueOffsetDays: 0,
  midPeriodEndPolicy: 'PRORATE',
  asOf: '2026-08-01',
  ...overrides,
});

const lengthOf = (p: { periodStart: string; periodEnd: string }) =>
  daysBetween(p.periodStart, p.periodEnd) + 1;

describe('period boundaries', () => {
  it('generates the first period on the day the rental starts', () => {
    const periods = planPeriods(monthly());
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      sequenceNumber: 1,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-30',
      dueDate: '2026-08-01',
      coveredDays: 30,
      isProrated: false,
    });
  });

  it('generates nothing before the rental starts', () => {
    expect(planPeriods(monthly({ asOf: '2026-07-31' }))).toHaveLength(0);
  });

  it('generates a period only once its start date has arrived', () => {
    // Period 2 starts 2026-08-31.
    expect(planPeriods(monthly({ asOf: '2026-08-30' }))).toHaveLength(1);
    expect(planPeriods(monthly({ asOf: '2026-08-31' }))).toHaveLength(2);
  });

  it('uses explicit inclusive boundaries with no gap or overlap', () => {
    const periods = planPeriods(monthly({ asOf: '2027-08-01' }));

    for (const period of periods) {
      expect(lengthOf(period)).toBe(30);
    }
    for (let i = 1; i < periods.length; i += 1) {
      expect(daysBetween(periods[i - 1]!.periodEnd, periods[i]!.periodStart)).toBe(1);
    }
  });

  it('numbers periods densely from 1', () => {
    const periods = planPeriods(monthly({ asOf: '2027-08-01' }));
    expect(periods.map((p) => p.sequenceNumber)).toEqual(
      Array.from({ length: periods.length }, (_, i) => i + 1),
    );
  });
});

describe('calendar edge cases that fixed-duration billing removes', () => {
  it.each([
    ['spans a 28-day February', '2027-02-01'],
    ['spans 29 February in a leap year', '2028-02-01'],
    ['spans a 31-day month', '2026-07-01'],
    ['starts on the 31st', '2026-01-31'],
    ['starts on 29 February', '2028-02-29'],
    ['starts on the last day of the year', '2026-12-31'],
  ])('a monthly period that %s is still exactly 30 days', (_case, startDate) => {
    const periods = planPeriods(monthly({ startDate, asOf: '2029-01-01' }));
    for (const period of periods) {
      expect(lengthOf(period)).toBe(30);
    }
  });

  it('a yearly period is exactly 365 days even across a leap year', () => {
    const periods = planPeriods(
      monthly({
        startDate: '2027-06-01',
        periodDays: YEARLY_PERIOD_DAYS,
        asOf: '2029-01-01',
      }),
    );
    expect(periods[0]).toMatchObject({ periodStart: '2027-06-01', periodEnd: '2028-05-30' });
    for (const period of periods) {
      expect(lengthOf(period)).toBe(365);
    }
  });

  it('start dates drift through the calendar, as designed', () => {
    const periods = planPeriods(monthly({ asOf: '2027-08-01' }));
    // Twelve periods after 2026-08-01, not "the 1st of every month".
    expect(periods[12]?.periodStart).toBe('2027-07-27');
  });
});

describe('due dates', () => {
  it('falls on the first day of the period by default', () => {
    expect(planPeriods(monthly())[0]?.dueDate).toBe('2026-08-01');
  });

  it('honours a configured offset', () => {
    expect(planPeriods(monthly({ dueOffsetDays: 5 }))[0]?.dueDate).toBe('2026-08-06');
  });

  it('rejects an offset that would fall outside the period', () => {
    expect(() => planPeriods(monthly({ dueOffsetDays: 30 }))).toThrow(RangeError);
  });
});

describe('a rental that has ended', () => {
  it('stops generating once the tenancy is over', () => {
    // Ends inside period 2 (2026-08-31 → 2026-09-29).
    const periods = planPeriods(monthly({ endDate: '2026-09-10', asOf: '2027-01-01' }));
    expect(periods).toHaveLength(2);
    expect(periods[1]?.isFinal).toBe(true);
  });

  it('prorates the final period by default', () => {
    const periods = planPeriods(monthly({ endDate: '2026-09-10', asOf: '2027-01-01' }));
    const final = periods[1]!;
    // 2026-08-31 to 2026-09-10 inclusive is 11 days of a 30-day period.
    expect(final).toMatchObject({
      periodStart: '2026-08-31',
      periodEnd: '2026-09-10',
      coveredDays: 11,
      basisDays: 30,
      isProrated: true,
    });
  });

  it('charges the whole final period when the policy says so', () => {
    const periods = planPeriods(
      monthly({ endDate: '2026-09-10', midPeriodEndPolicy: 'FULL_PERIOD', asOf: '2027-01-01' }),
    );
    const final = periods[1]!;
    expect(final).toMatchObject({
      periodEnd: '2026-09-29',
      coveredDays: 30,
      isProrated: false,
      isFinal: true,
    });
  });

  it('does not prorate when the tenancy ends exactly on a period boundary', () => {
    const periods = planPeriods(monthly({ endDate: '2026-08-30', asOf: '2027-01-01' }));
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ isProrated: false, coveredDays: 30, isFinal: true });
  });

  it('handles a tenancy lasting a single day', () => {
    const periods = planPeriods(monthly({ endDate: '2026-08-01', asOf: '2027-01-01' }));
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ coveredDays: 1, basisDays: 30, isProrated: true });
  });

  it('generates no period that starts after the tenancy ended', () => {
    // §45 — "rental ended before next period".
    const periods = planPeriods(monthly({ endDate: '2026-08-30', asOf: '2027-06-01' }));
    expect(periods).toHaveLength(1);
  });

  it('rejects an end date before the start date', () => {
    expect(() => planPeriods(monthly({ endDate: '2026-07-01' }))).toThrow(RangeError);
  });
});

describe('idempotency (§16)', () => {
  it('is deterministic — identical inputs give an identical plan', () => {
    const input = monthly({ asOf: '2027-02-01' });
    expect(planPeriods(input)).toEqual(planPeriods(input));
  });

  it('a second run of the generation job creates nothing', () => {
    const planned = planPeriods(monthly({ asOf: '2027-02-01' }));
    const existing = planned.map((p) => p.sequenceNumber);

    expect(periodsToCreate(planned, [])).toHaveLength(planned.length);
    // Running the job again against the same data is a no-op.
    expect(periodsToCreate(planned, existing)).toHaveLength(0);
    expect(periodsToCreate(planned, existing)).toHaveLength(0);
  });

  it('backfills only what is missing after a gap', () => {
    const planned = planPeriods(monthly({ asOf: '2027-02-01' }));
    // The job was down; periods 3 and 4 never got written.
    const existing = planned.map((p) => p.sequenceNumber).filter((n) => n !== 3 && n !== 4);

    const missing = periodsToCreate(planned, existing);
    expect(missing.map((p) => p.sequenceNumber)).toEqual([3, 4]);
  });

  it('a long outage is recovered in one pass', () => {
    // Nothing generated for two years; the next run fills every period.
    const planned = planPeriods(monthly({ asOf: '2028-08-01' }));
    expect(planned.length).toBeGreaterThan(24);
    expect(periodsToCreate(planned, [])).toHaveLength(planned.length);
  });
});

describe('guards', () => {
  it('rejects a non-positive period length', () => {
    expect(() => planPeriods(monthly({ periodDays: 0 }))).toThrow(RangeError);
    expect(() => planPeriods(monthly({ periodDays: -30 }))).toThrow(RangeError);
  });

  it('does not run unbounded for an absurdly old start date', () => {
    const periods = planPeriods(monthly({ startDate: '1900-01-01', asOf: '2026-08-01' }));
    expect(periods.length).toBeLessThanOrEqual(2500);
  });
});
