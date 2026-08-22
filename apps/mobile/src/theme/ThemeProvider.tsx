import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'nativewind';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemePreference } from '@rms/shared';

/**
 * Theme state. CLAUDE.md §26, §50.
 *
 * Stored in AsyncStorage, not SecureStore: a theme choice is a UI preference,
 * not a secret. Only authentication material goes in secure storage.
 *
 * Dark mode is a designed palette, not an inversion — see global.css.
 */

const STORAGE_KEY = 'rms.theme';

interface ThemeContextValue {
  /** What the user chose, including 'system'. */
  preference: ThemePreference;
  /** What is actually being displayed right now. */
  resolved: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
  /** False until the stored choice has been read. */
  isReady: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [preference, setStoredPreference] = useState<ThemePreference>('system');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isThemePreference(stored)) {
          setStoredPreference(stored);
          setColorScheme(stored);
        }
      })
      .catch(() => {
        // A failed preference read must not block the app from starting; the
        // system default is a perfectly good fallback.
      })
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [setColorScheme]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setStoredPreference(next);
      setColorScheme(next);
      // Fire and forget: the choice has already been applied on screen, and a
      // storage failure should not surface as an error the user can act on.
      void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
    },
    [setColorScheme],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved: colorScheme === 'dark' ? 'dark' : 'light',
      setPreference,
      isReady,
    }),
    [preference, colorScheme, setPreference, isReady],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return context;
}
