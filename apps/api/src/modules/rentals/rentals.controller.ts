import type { Response } from 'express';
import {
  type idParamSchema,
  type createRentalSchema,
  type endRentalSchema,
  type listRentalsQuerySchema,
  type replaceChargesSchema,
  type updateRentalSchema,
} from '@rms/shared';
import type { ValidatedRequest } from '../../middleware/validate';
import { requireAuthContext } from '../../middleware/require-auth';
import { fromDbDate } from '../../lib/business-date';
import { optionalPaisaToNumber } from '../../lib/serialize';
import type { RentalWithRelations } from './rentals.service';
import * as service from './rentals.service';

/**
 * HTTP in, HTTP out (CLAUDE.md §6).
 *
 * The response mapping is the boundary where `bigint` paisa becomes `number`
 * and PostgreSQL dates become `YYYY-MM-DD` strings.
 */
function toResponse(rental: RentalWithRelations) {
  return {
    id: rental.id,
    status: rental.status,

    ownerUserId: rental.ownerUserId,
    renterUserId: rental.renterUserId,
    counterpartyName: rental.counterpartyName,
    counterpartyPhone: rental.counterpartyPhone,

    unit: rental.unit
      ? {
          id: rental.unit.id,
          label: rental.unit.label,
          type: rental.unit.type,
          propertyId: rental.unit.propertyId,
        }
      : null,
    placeLabel: rental.placeLabel,
    placeAddress: rental.placeAddress,

    frequency: rental.frequency,
    /** Fixed-duration period length in days — 30 or 365 (ADR 0001). */
    periodDays: rental.periodDays,
    startDate: fromDbDate(rental.startDate),
    endDate: rental.endDate ? fromDbDate(rental.endDate) : null,

    dueOffsetDays: rental.dueOffsetDays,
    overdueAfterDays: rental.overdueAfterDays,
    midPeriodEndPolicy: rental.midPeriodEndPolicy,

    /** Refundable, and tracked separately from any rent credit. */
    securityDepositPaisa: optionalPaisaToNumber(rental.securityDepositPaisa),

    charges: rental.charges.map((charge) => ({
      id: charge.id,
      chargeType: charge.chargeType,
      label: charge.label,
      pricingModel: charge.pricingModel,
      amountPaisa: optionalPaisaToNumber(charge.amountPaisa),
      ratePaisaPerUnit: optionalPaisaToNumber(charge.ratePaisaPerUnit),
      prorationPolicy: charge.prorationPolicy,
    })),

    notes: rental.notes,
    endedReason: rental.endedReason,
    endedAt: rental.endedAt?.toISOString() ?? null,
    createdAt: rental.createdAt.toISOString(),
  };
}

type CreateReq = ValidatedRequest<{ body: typeof createRentalSchema }>;
type ListReq = ValidatedRequest<{ query: typeof listRentalsQuerySchema }>;
type IdReq = ValidatedRequest<{ params: typeof idParamSchema }>;
type UpdateReq = ValidatedRequest<{
  params: typeof idParamSchema;
  body: typeof updateRentalSchema;
}>;
type EndReq = ValidatedRequest<{ params: typeof idParamSchema; body: typeof endRentalSchema }>;
type ChargesReq = ValidatedRequest<{
  params: typeof idParamSchema;
  body: typeof replaceChargesSchema;
}>;

export async function create(req: CreateReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const rental = await service.createRental(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.body,
  );
  res.status(201).json(toResponse(rental));
}

export async function list(req: ListReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { items, meta } = await service.listRentals(auth.userId, req.validated.query);
  res.json({ data: items.map(toResponse), meta });
}

export async function getById(req: IdReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { rental } = await service.requireRentalAccess(auth.userId, req.validated.params.id);
  res.json(toResponse(rental));
}

export async function update(req: UpdateReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const rental = await service.updateRental(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
    req.validated.body,
  );
  res.json(toResponse(rental));
}

export async function remove(req: IdReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteRental(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
  );
  res.status(204).end();
}

export async function activate(req: IdReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const rental = await service.activateRental(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
  );
  res.json(toResponse(rental));
}

export async function end(req: EndReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const rental = await service.endRental(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
    req.validated.body,
  );
  res.json(toResponse(rental));
}

export async function replaceCharges(req: ChargesReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const rental = await service.replaceCharges(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
    req.validated.body.charges,
  );
  res.json(toResponse(rental));
}
