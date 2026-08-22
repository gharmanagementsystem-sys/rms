import type { Response } from 'express';
import type {
  idParamSchema,
  listPaymentsQuerySchema,
  listPeriodsQuerySchema,
  meterReadingSchema,
  recordPaymentSchema,
} from '@rms/shared';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { fromDbDate, todayInNepal } from '../../lib/business-date';
import { optionalPaisaToNumber, paisaToNumber } from '../../lib/serialize';
import { requireAuthContext } from '../../middleware/require-auth';
import type { ValidatedRequest } from '../../middleware/validate';
import { requireRentalAccess } from '../rentals/rentals.service';
import * as service from './accounting.service';
import { balanceOf, isOverdue, rentalBalance } from './settlement';

/**
 * Accounting endpoints (CLAUDE.md §6, §61).
 *
 * `isOverdue` is computed here at read time rather than stored, so it is
 * correct at every instant with no job involved (§15).
 */

type PeriodRow = Awaited<ReturnType<typeof loadPeriods>>[number];

async function loadPeriods(rentalId: string) {
  return prisma.rentalPeriod.findMany({
    where: { rentalId },
    include: { charges: { orderBy: { chargeType: 'asc' } } },
    orderBy: { sequenceNumber: 'asc' },
  });
}

function periodToResponse(period: PeriodRow, overdueAfterDays: number, asOf: string) {
  const totalPaisa = paisaToNumber(period.totalAmountPaisa);
  const paidPaisa = paisaToNumber(period.paidAmountPaisa);
  const balancePaisa = balanceOf(totalPaisa, paidPaisa);
  const dueDate = fromDbDate(period.dueDate);

  return {
    id: period.id,
    sequenceNumber: period.sequenceNumber,
    periodStart: fromDbDate(period.periodStart),
    periodEnd: fromDbDate(period.periodEnd),
    dueDate,
    coveredDays: period.coveredDays,
    basisDays: period.basisDays,
    isProrated: period.isProrated,

    totalPaisa,
    paidPaisa,
    balancePaisa,

    settlementStatus: period.settlementStatus,
    /** Derived, never stored (§15). */
    isOverdue: isOverdue({ balancePaisa, dueDate, overdueAfterDays, asOf }),
    /** False while a meter reading is outstanding — the total is not final. */
    chargesComplete: period.chargesComplete,

    /** The full breakdown. A total is never shown without it (§61). */
    charges: period.charges.map((charge) => ({
      id: charge.id,
      chargeType: charge.chargeType,
      label: charge.label,
      pricingModel: charge.pricingModel,
      amountPaisa: paisaToNumber(charge.amountPaisa),
      ratePaisaPerUnit: optionalPaisaToNumber(charge.ratePaisaPerUnit),
      prorationPolicy: charge.prorationPolicy,
      previousReading: charge.previousReading,
      currentReading: charge.currentReading,
      consumedUnits: charge.consumedUnits,
      isFinalized: charge.isFinalized,
    })),
  };
}

type RentalIdReq = ValidatedRequest<{ params: typeof idParamSchema }>;
type PeriodsReq = ValidatedRequest<{
  params: typeof idParamSchema;
  query: typeof listPeriodsQuerySchema;
}>;
type PaymentsListReq = ValidatedRequest<{
  params: typeof idParamSchema;
  query: typeof listPaymentsQuerySchema;
}>;
type PaymentReq = ValidatedRequest<{
  params: typeof idParamSchema;
  body: typeof recordPaymentSchema;
}>;
type ReadingReq = ValidatedRequest<{
  params: typeof idParamSchema;
  body: typeof meterReadingSchema;
}>;

/** Periods, generated lazily so a missed job run self-heals on read (§16). */
export async function listPeriods(req: PeriodsReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { rental } = await requireRentalAccess(auth.userId, req.validated.params.id);

  await service.ensurePeriods(rental.id);

  const asOf = todayInNepal();
  const periods = await loadPeriods(rental.id);
  const mapped = periods.map((period) => periodToResponse(period, rental.overdueAfterDays, asOf));

  res.json({
    data: req.validated.query.unsettled
      ? mapped.filter((period) => period.balancePaisa > 0)
      : mapped,
    meta: { hasMore: false, nextCursor: null },
  });
}

