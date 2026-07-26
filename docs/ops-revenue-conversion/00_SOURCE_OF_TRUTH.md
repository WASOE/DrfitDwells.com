# Drift & Dwells OPS Revenue and Conversion Intelligence

**Status:** Active source of truth for implementation  
**Last updated:** Batch 5A delivered

See the full specification in `SOURCE_OF_TRUTH.md`. All future AI and engineering work on OPS revenue and conversion intelligence must read this file first.

## Quick reference

- **Track A:** Revenue Intelligence — summary, data-quality, bookings, reconciliation, **performance**, **historical-data-quality**, filter-options; UI at `/ops/insights` and `/ops/insights/performance`
- **Track B:** Conversion Intelligence — funnel events, conversion summary, recovery (+ Batch 4B safety layer)
- **Feature flags (recovery, default OFF):** `RECOVERY_QUOTE_DELIVERY_ENABLED`, `RECOVERY_BOOKING_REMINDER_ENABLED`, `RECOVERY_EMAIL_PROVIDER_ENABLED`
- **Consent:** analytics consent ≠ email permission
- **revenueBasis:** `checkIn` | `booked` (Sofia day, end-exclusive)
- **Batch 5A:** direct historical sales + occupancy only; Airbnb/external channels excluded until 5B

## Architecture rules

1. Do not mutate `Booking`, `Payment`, `CheckoutSession`, or availability source data for reporting cosmetics
2. Booking = direct commercial truth; Payment = cash truth; iCal = availability only
3. Keep The Cabin and The Valley separate; use persisted IDs only
4. Do not fabricate unit assignments or treat iCal blocks as paid stays
5. Do not count maintenance/owner blocks as sellable; do not count cancelled stays as occupied
6. Historical uncertainty must remain visible (`verified` / `usable_with_limitations` / `revenue_only` / `unreliable`)
7. No occupancy from Mongo `createdAt` without explicit `InventoryOperatingPeriod` review

## Batch 5A (delivered)

- Audit: `server/scripts/auditHistoricalDirectSales.cjs`
- Denominator: `InventoryOperatingPeriod` + verified maintenance/manual blocks
- APIs: `GET /api/ops/insights/performance`, `GET /api/ops/insights/historical-data-quality`
- UI: `/ops/insights/performance`
- Repair: operating-period upsert + reporting metadata correction scripts (dry-run default)
- Live aggregation (no materialized commercial-truth collection)

## Batch 5B entry requirements

Do not start until Batch 5A is reviewed, operating periods are configured, and production audit gaps are accepted or repaired.

## Future

- **Batch 5B:** `ExternalChannelStay`, Airbnb import, combined occupancy / RevPAN
- **Batch 4C:** recovery send (separate track; still gated)
- **Later:** forecast, occupancy beyond direct+external as needed

For the complete specification, refer to `SOURCE_OF_TRUTH.md`.
