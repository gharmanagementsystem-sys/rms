import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Load environment files before anything reads process.env.
 *
 * Both locations are supported so a single repo-root .env can hold shared
 * values (the database URL) while app-specific overrides live beside the app.
 *
 * dotenv does not overwrite a variable that is already set, and it processes
 * the list in order, so apps/api/.env wins over the repo root, and a real
 * environment variable (Render, CI) wins over both.
 *
 * Paths are resolved from the working directory rather than from this file,
 * because the file sits at src/config/ in development but at dist/ after a
 * build — a file-relative path would silently point somewhere else in
 * production. npm workspace scripts always run with the app as the cwd.
 */
dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'), // apps/api/.env
    path.resolve(process.cwd(), '../../.env'), // repo root .env
  ],
  quiet: true,
});

/**
 * Environment configuration. CLAUDE.md §64.
 *
 * Parsed and validated once, at boot. The process refuses to start on invalid
 * configuration rather than failing later inside a request handler — a server
 * running without a database URL is worse than a server that never started.
 *
 * Every variable added here must also be documented in docs/env.md and listed
 * in apps/api/.env.example.
 */

/**
 * `z.coerce.boolean()` is unusable for env vars: it follows JavaScript
 * truthiness, so the string "false" coerces to `true`. Parse explicitly.
 */
const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .describe('true or false');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Comma-separated browser origin allowlist. See `corsOrigins` below. */
  CORS_ORIGINS: z.string().default(''),

  /**
   * Neon PostgreSQL connection string. Required — there is no meaningful
   * fallback, and defaulting to a local database would let a misconfigured
   * production deploy start up pointing at nothing.
   */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),

  /**
   * Keep this small. Neon's pooler is what scales connections; a large
   * per-instance pool just exhausts the project's connection budget.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  /**
   * Neon requires TLS in every environment, so this defaults to on.
   *
   * The default is the boolean `true`, not the string `'true'`: zod applies
   * `.default()` after `.transform()`, so it is typed against the output.
   * An absent variable therefore skips the enum entirely and yields `true`,
   * while an unrecognised value like `yes` still fails with a clear message.
   */
  DATABASE_SSL: booleanFromString.default(true),

  /**
   * Signs session tokens. Never defaulted — a predictable signing key means
   * forgeable sessions. Generate with: openssl rand -base64 32
   */
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  /**
   * Public base URL of this API. Better Auth builds OAuth callback URLs from
   * it, so a wrong value breaks Google sign-in in a way that is awkward to
   * diagnose from the client side.
   */
  BETTER_AUTH_URL: z.url().default('http://localhost:4000'),

  /**
   * Google OAuth. Optional in development so the API runs without Google
   * credentials; required in production — see the refinement below.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * The mobile app's deep-link scheme, from apps/mobile/app.json. Better Auth
   * must trust it to complete the OAuth redirect back into the app.
   */
  MOBILE_APP_SCHEME: z.string().min(1).default('rms'),

  /** Shown in email subjects and bodies. */
  APP_NAME: z.string().min(1).default('Rent Management Nepal'),

  /**
   * Outbound email over SMTP — the fallback transport.
   *
   * Some mail transport is required in production, because email verification
   * and password reset are not optional in a system holding financial records:
   * without them, an unverifiable address can squat an account and a locked-out
   * user has no recovery path except an insecure manual reset. Either these
   * four variables or the Resend pair below satisfies that.
   *
   * Kept alongside Resend so any provider remains usable — Brevo, Postmark,
   * Zoho, or a Nepali host — without a code change.
   *
   * When neither transport is configured in development, mail is written to the
   * log instead of sent, so the verification link is still reachable.
   */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  /** true for implicit TLS on port 465; false for STARTTLS on 587. */
  SMTP_SECURE: booleanFromString.default(false),

  /**
   * Resend, used in preference to SMTP when both are configured.
   *
   * Preferred because it reports a message id and a readable error body, so a
   * rejected address or a domain that is not verified yet is diagnosable —
   * whereas SMTP tends to fail as an opaque timeout. It also avoids outbound
   * port 587, which some networks block.
   *
   * The SMTP path is kept: this is a server-side credential either way, and
   * keeping both means switching provider stays a configuration change.
   */
  RESEND_API_KEY: z.string().min(1).optional(),

  /**
   * The From address for outbound mail, e.g. "Gharbeti <no-reply@example.com>".
   *
   * Its domain must be verified with the provider, and any local part on a
   * verified domain works. Resend also accepts `onboarding@resend.dev` with no
   * verified domain at all, but delivers only to the Resend account owner's own
   * address and rejects every other recipient with a 403 — usable for a smoke
   * test, useless for real users.
   */
  EMAIL_FROM: z.string().min(1).optional(),

  /**
   * Firebase service account JSON, base64-encoded.
   *
   * Base64 because the raw key is multi-line JSON, which does not survive an
   * environment variable intact. Required in production — see the refinement.
   *
   * These are SERVER credentials and must never reach the mobile app (§20).
   */
  FIREBASE_SERVICE_ACCOUNT: z.string().min(1).optional(),

  /**
   * Bearer token protecting the internal job endpoints.
   *
   * Render's cron service triggers jobs over HTTP, so those routes are publicly
   * reachable and need their own guard — a session cookie is not available to a
   * scheduler.
   */
  JOB_RUNNER_TOKEN: z.string().min(24, 'JOB_RUNNER_TOKEN must be at least 24 characters'),

  /**
   * Runs the scheduler inside this process.
   *
   * Off by default: on Render the jobs are driven by a separate Cron Job
   * service hitting the internal endpoint, which keeps working when the web
   * service is asleep or replaced mid-deploy. In-process cron is a local
   * development convenience.
   */
  ENABLE_IN_PROCESS_SCHEDULER: booleanFromString.default(false),
});

