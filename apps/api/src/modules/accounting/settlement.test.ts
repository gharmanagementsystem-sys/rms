import { describe, expect, it } from 'vitest';
import { rupeesToPaisa } from '@rms/shared';
import {
  allocateFifo,
  balanceOf,
  isOverdue,
  rentalBalance,
  settlementStatusFor,
  type AllocationTarget,
} from './settlement';

const NPR = rupeesToPaisa;

describe('settlement status', () => {
  const complete = { chargesComplete: true };

  it('is UNPAID when nothing has been paid', () => {
    expect(settlementStatusFor({ totalPaisa: NPR(15000), paidPaisa: 0, ...complete })).toBe(
      'UNPAID',
    );
  });

  it('is PARTIALLY_PAID for a part payment (§45)', () => {
    expect(
      settlementStatusFor({ totalPaisa: NPR(17750), paidPaisa: NPR(10000), ...complete }),
    ).toBe('PARTIALLY_PAID');
  });

  it('is PAID when the total is covered', () => {
    expect(
      settlementStatusFor({ totalPaisa: NPR(17750), paidPaisa: NPR(17750), ...complete }),
    ).toBe('PAID');
  });

  it('is PAID when a period genuinely costs nothing (§45 — zero charges)', () => {
    expect(settlementStatusFor({ totalPaisa: 0, paidPaisa: 0, ...complete })).toBe('PAID');
  });

  it('is WAIVED when the landlord forgives it', () => {
    expect(
      settlementStatusFor({ totalPaisa: NPR(15000), paidPaisa: 0, ...complete, isWaived: true }),
    ).toBe('WAIVED');
  });

  describe('while a meter reading is outstanding', () => {
    const incomplete = { chargesComplete: false };

    it('cannot reach PAID even when the known amount is covered', () => {
      // Otherwise the period would look settled, then silently reopen when the
      // electricity reading arrived — which reads as the app losing money.
      expect(
        settlementStatusFor({ totalPaisa: NPR(15000), paidPaisa: NPR(15000), ...incomplete }),
      ).toBe('PARTIALLY_PAID');
    });

    it('is still UNPAID when nothing has been paid', () => {
      expect(settlementStatusFor({ totalPaisa: NPR(15000), paidPaisa: 0, ...incomplete })).toBe(
        'UNPAID',
      );
    });
  });

  it('rejects negative money', () => {
    expect(() => settlementStatusFor({ totalPaisa: -1, paidPaisa: 0, ...complete })).toThrow(
      RangeError,
    );
  });
});

describe('balance', () => {
  it('is total minus paid', () => {
    expect(balanceOf(NPR(17750), NPR(10000))).toBe(NPR(7750));
  });

  it('never goes negative — surplus is credit, not a negative balance', () => {
    expect(balanceOf(NPR(15000), NPR(20000))).toBe(0);
  });
});

describe('overdue is derived, never stored (§15)', () => {
  const base = { balancePaisa: NPR(15000), dueDate: '2026-08-01', overdueAfterDays: 5 };

  it('is not overdue on the due date', () => {
    expect(isOverdue({ ...base, asOf: '2026-08-01' })).toBe(false);
  });

  it('is not overdue during the grace period', () => {
    expect(isOverdue({ ...base, asOf: '2026-08-06' })).toBe(false);
  });

  it('becomes overdue the day after grace ends', () => {
    expect(isOverdue({ ...base, asOf: '2026-08-07' })).toBe(true);
  });

  it('is never overdue when nothing is owed', () => {
    expect(isOverdue({ ...base, balancePaisa: 0, asOf: '2027-01-01' })).toBe(false);
  });

  it('with no grace, is overdue the day after the due date', () => {
    expect(isOverdue({ ...base, overdueAfterDays: 0, asOf: '2026-08-02' })).toBe(true);
    expect(isOverdue({ ...base, overdueAfterDays: 0, asOf: '2026-08-01' })).toBe(false);
  });
});

