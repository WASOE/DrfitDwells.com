# Checkout & Payment — Target Architecture (Locked)

**Status:** Architecture lock (approved audit, May 2026)  
**Scope:** Direct guest booking checkout only (ConfirmBooking → Stripe → booking finalize → success page)  
**Out of scope:** GMA, OPS messaging, creator, iCal, reviews, cabin admin, unrelated flows  

This document is the **single source of truth** for checkout/payment redesign. Implementation must not diverge without explicit architecture review.

---

## 1. Problem statement

### 1.1 Ivaylo incident class (production-proven)

Guest **Ivaylo Rusev** booked an **A-frame** stay (multi-unit `cabinTypeId`, `cabinId = null`). Production evidence:

| Observation | Implication |
|-------------|-------------|
| Charged **twice** (two captures) | Two succeeded Stripe PaymentIntents, not merely authorizations |
| **Two confirmed** bookings | Same guest, same A-frame product, same dates |
| **Two** `booking_confirmed` emails | Email idempotency is per `bookingId`, not per commercial stay |
| Both rows: `cabinTypeId` set, `cabinId` null | Success page assumes `booking.cabinId.*` → crash risk (“Something went wrong”) |

This is a **class** of failure, not a one-off bug.

### 1.2 Systemic failures (current architecture)

| Failure | Current behaviour |
|---------|-------------------|
| **Duplicate captured PaymentIntents** | Non-voucher path calls `stripe.paymentIntents.create` on every “Continue to payment” with no canonical owner; voucher path has branch-specific stale-PI replace only |
| **Duplicate confirmed bookings** | Idempotency keys are `checkoutId` + `paymentIntentId` fingerprint, not **commercial stay** (guest + product + dates); multiple `checkoutId`s or multi-unit per-unit assignment can yield two confirmed rows |
| **Duplicate confirmation emails** | `emailService` dedupes `bookingId:trigger` in memory (~10 min); two bookings → two emails |
| **BookingSuccess crash** | UI dereferences `booking.cabinId.name` without `cabinTypeId` fallback |
| **Voucher PI hotfix** | Correct for voucher + promo metadata drift; **not** architecture — does not fix PI sprawl, stay dedupe, finalize ownership, or success read model |

### 1.3 Structural diagnosis

The system treats **`Booking` as both checkout state and reservation output**. Payment identity is split across:

- Client `sessionStorage` (`checkoutId`, `clientSecret`, pending redirect payload)
- Stripe (unbounded PaymentIntents)
- `GiftVoucherRedemption` (partial)
- `Booking` row (created only at “success”)

There is **no server-owned checkout state machine**. That design cannot guarantee “pay once → one confirmed stay → one email” under retry, redirect, second tab, or multi-unit assignment.

---

## 2. Non-negotiable target architecture

These rules are **not optional** for implementation batches C1–C5.

| Principle | Requirement |
|-----------|-------------|
| **CheckoutSession is source of truth** | All checkout lifecycle state lives on a server document keyed by server-issued `checkoutId` |
| **Server-issued `checkoutId`** | Client may cache; client must not be the authority that defines commercial attempt boundaries |
| **Quote snapshot server-side** | Immutable `quoteSnapshot` frozen at PI create/refresh; finalize validates against snapshot, not live quote |
| **One canonical active PaymentIntent per CheckoutSession** | At most one chargeable PI per session; superseded PIs are cancelled or non-finalizable |
| **Booking is output of finalization** | `Booking` is created/linked only when `finalizeCheckoutSession` succeeds; not the checkout session |
| **Confirmation email once** | After valid finalization, `booking_confirmed` at most **once per commercial stay** (session + stay guard), not once per accidental booking row |
| **Success page uses confirmation read model** | `GET /bookings/:id/confirmation` (or equivalent) returns `displayEntity`; no raw `cabinId` assumptions |

**Payments remain enabled.** Architecture fixes ownership and invariants; it does not disable Stripe.

---

## 3. Invariants

Violations must **fail closed** (reject finalize, or `needs_review` + ManualReviewItem), never “best effort” duplicate confirm.

