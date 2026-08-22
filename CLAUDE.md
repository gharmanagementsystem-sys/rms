# CLAUDE.md — Rent Management Nepal

## 1. Role and Operating Instructions

You are the senior engineering team responsible for designing and building this product.

Act simultaneously as:

- Senior React Native engineer for iOS and Android
- Senior TypeScript engineer
- Senior backend/API engineer
- Database architect
- Authentication/security engineer
- Mobile UI/UX designer
- Product designer
- Performance engineer
- QA/test engineer
- DevOps/release engineer

Your job is not merely to make code compile. Your job is to build a production-quality rent management product that is reliable, intuitive, secure, maintainable, scalable, performant, and pleasant to use.

Before implementing a feature:

1. Understand the product requirement.
2. Identify affected users, entities, workflows, APIs, database records, permissions, notifications, and UI states.
3. Identify edge cases and failure states.
4. Check existing architecture and reuse established patterns.
5. Prefer the smallest clean solution that solves the actual problem.
6. Do not introduce libraries, infrastructure, abstractions, or patterns without a clear reason.
7. Explain important architectural decisions and their tradeoffs.
8. Implement incrementally and verify each meaningful change.
9. Never silently change product requirements.
10. If a requirement is ambiguous and the ambiguity can cause data loss, security problems, financial errors, or major UX problems, stop and ask for clarification rather than guessing.

Do not over-engineer. Do not under-engineer.

Correctness is more important than speed of implementation.

---

# 2. Product Vision

Build a modern rent management and rent accounting mobile application specifically designed for the Nepalese market.

The application serves two primary user types:

1. House Owner
2. Rentor / Tenant

The core purpose is to make recurring rent accounting simple and automatic.

Users should be able to:

- Create and manage rental properties
- Create rooms/flats/houses available for rent
- Record tenants and landlords
- Define rent and recurring service charges
- Track rent periods
- Automatically calculate amounts due
- Track pending and paid rent
- Track historical payments
- Receive automatic reminders and due-date notifications
- Mark rental agreements as active, ended, or left
- Manage available/occupied rooms
- View account/activity summaries
- Use the application in English or Nepali
- Use light or dark mode
- Receive reliable push notifications
- Manage their profile and account

The product should feel like a polished Nepali consumer application, not like an administrative database interface.

---

# 3. Core Product Principles

## 3.1 Simplicity

The primary user may not be technically sophisticated.

Every important workflow should be understandable without documentation.

Prefer:

- Clear labels
- Short forms
- Progressive disclosure
- Sensible defaults
- Helpful empty states
- Confirmation for destructive actions
- Human-readable errors
- Clear financial summaries

Avoid:

- Dense forms
- Technical terminology
- Unnecessary configuration
- Hidden actions
- Long onboarding screens
- Excessive modal dialogs

## 3.2 Financial correctness

Rent accounting is financial data.

Never use floating-point arithmetic for monetary calculations.

Use integer minor units wherever practical, such as:

- NPR 1,500 → 150000 paisa

or a database decimal/numeric type with explicit rounding rules.

Every financial calculation must have deterministic rounding behavior.

Never calculate important financial totals differently on the client and server.

The server is the source of truth for financial calculations.

## 3.3 Data integrity

Historical accounting records must remain trustworthy.

Do not mutate historical payment records merely because the current rent configuration changed.

Example:

If electricity was NPR 15/unit in January and later becomes NPR 20/unit, January's historical accounting must remain based on the January configuration.

Store the effective values needed to reproduce historical calculations.

## 3.4 Mobile-first thinking

This is primarily a mobile application.

Design for:

- Small Android phones
- Large Android phones
- iPhones with different screen sizes
- Safe areas
- Dynamic text sizes
- Keyboard interaction
- Poor/unstable networks
- Slow devices
- Battery efficiency
- Offline/intermittent connectivity

Never assume every device has a fast internet connection.

---

# 4. Technology Stack

## Mobile

- React Native
- TypeScript
- Tailwind-style styling through a React Native-compatible solution such as NativeWind
- Shared codebase for Android and iOS

Do not attempt to use browser-only CSS or DOM APIs.

Use React Native primitives and platform-compatible libraries.

## Backend

- Node.js
- Express.js
- TypeScript
- REST API
- Layered architecture

## Authentication

- Better Auth

Authentication must be centralized and server-controlled.

Do not implement custom cryptography or custom password hashing when the authentication framework already provides the required secure mechanisms.

## Database

- Neon PostgreSQL

Use relational modeling because the application contains strongly related entities:

- Users
- Properties
- Units
- Rental agreements
- Rent periods
- Charges
- Payments
- Notifications
- Devices
- Activity records

## Push notifications

- Firebase Cloud Messaging (FCM)

FCM is the push delivery layer.

The backend controls notification business logic.

Do not treat FCM as the application's notification database.

## Architecture

```text
React Native Mobile App
        |
        | HTTPS REST API
        v
Express + TypeScript API
        |
        +----------------------+
        |                      |
        v                      v
Neon PostgreSQL          FCM
        |                      |
        |                      v
        |                Android / iOS
        |
        v
Accounting / Rent Data
```

---

# 5. Important Technical Correction: Tailwind in React Native

React Native does not use browser Tailwind CSS directly.

Use a React Native-compatible Tailwind implementation such as NativeWind.

Do not introduce traditional browser-only Tailwind patterns into React Native.

Keep styling:

- Consistent
- Tokenized
- Reusable
- Theme-aware
- Accessible

Avoid arbitrary one-off styling scattered throughout components.

---

# 6. High-Level Architecture

Use a modular architecture.

## Mobile

```text
src/
├── app/
├── components/
├── features/
│   ├── auth/
│   ├── onboarding/
│   ├── dashboard/
│   ├── properties/
│   ├── rentals/
│   ├── accounting/
│   ├── payments/
│   ├── notifications/
│   └── profile/
├── navigation/
├── hooks/
├── services/
├── api/
├── store/
├── i18n/
├── theme/
├── utils/
├── types/
└── constants/
```

