/**
 * Demo data for local development.
 *
 * Creates a landlord and a tenant with realistic, deliberately messy data — an
 * overdue tenant, one paying on time, a partial payment, an unread electricity
 * meter — so every dashboard state is visible without hand-entering anything.
 *
 *   npm run db:seed   -w @rms/api
 *   npm run db:unseed -w @rms/api
 *
 * Accounts are created through Better Auth so passwords are hashed exactly as a
 * real sign-up would be, and email verification is set directly because there is
 * no inbox to click in.
 *
 * Every record uses the @demo.rms.local domain, which is what `db:unseed`
 * matches. Refuses to run in production.
 */
import { randomUUID } from 'node:crypto';
import { auth } from '../auth/better-auth';
import { env } from '../config/env';
import { addDays, todayInNepal, toDbDate } from '../lib/business-date';
import { activateRental, createRental } from '../modules/rentals/rentals.service';
import { createProperty } from '../modules/properties/properties.service';
import { createUnit } from '../modules/units/units.service';
import { recordPayment } from '../modules/accounting/accounting.service';
import { completeOnboarding } from '../modules/users/users.service';
import { logger } from '../services/logger';
import { closeDatabase, prisma } from './client';

const DEMO_DOMAIN = '@demo.rms.local';
const DEMO_PASSWORD = 'demo-Password-2026!';
const NPR = (rupees: number) => Math.round(rupees * 100);

if (env.isProduction) {
  throw new Error('Refusing to seed demo data in production.');
}

async function createVerifiedUser(email: string, name: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing.id;

  // Through Better Auth, so the password hash matches a real sign-up.
  await auth.api.signUpEmail({ body: { email, password: DEMO_PASSWORD, name } });

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  // No inbox to click in, so verification is set directly.
  await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  return user.id;
}