describe('FIFO allocation', () => {
  const targets = (...balances: number[]): AllocationTarget[] =>
    balances.map((balancePaisa, i) => ({
      periodId: `p${i + 1}`,
      sequenceNumber: i + 1,
      balancePaisa,
    }));

  it('settles the oldest debt first', () => {
    const result = allocateFifo(NPR(20000), targets(NPR(15000), NPR(15000)));
    expect(result.allocations).toEqual([
      { periodId: 'p1', amountPaisa: NPR(15000) },
      { periodId: 'p2', amountPaisa: NPR(5000) },
    ]);
    expect(result.remainderPaisa).toBe(0);
  });

  it('orders by sequence regardless of the order it receives (§37)', () => {
    const shuffled = [...targets(NPR(15000), NPR(15000))].reverse();
    const result = allocateFifo(NPR(15000), shuffled);
    // The oldest period is still settled first, so a changed ORDER BY cannot
    // move where money lands.
    expect(result.allocations).toEqual([{ periodId: 'p1', amountPaisa: NPR(15000) }]);
  });

  it('records a partial payment against one period', () => {
    const result = allocateFifo(NPR(10000), targets(NPR(17750)));
    expect(result.allocations).toEqual([{ periodId: 'p1', amountPaisa: NPR(10000) }]);
    expect(result.remainderPaisa).toBe(0);
  });

  it('turns an overpayment into credit rather than a negative balance (§45)', () => {
    const result = allocateFifo(NPR(20000), targets(NPR(15000)));
    expect(result.allocations).toEqual([{ periodId: 'p1', amountPaisa: NPR(15000) }]);
    expect(result.remainderPaisa).toBe(NPR(5000));
  });

  it('carries credit forward into later periods', () => {
    // A lump sum covering three months at once.
    const result = allocateFifo(NPR(45000), targets(NPR(15000), NPR(15000), NPR(15000)));
    expect(result.allocations).toHaveLength(3);
    expect(result.remainderPaisa).toBe(0);
  });

  it('holds the whole amount as credit when nothing is owed', () => {
    const result = allocateFifo(NPR(15000), []);
    expect(result.allocations).toEqual([]);
    expect(result.remainderPaisa).toBe(NPR(15000));
  });

  it('skips periods that are already settled', () => {
    const result = allocateFifo(NPR(5000), targets(0, NPR(15000)));
    expect(result.allocations).toEqual([{ periodId: 'p2', amountPaisa: NPR(5000) }]);
  });

  it('never allocates more than a period owes', () => {
    const result = allocateFifo(NPR(1000000), targets(NPR(15000), NPR(15000)));
    for (const allocation of result.allocations) {
      expect(allocation.amountPaisa).toBeLessThanOrEqual(NPR(15000));
    }
    const allocated = result.allocations.reduce((s, a) => s + a.amountPaisa, 0);
    expect(allocated + result.remainderPaisa).toBe(NPR(1000000));
  });

  it('conserves money — allocations plus remainder always equal the payment', () => {
    for (const amount of [0, 1, NPR(1), NPR(7333), NPR(45000), NPR(999999)]) {
      const result = allocateFifo(amount, targets(NPR(15000), NPR(2500), NPR(17750)));
      const allocated = result.allocations.reduce((s, a) => s + a.amountPaisa, 0);
      expect(allocated + result.remainderPaisa).toBe(amount);
    }
  });

  it('is deterministic, so retrying a payment is safe (§37)', () => {
    const input = targets(NPR(15000), NPR(15000));
    expect(allocateFifo(NPR(20000), input)).toEqual(allocateFifo(NPR(20000), input));
  });

  it('rejects fractional or negative amounts', () => {
    expect(() => allocateFifo(150.5, targets(NPR(15000)))).toThrow(RangeError);
    expect(() => allocateFifo(-1, targets(NPR(15000)))).toThrow(RangeError);
  });
});

describe('rental balance', () => {
  it('summarises periods, credit and deposit separately', () => {
    const balance = rentalBalance({
      periods: [
        { totalPaisa: NPR(15000), paidPaisa: NPR(15000) },
        { totalPaisa: NPR(15000), paidPaisa: NPR(10000) },
      ],
      rentPaymentsPaisa: NPR(30000),
      allocatedPaisa: NPR(25000),
      depositPaidPaisa: NPR(30000),
      depositRefundedPaisa: 0,
    });

    expect(balance).toEqual({
      billedPaisa: NPR(30000),
      paidPaisa: NPR(25000),
      outstandingPaisa: NPR(5000),
      creditPaisa: NPR(5000),
      depositHeldPaisa: NPR(30000),
    });
  });

  it('never uses the deposit to clear arrears', () => {
    // A tenant owing NPR 5,000 with a NPR 30,000 deposit still owes NPR 5,000.
    // Quietly consuming the deposit is what causes disputes.
    const balance = rentalBalance({
      periods: [{ totalPaisa: NPR(15000), paidPaisa: NPR(10000) }],
      rentPaymentsPaisa: NPR(10000),
      allocatedPaisa: NPR(10000),
      depositPaidPaisa: NPR(30000),
      depositRefundedPaisa: 0,
    });

    expect(balance.outstandingPaisa).toBe(NPR(5000));
    expect(balance.depositHeldPaisa).toBe(NPR(30000));
    expect(balance.creditPaisa).toBe(0);
  });

  it('reflects a refunded deposit', () => {
    const balance = rentalBalance({
      periods: [],
      rentPaymentsPaisa: 0,
      allocatedPaisa: 0,
      depositPaidPaisa: NPR(30000),
      depositRefundedPaisa: NPR(30000),
    });
    expect(balance.depositHeldPaisa).toBe(0);
  });

  it('fails loudly if the ledger is inconsistent', () => {
    // Allocating more than was ever paid means corruption. A plausible-looking
    // wrong number would be worse than an error (§74).
    expect(() =>
      rentalBalance({
        periods: [],
        rentPaymentsPaisa: NPR(1000),
        allocatedPaisa: NPR(2000),
        depositPaidPaisa: 0,
        depositRefundedPaisa: 0,
      }),
    ).toThrow(RangeError);

    expect(() =>
      rentalBalance({
        periods: [],
        rentPaymentsPaisa: 0,
        allocatedPaisa: 0,
        depositPaidPaisa: NPR(1000),
        depositRefundedPaisa: NPR(2000),
      }),
    ).toThrow(RangeError);
  });
});
