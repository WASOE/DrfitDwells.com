# StayChange — Locked Architecture Spec

**Status:** LOCKED ARCHITECTURE - PENDING IMPLEMENTATION  
**Feature name:** StayChange  
**OPS user-facing action:** Move / Modify stay  
**Canonical aggregate:** `StayChange`  
**Kinds:** `reallocate` | `amend` | `rebook`  
**Related:** `docs/cancellation_settlement_implementation_plan.md` (wires `rebooked_or_moved` + `replacementBookingId` as Booking projections of completed REBOOK)  
**Audits grounding this lock:** Stay move domain audit · Stay-change lock audit · Complimentary upgrade finance audit (2026-08)

This document is the Batch 0 locked architecture. **No application models, migrations, routes, or tests are authorized by this file alone.** Implementation begins only when a later batch is explicitly approved.

If this spec conflicts with informal backlog notes about “reassign” or “rebooked_or_moved UX,” **this spec wins**.

---

## 1. Problem statement

OPS can cancel a reservation with rich settlement, and can thinly “reassign” a `cabinId` or edit dates. None of that is a production-grade way to:

- move a guest between **physical units** of the same commercial product (A-Frame 1 → A-Frame 2);
- **amend** dates / guests / quote-affecting terms on the same Booking with explicit money disposition;
- **rebook** across commercial products (Cabin → Valley, Cabin → Stone House, etc.) while preserving historical commercial identity and Payment provenance;
- grant a **complimentary** or **partial** upgrade when the target’s canonical quote exceeds transferred coverage.

Raw Reassign is unsafe (identity mutation, AvailabilityBlock drift, no money model). Cancel + manual create is a workaround that double-counts Meta, commissions, KPIs, and emails unless carefully hand-managed.

**StayChange** is the durable domain aggregate that makes Move / Modify stay first-class.

---

## 2. Domain

### 2.1 Canonical aggregate

| Item | Lock |
|------|------|
| Aggregate name | **`StayChange`** (not `StayMove`, not split Amendment + Move collections) |
| Kinds | `reallocate` \| `amend` \| `rebook` |
| Source of truth | StayChange document for relationship, money plan, snapshots, and workflow state |
| Booking fields | Thin **projections** only (`cancellationSettlement` for REBOOK source; `settledByStayChangeId` for target/replacement) |

Rationale: one orchestration / settlement / idempotency / crash-recovery spine. Kind discriminant carries mode-specific rules. Name `StayChange` covers amend and reallocate; `StayMove` is semantically wrong as the collection name.

### 2.2 OPS surface

Single entry point: **Move / Modify stay**. The wizard (Batch 7) classifies into REALLOCATE / AMEND / REBOOK; operators do not edit raw commercial identity fields.

---

## 3. Commercial product identity

### 3.1 Canonical key

```text
commercialProductKey(x) =
  x.cabinTypeId
    ? "cabinType:" + String(x.cabinTypeId)
    : x.cabinId
      ? "cabin:" + String(x.cabinId)
      : invalid

isSameCommercialProduct(a, b) =
  commercialProductKey(a) === commercialProductKey(b)
```

| Inventory shape | Commercial identity | Operational only |
|-----------------|---------------------|------------------|
| Single inventory | `cabinId` | — (no unit layer) |
| Multi inventory | `cabinTypeId` | `unitId` |

**Proof lock (repo):** `Unit` has no pricing fields; quotes/payments/Meta item names/fingerprints key off Cabin or CabinType; `commercialStayFingerprint` never includes `unitId`.

### 3.2 Booking shape invariants

- Exactly one of `cabinId` | `cabinTypeId` (XOR).
- `unitId` only valid with `cabinTypeId`.
- `unitId` may be `null` before allocation.
- When `unitId` is set, the Unit’s `cabinTypeId` must equal the Booking’s `cabinTypeId`.

---

## 4. Mode routing

### 4.1 REALLOCATE

**When:**

- Same `cabinTypeId` (same commercial product).
- **Only** `unitId` changes.
- Dates, guests, and all quote-affecting commercial terms unchanged.