Organize business functionality primarily by feature.

Avoid one enormous global components directory containing unrelated application logic.

## Backend

```text
src/
├── config/
├── middleware/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── onboarding/
│   ├── properties/
│   ├── units/
│   ├── rentals/
│   ├── accounting/
│   ├── payments/
│   ├── notifications/
│   └── devices/
├── database/
├── jobs/
├── services/
├── utils/
├── errors/
├── routes/
├── app.ts
└── server.ts
```

Each major module should have a clear separation of:

- Routes
- Controllers
- Validation
- Services/business logic
- Data access/repositories where justified
- Types

Do not put business logic inside route handlers.

---

# 7. API Design

Use RESTful APIs with predictable naming.

Examples:

```text
POST   /api/v1/auth/...
GET    /api/v1/users/me
PATCH  /api/v1/users/me

GET    /api/v1/properties
POST   /api/v1/properties
GET    /api/v1/properties/:id
PATCH  /api/v1/properties/:id
DELETE /api/v1/properties/:id

GET    /api/v1/rentals
POST   /api/v1/rentals
GET    /api/v1/rentals/:id
PATCH  /api/v1/rentals/:id

GET    /api/v1/rentals/:id/periods
GET    /api/v1/rentals/:id/accounting
GET    /api/v1/payments

GET    /api/v1/notifications
PATCH  /api/v1/notifications/:id/read

POST   /api/v1/devices
DELETE /api/v1/devices/:id
```

Version the API from the beginning.

Use consistent:

- HTTP status codes
- Error format
- Pagination
- Validation
- Authorization
- Request IDs
- Response structures

Never expose internal database errors directly to clients.

---

# 8. User Roles

The system initially supports:

## HOUSE_OWNER

Can:

- Create properties
- Create units
- Manage available/occupied units
- Create rental agreements
- Add tenant information
- Define rent and service charges
- View accounting
- Record payments
- View pending balances
- View historical accounting
- Mark a rental as ended
- Mark a unit available after a tenant leaves

## RENTER

Can:

- Create/manage their rental record
- Add landlord/property details
- Define their rent and service charges
- View their accounting
- View payment history
- Track upcoming/overdue payments
- Mark their rental as left/ended
- Receive notifications

Authorization must be enforced on the server.

Never trust a role or ownership value sent by the mobile application.

---

# 9. Onboarding

Onboarding must be interactive, short, progressive, and visually engaging.

Do not present one enormous form.

Use a multi-step onboarding flow.

Example:

```text
Welcome
   ↓
Language
   ↓
Theme
   ↓
Role
   ↓
Basic profile
   ↓
Role-specific setup
   ↓
Referral/source
   ↓
Review
   ↓
Dashboard
```

## Required preferences

During onboarding collect:

- Language: English / Nepali
- Theme: Light / Dark / System if supported by the product design
- How the user discovered the app

## House Owner onboarding

Collect useful property-management information, including:

- Property name/identifier
- Location
- Address details
- Number of flats
- Number of rooms/units
- Occupied units
- Empty units
- Other useful property metadata

Do not ask for information that can be naturally created later.

If a value can be derived from database records, prefer deriving it instead of asking the user to enter it manually.

For example:

```text
occupiedUnits = count(active rental agreements)
availableUnits = totalUnits - occupiedUnits
```

Do not store redundant counters unless there is a justified performance reason.

## Renter onboarding

Collect:

- Basic profile information
- Current location
- Relevant rental information
- Landlord/property information when applicable
- Discovery source

Do not force renters through property-owner fields.

---

# 10. Property Model

A property represents a physical rental property.

A property may contain:

- Multiple flats
- Multiple rooms
- Other rentable units

Do not model every physical concept as the same thing without clear semantics.

Use a flexible `Unit` concept for something that can be rented.

Example:

```text
Property
   ├── Flat A
   │     ├── Room 1
   │     └── Room 2
   │
   └── Flat B
         └── Room 1
```

The exact hierarchy should remain simple enough for the user.

---

# 11. Rental Agreement Model

A rental agreement represents the relationship between:

- Owner
- Renter
- Rentable unit/property
- Financial terms
- Rental period
- Status

Possible statuses:

```text
DRAFT
ACTIVE
ENDED
CANCELLED
```

Do not use a single status field to represent every concept in the system.

Separate:

- Agreement lifecycle
- Payment status
- Unit occupancy

when necessary.

---

# 12. Rent Configuration

When a house owner creates a rental, they should be able to select the charges they need.

Core fields:

- Rent amount
- Rent frequency
- Rent start date
- Renter name
- Renter phone number
- Electricity pricing
- Water charges
- Waste collection fee
- House cleaning fee
- Internet fee
- Other recurring charges

Rent frequency initially:

```text
MONTHLY  = a fixed 30-day period
YEARLY   = a fixed 365-day period
```

These are fixed-duration periods measured in elapsed days from the rental start
date, not calendar months or calendar years. See section 13.

The UI should allow optional charges to be enabled/disabled.

Do not force every rental to use every service.

Example:

```text
Rent
✓ Monthly rent       NPR 15,000

Additional charges
✓ Electricity        NPR 15 / unit
✓ Water              NPR 500 / month
✓ Internet           NPR 1,000 / month
□ Waste collection
□ Cleaning
□ Other
```

---

# 13. Accounting Engine

This is one of the most important parts of the system.

Never implement accounting as simple UI calculations.

Create a dedicated server-side accounting domain.

The system should generate a rent period from the rental agreement.

## Rental periods are fixed-duration, not calendar periods

This is authoritative and overrides any calendar-month reading elsewhere in this
document.

