import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LANGUAGES, type Language } from '@rms/shared';
import enAuth from './en/auth.json';
import enCommon from './en/common.json';
import enAccount from './en/account.json';
import enDashboard from './en/dashboard.json';
import enProperties from './en/properties.json';
import enRentals from './en/rentals.json';
import enNotifications from './en/notifications.json';
import enOnboarding from './en/onboarding.json';
import neAuth from './ne/auth.json';
import neCommon from './ne/common.json';
import neAccount from './ne/account.json';
import neDashboard from './ne/dashboard.json';
import neProperties from './ne/properties.json';
import neRentals from './ne/rentals.json';
import neNotifications from './ne/notifications.json';
import neOnboarding from './ne/onboarding.json';

/**
 * Internationalisation. CLAUDE.md §27.
 *
 * Resources are namespaced per feature so a screen loads only its own strings
 * and translators work on one coherent file at a time.
 *
 * No user-facing string is ever hard-coded in a component, and sentences are
 * never assembled from fragments — Nepali word order differs from English, so
 * concatenation does not survive translation. Use interpolation instead.
 */

const STORAGE_KEY = 'rms.language';

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    onboarding: enOnboarding,
    dashboard: enDashboard,
    properties: enProperties,
    rentals: enRentals,
    account: enAccount,
    notifications: enNotifications,
  },
  ne: {
    common: neCommon,
    auth: neAuth,
    onboarding: neOnboarding,
    dashboard: neDashboard,
    properties: neProperties,
    rentals: neRentals,
    account: neAccount,
    notifications: neNotifications,
  },
} as const;

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** The device's language, if we support it. */
function deviceLanguage(): Language {
  const tag = getLocales()[0]?.languageCode;
  return isLanguage(tag) ? tag : 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  // Replaced by the stored choice as soon as it is read.
  lng: deviceLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [
    'common',
    'auth',
    'onboarding',
    'dashboard',
    'properties',
    'rentals',
    'account',
    'notifications',
  ],
  interpolation: {
    // React Native has no HTML to escape into, and escaping mangles Devanagari.
    escapeValue: false,
  },
  returnNull: false,
});

/**
 * Applies the user's stored language.
 *
 * Called once at start-up. The device language is the initial guess, but an
 * explicit choice always wins — a Nepali speaker with an English phone should
 * not have to change their OS setting.
 */
export async function restoreStoredLanguage(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored) && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    // The device language remains in effect; not worth surfacing.
  }
}

export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  await AsyncStorage.setItem(STORAGE_KEY, language).catch(() => undefined);
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : 'en';
}

/** True when the active language is written in Devanagari, which needs extra leading. */
export function isDevanagariScript(): boolean {
  return currentLanguage() === 'ne';
}

export { i18n };
