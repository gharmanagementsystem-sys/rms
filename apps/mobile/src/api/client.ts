import { isApiErrorResponse, type ApiErrorDetail, type ErrorCode } from '@rms/shared';

/**
 * The single HTTP entry point. CLAUDE.md §37, §40.
 *
 * Screens never call `fetch`. Everything goes through here so timeouts, error
 * shape and auth are handled once.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A failed request, in a form the UI can act on.
 *
 * `code` is what the client switches on to pick a TRANSLATED message. The
 * server's `message` is a developer-facing fallback and is not localized, so it
 * must never be rendered to a user (§27, §40).
 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT';
  readonly status: number;
  readonly details: ApiErrorDetail[];
  /** Correlates with the server logs; safe to show on a support screen. */
  readonly requestId: string | null;

  constructor(init: {
    code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT';
    status: number;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
  }

  /** True when retrying might succeed — offline, timeout, or a server fault. */
  get isRetryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'SERVICE_UNAVAILABLE' ||
      this.status >= 500
    );
  }

  /** Field-level messages, keyed by the path the server reported. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const detail of this.details) {
      // Strip the source prefix: the form knows the field as `amountPaisa`,
      // not `body.amountPaisa`.
      errors[detail.field.replace(/^(body|query|params)\./, '')] = detail.message;
    }
    return errors;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

function baseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new Error('EXPO_PUBLIC_API_URL is not set. See apps/mobile/.env.example.');
  }
  return url.replace(/\/+$/, '');
}

/**
 * Converts any failure into an ApiError.
 *
 * Exported for testing, and because the mapping is the interesting part: it is
 * what stops a network blip and a validation failure being indistinguishable to
 * the UI.
 */
export function toApiError(status: number, body: unknown): ApiError {
  if (isApiErrorResponse(body)) {
    return new ApiError({
      code: body.error.code,
      status,
      message: body.error.message,
      details: body.error.details ?? [],
      requestId: body.error.requestId,
    });
  }

  // A non-conforming body means a proxy or gateway answered, not our API.
  return new ApiError({
    code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    status,
    message: 'The server returned an unexpected response.',
  });
}

/**
 * Supplies the stored session cookie for each request.
 *
 * WHY THIS IS INJECTED rather than imported: React Native has no dependable
 * cookie jar, and `@better-auth/expo` deliberately does not rely on one — it
 * keeps the session in SecureStore and expects every request to carry it
 * explicitly. `credentials: 'include'` is a browser mechanism and is silently a
 * no-op here, which is exactly why Better Auth's own endpoints saw the session
 * (its client attaches the cookie itself) while every `/api/v1` call returned
 * 401.
 *
 * Importing the auth client directly would drag expo-secure-store and the
 * native Better Auth plugin into this module, and this file must stay loadable
 * in a plain Node test environment. `lib/auth-client.ts` registers the provider
 * on import instead, which keeps the dependency pointing one way.
 */
type SessionCookieProvider = () => string;

let sessionCookieProvider: SessionCookieProvider = () => '';

export function setSessionCookieProvider(provider: SessionCookieProvider): void {
  sessionCookieProvider = provider;
}

function sessionHeaders(): Record<string, string> {
  const cookie = sessionCookieProvider();
  // Signed out: send no header at all rather than an empty one.
  return cookie ? { cookie } : {};
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, signal } = options;

  // Mobile networks stall rather than fail, so a request without a deadline can
  // hang indefinitely and leave a spinner on screen forever (§37).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...sessionHeaders(),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new ApiError({
      code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      status: 0,
      message: aborted ? 'The request timed out.' : 'Could not reach the server.',
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) throw toApiError(response.status, parsed);
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
