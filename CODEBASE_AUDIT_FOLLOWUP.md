# Follow-up Audit – Missing Files & Issues Resolution

**Date:** 2026-03-10  
**Purpose:** Verify all items from `CODEBASE_AUDIT_AFTER_RESTORE.md` are resolved.

---

## ✅ Critical & High Items – All Resolved

| # | Original issue | Status | Verification |
|---|----------------|--------|---------------|
| 1 | Missing routes (ConfirmBooking, BookingRefundResolution, 4 SEO pages) | **Fixed** | `App.jsx` has all 6 routes and imports. `/cabin/:id/confirm` is declared before `/cabin/:id`. |
| 2 | Wrong CTA link `/the-valley` on About page | **Fixed** | `CTASection.jsx` uses `to="/valley"`. No remaining `/the-valley` links in client. |
| 3 | `bookingAPI.createPaymentIntent` missing in client | **Fixed** | `client/src/services/api.js` has `createPaymentIntent: (data) => api.post('/bookings/create-payment-intent', data)`. |
| 4 | No server `POST /api/bookings/create-payment-intent` | **Fixed** | `server/routes/bookingRoutes.js` has the route; uses `pricingService`, Stripe, returns `clientSecret`. |
| 5 | Stripe webhook not mounted | **Fixed** | `server/server.js` mounts `/api/stripe` with `express.raw({ type: 'application/json' })` before `express.json()`. Webhook path: `/api/stripe/webhook`. |

---

## ✅ Cross-Checks

- **Internal links:** No `to="/the-valley"` or `href="/the-valley"` in `client/src`. All SEO page links (`/off-grid-cabins-bulgaria`, `/rhodopes-cabin-retreat`, etc.) have matching routes in `App.jsx`.
- **Imports:** All components/pages imported in `App.jsx` exist:
  - `ConfirmBooking.jsx`, `BookingRefundResolution.jsx`
  - `OffGridCabinsBulgaria.jsx`, `RhodopesCabinRetreat.jsx`, `BanskoRemoteWorkRetreat.jsx`, `RetreatVenueBulgaria.jsx`
- **Client → server:** `ConfirmBooking.jsx` calls `bookingAPI.createPaymentIntent(...)`; `api.js` posts to `/bookings/create-payment-intent`; server implements that route.

---

## Unchanged (Low Priority / Optional)

These were noted in the original audit as low severity or optional; no code changes were required for “missing files” resolution:

| Item | Notes |
|------|--------|
| `AdminRoutes.jsx` unused | Still not imported; optional to remove or keep. |
| `Build.old.jsx` | Orphan; can delete or archive. |
| `Journal.jsx` | Placeholder; `/journal` redirects to `/build`. |
| `StoryHighlightsSection.jsx` | Not used in `TheValleyPage.jsx`; add if desired. |
| MapArrival `YOUR_TOKEN` | Placeholder map; replace when using real map service. |
| Valley `VALLEY_STILLS` paths | Confirm against actual files in `uploads/Videos/` if winter poster differs. |
| Add-on request TODO | Server still logs only; optional DB storage later. |

---

## Conclusion

**All missing-files and critical/high issues from the original audit are resolved.**  
Payment flow (create-payment-intent, confirm page, refund page), SEO landing routes, and the About CTA link are wired and consistent. Remaining items are optional cleanups or future improvements.
