import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Same two-location lookup as src/config/env.ts, so the CLI and the running
// server always read the same DATABASE_URL.
dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * Only the CLI reads this — `migrate`, `db pull`, `studio`. The running
 * application never uses it: the server builds its own connection through a
 * driver adapter in src/db/client.ts, using the validated `env` object.
 *
 * The URL is read straight from process.env rather than from src/config/env.ts
 * because the CLI runs outside the application and must not pull in the whole
 * server bootstrap, which calls process.exit on unrelated missing variables.
 *
 * A missing URL is deliberately NOT thrown here. `prisma generate` does not
 * need a database, and it runs on `postinstall` — throwing would break
 * `npm install` on a fresh clone that has no .env yet. The migrate commands
 * report a missing URL clearly on their own.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
