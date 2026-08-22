/**
 * Security + completeness end-to-end check.
 *
 * Two jobs:
 *   1. IDOR / authorization — user B must never reach user A's records.
 *   2. The endpoints the mobile app now calls actually behave as the UI assumes.
 *
 * Run with `npm run test:security -w @rms/api` against a running dev server
 * seeded with demo data (`npm run db:seed`).
 */
import { randomUUID } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4000';
const PASSWORD = 'demo-Password-2026!';
const A = 'owner@demo.rms.local';
const B = 'renter@demo.rms.local';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function signIn(email) {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok)
    throw new Error(`sign-in ${email}: ${response.status} ${await response.text()}`);
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function client(cookie) {
  return async (method, path, body) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json;
    try {
      json = text.length ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, body: json };
  };
}

function todayAd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function main() {
  const a = client(await signIn(A));
  const b = client(await signIn(B));
  const anon = client(null);

  // ---------------------------------------------------------------- setup
  const property = await a('POST', '/api/v1/properties', { name: `SecTest ${Date.now()}` });
  const propertyId = property.body?.id;
  const unit = await a('POST', `/api/v1/properties/${propertyId}/units`, {
    label: 'Sec Room',
    type: 'ROOM',
  });
  const unitId = unit.body?.id;

  const rental = await a('POST', '/api/v1/rentals', {
    side: 'OWNER',
    unitId,
    frequency: 'MONTHLY',
    startDate: todayAd(),
    charges: [{ chargeType: 'RENT', pricingModel: 'FIXED', amountPaisa: 1_000_000 }],
  });
  const rentalId = rental.body?.id;
  check('setup: rental created', rental.status === 201, rental);

  // =============================================== 1. UNAUTHENTICATED ACCESS
  for (const [label, path] of [
    ['properties', '/api/v1/properties'],
    ['rentals', '/api/v1/rentals'],
    ['notifications', '/api/v1/notifications'],
    ['dashboard', '/api/v1/dashboard'],
    ['own profile', '/api/v1/users/me'],
  ]) {
    const res = await anon('GET', path);
    check(`anonymous cannot read ${label}`, res.status === 401, res.status);
  }

  const anonDevice = await anon('POST', '/api/v1/devices', {
    token: 'x'.repeat(40),
    platform: 'ANDROID',
  });
  check('anonymous cannot register a device', anonDevice.status === 401, anonDevice.status);

  const anonPrefs = await anon('PATCH', '/api/v1/users/me/preferences', { language: 'ne' });
  check('anonymous cannot change preferences', anonPrefs.status === 401, anonPrefs.status);

  // ====================================================== 2. IDOR — reads
  const idorChecks = [
    ['read the property', 'GET', `/api/v1/properties/${propertyId}`],
    ['read its units', 'GET', `/api/v1/properties/${propertyId}/units`],
    ['read the rental', 'GET', `/api/v1/rentals/${rentalId}`],
    ['read its periods', 'GET', `/api/v1/rentals/${rentalId}/periods`],
    ['read its summary', 'GET', `/api/v1/rentals/${rentalId}/summary`],
    ['read its payments', 'GET', `/api/v1/rentals/${rentalId}/payments`],
  ];
  for (const [label, method, path] of idorChecks) {
    const res = await b(method, path);
    check(`another user cannot ${label}`, res.status === 404, res.status);
  }

  // ==================================================== 3. IDOR — mutations
  const mutations = [
    ['edit the property', 'PATCH', `/api/v1/properties/${propertyId}`, { name: 'hijacked' }],
    ['archive the property', 'DELETE', `/api/v1/properties/${propertyId}`, undefined],
    [
      'add a unit to it',
      'POST',
      `/api/v1/properties/${propertyId}/units`,
      { label: 'x', type: 'ROOM' },
    ],
    ['edit a unit', 'PATCH', `/api/v1/properties/${propertyId}/units/${unitId}`, { label: 'x' }],
    ['archive a unit', 'DELETE', `/api/v1/properties/${propertyId}/units/${unitId}`, undefined],
    ['edit the rental', 'PATCH', `/api/v1/rentals/${rentalId}`, { notes: 'hijacked' }],
    [
      'replace its charges',
      'PUT',
      `/api/v1/rentals/${rentalId}/charges`,
      { charges: [{ chargeType: 'RENT', pricingModel: 'FIXED', amountPaisa: 1 }] },
    ],
    ['activate it', 'POST', `/api/v1/rentals/${rentalId}/activate`, undefined],
    ['end it', 'POST', `/api/v1/rentals/${rentalId}/end`, { endDate: todayAd() }],
  ];
  for (const [label, method, path, payload] of mutations) {
    const res = await b(method, path, payload);
    check(`another user cannot ${label}`, res.status === 404, res.status);
  }

  // ============================================ 4. PRIVILEGE ESCALATION
  const escalate = await b('POST', '/api/v1/rentals', {
    side: 'OWNER',
    // Naming someone else's unit must not attach to it.
    unitId,
    frequency: 'MONTHLY',
    startDate: todayAd(),
    charges: [{ chargeType: 'RENT', pricingModel: 'FIXED', amountPaisa: 100 }],
  });
  check(
    "a user cannot attach a rental to another owner's unit",
    escalate.status === 404,
    escalate.status,
  );

  const spoofProfile = await b('PATCH', '/api/v1/users/me/profile', {
    fullName: 'Spoof',
    email: A,
    emailVerified: true,
    id: 'someone-else',
  });
  // Unknown keys are stripped by the schema; the point is that identity is not
  // reassigned. Verify B's email is untouched.
  const bAfter = await b('GET', '/api/v1/users/me');
  check('identity fields in a profile body cannot reassign the account', bAfter.body?.email === B, {
    status: spoofProfile.status,
    email: bAfter.body?.email,
  });

  // ============================================= 5. INTERNAL JOB ENDPOINT
  /**
   * The property under test is "the job did not run". 401 (bad token) and 429
   * (throttled) both satisfy it — and which one comes back depends on how many
   * attempts the limiter has already seen this minute, so accepting either is
   * correct rather than lenient. A 200 would be the failure.
   */
  const rejected = (status) => status === 401 || status === 429;

  const noToken = await anon('POST', '/api/internal/jobs/generate-periods');
  check('internal jobs reject a request with no token', rejected(noToken.status), noToken.status);

  const badToken = await fetch(`${BASE}/api/internal/jobs/generate-periods`, {
    method: 'POST',
    headers: { origin: BASE, authorization: 'Bearer definitely-not-the-token' },
  });
  check('internal jobs reject a wrong token', rejected(badToken.status), badToken.status);

  const sessionOnly = await a('POST', '/api/internal/jobs/generate-periods');
  check(
    'a normal user session cannot trigger a job',
    rejected(sessionOnly.status),
    sessionOnly.status,
  );

  // ============================================ 6. NOTIFICATIONS
  const notifications = await a('GET', '/api/v1/notifications');
  check('notifications list responds', notifications.status === 200, notifications.status);
  check(
    'notifications carry an unread count for the badge',
    typeof notifications.body?.meta?.unreadCount === 'number',
    notifications.body?.meta,
  );

  const foreignNotification = await b('PATCH', `/api/v1/notifications/${randomUUID()}/read`);
  check(
    'marking an unknown/foreign notification read reports not-found',
    foreignNotification.status === 404,
    foreignNotification.status,
  );

  const readAll = await a('POST', '/api/v1/notifications/read-all');
  check(
    'mark-all-read responds with a count',
    readAll.status === 200 && typeof readAll.body?.markedRead === 'number',
    readAll.body,
  );

  const afterReadAll = await a('GET', '/api/v1/notifications');
  check(
    'unread count is zero after mark-all-read',
    afterReadAll.body?.meta?.unreadCount === 0,
    afterReadAll.body?.meta,
  );

  // ============================================ 7. DEVICES
  const token = `e2e-${randomUUID()}${'x'.repeat(10)}`;
  const reg = await a('POST', '/api/v1/devices', {
    token,
    platform: 'ANDROID',
    appVersion: '0.1.0',
    notificationsEnabled: true,
  });
  check('a device registers', reg.status === 201 && typeof reg.body?.id === 'string', reg);

  const reReg = await a('POST', '/api/v1/devices', { token, platform: 'ANDROID' });
  check(
    're-registering the same token is idempotent',
    reReg.status === 201 && reReg.body?.id === reg.body?.id,
    { first: reg.body?.id, second: reReg.body?.id },
  );

  // The handset changes hands: B signs in and registers the same token.
  const reassign = await b('POST', '/api/v1/devices', { token, platform: 'ANDROID' });
  check(
    'registering an existing token reassigns it to the new user',
    reassign.status === 201 && reassign.body?.id === reg.body?.id,
    reassign.body,
  );

  const foreignRevoke = await a('DELETE', `/api/v1/devices/${reg.body?.id}`);
  check(
    'the previous owner can no longer revoke the reassigned device',
    foreignRevoke.status === 404,
    foreignRevoke.status,
  );

  const ownRevoke = await b('DELETE', `/api/v1/devices/${reg.body?.id}`);
  check('the current owner can revoke it', ownRevoke.status === 204, ownRevoke.status);

  const badPlatform = await a('POST', '/api/v1/devices', {
    token: 'y'.repeat(40),
    platform: 'WINDOWS',
  });
  check('an unknown device platform is rejected', badPlatform.status === 422, badPlatform.status);

  const shortToken = await a('POST', '/api/v1/devices', { token: 'short', platform: 'ANDROID' });
  check('an implausibly short token is rejected', shortToken.status === 422, shortToken.status);

  // ============================================ 8. PREFERENCES + PROFILE
  const prefs = await a('PATCH', '/api/v1/users/me/preferences', {
    language: 'ne',
    notificationsEnabled: false,
  });
  check(
    'preferences update returns the whole user',
    prefs.status === 200 && prefs.body?.preferences?.language === 'ne',
    prefs.body?.preferences,
  );
  check(
    'notification opt-out persists',
    prefs.body?.preferences?.notificationsEnabled === false,
    prefs.body?.preferences,
  );

  const restored = await a('PATCH', '/api/v1/users/me/preferences', {
    language: 'en',
    notificationsEnabled: true,
  });
  check(
    'preferences can be changed back',
    restored.body?.preferences?.language === 'en',
    restored.body?.preferences,
  );

  const emptyPrefs = await a('PATCH', '/api/v1/users/me/preferences', {});
  check('an empty preference patch is rejected', emptyPrefs.status === 422, emptyPrefs.status);

  const badLanguage = await a('PATCH', '/api/v1/users/me/preferences', { language: 'fr' });
  check('an unsupported language is rejected', badLanguage.status === 422, badLanguage.status);

  const tooManyReminders = await a('PATCH', '/api/v1/users/me/preferences', {
    rentReminderDays: [1, 2, 3, 4, 5, 6, 7],
  });
  check(
    'an excessive reminder list is rejected',
    tooManyReminders.status === 422,
    tooManyReminders.status,
  );

  const profile = await a('PATCH', '/api/v1/users/me/profile', { district: 'Lalitpur' });
  check(
    'profile update returns the whole user',
    profile.status === 200 && profile.body?.profile?.district === 'Lalitpur',
    profile.body?.profile,
  );

  const badPhone = await a('PATCH', '/api/v1/users/me/profile', { phone: '12345' });
  check('an invalid Nepali phone number is rejected', badPhone.status === 422, badPhone.status);

  const emptyProfile = await a('PATCH', '/api/v1/users/me/profile', {});
  check('an empty profile patch is rejected', emptyProfile.status === 422, emptyProfile.status);

  // ============================================ 9. EDIT RULES
  const editTerms = await a('PATCH', `/api/v1/rentals/${rentalId}`, { notes: 'Edited note' });
  check('the owner can edit rental terms', editTerms.status === 200, editTerms.status);

  const editSchedule = await a('PATCH', `/api/v1/rentals/${rentalId}`, {
    startDate: '2020-01-01',
    frequency: 'YEARLY',
  });
  // Unknown keys are stripped; the schedule must be unchanged either way.
  const afterScheduleAttempt = await a('GET', `/api/v1/rentals/${rentalId}`);
  check(
    'the billing schedule cannot be changed through an edit',
    afterScheduleAttempt.body?.periodDays === 30 &&
      afterScheduleAttempt.body?.startDate === rental.body?.startDate,
    { status: editSchedule.status, periodDays: afterScheduleAttempt.body?.periodDays },
  );

  const badOffset = await a('PATCH', `/api/v1/rentals/${rentalId}`, { dueOffsetDays: 400 });
  check('a due offset beyond the period is rejected', badOffset.status === 422, badOffset.status);

  // Charge replacement must not rewrite history.
  await a('POST', `/api/v1/rentals/${rentalId}/activate`);
  const beforeCharges = await a('GET', `/api/v1/rentals/${rentalId}/periods`);
  const originalTotal = beforeCharges.body?.data?.[0]?.totalPaisa;

  const replaced = await a('PUT', `/api/v1/rentals/${rentalId}/charges`, {
    charges: [{ chargeType: 'RENT', pricingModel: 'FIXED', amountPaisa: 9_999_900 }],
  });
  check('charges can be replaced', replaced.status === 200, replaced.status);

  const afterCharges = await a('GET', `/api/v1/rentals/${rentalId}/periods`);
  check(
    'an existing period keeps the price it was billed at',
    afterCharges.body?.data?.[0]?.totalPaisa === originalTotal,
    { before: originalTotal, after: afterCharges.body?.data?.[0]?.totalPaisa },
  );

  const noRent = await a('PUT', `/api/v1/rentals/${rentalId}/charges`, {
    charges: [{ chargeType: 'WATER', pricingModel: 'FIXED', amountPaisa: 50_000 }],
  });
  check('a charge set with no rent is rejected', noRent.status === 422, noRent.status);

  // ============================================ 10. ARCHIVE RULES
  const archiveWhileActive = await a('DELETE', `/api/v1/properties/${propertyId}`);
  check(
    'a property with an active rental cannot be archived',
    archiveWhileActive.status === 409,
    archiveWhileActive.status,
  );

  const archiveOccupiedUnit = await a('DELETE', `/api/v1/properties/${propertyId}/units/${unitId}`);
  check(
    'an occupied unit cannot be archived',
    archiveOccupiedUnit.status === 409,
    archiveOccupiedUnit.status,
  );

  const setOccupied = await a('PATCH', `/api/v1/properties/${propertyId}/units/${unitId}`, {
    availability: 'OCCUPIED',
  });
  check(
    'availability cannot be set to OCCUPIED by hand',
    setOccupied.status === 422,
    setOccupied.status,
  );

  await a('POST', `/api/v1/rentals/${rentalId}/end`, { endDate: todayAd() });

  const archiveAfterEnd = await a('DELETE', `/api/v1/properties/${propertyId}`);
  check(
    'a property can be archived once its rentals have ended',
    archiveAfterEnd.status === 200 && archiveAfterEnd.body?.archivedAt !== null,
    { status: archiveAfterEnd.status, archivedAt: archiveAfterEnd.body?.archivedAt },
  );

  // Idempotent by design: DELETE repeated is a no-op success, and the
  // archivedAt stamp must not be moved by the second call.
  const archiveTwice = await a('DELETE', `/api/v1/properties/${propertyId}`);
  check(
    'archiving an already-archived property is an idempotent no-op',
    archiveTwice.status === 200 &&
      archiveTwice.body?.archivedAt === archiveAfterEnd.body?.archivedAt,
    { first: archiveAfterEnd.body?.archivedAt, second: archiveTwice.body?.archivedAt },
  );

  const historyAfterArchive = await a('GET', `/api/v1/rentals/${rentalId}/periods`);
  check(
    'accounting history survives archiving the property',
    (historyAfterArchive.body?.data?.length ?? 0) > 0,
    historyAfterArchive.body?.data?.length,
  );

  const editEnded = await a('PATCH', `/api/v1/rentals/${rentalId}`, { notes: 'after the end' });
  check('an ended rental cannot be edited', editEnded.status === 409, editEnded.status);

  const chargesAfterEnd = await a('PUT', `/api/v1/rentals/${rentalId}/charges`, {
    charges: [{ chargeType: 'RENT', pricingModel: 'FIXED', amountPaisa: 1 }],
  });
  check(
    'an ended rental cannot have its charges replaced',
    chargesAfterEnd.status === 409,
    chargesAfterEnd.status,
  );

  // ============================================ 11. INPUT VALIDATION
  const badUuid = await a('GET', '/api/v1/rentals/not-a-uuid');
  check(
    'a malformed id is rejected as validation, not a 500',
    badUuid.status === 422,
    badUuid.status,
  );

  const badLimit = await a('GET', '/api/v1/properties?limit=9999');
  check('an out-of-range pagination limit is rejected', badLimit.status === 422, badLimit.status);

  const badCursor = await a('GET', '/api/v1/properties?cursor=nonsense');
  check('a malformed cursor is rejected', badCursor.status === 422, badCursor.status);

  const negativeWard = await a('POST', '/api/v1/properties', { name: 'x', ward: -5 });
  check('a negative ward is rejected', negativeWard.status === 422, negativeWard.status);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log('failed:', failures.join(' | '));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
