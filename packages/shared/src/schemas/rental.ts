import { z } from 'zod';
import {
  CHARGE_PRORATION_POLICIES,
  CHARGE_TYPES,
  MID_PERIOD_END_POLICIES,
  PRICING_MODELS,
  RENT_FREQUENCIES,
  RENTAL_STATUSES,
  periodDaysFor,
} from '../domain';
import {
  businessDateSchema,
  nepaliPhoneSchema,
  paginationQuerySchema,
  paisaSchema,
} from './common';

/**
 * Rentals and rent configuration (CLAUDE.md §11, §12, §30).
 *
 * Note what is NOT accepted from the client: ownerUserId, renterUserId,
 * periodDays, status, or any computed total. Those are set by the server from
 * the session and from product rules — accepting them would make privilege
 * escalation and financial tampering a matter of editing a request body
 * (§30, §54).
 */

/** A single configured charge. Mirrors the database CHECK constraint. */
export const chargeInputSchema = z
  .object({
    chargeType: z.enum(CHARGE_TYPES),
    /** Required for OTHER, which is the only repeatable type. */
    label: z.string().trim().min(1).max(60).optional(),
    pricingModel: z.enum(PRICING_MODELS),
    /** Set when pricingModel is FIXED. */
    amountPaisa: paisaSchema.optional(),
    /** Set when pricingModel is PER_UNIT, e.g. paisa per electricity unit. */
    ratePaisaPerUnit: paisaSchema.optional(),
    /**
     * Only meaningful for FIXED charges. Defaults to PRORATE when omitted.
     * Must be absent for PER_UNIT — a meter already measures actual usage.
     */
    prorationPolicy: z.enum(CHARGE_PRORATION_POLICIES).optional(),
  })
  .superRefine((charge, ctx) => {
    if (charge.pricingModel === 'FIXED') {
      if (charge.amountPaisa === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountPaisa'],
          message: 'A fixed charge needs an amount',
        });
      }
      if (charge.ratePaisaPerUnit !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['ratePaisaPerUnit'],
          message: 'A fixed charge cannot also have a per-unit rate',
        });
      }
    } else {
      if (charge.ratePaisaPerUnit === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['ratePaisaPerUnit'],
          message: 'A per-unit charge needs a rate',
        });
      }
      if (charge.amountPaisa !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountPaisa'],
          message: 'A per-unit charge cannot also have a fixed amount',
        });
      }
      if (charge.prorationPolicy !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['prorationPolicy'],
          message:
            'A metered charge is calculated from actual usage, so it has no proration policy',
        });
      }
    }

    if (charge.chargeType === 'OTHER' && !charge.label) {
      ctx.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Give this charge a name so it is recognisable',
      });
    }

    // Rent is a flat amount per period. A metered rent is not a concept the
    // accounting engine models, and allowing it would produce periods whose
    // total cannot be known.
    if (charge.chargeType === 'RENT' && charge.pricingModel !== 'FIXED') {
      ctx.addIssue({
        code: 'custom',
        path: ['pricingModel'],
        message: 'Rent must be a fixed amount',
      });
    }
  });

export type ChargeInput = z.infer<typeof chargeInputSchema>;

/** Exactly one RENT charge, and no repeated non-OTHER type. */
function validateChargeSet(charges: ChargeInput[], ctx: z.RefinementCtx): void {
  const rentCount = charges.filter((charge) => charge.chargeType === 'RENT').length;
  if (rentCount !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['charges'],
      message: 'A rental needs exactly one rent charge',
    });
  }

  const seen = new Set<string>();
  charges.forEach((charge, index) => {
    if (charge.chargeType === 'OTHER') return;
    if (seen.has(charge.chargeType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['charges', index, 'chargeType'],
        message: `${charge.chargeType} is already configured on this rental`,
      });
    }
    seen.add(charge.chargeType);
  });

  const otherLabels = new Set<string>();
  charges.forEach((charge, index) => {
    if (charge.chargeType !== 'OTHER' || !charge.label) return;
    const key = charge.label.toLowerCase();
    if (otherLabels.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['charges', index, 'label'],
        message: 'Two charges cannot share a name',
      });
    }
    otherLabels.add(key);
  });
}

