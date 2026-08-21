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

### 10.3 UnitNightClaim — exclusive guest unit ownership (LOCKED)

Mongo transactions alone do **not** prevent write-skew when two writers update different `Booking` documents to the same `unitId`. Deterministic single-winner exclusivity requires a **shared contention document** per occupied unit-night.

#### Model (conceptual)

```text
UnitNightClaim {
  unitId: ObjectId → Unit          // required
  night: Date                      // Sofia civil day-start for one occupied night
  bookingId: ObjectId → Booking    // required — current exclusive owner
  stayChangeId: ObjectId | null    // optional — StayChange that caused the claim
  source: string                   // e.g. finalize | date_edit | reallocate | bootstrap | …
  createdAt: Date
}
```

**No `active` / `released` status.** A row means **current** exclusive ownership only.

**Delete-on-release (LOCKED):** `releaseUnitNights` **deletes** rows owned by the supplied `bookingId`. Historical ownership lives on Booking / StayChange / AuditEvent / ManualReviewItem — not retained claim rows.

**Authoritative unique key (I6 cutover only):**

```text
unique index { unitId: 1, night: 1 }
```

Must **not** be enforced in application startup before bootstrap/conflict cleanup (I1–I5).

**Night semantics (LOCKED):** Sofia civil occupied nights for stay `[checkIn, checkOut)` exclusive end. Checkout day is never claimed. Reuse `formatSofiaDateOnly` / `normalizeExclusiveDateRange` / `computeStayNights` (or equivalents) — no duplicate timezone logic.

Examples:

| checkIn | checkOut | Claim nights |
|---------|----------|--------------|
| Aug 20 | Aug 21 | Aug 20 |
| Aug 20 | Aug 23 | Aug 20, Aug 21, Aug 22 |

#### Canonical claim service (LOCKED)

Permanent domain service (repo naming may vary; semantics fixed):

| Operation | Semantics |
|-----------|-----------|
| `claimUnitNights` | Expand Sofia nights; same-booking ownership idempotent; fill missing same-booking nights; **foreign owner → structured conflict, no silent partial success**; optional Mongo session |
| `releaseUnitNights` | Delete **only** claims owned by `bookingId` (optional unit/night scope); idempotent if absent |
| `transferUnitNightClaims` | Secure **target** nights before releasing **source**; no source release if target incomplete; session-safe; idempotent retry |
| `assertBookingOwnsNights` | Prove ownership of required set; structured diagnostics for reconciliation |

Every production unit-allocation writer must ultimately use this service (paid finalize, legacy create, LocationBooking **child** Bookings with `unitId`, multi-unit recovery, date-edit night expand/shrink, cancel/complete/delete release, REALLOCATE).

#### External holds (LOCKED)

- Airbnb/iCal holds remain `AvailabilityBlock` (`external_hold`).  
- **Never** convert external holds into `UnitNightClaim`.  
- UnitNightClaim = exclusive **internal guest Booking** ownership.  
- It does **not** mean “no external channel conflict.”  
- Later REALLOCATE: external hold overlap **blocks** by default; admin may explicitly accept risk without removing/mutating the hold.

#### Rollout invariant (LOCKED)

There must **never** be a production window where REALLOCATE trusts UnitNightClaim while another production allocation writer ignores it.

Shadow/dual-write (I1–I5): claims are infrastructure only; existing Booking/Availability conflict logic remains active; REALLOCATE **disabled**.

Authoritative (after I6): unique index exists; all writers use claim service; conflicts reconciled; then REALLOCATE may enable.

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
25. LocationBooking **StayChange / buyout move** rejected in v1.  
26. UnitNightClaim is the sole exclusivity primitive for physical unit nights among guest Bookings (including LocationBooking **child** Bookings with `unitId`).  
27. UnitNightClaim uses **delete-on-release**; no permanent `released` claim rows.  
28. External holds stay on AvailabilityBlock; never converted to UnitNightClaim.  
29. REALLOCATE must remain disabled until UnitNightClaim is globally authoritative across all production unit writers (after Inventory Integrity I6).  
30. Never a production window where REALLOCATE trusts claims while another allocation writer ignores them.

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