```text
MONTHLY rental period = exactly 30 days
YEARLY  rental period = exactly 365 days
```

A rental period is a fixed span of elapsed days measured from the rental start
date. It is **not** a calendar month and **not** a calendar year.

Example:

```text
Rental start:
2026-08-01

Monthly frequency (30 days, inclusive boundaries):

Period 1:
2026-08-01 → 2026-08-30

Period 2:
2026-08-31 → 2026-09-29

Period 3:
2026-09-30 → 2026-10-29
```

Note that the period start date deliberately drifts through the calendar. That
is expected behaviour, not a bug.

Rules:

- Do **not** use month-end logic.
- Do **not** use February or leap-year special cases.
- Do **not** use "same day next month" logic.
- Do **not** clamp a start day to the length of the following month.
- Period length comes from `MONTHLY_PERIOD_DAYS` / `YEARLY_PERIOD_DAYS` in
  `packages/shared/src/constants.ts` and from nowhere else.

## Explicit period boundaries

Every period must carry an explicit inclusive start date and inclusive end date.

```text
periodEnd = periodStart + (periodDays - 1) days
nextPeriodStart = periodEnd + 1 day
```

Never derive a boundary implicitly, and never express a period as a start date
plus an assumed length at the point of use. Storing both boundaries explicitly
is what prevents off-by-one errors, and it is what allows a historical period to
remain correct even if the period-length rule is ever changed.

Consecutive periods must be contiguous and must not overlap.

See `docs/decisions/0001-fixed-length-rental-periods.md` for the rationale and
the accepted trade-offs.

---

# 14. Rent Periods

Each rental should have accounting periods.

Example:

```text
Rental
   |
   +-- Period #1
   |     sequence number
   |     period start   (explicit, inclusive)
   |     period end     (explicit, inclusive)
   |     due date
   |     rent
   |     electricity
   |     water
   |     internet
   |     other charges
   |     total
   |     paid amount
   |     balance
   |
   +-- Period #2
   |
   +-- Period #3
```

Each period stores its own start and end date explicitly. Never infer a period's
boundaries from the rental start date plus an assumed length at the point of use.

Each period should preserve the financial values applicable to that period.

Do not recalculate historical periods from today's rental configuration.

---

# 15. Payment States

Use explicit states.

Example:

```text
PENDING
PARTIALLY_PAID
PAID
OVERDUE
CANCELLED
```

The exact model can be refined during implementation.

Important:

```text
balance = totalAmount - totalPaid
```

A payment should be an immutable financial event where possible.

If a payment must be corrected, prefer a correction/reversal/audit mechanism rather than silently editing history.

---

# 16. Automatic Accounting

The user should not manually create each month's accounting period.

The backend must automatically generate the next rent period according to the agreement's schedule.

Example:

```text
Period #3 ends (2026-09-29)
        ↓
Backend job
        ↓
Generate period #4 (2026-09-30 → 2026-10-29)
        ↓
Calculate applicable charges
        ↓
Set status to PENDING
        ↓
Create notification
        ↓
Send push notification
```

Periods are identified by their sequence number and explicit boundaries, never by
a calendar month name. "September's rent" is not a meaningful identifier in this
system, because a period can span two calendar months.

The system must be idempotent.

Running the accounting job twice must not create duplicate rent periods or duplicate charges.

Use unique database constraints and/or idempotency keys where appropriate.

---

# 17. Notifications

Notifications are a first-class product feature.

Use:

- FCM for push delivery
- PostgreSQL for persistent notification records

Do not rely only on push notifications.

A notification should exist in the database so the user can see notification history inside the app.

Example:

```text
Notification
├── userId
├── type
├── title
├── body
├── data
├── readAt
├── sentAt
└── createdAt
```

Possible notification types:

```text
RENT_DUE_SOON
RENT_DUE_TODAY
RENT_OVERDUE
PAYMENT_RECORDED
RENTAL_ENDED
RENTAL_STARTED
GENERAL
```

---

# 18. Automatic Notification Scheduling

The backend must automatically determine when notifications should be sent.

Never require an administrator to manually trigger normal rent reminders.

Example policy:

```text
7 days before due date
    ↓
Reminder

1 day before due date
    ↓
Reminder

Due date
    ↓
Rent due notification

After overdue threshold
    ↓
Overdue notification
```

The exact default policy should be configurable in a centralized notification policy.

Every notification must be deduplicated.

Never send:

```text
10:00 → Rent due
11:00 → Rent due
12:00 → Rent due
```

because the scheduler ran repeatedly.

Use a notification event key or equivalent unique constraint.

Example:

```text
rentalPeriodId + notificationType + targetDate
```

must uniquely identify a scheduled notification event.

---

# 19. Scheduled Jobs

The backend needs a reliable mechanism for time-based work.

Jobs include:

- Creating upcoming rent periods
- Detecting due periods
- Detecting overdue periods
- Creating notifications
- Sending push notifications
- Cleaning expired device tokens
- Other future recurring tasks

The scheduler must be safe to run repeatedly.

Never assume a scheduled job executes exactly once.

Use idempotent operations.

Do not block HTTP API requests while performing large notification batches.

If the implementation needs a queue/worker, introduce one deliberately and document why.

---

# 20. FCM Device Token Architecture

A user may have multiple devices.

Do NOT use:

```text
User.fcmToken
```

as the complete solution.

Use a device/session registration model such as:

```text
User
   |
   +-- Device
       ├── token
       ├── platform
       ├── appVersion
       ├── lastSeenAt
       ├── notificationsEnabled
       └── revokedAt
```

Support:

- Multiple devices
- Token rotation
- Logout
- Token invalidation
- Android
- iOS
- Notification permission state

The server should remove or deactivate invalid tokens after FCM reports them as invalid.

Never expose FCM server credentials to the mobile app.

---

# 21. Rentor Leaving a Property

A renter should be able to mark a rental as ended/left.

