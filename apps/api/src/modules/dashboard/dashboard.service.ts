import type {
  AttentionRow,
  DashboardResponse,
  OwnerDashboard,
  PaymentMethod,
  PaymentPurpose,
  RentalCardCharge,
  RentalCardPayment,
  RentalCardSummary,
  RenterDashboard,
} from '@rms/shared';
import { prisma } from '../../db/client';
import { addDays, daysBetween, fromDbDate, todayInNepal, toDbDate } from '../../lib/business-date';
import { resolvePlaceLabel } from '../../lib/rental-display';
import { paisaToNumber } from '../../lib/serialize';
import { ensurePeriods } from '../accounting/accounting.service';
import { balanceOf, isOverdue } from '../accounting/settlement';

/**
 * Dashboard aggregation. CLAUDE.md §24, §36.
 *
 * This is the screen opened most often, so it is built for speed: a fixed,
 * small number of queries regardless of how many properties or rentals a user
 * has. Every per-rental figure is computed by a single grouped SQL query
 * rather than one query per rental — there is no per-rental loop on the
 * application side.
 *
 * Where a business RULE is involved — what counts as overdue — the pure
 * accounting module decides, not SQL. Only plain arithmetic (`total - paid`,
 * counting rows) is expressed in the query, so there is no second definition of
 * a financial rule to drift.
 */

/** How many rows the attention lists carry. The dashboard points at problems
 *  rather than listing them all (§24). */
const ATTENTION_LIMIT = 5;

/** Window for "recently collected". */
const COLLECTED_WINDOW_DAYS = 30;

/** How far ahead "due soon" looks. */
const DUE_SOON_WINDOW_DAYS = 14;

/** Bounds the per-rental card list, the same way every other list here is bounded. */
const ACTIVE_RENTALS_LIMIT = 50;

/** Payments shown on each card — a pointer at recent activity, not the full
 *  history (that lives on the rental's own detail screen). */
const RECENT_PAYMENTS_PER_RENTAL = 5;

/**
 * Generates any missing periods for this user's rentals.
 *
 * The scheduled job normally does this at 00:15, so the common path finds
 * nothing to do and costs one query. The guard exists because a dashboard that
 * silently omits this month's rent — because a cron run was missed — is worse
 * than a slightly slower load (§16, self-healing on read).
 */