**Rules:**

- Same Booking `_id`.
- `deltaCents` must be **exactly 0** (zero tolerance).
- No financial settlement substeps.
- **Different `cabinId` is NEVER REALLOCATE** (that is REBOOK).
- Single-inventory bookings have no REALLOCATE path (no operational unit layer).

### 4.2 AMEND

**When:**

- Same commercial product (`isSameCommercialProduct`).
- Dates and/or guests and/or quote-affecting terms change (extras, transport, romantic setup, promo terms that affect quote, etc.).

**Rules:**

- Same Booking `_id`.
- Immutable before/after evidence on StayChange.
- Explicit settlement if contractual price changes (positive or negative delta rules below).
- May also change `unitId` as part of the same amend when still same `cabinTypeId` (unit change alone without quote/date/guest change remains REALLOCATE).

### 4.3 REBOOK

**When:** any commercial product change, including:

- cabin → different cabin  
- cabin → cabinType  
- cabinType → cabin  
- cabinType → different cabinType  

**Rules:**

- Preserve source Booking commercial identity, money snapshots, and Payment links **forever**.
- Create replacement Booking.
- Source commercial identity fields are **NEVER** rewritten.
- StayChange is the canonical link; Booking projections mirror completion.

---

## 5. Money model (integer cents, zero tolerance)

All StayChange money fields are **integer EUR cents**. Tolerance for equality checks is **0**.

### 5.1 Required concepts

| Field | Definition |
|-------|------------|
| `canonicalTargetQuoteCents` | Normal target quote from the canonical pricing engine **before** StayChange concession |
| `transferredValueCents` | Commercial coverage carried from the source reservation through StayChange (ledger coverage, **not** a Payment) |
| `positiveDeltaCents` | `canonicalTargetQuoteCents - transferredValueCents` when positive; else 0 for positive-delta equations |
| `waivedUpgradeCents` | Positive target-price difference deliberately absorbed by the business |
| `additionalChargeCents` | Remaining positive difference the guest must still provide |
| `contractualTargetTotalCents` | Amount the guest is contractually required to provide for the target stay after StayChange concessions |

### 5.2 Positive-delta outcomes (first-class)

| `settlementType` (upgrade family) | Meaning |
|-----------------------------------|---------|
| `paid_upgrade` | `waivedUpgradeCents = 0`; guest pays full positive delta |
| `complimentary_upgrade` | `additionalChargeCents = 0`; business waives full positive delta |
| `partial_complimentary_upgrade` | Both charge and waive nonzero; sum equals positive delta |

Positive delta does **not** automatically require charging the guest.

### 5.3 Positive-delta equations (LOCKED)

```text
positiveDeltaCents =
  canonicalTargetQuoteCents - transferredValueCents
  (only when canonicalTargetQuoteCents >= transferredValueCents;
   otherwise use negative-delta section)

additionalChargeCents + waivedUpgradeCents
  = positiveDeltaCents

contractualTargetTotalCents =
  transferredValueCents + additionalChargeCents
```

**Full complimentary example**

| Field | Cents |
|-------|------:|
| Source coverage / transferred | 5500 |
| Canonical target quote | 6500 |
| `positiveDeltaCents` | 1000 |
| `additionalChargeCents` | 0 |
| `waivedUpgradeCents` | 1000 |
| `contractualTargetTotalCents` | 5500 |

**Partial complimentary example**

| Field | Cents |
|-------|------:|
| Canonical target | 7500 |
| Transferred | 5500 |
| `positiveDeltaCents` | 2000 |
| Operator charges | 500 |
| Operator waives | 1500 |
| Contractual target | 6000 |

### 5.4 Negative-delta equations (LOCKED)

When `canonicalTargetQuoteCents < transferredValueCents`:

```text
negativeDeltaCents =
  transferredValueCents - canonicalTargetQuoteCents

refundCents + creditCents + retainedCents
  = negativeDeltaCents

contractualTargetTotalCents =
  canonicalTargetQuoteCents
```

