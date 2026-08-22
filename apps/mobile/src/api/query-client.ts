import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/**
 * Server-state configuration. CLAUDE.md §37, §38, §52.
 *
 * Server state lives here and nowhere else — it is deliberately not copied into
 * a global store, so there is one source of truth per resource.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Nepali mobile data is often slow and metered; refetching a rent
        // ledger on every focus wastes the user's money for little benefit.
        staleTime: 60_000,
        gcTime: 24 * 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Retrying a 422 or a 403 will fail identically every time and only
          // delays showing the user what is wrong.
          if (error instanceof ApiError && !error.isRetryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        /**
         * Mutations are NEVER retried automatically.
         *
         * A retried payment could be recorded twice. The server accepts an
         * idempotency key precisely so the CLIENT can decide when a retry is
         * safe, deliberately, rather than a library doing it silently (§37).
         */
        retry: false,
      },
    },
  });
}
