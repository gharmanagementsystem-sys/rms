import { z } from 'zod';

/**
 * Shared request/response building blocks (CLAUDE.md §7, §30, §35).
 */

/** Route parameter for any resource addressed by id. */
export const idParamSchema = z.object({
  id: z.uuid('Must be a valid id'),
});

/**
 * Cursor pagination.
 *
 * Cursor rather than offset because offset pagination duplicates and skips rows
 * when the underlying list changes while a user scrolls — for a payment history
 * that is a correctness problem, not a cosmetic one (§35).
 *
 * The cursor is the id of the last item seen. Ids are UUIDv7, which is
 * time-ordered, so ordering by id is chronological and stable.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

/**
 * Nepali phone number.
 *
 * Mobile numbers are ten digits beginning 97 or 98, optionally prefixed with
 * the +977 country code. Stored normalised to the bare ten digits so the same
 * person cannot be recorded twice under different formats (§47).
 */
const NEPAL_MOBILE = /^(?:\+?977[- ]?)?(9[678]\d{8})$/;

export const nepaliPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => NEPAL_MOBILE.test(value), {
    message: 'Enter a valid Nepali mobile number, for example 9801234567',
  })
  .transform((value) => {
    const match = NEPAL_MOBILE.exec(value);
    // The refine above guarantees a match; the fallback keeps the type honest.
    return match?.[1] ?? value;
  });

/** Nepal administrative address. Every part is optional — §9 warns against
 *  demanding information the user can supply later. */
export const nepaliAddressSchema = z.object({
  province: z.string().trim().min(1).max(80).optional(),
  district: z.string().trim().min(1).max(80).optional(),
  municipality: z.string().trim().min(1).max(120).optional(),
  ward: z.coerce.number().int().positive().max(100).optional(),
  addressLine: z.string().trim().min(1).max(200).optional(),
  landmark: z.string().trim().min(1).max(200).optional(),
});

export type NepaliAddress = z.infer<typeof nepaliAddressSchema>;

/**
 * A business date: a calendar day in Nepal Standard Time, as `YYYY-MM-DD`.
 *
 * Deliberately a string, never a JavaScript `Date`. NPT is UTC+05:45, so any
 * implicit Date conversion can shift a period boundary by a day (§46).
 *
 * These are Gregorian (AD) dates. Bikram Sambat is a presentation concern — the
 * mobile app converts BS → AD before calling the API, in one place.
 */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    // Rejects 2026-02-31 and similar, which the regex alone would accept.
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'That date does not exist');

export type BusinessDate = z.infer<typeof businessDateSchema>;

/**
 * A monetary amount, in integer paisa.
 *
 * Deliberately rejects non-integers rather than rounding: a client sending
 * `1500.5` has a bug, and silently accepting it would hide it (§3.2).
 */
export const paisaSchema = z
  .number()
  .int('Amounts must be whole paisa')
  .nonnegative('Amounts cannot be negative')
  .max(Number.MAX_SAFE_INTEGER);
