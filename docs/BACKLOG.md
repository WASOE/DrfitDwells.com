# Product & engineering backlog

Deferred work tracked outside active implementation batches. **Nothing here is committed to a release** until it is picked up, sized, and scheduled.

## How to use this document

| Field | Meaning |
|-------|---------|
| **Status** | `idea` → `ready` → `in_progress` → `done` (or `wont_fix`) |
| **Priority** | `P0` critical · `P1` high · `P2` medium · `P3` low |
| **Area** | Primary codebase or product surface |
| **Depends on** | Other backlog items, specs, or systems that must exist first |

**Conventions**

- One **epic** per product theme; **stories** underneath are shippable slices.
- Acceptance criteria stay outcome-focused (no implementation steps).
- Link to specs when a feature needs a full design pass (`docs/*_master_spec.md` pattern).
- Do **not** duplicate active batch work documented in `docs/backoffice-migration/`, `docs/checkout-payment-architecture/`, or locked batch plans unless explicitly deferred.

**Related today (audit context, May 2026)**

- OPS cancel (`POST /api/ops/reservations/:id/actions/cancel`) sets status `cancelled`, tombstones availability blocks, sends `booking_cancelled` email. **No Stripe refund is triggered.**
- Cancelled + paid/partial payments surface **Refund follow-up** / **Refund pending** in OPS — operational noise when no refund is intended.
- Cancellation policy is legal PDF only; not enforced in code.
- Prepaid **gift voucher** credit exists; cancellation **stay credit** reuses `GiftVoucher` with `issuanceSource: cancellation_compensation` (see locked spec). **OPS manual goodwill gift vouchers** are **not implemented** — tracked as EPIC-002 (adjacent, not part of cancel/resolve).

---

## Bugs

### BUG-001: `payment_unlinked` false positives for gift voucher payments

**Status:** `idea` · **Priority:** P3 · **Area:** Gift vouchers / Stripe ingestion / ManualReview

**Problem**

When the Stripe webhook ingests a paid `PaymentIntent` with `metadata.type === "gift_voucher"` and `metadata.giftVoucherId` is present, the system must not create a high-severity **"Payment ingested without reservation linkage"** `ManualReviewItem` with category `payment_unlinked`.

Gift voucher payments do not require `reservationId` / booking linkage.

**Expected behavior**

| Case | Behavior |
|------|----------|
| Booking payments without reservation linkage | Still create manual review (`payment_unlinked` or equivalent). |
| Gift voucher payments | Validate against `giftVoucherId` / `GiftVoucher.stripePaymentIntentId` instead of reservation linkage. |
| Voucher exists and is active/paid | No manual review. |
| Voucher missing or not activated | Create a **gift-voucher-specific** manual review category/title — not `payment_unlinked`. |

**Notes**

- `server/services/ops/ingestion/stripeIngestionService.js`, `server/services/giftVouchers/giftVoucherPaymentService.js`, `server/scripts/reconcilePaymentLinkageAndManualReviews.js`
- Classification bug only; not checkout-session / finalize orchestration.

---

## Epics

### EPIC-001: Reservation cancellation outcomes (no refund · credits · cash refund)

**Status:** `idea` · **Priority:** P1 · **Area:** OPS reservations · Payments · Guest comms

**Problem**

Staff can cancel a reservation but the product does not express *what happens to money*: keep payment, refund in Stripe, or convert value to guest credit. OPS sees misleading **refund follow-up** alerts when no refund is planned. Guests who deserve flexibility only hear “contact us” — there is no structured **refund-as-credits** path with an incentive to accept credit instead of cash.

**Vision**

Cancellation and **final money decision** are not always the same moment. The system must support:

```text
cancel now → settlement pending → resolve later
```

Staff may **cancel immediately** (release calendar) with `resolution_pending` while the guest still chooses cash refund, stay credit (with bonus), rebooking, or payment retained. Later, staff **resolve settlement** to a terminal outcome. When money is finalized at cancel, record that outcome directly (e.g. `payment_retained`).

