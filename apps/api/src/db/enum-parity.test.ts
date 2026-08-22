import { describe, expect, it } from 'vitest';
import {
  CHARGE_PRORATION_POLICIES,
  CHARGE_TYPES,
  DEVICE_PLATFORMS,
  DISCOVERY_SOURCES,
  MID_PERIOD_END_POLICIES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  PRICING_MODELS,
  RENT_FREQUENCIES,
  RENTAL_STATUSES,
  SETTLEMENT_STATUSES,
  UNIT_AVAILABILITIES,
  UNIT_TYPES,
  USER_ROLES,
} from '@rms/shared';
import * as PrismaEnums from '../../generated/prisma/enums';

/**
 * The same enumerations exist twice: as PostgreSQL enum types (via Prisma) and
 * as TypeScript unions in @rms/shared, which the mobile app consumes. A
 * PostgreSQL enum cannot be generated from TypeScript, so the duplication is
 * unavoidable — but silent drift between them is not.
 *
 * Drift here is a real failure mode: the API would accept a value the database
 * rejects (a 500 the client cannot act on), or the mobile app would render a
 * status it has no label for.
 */
const PAIRS = [
  ['UserRole', USER_ROLES, PrismaEnums.UserRole],
  ['DiscoverySource', DISCOVERY_SOURCES, PrismaEnums.DiscoverySource],
  ['UnitType', UNIT_TYPES, PrismaEnums.UnitType],
  ['UnitAvailability', UNIT_AVAILABILITIES, PrismaEnums.UnitAvailability],
  ['RentalStatus', RENTAL_STATUSES, PrismaEnums.RentalStatus],
  ['RentFrequency', RENT_FREQUENCIES, PrismaEnums.RentFrequency],
  ['MidPeriodEndPolicy', MID_PERIOD_END_POLICIES, PrismaEnums.MidPeriodEndPolicy],
  ['ChargeType', CHARGE_TYPES, PrismaEnums.ChargeType],
  ['PricingModel', PRICING_MODELS, PrismaEnums.PricingModel],
  ['ChargeProrationPolicy', CHARGE_PRORATION_POLICIES, PrismaEnums.ChargeProrationPolicy],
  ['SettlementStatus', SETTLEMENT_STATUSES, PrismaEnums.SettlementStatus],
  ['PaymentPurpose', PAYMENT_PURPOSES, PrismaEnums.PaymentPurpose],
  ['PaymentMethod', PAYMENT_METHODS, PrismaEnums.PaymentMethod],
  ['PaymentStatus', PAYMENT_STATUSES, PrismaEnums.PaymentStatus],
  ['NotificationType', NOTIFICATION_TYPES, PrismaEnums.NotificationType],
  ['DevicePlatform', DEVICE_PLATFORMS, PrismaEnums.DevicePlatform],
] as const satisfies ReadonlyArray<readonly [string, readonly string[], Record<string, string>]>;

/**
 * Enums that exist only in the database.
 *
 * Listed explicitly so that adding a new Prisma enum forces a decision — either
 * it belongs in @rms/shared and gets a parity pair above, or it is server-only
 * and belongs here. Silent omission is how the two drift apart.
 */
const SERVER_ONLY_ENUMS = ['DeliveryStatus', 'JobRunStatus'] as const;

describe('domain enum parity between @rms/shared and the database', () => {
  it.each(PAIRS)('%s has identical values in both', (_name, shared, prisma) => {
    const prismaValues = Object.values(prisma).sort();
    const sharedValues = [...shared].sort();
    expect(prismaValues).toEqual(sharedValues);
  });

  it('every database enum is either shared or explicitly server-only', () => {
    // Catches the case this file exists to prevent: a new Prisma enum added
    // without anyone deciding whether the mobile app needs to know about it.
    const covered = new Set<string>([...PAIRS.map(([name]) => name), ...SERVER_ONLY_ENUMS]);
    const allPrismaEnums = Object.keys(PrismaEnums);
    const uncovered = allPrismaEnums.filter((name) => !covered.has(name));

    expect(uncovered).toEqual([]);
  });

  it('UnitAvailability does not contain OCCUPIED', () => {
    // Occupancy is derived from active rentals, never stored — storing it would
    // reintroduce exactly the contradiction CLAUDE.md §22 warns about.
    expect(Object.values(PrismaEnums.UnitAvailability)).not.toContain('OCCUPIED');
    expect([...UNIT_AVAILABILITIES]).not.toContain('OCCUPIED');
  });
});
