import { describe, expect, it } from 'vitest';
import {
  buildCharges,
  fixedChargesTotalPaisa,
  hasMeteredCharge,
  initialChargeDrafts,
} from './charge-draft';

describe('initialChargeDrafts', () => {
  it('enables rent and nothing else', () => {
    const drafts = initialChargeDrafts();
    expect(drafts.RENT.isEnabled).toBe(true);
    expect(drafts.WATER.isEnabled).toBe(false);
    expect(drafts.OTHER.isEnabled).toBe(false);
  });

  it('makes rent a fixed amount, which the schema requires', () => {
    expect(initialChargeDrafts().RENT.pricingModel).toBe('FIXED');
  });

  it('defaults electricity to metered, as it is billed in Nepal', () => {
    expect(initialChargeDrafts().ELECTRICITY.pricingModel).toBe('PER_UNIT');
  });

  it('defaults proration to PRORATE', () => {
    expect(initialChargeDrafts().RENT.prorationPolicy).toBe('PRORATE');
  });
});

describe('buildCharges', () => {
  it('produces rent alone when nothing else is enabled', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';

    const result = buildCharges(drafts);
    expect(result).toEqual({
      ok: true,
      charges: [
        {
          chargeType: 'RENT',
          pricingModel: 'FIXED',
          amountPaisa: 1_500_000,
          prorationPolicy: 'PRORATE',
        },
      ],
    });
  });

  it('never sends a proration policy on a metered charge', () => {
    // The schema rejects it outright: a meter already measures actual usage.
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.ELECTRICITY = { ...drafts.ELECTRICITY, isEnabled: true, rateText: '15' };

    const result = buildCharges(drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const electricity = result.charges.find((charge) => charge.chargeType === 'ELECTRICITY');
    expect(electricity).toEqual({
      chargeType: 'ELECTRICITY',
      pricingModel: 'PER_UNIT',
      ratePaisaPerUnit: 1500,
    });
    expect(electricity).not.toHaveProperty('prorationPolicy');
    expect(electricity).not.toHaveProperty('amountPaisa');
  });

  it('carries a per-charge proration policy through', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    // An internet line the landlord pays for whether or not the tenant was there.
    drafts.INTERNET = {
      ...drafts.INTERNET,
      isEnabled: true,
      amountText: '1000',
      prorationPolicy: 'FULL',
    };

    const result = buildCharges(drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.charges.find((charge) => charge.chargeType === 'INTERNET')).toEqual({
      chargeType: 'INTERNET',
      pricingModel: 'FIXED',
      amountPaisa: 100_000,
      prorationPolicy: 'FULL',
    });
  });

  it('omits a charge that is switched off', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.WATER = { ...drafts.WATER, isEnabled: false, amountText: '500' };

    const result = buildCharges(drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charges.map((charge) => charge.chargeType)).toEqual(['RENT']);
  });

  it('reports the charge that is missing an amount', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '';
    drafts.WATER = { ...drafts.WATER, isEnabled: true, amountText: '' };

    const result = buildCharges(drafts);
    expect(result).toEqual({ ok: false, errors: { RENT: 'EMPTY', WATER: 'EMPTY' } });
  });

  it('reports a metered charge that is missing a rate', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.ELECTRICITY = { ...drafts.ELECTRICITY, isEnabled: true, rateText: '' };

    const result = buildCharges(drafts);
    expect(result).toEqual({ ok: false, errors: { ELECTRICITY: 'EMPTY' } });
  });

  it('requires a name for OTHER, which is the only repeatable type', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.OTHER = { ...drafts.OTHER, isEnabled: true, amountText: '200', label: '  ' };

    const result = buildCharges(drafts);
    expect(result).toEqual({ ok: false, errors: { OTHER: 'MISSING_LABEL' } });
  });

  it('includes the name on OTHER and on no other type', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.OTHER = { ...drafts.OTHER, isEnabled: true, amountText: '200', label: ' Parking ' };

    const result = buildCharges(drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.charges.find((charge) => charge.chargeType === 'OTHER')?.label).toBe('Parking');
    expect(result.charges.find((charge) => charge.chargeType === 'RENT')).not.toHaveProperty(
      'label',
    );
  });

  it('rejects a rent amount with sub-paisa precision rather than rounding it', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000.005';

    expect(buildCharges(drafts)).toEqual({ ok: false, errors: { RENT: 'TOO_MANY_DECIMALS' } });
  });

  it('always emits exactly one rent charge, which the schema demands', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.WATER = { ...drafts.WATER, isEnabled: true, amountText: '500' };
    drafts.INTERNET = { ...drafts.INTERNET, isEnabled: true, amountText: '1000' };

    const result = buildCharges(drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charges.filter((charge) => charge.chargeType === 'RENT')).toHaveLength(1);
  });
});

describe('fixedChargesTotalPaisa', () => {
  it('adds only the enabled fixed charges', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.WATER = { ...drafts.WATER, isEnabled: true, amountText: '500' };
    drafts.CLEANING = { ...drafts.CLEANING, isEnabled: false, amountText: '300' };

    expect(fixedChargesTotalPaisa(drafts)).toBe(1_550_000);
  });

  it('excludes a metered charge, whose amount is genuinely unknown', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    drafts.ELECTRICITY = { ...drafts.ELECTRICITY, isEnabled: true, rateText: '15' };

    expect(fixedChargesTotalPaisa(drafts)).toBe(1_500_000);
  });

  it('ignores an unparseable amount instead of throwing mid-typing', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '150';
    drafts.WATER = { ...drafts.WATER, isEnabled: true, amountText: '' };

    expect(fixedChargesTotalPaisa(drafts)).toBe(15_000);
  });
});

describe('hasMeteredCharge', () => {
  it('is false for a rental of fixed charges only', () => {
    const drafts = initialChargeDrafts();
    drafts.RENT.amountText = '15000';
    expect(hasMeteredCharge(drafts)).toBe(false);
  });

  it('is true once a metered charge is switched on', () => {
    const drafts = initialChargeDrafts();
    drafts.ELECTRICITY = { ...drafts.ELECTRICITY, isEnabled: true, rateText: '15' };
    expect(hasMeteredCharge(drafts)).toBe(true);
  });
});