**Revised order (OPTION B — LOCKED):** Inventory Integrity is a **prerequisite** before REALLOCATE. REALLOCATE remains disabled until UnitNightClaim is globally authoritative.

Ordering rationale: exclusive unit-night claims before any REALLOCATE; then StayChange REBOOK/AMEND money and wizard as before.

---

### Batch 0 — Locked specification

| | |
|--|--|
| **Delivered** | This document. Architecture locked. No runtime change. |
| **Touched** | `docs/stay-change-implementation-plan.md` only |
| **Invariants** | All §15 (+ inventory amendments) accepted as requirements |
| **Tests** | None (doc only) |
| **Prod verification** | Spec review / owner sign-off |
| **Still unsupported** | All StayChange / UnitNightClaim runtime behavior |

---

### Batch I — Inventory Integrity (prerequisite)

#### I1 — Model, service, integrity dry-run

| | |
|--|--|
| **Delivered** | `UnitNightClaim` model (no authoritative unique index yet); permanent claim service; read-only bootstrap/conflict projection tooling |
| **Touched** | New model + claim service + CLI/tooling + tests |
| **Must not** | Change finalize, date-edit, cancel/complete, AvailabilityBlock, OPS UI, or enable REALLOCATE |
| **Invariants** | 26–28 (foundation); delete-on-release; Sofia nights |

#### I2 — Dual-write allocation writers

| | |
|--|--|
| **Delivered** | Dual-write via claim service on: paid finalize, legacy booking create, LocationBooking **child** creation with `unitId`, multi-unit recovery/finalization paths |
| **Still** | Existing Booking/Availability conflict logic active; claims **not** yet sole authority; REALLOCATE disabled |

##### I2 shadow semantics (LOCKED)

UnitNightClaim remains **shadow infrastructure** in I2. Existing Booking / Availability conflict logic remains **canonical**. Therefore:

1. **Booking-first ordering.** Shadow claims run only **after** the canonical Booking allocation is durably known to survive its existing write/finalization logic (including post-save overlap / promo / unpaid-delete paths). Do **not** claim a Booking the flow is about to delete.
2. **Shadow failure never gates canonical success.** A UnitNightClaim failure MUST NOT cause an otherwise valid canonical Booking allocation to be rolled back, deleted, refunded, or reported as failed solely because shadow infrastructure failed. This applies to V2 paid finalize, legacy create, LocationBooking child Bookings, and paid orphan recovery/adoption.
3. **Paid Booking** on shadow claim failure: preserve Booking; no automatic refund; durable ManualReviewItem; PaymentResolutionIssue where `paymentIntentId` context exists; retry idempotently (finalize replay / reconcile / recovery adopt).
4. **Unpaid Booking** that has already survived canonical allocation logic: also **preserve** solely on shadow-claim failure. Shadow infrastructure must not become authoritative early.
5. **Exact I2 claim `source` values:** `finalize` | `legacy_create` | `location_child` | `multi_unit_recovery`. Later sources (`date_edit`, `reallocate`, `bootstrap`, …) remain as already defined on the model; they are not I2 writers.
6. **Orphan recovery** must **not** independently double-write claims when its create path already runs through canonical finalize (`executeBookingFinalizeWork`). Create-path claims happen once there (with `source=multi_unit_recovery` when recovery context supplies it). Adopt path may call the shared shadow helper idempotently for missing claims.
7. **Replay / adoption** paths must ensure missing shadow claims are repaired idempotently (crash case: Booking saved, process died before claim → replay fills claims).
8. **LocationBooking (LOCKED CORRECTION).** Do **not** put shadow UnitNightClaim writes inside a Mongo transaction in a way where claim failure aborts canonical LocationBooking / child Booking creation. Canonical location finalization must commit/survive **first**. After canonical success: shadow-claim each surviving unit child (`cabinTypeId` + `unitId`); claim failure is nonfatal to the location Booking; create durable reconciliation evidence; retries/replay may fill missing claims. Single-cabin children create no claims. If existing non-transaction rollback occurs **before** canonical success, there should be **no** shadow claims yet and therefore nothing to release. Only release I2 claims in location cleanup if actual implementation ordering made claims exist before a later canonical rollback — which must be avoided.
9. **I2 introduces NO unique authoritative `{ unitId, night }` index.** Authoritative exclusivity remains I6 after conflict cleanup.

