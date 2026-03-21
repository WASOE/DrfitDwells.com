# Calendar UX correction batch — build notes

## Scope

Replace `/ops` calendar card/list UI with:

1. **Property index** (`/ops/calendar`) — real list + compact occupancy preview from `indexPreview=1`.
2. **Single-property month grid** (`/ops/calendar/:cabinId`) — operational month view with spanning bars.

No backend architecture redesign. `AvailabilityBlock` + `Booking`-derived reservation blocks remain source of truth; conflicts/sync stay computed in the read model.

## Backend / read-model (`/api/ops/calendar`)

### Preserved

- Block assembly (availability blocks + reservation-backed rows), exclusive-end semantics, tombstone exclusion, conflict pairing, provenance.

### Added / changed

- **`mode`**: `range` (default) | `index_preview`.
- **`meta`**: `propertyTimezone`, `today` (YYYY-MM-DD Sofia), `rangeStart` / `rangeEnd` (ISO).
- **Per-block `render`** (derived on read, UI-only):
  - `labelShort`, `guestInitials`, `guestShortName` (reservations from `Booking.guestInfo`; nulls if missing).
  - `blockTypeToken` (same as `blockType`).
  - `conflictToken`: `hard` | `warning` | `null` (from existing conflict markers).
  - `occupiedDayKeys`: YYYY-MM-DD keys in Sofia for intersection with the requested window (for index strip + grid alignment without client-side timezone math on raw instants).
- **`indexPreview=1`**: optional `previewDays` (7–31, default 14). Omits `from`/`to`; returns `previewByCabin[]` with `listing`, `blocks`, `conflictMarkers`, `syncIndicators`, `summary` counts.
- **`pricingHint`** (range + `cabinId` only): `{ nightPrice, currency, source }` from `Cabin.pricePerNight` when present; explicit nulls otherwise.
- **Sync**: single-cabin range queries prefer `CabinChannelSyncState` (airbnb_ical), then `ChannelSyncEvent` (aligned with Sync Center intent).

### Parity

- `runCalendarParity` expected sync for scoped `cabinId` updated to match the read model’s sync resolution.

## Frontend

- `client/src/pages/ops/calendar/OpsCalendarIndex.jsx` — index + preview strip.
- `client/src/pages/ops/calendar/OpsCalendarMonth.jsx` — month grid, bars, actions.
- `client/src/pages/ops/calendar/calendarVisualTokens.js` — shared colors / legend.
- `client/src/pages/ops/calendar/opsCalendarDateUtils.js` — **layout-only** date math (no conflict/payment logic).
- `client/src/App.jsx` — routes for index + `:cabinId`.
- Removed `client/src/pages/ops/OpsCalendar.jsx` (list-only view).

## Validation

- `server/scripts/validateBuildCalendarUxBatch.js` + `npm run validate:calendarux` — shape checks for `index_preview` and `range` + `render` fields.

## Staging vs live

- **Safe for local/staging validation** once Mongo + auth are available; **not** a deployment instruction (no push/live in this batch).
- **Manual QA before production**: mobile month scroll/tap on block menu, verify reservation links, create/remove manual & maintenance blocks, conflict visibility vs backend.

## Manual QA checklist (before staging sign-off)

1. `/ops/calendar` loads property cards with image, name, active/sync, 14-day strip.
2. Tap property → month grid loads; prev/next month; “Today” highlights.
3. Reservation bar opens `/ops/reservations/:id`.
4. Manual/maintenance: add block with inclusive start / exclusive end; remove works; edit dates via prompt acceptable for batch.
5. Conflict/warning: visible on bars (ring) when backend marks block in marker pair.
6. `/admin` smoke: open bookings list (unchanged).
7. Other `/ops` routes still load (dashboard, reservations).
