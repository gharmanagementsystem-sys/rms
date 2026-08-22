import type { ApiErrorDetail, ErrorCode } from '@rms/shared';

/**
 * The only error type the application throws deliberately.
 *
 * Invariant: `message` is always safe to return to a client. Anything that is
 * not safe to expose — a driver error, a connection string, a stack trace —
 * goes in `cause`, which is logged and never serialized into a response.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[] | undefined;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { details?: ApiErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = options.details;
    Error.captureStackTrace?.(this, AppError);
  }

  /** Malformed request that is not a schema violation — unparseable JSON, etc. */
  static badRequest(message = 'The request could not be understood.', cause?: unknown): AppError {
    return new AppError('BAD_REQUEST', 400, message, { cause });
  }

  /** Schema violation. Always carries per-field details. */
  static validation(
    details: ApiErrorDetail[],
    message = 'The submitted data is not valid.',
  ): AppError {
    return new AppError('VALIDATION_ERROR', 422, message, { details });
  }

  /** No valid session. The caller has not proven who they are. */
  static unauthenticated(message = 'Authentication is required.'): AppError {
    return new AppError('UNAUTHENTICATED', 401, message);
  }

  /** Authenticated, but not permitted to act on this resource. */
  static forbidden(message = 'You do not have access to this resource.'): AppError {
    return new AppError('FORBIDDEN', 403, message);
  }

  static notFound(message = 'The requested resource was not found.'): AppError {
    return new AppError('NOT_FOUND', 404, message);
  }

  /** State conflict — duplicate, or an operation invalid for the current state. */
  static conflict(message: string): AppError {
    return new AppError('CONFLICT', 409, message);
  }

  static payloadTooLarge(message = 'The request payload is too large.', cause?: unknown): AppError {
    return new AppError('PAYLOAD_TOO_LARGE', 413, message, { cause });
  }

  static rateLimited(message = 'Too many requests. Please try again shortly.'): AppError {
    return new AppError('RATE_LIMITED', 429, message);
  }

  /**
   * Unexpected server fault. The default message is deliberately generic; put
   * the real diagnosis in `cause` so it reaches the logs and not the client.
   */
  static internal(
    message = 'Something went wrong on our side. Please try again.',
    cause?: unknown,
  ): AppError {
    return new AppError('INTERNAL_ERROR', 500, message, { cause });
  }

  /** A dependency (database, upstream service) is unavailable. */
  static unavailable(
    message = 'The service is temporarily unavailable. Please try again shortly.',
    cause?: unknown,
  ): AppError {
    return new AppError('SERVICE_UNAVAILABLE', 503, message, { cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
