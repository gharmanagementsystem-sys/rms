import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { haveIBeenPwned } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import type { Language } from '@rms/shared';
import { env } from '../config/env';
import { prisma } from '../db/client';
import { logger } from '../services/logger';
import { mailer } from '../services/mailer';
import {
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from '../services/email/templates';
import { recordAuthEvent } from './audit';

/**
 * Authentication. CLAUDE.md §49, §32.
 *
 * Better Auth owns password hashing (scrypt), session issuance and OAuth
 * entirely — we implement no cryptography of our own (§4). Sessions are
 * database-backed, so a sign-out or a forced revocation takes effect
 * immediately rather than waiting for a stateless token to expire.
 */

if (!env.isGoogleAuthEnabled && !env.isTest) {
  logger.warn('Google sign-in is disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
}

/**
 * The language to write to a user in.
 *
 * Reads the stored preference so a Nepali user does not receive an
 * English-only security alert about their own account (§27). Falls back to
 * English on any failure — including at sign-up, where no preferences row
 * exists yet — because a delivered email in the wrong language beats an
 * undelivered one.
 */
async function preferredLanguage(userId: string): Promise<Language> {
  try {
    const preferences = await prisma.userPreferences.findUnique({
      where: { userId },
      select: { language: true },
    });
    return preferences?.language === 'ne' ? 'ne' : 'en';
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not read language preference for an email');
    return 'en';
  }
}

/**
 * Builds an emailed auth link.
 *
 * The link points at the API, which validates the single-use token and then
 * redirects into the mobile app via its deep-link scheme. `callbackURL` must
 * resolve to a trusted origin or Better Auth rejects it with
 * INVALID_CALLBACK_URL — which is why the scheme is listed in trustedOrigins.
 *
 * Known limitation: a custom scheme only opens if the email is read on the
 * device that has the app installed. Opening it on a desktop will not resolve.
 * Fixing that properly needs universal links / Android App Links, which require
 * a hosted domain and are deferred until there is one.
 */
function buildAuthLink(apiPath: string, appPath: string): string {
  const callbackURL = `${env.MOBILE_APP_SCHEME}://${appPath}`;
  const separator = apiPath.includes('?') ? '&' : '?';
  return `${env.BETTER_AUTH_URL}${apiPath}${separator}callbackURL=${encodeURIComponent(callbackURL)}`;
}

const googleProvider =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          // Ask Google to re-issue a refresh token and show the account
          // chooser rather than silently reusing a previous grant.
          prompt: 'select_account' as const,
        },
      }
    : {};

