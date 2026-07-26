# Drift & Dwells OPS Revenue and Conversion Intelligence

Source of truth for future AI work

Status: planning document
Purpose: prevent AI drift across Cursor, Claude, Gemini, ChatGPT, and future implementation batches
Project: Drift & Dwells booking portal and OPS system
Primary goal: build real business visibility and capture lost direct-booking intent without damaging existing booking, payment, or availability flows

## 1. Why this exists

Drift & Dwells currently has multiple partial truths:

- Direct bookings live in the website database.
- Stripe contains payment and cash truth.
- Airbnb iCal contains availability holds only.
- Airbnb revenue is not available from iCal.
- OPS has some dashboard counters, but no full revenue intelligence product.
- Public-site visitors can view, search, quote, and leave without any first-party funnel record.

The business problem is not only reporting. The current pain is direct and organic conversion, especially for The Valley. Every day without funnel capture means lost visitor intent that can never be recovered.

The correct approach is two separate but parallel tracks:

- Track A: Revenue Intelligence
- Track B: Conversion Intelligence

They must stay architecturally separate.

## 2. Product separation rule

Never mix these products unless the UI explicitly asks for combined totals.

### The Cabin

- Proven product.
- Strong Airbnb demand.
- Airbnb can be fully booked while direct-site OPS numbers look weak.
- Usually uses `Cabin` records with `propertyKind = cabin`.

### The Valley

- Newer product.
- Includes A-frames, Stone House, Lux Cabin, and other Valley units.
- A-frames can use `CabinType` plus `Unit` records.
- Usually uses `propertyKind = valley` on `Cabin` or `CabinType`.

Reporting and conversion analytics must always support The Cabin and The Valley separately.

## 3. Source-truth rules

These rules are non-negotiable.

### Booking truth

`Booking` is the commercial truth for direct bookings.

It owns:

- guest direct reservation dates
- booking status
- commercial value
- promo and voucher application
- direct-channel provenance
- cancellation settlement snapshot

Do not mutate Booking for reporting.

### Stripe truth

`Payment` and Stripe webhook mirror data are payment and cash truth.

Stripe does not know:

- full stay assignment logic
- propertyKind
- off-platform Airbnb revenue
- manual bookings
- availability
- booking lifecycle rules

Do not treat Stripe as booking truth.

### Airbnb iCal truth

Airbnb iCal is availability truth only.

It can show external holds, but not:

- Airbnb revenue
- guest totals
- channel fees
- payout
- booking value
- true commercial source

Do not treat iCal as revenue truth.

### External channel revenue truth

Airbnb revenue must come from a separate import model or future integration.

Recommended future model: `ExternalChannelStay`.

Do not import Airbnb stays into `Booking`, because they are not direct website bookings.

### Funnel truth

Direct-site funnel data must use a new append-only event collection.

Recommended model: `BookingFunnelEvent`.

Do not use `Draft` as the funnel store.
Do not use `CheckoutSession` as the full funnel store.
CheckoutSession only covers late-funnel behavior.

## 4. Architecture rules

1. Do not change booking behavior unless a batch explicitly says so.
2. Do not change payment behavior unless a batch explicitly says so.
3. Do not refactor unrelated systems.
4. Do not mutate `Booking`, `Payment`, `CheckoutSession`, Stripe, or availability source data for reporting.
5. Keep reporting as a read model and service layer.
6. Keep conversion tracking append-only.
7. No black-box prediction.
8. No pricing recommendations in early batches.
9. No abandoned emails in Batch 1.
10. No BNPL in early batches.
11. No occupancy in Track A V1 because Valley unit assignment and calendar gaps can corrupt it.
12. Every metric must say what basis it uses.
13. If data is incomplete, show it as incomplete instead of guessing.
14. Prefer small batches with tests.
15. Preserve existing OPS patterns.

## 5. The two-track strategy

## Track A: Revenue Intelligence

Purpose: understand what was booked and paid through the direct system.