| Outcome family | Fields |
|----------------|--------|
| `refund` | `refundCents > 0` (v1: manual Stripe Dashboard + structured evidence, same posture as cancellation cash refund unless a later payments epic unlocks automation) |
| `stay_credit` | `creditCents > 0` → compensation GiftVoucher issuance (reuse cancellation compensation patterns; StayChange-linked issuance source/metadata) |
| `retain` | `retainedCents > 0` → business keeps difference with explicit reason |
| Split | Any combination whose cents sum exactly to `negativeDeltaCents` |

Refund / credit issuance for downgrade occurs **only after** inventory/booking commit (`committed` → `settling`). Failure after irreversible money side-effect → `needs_reconciliation`.

### 5.5 Zero-delta

`canonicalTargetQuoteCents === transferredValueCents` (and REALLOCATE always):

- No charge, waiver, refund, credit, or retain cents.
- REALLOCATE must prove `deltaCents === 0` or refuse.

### 5.6 Transferred value and gift vouchers

- `transferredValueCents` is normally the source stay’s settled commercial coverage (typically source `totalValueCents` when the source was fully settled at move time).
- Source `giftVoucherAppliedCents`, redemption ids, and Payments remain **source historical evidence**.
- Replacement **must not** copy source `giftVoucherAppliedCents`.
- A gift voucher on the replacement is allowed **only** as a **new** application toward incremental obligation (`additionalChargeCents` path), never as a copy of source coverage.

### 5.7 Forbidden money representations

- Moving or reassigning `Payment.reservationId`.
- Fake Payment rows for transferred or waived value.
- Copying source `stripePaidAmountCents` onto replacement.
- Using `discountAmount` / `discountAmountCents` / promo for StayChange goodwill.
- Writing canonical rack quote into replacement `totalValueCents`.

---

## 6. Replacement Booking monetary semantics

Replacement Booking fields mean what they mean **today** in checkout:

| Field | StayChange write rule |
|-------|------------------------|
| `totalValueCents` / `totalPrice` | **`contractualTargetTotalCents`** (not canonical rack) |
| `stripePaidAmountCents` | Incremental Stripe cash collected **on the replacement only** |
| `giftVoucherAppliedCents` | Only a **new** voucher applied to replacement obligation |
| `discountAmountCents` | Normal promo semantics only |
| `subtotal*` | Must not be abused to invent a silent waiver; canonical rack lives on StayChange |

**Complimentary upgrade write example (€65 product for €55):**

```text
totalValueCents = 5500
totalPrice = 55
stripePaidAmountCents = 0
giftVoucherAppliedCents = 0
discountAmountCents = 0   # unless a real promo applies independently
```

Canonical 6500 and waived 1000 live on **StayChange**, not as Booking contractual total.

---

## 7. Settled-via-StayChange projection (LOCKED)

### 7.1 Decision

**Do NOT extend `paymentMethod`** to mean StayChange settlement.  
`paymentMethod` continues to describe actual payment instrument / payment provenance (`stripe` | `gift_voucher` | `stripe_plus_gift_voucher`, and future instrument enums if added by payments work).

### 7.2 Booking projection

```text
Booking.settledByStayChangeId → ObjectId ref StayChange | null
```

| Rule | Lock |
|------|------|
| Where valid | Target / replacement Booking (and amend target = same booking when amend settles coverage without new Payment — see Batch 6) |
| Must reference | StayChange whose `targetBookingId` matches this Booking |
| When set | Only for a financially valid **completed** StayChange |
| Not a Payment | Must never fabricate cash provenance |
| Mutability | Set-once / immutable after valid completion except explicit reconciliation repair |

StayChange remains canonical truth for transferred coverage and settlement math.

### 7.3 OPS payment classification (required behavior)

Commercial coverage for “is this booking financially settled?”:

```text
coverageCents =
  transferredValueCents(from completed StayChange referenced by settledByStayChangeId)
  + incrementalStripePaidOnReplacement
  + incrementalNewGiftVoucherAppliedOnReplacement

settled iff coverageCents >= contractualTargetTotalCents
         (zero tolerance)
```

