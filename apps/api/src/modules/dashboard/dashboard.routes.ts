import { Router, type RequestHandler, type Response } from 'express';
import { prisma } from '../../db/client';
import { requireAuth, requireAuthContext } from '../../middleware/require-auth';
import { getDashboard } from './dashboard.service';

/**
 * The dashboard (CLAUDE.md §24).
 *
 * One request returns everything the home screen needs, so it renders in a
 * single pass rather than assembling itself as several calls resolve.
 */
export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/', (async (req, res: Response) => {
  const auth = requireAuthContext(req);

  // Read from the profile rather than trusting a query parameter: the role
  // decides what is shown, and a client-supplied one would be a lie the server
  // repeated back (§30).
  const profile = await prisma.profile.findUnique({
    where: { userId: auth.userId },
    select: { primaryRole: true },
  });

  res.json(await getDashboard(auth.userId, profile?.primaryRole ?? 'RENTER'));
}) as RequestHandler);
