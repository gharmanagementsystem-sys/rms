import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, request, setSessionCookieProvider, toApiError } from './client';

const envelope = (code: string, details?: { field: string; message: string }[]) => ({
  error: {
    code,
    message: 'Developer-facing message',
    requestId: 'req-123',
    ...(details ? { details } : {}),
  },
});

describe('error mapping', () => {
  it('preserves the server error code so the UI can translate it', () => {
    const error = toApiError(409, envelope('UNIT_ALREADY_OCCUPIED'));
    expect(error.code).toBe('UNIT_ALREADY_OCCUPIED');
    expect(error.status).toBe(409);
    expect(error.requestId).toBe('req-123');
  });

  it('keeps validation details', () => {
    const error = toApiError(
      422,
      envelope('VALIDATION_ERROR', [
        { field: 'body.amountPaisa', message: 'Must be a whole number' },
      ]),
    );
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toHaveLength(1);
  });

  it('strips the source prefix so a form can key errors by field name', () => {
    const error = toApiError(
      422,
      envelope('VALIDATION_ERROR', [
        { field: 'body.amountPaisa', message: 'Must be a whole number' },
        { field: 'query.limit', message: 'Too large' },
        { field: 'params.id', message: 'Not a valid id' },
      ]),
    );

    expect(error.fieldErrors()).toEqual({
      amountPaisa: 'Must be a whole number',
      limit: 'Too large',
      id: 'Not a valid id',
    });
  });

  it('handles a response that is not our envelope', () => {
    // A gateway or proxy answered, not the API.
    const error = toApiError(502, '<html>Bad Gateway</html>');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).not.toContain('html');
  });

  it('does not mistake a 4xx non-envelope for a server fault', () => {
    expect(toApiError(400, undefined).code).toBe('BAD_REQUEST');
  });
});

describe('retryability', () => {
  it.each([
    ['NETWORK_ERROR', 0, true],
    ['TIMEOUT', 0, true],
    ['SERVICE_UNAVAILABLE', 503, true],
    ['INTERNAL_ERROR', 500, true],
    ['VALIDATION_ERROR', 422, false],
    ['UNAUTHENTICATED', 401, false],
    ['CONFLICT', 409, false],
    ['NOT_FOUND', 404, false],
  ] as const)('%s is retryable=%s', (code, status, expected) => {
    const error = new ApiError({ code, status, message: 'x' });
    expect(error.isRetryable).toBe(expected);
  });

  it('never retries a validation failure — the input will not fix itself', () => {
    const error = new ApiError({ code: 'VALIDATION_ERROR', status: 422, message: 'x' });
    expect(error.isRetryable).toBe(false);
  });
});

describe('the server message is not for users', () => {
  it('is carried but marked as a developer fallback', () => {
    // The UI must switch on `code` and render its own translated string; this
    // asserts the raw message is available but distinct from the code.
    const error = toApiError(409, envelope('RENTAL_ALREADY_ENDED'));
    expect(error.message).toBe('Developer-facing message');
    expect(error.code).toBe('RENTAL_ALREADY_ENDED');
  });
});

describe('the session cookie travels with every request', () => {
  /**
   * This is a regression guard for a bug that made the whole app look broken on
   * a real device: sign-in succeeded, Better Auth's own endpoints saw the
   * session, and every /api/v1 call still came back 401.
   *
   * The cause was relying on `credentials: 'include'`, which is a browser
   * mechanism and a silent no-op in React Native. `@better-auth/expo` keeps the
   * session in SecureStore, so it has to be attached by hand.
   */
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setSessionCookieProvider(() => '');
  });

  function captureHeaders(): { current: Record<string, string> } {
    const captured = { current: {} as Record<string, string> };
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      captured.current = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    return captured;
  }

  it('sends the stored cookie on an authenticated request', async () => {
    setSessionCookieProvider(() => 'better-auth.session_token=abc123');
    const captured = captureHeaders();

    await request('/api/v1/users/me');

    expect(captured.current.cookie).toBe('better-auth.session_token=abc123');
  });

  it('sends no cookie header at all when signed out', async () => {
    setSessionCookieProvider(() => '');
    const captured = captureHeaders();

    await request('/api/v1/users/me');

    // An empty header is not the same as no header — some proxies treat a
    // blank cookie as a malformed one.
    expect(captured.current).not.toHaveProperty('cookie');
  });

  it('reads the provider per request, so signing in mid-session takes effect', async () => {
    let cookie = '';
    setSessionCookieProvider(() => cookie);
    const captured = captureHeaders();

    await request('/api/v1/users/me');
    expect(captured.current).not.toHaveProperty('cookie');

    cookie = 'better-auth.session_token=after-sign-in';
    await request('/api/v1/users/me');
    expect(captured.current.cookie).toBe('better-auth.session_token=after-sign-in');
  });

  it('does not let a caller-supplied header be silently dropped', async () => {
    setSessionCookieProvider(() => 'session=1');
    const captured = captureHeaders();

    await request('/api/v1/users/me', { headers: { 'x-trace': 'abc' } });

    expect(captured.current['x-trace']).toBe('abc');
    expect(captured.current.cookie).toBe('session=1');
  });
});
