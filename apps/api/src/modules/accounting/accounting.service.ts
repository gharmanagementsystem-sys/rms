import type { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { fromDbDate, todayInNepal, toDbDate, type BusinessDate } from '../../lib/business-date';
import { numberToPaisa, paisaToNumber } from '../../lib/serialize';
import { calculateMeteredCharge, planPeriodCharges, type ChargeConfig } from './charge-calculator';
import { periodsToCreate, planPeriods } from './period-generator';
import { allocateFifo, settlementStatusFor, type AllocationTarget } from './settlement';

/**
 * Accounting persistence. CLAUDE.md §13, §16, §54.
 *
 * This layer does no arithmetic of its own — every calculation comes from the
 * pure modules beside it. Its job is transactions, locking and idempotency.
 *
 * Every money-moving operation takes a row lock on the rental first, which
 * serialises concurrent activity per rental. Without it, two payments arriving
 * together could both read the same balance and both allocate against it.
 */

type Tx = Prisma.TransactionClient;

/**
 * Transaction options for money movement.
 *
 * Prisma's 5s default is tuned for a database on the same machine. Neon is a
 * network hop away, so a handful of sequential statements can legitimately
 * exceed it — and a timeout mid-allocation aborts a payment the user believes
 * they made. The work inside is bounded (one rental's periods), so a generous
 * ceiling costs nothing and removes a spurious failure mode.
 */
const MONEY_TX = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * Serialises all money movement for one rental.
 *
 * Chosen over a SERIALIZABLE transaction because the contention here is always
 * within a single rental: this gives the same guarantee without exposing every
 * caller to serialisation-failure retries.
 */
async function lockRental(tx: Tx, rentalId: string): Promise<void> {
  // No ::uuid cast — Prisma maps `String @id` to a TEXT column, so casting the
  // parameter would leave Postgres comparing text to uuid, for which there is
  // no operator.
  await tx.$queryRaw`SELECT id FROM rentals WHERE id = ${rentalId} FOR UPDATE`;
}

/**
 * Recomputes a period's cached totals from its charges and allocations.
 *
 * The cached columns exist because every list screen needs them, but they are
 * never the source of truth — they are recomputed from the underlying rows
 * inside the same transaction that changed those rows.
 */
async function recomputePeriods(tx: Tx, periodIds: string[]): Promise<void> {
  if (periodIds.length === 0) return;

  // Two queries for the whole set rather than two per period (§36 — avoid N+1).
  const [charges, allocations] = await Promise.all([
    tx.periodCharge.findMany({
      where: { periodId: { in: periodIds } },
      select: { periodId: true, amountPaisa: true, isFinalized: true },
    }),
    tx.paymentAllocation.findMany({
      where: { periodId: { in: periodIds }, payment: { status: 'POSTED' } },
      select: { periodId: true, amountPaisa: true },
    }),
  ]);

  for (const periodId of periodIds) {
    const own = charges.filter((charge) => charge.periodId === periodId);
    const totalPaisa = own.reduce(
      (sum, charge) => (charge.isFinalized ? sum + paisaToNumber(charge.amountPaisa) : sum),
      0,
    );
    const paidPaisa = allocations
      .filter((allocation) => allocation.periodId === periodId)
      .reduce((sum, allocation) => sum + paisaToNumber(allocation.amountPaisa), 0);
    const chargesComplete = own.every((charge) => charge.isFinalized);

    await tx.rentalPeriod.update({
      where: { id: periodId },
      data: {
        totalAmountPaisa: numberToPaisa(totalPaisa),
        paidAmountPaisa: numberToPaisa(paidPaisa),
        chargesComplete,
        // The status rule lives in the pure module and nowhere else — it is not
        // re-expressed in SQL, so there is one definition to get right.
        settlementStatus: settlementStatusFor({ totalPaisa, paidPaisa, chargesComplete }),
      },
    });
  }
}

/**
 * Applies any unallocated rent money to outstanding periods, oldest first.
 *
 * Called after a payment is recorded and after new periods appear, so an
 * overpayment automatically settles the next period rather than sitting idle
 * until someone notices it.
 *
 * Security deposits are excluded by the `purpose` filter — a deposit is
 * refundable and must never quietly clear arrears.
 */
async function applyAvailableCredit(tx: Tx, rentalId: string): Promise<void> {
  const periods = await tx.rentalPeriod.findMany({
    where: { rentalId, settlementStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    select: { id: true, sequenceNumber: true, totalAmountPaisa: true, paidAmountPaisa: true },
    orderBy: { sequenceNumber: 'asc' },
  });

  const payments = await tx.payment.findMany({
    where: { rentalId, purpose: 'RENT', status: 'POSTED' },
    select: { id: true, amountPaisa: true, allocations: { select: { amountPaisa: true } } },
    orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
  });

  const targets: AllocationTarget[] = periods.map((period) => ({
    periodId: period.id,
    sequenceNumber: period.sequenceNumber,
    balancePaisa: Math.max(
      0,
      paisaToNumber(period.totalAmountPaisa) - paisaToNumber(period.paidAmountPaisa),
    ),
  }));

  const touched = new Set<string>();

  for (const payment of payments) {
    const allocated = payment.allocations.reduce((sum, a) => sum + paisaToNumber(a.amountPaisa), 0);
    const unallocated = paisaToNumber(payment.amountPaisa) - allocated;
    if (unallocated <= 0) continue;

    const { allocations } = allocateFifo(unallocated, targets);
    if (allocations.length === 0) continue;

    for (const allocation of allocations) {
      // Upsert because this payment may already hold a partial allocation
      // against the period from an earlier pass.
      await tx.paymentAllocation.upsert({
        where: {
          paymentId_periodId: { paymentId: payment.id, periodId: allocation.periodId },
        },
        create: {
          paymentId: payment.id,
          periodId: allocation.periodId,
          amountPaisa: numberToPaisa(allocation.amountPaisa),
        },
        update: { amountPaisa: { increment: numberToPaisa(allocation.amountPaisa) } },
      });

      // Keep the in-memory balances in step so the next payment in this loop
      // does not allocate against money already spoken for.
      const target = targets.find((t) => t.periodId === allocation.periodId);
      if (target) target.balancePaisa -= allocation.amountPaisa;
      touched.add(allocation.periodId);
    }
  }

  await recomputePeriods(tx, [...touched]);
}

/**
 * Creates every period that should exist for a rental as at `asOf`.
 *
 * Idempotent by construction (§16): the plan is deterministic, only missing
 * sequence numbers are inserted, and `UNIQUE (rental_id, sequence_number)` is
 * the backstop if two runs race.
 *
 * Called both by the scheduled job and lazily when accounting is read, so a
 * missed job run self-heals the moment a user opens the screen.
 */
export async function ensurePeriods(
  rentalId: string,
  asOf: BusinessDate = todayInNepal(),
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockRental(tx, rentalId);

    const rental = await tx.rental.findUnique({
      where: { id: rentalId },
      include: {
        charges: { where: { isActive: true } },
        periods: { select: { sequenceNumber: true } },
      },
    });

    if (!rental) {
      throw new AppError('NOT_FOUND', 404, 'This rental was not found.');
    }

    // A draft has not started, and a cancelled rental never did.
    if (rental.status === 'DRAFT' || rental.status === 'CANCELLED') return 0;

    const planned = planPeriods({
      startDate: fromDbDate(rental.startDate),
      periodDays: rental.periodDays,
      dueOffsetDays: rental.dueOffsetDays,
      endDate: rental.endDate ? fromDbDate(rental.endDate) : undefined,
      midPeriodEndPolicy: rental.midPeriodEndPolicy,
      asOf,
    });

    const missing = periodsToCreate(
      planned,
      rental.periods.map((period) => period.sequenceNumber),
    );
    if (missing.length === 0) return 0;

    const chargeConfigs: ChargeConfig[] = rental.charges.map((charge) => ({
      chargeType: charge.chargeType,
      label: charge.label,
      pricingModel: charge.pricingModel,
      amountPaisa: charge.amountPaisa === null ? null : paisaToNumber(charge.amountPaisa),
      ratePaisaPerUnit:
        charge.ratePaisaPerUnit === null ? null : paisaToNumber(charge.ratePaisaPerUnit),
      prorationPolicy: charge.prorationPolicy,
    }));

    // Every period's charge snapshot is computed here first (§3.3), purely in
    // memory. The two database round trips below then insert the whole batch
    // at once instead of one round trip per missing period (§36) — a rental
    // that fell behind schedule for months, opened for the first time since,
    // would otherwise generate dozens of sequential creates on a single page
    // load.
    const plannedRows = missing.map((period) => {
      const charges = planPeriodCharges(chargeConfigs, {
        coveredDays: period.coveredDays,
        basisDays: period.basisDays,
      });

      const totalPaisa = charges.reduce(
        (sum, charge) => (charge.isFinalized ? sum + charge.amountPaisa : sum),
        0,
      );
      const complete = charges.every((charge) => charge.isFinalized);

      return { period, charges, totalPaisa, complete };
    });

    await tx.rentalPeriod.createMany({
      data: plannedRows.map(({ period, totalPaisa, complete }) => ({
        rentalId,
        sequenceNumber: period.sequenceNumber,
        periodStart: toDbDate(period.periodStart),
        periodEnd: toDbDate(period.periodEnd),
        dueDate: toDbDate(period.dueDate),
        coveredDays: period.coveredDays,
        basisDays: period.basisDays,
        isProrated: period.isProrated,
        totalAmountPaisa: numberToPaisa(totalPaisa),
        chargesComplete: complete,
        settlementStatus: settlementStatusFor({ totalPaisa, paidPaisa: 0, chargesComplete: complete }),
      })),
    });

    // `createMany` cannot return the inserted rows, and a period's id is
    // needed to attach its charges — `(rental_id, sequence_number)` is unique
    // and was just inserted, so it is a safe way to look them back up.
    const insertedPeriods = await tx.rentalPeriod.findMany({
      where: { rentalId, sequenceNumber: { in: plannedRows.map((row) => row.period.sequenceNumber) } },
      select: { id: true, sequenceNumber: true },
    });
    const periodIdBySequence = new Map(
      insertedPeriods.map((period) => [period.sequenceNumber, period.id]),
    );

    await tx.periodCharge.createMany({
      data: plannedRows.flatMap(({ period, charges }) => {
        const periodId = periodIdBySequence.get(period.sequenceNumber);
        if (!periodId) {
          // Can only happen if the createMany above silently skipped a row,
          // which would itself be a bug worth surfacing loudly rather than
          // charging the wrong period.
          throw AppError.internal(
            undefined,
            new Error(
              `Period ${period.sequenceNumber} for rental ${rentalId} was not found after creation`,
            ),
          );
        }
        return charges.map((charge) => ({
          periodId,
          chargeType: charge.chargeType,
          label: charge.label,
          pricingModel: charge.pricingModel,
          amountPaisa: numberToPaisa(charge.amountPaisa),
          ratePaisaPerUnit:
            charge.ratePaisaPerUnit === null ? null : numberToPaisa(charge.ratePaisaPerUnit),
          // Snapshotted with the amount, so how a past period was priced
          // stays explainable after the configuration changes (§3.3).
          prorationPolicy: charge.prorationPolicy,
          isFinalized: charge.isFinalized,
          finalizedAt: charge.isFinalized ? new Date() : null,
        }));
      }),
    });

    // A tenant who paid ahead should see the new period settle itself.
    await applyAvailableCredit(tx, rentalId);

    return missing.length;
  }, MONEY_TX);
}