async function seed(): Promise<void> {
  const today = todayInNepal();
  const ownerEmail = `owner${DEMO_DOMAIN}`;
  const renterEmail = `renter${DEMO_DOMAIN}`;

  // ---- Landlord -----------------------------------------------------------
  const ownerId = await createVerifiedUser(ownerEmail, 'Ram Bahadur Thapa');
  await completeOnboarding(ownerId, {
    fullName: 'Ram Bahadur Thapa',
    primaryRole: 'HOUSE_OWNER',
    language: 'en',
    theme: 'system',
    dateFormat: 'BS',
    notificationsEnabled: true,
    district: 'Kathmandu',
    municipality: 'Kathmandu Metropolitan City',
    ward: 4,
  });

  const actor = { userId: ownerId, requestId: 'seed' };
  const property = await createProperty(actor, {
    name: 'Baluwatar Apartments',
    district: 'Kathmandu',
    municipality: 'Kathmandu Metropolitan City',
    ward: 4,
    addressLine: 'Baluwatar Marg 12',
  });

  const flatA = await createUnit(actor, property.id, { label: 'Flat A', type: 'FLAT' });
  const flatB = await createUnit(actor, property.id, { label: 'Flat B', type: 'FLAT' });
  const room1 = await createUnit(actor, property.id, { label: 'Room 1', type: 'ROOM' });
  // Left empty on purpose so "available" is not zero.
  await createUnit(actor, property.id, { label: 'Room 2', type: 'ROOM' });

  // Tenant 1 — two months in, nothing paid. Shows as overdue.
  const overdueRental = await createRental(actor, {
    side: 'OWNER',
    unitId: flatA.id,
    counterpartyName: 'Sita Shrestha',
    counterpartyPhone: '9801234567',
    frequency: 'MONTHLY',
    startDate: addDays(today, -70),
    dueOffsetDays: 0,
    overdueAfterDays: 5,
    midPeriodEndPolicy: 'PRORATE',
    securityDepositPaisa: NPR(30000),
    charges: [
      {
        chargeType: 'RENT',
        pricingModel: 'FIXED',
        amountPaisa: NPR(15000),
        prorationPolicy: 'PRORATE',
      },
      {
        chargeType: 'WATER',
        pricingModel: 'FIXED',
        amountPaisa: NPR(500),
        prorationPolicy: 'PRORATE',
      },
      {
        chargeType: 'INTERNET',
        pricingModel: 'FIXED',
        amountPaisa: NPR(1200),
        prorationPolicy: 'FULL',
      },
      { chargeType: 'ELECTRICITY', pricingModel: 'PER_UNIT', ratePaisaPerUnit: NPR(15) },
    ],
  });
  await activateRental(actor, overdueRental.id);

  // Tenant 2 — one month in, paid most of it. Shows as partially paid.
  const partialRental = await createRental(actor, {
    side: 'OWNER',
    unitId: flatB.id,
    counterpartyName: 'Hari Gurung',
    counterpartyPhone: '9847654321',
    frequency: 'MONTHLY',
    startDate: addDays(today, -35),
    dueOffsetDays: 0,
    overdueAfterDays: 5,
    midPeriodEndPolicy: 'PRORATE',
    charges: [
      {
        chargeType: 'RENT',
        pricingModel: 'FIXED',
        amountPaisa: NPR(22000),
        prorationPolicy: 'PRORATE',
      },
      {
        chargeType: 'CLEANING',
        pricingModel: 'FIXED',
        amountPaisa: NPR(800),
        prorationPolicy: 'PRORATE',
      },
    ],
  });
  await activateRental(actor, partialRental.id);
  await recordPayment({
    rentalId: partialRental.id,
    recordedByUserId: ownerId,
    purpose: 'RENT',
    amountPaisa: NPR(30000),
    paidOn: addDays(today, -30),
    method: 'MOBILE_WALLET',
    reference: 'eSewa demo',
    idempotencyKey: randomUUID(),
  });

  // Tenant 3 — starts today, so it lands in "due soon".
  const dueSoonRental = await createRental(actor, {
    side: 'OWNER',
    unitId: room1.id,
    counterpartyName: 'Maya Tamang',
    frequency: 'MONTHLY',
    startDate: today,
    dueOffsetDays: 0,
    overdueAfterDays: 5,
    midPeriodEndPolicy: 'PRORATE',
    charges: [
      {
        chargeType: 'RENT',
        pricingModel: 'FIXED',
        amountPaisa: NPR(9000),
        prorationPolicy: 'PRORATE',
      },
    ],
  });
  await activateRental(actor, dueSoonRental.id);

  // ---- Tenant -------------------------------------------------------------
  const renterId = await createVerifiedUser(renterEmail, 'Anjali Karki');
  await completeOnboarding(renterId, {
    fullName: 'Anjali Karki',
    primaryRole: 'RENTER',
    language: 'ne',
    theme: 'system',
    dateFormat: 'BS',
    notificationsEnabled: true,
    district: 'Lalitpur',
  });

  const renterActor = { userId: renterId, requestId: 'seed' };
  const myRental = await createRental(renterActor, {
    side: 'RENTER',
    placeLabel: 'Room near Patan Durbar',
    placeAddress: 'Mangal Bazar, Lalitpur',
    counterpartyName: 'Landlord Krishna',
    counterpartyPhone: '9812345678',
    frequency: 'MONTHLY',
    startDate: addDays(today, -40),
    dueOffsetDays: 0,
    overdueAfterDays: 5,
    midPeriodEndPolicy: 'PRORATE',
    securityDepositPaisa: NPR(20000),
    charges: [
      {
        chargeType: 'RENT',
        pricingModel: 'FIXED',
        amountPaisa: NPR(9000),
        prorationPolicy: 'PRORATE',
      },
      {
        chargeType: 'INTERNET',
        pricingModel: 'FIXED',
        amountPaisa: NPR(1000),
        prorationPolicy: 'FULL',
      },
      { chargeType: 'ELECTRICITY', pricingModel: 'PER_UNIT', ratePaisaPerUnit: NPR(15) },
    ],
  });
  await activateRental(renterActor, myRental.id);

  await recordPayment({
    rentalId: myRental.id,
    recordedByUserId: renterId,
    purpose: 'SECURITY_DEPOSIT',
    amountPaisa: NPR(20000),
    paidOn: addDays(today, -40),
    method: 'BANK_TRANSFER',
    idempotencyKey: randomUUID(),
  });
  await recordPayment({
    rentalId: myRental.id,
    recordedByUserId: renterId,
    purpose: 'RENT',
    amountPaisa: NPR(10000),
    paidOn: addDays(today, -38),
    method: 'CASH',
    idempotencyKey: randomUUID(),
  });

  logger.info(
    {
      owner: ownerEmail,
      renter: renterEmail,
      password: DEMO_PASSWORD,
    },
    'Demo data ready',
  );

  console.log('\n  Sign in with either account (password is the same):\n');
  console.log(`    Landlord  ${ownerEmail}`);
  console.log(`    Tenant    ${renterEmail}`);
  console.log(`    Password  ${DEMO_PASSWORD}\n`);
}

async function unseed(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_DOMAIN } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);

  if (ids.length > 0) {
    // Rentals reference users with SET NULL / RESTRICT, so they go first.
    await prisma.rental.deleteMany({
      where: {
        OR: [
          { ownerUserId: { in: ids } },
          { renterUserId: { in: ids } },
          { createdByUserId: { in: ids } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  console.log(`\n  Removed ${ids.length} demo account(s) and everything belonging to them.\n`);
}

const shouldUnseed = process.argv.includes('--clean');

try {
  // `toDbDate` is imported so the module's date handling is exercised here too.
  void toDbDate(todayInNepal());
  await (shouldUnseed ? unseed() : seed());
} catch (error) {
  logger.error({ err: error }, shouldUnseed ? 'Unseed failed' : 'Seed failed');
  await closeDatabase();
  process.exit(1);
}

await closeDatabase();
