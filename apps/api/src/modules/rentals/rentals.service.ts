import type {
  ChargeInput,
  CreateRentalInput,
  EndRentalInput,
  ListRentalsQuery,
  UpdateRentalInput,
} from '@rms/shared';
import { periodDaysFor } from '@rms/shared';
import type { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { compareDates, fromDbDate, toDbDate } from '../../lib/business-date';
import { cursorArgs, toPage } from '../../lib/pagination';
import { optionalNumberToPaisa } from '../../lib/serialize';
import { recordAudit } from '../../services/audit-log';
import type { ActorContext } from '../properties/properties.service';
import { requireOwnedUnitById } from '../units/units.service';

/**
 * Rental business rules and authorization (CLAUDE.md §11, §21, §31).
 *
 * Nothing here trusts the client with identity or money: the caller's user id
 * comes from the session, `periodDays` comes from the frequency, and `status`
 * only ever moves through the transitions below (§30, §54).
 */

const RENTAL_INCLUDE = {
  charges: { where: { isActive: true }, orderBy: { chargeType: 'asc' } },
  unit: { select: { id: true, label: true, type: true, propertyId: true } },
} as const satisfies Prisma.RentalInclude;

export type RentalWithRelations = Prisma.RentalGetPayload<{ include: typeof RENTAL_INCLUDE }>;

/** Which party the caller is. Both may read; only the manager may change things. */
export type RentalRole = 'OWNER' | 'RENTER';

export interface RentalAccess {
  rental: RentalWithRelations;
  role: RentalRole;
  /**
   * The party responsible for the agreement's terms.
   *
   * For an owner-recorded rental that is the owner. For a renter-recorded one
   * there is no owner in the system, so the renter manages their own record
   * (§58 — the system must work when only one side uses the app).
   */
  canManage: boolean;
}

/**
 * Loads a rental the caller is a party to.
 *
 * A rental the caller has no edge to reports NOT_FOUND rather than FORBIDDEN,
 * so ids cannot be probed for existence.
 */
export async function requireRentalAccess(userId: string, rentalId: string): Promise<RentalAccess> {
  const rental = await prisma.rental.findFirst({
    where: {
      id: rentalId,
      OR: [{ ownerUserId: userId }, { renterUserId: userId }],
    },
    include: RENTAL_INCLUDE,
  });

  if (!rental) {
    throw new AppError('UNAUTHORIZED_RENTAL_ACCESS', 404, 'This rental was not found.');
  }

  const role: RentalRole = rental.ownerUserId === userId ? 'OWNER' : 'RENTER';
  const managerId = rental.ownerUserId ?? rental.renterUserId;

  return { rental, role, canManage: managerId === userId };
}

function assertManageable(access: RentalAccess): void {
  if (!access.canManage) {
    throw new AppError(
      'UNAUTHORIZED_RENTAL_ACCESS',
      403,
      'Only the landlord can change the terms of this rental.',
    );
  }
}

function assertEditableStatus(access: RentalAccess): void {
  if (access.rental.status === 'ENDED') {
    throw new AppError(
      'RENTAL_ALREADY_ENDED',
      409,
      'This rental has ended. Its records are kept as history and cannot be changed.',
    );
  }
  if (access.rental.status === 'CANCELLED') {
    throw new AppError('RENTAL_NOT_EDITABLE', 409, 'This rental was cancelled.');
  }
}

function chargeCreateData(charges: ChargeInput[]): Prisma.RentalChargeCreateManyRentalInput[] {
  return charges.map((charge) => ({
    chargeType: charge.chargeType,
    label: charge.label ?? null,
    pricingModel: charge.pricingModel,
    amountPaisa: optionalNumberToPaisa(charge.amountPaisa),
    ratePaisaPerUnit: optionalNumberToPaisa(charge.ratePaisaPerUnit),
    // Absent policy means PRORATE for a fixed charge; a metered charge never
    // has one, because a meter already measures actual usage.
    prorationPolicy: charge.pricingModel === 'FIXED' ? (charge.prorationPolicy ?? 'PRORATE') : null,
  }));
}

export async function createRental(
  actor: ActorContext,
  input: CreateRentalInput,
): Promise<RentalWithRelations> {
  // The caller's own id is assigned to the side they declared. A client can
  // never name another user as owner or renter.
  const ownerUserId = input.side === 'OWNER' ? actor.userId : null;
  const renterUserId = input.side === 'RENTER' ? actor.userId : null;

  if (input.unitId) {
    const unit = await requireOwnedUnitById(actor.userId, input.unitId);
    if (unit.archivedAt) {
      throw new AppError('UNIT_NOT_RENTABLE', 409, 'This unit is archived.');
    }
  }

  const periodDays = periodDaysFor(input.frequency);
  // Pay in arrears by default — rent due on the period's last day, which is
  // how rent is actually paid in Nepal, not on day one (§54: the server owns
  // this default, not the client, so every caller gets it right for free).
  // An explicit `dueOffsetDays` (including 0, pay in advance) always wins.
  const dueOffsetDays = input.dueOffsetDays ?? periodDays - 1;

  return prisma.$transaction(async (tx) => {
    const rental = await tx.rental.create({
      data: {
        createdByUserId: actor.userId,
        ownerUserId,
        renterUserId,
        unitId: input.unitId ?? null,
        placeLabel: input.placeLabel ?? null,
        placeAddress: input.placeAddress ?? null,
        counterpartyName: input.counterpartyName ?? null,
        counterpartyPhone: input.counterpartyPhone ?? null,
        frequency: input.frequency,
        // Server-set, snapshotted so a future change to the product-wide
        // constant cannot alter an existing agreement (§3.3).
        periodDays,
        startDate: toDbDate(input.startDate),
        dueOffsetDays,
        overdueAfterDays: input.overdueAfterDays,
        midPeriodEndPolicy: input.midPeriodEndPolicy,
        securityDepositPaisa: optionalNumberToPaisa(input.securityDepositPaisa),
        notes: input.notes ?? null,
        // Always DRAFT. Activation is a separate, explicit step so the
        // occupancy check happens at a well-defined moment (§11).
        status: 'DRAFT',
        charges: { createMany: { data: chargeCreateData(input.charges) } },
      },
      include: RENTAL_INCLUDE,
    });

    await recordAudit(tx, {
      action: 'RENTAL_CREATED',
      entityType: 'RENTAL',
      entityId: rental.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: {
        side: input.side,
        frequency: rental.frequency,
        periodDays: rental.periodDays,
        startDate: input.startDate,
      },
    });

    return rental;
  });
}

/**
 * Moves a rental from DRAFT to ACTIVE.
 *
 * The database also enforces one active rental per unit, so a concurrent
 * double-activation fails there even if two requests pass this check at the
 * same moment. The check exists to produce a good error message, not to be the
 * guarantee.
 */
export async function activateRental(
  actor: ActorContext,
  rentalId: string,
): Promise<RentalWithRelations> {
  const access = await requireRentalAccess(actor.userId, rentalId);
  assertManageable(access);

  if (access.rental.status === 'ACTIVE') {
    throw new AppError('RENTAL_ALREADY_ACTIVE', 409, 'This rental is already active.');
  }
  assertEditableStatus(access);

  if (access.rental.unitId) {
    const occupied = await prisma.rental.findFirst({
      where: { unitId: access.rental.unitId, status: 'ACTIVE' },
    });
    if (occupied) {
      throw new AppError(
        'UNIT_ALREADY_OCCUPIED',
        409,
        'This unit already has an active rental. End it before starting a new one.',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const rental = await tx.rental.update({
      where: { id: access.rental.id },
      data: { status: 'ACTIVE' },
      include: RENTAL_INCLUDE,
    });

    await recordAudit(tx, {
      action: 'RENTAL_ACTIVATED',
      entityType: 'RENTAL',
      entityId: rental.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      before: { status: 'DRAFT' },
      after: { status: 'ACTIVE' },
    });

    return rental;
  });
}

/**
 * Ends a rental (§21, §34).
 *
 * The record is never destroyed: history stays available, future period
 * generation simply stops, and the unit's derived occupancy returns to its
 * stored availability with no second field to keep in step (§22).
 */
export async function endRental(
  actor: ActorContext,
  rentalId: string,
  input: EndRentalInput,
): Promise<RentalWithRelations> {
  const access = await requireRentalAccess(actor.userId, rentalId);
  assertManageable(access);

  if (access.rental.status !== 'ACTIVE') {
    throw new AppError(
      access.rental.status === 'ENDED' ? 'RENTAL_ALREADY_ENDED' : 'RENTAL_NOT_ACTIVE',
      409,
      'Only an active rental can be ended.',
    );
  }

  const startDate = fromDbDate(access.rental.startDate);
  if (compareDates(input.endDate, startDate) < 0) {
    throw new AppError('VALIDATION_ERROR', 422, 'A rental cannot end before it started.', {
      details: [{ field: 'body.endDate', message: `Must be on or after ${startDate}` }],
    });
  }

  return prisma.$transaction(async (tx) => {
    const rental = await tx.rental.update({
      where: { id: access.rental.id },
      data: {
        status: 'ENDED',
        endDate: toDbDate(input.endDate),
        endedAt: new Date(),
        endedByUserId: actor.userId,
        endedReason: input.reason ?? null,
        // The final period's treatment is recorded on the rental so the
        // accounting engine can reproduce the decision later.
        ...(input.midPeriodEndPolicy ? { midPeriodEndPolicy: input.midPeriodEndPolicy } : {}),
      },
      include: RENTAL_INCLUDE,
    });

    await recordAudit(tx, {
      action: 'RENTAL_ENDED',
      entityType: 'RENTAL',
      entityId: rental.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      before: { status: 'ACTIVE' },
      after: {
        status: 'ENDED',
        endDate: input.endDate,
        midPeriodEndPolicy: rental.midPeriodEndPolicy,
      },
    });

    return rental;
  });
}

/**
 * Deletes a rental outright — the one case where that is safe (§21, §34).
 *
 * Restricted to DRAFT: a draft has never been activated, so no periods,
 * charges snapshots, or payments have ever been generated against it — there
 * is no accounting history to protect. An ACTIVE or ENDED rental has exactly
 * that history and must never be hard-deleted; `endRental` is the only
 * lifecycle exit for those, by design. This is enforced here in the service,
 * not by a database constraint: every FK from periods and payments down to
 * `rentals` cascades on delete, so the database would happily annihilate a
 * live rental's history if this check were ever skipped.
 */
export async function deleteRental(actor: ActorContext, rentalId: string): Promise<void> {
  const access = await requireRentalAccess(actor.userId, rentalId);
  assertManageable(access);

  if (access.rental.status !== 'DRAFT') {
    throw new AppError(
      'RENTAL_NOT_DRAFT',
      409,
      'Only a rental that has not been started can be deleted. End it instead.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      action: 'RENTAL_DELETED',
      entityType: 'RENTAL',
      entityId: access.rental.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      before: {
        status: access.rental.status,
        frequency: access.rental.frequency,
        startDate: fromDbDate(access.rental.startDate),
      },
    });

    // Cascades to this rental's charges — nothing else exists yet for a draft.
    await tx.rental.delete({ where: { id: access.rental.id } });
  });
}

