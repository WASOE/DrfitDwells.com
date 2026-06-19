# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 1 implementation

See the full specification in this document. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — `GET /api/ops/insights/summary`, `GET /api/ops/insights/data-quality`
- **Track B:** Conversion Intelligence — `POST /api/funnel-events`, server quote/finalize hooks
- **Feature flags:** `FUNNEL_TRACKING_ENABLED=1` (server), `VITE_FUNNEL_TRACKING_ENABLED=true` (client)
- **Consent:** Client funnel events require analytics consent; server quote events do not attach browser identity unless keys sent with consent
- **revenueBasis:** `checkIn` | `booked` (not `stay`)
- **No UI in Batch 1** for either track

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting
2. Funnel tracking is append-only (`BookingFunnelEvent`)
3. Stripe = payment truth; Booking = direct commercial truth; iCal = availability only
4. Keep The Cabin (`propertyKind: cabin`) and The Valley (`propertyKind: valley`) separate
5. No occupancy, forecast, Airbnb import, or reconciliation in Batch 1

## Batch 1 delivered

### Track B
- `server/models/BookingFunnelEvent.js`
- `server/services/conversion/*`
- `server/routes/funnelEventRoutes.js`
- `server/server.js` — funnel mount before global JSON (8kb) + `funnelEventLimiter`
- Quote `finally` hook + booking conversion hook in `bookingRoutes.js`
- `client/src/tracking/funnel.js` + page integrations

### Track A
- `server/services/ops/reporting/*`
- `server/services/ops/readModels/insightsReadModel.js`
- `server/routes/ops/modules/insightsRoutes.js`

## Dedupe (quote events)

```
quote_received: qr:{sessionKeyOrVisitorKey}:{entityType}:{entityId}:{checkIn}:{checkOut}:{adults}:{children}:{priceCents}:{promoHash8}
quote_failed (with identity): qf:{identity}:{entityType}:{entityId}:{checkIn}:{checkOut}:{class}:{YYYY-MM-DD}:{HHmm}
orphan (no session/visitor): qr:orphan:{uuid} / qf:orphan:{uuid}
```

## Future batches

- **Batch 2:** `/ops/insights` UI, `checkout_started` event
- **Batch 3:** `/ops/conversion` summary UI
- **Batch 4+:** saved quotes, abandoned recovery, Airbnb import, reconciliation, forecast

For the complete original specification, refer to git history or the planning document provided at project kickoff.
