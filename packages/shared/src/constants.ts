/**
 * Cross-cutting constants shared by the API and the mobile app.
 *
 * Anything in this file is a product decision, not an implementation detail.
 * Changing a value here changes accounting behaviour, so treat edits as
 * financially significant.
 */

/** Canonical business timezone. CLAUDE.md §46 — never use device-local time. */
export const APP_TIMEZONE = 'Asia/Kathmandu';

/**
 * Nepal Standard Time is UTC+05:45 — a 45-minute offset, not a whole hour.
 * Any code deriving "today" from a UTC timestamp without applying this will be
 * wrong for a 5h45m window every single day.
 */
export const APP_UTC_OFFSET_MINUTES = 345;

export const CURRENCY_CODE = 'NPR';

/**
 * Rental period lengths.
 *
 * Product decision: a period is a fixed span of days measured from the rental
 * start date — NOT a calendar month. This deliberately overrides CLAUDE.md §46's
 * calendar-arithmetic guidance. It removes month-end, February and leap-year
 * ambiguity entirely, at the cost of the billing date drifting through the
 * calendar (365 / 30 ≈ 12.17 periods per year).
 *
 * These two values are the single source of truth for period length. The period
 * generator must read them from here so the strategy stays swappable.
 */
export const MONTHLY_PERIOD_DAYS = 30;
export const YEARLY_PERIOD_DAYS = 365;

/**
 * Rent is due on the LAST day of the period by default — pay in arrears,
 * the convention the owner confirmed matches how rent is actually paid in
 * Nepal. There is no single flat "default offset" constant for this: the
 * last day of a period is `periodDays - 1`, which is a different number for
 * a 30-day and a 365-day rental, so `createRental` computes it from the
 * rental's own `periodDays` rather than a constant living here. A rental can
 * still choose `dueOffsetDays: 0` (pay in advance) explicitly.
 */

/** Days after the due date before an unpaid period is treated as overdue. */
export const DEFAULT_OVERDUE_AFTER_DAYS = 5;

/** Days before the due date on which reminders fire. 0 means "on the day". */
export const DEFAULT_RENT_REMINDER_DAYS = [7, 1, 0] as const;

export const SUPPORTED_LANGUAGES = ['en', 'ne'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_THEMES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof SUPPORTED_THEMES)[number];

/**
 * Which calendar dates are DISPLAYED in, app-wide (CLAUDE.md §46).
 *
 * Presentation only — every date is stored and computed in AD regardless of
 * this choice (§13, §46). 'BS' is the default because it is the calendar a
 * Nepali user reads and thinks in (§47), but a user unfamiliar with Bikram
 * Sambat can switch to the Gregorian dates their bank slips and agreements
 * already use.
 */
export const SUPPORTED_DATE_FORMATS = ['BS', 'AD'] as const;
export type DateFormatPreference = (typeof SUPPORTED_DATE_FORMATS)[number];