export async function updateRental(
  actor: ActorContext,
  rentalId: string,
  input: UpdateRentalInput,
): Promise<RentalWithRelations> {
  const access = await requireRentalAccess(actor.userId, rentalId);
  assertManageable(access);
  assertEditableStatus(access);

  if (input.dueOffsetDays !== undefined && input.dueOffsetDays >= access.rental.periodDays) {
    throw new AppError('VALIDATION_ERROR', 422, 'Rent must fall due within the period.', {
      details: [
        {
          field: 'body.dueOffsetDays',
          message: `Must be less than ${access.rental.periodDays}`,
        },
      ],
    });
  }

  return prisma.$transaction(async (tx) => {
    const rental = await tx.rental.update({
      where: { id: access.rental.id },
      data: {
        ...input,
        securityDepositPaisa: optionalNumberToPaisa(input.securityDepositPaisa),
      },
      include: RENTAL_INCLUDE,
    });

    await recordAudit(tx, {
      action: 'RENTAL_UPDATED',
      entityType: 'RENTAL',
      entityId: rental.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: { ...input },
    });

    return rental;
  });
}

/**
 * Replaces the whole charge set.
 *
 * Whole-set replacement rather than per-charge edits, because "exactly one rent
 * charge" cannot be enforced atomically across a sequence of partial updates.
 *
 * Safe for history: past periods keep their own snapshot of the values that
 * applied at the time, so changing configuration never rewrites the past
 * (§3.3, §14).
 */
