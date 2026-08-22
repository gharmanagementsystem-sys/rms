import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Request throttling for the routes Better Auth does not cover. CLAUDE.md §32.
 *
 * Better Auth rate-limits `/api/auth/*` itself, database-backed. Everything
 * else — the whole versioned API and the internal job trigger — had no limit at
 * all, which left two concrete problems:
 *
 *  1. `/api/internal/jobs/:name` accepts an unlimited number of bearer-token
 *     guesses. The comparison is constant-time, but a secret that can be
 *     attacked forever is a secret that eventually falls.
 *  2. Device registration and payment recording could be hammered without
 *     cost. Idempotency prevents duplicate financial records, but not the load.
 *
 * Deliberately in-process rather than database-backed, unlike the auth
 * limiter. The reasoning differs by purpose: the auth limiter defends
 * individual accounts and must survive restarts and be shared across
 * instances, whereas this is a blunt abuse guard where a per-instance counter
 * is proportionate. Adding Redis for it would violate §69, and a database
 * write on every API request would cost more than it protects.
 *
 * The trade-off is stated plainly: with N instances the effective limit is N
 * times the configured one, and counters reset on deploy. That is acceptable
 * for abuse protection and would NOT be acceptable for brute-force protection,
 * which is why authentication keeps its own database-backed limiter.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests permitted per key per window. */
  max: number;
  /** Distinguishes one limiter's buckets from another's. */
  name: string;
}

/**
 * Buckets for every limiter, keyed `name:client`.
 *
 * Swept lazily on write rather than on a timer, so an idle process does not
 * hold a wake lock and there is no interval to leak in tests.
 */
const buckets = new Map<string, Bucket>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Identifies the caller.
 *
 * The authenticated user id is preferred where present: it is stable across a
 * changing mobile IP, and it stops one abusive user on a carrier-grade NAT
 * from throttling everyone behind the same address. Falls back to the IP,
 * which Express resolves through the trusted proxy.
 */
function clientKey(req: {
  ip?: string | undefined;
  auth?: { userId: string } | undefined;
}): string {
  return req.auth?.userId ?? req.ip ?? 'unknown';
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, name } = options;

  return (req, res, next) => {
    const now = Date.now();
    sweep(now);

    const key = `${name}:${clientKey(req as never)}`;
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    existing.count += 1;

    if (existing.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(
        new AppError('RATE_LIMITED', 429, 'Too many requests. Please wait a moment and try again.'),
      );
      return;
    }

    next();
  };
}

/** Test seam: the buckets are process-global, so tests must be able to reset. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
