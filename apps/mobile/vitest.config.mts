import { defineConfig } from 'vitest/config';

/**
 * Tests for the app's PURE modules only — calendar conversion, formatting and
 * the API client's error mapping.
 *
 * React Native components are deliberately out of scope here: rendering them
 * needs the RN preset and a much heavier setup, and the logic worth protecting
 * has been kept out of components anyway.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * The API client refuses to build a URL without this and throws at
     * start-up, which is the right behaviour in the app — a missing base URL
     * should fail loudly rather than produce confusing network errors. Tests
     * that exercise `request()` need a value, so one is supplied here rather
     * than requiring every contributor to export it before running the suite.
     *
     * Deliberately not a real host: nothing here should reach the network, and
     * a bogus domain makes it obvious if something ever does.
     */
    env: {
      EXPO_PUBLIC_API_URL: 'http://api.test.invalid',
    },
  },
});
