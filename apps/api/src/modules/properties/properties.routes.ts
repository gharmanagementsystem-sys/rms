import { Router, type RequestHandler } from 'express';
import {
  createPropertySchema,
  idParamSchema,
  listPropertiesQuerySchema,
  updatePropertySchema,
} from '@rms/shared';
import { requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './properties.controller';
import { unitsRouter } from '../units/units.routes';

/**
 * Property routes (CLAUDE.md §7).
 *
 * Every route is authenticated. Ownership is enforced in the service layer, so
 * a missing check here cannot silently widen access.
 *
 * DELETE archives rather than destroys — financial history is never removed
 * (§34, §57).
 */
export const propertiesRouter: Router = Router();

propertiesRouter.use(requireAuth);

propertiesRouter.post(
  '/',
  validate({ body: createPropertySchema }),
  controller.create as RequestHandler,
);

propertiesRouter.get(
  '/',
  validate({ query: listPropertiesQuerySchema }),
  controller.list as RequestHandler,
);

propertiesRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  controller.getById as RequestHandler,
);

propertiesRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updatePropertySchema }),
  controller.update as RequestHandler,
);

propertiesRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  controller.archive as RequestHandler,
);

// Units are always addressed through their property, so ownership is
// established by the parent resource.
propertiesRouter.use('/:propertyId/units', unitsRouter);
