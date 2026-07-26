# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 4B delivered

See the full specification in `SOURCE_OF_TRUTH.md`. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — `GET /api/ops/insights/summary`, `GET /api/ops/insights/data-quality`, `GET /api/ops/insights/bookings`, `GET /api/ops/insights/reconciliation`, `GET /api/ops/insights/filter-options`, UI at `/ops/insights`
- **Track B:** Conversion Intelligence — `POST /api/funnel-events`, `GET /api/ops/conversion/summary`, `GET /api/ops/conversion/recovery`, `GET /api/ops/conversion/recovery/:id`, UI at `/ops/conversion` and `/ops/conversion/recovery`
- **Public withdrawal:** `GET/POST /api/public/communication-preferences/:token` → `/communication-preferences/:token`
- **Continuation:** `GET /api/public/booking-continuation/:token` → `/booking-continuation/:token`
- **OPS preview (no send):** `POST /api/ops/conversion/recovery/:id/preview`, `POST /api/ops/conversion/recovery/:id/links`
- **Feature flags (all default OFF):** `RECOVERY_QUOTE_DELIVERY_ENABLED`, `RECOVERY_BOOKING_REMINDER_ENABLED`, `RECOVERY_EMAIL_PROVIDER_ENABLED`
- **Consent:** Client funnel events require analytics consent; analytics consent is never email permission
- **Quote contact consents:** separate optional checkboxes for quote delivery, booking reminder, and marketing — none preselected
- **revenueBasis:** `checkIn` | `booked` (Sofia day, end-exclusive; not `stay`)
- **Conversion query max range:** 180 days

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting
2. Funnel tracking is append-only (`BookingFunnelEvent`) — not durable recovery state
3. Durable recovery commercial state lives in `SavedBookingQuote`
4. Consent audit trail lives in append-only `QuoteContactConsentEvent`; current preference on `GuestContactPreference`
5. Delivery attempts live in append-only `RecoveryMessageDelivery` (Batch 4B never writes `sent` via real send)
6. Keep The Cabin (`propertyKind: cabin`) and The Valley (`propertyKind: valley`) separate
7. Never expose raw browser identity (`sessionKey` / `visitorKey`) in OPS list or public URLs
8. Consent must be rechecked at delivery time; global suppression always wins; conversion cancels future recovery
9. **No guest recovery emails, quote delivery emails, reminders, manual send, live scheduler, or automatic discounts in Batch 4B**

## Batch 4B (delivered) — Recovery Delivery Safety Layer

Prepares recovery delivery infrastructure **without sending**.

### Public preference withdrawal

- Opaque hashed token (`GuestPreferenceAccessToken`); URL never contains email or internal IDs
- Withdraw quote delivery / booking reminder / marketing; suppress-all optional contact
- Appends `QuoteContactConsentEvent`; updates `GuestContactPreference`; propagates to all quotes for normalized email
- Public token **cannot grant** consent; repeated withdrawal is idempotent
- Confirmation pages for success / invalid / expired

### Delivery ledger

- Model: `RecoveryMessageDelivery`
- Idempotency: `recovery:{savedQuoteId}:{messagePurpose}:{templateVersion}:{sequence}`
- Statuses prepared for future provider lifecycle; Batch 4B writes `prepared` / `prepared_preview` / `blocked` / `cancelled` only
- No full recipient email in list-facing data (hash + domain only)
- Conversion / suppression cancels unsent prepared/blocked rows

### Send-time gate

- `evaluateRecoveryDeliveryGate` — final decision only; does not send
- Rechecks consent, suppression, convert, anonymized, window, idempotency, flags, test/internal

### Templates & OPS preview

- Versioned: `quote_delivery_v1`, `booking_reminder_v1`
- Not connected to email provider
- Preview renders subject/HTML/text + eligibility; may write `prepared_preview` audit only

### Continuation links

- Opaque `RecoveryContinuationToken` → Cabin or Valley journey
- Revalidates availability; shows immutable original quote; never silently overwrites

### Pagination

- Persisted filters → exact `total`, `totalBasis: "persisted_filters"`
- Derived eligibility → fill-batch scan (cap 2000), `total: null`, `totalBasis: "derived_filters"`, `returned`, `hasMore`

### Disabled preparation

- `findQuoteDeliveryCandidates` / `findBookingReminderCandidates` / `prepareRecoveryDelivery`
- No cron, queue, or provider calls; flags default false

### Batch 4B no-send limitation

Still no production send path, no scheduler, no send/resend/bulk UI, no List-Unsubscribe headers (prepared for 4C).

## Batch 4C activation requirements

Do not start production sending until:

1. Public withdrawal is live
2. Template wording is approved
3. Legal basis and consent wording are reviewed
4. Provider bounce and complaint handling is connected to `RecoveryMessageDelivery` + preference suppression
5. Idempotency tests pass
6. Feature flags default disabled
7. Staging preview is approved
8. A capped rollout plan exists
9. Monitoring and emergency shutoff exist

## Future

- **Batch 4C:** capped recovery send with provider status mapping
- **Later:** Airbnb import, forecast, occupancy

For the complete specification, refer to `SOURCE_OF_TRUTH.md`.
