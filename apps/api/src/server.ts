import { createApp } from './app';
import { env } from './config/env';
import { closeDatabase, verifyDatabaseConnection } from './db/client';
import { logger } from './services/logger';

const app = createApp();

const server = app.listen(env.PORT, () => {
  /**
   * `betterAuthUrl` is logged every boot, not just when it looks wrong.
   *
   * It is baked into every verification and password-reset link at the
   * moment each one is sent, and `tsx watch` only reloads *source* — editing
   * .env while the process is already running does not take effect until a
   * restart. Without this line, a stale value (silently falling back to its
   * `http://localhost:4000` default, which no phone on the network can reach)
   * is invisible until a user reports a dead link. Same principle as the mail
   * transport log in services/mailer.ts.
   */
  logger.info(
    { port: env.PORT, nodeEnv: env.NODE_ENV, betterAuthUrl: env.BETTER_AUTH_URL },
    'API listening',
  );
});

/**
 * Neon suspends an idle compute and resumes it on the next connection, which
 * regularly takes 10-20+ seconds (see the comment on `connectionTimeoutMillis`
 * in db/client.ts). Without this, that wake-up happens on whichever request
 * arrives first after a cold start — often a user's sign-in — turning normal
 * Neon behaviour into a slow, unexplained request. Pinging once at boot moves
 * the wait here, where a slow response is invisible instead of a 500 in
 * someone's face. Logged but never fatal: a still-sleeping database at boot
 * must not stop the process from serving requests once it wakes.
 */
verifyDatabaseConnection()
  .then(() => logger.info('Database connection warmed'))
  .catch((error: unknown) => {
    logger.warn({ err: error }, 'Database warm-up failed at boot; will retry on first request');
  });

let shuttingDown = false;

/**
 * Render sends SIGTERM on deploy and on scale-down. Draining lets in-flight
 * requests finish rather than being severed mid-response — which, for a payment
 * request, would leave the client unable to tell whether it succeeded.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down');

  // Refuse new connections, then wait for active ones to complete.
  await new Promise<void>((resolve) => server.close(() => resolve()));

  try {
    await closeDatabase();
  } catch (error) {
    logger.error({ err: error }, 'Failed to close the database pool cleanly');
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));

// A stuck connection must not hold the process open forever; Render will
// SIGKILL eventually, but exiting deliberately keeps the logs honest.
process.on('SIGTERM', () => {
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000).unref();
});

/**
 * Last-resort handlers. These do not swallow anything: they log the fault with
 * its stack and exit non-zero so the platform restarts a process whose state is
 * no longer trustworthy.
 */
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
