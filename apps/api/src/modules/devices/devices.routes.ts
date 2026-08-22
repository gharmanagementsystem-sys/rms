import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { idParamSchema } from '@rms/shared';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { requireAuth, requireAuthContext } from '../../middleware/require-auth';
import { validate, type ValidatedRequest } from '../../middleware/validate';

/**
 * Push device registration. CLAUDE.md §20.
 *
 * A user may have several devices; tokens rotate; a handset can change owner.
 * Registration is therefore an upsert keyed on the token, which reassigns it to
 * whoever is signed in now — otherwise a resold phone would keep receiving the
 * previous owner's rent reminders.
 */
export const devicesRouter: Router = Router();

devicesRouter.use(requireAuth);

const registerDeviceSchema = z.object({
  /** Native FCM registration token from expo-notifications. */
  token: z.string().trim().min(20).max(500),
  platform: z.enum(['ANDROID', 'IOS']),
  appVersion: z.string().trim().min(1).max(40).optional(),
  /** Whether the OS-level permission is currently granted. */
  notificationsEnabled: z.boolean().default(true),
});

type RegisterReq = ValidatedRequest<{ body: typeof registerDeviceSchema }>;
type IdReq = ValidatedRequest<{ params: typeof idParamSchema }>;

devicesRouter.post('/', validate({ body: registerDeviceSchema }), (async (
  req: RegisterReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);
  const input = req.validated.body;

  const device = await prisma.device.upsert({
    where: { token: input.token },
    create: {
      userId: auth.userId,
      token: input.token,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      notificationsEnabled: input.notificationsEnabled,
    },
    update: {
      // Reassign on re-registration: the token now belongs to this session.
      userId: auth.userId,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      notificationsEnabled: input.notificationsEnabled,
      lastSeenAt: new Date(),
      // A token that comes back to life is no longer revoked.
      revokedAt: null,
    },
    select: { id: true, platform: true, notificationsEnabled: true, createdAt: true },
  });

  res.status(201).json({
    id: device.id,
    platform: device.platform,
    notificationsEnabled: device.notificationsEnabled,
  });
}) as RequestHandler);

/**
 * Revokes a device — called on sign-out.
 *
 * Soft revoke rather than delete, so the delivery history of past
 * notifications remains intact.
 */
devicesRouter.delete('/:id', validate({ params: idParamSchema }), (async (
  req: IdReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);

  const result = await prisma.device.updateMany({
    // Scoped to the caller: one user cannot revoke another's device.
    where: { id: req.validated.params.id, userId: auth.userId },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) throw AppError.notFound('This device was not found.');
  res.status(204).send();
}) as RequestHandler);