Examples:

| Contractual | Transferred | New Payment | Settled? |
|------------:|------------:|------------:|----------|
| 6000 | 5500 | 500 | YES |
| 5500 | 5500 | 0 | YES |

A replacement **must not** appear `unpaid` merely because transferred value has no Payment row.

`rebooked_or_moved` with a completed valid StayChange + `replacementBookingId` **must suppress** normal cancelled-paid refund-follow-up alerts on the source.

---

## 8. Payment provenance

1. Existing `Payment.reservationId` **never** changes once linked.  
2. Original Payments remain on the **source** Booking permanently.  
3. Transferred value = StayChange ledger coverage, **not** Payment.  
4. Waived value = business concession, **not** Payment.  
5. Additional cash → **new** Payment attached to **replacement**.  
6. New voucher for incremental obligation → real new redemption; source voucher history untouched.

`Payment` remains Stripe (and linked provider) money SoT. StayChange is business transfer/concession SoT.

---

## 9. State machine

### 9.1 Statuses

```text
pending
inventory_secured
awaiting_payment
ready_to_commit
committed
settling
completed
failed
needs_reconciliation
```

| Status | Meaning |
|--------|---------|
| `pending` | Intent recorded; nothing irreversible |
| `inventory_secured` | Target inventory durably claimed; source **not** yet released |
| `awaiting_payment` | Incremental charge required; waiting for successful collection |
| `ready_to_commit` | Preconditions met; safe to commit booking/inventory mutation |
| `committed` | Booking + inventory writes durable |
| `settling` | Post-commit money side-effects (refund/credit) in progress |
| `completed` | Terminal success |
| `failed` | Safe pre-irreversible failure; no split-brain inventory |
| `needs_reconciliation` | Irreversible external side-effect or inconsistency; auto-complete blocked |

### 9.2 Happy paths

**Full complimentary upgrade** (`additionalChargeCents = 0`):

```text
pending → inventory_secured → ready_to_commit → committed → completed
```

(No `awaiting_payment`. No `settling` unless future side-effects require it.)

**Partial / paid upgrade** (`additionalChargeCents > 0`):

```text
pending → inventory_secured → awaiting_payment → ready_to_commit → committed → completed
```

**Downgrade** (negative delta with refund/credit/retain work after commit):

```text
pending → inventory_secured → ready_to_commit → committed → settling → completed
```

**REALLOCATE / zero-delta REBOOK or AMEND:** follow complimentary-like path (no `awaiting_payment`); skip `settling` when no post-commit money work.

### 9.3 Failure classes

- **`failed`:** before irreversible inventory release / before committed dual-write completion that cannot be rolled back cleanly.  
- **`needs_reconciliation`:** e.g. Stripe additional charge succeeded but commit crashed; refund evidence incomplete after commit; exactly-one-operational-stay invariant cannot be proven automatically.

---

## 10. Inventory safety

### 10.1 Ordering (LOCKED)

1. Durably secure **target** inventory.  
2. Only then release **source** inventory (REBOOK) or apply same-booking mutation (REALLOCATE / AMEND).  
3. Never release source before target is secured.

### 10.2 Protections

| Hazard | Required control |
|--------|------------------|
| Race after availability preview | Post-secure / post-commit overlap check (reuse paid-finalize / manual-create optimistic verify patterns) |
| Duplicate operator submit | Durable `idempotencyKey` unique on StayChange |
| Duplicate replacement Booking | Unique constraint / dedupe on completed REBOOK for a given source (+ idempotency) |
| Source released before target secured | State machine forbids; tests must prove |
| Neither stay remaining | Commit is transactional-or-ordered with rollback/repair; terminal failure leaves source operational if target never secured |
| Permanent double operational stay | `completed` REBOOK ⇒ source non-operational (`cancelled` + `rebooked_or_moved`); only nonterminal states may temporarily secure both |
| Crash halfway | Durable status + recovery to `completed` / `failed` / `needs_reconciliation` |