The system records settlement on `Booking`, updates OPS signals and guest messaging accordingly, and never implies a cash refund or stay credit is already issued when it is not.

**Out of scope for first slice (unless explicitly added later)**

- Guest self-service cancel portal
- Automated policy engine (e.g. “&lt; 7 days = no refund”) — may reference legal PDF but not replace it
- Partial Stripe refunds driven by policy rules without staff confirmation
- **Hybrid settlements** (e.g. €40 cash + €80 stay credit) — single outcome per reservation in v1; see spec §12
- `rebooked_or_moved` full flow (field reserved in spec; future batch)

**Depends on**

- Locked implementation spec [`docs/cancellation_settlement_implementation_plan.md`](cancellation_settlement_implementation_plan.md) (batches 1–8+): `cancellationSettlement` on `Booking` includes `financialSnapshot` (paid-at-record snapshot) and `rebooked_or_moved` clears follow-up only with `replacementBookingId`; stay credit via **GiftVoucher** `cancellation_compensation` subtype (`compensationGiftVoucherId`).
- STORY-001 (`payment_retained`) can ship after spec Batch 2; stay credit paths depend on STORY-003 (compensation voucher fields + reporting) and STORY-002 (cancel issues stay credit), per spec Batches 3–5.

**Implementation spec (locked):** [`docs/cancellation_settlement_implementation_plan.md`](cancellation_settlement_implementation_plan.md) — supersedes any story text below that implies a separate guest wallet / `GuestCreditLedgerEntry`.

---

#### STORY-001: Cancel without refund (explicit outcome, no false refund signals)

**Status:** `idea` · **Priority:** P1

**User story**

As ops staff, when a guest cancels inside a non-refundable window (or we otherwise keep the payment), I want to **cancel the reservation without refund** so dates reopen and OPS does not nag me to refund money we are keeping.

**Acceptance criteria**

- [ ] Cancel flow includes explicit settlement outcomes, including **`payment_retained`** and optionally **`resolution_pending`** when money is not finalized at cancel time.
- [ ] **`resolution_pending`** keeps refund/settlement follow-up active until resolved (per spec).
- [ ] After this outcome, reservation is `cancelled` and calendar inventory is released (same as today).
- [ ] OPS dashboard and reservation list **do not** show Refund follow-up / Refund pending for this outcome when payment remains captured.
- [ ] Audit log records outcome, actor, reason, and timestamp.
- [ ] Guest communication for this path does **not** imply a cash refund is processing (template variant or staff choice — product decision in spec).
- [ ] Stripe payment record stays `paid` (no automatic Stripe refund).

**Open questions**

- Should `booking_cancelled` email be suppressed, templated separately, or sent with “no refund per policy” copy?
- Can operators undo / change outcome within a time window?

**Notes**

- Builds on existing `transitionReservation` cancel; adds outcome metadata, not a second cancel button only.

---

#### STORY-002: Cancel and issue stay credit (staff-entered amount)

**Status:** `idea` · **Priority:** P1

**User story**

As ops staff, when a guest accepts **stay credit** (or we issue it with explicit confirmation), I want the system to **issue stay credit** as a compensation voucher so they can rebook with a redeemable code — whether at cancel or via later settlement resolution.

**Acceptance criteria**

- [ ] **`offer` ≠ `credits_issued`:** Recording a proposed €100 cash / €120 stay credit in `cancellationSettlement.offer` does **not** issue credit and does **not** set `credits_issued`.
- [ ] **`credits_issued`** only when guest accepted stay credit **or** staff explicitly confirms immediate issuance; creates **compensation `GiftVoucher`** (`issuanceSource: cancellation_compensation`).
- [ ] Credit amount (EUR cents) required before `credits_issued`; default may pre-fill from paid total; staff may override (including bonus above amount paid).
- [ ] Links voucher to the **cancelled reservation** (`sourceReservationId`; `cancellationSettlement.compensationGiftVoucherId`).
- [ ] Clears refund-follow-up / `refundPending` **only after** the compensation voucher exists.
- [ ] Does **not** trigger Stripe refund (`refunds.create` out of scope).
- [ ] Does **not** trigger creator commission (`ensureGiftVoucherCreatorCommissionAfterActivation` must not run).
- [ ] Does **not** send gift voucher **purchase** emails (buyer receipt / recipient gift templates).
- [ ] Guest receives **stay credit** confirmation (code, amount, expiry, how to book) — not “gift voucher” language.
- [ ] Audit trail links reservation → settlement → compensation voucher.

