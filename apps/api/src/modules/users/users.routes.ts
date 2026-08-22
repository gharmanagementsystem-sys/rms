import { Router, type RequestHandler, type Response } from 'express';
import {
  completeOnboardingSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from '@rms/shared';
import { requireAuth, requireAuthContext } from '../../middleware/require-auth';
import { validate, type ValidatedRequest } from '../../middleware/validate';
import * as service from './users.service';

/**
 * The signed-in user's own account (CLAUDE.md §23).
 *
 * Every route is `/me`. There is deliberately no `/users/:id` — a user can read
 * or edit exactly one account, so there is no identifier to tamper with.
 */
export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

type ProfileReq = ValidatedRequest<{ body: typeof updateProfileSchema }>;
type PreferencesReq = ValidatedRequest<{ body: typeof updatePreferencesSchema }>;
type OnboardingReq = ValidatedRequest<{ body: typeof completeOnboardingSchema }>;

/**
 * Everything the app needs to decide what to render: identity, profile,
 * preferences, and whether onboarding is finished.
 *
 * Returned as one payload so the router can gate on a single request rather
 * than flashing between screens as separate calls resolve.
 */
usersRouter.get('/me', (async (req, res: Response) => {
  const auth = requireAuthContext(req);
  res.json(await service.getCurrentUser(auth.userId));
}) as RequestHandler);

usersRouter.patch('/me/profile', validate({ body: updateProfileSchema }), (async (
  req: ProfileReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);
  res.json(await service.updateProfile(auth.userId, req.validated.body));
}) as RequestHandler);

usersRouter.patch('/me/preferences', validate({ body: updatePreferencesSchema }), (async (
  req: PreferencesReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);
  res.json(await service.updatePreferences(auth.userId, req.validated.body));
}) as RequestHandler);

/** One atomic call at the end of the multi-step flow (§9). */
usersRouter.post('/me/onboarding', validate({ body: completeOnboardingSchema }), (async (
  req: OnboardingReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);
  res.json(await service.completeOnboarding(auth.userId, req.validated.body));
}) as RequestHandler);

/** "Sign out everywhere else" — the remedy after losing a phone (§32). */
usersRouter.post('/me/sign-out-other-devices', (async (req, res: Response) => {
  const auth = requireAuthContext(req);
  const revoked = await service.signOutOtherDevices(auth.userId, auth.sessionId);
  res.json({ revokedSessions: revoked });
}) as RequestHandler);
