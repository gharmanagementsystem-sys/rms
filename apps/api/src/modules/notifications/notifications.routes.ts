import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler, type Response } from 'express';
import { idParamSchema, paginationQuerySchema } from '@rms/shared';
import { prisma } from '../../db/client';
import { AppError } from '../../errors/app-error';
import { runDispatchPush } from '../../jobs/jobs';
import { cursorArgs, toPage } from '../../lib/pagination';
import { requireAuth, requireAuthContext } from '../../middleware/require-auth';
import { validate, type ValidatedRequest } from '../../middleware/validate';

/**
 * Notification history (CLAUDE.md §17, §39).
 *
 * Backed by PostgreSQL rather than FCM, so a user who denied push permission,
 * or whose phone was off, still sees everything that happened.
 */
export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

type ListReq = ValidatedRequest<{ query: typeof paginationQuerySchema }>;
type IdReq = ValidatedRequest<{ params: typeof idParamSchema }>;

notificationsRouter.get('/', validate({ query: paginationQuerySchema }), (async (
  req: ListReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);
  const { limit, cursor } = req.validated.query;

  const rows = await prisma.notification.findMany({
    // Scoped to the caller — one user never sees another's notifications.
    where: { userId: auth.userId },
    orderBy: { id: 'desc' },
    ...cursorArgs(limit, cursor),
  });

  const page = toPage(rows, limit);
  const unreadCount = await prisma.notification.count({
    where: { userId: auth.userId, readAt: null },
  });

  res.json({
    data: page.items.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      /** Stable identifiers; the app resolves the destination itself (§39). */
      data: notification.data,
      rentalId: notification.rentalId,
      periodId: notification.periodId,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    })),
    meta: { ...page.meta, unreadCount },
  });
}) as RequestHandler);

/**
 * Sends the caller a real notification through the real pipeline, so they can
 * answer "is push actually working on this device?" without needing database
 * access or the internal job-runner token (§20, §39).
 *
 * Scoped entirely to the caller's own devices — this can only ever notify the
 * person who requested it, never anyone else, so it carries no more risk than
 * any other authenticated write.
 *
 * Delivery is done by handing off to the real `dispatch-push` job rather than
 * re-implementing the send-and-record logic here a second time (§51): this
 * creates one row and lets the same pipeline that ships rent reminders pick it
 * up. That job drains every pending notification, not only this one, which is
 * harmless — it is exactly what the next scheduled run would do anyway.
 */
notificationsRouter.post('/test', (async (req, res: Response) => {
  const auth = requireAuthContext(req);

  const registeredDevices = await prisma.device.count({
    where: { userId: auth.userId, revokedAt: null },
  });

  const notification = await prisma.notification.create({
    data: {
      userId: auth.userId,
      type: 'GENERAL',
      title: 'Test notification',
      body: 'If you can see this, push notifications are working on this device.',
      data: {},
      // Unique per call: this is a manual probe, not a recurring event the
      // dedupe rule (§18) needs to protect against.
      dedupeKey: `TEST:${auth.userId}:${randomUUID()}`,
    },
  });

  await runDispatchPush();

  const deliveries = await prisma.notificationDelivery.findMany({
    where: { notificationId: notification.id },
    select: { status: true },
  });

  res.json({
    notificationId: notification.id,
    registeredDevices,
    delivered: deliveries.filter((d) => d.status === 'SENT').length,
    failed: deliveries.filter((d) => d.status === 'FAILED').length,
  });
}) as RequestHandler);

notificationsRouter.patch('/:id/read', validate({ params: idParamSchema }), (async (
  req: IdReq,
  res: Response,
) => {
  const auth = requireAuthContext(req);

  const result = await prisma.notification.updateMany({
    where: { id: req.validated.params.id, userId: auth.userId, readAt: null },
    data: { readAt: new Date() },
  });

  if (result.count === 0) {
    // Either it is not theirs, or it was already read. Both are reported the
    // same way so a notification id cannot be probed for existence.
    const exists = await prisma.notification.count({
      where: { id: req.validated.params.id, userId: auth.userId },
    });
    if (exists === 0) throw AppError.notFound('This notification was not found.');
  }

  res.status(204).send();
}) as RequestHandler);

notificationsRouter.post('/read-all', (async (req, res: Response) => {
  const auth = requireAuthContext(req);
  const result = await prisma.notification.updateMany({
    where: { userId: auth.userId, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ markedRead: result.count });
}) as RequestHandler);
