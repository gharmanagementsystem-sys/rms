import type { ChargeType, PaymentMethod, PaymentPurpose, PricingModel } from '../domain';

/**
 * Dashboard payloads. CLAUDE.md §24, §73.
 *
 * Shaped around the questions the screen must answer, not around the tables it
 * reads from. Anything that is merely interesting is left out: this is the
 * screen a landlord opens to decide what to do today.
 *
 * Both sections are returned, and either may be null. A user can legitimately
 * be both — subletting a room in a flat they rent is common in Nepal — so the
 * dashboard is not switched on a single role (§31).
 */

/** A rental needing attention, in the form the row renders. */
export interface AttentionRow {
  rentalId: string;
  periodId: string;
  /** Tenant name for an owner; landlord name for a renter. */
  counterpartyName: string | null;
  /** Unit label, or the free-text place for a renter-recorded rental. */
  placeLabel: string;
  balancePaisa: number;
  dueDate: string;
  /** Negative once past due. Drives "in 3 days" versus "5 days late". */
  daysUntilDue: number;
  isOverdue: boolean;
  /** False while a metered reading is outstanding — the total is not final. */
  chargesComplete: boolean;
}

export interface RentalCardCharge {
  chargeType: ChargeType;
  label: string | null;
  pricingModel: PricingModel;
  amountPaisa: number | null;
  ratePaisaPerUnit: number | null;
}

export interface RentalCardPayment {
  id: string;
  amountPaisa: number;
  paidOn: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
}

/**
 * One ACTIVE rental's headline figures, for a swipeable card (§24, §73).
 *
 * Every field is scoped to THIS rental alone — unlike the aggregate `money`
 * figures on `OwnerDashboard`, nothing here is summed across a user's other
 * rentals. That is what lets the client show an honest "your balance with
 * THIS landlord/tenant" on each card rather than a number that quietly
 * blends several relationships together.
 */
export interface RentalCardSummary {
  rentalId: string;
  /** Tenant name for an owner; landlord name for a renter. */
  counterpartyName: string | null;
  /** Unit label, or the free-text place for a renter-recorded rental. */
  placeLabel: string;
  /** 30 or 365 — fixed duration, snapshotted at creation (ADR 0001). */
  periodDays: number;
  outstandingPaisa: number;
  /** Paid ahead on this rental. Applied automatically to its next period. */
  creditPaisa: number;
  /** Refundable, and never used to settle rent. */
  depositHeldPaisa: number;
  /** Null once every period on this rental is settled. */
  nextDueDate: string | null;
  /** Negative once past due. Null alongside `nextDueDate`. */
  daysUntilDue: number | null;
  isOverdue: boolean;
  /** False while a metered reading is outstanding — the total is not final. */
  chargesComplete: boolean;
  /** What this rental's periods bill for (§61) — never a total without the
   *  lines behind it. */
  charges: RentalCardCharge[];
  /**
   * Newest first, capped per rental. The dashboard points at recent
   * activity; the full history lives on this rental's own detail screen.
   */
  recentPayments: RentalCardPayment[];
}

export interface OwnerDashboard {
  properties: { total: number };
  units: {
    total: number;
    /** Derived from active rentals, never a stored flag (§22). */
    occupied: number;
    available: number;
    unavailable: number;
  };
  rentals: { active: number };
  money: {
    /** Everything still owed across every rental, past and present. */
    pendingPaisa: number;
    /** The portion of `pendingPaisa` that is past its grace period. */
    overduePaisa: number;
    /** Received in the last 30 days. */
    collectedRecentPaisa: number;
  };
  /** Worst first. Capped — the dashboard points at problems, it does not list them all. */
  overdue: AttentionRow[];
  /** Soonest first. */
  dueSoon: AttentionRow[];
  /**
   * Every ACTIVE rental this owner has, oldest first — the browsable
   * complement to `overdue`/`dueSoon` above, which only ever surface
   * problems rather than the whole portfolio.
   */
  activeRentals: RentalCardSummary[];
}

export interface RenterDashboard {
  /**
   * Every ACTIVE rental this user rents, oldest first, across every
   * landlord. A renter with more than one of these is a real, supported
   * situation (not just a transition between tenancies), so the dashboard
   * never picks just one to lead with — every rental gets its own card.
   */
  activeRentals: RentalCardSummary[];
  /**
   * A rental this user created but has not started yet.
   *
   * Surfaced separately from `activeRentals` because it has no periods and
   * no balance to show as a card — it needs the "start this rental" action
   * instead. Null once it is started (it then appears in `activeRentals`)
   * or if there already is at least one active rental.
   */
  draftRental: {
    id: string;
    placeLabel: string;
    startDate: string;
    periodDays: number;
  } | null;
}

export interface DashboardResponse {
  /** The section to show first. Navigation only — never authorization (§31). */
  primaryRole: 'HOUSE_OWNER' | 'RENTER';
  owner: OwnerDashboard | null;
  renter: RenterDashboard | null;
  /** Business date the figures were computed for, in Nepal Standard Time. */
  asOf: string;
}