Urgency: medium, because past booking data already exists and can be queried later.

Track A V1 must be deliberately small.

Track A V1 includes:

- strict Cabin versus Valley split
- revenue summary endpoint
- data-quality endpoint
- channel breakdown from direct booking provenance
- check-in-date basis and booked-date basis
- no UI in Batch 1 unless explicitly approved later

Track A V1 excludes:

- occupancy
- ADR
- RevPAN
- forecast
- charts
- Airbnb import
- Stripe reconciliation
- monthly series
- pricing recommendations

Reason for excluding occupancy:

Current audit found that Valley A-frame occupancy is not reliable enough for V1 because:

- some OPS calendar logic filters by `cabinId` only
- A-frame bookings may use `cabinTypeId` without `cabinId`
- Checkout V2 can save A-frame bookings without `unitId`
- there is no existing sellable-nights denominator
- multi-unit occupancy must count physical units, not parent cabin shells

Track A must first expose data-quality issues before producing advanced metrics.

## Track B: Conversion Intelligence

Purpose: capture visitor intent before it is lost.

Urgency: high, because anonymous visitor behavior is not stored today and cannot be recovered later.

Track B V1 includes:

- `BookingFunnelEvent` model
- public append-only ingest endpoint
- client tracking helper
- selected anonymous client events
- server-side quote outcome hooks
- server-side booking conversion hook
- feature flags
- consent gate for client events
- strict payload whitelist
- event dedupe
- no PII in client events

Track B V1 excludes:

- email capture before Stripe
- abandoned booking emails
- `AbandonedBookingLead`
- marketing automation
- newsletters
- identity merge across devices
- full OPS conversion UI
- joined revenue plus conversion dashboard
- checkout behavior changes

Track B must not increase friction in the booking flow.

## 6. Correct implementation priority

Batch 1 priority:

1. Track B foundation and hooks
2. Track B client event capture
3. Track A minimal revenue APIs

Reason:

Track B starts collecting new intent data immediately.
Track A can read historical booking data later.

## 7. Track A V1 details

### 7.1 New backend files

Recommended files:

- `server/services/ops/reporting/reportingFilters.js`
- `server/services/ops/reporting/propertyKindJoin.js`
- `server/services/ops/reporting/normalizedStayRow.js`
- `server/services/ops/reporting/revenueMetricsService.js`
- `server/services/ops/reporting/insightsDataQualityService.js`
- `server/services/ops/readModels/insightsReadModel.js`
- `server/routes/ops/modules/insightsRoutes.js`
- `server/scripts/propertyKindJoin.test.cjs`
- `server/scripts/insightsReadModel.test.cjs`

### 7.2 Modified backend files

Recommended files:

- `server/routes/ops/index.js`
- `server/services/ops/opsModuleRegistry.js`
- `server/package.json`

### 7.3 Endpoint: revenue summary

Endpoint:

`GET /api/ops/insights/summary`

Auth:

OPS auth required, finance module.

Query params:

- `propertyKind`: required, `cabin` or `valley`
- `from`: required, `YYYY-MM-DD`
- `to`: required, `YYYY-MM-DD`
- `revenueBasis`: optional, `checkIn` or `booked`

Important naming decision:

Use `checkIn`, not `stay`, for V1.

Reason:

Track A V1 does not prorate revenue across all stay nights. It filters by check-in date. Calling this true stay revenue would be misleading.

Response shape:

```js
{
  success: true,
  data: {
    propertyKind: 'cabin' | 'valley',
    period: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },
    revenueBasis: 'checkIn' | 'booked',
    metrics: {
      bookingCount: number,
      cancelledCount: number,
      grossBookedRevenueCents: number,
      cancelledRevenueCents: number,
      avgBookingValueCents: number | null,
      cashCollectedCents: number
    },
    channelBreakdown: {
      website: { count: number, revenueCents: number },
      staff: { count: number, revenueCents: number },
      other: { count: number, revenueCents: number }
    },
    provenance: {
      computedAt: string,
      filtersApplied: string[],
      cashCollectedNote: 'sum of Booking.stripePaidAmountCents at finalize',
      revenueBasisNote: 'checkIn means booking check-in date, not prorated stay revenue'
    }
  }
}
```

