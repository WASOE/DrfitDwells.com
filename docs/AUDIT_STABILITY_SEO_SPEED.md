# Deep Audit: Stability, SEO, Speed & Security

**Date:** 2026-03-10  
**Scope:** Full codebase — server (Node/Express/Mongoose), client (React/Vite/Tailwind), infrastructure.

---

## 1. STABILITY

### 1.1 Server Route Error Handling

All route handlers use try-catch. No unprotected Mongoose queries found.

**Edge cases:**
- `adminController.js` `ensureUniqueCabinTypeSlug` uses `while (true)` with `CabinType.findOne` — could spin indefinitely if DB is misconfigured.
- `reviewRoutes.js` lines 35, 38: `new mongoose.Types.ObjectId(id)` can throw `CastError` for invalid IDs (inside try-catch, so handled).

### 1.2 Input Validation Gaps

Many routes accept user input without validation:

| File | Route | Missing Validation |
|------|-------|--------------------|
| `cabinRoutes.js:9` | `GET /:id` | `id` not validated as MongoId |
| `cabinTypeRoutes.js:44` | `GET /:slug` | `slug` not validated |
| `unitRoutes.js:21,54` | `GET /by-type/:cabinTypeId`, `GET /:id` | IDs not validated |
| `bookingRoutes.js:428,478` | `GET /:id`, `POST /:id/addon-request` | IDs not validated |
| `adminRoutes.js:102,138,161,207` | Image CRUD routes | `id`, `imageId` not validated |
| `adminRoutes.js:237,307` | `GET /email-events`, `/email-events/summary` | No validation |
| `adminReviewRoutes.js:119,325,526` | Review CRUD | IDs not validated |
| `adminCabinTypeRoutes.js:262,350,391,426,476` | CabinType CRUD | IDs not validated |
| `draftRoutes.js:11` | `POST /` | `payload` has no size/depth/schema validation |
| `draftRoutes.js:40` | `GET /:token` | `token` not validated |
| `adminController.js:506-518` | `getBookings` | `q`, `from`, `to`, `status`, `cabinId`, `page`, `limit` not validated |
| `adminController.js:941-944` | `getCabins` | `q`, `page`, `limit` not validated |

### 1.3 Race Conditions

**Booking creation has a TOCTOU race:**

- `bookingRoutes.js` lines 214–232: Checks availability (query), then creates booking (insert) without a MongoDB transaction. Two concurrent requests can both pass the availability check and double-book.
- Same pattern in multi-unit path (lines 274–295, 358–362).
- **Fix:** Wrap availability check + booking insert in `session.startTransaction()` / `commitTransaction()`.

### 1.4 Memory Leaks

- `emailService.js` lines 4–18: `sentEvents` Map grows unbounded; cleanup only when `size > 5000`. Cleanup loop mutates `sentEvents` while iterating — may skip entries.

### 1.5 Process-Level Stability

| Finding | Status |
|---------|--------|
| `uncaughtException` handler | **Missing** |
| `unhandledRejection` handler | **Missing** |
| Graceful shutdown (SIGTERM/SIGINT) | **Missing** |
| Server listen error handler | **Missing** — EADDRINUSE crashes with stack trace |

### 1.6 Client Stability

| Finding | Status |
|---------|--------|
| React Error Boundary | **Missing** — one render error can white-screen the app |
| `window.onunhandledrejection` | **Missing** |
| API retry on transient failures | **Missing** |
| API timeout | 10s (api.js) — OK |

### 1.7 Environment Variable Validation

No required env vars are validated at startup:

| Variable | Fallback | Risk |
|----------|----------|------|
| `MONGODB_URI` | `localhost:27017/drift-dwells-booking` | Silent wrong DB in prod |
| `STRIPE_SECRET_KEY` | `null` (Stripe disabled) | Payment silently broken |
| `STRIPE_WEBHOOK_SECRET` | `null` | Webhooks silently broken |
| `ADMIN_USER` | `admin` | Weak default in prod |
| `ADMIN_PASS` | `securepassword123` | Weak default in prod |
| `ADMIN_JWT_SECRET` | `securepassword123-secret` | Predictable in prod |
| `SMTP_URL` | Not set → emails logged | Silent mail failure |