**Open questions**

- Expiry on issued stay credit? Transferable? Per-property restrictions?

**Depends on**

- STORY-003 (compensation GiftVoucher support); spec Batches 4–5.
- Post-cancel **`resolve-cancellation-settlement`** API (spec Batch 5+) when cancel used `resolution_pending` first.

---

#### STORY-002b: Post-cancel settlement resolution (future)

**Status:** `idea` · **Priority:** P1

**User story**

As ops staff, after cancelling with **`resolution_pending`**, I want to **resolve settlement later** when the guest chooses cash refund, stay credit, rebooking, or payment retained — without re-opening the calendar block.

**Acceptance criteria**

- [ ] `POST /api/ops/reservations/:id/actions/resolve-cancellation-settlement` transitions e.g. `resolution_pending` → terminal outcomes (per spec).
- [ ] Not in Batch 1–2 unless explicitly approved; target spec Batch 5+.
- [ ] `rebooked_or_moved` only clears refund follow-up when `replacementBookingId` is present (otherwise it must remain `resolution_pending` or another follow-up state).
- [ ] `rebooked_or_moved` is expected as a future batch outcome (not first implementation slice); until implemented it should be treated as follow-up.
- [ ] When resolving to `cash_refunded`, structured `cashRefundEvidence` is required (amount, actor, timestamp, Stripe reference) unless Payment webhook already shows refunded — `cashRefundNote` alone is not sufficient.
- [ ] Audit trail for resolve action; idempotency prevents duplicate compensation vouchers.

**Depends on**

- STORY-002, STORY-003; spec §7.2.

---

#### STORY-003: Compensation GiftVoucher support and redemption safety

**Status:** `idea` · **Priority:** P1

**User story**

As ops and engineering, we need **compensation stay credits** to be safe and separable from purchased gift vouchers, while reusing existing checkout redemption for guests who receive a compensation code.

**Acceptance criteria**

- [ ] Compensation vouchers use **`issuanceSource: cancellation_compensation`**; purchased vouchers stay `purchase`. **`goodwill_ops`** manual issuance is **EPIC-002** (separate epic, not implemented).
- [ ] **Reuse existing checkout voucher redemption** (`voucherCode`, ledger reserve/confirm) — no separate guest wallet / `GuestCreditLedgerEntry` in this epic.
- [ ] Enforce current **€100 minimum** redeem invariant at issue time unless a later batch explicitly changes `giftVoucherValidationService`.
- [ ] OPS reservation detail shows **Compensation credit** + link when `compensationGiftVoucherId` is set.
- [ ] OPS gift voucher list **defaults to purchased** vouchers only, or clearly separates compensation credits.
- [ ] **Creator stats / gift revenue reporting** exclude compensation (and goodwill) vouchers.
- [ ] Dedicated `issueCancellationCompensationVoucher` path never calls Stripe activation, purchase emails, or commission hooks (per locked spec).

**Open questions**

- Reporting: liability / breakage for compensation vouchers vs purchased gift sales?

**Notes**

- Purchased **gift vouchers** remain a **product sale**; compensation **stay credit** is operational liability — separate labels and filters, same `GiftVoucher` collection.

---

#### STORY-004: Refund choice — cash vs stay credit with bonus incentive

**Status:** `idea` · **Priority:** P2

**User story**

As ops staff (and eventually the guest, if self-service is added), when a refund is appropriate, I want to **offer stay credit with a bonus** (via compensation `GiftVoucher`) instead of cash so more guests accept credit and we reduce cash-out.

