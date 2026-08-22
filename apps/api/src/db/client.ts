import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolConfig } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from '../config/env';
import { logger } from '../services/logger';

/**
 * Database connection. CLAUDE.md §33.
 *
 * Prisma 7 connects through a driver adapter rather than a built-in engine.
 * `@prisma/adapter-pg` is used — node-postgres over TCP — for two reasons:
 *
 *  1. Interactive multi-statement transactions are required. Recording a
 *     payment must update the payment, its allocations and the period
 *     atomically, and Neon's HTTP driver cannot do that.
 *  2. It is not Neon-specific, so the database is portable.
 *
 * Point DATABASE_URL at Neon's **pooled** connection string. Neon's pooler is
 * what scales connections; DATABASE_POOL_MAX stays small so a few API
 * instances cannot exhaust the project's connection budget.
 */

const poolConfig: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,

  /**
   * Generous, because of how Neon behaves rather than how fast the network is.
   *
   * Neon suspends an idle compute and resumes it on the next connection. That
   * cold start regularly takes several seconds and occasionally longer, and a
   * 10s ceiling turned it into `Connection terminated due to connection
   * timeout` — surfacing to the user as a 500 on sign-in, from a database that
   * was merely asleep.
   *
   * Waiting is the right behaviour here: the alternative is failing a request
   * that would have succeeded a second later. Genuine unreachability still
   * fails, just 20 seconds later instead of 10.
   */
  connectionTimeoutMillis: 30_000,

  /**
   * Below Neon's own idle cutoff, so this pool closes a connection before the
   * server does. A client the pool still believes is live, which Neon has
   * already dropped, fails on first use with "Connection terminated
   * unexpectedly".
   */
  idleTimeoutMillis: 30_000,
};

/**
 * The pool is constructed here rather than letting the adapter build it from a
 * config object, so an 'error' listener can be attached. Without one, an idle
 * client failing (a Neon compute suspend, a network blip) emits an unhandled
 * 'error' event and terminates the process.
 *
 * Constructing a Pool does not open a connection — node-postgres connects
 * lazily. Importing this module is therefore safe at boot and in tests;
 * failure surfaces at `verifyDatabaseConnection()`, where it is reported
 * clearly.
 */
function createPool(): Pool {
  const pool = new Pool(poolConfig);
  pool.on('error', (error: Error) => {
    logger.error({ err: error }, 'Idle database client error');
  });
  return pool;
}

function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

/**
 * `tsx watch` re-imports modules on every change. Without this cache each
 * reload would build a new pool and leak connections until Neon refused them.
 * Production always constructs exactly once.
 */
interface PrismaGlobal {
  __rmsPool?: Pool;
  __rmsPrisma?: PrismaClient;
}

const globalCache = globalThis as unknown as PrismaGlobal;

const pool: Pool = globalCache.__rmsPool ?? createPool();
export const prisma: PrismaClient = globalCache.__rmsPrisma ?? createPrismaClient(pool);

if (!env.isProduction) {
  globalCache.__rmsPool = pool;
  globalCache.__rmsPrisma = prisma;
}

export type Database = PrismaClient;

/**
 * Round-trips a trivial query. Throws the underlying driver error on failure —
 * callers translate it, so the real cause always reaches the logs rather than
 * being flattened into a boolean.
 */
export async function verifyDatabaseConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
  // The pool is ours, not Prisma's, so it must be closed explicitly.
  await pool.end();
}
