# Creator Portal — Batch 11A specification (read-only)

**Status:** Planning only — **no implementation in this batch.**  
**Scope:** A separate, read-only **Creator Portal** surface (not OPS, not public “influencer application” pages).  
**Relationship:** OPS remains source of truth for edits, commission workflow, and payouts. Portal is **reporting only**.

**Cross-reference:** Creator Portal metrics and UI copy must follow the same financial semantics as OPS. See **[Creator financial semantics hardening](./driftdwells_creator_financial_semantics_hardening.md)** for locked definitions (attributed value vs paid stay revenue, projected vs ledger commission, payment-issue exclusions, voucher commission split, etc.).

---

## Financial language alignment

Creator Portal must reuse the **same metric semantics** as OPS and the hardening spec above — same underlying service outputs, same meaning in labels. Portal copy may add clarity (e.g. “not payable”) but must **not** contradict or soften those definitions.

**Required labels (and meanings):**

- **Projected commission** — visible **estimate** only; **not payable**; not for payout decisions.
- **Approved commission** — total **manually approved by OPS**; **not necessarily paid**.
- **Paid commission** — total **marked paid by OPS** (settled payout queue).
- **Paid stay revenue** — cash-style revenue from **qualifying paid bookings only** (per hardening spec: confirmed / in-house / completed and exclusions such as open payment-resolution issues where applicable).
- **Attributed booking value** — booking value **attributed** to the creator for visibility; **not** “money collected” and **not necessarily payable**.
- **Gift voucher sales** — **separate** from stay bookings (counts/revenue from voucher domain, not mixed into stay rows as if they were the same product).
- **Gift voucher commission** — show **only** when the underlying voucher sale is **commissionable** for this creator (same rules as stats/ledger; if not commissionable, omit or show zero with a clear label — implementation batch must match existing aggregation, not invent new rules).

**Forbidden / discouraged wording:**

- Do **not** call projected commission **“earnings”**, **“balance”**, or implied cash the creator can withdraw.
- Do **not** show **“available payout”** (or equivalent) **unless** a defined payout workflow exists in product and code; until then, stay with approved / paid commission labels only.

**Conservatism rule:**

The creator portal must be **more conservative than OPS** in money wording. If a figure’s business meaning is ambiguous for a creator audience, label it as **estimate** or **projected** (or reuse the exact OPS-approved label from the hardening doc) rather than implying certainty or entitlement.

---

## 1. Product goal

- Give each **CreatorPartner** a **private** way to view **only their own** performance and commission summaries.
- **No** guest PII, **no** payment identifiers, **no** internal ops notes or manual-review payloads.
- **No** access to OPS routes or admin capabilities.
- **No passwords** in V1: **passwordless magic link** (or equivalent signed, expiring token) leading to an **httpOnly** session cookie scoped to creator portal.
- **Revocable / expiring** access so operators can shut down or rotate links without touching booking/payment code.

**Explicit non-goals (V1):**

- Public influencer/collab application flows (keep separate).
- Editing creator profile, promo, commission settings, or ledger from the portal.
- Changing booking, payment, promo, pricing, or commission **math** — reuse existing services only.

---

## 2. Login / auth flow

### 2.1 Operator-initiated link

1. OPS: **Creator partners** → select creator (e.g. Diana) → **Send portal link** (or **Regenerate access**).
2. Backend generates a **short-lived, signed** credential (see §9) and sends **one** delivery channel in V1 (decide in §14): e.g. email to `contact.email`, or copy-to-clipboard link for OPS to paste into Instagram DM.
3. Creator opens URL, e.g. `https://<booking-host>/creator/login?t=<token>` (exact query shape TBD in implementation; prefer opaque token, not JWT in URL if avoidable).

### 2.2 Verification and session

1. **GET** or **POST** verification endpoint consumes the token **once** (recommended: single-use **exchange**), validates signature + expiry + revocation + creator still allowed (`status` in `active` | `paused` | `archived` — **exclude `draft`** for portal login, align with attribution policy).
2. On success: set **httpOnly**, **Secure**, **SameSite** cookie (e.g. `CreatorPortalSession` or reuse a dedicated cookie name) containing **only** a server-side session id **or** a signed session blob **that maps server-side** to `creatorPartnerId`.
3. Redirect to **`/creator`** (SPA route). Subsequent API calls send cookie; **no** `Authorization` bearer shared with OPS.

