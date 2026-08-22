import { Router, type RequestHandler } from 'express';
import { createUnitSchema, listUnitsQuerySchema, updateUnitSchema } from '@rms/shared';
import { validate } from '../../middleware/validate';
import * as controller from './units.controller';
import { unitIdParamsSchema, unitParamsSchema } from './units.controller';

/**
 * Unit routes, mounted at /properties/:propertyId/units.
 *
 * `mergeParams` is required so :propertyId from the parent router is visible
 * here — without it the ownership check would receive undefined and every
 * request would fail.
 *
 * Authentication is applied by the parent property router.
 */
export const unitsRouter: Router = Router({ mergeParams: true });

unitsRouter.post(
  '/',
  validate({ params: unitParamsSchema, body: createUnitSchema }),
  controller.create as RequestHandler,
);

unitsRouter.get(
  '/',
  validate({ params: unitParamsSchema, query: listUnitsQuerySchema }),
  controller.list as RequestHandler,
);

unitsRouter.get(
  '/:unitId',
  validate({ params: unitIdParamsSchema }),
  controller.getById as RequestHandler,
);

unitsRouter.patch(
  '/:unitId',
  validate({ params: unitIdParamsSchema, body: updateUnitSchema }),
  controller.update as RequestHandler,
);

unitsRouter.delete(
  '/:unitId',
  validate({ params: unitIdParamsSchema }),
  controller.archive as RequestHandler,
);