#### I3 — Date-edit integration

| | |
|--|--|
| **Delivered** | OPS Edit Dates hardened for multi-unit inventory integrity; Booking-first shadow UnitNightClaim synchronization to the canonical NEW occupied night range (`source=date_edit`); REALLOCATE still disabled; claims still non-authoritative |

##### I3 date-edit integrity semantics (LOCKED)

UnitNightClaim remains **shadow infrastructure** in I3. Canonical Booking / AvailabilityBlock conflict logic remains **canonical**. Therefore:

1. **Allocated multi-unit conflict validation.** Edit Dates for `cabinTypeId` + `unitId` MUST use unit-aware conflict evaluation for the full requested `[checkIn, checkOut)` with self-exclusion (`excludeReservationId = Booking._id`), parent cabin where required, and `treatExternalHoldAsHard = false`. Hard conflict → HTTP 409; zero canonical mutation; zero shadow mutation.
2. **Booking-first ordering.** Canonical Booking date change + active reservation AvailabilityBlock date sync succeed **before** shadow UnitNightClaim synchronization.
3. **Shadow / non-authoritative.** UnitNightClaim is not authoritative in I3. No unique `{ unitId, night }` index. REALLOCATE remains disabled. I4+ untouched.
4. **Shadow synchronization (`syncUnitNightClaimsShadow`, `source=date_edit`).** Fill required NEW Sofia occupied nights first (`claimUnitNights`); then release booking-owned surplus nights outside the NEW range (`releaseUnitNights`). Foreign/write failure is **nonfatal** to canonical date success; never steal foreign claims; create deduped `unit_night_claim_shadow_failure` ManualReviewItem. No PaymentResolutionIssue for normal OPS Edit Dates (no paid-finalize context).
5. **Surplus release despite fill failure.** Booking-owned claims outside the canonical NEW Booking range are released even when required NEW shadow claims cannot all be obtained (canonical occupancy is SoT).
6. **External holds.** Retain current Edit Dates soft-warning behavior; no new explicit-accept UI in I3.
7. **Idempotency fingerprint.** Effective identity includes `bookingId` + normalized requested `checkIn` + normalized requested `checkOut` + actor + action + optional client idempotency key. Different requested dates must never collide merely because they occur within the 10-minute in-memory cache TTL.
8. **Same requested mutation** remains idempotent.
9. **Same-date / remembered replay repair.** Must still converge active reservation AvailabilityBlock dates to Booking and repair UnitNightClaim shadow state for allocated blocking multi-unit Bookings.
10. **Same-date repair/no-op side effects.** Repair/no-op MUST NOT re-fire `reservation_edit_dates` audit, GMA date-change reschedule, or Ops dates-changed push. It is not a new date mutation.
11. **Status policy.** Allow Edit Dates for `pending`, `confirmed`, and `in_house`. Reject `completed` and `cancelled` with `invalid_transition` HTTP 409. Non-blocking Bookings do not acquire claims via date-edit; stale claims on completed/cancelled are I4/I5 (no cleanup in I3).
12. **IN_HOUSE HISTORY LOCK.** Once `Booking.status == in_house`, `checkIn` is immutable through Edit Dates. A request that changes `checkIn` is rejected. Changing `checkOut` remains supported when conflict/date validation passes. Reason: one Booking checkIn/unit allocation represents historical occupancy and must not be rewritten after the stay has begun.
13. **Unallocated multi-inventory.** `cabinTypeId` set and `unitId` null → Edit Dates rejected with a stable domain error. Do **not** use `evaluateCabinConflicts` with `cabinId=null`.
14. **Canonical Booking + reservation-block writes.** Use repo-native Mongo transaction support when available (`canUseMongoTransactions`). Otherwise: Booking write → reservation AvailabilityBlock update → on block-update failure, compensate Booking back to prior dates → return failure, **never** false success. Zero matching reservation blocks remains valid Booking-only success.
15. **Compensation failure.** If restoration itself fails: return hard failure; create durable ManualReviewItem (category `reservation_date_edit_canonical_inconsistency`) with Booking id, old/new dates, failure stage, technical error; no unnecessary guest PII; never silently return success.
16. **Single-cabin Edit Dates** retain correct `evaluateCabinConflicts` behavior; create no UnitNightClaims.

