# Rent Management Nepal

Rent management and rent accounting for the Nepalese market — an Expo/React
Native app backed by an Express + TypeScript API on Neon PostgreSQL.

`CLAUDE.md` at the repository root is the engineering source of truth. Where a
decision deliberately departs from it, there is an ADR in `docs/decisions/`.

**Rental periods are fixed-duration**: MONTHLY is exactly 30 days and YEARLY is
exactly 365 days, measured in elapsed days from the rental start date with
explicit inclusive boundaries. They are not calendar months or years, and no
month-end, February, leap-year or same-day-next-month logic applies. See
`CLAUDE.md` §13 and [ADR 0001](docs/decisions/0001-fixed-length-rental-periods.md).

## Requirements

- Node.js **≥ 20.19**
- npm 10+ (the repo uses npm workspaces; see "Why npm" below)
- Expo Go on a physical Android/iOS device for development

## Layout

```
apps/
  api/        Express + TypeScript API (deploys to Render)
  mobile/     Expo + React Native + NativeWind app
packages/
  shared/     Contracts shared by both: enums, zod schemas, money, constants
docs/
  env.md      Every environment variable, documented
  decisions/  ADRs for choices that depart from CLAUDE.md
```

`packages/shared` may depend on **zod only**. It is bundled into the mobile app
by Metro, so a Node-only import (`fs`, `crypto`, `process`) will break the
bundler. Keep it pure.

## Getting started

```bash
npm install                              # also runs `prisma generate`
cp apps/api/.env.example apps/api/.env   # then fill it in
```

Database commands (from the repo root):

```bash
npm run db:generate -w @rms/api   # regenerate Prisma Client after a schema edit
npm run db:migrate  -w @rms/api   # create + apply a migration (development)
npm run db:deploy   -w @rms/api   # apply pending migrations (CI / Render)
npm run db:status   -w @rms/api   # show migration state
npm run db:studio   -w @rms/api   # browse data
```

## Running it

You need **two terminals**. The API must be running before the app is useful.

**Terminal 1 — API**

```bash
npm run api          # http://localhost:4000/api/v1/health
```

**Terminal 2 — mobile app**

```bash
npm run mobile       # then scan the QR code with Expo Go
```

### The phone cannot reach `localhost`

On a physical device, `localhost` means _the phone itself_. `apps/mobile/.env`
must therefore point at your machine's Wi-Fi address:

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:4000
```

Find it with `ipconfig` (Windows) or `ifconfig | grep inet` (macOS/Linux) and
pick the **Wi-Fi** adapter — a `192.168.56.x` address is usually a VirtualBox or
WSL virtual adapter that the phone cannot see.

The same address must appear in the root `.env` as `BETTER_AUTH_URL`, and in
`CORS_ORIGINS`. Both must be reachable from the phone, and the phone and
computer must be on the same Wi-Fi network.

| Testing on               | `EXPO_PUBLIC_API_URL`        |
| ------------------------ | ---------------------------- |
| Physical phone (Expo Go) | `http://<your-wifi-ip>:4000` |
| Android emulator         | `http://10.0.2.2:4000`       |
| iOS simulator            | `http://localhost:4000`      |

If sign-in returns **`INVALID_ORIGIN`**, the address the app is calling is not
listed in `BETTER_AUTH_URL` or `CORS_ORIGINS`. That is the usual cause.

### Demo data

Signing up into an empty account shows empty dashboards, which does not tell you
much. Seed a realistic portfolio instead:

```bash
npm run db:seed   -w @rms/api     # create demo accounts and data
npm run db:unseed -w @rms/api     # remove them again
```

Both accounts use the password `demo-Password-2026!`:

| Account                 | Shows                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `owner@demo.rms.local`  | 1 property, 4 units (3 occupied, 1 free), one badly overdue tenant, one partly paid, one due today |
| `renter@demo.rms.local` | A tenancy with rent owing, a deposit held separately, and an unread electricity meter              |

The seed goes through Better Auth, so passwords are hashed exactly as a real
sign-up would be. It refuses to run when `NODE_ENV=production`.

### What works today

Every planned V1 workflow is implemented end to end: sign up, email
verification, sign in, onboarding, both dashboards, properties and units
(create, edit, archive), rentals (create, start, edit, end), rent and charge
configuration, payment recording, meter readings, payment history, the
notification centre, account preferences and profile editing, and sign out.

⚠️ **Two things cannot be tested this way.** Google sign-in needs an
`https://` callback, which Google will not accept for a private IP — use the
Android emulator on `localhost`, or an ngrok domain. And **push notifications do
not work in Expo Go at all** (removed in SDK 53); they need a development build.

### Verification emails

Email goes out through **Resend** when `RESEND_API_KEY` and `EMAIL_FROM` are
set, or over SMTP when the `SMTP_*` variables are. Resend wins when both are
configured, because it returns a message id and a readable error body — an
unverified domain or a rejected address is diagnosable, whereas the same
failures over SMTP tend to look like a timeout.

With neither configured, messages are **written to the API terminal** instead of
being sent. Copy the link from there and open it. The seeded accounts are
verified already, so this only affects accounts you create yourself.

Three transactional emails exist, each in English and Nepali:

| Email                     | When                    | Notes                                        |
| ------------------------- | ----------------------- | -------------------------------------------- |
| Confirm email address     | Sign-up                 | Single-use link, expires in an hour          |
| Reset your password       | Reset requested         | States plainly that nothing has changed yet  |
| Your password was changed | After a reset completes | Security alert; deliberately carries no link |

