import { toBik, toGreg_text } from 'bikram-sambat';

/**
 * Bikram Sambat ↔ Gregorian conversion. CLAUDE.md §46, §47.
 *
 * THIS IS THE ONLY PLACE IN THE APP THAT CONVERTS BETWEEN CALENDARS.
 *
 * The rule the rest of the codebase depends on:
 *
 *   • BS is a PRESENTATION concern. It is what the user reads and types.
 *   • AD (`YYYY-MM-DD`) is the wire and storage format. Every API request and
 *     response carries AD, and the server does all period arithmetic on it.
 *
 * That split is deliberate. A BS month varies between 29 and 32 days, so
 * letting BS anywhere near period arithmetic would reintroduce exactly the
 * variability that fixed-duration 30/365-day periods exist to eliminate
 * (ADR 0001). Rental duration is always elapsed days on the AD representation.
 *
 * The underlying table-driven conversion comes from `bikram-sambat`; wrapping
 * it here means swapping that library is a one-file change.
 */

/** An AD calendar date, `YYYY-MM-DD`. The format used on the wire. */
export type AdDate = string;

export interface BsDate {
  year: number;
  /** 1–12. Baisakh is 1. */
  month: number;
  /** 1–32. BS months are not a fixed length. */
  day: number;
}

/**
 * Month names in Nepali and in Latin transliteration.
 *
 * Nepali users read भदौ, not "month 5". The Latin forms are for the English
 * locale, where "Bhadau" is still how the month is spoken.
 */
export const BS_MONTHS_NE = [
  'बैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कार्तिक',
  'मंसिर',
  'पुष',
  'माघ',
  'फागुन',
  'चैत',
] as const;

export const BS_MONTHS_EN = [
  'Baisakh',
  'Jestha',
  'Asar',
  'Shrawan',
  'Bhadau',
  'Asoj',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'] as const;

/** Western digits → Devanagari. Display only, never for values sent to the API. */
export function toDevanagariDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit);
}

const AD_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isAdDate(value: string): boolean {
  if (!AD_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

/** AD → BS. */
export function adToBs(date: AdDate): BsDate {
  if (!isAdDate(date)) throw new CalendarError(`Not a valid AD date: ${date}`);
  try {
    const result = toBik(date);
    return { year: result.year, month: result.month, day: result.day };
  } catch (error) {
    // Outside the conversion table's supported range.
    throw new CalendarError(
      `Cannot convert ${date} to Bikram Sambat: ${error instanceof Error ? error.message : 'unsupported date'}`,
    );
  }
}

/** BS → AD. The value that goes on the wire. */
export function bsToAd(date: BsDate): AdDate {
  const { year, month, day } = date;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new CalendarError(`BS month must be 1–12, received ${month}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 32) {
    throw new CalendarError(`BS day must be 1–32, received ${day}`);
  }
  try {
    return toGreg_text(year, month, day);
  } catch (error) {
    throw new CalendarError(
      `Cannot convert ${year}-${month}-${day} BS to Gregorian: ${error instanceof Error ? error.message : 'unsupported date'}`,
    );
  }
}

export interface FormatBsOptions {
  /** 'ne' uses Devanagari month names and numerals. */
  locale?: 'en' | 'ne';
  /** 'long' → "1 Bhadau 2083"; 'short' → "2083-05-01". */
  style?: 'long' | 'short';
}

/**
 * Formats an AD date for display, in Bikram Sambat.
 *
 * Every user-facing date goes through here. A raw AD date should never reach a
 * Nepali user — they think in गते, and a Gregorian date is as foreign to them
 * as a BS date would be to a European.
 */
export function formatBs(date: AdDate, options: FormatBsOptions = {}): string {
  const { locale = 'en', style = 'long' } = options;
  const bs = adToBs(date);

  if (style === 'short') {
    const text = `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`;
    return locale === 'ne' ? toDevanagariDigits(text) : text;
  }

  const monthName = locale === 'ne' ? BS_MONTHS_NE[bs.month - 1] : BS_MONTHS_EN[bs.month - 1];
  const text = `${bs.day} ${monthName} ${bs.year}`;
  return locale === 'ne' ? toDevanagariDigits(text) : text;
}

const AD_MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Formats an AD date for display, in the Gregorian calendar itself.
 *
 * For a user who has chosen the AD date-format preference (§46) — someone
 * more used to reading bank slips and agreements than Bikram Sambat. Unlike
 * `formatBs`, the month name has no Nepali translation here: an AD date
 * written in Nepali still conventionally keeps the Latin month name, only the
 * digits become Devanagari.
 */
export function formatAd(date: AdDate, options: FormatBsOptions = {}): string {
  if (!isAdDate(date)) throw new CalendarError(`Not a valid AD date: ${date}`);
  const { locale = 'en', style = 'long' } = options;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];

  if (style === 'short') {
    return locale === 'ne' ? toDevanagariDigits(date) : date;
  }

  const text = `${day} ${AD_MONTHS_EN[month - 1]} ${year}`;
  return locale === 'ne' ? toDevanagariDigits(text) : text;
}

export interface FormatDateOptions extends FormatBsOptions {
  /** Which calendar to render in — the user's `DateFormatPreference` (§46). */
  format: 'BS' | 'AD';
}

/**
 * The single entry point every screen should use to show a date.
 *
 * Dispatches to `formatBs` or `formatAd` by the caller's resolved preference
 * (`useDateFormat()`), so a screen never has to branch on it itself. `formatBs`
 * and `formatAd` remain exported directly for the few places that need one
 * calendar unconditionally — `BsDateField`'s own BS entry UI, and the AD
 * equivalent it shows underneath regardless of preference.
 */
export function formatDate(date: AdDate, options: FormatDateOptions): string {
  const { format, ...rest } = options;
  return format === 'AD' ? formatAd(date, rest) : formatBs(date, rest);
}

/** Today, as an AD date, in Nepal Standard Time. */
export function todayAd(now: Date = new Date()): AdDate {
  // en-CA formats as YYYY-MM-DD. The explicit timezone matters: NPT is
  // UTC+05:45, so the device's own timezone must not decide what "today" is.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Today in Bikram Sambat. */
export function todayBs(now: Date = new Date()): BsDate {
  return adToBs(todayAd(now));
}
