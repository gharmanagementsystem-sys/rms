import { describe, expect, it } from 'vitest';
import {
  CalendarError,
  adToBs,
  bsToAd,
  formatBs,
  isAdDate,
  todayAd,
  toDevanagariDigits,
} from './index';

describe('AD → BS', () => {
  it('converts a known date', () => {
    // 2026-08-17 AD is 1 Bhadau 2083 BS.
    expect(adToBs('2026-08-17')).toEqual({ year: 2083, month: 5, day: 1 });
  });

  it('handles a Gregorian leap day', () => {
    expect(() => adToBs('2028-02-29')).not.toThrow();
  });

  it('rejects a date that does not exist', () => {
    expect(() => adToBs('2026-02-30')).toThrow(CalendarError);
    expect(() => adToBs('not-a-date')).toThrow(CalendarError);
  });
});

describe('BS → AD', () => {
  it('converts back to the wire format', () => {
    expect(bsToAd({ year: 2083, month: 5, day: 1 })).toBe('2026-08-17');
  });

  it('rejects an impossible month or day', () => {
    expect(() => bsToAd({ year: 2083, month: 13, day: 1 })).toThrow(CalendarError);
    expect(() => bsToAd({ year: 2083, month: 0, day: 1 })).toThrow(CalendarError);
    expect(() => bsToAd({ year: 2083, month: 5, day: 33 })).toThrow(CalendarError);
  });
});

describe('round trip', () => {
  it('survives conversion in both directions across a year', () => {
    // Every 11th day of 2026, so months of differing BS length are covered.
    for (let day = 1; day <= 365; day += 11) {
      const ad = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
      expect(bsToAd(adToBs(ad))).toBe(ad);
    }
  });

  it('handles BS months of 29, 30, 31 and 32 days without drifting', () => {
    // BS month lengths vary; a round trip is the strongest check that the
    // table is being applied rather than a fixed month length assumed.
    for (const ad of ['2026-04-14', '2026-05-15', '2026-06-15', '2026-12-16', '2027-03-14']) {
      expect(bsToAd(adToBs(ad))).toBe(ad);
    }
  });
});

describe('formatting', () => {
  it('reads naturally in English', () => {
    expect(formatBs('2026-08-17')).toBe('1 Bhadau 2083');
  });

  it('uses Devanagari month names and numerals in Nepali', () => {
    expect(formatBs('2026-08-17', { locale: 'ne' })).toBe('१ भदौ २०८३');
  });

  it('supports a short numeric style', () => {
    expect(formatBs('2026-08-17', { style: 'short' })).toBe('2083-05-01');
    expect(formatBs('2026-08-17', { style: 'short', locale: 'ne' })).toBe('२०८३-०५-०१');
  });

  it('converts digits without touching anything else', () => {
    expect(toDevanagariDigits('NPR 1,500')).toBe('NPR १,५००');
  });
});

describe('todayAd', () => {
  it('uses Nepal Standard Time, not the device timezone', () => {
    // 19:00Z is already the next day in Kathmandu (UTC+05:45).
    expect(todayAd(new Date('2026-08-16T19:00:00.000Z'))).toBe('2026-08-17');
    expect(todayAd(new Date('2026-08-16T18:00:00.000Z'))).toBe('2026-08-16');
  });
});

describe('AD is the wire format', () => {
  it('validates what the API will accept', () => {
    expect(isAdDate('2026-08-17')).toBe(true);
    expect(isAdDate('2083-05-01')).toBe(true); // structurally valid AD, even if odd
    expect(isAdDate('2026-13-01')).toBe(false);
    expect(isAdDate('17/08/2026')).toBe(false);
  });

  it('produces a string the server can parse directly', () => {
    // What a date picker would send after the user chose 1 Bhadau 2083.
    const wire = bsToAd({ year: 2083, month: 5, day: 1 });
    expect(isAdDate(wire)).toBe(true);
    expect(wire).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