| ID | Invariant |
|----|-----------|
| **I1** | One **CheckoutSession** owns one **commercial attempt** (one guest intent to book one stay at one price). |
| **I2** | One **canonical** active PaymentIntent per active CheckoutSession (status not terminal). |
| **I3** | Retrying another card **must not** create a second confirmed booking (same session → same PI → same finalize). |
| **I4** | Same PaymentIntent **cannot** finalize more than one booking (DB unique on `Booking.stripePaymentIntentId` + session guard). |
| **I5** | Same **commercial stay** cannot produce duplicate **paid/confirmed** direct bookings unless **explicit multi-unit quantity** checkout exists (product decision; default = **no accidental double unit**). |
| **I6** | **BookingSuccess** (and confirmation API) **must** support `cabinId` and `cabinTypeId` populated shapes. |
| **I7** | **Webhook** and **frontend** finalization **must** call the **same** `finalizeCheckoutSession` service (one code path). |
| **I8** | **Paid but not finalized** (PI `succeeded`, no finalized session/booking) **must** create recovery / manual review — never silent orphan. |

---

## 4. CheckoutSession model (draft)

### 4.1 Collection

`CheckoutSession` (MongoDB), authoritative for checkout lifecycle.

### 4.2 Fields (draft)

| Field | Type | Purpose |
|-------|------|---------|
| `checkoutId` | String (PK) | Server UUID; returned to client on session start |
| `status` | Enum | Lifecycle (see §4.3) |
| `stayFingerprint` | String | Hash: `cabinId\|cabinTypeId\|checkIn\|checkOut\|guestEmailNormalized` |
| `guestEmail` | String | Normalized email for guards and ops |
| `quoteSnapshot` | Object | Frozen totals, promo, experienceKeys, entity ids, adults/children, currency |
| `canonicalPaymentIntentId` | String \| null | Single active PI Stripe id |
| `supersededPaymentIntentIds` | [String] | Historical PIs; must not finalize |
| `voucherRedemptionId` | ObjectId \| null | Link to `GiftVoucherRedemption` |
| `bookingId` | ObjectId \| null | Set on successful finalize |
| `paymentStatus` | Enum | `unpaid` \| `processing` \| `paid` \| `failed` (mirror of canonical PI) |
| `finalizeStatus` | Enum | `open` \| `in_progress` \| `finalized` \| `needs_review` |
| `confirmationEmailSentAt` | Date \| null | Email-once CAS target |
| `stripeAmountCents` | Number | Card portion from snapshot |
| `expiresAt` | Date | TTL for abandoned sessions |
| `version` | Number | Optimistic concurrency |
| `metadata` | Object | Attribution snapshot, route, userAgent (non-PII where possible) |
| `createdAt` / `updatedAt` | Date | Audit |

### 4.3 Statuses

```
draft → quoted → payment_required → pi_active → paid → finalizing → finalized
```

Terminal / exceptional: `abandoned`, `expired`, `needs_review`, `superseded`

- **`finalized`**: `bookingId` set; no new PI or finalize without idempotent read.
- **`needs_review`**: Ops/recovery required; guest gets safe message, not second success path.

### 4.4 Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ checkoutId: 1 }` | Unique | Primary key |
| `{ canonicalPaymentIntentId: 1 }` | Unique partial (`$type: string`) | One session per PI |
| `{ stayFingerprint: 1, finalizeStatus: 1 }` | Compound | Stay guard queries |
| `{ guestEmail: 1, createdAt: -1 }` | Compound | Ops / support |
| `{ expiresAt: 1 }` | TTL | Auto-expire non-finalized sessions (e.g. 24–48h) |

### 4.5 Relationships

| Entity | Relationship |
|--------|----------------|
| **Booking** | 0..1 per finalized session; `Booking.checkoutId` = session id; `Booking.stripePaymentIntentId` = canonical PI |
| **PaymentIntent (Stripe)** | 1 canonical per session; metadata includes `checkoutId`, `quoteSnapshot` version/hash |
| **Payment (Mongo)** | Upserted by webhook; `reservationId` = `bookingId` after finalize; `providerReference` = PI id |
| **GiftVoucherRedemption** | `checkoutId` FK; `paymentIntentId` updated when canonical PI changes |
| **Promo** | Frozen in `quoteSnapshot`; usage increment **inside** finalize transaction |
| **EmailEvent** | Logged per send; dedupe keyed by session/stay + `booking_confirmed` |

### 4.6 Session creation

- **POST** `/bookings/checkout-sessions` (or first quote/PI call creates session): server returns `checkoutId`.
- Client **must** send this `checkoutId` on quote refresh, PI create, and finalize.

---

## 5. Canonical PaymentIntent rules

All rules enforced in **CheckoutSession service**, not scattered in routes.

