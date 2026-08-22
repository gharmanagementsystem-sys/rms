import { Router } from 'express';
import { APP_TIMEZONE } from '@rms/shared';
import { verifyDatabaseConnection } from '../../db/client';
import { AppError } from '../../errors/app-error';

export const healthRouter: Router = Router();

/**
 * Liveness probe. Render polls this continuously to decide whether to recycle
 * the instance, so it must stay cheap and must NOT touch the database — a slow
 * query should never cause a working instance to be killed.
 */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timezone: APP_TIMEZONE,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/**
 * Readiness probe. Verifies dependencies are actually usable.
 *
 * Kept separate from liveness so a database outage reports 503 (temporarily
 * unable to serve) instead of being mistaken for a dead process.
 */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    // Not a swallow: the driver error is carried as `cause`, logged in full by
    // the error handler, and replaced with a client-safe message so a
    // connection string can never reach a response body.
    throw AppError.unavailable('The database is not reachable.', error);
  }

  res.json({ status: 'ready', checks: { database: 'ok' } });
});
