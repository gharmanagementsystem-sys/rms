# Environment variables

> API surface, error codes and the domain model are documented in
> [`docs/api.md`](./api.md).

Per `CLAUDE.md` §64, every environment variable is documented here. Secrets are
never committed; `.env` is git-ignored at the repository root and each app ships
a committed `.env.example`.

## `apps/api`

Loaded and validated at boot by `src/config/env.ts`. The process **exits** on
invalid configuration rather than starting in a broken state.

| Variable       | Required | Default       | Description                                                                                                                                                                                                               |
| -------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | no       | `development` | One of `development`, `test`, `production`.                                                                                                                                                                               |
| `PORT`         | no       | `4000`        | HTTP bind port. **Render injects its own `PORT`** — do not hardcode it in the service settings.                                                                                                                           |
| `LOG_LEVEL`    | no       | `info`        | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`.                                                                                                                                                                |
| `CORS_ORIGINS` | no       | _(empty)_     | Comma-separated browser origin allowlist. When empty, development reflects any origin and **production allows none**. Native mobile requests are not subject to CORS, so denying browsers is the safe production default. |

### Database

| Variable            | Required | Default | Description                                                                                                                                                                                      |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | **yes**  | —       | Neon PostgreSQL connection string. Must begin `postgres://` or `postgresql://`. Use Neon's **pooled** endpoint (host contains `-pooler`). The API exits at boot if this is missing or malformed. |
| `DATABASE_POOL_MAX` | no       | `10`    | Max connections per instance. Keep small — Neon's pooler provides the scaling; a large per-instance pool exhausts the project budget.                                                            |
| `DATABASE_SSL`      | no       | `true`  | `true` or `false` as a literal string. Neon requires TLS everywhere; set `false` only for a local PostgreSQL without TLS.                                                                        |

`DATABASE_SSL` is parsed as an explicit `'true' | 'false'` string rather than
coerced, because JavaScript truthiness would turn the string `"false"` into
`true`.

### Authentication (Better Auth)

| Variable               | Required          | Default                 | Description                                                                                                                                   |
| ---------------------- | ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`   | **yes**           | —                       | Signs session tokens. Minimum 32 characters, never defaulted. Generate with `openssl rand -base64 32`. Rotating it invalidates every session. |
| `BETTER_AUTH_URL`      | no                | `http://localhost:4000` | Public base URL of the API. Google callback URLs are derived from it, so it must match the Google Cloud console registration.                 |
| `GOOGLE_CLIENT_ID`     | **in production** | —                       | Google OAuth client id. Optional in development, so the API runs without Google credentials.                                                  |
| `GOOGLE_CLIENT_SECRET` | **in production** | —                       | Google OAuth client secret.                                                                                                                   |
| `MOBILE_APP_SCHEME`    | no                | `rms`                   | Mobile deep-link scheme. Must match `scheme` in `apps/mobile/app.json` or the OAuth redirect back into the app is rejected.                   |

Google sign-in is a shipped V1 feature, so a production boot without both Google
variables fails rather than silently starting with the provider missing. In
development the API starts and logs a warning.

The Google authorized redirect URI to register is
`<BETTER_AUTH_URL>/api/auth/callback/google`. Only **one** Google credential is
needed, of type **Web application** — the API is the OAuth client, not the phone,
so no Android/iOS client IDs or SHA-1 fingerprints are involved.

`BETTER_AUTH_URL` must additionally use `https://` in production, or session
cookies would travel in the clear.

### Outbound email (SMTP)

| Variable        | Required          | Default                 | Description                                                           |
| --------------- | ----------------- | ----------------------- | --------------------------------------------------------------------- |
| `APP_NAME`      | no                | `Rent Management Nepal` | Used in email subjects and bodies.                                    |
| `SMTP_HOST`     | **in production** | —                       | Any SMTP provider: Resend, Brevo, Postmark, Zoho, Gmail app password. |
| `SMTP_PORT`     | no                | `587`                   | 587 for STARTTLS, 465 for implicit TLS.                               |
| `SMTP_USER`     | **in production** | —                       | SMTP username.                                                        |
| `SMTP_PASSWORD` | **in production** | —                       | SMTP password or API key.                                             |
| `SMTP_FROM`     | **in production** | —                       | From address, on a domain the provider has verified.                  |
| `SMTP_SECURE`   | no                | `false`                 | `true` for implicit TLS on 465.                                       |

Email verification and password reset are **not optional** — a system holding
financial records cannot let an unverifiable address squat an account, and a
locked-out user needs a recovery path that is not a manual support reset. So a
production boot without SMTP fails.

In development, with SMTP unset, messages are written to the log instead of
being sent, so the verification link is still reachable. That transport
**refuses to be constructed in production**: verification and reset links are
bearer credentials, and logging them on a live server would be worse than not
booting.

Variables for FCM are added in their step and documented here at the same time.

### Failure behaviour

`src/config/env.ts` validates the whole environment once at boot and calls
`process.exit(1)` on any problem, printing the offending variable **names** and
reasons. Values are never echoed, because `DATABASE_URL` contains a password
(`CLAUDE.md` §32, §65).

`prisma.config.ts` supplies `DATABASE_URL` to the Prisma CLI. It deliberately
does **not** throw when the variable is absent, because `prisma generate` needs
no database and runs on `postinstall` — throwing would break `npm install` on a
fresh clone. The `migrate` commands report a missing URL clearly on their own.

Note that the application does not read `prisma.config.ts`. The server builds its
own connection through the `@prisma/adapter-pg` driver adapter using the
validated `env` object, so `DATABASE_POOL_MAX` and `DATABASE_SSL` apply to the
running API but not to CLI migrations.

## `apps/mobile`

Expo inlines any variable prefixed `EXPO_PUBLIC_` into the JavaScript bundle,
which ships to end users. **Never put a secret in a mobile environment
variable** — no API keys, no FCM server credentials, no database URLs
(`CLAUDE.md` §20, §32).

| Variable              | Required | Description                                                                                                                                                                                                                                               |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | **yes**  | Base URL of the API. The auth client throws at startup if it is unset. On a physical device `localhost` means the phone itself — use the development machine's LAN address (`http://192.168.x.x:4000`); the Android emulator uses `http://10.0.2.2:4000`. |

The mobile deep-link scheme (`rms`) is declared in `apps/mobile/app.json` and
must match the API's `MOBILE_APP_SCHEME`. The session is stored in
`expo-secure-store`, never in AsyncStorage (`CLAUDE.md` §50).
