# Back-office consolidation: architectural decision

**Status:** locked for migration planning  
**Last updated:** planning doc only (no implementation implied)

## Decision

1. **OPS (`/ops`) is the only canonical back-office UI** for day-to-day operations after migration completes.
2. **Legacy Admin (`/admin`) is temporary compatibility only** during the transition: redirects, read-only shells, or thin proxies—not a place for new product work.
3. **After parity and soak, `/admin` is removed** from the product (routes, navigation, and eventually unused API surface where safe).

## Why OPS is canonical

- Reservation **writes** are already modeled as domain actions in OPS (`reservationWriteService`, conflict checks, audit, availability block sync), with readiness/cutover machinery designed around OPS primacy for reservations.
- OPS provides a **single operational surface** for calendar, reservations, availability actions, communications (arrival path), payments read-models, sync center, manual review, and readiness—aligned with “one back office.”
- Continuing to ship operational features on `/admin` **duplicates mental models** and risks conflicting lifecycle behavior on the same `Booking` documents.

## What `/admin` is allowed to do during migration

| Allowed | Not allowed |
|--------|--------------|
| Existing pages until replaced or redirected | **Any new operational features** on `/admin` |
| Read-only or “shell” views that point users to OPS | **New business logic** duplicated under `/admin` instead of shared services |
| Temporary compatibility: same APIs called from OPS after extraction, or thin proxies | **Expanding** admin-only workflows as the long-term home for new work |
| Emergency rollback: re-enable a route or UI behind explicit flags if a batch fails | Long-term reliance on `/admin` as primary |

## Non-negotiables

1. **No duplicate business logic** between Admin and OPS—extract to shared modules/services and call from one canonical path per behavior.
2. **No new operational features on `/admin`** from the date this decision is adopted; all new work lands in OPS (or shared services consumed by OPS).
3. **Do not remove `/admin` until OPS has proven parity** for the workflows that team members actually use (tracked in the feature matrix and phase plan).
4. **Small, reviewable batches only**—each batch reversible by a single revert where possible.
5. **Explicitly out of scope unless a dedicated batch says otherwise:**
   - Stripe / payment processing logic
   - Booking pricing logic
   - iCal / sync engine behavior
   - Public website / guest-facing pages

## Related documents

- `01_FEATURE_MATRIX.md` — inventory and targets  
- `02_PHASE_PLAN.md` — ordered phases  
- `03_RULES_FOR_CURSOR.md` — implementation rules for agents  
- `04_FIRST_BATCH_PLAN.md` — recommended first implementation slice  