| Event | Rule |
|-------|------|
| **Create PI** | Only when session in `payment_required` / `pi_active`, and no valid canonical PI, **or** quote snapshot changed (amount, promo, voucher applied cents) |
| **Reuse PI** | Same session; PI status ∈ `requires_payment_method`, `requires_confirmation`, `requires_action`; `paymentIntentMatchesQuoteSnapshot(pi, quoteSnapshot)` |
| **Update PI** | Metadata via Stripe update; **amount change** → cancel (if allowed) + create new canonical |
| **Cancel / supersede** | On snapshot change or new PI; append old id to `supersededPaymentIntentIds`; `tryCancelStalePaymentIntent` for cancellable states |
| **Failed card** | **Same PI**, same `clientSecret`; guest retries payment method on PaymentElement — **no** new session, **no** new PI |
| **Retry another card** | **Same PI** (Stripe updates PM) — **not** parallel checkout |
| **Promo / voucher change** | Refresh server quote → update `quoteSnapshot` on session → supersede PI → one new canonical PI |
| **Superseded PI succeeds later** | **Must not** finalize; create `ManualReviewItem` category `superseded_pi_captured`; refund per product policy |

**Non-voucher “always create” is forbidden** in target architecture.

---

## 6. Finalization rules

### 6.1 Single service

```text
finalizeCheckoutSession({
  checkoutId,
  paymentIntentId,  // must equal session.canonicalPaymentIntentId when card due
  guestPayload,     // legal acceptance, guestInfo, etc.
  source            // 'frontend' | 'webhook_worker'
})
```

Used by:

- POST `/bookings` (thin adapter) or POST `/bookings/finalize`
- Webhook follow-up worker (C4), **same implementation**

### 6.2 Idempotency

| Key | Behaviour |
|-----|-----------|
| **`checkoutId`** | If session `finalizeStatus === finalized` → return existing `bookingId` (200, `idempotentReplay: true`) |
| **`paymentIntentId`** | Unique on `Booking.stripePaymentIntentId`; second booking with same PI → 409 `PAYMENT_INTENT_ALREADY_USED` |
| **Commercial stay** | Before create: if blocking booking exists for `stayFingerprint` and not this session → reject + `duplicate_stay_conflict` review |

### 6.3 Transaction boundaries

Atomic intent (Mongo transaction or ordered `findOneAndUpdate` guards):

1. Lock session: `finalizeStatus` → `in_progress` (version check).
2. Verify canonical PI `status === succeeded` and amount/metadata vs `quoteSnapshot`.
3. Run **commercial stay guard** (I5).
4. Create `Booking` **or** return existing on replay.
5. Confirm voucher redemption; increment promo if applicable.
6. Set session `finalized`, `bookingId`, `finalizeStatus`.
7. Patch Stripe PI metadata `bookingId`.
8. **After commit:** send email only if `confirmationEmailSentAt` unset (CAS).

### 6.4 Email-once rule

- **Template:** `booking_confirmed` only when session transitions to `finalized` with valid payment (or full voucher per snapshot).
- **Dedupe:** Set `confirmationEmailSentAt` on session in finalize transaction **or** unique partial index on `(stayFingerprint, templateKey)` for successful lifecycle sends.
- **Do not rely** on in-memory `sentEvents` alone for paid paths.
- **`booking_received`:** Only for intentional unpaid/pending paths (pay-on-arrival policy); never for card-captured stay.

### 6.5 Booking status

| Path | `Booking.status` |
|------|------------------|
| Card PI succeeded + finalize OK | `confirmed` |
| Full voucher (no card) | `confirmed` |
| Pay-on-arrival (explicit product mode) | `pending` |
| `BOOKING_CONFIRM_WITHOUT_STRIPE` | Per env policy (documented; not default guest portal) |

---

## 7. Recovery rules

All create **`ManualReviewItem`** and/or **`PaymentResolutionIssue`** (extend enums in C4). Guest sees safe message; ops owns resolution.

| Category | Condition | Guest-facing | Ops action |
|----------|-----------|--------------|------------|
| **`paid_not_finalized`** | PI succeeded; session not `finalized` after timeout or finalize error | “Payment received — we’re completing your booking” | Manual finalize or refund |
| **`duplicate_paid_pi`** | Second succeeded PI for same `stayFingerprint` / session | Do not second-confirm; support ref | Refund duplicate capture |
| **`duplicate_stay_conflict`** | Finalize blocked; existing confirmed booking | Redirect to existing booking (read model) | Merge/cancel duplicate |
| **`webhook_before_frontend_finalize`** | Webhook marks `paid`; finalize pending | Same as paid_not_finalized if delayed | Worker calls `finalizeCheckoutSession` |
| **`frontend_finalize_failure_after_stripe_success`** | Stripe OK; POST finalize 5xx/409 | No false success navigation | Same as paid_not_finalized |
| **`voucher_reserved_not_finalized`** | Redemption `reserved`; no finalize | Voucher still held | Release hold / complete booking |
| **`superseded_pi_captured`** | Superseded PI reaches `succeeded` | No booking from that PI | Refund superseded PI |

