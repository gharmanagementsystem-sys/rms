import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CurrentUser, DateFormatPreference, Language, ThemePreference } from '@rms/shared';
import { ApiError } from '../../api/client';
import { currentLanguage, setLanguage } from '../../i18n';
import { useDateFormat } from '../../lib/calendar/DateFormatProvider';
import { logDiagnostic } from '../../lib/diagnostics';
import { useTheme } from '../../theme/ThemeProvider';
import { currentUserKey, useCurrentUser } from '../auth/useCurrentUser';
import { useUpdatePreferences } from './api';

/**
 * Reconciles account preferences between the server and local storage.
 * CLAUDE.md §23, §38, §50, §52.
 *
 * The rule, stated once so the rest of the app can rely on it:
 *
 *   **The server is authoritative. Local storage is a cold-start cache.**
 *
 * Local storage exists only so the app can paint in the right language and
 * theme before `/users/me` resolves — otherwise every launch would flash
 * English-on-light before correcting itself. The moment the server's value
 * arrives, it wins and overwrites the cache.
 *
 * That direction matters for a real reason: preferences are account-level, so
 * signing in on a second handset must bring the user's language with them, and
 * `notificationsEnabled` has to match what the server uses when deciding
 * whether to send a reminder at all. A local value that silently disagreed
 * would mean a user who turned notifications off still received them.
 *
 * Writes go the other way and are not fire-and-forget: the change is applied
 * locally for immediate feedback, then sent. If the request fails, the local
 * change is REVERTED and the failure is reported — §38 is explicit that an
 * offline write must not be faked as success.
 */

/** Patches the cached `/users/me` in place, so the switch reading it re-renders
 *  immediately instead of waiting for the mutation's own response. */
function setNotificationsEnabledInCache(queryClient: QueryClient, enabled: boolean): void {
  queryClient.setQueryData<CurrentUser>(currentUserKey, (previous) =>
    previous && previous.preferences
      ? { ...previous, preferences: { ...previous.preferences, notificationsEnabled: enabled } }
      : previous,
  );
}

export interface PreferenceSyncState {
  /** True while a preference write is in flight. */
  isSaving: boolean;
  /** Set when the last write failed. Cleared by the next successful one. */
  error: 'OFFLINE' | 'FAILED' | null;
  /** Server-backed notification opt-in. Null until `/users/me` has resolved. */
  notificationsEnabled: boolean | null;
  changeLanguage: (language: Language) => void;
  changeTheme: (theme: ThemePreference) => void;
  changeDateFormat: (dateFormat: DateFormatPreference) => void;
  changeNotificationsEnabled: (enabled: boolean) => void;
  retry: () => void;
  dismissError: () => void;
}

export function usePreferenceSync(): PreferenceSyncState {
  const { user } = useCurrentUser();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const { preference: dateFormatPreference, setPreference: setDateFormatPreference } =
    useDateFormat();
  const mutation = useUpdatePreferences();
  const queryClient = useQueryClient();

  const [error, setError] = useState<PreferenceSyncState['error']>(null);
  /** The write to repeat when the user taps retry. */
  const lastAttempt = useRef<Parameters<typeof mutation.mutate>[0] | null>(null);

  const serverPreferences = user?.preferences ?? null;

  /**
   * Server → local, on arrival and whenever the server value changes.
   *
   * Guarded against re-running for a value already applied, so a user actively
   * changing a preference is not fought by this effect mid-edit.
   */
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!serverPreferences) return;

    const signature = `${serverPreferences.language}|${serverPreferences.theme}|${serverPreferences.dateFormat}`;
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;

    if (serverPreferences.language !== currentLanguage()) {
      void setLanguage(serverPreferences.language);
    }
    if (serverPreferences.theme !== themePreference) {
      setThemePreference(serverPreferences.theme);
    }
    if (serverPreferences.dateFormat !== dateFormatPreference) {
      setDateFormatPreference(serverPreferences.dateFormat);
    }
  }, [
    serverPreferences,
    themePreference,
    setThemePreference,
    dateFormatPreference,
    setDateFormatPreference,
  ]);

  /**
   * Signing out must clear the applied marker, otherwise the next user to sign
   * in on this handset inherits the previous user's language until the
   * signature happens to differ.
   */
  useEffect(() => {
    if (!user) appliedRef.current = null;
  }, [user]);

  function send(input: Parameters<typeof mutation.mutate>[0], revert: () => void) {
    lastAttempt.current = input;
    setError(null);

    mutation.mutate(input, {
      onSuccess: () => {
        lastAttempt.current = null;
        setError(null);
      },
      onError: (failure) => {
        // Never silently swallowed (§38): the optimistic local change is undone
        // so the screen matches the server, and the failure is reported.
        revert();
        const offline = failure instanceof ApiError && failure.isRetryable;
        setError(offline ? 'OFFLINE' : 'FAILED');
        logDiagnostic('preferences.sync.failed', {
          status: failure instanceof ApiError ? failure.status : 0,
        });
      },
    });
  }

  return {
    isSaving: mutation.isPending,
    error,
    notificationsEnabled: serverPreferences?.notificationsEnabled ?? null,

    changeLanguage: (language) => {
      const previous = currentLanguage();
      void setLanguage(language);
      send({ language }, () => void setLanguage(previous));
    },

    changeTheme: (theme) => {
      const previous = themePreference;
      setThemePreference(theme);
      send({ theme }, () => setThemePreference(previous));
    },

    changeDateFormat: (dateFormat) => {
      const previous = dateFormatPreference;
      setDateFormatPreference(dateFormat);
      send({ dateFormat }, () => setDateFormatPreference(previous));
    },

    changeNotificationsEnabled: (enabled) => {
      // Unlike theme/language/dateFormat, this has no dedicated local
      // provider to flip immediately — it renders straight from the cached
      // `/users/me`. Writing the cache directly gets the same instant
      // feedback (§37) without waiting for the round trip, and the write is
      // reverted on failure exactly like the others.
      const previous = serverPreferences?.notificationsEnabled ?? null;
      setNotificationsEnabledInCache(queryClient, enabled);
      send({ notificationsEnabled: enabled }, () => {
        if (previous !== null) setNotificationsEnabledInCache(queryClient, previous);
      });
    },

    retry: () => {
      const attempt = lastAttempt.current;
      if (attempt) send(attempt, () => undefined);
    },

    dismissError: () => setError(null),
  };
}
