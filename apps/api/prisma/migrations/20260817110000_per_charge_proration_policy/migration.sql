-- CreateEnum
CREATE TYPE "charge_proration_policy" AS ENUM ('PRORATE', 'FULL');

-- AlterTable
ALTER TABLE "period_charges" ADD COLUMN     "proration_policy" "charge_proration_policy";

-- AlterTable
ALTER TABLE "rental_charges" ADD COLUMN     "proration_policy" "charge_proration_policy";


-- Backfill: existing FIXED charges keep the previous behaviour, which was to
-- prorate unconditionally. Metered charges stay NULL, since usage is already
-- the measure of what was consumed.
UPDATE "rental_charges" SET "proration_policy" = 'PRORATE' WHERE "pricing_model" = 'FIXED';
UPDATE "period_charges"  SET "proration_policy" = 'PRORATE' WHERE "pricing_model" = 'FIXED';

-- A FIXED charge must state its policy; a metered charge must not have one.
-- This makes "electricity is never prorated" a property of the schema rather
-- than a convention someone has to remember.
ALTER TABLE "rental_charges" ADD CONSTRAINT "rental_charges_proration_policy_shape"
  CHECK (
    ("pricing_model" = 'FIXED' AND "proration_policy" IS NOT NULL)
    OR ("pricing_model" = 'PER_UNIT' AND "proration_policy" IS NULL)
  );

ALTER TABLE "period_charges" ADD CONSTRAINT "period_charges_proration_policy_shape"
  CHECK (
    ("pricing_model" = 'FIXED' AND "proration_policy" IS NOT NULL)
    OR ("pricing_model" = 'PER_UNIT' AND "proration_policy" IS NULL)
  );