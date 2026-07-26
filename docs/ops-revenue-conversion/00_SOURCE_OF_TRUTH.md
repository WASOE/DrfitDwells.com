# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 4A delivered

See the full specification in `SOURCE_OF_TRUTH.md`. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — `GET /api/ops/insights/summary`, `GET /api/ops/insights/data-quality`, `GET /api/ops/insights/bookings`, `GET /api/ops/insights/reconciliation`, `GET /api/ops/insights/filter-options`, UI at `/ops/insights`
- **Track B:** Conversion Intelligence — `POST /api/funnel-events`, `GET /api/ops/conversion/summary`, `GET /api/ops/conversion/recovery`, `GET /api/ops/conversion/recovery/:id`, UI at `/ops/conversion` and `/ops/conversion/recovery`
- **Feature flags:** `FUNNEL_TRACKING_ENABLED=1` (server), `VITE_FUNNEL_TRACKING_ENABLED=true` (client)
- **Consent:** Client funnel events require analytics consent; server quote events do not attach browser identity unless identity keys were sent with consent
- **Analytics consent ≠ email/marketing consent.** Entering an email at checkout does not authorize promotional or recovery email.
- **revenueBasis:** `checkIn` | `booked` (Sofia day, end-exclusive; not `stay`)
- **Conversion query max range:** 180 days (matches funnel TTL)
- **Conversion entity filters:** `cabinId` | `cabinTypeId` only (no `unitId`)
- **Insights entity filters:** `cabinId` | `cabinTypeId` | `unitId` (strict persisted propertyKind validation)

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting
2. Funnel tracking is append-only (`BookingFunnelEvent`) — not durable recovery state
3. Durable recovery commercial state lives in `SavedBookingQuote` (Batch 4A)
4. Stripe = payment truth; Booking = direct commercial truth; iCal = availability only
5. Keep The Cabin (`propertyKind: cabin`) and The Valley (`propertyKind: valley`) separate
6. Never infer `propertyKind` from names, slugs or listing labels
7. No occupancy, Airbnb import, forecasting, or automated recovery emails in Batch 4A
8. Do not reconstruct quote prices from current prices after abandonment — persist the exact snapshot

## Saved quotes (Batch 4A)

- Model: `SavedBookingQuote`
- Source of truth for recoverable quote/checkout intent (not `BookingFunnelEvent`)
- Quote TTL: 48h (`expiresAt`), aligned with CheckoutSession soft expiry
- Display status may be derived from timestamps; no write job required to show expired
- Dedupe: deterministic `quoteFingerprint` when `sessionKey`/`visitorKey` present; anonymous orphans insert-only (never merge strangers)
- Consent defaults: `marketingConsent=false`, `transactionalContinuationEligible=false`
- Email alone → `missing_email` or `no_valid_consent` — never send-eligible from analytics consent alone
- **Batch 4A does not send any recovery or marketing messages** (no send APIs, no templates, no UI send controls)
- Retention: active/recent quotes 180 days operational retention documented; no Mongo TTL index yet (converted refs + suppression need deliberate purge design)
- Cabin public quote path hooked (`POST /api/bookings/quote`); Valley location-quote path not yet hooked

## Payment snapshot (Track A)

- API field `cashCollectedCents` is retained for compatibility
- UI label: **Payment snapshot at booking**
- Source: `Booking.stripePaidAmountCents` at finalize (LocationBooking uses `totalPrice` when `stripePaymentIntentId` is present)
- Limitations: does not reflect later refunds or later payment changes; not live Stripe balance

## Reconciliation (Batch 3B)

- `GET /api/ops/insights/reconciliation` is **read-only** and **additive**
- Does not replace summary `cashCollectedCents`
- Linked Payment ledger joins `Payment.reservationId` to Booking stays only
- Unlinked Payments are **site-wide**, never attributed to Cabin/Valley/entity, and never included in zone variance
- Gift voucher product-sale Payments are excluded from stay ledger totals

## Valley LocationBooking masters

- Track A Valley summaries and drill-down include `LocationBooking` masters once
- Child Bookings with `excludeFromRevenueReporting: true` are omitted
- Drill-down rows use `stayKind: 'location_booking'`, `detailHref: null`, and a Valley buyout badge
- Entity filters that cannot apply to LocationBooking omit those rows (stated in provenance)

## Zone funnel

Primary zone-specific funnel — **excludes `search_results`**:

```
property_view → confirm_page_view → quote_received → checkout_started → booking_converted
```

`search_results` is **supplementary only**:

- Site-wide session and event counts
- Not propertyKind-scoped
- Not included in Cabin/Valley drop-off
- Entity filters never apply
- Do not fake propertyKind attribution for search_results

Saved-quote recovery counts on conversion summary are also **supplementary only** and must not be mixed into session-sequential drop-off.

## Dedupe (quote + checkout events)

```
quote_received: qr:{sessionKeyOrVisitorKey}:{entityType}:{entityId}:{checkIn}:{checkOut}:{adults}:{children}:{priceCents}:{promoHash8}
quote_failed (with identity): qf:{identity}:{entityType}:{entityId}:{checkIn}:{checkOut}:{class}:{YYYY-MM-DD}:{HHmm}
orphan (no session/visitor): qr:orphan:{uuid} / qf:orphan:{uuid}
checkout_started: cs:{sessionKey}:{checkoutId}
checkout_started (pay-on-arrival): cs:{sessionKey}:{entityType}:{entityId}:{checkIn}:{checkOut}
```

## Batch 3 delivered

### Batch 3A
- Booked date range end-exclusive fix
- `GET /api/ops/insights/bookings` paginated drill-down
- Entity filters on insights summary + conversion summary
- Insights/Conversion UI filters, payment-snapshot labelling, cancelled revenue, distinct DQ codes
- Creator stats DTO preserves `paidStayRevenue` / `attributedBookingValue`
- Gift commission accrual requires `issuanceSource === 'purchase'`

### Batch 3B
- `GET /api/ops/insights/reconciliation`
- Compact reconciliation panel on `/ops/insights`

## Batch 4A delivered

- `SavedBookingQuote` model + immutable pricing snapshot
- Fire-and-forget hooks: quote upsert, checkout link, booking conversion suppress
- Pure recovery eligibility engine (no send)
- `GET /api/ops/conversion/recovery` (+ detail)
- Supplementary saved-quote counts on conversion summary
- UI `/ops/conversion/recovery` (finance module; no send controls)

## Future batches

- **Batch 4B:** automated/manual recovery messaging only after approved consent UX and legal basis; GuestContactPreference checks; Valley location-quote hooks
- **Later:** Airbnb import (`ExternalChannelStay`), forecast, occupancy, ADR, RevPAN

For the complete specification, refer to `SOURCE_OF_TRUTH.md`.