### 7.4 Endpoint: data quality

Endpoint:

`GET /api/ops/insights/data-quality`

Auth:

OPS auth required, finance module.

Query params:

- `propertyKind`: required, `cabin` or `valley`

Response shape:

```js
{
  success: true,
  data: {
    propertyKind: 'cabin' | 'valley',
    issues: [
      { code: 'missing_property_kind', count: number, sampleBookingIds: string[] },
      { code: 'zero_price_manual', count: number, sampleBookingIds: string[] },
      { code: 'missing_unit_on_valley_booking', count: number, sampleBookingIds: string[] }
    ],
    inventoryHealth: {
      cabinsWithPropertyKind: number,
      cabinsMissingPropertyKind: number,
      cabinTypesWithPropertyKind: number,
      cabinTypesMissingPropertyKind: number,
      activeUnits: number | null
    },
    provenance: { computedAt: string }
  }
}
```

### 7.5 Track A rules

- Use strict `propertyKind` joins.
- Do not infer from names or slugs.
- Bookings with missing propertyKind appear in data quality, not in summary.
- Exclude test and fixture bookings.
- Exclude archived bookings.
- Cancelled bookings are counted separately and excluded from gross active revenue.
- Manual zero-price bookings are counted under staff and flagged.
- `cashCollectedCents` in V1+ uses `Booking.stripePaidAmountCents` (API compatibility name) and must be labelled in UI as **Payment snapshot at booking**
- Payment snapshot does not reflect later refunds or payment changes; it is not live Stripe balance
- Valley Track A also includes `LocationBooking` masters once; children with `excludeFromRevenueReporting` are omitted
- Do not use `Payment` ledger as a silent replacement for `cashCollectedCents`
- Batch 3B adds read-only additive reconciliation against linked Payment rows

### 7.6 Track A tests

Required tests:

- cabinId booking resolves to `cabin`
- cabinTypeId booking resolves to `valley`
- missing propertyKind returns null and flags data quality
- XOR violations are handled safely
- `revenueBasis=checkIn` filters by check-in date
- `revenueBasis=booked` filters by createdAt
- Cabin and Valley are separated
- test and fixture bookings are excluded
- manual zero-price booking is counted and flagged
- cancelled bookings are counted but excluded from gross active revenue
- channel mapping works

## 8. Track B V1 details

### 8.1 New backend files

Recommended files:

- `server/models/BookingFunnelEvent.js`
- `server/services/conversion/funnelEventConstants.js`
- `server/services/conversion/funnelEventSanitize.js`
- `server/services/conversion/funnelEventDedupe.js`
- `server/services/conversion/funnelEventService.js`
- `server/routes/funnelEventRoutes.js`
- `server/scripts/funnelEventService.test.cjs`
- `server/scripts/funnelEventRoutes.test.cjs`

### 8.2 New frontend file

Recommended file:

- `client/src/tracking/funnel.js`

### 8.3 Modified files

Recommended files:

- `server/server.js`
- `server/routes/bookingRoutes.js`
- `client/src/tracking/attribution.js`
- `client/src/pages/CabinDetails.jsx`
- `client/src/pages/AFrameDetails.jsx`
- `client/src/pages/SearchResults.jsx`
- `client/src/pages/ConfirmBooking.jsx`
- `client/src/services/api.js`
- `server/package.json`

### 8.4 Model: BookingFunnelEvent

Schema fields:

