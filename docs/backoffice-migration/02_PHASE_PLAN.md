# Phased migration plan: Admin → OPS

Each phase is intentionally **narrow**. Phases may overlap only at documentation level until prior phase DoD is met.

---

## Phase 1 — Reservations parity in OPS

| Field | Content |
|-------|---------|
| **Goal** | `/ops/reservations` and `/ops/reservations/:id` replace daily use of `/admin/bookings*`. |
| **In scope** | List filters (including `stayScope` parity), export, reservation detail completeness, lifecycle email preview/resend/edit-resend (via **shared** services), email timeline/summary where needed, deprecation messaging toward OPS. |
| **Out of scope** | Stripe, pricing, iCal/sync engine, public pages, cabin image CRUD, promo codes, review moderation writes. |
| **Files likely touched** | `client/src/pages/ops/OpsReservations.jsx`, `OpsReservationDetail.jsx`, `opsApi.js`; `server/routes/ops/modules/reservationsRoutes.js`, `communicationsRoutes.js` (or small new ops submodule); shared `bookingLifecycleEmailService` (call sites only, not duplicated logic). |
| **Backend routes affected** | New or extended `GET/POST /api/ops/reservations*`, `.../communications/*` as needed; **deprecation** wrappers or params on `GET /api/admin/bookings` optional later—not required to start. |
| **Frontend routes affected** | `/ops/reservations`, `/ops/reservations/:id`; optional banner from `/admin/bookings` (Phase 4 if deferred). |
| **Risks** | Dual lifecycle writes until admin booking status UI is retired; email send mistakes; permission drift. |
| **Rollback strategy** | Single-commit revert per batch; feature flag optional for new OPS panels; keep admin pages functional until redirects land. |
| **Verification steps** | Manual: list filters, export, detail load, each email action, 401/403/409 paths; regression: OPS reservation actions unchanged; no payment/sync code touched. |
| **Definition of done** | Stakeholders agree admin bookings pages are no longer needed for routine work; matrix Phase 1 rows marked done; build green. |

---

## Phase 2 — Cabin and media management in OPS

| Field | Content |
|-------|---------|
| **Goal** | All cabin CRUD and gallery/image operations happen from OPS, not `/admin/cabins*`. |
| **In scope** | Move or proxy cabin `GET/POST/PATCH` and image upload/reorder/patch/batch/delete to OPS routes; reuse same persistence and `syncMultiUnitGalleryToCabinType` paths via **extracted shared functions** where possible. |
| **Out of scope** | Guest-facing cabin page redesign; search ranking; new image processing pipeline. |
| **Files likely touched** | `client/src/pages/ops/OpsCabins.jsx` (split components as needed), `adminImages.js` pattern recreated as `opsCabinMedia` client; `server/routes/ops/modules/cabinsRoutes.js`; extracted helpers from `adminRoutes.js` into `server/services/...` shared module. |
| **Backend routes affected** | New `POST/PATCH/DELETE .../api/ops/cabins/.../images*` (exact shape TBD); gradual deprecation of `/api/admin/cabins/.../images*`. |
| **Frontend routes affected** | `/ops/cabins`, `/ops/cabins/:id`; `/admin/cabins*` → redirect or shell. |
| **Risks** | **High** — public gallery and `imageUrl`/`isCover` consistency; file upload security; audit on delete. |
| **Rollback strategy** | Keep admin routes live behind cutover flag; revert single PR; DB unchanged on rollback if only routing moved. |
| **Verification steps** | Upload, reorder, cover, tags, batch, delete on staging cabin; verify public cabin page and search cards; multi-unit gallery sync. |
| **Definition of done** | No routine edits from admin cabins; cutover module `cabins` ready for `opsPrimary` per readiness policy. |

---

## Phase 3 — Reviews, promos, cabin types, and remaining admin utilities

