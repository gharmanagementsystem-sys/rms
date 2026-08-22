import { prisma } from '../db/client';
import { logger } from '../services/logger';

/**
 * Security audit trail for authentication events (CLAUDE.md §56).
 *
 * Records only financially or security-meaningful actions — not every UI event.
 * Contains no personal data by design: see the AuthAuditLog model comment.
 */

export const AUTH_AUDIT_EVENTS = [
  'ACCOUNT_CREATED',
  'SESSION_CREATED',
  'PASSWORD_CHANGED',
  'ACCOUNT_DELETED',
] as const;

export type AuthAuditEvent = (typeof AUTH_AUDIT_EVENTS)[number];

export interface AuthAuditContext {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Writes an audit record.
 *
 * Failures are logged but never propagated: an audit write must not be able to
 * fail a sign-in. The trade-off is deliberate and is why the error is logged at
 * `error` level — a silently missing trail is a problem worth alerting on.
 */
export async function recordAuthEvent(
  event: AuthAuditEvent,
  context: AuthAuditContext = {},
): Promise<void> {
  try {
    await prisma.authAuditLog.create({
      data: {
        event,
        userId: context.userId ?? null,
        ipAddress: context.ipAddress ?? null,
        // Bounded: a hostile client can send a very long User-Agent.
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, event }, 'Failed to write auth audit record');
  }
}
