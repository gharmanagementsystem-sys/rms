import { Router } from 'express';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { devicesRouter } from '../modules/devices/devices.routes';
import { healthRouter } from '../modules/health/health.routes';
import { notificationsRouter } from '../modules/notifications/notifications.routes';
import { propertiesRouter } from '../modules/properties/properties.routes';
import { rentalsRouter } from '../modules/rentals/rentals.routes';
import { usersRouter } from '../modules/users/users.routes';

/**
 * The versioned API surface. CLAUDE.md §7 — version from the beginning.
 * Every module router is mounted here and nowhere else.
 *
 * Note that Better Auth's own endpoints are NOT mounted here. They live at
 * /api/auth/* and are wired in app.ts, because they must run before the JSON
 * body parser. The internal job endpoints are mounted separately too — they
 * are authenticated by a bearer token rather than a session.
 */
export const apiV1Router: Router = Router();

apiV1Router.use('/health', healthRouter);
apiV1Router.use('/users', usersRouter);
apiV1Router.use('/dashboard', dashboardRouter);
apiV1Router.use('/properties', propertiesRouter);
apiV1Router.use('/rentals', rentalsRouter);
apiV1Router.use('/devices', devicesRouter);
apiV1Router.use('/notifications', notificationsRouter);