### 1.8 Logging

- Only `console.log`/`console.error` throughout — no structured logging, no log levels, no request IDs.
- `api.js` lines 15, 34: `console.log` on every API request/response in production.

---

## 2. SECURITY

### 2.1 Critical Issues

| # | Issue | File | Severity |
|---|-------|------|----------|
| 1 | **Path traversal in file upload**: `req.params.id` used in `path.join(... 'uploads', 'cabins', id, ...)` without validation. Value like `../../../etc` escapes uploads dir. File is written before cabin existence is checked. | `upload.js:10-14`, `adminRoutes.js:68` | **Critical** |
| 2 | **`GET /api/bookings/:id` is public** — no auth. Anyone with a booking ID can read full guest info (name, email, phone, price). | `bookingRoutes.js:425-449` | **High** |
| 3 | **Weak default admin credentials** used if env vars not set. Production can run with `admin`/`securepassword123`. Warning logged but login still allowed. | `defaults.js:6-8`, `adminController.js:667-669` | **High** |
| 4 | **`bookingAPI.getRefundStatus` missing** in api.js. `BookingRefundResolution.jsx:48` calls it — runtime crash. | `api.js`, `BookingRefundResolution.jsx:48` | **High** |

### 2.2 Medium Issues

| # | Issue | File |
|---|-------|------|
| 5 | **No rate limiting** on login, booking creation, payment endpoints. Brute-force and DoS possible. | `server.js` |
| 6 | **No security headers (helmet)** — missing `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`. | `server.js` |
| 7 | **CORS allows all origins**: `app.use(cors())` with no restrictions. | `server.js:69` |
| 8 | **ReDoS via `$regex`**: User input `q` used unsanitized in `$regex` queries in admin search (bookings, cabins). Malicious regex can hang the server. | `adminController.js:753-755, 950-951` |
| 9 | **XSS in WordPress widget**: `popover.innerHTML` interpolates user-controlled form data and error messages without sanitization. | `wordpress-plugin/.../wordpress-widget.js:565` |
| 10 | **No CSRF protection** on state-changing public endpoints (`POST /api/bookings`, `POST /api/drafts`). | — |
| 11 | **Admin identity mismatch**: `getAdminIdentity` reads `req.user?.email` but `adminAuth` sets `req.admin`. | `adminReviewRoutes.js:26` |
| 12 | **File upload**: Only extension check, no magic-byte validation. Malicious content can be uploaded with `.jpg` extension. | `upload.js` |
| 13 | **Admin token in localStorage**: Vulnerable to XSS. No `httpOnly` cookie option. | `api.js:17` |
| 14 | **No token invalidation/logout**: 7-day tokens remain valid until expiry. | `adminAuth.js` |
| 15 | **Stripe payment flow incomplete**: `POST /api/bookings` does not verify `paymentIntentId` or Stripe payment status. `PAYMENT_SECURITY.md` describes a flow that is not implemented. | `bookingRoutes.js` |

### 2.3 .gitignore & Secrets

- `.env`, `.env.local`, etc. properly gitignored.
- No `.env.example` documenting required variables.
- Client uses `VITE_STRIPE_PUBLISHABLE_KEY` (publishable, OK) and `VITE_CONTACT_*` (public, OK).

---

## 3. SEO

### 3.1 Meta Tags — Page-by-Page

**Pages with full meta (Seo component):**
Home, TheCabin, TheValleyPage, About, 4 SEO landing pages.

**Pages with partial meta:**
- `CabinDetails.jsx` — manual DOM updates; canonical includes query params (should be clean path).
- `DocumentViewer.jsx` (Terms, Privacy, etc.) — useEffect meta; missing `og:image`.

**Pages with NO meta (no title, description, canonical, OG, Twitter):**

