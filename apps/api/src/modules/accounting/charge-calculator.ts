import type { ChargeProrationPolicy, ChargeType, PricingModel } from '@rms/shared';
import { paisa, prorate } from '@rms/shared';

/**
 * Charge calculation. CLAUDE.md §12, §14, §60, §61.
 *
 * PURE: no database, no clock. All amounts are integer paisa.
 *
 * The output of `planPeriodCharges` is a SNAPSHOT. Once written to a period it
 * is never recomputed from the rental's current configuration, which is what
 * keeps January's electricity priced at January's rate after the rate changes
 * (§3.3).
 */

/** A charge as currently configured on the rental. */
export interface ChargeConfig {
  chargeType: ChargeType;
  label: string | null;
  pricingModel: PricingModel;
  /** Paisa, for FIXED. */
  amountPaisa: number | null;
  /** Paisa per unit, for PER_UNIT. */
  ratePaisaPerUnit: number | null;
  /**
   * PRORATE or FULL for a FIXED charge; null for PER_UNIT.
   *
   * Per-charge rather than per-rental because the right answer differs by
   * service: rent and water scale with occupancy, whereas an internet line the
   * landlord pays for monthly does not.
   */
  prorationPolicy: ChargeProrationPolicy | null;
}

/** A charge as it will be recorded against one period. */
export interface PeriodChargePlan {
  chargeType: ChargeType;
  label: string | null;
  pricingModel: PricingModel;
  /** Paisa. Zero for a metered charge awaiting its reading. */
  amountPaisa: number;
  /** Snapshotted so the historical rate survives a later price change. */
  ratePaisaPerUnit: number | null;
  /**
   * Snapshotted alongside the amount.
   *
   * Without this, changing a charge from FULL to PRORATE would leave no record
   * of which rule produced a past period's figure, and the number could not be
   * re-derived or explained (§3.3, §61).
   */
  prorationPolicy: ChargeProrationPolicy | null;
  /**
   * False for a metered charge with no reading yet.
   *
   * An unfinalized charge contributes nothing to the period total and blocks
   * the period from reaching PAID — otherwise a period would look settled
   * before electricity had been billed, then silently reopen when the reading
   * arrived, which reads to a user as the app losing their money.
   */
  isFinalized: boolean;
}

export interface Proration {
  /** Days actually charged for. */
  coveredDays: number;
  /** Full period length — the denominator. */
  basisDays: number;
}

/**
 * Builds the charge snapshot for one period.
 *
 * Proration is decided per charge:
 *
 *   PER_UNIT   never prorated. A meter reading already measures what was
 *              actually used, so scaling it by occupancy would discount twice.
 *   FIXED      PRORATE scales by days occupied; FULL charges the whole amount.
 *
 * The policy that applied is snapshotted with the amount, so a later change to
 * the configuration cannot alter — or obscure — how a past period was priced.
 */
export function planPeriodCharges(
  charges: ChargeConfig[],
  proration: Proration,
): PeriodChargePlan[] {
  const { coveredDays, basisDays } = proration;

  if (!Number.isInteger(basisDays) || basisDays <= 0) {
    throw new RangeError(`basisDays must be positive, received ${basisDays}`);
  }
  if (!Number.isInteger(coveredDays) || coveredDays < 0 || coveredDays > basisDays) {
    throw new RangeError(`coveredDays must be between 0 and ${basisDays}, received ${coveredDays}`);
  }

  return charges.map((charge) => {
    if (charge.pricingModel === 'PER_UNIT') {
      if (charge.ratePaisaPerUnit === null) {
        throw new TypeError(`Per-unit charge ${charge.chargeType} has no rate`);
      }
      return {
        chargeType: charge.chargeType,
        label: charge.label,
        pricingModel: charge.pricingModel,
        amountPaisa: 0,
        ratePaisaPerUnit: charge.ratePaisaPerUnit,
        // Metered charges carry no policy — usage is the measure.
        prorationPolicy: null,
        isFinalized: false,
      };
    }

    if (charge.amountPaisa === null) {
      throw new TypeError(`Fixed charge ${charge.chargeType} has no amount`);
    }

    // Absent policy means PRORATE: the safer default, since charging a tenant
    // for days they did not occupy needs a deliberate decision.
    const policy: ChargeProrationPolicy = charge.prorationPolicy ?? 'PRORATE';
    const isPartialPeriod = coveredDays !== basisDays;
    const amountPaisa =
      policy === 'FULL' || !isPartialPeriod
        ? charge.amountPaisa
        : prorate(paisa(charge.amountPaisa), coveredDays, basisDays);

    return {
      chargeType: charge.chargeType,
      label: charge.label,
      pricingModel: charge.pricingModel,
      amountPaisa,
      ratePaisaPerUnit: null,
      prorationPolicy: policy,
      isFinalized: true,
    };
  });
}

export interface MeterReading {
  previousReading: number;
  currentReading: number;
  ratePaisaPerUnit: number;
}

export interface MeteredCharge {
  consumedUnits: number;
  amountPaisa: number;
}

/**
 * Prices a metered utility from its two readings (§60).
 *
 * Readings and the rate are whole numbers, so `units × rate` is exact integer
 * arithmetic with no rounding at all — there is no place for a fraction of a
 * paisa to appear and no rounding rule to get wrong.
 *
 * Both readings are stored alongside the result so the tenant can see where the
 * amount came from, rather than being handed a total to trust (§61).
 */
export function calculateMeteredCharge(reading: MeterReading): MeteredCharge {
  const { previousReading, currentReading, ratePaisaPerUnit } = reading;

  for (const [name, value] of Object.entries(reading)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a whole number of zero or more, received ${value}`);
    }
  }

  if (currentReading < previousReading) {
    // A meter that appears to run backwards means a mistyped reading or a
    // replaced meter. Guessing which would produce a silently wrong bill.
    throw new RangeError(
      `Current reading ${currentReading} is lower than the previous reading ${previousReading}`,
    );
  }

  const consumedUnits = currentReading - previousReading;
  return {
    consumedUnits,
    amountPaisa: consumedUnits * ratePaisaPerUnit,
  };
}

/** A period's total is the sum of its FINALIZED charges only. */
export function totalOf(charges: Pick<PeriodChargePlan, 'amountPaisa' | 'isFinalized'>[]): number {
  return charges.reduce((sum, charge) => (charge.isFinalized ? sum + charge.amountPaisa : sum), 0);
}

/** True when every charge on the period has a final amount. */
export function chargesComplete(charges: Pick<PeriodChargePlan, 'isFinalized'>[]): boolean {
  return charges.every((charge) => charge.isFinalized);
}
