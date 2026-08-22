import type { Response } from 'express';
import type {
  createPropertySchema,
  idParamSchema,
  listPropertiesQuerySchema,
  updatePropertySchema,
} from '@rms/shared';
import type { Property } from '../../../generated/prisma/client';
import type { ValidatedRequest } from '../../middleware/validate';
import { requireAuthContext } from '../../middleware/require-auth';
import * as service from './properties.service';

/**
 * HTTP in, HTTP out. No business logic and no database access (CLAUDE.md §6).
 */

/** Response shape. Explicit rather than returning the row, so a column added
 *  later cannot leak into the API by accident. */
function toResponse(property: Property) {
  return {
    id: property.id,
    name: property.name,
    province: property.province,
    district: property.district,
    municipality: property.municipality,
    ward: property.ward,
    addressLine: property.addressLine,
    landmark: property.landmark,
    archivedAt: property.archivedAt?.toISOString() ?? null,
    createdAt: property.createdAt.toISOString(),
  };
}

type CreateReq = ValidatedRequest<{ body: typeof createPropertySchema }>;
type UpdateReq = ValidatedRequest<{
  body: typeof updatePropertySchema;
  params: typeof idParamSchema;
}>;
type ListReq = ValidatedRequest<{ query: typeof listPropertiesQuerySchema }>;
type IdReq = ValidatedRequest<{ params: typeof idParamSchema }>;

export async function create(req: CreateReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const property = await service.createProperty(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.body,
  );
  res.status(201).json(toResponse(property));
}

export async function list(req: ListReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { items, meta } = await service.listProperties(auth.userId, req.validated.query);
  res.json({ data: items.map(toResponse), meta });
}

export async function getById(req: IdReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const property = await service.getProperty(auth.userId, req.validated.params.id);
  res.json(toResponse(property));
}

export async function update(req: UpdateReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const property = await service.updateProperty(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
    req.validated.body,
  );
  res.json(toResponse(property));
}

export async function archive(req: IdReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const property = await service.archiveProperty(
    { userId: auth.userId, requestId: String(req.id) },
    req.validated.params.id,
  );
  res.json(toResponse(property));
}