export interface RecordPaymentInput {
  rentalId: string;
  recordedByUserId: string;
  purpose: 'RENT' | 'SECURITY_DEPOSIT' | 'DEPOSIT_REFUND';
  amountPaisa: number;
  paidOn: BusinessDate;
  method: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CHEQUE' | 'OTHER';
  reference?: string | undefined;
  note?: string | undefined;
  /** Client-generated, so a retry returns the original payment (§37). */
  idempotencyKey: string;
}

/**
 * Records a payment and allocates it.
 *
 * Idempotent: a repeat submission with the same key returns the payment that
 * already exists rather than creating a second one. This is the "user taps Pay
 * twice because the first request looked frozen" case from §37.
 *
 * Deposits are recorded but never allocated to periods.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<{
  paymentId: string;
  created: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({
      where: {
        recordedByUserId_idempotencyKey: {
          recordedByUserId: input.recordedByUserId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true, rentalId: true },
    });

    if (existing) {
      if (existing.rentalId !== input.rentalId) {
        throw new AppError(
          'CONFLICT',
          409,
          'This request id has already been used for a different rental.',
        );
      }
      return { paymentId: existing.id, created: false };
    }

    await lockRental(tx, input.rentalId);

    const payment = await tx.payment.create({
      data: {
        rentalId: input.rentalId,
        recordedByUserId: input.recordedByUserId,
        purpose: input.purpose,
        amountPaisa: numberToPaisa(input.amountPaisa),
        paidOn: toDbDate(input.paidOn),
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
      },
      select: { id: true },
    });

    if (input.purpose === 'RENT') {
      await applyAvailableCredit(tx, input.rentalId);
    }

    return { paymentId: payment.id, created: true };
  }, MONEY_TX);
}

/**
 * Reverses a payment (§15, §55).
 *
 * The original row is never edited or deleted. It is marked REVERSED, its
 * allocations are removed, and the affected periods are recomputed — so the
 * record of what was believed, and when, survives.
 */