| Page | File |
|------|------|
| SearchResults | `SearchResults.jsx` |
| AFrameDetails | `AFrameDetails.jsx` |
| BookingSuccess | `BookingSuccess.jsx` |
| ValleyGuide | `ValleyGuide.jsx` |
| CabinFaqPage | `CabinFaqPage.jsx` |
| Build | `Build.jsx` |
| ConfirmBooking | `ConfirmBooking.jsx` |
| BookingRefundResolution | `BookingRefundResolution.jsx` |
| Step1-4 (craft flow) | `craft/*.jsx` |

### 3.2 Heading Hierarchy Violations

| Page | Issue |
|------|-------|
| **Home** | **No `<h1>`**. DualityHero uses `<h2>` only. |
| CabinDetails | Error/loading states show `<h2>` without `<h1>` |
| AFrameDetails | Error/unavailable states show `<h2>` without `<h1>` |

### 3.3 Structured Data (JSON-LD)

**Present:** Home (WebSite + Organization), TheCabin (LodgingBusiness + BreadcrumbList), TheValleyPage (LodgingBusiness + BreadcrumbList), CabinDetails (LodgingBusiness).

**Missing from:** About, Build, CabinFaqPage (FAQPage schema), all 4 SEO landing pages (ideal candidates for LocalBusiness or LodgingBusiness), AFrameDetails.

**Issues:**
- CabinDetails JSON-LD `image` URLs can be relative; schema.org expects absolute.
- CabinDetails `url` uses `window.location.href` (includes query params).
- Home WebSite schema lacks `potentialAction` for sitelinks search box.

### 3.4 Image Alt Text

Many images have missing, empty, or generic alt text:

| Component | Lines | Issue |
|-----------|-------|-------|
| `Header.jsx` | 129, 136 | Logo images — no alt |
| `TrustStrip.jsx` | 10 | No alt |
| `Footer.jsx` | 197, 220, 237 | Trust logos — no alt |
| `MemoryStream.jsx` | 44, 83 | Photo grid — alt from data but may be empty |
| `PolaroidGallery.jsx` | 53 | No alt shown |
| `CabinCard.jsx` | 141, 183, 201, 214 | Multiple images — check data |
| `CraftExperienceSection.jsx` | 105, 187, 277 | No alt |
| `about/HostSection.jsx` | 24 | No alt |
| `about/OutcomesSection.jsx` | 48 | No alt |
| `the-valley/StaysSection.jsx` | 145 | Alt from data |
| `the-valley/EditorialHookSection.jsx` | 188 | No alt |
| `the-valley/LayOfLandSection.jsx` | 58 | No alt |
| `CabinEdit.jsx` | 1010 | `alt={img.alt \|\| ''}` — empty fallback |

### 3.5 Sitemap

**Missing from sitemap.xml but should be indexed:**
- `/stays/a-frame`

**Correctly excluded (transactional/user-specific):**
- `/cabin/:id`, `/cabin/:id/confirm`, `/booking-success/:id`, `/my-trip/:bookingId/valley-guide`, `/booking-refund`, `/embedded/craft`

**Sitemap is static** — no auto-generation; dates are hardcoded.

### 3.6 Canonical URL Issues

- `CabinDetails.jsx`: Canonical set to `window.location.href` — includes `?photos=all&index=0`. Should be `/cabin/:id` only.
- `SearchResults.jsx`: No canonical; URL has query params.

### 3.7 Language/i18n SEO

- `hreflang` tags rendered by Seo component when `hreflangAlternates` is passed.
- **Issue:** All hreflang tags point to same path with `en` and `x-default` — no `bg` alternate URL. Content switches via i18n client-side; no separate `/bg/` URLs.
- **Recommendation:** Remove hreflang until language-specific URLs exist, or implement `/bg/` prefixed routes.

### 3.8 Accessibility/SEO Overlap

| Issue | Status |
|-------|--------|
| Skip-to-content link | **Missing** |
| `id="main"` on main content | **Missing** |
| `<main>` element | Present in SiteLayout |
| `<nav>` element | Present in Header |
| `<footer>` element | Present in Footer |
| `<article>` for content | Not used |
| Focus management on route change | ScrollToTop only |

