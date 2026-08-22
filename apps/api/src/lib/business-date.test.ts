import { describe, expect, it } from 'vitest';
import { MONTHLY_PERIOD_DAYS, YEARLY_PERIOD_DAYS } from '@rms/shared';
import {
  addDays,
  compareDates,
  daysBetween,
  fromDbDate,
  isBusinessDate,
  toDbDate,
  todayInNepal,
} from './business-date';

describe('business date validation', () => {
  it('accepts real dates', () => {
    expect(isBusinessDate('2026-08-16')).toBe(true);
    expect(isBusinessDate('2028-02-29')).toBe(true); // leap year
  });

  it('rejects dates that do not exist', () => {
    expect(isBusinessDate('2026-02-30')).toBe(false);
    expect(isBusinessDate('2027-02-29')).toBe(false); // not a leap year
    expect(isBusinessDate('2026-13-01')).toBe(false);
    expect(isBusinessDate('16-08-2026')).toBe(false);
  });
});

describe('database round trip', () => {
  it('survives conversion in both directions', () => {
    expect(fromDbDate(toDbDate('2026-08-16'))).toBe('2026-08-16');
  });

  it('does not shift the day despite the UTC+05:45 offset', () => {
    // The trap this module exists to prevent: a naive local-time conversion
    // moves a Nepali business date by a day for part of every day.
    expect(fromDbDate(toDbDate('2026-01-01'))).toBe('2026-01-01');
    expect(fromDbDate(toDbDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('addDays — the only way periods advance', () => {
  it('adds whole days', () => {
    expect(addDays('2026-08-01', 1)).toBe('2026-08-02');
    expect(addDays('2026-08-01', 0)).toBe('2026-08-01');
    expect(addDays('2026-08-02', -1)).toBe('2026-08-01');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses 29 February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('skips 29 February in a non-leap year', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});

describe('fixed-duration period boundaries (ADR 0001)', () => {
  /**
   * A period is a fixed span of elapsed days with explicit inclusive
   * boundaries: end = start + (periodDays - 1), and the next period starts the
   * following day. These assertions are the guarantee that a period is always
   * exactly 30 or 365 days regardless of which months it spans.
   */
  const periodEnd = (start: string, days: number) => addDays(start, days - 1);
  const nextStart = (start: string, days: number) => addDays(periodEnd(start, days), 1);

  it('a monthly period is exactly 30 days, inclusive', () => {
    const start = '2026-08-01';
    const end = periodEnd(start, MONTHLY_PERIOD_DAYS);
    expect(end).toBe('2026-08-30');
    expect(daysBetween(start, end) + 1).toBe(30);
  });

  it('stays 30 days when it spans a 28-day February', () => {
    const start = '2027-02-15';
    const end = periodEnd(start, MONTHLY_PERIOD_DAYS);
    expect(daysBetween(start, end) + 1).toBe(30);
    expect(end).toBe('2027-03-16');
  });

  it('stays 30 days when it spans 29 February in a leap year', () => {
    const start = '2028-02-15';
    const end = periodEnd(start, MONTHLY_PERIOD_DAYS);
    expect(daysBetween(start, end) + 1).toBe(30);
    expect(end).toBe('2028-03-15');
  });

  it('stays 30 days when it spans a 31-day month', () => {
    const start = '2026-07-20';
    expect(daysBetween(start, periodEnd(start, MONTHLY_PERIOD_DAYS)) + 1).toBe(30);
  });

  it('a rental starting on the 31st behaves like any other', () => {
    const start = '2026-01-31';
    expect(daysBetween(start, periodEnd(start, MONTHLY_PERIOD_DAYS)) + 1).toBe(30);
    expect(periodEnd(start, MONTHLY_PERIOD_DAYS)).toBe('2026-03-01');
  });

  it('a yearly period is exactly 365 days, inclusive', () => {
    const start = '2026-08-01';
    expect(daysBetween(start, periodEnd(start, YEARLY_PERIOD_DAYS)) + 1).toBe(365);
    expect(periodEnd(start, YEARLY_PERIOD_DAYS)).toBe('2027-07-31');
  });

  it('a yearly period containing 29 February still ends 365 days later', () => {
    const start = '2027-06-01';
    const end = periodEnd(start, YEARLY_PERIOD_DAYS);
    expect(daysBetween(start, end) + 1).toBe(365);
    // Because 2028 is a leap year, the end lands a day "earlier" in the
    // calendar than a naive same-day-next-year would give. That is expected.
    expect(end).toBe('2028-05-30');
  });

  it('consecutive periods are contiguous and never overlap', () => {
    let start = '2026-08-01';
    const seen: Array<[string, string]> = [];

    for (let i = 0; i < 24; i += 1) {
      const end = periodEnd(start, MONTHLY_PERIOD_DAYS);
      seen.push([start, end]);
      start = nextStart(start, MONTHLY_PERIOD_DAYS);
    }

    for (let i = 0; i < seen.length; i += 1) {
      const [periodStart, end] = seen[i]!;
      expect(daysBetween(periodStart, end) + 1).toBe(30);
      if (i > 0) {
        const previousEnd = seen[i - 1]![1];
        expect(daysBetween(previousEnd, periodStart)).toBe(1);
        expect(compareDates(periodStart, previousEnd)).toBe(1);
      }
    }
  });

  it('period start dates drift through the calendar, as designed', () => {
    // The accepted cost of fixed-duration billing: the due date walks
    // backwards through the month rather than staying on the 1st.
    let start = '2026-08-01';
    for (let i = 0; i < 12; i += 1) start = nextStart(start, MONTHLY_PERIOD_DAYS);
    expect(start).toBe('2027-07-27');
  });
});

describe('todayInNepal', () => {
  it('uses Nepal Standard Time, not the server timezone', () => {
    // 2026-08-16T19:00Z is already 2026-08-17 in Kathmandu (UTC+05:45).
    expect(todayInNepal(new Date('2026-08-16T19:00:00.000Z'))).toBe('2026-08-17');
    // 2026-08-16T18:00Z is still 2026-08-16 there (23:45 local).
    expect(todayInNepal(new Date('2026-08-16T18:00:00.000Z'))).toBe('2026-08-16');
  });
});
