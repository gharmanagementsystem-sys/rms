/**
 * The API error contract. CLAUDE.md §40.
 *
 * Every non-2xx response from the API has exactly this shape. The mobile client
 * switches on `code` to pick a translated message — the server's `message` is a
 * developer-facing fallback and is never localized, so it must not be rendered
 * to a user directly (§27).
 */

/**
 * Category codes. Every error resolves to exactly one of these, and each maps to
 * a distinct HTTP status so callers can distinguish validation failures from
 * authentication, authorization, not-found, conflict and internal errors without
 * parsing messages.
 *
 * Domain-specific codes (RENTAL_ALREADY_ENDED, INVALID_PAYMENT_AMOUNT, …) are
 * added to this union as their modules land, so the client keeps a single
 * exhaustive switch.
 */
export const ERROR_CODES = [
  // --- Categories ----------------------------------------------------------
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',

  // --- Domain (CLAUDE.md §40) ----------------------------------------------
  // Used where a client can act on the specific reason, rather than only on
  // the category. Each still maps to one of the categories' HTTP statuses.
  'PROPERTY_HAS_ACTIVE_RENTALS',
  'UNIT_HAS_ACTIVE_RENTAL',
  'UNIT_NOT_RENTABLE',
  'UNIT_ALREADY_OCCUPIED',
  'RENTAL_ALREADY_ACTIVE',
  'RENTAL_ALREADY_ENDED',
  'RENTAL_NOT_ACTIVE',
  'RENTAL_NOT_EDITABLE',
  'RENTAL_NOT_DRAFT',
  'UNAUTHORIZED_PROPERTY_ACCESS',
  'UNAUTHORIZED_RENTAL_ACCESS',
  'DUPLICATE_CHARGE_TYPE',
  'INVALID_CHARGE_CONFIGURATION',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorDetail {
  /**
   * Dot-path to the offending value, always prefixed by its source:
   * `body.amountPaisa`, `query.limit`, `params.id`.
   *
   * The prefix keeps a body field and a route param of the same name
   * distinguishable, which matters once nested resources appear.
   */
  field: string;
  message: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  /** Developer-facing. Not localized — never render this to a user. */
  message: string;
  /** Present for VALIDATION_ERROR; omitted otherwise. */
  details?: ApiErrorDetail[];
  /** Correlates this response with server logs. Safe to show in a support screen. */
  requestId: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/** Narrow an unknown response body to the API error envelope. */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = (value as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<ApiErrorBody>;
  return (
    isErrorCode(candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.requestId === 'string'
  );
}
