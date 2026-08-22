import { MONTHLY_PERIOD_DAYS, YEARLY_PERIOD_DAYS } from './constants';

/**
 * Domain enumerations shared by the API and the mobile app.
 *
 * These values are duplicated as Prisma enums in apps/api/prisma/schema.prisma,
 * because a PostgreSQL enum type cannot be generated from TypeScript. A parity
 * test in the API asserts the two stay identical — if you add a value here, add
 * it there too or that test fails.
 *
 * Values are SCREAMING_SNAKE_CASE and are stable identifiers, never display
 * text. All user-facing labels live in the i18n files (CLAUDE.md §27, §48).
 */

/**
 * A user's primary role. This drives navigation and onboarding ONLY.
 *
 * Authorization is never based on this value — it is based on ownership edges
 * in the database (CLAUDE.md §31). That is deliberate: in Nepal it is common to
 * rent a flat and sublet rooms within it, so one person can legitimately be
 * both an owner and a renter without needing two accounts.
 */
export const USER_ROLES = ['HOUSE_OWNER', 'RENTER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** How a user found the app. Collected once during onboarding (CLAUDE.md §9). */
export const DISCOVERY_SOURCES = [
  'FRIEND_OR_FAMILY',
  'SOCIAL_MEDIA',
  'SEARCH_ENGINE',
  'APP_STORE',
  'ADVERTISEMENT',
  'OTHER',
] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

/** A rentable space. `HOUSE` covers a whole property let as one unit. */
export const UNIT_TYPES = ['FLAT', 'ROOM', 'SHOP', 'HOUSE'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/**
 * States a unit can be put into by its owner.
 *
 * `OCCUPIED` is deliberately absent. Occupancy is DERIVED from whether an
 * active rental exists, so the two can never contradict each other
 * (CLAUDE.md §22). Effective status is:
 *   hasActiveRental ? 'OCCUPIED' : availability
 */
export const UNIT_AVAILABILITIES = ['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'] as const;
export type UnitAvailability = (typeof UNIT_AVAILABILITIES)[number];

/** Derived occupancy, as presented to the user. */
export const UNIT_OCCUPANCY_STATES = [...UNIT_AVAILABILITIES, 'OCCUPIED'] as const;
export type UnitOccupancyState = (typeof UNIT_OCCUPANCY_STATES)[number];

/**
 * Rental agreement lifecycle (CLAUDE.md §11).
 *
 * `CANCELLED` is only reachable while no money has moved — it means "recorded
 * in error". A rental that ever had a payment can only be `ENDED`, so financial
 * history is never orphaned (§34).
 */
export const RENTAL_STATUSES = ['DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED'] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

/**
 * Billing frequency.
 *
 * These are FIXED-DURATION periods measured in elapsed days from the rental
 * start date — 30 days for MONTHLY, 365 for YEARLY — not calendar months or
 * years (CLAUDE.md §13, ADR 0001). See MONTHLY_PERIOD_DAYS / YEARLY_PERIOD_DAYS
 * in constants.ts.
 */
export const RENT_FREQUENCIES = ['MONTHLY', 'YEARLY'] as const;
export type RentFrequency = (typeof RENT_FREQUENCIES)[number];

/** What happens to the final period when a tenant leaves part-way through. */
export const MID_PERIOD_END_POLICIES = ['PRORATE', 'FULL_PERIOD'] as const;
export type MidPeriodEndPolicy = (typeof MID_PERIOD_END_POLICIES)[number];

/**
 * Charge categories. `RENT` is always present; the rest are opt-in per rental
 * (CLAUDE.md §12 — do not force every rental to use every service).
 */
export const CHARGE_TYPES = [
  'RENT',
  'ELECTRICITY',
  'WATER',
  'INTERNET',
  'WASTE',
  'CLEANING',
  'OTHER',
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

/**
 * How a charge is priced.
 *
 * `FIXED` is a flat amount per period. `PER_UNIT` is metered — the amount is
 * unknown until a reading is entered, which is why a period carrying one is not
 * complete until it is finalized (CLAUDE.md §60).
 */
export const PRICING_MODELS = ['FIXED', 'PER_UNIT'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

/**
 * How a FIXED charge behaves when a tenant occupies only part of a period.
 *
 *   PRORATE  charge in proportion to days occupied — the right default for rent
 *            and for anything consumed continuously.
 *   FULL     charge the whole amount regardless. Appropriate for a service
 *            billed as an indivisible monthly fee, such as an internet line the
 *            landlord pays for whether or not the tenant was there.
 *
 * Metered charges (PER_UNIT) have NO policy — they are computed from actual
 * consumption, which is already proportional to occupancy. Prorating a meter
 * reading on top of that would double-discount it.
 */
export const CHARGE_PRORATION_POLICIES = ['PRORATE', 'FULL'] as const;
export type ChargeProrationPolicy = (typeof CHARGE_PRORATION_POLICIES)[number];

/**
 * How much of a period's total has been settled.
 *
 * `OVERDUE` is deliberately NOT here. Overdue is time-dependent, so storing it
 * would make every row wrong the moment a due date passes, until some job
 * corrected it — and a missed job run would leave a tenant's screen lying about
 * their account. It is derived at read time from the due date and the balance
 * (CLAUDE.md §15, §62).
 */
export const SETTLEMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/**
 * What a payment was for.
 *
 * A security deposit is refundable and is never used to settle unpaid rent, so
 * it must be distinguishable from rent at the point it is recorded — not
 * inferred later.
 */
export const PAYMENT_PURPOSES = ['RENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** Nepali payment rails. MOBILE_WALLET covers eSewa, Khalti and similar. */
export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'MOBILE_WALLET',
  'CHEQUE',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * A payment is an immutable financial event. Correcting one means reversing it
 * and recording a new one — never editing the original (§15, §55).
 */
export const PAYMENT_STATUSES = ['POSTED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * What a notification is about (CLAUDE.md §17).
 *
 * The mobile app needs these to render an icon and a translated label for each
 * row of notification history, which is why they live here rather than only as
 * a Prisma enum.
 */
export const NOTIFICATION_TYPES = [
  'RENT_DUE_SOON',
  'RENT_DUE_TODAY',
  'RENT_OVERDUE',
  'PAYMENT_RECORDED',
  'RENTAL_STARTED',
  'RENTAL_ENDED',
  'GENERAL',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Platforms a push device can run on (§20). */
export const DEVICE_PLATFORMS = ['ANDROID', 'IOS'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * Number of days in a period for a given frequency.
 *
 * Reads the two constants rather than repeating the literals, so period length
 * has exactly one source of truth.
 */
export function periodDaysFor(frequency: RentFrequency): number {
  return frequency === 'MONTHLY' ? MONTHLY_PERIOD_DAYS : YEARLY_PERIOD_DAYS;
}
