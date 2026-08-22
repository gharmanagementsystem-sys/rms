/**
 * Dynamic Expo config, layered on top of app.json.
 *
 * app.json remains the source of truth for everything static; Expo parses it
 * first and hands the result here as `config`. This file exists for exactly
 * one thing that cannot be expressed statically: enabling Android cleartext
 * (plain HTTP) traffic for LOCAL TESTING BUILDS ONLY.
 *
 * WHY THIS IS NEEDED
 * Android 9+ (API 28) blocks cleartext HTTP in release builds. A `preview`
 * APK is a release build, so an app pointed at a `http://<lan-ip>:4000`
 * development API installs and launches fine but fails every single request
 * with an opaque network error — which looks like a broken app rather than a
 * blocked protocol.
 *
 * WHY IT IS GATED
 * Shipping `usesCleartextTraffic` to the Play Store would let the production
 * app talk to any unencrypted endpoint, downgrading transport security for
 * real users' financial data (CLAUDE.md §32). Rather than a flag someone has
 * to remember to remove before release, it is opt-in per build profile: only
 * `eas.json`'s `preview` profile sets EXPO_ALLOW_CLEARTEXT, so the production
 * profile is secure by default and stays that way without anyone's vigilance.
 *
 * Once the API is deployed behind HTTPS, delete EXPO_ALLOW_CLEARTEXT from
 * eas.json and this whole file can go with it.
 */

const ALLOW_CLEARTEXT = process.env.EXPO_ALLOW_CLEARTEXT === 'true';

/** Adds `android.usesCleartextTraffic` to the existing expo-build-properties
 *  entry, preserving the Proguard/resource-shrinking settings beside it. */
function withCleartext(plugins) {
  return plugins.map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;

    const [name, options = {}] = plugin;
    return [name, { ...options, android: { ...options.android, usesCleartextTraffic: true } }];
  });
}

module.exports = ({ config }) => {
  if (!ALLOW_CLEARTEXT) return config;

  return { ...config, plugins: withCleartext(config.plugins ?? []) };
};
