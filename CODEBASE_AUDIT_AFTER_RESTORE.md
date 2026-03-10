# Codebase Audit After Backup Restoration

**Date:** 2026-03-10  
**Scope:** Full audit for missing components, broken references, unwired routes, and incomplete features after restore from old backup.

---

## 1. Critical: Missing Routes in `App.jsx`

These pages **exist** but have **no route** in `client/src/App.jsx`. Users cannot reach them.

| Route (expected) | Component | Used by / purpose |
|-------------------|-----------|--------------------|
| `/cabin/:id/confirm` | `ConfirmBooking` | Stripe return URL and payment confirmation page. `ConfirmBooking.jsx` sets `return_url: /cabin/${id}/confirm`. |
| `/booking-refund` | `BookingRefundResolution` | Post-payment refund/conflict resolution. `ConfirmBooking.jsx` navigates here on 409/refund. |
| `/off-grid-cabins-bulgaria` | (SEO page exists) | Linked from `BanskoRemoteWorkRetreat.jsx`, `RhodopesCabinRetreat.jsx`. |
| `/rhodopes-cabin-retreat` | (SEO page exists) | Linked from `OffGridCabinsBulgaria.jsx`. |
| `/bansko-remote-work-retreat` | (SEO page exists) | Likely intended SEO landing. |
| `/retreat-venue-bulgaria` | (SEO page exists) | Likely intended SEO landing. |

**Recommendation:** Add to `App.jsx` under `SiteLayout`:

```jsx
<Route path="/cabin/:id/confirm" element={<ConfirmBooking />} />
<Route path="/booking-refund" element={<BookingRefundResolution />} />
<Route path="/off-grid-cabins-bulgaria" element={<OffGridCabinsBulgaria />} />
<Route path="/rhodopes-cabin-retreat" element={<RhodopesCabinRetreat />} />
<Route path="/bansko-remote-work-retreat" element={<BanskoRemoteWorkRetreat />} />
<Route path="/retreat-venue-bulgaria" element={<RetreatVenueBulgaria />} />
```

(Add the corresponding imports at the top of `App.jsx`.)

---

## 2. Critical: Wrong Link in About CTA

**File:** `client/src/pages/about/sections/CTASection.jsx`  
**Issue:** "Explore The Valley" link uses `to="/the-valley"` but the app route is **`/valley`**.  
**Effect:** 404 when users click "Explore The Valley" on the About page.

**Fix:** Change `to="/the-valley"` to `to="/valley"`.

---

## 3. Critical: Stripe Payment Flow Incomplete

### 3.1 Client API missing method

**File:** `client/src/services/api.js`  
**Issue:** `ConfirmBooking.jsx` calls `bookingAPI.createPaymentIntent({ cabinId, checkIn, checkOut, adults, children, experienceKeys })`, but **`bookingAPI` has no `createPaymentIntent`** in `api.js`. Only `create`, `getById`, and `submitAddOnRequest` exist.

**Fix:** Add to `api.js`:

```js
// In bookingAPI object:
createPaymentIntent: (data) => api.post('/bookings/create-payment-intent', data),
```

### 3.2 Server: No create-payment-intent endpoint

**File:** `server/routes/bookingRoutes.js`  
**Issue:** No `POST /api/bookings/create-payment-intent` route. Comment in `server/services/pricingService.js` says it is "Used by create-payment-intent and booking creation", but the endpoint was never added (or was lost).

**Fix:** Implement `POST /api/bookings/create-payment-intent` that:
- Uses `pricingService.calculateCabinPrice` for amount
- Creates a Stripe PaymentIntent (server-side)
- Returns `{ success: true, clientSecret }` for Stripe Elements

### 3.3 Server: Stripe webhook not mounted

**Files:** `server/server.js`, `server/routes/stripeWebhookRoutes.js`  
**Issue:** `stripeWebhookRoutes.js` exists and handles `refund.created`, `refund.updated`, `refund.failed` for `PaymentFinalization`, but **it is never mounted** in `server.js`. Stripe webhooks will 404.