```js
{
  eventType: String,
  source: String,
  dedupeKey: String,

  sessionKey: String | null,
  visitorKey: String | null,

  propertyKind: String | null,
  cabinId: ObjectId | null,
  cabinTypeId: ObjectId | null,
  unitId: ObjectId | null,

  checkInDateOnly: String | null,
  checkOutDateOnly: String | null,
  adults: Number | null,
  children: Number | null,

  priceShownCents: Number | null,
  currency: String,

  quoteFailureClass: String | null,

  attribution: {
    utmSource: String,
    utmMedium: String,
    utmCampaign: String,
    gclid: String,
    fbclid: String,
    msclkid: String,
    referrer: String,
    landingPath: String,
    referralCode: String
  },

  convertedBookingId: ObjectId | undefined,
  checkoutId: String | null,

  searchResultCount: Number | null,

  schemaVersion: Number,
  createdAt: Date
}
```

Important:

Do not store `convertedBookingId: null` if using a partial unique index. Either omit it when not present or use a partial filter that only matches ObjectId values.

### 8.5 Indexes

Required indexes:

```js
{ dedupeKey: 1 }, unique: true
{ eventType: 1, createdAt: -1 }
{ sessionKey: 1, createdAt: -1 }, sparse: true
{ createdAt: 1 }, expireAfterSeconds: 15552000
```

For conversion uniqueness:

```js
{ convertedBookingId: 1 },
{
  unique: true,
  partialFilterExpression: { convertedBookingId: { $type: 'objectId' } }
}
```

Alternative acceptable approach:

Do not define `convertedBookingId` on non-conversion events and use a partial index that only indexes existing ObjectId values.

### 8.6 Event enum

Client-allowed events:

- `property_view`
- `search_results`
- `confirm_page_view`
- `checkout_started`

Server-only events:

- `quote_received`
- `quote_failed`
- `booking_converted`

Rejected always:

- unknown event types
- arbitrary metadata objects
- email
- phone
- firstName
- lastName
- guestInfo
- raw Stripe IDs from client
- raw errors

### 8.7 Client event payloads

`property_view`

Trigger:

Cabin or A-frame page mount after entity is loaded.

Payload:

- sessionKey
- visitorKey optional
- `cabinId` XOR `cabinTypeId`
- propertyKind if known
- URL dates if present
- attribution subset only if consent allows

`search_results`

Trigger:

After successful availability search.

Payload:

- sessionKey
- visitorKey optional
- checkInDateOnly
- checkOutDateOnly
- adults
- children
- searchResultCount

`confirm_page_view`

Trigger:

Confirm page mount with valid stay params.

Payload:

- sessionKey
- visitorKey optional
- entity
- checkInDateOnly
- checkOutDateOnly
- adults
- children

### 8.8 Server event payloads

`quote_received`

Trigger:

Successful `POST /api/bookings/quote`.

Payload:

- entity
- propertyKind resolved server-side
- checkInDateOnly
- checkOutDateOnly
- adults
- children
- priceShownCents
- currency
- sessionKey if provided
- visitorKey if provided

`quote_failed`

Trigger:

Quote failure, including validation, unavailable, not found, capacity, promo, server error where safely classifiable.

Payload:

- quoteFailureClass
- entity if parseable
- dates if parseable
- adults and children if parseable
- sessionKey if provided
- visitorKey if provided

Never store raw error message.
Never store stack trace.
Never let logging change the quote response.

`booking_converted`

Trigger:

Confirmed direct booking created through public guest portal.

Payload:

- convertedBookingId
- entity
- propertyKind
- checkInDateOnly
- checkOutDateOnly
- priceShownCents
- currency
- checkoutId
- sessionKey if available
- visitorKey if available

Only emit when:

- booking is newly confirmed
- not idempotent replay
- `booking.provenance.source === guest_portal`

Exclude manual, staff, craft, and replayed bookings.

### 8.9 Dedupe formulas

Dedupe must prevent frontend double fires without globally merging unrelated visitors.

`property_view`

```txt
pv:{sessionKey}:{entityType}:{entityId}:{YYYY-MM-DD}
```

`search_results`

