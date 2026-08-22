import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The database module is mocked so readiness can be tested deterministically in
// both directions, and so no test ever opens a real connection.
vi.mock('../../db/client', () => ({
  verifyDatabaseConnection: vi.fn(),
  closeDatabase: vi.fn(),
  // Better Auth's Prisma adapter is constructed at import time from this
  // export, so the mock must provide it even though no query runs here.
  prisma: {},
}));

const { createApp } = await import('../../app');
const { verifyDatabaseConnection } = await import('../../db/client');

const verifyMock = vi.mocked(verifyDatabaseConnection);

describe('GET /api/v1/health (liveness)', () => {
  beforeEach(() => {
    verifyMock.mockReset();
  });

  it('reports the service as healthy', async () => {
    const response = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      // Also proves @rms/shared resolves at runtime, not just at typecheck.
      timezone: 'Asia/Kathmandu',
    });
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('does not touch the database', async () => {
    await request(createApp()).get('/api/v1/health');

    // Render polls this constantly; a database round-trip here would turn a
    // slow query into an instance restart.
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('does not leak the framework in response headers', async () => {
    const response = await request(createApp()).get('/api/v1/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  beforeEach(() => {
    verifyMock.mockReset();
  });

  it('reports ready when the database responds', async () => {
    verifyMock.mockResolvedValue(undefined);

    const response = await request(createApp()).get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it('fails clearly with 503 when the database is unreachable', async () => {
    verifyMock.mockRejectedValue(
      new Error('connect ECONNREFUSED postgresql://rms:sup3rs3cret@db.example.com:5432'),
    );

    const response = await request(createApp()).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.requestId).toBeTruthy();

    // The failure must be reported, but the connection string must not be.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('sup3rs3cret');
    expect(serialized).not.toContain('ECONNREFUSED');
  });
});
