import type {
  CreateUnitInput,
  ListUnitsQuery,
  UnitOccupancyState,
  UpdateUnitInput,
} from '@rms/shared';
import type { Unit } from '../../../generated/prisma/client';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { cursorArgs, toPage } from '../../lib/pagination';
import { recordAudit } from '../../services/audit-log';
import { requireOwnedProperty, type ActorContext } from '../properties/properties.service';

/**
 * Unit business rules (CLAUDE.md §10, §22).
 *
 * Occupancy is DERIVED, never stored. A unit is occupied precisely when an
 * active rental references it, which the database guarantees is at most one
 * (partial unique index `rentals_one_active_per_unit`). That is why the two can
 * never contradict each other.
 */

export type UnitWithOccupancy = Unit & { occupancy: UnitOccupancyState };

/** Rows carry the active-rental count from a single aggregate query. */
type UnitRow = Unit & { _count: { rentals: number } };

function withOccupancy(row: UnitRow): UnitWithOccupancy {
  const { _count, ...unit } = row;
  return {
    ...unit,
    occupancy: _count.rentals > 0 ? 'OCCUPIED' : unit.availability,
  };
}

/** Counts only ACTIVE rentals — the definition of occupied. */
const ACTIVE_RENTAL_COUNT = {
  _count: { select: { rentals: { where: { status: 'ACTIVE' as const } } } },
};

/**
 * Loads a unit within a property the caller owns.
 *
 * Ownership is established through the parent property, so a unit id belonging
 * to someone else's property is simply not found.
 */
export async function requireOwnedUnit(
  userId: string,
  propertyId: string,
  unitId: string,
): Promise<UnitWithOccupancy> {
  await requireOwnedProperty(userId, propertyId);

  const row = await prisma.unit.findFirst({
    where: { id: unitId, propertyId },
    include: ACTIVE_RENTAL_COUNT,
  });

  if (!row) {
    throw new AppError('UNAUTHORIZED_PROPERTY_ACCESS', 404, 'This unit was not found.');
  }
  return withOccupancy(row);
}

/**
 * Loads a unit by id alone, verifying it belongs to a property the caller
 * owns.
 *
 * For callers that only have a unit id and not its parent property id — a
 * rental is created from `unitId` alone (§11), so ownership is confirmed by
 * joining through the unit's own `property` relation instead of requiring
 * the caller to already know which property it belongs to.
 */
export async function requireOwnedUnitById(userId: string, unitId: string): Promise<Unit> {
  const unit = await prisma.unit.findFirst({
    where: { id: unitId, property: { ownerUserId: userId } },
  });

  if (!unit) {
    throw new AppError('UNAUTHORIZED_PROPERTY_ACCESS', 404, 'This unit was not found.');
  }
  return unit;
}

export async function createUnit(
  actor: ActorContext,
  propertyId: string,
  input: CreateUnitInput,
): Promise<UnitWithOccupancy> {
  const property = await requireOwnedProperty(actor.userId, propertyId);

  if (property.archivedAt) {
    throw new AppError(
      'CONFLICT',
      409,
      'This property is archived. Restore it before adding units.',
    );
  }

  // A client-supplied parent id is a request, not a permission (§30): confirm
  // it lives in the same property before trusting it.
  if (input.parentUnitId) {
    const parent = await prisma.unit.findFirst({
      where: { id: input.parentUnitId, propertyId },
    });
    if (!parent) {
      throw new AppError(
        'VALIDATION_ERROR',
        422,
        'The chosen parent unit is not in this property.',
        {
          details: [{ field: 'body.parentUnitId', message: 'Not a unit of this property' }],
        },
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.unit.create({
      data: {
        propertyId,
        label: input.label,
        type: input.type,
        floor: input.floor ?? null,
        parentUnitId: input.parentUnitId ?? null,
      },
    });

    await recordAudit(tx, {
      action: 'UNIT_CREATED',
      entityType: 'UNIT',
      entityId: created.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: { label: created.label, type: created.type, propertyId },
    });

    return { ...created, occupancy: created.availability satisfies UnitOccupancyState };
  });
}

export async function listUnits(userId: string, propertyId: string, query: ListUnitsQuery) {
  await requireOwnedProperty(userId, propertyId);

  const rows = await prisma.unit.findMany({
    where: {
      propertyId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.availability ? { availability: query.availability } : {}),
      // Occupancy is a property of the rentals, so it is filtered there rather
      // than against a stored column.
      ...(query.occupied === undefined
        ? {}
        : query.occupied
          ? { rentals: { some: { status: 'ACTIVE' } } }
          : { rentals: { none: { status: 'ACTIVE' } } }),
    },
    include: ACTIVE_RENTAL_COUNT,
    orderBy: { id: 'desc' },
    ...cursorArgs(query.limit, query.cursor),
  });

  const page = toPage(rows, query.limit);
  return { items: page.items.map(withOccupancy), meta: page.meta };
}

export async function updateUnit(
  actor: ActorContext,
  propertyId: string,
  unitId: string,
  input: UpdateUnitInput,
): Promise<UnitWithOccupancy> {
  const existing = await requireOwnedUnit(actor.userId, propertyId, unitId);

  /**
   * An occupied unit cannot be marked MAINTENANCE or UNAVAILABLE. Those states
   * assert "nobody is living here", which would contradict an active tenancy
   * and make the derived occupancy misleading (§22).
   */
  if (
    input.availability &&
    input.availability !== 'AVAILABLE' &&
    existing.occupancy === 'OCCUPIED'
  ) {
    throw new AppError(
      'UNIT_HAS_ACTIVE_RENTAL',
      409,
      'This unit has a tenant. End the rental before changing its availability.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.unit.update({
      where: { id: existing.id },
      data: input,
      include: ACTIVE_RENTAL_COUNT,
    });

    await recordAudit(tx, {
      action: 'UNIT_UPDATED',
      entityType: 'UNIT',
      entityId: updated.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      before: Object.fromEntries(
        Object.keys(input).map((key) => [key, existing[key as keyof Unit] ?? null]),
      ),
      after: input,
    });

    return withOccupancy(updated);
  });
}

/** Archives a unit. Refuses while a tenant is in place (§57). */
export async function archiveUnit(
  actor: ActorContext,
  propertyId: string,
  unitId: string,
): Promise<UnitWithOccupancy> {
  const existing = await requireOwnedUnit(actor.userId, propertyId, unitId);

  if (existing.archivedAt) {
    return existing;
  }

  if (existing.occupancy === 'OCCUPIED') {
    throw new AppError(
      'UNIT_HAS_ACTIVE_RENTAL',
      409,
      'This unit has a tenant. End the rental before archiving it.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const archived = await tx.unit.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
      include: ACTIVE_RENTAL_COUNT,
    });

    await recordAudit(tx, {
      action: 'UNIT_ARCHIVED',
      entityType: 'UNIT',
      entityId: archived.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: { archivedAt: archived.archivedAt?.toISOString() ?? null },
    });

    return withOccupancy(archived);
  });
}
