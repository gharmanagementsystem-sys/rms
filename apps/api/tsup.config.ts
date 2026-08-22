import { defineConfig } from 'tsup';

export default defineConfig({
  // Single entry. Migrations are applied by the Prisma CLI
  // (`npm run db:deploy -w @rms/api`) in Render's pre-deploy command, so there
  // is no hand-written migration runner to bundle.
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // @rms/shared ships TypeScript source, so it must be bundled rather than left
  // as an external import that Node could not resolve at runtime on Render.
  noExternal: ['@rms/shared'],
});
