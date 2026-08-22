import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth/better-auth';
import { AppError } from '../errors/app-error';

/**
 * Authentication gate. CLAUDE.md §31.
 *
 * The caller's identity is resolved by looking the session up server-side. It
 * is NEVER read from the request body, a header, or any client-supplied field —
 * that would make privilege escalation a one-line curl (§30, §54).
 *
 * This answers "who are you?" only. "What may you do?" is a separate question,
 * answered by ownership checks in the service layer, because a valid session
 * says nothing about whether this user owns the rental being modified.
 */

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Absent on unauthenticated routes. */
      auth?: AuthContext;
    }
  }
}

/**
 * Looks the session up, if any, without ever rejecting the request.
 *
 * Shared by `requireAuth` (which turns a miss into 401) and `attachAuthIfPresent`
 * (which is best-effort and runs ahead of routes that must not require a
 * session, such as the general rate limiter).
 */
async function resolveAuthContext(req: {
  headers: Parameters<typeof fromNodeHeaders>[0];
}): Promise<AuthContext | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    image: session.user.image ?? null,
    sessionId: session.session.id,
  };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const context = await resolveAuthContext(req);

  if (!context) {
    next(AppError.unauthenticated());
    return;
  }

  req.auth = context;
  next();
};

/**
 * Attaches `req.auth` when a valid session cookie is present, but never
 * blocks the request either way.
 *
 * Exists solely so the general rate limiter (mounted ahead of every module
 * router's own `requireAuth`) can key on the signed-in user rather than
 * always falling back to IP — otherwise every request behind a shared or
 * carrier-grade NAT would share one bucket. An anonymous request costs no
 * extra I/O (Better Auth returns immediately with no session cookie), and an
 * authenticated one is served from the session cookie cache rather than the
 * database (see `auth/better-auth.ts`'s `session.cookieCache`).
 */
export const attachAuthIfPresent: RequestHandler = async (req, _res, next) => {
  // Best-effort by contract: this sits ahead of every /api/v1 route, so a
  // lookup failure must degrade to "treat as anonymous" rather than take the
  // whole API down. `requireAuth` still performs the real, failure-visible
  // check on routes that actually need one.
  try {
    req.auth = (await resolveAuthContext(req)) ?? undefined;
  } catch {
    req.auth = undefined;
  }
  next();
};

/**
 * Reads the auth context, throwing if the route was not gated by `requireAuth`.
 *
 * Controllers use this instead of `req.auth!` so that a missing middleware is a
 * loud 500 during development rather than a silent `undefined` that reads as
 * "no user" and quietly widens access.
 */
export function requireAuthContext(req: Express.Request): AuthContext {
  if (!req.auth) {
    throw AppError.internal(
      undefined,
      new Error('requireAuth middleware is missing on this route'),
    );
  }
  return req.auth;
}