**Invariant I8:** No succeeded PI without either `finalized` session or open recovery row.

---

## 8. Success page architecture

### 8.1 Confirmation read model

**Endpoint (locked name):** `GET /api/bookings/:id/confirmation?email=`

**Response shape (draft):**

```json
{
  "bookingId": "...",
  "status": "confirmed|pending|...",
  "bookingRef": "DW-...",
  "checkInDateOnly": "YYYY-MM-DD",
  "checkOutDateOnly": "YYYY-MM-DD",
  "displayEntity": {
    "type": "cabin|cabinType",
    "name": "...",
    "location": "...",
    "meetingPoint": {},
    "arrivalGuideUrl": null,
    "packingList": [],
    "safetyNotes": null,
    "emergencyContact": null,
    "arrivalWindowDefault": null
  },
  "paymentSummary": {
    "paid": true,
    "method": "stripe|gift_voucher|stripe_plus_gift_voucher|pay_on_arrival",
    "displayAmount": 123.45,
    "currency": "EUR"
  },
  "guest": { "firstName", "lastName", "email" },
  "idempotentReplay": false,
  "existingBookingRedirect": null
}
```

### 8.2 UI rules (BookingSuccess)

| Rule | Requirement |
|------|-------------|
| **No raw `cabinId` assumptions** | Use `displayEntity` only for name, location, guides, packing |
| **cabinId and cabinTypeId** | Server populates `displayEntity` from whichever is on booking |
| **Paid copy** | If `paymentSummary.paid` → do not show “payment due on arrival” |
| **Pending** | Clear “request received” / pay-on-arrival wording |
| **Full voucher** | `paid: true`, `method: gift_voucher`, amount display consistent |
| **Duplicate blocked** | If finalize returns existing booking → success page for **that** id |

### 8.3 C1 scope

C1 delivers read model + client consumption **without** rewriting payment logic (see §9).

---

## 9. Implementation batches

Batches are **sequential dependencies**, not emergency patches.

### C1 — Confirmation read model + success page robustness

| Item | Detail |
|------|--------|
| **Files** | `BookingSuccess.jsx`, `bookingRoutes.js` (GET confirmation), new `bookingConfirmationReadModel.js` (or equivalent) |
| **Behaviour** | `displayEntity`; paid/pending/voucher copy; no `cabinId.name` crash |
| **Risk** | Low |
| **Rollback** | Feature flag `BOOKING_CONFIRMATION_DTO=0` → legacy GET booking (deprecated) |
| **Does not solve alone** | Double charge, double booking, PI ownership |

### C2 — CheckoutSession + canonical PaymentIntent ownership

| Item | Detail |
|------|--------|
| **Files** | `CheckoutSession` model, `checkoutSessionService.js`, `bookingRoutes.js` (quote/PI), `ConfirmBooking.jsx`, `bookingVoucherRedemptionService.js` |
| **Behaviour** | Server session; PI create/reuse/cancel/supersede; behind `CHECKOUT_SESSION_V2=1` |
| **Risk** | High (money path) |
| **Rollback** | Flag off → legacy PI path (bridge only during rollout) |
| **Does not solve alone** | Stay dedupe, email-once, webhook orphan finalize |

### C3 — Idempotent finalization + commercial stay guard + email once

| Item | Detail |
|------|--------|
| **Files** | `checkoutFinalizeService.js`, `bookingRoutes.js` POST, `Booking.js` indexes, `bookingLifecycleEmailService.js` |
| **Behaviour** | Single finalize; I4/I5; unique PI; `confirmationEmailSentAt` |
| **Risk** | High (false positive stay block if policy wrong) |
| **Rollback** | `STAY_DEDUPE_ENFORCED=0` only as temporary ops escape — not long-term |
| **Does not solve alone** | Orphan PI without C4 worker |

### C4 — Webhook / recovery / manual review

| Item | Detail |
|------|--------|
| **Files** | `stripeIngestionService.js`, finalize worker, `PaymentResolutionIssue`, `manualReviewService` categories |
| **Behaviour** | Webhook sets session `paid`; shared finalize; recovery categories §7 |
| **Risk** | Medium (auto-finalize policy) |
| **Rollback** | Disable worker; manual ops only |
| **Does not solve alone** | Historical data / indexes |

### C5 — Migrations / preflight / observability