Booking remains inventory SoT for stays; reservation `AvailabilityBlock` rows must be kept consistent with the chosen sync policy in implementation batches (move/tombstone/upsert with Booking — never leave ghost cabin blocks as today’s reassign does).

Reuse checkout finalize lock / durable job / post-save overlap ideas where they fit; **do not** reuse in-memory `rememberResult` as the sole idempotency for money-bearing StayChanges.

---

## 11. REBOOK Booking relationships

### 11.1 Canonical

StayChange holds:

- `sourceBookingId`
- `targetBookingId` (replacement)
- snapshots, money plan, status, actor, reason, idempotency key

### 11.2 Source projection (on completed REBOOK)

```text
cancellationSettlement.outcome = rebooked_or_moved
cancellationSettlement.replacementBookingId = targetBookingId
```

Follow-up / refund-alert suppression requires **completed** valid StayChange + `replacementBookingId` present (aligns with cancellation settlement reserved design; this spec **implements** that reserved outcome for StayChange-driven REBOOK).

### 11.3 Target projection

```text
settledByStayChangeId = StayChange._id
```

Optional thin reverse pointer for ops navigation (non-canonical): e.g. `movedFromBookingId` — allowed only as projection; financial truth stays on StayChange.

### 11.4 Traversal

Both directions required:

- Source → replacement via `replacementBookingId` / StayChange  
- Replacement → source via StayChange `sourceBookingId` (and optional thin pointer)

---

## 12. Reporting / attribution / communications guards

### 12.1 Value layers

| Value | Layer |
|-------|--------|
| Source historical cash / Payments | Source Booking + Payment rows |
| Transferred coverage | StayChange (`transferredValueCents`) — **not** new revenue |
| Replacement contractual value | Replacement `totalValueCents` |
| Canonical target quote | StayChange only — nominal product value |
| Waived goodwill | StayChange `waivedUpgradeCents` — **not** revenue |
| Incremental collected upgrade | Replacement incremental `stripePaidAmountCents` + Payment |
| Refund / credit / retain | StayChange negative-delta fields (+ voucher / refund evidence) |

Transferred value is **not** new revenue. Waived upgrade is **not** revenue. Canonical target is **not** booked revenue.

Occupancy / ADR for the operational stay uses **replacement contractual** totals and nights — not canonical rack.

### 12.2 Must prevent on first REBOOK-capable batch

- Duplicate Meta Purchase  
- Duplicate creator commission  
- Duplicate acquisition / funnel conversion  
- Duplicate booking KPI  
- Duplicate revenue (cash double-count via copied `stripePaidAmountCents`)  
- Misleading cancellation / refund-follow-up metrics for `rebooked_or_moved`

### 12.3 Communications

| Kind | Guest experience |
|------|------------------|
| REBOOK | One coherent **“Your stay has been moved”** — suppress normal cancel + new confirmation pair |
| AMEND | **“Your stay has been updated”** |
| REALLOCATE | Normally **silent** unless guest-facing information materially changes |

Reuse existing suppression mechanisms where safe; do not rely on unused `suppressGuestEmail` alone without wiring. Orchestrator jobs must transfer/reschedule onto the surviving stay identity.

---

## 13. Legacy Reassign

**Status:** UNSAFE and **DEPRECATED**.

**Immediate policy (documentation / ops guidance):** do not use for commercial moves.

**Batch 1:** hard-gate / remove unsafe identity mutation.

Raw reassign must **never** permit:

- different `cabinId`  
- cabin → cabinType  
- cabinType → cabin  
- different `cabinTypeId`  

Same-`cabinTypeId` physical allocation belongs to **REALLOCATE** only.

---

## 14. V1 scope

| In scope | Out of scope |
|----------|----------------|
| Single Booking stays (cabin or cabinType+unit) | **LocationBooking / whole-location buyouts** |
| REALLOCATE / AMEND / REBOOK as defined | Guest self-serve StayChange |
| Manual refund evidence + stay credit patterns | Automated `stripe.refunds.create` unless unlocked by a separate payments epic |
| OPS Move / Modify stay | Partner/Airbnb channel rebooking automation |

