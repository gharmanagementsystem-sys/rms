import { describe, expect, it } from 'vitest';
import { formatAmount, paisa, rupeesToPaisa } from '@rms/shared';
import {
  calculateMeteredCharge,
  chargesComplete,
  planPeriodCharges,
  totalOf,
  type ChargeConfig,
} from './charge-calculator';

const fixed = (
  chargeType: ChargeConfig['chargeType'],
  rupees: number,
  prorationPolicy: ChargeConfig['prorationPolicy'] = 'PRORATE',
): ChargeConfig => ({
  chargeType,
  label: null,
  pricingModel: 'FIXED',
  amountPaisa: rupeesToPaisa(rupees),
  ratePaisaPerUnit: null,
  prorationPolicy,
});

const rent = (rupees: number, prorationPolicy: ChargeConfig['prorationPolicy'] = 'PRORATE') =>
  fixed('RENT', rupees, prorationPolicy);

const metered = (chargeType: ChargeConfig['chargeType'], rupeesPerUnit: number): ChargeConfig => ({
  chargeType,
  label: null,
  pricingModel: 'PER_UNIT',
  amountPaisa: null,
  ratePaisaPerUnit: rupeesToPaisa(rupeesPerUnit),
  // Metered charges carry no policy — usage is the measure.
  prorationPolicy: null,
});

const FULL = { coveredDays: 30, basisDays: 30 };

describe('a full period', () => {
  it('charges fixed amounts in full', () => {
    const charges = planPeriodCharges([rent(15000), fixed('WATER', 500)], FULL);
    expect(charges[0]?.amountPaisa).toBe(1500000);
    expect(charges[1]?.amountPaisa).toBe(50000);
    expect(charges.every((c) => c.isFinalized)).toBe(true);
  });

  it('handles a rental with only rent configured (§45 — optional charges)', () => {
    const charges = planPeriodCharges([rent(9000)], FULL);
    expect(charges).toHaveLength(1);
    expect(totalOf(charges)).toBe(900000);
  });

  it('handles a zero-amount charge without treating it as missing', () => {
    const charges = planPeriodCharges([rent(15000), fixed('WASTE', 0)], FULL);
    expect(charges[1]?.amountPaisa).toBe(0);
    expect(charges[1]?.isFinalized).toBe(true);
    expect(chargesComplete(charges)).toBe(true);
  });
});

describe('metered charges (§60)', () => {
  it('is created unpriced and unfinalized, with the rate snapshotted', () => {
    const charges = planPeriodCharges([rent(15000), metered('ELECTRICITY', 15)], FULL);
    const electricity = charges[1]!;

    expect(electricity.amountPaisa).toBe(0);
    expect(electricity.isFinalized).toBe(false);
    expect(electricity.ratePaisaPerUnit).toBe(1500);
  });

  it('leaves the period incomplete until a reading arrives', () => {
    const charges = planPeriodCharges([rent(15000), metered('ELECTRICITY', 15)], FULL);
    expect(chargesComplete(charges)).toBe(false);
    // The unpriced charge contributes nothing to the total so far.
    expect(totalOf(charges)).toBe(1500000);
  });

  it('prices consumption exactly, with no rounding', () => {
    // 1200 → 1250 at NPR 15/unit = 50 units = NPR 750.
    const result = calculateMeteredCharge({
      previousReading: 1200,
      currentReading: 1250,
      ratePaisaPerUnit: rupeesToPaisa(15),
    });
    expect(result).toEqual({ consumedUnits: 50, amountPaisa: 75000 });
  });

  it('handles a period with no consumption', () => {
    const result = calculateMeteredCharge({
      previousReading: 1200,
      currentReading: 1200,
      ratePaisaPerUnit: 1500,
    });
    expect(result).toEqual({ consumedUnits: 0, amountPaisa: 0 });
  });

  it('refuses a meter that appears to run backwards', () => {
    // A mistyped reading or a replaced meter. Guessing would silently produce
    // a wrong bill.
    expect(() =>
      calculateMeteredCharge({
        previousReading: 1250,
        currentReading: 1200,
        ratePaisaPerUnit: 1500,
      }),
    ).toThrow(RangeError);
  });

  it('refuses fractional or negative readings', () => {
    expect(() =>
      calculateMeteredCharge({ previousReading: 0, currentReading: 10.5, ratePaisaPerUnit: 1500 }),
    ).toThrow(RangeError);
    expect(() =>
      calculateMeteredCharge({ previousReading: -1, currentReading: 10, ratePaisaPerUnit: 1500 }),
    ).toThrow(RangeError);
  });
});