| Item | Detail |
|------|--------|
| **Files** | Index migrations, preflight scripts, metrics/logging |
| **Behaviour** | Unique `stripePaymentIntentId`; preflight queries §10; dashboards |
| **Risk** | Index build on large collections |
| **Rollback** | Drop indexes only with ops plan |
| **Does not solve alone** | Runtime without C2–C4 |

---

## 10. Required test matrix (pre-deploy)

All scenarios **must** pass (integration and/or e2e in Stripe test mode) before production flag flip.

| # | Scenario | Expected outcome |
|---|----------|------------------|
| T1 | Same `checkoutId`, double submit finalize | One booking; second idempotent 200 |
| T2 | Different `checkoutId`, same guest/stay/dates | Second finalize blocked (stay guard); no second confirmed booking |
| T3 | Card fail then retry same PI | One PI, one booking |
| T4 | Second card on same PI (same session) | One booking |
| T5 | Stripe succeeds; finalize fails (simulated) | Session `needs_review`; `paid_not_finalized`; no duplicate email |
| T6 | Webhook `payment_intent.succeeded` before frontend finalize | Worker/idempotent finalize → one booking |
| T7 | Webhook after finalize | No-op; no second booking |
| T8 | Promo applied after PI created | PI superseded; old PI cannot finalize; one chargeable PI |
| T9 | Voucher partial + card | One PI for remainder; one booking |
| T10 | Voucher full coverage | No PI; one booking; `gift_voucher` method |
| T11 | PaymentIntent already used for another booking | 409 `PAYMENT_INTENT_ALREADY_USED` |
| T12 | Booking success with `cabinTypeId` only | Confirmation DTO renders; no React throw |
| T13 | Confirmation email | Exactly one `booking_confirmed` per commercial stay |
| T14 | No duplicate confirmed paid stay | Second path rejected (unless explicit quantity UX — product) |
| T15 | Orphan succeeded PI (paid, no finalize) | ManualReviewItem created within SLA |
| T16 | Superseded PI succeeds | No booking; `superseded_pi_captured` review |
| T17 | Multi-unit: two finalize same guest/dates (default policy) | Second blocked (after product lock §11) |

---

## 11. Product decisions still needed

Architecture implementation **defaults** below until explicitly changed:

| # | Decision | Default for build |
|---|----------|-------------------|
| **P1** | Accidental double A-frame booking (same guest, same dates, two units) | **Bug** — block unless explicit **quantity / multi-unit** checkout exists |
| **P2** | Does `pending` unpaid booking block same guest from rebooking same dates? | **Yes** — `pending` ∈ blocking statuses for stay guard |
| **P3** | Duplicate capture refund | **Manual refund first** (C4 ops); auto-refund behind flag after playbook |
| **P4** | Webhook auto-finalize without guest POST | **Allowed** only via same `finalizeCheckoutSession` + stored guest payload; flag `WEBHOOK_FINALIZE_ENABLED` |
| **P5** | Pay-on-arrival when Stripe enabled | **Disallowed** on public ConfirmBooking (API enforce in C3) unless explicit legacy route |
| **P6** | Ivaylo historical rows | Ops: cancel one booking + refund one PI — **out of band** (not migration scope) |

Record decisions in this section when locked by product.

---

## 12. Preflight (production, read-only)

Run before C5 index migrations:

- Duplicate `stripePaymentIntentId` on `bookings`
- Duplicate confirmed stays (same email + cabinType/cabin + dates)
- Orphan succeeded PIs (Stripe search by `metadata.checkoutId`)
- Confirmed card bookings without PI
- `payments` paid without `reservationId`
- `giftvoucherredemptions` reserved without booking
- Multiple `booking_confirmed` emails per stay window

See audit playbook for exact `mongosh` / Stripe CLI queries.

---

## 13. References (code map — current, pre-implementation)

| Area | Current file |
|------|----------------|
| Checkout UI | `client/src/pages/ConfirmBooking.jsx` |
| Success UI | `client/src/pages/BookingSuccess.jsx` |
| Routes | `server/routes/bookingRoutes.js` |
| Quote / PI verify | `server/services/bookingQuoteService.js` |
| Voucher hold | `server/services/bookings/bookingVoucherRedemptionService.js` |
| Email | `server/services/bookingLifecycleEmailService.js`, `server/services/emailService.js` |
| Webhook | `server/services/ops/ingestion/stripeIngestionService.js` |
| Models | `server/models/Booking.js`, `Payment.js`, `GiftVoucherRedemption.js` |

**Do not extend** voucher-only PI hotfix as substitute for this document.

---

## Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-05 | Initial lock from production audit (Ivaylo class) |

**Changes require:** architecture owner sign-off + test matrix update.
