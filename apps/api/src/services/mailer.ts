import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Outbound email.
 *
 * Deliberately a thin interface over SMTP rather than a vendor SDK, so the
 * provider is a configuration choice rather than a code change.
 *
 * Security note: message bodies carry single-use verification and password
 * reset links, which are bearer credentials. They are never written to the log
 * in production — see `DevLogMailer` below.
 */

export interface OutboundMail {
  to: string;
  subject: string;
  /** Plain-text alternative. Always required — never send HTML only. */
  text: string;
  /** Optional HTML part. Clients that prefer text still get a full message. */
  html?: string | undefined;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}

/**
 * Real transport. Used whenever SMTP is configured, and mandatory in
 * production (enforced in config/env.ts).
 */
class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
    secure: boolean;
  }) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
    });
  }

  async send(mail: OutboundMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    });
    // Recipient and subject only. The body holds a live credential.
    logger.info({ to: mail.to, subject: mail.subject, via: 'smtp' }, 'Email sent');
  }
}

/**
 * Resend, over its REST API.
 *
 * The API rather than Resend's SMTP endpoint for two practical reasons: it
 * returns a message id that can be matched against Resend's dashboard when a
 * user says "I never got the email", and it returns a readable JSON error for
 * the failures that actually happen in practice — an unverified sending domain,
 * or the free tier's restriction to the account owner's own address. Over SMTP
 * both of those surface as an opaque failure.
 *
 * Uses global fetch rather than the Resend SDK: the request is one POST, and a
 * dependency for that would not earn its place (§69).
 */
/** Second attempt gets a shorter budget — a genuine outage should not double
 *  the worst-case wait, only a brief blip needs the extra try. */
const RESEND_TIMEOUT_MS = 15_000;
const RESEND_RETRY_TIMEOUT_MS = 8_000;
const RESEND_RETRY_DELAY_MS = 400;

class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(mail: OutboundMail): Promise<void> {
    let lastError: unknown;

    // One retry, and only because a verification/reset email failing here is
    // no longer allowed to fail the whole request that triggered it (see the
    // callers in auth/better-auth.ts) — so it is worth a brief second attempt
    // at a transient network blip before giving up and logging it (§37).
    for (const timeoutMs of [RESEND_TIMEOUT_MS, RESEND_RETRY_TIMEOUT_MS]) {
      if (lastError !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, RESEND_RETRY_DELAY_MS));
      }

      try {
        await this.attemptSend(mail, timeoutMs);
        return;
      } catch (error) {
        lastError = error;
        // A 4xx means Resend understood the request and rejected it — a bad
        // recipient, an unverified sender domain. Retrying sends the exact
        // same request and will fail the exact same way, so only a network
        // failure or a 5xx (both plausibly transient) get the second try.
        if (error instanceof ResendRejection && !error.isRetryable) throw error;
      }
    }

    throw lastError;
  }

  private async attemptSend(mail: OutboundMail, timeoutMs: number): Promise<void> {
    let response: Response;

    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          ...(mail.html ? { html: mail.html } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new Error('Could not reach Resend', { cause });
    }

    if (!response.ok) {
      // The body explains the real reason; it contains no secret. The API key
      // is never included, and `mail.text` (which holds the live link) is not
      // echoed back by Resend.
      const detail = await response.text().catch(() => '');
      throw new ResendRejection(response.status, detail.slice(0, 300));
    }

    const result = (await response.json().catch(() => ({}))) as { id?: string };

    logger.info(
      { to: mail.to, subject: mail.subject, via: 'resend', messageId: result.id ?? null },
      'Email sent',
    );
  }
}

/** A rejection Resend actually responded with, as opposed to a network
 *  failure — carries the status so the caller can tell a transient 5xx from
 *  a rejection retrying cannot fix. */
class ResendRejection extends Error {
  readonly isRetryable: boolean;

  constructor(status: number, detail: string) {
    super(`Resend rejected the message (${status}): ${detail}`);
    this.name = 'ResendRejection';
    this.isRetryable = status >= 500;
  }
}

/**
 * Development fallback when SMTP is unconfigured.
 *
 * Writes the message to the log so the verification link is reachable without
 * a mail provider. This transport refuses to be constructed in production —
 * silently logging credentials on a live server would be far worse than
 * failing to boot.
 */
class DevLogMailer implements Mailer {
  constructor() {
    if (env.isProduction) {
      throw new Error('DevLogMailer must never be used in production');
    }
  }

  async send(mail: OutboundMail): Promise<void> {
    logger.warn(
      { to: mail.to, subject: mail.subject, body: mail.text },
      'SMTP is not configured — email written to the log instead of being sent',
    );
  }
}

/** Test transport. Captures messages so assertions can inspect them. */
export class MemoryMailer implements Mailer {
  readonly sent: OutboundMail[] = [];

  async send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
  }
}

function createMailer(): Mailer {
  /**
   * The chosen transport is logged at startup, not just when it is missing.
   *
   * This exists because of a real incident: a `tsx watch` server kept running
   * while RESEND_API_KEY was added to .env. dotenv reads the file once at boot
   * and watch mode only reloads *source*, so the live process silently kept
   * using DevLogMailer and wrote every verification email to its own terminal.
   * Sign-up returned 200, nothing errored, and no email arrived — with no way
   * to tell from the outside which transport was actually in use.
   *
   * One line at boot makes that state visible immediately.
   */
  // Resend first: it gives a message id and a readable error, so it is the
  // better default whenever both are configured.
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    if (!env.isTest) {
      logger.info({ transport: 'resend', from: env.EMAIL_FROM }, 'Mail transport ready');
    }
    return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }

  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM) {
    if (!env.isTest) {
      logger.info(
        { transport: 'smtp', host: env.SMTP_HOST, from: env.SMTP_FROM },
        'Mail transport ready',
      );
    }
    return new SmtpMailer({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
      secure: env.SMTP_SECURE,
    });
  }

  if (!env.isTest) {
    logger.warn(
      'No mail transport configured (set RESEND_API_KEY + EMAIL_FROM, or SMTP_*). Verification and password-reset emails will be written to the log.',
    );
  }
  return new DevLogMailer();
}

export const mailer: Mailer = createMailer();
