-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('HOUSE_OWNER', 'RENTER');

-- CreateEnum
CREATE TYPE "discovery_source" AS ENUM ('FRIEND_OR_FAMILY', 'SOCIAL_MEDIA', 'SEARCH_ENGINE', 'APP_STORE', 'ADVERTISEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "unit_type" AS ENUM ('FLAT', 'ROOM', 'SHOP', 'HOUSE');

-- CreateEnum
CREATE TYPE "unit_availability" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "rental_status" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "rent_frequency" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "mid_period_end_policy" AS ENUM ('PRORATE', 'FULL_PERIOD');

-- CreateEnum
CREATE TYPE "charge_type" AS ENUM ('RENT', 'ELECTRICITY', 'WATER', 'INTERNET', 'WASTE', 'CLEANING', 'OTHER');

-- CreateEnum
CREATE TYPE "pricing_model" AS ENUM ('FIXED', 'PER_UNIT');

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "photo_url" TEXT,
    "primary_role" "user_role" NOT NULL,
    "province" TEXT,
    "district" TEXT,
    "municipality" TEXT,
    "ward" INTEGER,
    "address_line" TEXT,
    "landmark" TEXT,
    "discovery_source" "discovery_source",
    "onboarding_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "rent_reminder_days" INTEGER[] DEFAULT ARRAY[7, 1, 0]::INTEGER[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT,
    "district" TEXT,
    "municipality" TEXT,
    "ward" INTEGER,
    "address_line" TEXT,
    "landmark" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "parent_unit_id" TEXT,
    "label" TEXT NOT NULL,
    "type" "unit_type" NOT NULL,
    "floor" TEXT,
    "availability" "unit_availability" NOT NULL DEFAULT 'AVAILABLE',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentals" (
    "id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "renter_user_id" TEXT,
    "unit_id" TEXT,
    "counterparty_name" TEXT,
    "counterparty_phone" TEXT,
    "place_label" TEXT,
    "place_address" TEXT,
    "frequency" "rent_frequency" NOT NULL,
    "period_days" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "due_offset_days" INTEGER NOT NULL DEFAULT 0,
    "overdue_after_days" INTEGER NOT NULL DEFAULT 5,
    "mid_period_end_policy" "mid_period_end_policy" NOT NULL DEFAULT 'PRORATE',
    "security_deposit_paisa" BIGINT,
    "status" "rental_status" NOT NULL DEFAULT 'DRAFT',
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_user_id" TEXT,
    "ended_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_charges" (
    "id" TEXT NOT NULL,
    "rental_id" TEXT NOT NULL,
    "charge_type" "charge_type" NOT NULL,
    "label" TEXT,
    "pricing_model" "pricing_model" NOT NULL,
    "amount_paisa" BIGINT,
    "rate_paisa_per_unit" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rental_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_phone_key" ON "profiles"("phone");

-- CreateIndex
CREATE INDEX "profiles_primary_role_idx" ON "profiles"("primary_role");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "properties_owner_user_id_archived_at_idx" ON "properties"("owner_user_id", "archived_at");

-- CreateIndex
CREATE INDEX "units_property_id_archived_at_idx" ON "units"("property_id", "archived_at");

-- CreateIndex
CREATE INDEX "units_parent_unit_id_idx" ON "units"("parent_unit_id");

-- CreateIndex
CREATE INDEX "rentals_owner_user_id_status_idx" ON "rentals"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "rentals_renter_user_id_status_idx" ON "rentals"("renter_user_id", "status");

-- CreateIndex
CREATE INDEX "rentals_unit_id_status_idx" ON "rentals"("unit_id", "status");

-- CreateIndex
CREATE INDEX "rental_charges_rental_id_is_active_idx" ON "rental_charges"("rental_id", "is_active");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_parent_unit_id_fkey" FOREIGN KEY ("parent_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_renter_user_id_fkey" FOREIGN KEY ("renter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_charges" ADD CONSTRAINT "rental_charges_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express in schema.prisma.
--
-- These are enforced in the DATABASE, not only in the service layer, because a
-- bug or a concurrent request must not be able to produce impossible financial
-- state (CLAUDE.md §33).
-- ---------------------------------------------------------------------------

-- A unit can have at most ONE active rental. This is what makes derived
-- occupancy trustworthy (§22): with this index, "occupied" is simply "an active
-- rental exists", and double-letting a room is impossible rather than unlikely.
CREATE UNIQUE INDEX "rentals_one_active_per_unit"
  ON "rentals" ("unit_id")
  WHERE "status" = 'ACTIVE' AND "unit_id" IS NOT NULL;

-- A rental must have at least one side attached, or it belongs to nobody and
-- can never be authorised against (§58).
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_has_a_party"
  CHECK ("owner_user_id" IS NOT NULL OR "renter_user_id" IS NOT NULL);

-- Period boundaries must be coherent.
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_end_after_start"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- Fixed-duration periods: 30 for MONTHLY, 365 for YEARLY (ADR 0001). Guarded
-- rather than assumed, because a zero or negative value would make period
-- generation loop forever.
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_period_days_positive"
  CHECK ("period_days" > 0);

-- Rent cannot fall due after the period it belongs to has ended.
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_due_offset_within_period"
  CHECK ("due_offset_days" >= 0 AND "due_offset_days" < "period_days");

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_overdue_after_days_non_negative"
  CHECK ("overdue_after_days" >= 0);

-- Money is never negative. Sign is carried by transaction type, never by the
-- amount (§3.2).
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_deposit_non_negative"
  CHECK ("security_deposit_paisa" IS NULL OR "security_deposit_paisa" >= 0);

-- A charge is either a flat amount or a per-unit rate — never both, never
-- neither. Without this, a charge row can exist that no calculation can price.
ALTER TABLE "rental_charges" ADD CONSTRAINT "rental_charges_pricing_shape"
  CHECK (
    ("pricing_model" = 'FIXED'
      AND "amount_paisa" IS NOT NULL AND "amount_paisa" >= 0
      AND "rate_paisa_per_unit" IS NULL)
    OR
    ("pricing_model" = 'PER_UNIT'
      AND "rate_paisa_per_unit" IS NOT NULL AND "rate_paisa_per_unit" >= 0
      AND "amount_paisa" IS NULL)
  );

-- OTHER may repeat on a rental (an owner can add several miscellaneous
-- charges); every other type may appear at most once.
CREATE UNIQUE INDEX "rental_charges_one_per_type"
  ON "rental_charges" ("rental_id", "charge_type")
  WHERE "charge_type" <> 'OTHER';

-- A repeating OTHER charge must be distinguishable to the user.
ALTER TABLE "rental_charges" ADD CONSTRAINT "rental_charges_other_needs_label"
  CHECK ("charge_type" <> 'OTHER' OR ("label" IS NOT NULL AND length(trim("label")) > 0));

-- Nepal ward numbers are positive. No upper bound asserted, because the number
-- of wards varies by municipality and local-government restructuring changes it.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_ward_positive"
  CHECK ("ward" IS NULL OR "ward" > 0);

ALTER TABLE "properties" ADD CONSTRAINT "properties_ward_positive"
  CHECK ("ward" IS NULL OR "ward" > 0);
