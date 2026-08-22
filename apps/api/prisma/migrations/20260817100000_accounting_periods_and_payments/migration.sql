-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "payment_purpose" AS ENUM ('RENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "rental_periods" (
    "id" TEXT NOT NULL,
    "rental_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "covered_days" INTEGER NOT NULL,
    "basis_days" INTEGER NOT NULL,
    "is_prorated" BOOLEAN NOT NULL DEFAULT false,
    "total_amount_paisa" BIGINT NOT NULL DEFAULT 0,
    "paid_amount_paisa" BIGINT NOT NULL DEFAULT 0,
    "charges_complete" BOOLEAN NOT NULL DEFAULT true,
    "settlement_status" "settlement_status" NOT NULL DEFAULT 'UNPAID',
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rental_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_charges" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "charge_type" "charge_type" NOT NULL,
    "label" TEXT,
    "pricing_model" "pricing_model" NOT NULL,
    "amount_paisa" BIGINT NOT NULL DEFAULT 0,
    "rate_paisa_per_unit" BIGINT,
    "previous_reading" INTEGER,
    "current_reading" INTEGER,
    "consumed_units" INTEGER,
    "is_finalized" BOOLEAN NOT NULL DEFAULT true,
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "period_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "rental_id" TEXT NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "purpose" "payment_purpose" NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'POSTED',
    "reverses_payment_id" TEXT,
    "reversed_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_periods_settlement_status_due_date_idx" ON "rental_periods"("settlement_status", "due_date");

-- CreateIndex
CREATE INDEX "rental_periods_rental_id_sequence_number_idx" ON "rental_periods"("rental_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "rental_periods_rental_id_sequence_number_key" ON "rental_periods"("rental_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "rental_periods_rental_id_period_start_key" ON "rental_periods"("rental_id", "period_start");

-- CreateIndex
CREATE INDEX "period_charges_period_id_idx" ON "period_charges"("period_id");

-- CreateIndex
CREATE INDEX "payments_rental_id_paid_on_idx" ON "payments"("rental_id", "paid_on");

-- CreateIndex
CREATE INDEX "payments_rental_id_purpose_status_idx" ON "payments"("rental_id", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_recorded_by_user_id_idempotency_key_key" ON "payments"("recorded_by_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_allocations_period_id_idx" ON "payment_allocations"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_period_id_key" ON "payment_allocations"("payment_id", "period_id");

-- AddForeignKey
ALTER TABLE "rental_periods" ADD CONSTRAINT "rental_periods_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_charges" ADD CONSTRAINT "period_charges_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "rental_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "rental_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Accounting invariants (CLAUDE.md §33, §15).
--
-- Enforced in the DATABASE so that no bug, race, or future code path can
-- produce impossible financial state.
-- ---------------------------------------------------------------------------

-- Explicit inclusive boundaries must be coherent, and rent cannot fall due
-- outside the period it belongs to.
ALTER TABLE "rental_periods" ADD CONSTRAINT "rental_periods_boundaries"
  CHECK ("period_end" >= "period_start"
     AND "due_date" >= "period_start"
     AND "due_date" <= "period_end");

-- Proration must be a real fraction of a real period.
ALTER TABLE "rental_periods" ADD CONSTRAINT "rental_periods_proration_sane"
  CHECK ("basis_days" > 0 AND "covered_days" > 0 AND "covered_days" <= "basis_days");

-- Money is never negative; sign is carried by the transaction, not the amount.
ALTER TABLE "rental_periods" ADD CONSTRAINT "rental_periods_amounts_non_negative"
  CHECK ("total_amount_paisa" >= 0 AND "paid_amount_paisa" >= 0);

ALTER TABLE "period_charges" ADD CONSTRAINT "period_charges_amounts_non_negative"
  CHECK ("amount_paisa" >= 0
     AND ("rate_paisa_per_unit" IS NULL OR "rate_paisa_per_unit" >= 0));

-- A meter cannot run backwards, and consumption must equal the difference of
-- the two readings — so a stored amount can always be re-derived and checked.
ALTER TABLE "period_charges" ADD CONSTRAINT "period_charges_readings_coherent"
  CHECK (
    ("previous_reading" IS NULL AND "current_reading" IS NULL AND "consumed_units" IS NULL)
    OR (
      "previous_reading" >= 0
      AND "current_reading" >= "previous_reading"
      AND "consumed_units" = "current_reading" - "previous_reading"
    )
  );

-- A metered charge is only finalized once it has been read.
ALTER TABLE "period_charges" ADD CONSTRAINT "period_charges_metered_needs_reading"
  CHECK ("pricing_model" <> 'PER_UNIT' OR "is_finalized" = false OR "current_reading" IS NOT NULL);

-- One charge of each type per period, except OTHER which may repeat.
CREATE UNIQUE INDEX "period_charges_one_per_type"
  ON "period_charges" ("period_id", "charge_type")
  WHERE "charge_type" <> 'OTHER';

-- A payment of zero moves no money and would only add noise to the ledger.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive"
  CHECK ("amount_paisa" > 0);

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive"
  CHECK ("amount_paisa" > 0);