Preview or send them all:

```bash
# Write HTML files you can open in a browser
npm run email:preview -w @rms/api

# Send for real, to check how a live client renders them
npm run email:preview -w @rms/api -- --send you@example.com
```

**The From domain must be verified with Resend.** Any local part on a verified
domain works, so `no-reply@`, `hello@` and `alerts@` are all available without
further setup.

Two failure modes worth recognising, because both are quiet:

- Using `onboarding@resend.dev` (Resend's no-setup sender) delivers **only to
  the Resend account owner's own address** and rejects every other recipient
  with a 403. Fine for a smoke test; it means nobody can register.
- A **send-only restricted API key** cannot call read endpoints such as
  `GET /domains`, which returns 401 `restricted_api_key`. That is not a broken
  key — sending still works, and a restricted key is the better choice for a
  server that only ever sends.

## Building for a real device

Expo Go covers everything except push notifications, which were removed from it
in SDK 53. Push therefore needs a **development build**.

### 1. Firebase — required for push only

Skip this whole step to build and test everything except push.

1. Create a Firebase project and add an **Android** app whose package name is
   `np.com.rms.app`. It must match `app.json` exactly or FCM will reject the
   registration.
2. Download `google-services.json` into `apps/mobile/`. It is git-ignored.
3. Add this line under `expo.android` in `app.json`:

   ```json
   "googleServicesFile": "./google-services.json"
   ```

   This key is deliberately **not** committed. Declaring it before the file
   exists makes every native build fail, so it stays out until the file is in
   place.

4. Create a service account key in Firebase and point the API at it using the
   FCM variables documented in `apps/api/.env.example`. That credential is
   server-side only and must never reach the app bundle.

### 2. Build

```bash
cd apps/mobile

# Cloud build, produces an installable APK
npx eas build --profile development --platform android

# Or locally, if the Android SDK is installed
npx expo run:android
```

`eas.json` defines three profiles:

| Profile       | Output              | Use                                       |
| ------------- | ------------------- | ----------------------------------------- |
| `development` | APK with dev client | Day-to-day device testing, Metro attached |
| `preview`     | Standalone APK      | Hand to a tester, no Metro needed         |
| `production`  | AAB                 | Play Store                                |

### The API URL in a build

`development` loads JavaScript from Metro, so it picks up `apps/mobile/.env` as
usual. `preview` and `production` bake the value in at build time, so
`EXPO_PUBLIC_API_URL` must point at a host the phone can actually reach — a LAN
address for testing, never `localhost`, which on a phone means the phone itself.

Only `EXPO_PUBLIC_*` variables are inlined into the bundle, and every one of
them is readable from any installed copy of the app. No secret belongs there.

### Do not commit `android/` or `ios/`

This is a managed Expo project. Running `expo run:android` or `expo prebuild`
generates a native directory locally; both are git-ignored and should be deleted
rather than checked in, because committing them makes `app.json` stop being the
source of truth for native configuration.

## Checks

```bash
npm run check        # typecheck + lint + format:check across all workspaces
npm test             # all workspace tests
npm run format       # apply Prettier
```

Run `npm run check` and `npm test` before every commit (`CLAUDE.md` §66).

## Notes

**Why npm workspaces.** Metro resolves most reliably against a hoisted, flat
`node_modules`. pnpm's symlinked layout requires `node-linker=hoisted` to work
with Expo, which discards its main advantage. Turborepo/Nx would add build
caching value at ~20 packages, not at 3.

**`packages/shared` ships TypeScript source**, not a compiled `dist`. Metro
transpiles it via Babel; the API runs it through `tsx` in development and bundles
it with `tsup` for production (`noExternal: ['@rms/shared']`). This avoids a
build-order dependency and the "I edited shared and nothing changed" trap. The
trade-off is that the package cannot be published to npm as-is, which is fine —
it is private.

**Prisma 7 specifics.** Version 7 removed `url` from the `datasource` block and
dropped the bundled query engine, so two things differ from older Prisma setups:

- The CLI reads the connection string from `apps/api/prisma.config.ts`; the
  running server builds its own connection through the `@prisma/adapter-pg`
  driver adapter (`src/db/client.ts`) using the validated `env` object. The pool
  is constructed by us, not the adapter, so an idle-client `error` listener can
  be attached — without one a dropped connection terminates the process.
- Prisma Client is generated to `apps/api/generated/prisma`, **not** into
  `node_modules`. It is git-ignored and regenerated by `postinstall`, so a fresh
  clone or a Render build produces it automatically.

`@prisma/adapter-pg` (node-postgres over TCP) is used rather than Neon's HTTP
driver because interactive multi-statement transactions are required: recording
a payment must update the payment, its allocations and the period atomically.

**Money and Prisma.** Paisa columns are `BigInt`, which Prisma maps to
JavaScript `bigint`. `JSON.stringify` throws on `bigint`, so paisa must be
converted to `number` at the API response boundary — lossless, since paisa
values sit far below 2^53. Never use a floating-point column for money.

**Known audit findings.** `npm audit` reports 14 high-severity findings, all
cascading from a single transitive dependency (`image-size`, DoS in its
ICNS/JXL/HEIF parsers) inside Metro's bundler. These are **build-time only** —
they are not reachable from the API or from the shipped app at runtime, and are
triggered only by parsing a hostile image during bundling. npm's suggested
remediation is downgrading Expo 57 → 53, which would break the SDK, so it has
**not** been applied. Re-check when Expo ships an updated Metro.