describe('proration of a partly-occupied final period', () => {
  it('prorates rent by days occupied', () => {
    // NPR 15,000 over 10 of 30 days = NPR 5,000.
    const charges = planPeriodCharges([rent(15000)], { coveredDays: 10, basisDays: 30 });
    expect(charges[0]?.amountPaisa).toBe(500000);
  });

  it('prorates every fixed charge whose policy says so', () => {
    const charges = planPeriodCharges(
      [rent(15000), fixed('INTERNET', 1000), fixed('CLEANING', 300)],
      {
        coveredDays: 10,
        basisDays: 30,
      },
    );
    expect(charges.map((c) => c.amountPaisa)).toEqual([500000, 33333, 10000]);
  });

  it('rounds half away from zero, deterministically', () => {
    // 1000 paisa over 1 of 3 days = 333.33… → 333.
    expect(
      planPeriodCharges([{ ...rent(0), amountPaisa: 1000 }], { coveredDays: 1, basisDays: 3 })[0]
        ?.amountPaisa,
    ).toBe(333);
    // 1000 paisa over 1 of 2 days = 500 exactly.
    expect(
      planPeriodCharges([{ ...rent(0), amountPaisa: 1000 }], { coveredDays: 1, basisDays: 2 })[0]
        ?.amountPaisa,
    ).toBe(500);
    // 3 paisa over 1 of 2 days = 1.5 → 2 (half away from zero).
    expect(
      planPeriodCharges([{ ...rent(0), amountPaisa: 3 }], { coveredDays: 1, basisDays: 2 })[0]
        ?.amountPaisa,
    ).toBe(2);
  });

  it('does not prorate a full period', () => {
    const charges = planPeriodCharges([rent(15000)], FULL);
    expect(charges[0]?.amountPaisa).toBe(1500000);
  });

  it('charges nothing for zero days occupied', () => {
    const charges = planPeriodCharges([rent(15000)], { coveredDays: 0, basisDays: 30 });
    expect(charges[0]?.amountPaisa).toBe(0);
  });

  it('rejects impossible proration', () => {
    expect(() => planPeriodCharges([rent(1)], { coveredDays: 31, basisDays: 30 })).toThrow(
      RangeError,
    );
    expect(() => planPeriodCharges([rent(1)], { coveredDays: -1, basisDays: 30 })).toThrow(
      RangeError,
    );
    expect(() => planPeriodCharges([rent(1)], { coveredDays: 1, basisDays: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('per-charge proration policy', () => {
  const partial = { coveredDays: 10, basisDays: 30 };

  it('charges a FULL-policy service in full despite a partial period', () => {
    // An internet line the landlord pays for monthly is not divisible.
    const charges = planPeriodCharges([fixed('INTERNET', 1000, 'FULL')], partial);
    expect(charges[0]?.amountPaisa).toBe(100000);
  });

  it('lets rent be prorated while a service stays full, on the same rental', () => {
    const charges = planPeriodCharges(
      [
        rent(15000, 'PRORATE'),
        fixed('INTERNET', 1000, 'FULL'),
        fixed('WATER', 600, 'PRORATE'),
        fixed('CLEANING', 300, 'FULL'),
      ],
      partial,
    );

    expect(charges.map((c) => [c.chargeType, c.amountPaisa])).toEqual([
      ['RENT', 500000], // 15,000 × 10/30
      ['INTERNET', 100000], // full
      ['WATER', 20000], // 600 × 10/30
      ['CLEANING', 30000], // full
    ]);
  });

  it('supports rent itself being FULL', () => {
    // Some tenancies charge the whole month regardless of the leaving date.
    const charges = planPeriodCharges([rent(15000, 'FULL')], partial);
    expect(charges[0]?.amountPaisa).toBe(1500000);
  });

  it('never prorates a metered charge, whatever the occupancy', () => {
    // Consumption is already proportional; prorating would discount twice.
    const charges = planPeriodCharges([metered('ELECTRICITY', 15)], partial);
    expect(charges[0]?.prorationPolicy).toBeNull();
    expect(
      calculateMeteredCharge({
        previousReading: 0,
        currentReading: 50,
        ratePaisaPerUnit: charges[0]!.ratePaisaPerUnit!,
      }).amountPaisa,
    ).toBe(75000); // full 50 units, not 50 × 10/30
  });

  it('defaults to PRORATE when no policy is configured', () => {
    const charges = planPeriodCharges([{ ...fixed('WATER', 600), prorationPolicy: null }], partial);
    expect(charges[0]?.prorationPolicy).toBe('PRORATE');
    expect(charges[0]?.amountPaisa).toBe(20000);
  });

  it('snapshots the policy that applied', () => {
    // Without this, changing FULL to PRORATE later would leave no record of
    // which rule produced a past period's figure.
    const charges = planPeriodCharges([rent(15000), fixed('INTERNET', 1000, 'FULL')], partial);
    expect(charges.map((c) => c.prorationPolicy)).toEqual(['PRORATE', 'FULL']);
  });

  it('makes no difference on a full period', () => {
    const prorated = planPeriodCharges([fixed('INTERNET', 1000, 'PRORATE')], FULL);
    const full = planPeriodCharges([fixed('INTERNET', 1000, 'FULL')], FULL);
    expect(prorated[0]?.amountPaisa).toBe(full[0]?.amountPaisa);
  });
});

describe('historical pricing (§3.3, §45)', () => {
  it('a snapshot is unaffected by a later price change', () => {
    const january = planPeriodCharges([metered('ELECTRICITY', 15)], FULL);
    // The landlord raises the rate to NPR 20/unit in February.
    const february = planPeriodCharges([metered('ELECTRICITY', 20)], FULL);

    expect(january[0]?.ratePaisaPerUnit).toBe(1500);
    expect(february[0]?.ratePaisaPerUnit).toBe(2000);

    // January's 50 units are still priced at January's rate.
    expect(
      calculateMeteredCharge({
        previousReading: 0,
        currentReading: 50,
        ratePaisaPerUnit: january[0]!.ratePaisaPerUnit!,
      }).amountPaisa,
    ).toBe(75000);
  });
});

describe('the worked example from CLAUDE.md §61', () => {
  it('produces a breakdown that adds up to NPR 17,750', () => {
    const charges = planPeriodCharges(
      [
        rent(15000),
        fixed('WATER', 500),
        fixed('INTERNET', 1000),
        fixed('WASTE', 200),
        fixed('CLEANING', 300),
      ],
      FULL,
    );

    const electricity = calculateMeteredCharge({
      previousReading: 1200,
      currentReading: 1250,
      ratePaisaPerUnit: rupeesToPaisa(15),
    });

    const total = totalOf(charges) + electricity.amountPaisa;

    expect(electricity).toEqual({ consumedUnits: 50, amountPaisa: 75000 });
    expect(total).toBe(1775000);
    expect(formatAmount(paisa(total))).toBe('रु 17,750');

    // Every line is inspectable — the user is never shown only a total (§61).
    expect(charges.map((c) => [c.chargeType, c.amountPaisa])).toEqual([
      ['RENT', 1500000],
      ['WATER', 50000],
      ['INTERNET', 100000],
      ['WASTE', 20000],
      ['CLEANING', 30000],
    ]);
  });
});

describe('malformed configuration', () => {
  it('refuses a fixed charge with no amount', () => {
    expect(() => planPeriodCharges([{ ...rent(0), amountPaisa: null }], FULL)).toThrow(TypeError);
  });

  it('refuses a per-unit charge with no rate', () => {
    expect(() =>
      planPeriodCharges([{ ...metered('ELECTRICITY', 0), ratePaisaPerUnit: null }], FULL),
    ).toThrow(TypeError);
  });
});