StayChange **must reject** LocationBooking-linked / buyout master flows rather than passing them into normal Booking logic.

---

## 15. Global invariants (LOCKED)

1. Cross-product change never rewrites source commercial identity.  
2. `Payment.reservationId` never moves once linked.  
3. Unit-only same-`cabinTypeId` change is not a new sale.  
4. Every completed StayChange has immutable before/after evidence.  
5. Every financial delta has explicit disposition.  
6. Integer cents only; zero tolerance.  
7. Source inventory is not released until target is durably secured.  
8. Durable idempotency on every operation.  
9. Additional payment can never be charged twice for the same StayChange.  
10. Crash after successful additional payment is recoverable (`needs_reconciliation`).  
11. No duplicate Meta / commission / acquisition / KPI / lifecycle cancel+confirm emails.  
12. Historical source Booking remains intact and queryable as originally sold.  
13. Replacement chain traversable both directions.  
14. Completed REBOOK has exactly one operational stay.  
15. Dual secured/operational state only in explicit durable nonterminal workflow states.  
16. `cabinId` XOR `cabinTypeId` always.  
17. `unitId` operational-only; belongs to `cabinTypeId` when set.  
18. REALLOCATE is multi-inventory only.  
19. REALLOCATE delta exactly zero.  
20. Transferred value is neither new Payment nor new revenue.  
21. Waived upgrade value is explicit business concession.  
22. Replacement contractual total excludes waived amount.  
23. `settledByStayChangeId` never fabricates Payment provenance.  
24. Attribution / reporting / email guards ship with first REBOOK-capable implementation.  
25. LocationBooking moves rejected in v1.

---

## 16. Conceptual StayChange shape (documentation only — not implemented yet)

Illustrative fields for implementers; exact Mongoose schema lands in Batch 2.

```text
StayChange {
  kind: reallocate | amend | rebook
  status: pending | inventory_secured | awaiting_payment | ready_to_commit |
          committed | settling | completed | failed | needs_reconciliation

  sourceBookingId: ObjectId
  targetBookingId: ObjectId | null   # same as source for reallocate/amend

  idempotencyKey: string (unique)
  actorId, reason
  createdAt, updatedAt, completedAt

  sourceSnapshot: { commercialProductKey, cabinId, cabinTypeId, unitId,
                    checkIn, checkOut, adults, children,
                    totalValueCents, stripePaidAmountCents, giftVoucherAppliedCents, ... }
  targetSnapshot: { ... parallel fields after change ... }

  money: {
    canonicalTargetQuoteCents,
    transferredValueCents,
    positiveDeltaCents,          # 0 if not applicable
    negativeDeltaCents,          # 0 if not applicable
    additionalChargeCents,
    waivedUpgradeCents,
    contractualTargetTotalCents,
    refundCents, creditCents, retainedCents,
    settlementType,              # complimentary_upgrade | partial_complimentary_upgrade |
                                 # paid_upgrade | refund | stay_credit | retain | split | no_delta | ...
    stripeAdditionalPaymentIntentId | null,
    compensationGiftVoucherId | null,
    cashRefundEvidence | null
  }
}
```

---

## 17. Batch plan

Ordering rationale vs earlier drafts: REALLOCATE first (smallest, kills unsafe reassign); StayChange spine before REBOOK; **reporting/email/payment-classifier guards ship in Batch 3 with first REBOOK**; downgrade before upgrade charge complexity; AMEND after shared money primitives; wizard last; reconciliation last.

---

### Batch 0 — Locked specification

| | |
|--|--|
| **Delivered** | This document. Architecture locked. No runtime change. |
| **Touched** | `docs/stay-change-implementation-plan.md` only |
| **Invariants** | All §15 accepted as requirements |
| **Tests** | None (doc only) |
| **Prod verification** | Spec review / owner sign-off |
| **Still unsupported** | All StayChange runtime behavior |

---

### Batch 1 — Kill unsafe Reassign + production REALLOCATE

