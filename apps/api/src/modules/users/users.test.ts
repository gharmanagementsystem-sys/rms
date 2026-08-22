import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const getSession = vi.fn();
const userFindUnique = vi.fn();

// Better Auth is mocked so authorization is testable without a live session.
// `handler` must exist because app.ts wraps the instance at mount time.
vi.mock('../../auth/better-auth', () => ({
  auth: {
    api: { getSession },
    handler: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  },
}));

vi.mock('../../db/client', () => ({
  verifyDatabaseConnection: vi.fn(),
  closeDatabase: vi.fn(),
  prisma: { user: { findUnique: userFindUnique } },
}));

const { createApp } = await import('../../app');

const SESSION = {
  user: {
    id: 'user_01',
    name: 'Sita Shrestha',
    email: 'sita@example.com',
    emailVerified: true,
    image: null,
  },
  session: { id: 'sess_01' },
};

/** A row as Prisma would return it, including the fields that must never leak. */
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_01',
    name: 'Sita Shrestha',
    email: 'sita@example.com',
    emailVerified: true,
    image: null,
    profile: {
      fullName: 'Sita Shrestha',
      phone: '9801234567',
      photoUrl: null,
      primaryRole: 'HOUSE_OWNER',
      province: null,
      district: 'Kathmandu',
      municipality: null,
      ward: 4,
      addressLine: null,
      landmark: null,
      onboardingCompletedAt: new Date('2026-08-01T00:00:00Z'),
    },
    preferences: {
      language: 'ne',
      theme: 'dark',
      notificationsEnabled: true,
      rentReminderDays: [7, 1, 0],
    },
    ...overrides,
  };
}

describe('GET /api/v1/users/me', () => {
  beforeEach(() => {
    getSession.mockReset();
    userFindUnique.mockReset();
  });

  it('returns 401 UNAUTHENTICATED without a session', async () => {
    getSession.mockResolvedValue(null);

    const response = await request(createApp()).get('/api/v1/users/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    // The database is never consulted for an unauthenticated caller.
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('returns the profile and preferences of the session owner', async () => {
    getSession.mockResolvedValue(SESSION);
    userFindUnique.mockResolvedValue(userRow());

    const response = await request(createApp()).get('/api/v1/users/me');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'user_01',
      email: 'sita@example.com',
      emailVerified: true,
      onboardingCompleted: true,
      profile: { fullName: 'Sita Shrestha', primaryRole: 'HOUSE_OWNER', ward: 4 },
      preferences: { language: 'ne', theme: 'dark' },
    });
  });

  it('reports onboarding as incomplete when the timestamp is absent', async () => {
    // A profile row can exist before the flow finishes, so the gate must key on
    // the timestamp rather than on the row's presence.
    getSession.mockResolvedValue(SESSION);
    userFindUnique.mockResolvedValue(
      userRow({ profile: { ...userRow().profile, onboardingCompletedAt: null } }),
    );

    const response = await request(createApp()).get('/api/v1/users/me');
    expect(response.body.onboardingCompleted).toBe(false);
  });

  it('reports onboarding as incomplete when there is no profile at all', async () => {
    getSession.mockResolvedValue(SESSION);
    userFindUnique.mockResolvedValue(userRow({ profile: null, preferences: null }));

    const response = await request(createApp()).get('/api/v1/users/me');
    expect(response.body).toMatchObject({
      onboardingCompleted: false,
      profile: null,
      preferences: null,
    });
  });

  it('never exposes credential material', async () => {
    getSession.mockResolvedValue(SESSION);
    // Fields that must not survive into a response even if a future include
    // widens the query.
    userFindUnique.mockResolvedValue(
      userRow({
        accounts: [{ password: 'argon2id$hashed', accessToken: 'ya29.token' }],
      }),
    );

    const response = await request(createApp()).get('/api/v1/users/me');
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('argon2id');
    expect(serialized).not.toContain('ya29');
    expect(response.body).not.toHaveProperty('accounts');
  });

  it('derives identity from the session, ignoring client-supplied ids', async () => {
    getSession.mockResolvedValue(SESSION);
    userFindUnique.mockResolvedValue(userRow());

    const response = await request(createApp())
      .get('/api/v1/users/me')
      .set('x-user-id', 'user_99')
      .query({ userId: 'user_99' });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('user_01');
    // The lookup used the session's id, not anything from the request.
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user_01' } }),
    );
  });

  it('rejects a session whose user no longer exists', async () => {
    // A deleted account whose session was not yet cleaned up.
    getSession.mockResolvedValue(SESSION);
    userFindUnique.mockResolvedValue(null);

    const response = await request(createApp()).get('/api/v1/users/me');
    expect(response.status).toBe(401);
  });
});

describe('Better Auth mount', () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it('serves /api/auth/* rather than falling through to the 404 handler', async () => {
    const response = await request(createApp()).get('/api/auth/session');

    expect(response.status).not.toBe(404);
    expect(response.body).toEqual({ ok: true });
  });
});