The owner should also be able to end the rental from their side.

However, do not immediately destroy the rental record.

Historical accounting must remain available.

Correct lifecycle:

```text
ACTIVE
   ↓
END REQUEST / CONFIRMATION
   ↓
ENDED
   ↓
Unit becomes AVAILABLE
```

The exact authorization and confirmation flow should prevent one user from accidentally terminating another user's active agreement without appropriate permissions.

---

# 22. Property Occupancy

A unit should have a clear occupancy state.

Example:

```text
AVAILABLE
OCCUPIED
MAINTENANCE
UNAVAILABLE
```

When a renter leaves:

```text
Rental = ENDED
Unit = AVAILABLE
```

Do not duplicate occupancy state unnecessarily if it can be derived safely from active rental agreements.

If both are stored, enforce consistency.

---

# 23. Account Page

The account page should contain:

## Profile

- Name
- Phone
- Email if applicable
- Profile photo
- Role
- Location

## Preferences

- Language
- Theme
- Notifications

## Account actions

- Edit profile
- Change password
- Change profile picture
- Language
- Theme
- Notification settings
- Logout

## Activity summary

For owners:

- Total properties
- Total units
- Occupied units
- Available units
- Active renters
- Pending rent
- Collected rent

For renters:

- Current rental
- Current rent
- Amount due
- Amount paid
- Upcoming due date
- Payment history

---

# 24. Dashboard

The dashboard must immediately answer:

## Owner

- How many properties?
- How many occupied units?
- How many available units?
- How much rent is pending?
- How much was collected?
- Which renters have overdue payments?
- Which payments are due soon?

## Renter

- Where am I currently renting?
- How much do I owe?
- When is the next due date?
- What services are included?
- Recent payments
- Outstanding balance

The dashboard should not become a giant analytics screen.

Prioritize actionable information.

---

# 25. UI/UX Direction

The design should feel:

- Premium
- Professional
- Calm
- Trustworthy
- Modern
- Nepali
- Simple
- Financially reliable

Avoid:

- Neon colors
- Bright gradients
- Excessive glassmorphism
- Excessive animations
- Rainbow UI
- Cartoonish financial interfaces
- Overly saturated backgrounds
- Too many decorative elements

Use a restrained color system.

Prefer:

- Deep neutral tones
- Warm off-whites
- Muted greens/blues where appropriate
- Subtle Nepal-inspired accents
- High-quality typography
- Strong contrast
- Generous spacing

Do not make the application look like a tourism website.

Nepali cultural influence should be subtle and premium.

Use cultural references through:

- Typography choices
- Small visual motifs
- Language
- Icons/illustrations
- Local terminology
- Thoughtful color accents

Do not cover the UI with cultural decorations.

## Icons

Use beautiful, consistent, platform-friendly icons wherever they improve comprehension or navigation.

Rules:

- Prefer one coherent icon family across the application.
- Use icons to support meaning, not merely to decorate empty space.
- Use familiar icons for navigation and common actions.
- Keep icon sizing, stroke weight, and alignment consistent.
- Do not mix unrelated icon styles.
- Prefer accessible icon + text combinations when an icon alone could be ambiguous.
- Do not replace important text with an unfamiliar icon.
- Use platform-appropriate icons where native conventions materially improve usability.

## Animation and Motion

The application should feel smooth, polished, and responsive.

Use tasteful animations for:

- Screen transitions
- Onboarding progress
- Cards appearing/disappearing
- Expand/collapse interactions
- Bottom sheets
- Modals
- Loading/skeleton transitions
- Success and error feedback
- Button interaction feedback
- List insertion/removal
- Navigation state changes

Animation must support usability rather than distract from it.

Rules:

- Prefer smooth, subtle motion over flashy effects.
- Keep animations short and purposeful.
- Avoid excessive bouncing, spinning, parallax, or decorative motion.
- Never make users wait for an animation before completing a normal action.
- Respect reduced-motion/accessibility preferences where supported.
- Avoid animations that cause dropped frames on lower-end Android devices.
- Do not animate large numbers of list items unnecessarily.
- Use performant React Native animation techniques and avoid causing unnecessary React renders.
- Keep animation behavior consistent across Android and iOS.
- Test motion on both platforms and on lower-performance devices where practical.

The product should feel polished, not animated for the sake of being animated.

---

# 26. Dark Mode

Dark mode must be intentionally designed, not simply inverted.

Define semantic design tokens:

```text
background
surface
surfaceElevated
textPrimary
textSecondary
border
primary
success
warning
danger
```

Every component must consume semantic tokens.

Do not hardcode colors repeatedly.

Ensure:

- Text remains readable
- Financial statuses remain distinguishable
- Cards do not become muddy
- Borders remain visible
- Images remain appropriate
- Inputs remain usable

---

# 27. Language Support

Support:

- English
- Nepali

Do not hardcode user-facing strings inside components.

Bad:

```text
<Text>Rent is due today</Text>
```

Prefer:

```text
<Text>{t("rent.dueToday")}</Text>
```

All user-facing text must be translatable.

Translations should be organized by feature.

Example:

```text
i18n/
├── en/
│   ├── common.json
│   ├── auth.json
│   ├── rentals.json
│   └── accounting.json
└── ne/
    ├── common.json
    ├── auth.json
    ├── rentals.json
    └── accounting.json
```

Do not concatenate translated sentences from fragments when grammar may change between languages.

Test Nepali text layout on real device dimensions.

---

# 28. Navigation

Navigation should be role-aware.

Do not show owner-specific features to renters.

Possible primary navigation:

```text
Owner:
Home
Properties
Rentals
Accounting
Notifications
Account

Renter:
Home
My Rental
Accounting
Notifications
Account
```

Keep navigation simple.

The user should reach the most common action in very few taps.

---

# 29. Forms

Forms are a major part of this application.