```txt
sr:{sessionKey}:{checkIn}:{checkOut}:{adults}:{children}:{YYYY-MM-DD}
```

`confirm_page_view`

```txt
cp:{sessionKey}:{entityType}:{entityId}:{checkIn}:{checkOut}
```

`quote_received`

```txt
qr:{sessionKeyOrVisitorKey}:{entityType}:{entityId}:{checkIn}:{checkOut}:{adults}:{children}:{priceCents}:{promoHash8}
```

If neither sessionKey nor visitorKey exists, do not globally dedupe across all users.

Safe orphan fallback (shipped):

```txt
qr:orphan:{uuid}
qf:orphan:{uuid}
```

Each orphan event gets a unique UUID so unrelated anonymous visitors are never merged.

`booking_converted`

```txt
bc:{bookingId}
```

### 8.10 Endpoint: funnel event ingest

Endpoint:

`POST /api/funnel-events`

Auth:

Public.

Feature flag:

`FUNNEL_TRACKING_ENABLED=1`

If disabled:

```js
202 { success: true, skipped: true }
```

Rate limit:

60 requests per minute per IP, unless Cursor finds a better existing pattern.

Body limit:

8kb target.

Important:

Cursor must audit `server.js` parser order before implementation. If global `express.json()` is mounted before routes, route-level body limit may not protect this endpoint. In that case, propose the safest implementation without destabilizing existing routes.

Accepted response:

```js
202 { success: true }
```

Duplicate response:

```js
202 { success: true, duplicate: true }
```

Feature-disabled response:

```js
202 { success: true, skipped: true }
```

Validation error:

```js
400 { success: false, message: 'Invalid funnel event' }
```

Rate limited:

```js
429 { success: false, message: 'Too many requests' }
```

Ingest errors:

Prefer safe 202 for client-side non-critical events, with server logging.
Never break the user flow because of funnel tracking.

### 8.11 Quote hook requirements

The quote hook must be fire-and-forget.

It must never block, slow down, or change the quote response.

Cursor must audit exact error handling in `POST /api/bookings/quote` before implementation.

Required behavior:

- record `quote_received` on successful quote
- record `quote_failed` on safe failure branches
- do not refactor quote logic
- do not store raw error messages
- do not throw from funnel logging into route response

Optional request fields on quote body:

```js
funnelSessionKey?: string
funnelVisitorKey?: string
```

These fields are only for funnel linking and must be ignored by pricing logic.

### 8.12 Client tracking helper

File:

`client/src/tracking/funnel.js`

Behavior:

- no-op if `VITE_FUNNEL_TRACKING_ENABLED !== true`
- no-op unless analytics consent is true
- build payload only from whitelist
- add sessionKey and visitorKey from attribution helpers
- send using `navigator.sendBeacon` where possible
- fallback to `fetch` with `keepalive: true`
- never throw into UI
- never block navigation

Consent rule for Batch 1:

Client events are gated by existing analytics consent.

Server quote and conversion events are operational logs and do not require client analytics consent because they store no PII and are tied to operational booking flow.

### 8.13 Feature flags

Server:

```txt
FUNNEL_TRACKING_ENABLED=1
```

Client:

```txt
VITE_FUNNEL_TRACKING_ENABLED=true
```

Default should be off unless explicitly enabled in environment.

### 8.14 Track B tests

Required service tests:

- unknown event type rejected
- PII fields rejected or stripped
- arbitrary metadata rejected
- property_view dedupe works
- quote_received dedupe includes session or visitor key
- anonymous quote_received does not globally dedupe unrelated users
- quote_failed maps safe reason classes only
- raw error message is not stored
- booking_converted unique per booking
- propertyKind resolves from Cabin
- propertyKind resolves from CabinType
- feature flag off makes record functions no-op

Required route tests:

- valid property_view returns 202 and inserts row
- duplicate returns 202 and inserts one row
- invalid eventType returns 400
- oversized body rejected according to final middleware decision
- rate limit returns 429
- feature flag off returns skipped and inserts no row