| Field | Content |
|-------|---------|
| **Goal** | CRUD and moderation tools live under OPS (or explicitly under “break glass” maintenance with documented exception). |
| **In scope** | Reviews create/edit/bulk/recalc; promo list/create/patch; cabin type and unit management beyond current OPS unit label patch; admin-only backfill tools relocated or gated. |
| **Out of scope** | Changing discount math or promo application on checkout (separate product batch if ever needed). |
| **Files likely touched** | New `client/src/pages/ops/*` modules; `server/routes/ops/modules/*` for reviews/promo/cabin-types; possibly move handlers from `adminReviewRoutes.js`, `adminPromoRoutes.js`, `adminCabinTypeRoutes.js` into services. |
| **Backend routes affected** | New `/api/ops/reviews*`, `/api/ops/promo-codes*`, `/api/ops/cabin-types*` (names TBD); deprecate parallel admin routes. |
| **Frontend routes affected** | `/ops/reviews` (extend), new `/ops/promo-codes`, `/ops/cabin-types` (if not merged into cabins). |
| **Risks** | Medium — stats recompute, promo uniqueness, multi-unit feature flags. |
| **Rollback strategy** | Feature flags per submodule; admin routes remain until parity sign-off. |
| **Verification steps** | Full CRUD on staging data; bulk review; recalc; promo conflict (409); cabin type + unit flows. |
| **Definition of done** | Matrix Phase 3 rows done; ops readiness verdicts updated where applicable. |

---

## Phase 4 — Deprecate `/admin` UI and compatibility routing

| Field | Content |
|-------|---------|
| **Goal** | Users and bookmarks land on OPS; `/admin` is shell or redirect only. |
| **In scope** | Remove admin nav operational tabs; add redirects (`/admin/bookings` → `/ops/reservations`, etc.); optional read-only “moved to OPS” pages; keep login at `/admin/login` temporarily if token model unchanged. |
| **Out of scope** | Deleting server routes (Phase 5). |
| **Files likely touched** | `client/src/App.jsx`, `client/src/layouts/AdminLayout.jsx`, `client/src/pages/admin/*` (thin wrappers). |
| **Backend routes affected** | None strictly required; optional `Deprecation` headers on `/api/admin/*` later. |
| **Frontend routes affected** | All `/admin/*` except login → redirects or shells. |
| **Risks** | Low–medium — broken deep links, external docs linking to admin. |
| **Rollback strategy** | Revert redirect PR; restore nav links. |
| **Verification steps** | Click every old admin URL; confirm landing on correct OPS screen; operator vs admin role. |
| **Definition of done** | No operational entry points to old admin chrome; team trained. |

---

## Phase 5 — Remove legacy Admin code and unused APIs

| Field | Content |
|-------|---------|
| **Goal** | Delete dead React pages/components and unused `/api/admin` handlers after telemetry shows no calls (or after contractual wait period). |
| **In scope** | Remove `pages/admin/*`, `components/admin/*` not needed; collapse `adminController` booking/cabin handlers if fully superseded; remove `adminReviewRoutes` / `adminPromoRoutes` only when OPS replacements are sole callers. |
| **Out of scope** | Removing `POST /api/admin/login` until a replacement auth entry for OPS is agreed (may remain indefinitely as thin login). |
| **Files likely touched** | Large deletions across `client/` and `server/`; update tests and Playwright paths. |
| **Backend routes affected** | Removal of deprecated `GET/PATCH/POST .../api/admin/...` per submodule. |
| **Frontend routes affected** | Removal of `/admin/bookings` etc.; possible `/admin` → `/ops` root redirect. |
| **Risks** | **High** — hidden callers (scripts, cron, external tools). |
| **Rollback strategy** | Tag release before mass delete; revert commit; restore routes from tag if needed. |
| **Verification steps** | Grep repo and logs for `/api/admin`; smoke full guest booking; smoke OPS; run E2E auth suites. |
| **Definition of done** | No references to removed routes; documentation updated; matrix marked complete. |

---

## Cross-phase constraints (all phases)

- Each implementation batch touches **one domain** unless an explicit exception is documented in the batch plan.
- No Stripe, pricing, sync, or public-site changes unless a dedicated doc scopes them.
- **Build must pass** before a batch is considered done (`03_RULES_FOR_CURSOR.md`).
