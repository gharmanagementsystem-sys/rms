/**
 * Types for `bikram-sambat`, which ships none.
 *
 * Declared precisely rather than as a blanket `declare module` returning `any`
 * (CLAUDE.md §51): this module converts dates that drive rent due dates, and an
 * untyped surface there would let a typo through silently.
 *
 * Only the functions actually used are declared. The rest of the library's
 * surface is intentionally absent, so reaching for an undeclared helper is a
 * compile error rather than an implicit `any`.
 */
declare module 'bikram-sambat' {
  export interface BikramDate {
    year: number;
    month: number;
    day: number;
  }

  /** Gregorian `YYYY-MM-DD` → Bikram Sambat parts. */
  export function toBik(gregorianDate: string): BikramDate;

  /** Bikram Sambat parts → Gregorian `YYYY-MM-DD`. */
  export function toGreg_text(year: number, month: number, day: number): string;

  /** Days in a given Bikram Sambat month. BS months are 29–32 days. */
  export function daysInMonth(year: number, month: number): number;
}
