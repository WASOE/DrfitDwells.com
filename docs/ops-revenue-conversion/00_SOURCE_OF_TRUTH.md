# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 4A.1 delivered

See the full specification in `SOURCE_OF_TRUTH.md`. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — `GET /api/ops/insights/summary`, `GET /api/ops/insights/data-quality`, `GET /api/ops/insights/bookings`, `GET /api/ops/insights/reconciliation`, `GET /api/ops/insights/filter-options`, UI at `/ops/insights`
- **Track B:** Conversion Intelligence — `POST /api/funnel-events`, `GET /api/ops/conversion/summary`, `GET /api/ops/conversion/recovery`, `GET /api/ops/conversion/recovery/:id`, UI at `/ops/conversion` and `/ops/conversion/recovery`
- **Feature flags:** `FUNNEL_TRACKING_ENABLED=1` (server), `VITE_FUNNEL_TRACKING_ENABLED=true` (client)
- **Consent:** Client funnel events require analytics consent; analytics consent is never email permission
- **Quote contact consents (Batch 4A.1):** separate optional checkboxes for quote delivery, booking reminder, and marketing — none preselected; declining does not block booking
- **revenueBasis:** `checkIn` | `booked` (Sofia day, end-exclusive; not `stay`)
- **Conversion query max range:** 180 days
- **Conversion entity filters:** `cabinId` | `cabinTypeId` only (no `unitId`)
- **Insights entity filters:** `cabinId` | `cabinTypeId` | `unitId` (strict persisted propertyKind validation)

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting
2. Funnel tracking is append-only (`BookingFunnelEvent`) — not durable recovery state
3. Durable recovery commercial state lives in `SavedBookingQuote`
4. Consent audit trail lives in append-only `QuoteContactConsentEvent`; current preference on `GuestContactPreference`
5. Keep The Cabin (`propertyKind: cabin`) and The Valley (`propertyKind: valley`) separate
6. Never infer `propertyKind` from names, slugs or listing labels
7. No occupancy, Airbnb import, forecasting, or automated recovery emails until Batch 4B entry criteria are met
8. Do not reconstruct quote prices from current prices after abandonment

## Saved quotes

- Model: `SavedBookingQuote`
- Cabin path: `POST /api/bookings/quote`
- Valley path: `POST /api/public/location-quotes/:slug` (`entityType: location`, `locationKey`, location buyout snapshot)
- Quote TTL: 48h (`expiresAt`) — distinct from checkout hold / CheckoutSession soft expiry (`checkoutExpiresAt`)
- Dedupe by fingerprint when browser identity present; anonymous orphans insert-only
- Conversion suppresses related abandoned quotes for the same commercial journey
- **No send APIs, templates, schedulers, or UI send controls**

## Consent types (exact)

| Type | Field | Meaning |
| --- | --- | --- |
| Quote delivery | `quoteDeliveryRequested` | Permission to email the requested quote only |
| Booking reminder | `bookingReminderConsent` | Limited abandoned-booking reminder |
| Marketing | `marketingConsent` | Promotional offers / news |

Audit: `QuoteContactConsentEvent` stores `consentType`, `granted`, `textVersion`, `textSnapshot`, `capturedAt`, `sourceSurface`, links.

Effective preference: `resolveGuestContactStatus(email)` — latest withdrawal wins; global suppression overrides all optional sends.

Eligibility reasons include: `quote_delivery_requested`, `booking_reminder_consent`, `marketing_consent`, `no_valid_consent`, `consent_withdrawn`, `globally_suppressed`, `already_converted`, `missing_email`, `expired`, `checkout_still_active`, `already_recovered`, `test_or_internal`, `invalid_quote`.

Quote delivery eligibility does **not** authorize repeated reminder drips.

## Retention

- Operational target: 180 days
- Script: `node server/scripts/purgeSavedBookingQuotes.cjs` (dry-run default; `--execute` to anonymize)
- Anonymizes email + browser keys; retains booking/locationBooking linkage and suppression markers
- No Mongo TTL index

## Recovery query

- DB pagination on persisted filters (`propertyKind`, dates, status, entity, hasEmail, suppressed, consent snapshot flags)
- Derived eligibility evaluated **after** pagination
- Indexes: propertyKind+quotedAt, status, locationKey, expiresAt+status, emailNormalized, checkoutId, session/visitor sparse keys

## Batch 4A.1 delivered

- Valley location quote persistence + checkout/convert hooks
- Explicit consent UX on ConfirmBooking + Valley checkout
- Consent events + GuestContactPreference fields + live eligibility resolution
- Retention purge tooling
- Scalable recovery list query + OPS UI consent/suppression columns

## Batch 4B entry requirements

Do not start Batch 4B until all are true:

1. Cabin and Valley saved quote coverage exists
2. Explicit reminder consent can be captured
3. Consent withdrawal is respected
4. Global suppression is respected
5. Recovery queries are paginated and bounded
6. Retention tooling exists
7. No-send tests pass

## Future

- **Batch 4B:** send infrastructure only after legal/consent review
- **Later:** Airbnb import, forecast, occupancy

For the complete specification, refer to `SOURCE_OF_TRUTH.md`.
