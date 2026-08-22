import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobRun = {
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('../db/client', () => ({
  prisma: { jobRun },
  verifyDatabaseConnection: vi.fn(),
  closeDatabase: vi.fn(),
}));

const { runJob } = await import('./runner');

/** Mimics Prisma's unique-constraint violation. */
class UniqueViolation extends Error {
  code = 'P2002';
}

describe('duplicate job execution (§19)', () => {
  beforeEach(() => {
    jobRun.create.mockReset();
    jobRun.update.mockReset();
    jobRun.update.mockResolvedValue({});
  });

  it('runs the work when it wins the claim', async () => {
    jobRun.create.mockResolvedValue({ id: 'run-1' });
    const work = vi.fn().mockResolvedValue(7);

    const result = await runJob({ name: 'generate-periods', runKey: '2026-08-17', run: work });

    expect(work).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'SUCCEEDED', itemsProcessed: 7 });
  });

  it('does NOT run the work a second time for the same window', async () => {
    // The unique constraint on (jobName, runKey) rejects the second claim.
    jobRun.create.mockRejectedValue(new UniqueViolation('duplicate key'));
    const work = vi.fn().mockResolvedValue(7);

    const result = await runJob({ name: 'generate-periods', runKey: '2026-08-17', run: work });

    expect(work).not.toHaveBeenCalled();
    expect(result.outcome).toBe('SKIPPED');
    expect(result.itemsProcessed).toBe(0);
  });

  it('reports a skip as success, so a scheduler does not retry it forever', async () => {
    jobRun.create.mockRejectedValue(new UniqueViolation('duplicate key'));
    const result = await runJob({
      name: 'rent-reminders',
      runKey: '2026-08-17',
      run: async () => 0,
    });
    expect(result.outcome).not.toBe('FAILED');
  });

  it('performs the work exactly once across many concurrent triggers', async () => {
    let claimed = false;
    jobRun.create.mockImplementation(async () => {
      if (claimed) throw new UniqueViolation('duplicate key');
      claimed = true;
      return { id: 'run-1' };
    });

    const work = vi.fn().mockResolvedValue(1);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        runJob({ name: 'generate-periods', runKey: '2026-08-17', run: work }),
      ),
    );

    expect(work).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.outcome === 'SUCCEEDED')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'SKIPPED')).toHaveLength(9);
  });

  it('runs on every invocation when no window is given', async () => {
    // The push dispatcher is a queue drain, not a once-per-day job.
    jobRun.create.mockResolvedValue({ id: 'run-1' });
    const work = vi.fn().mockResolvedValue(0);

    await runJob({ name: 'dispatch-push', run: work });
    await runJob({ name: 'dispatch-push', run: work });

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('records a failure instead of swallowing it', async () => {
    jobRun.create.mockResolvedValue({ id: 'run-1' });
    const work = vi.fn().mockRejectedValue(new Error('database exploded'));

    const result = await runJob({ name: 'generate-periods', runKey: '2026-08-17', run: work });

    expect(result.outcome).toBe('FAILED');
    expect(result.error).toContain('database exploded');
    expect(jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('does not treat an unrelated error as a duplicate claim', async () => {
    // Only P2002 means "already claimed"; anything else is a real fault.
    jobRun.create.mockRejectedValue(new Error('connection refused'));
    await expect(
      runJob({ name: 'generate-periods', runKey: '2026-08-17', run: async () => 0 }),
    ).rejects.toThrow('connection refused');
  });
});
