# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 2 implementation

See the full specification in `SOURCE_OF_TRUTH.md`. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — `GET /api/ops/insights/summary`, `GET /api/ops/insights/data-quality`, UI at `/ops/insights`
- **Track B:** Conversion Intelligence — `POST /api/funnel-events`, `GET /api/ops/conversion/summary`, UI at `/ops/conversion`
- **Feature flags:** `FUNNEL_TRACKING_ENABLED=1` (server), `VITE_FUNNEL_TRACKING_ENABLED=true` (client)
- **Consent:** Client funnel events require analytics consent; server quote events do not attach browser identity unless keys sent with consent
- **revenueBasis:** `checkIn` | `booked` (not `stay`)
- **Conversion query max range:** 180 days (matches funnel TTL)

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting
2. Funnel tracking is append-only (`BookingFunnelEvent`)
3. Stripe = payment truth; Booking = direct commercial truth; iCal = availability only
4. Keep The Cabin (`propertyKind: cabin`) and The Valley (`propertyKind: valley`) separate
5. No occupancy, forecast, Airbnb import, or reconciliation in Batch 1–2

## Zone funnel (Batch 2)

Primary zone-specific funnel — **excludes `search_results`**:

```
property_view → confirm_page_view → quote_received → checkout_started → booking_converted
```

`search_results` is **supplementary only** in Batch 2:

- Site-wide session and event counts
- Not propertyKind-scoped
- Not included in Cabin/Valley drop-off
- Do not fake propertyKind attribution for search_results

## Batch 2 delivered

### Track B — `checkout_started`
- Client event after `checkoutId` exists (`initializeCheckoutPayment`)
- Pay-on-arrival fallback in `handleConfirmAndPay` when Stripe disabled
- Dedupe: `cs:{sessionKey}:{checkoutId}` or stay-identity fallback

### Track B — Conversion summary API + UI
- `GET /api/ops/conversion/summary?propertyKind=&from=&to=`
- Session-sequential drop-off on zone funnel only
- Supplementary `search_results` and `quote_failed` sections
- UI at `/ops/conversion`

### Track A — Insights UI
- `/ops/insights` — KPI cards, channel table, data-quality banner
- Uses existing insights APIs only (no new Track A backend)

## Dedupe (quote + checkout events)

```
quote_received: qr:{sessionKeyOrVisitorKey}:{entityType}:{entityId}:{checkIn}:{checkOut}:{adults}:{children}:{priceCents}:{promoHash8}
quote_failed (with identity): qf:{identity}:{entityType}:{entityId}:{checkIn}:{checkOut}:{class}:{YYYY-MM-DD}:{HHmm}
orphan (no session/visitor): qr:orphan:{uuid} / qf:orphan:{uuid}
checkout_started: cs:{sessionKey}:{checkoutId}
checkout_started (pay-on-arrival): cs:{sessionKey}:{entityType}:{entityId}:{checkIn}:{checkOut}
```

## Future batches

- **Batch 3+:** entity filters, richer conversion breakdowns, optional zone-scoped search
- **Batch 4+:** saved quotes, abandoned recovery, Airbnb import, reconciliation, forecast

For the complete original specification, refer to `SOURCE_OF_TRUTH.md`.
