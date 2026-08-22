import express, { Router, type Express } from 'express';
import { errorHandler } from '../middleware/error-handler';
import { notFoundHandler } from '../middleware/not-found';
import { requestLogger } from '../middleware/request-logger';

/**
 * Test-only infrastructure.
 *
 * Builds a minimal app wired with the real request/error middleware stack so
 * middleware behaviour is exercised as it actually runs in production, rather
 * than against a hand-rolled stand-in.
 *
 * The body limit is deliberately tiny (1kb) so the 413 path is testable without
 * constructing a 100kb payload.
 */
export function createTestApp(configure: (router: Router) => void): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(express.json({ limit: '1kb' }));

  const router = Router();
  configure(router);
  app.use('/test', router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
