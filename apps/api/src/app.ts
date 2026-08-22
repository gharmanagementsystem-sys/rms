import express, { type Express } from 'express';
import compression from 'compression';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/better-auth';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { rateLimit } from './middleware/rate-limit';
import { attachAuthIfPresent } from './middleware/require-auth';
import { requestLogger } from './middleware/request-logger';
import { internalRouter } from './modules/internal/internal.routes';
import { apiV1Router } from './routes/index';

/**
 * Browser origin policy.
 *
 * With no allowlist configured, development reflects any origin so a local web
 * debugger works, while production allows none. Native mobile clients are not
 * subject to CORS, so denying browsers by default is the safe production
 * posture — the alternative would open the API to any website (CLAUDE.md §32).
 */
function buildCorsOptions(): CorsOptions {
  if (env.corsOrigins.length > 0) {
    return { origin: [...env.corsOrigins], credentials: true };
  }
  return { origin: !env.isProduction, credentials: true };
}

/**
 * Assembles the Express application.
 *
 * Kept separate from server.ts so tests can build an app without binding a port.
 *
 * Middleware order is deliberate:
 *   1. request logger  — assigns req.id, so even a 404 is traceable
 *   2. security headers and CORS
 *   3. body parsing
 *   4. routes
 *   5. 404 handler     — turns an unmatched path into a normal AppError
 *   6. error handler   — the only place an error response is shaped
 */
export function createApp(): Express {
  const app = express();

  // Do not advertise the framework.
  app.disable('x-powered-by');
  // Render terminates TLS upstream; without this, req.ip and secure-cookie
  // handling see the proxy rather than the client.
  app.set('trust proxy', 1);

  app.use(requestLogger);

  // HSTS is meaningless over plain HTTP locally and can poison a developer's
  // browser for localhost, so it is enabled in production only.
  app.use(helmet({ hsts: env.isProduction }));
  app.use(cors(buildCorsOptions()));

  // Nepal's mobile networks are frequently slow or metered (CLAUDE.md §3.4,
  // §36) — gzip/brotli cuts JSON payload size for near-zero CPU cost.
  app.use(compression());

  /**
   * Better Auth owns /api/auth/*.
   *
   * This MUST be mounted before express.json(): the handler consumes the raw
   * request stream itself, and a body parser that has already drained it makes
   * every sign-in hang.
   *
   * The `{*any}` form is Express 5 path syntax — the bare `*` wildcard of
   * Express 4 no longer matches, and silently 404s the whole auth surface.
   */
  app.all('/api/auth/{*any}', toNodeHandler(auth));

  // A rent-management payload is small. A low cap is a cheap DoS guard, and
  // body-parser's `entity.too.large` is mapped to 413 by the error handler.
  app.use(express.json({ limit: '100kb' }));

  /**
   * Abuse guards. Better Auth limits /api/auth itself; these cover the rest.
   *
   * The general limit is high enough that ordinary use — a dashboard refresh
   * pulling several resources, a user scrolling — never approaches it, and low
   * enough to stop a script.
   *
   * Active in development as well as production, deliberately: a guard that
   * only ever runs in production is a guard whose wiring has never been
   * exercised before it matters. Only tests are exempt, because a fixture
   * issuing dozens of requests in a second is not abuse and a flaky 429 in CI
   * teaches nothing.
   */
  if (!env.isTest) {
    // Every module router under /api/v1 applies its own `requireAuth` further
    // down the stack, so without this, `rateLimit` below would never see
    // `req.auth` and would always key on IP alone — punishing everyone behind
    // a shared or carrier-grade NAT together. This runs first so the limiter
    // can key on the signed-in user instead; see `attachAuthIfPresent`'s own
    // comment for why that is safe to do unconditionally.
    app.use('/api/v1', attachAuthIfPresent);
    app.use('/api/v1', rateLimit({ name: 'api', windowMs: 60_000, max: 300 }));
    // The scheduler calls a handful of jobs a day. A tight limit here is what
    // makes the bearer token infeasible to brute-force. Internal routes carry
    // a bearer token, not a session, so IP is the only signal available and
    // the right one.
    app.use('/api/internal', rateLimit({ name: 'internal', windowMs: 60_000, max: 30 }));
  }

  app.use('/api/v1', apiV1Router);
  // Bearer-token authenticated, for Render's Cron Job service.
  app.use('/api/internal', internalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
