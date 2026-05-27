# Cancellation Settlement — Locked Implementation Spec

**Status:** Locked for implementation batches (documentation only until Batch 1 is approved)  
**Feature name:** Cancellation Settlement  
**Guest-facing credit label:** Stay credit  
**Internal credit model:** GiftVoucher compensation subtype (`issuanceSource: cancellation_compensation`)  
**Epic:** EPIC-001 (see `docs/BACKLOG.md`)  
**Supersedes:** Informal cancellation/credit notes in backlog stories where they conflict with this document.

If this spec and `docs/gift_vouchers_master_spec.md` conflict on **purchased** gift vouchers, the gift voucher master spec wins for purchases. For **cancellation compensation** credits, this spec wins.

---

## 1. Problem statement

Today, OPS cancellation only changes booking lifecycle status (`cancelled`), tombstones availability, and may send a generic `booking_cancelled` email. It does **not** persist what happens to money.

OPS read models treat **cancelled + paid/partial** as refund owed (`refundPending`, dashboard **Refund follow-up**), even when D&D intentionally keeps payment, is still negotiating with the guest, or will offer stay credit later.

**Real business flow:** D&D may need to **cancel now** (release calendar) while the guest has **not yet chosen** cash refund, stay credit with bonus, rebooking / moved dates, or non-refundable retention.

The spec must support:

```text
cancel now → settlement pending → resolve later
```

`Payment` remains the source of truth for Stripe money movement. **Cancellation settlement** is the staff/business decision layered on top.

---

## 2. Business outcomes

### 2.1 Cancel now, resolve money later (`resolution_pending`)

- Booking `cancelled`; calendar released immediately.  
- Money outcome **not finalized**; OPS must follow up.  
- Guest may still be choosing: cash refund, stay credit (with bonus), rebooking, or payment retained.  
- Settlement `resolution_pending` → **keeps** refund/settlement follow-up active (intentional).  
- Optional `offer` subdocument may record proposed amounts (e.g. €100 cash OR €120 stay credit) — **offer ≠ issued credit**.
- `offer.expiresAt` is informational only in v1 (no automation/auto-transition job included); OPS must resolve manually.

### 2.2 Cancel with payment retained (`payment_retained`)

- Non-refundable / D&D keeps charge.  
- Clears refund-follow-up when finalized (at cancel or via resolve route).

### 2.3 Stay credit issued (`credits_issued`)

- **Only** when stay credit was **actually created** as a compensation `GiftVoucher`.  
- Requires `compensationGiftVoucherId`.  
- Must **not** be set because an offer was made or discussed.  
- Triggers: guest accepted stay credit, **or** staff issues stay credit immediately with **explicit confirmation** (not accidental).  
- Does not use Stripe purchase activation, creator commission, or gift purchase emails.

### 2.4 Cash refund (`cash_refund_pending` / `cash_refunded`)

- **V1:** No Stripe `refunds.create`. Manual refund in Stripe Dashboard.  
- `cash_refund_pending`: refund still owed; keep manual follow-up; OPS sees amount + payment reference + action required.  
- `cash_refunded`: refund completed only when backed by Payment/refund webhook evidence **or** structured `cashRefundEvidence` (not note-only).

### 2.5 Rebooked or moved (`rebooked_or_moved`)

- Guest moved to another booking/date/property.  
- Should set `replacementBookingId` when known.  
- Clears refund-follow-up for the cancelled reservation only when `replacementBookingId` is present; otherwise follow-up must remain active (treat as `resolution_pending` / incomplete).  
- **Future batch** — not first implementation slice.

---

## 3. Core design — `Booking.cancellationSettlement`

Persist one object on `Booking` (implementation from Batch 2+). Schema includes fields needed for later batches; not all fields are writable in early batches.