Rules:

- Use proper keyboard types
- Validate while appropriate
- Avoid excessive validation interruptions
- Preserve input when errors occur
- Clearly indicate required fields
- Show units such as NPR, per month, per unit
- Use date pickers
- Use numeric inputs for amounts
- Format money consistently
- Prevent impossible dates
- Handle keyboard overlap
- Support safe-area layouts

Never silently discard user-entered data.

---

# 30. API Validation

Validate all external input on the backend.

Never trust:

- Client-side validation
- User role from request body
- User ID from request body
- Ownership IDs
- Payment amounts
- Rental status
- Notification permissions

Use schemas for:

- Request body
- Query parameters
- Route parameters
- Important response structures

Return clear validation errors.

---

# 31. Authorization

Authentication answers:

> Who are you?

Authorization answers:

> What are you allowed to do?

Every protected operation must perform server-side authorization.

Examples:

A renter must not be able to:

```text
GET another owner's private property
DELETE another user's rental
modify another user's payment
read another user's notifications
```

An owner must not automatically have access to unrelated properties owned by another owner.

Use ownership checks in the service/domain layer, not only in the UI.

---

# 32. Security Requirements

Follow secure defaults.

Must include:

- HTTPS in production
- Secure authentication
- Secure password handling through Better Auth
- Proper session management
- Input validation
- Authorization checks
- Rate limiting where appropriate
- CORS configured intentionally
- Secure headers
- Secrets stored in environment variables
- No secrets in Git
- No FCM server credentials in mobile code
- Safe error responses
- Database constraints
- Auditability for important financial actions

Never log:

- Passwords
- Auth tokens
- Sensitive credentials
- Full private session information

---

# 33. Database Principles

Use PostgreSQL relational modeling.

Tables will likely include concepts such as:

```text
users
profiles
properties
units
rentals
rental_participants
rental_charge_definitions
rental_periods
period_charges
payments
notifications
devices
user_preferences
audit_logs
```

The exact schema may evolve.

Do not create unnecessary tables simply to appear sophisticated.

Use:

- UUIDs or another consistent ID strategy
- Foreign keys
- Unique constraints
- Check constraints where appropriate
- Indexes for frequent queries
- Timestamps
- Soft deletion only where it provides clear value

Use database transactions for multi-step financial operations.

---

# 34. Historical Data

Historical records are important.

Never delete a completed rental just because the renter leaves.

Keep historical:

- Rental agreement
- Periods
- Charges
- Payments
- Payment status
- Effective pricing
- Relevant participants

This allows the user to answer:

> "How much did this renter pay me six months ago?"

---

# 35. Search and Filtering

Owners may eventually have many properties and renters.

Design APIs to support:

- Search
- Filtering
- Pagination
- Sorting

Do not fetch thousands of records and filter them only on the mobile device.

Filter and paginate on the backend.

---

# 36. Performance

The application must feel fast.

Targets:

- Fast cold start
- Fast navigation
- Minimal unnecessary renders
- Small bundle size
- Optimized images
- Lazy loading where appropriate
- Paginated lists
- Efficient database queries
- Avoid N+1 queries
- Avoid unnecessary API calls
- Cache safe/read-heavy data where appropriate
- Avoid huge JSON responses

Do not sacrifice correctness for micro-optimizations.

Measure before optimizing complex code.

---

# 36A. Expo Development Workflow

Expo is the preferred development workflow for the mobile application.

Development priorities:

- Start the mobile app with Expo.
- Use Expo Go for rapid development and device testing whenever the current feature set is compatible.
- Make it easy for the developer to scan the Expo QR code and test on a physical Android/iOS device.
- Keep the development loop fast: edit → reload/fast refresh → test.
- Avoid unnecessary native project configuration during early development.
- Prefer Expo-compatible libraries and Expo modules when they satisfy the requirement.

However, do not force Expo Go compatibility at the expense of product requirements.

If a feature requires native capabilities unavailable in Expo Go:

1. Identify the limitation.
2. Explain why Expo Go cannot support the feature.
3. Check whether an Expo-compatible alternative exists.
4. Only then introduce a development build or native configuration.
5. Keep the additional setup isolated and documented.

Do not eject or introduce native complexity simply because it is familiar.

The application must still be tested on real Android and iOS devices before release. Expo Go is a development convenience, not a substitute for final native-device and production-build testing.

# 37. Network Resilience

Mobile networks are unreliable.

Handle:

- Timeouts
- Connection loss
- Slow responses
- Duplicate requests
- App backgrounding
- App restart
- Partial failures

For mutations, consider idempotency where duplicate submission could cause financial or data corruption.

Example:

A user taps "Pay" twice because the first request appears frozen.

The system must not accidentally create two payments.

---

# 38. Offline Behavior

Do not claim the entire accounting system works offline unless the architecture explicitly supports conflict resolution.

Safe approach:

- Cache read-only/recent data where useful
- Show cached data clearly
- Queue only operations that can be safely reconciled
- Do not silently fake successful financial operations while offline

The server remains authoritative for accounting.

---

# 39. Notifications UX

Users should be able to:

- Grant notification permission
- Deny permission
- Change notification preferences
- View notification history
- Mark notifications read
- Open the relevant rental/accounting screen by tapping a notification

Push payloads should contain stable navigation identifiers, not UI-specific assumptions.

Example:

```text
type: RENT_DUE
rentalPeriodId: ...
```

The mobile application resolves the destination.

---

# 40. Error Handling

Errors must be understandable.

Bad:

```text
500 Internal Server Error
```

Good:

```text
We couldn't save this rental right now.
Please check your connection and try again.
```

However, never hide technical errors from developers.

Use:

- User-friendly client messages
- Structured server logs
- Request/correlation IDs
- Error codes

Example:

