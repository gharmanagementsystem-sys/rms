/**
 * Serialization boundary between Prisma types and JSON responses.
 *
 * Prisma maps a PostgreSQL `BigInt` to a JavaScript `bigint`, and
 * `JSON.stringify` throws on that type. Every paisa value therefore has to be
 * converted before it leaves a controller — doing it here, rather than ad hoc
 * per route, means one place to get it right.
 */

/**
 * `bigint` paisa → `number`.
 *
 * Lossless in practice: the safe-integer limit is ~9.0e15 paisa, which is
 * ~9.0e13 rupees. The bound is asserted rather than assumed, because silently
 * truncating a monetary value is precisely the failure a rent ledger must not
 * have (CLAUDE.md §3.2).
 */
export function paisaToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Paisa amount exceeds safe integer range: ${value}`);
  }
  return Number(value);
}

export function optionalPaisaToNumber(value: bigint | null): number | null {
  return value === null ? null : paisaToNumber(value);
}

export function numberToPaisa(value: number): bigint {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Paisa amounts must be whole numbers, received ${value}`);
  }
  return BigInt(value);
}

export function optionalNumberToPaisa(value: number | undefined): bigint | null {
  return value === undefined ? null : numberToPaisa(value);
}
