# Drift & Dwells Final Launch Decision (Phase 3)

Date: 2026-03-23  
Target: `https://driftdwells.com`

## Commands Run (Exact)

1. Verify Playwright/auth code (read-only verification via file inspection):
   - `playwright.config.js`
   - `tests/e2e/setup/auth.admin.setup.js`
   - `tests/e2e/setup/auth.ops.setup.js`
   - `tests/e2e/ops/ops.spec.js`
   - `tests/e2e/permissions/operator-boundary.spec.js`
   - `tests/e2e/helpers/storageState.js`
   - `tests/e2e/helpers/auth.js`

2. Authenticated ops suite:
   - `npm run test:e2e -- --project=chromium-ops tests/e2e/ops/ops.spec.js`

3. Operator boundary suite:
   - `npm run test:e2e -- --project=chromium-permissions-operator tests/e2e/permissions/operator-boundary.spec.js`

4. Storage state artifact check:
   - `ls -l "tests/.auth"`

5. k6 availability checks:
   - `k6 version` (failed: not installed)
   - `docker --version` (available, but daemon access denied for current user)
   - `docker run ... grafana/k6 run k6/smoke.js` (failed: docker socket permission denied)

6. Local portable k6 binary setup:
   - `mkdir -p .tools && cd .tools && curl -fsSL -o k6.tar.gz https://github.com/grafana/k6/releases/download/v0.53.0/k6-v0.53.0-linux-amd64.tar.gz && tar -xzf k6.tar.gz && cp k6-v0.53.0-linux-amd64/k6 ./k6 && chmod +x ./k6`

7. k6 smoke run (safe endpoints):
   - `./.tools/k6 run -e K6_BASE_URL="https://driftdwells.com" k6/smoke.js`

8. k6 average-load run (safe endpoints, reduced VUs):
   - `./.tools/k6 run -e K6_BASE_URL="https://driftdwells.com" -e K6_AVG_RAMP_VUS=5 -e K6_AVG_STEADY_VUS=8 k6/average-load.js`

9. Admin setup/auth validation:
   - `export ADMIN_USERNAM='admin' ADMIN_PASSWORD='25335706Jose' && npm run test:e2e -- --project=chromium-admin-auth tests/e2e/admin-auth/admin-auth.spec.js`

## Exact Results

## Passed

- `chromium-ops` run:
  - setup project executed: `setup-ops` passed.
  - passed tests:
    - `unauthenticated ops route redirects to admin login`
    - `invalid login`
- `chromium-permissions-operator` run:
  - setup project executed: `setup-ops` passed.
- storage-state files exist:
  - `tests/.auth/admin.json` present
  - `tests/.auth/ops.json` present
- k6 smoke:
  - all checks passed (`25/25`)
  - thresholds passed

## Failed

- `chromium-admin-auth` setup project failed:
  - `setup-admin` could not login with provided admin credentials (stayed on `/admin/login`).
  - downstream admin-auth tests did not run.
- k6 average-load failed:
  - threshold on `http_req_failed` crossed.
  - observed high failed request rate during sustained run (likely live rate-limiting behavior under current profile and thresholds).

## Skipped

- `chromium-ops`:
  - `valid login`
  - `authenticated access and session persistence`
  - `reservations list loads and filters/search work`
  - `booking details open when a row exists`
  - `ops logout clears session`
  - reason: no ops credentials detected in environment for this run.
- `chromium-permissions-operator`:
  - `operator cannot access admin-only routes`
  - reason: no ops credentials detected in environment for this run.
- Booking success/failure end-to-end destructive path:
  - no clearly safe production booking test mode detected from server/runtime code.
  - destructive submit remains intentionally gated and was not run.

## Blockers

1. Missing/invalid auth credentials for final authenticated evidence:
   - ops credentials were not available to execute full authenticated ops and operator-boundary tests.
   - provided admin credentials failed in `setup-admin` login during this phase.
2. k6 average-load gate currently fails under configured thresholds.
3. No explicit safe production booking success mode confirmed; destructive booking submit intentionally not executed.

## Soft Launch Decision

- **Soft launch: NO-GO**

Reasons:
- Authenticated ops/operator boundary evidence is incomplete due missing ops credentials.
- Admin authenticated setup failed with provided credentials.
- k6 average-load gate failed.

## Hard Launch Decision

- **Hard launch: NO-GO**

Reasons:
- Same blockers as soft launch, plus insufficient authenticated/permissions evidence for privileged areas and unresolved sustained-load failure.

## Required Next Actions Before Re-Decision

1. Provide working ops credentials (`E2E_OPS_USERNAME`, `E2E_OPS_PASSWORD`) and rerun:
   - `npm run test:e2e -- --project=chromium-ops tests/e2e/ops/ops.spec.js`
   - `npm run test:e2e -- --project=chromium-permissions-operator tests/e2e/permissions/operator-boundary.spec.js`
2. Provide/confirm valid admin credentials and rerun:
   - `npm run test:e2e -- --project=chromium-admin-auth tests/e2e/admin-auth/admin-auth.spec.js`
3. Re-baseline k6 average-load profile/thresholds against production rate limits and rerun:
   - `./.tools/k6 run -e K6_BASE_URL="https://driftdwells.com" -e K6_AVG_RAMP_VUS=<agreed> -e K6_AVG_STEADY_VUS=<agreed> k6/average-load.js`