---

## 4. SPEED

### 4.1 Bundle Size — No Route-Level Code Splitting

**App.jsx eagerly imports 51 components** including all guest pages, all admin pages, all SEO pages, all legal pages, all craft steps. Everything ships in the main bundle.

**AdminRoutes.jsx** defines lazy admin routes but is **never imported** — dead code.

**Heavy libraries in main bundle:**
- `framer-motion` (~50KB gzipped)
- `react-datepicker` + `date-fns` (~30KB)
- `axios` (~15KB)
- `i18next` + `react-i18next` + 18 locale JSON files
- `@stripe/stripe-js` (loaded via ConfirmBooking)
- `lucide-react` + `react-icons` (duplicate icon libraries)
- `jspdf` (only used in Build page)

**Estimated main bundle:** 500KB+ JS before splitting.

### 4.2 Manual Chunks in vite.config.js

Current: `vendor` (react, react-dom), `motion` (framer-motion), `datepicker` (react-datepicker).

**Missing from manual chunks:** `react-router-dom`, `axios`, `date-fns`, `i18next`, Stripe, `lucide-react`.

### 4.3 Font Loading — Duplicate and Render-Blocking

**Two render-blocking font requests:**

1. `index.html` line 10: Montserrat (400,500,600,700) + Playfair Display (300,400,italic 300)
2. `index.css` line 1: Playfair Display (400,600,700) + Merriweather (300,400,700) + Inter (300,400,500,600) + Caveat (400,600)

**Issues:**
- Playfair Display loaded twice with different weight sets.
- 5 font families, 18+ weight/style combinations — many likely unused.
- Both requests are render-blocking.
- No `<link rel="preload">` for critical fonts.

### 4.4 Images — CLS and Responsiveness

**Images missing `width`/`height` (causes CLS):**

Almost every `<img>` across the codebase lacks explicit `width`/`height` or CSS `aspect-ratio`:

| Component | Approximate count |
|-----------|-------------------|
| Hero images (DualityHero, TheCabin, TheValley, HeroSection) | 4 |
| Gallery images (CabinGallery, CabinGallerySection, MosaicGallery) | 15+ |
| Content images (MemoryStream, PolaroidGallery, CraftExperience, Footer, Header, About sections) | 20+ |
| Card images (CabinCard, SearchResults, StaysSection) | 6+ |

**No responsive images:** Most images use single `src` from `/uploads/`. No `srcSet`/`sizes` for different viewports. `CabinGallery.jsx` has `generateSrcSet` but returns `${url} 1x` — no real responsive variants.

**`OptimizedImage.jsx` exists but is never imported anywhere.**

### 4.5 Video Optimization

| Video | preload | poster | Issue |
|-------|---------|--------|-------|
| DualityHero (cabin/valley) | `none` | Yes | OK |
| TheCabin hero | `none` | Yes | OK |
| TheCabin TV spot | `metadata` | No | Heavier; no poster |
| TheValley hero | `metadata` | Yes | Could be `none` |
| TheValley map video | `none` | **No** | No poster — black frame on load |
| LayOfLandSection map video | `none` | **No** | No poster — black frame on load |

Poster images are JPG only — no WebP variants.

### 4.6 CSS Issues

- `react-day-picker/dist/style.css` loaded in BookingModal and ChangeDatesModal even when modals are closed.
- Duplicate date picker theme imports.
- No evidence of unused CSS purging beyond Tailwind defaults.

### 4.7 JavaScript Performance

**Render-path concerns:**
- `ValleyGuide.jsx:247` — `JSON.parse` in render path.
- `CabinDetails.jsx` — `filter`, `map`, `reduce` in render without `useMemo`.
- `CabinFaqPage.jsx:541` — `faqData.map` in render.
- `CabinGallerySection.jsx:74-79` — gallery filtering without memoization.
- Many inline `style={{ }}` objects and `onClick={() => }` handlers create new references every render.