```text
RENTAL_PERIOD_ALREADY_EXISTS
UNAUTHORIZED_PROPERTY_ACCESS
INVALID_PAYMENT_AMOUNT
RENTAL_ALREADY_ENDED
```

---

# 41. Loading States

Every network-driven screen must handle:

1. Loading
2. Success
3. Empty
4. Error
5. Refreshing

Do not leave blank screens while data is loading.

Use skeletons where they genuinely improve perceived performance.

---

# 42. Empty States

Empty states should guide the user.

Example:

```text
No rental agreements yet.

Add your first rental to start automatically
tracking rent and service charges.

[Add Rental]
```

Do not use meaningless:

```text
No data
```

---

# 43. Accessibility

Support:

- Screen readers
- Accessible labels
- Adequate touch targets
- Sufficient contrast
- Dynamic text where possible
- Clear focus order
- Reduced motion where appropriate

Do not rely solely on color to communicate:

- Paid
- Pending
- Overdue
- Error

Use icon + text + color where appropriate.

---

# 44. Animation

Onboarding may use tasteful animations.

Use animation to:

- Explain progress
- Confirm actions
- Improve transitions
- Provide feedback

Do not animate everything.

Avoid animations that:

- Delay the user
- Consume excessive battery
- Hurt accessibility
- Cause frame drops

---

# 45. Testing Strategy

Testing is mandatory.

## Backend

Test:

- Authentication
- Authorization
- Rental creation
- Rental period generation
- Accounting calculations
- Payment calculations
- Duplicate prevention
- Notifications
- Ownership checks
- Date boundaries

## Mobile

Test:

- Login
- Signup
- Onboarding
- Owner workflows
- Renter workflows
- Theme switching
- Language switching
- Navigation
- Form validation
- Network errors
- Notification handling

## Critical accounting tests

Period generation is fixed-duration (section 13), so the calendar edge cases that
dominate calendar-month billing systems do not apply. What must be tested instead
is that period length stays exactly 30 or 365 days regardless of which months a
period happens to span, and that boundaries never overlap or leave a gap.

Test:

- A 30-day period spans exactly 30 days, inclusive of both boundaries
- A 365-day period spans exactly 365 days, inclusive of both boundaries
- Consecutive periods are contiguous: `nextStart === previousEnd + 1 day`
- Consecutive periods never overlap
- A period that spans a 28-day month is still exactly 30 days
- A period that spans a 31-day month is still exactly 30 days
- A period spanning 29 February in a leap year is still exactly 30 days
- A 365-day yearly period that contains 29 February still ends 365 days later
- A rental starting on the 31st generates the same period length as any other
- Period start dates drift through the calendar as expected across a year
- Backfilling many periods from an old start date produces no gaps or overlaps
- Partial payments
- Overpayments, and the resulting rental credit
- Credit carried into a later period
- Security deposit kept separate from rent credit
- Zero charges
- Optional charges
- Changing prices after a previous period
- Duplicate scheduler execution
- Payment submitted twice
- Rental ended before next period
- Mid-period departure, prorated
- Mid-period departure, full period charged

---

# 46. Date and Time Rules

Never use device-local time as the authority for accounting.

The backend must define the canonical timezone for the rental/accounting operation.

Because the product targets Nepal, use Nepal Standard Time (Asia/Kathmandu) for Nepal-based rent accounting unless a future multi-country requirement explicitly changes this.

Note that Nepal Standard Time is UTC+05:45 — a 45-minute offset, not a whole hour. Deriving "today" from a UTC timestamp without applying this offset produces the wrong Nepali date for a 5h45m window every day.

Use timezone-aware date/time handling.

## Rental duration is measured in elapsed days

Rental period length is fixed-duration — 30 days for MONTHLY, 365 days for YEARLY — as defined in section 13. Advance a period by adding whole calendar days to a business date.

Do not add raw seconds or milliseconds:

```text
30 * 24 * 60 * 60     ← wrong: ignores the business timezone
```

Do not use calendar-month arithmetic either:

```text
addMonths(start, 1)   ← wrong: this product does not bill by calendar month
```

Add whole days to a timezone-anchored business date instead:

```text
periodEnd = addDays(periodStart, periodDays - 1)
```

Business dates (period start, period end, due date, payment date) are calendar dates in Nepal Standard Time and must be stored as date values without a time component. Event timestamps (created, sent) are instants and must be stored with a timezone.

## Bikram Sambat

Bikram Sambat (BS) is the primary user-facing calendar. A reliable Gregorian/AD representation is maintained internally wherever it is needed.

All BS ↔ AD conversion must live in a single date/calendar module. Do not scatter conversion logic across features.

Rental duration is always computed in elapsed days on the AD representation. BS is a presentation concern and must never drive period length — a BS month varies between 29 and 32 days, which would reintroduce exactly the variability that fixed-duration periods exist to eliminate.

---

# 47. Nepal Localization

The product should feel native to Nepal.

Use:

- NPR / रु where appropriate
- Nepali language
- English language
- Nepal Standard Time
- Nepal-friendly address/location fields
- Phone number validation appropriate for Nepal
- Familiar date and financial presentation

Do not assume Western address structures are the only structure.

Keep the data model extensible enough for future expansion.

---

# 48. Product Naming and Terminology

Use terminology that ordinary Nepalese users understand.

Avoid unnecessarily technical terms.

The English and Nepali labels should be decided consistently and stored centrally in translation files.

Use one canonical term for each concept throughout the app.

Do not call the same concept:

- Tenant in one screen
- Rentor in another
- Renter somewhere else

unless the product language intentionally distinguishes them.

---

# 49. Authentication Flow

Support the authentication capabilities required by Better Auth.

The implementation should provide:

- Signup
- Login
- Logout
- Session persistence
- Password management
- Secure session handling
- Account recovery as supported
- Profile management

Do not store authentication secrets in AsyncStorage or other insecure client storage.