#### I4 — Inventory release

| | |
|--|--|
| **Delivered** | Cancel / complete / delete/rollback paths shadow-release UnitNightClaims via delete-on-release (`releaseUnitNights` by `bookingId`); claims remain non-authoritative; REALLOCATE still disabled |

##### I4 unit claim release semantics (LOCKED)

UnitNightClaim remains **shadow infrastructure** in I4. Canonical Booking / AvailabilityBlock lifecycle remains **canonical**. Therefore:

1. **Blocking statuses.** Reuse canonical `BLOCKING_BOOKING_STATUSES` = `pending` | `confirmed` | `in_house`. Non-blocking: `completed` | `cancelled`. Do **not** duplicate status lists across I2/I3/I4 helpers.
2. **Terminal ownership invariant.** Once a Booking is durably `cancelled` or `completed`, it owns **ZERO** active UnitNightClaims. Terminal release deletes **ALL** `UnitNightClaim` rows matching `bookingId` (no unit filter, no date filter) so stale historical shadow rows are removed with current-range rows.
3. **No shape fast-skip.** Do **not** skip terminal/delete release merely because the current Booking lacks `unitId` / `cabinTypeId` or is single-inventory. Release-by-`bookingId` always runs; ownership filter is the safety boundary (stale claims may predate current shape).
4. **Delete-on-release.** `releaseUnitNights` deletes owned rows. No permanent `released` claim status rows.
5. **Shadow / nonfatal.** Release failure never rolls back a valid cancellation/completion; never blocks a canonical delete already decided; never refunds or mutates payment/settlement solely for claim cleanup; MRI/reconciliation only.
6. **Cancel / complete ordering.** After terminal Booking status is durably persisted and the existing reservation AvailabilityBlock tombstone operation has been **attempted**, run UnitNightClaim release. Do **not** make claim release conditional on tombstone success if Booking is already durably terminal. Preserve existing canonical error/reconciliation semantics for block maintenance failures; claim release still converges toward the durable non-blocking status.
7. **Helper.** `ensureUnitNightClaimsReleasedShadow({ booking?, bookingId, lifecycleSource })`: `bookingId` required; calls `releaseUnitNights({ bookingId })` with no narrower filter for terminal/delete; idempotent; structured result; never foreign deletion; shadow failure → MRI; never throws shadow-only failure into canonical success/delete; no auto-close MRI in I4.
8. **MRI.** Reuse category `unit_night_claim_shadow_failure`. Evidence: `operation=release`, `lifecycleSource`, `bookingId`, technical error/errorCode. No unnecessary guest PII. No PRI for ordinary OPS cancel/complete.
9. **Stable `lifecycleSource` strings (helper/observability only):** `cancel` | `complete` | `booking_delete` | `location_rollback` | `finalize_cleanup` | `maintenance_delete`. `repair` reserved for I5. Not persisted as `UnitNightClaim.source` (release deletes rows).
10. **Paid-retain exception.** If a paid-overlap / needs-review Booking is retained in a blocking status, **do not** release its claims. Finalize error ≠ inventory release.
11. **Remembered cancel/complete replay.** Must still attempt terminal claim release before returning remembered success (crash after terminal write, before release). Already-terminal HTTP 409 is unchanged in I4; I5 repair tooling handles stale claims on historical terminal rows.
12. **Delete/rollback.** Canonical delete decision → attempt release ALL claims by `bookingId` → delete Booking per existing flow. Release failure → MRI; delete still proceeds; I5 may later remove orphan claims by `bookingId`.
13. **AvailabilityBlock.** UnitNightClaim does **not** replace reservation AvailabilityBlocks. External holds untouched. No ICS/Airbnb mutation from claim release.
14. **No unique `{ unitId, night }` index.** REALLOCATE remains disabled. I5/I6 untouched.

