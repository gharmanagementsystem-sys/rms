import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../src/config/env';

/**
 * Confirms the Firebase push credentials are wired up correctly.
 *
 * Run: npm run verify:fcm -w @rms/api
 *
 * WHY THIS EXISTS: the service account key is a real secret — it contains a
 * private key granting server-side access to the Firebase project. Nobody
 * should ever paste it into a chat, a ticket, or a commit to check whether it
 * is right. This script answers that question locally and prints only
 * non-secret identifiers (project id, client email, package name), so the
 * result can be shared safely while the key never leaves the machine.
 *
 * It verifies four things that are each independently easy to get wrong:
 *
 *   1. The base64 blob decodes to valid service-account JSON.
 *   2. firebase-admin accepts the key — which proves it is a real, unrevoked
 *      credential rather than a well-formed but useless file.
 *   3. `google-services.json` exists for the mobile app.
 *   4. The project id and Android package name MATCH across the two files and
 *      app.json. A mismatch here is the single most common reason push
 *      "silently does nothing": both sides look configured, but they point at
 *      different Firebase projects or a different package name, and FCM simply
 *      refuses the registration.
 */

const MOBILE_DIR = join(process.cwd(), '..', 'mobile');

interface ServiceAccount {
  type?: string;
  project_id?: string;
  private_key?: string;
  client_email?: string;
}

function fail(message: string, hint?: string): never {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}

async function main(): Promise<void> {
  console.log('\nFirebase push configuration check\n');

  // ---- 1. The server credential -------------------------------------------
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    fail(
      'FIREBASE_SERVICE_ACCOUNT is not set.',
      'Add it to apps/api/.env — see the Firebase section of the README.',
    );
  }

  let account: ServiceAccount;
  try {
    const decoded = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
    account = JSON.parse(decoded) as ServiceAccount;
  } catch {
    fail(
      'FIREBASE_SERVICE_ACCOUNT is not valid base64-encoded JSON.',
      'Re-encode the downloaded key with the command in the README, on one line.',
    );
  }

  if (account.type !== 'service_account') {
    fail(
      `Expected a service account key, got type "${account.type ?? 'unknown'}".`,
      'Download it from Project settings → Service accounts → Generate new private key.',
    );
  }
  if (!account.project_id || !account.private_key || !account.client_email) {
    fail('The service account JSON is missing project_id, private_key or client_email.');
  }

  ok('FIREBASE_SERVICE_ACCOUNT decodes to a valid service account key');
  console.log(`      project:       ${account.project_id}`);
  console.log(`      service email: ${account.client_email}`);

  // ---- 2. Does Firebase actually accept it? -------------------------------
  const appName = 'fcm-verify';
  try {
    const app =
      getApps().find((existing) => existing.name === appName) ??
      initializeApp({ credential: cert(account as Parameters<typeof cert>[0]) }, appName);

    // Forces the credential to be exchanged for an access token. A malformed,
    // revoked or wrong-project key fails here rather than at 3am in a job run.
    await getMessaging(app).send({ token: 'verification-probe', data: {} }, true);

    ok('Firebase accepted the credential (dry-run send authorised)');
    await deleteApp(app);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';

    /**
     * A rejected *token* means authentication succeeded and only the fake probe
     * was refused — which is exactly the outcome that proves the key works.
     *
     * Matched on the error code first and the message second: FCM has worded
     * this several ways ("registration token is not valid", "invalid
     * registration token"), and matching prose alone made this check report a
     * working credential as broken.
     */
    const tokenWasRejected =
      /invalid-argument|registration-token-not-registered/i.test(code) ||
      /registration token|invalid-argument/i.test(message);

    if (tokenWasRejected) {
      ok('Firebase accepted the credential (probe token rejected, as expected)');
      const app = getApps().find((existing) => existing.name === appName);
      if (app) await deleteApp(app);
    } else {
      fail(`Firebase rejected the credential: ${message}`);
    }
  }

  // ---- 3. The mobile client config ----------------------------------------
  const googleServicesPath = join(MOBILE_DIR, 'google-services.json');
  if (!existsSync(googleServicesPath)) {
    fail(
      'apps/mobile/google-services.json is missing.',
      'Download it from Firebase → Project settings → Your apps → Android.',
    );
  }

  const googleServices = JSON.parse(readFileSync(googleServicesPath, 'utf8')) as {
    project_info?: { project_id?: string };
    client?: { client_info?: { android_client_info?: { package_name?: string } } }[];
  };

  const clientProjectId = googleServices.project_info?.project_id;
  const packageNames = (googleServices.client ?? [])
    .map((entry) => entry.client_info?.android_client_info?.package_name)
    .filter((name): name is string => typeof name === 'string');

  ok('apps/mobile/google-services.json is present');

  // ---- 4. Everything must agree -------------------------------------------
  if (clientProjectId !== account.project_id) {
    fail(
      `Project mismatch: the server key is for "${account.project_id}" but google-services.json is for "${clientProjectId}".`,
      'Both must come from the same Firebase project, or no notification will ever arrive.',
    );
  }
  ok(`Both sides point at the same project (${account.project_id})`);

  const appJson = JSON.parse(readFileSync(join(MOBILE_DIR, 'app.json'), 'utf8')) as {
    expo?: { android?: { package?: string; googleServicesFile?: string } };
  };
  const expectedPackage = appJson.expo?.android?.package;

  if (!expectedPackage || !packageNames.includes(expectedPackage)) {
    fail(
      `google-services.json has no Android app for "${expectedPackage}" (it has: ${packageNames.join(', ') || 'none'}).`,
      'Add an Android app in Firebase with exactly that package name and re-download the file.',
    );
  }
  ok(`google-services.json covers the package ${expectedPackage}`);

  if (appJson.expo?.android?.googleServicesFile !== './google-services.json') {
    fail(
      'app.json is missing "googleServicesFile" under expo.android.',
      'Add:  "googleServicesFile": "./google-services.json"',
    );
  }
  ok('app.json points at google-services.json');

  console.log('\n  Push configuration looks correct. Build a development client next.\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
