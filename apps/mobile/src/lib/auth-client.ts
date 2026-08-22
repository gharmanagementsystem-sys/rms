import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { setSessionCookieProvider } from '../api/client';

/**
 * Better Auth client. CLAUDE.md §49, §50.
 *
 * The session is held in expo-secure-store — Keychain on iOS, EncryptedSharedPreferences
 * on Android — never in AsyncStorage. AsyncStorage is plain, world-readable-on-a-rooted-device
 * storage, and a session token there is a standing account takeover.
 *
 * The Expo plugin also handles the OAuth round trip: it opens the system
 * browser, and Google redirects back into the app via the `rms://` scheme
 * declared in app.json. That scheme must be listed in the server's
 * trustedOrigins or the redirect is rejected.
 */

const baseURL = process.env.EXPO_PUBLIC_API_URL;

if (!baseURL) {
  // Fails loudly at startup rather than producing confusing network errors on
  // the first sign-in attempt.
  throw new Error(
    'EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to .env and set it.',
  );
}

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      // Must match `scheme` in app.json.
      scheme: 'rms',
      // Namespaces SecureStore keys so they cannot collide with other data.
      storagePrefix: 'rms',
      storage: SecureStore,
    }),
  ],
});

/**
 * Hands the session cookie to the HTTP client.
 *
 * Done here, at module scope, rather than in a bootstrap step a future change
 * could forget: anything that can make an authenticated request already
 * imports this module, so the wiring cannot be missed. The arrow is deliberate
 * — `getCookie` must be read per request, because the value changes on sign-in
 * and sign-out.
 */
setSessionCookieProvider(() => authClient.getCookie());

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
