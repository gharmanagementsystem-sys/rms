import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Terminal 404 for unmatched routes.
 *
 * Routed through the error handler rather than responding directly, so an
 * unknown path produces the same envelope, the same log line and the same
 * request id as every other error.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}.`));
};
