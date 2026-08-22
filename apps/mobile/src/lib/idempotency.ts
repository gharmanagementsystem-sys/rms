import { randomUUID } from 'expo-crypto';

/**
 * Idempotency keys for financial mutations. CLAUDE.md §37.
 *
 * A user whose "Record payment" request appears to hang will tap again. The
 * server deduplicates on `(recordedByUserId, idempotencyKey)` and replays the
 * original payment instead of creating a second one — but only if the retry
 * carries the SAME key. Generating a fresh key per tap would defeat the whole
 * mechanism and post the money twice.
 *
 * `expo-crypto` is used rather than a `Math.random` UUID because this key is the
 * only thing standing between a stalled network and a duplicated payment. It is
 * a first-party Expo module and works in Expo Go, so it costs nothing in the
 * development loop (§36A).
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}