| | |
|--|--|
| **Delivered** | Hard-gate legacy reassign so it cannot change commercial product. Ship REALLOCATE: same `cabinTypeId`, change `unitId` only, conflict checks, AvailabilityBlock sync, post-save race check, audit, orchestrator reschedule if needed. `deltaCents === 0` enforced. |
| **Touched (conceptual)** | `reservationWriteService.reassignReservation` (gate/remove unsafe paths); new reallocate write path; `conflictService` unit-aware checks; AvailabilityBlock sync; `OpsReservationDetail` (remove raw cabinId prompt for cross-product); permissions |
| **Invariants proven** | 3, 7 (unit claim), 8, 16–19 |
| **Required tests** | Unit swap A1→A2; reject cabin→cabin; reject cabinType change; block drift absent; double-submit idempotent; external-hold accept path |
| **Prod verification** | Ops: move guest between two Valley units same dates; calendars correct; no price change |
| **Still unsupported** | AMEND money, REBOOK, upgrades/downgrades, wizard |

---

### Batch 2 — StayChange spine

| | |
|--|--|
| **Delivered** | `StayChange` model; status machine transitions; durable idempotency; inventory securing primitives; failed vs needs_reconciliation scaffolding; no full REBOOK money yet. |
| **Touched** | New model + domain service; ops routes skeleton (feature-flagged); mongo txn helpers where available; job/lock patterns aligned with checkout finalize |
| **Invariants proven** | 4, 6, 7, 8, 10 (skeleton), 15 |
| **Required tests** | Illegal transitions rejected; idempotent create; crash mid-pending leaves recoverable state; LocationBooking input rejected |
| **Prod verification** | Flagged; no operator wizard yet |
| **Still unsupported** | Replacement booking creation, settlement classifiers, guest emails |

---

### Batch 3 — REBOOK base + guards + settled-via-StayChange

| | |
|--|--|
| **Delivered** | REBOOK same-price / zero-delta (and structurally ready for later money): create replacement; freeze source; project `rebooked_or_moved` + `replacementBookingId`; set `settledByStayChangeId`; OPS payment classification treats transferred coverage as settled; suppress cancel+confirm emails; send move notice; **guards** for Meta, commission, promo usage, funnel/KPI, cancel/refund alerts; bidirectional traversal. |
| **Touched** | StayChange commit path; Booking projections; `reservationPaymentSignals`; lifecycle email service; messageOrchestrator; `bookingPurchaseTracking`; creator commission eligibility; promo `$inc` skip; dashboard refund follow-up; reporting filters as needed |
| **Invariants proven** | 1, 2, 11–14, 20, 23–24, 25 |
| **Required tests** | Cabin→Valley identity preserved on source; replacement contractual equals transferred when zero delta; OPS not unpaid; no second Meta/commission; no refund-follow-up on source; email single move template |
| **Prod verification** | Controlled ops rebook with equal contractual value; Insights/cash/commission spot-check |
| **Still unsupported** | Downgrade settlement, upgrade charge/waiver UI, AMEND, full wizard |

---

### Batch 4 — Downgrade settlement

| | |
|--|--|
| **Delivered** | Negative-delta outcomes: refund (evidence), stay credit (compensation voucher), retain; `committed → settling → completed`; `needs_reconciliation` on post-commit failure. |
| **Touched** | StayChange money writers; reuse `issueCancellationCompensationVoucher` patterns; cash refund evidence builders; settlement emails as appropriate |
| **Invariants proven** | 5, 6, 10, 20–21 (retain/credit/refund explicit) |
| **Required tests** | Equation exactness; refund before commit forbidden; credit min rules if reused; retain reason required |
| **Prod verification** | One live downgrade retain + one stay-credit path in staging/prod checklist |
| **Still unsupported** | Upgrade waiver/charge |

---

### Batch 5 — Upgrade: complimentary / partial / paid + Stripe crash recovery

