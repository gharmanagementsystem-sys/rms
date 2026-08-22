import { describe, expect, it } from 'vitest';
import {
  addPaisa,
  formatAmount,
  MoneyError,
  multiplyPaisa,
  paisa,
  paisaToRupees,
  prorate,
  rupeesToPaisa,
  subtractPaisa,
} from './money';

describe('paisa()', () => {
  it('accepts whole numbers', () => {
    expect(paisa(0)).toBe(0);
    expect(paisa(1500000)).toBe(1500000);
  });

  it('rejects fractional paisa — there is no such thing', () => {
    expect(() => paisa(10.5)).toThrow(MoneyError);
  });

  it('rejects non-finite and unsafe values', () => {
    expect(() => paisa(Number.NaN)).toThrow(MoneyError);
    expect(() => paisa(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => paisa(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
});

describe('rupeesToPaisa()', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaisa(15000)).toBe(1500000);
  });

  it('survives IEEE 754 representation error for two-decimal amounts', () => {
    // 15.07 * 100 is 1506.9999999999998 in floating point. Truncating would
    // silently lose a paisa on every such amount; rounding recovers it.
    expect(rupeesToPaisa(15.07)).toBe(1507);
    expect(rupeesToPaisa(0.29)).toBe(29);
    expect(rupeesToPaisa(8.11)).toBe(811);
  });

  it('documents the limit: sub-paisa input cannot be represented exactly', () => {
    // 1.005 is not exactly representable; 1.005 * 100 === 100.49999999999999,
    // so this rounds DOWN to 100 despite looking like a half-up case.
    //
    // This is why float rupees must never cross the API boundary. Clients send
    // integer paisa; this helper exists for tests, seeds and display-side
    // conversion of already-validated two-decimal input only.
    expect(rupeesToPaisa(1.005)).toBe(100);
  });

  it('round-trips', () => {
    expect(paisaToRupees(rupeesToPaisa(17750))).toBe(17750);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    // The CLAUDE.md §61 worked example.
    const total = addPaisa(
      rupeesToPaisa(15000), // rent
      rupeesToPaisa(750), // electricity
      rupeesToPaisa(500), // water
      rupeesToPaisa(1000), // internet
      rupeesToPaisa(200), // waste
      rupeesToPaisa(300), // cleaning
    );
    expect(total).toBe(1775000);
    expect(formatAmount(total)).toBe('रु 17,750');

    const balance = subtractPaisa(total, rupeesToPaisa(10000));
    expect(balance).toBe(775000);
    expect(formatAmount(balance)).toBe('रु 7,750');
  });
});

describe('multiplyPaisa()', () => {
  it('computes a per-unit electricity charge', () => {
    // 50 units at NPR 15/unit = NPR 750
    expect(multiplyPaisa(rupeesToPaisa(15), 50)).toBe(75000);
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(multiplyPaisa(paisa(1), 0.5)).toBe(1);
    expect(multiplyPaisa(paisa(-1), 0.5)).toBe(-1);
    expect(multiplyPaisa(paisa(1), 0.49)).toBe(0);
  });
});

describe('prorate()', () => {
  it('prorates a 30-day period', () => {
    // NPR 15,000 rent, tenant left after 10 of 30 days.
    expect(prorate(rupeesToPaisa(15000), 10, 30)).toBe(500000);
  });

  it('returns the full amount when the whole period is occupied', () => {
    expect(prorate(rupeesToPaisa(15000), 30, 30)).toBe(1500000);
  });

  it('returns zero for zero days', () => {
    expect(prorate(rupeesToPaisa(15000), 0, 30)).toBe(0);
  });

  it('rounds half up', () => {
    // 1 paisa over 2 days = 0.5, rounds to 1.
    expect(prorate(paisa(1), 1, 2)).toBe(1);
  });

  it('rejects a non-positive or fractional basis', () => {
    expect(() => prorate(paisa(100), 1, 0)).toThrow(MoneyError);
    expect(() => prorate(paisa(100), 1, -30)).toThrow(MoneyError);
    expect(() => prorate(paisa(100), 1.5, 30)).toThrow(MoneyError);
    expect(() => prorate(paisa(100), -1, 30)).toThrow(MoneyError);
  });
});

describe('formatAmount()', () => {
  it('uses South Asian grouping, not Western', () => {
    // 1,50,000 — one lakh fifty thousand. NOT 150,000.
    expect(formatAmount(rupeesToPaisa(150000), { withSymbol: false })).toBe('1,50,000');
    expect(formatAmount(rupeesToPaisa(1234567.89), { withSymbol: false })).toBe('12,34,567.89');
    expect(formatAmount(rupeesToPaisa(999), { withSymbol: false })).toBe('999');
    expect(formatAmount(rupeesToPaisa(1000), { withSymbol: false })).toBe('1,000');
  });

  it('hides paisa for whole rupee amounts unless asked', () => {
    expect(formatAmount(rupeesToPaisa(500), { withSymbol: false })).toBe('500');
    expect(formatAmount(rupeesToPaisa(500), { withSymbol: false, alwaysShowPaisa: true })).toBe(
      '500.00',
    );
  });

  it('pads paisa to two digits', () => {
    expect(formatAmount(paisa(50005), { withSymbol: false })).toBe('500.05');
  });

  it('renders the currency symbol by default', () => {
    expect(formatAmount(rupeesToPaisa(15000))).toBe('रु 15,000');
  });

  it('renders Devanagari numerals on request', () => {
    expect(formatAmount(rupeesToPaisa(150000), { withSymbol: false, devanagariDigits: true })).toBe(
      '१,५०,०००',
    );
  });

  it('places the sign before the symbol for negatives', () => {
    expect(formatAmount(paisa(-150000))).toBe('-रु 1,500');
  });

  it('formats zero', () => {
    expect(formatAmount(paisa(0), { withSymbol: false })).toBe('0');
  });
});
