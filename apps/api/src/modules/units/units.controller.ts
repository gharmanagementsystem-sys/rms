import type { Response } from 'express';
import { z } from 'zod';
import type { createUnitSchema, listUnitsQuerySchema, updateUnitSchema } from '@rms/shared';
import type { ValidatedRequest } from '../../middleware/validate';
import { requireAuthContext } from '../../middleware/require-auth';
import type { UnitWithOccupancy } from './units.service';
import * as service from './units.service';

/** Units are always addressed beneath their property. */
export const unitParamsSchema = z.object({
  propertyId: z.uuid(),
});

export const unitIdParamsSchema = unitParamsSchema.extend({
  unitId: z.uuid(),
});

function toResponse(unit: UnitWithOccupancy) {
  return {
    id: unit.id,
    propertyId: unit.propertyId,
    parentUnitId: unit.parentUnitId,
    label: unit.label,
    type: unit.type,
    floor: unit.floor,
    /** Owner-set state. */
    availability: unit.availability,
    /** Derived: OCCUPIED when an active rental exists, else `availability`. */
    occupancy: unit.occupancy,
    archivedAt: unit.archivedAt?.toISOString() ?? null,
    createdAt: unit.createdAt.toISOString(),
  };
}

type CreateReq = ValidatedRequest<{
  body: typeof createUnitSchema;
  params: typeof unitParamsSchema;
}>;
type ListReq = ValidatedRequest<{
  query: typeof listUnitsQuerySchema;
  params: typeof unitParamsSchema;
}>;
type UnitReq = ValidatedRequest<{ params: typeof unitIdParamsSchema }>;
type UpdateReq = ValidatedRequest<{
  body: typeof updateUnitSchema;
  params: typeof unitIdParamsSchema;
}>;

export async function create(req: CreateReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const unit = await service.createUnit(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.propertyId,
    req.validated.body,
  );
  res.status(201).json(toResponse(unit));
}

export async function list(req: ListReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { items, meta } = await service.listUnits(
    auth.userId,
    req.validated.params.propertyId,
    req.validated.query,
  );
  res.json({ data: items.map(toResponse), meta });
}

export async function getById(req: UnitReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const unit = await service.requireOwnedUnit(
    auth.userId,
    req.validated.params.propertyId,
    req.validated.params.unitId,
  );
  res.json(toResponse(unit));
}

export async function update(req: UpdateReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const unit = await service.updateUnit(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.propertyId,
    req.validated.params.unitId,
    req.validated.body,
  );
  res.json(toResponse(unit));
}

export async function archive(req: UnitReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const unit = await service.archiveUnit(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.propertyId,
    req.validated.params.unitId,
  );
  res.json(toResponse(unit));
}
