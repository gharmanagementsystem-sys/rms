/**
 * Turning what a user typed into integer paisa. CLAUDE.md §3.2, §29.
 *
 * This is the one place rupees become paisa on the client, and it never
 * multiplies a float to get there.
 *
 * `rupeesToPaisa` in @rms/shared does `Math.round(rupees * 100)`, and its own
 * documentation warns that this is for tests and seed data rather than
 * authoritative amounts: `1.005 * 100` is `100.49999999999999` in IEEE 754, so
 * the value a user typed and the value they are charged can differ. Parsing the
 * decimal string directly avoids the floating-point step altogether — the rupee
 * part and the paisa part are read as separate integers and combined with
 * integer arithmetic.
 */

const DEVANAGARI_TO_WESTERN: Record<string, string> = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

/**
 * Largest amount accepted from a form: NPR 10,00,00,000 (ten crore).
 *
 * Far above any plausible Nepali rent, and low enough that a mistyped digit run
 * is rejected as input rather than travelling into the accounting engine.
 */
export const MAX_INPUT_PAISA = 10_00_00_000_00;

export type MoneyParseError = 'EMPTY' | 'NOT_A_NUMBER' | 'TOO_MANY_DECIMALS' | 'TOO_LARGE';

export type MoneyParseResult = { ok: true; paisa: number } | { ok: false; reason: MoneyParseError };

/**
 * Normalise what a user could plausibly type.
 *
 * A Nepali keyboard produces Devanagari numerals, and people paste amounts with
 * grouping separators in them. Rejecting either would be rejecting a correctly
 * entered amount.
 */
export function normalizeAmountText(text: string): string {
  return text
    .replace(/[०-९]/g, (digit) => DEVANAGARI_TO_WESTERN[digit] ?? digit)
    .replace(/[\s,]/g, '')
    .trim();
}

/** Parse a typed rupee amount into integer paisa. */
export function parseRupeesToPaisa(text: string): MoneyParseResult {
  const normalized = normalizeAmountText(text);
  if (normalized.length === 0) return { ok: false, reason: 'EMPTY' };

  if (!/^\d*(?:\.\d*)?$/.test(normalized) || normalized === '.') {
    return { ok: false, reason: 'NOT_A_NUMBER' };
  }

  const [rupeeText = '', paisaText = ''] = normalized.split('.');
  if (paisaText.length > 2) return { ok: false, reason: 'TOO_MANY_DECIMALS' };
  if (rupeeText.length === 0 && paisaText.length === 0) {
    return { ok: false, reason: 'NOT_A_NUMBER' };
  }

  const rupees = rupeeText.length > 0 ? Number(rupeeText) : 0;
  // "5.5" means five rupees fifty paisa, not five paisa — pad on the right.
  const paisaPart = paisaText.length > 0 ? Number(paisaText.padEnd(2, '0')) : 0;

  if (!Number.isSafeInteger(rupees)) return { ok: false, reason: 'TOO_LARGE' };

  const total = rupees * 100 + paisaPart;
  if (!Number.isSafeInteger(total) || total > MAX_INPUT_PAISA) {
    return { ok: false, reason: 'TOO_LARGE' };
  }

  return { ok: true, paisa: total };
}

/**
 * Paisa back to a plain editable rupee string, for prefilling a field.
 *
 * Deliberately ungrouped and symbol-free: this feeds a TextInput, and "रु 1,500"
 * is not something the parser above should have to read back.
 */
export function paisaToInputText(value: number): string {
  const rupees = Math.trunc(value / 100);
  const paisaPart = value % 100;
  return paisaPart === 0 ? String(rupees) : `${rupees}.${String(paisaPart).padStart(2, '0')}`;
}
