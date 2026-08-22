import {
  DEFAULT_RENT_REMINDER_DAYS,
  type CompleteOnboardingInput,
  type CurrentUser,
  type DateFormatPreference,
  type Language,
  type ThemePreference,
  type UpdatePreferencesInput,
  type UpdateProfileInput,
} from '@rms/shared';
import type { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';

/**
 * Profile, preferences and onboarding (CLAUDE.md §9, §23).
 *
 * Identity always comes from the session. Nothing here accepts a user id from
 * a caller, so there is no path by which one user edits another's profile.
 */

const USER_INCLUDE = {
  profile: true,
  preferences: true,
} as const satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

function toCurrentUser(user: UserRow): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    image: user.image,
    profile: user.profile
      ? {
          fullName: user.profile.fullName,
          phone: user.profile.phone,
          photoUrl: user.profile.photoUrl,
          primaryRole: user.profile.primaryRole,
          province: user.profile.province,
          district: user.profile.district,
          municipality: user.profile.municipality,
          ward: user.profile.ward,
          addressLine: user.profile.addressLine,
          landmark: user.profile.landmark,
        }
      : null,
    preferences: user.preferences
      ? {
          // Stored as plain text columns rather than enums, so they are
          // narrowed here. The values can only have come from the validated
          // update schema, which accepts nothing else.
          language: user.preferences.language as Language,
          theme: user.preferences.theme as ThemePreference,
          dateFormat: user.preferences.dateFormat as DateFormatPreference,
          notificationsEnabled: user.preferences.notificationsEnabled,
          rentReminderDays: user.preferences.rentReminderDays,
        }
      : null,
    // The router's gate. A profile can exist without onboarding being finished,
    // so this is an explicit timestamp rather than "profile is not null".
    onboardingCompleted: user.profile?.onboardingCompletedAt != null,
  };
}

export async function getCurrentUser(userId: string): Promise<CurrentUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: USER_INCLUDE });
  if (!user) {
    // The session referenced a user that no longer exists — a deleted account
    // whose session was not yet cleaned up.
    throw AppError.unauthenticated('Your account is no longer available.');
  }
  return toCurrentUser(user);
}

/**
 * Translates a unique-constraint violation on `phone` into a usable message.
 *
 * Prisma reports P2002; without this the user would see a generic 500 for what
 * is really "someone already registered that number".
 */
function asUniqueConflict(error: unknown): AppError | null {
  if ((error as { code?: string })?.code !== 'P2002') return null;

  // `meta.target` is not a stable shape — depending on the Prisma version and
  // driver adapter it can be a string[], a single string, or absent entirely.
  // Normalising to text, and falling back to the message, means the mapping
  // does not silently break on an upgrade.
  const meta = (error as { meta?: { target?: unknown } })?.meta?.target;
  const target = Array.isArray(meta) ? meta.join(',') : String(meta ?? '');
  const message = (error as { message?: string })?.message ?? '';
  const mentionsPhone = /phone/i.test(target) || /phone/i.test(message);

  return new AppError(
    'CONFLICT',
    409,
    mentionsPhone
      ? 'That phone number is already registered to another account.'
      : 'Those details are already registered to another account.',
  );
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<CurrentUser> {
  try {
    await prisma.profile.update({ where: { userId }, data: input });
  } catch (error) {
    const conflict = asUniqueConflict(error);
    if (conflict) throw conflict;
    if ((error as { code?: string })?.code === 'P2025') {
      throw AppError.notFound('Complete onboarding before editing your profile.');
    }
    throw error;
  }
  return getCurrentUser(userId);
}

export async function updatePreferences(
  userId: string,
  input: UpdatePreferencesInput,
): Promise<CurrentUser> {
  // Upsert rather than update: a user created before preferences existed, or
  // one who signed in with Google and skipped ahead, still needs this to work.
  await prisma.userPreferences.upsert({
    where: { userId },
    create: {
      userId,
      language: input.language ?? 'en',
      theme: input.theme ?? 'system',
      dateFormat: input.dateFormat ?? 'BS',
      notificationsEnabled: input.notificationsEnabled ?? true,
      rentReminderDays: input.rentReminderDays ?? [...DEFAULT_RENT_REMINDER_DAYS],
    },
    update: input,
  });
  return getCurrentUser(userId);
}

/**
 * Completes onboarding atomically (§9).
 *
 * Profile and preferences are written in one transaction, so the app can never
 * observe a user who has a role but no language, or preferences but no name.
 *
 * Idempotent: re-submitting updates the same rows rather than failing, which
 * matters because the final step of a multi-screen flow is exactly where a
 * flaky connection causes a retry.
 */
export async function completeOnboarding(
  userId: string,
  input: CompleteOnboardingInput,
): Promise<CurrentUser> {
  const { language, theme, dateFormat, notificationsEnabled, discoverySource, ...profileFields } =
    input;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.profile.upsert({
        where: { userId },
        create: {
          userId,
          ...profileFields,
          discoverySource: discoverySource ?? null,
          onboardingCompletedAt: new Date(),
        },
        update: {
          ...profileFields,
          discoverySource: discoverySource ?? null,
          onboardingCompletedAt: new Date(),
        },
      });

      await tx.userPreferences.upsert({
        where: { userId },
        create: {
          userId,
          language,
          theme,
          dateFormat,
          notificationsEnabled,
          rentReminderDays: [...DEFAULT_RENT_REMINDER_DAYS],
        },
        update: { language, theme, dateFormat, notificationsEnabled },
      });
    });
  } catch (error) {
    const conflict = asUniqueConflict(error);
    if (conflict) throw conflict;
    throw error;
  }

  return getCurrentUser(userId);
}

/**
 * Revokes every session except the current one.
 *
 * Offered because "sign out of my other devices" is the only self-service
 * remedy a user has after losing a phone (§23, §32).
 */
export async function signOutOtherDevices(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const [sessions, devices] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
    // Their push tokens go too, or the lost handset keeps receiving rent
    // reminders for this account.
    prisma.device.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  void devices;
  return sessions.count;
}
