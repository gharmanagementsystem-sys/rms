import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser, UpdatePreferencesInput, UpdateProfileInput } from '@rms/shared';
import { api } from '../../api/client';
import { currentUserKey } from '../auth/useCurrentUser';

/**
 * The signed-in user's own profile and preferences. CLAUDE.md §23, §52.
 *
 * Both mutations return the full `CurrentUser`, so the cache is written
 * directly from the response rather than invalidated and refetched. That
 * matters here because `/users/me` gates the router — an invalidation would
 * briefly empty the query and could bounce the user through the loading gate
 * mid-edit.
 */

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      api.patch<CurrentUser>('/api/v1/users/me/profile', input),
    onSuccess: (user) => {
      queryClient.setQueryData(currentUserKey, user);
    },
  });
}

/**
 * Preference writes are fired the instant a user taps a choice (§37, and see
 * `usePreferenceSync`) rather than waiting on each one before allowing the
 * next, so two requests can genuinely resolve out of order — a user tapping
 * "Nepali" then "English" in quick succession must not end up with whichever
 * response happens to land second. `latestRequestId` makes a stale response
 * a no-op instead of clobbering a newer choice.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  const latestRequestId = useRef(0);

  return useMutation({
    mutationFn: async (input: UpdatePreferencesInput) => {
      const requestId = ++latestRequestId.current;
      const user = await api.patch<CurrentUser>('/api/v1/users/me/preferences', input);
      return { user, requestId };
    },
    onSuccess: ({ user, requestId }) => {
      if (requestId !== latestRequestId.current) return;
      queryClient.setQueryData(currentUserKey, user);
    },
  });
}

export function useSignOutOtherDevices() {
  return useMutation({
    mutationFn: () =>
      api.post<{ revokedSessions: number }>('/api/v1/users/me/sign-out-other-devices'),
  });
}