async function ensureUserPeriodsCurrent(userId: string, asOf: string): Promise<void> {
  const stale = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r.id
    FROM rentals r
    LEFT JOIN LATERAL (
      SELECT MAX(period_end) AS last_end
      FROM rental_periods
      WHERE rental_id = r.id
    ) p ON TRUE
    WHERE r.status = 'ACTIVE'
      AND (r.owner_user_id = ${userId} OR r.renter_user_id = ${userId})
      AND (p.last_end IS NULL OR p.last_end < ${toDbDate(asOf)}::date)
    LIMIT 200
  `;

  for (const rental of stale) {
    await ensurePeriods(rental.id, asOf);
  }
}

/**
 * Unsettled periods, with just enough context to render a row.
 *
 * Scoped to one party at a time (owner XOR renter) — an owner legitimately
 * wants arrears aggregated across every tenant they have ever had, and a
 * renter's own arrears are grouped per rental afterwards by the caller
 * (`buildRentalCards`), so neither side needs this scoped any further.
 */
async function loadAttentionRows(
  where: { ownerUserId?: string; renterUserId?: string },
  asOf: string,
): Promise<AttentionRow[]> {
  const periods = await prisma.rentalPeriod.findMany({
    where: {
      settlementStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      rental: { ...where, status: { in: ['ACTIVE', 'ENDED'] } },
    },
    include: {
      rental: {
        select: {
          id: true,
          counterpartyName: true,
          placeLabel: true,
          overdueAfterDays: true,
          unit: { select: { label: true } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    // Bounded so one landlord with hundreds of arrears cannot make the
    // dashboard slow for everyone.
    take: 200,
  });

  return periods
    .map((period): AttentionRow => {
      const balancePaisa = balanceOf(
        paisaToNumber(period.totalAmountPaisa),
        paisaToNumber(period.paidAmountPaisa),
      );
      const dueDate = fromDbDate(period.dueDate);

      return {
        rentalId: period.rental.id,
        periodId: period.id,
        counterpartyName: period.rental.counterpartyName,
        placeLabel: resolvePlaceLabel(period.rental, '—'),
        balancePaisa,
        dueDate,
        daysUntilDue: daysBetween(asOf, dueDate),
        // The rule lives in the pure module, so the dashboard and the period
        // screen can never disagree about what "overdue" means.
        isOverdue: isOverdue({
          balancePaisa,
          dueDate,
          overdueAfterDays: period.rental.overdueAfterDays,
          asOf,
        }),
        chargesComplete: period.chargesComplete,
      };
    })
    .filter((row) => row.balancePaisa > 0);
}

/** One row of the per-rental money query shared by both dashboards below. */
interface RentalMoneyRow {
  rental_id: string;
  counterparty_name: string | null;
  place_label: string;
  period_days: number;
  outstanding: bigint;
  rent_paid: bigint;
  allocated: bigint;
  deposit: bigint;
  refunded: bigint;
}

/**
 * Every ACTIVE rental on one side of a party, with each one's own balance —
 * never summed across rentals, unlike `OwnerDashboard.money` (§3.2).
 */
async function loadActiveRentalMoney(
  party: { ownerUserId: string } | { renterUserId: string },
): Promise<RentalMoneyRow[]> {
  return 'ownerUserId' in party
    ? prisma.$queryRaw<RentalMoneyRow[]>`
        SELECT
          r.id AS rental_id,
          r.counterparty_name AS counterparty_name,
          COALESCE(u.label, r.place_label, '—') AS place_label,
          r.period_days AS period_days,
          COALESCE((
            SELECT SUM(rp.total_amount_paisa - rp.paid_amount_paisa)
            FROM rental_periods rp
            WHERE rp.rental_id = r.id AND rp.total_amount_paisa > rp.paid_amount_paisa
          ), 0)::bigint AS outstanding,
          COALESCE((
            SELECT SUM(amount_paisa) FROM payments
            WHERE rental_id = r.id AND status = 'POSTED' AND purpose = 'RENT'
          ), 0)::bigint AS rent_paid,
          COALESCE((
            SELECT SUM(pa.amount_paisa)
            FROM payment_allocations pa
            JOIN payments p ON p.id = pa.payment_id
            WHERE p.rental_id = r.id AND p.status = 'POSTED'
          ), 0)::bigint AS allocated,
          COALESCE((
            SELECT SUM(amount_paisa) FROM payments
            WHERE rental_id = r.id AND status = 'POSTED' AND purpose = 'SECURITY_DEPOSIT'
          ), 0)::bigint AS deposit,
          COALESCE((
            SELECT SUM(amount_paisa) FROM payments
            WHERE rental_id = r.id AND status = 'POSTED' AND purpose = 'DEPOSIT_REFUND'
          ), 0)::bigint AS refunded
        FROM rentals r
        LEFT JOIN units u ON u.id = r.unit_id
        WHERE r.owner_user_id = ${party.ownerUserId} AND r.status = 'ACTIVE'
        ORDER BY r.created_at ASC
        LIMIT ${ACTIVE_RENTALS_LIMIT}
      `
    : prisma.$queryRaw<RentalMoneyRow[]>`
        SELECT
          r.id AS rental_id,
          r.counterparty_name AS counterparty_name,
          COALESCE(u.label, r.place_label, '—') AS place_label,
          r.period_days AS period_days,
          COALESCE((
            SELECT SUM(rp.total_amount_paisa - rp.paid_amount_paisa)
            FROM rental_periods rp
            WHERE rp.rental_id = r.id AND rp.total_amount_paisa > rp.paid_amount_paisa
          ), 0)::bigint AS outstanding,
          COALESCE((
            SELECT SUM(amount_paisa) FROM payments
            WHERE rental_id = r.id AND status = 'POSTED' AND purpose = 'RENT'
          ), 0)::bigint AS rent_paid,
          COALESCE((
            SELECT SUM(pa.amount_paisa)
            FROM payment_allocations pa
            JOIN payments p ON p.id = pa.payment_id
            WHERE p.rental_id = r.id AND p.status = 'POSTED'
          ), 0)::bigint AS allocated,
          COALESCE((
            SELECT SUM(amount_paisa) FROM payments
            WHERE rental_id = r.id AND status = 'POSTED' AND purpose = 'SECURITY_DEPOSIT'
          ), 0)::bigint AS deposit,
          COALESCE((
            SELECT SUM(amount_paisa) FROM payments
            WHERE rental_id = r.id AND status = 'POSTED' AND purpose = 'DEPOSIT_REFUND'
          ), 0)::bigint AS refunded
        FROM rentals r
        LEFT JOIN units u ON u.id = r.unit_id
        WHERE r.renter_user_id = ${party.renterUserId} AND r.status = 'ACTIVE'
        ORDER BY r.created_at ASC
        LIMIT ${ACTIVE_RENTALS_LIMIT}
      `;
}

/**
 * Every active charge for a set of rentals, grouped by rental — one query
 * regardless of how many rentals are asked for, never one query each (§36).
 */
async function loadChargesByRental(rentalIds: string[]): Promise<Map<string, RentalCardCharge[]>> {
  const map = new Map<string, RentalCardCharge[]>();
  if (rentalIds.length === 0) return map;

  const charges = await prisma.rentalCharge.findMany({
    where: { rentalId: { in: rentalIds }, isActive: true },
    orderBy: { chargeType: 'asc' },
    select: {
      rentalId: true,
      chargeType: true,
      label: true,
      pricingModel: true,
      amountPaisa: true,
      ratePaisaPerUnit: true,
    },
  });

  for (const charge of charges) {
    const list = map.get(charge.rentalId) ?? [];
    list.push({
      chargeType: charge.chargeType,
      label: charge.label,
      pricingModel: charge.pricingModel,
      amountPaisa: charge.amountPaisa === null ? null : paisaToNumber(charge.amountPaisa),
      ratePaisaPerUnit:
        charge.ratePaisaPerUnit === null ? null : paisaToNumber(charge.ratePaisaPerUnit),
    });
    map.set(charge.rentalId, list);
  }
  return map;
}

interface RankedPaymentRow {
  rental_id: string;
  id: string;
  amount_paisa: bigint;
  paid_on: Date;
  method: PaymentMethod;
  purpose: PaymentPurpose;
}

/**
 * The most recent payments for a set of rentals, grouped by rental and capped
 * per rental at `RECENT_PAYMENTS_PER_RENTAL`.
 *
 * A plain `findMany` with a global `take` would return the top payments
 * OVERALL, starving every rental but the most recently paid one — a window
 * function ranks payments WITHIN each rental instead, so this stays one query
 * regardless of how many rentals are asked for (§36).
 */
async function loadRecentPaymentsByRental(
  rentalIds: string[],
): Promise<Map<string, RentalCardPayment[]>> {
  const map = new Map<string, RentalCardPayment[]>();
  if (rentalIds.length === 0) return map;

  const rows = await prisma.$queryRaw<RankedPaymentRow[]>`
    SELECT id, rental_id, amount_paisa, paid_on, method, purpose
    FROM (
      SELECT
        p.id, p.rental_id, p.amount_paisa, p.paid_on, p.method, p.purpose,
        ROW_NUMBER() OVER (
          PARTITION BY p.rental_id
          ORDER BY p.paid_on DESC, p.created_at DESC
        ) AS rn
      FROM payments p
      WHERE p.rental_id = ANY(${rentalIds}::text[]) AND p.status = 'POSTED'
    ) ranked
    WHERE rn <= ${RECENT_PAYMENTS_PER_RENTAL}
    -- \`rn\` already reflects the desired newest-first order within each
    -- rental (the window function above resolved same-day ties via
    -- created_at); ordering by it here avoids referencing a column that was
    -- never selected into this outer query.
    ORDER BY rental_id, rn
  `;

  for (const row of rows) {
    const list = map.get(row.rental_id) ?? [];
    list.push({
      id: row.id,
      amountPaisa: paisaToNumber(row.amount_paisa),
      paidOn: fromDbDate(row.paid_on),
      method: row.method,
      purpose: row.purpose,
    });
    map.set(row.rental_id, list);
  }
  return map;
}

