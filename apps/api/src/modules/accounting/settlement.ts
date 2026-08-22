import type { SettlementStatus } from '@rms/shared';
import { addDays, compareDates, type BusinessDate } from '../../lib/business-date';

/**
 * Settlement: how much is owed, what has been paid, and what that means.
 * CLAUDE.md §15, §37, §62.
 *
 * PURE: no database, no clock. All amounts are integer paisa.
 *
 * The financial invariants this module upholds:
 *
 *   1. balance = total - paid, and is never negative on a period.
 *   2. An allocation never exceeds the period's outstanding balance.
 *   3. Money that cannot be allocated becomes rental credit — it is never
 *      discarded and never turns a period balance negative.
 *   4. A security deposit is never used to settle rent.
 */

export interface SettlementInput {
  totalPaisa: number;
  paidPaisa: number;
  /** False while a metered charge is still awaiting its reading. */
  chargesComplete: boolean;
  /** The landlord has forgiven this period. */
  isWaived?: boolean;
}

/**
 * The stored settlement status of a period.
 *
 * Note what is absent: OVERDUE. That is derived by `isOverdue` below, so it can
 * never go stale between job runs (§15).
 */
export function settlementStatusFor(input: SettlementInput): SettlementStatus {
  const { totalPaisa, paidPaisa, chargesComplete, isWaived = false } = input;

  assertNonNegative('totalPaisa', totalPaisa);
  assertNonNegative('paidPaisa', paidPaisa);

  if (isWaived) return 'WAIVED';

  /**
   * A period with an unpriced metered charge cannot be PAID, even when the
   * amount known so far has been covered. Marking it PAID and then reopening it
   * once the electricity reading arrived would read to a user as the app losing
   * their money (§60).
   */
  if (!chargesComplete) {
    return paidPaisa > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  }

  // A period that genuinely costs nothing is settled, not perpetually pending.
  if (totalPaisa === 0) return 'PAID';

  if (paidPaisa >= totalPaisa) return 'PAID';
  if (paidPaisa > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

export function balanceOf(totalPaisa: number, paidPaisa: number): number {
  assertNonNegative('totalPaisa', totalPaisa);
  assertNonNegative('paidPaisa', paidPaisa);
  // Clamped at zero: a period is never "negatively owed". Surplus lives on the
  // rental as credit instead, which is where it can be applied to a later
  // period (§45 — overpayments).
  return Math.max(0, totalPaisa - paidPaisa);
}

export interface OverdueInput {
  balancePaisa: number;
  dueDate: BusinessDate;
  /** Grace days after the due date before the period counts as overdue. */
  overdueAfterDays: number;
  /** "Today" in Nepal Standard Time. */
  asOf: BusinessDate;
}

/**
 * Derived, never stored.
 *
 * Computing this at read time means it is correct at every instant with no job
 * involved. The overdue job's only responsibility is to send a notification —
 * not to maintain truth (§15, §18).
 */
export function isOverdue(input: OverdueInput): boolean {
  const { balancePaisa, dueDate, overdueAfterDays, asOf } = input;
  if (balancePaisa <= 0) return false;
  const graceEnds = addDays(dueDate, overdueAfterDays);
  return compareDates(asOf, graceEnds) > 0;
}

export interface AllocationTarget {
  periodId: string;
  /** Used to order allocation. Oldest debt is settled first. */
  sequenceNumber: number;
  /** Outstanding balance on this period, in paisa. */
  balancePaisa: number;
}

export interface Allocation {
  periodId: string;
  amountPaisa: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** What could not be allocated. Becomes rental credit — never discarded. */
  remainderPaisa: number;
}

/**
 * Allocates money across outstanding periods, oldest first.
 *
 * FIFO rather than "apply to the period the user tapped": it is deterministic,
 * it matches how rent arrears are normally settled, and it means the same
 * payment always produces the same allocation. That last property is what makes
 * the operation safe to retry (§37).
 *
 * Targets are sorted here rather than trusted to arrive in order, so a caller
 * cannot accidentally change where money lands by changing a query's ORDER BY.
 *
 * Surplus is returned as `remainderPaisa` rather than overpaying a period, so
 * the invariant "a period balance is never negative" holds by construction.
 */
export function allocateFifo(amountPaisa: number, targets: AllocationTarget[]): AllocationResult {
  assertNonNegative('amountPaisa', amountPaisa);
  if (!Number.isInteger(amountPaisa)) {
    throw new RangeError(`amountPaisa must be whole paisa, received ${amountPaisa}`);
  }

  const ordered = [...targets].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const allocations: Allocation[] = [];
  let remaining = amountPaisa;

  for (const target of ordered) {
    if (remaining === 0) break;
    assertNonNegative('balancePaisa', target.balancePaisa);
    if (target.balancePaisa === 0) continue;

    const applied = Math.min(remaining, target.balancePaisa);
    allocations.push({ periodId: target.periodId, amountPaisa: applied });
    remaining -= applied;
  }

  return { allocations, remainderPaisa: remaining };
}

export interface RentalBalanceInput {
  /** Every period on the rental. */
  periods: { totalPaisa: number; paidPaisa: number }[];
  /** Sum of POSTED payments with purpose RENT. */
  rentPaymentsPaisa: number;
  /** Sum of all live allocations. */
  allocatedPaisa: number;
  /** Sum of POSTED payments with purpose SECURITY_DEPOSIT. */
  depositPaidPaisa: number;
  /** Sum of POSTED payments with purpose DEPOSIT_REFUND. */
  depositRefundedPaisa: number;
}

export interface RentalBalance {
  /** Total charged across all periods. */
  billedPaisa: number;
  /** Total settled against periods. */
  paidPaisa: number;
  /** Still owed. */
  outstandingPaisa: number;
  /** Rent money received but not yet applied to a period. */
  creditPaisa: number;
  /** Refundable deposit currently held. Never offsets rent. */
  depositHeldPaisa: number;
}

/**
 * Rolls a rental's periods and payments into the numbers a dashboard shows
 * (§24, §61).
 *
 * The deposit is reported separately and is deliberately excluded from
 * `outstandingPaisa`: it is the tenant's money held against damage, not a
 * prepayment of rent, and quietly consuming it to clear arrears is precisely
 * the behaviour that causes disputes.
 */
export function rentalBalance(input: RentalBalanceInput): RentalBalance {
  const billedPaisa = input.periods.reduce((sum, period) => sum + period.totalPaisa, 0);
  const paidPaisa = input.periods.reduce((sum, period) => sum + period.paidPaisa, 0);
  const outstandingPaisa = input.periods.reduce(
    (sum, period) => sum + balanceOf(period.totalPaisa, period.paidPaisa),
    0,
  );

  const creditPaisa = input.rentPaymentsPaisa - input.allocatedPaisa;
  if (creditPaisa < 0) {
    // Allocations exceeding payments means the ledger is corrupt. Failing loudly
    // beats reporting a plausible-looking wrong number (§74).
    throw new RangeError(
      `Allocated ${input.allocatedPaisa} exceeds rent payments ${input.rentPaymentsPaisa}`,
    );
  }

  const depositHeldPaisa = input.depositPaidPaisa - input.depositRefundedPaisa;
  if (depositHeldPaisa < 0) {
    throw new RangeError(
      `Refunded ${input.depositRefundedPaisa} exceeds deposit ${input.depositPaidPaisa}`,
    );
  }

  return { billedPaisa, paidPaisa, outstandingPaisa, creditPaisa, depositHeldPaisa };
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be zero or more, received ${value}`);
  }
}