```js
cancellationSettlement: {
  outcome: {
    type: String,
    enum: [
      'unresolved',
      'resolution_pending',
      'payment_retained',
      'credits_issued',
      'cash_refund_pending',
      'cash_refunded',
      'rebooked_or_moved'
    ],
    required: true
  },
  settlementRecordedAt: { type: Date, required: true },           // when the current settlement state was recorded (cancel or resolve)
  settlementRecordedByActorId: { type: String, required: true, trim: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },

  // Issued stay credit (terminal only for credits_issued)
  creditAmountCents: { type: Number, default: null, min: 0 },
  compensationGiftVoucherId: { type: ObjectId, ref: 'GiftVoucher', default: null },

  // Cash refund tracking (cash_refund_* outcomes)
  cashRefundAmountCents: { type: Number, default: null, min: 0 },
  cashRefundNote: { type: String, default: null, trim: true, maxlength: 500 }, // optional ops note only — not proof of refund

  // Structured manual refund evidence (required for cash_refunded when not webhook-backed)
  cashRefundEvidence: {
    amountCents: { type: Number, default: null, min: 0 },
    stripeRefundId: { type: String, default: null, trim: true },
    stripeChargeId: { type: String, default: null, trim: true },
    stripePaymentIntentId: { type: String, default: null, trim: true },
    recordedAt: { type: Date, default: null },
    recordedByActorId: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true, maxlength: 500 }
  },

  // Guest choice offer (NOT issued credit)
  offer: {
    cashRefundAmountCents: { type: Number, default: null, min: 0 },
    stayCreditAmountCents: { type: Number, default: null, min: 0 },
    offeredAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    note: { type: String, default: null, trim: true, maxlength: 500 }
  },

  // Rebooking / move (rebooked_or_moved)
  replacementBookingId: { type: ObjectId, ref: 'Booking', default: null },

  // Snapshot of what we believed at cancel/record time, to keep settlement reasoning stable.
  // Payment remains source-of-truth for actual Stripe money movement; this is a reference only.
  financialSnapshot: {
    bookingTotalCents: { type: Number, default: null, min: 0 },
    stripePaidAmountCents: { type: Number, default: null, min: 0 },
    voucherAppliedCents: { type: Number, default: null, min: 0 },
    netCashPaidCents: { type: Number, default: null, min: 0 },
    currency: { type: String, enum: ['EUR'], required: true, default: 'EUR' },
    capturedAt: { type: Date, required: true }
  }
}
```

**`financialSnapshot` explanation**: snapshot of what the system believed about the money at the time the cancellation settlement state was recorded. It prevents later Stripe/ledger changes (refunds, voucher adjustments) from rewriting the basis for the settlement decision. `Payment` remains source-of-truth for actual Stripe money movement. **Currency is EUR only** in this system unless a future multi-currency project changes it.

**Lifecycle writers**

| Action | Route | When |
|--------|-------|------|
| Cancel + initial settlement | `POST .../actions/cancel` | Batch 2+ (`transitionReservation`) |
| Resolve / change settlement | `POST .../actions/resolve-cancellation-settlement` | **Future** Batch 5+ or dedicated batch (not Batch 1–2 unless separately approved) |

Only meaningful when `booking.status === 'cancelled'`.

### 3.1 Outcome semantics

| Outcome | Meaning | Refund follow-up / `refundPending` |
|---------|---------|-------------------------------------|
| `unresolved` | Legacy or missing settlement on old cancelled rows | **Current behavior** (cancelled + paid → follow-up) |
| `resolution_pending` | Cancelled; calendar released; money outcome not finalized; OPS must follow up | **Keep** follow-up active |
| `payment_retained` | D&D keeps charge; no refund planned | **Clear** noise |
| `credits_issued` | Stay credit **issued** (compensation voucher exists) | **Clear** only when `compensationGiftVoucherId` set |
| `cash_refund_pending` | Manual Stripe refund still required | **Keep** manual refund follow-up |
| `cash_refunded` | Refund completed with webhook evidence in `Payment` **or** structured `cashRefundEvidence` (see §3.2) | **Clear** noise |
| `rebooked_or_moved` | Guest rebooked / moved; must provide `replacementBookingId` | **Clear** only when `replacementBookingId` is present; otherwise follow-up must remain active |

### 3.2 Rules

- Missing `cancellationSettlement` on old cancelled bookings → **`unresolved`**.  
- `cash_refunded` clears follow-up only when backed by **either**:
  - Payment/refund webhook evidence (`Payment.status = refunded` or equivalent), **or**
  - structured `cashRefundEvidence` with at minimum: `amountCents`, `recordedAt`, `recordedByActorId`, and **one** Stripe reference (`stripeRefundId` **or** `stripeChargeId` **or** `stripePaymentIntentId`).
