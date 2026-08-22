import { Router, type RequestHandler } from 'express';
import {
  createRentalSchema,
  endRentalSchema,
  idParamSchema,
  listPaymentsQuerySchema,
  listPeriodsQuerySchema,
  listRentalsQuerySchema,
  meterReadingSchema,
  recordPaymentSchema,
  replaceChargesSchema,
  updateRentalSchema,
} from '@rms/shared';
import { requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as accounting from '../accounting/accounting.controller';
import * as controller from './rentals.controller';

/**
 * Rental routes (CLAUDE.md §7).
 *
 * Lifecycle transitions are their own endpoints rather than a writable `status`
 * field. A client that could PATCH `status` would be deciding business state;
 * these endpoints let the server own the transition rules (§54).
 *
 * DELETE only ever succeeds for a DRAFT rental — one with no accounting
 * history to protect. An ACTIVE or ENDED rental is ended, never destroyed, so
 * its history survives (§34); `deleteRental` enforces this itself rather than
 * relying on the route to gate it.
 */
export const rentalsRouter: Router = Router();

rentalsRouter.use(requireAuth);

rentalsRouter.post(
  '/',
  validate({ body: createRentalSchema }),
  controller.create as RequestHandler,
);

rentalsRouter.get(
  '/',
  validate({ query: listRentalsQuerySchema }),
  controller.list as RequestHandler,
);

rentalsRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  controller.getById as RequestHandler,
);

rentalsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateRentalSchema }),
  controller.update as RequestHandler,
);

rentalsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  controller.remove as RequestHandler,
);

rentalsRouter.post(
  '/:id/activate',
  validate({ params: idParamSchema }),
  controller.activate as RequestHandler,
);

rentalsRouter.post(
  '/:id/end',
  validate({ params: idParamSchema, body: endRentalSchema }),
  controller.end as RequestHandler,
);

rentalsRouter.put(
  '/:id/charges',
  validate({ params: idParamSchema, body: replaceChargesSchema }),
  controller.replaceCharges as RequestHandler,
);

// --- Accounting ------------------------------------------------------------
// Mounted under the rental because every accounting record belongs to one, and
// access is therefore established by the same ownership check.

rentalsRouter.get(
  '/:id/periods',
  validate({ params: idParamSchema, query: listPeriodsQuerySchema }),
  accounting.listPeriods as RequestHandler,
);

rentalsRouter.get(
  '/:id/summary',
  validate({ params: idParamSchema }),
  accounting.getSummary as RequestHandler,
);

rentalsRouter.post(
  '/:id/payments',
  validate({ params: idParamSchema, body: recordPaymentSchema }),
  accounting.recordPayment as RequestHandler,
);

rentalsRouter.get(
  '/:id/payments',
  validate({ params: idParamSchema, query: listPaymentsQuerySchema }),
  accounting.listPayments as RequestHandler,
);

rentalsRouter.post(
  '/:id/meter-readings',
  validate({ params: idParamSchema, body: meterReadingSchema }),
  accounting.recordMeterReading as RequestHandler,
);
