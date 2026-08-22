import { z } from 'zod';
import { SUPPORTED_DATE_FORMATS, SUPPORTED_LANGUAGES, SUPPORTED_THEMES } from '../constants';
import { DISCOVERY_SOURCES, USER_ROLES } from '../domain';
import { nepaliAddressSchema, nepaliPhoneSchema } from './common';

/**
 * Profile, preferences and onboarding (CLAUDE.md §9, §23, §30).
 *
 * Note what the client may NOT send: `userId`, `email`, `emailVerified`. The
 * first two come from the session, and the third is set only by completing the
 * verification flow — accepting any of them would let a request body grant
 * itself another person's identity (§30, §54).
 */

export const updateProfileSchema = nepaliAddressSchema
  .extend({
    fullName: z.string().trim().min(1, 'Enter your name').max(120).optional(),
    phone: nepaliPhoneSchema.optional(),
    photoUrl: z.url().max(500).optional(),
    /**
     * Changeable after onboarding.
     *
     * A user who picks the wrong role must not be stuck with it, and in Nepal
     * one person may genuinely both rent a flat and sublet rooms. This only
     * drives navigation — authorization is always by ownership (§31).
     */
    primaryRole: z.enum(USER_ROLES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const updatePreferencesSchema = z
  .object({
    language: z.enum(SUPPORTED_LANGUAGES).optional(),
    theme: z.enum(SUPPORTED_THEMES).optional(),
    dateFormat: z.enum(SUPPORTED_DATE_FORMATS).optional(),
    notificationsEnabled: z.boolean().optional(),
    /**
     * Days before the due date to remind. 0 means "on the day".
     *
     * Capped and de-duplicated so a client cannot request ninety reminders for
     * one period.
     */
    rentReminderDays: z
      .array(z.number().int().min(0).max(30))
      .max(5, 'Choose at most five reminder days')
      .transform((days) => [...new Set(days)].sort((a, b) => b - a))
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

/**
 * Completes onboarding in one atomic call.
 *
 * Sent once, at the end of the multi-step flow, rather than saving each step as
 * the user goes. A half-finished profile is not a state the rest of the app
 * should have to reason about, and one request means one transaction (§9).
 */
export const completeOnboardingSchema = nepaliAddressSchema.extend({
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
  phone: nepaliPhoneSchema.optional(),
  primaryRole: z.enum(USER_ROLES),
  language: z.enum(SUPPORTED_LANGUAGES),
  theme: z.enum(SUPPORTED_THEMES),
  dateFormat: z.enum(SUPPORTED_DATE_FORMATS).default('BS'),
  discoverySource: z.enum(DISCOVERY_SOURCES).optional(),
  notificationsEnabled: z.boolean().default(true),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;

/** The `/users/me` response. Everything the app needs to route and render. */
export interface CurrentUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string | null;
  profile: {
    fullName: string;
    phone: string | null;
    photoUrl: string | null;
    primaryRole: (typeof USER_ROLES)[number];
    province: string | null;
    district: string | null;
    municipality: string | null;
    ward: number | null;
    addressLine: string | null;
    landmark: string | null;
  } | null;
  preferences: {
    language: (typeof SUPPORTED_LANGUAGES)[number];
    theme: (typeof SUPPORTED_THEMES)[number];
    dateFormat: (typeof SUPPORTED_DATE_FORMATS)[number];
    notificationsEnabled: boolean;
    rentReminderDays: number[];
  } | null;
  /** False until onboarding has been completed; drives the router's gate. */
  onboardingCompleted: boolean;
}
