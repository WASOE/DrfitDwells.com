# Drift & Dwells Launch Test Checklist

## Coverage Snapshot

- `smoke`: homepage + auth entrypoints.
- `public-site`: homepage nav, key listing pages, booking entrypoint, mobile sanity.
- `booking-flow`: safe availability path, empty/edge behavior, form validation, non-destructive pre-submit path.
- `admin-auth`: valid login, invalid login, protected route behavior, refresh persistence, logout and post-logout redirect.
- `ops`: valid login, invalid login, reservations list load, filters/search, detail open (if row exists), logout behavior.
- `permissions`: unauthenticated page protections, unauthenticated protected API response, operator boundary check.
- `api`: auth failure, auth success on protected APIs, safe validation error assertions on booking endpoints.
- `k6`: smoke, average-load, stress scaffolds for safe non-destructive endpoints/routes.

## Explicit Non-Covered / Unsafe On Live

- Live payment transaction completion is **not** run by default.
- Destructive booking submit is skipped unless `E2E_ALLOW_BOOKING_SUBMIT=true`.
- Admin destructive CRUD and ops write-heavy/destructive flows are intentionally excluded on production.
- Real JWT/session timeout-by-clock is not fully exercised; token-removal simulation is used for expiration behavior checks.

## Required Environment Variables

- Core:
  - `E2E_BASE_URL` (optional, defaults to `https://driftdwells.com`)
- Admin auth:
  - `E2E_ADMIN_USERNAME` (preferred)
  - `E2E_ADMIN_PASSWORD` (preferred)
  - Backward-compatible fallbacks supported: `ADMIN_USERNAME`, `ADMIN_USER`, `ADMIN_USERNAM`, `ADMIN_PASSWORD`, `ADMIN_PASS`
- Ops auth:
  - `E2E_OPS_USERNAME`
  - `E2E_OPS_PASSWORD`
- Optional destructive test switch:
  - `E2E_ALLOW_BOOKING_SUBMIT=true`
- k6:
  - `K6_BASE_URL` (optional, defaults to `https://driftdwells.com`)
  - Optional tuning: `K6_VUS`, `K6_ITERATIONS`, `K6_AVG_RAMP_VUS`, `K6_AVG_STEADY_VUS`, `K6_STRESS_START_VUS`, `K6_STRESS_PEAK_VUS`

## Run Commands

- Install:
  - `npm install`
  - `npx playwright install chromium`
- Full Playwright:
  - `npm run test:e2e`
- Smoke only:
  - `npm run test:e2e:smoke`
- Authenticated suites only:
  - `npm run test:e2e:auth`
- API tests only:
  - `npm run test:e2e:api`
- Mobile sanity:
  - `npm run test:e2e -- --project=mobile-chromium tests/e2e/public-site/public-site.spec.js`
- Report:
  - `npm run test:e2e:report`

## k6 Run Commands

- Smoke profile:
  - `npm run k6:smoke`
- Average-load profile:
  - `npm run k6:average-load`
- Stress profile:
  - `npm run k6:stress`

## k6 Concurrency Assumptions

- Smoke script is minimal confidence only (low VU/iterations).
- Average-load is intended as pre-launch baseline and should not be run concurrently with stress.
- Stress is short-duration pressure check, not a soak test.
- All scripts target safe read-oriented pages/endpoints:
  - `/`
  - `/cabin`
  - `/valley`
  - `/search?...`
  - `/api/availability?...`
  - `/api/health`
- No booking submission or payment-intent creation in k6 scripts.

## Security Hardening Note

- Current admin/ops session token (`adminToken`) is stored in `localStorage` and used as bearer auth.
- This is a valid session token pattern in current architecture, but it is vulnerable to token theft if XSS occurs.
- Recommended future hardening (not refactored now): move to secure `httpOnly` cookie-based session handling with CSRF protections and tightened token rotation/revocation strategy.

## Launch Gate (Explicit)

Release is **blocked** unless all gate checks below pass:

1. Public smoke pass:
   - `npm run test:e2e:smoke`
2. Authenticated admin/ops pass:
   - `npm run test:e2e:auth`
3. Permissions pass:
   - `npm run test:e2e -- tests/e2e/permissions/permissions.spec.js tests/e2e/permissions/operator-boundary.spec.js`
4. API auth pass:
   - `npm run test:e2e:api`
5. k6 smoke and average-load pass:
   - `npm run k6:smoke`
   - `npm run k6:average-load`