Follow the recommended Better Auth architecture for React Native/mobile clients.

---

# 50. Mobile Storage

Separate data types by sensitivity.

Never store sensitive authentication secrets casually.

Local storage should be used for:

- Theme preference
- Language preference
- Non-sensitive cached state
- UI preferences

Sensitive authentication material must use appropriate secure device storage according to the authentication architecture.

---

# 51. Code Quality

Use strict TypeScript.

Avoid:

```text
any
```

unless there is a documented reason.

Prefer:

- Explicit types
- Narrow unions
- Reusable domain types
- Schema inference where appropriate
- Small functions
- Clear names
- Pure calculation functions

Avoid:

- Giant components
- Giant controllers
- Giant service files
- Deep nesting
- Duplicate business logic
- Magic numbers
- Hardcoded strings
- Dead code
- Premature abstractions

---

# 52. State Management

Do not put every piece of application data into global state.

Separate:

- Server state
- UI state
- Authentication state
- Local preferences

Use a server-state solution where appropriate.

Do not create duplicated copies of server data in multiple stores without a clear reason.

Avoid global state for simple component-local state.

---

# 53. Component Design

Components should have one clear responsibility.

Prefer:

```text
RentSummaryCard
PaymentStatusBadge
RentalPeriodCard
ChargeRow
PropertyCard
```

over:

```text
UniversalEverythingCard
```

Reusable components should be reusable because they share a real visual/behavioral pattern, not because abstraction looks sophisticated.

---

# 54. Backend Business Logic

Financial logic must live on the server.

Examples:

- Calculate total rent
- Calculate service charges
- Determine balance
- Determine overdue state
- Generate rent periods
- Determine notification schedule

The mobile app may display calculations for UX, but the backend must validate and recalculate authoritative values.

Never trust:

```text
totalAmount
balance
paymentStatus
```

sent by the mobile app.

---

# 55. Payment Recording

The first version may record payments rather than process online payments.

Keep these concepts separate:

```text
Payment recorded
```

and

```text
Online payment processed
```

If online payments are added later, introduce a proper payment gateway integration without corrupting the accounting model.

---

# 56. Auditability

Important actions should be traceable.

Consider audit records for:

- Rental created
- Rental modified
- Rental ended
- Charge changed
- Payment recorded
- Payment corrected
- Property deleted/archived
- Account security changes

Do not create an audit system that captures every meaningless UI event.

Audit financially meaningful actions.

---

# 57. Destructive Actions

Never permanently delete important financial history casually.

Use:

- Confirmation
- Clear explanation
- Soft deletion/archive where appropriate
- Authorization
- Audit record

Example:

Before ending a rental:

```text
End this rental?

The rental will become inactive and future
rent periods will stop being generated.
Your previous accounting will remain available.

[Cancel] [End Rental]
```

---

# 58. Owner/Renter Relationship

Do not assume both sides always use the application.

The system must support:

### Owner-only workflow

Owner records renter manually.

### Renter-only workflow

Renter records landlord/property manually.

### Future linked workflow

Owner and renter can later connect/verify the same rental relationship.

Design identifiers and data ownership so this future feature can be added without rewriting the accounting engine.

Do not prematurely implement a complicated invitation system unless required.

---

# 59. Product Extensibility

Design the domain so future features can be added.

Potential future features may include:

- Online rent payment
- Digital rental agreements
- Receipt generation
- PDF statements
- Utility meter readings
- Multiple owners
- Multiple renters
- Maintenance requests
- Property expenses
- Income reports
- Analytics
- Reminders
- Tenant invitations
- Owner/renter verification
- Property management for multiple buildings

Do not implement these now unless required.

But avoid architecture that makes them impossible.

---

# 60. Meter and Utility Accounting

Electricity may be charged per unit.

If implemented using meter readings, prefer storing:

```text
previousReading
currentReading
consumedUnits
rate
amount
```

rather than only storing the final amount.

Example:

```text
Previous meter: 1200
Current meter: 1250
Usage: 50 units
Rate: NPR 15
Electricity: NPR 750
```

This makes accounting explainable.

Do the same principle for future metered utilities.

---

# 61. Financial Calculation Example

A monthly period might contain:

```text
Rent                  NPR 15,000
Electricity 50 × 15   NPR    750
Water                  NPR    500
Internet               NPR  1,000
Waste                  NPR    200
Cleaning               NPR    300
--------------------------------
Total                  NPR 17,750
Paid                   NPR 10,000
--------------------------------
Balance                NPR  7,750
```

The user should be able to understand exactly where the total came from.

Never show only:

```text
Total: NPR 17,750
```

without a way to inspect the breakdown.

---

# 62. UI Financial Statuses

Use consistent statuses.

Example:

```text
PAID
PARTIALLY PAID
PENDING
OVERDUE
```

Use semantic styling and text.

Example:

```text
✓ Paid
◐ Partially paid
○ Pending
! Overdue
```

Do not rely only on colors.

---

# 63. App Architecture Rules

Never couple accounting logic directly to UI components.

Bad:

```text
RentScreen.tsx
    ├── calculate rent
    ├── determine overdue
    ├── create notification
    └── update database
```

Good:

```text
Mobile UI
   ↓
API
   ↓
Rental Service
   ↓
Accounting Service
   ↓
Database
```

The mobile app requests operations.

The backend owns business rules.

---

# 64. Environment Configuration

Use separate environments:

```text
development
staging
production
```

Never commit:

- API secrets
- Database credentials
- Better Auth secrets
- FCM server credentials
- Private keys

Maintain clear `.env.example` files.

Document every environment variable.

---

# 65. Logging and Monitoring

Use structured server logging.

Useful fields:

- timestamp
- request ID
- route
- method
- status
- duration
- user ID where safe
- error code

Do not log sensitive information.

Important accounting failures should be detectable.

---

# 66. Git and Development Workflow

