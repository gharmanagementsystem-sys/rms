import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { isJobName, runJobByName } from '../../jobs/jobs';

/**
 * Internal job triggers. CLAUDE.md §19.
 *
 * On Render the scheduler is a separate Cron Job service that calls these
 * endpoints over HTTP. That is preferred over an in-process cron because it
 * keeps running when the web service is replaced mid-deploy or scaled to zero,
 * and because a web instance restarting must not skip a day's billing.
 *
 * A scheduler has no session, so these routes carry their own bearer token.
 */
export const internalRouter: Router = Router();

/**
 * Constant-time comparison.
 *
 * A plain `===` leaks the token one character at a time through response
 * timing, which is exactly the shape of secret an attacker can brute-force.
 */
function tokenMatches(provided: string): boolean {
  const expected = Buffer.from(env.JOB_RUNNER_TOKEN, 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so the lengths are equalised first.
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, actual);
}

const requireJobToken: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !tokenMatches(provided)) {
    next(AppError.unauthenticated('A valid job token is required.'));
    return;
  }
  next();
};

internalRouter.use(requireJobToken);

/**
 * Runs one job.
 *
 * Safe to call repeatedly: each job claims its window through a unique
 * constraint and is independently idempotent, so a retrying scheduler cannot
 * double-bill or double-notify (§16, §18).
 */
internalRouter.post('/jobs/:name', (async (req, res) => {
  // Express 5 types a route param as possibly an array; narrow before use.
  const raw = req.params['name'];
  const name = Array.isArray(raw) ? raw[0] : raw;

  if (typeof name !== 'string' || !isJobName(name)) {
    throw AppError.notFound('No such job.');
  }

  const result = await runJobByName(name);

  // A skipped run is a success from the scheduler's point of view — the work
  // was already done — so it must not be reported as a failure and retried.
  res.status(result.outcome === 'FAILED' ? 500 : 200).json(result);
}) as RequestHandler);
