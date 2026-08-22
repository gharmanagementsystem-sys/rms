import { randomUUID } from 'node:crypto';
import { prisma } from '../db/client';
import { logger } from '../services/logger';

/**
 * Scheduled job execution. CLAUDE.md §19.
 *
 * Every job must be safe to run repeatedly, from any number of instances. Two
 * independent mechanisms provide that:
 *
 *  1. This runner claims a `runKey` through a UNIQUE constraint. Whoever
 *     inserts the row first does the work; everyone else is told to skip. No
 *     advisory lock is needed, and the claim doubles as an execution log.
 *
 *  2. The jobs themselves are idempotent regardless — period generation diffs
 *     against existing sequence numbers, and notifications carry a unique
 *     dedupe key. The claim is an optimisation; correctness does not rest on it.
 *
 * The second point matters: a crashed run leaves a claimed key behind, and the
 * next run must still be able to finish the work safely.
 */

export type JobOutcome = 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface JobResult {
  jobName: string;
  outcome: JobOutcome;
  itemsProcessed: number;
  runKey: string;
  durationMs: number;
  error?: string;
}

export interface JobDefinition {
  name: string;
  /**
   * Identifies the logical run window.
   *
   * A daily job passes the business date, so triggering it five times in one
   * day performs the work once. Omit it for a job that should run on every
   * invocation, such as the push dispatcher.
   */
  runKey?: string | undefined;
  run: () => Promise<number>;
}

/** Postgres unique-violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function runJob(definition: JobDefinition): Promise<JobResult> {
  const startedAt = Date.now();
  // A job with no runKey always runs; the random key still records the run.
  const runKey = definition.runKey ?? `adhoc:${randomUUID()}`;

  let runId: string;
  try {
    const created = await prisma.jobRun.create({
      data: { jobName: definition.name, runKey, status: 'RUNNING' },
      select: { id: true },
    });
    runId = created.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Another instance, or an earlier trigger, already owns this window.
      logger.info({ job: definition.name, runKey }, 'Job already run for this window, skipping');
      return {
        jobName: definition.name,
        outcome: 'SKIPPED',
        itemsProcessed: 0,
        runKey,
        durationMs: Date.now() - startedAt,
      };
    }
    throw error;
  }

  try {
    const itemsProcessed = await definition.run();
    const durationMs = Date.now() - startedAt;

    await prisma.jobRun.update({
      where: { id: runId },
      data: { status: 'SUCCEEDED', itemsProcessed, finishedAt: new Date() },
    });

    logger.info({ job: definition.name, runKey, itemsProcessed, durationMs }, 'Job succeeded');
    return {
      jobName: definition.name,
      outcome: 'SUCCEEDED',
      itemsProcessed,
      runKey,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Recorded and logged, never swallowed — a silently failing accounting job
    // is exactly the failure §65 says must stay detectable.
    await prisma.jobRun.update({
      where: { id: runId },
      data: { status: 'FAILED', error: message.slice(0, 1000), finishedAt: new Date() },
    });

    logger.error({ err: error, job: definition.name, runKey }, 'Job failed');
    return {
      jobName: definition.name,
      outcome: 'FAILED',
      itemsProcessed: 0,
      runKey,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}
