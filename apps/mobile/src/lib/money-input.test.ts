import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_PAISA,
  normalizeAmountText,
  paisaToInputText,
  parseRupeesToPaisa,
} from './money-input';

describe('parseRupeesToPaisa', () => {
  it('reads whole rupees', () => {
    expect(parseRupeesToPaisa('15000')).toEqual({ ok: true, paisa: 1_500_000 });
  });

  it('reads two decimal places as paisa', () => {
    expect(parseRupeesToPaisa('1500.75')).toEqual({ ok: true, paisa: 150_075 });
  });

  it('pads a single decimal place, so 5.5 is fifty paisa not five', () => {
    expect(parseRupeesToPaisa('5.5')).toEqual({ ok: true, paisa: 550 });
  });

  it('does not lose a paisa to floating point', () => {
    // The whole reason this parser exists: Math.round(1.005 * 100) is 100,
    // because 1.005 * 100 is 100.49999999999999 in IEEE 754.
    expect(parseRupeesToPaisa('1.005')).toEqual({ ok: false, reason: 'TOO_MANY_DECIMALS' });
    expect(parseRupeesToPaisa('1.01')).toEqual({ ok: true, paisa: 101 });
    // A value that Math.round(x * 100) also gets wrong on the way down.
    expect(parseRupeesToPaisa('15.07')).toEqual({ ok: true, paisa: 1507 });
  });

  it('accepts a trailing decimal point mid-typing', () => {
    expect(parseRupeesToPaisa('1500.')).toEqual({ ok: true, paisa: 150_000 });
  });

  it('accepts a leading decimal point', () => {
    expect(parseRupeesToPaisa('.5')).toEqual({ ok: true, paisa: 50 });
  });

  it('accepts Devanagari numerals', () => {
    // A Nepali keyboard produces these, and rejecting them would reject a
    // correctly entered amount.
    expect(parseRupeesToPaisa('१५०००')).toEqual({ ok: true, paisa: 1_500_000 });
    expect(parseRupeesToPaisa('१५००.५०')).toEqual({ ok: true, paisa: 150_050 });
  });

  it('accepts grouping separators and spaces', () => {
    expect(parseRupeesToPaisa('1,50,000')).toEqual({ ok: true, paisa: 15_000_000 });
    expect(parseRupeesToPaisa(' 1 500 ')).toEqual({ ok: true, paisa: 150_000 });
  });

  it('rejects an empty or meaningless entry', () => {
    expect(parseRupeesToPaisa('')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parseRupeesToPaisa('   ')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parseRupeesToPaisa('.')).toEqual({ ok: false, reason: 'NOT_A_NUMBER' });
  });

  it('rejects anything that is not a plain positive number', () => {
    expect(parseRupeesToPaisa('abc')).toEqual({ ok: false, reason: 'NOT_A_NUMBER' });
    expect(parseRupeesToPaisa('-500')).toEqual({ ok: false, reason: 'NOT_A_NUMBER' });
    expect(parseRupeesToPaisa('1e5')).toEqual({ ok: false, reason: 'NOT_A_NUMBER' });
    expect(parseRupeesToPaisa('1.2.3')).toEqual({ ok: false, reason: 'NOT_A_NUMBER' });
  });

  it('rejects more than two decimal places rather than rounding them away', () => {
    // Silently rounding would charge a different amount than the one on screen.
    expect(parseRupeesToPaisa('100.456')).toEqual({ ok: false, reason: 'TOO_MANY_DECIMALS' });
  });

  it('rejects an implausibly large amount', () => {
    expect(parseRupeesToPaisa('99999999999')).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('accepts the documented ceiling exactly', () => {
    const result = parseRupeesToPaisa('100000000');
    expect(result).toEqual({ ok: true, paisa: MAX_INPUT_PAISA });
  });

  it('always produces a safe integer', () => {
    for (const text of ['0', '0.01', '1', '999999.99', '100000000']) {
      const result = parseRupeesToPaisa(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Number.isSafeInteger(result.paisa)).toBe(true);
    }
  });
});

describe('paisaToInputText', () => {
  it('round-trips through the parser', () => {
    for (const value of [0, 1, 99, 100, 150_000, 150_075, 1_500_000]) {
      const result = parseRupeesToPaisa(paisaToInputText(value));
      expect(result).toEqual({ ok: true, paisa: value });
    }
  });

  it('omits paisa when the amount is whole rupees', () => {
    expect(paisaToInputText(150_000)).toBe('1500');
  });

  it('pads a single paisa digit', () => {
    expect(paisaToInputText(150_005)).toBe('1500.05');
  });
});

describe('normalizeAmountText', () => {
  it('leaves an already-plain number untouched', () => {
    expect(normalizeAmountText('1500.50')).toBe('1500.50');
  });
});