#### I5 — Bootstrap + conflict reconciliation

| | |
|--|--|
| **Delivered** | Shared canonical expected-claim projection; permanent reconciliation CLI/service (dry-run default, `--apply-safe` only for deterministic repairs); conflict report + durable MRI for hard collisions; **never** silently choose a winner; claims remain shadow; no unique index; REALLOCATE still disabled |

##### I5 unit claim reconciliation semantics (LOCKED)

UnitNightClaim remains **shadow / non-authoritative** in I5. No unique `{ unitId, night }` index. No authoritative cutover. REALLOCATE disabled. I6 performs its own final precheck under a controlled low-write window before `createIndex`.

1. **Canonical expected-claim invariant.** A `UnitNightClaim` SHOULD exist iff canonical Booking: production/non-fixture/non-archived per scan rules; `status ∈ BLOCKING_BOOKING_STATUSES` (`pending`|`confirmed`|`in_house`); has `cabinTypeId` and `unitId`; referenced Unit exists; `Unit.cabinTypeId` matches `Booking.cabinTypeId`; inventory shape otherwise valid; dates expand successfully; night ∈ Sofia occupied nights of `[checkIn, checkOut)` (checkout excluded). Expected set covers **ALL** occupied nights — **no** artificial historical/future horizon. Past checkout while still blocking still expects claims until canonical Booking is repaired. Location children and paid-retained blocking Bookings participate normally.

2. **Invalid Bookings do not generate expected claims.** Do **not** expand expected nights for unit/cabinType mismatch, missing Unit, cabinId+cabinTypeId malformed shape, invalid/zero/negative dates, or other non-deterministic allocation. Correct I1 fallthrough where mismatch still expanded expected nights.

3. **Taxonomy (minimum):** `MISSING_CLAIM` | `STALE_TERMINAL_CLAIM` | `ORPHAN_CLAIM` | `WRONG_UNIT_CLAIM` | `OUTSIDE_DATE_RANGE_CLAIM` | `INVALID_ALLOCATION` | `CANONICAL_UNIT_NIGHT_CONFLICT` | `FOREIGN_CLAIM_CONFLICT` | `DUPLICATE_SAME_OWNER_CLAIM` | `DUPLICATE_FOREIGN_OWNER_CLAIM` | `UNALLOCATED_BLOCKING_BOOKING` | `MALFORMED_BOOKING` | `CLAIM_FOR_SINGLE_INVENTORY` | `CLAIM_FOR_EXCLUDED_BOOKING` (test/fixture/archived claims).

4. **No silent winners.** Never auto-choose between two canonical Bookings for the same unit-night by createdAt, payment, amount, claim presence/source, status priority, latest edit, oldest Booking, guest identity, DB ordering, or similar. Canonical conflict = HUMAN. Contested keys enter a **deny-write** set. `--apply-safe` must not create/delete ownership on contested keys in a way that selects a winner.

5. **SAFE_AUTOMATIC:** uncontested `MISSING_CLAIM`; `STALE_TERMINAL_CLAIM`; `ORPHAN_CLAIM` (Booking truly absent — archived exists ≠ orphan); `OUTSIDE_DATE_RANGE_CLAIM`; `WRONG_UNIT_CLAIM` when allocation valid; `DUPLICATE_SAME_OWNER_CLAIM` (keep earliest `createdAt` then `_id`); `CLAIM_FOR_SINGLE_INVENTORY`. **HUMAN/TARGETED:** collisions, foreign live owners, duplicate foreign owners, invalid allocation, unallocated blocking, malformed. **`CLAIM_FOR_EXCLUDED_BOOKING`:** report; do **not** blindly auto-delete in ordinary `--apply-safe`; **MUST be zero before I6** unless I6 implements safe exclusion — fixture/test/archive claims must never become authoritative against real inventory.

