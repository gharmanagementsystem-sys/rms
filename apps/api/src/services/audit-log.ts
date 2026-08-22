import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../db/client';
import { logger } from './logger';

/**
 * Audit trail for financially meaningful domain actions (CLAUDE.md §56).
 *
 * Deliberately NOT a generic change-data-capture layer: only actions a user
 * could later dispute are recorded — money, tenancy lifecycle, and destructive
 * operations. Capturing every UI event would bury the entries that matter.
 */

export const AUDIT_ACTIONS = [
  'PROPERTY_CREATED',
  'PROPERTY_UPDATED',
  'PROPERTY_ARCHIVED',
  'UNIT_CREATED',
  'UNIT_UPDATED',
  'UNIT_ARCHIVED',
  'RENTAL_CREATED',
  'RENTAL_UPDATED',
  'RENTAL_ACTIVATED',
  'RENTAL_ENDED',
  'RENTAL_CANCELLED',
  'RENTAL_DELETED',
  'RENTAL_CHARGES_REPLACED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  entityType: 'PROPERTY' | 'UNIT' | 'RENTAL';
  entityId: string;
  actorUserId: string;
  requestId?: string | undefined;
  /** Only the fields that changed — not the whole row. */
  before?: Prisma.InputJsonValue | undefined;
  after?: Prisma.InputJsonValue | undefined;
}

/**
 * Writes an audit record.
 *
 * Accepts a transaction client so the audit entry commits atomically with the
 * change it describes. An audit trail that can disagree with the data is worse
 * than none, because it invites false confidence.
 */
export async function recordAudit(
  client: Prisma.TransactionClient | typeof prisma,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorUserId: entry.actorUserId,
      requestId: entry.requestId ?? null,
      ...(entry.before === undefined ? {} : { before: entry.before }),
      ...(entry.after === undefined ? {} : { after: entry.after }),
    },
  });
}

/**
 * Fire-and-forget variant for actions outside a transaction.
 *
 * Failures are logged rather than propagated so an audit write cannot fail the
 * user's operation — but at `error` level, because a silently missing trail is
 * worth alerting on.
 */
export async function recordAuditSafely(entry: AuditEntry): Promise<void> {
  try {
    await recordAudit(prisma, entry);
  } catch (error) {
    logger.error({ err: error, action: entry.action }, 'Failed to write audit record');
  }
}