/**
 * Google sign-in is a shipped V1 feature, so a production deploy missing its
 * credentials is a misconfiguration rather than an opt-out. Failing at boot
 * beats discovering it when a user taps "Continue with Google".
 */
const EnvSchemaWithProductionRules = EnvSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const) {
    if (!value[key]) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required in production (Google sign-in is enabled in V1)`,
      });
    }
  }

  /**
   * Some mail transport must exist in production. Without one, email
   * verification and password reset silently stop working — a user cannot
   * complete sign-up or recover an account, and nothing errors until someone
   * reports it.
   *
   * Either provider satisfies this. The check is on capability, not on a
   * particular vendor's variables, so switching provider does not mean editing
   * this rule.
   */
  const hasResend = Boolean(value.RESEND_API_KEY && value.EMAIL_FROM);
  const hasSmtp = Boolean(
    value.SMTP_HOST && value.SMTP_USER && value.SMTP_PASSWORD && value.SMTP_FROM,
  );

  if (!hasResend && !hasSmtp) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message:
        'A mail transport is required in production: set RESEND_API_KEY + EMAIL_FROM, or the four SMTP_* variables. Email verification and password reset depend on it.',
    });
  }

  // Push is a shipped feature; a production deploy without FCM credentials
  // would create notification records that are never delivered, with no error.
  if (!value.FIREBASE_SERVICE_ACCOUNT) {
    ctx.addIssue({
      code: 'custom',
      path: ['FIREBASE_SERVICE_ACCOUNT'],
      message: 'FIREBASE_SERVICE_ACCOUNT is required in production (push notifications)',
    });
  }

  // A production deployment reachable over plain HTTP would send session
  // cookies in the clear.
  if (!value.BETTER_AUTH_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['BETTER_AUTH_URL'],
      message: 'BETTER_AUTH_URL must use https:// in production',
    });
  }
});

type RawEnv = z.infer<typeof EnvSchema>;

export interface Env extends RawEnv {
  readonly corsOrigins: readonly string[];
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  /** True only when both Google credentials are present. */
  readonly isGoogleAuthEnabled: boolean;
  /** True when any real mail transport is configured (Resend or SMTP). */
  readonly isEmailEnabled: boolean;
}

function loadEnv(): Env {
  const parsed = EnvSchemaWithProductionRules.safeParse(process.env);

  if (!parsed.success) {
    // Deliberately console.error rather than the logger: the logger is
    // configured from this module, so it does not exist yet.
    //
    // Only the failing variable NAME and the reason are printed. Values are
    // never echoed, because one of them is a database URL containing a
    // password (CLAUDE.md §32, §65).
    console.error('Invalid environment configuration. The API will not start.\n');
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '(root)';
      console.error(`  ✗ ${key}: ${issue.message}`);
    }
    console.error('\nSee apps/api/.env.example and docs/env.md.');
    process.exit(1);
  }

  const data = parsed.data;

  return {
    ...data,
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    isDevelopment: data.NODE_ENV === 'development',
    isProduction: data.NODE_ENV === 'production',
    isTest: data.NODE_ENV === 'test',
    isGoogleAuthEnabled: Boolean(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),
    isEmailEnabled: Boolean(
      (data.RESEND_API_KEY && data.EMAIL_FROM) ??
      (data.SMTP_HOST && data.SMTP_USER && data.SMTP_PASSWORD && data.SMTP_FROM),
    ),
  };
}

export const env: Env = loadEnv();
