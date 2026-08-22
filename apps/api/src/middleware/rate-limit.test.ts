import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error';
import { rateLimit, resetRateLimits } from './rate-limit';

/**
 * The limiter's job is narrow: let ordinary traffic through, and stop a caller
 * that exceeds the budget with a 429 carrying Retry-After. These tests pin the
 * boundary exactly, because an off-by-one here either blocks a legitimate user
 * or leaves an extra request available to an attacker on every window.
 */

function makeReq(overrides: Partial<Request> = {}): Request {
  return { ip: '203.0.113.10', ...overrides } as Request;
}

function makeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it('allows requests up to the limit', () => {
    const limiter = rateLimit({ name: 'test', windowMs: 60_000, max: 3 });
    const next = vi.fn() as unknown as NextFunction;

    for (let i = 0; i < 3; i += 1) {
      limiter(makeReq(), makeRes(), next);
    }

    expect(next).toHaveBeenCalledTimes(3);
    expect(vi.mocked(next).mock.calls.every((call) => call[0] === undefined)).toBe(true);
  });

  it('rejects the request after the limit with a 429', () => {
    const limiter = rateLimit({ name: 'test', windowMs: 60_000, max: 2 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq(), makeRes(), next);
    limiter(makeReq(), makeRes(), next);
    limiter(makeReq(), makeRes(), next);

    // Express types the next() argument as `string | Error`, so it needs
    // narrowing rather than a cast before its AppError fields can be read.
    const lastArg: unknown = vi.mocked(next).mock.calls[2]?.[0];
    expect(lastArg).toBeInstanceOf(AppError);
    if (!(lastArg instanceof AppError)) throw new Error('expected an AppError');
    expect(lastArg.status).toBe(429);
    expect(lastArg.code).toBe('RATE_LIMITED');
  });

  it('sets Retry-After so a client knows when to come back', () => {
    const limiter = rateLimit({ name: 'test', windowMs: 60_000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq(), makeRes(), next);
    const res = makeRes();
    limiter(makeReq(), res, next);

    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
    expect(Number(res.headers['Retry-After'])).toBeLessThanOrEqual(60);
  });

  it('counts each client separately', () => {
    // One noisy caller must not throttle everyone else.
    const limiter = rateLimit({ name: 'test', windowMs: 60_000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq({ ip: '203.0.113.1' }), makeRes(), next);
    limiter(makeReq({ ip: '203.0.113.2' }), makeRes(), next);

    expect(vi.mocked(next).mock.calls.every((call) => call[0] === undefined)).toBe(true);
  });

  it('keys on the authenticated user rather than the IP when there is one', () => {
    // Two users behind one carrier-grade NAT share an IP; throttling them
    // together would let one person silence the other.
    const limiter = rateLimit({ name: 'test', windowMs: 60_000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    const shared = '198.51.100.7';
    limiter(makeReq({ ip: shared, auth: { userId: 'user-a' } } as never), makeRes(), next);
    limiter(makeReq({ ip: shared, auth: { userId: 'user-b' } } as never), makeRes(), next);

    expect(vi.mocked(next).mock.calls.every((call) => call[0] === undefined)).toBe(true);
  });

  it('does not share buckets between two limiters', () => {
    const a = rateLimit({ name: 'alpha', windowMs: 60_000, max: 1 });
    const b = rateLimit({ name: 'beta', windowMs: 60_000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    a(makeReq(), makeRes(), next);
    b(makeReq(), makeRes(), next);

    expect(vi.mocked(next).mock.calls.every((call) => call[0] === undefined)).toBe(true);
  });

  it('lets the caller through again once the window has passed', () => {
    vi.useFakeTimers();
    const limiter = rateLimit({ name: 'test', windowMs: 1_000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq(), makeRes(), next);
    limiter(makeReq(), makeRes(), next);
    expect(vi.mocked(next).mock.calls[1]?.[0]).toBeInstanceOf(AppError);

    vi.advanceTimersByTime(1_001);
    limiter(makeReq(), makeRes(), next);
    expect(vi.mocked(next).mock.calls[2]?.[0]).toBeUndefined();
  });

  it('falls back to a stable key when there is neither user nor IP', () => {
    // Must not throw, and must still count — an unidentifiable caller is
    // exactly the one that should not get unlimited requests.
    const limiter = rateLimit({ name: 'test', windowMs: 60_000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq({ ip: undefined }), makeRes(), next);
    limiter(makeReq({ ip: undefined }), makeRes(), next);

    expect(vi.mocked(next).mock.calls[1]?.[0]).toBeInstanceOf(AppError);
  });
});