### 2.3 Logout

- **POST** `/api/creator-portal/logout` clears cookie and invalidates server-side session if stored.

### 2.4 Optional: “request link” self-serve

- **POST** `/api/creator-portal/request-link` with **rate-limited** body (e.g. email **or** referral code) — **high abuse risk**. Spec allows it as **optional V1.1**; V1 can be **OPS-only send** to reduce enumeration. If implemented: never reveal whether email/referral matched; always generic response; strict rate limits; optional CAPTCHA later.

---

## 3. Data the creator **can** see

### 3.1 Profile header (non-sensitive)

- Display name (`CreatorPartner.name`)
- Referral handle / code for display: e.g. `@diana.bosa` style from `referral.code` (formatting only)
- Status label: `active` | `paused` | `archived` (and copy that portal is read-only)

### 3.2 Aggregated metrics (aligned with hardened semantics)

Reuse **`buildSingleCreatorPartnerStats`** output where possible; extend **portal response DTO** only (not OPS) to include fields already computed in stats service if missing from OPS formatter today:

| Metric | Source (conceptual) |
|--------|---------------------|
| Visits | stats service |
| Unique visitors | stats service |
| Bookings (attributed) | `attributedBookings` |
| Paid bookings | `paidConfirmedBookings` |
| Attributed booking value | `attributedBookingValue` (fallback semantics documented in financial hardening doc) |
| Paid stay revenue | `paidStayRevenue` |
| Gift voucher sales | purchases count + revenue cents (as money) |
| Projected commission | clearly labeled **not payable** — from existing estimate fields / rate (same rules as OPS copy, no new formula) |
| Approved commission | **sum** of ledger rows `status === 'approved'` for this partner |
| Paid commission | **sum** of ledger rows `status === 'paid'` |

**Referral link:** construct from configured public origin + `?ref=<referral.code>` (same as OPS copy pattern).

**Promo code:** `promo.code` if set — display only; no editing.

**Terms:** `commission.eligibleAfter`, `commission.rateBps` as human-readable percent (read-only).

### 3.3 Activity lists (privacy-safe)

**Stay bookings (attributed to this creator only):**

| Field | Notes |
|-------|--------|
| Date | check-in or booking date — pick one consistently |
| Property | cabin name from populated or joined field; **no** internal cabin admin ids in UI |
| Status | coarse booking status bucket (e.g. pending / confirmed / cancelled) — mirror allowed enum subset |
| Source | `referral` \| `promo` \| `none` — from attribution resolver **source** (not raw internal debug) |
| Booking value | attributed value line item consistent with portal “attributed value” semantics (document: use **totalPrice** or existing stats row helper — **no new pricing rules**) |
| Commission status | ledger row status for that booking if exists: pending / approved / paid / void (aggregate if multiple rows — document rule: prefer **worst** or **primary stay row**; implementation batch must pick one rule) |

**Gift voucher sales (attributed to creator):**

- Date, amount (money), **no** purchaser email/name unless already non-PII aggregate (default: **omit purchaser PII**).

---

## 4. Data the creator **must not** see

- Guest **full name**, email, phone, address
- Stripe / payment intent ids, card metadata
- `PaymentResolutionIssue` details, dispute text, or “needs review” internals
- `ManualReviewItem` content
- OPS-only fields: `notes`, `createdBy`, internal promo warnings, other creators’ data
- Any route under `/ops/*` or admin JWT-protected surfaces

---

## 5. API routes (canonical names)

