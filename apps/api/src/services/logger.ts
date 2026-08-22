import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env';

/**
 * Structured logging. CLAUDE.md §65.
 *
 * Redaction is defence in depth, not the primary control. The primary control is
 * that we never pass sensitive values to the logger in the first place — most
 * importantly, request and response **bodies are never logged**, because they
 * carry payment amounts, balances and personal data (§32, §65).
 */
const REDACTED_PATHS = [
  // Credentials arriving on the wire.
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',

  // Anything that looks like a credential, at any nesting depth.
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.sessionToken',
  '*.idToken',
  '*.secret',
  '*.clientSecret',
  '*.apiKey',
  '*.authorization',

  // Connection strings embed a password.
  '*.connectionString',
  '*.DATABASE_URL',
  '*.databaseUrl',
];

const options: LoggerOptions = {
  // Tests assert on logger calls via spies, so silence output rather than
  // disabling the logger — the methods must remain callable.
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { env: env.NODE_ENV },
  formatters: {
    // Emit `"level":"info"` rather than `"level":30`, so log search is legible.
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Human-readable locally; machine-readable JSON everywhere else so Render's
  // log drain and any future aggregator can parse it.
  ...(env.isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,env' },
        },
      }
    : {}),
};

export const logger = pino(options);

export type Logger = typeof logger;