Use small, meaningful commits.

Prefer:

```text
feat: add rental creation flow
feat: add monthly rent period generation
fix: prevent duplicate rent periods
feat: add FCM device registration
fix: handle expired device tokens
```

Do not create giant commits containing unrelated changes.

Before considering a feature complete:

- TypeScript passes
- Lint passes
- Tests pass
- Relevant manual flow tested
- Android tested where relevant
- iOS tested where relevant
- Error states tested
- Loading states tested
- Empty states tested

---

# 67. Claude Coding Behavior

When asked to implement something:

### First

Inspect the existing code.

Do not immediately create new files.

Understand:

- Current architecture
- Existing conventions
- Existing dependencies
- Existing database schema
- Existing API patterns
- Existing state management
- Existing UI patterns

### Then

Explain briefly:

1. What needs to change
2. Why it needs to change
3. Which files/modules will change
4. Any risks or assumptions

### Then implement

Keep changes focused.

Do not rewrite unrelated code.

Do not introduce a new architecture halfway through the project unless there is a strong reason.

### After implementation

Verify:

- TypeScript
- Tests
- Lint
- Build
- Relevant runtime behavior

If something cannot be verified, explicitly say so.

Never claim something was tested when it was not.

---

# 68. Claude Must Challenge Bad Requirements

If a requirement is technically unsafe, inconsistent, or likely to cause future problems, do not blindly implement it.

Call it out.

Examples:

If asked to store all money as floating point:

> This is unsafe for financial calculations. We should use integer minor units or PostgreSQL NUMERIC.

If asked to store only one FCM token per user:

> This fails for users with multiple devices. We should model devices separately.

If asked to calculate due dates using milliseconds:

> This ignores the business timezone and Nepal Standard Time's 45-minute offset. Add whole days to a timezone-anchored business date instead. Note that this product bills in fixed 30/365-day periods, so calendar-month arithmetic is also wrong here — see section 13.

If asked to trust totals sent by the mobile app:

> This is a security and financial-integrity problem. Recalculate authoritative values on the server.

Be direct.

---

# 69. Do Not Over-Engineer

Do not add:

- Microservices
- Event buses
- Kubernetes
- Complex CQRS
- GraphQL
- Multiple databases
- Redis
- Message brokers
- Elaborate design patterns

unless the current product genuinely requires them.

Start with a modular monolith.

The backend should be easy for one developer to understand and operate.

Scale architecture when actual requirements justify it.

---

# 70. Production Readiness

Before release, verify:

## Authentication

- Signup
- Login
- Logout
- Session persistence
- Password security
- Unauthorized access

## Rent accounting

- Correct monthly periods (exactly 30 days, explicit inclusive boundaries)
- Correct yearly periods (exactly 365 days, explicit inclusive boundaries)
- Periods contiguous with no gaps or overlaps
- Correct charges
- Correct balances
- Correct historical values
- Correct overdue detection

## Notifications

- Device registration
- FCM delivery
- Notification persistence
- Notification deduplication
- Invalid token handling
- Permission denied behavior
- Deep links

## Mobile

- Android build
- iOS build
- Small screen
- Large screen
- Dark mode
- Light mode
- English
- Nepali
- Offline/error states
- Keyboard behavior
- Safe areas

## Security

- Authorization
- Input validation
- Secret management
- Rate limiting
- Secure headers
- No sensitive logs

## Performance

- Startup
- Navigation
- API latency
- Database query performance
- Large lists
- Image handling
- Notification processing

---

# 71. Definition of Done

A feature is NOT done merely because the code compiles.

A feature is done when:

- Requirements are satisfied
- UX is coherent
- Mobile layouts work
- Loading states exist
- Empty states exist
- Error states exist
- Authorization is correct
- Input is validated
- Database constraints are correct
- Accounting is deterministic
- Notifications behave correctly where applicable
- Tests cover important behavior
- No obvious security issue exists
- No unnecessary duplication exists
- Code is maintainable
- Android and iOS behavior is verified where relevant

---

# 72. Development Priority

Build in this order unless there is a strong product reason to change it:

## Phase 1 — Foundation

- Project setup
- TypeScript
- React Native architecture
- Express architecture
- Database
- Better Auth
- Environment configuration
- Design system
- i18n
- Theme system

## Phase 2 — Onboarding

- Signup/login
- Role selection
- Preferences
- Owner onboarding
- Renter onboarding
- Profile

## Phase 3 — Property and Rental Domain

- Properties
- Units
- Rental agreements
- Rent configuration
- Service charges
- Occupancy

## Phase 4 — Accounting

- Rent periods
- Charge calculations
- Balances
- Payments
- History
- Overdue state

## Phase 5 — Automation

- Scheduled jobs
- Automatic period generation
- Notification generation
- FCM integration
- Device management

## Phase 6 — Dashboard

- Owner dashboard
- Renter dashboard
- Financial summaries
- Activity

## Phase 7 — Polish

- Animations
- Accessibility
- Performance
- Empty states
- Error states
- Localization refinement
- Android/iOS QA

---

# 73. Important Product Rule

The application must never make a user wonder:

> "What do I need to do now?"

Every major screen should clearly communicate:

- Current state
- Amount
- Due date
- Next action

For financial workflows, prioritize clarity over visual decoration.

---

# 74. Final Engineering Standard

Build this product as if real Nepalese households will rely on it to track money.

That means:

- Never lose financial history.
- Never silently change accounting.
- Never trust the client with authorization.
- Never send duplicate reminders.
- Never make the user manually perform something that the system can reliably automate.
- Never sacrifice usability for architecture.
- Never sacrifice financial correctness for convenience.
- Never sacrifice security for speed.
- Never sacrifice maintainability for cleverness.

The goal is not to produce the maximum amount of code.

The goal is to produce a **small, clean, understandable, reliable, secure, polished system that can grow for years.**
