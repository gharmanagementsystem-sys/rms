import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from '@rms/shared';
import type { Property } from '../../../generated/prisma/client';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { cursorArgs, toPage } from '../../lib/pagination';
import { recordAudit } from '../../services/audit-log';

/**
 * Property business rules and authorization (CLAUDE.md §31).
 *
 * Every function here takes the caller's user id as its first argument and
 * scopes the query by it. Ownership is checked in this layer — never only in a
 * route guard and never in the UI.
 *
 * No repository layer: these are single-table queries that Prisma already
 * expresses declaratively, and wrapping them would add indirection without
 * removing duplication (§6 "where justified", §69).
 */

export interface ActorContext {
  userId: string;
  requestId?: string | undefined;
}

/**
 * Loads a property the caller owns.
 *
 * A property owned by someone else reports NOT_FOUND rather than FORBIDDEN.
 * Returning 403 would confirm that the id exists, letting an attacker enumerate
 * other people's property ids. FORBIDDEN is reserved for resources the caller
 * demonstrably has a relationship with.
 */
export async function requireOwnedProperty(userId: string, propertyId: string): Promise<Property> {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerUserId: userId },
  });

  if (!property) {
    throw new AppError('UNAUTHORIZED_PROPERTY_ACCESS', 404, 'This property was not found.');
  }
  return property;
}

export async function createProperty(
  actor: ActorContext,
  input: CreatePropertyInput,
): Promise<Property> {
  return prisma.$transaction(async (tx) => {
    const property = await tx.property.create({
      data: {
        ownerUserId: actor.userId,
        name: input.name,
        province: input.province ?? null,
        district: input.district ?? null,
        municipality: input.municipality ?? null,
        ward: input.ward ?? null,
        addressLine: input.addressLine ?? null,
        landmark: input.landmark ?? null,
      },
    });

    await recordAudit(tx, {
      action: 'PROPERTY_CREATED',
      entityType: 'PROPERTY',
      entityId: property.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: { name: property.name },
    });

    return property;
  });
}

export async function listProperties(userId: string, query: ListPropertiesQuery) {
  const rows = await prisma.property.findMany({
    where: {
      ownerUserId: userId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { id: 'desc' },
    ...cursorArgs(query.limit, query.cursor),
  });

  return toPage(rows, query.limit);
}

export async function getProperty(userId: string, propertyId: string): Promise<Property> {
  return requireOwnedProperty(userId, propertyId);
}

export async function updateProperty(
  actor: ActorContext,
  propertyId: string,
  input: UpdatePropertyInput,
): Promise<Property> {
  const existing = await requireOwnedProperty(actor.userId, propertyId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.property.update({
      where: { id: existing.id },
      data: input,
    });

    await recordAudit(tx, {
      action: 'PROPERTY_UPDATED',
      entityType: 'PROPERTY',
      entityId: updated.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      // Only the changed fields, so the trail stays readable (§56).
      before: Object.fromEntries(
        Object.keys(input).map((key) => [key, existing[key as keyof Property] ?? null]),
      ),
      after: input,
    });

    return updated;
  });
}

/**
 * Archives a property.
 *
 * Never a hard delete: a property carries rental and payment history, and
 * destroying it would destroy the answer to "how much did this tenant pay me
 * last year?" (§34, §57).
 *
 * Refuses while any rental on any of its units is still active — ending those
 * tenancies is a decision the owner must make explicitly, not a side effect.
 */
export async function archiveProperty(actor: ActorContext, propertyId: string): Promise<Property> {
  const existing = await requireOwnedProperty(actor.userId, propertyId);

  if (existing.archivedAt) {
    return existing;
  }

  const activeRentals = await prisma.rental.count({
    where: { status: 'ACTIVE', unit: { propertyId: existing.id } },
  });

  if (activeRentals > 0) {
    throw new AppError(
      'PROPERTY_HAS_ACTIVE_RENTALS',
      409,
      `This property still has ${activeRentals} active rental${activeRentals === 1 ? '' : 's'}. End them before archiving it.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const archived = await tx.property.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    });

    await recordAudit(tx, {
      action: 'PROPERTY_ARCHIVED',
      entityType: 'PROPERTY',
      entityId: archived.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: { archivedAt: archived.archivedAt?.toISOString() ?? null },
    });

    return archived;
  });
}