- `cashRefundNote` is optional operational commentary only — **not** acceptable as sole proof of refund.  
- **`offer` ≠ `credits_issued`:** Recording €100 cash / €120 stay credit in `offer` does not issue credit and must not set outcome to `credits_issued`.  
- **`credits_issued`** only when compensation `GiftVoucher` exists **and** guest accepted stay credit **or** staff explicitly confirms immediate issuance.  
- **`credits_issued` without `compensationGiftVoucherId`** is invalid — do not reach terminal state.  
- **`resolution_pending`** is valid at cancel when money decision is deferred; resolve later via `resolve-cancellation-settlement`.  
- **`rebooked_or_moved` requires** `replacementBookingId`; without it, it must remain `resolution_pending` (or another follow-up state).  
- Bonus stay credit (€100 paid → €120): set issued amounts on voucher at issue time; `offer.stayCreditAmountCents` may preview 12000 before issuance.  
- `Payment.status` is authoritative for Stripe; settlement does not call `refunds.create` in this epic.

---

## 4. Architecture boundaries (locked)

| Rule | Detail |
|------|--------|
| Cancel writer | `transitionReservation({ kind: 'cancel' })` — status + initial `cancellationSettlement` |
| Resolve writer | `resolveCancellationSettlement(...)` — **future**; transitions e.g. `resolution_pending` → terminal outcomes |
| No duplicate cancel paths | Do not add parallel cancel logic in admin or public routes |
| OPS canonical | `POST /api/ops/reservations/:id/actions/cancel`; resolve route documented below, shipped later |
| No guest self-cancel | Out of epic |
| Payment truth | `Payment` + Stripe webhooks for money movement |
| Out of scope unless batched | Checkout, booking finalization, Stripe PI creation, gift voucher **purchase**, creator commission logic changes, `refunds.create` |

---

## 5. OPS payment signals (read models)

Today `derivePaymentAttention` sets `refundPending` when `cancelled && (paid || partial)`.

**Target behavior (from Batch 2 onward):**

```text
CLEAR refundPending / refund_follow_up when outcome IN (
  payment_retained,
  credits_issued AND compensationGiftVoucherId present,
  cash_refunded (only with Payment/refund webhook evidence OR valid cashRefundEvidence),
  rebooked_or_moved AND replacementBookingId present
)

KEEP follow-up when outcome IN (
  unresolved,
  resolution_pending,
  cash_refund_pending
)

credits_issued without compensationGiftVoucherId → incomplete (invalid)
```

**Batch 1:** Extract shared payment-signals module; **no behavior change**; tests assert **current** (pre-settlement) behavior only.

---

## 6. GiftVoucher reuse — compensation subtype

**Decision:** Reuse `GiftVoucher` as the credit engine. **No** separate `GuestCreditLedgerEntry` in this epic.

Redemption uses existing checkout voucher path. **No checkout code changes** in early batches.

### 6.1 Fields added to `GiftVoucher` (Batch 3)

See prior spec: `issuanceSource`, `sourceReservationId`, `issuedByActorId`, `compensationNote`. Backfill existing → `purchase`.

### 6.2 `issueCancellationCompensationVoucher` (Batch 4)

Same constraints as before: active voucher, no Stripe activation, no commission, no gift purchase emails, stay-credit email only.

Called from **resolve** or **cancel** only when transitioning to `credits_issued` with explicit confirmation — not when saving `offer` only.

### 6.3–6.4 Reporting and €100 minimum

Unchanged: filter purchased vs compensation; creator stats exclude compensation; minimum stay credit €100 at issue unless invariant changed.

---

## 7. API shapes

### 7.1 Cancel — `POST /api/ops/reservations/:id/actions/cancel` (Batch 2+)

**Batch 2 allowed outcomes:** `payment_retained`, optionally `resolution_pending` (if needed for API compatibility). Reject others with 400.

```json
{
  "reason": "Guest requested cancel; awaiting decision on refund vs stay credit",
  "settlement": {
    "outcome": "resolution_pending",
    "offer": {
      "cashRefundAmountCents": 10000,
      "stayCreditAmountCents": 12000,
      "note": "Offered either option; guest to confirm by Friday"
    }
  }
}
```

