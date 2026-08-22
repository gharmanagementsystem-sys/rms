import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CurrentUser } from '@rms/shared';
import { ApiError, api } from '../../api/client';
import { authClient } from '../../lib/auth-client';

/**
 * The signed-in user, or null.
 *
 * Two sources are combined deliberately:
 *
 *  • Better Auth's `useSession` knows whether a session token exists locally.
 *    It is instant but says nothing about the account's server-side state.
 *  • `/users/me` is authoritative: it reveals whether the session is still
 *    valid, whether the email is verified, and whether onboarding is done.
 *
 * The router gates on the second. Trusting only the local token would let a
 * revoked session render the app until the first request happened to fail.
 */

export const currentUserKey = ['users', 'me'] as const;

export interface SessionState {
  user: CurrentUser | null;
  /** True while the answer is genuinely unknown — show a splash, not a screen. */
  isLoading: boolean;
  isSignedIn: boolean;
  /** Signed in but has not finished onboarding. */
  needsOnboarding: boolean;
  refetch: () => void;
}

export function useCurrentUser(): SessionState {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const hasLocalSession = Boolean(session?.user);

  const query = useQuery({
    queryKey: currentUserKey,
    queryFn: () => api.get<CurrentUser>('/api/v1/users/me'),
    // Nothing to ask for without a token; skipping avoids a guaranteed 401 on
    // every cold start of a signed-out app.
    enabled: hasLocalSession,
    retry: (failureCount, error) => {
      // A 401 means the session is gone. Retrying cannot bring it back and only
      // delays showing the sign-in screen.
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
    staleTime: 30_000,
  });

  const rawIsLoading = isSessionPending || (hasLocalSession && query.isPending);

  /**
   * `isLoading` is true only until the session has resolved for the FIRST
   * time, not on every later toggle of `rawIsLoading`.
   *
   * `authClient.useSession()` revalidates in the background after any auth
   * mutation — including a plain sign-up, which never even creates a session
   * — and `isSessionPending` flips true again while it does. `AuthGate` treats
   * `isLoading` as "the answer is genuinely unknown, show a blocking splash",
   * which unmounts the whole app underneath it. Without this guard, that
   * unmount discarded whatever screen state was on screen at the time — the
   * sign-up screen's "check your email" card, set entirely in local
   * component state, was wiped the instant the background revalidation
   * fired, which is what made a successful sign-up appear to skip straight
   * to the sign-in screen.
   */
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);
  useEffect(() => {
    if (!rawIsLoading && !hasResolvedOnce) setHasResolvedOnce(true);
  }, [rawIsLoading, hasResolvedOnce]);

  const isLoading = rawIsLoading && !hasResolvedOnce;

  // A 401 from /users/me outranks the local token: the server has the last word
  // on whether this session is still valid.
  const isRejected = query.error instanceof ApiError && query.error.status === 401;
  const user = isRejected ? null : (query.data ?? null);

  return {
    user,
    isLoading,
    isSignedIn: user !== null,
    needsOnboarding: user !== null && !user.onboardingCompleted,
    refetch: () => void query.refetch(),
  };
}