**Large components that should be split:**

| File | Lines |
|------|-------|
| `CabinEdit.jsx` | ~2400 |
| `CabinDetails.jsx` | ~1900 |
| `TheValley.jsx` | ~1260 |
| `Build.jsx` | ~1080 |
| `ValleyGuide.jsx` | ~660 |

### 4.8 Animation Performance

**Layout-triggering animations (cause reflow):**

| File | Animation | Issue |
|------|-----------|-------|
| `DualityHero.jsx:219-227` | `width: '50%'` → `'70%'` / `'30%'` | Layout thrash |
| `Build.jsx:946-947` | `width: 0` → `width: X%` | Layout thrash |
| `PracticalDetailsAccordion.jsx:84-86` | `height: 0` → `auto` | Layout thrash |
| `ValleyGuide.jsx:575-577` | `height: 0` → `auto` | Layout thrash |
| `CabinFaqPage.jsx:562,591` | `height: auto` | Layout thrash |
| `TheCabin.jsx:657` | `height: auto` | Layout thrash |

Most other framer-motion usage is GPU-friendly (`opacity`, `y`, `x`, `scale`).

### 4.9 Network / Caching

- **No client-side caching** for API responses (no React Query, SWR, or manual cache).
- Cabin/availability data refetched on every navigation.
- No service worker.
- `api.js` logs every request/response in production (`console.log`).
- **Sequential API calls** that could be parallel: `ConfirmBooking.jsx` fetches cabin then creates PaymentIntent.

### 4.10 Third-Party Scripts

| Script | Where | Size |
|--------|-------|------|
| Stripe.js | ConfirmBooking (loadStripe) | ~50KB |
| Google Fonts | index.html + index.css | 2 requests |
| i18next | main.jsx | 18 locale files |
| Mapbox | MapArrival.jsx | Placeholder `YOUR_TOKEN` — inactive |

No analytics, chat widgets, or tracking scripts.

---

## 5. PRIORITY ACTION PLAN

### P0 — Critical (fix before production)

| # | Area | Action | Files |
|---|------|--------|-------|
| 1 | Security | **Fix path traversal in file upload**: Validate `req.params.id` as MongoId before multer writes. | `upload.js`, `adminRoutes.js` |
| 2 | Security | **Protect `GET /api/bookings/:id`**: Require auth or booking-specific token. | `bookingRoutes.js` |
| 3 | Security | **Fail if default credentials in production**: `process.exit(1)` if `ADMIN_PASS`/`ADMIN_JWT_SECRET` are defaults and `NODE_ENV=production`. | `server.js`, `defaults.js` |
| 4 | Stability | **Fix booking race condition**: Use MongoDB transactions for availability check + booking create. | `bookingRoutes.js` |
| 5 | Stability | **Add React Error Boundary** wrapping `<App />`. | `main.jsx` |
| 6 | Security | **Add helmet middleware** for security headers. | `server.js` |
| 7 | Security | **Add rate limiting** on `/api/admin/login`, `/api/bookings`, `/api/bookings/create-payment-intent`. | `server.js` |
| 8 | Client | **Fix `bookingAPI.getRefundStatus` missing** — add to api.js or remove call from BookingRefundResolution.jsx. | `api.js`, `BookingRefundResolution.jsx` |

### P1 — High (significant impact)

| # | Area | Action | Files |
|---|------|--------|-------|
| 9 | Speed | **Route-level code splitting**: Lazy-load all guest routes, admin routes (use existing AdminRoutes.jsx), legal, SEO, craft pages. | `App.jsx` |
| 10 | SEO | **Add `<h1>` to Home page**. | `DualityHero.jsx` or `Home.jsx` |
| 11 | SEO | **Add `<Seo>` to 12+ pages missing meta** (SearchResults, Build, AFrameDetails, CabinFaqPage, BookingSuccess, ValleyGuide, ConfirmBooking, BookingRefundResolution, craft steps). | Various |
| 12 | SEO | **Fix CabinDetails canonical** to exclude query params. | `CabinDetails.jsx` |
| 13 | Speed | **Consolidate fonts**: One request, remove unused families/weights, `font-display: swap`, preload critical font. | `index.html`, `index.css` |
| 14 | Security | **Restrict CORS** to allowed origins. | `server.js` |
| 15 | Security | **Escape `$regex` input** to prevent ReDoS. | `adminController.js` |
| 16 | Stability | **Add graceful shutdown** (SIGTERM/SIGINT → close server, close DB). | `server.js` |
| 17 | Stability | **Add `uncaughtException`/`unhandledRejection` handlers** (server + client). | `server.js`, `main.jsx` |
| 18 | Speed | **Remove `console.log` from api.js** in production. | `api.js` |