## 9. Consent and privacy

Batch 1 privacy posture:

- client funnel tracking requires analytics consent
- no email or phone in client funnel events
- no firstName, lastName, or guestInfo in funnel events
- no raw Stripe IDs from client
- no raw error storage
- 180-day TTL on funnel events
- marketing use is out of scope
- abandoned email use is out of scope
- future privacy policy update may be needed before using funnel data for email recovery

This is a capture layer, not a marketing automation layer.

## 10. What not to build yet

Do not build these in Batch 1:

- `/ops/insights` UI
- `/ops/conversion` UI
- conversion summary endpoints
- abandoned cart emails
- email-before-Stripe capture
- availability alerts
- saved quote emails
- newsletter logic
- BNPL
- deposit payments
- Stripe reconciliation
- Airbnb import
- forecast engine
- occupancy metrics
- charts
- pricing suggestions
- joined revenue plus conversion dashboard

## 11. Future roadmap

### Batch 2

Delivered scope:

- `/ops/insights` UI for Track A summary and data quality
- `checkout_started` client event
- `GET /api/ops/conversion/summary`
- minimal `/ops/conversion` page

Zone funnel (propertyKind-scoped drop-off):

```txt
property_view → confirm_page_view → quote_received → checkout_started → booking_converted
```

`search_results` is supplementary only in Batch 2:

- site-wide session and event counts
- not included in Cabin/Valley drop-off
- do not fake propertyKind attribution

Conversion summary guardrails:

- default UI date range: current month
- max API query range: 180 days (funnel TTL)
- `checkout_started` has no historical data before Batch 2 deployment

### Batch 3A (delivered)

- Paginated `GET /api/ops/insights/bookings` drill-down (includes Valley `LocationBooking` rows with null detailHref)
- Entity filters on insights (`cabinId` / `cabinTypeId` / `unitId`) and conversion (`cabinId` / `cabinTypeId` only)
- Distinct data-quality issue codes: `missing_property_kind`, `both_cabin_and_cabin_type`, `missing_inventory_ref`
- Booked/checkIn Sofia end-exclusive date bounds
- Creator DTO + purchase-only gift commission accrual fixes

### Batch 3B (delivered)

- Read-only `GET /api/ops/insights/reconciliation`
- Additive reconciliation panel on `/ops/insights`
- Unlinked Payments remain site-wide and unattributed

### Batch 4A (delivered)

Purpose: persist recoverable commercial quote/checkout intent. **No automated sending.**

See Batch 4A.1 for Valley coverage, consent foundation, retention, and query performance.

### Batch 4A.1 (delivered)

Purpose: close foundation gaps before any recovery send is allowed.

#### Valley quote coverage

- Hooked `POST /api/public/location-quotes/:slug` → `upsertSavedQuoteFromLocationQuote`
- `propertyKind: valley`, `entityType: location`, `locationKey`, deterministic location entity id
- Immutable buyout snapshot includes `includedTargets` summary (no per-unit duplicate journeys)
- Location checkout create links `checkoutId` + `checkoutExpiresAt`; finalize sets `locationBookingId` and suppresses related quotes
- Client attaches funnel identity on Valley quote/checkout requests

#### Exact consent types

1. `quote_delivery` — email the requested quote only
2. `booking_reminder` — limited abandoned-booking reminder
3. `marketing` — promotional email

UX: three separate optional checkboxes (default unchecked) on ConfirmBooking and Valley checkout. Declining does not block booking.

#### Consent audit trail

- Model: `QuoteContactConsentEvent` (append-only)
- Fields: consentType, granted, textVersion, textSnapshot, capturedAt, sourceSurface, emailNormalized, savedQuoteId, checkoutSessionId, bookingId, locationBookingId
- Journey snapshot copied onto `SavedBookingQuote.consentSnapshot` + boolean flags for fast display

#### Current preference resolution

