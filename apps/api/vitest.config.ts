import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    /**
     * Tests must be hermetic. These are set before any module loads, and
     * `dotenv` does not overwrite existing variables, so a developer's real
     * .env can never leak into a test run — in particular, tests can never
     * reach a real database.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/rms_test',
      DATABASE_SSL: 'false',
      // Not a real secret — tests never issue a session that leaves the process.
      BETTER_AUTH_SECRET: 'test-only-signing-secret-at-least-32-characters',
      JOB_RUNNER_TOKEN: 'test-only-job-runner-token-at-least-24-chars',
    },
  },
});