### P2 — Medium (quality improvements)

| # | Area | Action |
|---|------|--------|
| 19 | SEO | Add JSON-LD to About, CabinFaqPage (FAQPage schema), SEO landing pages |
| 20 | SEO | Add alt text to all images (Header logos, Footer trust logos, MemoryStream, etc.) |
| 21 | SEO | Add skip-to-content link and `id="main"` |
| 22 | SEO | Fix or remove hreflang (no `/bg/` URLs exist) |
| 23 | SEO | Dynamic sitemap with cabin/stay URLs |
| 24 | Speed | Add `width`/`height` or `aspect-ratio` to images (CLS fix) |
| 25 | Speed | Add poster to TheValley map videos |
| 26 | Speed | Add `srcSet`/`sizes` for responsive images, or use OptimizedImage |
| 27 | Speed | Client-side API caching (React Query or SWR) |
| 28 | Speed | Split large components (CabinDetails 1900L, CabinEdit 2400L, TheValley 1260L) |
| 29 | Speed | Replace layout-triggering animations (`width`/`height`) with `transform`/`opacity` |
| 30 | Stability | Validate required env vars at startup |
| 31 | Stability | Structured logging (Winston/Pino) |
| 32 | Stability | Input validation on all route params (MongoId validation) |
| 33 | Security | Magic-byte validation on file uploads |
| 34 | Security | Implement Stripe payment verification in booking creation |
| 35 | Security | Add `.env.example` documenting required variables |

---

## 6. FILE REFERENCE INDEX

### Server
- `server/server.js` — Middleware, CORS, routes, error handling
- `server/config/database.js` — MongoDB connection
- `server/config/defaults.js` — Default admin credentials
- `server/middleware/adminAuth.js` — Admin token verification
- `server/middleware/upload.js` — Multer file upload (path traversal risk)
- `server/routes/availabilityRoutes.js` — Availability search
- `server/routes/bookingRoutes.js` — Booking CRUD, PaymentIntent (race condition, public GET)
- `server/routes/cabinRoutes.js` — Public cabin endpoints
- `server/routes/adminRoutes.js` — Admin CRUD (validation gaps)
- `server/routes/stripeWebhookRoutes.js` — Stripe webhooks
- `server/controllers/adminController.js` — Admin logic (ReDoS in $regex)
- `server/services/emailService.js` — Email sending (memory leak in sentEvents)
- `server/services/pricingService.js` — Server-side price calculation
- `server/services/assignmentEngine.js` — Multi-unit assignment

### Client
- `client/src/main.jsx` — App bootstrap (no Error Boundary)
- `client/src/App.jsx` — All routes eagerly imported (no code splitting)
- `client/src/services/api.js` — API client (console.log in prod, missing getRefundStatus)
- `client/src/components/Seo.jsx` — SEO meta component
- `client/src/components/DualityHero.jsx` — Home hero (no h1, layout animations)
- `client/src/components/OptimizedImage.jsx` — Unused responsive image component
- `client/src/routes/AdminRoutes.jsx` — Lazy admin routes (dead code, never imported)
- `client/src/config/mediaConfig.js` — Canonical media paths
- `client/index.html` — Entry HTML (font loading)
- `client/src/index.css` — Global CSS (duplicate font import)
- `client/vite.config.js` — Build config (chunk strategy)
