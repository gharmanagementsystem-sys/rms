import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DateFormatPreference } from '@rms/shared';

/**
 * Which calendar dates are displayed in, app-wide. CLAUDE.md §46, §47.
 *
 * Mirrors `ThemeProvider` deliberately: same shape, same AsyncStorage-then-
 * server-wins reconciliation via `usePreferenceSync`, same reason for existing
 * as its own context rather than a plain module getter — every screen that
 * shows a date needs to re-render the moment this changes, not just the next
 * time it happens to remount.
 *
 * Presentation only. Every date is still stored, sent to the API, and
 * computed in AD regardless of this choice (§13) — this decides how
 * `formatDate` renders an AD date on screen, nothing else.
 */

const STORAGE_KEY = 'rms.dateFormat';

interface DateFormatContextValue {
  preference: DateFormatPreference;
  setPreference: (preference: DateFormatPreference) => void;
  isReady: boolean;
}

const DateFormatContext = createContext<DateFormatContextValue | null>(null);

function isDateFormatPreference(value: unknown): value is DateFormatPreference {
  return value === 'BS' || value === 'AD';
}

export function DateFormatProvider({ children }: { children: React.ReactNode }) {
  const [preference, setStoredPreference] = useState<DateFormatPreference>('BS');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isDateFormatPreference(stored)) setStoredPreference(stored);
      })
      .catch(() => {
        // A failed preference read must not block the app from starting; BS is
        // a perfectly good default.
      })
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: DateFormatPreference) => {
    setStoredPreference(next);
    // Fire and forget: the choice has already been applied on screen, and a
    // storage failure should not surface as an error the user can act on.
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<DateFormatContextValue>(
    () => ({ preference, setPreference, isReady }),
    [preference, setPreference, isReady],
  );

  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>;
}

export function useDateFormat(): DateFormatContextValue {
  const context = useContext(DateFormatContext);
  if (!context) {
    throw new Error('useDateFormat must be used inside DateFormatProvider');
  }
  return context;
}