| | |
|--|--|
| **Delivered** | Positive-delta equations; `complimentary_upgrade`, `partial_complimentary_upgrade`, `paid_upgrade`; replacement contractual writes; `awaiting_payment` when `additionalChargeCents > 0`; new Payment on replacement; crash → `needs_reconciliation`; no double charge. |
| **Touched** | Checkout/PI create for delta; payment linking to replacement; StayChange money; OPS classifier coverage math |
| **Invariants proven** | 5, 6, 9, 10, 20–23 |
| **Required tests** | €55→€65 free; €55→€75 with €5 charge + €15 waive; PI success + kill before commit; replay does not double-charge |
| **Prod verification** | Staging Stripe test mode full matrix |
| **Still unsupported** | AMEND, unified wizard |

---

### Batch 6 — AMEND

| | |
|--|--|
| **Delivered** | Same-product changes to dates / guests / extras / quote-affecting terms; replace weak edit-dates as the money-safe path; explicit settlement when quote changes; immutable evidence. |
| **Touched** | `editReservationDates` policy (delegate or hard-gate money-affecting edits through StayChange); StayChange `kind=amend`; conflict/unit paths |
| **Invariants proven** | 4, 5, 6, 16–17 |
| **Required tests** | Night change forces quote; silent price keep forbidden; per_person guest change; self-block exclusion; race check |
| **Prod verification** | Ops amend dates with and without price change |
| **Still unsupported** | Unified wizard polish |

---

### Batch 7 — Unified OPS Move / Modify stay wizard

| | |
|--|--|
| **Delivered** | Single UI action; automatic mode routing; preview (conflicts, canonical vs contractual, delta disposition, email plan, attribution impact); confirm commit. |
| **Touched** | `OpsReservationDetail` / new wizard components; `opsApi`; permissions `ops.reservation.stay_change` (name TBD in batch) |
| **Invariants proven** | Operator cannot select illegal REALLOCATE/REBOOK mix-ups via UI |
| **Required tests** | Classifier unit tests; permission tests; preview/commit contract tests |
| **Prod verification** | Operator walkthrough all three kinds |
| **Still unsupported** | Deep reconciliation dashboards |

---

### Batch 8 — Reconciliation, parity, observability, hardening

| | |
|--|--|
| **Delivered** | Ops views for `needs_reconciliation`; StayChange parity reports (coverage vs Payments vs contractual); metrics; runbooks; LocationBooking rejection monitoring; integrity jobs for AvailabilityBlock vs Booking after StayChange. |
| **Touched** | Dashboard/read models; scripts; alerts; docs/runbooks |
| **Invariants proven** | 10, 14, 15 under failure injection |
| **Required tests** | Reconciliation fixtures; alert suppression regression |
| **Prod verification** | Chaos/drill: kill mid-awaiting_payment and mid-settling |
| **Still unsupported** | LocationBooking StayChange (explicit future epic) |

---

## 18. Non-goals (v1)

- Guest self-serve move/amend.  
- Automated Stripe refund API (unless separate epic).  
- Using promo/`discountAmount*` for OPS concessions.  
- Extending `paymentMethod` for StayChange settlement.  
- In-place rewrite of source `cabinId` / `cabinTypeId` on REBOOK.  
- LocationBooking / buyout StayChange.  
- Keeping raw cabinId `window.prompt` reassign as a supported commercial tool.

---

## 19. Open implementation details (non-blocking for architecture)

These do not reopen §1–15 locks; they are decided inside the named batches:

- Exact Mongoose indexes and unique keys for StayChange.  
- Whether optional `movedFromBookingId` thin pointer is added on replacement.  
- Exact guest email template copy and provider (SMTP / existing lifecycle pipeline).  
- Permission string naming.  
- Feature flag names and rollout order per propertyKind.

---

## 20. Document history

| Date | Change |
|------|--------|
| 2026-08-20 | Batch 0 lock: StayChange aggregate; commercial identity; mode routing; complimentary/partial upgrade equations; replacement contractual semantics; `settledByStayChangeId`; state machine; invariants; batches 1–8. |

---

**END OF LOCKED ARCHITECTURE — PENDING IMPLEMENTATION**