**Fix:** Mount the Stripe webhook **before** `express.json()` so the webhook receives raw body for signature verification:

```js
// In server.js, BEFORE app.use(express.json()):
const stripeWebhookRoutes = require('./routes/stripeWebhookRoutes');
app.use('/api/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);
// Then keep app.use(express.json()); for all other routes.
```

Note: Mounting only the webhook path with raw body (e.g. via a small wrapper that uses `express.raw` only for `POST /webhook`) is safer so the rest of the API still uses JSON. Adjust path to match what you configure in Stripe Dashboard (e.g. `https://yourdomain.com/api/stripe/webhook`).

---

## 4. Orphaned / Unused Files

| Item | Notes |
|------|--------|
| `client/src/routes/AdminRoutes.jsx` | Defines admin routes with lazy-loaded components but is **never imported** in `App.jsx`. App uses inline admin routes. Safe to remove or keep as alternative. |
| `client/src/pages/Build.old.jsx` | Old Build page; `Build.jsx` is the one in use. Can archive or delete. |
| `client/src/pages/Journal.jsx` | Placeholder content ("Coming Soon"). App redirects `/journal` → `/build`, so Journal is not reachable. Intentional or restore artifact. |
| `client/src/pages/the-valley/sections/StoryHighlightsSection.jsx` | Exists but is **not imported** in `TheValleyPage.jsx`. Optional section; add to Valley page if desired. |

---

## 5. Placeholders / Incomplete Implementations

| Location | Issue |
|----------|--------|
| `client/src/components/MapArrival.jsx` | Map URL uses `YOUR_TOKEN` for Mapbox; comments say "placeholder - replace with actual map service". |
| `client/src/pages/Journal.jsx` | Placeholder blog posts only. |
| `server/routes/bookingRoutes.js` (addon-request) | TODO: "Store in database (could add addonRequests array to Booking model)". Add-on requests are only logged. |

---

## 6. Possible Asset Path Mismatch (Valley)

**File:** `client/src/pages/the-valley/data.js`  
**Issue:** `VALLEY_STILLS.winter` is `'/uploads/Videos/The-Valley-firaplace-video-poster.jpg'`. In the repo there is also `The-Valley-firaplace-video.winter-poster.jpg`. If the winter poster was meant to be different, the path should be:

- `winter: '/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg'`

Verify file names under `uploads/Videos/` and align `VALLEY_STILLS` (and any video paths) with actual assets.

---

## 7. Summary Checklist

| # | Item | Severity | Action |
|---|------|----------|--------|
| 1 | Add routes for ConfirmBooking, BookingRefundResolution, SEO pages | **High** | Add routes + imports in `App.jsx` |
| 2 | Fix About CTA link `/the-valley` → `/valley` | **High** | Edit `CTASection.jsx` |
| 3 | Add `bookingAPI.createPaymentIntent` in client | **High** | Edit `client/src/services/api.js` |
| 4 | Implement `POST /api/bookings/create-payment-intent` on server | **High** | Add route in `bookingRoutes.js`, use Stripe + pricingService |
| 5 | Mount Stripe webhook in server (raw body) | **High** | Edit `server/server.js` |
| 6 | AdminRoutes.jsx unused | Low | Remove or document as alternative |
| 7 | MapArrival map token / map service | Medium | Replace placeholder with real key or service |
| 8 | Valley video/poster paths | Low | Verify `data.js` vs actual uploads |
| 9 | StoryHighlightsSection not used on Valley page | Low | Add to TheValleyPage if desired |

---

## 8. Quick Fix Order

1. **App.jsx:** Add missing routes and imports (ConfirmBooking, BookingRefundResolution, 4 SEO pages).  
2. **CTASection.jsx:** Change `to="/the-valley"` to `to="/valley"`.  
3. **api.js:** Add `createPaymentIntent` to `bookingAPI`.  
4. **server:** Add create-payment-intent route and mount Stripe webhook.

After these, the payment flow and all linked pages should be reachable and the Stripe webhook able to receive events.