6. **Dry-run / `--verify` = zero Mongo writes.** No UnitNightClaim, Booking, MRI, AuditEvent, repair markers, or hidden timestamps. Reports may write only to requested filesystem path. Conflict MRI only in mutating mode (`--apply-safe`).

7. **Partial/targeted never declare readiness.** `--booking-id` / `--limit` → `scanCompleteness=partial|targeted`; never `readyForI6=true`. Only `scanCompleteness=full` can contribute. Reject `--apply-safe` + `--limit`. Targeted `--booking-id --apply-safe` may repair only that target's deterministic drift; global readiness stays false/UNKNOWN.

8. **CLI exit:** `0` = full scan + `READY_FOR_I6=true`; `2` = successful scan with blockers/drift or non-ready; `1` = tool/execution failure. Partial/targeted successful diagnostics use non-ready exit (never global ready).

9. **Tooling:** `unitNightClaimReconciliationService` + `unitNightClaimReconcile.js`; I1 dry-run shares projection (no second occupancy algorithm).

10. **Scale:** cursor/batch; bounded per-unit accumulation where practical; do not load every full Booking document; report if safety bound exceeded.

11. **Apply-safe order:** build valid expected → collisions → deny-write → scan claims → classify → plan; then re-evaluate → release safe drift → same-owner dedupe → `claimUnitNights` (`source=bootstrap`) for uncontested missing → never contested keys → continue on failure → rescan → report. Idempotent.

12. **Orphan / terminal:** orphan = `Booking.findById` null; terminal reuse `releaseUnitNights({ bookingId })` (or release helper for MRI-on-failure); never `transitionReservation`; no lifecycle communication.

13. **MRI shadow-failure dedupe (I4 gap fix):** keep category `unit_night_claim_shadow_failure`; append operation to **existing** stable `sourceReference` (`:claim` / `:sync` / `:release`); fallback to `bookingId` only when no stronger reference. No migration. Same operation retries dedupe; different operations do not overwrite.

14. **Canonical conflict MRI:** mutating mode only; schema-compatible entity type; stable dedupe on unitId+night+sorted bookingIds in provenance/evidence; no guest PII; one open item per contested unit-night across runs.

15. **`READY_FOR_I6`:** only full scan with zeros for: canonical collisions, foreign conflicts, foreign-owner duplicate rows, any duplicate `{unitId,night}` rows, missing, stale terminal, orphan, wrong-unit, outside-range, single-inventory claims, excluded-booking claims, unresolved invalid/malformed affecting inventory, failed safe repairs; claims still shadow; no unique index yet; **and** stable verification (two consecutive full read-only verifies, zero blockers, matching fingerprint excluding volatile passId/detectedAt). `UNALLOCATED_BLOCKING_BOOKING` is **not** a unique-index blocker (report as OPS/HUMAN warning). I6 must preserve pooled-capacity semantics independently.

16. **Stable verification vs I6:** I5 provisional stable ≠ permission to create unique index. I6 must re-precheck immediately before `createIndex` under controlled low-write window.

17. **Unique-index precheck:** read-only aggregation `n>1` on `{unitId,night}`; no create/drop/mutate indexes.

18. **Deploy:** implement/push I5 first; deploy **I1–I5 together**. Deploy alone does not mutate. No reconciliation writes on deploy.

19. **I5 does not:** create unique index; make claims authoritative; reject Bookings on claims; transfer claims; enable REALLOCATE; change pricing/payments/StayChange SM.

#### I6 — Authoritative cutover

| | |
|--|--|
| **Delivered** | Create unique `{ unitId, night }` index; authoritative enforcement; cutover verification that **every** production unit writer uses the claim service |
| **Gate** | Conflicts resolved; dual-write complete; then and only then claims are authoritative |

---

### Batch R — REALLOCATE (after I6)

| | |
|--|--|
| **Delivered** | Minimal StayChange(`kind=reallocate`); `transferUnitNightClaims`; OPS same-cabinType unit selector; pre-stay movable policy; same-unit HTTP 200 no-op; hard-disable legacy commercial reassign; AvailabilityBlock `unitId` sync; credential-diff GMA reschedule only |
| **Invariants proven** | 3, 7, 8, 16–19, 26–30 |
| **Still unsupported** | AMEND money, REBOOK, upgrades/downgrades, wizard |

