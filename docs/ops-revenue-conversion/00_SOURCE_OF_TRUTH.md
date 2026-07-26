# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 3A + 3B delivered

See the full specification in `SOURCE_OF_TRUTH.md`. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — `GET /api/ops/insights/summary`, `GET /api/ops/insights/data-quality`, `GET /api/ops/insights/bookings`, `GET /api/ops/insights/reconciliation`, `GET /api/ops/insights/filter-options`, UI at `/ops/insights`
- **Track B:** Conversion Intelligence — `POST /api/funnel-events`, `GET /api/ops/conversion/summary`, UI at `/ops/conversion`
- **Feature flags:** `FUNNEL_TRACKING_ENABLED=1` (server), `VITE_FUNNEL_TRACKING_ENABLED=true` (client)
- **Consent:** Client funnel events require analytics consent; server quote events do not attach browser identity unless identity keys were sent with consent
- **revenueBasis:** `checkIn` | `booked` (Sofia day, end-exclusive; not `stay`)
- **Conversion query max range:** 180 days (matches funnel TTL)
- **Conversion entity filters:** `cabinId` | `cabinTypeId` only (no `unitId`)
- **Insights entity filters:** `cabinId` | `cabinTypeId` | `unitId` (strict persisted propertyKind validation)

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting
2. Funnel tracking is append-only (`BookingFunnelEvent`)
3. Stripe = payment truth; Booking = direct commercial truth; iCal = availability only
4. Keep The Cabin (`propertyKind: cabin`) and The Valley (`propertyKind: valley`) separate
5. Never infer `propertyKind` from names, slugs or listing labels
6. No occupancy, Airbnb import, forecasting, recovery emails or pricing recommendations in Batch 3

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

## Future batches

- **Batch 4+:** saved quotes, abandoned recovery, Airbnb import (`ExternalChannelStay`), forecast
- **Later:** occupancy, ADR, RevPAN, richer conversion attribution breakdowns requiring new capture fields

For the complete specification, refer to `SOURCE_OF_TRUTH.md`.
