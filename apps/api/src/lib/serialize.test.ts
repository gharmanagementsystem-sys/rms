import { describe, expect, it } from 'vitest';
import { numberToPaisa, optionalPaisaToNumber, paisaToNumber } from './serialize';

describe('paisa serialization', () => {
  it('converts a bigint amount to a number', () => {
    expect(paisaToNumber(1500000n)).toBe(1500000);
    expect(paisaToNumber(0n)).toBe(0);
  });

  it('throws rather than silently truncating an out-of-range amount', () => {
    // Silently losing precision on a monetary value is the one failure a rent
    // ledger must not have, so the bound is asserted rather than assumed.
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() => paisaToNumber(tooBig)).toThrow(RangeError);
  });

  it('round-trips through the API boundary', () => {
    expect(paisaToNumber(numberToPaisa(1775000))).toBe(1775000);
  });

  it('rejects fractional paisa on the way in', () => {
    expect(() => numberToPaisa(150.5)).toThrow(RangeError);
  });

  it('passes null through unchanged', () => {
    expect(optionalPaisaToNumber(null)).toBeNull();
    expect(optionalPaisaToNumber(500n)).toBe(500);
  });

  it('a JSON response containing a raw bigint would throw — which is why this exists', () => {
    expect(() => JSON.stringify({ amountPaisa: 1500000n })).toThrow(TypeError);
    expect(JSON.stringify({ amountPaisa: paisaToNumber(1500000n) })).toBe(
      '{"amountPaisa":1500000}',
    );
  });
});