**Acceptance criteria**

- [ ] Staff can record a **guest choice offer** on settlement (`offer.cashRefundAmountCents`, `offer.stayCreditAmountCents`) — e.g. €100 cash OR €120 stay credit — without issuing credit.
- [ ] When guest accepts stay credit, resolve to **`credits_issued`** and issue compensation voucher (not when offer alone is saved).
- [ ] Bonus is configurable (e.g. percentage or fixed top-up): example — paid **€100** → **€120** stay credit on issued voucher.
- [ ] UI shows both options side-by-side with clear totals before confirmation.
- [ ] If guest accepts stay credit: issue **compensation `GiftVoucher`** per STORY-002/003; **no** Stripe refund for the credit portion.
- [ ] If guest insists on cash: existing/manual Stripe refund path (or future automated refund story).
- [ ] Config: default bonus %, max bonus cap, properties/cabins where offer applies (optional v1: global only).
- [ ] Messaging uses **stay credit** language (not gift voucher purchase copy); legal review if marketing-like.

**Example (product reference, not hard-coded)**

| Booking paid | Cash refund | Credit offer (20% bonus) |
|--------------|-------------|----------------------------|
| €100 | €100 | €120 credit |

**Open questions**

- Who selects — staff only at first, or guest-facing choice link/email?
- Tax / invoice implications for bonus portion (finance input).
- Does bonus apply to partial refunds?

**Depends on**

- STORY-003 (compensation GiftVoucher support)
- STORY-002 (cancel issues stay credit) — shared UX patterns

---

### EPIC-002: OPS manual goodwill gift vouchers

**Status:** `idea` · **Priority:** P2 · **Area:** OPS gift vouchers · **Implementation:** **not implemented**

**Problem**

Staff sometimes need to issue prepaid credit **without** a Stripe purchase, **without** tying it to a cancelled reservation, and **without** going through the public gift-voucher checkout. Today, OPS can only issue reservation-linked compensation credits via cancellation settlement (`credits_issued` → `cancellation_compensation`). There is no path to create a standalone goodwill credit (e.g. service recovery, marketing gesture, ops correction).

**Relationship to cancellation settlement**

Adjacent but **out of scope** for EPIC-001 / [`docs/cancellation_settlement_implementation_plan.md`](cancellation_settlement_implementation_plan.md). Goodwill issuance must **not** use cancel, resolve, or `sourceReservationId` requirements from the compensation flow.

**Vision**

OPS/admin can manually create an active gift voucher credit from the OPS gift-voucher workspace — same `GiftVoucher` collection and checkout redemption path as purchases and compensation credits, but classified as **`issuanceSource: goodwill_ops`** with no payment or reservation linkage.

**Out of scope (unless explicitly added later)**

- Stripe PaymentIntent / checkout session creation
- Public `/gift-vouchers` purchase flow
- Creator commission on issuance
- Purchase revenue / gift-voucher sales attribution
- Guest delivery email (may ship as a follow-on story; not required for v1 issuance)
- Cancellation settlement cancel/resolve integration

**Depends on**

- Existing `GiftVoucher` model (`issuanceSource` enum already includes `goodwill_ops` in code — **no issuance API or OPS UI yet**).
- Reporting / stats exclusion patterns from EPIC-001 STORY-003 (compensation and goodwill must not pollute purchase metrics).
- [`docs/gift_vouchers_master_spec.md`](gift_vouchers_master_spec.md) for redemption, ledger, and event audit rules.

---

#### STORY-001: OPS manual goodwill gift voucher issuance

**Status:** `idea` · **Priority:** P2 · **Implementation:** **not implemented**

**User story**

As ops staff, I want to **manually create a gift voucher credit** for a guest (goodwill / service recovery) so they receive a redeemable code without a Stripe payment and without cancelling a reservation.

**Acceptance criteria**