- Service: `resolveGuestContactStatus(email)`
- Sources: `GuestContactPreference` (quoteDelivery, bookingReminder, marketing, suppressed) with fallback to latest consent events
- Precedence: global suppression > latest explicit withdrawal > earlier grants
- Saved quote snapshot alone must not keep a journey eligible after withdrawal

#### Quote expiry versus checkout expiry

- `expiresAt` — commercial quote TTL (48h)
- `checkoutExpiresAt` — checkout session / hold soft expiry (distinct)
- Display and eligibility distinguish `expired` (quote) vs `checkout_still_active`

#### Retention and anonymization

- `purgeSavedBookingQuotes` service + `server/scripts/purgeSavedBookingQuotes.cjs`
- Dry-run by default; `--execute` anonymizes email/session/visitor; keeps suppression + booking links
- No automatic scheduler in this batch; no TTL index

#### Recovery query limitations

- Persisted filters paginated in MongoDB with exact totals (`totalBasis: persisted_filters`)
- Derived eligibility uses bounded fill-batch scan (`totalBasis: derived_filters`, `total: null`)
- Provenance documents which filters are persisted vs derived

#### No-send limitation (superseded by Batch 4B safety layer)

Batch 4A.1 had no send endpoints. Batch 4B adds preview/links/preparation only — still no guest send.

#### Batch 4B entry requirements (met)

1. Cabin and Valley saved quote coverage exists
2. Explicit reminder consent can be captured
3. Consent withdrawal is respected
4. Global suppression is respected
5. Recovery queries are paginated and bounded
6. Retention tooling exists
7. No-send tests pass

### Batch 4B (delivered)

Purpose: recovery delivery safety layer. **No guest emails. No live scheduler. No provider send.**

#### Public preference withdrawal

- Model: `GuestPreferenceAccessToken` (SHA-256 of opaque token; email stored server-side only)
- Routes: `GET/POST /api/public/communication-preferences/:token`
- UI: `/communication-preferences/:token` (unauthenticated)
- Actions: withdraw quote delivery / booking reminder / marketing; suppress-all optional contact
- Effects: append `QuoteContactConsentEvent`; update `GuestContactPreference`; propagate to every `SavedBookingQuote` for normalized email; cancel unsent ledger rows
- Hard rule: public token cannot grant consent
- Expired / invalid / revoked tokens change nothing

#### Immutable delivery ledger

- Model: `RecoveryMessageDelivery`
- Idempotency key: `recovery:{savedQuoteId}:{messagePurpose}:{templateKey:version}:{sequence}`
- Statuses: `prepared` | `prepared_preview` | `blocked` | `cancelled` | `sent` | `delivered` | `bounced` | `complained` | `failed`
- Batch 4B never writes `sent` via a real send path; preview uses `prepared_preview`
- Stores `recipientHash` + `recipientDomain` only (no full email in list-facing delivery data)
- Conversion and global suppression cancel unsent `prepared`/`blocked` rows

#### Send-time gate

- Service: `evaluateRecoveryDeliveryGate`
- Rechecks immediately before any future send; does not send
- Reasons include: `allowed`, `missing_email`, `missing_consent`, `consent_withdrawn`, `globally_suppressed`, `already_converted`, `already_sent`, `outside_send_window`, `checkout_active`, `quote_expired`, `anonymized`, `test_or_internal`, `feature_disabled`, `invalid_record`
- Feature flags are evaluated after consent/lifecycle so preparation can still record dry-run candidates

#### Template registry and OPS preview

- Templates: `quote_delivery_v1`, `booking_reminder_v1` (identifiable after future edits)
- No fabricated urgency, availability reservation, post-expiry price guarantee, automatic discount, or marketing in quote-delivery
- Reminder templates include preference withdrawal URL
- `POST /api/ops/conversion/recovery/:id/preview` — subject/HTML/text + eligibility; no provider call
- `POST /api/ops/conversion/recovery/:id/links` — preference + continuation URL indicators for OPS

