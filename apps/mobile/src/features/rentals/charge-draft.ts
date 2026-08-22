import type { ChargeInput, ChargeProrationPolicy, ChargeType, PricingModel } from '@rms/shared';
import { CHARGE_TYPES } from '@rms/shared';
import { parseRupeesToPaisa, paisaToInputText, type MoneyParseError } from '../../lib/money-input';
import type { ChargeResponse } from './api';

/**
 * The rent-configuration form's state, and how it becomes an API payload.
 * CLAUDE.md §12, §30.
 *
 * PURE: no React, no i18n, no network. Failures come back as codes rather than
 * sentences so the screen owns the wording and both languages stay in the
 * translation files (§27).
 *
 * This mirrors `chargeInputSchema` but does NOT replace it. The server
 * re-validates everything; what happens here is convenience, so a user learns
 * about a missing amount before a round trip rather than after one (§30).
 */

/**
 * Charges that can sensibly be metered.
 *
 * Electricity almost always is in Nepal. Water sometimes is, in newer municipal
 * supply areas. The rest are flat fees, and offering a meter for waste
 * collection would be a configuration option nobody wants (§3.1).
 */
export const METERABLE_CHARGE_TYPES: readonly ChargeType[] = ['ELECTRICITY', 'WATER'];

/** Everything the user can switch on, in the order the form shows them. */
export const OPTIONAL_CHARGE_TYPES: readonly ChargeType[] = CHARGE_TYPES.filter(
  (type) => type !== 'RENT',
);

export interface ChargeDraft {
  isEnabled: boolean;
  pricingModel: PricingModel;
  /** Rupees as typed, for a FIXED charge. */
  amountText: string;
  /** Rupees per unit as typed, for a PER_UNIT charge. */
  rateText: string;
  /** Only meaningful for FIXED charges (§12 — configurable per charge). */
  prorationPolicy: ChargeProrationPolicy;
  /** Required for OTHER, which is the only repeatable type. */
  label: string;
}

export type ChargeDrafts = Record<ChargeType, ChargeDraft>;

function emptyDraft(): ChargeDraft {
  return {
    isEnabled: false,
    pricingModel: 'FIXED',
    amountText: '',
    rateText: '',
    // PRORATE is the default the product settled on: a tenant who leaves
    // part-way through pays for the days they were there.
    prorationPolicy: 'PRORATE',
    label: '',
  };
}

export function initialChargeDrafts(): ChargeDrafts {
  const drafts = {} as ChargeDrafts;
  for (const type of CHARGE_TYPES) {
    drafts[type] = emptyDraft();
  }
  // Rent is not optional and is always a flat amount per period.
  drafts.RENT = { ...drafts.RENT, isEnabled: true, pricingModel: 'FIXED' };
  // Electricity is metered by default because that is how it is nearly always
  // billed here — a landlord who charges a flat fee can switch it.
  drafts.ELECTRICITY = { ...drafts.ELECTRICITY, pricingModel: 'PER_UNIT' };
  return drafts;
}

/**
 * The reverse of `buildCharges` — seeds draft state from an existing rental's
 * saved charges, for duplication (§53: an owner setting up ten similar rooms
 * should not have to re-type the same charge configuration ten times).
 *
 * `ChargeDrafts` has exactly one slot per `ChargeType`, so if the source
 * somehow carries more than one `OTHER` charge (the create form itself can
 * only ever produce one, but nothing stops a different client from writing
 * more), only the first is kept — the same ceiling this form already has.
 */
export function chargeDraftsFromResponse(charges: ChargeResponse[]): ChargeDrafts {
  const drafts = initialChargeDrafts();
  const seen = new Set<ChargeType>();

  for (const charge of charges) {
    if (seen.has(charge.chargeType)) continue;
    seen.add(charge.chargeType);

    drafts[charge.chargeType] = {
      isEnabled: true,
      pricingModel: charge.pricingModel,
      amountText: charge.amountPaisa === null ? '' : paisaToInputText(charge.amountPaisa),
      rateText: charge.ratePaisaPerUnit === null ? '' : paisaToInputText(charge.ratePaisaPerUnit),
      prorationPolicy: charge.prorationPolicy ?? 'PRORATE',
      label: charge.label ?? '',
    };
  }

  return drafts;
}

export type ChargeDraftError = MoneyParseError | 'MISSING_LABEL';

export type BuildChargesResult =
  | { ok: true; charges: ChargeInput[] }
  | { ok: false; errors: Partial<Record<ChargeType, ChargeDraftError>> };

/**
 * Turn the drafts into the payload, or report which charge is not ready.
 *
 * Rent is always included. Everything else is included only when switched on —
 * §12 is explicit that a rental must not be forced to carry every service.
 */
export function buildCharges(drafts: ChargeDrafts): BuildChargesResult {
  const charges: ChargeInput[] = [];
  const errors: Partial<Record<ChargeType, ChargeDraftError>> = {};

  for (const type of CHARGE_TYPES) {
    const draft = drafts[type];
    if (!draft.isEnabled) continue;

    if (type === 'OTHER' && draft.label.trim().length === 0) {
      errors[type] = 'MISSING_LABEL';
      continue;
    }

    if (draft.pricingModel === 'PER_UNIT') {
      const rate = parseRupeesToPaisa(draft.rateText);
      if (!rate.ok) {
        errors[type] = rate.reason;
        continue;
      }
      charges.push({
        chargeType: type,
        pricingModel: 'PER_UNIT',
        ratePaisaPerUnit: rate.paisa,
        // Deliberately no proration policy: a meter already measures actual
        // usage, so prorating on top of it would discount twice.
        ...(type === 'OTHER' ? { label: draft.label.trim() } : {}),
      });
      continue;
    }

    const amount = parseRupeesToPaisa(draft.amountText);
    if (!amount.ok) {
      errors[type] = amount.reason;
      continue;
    }
    charges.push({
      chargeType: type,
      pricingModel: 'FIXED',
      amountPaisa: amount.paisa,
      prorationPolicy: draft.prorationPolicy,
      ...(type === 'OTHER' ? { label: draft.label.trim() } : {}),
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, charges };
}

/**
 * The total of the fixed charges, for the running summary on the form.
 *
 * Metered charges are excluded because their amount is genuinely unknown until
 * a reading exists — including a guess would be inventing a number. This figure
 * is a preview only; the server computes the authoritative total (§54).
 */
export function fixedChargesTotalPaisa(drafts: ChargeDrafts): number {
  let total = 0;
  for (const type of CHARGE_TYPES) {
    const draft = drafts[type];
    if (!draft.isEnabled || draft.pricingModel !== 'FIXED') continue;
    const amount = parseRupeesToPaisa(draft.amountText);
    if (amount.ok) total += amount.paisa;
  }
  return total;
}

/** True when at least one enabled charge is metered. */
export function hasMeteredCharge(drafts: ChargeDrafts): boolean {
  return CHARGE_TYPES.some(
    (type) => drafts[type].isEnabled && drafts[type].pricingModel === 'PER_UNIT',
  );
}