```json
{
  "reason": "Non-refundable cancel 1 day before arrival",
  "settlement": {
    "outcome": "payment_retained"
  }
}
```

### 7.2 Resolve settlement — `POST /api/ops/reservations/:id/actions/resolve-cancellation-settlement`

**Not Batch 1 or Batch 2** unless explicitly approved. Target: **Batch 5+** or a dedicated batch after compensation voucher service exists.

**Purpose:** Cancel first, finalize money later.

**Allowed transitions (examples):**

- `resolution_pending` → `payment_retained`
- `resolution_pending` → `credits_issued` (issues voucher via `issueCancellationCompensationVoucher`)
- `resolution_pending` → `cash_refund_pending`
- `resolution_pending` → `cash_refunded`
- `resolution_pending` → `rebooked_or_moved` (+ `replacementBookingId`)

```json
{
  "reason": "Guest chose stay credit",
  "settlement": {
    "outcome": "credits_issued",
    "creditAmountCents": 12000
  }
}
```

Response includes updated `cancellationSettlement`, `compensationGiftVoucherId`, voucher `code` when applicable.

**Idempotency:** Resolve idempotency key must prevent duplicate voucher issuance.

---

## 8. Guest and OPS language

| Audience | Term |
|----------|------|
| Guest | **Stay credit** / account credit toward a future stay — not “gift card” / “gift voucher” |
| OPS reservation | **Compensation credit** when voucher issued; **Settlement pending** when `resolution_pending` |
| OPS gift voucher module | Purchased vouchers only by default |

---

## 9. Email behavior (locked rules)

| Outcome | Rules |
|---------|--------|
| `payment_retained` | **Either** suppress automatic `booking_cancelled` **or** use settlement-safe template that does **not** imply refund. Generic `booking_cancelled` must not promise refund. |
| `resolution_pending` | Must **not** promise refund or stay credit. May say D&D will contact the guest about next steps **only if product approves** that copy. |
| `credits_issued` | **Stay credit email only after** `compensationGiftVoucherId` exists. Include code, amount, expiry, how to book. |
| `cash_refund_pending` | Do not imply refund already sent. Optional ops/manual comms. |
| `cash_refunded` | Optional confirmation after manual refund. |
| `rebooked_or_moved` | TBD — likely manual or linked to new booking confirmation. |
| Compensation vouchers | **Never** gift purchase (buyer receipt / recipient gift) templates. |

---

## 10. `cash_refund_pending` — OPS visibility (spec)

When outcome is `cash_refund_pending`, OPS should surface (implementation in later batch):

| Field / signal | Source |
|----------------|--------|
| Refund amount | `cashRefundAmountCents` (required on resolve or at cancel if known) |
| Stripe payment / charge reference | Linked `Payment` / `paymentTrail` / `stripePaymentIntentId` on booking |
| Manual action required | Banner: “Process refund in Stripe Dashboard” |
| Follow-up status | Stays in action-needed until → `cash_refunded` (with evidence per §3.2) |
| Refund evidence (manual) | `cashRefundEvidence` when staff records refund in Stripe Dashboard |

**No** `refunds.create` in this epic. Do not mark `cash_refunded` from `cashRefundNote` alone.

---

## 11. Permissions (future separation)

V1 may remain **admin-only** for all settlement actions. The spec records **unequal risk** — do not treat all outcomes as one permission.

| Permission (future) | Capability |
|---------------------|------------|
| `OPS_RESERVATION_CANCEL` | Lifecycle cancel + initial settlement (existing) |
| `OPS_RESERVATION_SETTLEMENT_RETAIN` | `payment_retained` |
| `OPS_RESERVATION_SETTLEMENT_CREDIT` | `credits_issued` / issue compensation voucher |
| `OPS_RESERVATION_SETTLEMENT_REFUND` | `cash_refund_pending` / `cash_refunded` |

Batch 2 may use `OPS_RESERVATION_CANCEL` only until granular permissions are added.

---

## 12. Out of scope / future

### Hybrid settlements (explicitly out of scope)

Example: **€40 cash refund + €80 stay credit** on one cancellation.

- **Do not build** hybrid split in this epic.  
- Current enum is **single terminal outcome** per reservation settlement.  
- Document as **future** if finance/product requires mixed settlements (may need `settlementComponents[]` or similar).

