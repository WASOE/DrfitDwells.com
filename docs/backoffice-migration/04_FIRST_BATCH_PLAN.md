# First implementation batch (proposal only)

**This document does not authorize coding.** It selects the safest *first* engineering slice after planning docs exist.

## Candidates evaluated

| ID | Slice | In one domain? | Backend change? | User impact | Reversible? | Architecture value |
|----|--------|------------------|-----------------|-------------|-------------|----------------------|
| **A** | Add OPS `stayScope` filter + CSV export on reservations list; **no** admin redirects yet | Yes (reservations list) | Likely yes — extend `GET /api/ops/reservations` query + read model | OPS users gain parity; admin unchanged | Yes | Moves “where we filter bookings” toward OPS |
| **B** | Move booking lifecycle email preview / resend / edit-resend to OPS reservation detail | Yes (reservations + comms) | Yes — new or extended OPS endpoints calling **existing** email services | High value; touches sends | Yes with care | Large parity win; higher blast radius |
| **C** | Add read-only deprecation banner + link from `/admin` shell to OPS | Yes (UI shell only) | None | Low; educates staff | Yes | Policy signal; **does not** reduce dual-use by itself |
| **D** | Redirect `/admin/bookings` → `/ops/reservations` | Yes (routing) | Optional | **High** if OPS list/detail lacks any workflow users rely on (email tools, summary badges, bookmarks) | Yes | Premature if parity incomplete |

## Recommendation: **Batch A** as the first implementation batch

### Why A first

1. **Single domain** — reservations *list* only; no lifecycle state mutations, no email sends, no redirects that break existing admin workflows.
2. **Architecture-aligned** — operational filtering and export live where reservations are supposed to live long-term (OPS), without forcing everyone off admin on day one.
3. **Lower blast radius than B** — no guest email side effects; easier manual verification.
4. **Lower risk than D** — no sudden loss of admin list URL or muscle memory; admin can remain in use until later phase adds redirects after parity.
5. **Reversible** — one revert restores prior OPS list-only behavior; admin untouched.

### Why not B, C, or D as *first*

- **B** should follow soon after A (or parallel *only* if staffed and split by strict sub-batches), because it touches **email delivery** and template editing—still one “domain” but higher operational and reputational risk.
- **C** is excellent as a **zero-code-risk** micro-batch; it can ship **alone in minutes** or **prepended** to A in the same PR *only if* the PR stays trivially reviewable. On its own, C does not advance data/API ownership toward OPS enough to be the sole “first batch” for a consolidation project.
- **D** is the wrong first move: redirects before email tools and export parity in OPS recreate the “two half consoles” frustration or block workflows.

### Suggested sequencing after A

1. **A** — OPS list: `stayScope` + CSV (and any minimal read-model/query support).
2. **B** — OPS reservation detail: lifecycle email preview/resend/edit-resend via shared services only.
3. **C** — Admin shell deprecation banner (if not already done with A).
4. **Later phase** — **D** and further redirects once matrix rows for reservations are signed off.

## Batch A — concrete outline (for implementers; do not execute from this doc alone)

| Item | Detail |
|------|--------|
| **Goal** | Operators can filter “all / active / past” stays and export CSV from `/ops/reservations` without using admin list for that. |
| **In scope** | `GET /api/ops/reservations` query param parity with admin `stayScope` semantics (`checkOut`-based); OPS UI select + URL persistence mirroring admin patterns; client CSV from fetched page or explicit export endpoint (prefer one approach—avoid duplicate export logic). |
| **Out of scope** | Redirects; booking status; email send; cabin; promo; reviews. |
| **Likely files** | `OpsReservations.jsx`, `opsApi.js`, `server/routes/ops/modules/reservationsRoutes.js`, `reservationsReadModel.js` (or equivalent read model file). |
| **Verification** | Filter combinations, pagination totals, CSV contents spot-check, build passes. |
| **DoD** | Matrix rows for “OPS list stayScope + export” marked complete; admin list not required for that task. |

## Optional micro-batch (same PR only if tiny)

- **C-only PR:** banner + “use OPS for reservations” link — acceptable as **0th** or **same** PR as A if diff stays under ~50 lines and review stays trivial.

---

## Cursor prompt stub (for when implementation is approved)

Use after updating matrix DoD for batch A:

```text
Implement docs/backoffice-migration/04_FIRST_BATCH_PLAN.md Batch A only.

- Add stayScope (active|past|omit=all) to GET /api/ops/reservations with same checkOut semantics as admin getBookings.
- Add OPS reservations list UI: Stays filter + CSV export; URL persistence optional but preferred.
- Do not redirect /admin routes. Do not add lifecycle email sends. Do not touch Stripe, pricing, sync, or public pages.
- Shared logic only: extract date-boundary helper to a small shared module if needed, call from both admin and ops OR duplicate filter construction in one ops read path only if extraction is deferred—state clearly in PR which approach was taken and follow 03_RULES_FOR_CURSOR.md.

Report: files, routes, models, risk, manual tests, build result.
```