/**
 * Joins the money rows with each rental's soonest unsettled period, its
 * charges, and its recent payments — all fetched once for the whole party
 * beforehand (§36), so this is a cheap grouping pass rather than a query per
 * rental.
 */
function buildRentalCards(
  moneyRows: RentalMoneyRow[],
  attention: AttentionRow[],
  chargesByRental: Map<string, RentalCardCharge[]>,
  paymentsByRental: Map<string, RentalCardPayment[]>,
): RentalCardSummary[] {
  return moneyRows.map((row): RentalCardSummary => {
    // `attention` is ordered soonest-due first, so the first match per rental
    // is its next due period.
    const nextDue = attention.find((candidate) => candidate.rentalId === row.rental_id) ?? null;

    return {
      rentalId: row.rental_id,
      counterpartyName: row.counterparty_name,
      placeLabel: row.place_label,
      periodDays: row.period_days,
      outstandingPaisa: paisaToNumber(row.outstanding),
      creditPaisa: paisaToNumber(row.rent_paid) - paisaToNumber(row.allocated),
      depositHeldPaisa: paisaToNumber(row.deposit) - paisaToNumber(row.refunded),
      nextDueDate: nextDue?.dueDate ?? null,
      daysUntilDue: nextDue?.daysUntilDue ?? null,
      isOverdue: nextDue?.isOverdue ?? false,
      chargesComplete: nextDue?.chargesComplete ?? true,
      charges: chargesByRental.get(row.rental_id) ?? [],
      recentPayments: paymentsByRental.get(row.rental_id) ?? [],
    };
  });
}