### Other future

- Guest self-service choice of refund vs stay credit  
- Automated policy engine by days-before-arrival  
- Stripe `refunds.create` automation  
- Separate guest wallet / `GuestCreditLedgerEntry`  
- `rebooked_or_moved` full UX (field reserved now)

---

## 13. Implementation batches (locked order)

### Batch 1 — Shared payment signals (refactor only)

- Extract `reservationPaymentSignals` module.  
- **No behavior change.** No `cancellationSettlement` logic.  
- Tests: **current** pre-settlement behavior only. Settlement matrix in Batch 2+.

### Batch 2 — Initial settlement (simple)

- Add `Booking.cancellationSettlement` schema (all fields per §3; only subset writable).  
- `transitionReservation` cancel accepts `settlement`; persist on cancel.  
- Implement terminal outcome **`payment_retained`** only.  
- Optionally allow **`resolution_pending`** at cancel if required for API compatibility (keeps follow-up).  
- Batch 2 is intentionally narrow: only `payment_retained` (and optionally `resolution_pending`) affects follow-up clearing; other terminal outcomes remain legacy/unresolved behavior until later batches.  
- Read models respect `payment_retained` (and `resolution_pending` if enabled).  
- Settlement-safe email rules for `payment_retained` (per §9).  
- **No** `credits_issued`, **no** compensation voucher issuing, **no** `resolve-cancellation-settlement` route, **no** cash refund automation, **no** `rebooked_or_moved` UX.

### Batch 3 — GiftVoucher compensation fields

Unchanged: `issuanceSource`, backfill, reporting filters.

### Batch 4 — Compensation issuing service

`issueCancellationCompensationVoucher` — not wired to cancel/resolve yet.

### Batch 5 — Stay credit + resolve route

- `POST .../resolve-cancellation-settlement` (or dedicated batch number if split).  
- `credits_issued` on resolve (and on cancel only with explicit immediate-issue confirmation).  
- Wire voucher issuance; idempotency; stay-credit email after voucher exists.  
- May include `offer` persistence on cancel/resolve when staff records guest choice options.

### Batch 6 — OPS UI (client)

Cancel modal: reason, outcome (`payment_retained` | `resolution_pending` | … as APIs allow).  
Resolve settlement UI when Batch 5 API exists. €100 minimum for stay credit.

### Batch 7 — Cash refund polish

`cash_refund_pending` / `cash_refunded`, OPS visibility fields, manual mark refunded. No `refunds.create`.

### Batch 8+ (optional) — `rebooked_or_moved`

`replacementBookingId`, rebooking workflow integration.

---

## 14. Testing requirements

| Test | Batch |
|------|-------|
| Payment attention matrix (current) | 1 |
| `payment_retained` clears follow-up | 2 |
| `resolution_pending` keeps follow-up | 2 |
| `offer` saved without voucher / without `credits_issued` | 5 |
| Resolve `resolution_pending` → `credits_issued` + voucher | 5 |
| `credits_issued` rejected without explicit confirmation on cancel | 5 |
| Compensation voucher issue (no PI, no commission, no purchase email) | 4 |
| Creator stats exclude compensation | 3 |
| Idempotency: no duplicate voucher on resolve retry | 5 |

---

## 15. Deployment policy

Unchanged: per-batch review; commit/push/deploy only after approval; PM2/client build only when runtime/client changes.

---

## 16. File map

Unchanged from prior spec plus `resolveCancellationSettlement` service/route when Batch 5 ships.

---

## 17. Changelog

| Date | Change |
|------|--------|
| 2026-05-26 | `cashRefundEvidence` structured proof for `cash_refunded`; `cashRefundNote` note-only; EUR-only `financialSnapshot.currency`. |
| 2026-05-26 | Two-phase model: `resolution_pending`, `offer`, `replacementBookingId`, resolve route, `rebooked_or_moved`; offer ≠ issued credit; permissions & hybrid future. |
| 2026-05-26 | Clarified Batch 1 tests: current behavior only; settlement matrix in Batch 2. |
| 2026-05-26 | Initial locked spec: cancellation settlement + GiftVoucher compensation subtype + batches 1–8+ |
