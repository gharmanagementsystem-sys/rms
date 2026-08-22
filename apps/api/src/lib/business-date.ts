import { APP_TIMEZONE } from '@rms/shared';

/**
 * Business dates. CLAUDE.md §46.
 *
 * A business date is a calendar day in Nepal Standard Time, carried as
 * `YYYY-MM-DD`. It is never a JavaScript `Date` in application code, because
 * NPT is UTC+05:45 and an implicit conversion shifts a period boundary by a day.
 *
 * PostgreSQL `date` columns come back from the driver as a `Date` at UTC
 * midnight, so conversion happens here and only here — this module is the sole
 * boundary between the two representations.
 *
 * Bikram Sambat conversion is a presentation concern handled on the client and
 * is deliberately absent here: period arithmetic is always done on the AD
 * representation, in elapsed days (§13, §46).
 */

export type BusinessDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function assertBusinessDate(value: string): void {
  if (!isBusinessDate(value)) {
    throw new RangeError(`Not a valid business date: ${value}`);
  }
}

/** `YYYY-MM-DD` → the `Date` a PostgreSQL `date` column expects. */
export function toDbDate(value: BusinessDate): Date {
  assertBusinessDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

/** A `Date` from a PostgreSQL `date` column → `YYYY-MM-DD`. */
export function fromDbDate(value: Date): BusinessDate {
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Adds whole days to a business date.
 *
 * This is the only way period boundaries advance (§13, §46): fixed-duration
 * periods are measured in elapsed days, never with calendar-month arithmetic
 * and never by adding seconds.
 */
export function addDays(value: BusinessDate, days: number): BusinessDate {
  assertBusinessDate(value);
  if (!Number.isInteger(days)) {
    throw new RangeError(`Days must be a whole number, received ${days}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return fromDbDate(date);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  assertBusinessDate(from);
  assertBusinessDate(to);
  const ms = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

export function compareDates(a: BusinessDate, b: BusinessDate): number {
  assertBusinessDate(a);
  assertBusinessDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Today, in Nepal Standard Time.
 *
 * Uses Intl with an explicit timezone rather than arithmetic on the UTC offset,
 * so the value stays correct regardless of the server's own timezone — Render
 * runs in UTC, a developer's laptop does not.
 */
export function todayInNepal(now: Date = new Date()): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // en-CA formats as YYYY-MM-DD.
  return parts;
}
