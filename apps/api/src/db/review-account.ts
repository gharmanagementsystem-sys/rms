/**
 * Creates the store-review (Google Play) test account.
 *
 *   REVIEW_ACCOUNT_PASSWORD='...' npm run db:review-account -w @rms/api
 *   npm run db:review-account -w @rms/api -- --clean
 *
 * Unlike `db:seed` this is allowed to run against production, because the
 * reviewer signs in to the deployed app. It therefore touches exactly one
 * account (REVIEW_EMAIL) and refuses to overwrite it if it already exists.
 *
 * The account is created through Better Auth's internal adapter rather than
 * `signUpEmail`, so no verification email is sent to the dummy address, and it
 * is marked verified because `requireEmailVerification` would otherwise lock the
 * reviewer out. The password is read from the environment and never committed.
 */
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { auth } from '../auth/better-auth';
import { addDays, todayInNepal } from '../lib/business-date';
import { activateRental, createRental } from '../modules/rentals/rentals.service';
import { createProperty } from '../modules/properties/properties.service';
import { createUnit } from '../modules/units/units.service';
import { recordPayment } from '../modules/accounting/accounting.service';
import { completeOnboarding } from '../modules/users/users.service';
import { logger } from '../services/logger';
import { closeDatabase, prisma } from './client';

const REVIEW_EMAIL = 'play.reviewer@example.com';
const REVIEW_NAME = 'Play Reviewer';
const NPR = (rupees: number) => Math.round(rupees * 100);

async function create(): Promise<void> {
  const password = process.env.REVIEW_ACCOUNT_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error('Set REVIEW_ACCOUNT_PASSWORD (at least 10 characters).');
  }

  const existing = await prisma.user.findUnique({ where: { email: REVIEW_EMAIL } });
  if (existing) {
    throw new Error(`${REVIEW_EMAIL} already exists. Run with --clean first to recreate it.`);
  }

  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({
    email: REVIEW_EMAIL,
    name: REVIEW_NAME,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    // Better Auth's default hasher, called directly: `ctx.password.hash` is
    // wrapped by the haveIBeenPwned plugin, which needs a request context.
    password: await hashPassword(password),
  });

  await completeOnboarding(user.id, {
    fullName: REVIEW_NAME,
    primaryRole: 'HOUSE_OWNER',
    language: 'en',
    theme: 'system',
    dateFormat: 'BS',
    notificationsEnabled: true,
    district: 'Kathmandu',
    municipality: 'Kathmandu Metropolitan City',
    ward: 4,
  });

  // A little data so the reviewer does not land on empty screens.
  const today = todayInNepal();
  const actor = { userId: user.id, requestId: 'review-account' };
  const property = await createProperty(actor, {
    name: 'Sample Apartments',
    district: 'Kathmandu',
    municipality: 'Kathmandu Metropolitan City',
    ward: 4,
    addressLine: 'Sample Marg 1',
  });
  const flat = await createUnit(actor, property.id, { label: 'Flat A', type: 'FLAT' });
  await createUnit(actor, property.id, { label: 'Room 1', type: 'ROOM' });

  const rental = await createRental(actor, {
    side: 'OWNER',
    unitId: flat.id,
    counterpartyName: 'Sample Tenant',
    counterpartyPhone: '9801234567',
    frequency: 'MONTHLY',
    startDate: addDays(today, -35),
    dueOffsetDays: 0,
    overdueAfterDays: 5,
    midPeriodEndPolicy: 'PRORATE',
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
    ],
  });
  await activateRental(actor, rental.id);
  await recordPayment({
    rentalId: rental.id,
    recordedByUserId: user.id,
    purpose: 'RENT',
    amountPaisa: NPR(10000),
    paidOn: addDays(today, -30),
    method: 'CASH',
    idempotencyKey: randomUUID(),
  });

  console.log(`\n  Review account ready: ${REVIEW_EMAIL}\n`);
}

async function clean(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: REVIEW_EMAIL } });
  if (user) {
    await prisma.rental.deleteMany({
      where: {
        OR: [{ ownerUserId: user.id }, { renterUserId: user.id }, { createdByUserId: user.id }],
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
  }
  console.log(`\n  Removed ${REVIEW_EMAIL} and its data.\n`);
}

try {
  await (process.argv.includes('--clean') ? clean() : create());
  await closeDatabase();
} catch (error) {
  logger.error({ err: error }, 'Review account script failed');
  await closeDatabase();
  process.exit(1);
}
