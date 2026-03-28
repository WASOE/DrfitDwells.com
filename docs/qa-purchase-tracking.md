# Purchase tracking — production sign-off checklist

Use this list before calling the paid-ads sprint production-complete.

1. **GA4 `purchase` payload** — In GTM Preview or browser devtools, confirm the `purchase` dataLayer event includes `ecommerce.transaction_id`, `ecommerce.value`, `ecommerce.currency` (ISO 4217), and `ecommerce.items[]` with `item_id`, `item_name`, `price`, `quantity`, and `item_category: "lodging"`. Source: `client/src/tracking/purchase.js` and server `buildPurchaseTrackingPayload` in `server/services/bookingPurchaseTracking.js`.

2. **Google Ads + Conversion Linker** — In GTM, verify a real Google Ads conversion (or GA4-imported conversion) fires on purchase where intended, and a **Conversion Linker** tag runs on all relevant pages after consent. Optionally set `VITE_GOOGLE_ADS_ID=AW-…` so `gtag.js` loads with ads consent for linker cookies when not fully covered by GTM.

3. **Meta Test Events** — For a test booking, confirm **one** deduplicated Purchase: browser Pixel and server CAPI share `event_id` `pur_<mongoBookingId>`.

4. **Success page refresh** — Complete a paid booking, accept cookies, land on `/booking-success/:id`. Refresh the page; confirm a second browser `purchase` does not fire (sessionStorage key `dd_purchase_browser_<transaction_id>`).

5. **Server CAPI without success page** — Complete payment so the booking is **confirmed** on `POST /api/bookings`, then close the tab before the success page. Confirm Meta still receives the server Purchase (CAPI runs on confirm, not only from the success page).

6. **Skipped CAPI replay** — With `META_CAPI_ACCESS_TOKEN` unset, create a confirmed booking; confirm `metaPurchaseSentAt` stays empty. Add the token, hit `POST /api/bookings/:id/purchase-tracking` (or rely on a second booking path); confirm CAPI succeeds and `metaPurchaseSentAt` is set only after a successful Graph API response.
