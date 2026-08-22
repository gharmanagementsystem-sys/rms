import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppError } from '../errors/app-error';
import { logger } from '../services/logger';
import { createTestApp } from '../testing/create-test-app';

describe('error handler', () => {
  describe('error categories are distinguishable', () => {
    // CLAUDE.md §40 — a client must be able to tell these apart without
    // parsing messages. Each maps to a distinct code AND a distinct status.
    it.each([
      ['validation', () => AppError.validation([]), 422, 'VALIDATION_ERROR'],
      ['authentication', () => AppError.unauthenticated(), 401, 'UNAUTHENTICATED'],
      ['authorization', () => AppError.forbidden(), 403, 'FORBIDDEN'],
      ['not found', () => AppError.notFound(), 404, 'NOT_FOUND'],
      ['conflict', () => AppError.conflict('Already ended.'), 409, 'CONFLICT'],
      ['rate limit', () => AppError.rateLimited(), 429, 'RATE_LIMITED'],
      ['internal', () => AppError.internal(), 500, 'INTERNAL_ERROR'],
      ['unavailable', () => AppError.unavailable(), 503, 'SERVICE_UNAVAILABLE'],
    ])('%s → %d', async (_name, makeError, status, code) => {
      const app = createTestApp((router) => {
        router.get('/boom', () => {
          throw makeError();
        });
      });

      const response = await request(app).get('/test/boom');

      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
      expect(typeof response.body.error.message).toBe('string');
      expect(typeof response.body.error.requestId).toBe('string');
    });
  });

  it('includes per-field details on validation errors only', async () => {
    const details = [{ field: 'body.amountPaisa', message: 'Must be a whole number' }];
    const app = createTestApp((router) => {
      router.get('/invalid', () => {
        throw AppError.validation(details);
      });
      router.get('/conflict', () => {
        throw AppError.conflict('Rental already ended.');
      });
    });

    const invalid = await request(app).get('/test/invalid');
    expect(invalid.body.error.details).toEqual(details);

    const conflict = await request(app).get('/test/conflict');
    expect(conflict.body.error).not.toHaveProperty('details');
  });

  it('never leaks an internal error message, cause or stack to the client', async () => {
    const connectionString = 'postgresql://rms:sup3rs3cret@db.example.com/rms';
    const app = createTestApp((router) => {
      router.get('/boom', () => {
        throw new Error(`ECONNREFUSED connecting to ${connectionString}`);
      });
    });

    const response = await request(app).get('/test/boom');
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(serialized).not.toContain('sup3rs3cret');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('db.example.com');
    expect(response.body.error).not.toHaveProperty('stack');
  });

  it('logs the original cause instead of swallowing it', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = createTestApp((router) => {
      router.get('/boom', () => {
        throw new Error('underlying driver failure');
      });
    });

    await request(app).get('/test/boom');

    // pino-http also logs the completed request at error level for a 5xx, so
    // there are two error lines. Find the one written by the error handler.
    const contexts = spy.mock.calls
      .map((call) => call[0])
      .filter(
        (arg): arg is { err?: Error; code?: string } =>
          typeof arg === 'object' && arg !== null && 'code' in arg,
      );

    const handled = contexts.find((context) => context.code === 'INTERNAL_ERROR');
    expect(handled).toBeDefined();
    expect(handled?.err?.message).toBe('underlying driver failure');
  });

  it('catches errors thrown from async handlers', async () => {
    const app = createTestApp((router) => {
      router.get('/boom', async () => {
        await Promise.resolve();
        throw AppError.conflict('Rental already ended.');
      });
    });

    const response = await request(app).get('/test/boom');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('maps unparseable JSON to BAD_REQUEST, not INTERNAL_ERROR', async () => {
    const app = createTestApp((router) => {
      router.post('/echo', (_req, res) => res.json({ ok: true }));
    });

    const response = await request(app)
      .post('/test/echo')
      .set('Content-Type', 'application/json')
      .send('{"unterminated":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('maps an oversized body to PAYLOAD_TOO_LARGE', async () => {
    const app = createTestApp((router) => {
      router.post('/echo', (_req, res) => res.json({ ok: true }));
    });

    const response = await request(app)
      .post('/test/echo')
      .send({ note: 'x'.repeat(4000) });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns a structured 404 for an unmatched route', async () => {
    const app = createTestApp(() => {});

    const response = await request(app).get('/no/such/path');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });
});

describe('request correlation id', () => {
  it('echoes the id in both the header and the error body', async () => {
    const app = createTestApp((router) => {
      router.get('/boom', () => {
        throw AppError.notFound();
      });
    });

    const response = await request(app).get('/test/boom');

    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('adopts a well-formed client-supplied id', async () => {
    const app = createTestApp((router) => {
      router.get('/ok', (_req, res) => res.json({ ok: true }));
    });

    const response = await request(app).get('/test/ok').set('x-request-id', 'trace-abc_123');

    expect(response.headers['x-request-id']).toBe('trace-abc_123');
  });

  it.each([
    ['punctuation that could confuse a log parser', 'abc [fatal] forged=1'],
    ['angle brackets', '<script>alert(1)</script>'],
    ['an over-long value', 'a'.repeat(200)],
  ])('replaces a malformed client id — %s', async (_case, hostile) => {
    const app = createTestApp((router) => {
      router.get('/boom', () => {
        throw AppError.notFound();
      });
    });

    // Note: values containing a newline are rejected by Node's HTTP client
    // before they are ever sent, so genReqId is the second line of defence.
    const response = await request(app).get('/test/boom').set('x-request-id', hostile);

    const id = response.body.error.requestId;
    expect(id).not.toBe(hostile);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(response.headers['x-request-id']).toBe(id);
  });
});