export async function replaceCharges(
  actor: ActorContext,
  rentalId: string,
  charges: ChargeInput[],
): Promise<RentalWithRelations> {
  const access = await requireRentalAccess(actor.userId, rentalId);
  assertManageable(access);
  assertEditableStatus(access);

  return prisma.$transaction(async (tx) => {
    await tx.rentalCharge.deleteMany({ where: { rentalId: access.rental.id } });
    await tx.rentalCharge.createMany({
      data: chargeCreateData(charges).map((charge) => ({ ...charge, rentalId: access.rental.id })),
    });

    const rental = await tx.rental.findUniqueOrThrow({
      where: { id: access.rental.id },
      include: RENTAL_INCLUDE,
    });

    await recordAudit(tx, {
      action: 'RENTAL_CHARGES_REPLACED',
      entityType: 'RENTAL',
      entityId: rental.id,
      actorUserId: actor.userId,
      requestId: actor.requestId,
      before: {
        charges: access.rental.charges.map((charge) => ({
          chargeType: charge.chargeType,
          label: charge.label,
          amountPaisa: charge.amountPaisa === null ? null : Number(charge.amountPaisa),
          ratePaisaPerUnit:
            charge.ratePaisaPerUnit === null ? null : Number(charge.ratePaisaPerUnit),
        })),
      },
      after: { charges: charges as unknown as Prisma.InputJsonValue },
    });

    return rental;
  });
}

export async function listRentals(userId: string, query: ListRentalsQuery) {
  const partyFilter: Prisma.RentalWhereInput =
    query.side === 'OWNER'
      ? { ownerUserId: userId }
      : query.side === 'RENTER'
        ? { renterUserId: userId }
        : { OR: [{ ownerUserId: userId }, { renterUserId: userId }] };

  const rows = await prisma.rental.findMany({
    where: {
      ...partyFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.propertyId ? { unit: { propertyId: query.propertyId } } : {}),
      ...(query.search
        ? {
            OR: [
              { counterpartyName: { contains: query.search, mode: 'insensitive' } },
              { placeLabel: { contains: query.search, mode: 'insensitive' } },
              { unit: { label: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: RENTAL_INCLUDE,
    orderBy: { id: 'desc' },
    ...cursorArgs(query.limit, query.cursor),
  });

  return toPage(rows, query.limit);
}
