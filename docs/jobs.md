# Scheduled jobs

Four jobs drive the automatic side of the product. All are **orchestration
only** — every financial rule lives in the pure accounting modules and every
notification rule in the pure notification policy, so nothing is duplicated
here (`CLAUDE.md` §19, §63).

| Job                | Intended time (NPT) | Cron to configure (UTC) | Does                                                         |
| ------------------ | ------------------- | ----------------------- | ------------------------------------------------------------ |
| `generate-periods` | 00:15 daily         | `30 18 * * *`           | Creates any rent period whose start date has arrived         |
| `rent-reminders`   | 08:00 daily         | `15 2 * * *`            | Creates notification records for upcoming, due and late rent |
| `dispatch-push`    | every 5 minutes     | `*/5 * * * *`           | Pushes notifications that have no delivery record yet        |
| `prune-devices`    | Sunday 03:00        | `15 21 * * 6`           | Revokes devices unseen for 90 days                           |

Reminders run at 08:00 rather than midnight because a push at 3 a.m. is how an
app gets uninstalled.

⚠️ **Configure the UTC column, not the NPT one.** Render's cron scheduler has no
timezone setting and always interprets an expression as UTC. Nepal Standard Time
is UTC+05:45 — a **45-minute** offset, so these are not whole-hour conversions
and the minutes field changes too. Entering `0 8 * * *` expecting 08:00 in
Kathmandu would fire reminders at 13:45 local time.

Note that two of the conversions also move the _day_: 00:15 NPT is 18:30 UTC on
the **previous** day, and Sunday 03:00 NPT is Saturday 21:15 UTC (weekday `0`
becomes `6`). `render.yaml` at the repo root encodes all of this already.

## How they are triggered on Render

A separate **Render Cron Job** service calls the API over HTTP:

```
curl -fsS -X POST \
  -H "Authorization: Bearer $JOB_RUNNER_TOKEN" \
  https://<your-api>.onrender.com/api/internal/jobs/rent-reminders
```

This is preferred over an in-process scheduler because it keeps running when the
web service is replaced mid-deploy or scaled to zero — a web instance restarting
must not cause a day's billing to be skipped. `ENABLE_IN_PROCESS_SCHEDULER`
exists for local development only.

The endpoints are guarded by `JOB_RUNNER_TOKEN` (bearer, compared in constant
time). A scheduler has no session cookie, so session auth is not an option.

## Why running them twice is safe

Every job is idempotent by **two** independent mechanisms, because relying on
one would make correctness depend on the scheduler behaving.

**1. The run claim.** `runJob` inserts a row into `job_runs` keyed
`(jobName, runKey)`. A daily job passes the business date as its key, so
whichever caller inserts first does the work and every other caller is told to
skip. A skip is reported as success, so a retrying scheduler does not loop.

**2. The work itself.** Independently of any claim:

- `generate-periods` diffs the planned periods against existing sequence
  numbers, and `UNIQUE (rental_id, sequence_number)` rejects a duplicate even
  under a race.
- `rent-reminders` writes with a unique `dedupe_key` of
  `TYPE:periodId:targetDate:userId`, so the same logical notification cannot be
  created twice however many times the job runs.
- `dispatch-push` is a queue drain: `PENDING` is the state, and re-running picks
  up only what is left. Delivery rows are keyed `(notificationId, deviceId)`, so
  a retried push updates a row rather than adding one.

The second layer is what matters after a crash: a failed run leaves its claim
behind, and the next run must still be able to finish the work safely.

## Notifications

Records live in PostgreSQL, not in FCM (§17). Push is only a delivery attempt,
so a user who denied permission — or whose phone was off — still sees the full
history in the app.

Deduplication uses `notifications.dedupe_key`:

- `RENT_DUE_SOON` and `RENT_OVERDUE` are keyed to the day they **fire**.
- `RENT_DUE_TODAY` is keyed to the due date.

Keying a reminder to the due date instead would give the 7-day and 1-day
reminders the same key, and the second would be silently swallowed as a
duplicate. Overdue rent is chased **weekly**, not daily.

Payloads carry stable identifiers only — `type`, `rentalId`, `periodId` — never
a screen name or route. The app resolves the destination itself, so changing
navigation does not invalidate notifications already delivered (§39).

## Push delivery

The mobile app registers a **native device token** (`getDevicePushTokenAsync`
from `expo-notifications`), not an Expo push token, so messages go from this
server straight to FCM with no third party in the path.

⚠️ **Delivery works on Android only today.** `getDevicePushTokenAsync()` returns
an FCM registration token on Android but a raw **APNs** token on iOS, and the
server sends through FCM's v1 API, which accepts only the former. An iOS token
is therefore rejected as `messaging/invalid-argument`, classified as a dead
token, and the device is revoked by the rule below — so iOS push silently never
arrives and the evidence cleans itself up.

Fixing it is infrastructure, not code: register the iOS app in Firebase, upload
an APNs auth key to it, add `ios.googleServicesFile` to `app.json`, and obtain
the token via the Firebase iOS SDK so iOS yields a real FCM token. FCM then
bridges to APNs and this server-side path covers both platforms unchanged.

When FCM reports `registration-token-not-registered` or
`invalid-registration-token`, the device is revoked immediately. Without that,
every future batch would carry a growing tail of dead tokens (§20).

⚠️ **Remote push does not work in Expo Go** (removed in SDK 53). A development
build is required to receive a notification on a device.