Base path: **`/api/creator-portal`** (distinct from `/api/ops`).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/creator-portal/request-link` | Optional: rate-limited “email me a link” (see §14) |
| `GET` | `/api/creator-portal/session` | Health: returns `{ authenticated: boolean }` without leaking id if unauthenticated |
| `GET` | `/api/creator-portal/me` | Full portal DTO: profile slice + metrics + safe lists |
| `POST` | `/api/creator-portal/logout` | Clear session |

**Additional implementation route (not counted as “public API surface” for creators):**

- **`GET` or `POST`** `/api/creator-portal/verify` (name TBD) — exchange magic token for session; may be merged into login page load with POST to avoid token in Referer logs — **security detail in Batch 11E**.

All portal APIs:

- **CORS:** only portal origin(s) if SPA is cross-host; if same-site under booking app, cookie `Path`/`SameSite` must be correct.
- **Rate limit** token verify and request-link aggressively.

---

## 6. Frontend routes

| Route | Purpose |
|-------|---------|
| `/creator/login` | Landing: token in query or pasted; shows “Verifying…” / error / redirect |
| `/creator` | Dashboard (protected): metrics, links, activity, terms |

**Implementation note:** Vite/React router additions in **client** only for Batch 11D; **no** embedding inside OPS bundle layout — separate layout component `CreatorPortalLayout` (dark theme).

---

## 7. OPS actions required

- On **OpsCreatorPartners** detail (or row menu): **Send portal link**  
  - Calls new **OPS-authenticated** endpoint, e.g. `POST /api/ops/creator-partners/:id/portal-link` (exact path in 11C).  
  - Sends email or returns one-time URL for operator to copy (product choice in §14).
- **Regenerate access** (optional same endpoint with `?regenerate=true`): invalidates previous magic-link tokens / sessions for that partner.

**Authorization:** same OPS auth as other creator partner mutations.

---

## 8. Reused backend services (no commission math changes)

| Capability | Suggested reuse |
|------------|-----------------|
| Partner stats | `buildSingleCreatorPartnerStats(creatorPartnerDoc)` from `server/services/ops/creatorPartnerStatsService.js` |
| Attribution source for rows | `resolveBookingCreatorAttribution(booking, maps)` from `server/services/creators/creatorAttributionResolver.js` — **read-only** |
| Attributed booking list | `listCreatorPartnerAttributedBookings(creatorPartnerDoc, { limit })` then **map** to privacy DTO (strip guest fields) |
| Commission rows | `listCreatorCommissionForPartner(creatorPartnerId, { limit })` — aggregate approved/paid sums in portal service; **do not** change ledger write paths |

**Gap to close in 11B (DTO only):** OPS `formatCreatorPartnerStats` may omit `attributedBookingValue`, `paidStayRevenue` — portal should read **raw stats object** from service or add a **portal-specific formatter** that does not change calculations.

---

## 9. New models / fields (recommended)

**Preferred: dedicated collection for auditability and revocation**

Example shape (names illustrative):

**`CreatorPortalAccess`**

- `creatorPartnerId` (ObjectId, indexed)
- `tokenHash` (hash of opaque token — **never** store raw token)
- `expiresAt` (Date, TTL index optional)
- `revokedAt` (Date, nullable)
- `createdBy` (OPS email)
- `lastSentAt` (Date)
- `usageCount` / `maxUses` (if single-use: `consumedAt`)

**Alternative (lighter):** signed stateless JWT with short TTL + revocation list in Redis — only if infra exists; Mongo-first matches current stack.

**`CreatorPartner` changes:** none required for V1 if access tokens live in `CreatorPortalAccess`. Optional: `portalLastInviteAt` for UX only.

---

## 10. Security rules

1. **Session cookie:** `httpOnly`, `Secure` in prod, `SameSite=Lax` or `Strict` depending on hosting (document per deploy).
2. **Token:** cryptographically random, high entropy; store **hash** only; **short TTL** (e.g. 15–60 minutes for magic link); **single-use** exchange recommended.
3. **Authorization:** every `/api/creator-portal/me` resolves `creatorPartnerId` **only** from server session — **never** from client-supplied id.
4. **Enumeration:** `request-link` if enabled must not leak account existence.
5. **CSRF:** For cookie-based session, **POST** mutations (logout, verify) use **SameSite** + optional CSRF token if same-site patterns require it.
6. **No** portal user impersonation via OPS JWT — separate middleware `requireCreatorPortalSession`.
7. **Content:** strip PII at **service boundary** for portal DTOs — defense in depth even if list functions return more fields internally.

---

## 11. Design direction

- **Separate** from OPS: own layout, typography, color system.
- **Dark / premium** with **Instagram-inspired** subtle gradients on cards/headers only (avoid noisy backgrounds).
- **Mobile-first**, large metric cards, generous spacing; **not** dense admin tables for primary metrics (tables allowed only for compact “recent activity” if needed).
- **max-width** container on desktop (e.g. `max-w-3xl` or `max-w-4xl` centered).

---

## 12. Recommended data contract (`GET /api/creator-portal/me`)

```json
{
  "profile": {
    "displayName": "string",
    "referralCode": "string",
    "referralUrl": "string",
    "promoCode": "string | null",
    "status": "active | paused | archived",
    "commissionRatePercent": 5,
    "eligibleAfter": "stay_completed | manual_approval"
  },
  "metrics": {
    "visits": 0,
    "uniqueVisitors": 0,
    "attributedBookings": 0,
    "paidBookings": 0,
    "attributedBookingValue": 0,
    "paidStayRevenue": 0,
    "giftVoucherPurchases": 0,
    "giftVoucherRevenue": { "amount": 0, "currency": "EUR" },
    "projectedCommission": { "amount": 0, "currency": "EUR", "notPayable": true },
    "approvedCommission": { "amount": 0, "currency": "EUR" },
    "paidCommission": { "amount": 0, "currency": "EUR" }
  },
  "recentBookings": [
    {
      "id": "string",
      "date": "ISO",
      "propertyName": "string",
      "status": "string",
      "source": "referral | promo | none",
      "bookingValue": { "amount": 0, "currency": "EUR" },
      "commissionStatus": "pending | approved | paid | void | none"
    }
  ],
  "recentGiftVouchers": []
}
```

**Notes:**

- Money as `{ amount, currency }` or minor units — pick one in 11B and stay consistent.
- `recentGiftVouchers` entries must omit purchaser PII.

---

## 13. Batch plan (execution order)

| Batch | Name | Deliverables |
|-------|------|----------------|
| **11A** | Creator portal spec | This document + locked decisions from §14 |
| **11B** | Backend auth + read APIs | `CreatorPortalAccess` (or chosen token store), verify + session cookie, `session`/`me`/`logout`, portal service wrapping stats + commission aggregates + privacy mappers, `server.js` route registration, env vars (`CREATOR_PORTAL_SECRET`, cookie name, TTL) |
| **11C** | OPS send link | OPS route + UI button, email template or copy-link response, revoke/regenerate |
| **11D** | Public frontend | `/creator/login`, `/creator`, dark layout, consumes `me` API |
| **11E** | Tests + hardening | Token reuse, expiry, revoked partner, draft blocked, rate limits, no PII leakage tests on JSON responses |

**Dependency order:** 11A → 11B → (11C parallel with 11D after `me` stub) → 11E last.

---

## 14. Risk list

| Risk | Mitigation |
|------|------------|
| Token leaked via Referer / logs | Prefer POST exchange; short TTL; single-use |
| Email spoof / link forwarding | Educate creators; optional device binding deferred |
| `request-link` enumeration | OPS-only send in V1, or generic responses + rate limit |
| Accidental PII in `listCreatorPartnerAttributedBookings` | Explicit portal mapper; integration tests on JSON keys |
| Cookie on wrong domain | Document `APP_URL` / booking host vs marketing site |
| Stats/OPS formatter drift | Portal reads service layer or shared formatter, not duplicated math |
| Archived creator access | Policy: allow read-only portal for archived (align with historical stats) or block — **decide in §15** |

---

## 15. Open decisions (cannot lock without product input)

1. **Self-serve `request-link` in V1?** (Recommended: **no** — OPS send only.)
2. **Delivery:** email to `contact.email` vs copy-link only vs both.
3. **Magic link TTL** and **single-use vs multi-use** until expiry.
4. **Archived creators:** portal allowed or login denied?
5. **Hostname:** same origin as booking SPA vs subdomain — drives cookie and CORS.
6. **Commission row per booking:** if multiple ledger rows, how portal picks “commission status” for one booking row (single display rule).

---

## 16. Explicit hard rules (carry forward to 11B–11E)

- Separate product surface from OPS; **no** shared session with OPS admin JWT.
- Read-only reporting; **no** writes to `Booking`, `CreatorPartner` ledger approve/pay, or payment objects from portal.
- **Do not** change booking / payment / promo / pricing / availability logic.
- **Do not** change commission calculation formulas — **aggregate** existing ledger only.
- **Do not** expose manual review / payment resolution internals.

---

**Document owner:** planning batch 11A.  
**Next step:** Review §15 decisions, then implement **Batch 11B** per §13.