const rentalTermsShape = {
  frequency: z.enum(RENT_FREQUENCIES),
  startDate: businessDateSchema,

  /**
   * Days after a period begins before rent is due. 0 = due on day one
   * (pay in advance); `periodDays - 1` = due on the period's last day
   * (pay in arrears).
   *
   * Left unset here deliberately — there is no single flat number that means
   * "the last day of the period" across both a 30-day and a 365-day rental,
   * so the real default is computed server-side from the rental's own
   * `periodDays` (see `createRental`), not baked into this schema.
   */
  dueOffsetDays: z.number().int().min(0).max(364).optional(),
  /** Days after the due date before an unpaid period counts as overdue. */
  overdueAfterDays: z.number().int().min(0).max(120).default(5),

  midPeriodEndPolicy: z.enum(MID_PERIOD_END_POLICIES).default('PRORATE'),

  /**
   * Refundable deposit. Tracked separately from rent credit and never used to
   * settle unpaid rent automatically.
   */
  securityDepositPaisa: paisaSchema.optional(),

  notes: z.string().trim().max(1000).optional(),
};

export const createRentalSchema = z
  .object({
    /**
     * Which side of this agreement the caller is on.
     *
     * This is an intent declaration, not an authorization claim: the server
     * assigns the CALLER'S OWN id to the chosen slot. A client can never name
     * another user as owner or renter.
     */
    side: z.enum(['OWNER', 'RENTER']),

    /** Owner-side rentals attached to a unit the caller owns. */
    unitId: z.uuid().optional(),

    /** Free-text place, for a renter recording their own tenancy (§9, §58). */
    placeLabel: z.string().trim().min(1).max(120).optional(),
    placeAddress: z.string().trim().min(1).max(200).optional(),

    /** The other party, when they do not use the app. */
    counterpartyName: z.string().trim().min(1).max(120).optional(),
    counterpartyPhone: nepaliPhoneSchema.optional(),

    ...rentalTermsShape,

    charges: z.array(chargeInputSchema).min(1, 'Add at least the rent'),
  })
  .superRefine((value, ctx) => {
    validateChargeSet(value.charges, ctx);

    if (value.side === 'RENTER' && value.unitId) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitId'],
        message: 'A renter records the place by name, not by unit',
      });
    }

    if (!value.unitId && !value.placeLabel) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeLabel'],
        message: 'Choose a unit or describe the place',
      });
    }

    // Rent cannot fall due after the period it belongs to has ended. Mirrors
    // the database CHECK constraint. Undefined means "use the server's
    // default" (the period's last day), which is always in range.
    const periodDays = periodDaysFor(value.frequency);
    if (value.dueOffsetDays !== undefined && value.dueOffsetDays >= periodDays) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueOffsetDays'],
        message: `Rent must fall due within the ${periodDays}-day period`,
      });
    }
  });

/**
 * Editable terms.
 *
 * `startDate` and `frequency` are absent by design: both change the period
 * schedule, and a rental with generated periods cannot have its history
 * reshaped (§3.3, §14). Changing them means ending the rental and starting a
 * new one.
 */
export const updateRentalSchema = z
  .object({
    counterpartyName: z.string().trim().min(1).max(120).optional(),
    counterpartyPhone: nepaliPhoneSchema.optional(),
    placeLabel: z.string().trim().min(1).max(120).optional(),
    placeAddress: z.string().trim().min(1).max(200).optional(),
    dueOffsetDays: z.number().int().min(0).max(364).optional(),
    overdueAfterDays: z.number().int().min(0).max(120).optional(),
    midPeriodEndPolicy: z.enum(MID_PERIOD_END_POLICIES).optional(),
    securityDepositPaisa: paisaSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

/** Replaces the whole charge set. Partial edits would make the "exactly one
 *  rent charge" rule impossible to enforce atomically. */
export const replaceChargesSchema = z
  .object({ charges: z.array(chargeInputSchema).min(1, 'Add at least the rent') })
  .superRefine((value, ctx) => validateChargeSet(value.charges, ctx));

export const endRentalSchema = z.object({
  /** Inclusive last day of tenancy. */
  endDate: businessDateSchema,
  /** Overrides the rental's default for the final period only. */
  midPeriodEndPolicy: z.enum(MID_PERIOD_END_POLICIES).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const listRentalsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RENTAL_STATUSES).optional(),
  /** Restrict to rentals where the caller is the owner, or the renter. */
  side: z.enum(['OWNER', 'RENTER']).optional(),
  propertyId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export type CreateRentalInput = z.infer<typeof createRentalSchema>;
export type UpdateRentalInput = z.infer<typeof updateRentalSchema>;
export type ReplaceChargesInput = z.infer<typeof replaceChargesSchema>;
export type EndRentalInput = z.infer<typeof endRentalSchema>;
export type ListRentalsQuery = z.infer<typeof listRentalsQuerySchema>;