/** The rental's overall financial position (§24, §61). */
export async function getSummary(req: RentalIdReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { rental } = await requireRentalAccess(auth.userId, req.validated.params.id);

  await service.ensurePeriods(rental.id);

  const asOf = todayInNepal();
  const [periods, payments, allocations] = await Promise.all([
    loadPeriods(rental.id),
    prisma.payment.groupBy({
      by: ['purpose'],
      where: { rentalId: rental.id, status: 'POSTED' },
      _sum: { amountPaisa: true },
    }),
    prisma.paymentAllocation.aggregate({
      where: { payment: { rentalId: rental.id, status: 'POSTED' } },
      _sum: { amountPaisa: true },
    }),
  ]);

  const sumFor = (purpose: string) =>
    paisaToNumber(payments.find((p) => p.purpose === purpose)?._sum.amountPaisa ?? 0n);

  const balance = rentalBalance({
    periods: periods.map((period) => ({
      totalPaisa: paisaToNumber(period.totalAmountPaisa),
      paidPaisa: paisaToNumber(period.paidAmountPaisa),
    })),
    rentPaymentsPaisa: sumFor('RENT'),
    allocatedPaisa: paisaToNumber(allocations._sum.amountPaisa ?? 0n),
    depositPaidPaisa: sumFor('SECURITY_DEPOSIT'),
    depositRefundedPaisa: sumFor('DEPOSIT_REFUND'),
  });

  const mapped = periods.map((period) => periodToResponse(period, rental.overdueAfterDays, asOf));
  const overdue = mapped.filter((period) => period.isOverdue);
  const nextDue = mapped.find((period) => period.balancePaisa > 0);

  res.json({
    rentalId: rental.id,
    status: rental.status,
    ...balance,
    periodCount: periods.length,
    overdueCount: overdue.length,
    overduePaisa: overdue.reduce((sum, period) => sum + period.balancePaisa, 0),
    nextDueDate: nextDue?.dueDate ?? null,
    nextDuePaisa: nextDue?.balancePaisa ?? 0,
  });
}

/**
 * Records a payment. Either party may do so — both the landlord and the tenant
 * can enter one.
 */
export async function recordPayment(req: PaymentReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { rental } = await requireRentalAccess(auth.userId, req.validated.params.id);

  if (rental.status === 'DRAFT' || rental.status === 'CANCELLED') {
    throw new AppError('RENTAL_NOT_ACTIVE', 409, 'This rental has not started yet.');
  }

  await service.ensurePeriods(rental.id);

  const { paymentId, created } = await service.recordPayment({
    rentalId: rental.id,
    recordedByUserId: auth.userId,
    ...req.validated.body,
  });

  // A replayed request returns 200 with the original payment rather than
  // creating a second one (§37).
  res.status(created ? 201 : 200).json({ id: paymentId, replayed: !created });
}

export async function listPayments(req: PaymentsListReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const { rental } = await requireRentalAccess(auth.userId, req.validated.params.id);

  const payments = await prisma.payment.findMany({
    where: {
      rentalId: rental.id,
      ...(req.validated.query.purpose ? { purpose: req.validated.query.purpose } : {}),
    },
    include: { allocations: { select: { periodId: true, amountPaisa: true } } },
    orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
  });

  res.json({
    data: payments.map((payment) => ({
      id: payment.id,
      purpose: payment.purpose,
      amountPaisa: paisaToNumber(payment.amountPaisa),
      paidOn: fromDbDate(payment.paidOn),
      method: payment.method,
      reference: payment.reference,
      note: payment.note,
      status: payment.status,
      recordedByUserId: payment.recordedByUserId,
      /** Which periods this money settled — always inspectable. */
      allocations: payment.allocations.map((allocation) => ({
        periodId: allocation.periodId,
        amountPaisa: paisaToNumber(allocation.amountPaisa),
      })),
      unallocatedPaisa:
        paisaToNumber(payment.amountPaisa) -
        payment.allocations.reduce((sum, a) => sum + paisaToNumber(a.amountPaisa), 0),
      createdAt: payment.createdAt.toISOString(),
    })),
    meta: { hasMore: false, nextCursor: null },
  });
}

export async function recordMeterReading(req: ReadingReq, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const access = await requireRentalAccess(auth.userId, req.validated.params.id);

  if (!access.canManage) {
    throw new AppError(
      'UNAUTHORIZED_RENTAL_ACCESS',
      403,
      'Only the landlord can record meter readings.',
    );
  }

  const charge = await prisma.periodCharge.findFirst({
    where: { id: req.validated.body.chargeId, period: { rentalId: access.rental.id } },
    select: { periodId: true },
  });
  if (!charge) throw new AppError('NOT_FOUND', 404, 'This charge was not found.');

  await service.recordMeterReading(access.rental.id, {
    periodId: charge.periodId,
    ...req.validated.body,
  });

  res.status(204).send();
}
