# API

Base path `/api/v1`. Authentication lives at `/api/auth/*` and is owned by
Better Auth (see `docs/env.md`).

Every endpoint below requires a session. Identity comes from that session and
never from the request body (`CLAUDE.md` §30, §54).

## Endpoints

| Method | Path                                    | Notes                                        |
| ------ | --------------------------------------- | -------------------------------------------- |
| GET    | `/users/me`                             | The caller's own profile                     |
| POST   | `/properties`                           |                                              |
| GET    | `/properties`                           | `?search=&limit=&cursor=&includeArchived=`   |
| GET    | `/properties/:id`                       |                                              |
| PATCH  | `/properties/:id`                       |                                              |
| DELETE | `/properties/:id`                       | **Archives**, never destroys (§34, §57)      |
| POST   | `/properties/:propertyId/units`         |                                              |
| GET    | `/properties/:propertyId/units`         | `?availability=&occupied=&limit=&cursor=`    |
| GET    | `/properties/:propertyId/units/:unitId` |                                              |
| PATCH  | `/properties/:propertyId/units/:unitId` |                                              |
| DELETE | `/properties/:propertyId/units/:unitId` | Archives                                     |
| POST   | `/rentals`                              | Always created as `DRAFT`                    |
| GET    | `/rentals`                              | `?status=&side=&propertyId=&unitId=&search=` |
| GET    | `/rentals/:id`                          |                                              |
| PATCH  | `/rentals/:id`                          | Terms only — not status, dates or frequency  |
| POST   | `/rentals/:id/activate`                 | `DRAFT` → `ACTIVE`                           |
| POST   | `/rentals/:id/end`                      | `ACTIVE` → `ENDED`                           |
| PUT    | `/rentals/:id/charges`                  | Replaces the whole charge set                |

There is no `DELETE /rentals/:id`. A rental is ended, never destroyed, so its
accounting history survives (§34).

Lifecycle transitions are separate endpoints rather than a writable `status`
field: a client that could `PATCH` the status would be deciding business state.

## Conventions

**Pagination** is cursor-based: `?limit=&cursor=`. Responses are
`{ "data": [...], "meta": { "nextCursor": string | null, "hasMore": boolean } }`.
Offset pagination is not used because it duplicates and skips rows when a list
changes mid-scroll (§35).

**Money** is always integer paisa, named `*Paisa`. NPR 15,000 is `1500000`.
Fractional or negative values are rejected rather than rounded (§3.2).

**Business dates** are `YYYY-MM-DD` strings in Nepal Standard Time — never
timestamps. These are Gregorian (AD); Bikram Sambat conversion happens on the
client (§46).

**Errors** use one envelope, described in `packages/shared/src/errors.ts`:

```json
{
  "error": {
    "code": "UNIT_ALREADY_OCCUPIED",
    "message": "…",
    "details": [{ "field": "body.amountPaisa", "message": "…" }],
    "requestId": "…"
  }
}
```

`message` is a developer fallback and is not localized — the client switches on
`code` to pick a translated string (§27, §40). `details` is present only for
`VALIDATION_ERROR`.

## Authorization model

Permission is based on **ownership edges in the database, not on a user's role**
(§31). `primaryRole` drives navigation and onboarding only. This is deliberate:
in Nepal it is common to rent a flat and sublet rooms within it, so one person
can legitimately be both an owner and a renter.

A resource the caller has **no** relationship to returns **404**, not 403 —
returning 403 would confirm the id exists and allow enumeration. `403` is
reserved for resources the caller demonstrably is a party to but may not change
(for example, a renter on a linked rental attempting to alter the rent).

## Occupancy is derived

`UnitAvailability` has no `OCCUPIED` value. A unit is occupied precisely when an
active rental references it:

```
effective occupancy = hasActiveRental ? OCCUPIED : availability
```

The database enforces at most one active rental per unit
(`rentals_one_active_per_unit`), so the derived value can never contradict
reality (§22). Unit responses carry both `availability` (owner-set) and
`occupancy` (derived).

## Rental periods

Fixed duration, never calendar months: `periodDays` is **30** for `MONTHLY` and
**365** for `YEARLY`, with explicit inclusive boundaries (§13, ADR 0001).

`periodDays` is set by the server from the frequency and snapshotted on the
rental, so changing the product-wide constant can never alter an existing
agreement's schedule.