- [ ] OPS/admin can create a manual credit from OPS (API + UI — **future batch; not implemented**).
- [ ] Required fields at creation: **recipient name**, **recipient email**, **amount** (EUR cents), **reason/note**.
- [ ] Optional fields: **expiry date**, **internal reference** (ops-only metadata; exact field name TBD in spec).
- [ ] Created voucher has **`issuanceSource: goodwill_ops`**.
- [ ] **No** `stripePaymentIntentId`, **no** `stripeCheckoutSessionId`, **no** `purchaseRequestId`, **no** checkout or payment activation path.
- [ ] **No** creator commission hooks (`ensureGiftVoucherCreatorCommissionAfterActivation` and equivalents must not run).
- [ ] **No** purchase revenue attribution; goodwill vouchers **excluded** from gift-voucher purchase stats, creator gift revenue, and creator commission reporting.
- [ ] **No** gift-voucher **purchase** emails (buyer receipt / recipient gift-card purchase templates) on issuance.
- [ ] Initial status is **`active`** (or explicit product choice: draft/manual pending — lock in implementation spec before build).
- [ ] **`GiftVoucherEvent`** recorded on issuance (e.g. `goodwill_issued` or `manual_issued` — exact event type TBD; must include actor, note/reason, amount).
- [ ] Voucher appears in **OPS gift voucher list** and **detail** with clear **goodwill** labeling, filterable separately from **purchase** and **cancellation_compensation** vouchers.
- [ ] Redemption reuses existing checkout voucher path (same as compensation credits); €100 minimum redeem invariant applies unless explicitly changed in a later batch.
- [ ] Idempotency on create (idempotency key) prevents duplicate vouchers on retry.
- [ ] Audit trail: actor, timestamp, reason/note, amount, recipient — no silent financial mutations.

**Open questions**

- Minimum issue amount: same €100 as compensation, or lower for goodwill?
- Should goodwill vouchers support `deliveryMode: manual` only, or also optional email send in v1?
- Internal reference: free-text ops note vs structured `internalReference` field?
- Void/adjust: reuse existing OPS gift-voucher lifecycle actions or goodwill-specific rules?

**Notes**

- `goodwill_ops` enum exists on `GiftVoucher` today; **no** `issueGoodwillOpsVoucher` service, **no** OPS create route, **no** create UI.
- Guest email delivery is a **separate optional batch** after issuance works.

---

## Backlog index

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| BUG-001 | Gift voucher `payment_unlinked` false positives | P3 | idea |
| EPIC-001 | Cancellation outcomes (no refund · credits · refund choice) | P1 | idea |
| EPIC-001-STORY-001 | Cancel without refund | P1 | idea |
| EPIC-001-STORY-002 | Cancel / resolve → issue stay credit (compensation voucher) | P1 | idea |
| EPIC-001-STORY-002b | Post-cancel settlement resolution | P1 | idea |
| EPIC-001-STORY-003 | Compensation GiftVoucher support & redemption safety | P1 | idea |
| EPIC-001-STORY-004 | Cash vs stay credit with bonus incentive | P2 | idea |
| EPIC-002 | OPS manual goodwill gift vouchers | P2 | idea |
| EPIC-002-STORY-001 | OPS manual goodwill gift voucher issuance | P2 | idea |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-05 | Added EPIC-002: OPS manual goodwill gift vouchers (not implemented; adjacent to cancellation settlement). |
| 2026-05-26 | Spec: `cashRefundEvidence` for manual `cash_refunded` proof (not note-only). |
| 2026-05-26 | EPIC-001: two-phase cancel (`resolution_pending`) + resolve route; offer ≠ issued credit; rebooked future. |
| 2026-05-26 | Aligned EPIC-001 stories with locked spec (GiftVoucher compensation subtype; no separate guest wallet). |
| 2026-05-26 | Linked locked spec `cancellation_settlement_implementation_plan.md` under EPIC-001. |
| 2026-05-26 | Added EPIC-001 (cancellation & credits) from product discussion; documented backlog conventions and current-system audit context. |
| (prior) | BUG-001 gift voucher `payment_unlinked` entry. |
