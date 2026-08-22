import { z } from 'zod';
import { PAYMENT_METHODS, PAYMENT_PURPOSES } from '../domain';
import { businessDateSchema, paginationQuerySchema, paisaSchema } from './common';

/** Accounting requests (CLAUDE.md §15, §37, §60). */

export const recordPaymentSchema = z.object({
  purpose: z.enum(PAYMENT_PURPOSES).default('RENT'),
  /** Integer paisa. Must be positive — a zero payment moves no money. */
  amountPaisa: paisaSchema.refine((value) => value > 0, 'Enter an amount greater than zero'),
  paidOn: businessDateSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(500).optional(),

  /**
   * Client-generated, stable across retries of the SAME logical payment.
   *
   * Without it, a user tapping "Record payment" twice because the first request
   * looked frozen would create two payments (§37).
   */
  idempotencyKey: z.uuid('Send a UUID so a retry is recognised'),
});

/**
 * Deliberately absent: `periodId`. Allocation is decided by the server, oldest
 * period first — a client choosing where money lands could leave older debt
 * unsettled while newer periods showed as paid.
 */
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const meterReadingSchema = z
  .object({
    chargeId: z.uuid(),
    /** Whole units. Fractional readings would reintroduce rounding (§60). */
    previousReading: z.number().int().nonnegative(),
    currentReading: z.number().int().nonnegative(),
  })
  .refine((value) => value.currentReading >= value.previousReading, {
    path: ['currentReading'],
    message: 'The current reading cannot be lower than the previous one',
  });

export type MeterReadingInput = z.infer<typeof meterReadingSchema>;

export const listPeriodsQuerySchema = paginationQuerySchema.extend({
  /** Only periods still owing something. */
  unsettled: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  purpose: z.enum(PAYMENT_PURPOSES).optional(),
});

export type ListPeriodsQuery = z.infer<typeof listPeriodsQuerySchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
