# Calendar productization + interaction hardening — build notes

## Scope
Production-grade polish for the new `/ops` calendar UI only (property index + month grid).

Hard requirements preserved:
- No backend truth changes
- `AvailabilityBlock` remains canonical conflict surface
- All calendar writes still go through `/api/ops` write contracts
- `/admin` untouched

## What changed

### Frontend (calendar only)
- `client/src/pages/ops/calendar/CalendarBottomSheet.jsx` (new)
  - Shared mobile-first bottom sheet primitive for calendar actions.
  - Avoids browser-native dialogs.
- `client/src/pages/ops/calendar/OpsCalendarMonth.jsx`
  - Removed all `window.prompt()` and `window.confirm()` usage.
  - Replaced add/edit/remove flows with in-app bottom sheets:
    - Add manual/maintenance block
    - Edit manual/maintenance block dates
    - Remove/tombstone manual/maintenance block (explicit confirmation UI)
  - Improved action affordances:
    - Larger tap targets in block action menu
    - Errors are shown in the relevant sheet (and not as browser dialogs)
- `client/src/pages/ops/calendar/OpsCalendarIndex.jsx`
  - Stronger card hierarchy and clearer preview chips:
    - Better image fallback (initials)
    - Hard/Warning conflict preview chips (less noisy than a generic banner)
    - Sync chip stays visible

### Backend / read-model metadata
- No changes in `/api/ops/calendar` or read model metadata for this batch.

## Interaction hardening validation
- Added client validation script: `client/scripts/validate-calendar-ux-interactions.mjs`
- Script checks that no calendar files contain `window.prompt`, `window.confirm`, or `alert(`.
- Run locally:
  - `cd client && npm run validate:calendaruxinteractions`

## Staging-readiness
Safe for **staging validation** only (per instruction). Production rollout requires manual operator phone QA.

## Manual phone QA before staging sign-off
1. Open `/ops/calendar` on a narrow viewport (~390px):
   - Verify property cards render fast and consistently.
   - Verify image fallback shows initials when no image exists.
2. Tap a property card:
   - Verify month grid opens.
   - Verify “Today” marker is visually obvious.
3. On the month grid:
   - Tap “Add manual block” → bottom sheet opens → fill dates → Save → month refreshes.
   - Tap “Add maintenance block” → same behavior.
4. On an existing manual/maintenance block:
   - Tap the block action menu → “Edit dates” opens bottom sheet (no prompts).
   - Tap “Remove” opens confirmation bottom sheet (no confirms).
   - Verify errors render in-sheet if the backend rejects.
5. Tap a reservation bar:
   - Verify it still opens `/ops/reservations/:id`.
6. Confirm `/admin` still works (bookings list load).