export const auth = betterAuth({
  appName: env.APP_NAME,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  emailAndPassword: {
    enabled: true,
    // These are financial records. A short minimum is the cheapest possible
    // way to weaken every account at once.
    minPasswordLength: 10,
    maxPasswordLength: 128,

    /**
     * Required. Without it, anyone can sign up using an address they do not
     * control — squatting the account a real owner would later want, and
     * receiving that person's rent notifications in the meantime.
     */
    requireEmailVerification: true,

    /**
     * Every existing session is destroyed when a password is reset. If an
     * attacker already had a session, a password change that left it alive
     * would give the user false confidence that they had locked the intruder
     * out.
     */
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, token }) => {
      // The new password must be typed inside the app, so the link goes
      // through the API (which validates the token) and then deep-links back.
      const mail = resetPasswordTemplate({
        url: buildAuthLink(
          `/api/auth/reset-password/${encodeURIComponent(token)}`,
          // No group in the path: Expo Router's (auth) folder is a grouping
          // device and never appears in a URL, so the deep link that reaches
          // app/(auth)/reset-password.tsx is rms://reset-password.
          'reset-password',
        ),
        name: user.name,
        locale: await preferredLanguage(user.id),
      });

      // Logged rather than thrown: ForgotPasswordScreen always reports the
      // same generic success regardless of whether the address is registered
      // (anti-enumeration, §32) — letting a slow mail provider surface as a
      // 500 here would be the one case that visibly behaves differently for a
      // real account. The token still exists and can be reissued by asking
      // again, exactly as it would need to be if the address genuinely had no
      // account.
      try {
        await mailer.send({ to: user.email, ...mail });
      } catch (error) {
        logger.error({ err: error, userId: user.id }, 'Could not send the password reset email');
      }
    },

    /**
     * Security alert after the password actually changes.
     *
     * Separate from the reset link, and sent after the fact — this is the
     * message that lets an owner notice a takeover they did not start. Failure
     * is logged rather than thrown: the password change has already succeeded,
     * and rejecting the request at this point would tell the user their reset
     * failed when it did not (§40).
     */
    onPasswordReset: async ({ user }) => {
      try {
        const mail = passwordChangedTemplate({
          name: user.name,
          locale: await preferredLanguage(user.id),
        });
        await mailer.send({ to: user.email, ...mail });
      } catch (error) {
        logger.error(
          { err: error, userId: user.id },
          'Password was reset but the confirmation email could not be sent',
        );
      }
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // A freshly verified user is signed in immediately rather than being sent
    // back to a login screen for no reason.
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60, // 1 hour
    sendVerificationEmail: async ({ user, token }) => {
      const mail = verifyEmailTemplate({
        url: buildAuthLink(
          `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
          // See the note on reset-password: the route group is not part of the
          // URL, so this must not be prefixed with `auth/`.
          'email-verified',
        ),
        name: user.name,
        // At sign-up there are usually no preferences yet, so this falls back
        // to English — see `preferredLanguage`.
        locale: await preferredLanguage(user.id),
      });

      /**
       * Logged rather than thrown.
       *
       * By the time this hook runs the account already exists — a real 500
       * here does not undo that, it only tells the client sign-up failed when
       * it actually succeeded, leaving someone with a working account they
       * don't know they have and no error that explains why. The client's
       * "Resend verification email" button calls this exact hook again, which
       * is the intended recovery path for a mail provider that was briefly
       * slow or unreachable — better than the whole request failing over it,
       * matching the same trade-off already made in `onPasswordReset` below.
       */
      try {
        await mailer.send({ to: user.email, ...mail });
      } catch (error) {
        logger.error(
          { err: error, userId: user.id },
          'Account created but the verification email could not be sent',
        );
      }
    },
  },

  socialProviders: googleProvider,

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // sliding window, refreshed at most daily
    /**
     * Sensitive operations require a session established recently. Without
     * this, a session stolen months ago could be used to change the password
     * and take the account permanently.
     */
    freshAge: 60 * 15,
    /**
     * Without this, `auth.api.getSession()` hits the database on every
     * single authenticated request — every screen of this app makes one.
     * With it, a signed cookie carries the session+user payload and is
     * trusted until it expires, so a normal request does no session lookup
     * at all.
     *
     * The cost is real and deliberately bounded: a session revoked from
     * another device (users.service.ts's "sign out other devices") keeps
     * working from the cache for up to `maxAge` seconds afterward, because
     * the cache has no way to hear about the revocation early. 60s was
     * chosen over the library's 300s default because this is a financial
     * app where that feature exists specifically to cut off a compromised
     * device — five minutes of extra reach is not an acceptable trade for
     * saved database round-trips.
     */
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },

  account: {
    accountLinking: {
      // A user who signed up with a password and later uses Google with the
      // same address gets one account, not two. Restricted to Google because
      // it verifies email ownership — blind linking is an account-takeover
      // path, since an unverified provider could assert any address.
      enabled: true,
      trustedProviders: ['google'],
    },
  },

  user: {
    deleteUser: {
      // Users can delete their own account (a store requirement, and the right
      // default for personal data). Sessions and OAuth links cascade.
      enabled: true,
      afterDelete: async (user) => {
        await recordAuthEvent('ACCOUNT_DELETED', { userId: user.id });
      },
    },
  },

  advanced: {
    /**
     * How the caller's IP is resolved for rate limiting.
     *
     * Without this Better Auth cannot identify a client and falls back to ONE
     * shared bucket per path — meaning every user on the planet shares a single
     * sign-in budget. That is worse than no limit in one direction (a handful
     * of failed logins locks out everyone) and useless in the other (an
     * attacker's attempts are indistinguishable from legitimate traffic).
     *
     * `x-forwarded-for` is correct here because Render terminates TLS upstream
     * and Express is configured with `trust proxy 1`. The header is only
     * trustworthy because a known proxy sets it — reading it from a directly
     * exposed server would let a client name its own IP and evade the limit
     * entirely.
     */
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
    },

    /**
     * Session cookies are Secure + HttpOnly + SameSite=Lax in production, so
     * they are never sent over plain HTTP and are unreadable from JavaScript.
     * Disabled locally only because development runs over http://localhost.
     */
    useSecureCookies: env.isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
    },
  },

  /**
   * Surfaces the real cause of a failed request.
   *
   * Better Auth's handler bypasses Express's error middleware entirely (it
   * owns /api/auth via `toNodeHandler`, not `next()`), so without this the
   * only trace of a failure is pino-http's generic "failed with status code
   * 500" — the actual driver/database error is thrown and swallowed inside
   * Better Auth before it ever reaches our logger. That is what made the Neon
   * cold-start 500 on sign-in impossible to diagnose from the logs alone.
   *
   * Expected client errors (wrong password, unverified email, rate limited)
   * are not logged at error level — they are normal traffic, not incidents.
   * Setting `onAPIError.onError` replaces Better Auth's own default error
   * logging rather than adding to it, so this reimplements the one part of
   * that default worth keeping: flagging INTERNAL_SERVER_ERROR loudly.
   */
  onAPIError: {
    onError: (error) => {
      if (isAPIError(error) && error.status !== 'INTERNAL_SERVER_ERROR') return;
      logger.error({ err: error }, 'Better Auth request failed');
    },
  },

  /**
   * Brute-force protection (CLAUDE.md §32).
   *
   * Database-backed so counters survive a restart and are shared across
   * instances — in-memory storage resets on every deploy and multiplies the
   * effective limit by the instance count.
   */
  rateLimit: {
    enabled: true,
    storage: 'database',
    modelName: 'rateLimit',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 300, max: 8 },
      '/sign-up/email': { window: 3600, max: 10 },
      // Both spellings: this version exposes /request-password-reset, with
      // /forget-password kept as a legacy alias. Limiting only one would leave
      // the other open as a free email-sending relay.
      '/request-password-reset': { window: 3600, max: 5 },
      '/forget-password': { window: 3600, max: 5 },
      '/reset-password': { window: 3600, max: 5 },
      '/send-verification-email': { window: 3600, max: 5 },
    },
  },

  plugins: [
    /**
     * Rejects passwords found in known breach corpora. This is the single
     * highest-value password control available: credential stuffing with
     * previously-breached passwords is how most real account takeovers happen,
     * and complexity rules do not stop it.
     *
     * The check is k-anonymous — only the first 5 characters of the SHA-1 hash
     * are sent, so neither the password nor its full hash ever leaves this
     * server.
     */
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        'This password has appeared in a known data breach. Please choose a different one.',
    }),

    /** Deep-link OAuth redirect handling and SecureStore session transport. */
    expo(),
  ],

  /**
   * Origins allowed to complete an auth flow. The mobile scheme must be listed
   * or the Google redirect back into the app is rejected.
   */
  trustedOrigins: [`${env.MOBILE_APP_SCHEME}://`, ...env.corsOrigins],

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordAuthEvent('ACCOUNT_CREATED', { userId: user.id });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await recordAuthEvent('SESSION_CREATED', {
            userId: session.userId,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
          });
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = Auth['$Infer']['Session'];