---

### Batch 2 — StayChange spine (amend/rebook-ready)

| | |
|--|--|
| **Delivered** | Full StayChange state machine transitions beyond reallocate; durable idempotency for money-bearing kinds; `inventory_secured` / `needs_reconciliation` scaffolding shared with REBOOK |
| **Touched** | StayChange model expansion; domain service; ops routes skeleton (feature-flagged) |
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
| **Delivered** | Ops views for `needs_reconciliation`; StayChange parity reports (coverage vs Payments vs contractual); UnitNightClaim parity; metrics; runbooks; LocationBooking StayChange rejection monitoring; integrity jobs for AvailabilityBlock vs Booking after StayChange. |
| **Touched** | Dashboard/read models; scripts; alerts; docs/runbooks |
| **Invariants proven** | 10, 14, 15, 26–30 under failure injection |
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
- LocationBooking / buyout **StayChange** (child Bookings with `unitId` still participate in UnitNightClaim).  
- Keeping raw cabinId `window.prompt` reassign as a supported commercial tool.  
- Enabling REALLOCATE before Inventory Integrity I6 authoritative cutover.

---

## 19. Open implementation details (non-blocking for architecture)

These do not reopen §1–15 locks; they are decided inside the named batches:

- Exact Mongoose indexes and unique keys for StayChange.  
- Whether optional `movedFromBookingId` thin pointer is added on replacement.  
- Exact guest email template copy and provider (SMTP / existing lifecycle pipeline).  
- Permission string naming.  
- Feature flag names and rollout order per propertyKind.  
- UnitNightClaim I6 unique-index migration tooling shape (must not auto-enforce before I5 complete).

---

## 20. Document history

| Date | Change |
|------|--------|
| 2026-08-20 | Batch 0 lock: StayChange aggregate; commercial identity; mode routing; complimentary/partial upgrade equations; replacement contractual semantics; `settledByStayChangeId`; state machine; invariants; batches 1–8. |
| 2026-08-20 | Amendment: UnitNightClaim exclusivity primitive; delete-on-release; Inventory Integrity Batch I (I1–I6) before REALLOCATE Batch R; Location child Bookings must claim; external holds remain AvailabilityBlock; rollout invariant (no REALLOCATE until claims authoritative). |
| 2026-08-20 | Amendment: I2 shadow dual-write semantics — Booking-first ordering; shadow claim failure never gates canonical Booking success (paid or unpaid after survival); MRI/PRI durable signals; exact claim sources; no location claim-inside-txn abort; no unique index in I2; orphan recovery no double-write; replay/adopt repair missing claims. |
| 2026-08-20 | Amendment: I3 date-edit integrity — unit-aware allocated multi-unit conflicts; Booking-first shadow sync (`source=date_edit`); fill-before-release with surplus release despite fill failure; fingerprint idempotency; same-date repair without audit/GMA/push; status + in_house checkIn immutability; unallocated reject; txn/compensate Booking+blocks; MRI on compensation failure; no unique index; REALLOCATE still disabled. |
| 2026-08-21 | Amendment: I4 unit claim release — terminal cancel/complete + delete/rollback shadow-release by bookingId (all owned rows); no shape fast-skip; nonfatal MRI (`operation=release`); paid-retain keeps claims; remembered cancel/complete repairs; lifecycleSource strings; no unique index; REALLOCATE still disabled; I5 repair reserved. |
| 2026-08-21 | Amendment: I5 reconciliation — shared expected-claim invariant (full history, no horizon); invalid allocations never expand expected nights; taxonomy + SAFE/HUMAN; no silent winners / deny-write; dry-run zero Mongo writes; partial/targeted never ready; CLI exit 0/2/1; apply-safe order; MRI operation-suffixed sourceReference; conflict MRI mutating-only; READY_FOR_I6 + stable dual verify; excluded claims block I6; deploy I1–I5 together; no unique index / REALLOCATE. |

---

**END OF LOCKED ARCHITECTURE — PENDING IMPLEMENTATION**
