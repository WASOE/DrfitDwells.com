# Rules for Cursor (and humans): Admin → OPS migration

These rules apply to **all** implementation work related to back-office consolidation unless a written exception is added under `docs/backoffice-migration/` and approved by the project owner.

## 1. Scope and batching

1. **Never implement across multiple domains in one batch.**  
   Domains include: reservations, communications/email, cabins/media, reviews, promo codes, cabin types/units, auth/shell, maintenance, readiness/cutover.

2. **Each batch must be small enough to review in one PR** and should map to a single objective in `02_PHASE_PLAN.md` or `04_FIRST_BATCH_PLAN.md`.

3. **Each batch must be reversible by one `git revert`** of that merge/commit where technically possible. If not possible (e.g., data migration), the batch plan must state that explicitly before coding.

## 2. No duplicate logic; shared services only

1. **Never duplicate Admin controller logic inside OPS routes** if the behavior can live in a **shared service** called by both (temporarily) or by OPS only (preferred).

2. **Prefer extract-then-call:** extract pure functions/services from `adminController.js` or inline `adminRoutes.js` handlers into `server/services/...`, then wire OPS routes to them. Remove admin wiring only in a later deprecation batch.

3. **No new operational features on `/admin`.**  
   If a stakeholder asks for a feature while migration is ongoing, it ships under `/ops` (or shared service + OPS UI) only.

## 3. Deprecation and removal discipline

1. **Do not delete `/admin` pages or `/api/admin` routes until OPS parity is proven** for the workflows in `01_FEATURE_MATRIX.md` (checkbox / sign-off per row or per domain).

2. **Legacy routes may remain as compatibility proxies** during transition (same behavior, deprecated response header or log line optional). Removal is **Phase 5** only unless a row is explicitly “delete” with no callers.

3. **Do not change Stripe/payment logic, booking pricing logic, iCal/sync logic, or public guest pages** in migration batches unless the batch doc explicitly lists that scope (default: **forbidden**).

## 4. Required reporting after each batch

Every implementation batch PR / Cursor completion must include:

| Report item | Requirement |
|-------------|-------------|
| Exact files changed | list paths |
| Routes touched | list ` /api/...` and `/...` frontend routes |
| Models touched | list Mongoose models or collections |
| Risk level | low / medium / high + one-line why |
| Rollback | revert commit hash strategy or “not revertible — because …” |
| Tests | manual steps or automated tests run |
| Build | **`npm run build` (or repo standard) must pass** before marking done |

## 5. Quality gates

1. **Lint/build:** follow repo conventions; fix new violations introduced by the batch.

2. **Permissions:** use existing `permissionService` / OPS patterns; do not bypass `requirePermission` or `adminModuleWriteGate` without explicit design doc.

3. **Audit and email:** preserve existing audit and `EmailEvent` behavior when moving send/preview paths—no silent drops.

## 6. What Cursor must not do

- Do not “quick duplicate” OPS endpoints by copy-pasting large blocks from admin.
- Do not add new `/admin` nav items or pages for new features.
- Do not merge unrelated refactors (typo sweeps, formatting-only mega-diffs) into migration PRs.
- Do not push or deploy unless the user explicitly asks in that session.

## 7. Documentation updates

When a batch completes a matrix row, update `01_FEATURE_MATRIX.md` (or a `CHANGELOG` subsection within this folder) in the **same PR** as the code, or immediately after in a doc-only follow-up—so the matrix stays truthful.