async function buildOwnerDashboard(userId: string, asOf: string): Promise<OwnerDashboard | null> {
  const propertyCount = await prisma.property.count({
    where: { ownerUserId: userId, archivedAt: null },
  });

  // A user with no properties is not an owner as far as this screen is
  // concerned, so the section is omitted rather than shown full of zeroes.
  if (propertyCount === 0) return null;

  const [unitStats, money, rentalCount, attention, activeRentalMoney] = await Promise.all([
    // One query for every unit figure. Occupancy is derived from active
    // rentals, so it cannot disagree with reality (§22).
    prisma.$queryRaw<{ total: number; occupied: number; available: number; unavailable: number }[]>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE occ.n > 0)::int AS occupied,
        COUNT(*) FILTER (WHERE occ.n = 0 AND u.availability = 'AVAILABLE')::int AS available,
        COUNT(*) FILTER (WHERE occ.n = 0 AND u.availability <> 'AVAILABLE')::int AS unavailable
      FROM units u
      JOIN properties p ON p.id = u.property_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS n FROM rentals r
        WHERE r.unit_id = u.id AND r.status = 'ACTIVE'
      ) occ ON TRUE
      WHERE p.owner_user_id = ${userId}
        AND p.archived_at IS NULL
        AND u.archived_at IS NULL
    `,

    prisma.$queryRaw<{ pending: bigint; collected: bigint }[]>`
      SELECT
        COALESCE((
          SELECT SUM(rp.total_amount_paisa - rp.paid_amount_paisa)
          FROM rental_periods rp
          JOIN rentals r ON r.id = rp.rental_id
          WHERE r.owner_user_id = ${userId}
            AND rp.total_amount_paisa > rp.paid_amount_paisa
        ), 0)::bigint AS pending,
        COALESCE((
          SELECT SUM(pay.amount_paisa)
          FROM payments pay
          JOIN rentals r2 ON r2.id = pay.rental_id
          WHERE r2.owner_user_id = ${userId}
            AND pay.status = 'POSTED'
            AND pay.purpose = 'RENT'
            AND pay.paid_on >= ${toDbDate(addDays(asOf, -COLLECTED_WINDOW_DAYS))}::date
        ), 0)::bigint AS collected
    `,

    prisma.rental.count({ where: { ownerUserId: userId, status: 'ACTIVE' } }),
    loadAttentionRows({ ownerUserId: userId }, asOf),
    loadActiveRentalMoney({ ownerUserId: userId }),
  ]);

  const units = unitStats[0] ?? { total: 0, occupied: 0, available: 0, unavailable: 0 };
  const totals = money[0] ?? { pending: 0n, collected: 0n };

  const overdue = attention.filter((row) => row.isOverdue);
  const dueSoon = attention.filter(
    (row) => !row.isOverdue && row.daysUntilDue <= DUE_SOON_WINDOW_DAYS,
  );

  const activeRentalIds = activeRentalMoney.map((row) => row.rental_id);
  const [chargesByRental, paymentsByRental] = await Promise.all([
    loadChargesByRental(activeRentalIds),
    loadRecentPaymentsByRental(activeRentalIds),
  ]);

  return {
    properties: { total: propertyCount },
    units,
    rentals: { active: rentalCount },
    money: {
      pendingPaisa: paisaToNumber(totals.pending),
      overduePaisa: overdue.reduce((sum, row) => sum + row.balancePaisa, 0),
      collectedRecentPaisa: paisaToNumber(totals.collected),
    },
    // Worst first: the largest arrears are what a landlord acts on.
    overdue: [...overdue].sort((a, b) => a.daysUntilDue - b.daysUntilDue).slice(0, ATTENTION_LIMIT),
    dueSoon: dueSoon.slice(0, ATTENTION_LIMIT),
    activeRentals: buildRentalCards(activeRentalMoney, attention, chargesByRental, paymentsByRental),
  };
}

async function buildRenterDashboard(userId: string, asOf: string): Promise<RenterDashboard | null> {
  const [activeRentalMoney, attention, draft] = await Promise.all([
    loadActiveRentalMoney({ renterUserId: userId }),
    loadAttentionRows({ renterUserId: userId }, asOf),
    // Held separately from `activeRentalMoney`: a draft has no periods and no
    // balance, so it cannot be priced the way an active rental's card is.
    prisma.rental.findFirst({
      where: { renterUserId: userId, status: 'DRAFT' },
      select: {
        id: true,
        placeLabel: true,
        startDate: true,
        periodDays: true,
        unit: { select: { label: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Nothing to show at all — neither an active tenancy nor one waiting to start.
  if (activeRentalMoney.length === 0 && !draft) return null;

  const activeRentalIds = activeRentalMoney.map((row) => row.rental_id);
  const [chargesByRental, paymentsByRental] = await Promise.all([
    loadChargesByRental(activeRentalIds),
    loadRecentPaymentsByRental(activeRentalIds),
  ]);

  return {
    activeRentals: buildRentalCards(activeRentalMoney, attention, chargesByRental, paymentsByRental),
    draftRental: draft
      ? {
          id: draft.id,
          placeLabel: resolvePlaceLabel(draft, '—'),
          startDate: fromDbDate(draft.startDate),
          periodDays: draft.periodDays,
        }
      : null,
  };
}

export async function getDashboard(
  userId: string,
  primaryRole: 'HOUSE_OWNER' | 'RENTER',
): Promise<DashboardResponse> {
  const asOf = todayInNepal();

  await ensureUserPeriodsCurrent(userId, asOf);

  // Both sections are built: a user may be both a landlord and a tenant, and
  // the role only decides which is shown first.
  const [owner, renter] = await Promise.all([
    buildOwnerDashboard(userId, asOf),
    buildRenterDashboard(userId, asOf),
  ]);

  return { primaryRole, owner, renter, asOf };
}