export async function reversePayment(paymentId: string, rentalId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockRental(tx, rentalId);

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, rentalId },
      include: { allocations: { select: { periodId: true } } },
    });

    if (!payment) throw new AppError('NOT_FOUND', 404, 'This payment was not found.');
    if (payment.status === 'REVERSED') {
      throw new AppError('CONFLICT', 409, 'This payment has already been reversed.');
    }

    const affected = payment.allocations.map((a) => a.periodId);

    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'REVERSED', reversedAt: new Date() },
    });

    await recomputePeriods(tx, affected);

    // Money freed up by the reversal may still settle other periods.
    await applyAvailableCredit(tx, rentalId);
  }, MONEY_TX);
}

export interface MeterReadingInput {
  periodId: string;
  chargeId: string;
  previousReading: number;
  currentReading: number;
}

/**
 * Prices a metered charge from its readings and finalises it (§60).
 *
 * Completing the last outstanding charge is what allows the period to reach
 * PAID, so the recompute afterwards is not optional.
 */
export async function recordMeterReading(
  rentalId: string,
  input: MeterReadingInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockRental(tx, rentalId);

    const charge = await tx.periodCharge.findFirst({
      where: { id: input.chargeId, periodId: input.periodId, period: { rentalId } },
    });

    if (!charge) throw new AppError('NOT_FOUND', 404, 'This charge was not found.');
    if (charge.pricingModel !== 'PER_UNIT') {
      throw new AppError('CONFLICT', 409, 'This charge is not metered.');
    }
    if (charge.ratePaisaPerUnit === null) {
      // A PER_UNIT charge without a rate should be impossible — the database
      // CHECK on rental_charges prevents it — so this is corruption, not user
      // error, and the real cause belongs in the logs rather than the response.
      throw AppError.internal(
        undefined,
        new Error(`Metered charge ${charge.id} has no snapshotted rate`),
      );
    }

    // Uses the rate SNAPSHOTTED on the period, not the rental's current rate,
    // so a later price change cannot re-price a past period (§3.3).
    const { consumedUnits, amountPaisa } = calculateMeteredCharge({
      previousReading: input.previousReading,
      currentReading: input.currentReading,
      ratePaisaPerUnit: paisaToNumber(charge.ratePaisaPerUnit),
    });

    await tx.periodCharge.update({
      where: { id: charge.id },
      data: {
        previousReading: input.previousReading,
        currentReading: input.currentReading,
        consumedUnits,
        amountPaisa: numberToPaisa(amountPaisa),
        isFinalized: true,
        finalizedAt: new Date(),
      },
    });

    await recomputePeriods(tx, [input.periodId]);
    // The period just got more expensive; existing credit may cover it.
    await applyAvailableCredit(tx, rentalId);
  }, MONEY_TX);
}
