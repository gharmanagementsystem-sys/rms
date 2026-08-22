import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorDetail, ApiErrorResponse } from '@rms/shared';
import { AppError, isAppError } from '../errors/app-error';
import { logger } from '../services/logger';

/**
 * Centralized error handling. CLAUDE.md §40.
 *
 * This is the ONLY place an error response is shaped. Nothing else in the
 * codebase writes an error body, so the envelope cannot drift between modules.
 *
 * Nothing is ever swallowed: every error reaching here is logged with its
 * original cause and stack before a sanitized response is returned.
 */

/** Shape body-parser attaches to its failures. */
interface BodyParserError extends Error {
  type?: string;
}

function zodToDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.map((segment) => String(segment)).join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Map any thrown value onto an AppError.
 *
 * Unrecognised errors become INTERNAL_ERROR with the original attached as
 * `cause` — never discarded, never exposed.
 */
function normalize(error: unknown): AppError {
  if (isAppError(error)) return error;

  // A ZodError escaping a service means a schema was applied outside the
  // validate() middleware. Still a client data problem, so report it as one.
  if (error instanceof ZodError) return AppError.validation(zodToDetails(error));

  if (error instanceof Error) {
    const { type } = error as BodyParserError;
    if (type === 'entity.parse.failed') {
      return AppError.badRequest('The request body is not valid JSON.', error);
    }
    if (type === 'entity.too.large') {
      return AppError.payloadTooLarge(undefined, error);
    }
  }

  return AppError.internal(undefined, error);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const requestId = typeof req.id === 'string' ? req.id : String(req.id ?? 'unknown');

  // Headers already sent means the response is mid-flight; we cannot replace it
  // with an error body. Delegate to Express's default handler (which destroys
  // the connection) but log first, so the failure is never invisible.
  if (res.headersSent) {
    logger.error(
      { reqId: requestId, method: req.method, url: req.originalUrl, err },
      'Error thrown after response headers were sent',
    );
    next(err);
    return;
  }

  const appError = normalize(err);

  const logContext = {
    reqId: requestId,
    code: appError.code,
    status: appError.status,
    method: req.method,
    url: req.originalUrl,
    // The underlying fault, with stack. Logged only — never serialized into the
    // response, because it can carry driver internals or connection details.
    err: appError.cause ?? appError,
  };

  if (appError.status >= 500) {
    logger.error(logContext, appError.message);
  } else {
    logger.warn(logContext, appError.message);
  }

  const body: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId,
    },
  };

  res.status(appError.status).json(body);
};
