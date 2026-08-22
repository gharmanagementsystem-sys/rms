/**
 * Money handling. CLAUDE.md §3.2 — never floating point for money.
 *
 * All monetary values in this system are integer **paisa** (1 NPR = 100 paisa),
 * carried as a branded number so that rupees can never be passed where paisa is
 * expected without an explicit conversion. That mistake is otherwise invisible
 * in review and off by a factor of 100.
 */

declare const PAISA_BRAND: unique symbol;

/** An integer count of paisa. NPR 1,500.00 is `150000` paisa. */
export type Paisa = number & { readonly [PAISA_BRAND]: true };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Assert that a raw number is a usable paisa value and brand it. */
export function paisa(value: number): Paisa {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Amount must be a finite number, received ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Amount in paisa must be a whole number, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Amount exceeds safe integer range: ${value}`);
  }
  return value as Paisa;
}

export const ZERO_PAISA = paisa(0);

/**
 * Convert a rupee amount with at most two decimal places into paisa.
 *
 * ⚠️ Float rupees must never cross the API boundary — clients send and receive
 * integer paisa. Inputs with more than two decimals cannot be represented
 * exactly (1.005 * 100 === 100.49999999999999, which rounds down to 100), so
 * this helper is for tests, seed data and converting already-validated
 * two-decimal form input, not for authoritative amounts.
 */
export function rupeesToPaisa(rupees: number): Paisa {
  if (!Number.isFinite(rupees)) {
    throw new MoneyError(`Rupee amount must be a finite number, received ${rupees}`);
  }
  // Round rather than truncate: 15.07 * 100 is 1506.9999... in IEEE 754.
  return paisa(Math.round(rupees * 100));
}

export function paisaToRupees(value: Paisa): number {
  return value / 100;
}

export function addPaisa(...values: Paisa[]): Paisa {
  return paisa(values.reduce<number>((sum, v) => sum + v, 0));
}

export function subtractPaisa(a: Paisa, b: Paisa): Paisa {
  return paisa(a - b);
}

/**
 * Multiply a paisa amount by a quantity, rounding half-up away from zero.
 *
 * This is the ONLY rounding rule in the system (per-unit charges, proration).
 * `Math.round` rounds half toward +Infinity, which is asymmetric for negatives,
 * so the sign is handled explicitly to keep the rule symmetric and predictable.
 */
export function multiplyPaisa(value: Paisa, quantity: number): Paisa {
  if (!Number.isFinite(quantity)) {
    throw new MoneyError(`Quantity must be a finite number, received ${quantity}`);
  }
  const product = value * quantity;
  const rounded = Math.sign(product) * Math.round(Math.abs(product));
  return paisa(rounded);
}

/**
 * Apply a fraction to a paisa amount, rounding half-up. Used for proration:
 * `prorate(rent, daysOccupied, daysInPeriod)`.
 */
export function prorate(value: Paisa, numerator: number, denominator: number): Paisa {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new MoneyError('Proration numerator and denominator must be whole numbers');
  }
  if (denominator <= 0) {
    throw new MoneyError(`Proration denominator must be positive, received ${denominator}`);
  }
  if (numerator < 0) {
    throw new MoneyError(`Proration numerator must not be negative, received ${numerator}`);
  }
  const exact = (value * numerator) / denominator;
  return paisa(Math.sign(exact) * Math.round(Math.abs(exact)));
}

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'] as const;

function toDevanagariDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => DEVANAGARI_DIGITS[Number(d)] ?? d);
}

/**
 * Group an integer string using the South Asian convention: the last three
 * digits, then groups of two. 150000 becomes "1,50,000" — not "150,000".
 *
 * Implemented by hand rather than via Intl because Hermes' Intl coverage varies
 * by platform and a money format that differs between Android and iOS is a bug.
 */
function groupSouthAsian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

export interface FormatAmountOptions {
  /** Render the "रु" / "NPR" prefix. Default true. */
  withSymbol?: boolean;
  /** Show paisa even when the amount is a whole number of rupees. Default false. */
  alwaysShowPaisa?: boolean;
  /** Use Devanagari numerals (०१२…). Default false. */
  devanagariDigits?: boolean;
  /** Symbol to prefix when `withSymbol` is set. Default "रु". */
  symbol?: string;
}

/** Format a paisa amount for display. Never use this for arithmetic. */
export function formatAmount(value: Paisa, options: FormatAmountOptions = {}): string {
  const {
    withSymbol = true,
    alwaysShowPaisa = false,
    devanagariDigits = false,
    symbol = 'रु',
  } = options;

  const negative = value < 0;
  const abs = Math.abs(value);
  const rupeePart = Math.trunc(abs / 100);
  const paisaPart = abs % 100;

  let text = groupSouthAsian(String(rupeePart));
  if (paisaPart > 0 || alwaysShowPaisa) {
    text += `.${String(paisaPart).padStart(2, '0')}`;
  }
  if (devanagariDigits) text = toDevanagariDigits(text);
  if (withSymbol) text = `${symbol} ${text}`;
  return negative ? `-${text}` : text;
}