#### Continuation links

- Model: `RecoveryContinuationToken`
- Route: `GET /api/public/booking-continuation/:token` → `/booking-continuation/:token`
- Resolves Cabin confirm journey or Valley retreat journey
- Revalidates availability; shows immutable original quote; never creates booking or reserves inventory
- No raw sessionKey/visitorKey in URL or payload

#### Pagination semantics (corrected)

```js
{
  page,
  limit,
  returned,
  total,              // exact when totalBasis === 'persisted_filters'; null when derived
  totalBasis: 'persisted_filters' | 'derived_filters',
  hasMore
}
```

#### Disabled preparation services

- `findQuoteDeliveryCandidates`, `findBookingReminderCandidates`, `prepareRecoveryDelivery`
- No cron, queue producer, or provider calls
- Feature flags (default false / unset):
  - `RECOVERY_QUOTE_DELIVERY_ENABLED=0`
  - `RECOVERY_BOOKING_REMINDER_ENABLED=0`
  - `RECOVERY_EMAIL_PROVIDER_ENABLED=0`

#### Provider webhook preparation (not connected for recovery)

Existing Postmark webhook at `/api/email/webhook/postmark` routes:

- Legacy → `EmailEvent`
- Dispatch-tagged automation → `MessageDeliveryEvent`

**Batch 4C plan:** recovery sends must tag messages with `recovery:{deliveryId}` (or Metadata.recoveryDeliveryId). Webhook fork maps:

| Provider event | RecoveryMessageDelivery status | Side effects |
| --- | --- | --- |
| Delivery | `delivered` | set `deliveredAt` |
| Bounce (hard) | `bounced` | set `failedAt` / failureClass; prefer global suppression |
| SpamComplaint | `complained` | suppress optional contact |
| Open/Click | ignore for ledger status | optional analytics only if consented |

Match by `providerMessageId` stored at send time. Never invent delivery rows from webhooks. Re-run send gate is irrelevant for status updates; only lifecycle fields change.

#### Batch 4B no-send limitation

- No recovery mailer call
- No provider call for recovery
- No scheduled task / cron / queue
- No send / resend / bulk UI controls
- All recovery email feature flags default disabled

#### Batch 4C activation requirements

Do not enable production sending until:

1. Public withdrawal is live
2. Template wording is approved
3. Legal basis and consent wording are reviewed
4. Provider bounce and complaint handling is connected
5. Idempotency tests pass
6. Feature flags default disabled
7. Staging preview is approved
8. A capped rollout plan exists
9. Monitoring and emergency shutoff exist

### Batch 5

Likely scope:

- Airbnb/manual import via `ExternalChannelStay`
- external channel revenue in Track A

### Later

- occupancy metrics
- forecast engine
- deposit payments
- BNPL only if payment friction is proven
- UTM / device / checkout-type conversion breakdowns that require new capture fields

## 12. How future AIs should work on this

Every AI or coding agent must follow this workflow:

1. Read this document first.
2. Treat it as the source of truth.
3. Do not expand scope without explicit approval.
4. Audit before implementing when touching existing flows.
5. Preserve booking, payment, and availability behavior.
6. Keep Track A and Track B separate.
7. Add tests with every batch.
8. Report exact files changed.
9. Report any discovered drift before fixing it.
10. Ask for approval before adding new product behavior like emails, deposits, BNPL, or pricing logic.

## 13. Batch 1 approval state

Approved direction:

- two-track architecture
- Track B first or same sprint
- Track A minimal APIs only
- no UI in Batch 1
- no abandoned emails
- no email capture before Stripe
- no occupancy
- no forecast
- no Airbnb import

Required before coding:

- Cursor must incorporate dedupe corrections for quote events
- Cursor must fix convertedBookingId partial index
- Cursor must audit body parser order
- Cursor must use `revenueBasis=checkIn|booked` or clearly label check-in basis
- Cursor must confirm quote_failed hook placement

