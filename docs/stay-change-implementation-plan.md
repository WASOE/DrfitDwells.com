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

**R1 runtime lock:** full minimal workflow, eligibility, staged claim/Booking ordering, durable StayChange, and API contract are locked in **§21 (Batch R1)**. R1 is domain/API only (no Move UI). Do **not** wire the combined `transferUnitNightClaims` primitive as the sole R1 workflow.

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
- **R1 REALLOCATE:** external hold overlap **blocks** by default; OPS must pass explicit `acceptExternalHoldWarnings: true` (same acknowledgment pattern as legacy cabin reassign / manual-create). Acknowledgment must **not** remove or mutate the external hold.

#### Rollout invariant (LOCKED)

There must **never** be a production window where REALLOCATE trusts UnitNightClaim while another production allocation writer ignores it.

Shadow/dual-write (I1–I5): claims are infrastructure only; existing Booking/Availability conflict logic remains active; REALLOCATE **disabled**.

Authoritative (after I6): unique index exists; all writers use claim service; conflicts reconciled; then REALLOCATE may enable.

---

## 11. REBOOK Booking relationships

### 11.1 Canonical

For **every** StayChange kind, `bookingId` is the canonical **source** Booking identifier.

StayChange holds:

- `bookingId` — source Booking (same Booking for REALLOCATE/AMEND; source only for REBOOK)
- `targetBookingId` — replacement Booking for REBOOK only; `null` for REALLOCATE/AMEND
- snapshots, money plan, status, actor, reason, idempotency key

**Do NOT persist `sourceBookingId`.** A second source identifier must not diverge from `bookingId`. Full REBOOK lock: **§23**.

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

- Source → replacement via `cancellationSettlement.replacementBookingId` and/or StayChange where `bookingId = source`
- Replacement → source via StayChange where `targetBookingId = replacement._id` (and optional thin pointer — see §23.28)

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
| REBOOK | Suppress normal cancel + new confirmation pair in first mutation batch (§23.26). One coherent **“Your stay has been moved”** guest notice is **later scope** (no template exists today). |
| AMEND | **“Your stay has been updated”** |
| REALLOCATE | Normally **silent** unless guest-facing information materially changes |

Reuse existing suppression mechanisms where safe; do not rely on unused `suppressGuestEmail` alone without wiring. Orchestrator jobs must transfer/reschedule onto the surviving stay identity.

---

## 13. Legacy Reassign

**Status:** UNSAFE for commercial moves; **I6 hard-blocks multi-inventory**.

**Runtime (I6+):**

- `POST /api/ops/reservations/:id/actions/reassign` — **single-cabin `cabinId`-only** reassignment remains.
- Multi-unit / `cabinTypeId` / allocated `unitId` / malformed mixed identity → hard reject (`LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY`).
- **Never** silently route legacy reassign into StayChange REALLOCATE.

**R1:** physical same-`cabinTypeId` unit moves use a **separate** route:

```text
POST /api/ops/reservations/:id/actions/reallocate
```

Same-`cabinTypeId` physical allocation belongs to **REALLOCATE** only (see §21).

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
29. REALLOCATE remained disabled until UnitNightClaim was globally authoritative (I6). **R1** (§21) is the first allowed REALLOCATE runtime after I6.
30. Never a production window where REALLOCATE trusts claims while another allocation writer ignores them.

---

## 16. Conceptual StayChange shape (documentation — R1 introduces minimal reallocate model)

Illustrative fields for implementers. **R1** introduces the minimal StayChange model sufficient for `kind=reallocate` (§21.6). Full money/amend/rebook expansion remains later batches.

```text
StayChange {
  kind: reallocate | amend | rebook
  status: pending | inventory_secured | awaiting_payment | ready_to_commit |
          committed | settling | completed | failed | needs_reconciliation

  bookingId: ObjectId              # canonical SOURCE Booking (all kinds)
  targetBookingId: ObjectId | null # REBOOK replacement only; null for reallocate/amend

  idempotencyKey: string (unique scoped with kind + bookingId — §21.7, §23.29)
  payloadFingerprint: string
  actorId, reason
  createdAt, updatedAt, completedAt

  # R1 identity / inventory evidence (required for reallocate)
  sourceCommercialProductKey, targetCommercialProductKey
  sourceCabinTypeId, targetCabinTypeId
  sourceUnitId, targetUnitId
  checkIn, checkOut
  externalHoldWarningsAccepted?

  sourceSnapshot / targetSnapshot: { ... }  # expand for amend/rebook
  money: { ... }                            # not required for R1 reallocate
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
| **Delivered** | Named unique `{ unitId, night }` index via explicit cutover CLI; UnitNightClaim becomes authoritative exclusive physical-unit ownership; all allocated multi-unit writers acquire/release claims authoritatively; pooled cabinType capacity bug fixed; legacy multi-unit reassign hard-blocked; REALLOCATE still disabled |
| **Gate** | I5 `readyForI6=true` + clean duplicate aggregation + controlled stop-the-world window; then create unique index **before** starting authoritative writers |

##### I6 authoritative unit claim cutover semantics (LOCKED)

**Production facts (locked for cutover design):** MongoDB 7.0.28 standalone (no multi-document transactions). Collection `unitnightclaims` has non-unique `unitId_1_night_1` and **no** authoritative unique yet. Mongo 7 permits coexistence of non-unique and unique indexes with the same keys when names differ. I6 **must not** drop `unitId_1_night_1` during normal cutover. Transactions may exist for supporting environments but **must not** be required for correctness; standalone compensation is the primary production path.

1. **Permanent authoritative invariant.** Valid allocated blocking multi-inventory Booking (`pending|confirmed|in_house` + `cabinTypeId` + `unitId` + Unit belongs to cabinType + valid Sofia `[checkIn, checkOut)`) owns **exactly one** UnitNightClaim per occupied Sofia night in `[checkIn, checkOut)` and no others (checkout excluded). Terminal (`completed|cancelled`) owns **zero** claims. Unallocated (`cabinTypeId`, `unitId` null) owns **zero** claims but still consumes cabinType **pooled commercial capacity**. Single-inventory (`cabinId`) owns **zero** claims. Location children follow the same rule.

2. **Model + index strategy.** `UnitNightClaim` schema `autoIndex: false`. No `syncIndexes` / `createIndexes` / automatic index replacement / automatic legacy drop in normal startup. Schema documents the authoritative named unique index `unitNightClaim_unitId_night_unique` `{ unitId: 1, night: 1 }` `unique: true` without auto-creating it. Legacy production `unitId_1_night_1` may remain; exclusivity depends only on the named unique index. One canonical `AUTHORITATIVE_UNIQUE_INDEX_SPEC` (no duplicate constants).

3. **Explicit cutover CLI.** `server/scripts/unitNightClaimI6Cutover.js`. Default = **READ-ONLY** preflight (I5-ready fields, duplicate aggregation, index metadata, `readyForUniqueIndex`). Mutation only `--create-unique-index`: full preflight; refuse partial/blockers/duplicates; idempotent if exact unique already exists; otherwise create exactly that named unique; re-verify name+keys+`unique:true`; fail if mismatch. **Never** drop any index, `syncIndexes`, `dropIndexes`, silent replace, Booking mutation, or claim bootstrap/repair. No `--replace-legacy-compound-index` required for production Mongo 7.

4. **Acquisition index guard.** `assertAuthoritativeUnitNightIndex()` (or equivalent) inspects exact name/keys/`unique:true`. **Once per `claimUnitNights` acquisition operation** (not once per night; **no** indefinite positive process cache). Release may proceed without unique index. Read-only reconcile/cutover tooling work without it. Single-inventory paths do not fail solely because the index is absent. Guard never creates/mutates indexes. Do **not** fail entire server boot solely because unique index is absent.

5. **One canonical claim API.** `claimUnitNights` / `releaseUnitNights` / `transferUnitNightClaims` / `assertBookingOwnsNights` — no parallel shadow vs authoritative APIs. `claimUnitNights` is authoritative and asserts the unique index before acquire. Outcomes: empty → acquire; same Booking → idempotent; foreign pre-read → structured conflict; concurrent race E11000 → **same** structured conflict. Raw E11000 never escapes. Structured conflict: code/category, `unitId`, `night`, `requestedBookingId`, `existingBookingId` if deterministically discoverable — no guest PII.

6. **All-or-nothing acquisition (compensation primary).** For target nights: skip nights already owned by same Booking; insert missing; track **exactly** claims this attempt inserted; on any conflict/error delete **only** this attempt’s inserts (same `bookingId` + attempted keys); never delete pre-existing same-booking or foreign claims; never overwrite foreign; normalize E11000; throw structured failure. Either Booking owns **all** requested target nights or gains **none** of the new nights from the failed attempt. If compensation fails: critical reconciliation evidence; do not continue canonical Booking commit; never silent success. Optional txn path only when environment supports it; equivalent semantics; **not** required by tests for correctness.

7. **Creation writer order.** Replace I2 Booking-first / nonfatal shadow. For every new allocated multi-unit Booking: mint `_id` → acquire **all** target claims → then persist Booking → then other canonical side effects per writer; on Booking persist failure compensate only this create attempt’s claims; retries idempotent; crash after claims before Booking → conservative orphans (I5), never double-book. No intentional allocated blocking Booking without claims. Applies to V2 finalize, legacy create, Location children, multi-unit paid orphan recovery, and any other allocated creation writer.

8. **Paid retain / overlap.** Preserve Booking/Payment/PI/checkout/MRI/PRI/audit. Never steal, delete paid evidence, silent unit pick, or invent financial behavior. Prefer claim-before-durable allocated Booking. If a durable allocated Booking cannot own required claims: demote `unitId=null`, keep `cabinTypeId` + blocking status, ensure zero claims, preserve paid evidence, critical MRI/reconciliation, surface finalize failure. If demotion fails: critical evidence; do not report successful inventory finalization; I5 detects allocated-without-claims.

9. **Voucher failure.** Prefer claims before allocated Booking save. If voucher confirm fails after valid Booking+claims: preserve inventory relationship + existing voucher failure review. If an edge leaves allocated without claims: same demotion as paid retain. Do not change voucher accounting semantics.

10. **Date-edit order.** Replace I3 Booking-first shadow sync. `retained = old ∩ new`, `newTarget = new − old`, `surplus = old − new`. Validate → read conflicts → acquire **only** `newTarget` → on conflict reject with old Booking+claims intact → persist new dates + reservation blocks → **only after** successful commit release surplus → on commit failure compensate only newly inserted `newTarget` claims → on surplus release failure after commit: keep new dates; stale surplus is conservative; CRITICAL MRI; do not roll back the committed date edit. Never release surplus before canonical commit. In-house checkIn immutability unchanged.

11. **Legacy reassign hard block.** In `reassignReservation`, immediately after `loadBookingOrFail`: hard reject if `cabinTypeId` present, `unitId` present, or mixed/malformed multi-inventory identity. Do not cabin-mutate multi-inventory with `validateBeforeSave:false`. Single-cabin `cabinId`-only reassign may remain. Clear 409/validation. Do **not** wire `transferUnitNightClaims`. R1 owns physical unit moves.

12. **Transfer primitive.** Harden `transferUnitNightClaims` for all-or-nothing target + never release source before target secured + E11000 normalize + same-unit no-op. **No** production route/UI uses transfer in I6. REALLOCATE = R1.

13. **Terminal / delete release.** Cancel/complete/hard delete/location rollback/finalize cleanup/maintenance delete must release. After durable terminal: release failure does **not** un-cancel/un-complete; stale claim conservative; CRITICAL MRI; I5 detects. Prefer release before hard delete; orphan after delete = CRITICAL. Do not silently swallow authoritative release failure.

14. **Status transitions.** Blocking→blocking (confirm, check-in): claims unchanged. Blocking→terminal: release. Terminal→blocking: keep rejecting resurrection. No reacquire/resurrection semantics.

15. **Pooled cabinType capacity (REQUIRED I6 fix).** Physical UnitNightClaim ≠ pooled commercial capacity. Capacity = **all** overlapping blocking Bookings for that cabinType (allocated **and** unallocated). Public search / AssignmentEngine must not sell when total blocking occupancy already consumes available unit count. Example: 3 units, A1+A2 allocated + 1 unallocated → commercially **full** even if A3 physically unclaimed. Canonical capacity helper preferred over scattered OR queries. Do **not** convert claim count into capacity. Terminal/non-overlap do not consume.

16. **Read vs acquire.** Browsing/selection/quote/AssignmentEngine/OPS preview/finalize validation/date-edit validation = **READ ONLY** (Booking capacity, optional UnitNightClaim ownership observation, AvailabilityBlock). **ACQUIRE** only at commit writers (finalize, legacy create, date-edit commit, Location child commit, paid recovery). No speculative durable claims. REALLOCATE commit = R1.

17. **External holds.** Airbnb/iCal = AvailabilityBlock only; never UnitNightClaim. Internal claim conflict = hard. External overlap = existing warning/policy. ICS sync unchanged.

18. **Conflict SoT.** Physical internal exclusivity race safety = UnitNightClaim + unique index. Pooled capacity = canonical blocking Booking occupancy. External = AvailabilityBlock. Booking scans remain for capacity/reconciliation/preview/single-cabin; **insufficient** alone for physical multi-unit exclusivity.

19. **I5 after cutover.** Default read-only. Missing allocated claim / foreign owner / canonical collision = CRITICAL blockers; terminal/orphan/stale = CRITICAL drift. Safe repair for deterministic uncontested classes only; no silent winners. Historical `unit_night_claim_shadow_failure` may remain; new failures may use clearer category while preserving dedupe discipline. No MRI migration required.

20. **LocationBooking atomicity (compensation).** Mint child ids → acquire **all** child claims for the whole attempt → track all attempt inserts → any later conflict compensates **every** claim newly inserted for the attempt → then persist LocationBooking/children → on canonical failure compensate all attempt claims. Crash strands = I5 orphans. No partial successful location inventory allocation.

21. **Paid orphan recovery.** Acquire authoritatively; never steal/overwrite/silent other unit; preserve payment/recovery evidence; MRI; demotion/unallocated if a blocking Booking must be preserved without claims; never delete paid evidence.

22. **Stop-the-world cutover architecture (ops, not app automation).** Maintenance → stop all inventory-writing PM2 processes → deploy/build/install while **stopped** → final I5 verify with new code → I6 read-only preflight → `--create-unique-index` → verify unique metadata → **first** start of authoritative API/workers → smoke → I5 reconcile → exit. Forbidden: old shadow writers + unique index; new authoritative writers without unique index; mixed old/new writers. **No** permanent feature flag. No deploy automation in application code.

23. **Shadow wrapper disposition.** Convert/remove `ensureUnitNightClaimsShadow` / `syncUnitNightClaimsShadow` / `ensureUnitNightClaimsReleasedShadow` so no convenient nonfatal shadow path remains. Prefer consolidation into canonical authoritative helpers. No duplicate inventory APIs.

24. **I6 does not:** enable REALLOCATE / Move UI / StayChange REBOOK/AMEND; change payments/pricing; touch cancellation-cents / cleaning calendar / client quotas / unrelated OPS; drop legacy `unitId_1_night_1` in normal cutover; depend on multi-document transactions.

---

### Batch R — REALLOCATE (after I6)

Split into **R1** (domain/API — locked in §21; **LIVE** in production at `1a2d1638c76d75049515b09905b6b59a0b65d757`), optional **R2** hardening if still needed after R1, **R3** (OPS Move Unit UI — locked in §22; **LIVE** at `7bf99e6`), and **REBOOK** (cross-product stay change — locked in §23; **NOT LIVE**). Do **not** pull AMEND/REBOOK or the Batch 7 wizard into R3.

| | |
|--|--|
| **R1 Delivered (LIVE)** | Minimal StayChange(`kind=reallocate`); staged target-secure → Booking CAS → block sync → source-release; durable scoped idempotency; focused reconcile/resume; OPS API `POST …/actions/reallocate`; R1 indexes live (`stayChange_kind_booking_idempotency_unique`, `auditEvent_dedupeKey_unique`); legacy multi-unit reassign remains rejected |
| **R1 does NOT include** | Move UI; unit selector; wizard; AMEND; REBOOK; pricing/payments; `in_house` unit moves; wiring combined `transferUnitNightClaims` as sole workflow |
| **Invariants proven (R1)** | 3, 7, 8, 16–19, 26–30 (+ R1 §21 locks) |
| **R3 Delivered (when implemented)** | OPS Move Unit for existing R1 REALLOCATE: detail inventory identity; read-only reallocate-candidates; Move Unit dialog; selector + warnings + ack; client idempotency; legacy Reassign visibility correction; ≥60+ locked UI/API scenarios (§22) |
| **R3 does NOT include** | AMEND; REBOOK; date/guest/price/payment/refund/upgrade/extras; cross-product moves; StayChange management UI; full Move/Modify wizard (Batch 7); Cleaning calendar changes |
| **Still unsupported after R3** | AMEND money, REBOOK, upgrades/downgrades, unified Move/Modify wizard (Batch 7) |
| **R3 does NOT list as blocker** | R1 index cutover (already live in production) |

---

## 21. R1 minimal StayChange REALLOCATE (LOCKED)

**Prerequisite:** I6 complete in production (authoritative `UnitNightClaim`, unique `{unitId,night}`, compensation without transactions, legacy multi-unit reassign blocked).

**R1 adds ONLY:** minimal StayChange `kind=reallocate` + domain/API workflow.
**R1 does NOT:** implement application code in this amendment; create UI; start R2/R3; enable AMEND/REBOOK; mutate payments/pricing.

### 21.1 Exact scope

REALLOCATE means:

- same Booking `_id`
- same `cabinTypeId` / commercial product
- same dates, guests, extras, transport, romantic package, promo/voucher terms, price/payment state
- **ONLY** `unitId` changes to another Unit belonging to the same `cabinTypeId`

Example: A-Frame / A2 → A-Frame / A3.

No replacement Booking. No payment mutation. No value transfer. No pricing calculation. No refund. No AMEND. No REBOOK. No Move UI.

### 21.2 Commercial product routing

```text
commercialProductKey(x) =
  cabinTypeId ? "cabinType:" + cabinTypeId
  : cabinId ? "cabin:" + cabinId
  : invalid
```

R1 allowed **ONLY** when source and target commercialProductKey are **exactly equal** and **cabinType-based**.

Changing any of: `cabinTypeId`, `cabinId`, dates, guests, extras, price, payment, promo, voucher, transport, romantic package → **NOT R1**.

### 21.3 Eligibility (PRE-STAY ONLY)

**Allowed statuses:** `pending` | `confirmed`

**Rejected:** `in_house` | `completed` | `cancelled`

Also reject:

- single-inventory `cabinId` Booking
- unallocated cabinType Booking (`unitId` null)
- mixed/malformed inventory identity
- invalid Sofia stay dates
- source Unit not belonging to Booking.`cabinTypeId`

Do **not** add `in_house` unit movement in R1.

### 21.4 Target Unit

Target Unit must:

- exist
- `isActive === true`
- belong to Booking.`cabinTypeId`
- differ from source unit (except same-unit no-op — §21.5)

Reuse existing canonical Unit eligibility. Do not invent maintenance/operational fields that do not exist. Existing hard-block systems remain authoritative where already used.

### 21.5 Same-unit policy

If `targetUnitId` equals current Booking.`unitId`:

| Case | Behavior |
|------|----------|
| `idempotencyKey` matches an existing StayChange for this booking/kind | Replay/resume that durable StayChange according to its state |
| Otherwise | HTTP **200 no-op**; create **NO** StayChange; create **NO** audit event; mutate **NOTHING** |

Do not create fake successful StayChange records for fresh no-op requests.

### 21.6 Durable StayChange contract (conceptual — model lands in R1 implementation)

Required R1 fields:

```text
_id
kind = reallocate
bookingId
sourceCommercialProductKey
targetCommercialProductKey
sourceCabinTypeId
targetCabinTypeId
sourceUnitId
targetUnitId
checkIn
checkOut
status
idempotencyKey
payloadFingerprint
actor
reason? (optional)
externalHoldWarningsAccepted (or equivalent audit evidence)
failure metadata where required
reconciliation metadata where required
createdAt
updatedAt
completedAt
```

- Snapshot both cabinTypeIds even though they must match (immutable evidence).
- No guest PII snapshots unless already required by canonical audit convention.
- No payment/value fields required for R1.
- Schema may be future-compatible with amend/rebook; R1 runtime **only** creates `kind=reallocate`.

### 21.7 Idempotency (REQUIRED)

- `idempotencyKey` is **REQUIRED** on every mutating REALLOCATE request (non-empty bounded string; existing API validation style).
- Do **NOT** use a globally unique key alone.
- Preferred durable uniqueness: **`{ kind, bookingId, idempotencyKey }`** (partial/index semantics as needed by eventual schema).
- Store **`payloadFingerprint` independently**. Fingerprint covers at minimum: `kind`, `bookingId`, `sourceUnitId` at accepted creation, `targetUnitId`, `checkIn`, `checkOut`, commercial product identity. Include actor only if canonical convention requires it.

| Same scoped key + same fingerprint | Replay / resume existing StayChange |
| Same scoped key + different fingerprint | HTTP **409** idempotency conflict |

Do **not** rely on process memory (`rememberResult`) for correctness.

### 21.8 R1 state machine (spine subset)

Use locked generic statuses, **only** this subset:

```text
pending
inventory_secured
committed
completed
failed
needs_reconciliation
```

**Do not use for R1:** `awaiting_payment`, `settling`. Do not use `ready_to_commit` unless implementation proves it materially necessary (prefer collapsing into the commit transition).

Happy path:

```text
pending → inventory_secured → committed → completed
```

| Status | Meaning |
|--------|---------|
| `pending` | Operation exists; target not yet known fully secured |
| `inventory_secured` | All target UnitNightClaims durable; source claims still held; Booking still source |
| `committed` | Booking.`unitId` durably equals target |
| `completed` | Booking target + target claims exact + reservation block synchronized + source claims released |
| `failed` | Pre-commit compensatable failure; no unsafe canonical unit move left dangling |
| `needs_reconciliation` | Booking crossed canonical commit boundary but required post-commit inventory projection/cleanup is incomplete |

Pre-commit compensatable failure → `failed`.
Post-Booking-commit cleanup/invariant failure → `needs_reconciliation`.

Status reflects what has **actually** become durable.

### 21.9 Source ownership precondition

Before target acquisition: `assertBookingOwnsNights` **exact** for all Sofia occupied nights in `[checkIn, checkOut)` on the **source** unit.

Missing / foreign / inconsistent ownership → **FAIL CLOSED**. Do not run I5 repair inside REALLOCATE. Do not choose winners. Return reconciliation-required domain error.

### 21.10 Internal / external conflict policy

| Conflict | Policy |
|----------|--------|
| Internal UnitNightClaim | **HARD** — **NO OVERRIDE** |
| External Airbnb/iCal `AvailabilityBlock` | Reuse OPS reassign/manual-create acknowledgment: require `acceptExternalHoldWarnings: true` before commit; otherwise reject per existing OPS convention |
| Other existing hard blocks | Remain hard |
| Airbnb/iCal → UnitNightClaim | **Never** |

### 21.11 Staged order (LOCKED) — do NOT wire combined transfer as sole workflow

Current `transferUnitNightClaims()` claims target then **immediately** releases source. That ordering is **wrong for R1** because Booking canonical commit must occur **between** those phases.

**Exact R1 order:**

1. Load Booking
2. Resolve/replay idempotency if existing StayChange
3. Validate eligibility / product / target
4. Evaluate read-only conflicts / external warnings
5. Assert exact source claims
6. Create durable StayChange `pending`
7. Acquire **ALL** target claims
8. StayChange → `inventory_secured`
9. **CAS** Booking: expected source unit + eligible status + same cabinType → set `unitId = target`
10. StayChange → `committed`
11. Synchronize Booking-owned reservation `AvailabilityBlock` / unit projection to target
12. Release source UnitNightClaims
13. Emit OPS audit projection exactly once
14. StayChange → `completed`

**TARGET FIRST. SOURCE RELEASE LAST.**

Use low-level `claimUnitNights` / `compensateClaimAttempt` / `releaseUnitNights` (and optional staged helpers). Combined `transferUnitNightClaims` must **not** be the sole R1 workflow primitive.

### 21.12 Booking CAS

Standalone Mongo requires explicit concurrency control. Canonical unit move must use compare-and-set semantics equivalent to:

```text
Booking._id == bookingId
Booking.unitId == expectedSourceUnitId
Booking.cabinTypeId == expectedCabinTypeId
Booking.status ∈ { pending, confirmed }
→ set unitId = targetUnitId
```

Only one concurrent move may commit. If CAS matches zero:

- do not overwrite current Booking
- do not release source claims
- compensate **ONLY** this operation’s target claims where safe
- inspect existing StayChange / Booking state → replay legitimate same operation or fail/reconcile

Two simultaneous ops `A2→A3` and `A2→A4` may both temporarily secure different targets before CAS. Exactly **one** CAS wins. Loser compensates only its own target attempt. Loser never releases winner/source claims incorrectly.

Two different Bookings racing the same target unit: unique `{unitId,night}` selects exactly one claim winner; loser gets structured inventory conflict (no raw E11000).

### 21.13 Target acquisition failure

If target acquisition fails:

- Booking remains source
- Source claims remain untouched
- Attempt-created target claims compensated via authoritative claim service
- StayChange → `failed`

If target compensation itself cannot complete: do **not** proceed to Booking CAS; record CRITICAL reconciliation evidence; StayChange reflects reconciliation requirement (not ordinary clean failure) if durable target drift may remain.

### 21.14 CAS failure after target secured

If target claims are fully secured but Booking CAS fails:

- Booking remains whatever canonical state won
- Compensate **ONLY** target claims created by **this** StayChange when they are no longer canonical
- Never delete foreign claims, pre-existing same-booking claims, or claims belonging to another successful move
- Compensation complete → StayChange → `failed` where safe
- Compensation unproven → StayChange → `needs_reconciliation`

### 21.15 AvailabilityBlock synchronization failure (CRITICAL)

After Booking CAS succeeds: Booking is target; target claims remain authoritative.

Next: synchronize **ONLY** the reservation-owned AvailabilityBlock projection from source unit to target unit using existing canonical reservation-block semantics. Do **NOT** mutate external Airbnb/iCal blocks.

If reservation block synchronization **fails**:

- Do **NOT** roll Booking back to source
- Do **NOT** release target claims
- Do **NOT** release source claims yet
- Booking remains target; target claims remain full; source claims remain conservatively held
- Stale/old reservation block may remain conservatively blocking source
- StayChange → `needs_reconciliation`
- Emit CRITICAL reconciliation evidence

This deliberately blocks **more** inventory rather than risking under-block / double-book. Recovery must finish block synchronization **BEFORE** source release.

### 21.16 Source release failure

If Booking target durable + target claims full + reservation block successfully synchronized, but source claim release fails:

- Booking stays target; target claims stay
- Do not roll back
- Stale source claims are conservative
- StayChange → `needs_reconciliation` + CRITICAL evidence
- Recovery retries only source cleanup

### 21.17 Completion invariant

StayChange may become `completed` **ONLY** when:

- Booking.`unitId` == `targetUnitId`
- target claims exactly cover all occupied Sofia nights
- source claims for those stay nights == zero
- reservation-owned AvailabilityBlock points to the target unit / canonical target reservation projection
- no unresolved internal inventory failure exists

Audit projection may be emitted once without becoming a competing inventory SoT.

### 21.18 Crash recovery

R1 **MUST** have a focused durable reconciler/resume path, conceptually:

```text
reconcileReallocateStayChange(stayChangeId)
```

Inspect StayChange state, Booking.`unitId`, source/target claims, reservation block projection.

| Observed | Convergence |
|----------|-------------|
| `pending` + no target claims | Retry acquisition or safely fail per path |
| `pending` + full target claims | Recognize crash after acquire; advance/resume |
| `inventory_secured` + Booking source | Retry CAS if preconditions valid; else compensate target |
| `inventory_secured` + Booking target | Recognize crash after CAS; advance `committed` |
| `committed` + block still source | Synchronize block |
| `committed` + block target + stale source claims | Release source |
| `committed` + block target + source zero | Complete |
| `completed` | No-op replay |
| Ambiguous / foreign ownership | `needs_reconciliation` + CRITICAL evidence |

No general AMEND/REBOOK workflow engine.

### 21.19 HTTP response lost / retry

Because `idempotencyKey` is mandatory: same booking + same key + same payload → load existing StayChange; if `completed` return completed result; if recoverable run/resume focused reconciliation. Do **NOT** create a second StayChange.

### 21.20 AvailabilityBlock is a projection

StayChange + Booking + UnitNightClaim remain domain truth. Reservation AvailabilityBlock must stay aligned. External holds are not part of source/target claim transfer. No new block model. Implementation audits existing reservation-block helpers.

### 21.21 Booking projection

R1 mutates on Booking: **`unitId` only**, plus already-existing operational projections (reservation AvailabilityBlock) where required.

Do **NOT** add `settledByStayChangeId` for R1. Do **NOT** add `replacementBookingId`. StayChange is durable movement history.

### 21.22 Audit event

Reuse existing OPS reservation audit infrastructure. Successful REALLOCATE projects **one** audit event:

- action: `reservation_reallocate` (or existing canonical naming)
- bookingId, StayChange id, before/after unitId, actor, timestamp, reason, external warnings accepted if applicable

StayChange = durable history SoT. AuditEvent = OPS visibility. Idempotent replay must **not** duplicate audit. Audit write failure must **not** reverse a safely completed inventory move merely because StayChange already holds durable history; use existing MRI/observability patterns if audit projection fails.

### 21.23 Legacy reassign vs R1 API

| Route | Role |
|-------|------|
| `POST .../actions/reassign` | Single-cabin `cabinId` only; multi-unit remains rejected (I6) |
| `POST .../actions/reallocate` | R1 physical unit REALLOCATE |

Never silently route reassign → REALLOCATE.

### 21.24 R1 API contract

```text
POST /api/ops/reservations/:id/actions/reallocate
```

Body:

| Field | Rule |
|-------|------|
| `targetUnitId` | **REQUIRED** |
| `idempotencyKey` | **REQUIRED** |
| `reason` | optional bounded string |
| `acceptExternalHoldWarnings` | optional boolean, default `false` |

Reject unknown/mutation fields including: checkIn, checkOut, dates, adults, children, guests, cabinTypeId, cabinId, price, totalPrice, payment, extras, transport, romantic, promo, voucher.

Server derives source Booking state.

### 21.25 Authorization

R1 initially uses the same **ADMIN-only** authorization boundary as legacy OPS reservation reassignment. No broader permissions. No operator access in R1. Reusing the same permission constant vs a semantic alias with identical role coverage is an implementation detail; **no permission expansion**.

### 21.26 Service architecture (future implementation)

Preferred:

- `server/services/stayChange/reallocateStayChangeService.js` — validation, StayChange lifecycle, idempotency, target acquisition, Booking CAS, block sync, source release, reconcile/resume
- `unitNightClaimService` — canonical low-level inventory primitives
- `reservationWriteService` — focused helpers only; do not place the entire durable state machine there
- OPS route — thin HTTP adapter

### 21.27 Guest / operational side effects

During implementation, audit existing reassign/date-edit side effects for credentials/messages. Do **NOT** blindly send cancellation/rebooking messages. If changing physical Unit changes an already-existing canonical credential/property instruction projection, reuse the existing precise side-effect helper **only when inputs actually differ**. No new messaging architecture in R1. Side effects are secondary to inventory correctness and must never change core commit ordering.

### 21.28 I5 postcondition

After `completed` REALLOCATE:

- Booking.`unitId` = target
- target UnitNightClaims = exactly every occupied Sofia night
- source UnitNightClaims for Booking/stay = zero
- StayChange = `completed`
- reservation block = target-aligned
- I5 = clean

If source cleanup remains, StayChange must **NOT** claim `completed`.

### 21.29 R1 / R2 / R3 boundary

| Stage | Includes |
|-------|----------|
| **R1** | StayChange model foundation sufficient for reallocate; reallocate domain service; durable idempotency; recovery/reconcile; OPS API route; tests — **LIVE** |
| **R1 does NOT** | UI |
| **R2** | Any further inventory-transfer/domain hardening explicitly planned after R1 if still needed |
| **R3** | OPS **Move Unit** only for existing R1 REALLOCATE — locked in §22 (not AMEND/REBOOK; not Batch 7 wizard) |

Do not pull R3 into R1. Do not pull AMEND/REBOOK into R3.

### 21.30 Required R1 test contract

Implementation must cover at least the audited ~90 scenarios plus explicit:

91. `idempotencyKey` required
92. uniqueness scoped by `kind+bookingId+key`, not global key alone
93. same scoped key + changed payload = 409
94. same-unit fresh request creates no StayChange
95. same-unit matching previous idempotency replays existing StayChange
96. block sync failure after CAS keeps source claims
97. block sync failure keeps target claims
98. block sync failure enters `needs_reconciliation`
99. reconcile fixes block before releasing source
100. audit projection failure does not roll back safe completed inventory
101. crash after CAS before `committed` status inferred safely
102. crash after block sync before source release inferred safely
103. concurrent loser compensates only its own target claims
104. reconciliation never releases claims owned by another StayChange / Booking
105. no application dependency on Mongo multi-document transactions

---

## 22. R3 OPS Move Unit UI + read-only prerequisites (LOCKED)

**Prerequisite:** R1 LIVE in production (`1a2d1638c76d75049515b09905b6b59a0b65d757`). Production R1 indexes already live (`stayChange_kind_booking_idempotency_unique`, `auditEvent_dedupeKey_unique`). **Do not** list R1 index cutover as an R3 blocker.

**Mutation API already live:**

```text
POST /api/ops/reservations/:id/actions/reallocate
```

**R1 guarantees R3 must respect:** same Booking; same `cabinTypeId`; `unitId`-only move; `pending|confirmed` only; durable StayChange; required `idempotencyKey`; authoritative UnitNightClaims; internal conflicts hard; external holds require explicit acknowledgment; admin-only auth (same effective permission as legacy Reassign); crash-safe recovery.

**This §22 amendment locks the R3 contract only.** It does **not** authorize application implementation by itself. Implementation begins only when a later R3 implementation batch is explicitly approved.

### 22.1 Exact R3 scope

R3 **is** the OPS Move Unit experience for existing R1 REALLOCATE.

| Includes | Excludes |
|----------|----------|
| Reservation detail inventory identity enrichment | AMEND |
| Read-only reallocate candidates endpoint | REBOOK |
| Move Unit button + dialog/sheet | Date / guest / product modification |
| Target unit selector | Price / payment / refund / upgrade charge |
| Conflict / warning display | Extras changes |
| External-hold acknowledgment | Cross-product moves |
| Optional reason | StayChange management / history panel UI |
| Client idempotency lifecycle | Full Move/Modify stay wizard (Batch 7) |
| `opsApi` reallocate + candidates methods | Cleaning calendar changes |
| Success / error UX + reservation refresh | Second availability / conflict engine |
| Legacy Reassign visibility correction | Speculative claim / StayChange on preview |
| Tests (≥60+ locked scenarios) | |

### 22.2 Current OPS UI graph (implementation references)

Lock these as the R3 integration surface. Do not invent parallel pages or availability engines.

| Concern | Path |
|---------|------|
| Reservation detail | `client/src/pages/ops/OpsReservationDetail.jsx` |
| Reservations list | `client/src/pages/ops/OpsReservations.jsx` |
| Permissions | `client/src/pages/ops/utils/opsReservationPermissions.js` |
| OPS API client | `client/src/services/opsApi.js` |
| Detail read model | `server/services/ops/readModels/reservationDetailReadModel.js` |
| Reservation mapper | `server/mappers/bookingToReservationMapper.js` |
| Canonical target conflicts | `server/services/ops/domain/conflictService.js` → `evaluateTargetConflicts` |
| R1 mutation route | `server/routes/ops/modules/reservationsRoutes.js` |

UX precedents to **reuse** (not re-invent): edit-dates / cancel dialog shells; create-reservation external-hold checkbox (`OpsReservations.jsx`); location-block conflict labels (`LocationBlockSheet.jsx`); `crypto.randomUUID()` idempotency style (not timestamp-only keys).

### 22.3 Detail inventory identity prerequisite

Current reservation detail does **not** expose enough multi-unit identity (`mapBookingToReservationCompatible` today exposes `cabinId` but not `cabinTypeId` / `unitId`).

R3 **must** enrich the existing reservation detail read model so the UI can determine, without guessing from text labels:

- `cabinTypeId`
- `unitId`
- current unit display label
- commercial accommodation display label where already available

Prefer reuse of the reservations-list `cabinSummary` shape (`reservationsReadModel.resolveCabinSummary`) where clean.

**Must distinguish structured shapes:**

| Shape | Meaning |
|-------|---------|
| Single cabin | `cabinId` present; no `cabinTypeId` |
| Allocated cabinType | `cabinTypeId` + `unitId`; not malformed |
| Unallocated cabinType | `cabinTypeId` without `unitId` |
| Malformed | both `cabinId` and `cabinTypeId` (or other invalid XOR) |

Do **not** add raw internal model dumps or unrelated inventory data.

### 22.4 Read-only reallocate candidates endpoint

Canonical route:

```text
GET /api/ops/reservations/:id/reallocate-candidates
```

(Equivalent GET path only if exact OPS route conventions make it materially better; prefer the path above.)

| Rule | Lock |
|------|------|
| Mutability | **READ ONLY** |
| Auth | Same effective permission as REALLOCATE / legacy admin Reassign (`ops.reservation.reassign`) |
| Engine | **Only** `evaluateTargetConflicts` + existing Unit / cabinType domain rules |
| Dates | Booking’s **existing** stay dates (no date preview rewrite) |
| External holds | Warnings (`treatExternalHoldAsHard: false`), not hard conflicts |
| Self | Exclude the source reservation correctly |
| Claims | Do **not** acquire UnitNightClaims |
| StayChange | Do **not** create |
| Booking / blocks / MRI | Do **not** mutate / write |

**Server flow:**

1. Load Booking
2. Validate enough identity for candidate context (allocated multi-unit eligible shape)
3. Load Units belonging to `Booking.cabinTypeId`
4. Evaluate each Unit against existing stay dates via `evaluateTargetConflicts`
5. Return compact candidate DTOs

Wrong-cabinType Units must **never** be returned.

**Advisory only:** candidates do **not** reserve inventory. R1 REALLOCATE mutation remains authoritative. A target may become unavailable between preview and submit — treat as normal concurrency, not corruption.

Do **not** call the mutation service for preview. Do **not** use StayChange for preview.

### 22.5 Candidate DTO and state classification

Each candidate minimum UI contract:

| Field | Notes |
|-------|-------|
| `unitId` | Required |
| `displayName` | When available |
| `unitNumber` | When existing canonical data exposes it |
| `isActive` | Boolean |
| `state` | One of the locked states below |
| conflicts / warnings | Compact safe metadata for OPS display; reuse canonical conflict categories |

**Allowed `state` values (precedence locked):**

| State | Rule | Selectable? |
|-------|------|-------------|
| `CURRENT` | `unitId == Booking.unitId` | **No** (even if conflict-free) |
| `INACTIVE` | `Unit.isActive !== true` | **No** |
| `HARD_BLOCKED` | ≥1 canonical hard conflict | **No** |
| `EXTERNAL_HOLD_WARNING` | no hard conflict; ≥1 external hold warning | **Yes** (with visible warning + ack) |
| `AVAILABLE` | no hard conflict; no external warning | **Yes** |

If both hard conflicts and external warnings exist → `HARD_BLOCKED`.

**PII:** Candidate / conflict DTO must **not** leak another guest’s name, email, phone, payment, notes, or message contents. Expose only operational conflict category, safe reservation identifier if existing OPS convention allows it, dates, and source/channel where appropriate. Prefer existing safe conflict projection patterns (`LocationBlockSheet` / conflict service guest labels are already minimized — do not expand to full PII).

### 22.6 Move Unit placement and eligibility

```text
OPS Reservation Detail → Reservation actions → Move Unit
```

**Show only when all hold:**

- Session has existing admin reassign permission (`ops.reservation.reassign`)
- `Booking.status` ∈ `pending` \| `confirmed`
- Valid allocated multi-unit identity (`cabinTypeId` + `unitId`, not malformed)

**Hide** (do not show disabled-with-tooltip — match current OPS hide convention): `in_house`, `completed`, `cancelled`, single-cabin, unallocated cabinType, malformed identity, no permission.

### 22.7 Legacy Reassign visibility boundary

| Booking shape | Legacy Reassign | Move Unit |
|---------------|-----------------|-----------|
| Single-cabin (`cabinId` only) | Show where currently permitted | Hide |
| Allocated multi-unit | **Hide** | Show when §22.6 passes |
| Unallocated / malformed multi-unit | Hide | Hide |

Do **not** route Reassign into REALLOCATE. Do **not** merge into one generic action.

### 22.8 Move dialog UX

Compact vertical selector. Prefer responsive bottom-sheet / modal consistent with existing OPS UI.

**Forbidden:** `window.prompt`; desktop-only inventory grid; full modification wizard; date / guest / product / price / payment / extras controls.

**Contents:** current unit; candidate list; optional reason; external warning acknowledgment when applicable; submit/cancel; local error state.

**Narrow screens:** vertical list, scrollable content, large enough controls; no horizontal inventory tables.

### 22.9 External hold UX

External Airbnb/iCal hold ≠ internal conflict.

When selected candidate is `EXTERNAL_HOLD_WARNING`:

- Show warning visibly (affected date / source / type when safe metadata exists)
- Require explicit operator acknowledgment
- Only after explicit action send `acceptExternalHoldWarnings: true`
- Default / unset → `false`
- **Never** automatically send `true` (legacy Reassign’s force-true is **not** the R3 pattern)
- **No** override control for internal hard conflicts

### 22.10 Reason

Optional free text. Match existing OPS edit-dates reason conventions and R1 backend max length (500). No categories/presets in R3. Trim whitespace; empty may be omitted from payload.

### 22.11 Client idempotency lifecycle

Backend requires `idempotencyKey` (8–128 chars).

| Rule | Lock |
|------|------|
| Generation | `crypto.randomUUID()` with optional stable prefix, e.g. `ops_realloc_<uuid>` |
| Mint | **Once** when a new Move intent starts (dialog open) |
| Reuse | Double-click protection; HTTP / timeout retry; same exact target/payload retry |
| New key | Dialog close+reopen; target change before a new submission intent; operator starts a genuinely new Move |
| Do not | Generate a new key on every submit click |
| Busy | Prevent parallel duplicate in-flight submissions |

### 22.12 API client (implementation-time)

| Method | Contract |
|--------|----------|
| `opsWriteAPI.reallocateReservation(id, body)` | `POST /api/ops/reservations/:id/actions/reallocate` |
| Body **only** | `targetUnitId`, `idempotencyKey`, `reason` when non-empty, `acceptExternalHoldWarnings` |
| Read | Candidates method for `GET …/reallocate-candidates` using existing OPS API conventions |

No other mutation fields.

### 22.13 Submission flow

1. Open Move Unit
2. Mint idempotency key
3. Load candidates endpoint
4. Render target states
5. Select valid target
6. Optional reason
7. Acknowledge external warning if required
8. Submit R1 REALLOCATE
9. Lock submit while request active
10. **Success:** refresh reservation detail; close dialog; success toast
11. **Failure:** keep dialog open where recovery is possible; map structured `details.code`
12. **Target/conflict race:** refresh candidates

Modal-local errors (edit-dates style); do not rely only on page-level `doAction` toast if that closes recovery paths.

### 22.14 Structured error UX

Use `details.code` from existing domain error responses. Do **not** parse human message strings when structured code exists.

| Code | UI behavior |
|------|-------------|
| `HARD_CONFLICTS` | Target no longer available; refresh candidates |
| `EXTERNAL_HOLD_ACK_REQUIRED` | Show warning; require acknowledgment; keep dialog |
| `UNIT_NOT_FOUND_OR_INACTIVE` | Candidate unavailable / inactive |
| `UNIT_CABIN_TYPE_MISMATCH` | Invalid target / product mismatch |
| `STATUS_NOT_ELIGIBLE` | Refresh detail; Move no longer allowed |
| `SINGLE_CABIN_NOT_REALLOCATE` / `CABIN_TYPE_REQUIRED` / `UNIT_ALLOCATION_REQUIRED` / `MALFORMED_INVENTORY_IDENTITY` / `COMMERCIAL_PRODUCT_INVALID` | Refresh detail; close/hide invalid Move |
| `SOURCE_OWNERSHIP_MISMATCH` | Inventory needs reconciliation; do not suggest blind retry |
| `IDEMPOTENCY_KEY_CONFLICT` | Intent/key conflict; new intent only after operator understands prior state |
| `CAS_FAILED` / `CAS_LOST_OTHER_UNIT` / `BOOKING_CAS_FAILED` | Concurrent change; refresh detail + candidates |
| `BLOCK_SYNC_FAILED` / `SOURCE_RELEASE_FAILED` / needs_reconciliation | Reconciliation required; **no** financial / guest-charge wording |
| `STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING` | Operational backend configuration error (should not occur with live indexes; still map) |
| Validation 400 | Field-specific UI where practical |
| Unknown | Safe generic failure message |

### 22.15 Success UX and detail unit display

On completed REALLOCATE:

- Refresh detail
- Display new current Unit
- Same Booking / reservation id remains
- Concise toast e.g. `Moved from A2 to A3`

**Do not show:** new reservation; upgrade charge; refund; price difference; payment status change.

R3 must **visibly** show current accommodation / unit on reservation detail so operators can verify after refresh:

- Multi-unit: cabinType / product label + physical Unit label
- Single cabin: preserve existing display conventions

Do not redesign the whole reservation header.

### 22.16 StayChange / audit history

R3 v1 does **not** require a StayChange history panel. R1 `AuditEvent` (`reservation_reallocate` on Reservation) remains the OPS history projection. Success toast + refreshed Unit is sufficient. History panel may be later work.

### 22.17 Data refresh

| After success | |
|---------------|--|
| **MUST** | Refresh reservation detail |
| May | List refreshes on navigation; calendar on its own page load |
| **MUST NOT** | Modify Cleaning calendar behavior; add global polling / event systems; broad unrelated invalidation |

No global client cache requires broad invalidation today.

### 22.18 Preferred R3 architecture

**Server (small):**

- Enrich `reservationDetailReadModel` / mapper for inventory identity
- Focused read service e.g. `reallocateCandidatesReadService` wrapping Booking lookup, Unit lookup, `evaluateTargetConflicts`, safe DTO mapping
- Thin GET adapter on `reservationsRoutes`

**Client:**

- `opsApi.js`; eligibility helpers in `opsReservationPermissions.js`; `OpsReservationDetail.jsx`
- Prefer extract `client/src/pages/ops/components/MoveUnitDialog.jsx` if detail would grow materially
- Small idempotency helper only if genuinely reusable
- **No** generic workflow framework

### 22.19 Required R3 test contract (≥60; lock ≥80 named)

Implementation must cover at least these scenarios (add more discovered during implementation):

1. admin + pending allocated multi shows Move
2. admin + confirmed allocated multi shows Move
3. operator hides Move
4. in_house hides
5. completed hides
6. cancelled hides
7. cabinId (single-cabin) hides Move
8. unallocated hides Move
9. malformed hides Move
10. multi hides legacy Reassign
11. single cabin preserves Reassign
12. detail exposes `cabinTypeId`
13. detail exposes `unitId`
14. current Unit label displayed
15. candidates same cabinType only
16. current classified `CURRENT`
17. inactive classified `INACTIVE`
18. free classified `AVAILABLE`
19. internal conflict `HARD_BLOCKED`
20. external only `EXTERNAL_HOLD_WARNING`
21. hard + external ⇒ `HARD_BLOCKED`
22. wrong cabinType never returned
23. candidate endpoint read-only
24. candidate endpoint creates no StayChange
25. candidate endpoint creates no claims
26. candidate endpoint mutates no blocks
27. candidate endpoint reuses `evaluateTargetConflicts`
28. current not selectable
29. inactive not selectable
30. hard blocked not selectable
31. available selectable
32. external-warning selectable
33. external warning visibly rendered
34. external acknowledgment required
35. false/default acknowledgment not silently true
36. explicit acknowledgment sends true
37. reason optional
38. empty reason omitted/normalized
39. reason length enforced
40. idempotency generated on open
41. UUID-based key
42. same key on double submit
43. same key on timeout retry
44. target change produces new operation key
45. close/reopen produces new key
46. busy state prevents concurrent submit
47. successful request refreshes detail
48. success closes dialog
49. success toast identifies unit move
50. same reservation id remains
51. no financial success copy
52. `HARD_CONFLICTS` refreshes candidates
53. `EXTERNAL_HOLD_ACK_REQUIRED` preserves dialog
54. `STATUS_NOT_ELIGIBLE` refreshes detail
55. `SOURCE_OWNERSHIP_MISMATCH` shows reconciliation message
56. `IDEMPOTENCY_KEY_CONFLICT` handled structurally
57. CAS race refreshes state
58. needs_reconciliation handled without financial wording
59. backend 503 / index-missing surfaced operationally
60. unknown server failure safe generic message
61. no free-text error-code parsing
62. no date field in Move dialog
63. no guest field
64. no product selector
65. no price field
66. no payment control
67. no extras controls
68. no StayChange history UI required
69. candidate endpoint doesn’t leak guest PII
70. external hold details safe
71. narrow viewport usable
72. selector scrollable
73. no `window.prompt`
74. client API payload whitelist
75. single-cabin Reassign regression
76. R1 mutation regressions remain green
77. I1–I6 inventory regressions remain green
78. reservation detail existing actions unchanged
79. Cleaning calendar untouched
80. no AMEND/REBOOK implementation

### 22.20 R3 / later boundary

| Stage | |
|-------|--|
| **R3** | §22 Move Unit + read-only prerequisites + tests |
| **R3 does NOT** | AMEND, REBOOK, Batch 7 wizard, StayChange admin UI, Cleaning changes |
| **Batch 7** | Unified Move / Modify stay wizard remains later; R3 does not pre-build it |

---

## 23. REBOOK cross-product stay change (LOCKED)

**Production baseline:** `7bf99e6be18e642938ed3e199b6871089df01c8d`
**Live foundation:** I6 authoritative `UnitNightClaim`; R1 REALLOCATE backend; R3 Move Unit OPS UI.
**REBOOK is NOT live.**

**REBOOK** means a **commercial product** changes (e.g. Lux Cabin → A-Frame, A-Frame → Stone House). REBOOK must remain **distinct from REALLOCATE** internally. Same commercial product is **not** REBOOK — route conceptually to REALLOCATE or reject REBOOK; do not silently turn same-product REBOOK into REALLOCATE inside the mutation service.

This section locks REBOOK only. **No application implementation** is authorized by §23 alone.

### 23.1 Canonical REBOOK identity

For every StayChange kind, **`StayChange.bookingId` remains the canonical SOURCE Booking.**

For REBOOK add:

- **`targetBookingId`** — replacement Booking after creation

**Do NOT add persisted `sourceBookingId`.**

| Kind | `bookingId` | `targetBookingId` |
|------|-------------|-------------------|
| REALLOCATE | same Booking | `null` |
| REBOOK | source Booking | replacement Booking id |

Existing unique index remains:

```text
{ kind, bookingId, idempotencyKey }
```

No second source identifier may diverge from `bookingId`.

### 23.2 Source / replacement semantics

REBOOK creates a **NEW replacement Booking**. Source Booking commercial identity is **NEVER rewritten**.

Source retains forever:

- `cabinId` / `cabinTypeId` / `unitId`
- original Payment rows
- original Stripe identifiers
- original voucher/promo evidence
- original attribution evidence
- historical contractual totals

On successful REBOOK, source becomes:

```text
status = cancelled
cancellationSettlement.outcome = rebooked_or_moved
cancellationSettlement.replacementBookingId = replacement Booking id
```

**Do NOT create `Booking.status = rebooked_or_moved`.** Replacement carries the new commercial identity. Canonical relationship is **StayChange**.

### 23.3 Payment ownership

Lock permanently:

- Existing **`Payment.reservationId` NEVER moves.**
- Source Payment rows remain source evidence.
- Transferred value is **NOT** represented as Payment.
- Waived value is **NOT** represented as Payment.
- Transferred value is **NOT** new revenue.
- Waiver is **NOT** promo/discount abuse.
- Only genuinely **NEW incremental money** collected after REBOOK may create Payment rows on replacement.

**Do NOT copy** source `stripePaidAmountCents`, `giftVoucherAppliedCents`, payment intent ids, checkout ids, or voucher redemption ids onto replacement as if newly paid.

### 23.4 Single-cabin inventory prerequisite

**Full S1 lock:** **§24** (REBOOK-S1 CabinNightClaim foundation).

Repository audit proved current single-cabin inventory has **NO durable exclusive acquisition primitive.** Current single-cabin availability is check-then-write:

- Booking overlap queries
- AvailabilityBlock overlap queries
- post-save conflict cleanup

Neither Booking nor AvailabilityBlock has a unique constraint capable of preventing arbitrary overlapping stays.

Therefore **REBOOK MUST NOT target `cabinId`-only inventory** until **§24** S1 closes (S1.6 unique authority + S1.7 claim-first writers + post-cutover verification).

Conceptual model summary: **`CabinNightClaim`** — `{ cabinId, night }` authoritative uniqueness; occupied nights `[checkIn, checkOut)` Europe/Sofia civil dates. **Do NOT** use AvailabilityBlock as single-cabin uniqueness authority.

### 23.5 Single-cabin claim foundation boundary

**Full staged cutover:** **§24.29** (S1.1–S1.8). **Do NOT collapse S1.1–S1.7.**

The single-cabin claim foundation must cover **all authoritative single-cabin inventory writers**, not only REBOOK, before REBOOK may rely on it. REBOOK targeting `cabinId`-only inventory is **blocked** until §24 S1 closes. Multi-unit targets continue to use `UnitNightClaim`.

### 23.6 Replacement Booking creation timing

**Do NOT persist a staging Booking** before target inventory is secured.

Existing Booking fields/statuses are insufficient for a safely invisible staging Booking:

- `pending` would block inventory and appear operationally
- `archived` still participates in some conflict paths
- `isTest` has wrong semantics

**Lock:** during precommit REBOOK, durable state lives on:

- StayChange
- source snapshot
- target snapshot
- target claims/holds

Replacement Booking is created **only AFTER** target inventory has been durably secured and immediately before/within the forward commit phase.

**No new generic Booking staging status** is introduced.

### 23.7 Product shapes

Canonical commercial key remains:

```text
cabinTypeId ? "cabinType:" + cabinTypeId
  : cabinId ? "cabin:" + cabinId
  : invalid
```

REBOOK v1 source/target shapes:

| Shape | Fields |
|-------|--------|
| SINGLE | `cabinId` set; `cabinTypeId` null; `unitId` null |
| ALLOCATED MULTI | `cabinTypeId` set; `unitId` set; `cabinId` null |

**Reject:**

- mixed `cabinId` + `cabinTypeId`
- missing commercial product
- unallocated multi
- LocationBooking-linked source/target
- whole-location inventory

Same commercial product is **NOT** REBOOK.

### 23.8 StayChange schema expansion

REBOOK requires StayChange expansion. Add to locked conceptual schema:

- `targetBookingId`
- `sourceCabinId`, `targetCabinId`
- existing `sourceCabinTypeId`, `targetCabinTypeId`, `sourceUnitId`, `targetUnitId` — **shape-dependent** rather than universally required
- immutable `sourceSnapshot` and `targetSnapshot` sufficient for: idempotency, recovery, financial evidence, commercial identity, dates, guests, target quote, operator decisions

REALLOCATE validation remains exactly as R1. REBOOK gets kind-specific service validation. Schema may allow nullable shape fields, but service validation must **fail closed**.

### 23.9 Source contractual total

Introduce one canonical resolver:

```text
resolveSourceContractualTotalCents(booking)
```

Semantics:

- prefer `totalValueCents` when valid
- otherwise normalized `round(totalPrice * 100)`

Equivalent to existing `bookingRevenueCents` semantics.

**Freeze `sourceContractualTotalCents`** inside StayChange `sourceSnapshot` **BEFORE** source mutation. Do not recompute from a cancelled/mutated source later. Do not use the existing cancellation helper if it only reads `totalPrice` and conflicts with `totalValueCents` normalization.

### 23.10 Recognized transferable coverage

Introduce canonical future helper:

```text
resolveRecognizedNetSettledCoverageCents(source)
```

Must distinguish contractual value from actually recognized coverage.

**COUNT:**

- successful paid Payment rows
- recognized partial captured Payment rows
- valid source `giftVoucherAppliedCents`

**DO NOT COUNT:**

- failed Payment
- unpaid Payment
- promo discount as separate coverage
- waiver
- pending/unsettled payment
- refunded cash already returned

**DISPUTED / CHARGEBACK:** FAIL CLOSED for REBOOK v1.

**MANUAL/CASH WITHOUT DURABLE PAYMENT EVIDENCE:** FAIL CLOSED when the Booking appears financially settled but no reliable evidence exists. Do **NOT** silently treat an ambiguous paid manual booking as zero coverage.

If source is genuinely unpaid with no paid evidence: coverage may correctly be zero.

### 23.11 Payment evidence precedence

Avoid double-counting Payment trail plus Booking stripe aggregate.

**Lock:**

| Rule | |
|------|--|
| A | If canonical Payment trail exists and is internally consistent: derive cash coverage from Payment trail. |
| B | Only when no canonical Payment trail exists may legacy `stripePaidAmountCents` be used as fallback. |
| C | If both exist and materially disagree: **FAIL CLOSED / reconciliation-required.** Do not `max()`, add(), or silently prefer the larger figure. |
| D | Add `giftVoucherAppliedCents` once as non-cash coverage if evidence is valid. |
| E | Cap transferable value at source contractual total. |

**Canonical formula:**

```text
recognizedNetSettledCoverageCents =
  recognizedNetCashCoverageCents
  + recognizedVoucherCoverageCents

transferredValueCents =
  min(
    sourceContractualTotalCents,
    recognizedNetSettledCoverageCents
  )
```

All values integer cents. Zero tolerance.

### 23.12 REBOOK money ledger

StayChange is the canonical REBOOK value ledger. Lock fields conceptually including:

- `canonicalTargetQuoteCents`
- `sourceContractualTotalCents`
- `transferredValueCents`
- `waivedUpgradeCents`
- `additionalChargeCents`
- `refundCents`, `creditCents`, `retainedCents`
- `contractualTargetTotalCents`
- `settlementType`
- incremental payment/voucher references as needed later

**Do NOT** represent these by mutating source payment provenance.

### 23.13 Batch S3 money scope

First REBOOK mutation batch supports **ONLY:**

| Case | |
|------|--|
| A | target canonical quote **equals** source contractual value |
| B | target canonical quote is **MORE expensive** and operator explicitly waives some or all of the upgrade difference |

**Not in S3:**

- Stripe upgrade collection
- downgrade
- refund
- credit
- retained-value downgrade settlement
- split cash+waive collection

**Later:** downgrade disposition = later batch; paid/partial upgrade = later batch.

### 23.14 Waiver semantics

For an upgrade:

```text
canonicalTargetQuoteCents = target rack/canonical quote
waivedUpgradeCents = explicit operator waiver
contractualTargetTotalCents = canonicalTargetQuoteCents - waivedUpgradeCents
```

Waiver reduces **CONTRACTUAL** target obligation. Waiver **does NOT** create coverage.

Example:

```text
source contractual = 10000
recognized coverage = 4000
target canonical = 14000
waived = 4000

replacement contractual = 10000
transferred coverage = 4000
remaining obligation = 6000
```

Replacement is **NOT** magically paid. Do not write waiver to promo/`discountAmount`.

### 23.15 Replacement payment status / Booking status

REBOOK requires payment classification to understand transferred coverage through:

```text
replacement.settledByStayChangeId
```

Future canonical coverage:

```text
transferredValueCents from StayChange
+ genuinely incremental paid coverage on replacement
+ new valid voucher coverage on replacement
```

Replacement is financially settled **iff** `coverage >= contractualTargetTotalCents` (zero tolerance).

REBOOK replacement Booking status on commit:

| Condition | Status |
|-----------|--------|
| canonical REBOOK coverage fully settles contractual target total | `confirmed` |
| otherwise | `pending` |

This is a dedicated REBOOK creator rule. **Do NOT** infer settlement from waiver alone. **Do NOT** copy source Stripe/voucher fields to manufacture proof.

### 23.16 Payment classifier prerequisite

Before Batch S3 mutation is considered ready, payment/read-model classification must understand `settledByStayChangeId` and read transferable coverage from the completed/active REBOOK StayChange.

Without this, a transfer-covered replacement would incorrectly appear unpaid. **This is a mandatory prerequisite.**

### 23.17 Target-first ordering

Lock standalone-Mongo ordering. **No multi-document transaction assumption.**

Conceptual flow:

1. load/validate source
2. canonical source money snapshot
3. canonical target quote
4. validate operator settlement intent
5. durable StayChange pending
6. acquire **TARGET** inventory tagged to StayChange
7. verify full target ownership
8. StayChange `inventory_secured`
9. create replacement Booking from locked snapshot
10. project replacement commercial/financial fields
11. mark StayChange `ready_to_commit` / `committed` as exact implementation requires
12. project source: `cancelled`, `rebooked_or_moved`, `replacementBookingId`
13. release **SOURCE** inventory
14. verify final inventory invariants
15. complete StayChange
16. exactly-once audit

The implementation audit may refine status-write placement but must preserve the safety boundaries.

**Never release source first.**

### 23.18 Source release boundary

**Pre-source-projection failure:**

- source remains canonical
- source inventory stays
- compensate REBOOK-owned target resources only
- replacement Booking, if created but source not projected, must be safely compensated/removed according to durable facts
- StayChange may fail cleanly

**After source has durably become** `cancelled` + `rebooked_or_moved` + `replacementBookingId`:

- the operation crosses the **forward-only** boundary
- do **NOT** blindly resurrect source
- do **NOT** release target
- recover forward; MRI if ambiguous
- finish source inventory cleanup
- finish audit/projections
- complete StayChange

### 23.19 Multi target claim ownership

For multi-unit target, `UnitNightClaim` must use:

- `bookingId` = replacement Booking when available according to final claim ownership design
- `stayChangeId` = REBOOK StayChange
- `source` = `rebook`

The spec implementation audit must resolve the temporary pre-replacement ownership detail because replacement Booking creation is deferred.

**Preferred durable design:**

- target claims may initially be StayChange-owned, then become replacement Booking-owned only through an explicit safe mechanism

**OR**

- replacement id is generated before persistence and used consistently

**Do NOT** weaken unique `{ unitId, night }` authority. **Do NOT** let a second StayChange borrow another REBOOK's target claims. This exact ownership transition must be resolved before implementation.

### 23.20 Single target claim ownership

Future `CabinNightClaim` follows equivalent semantics:

```text
cabinId, night, bookingId / future replacement id, stayChangeId, source = rebook
```

| Case | Result |
|------|--------|
| Same StayChange | idempotent |
| Different StayChange | conflict |
| Foreign Booking | conflict |

Permanent claim remains after completed REBOOK under replacement Booking.

### 23.21 External hold policy

No new hold policy.

| Inventory | Policy |
|-----------|--------|
| Internal authoritative inventory | hard conflict, no override |
| External Airbnb/iCal AvailabilityBlock | warning only; explicit operator acknowledgment required |

Never automatically acknowledge.

### 23.22 Promo / voucher

- Source promo and redemption remain historical.
- **Do NOT** automatically carry source promo to replacement.
- **Do NOT** increment promo usage again.
- Source voucher redemption remains historical.
- **Do NOT** copy redemption id/application fields to replacement.
- Transferred source voucher coverage is represented only through `transferredValueCents` / StayChange snapshot.
- A genuinely **NEW** voucher against future additional obligation is later scope and must use normal voucher redemption flow.
- **Waiver is never promo.**

### 23.23 Replacement field copy policy

**COPY:** `guestInfo`, contact preferences where canonical, `checkIn`, `checkOut`, `adults`, `children`, `specialRequests`, `cleaningNotes`, `tripType`, `transportMethod`, `romanticSetup`, `craft`, legalAcceptance snapshot.

**REQUOTE / REBUILD:** commercial inventory identity, contractual totals, payment classification.

**DO NOT COPY:** source Payment ids, Stripe intent/session ids, checkout ids, promo redemption, voucher redemption, source paid aggregates as fake replacement money, `locationBookingId`.

**RESET / suppress:** confirmation lifecycle markers, normal booking-created notification behavior, conversion attribution.

### 23.24 Creator / attribution

Source retains historical attribution. Replacement must **NOT** copy UTM/referral/creator attribution fields that would cause a second conversion or commission.

Set replacement provenance: `source = stay_change_rebook`.

**Do not call** normal booking-created conversion hooks, Meta purchase hooks, or creator accrual hooks for replacement creation.

Reporting must explicitly exclude `rebooked_or_moved` source from creator gross logic where current cancelled-booking aggregation would otherwise count it. Do not count replacement as a second creator acquisition.

### 23.25 Revenue reporting

After completed REBOOK:

| Entity | Rule |
|--------|------|
| source | `cancelled`, `rebooked_or_moved`; active commercial revenue = 0; historical evidence remains |
| replacement | count `contractualTargetTotalCents` **ONCE** as active commercial value |
| `transferredValueCents` | **not** additional revenue |
| `waivedUpgradeCents` | **not** revenue; **not** promo |
| Payments | cash reporting remains based on real payment provenance |
| Creator gross | must not count both source and replacement |

Required reporting guards belong to REBOOK prerequisite/implementation batches.

### 23.26 Messaging / GMA

Batch S3 deliberately sends **NO automatic guest move email.** No move template exists today.

**Suppress:**

- normal cancellation lifecycle email on source
- normal `booking_received` / `booking_confirmed` messages on replacement
- normal replacement creation notifications
- duplicate conversion messaging/hooks
- GMA/arrival scheduling caused merely by replacement creation

Do not use generic cancel/create service paths that emit these side effects. A dedicated intentional **"stay moved"** guest notice is **later scope**.

### 23.27 Location / unallocated

REBOOK v1 **rejects:**

- `source.locationBookingId` set
- unallocated multi source
- unallocated multi target
- whole-location product

Target multi must be explicitly allocated to one Unit before mutation commit. LocationBooking remains out of scope.

### 23.28 `settledByStayChangeId`

Add to replacement Booking:

```text
settledByStayChangeId
```

This is the **only required canonical** Booking → StayChange financial link. It permits later cancellation/payment readers to resolve transferred value, waiver, contractual target total, and future additional payments/refunds/credits.

**No generic `movedFromBookingId` is required for correctness.** Any future navigation convenience field requires separate justification.

### 23.29 Idempotency

Reuse exact durable index:

```text
{ kind, bookingId, idempotencyKey }
```

`bookingId` = source Booking.

REBOOK fingerprint must bind immutable accepted intent including:

- source Booking
- source commercial product
- target commercial product
- target unit when multi
- checkIn/checkOut
- guests/capacity inputs
- canonical target quote
- source contractual snapshot
- recognized transferable snapshot
- waiver/operator settlement choice
- external-hold acknowledgment
- reason

Existing scoped key lookup must occur **BEFORE** deriving fresh mutable source state where replay requires stored snapshot.

| Case | Result |
|------|--------|
| Same key + same fingerprint | replay/resume |
| Same key + changed fingerprint | 409 |

No soft fallback.

### 23.30 Crash recovery

Focused REBOOK reconciler must derive durable facts, not trust state labels alone.

Cover:

- StayChange pending, no target claims
- partial target claims
- full target claims
- `inventory_secured`, no replacement Booking
- replacement created, source untouched
- replacement committed, source untouched
- source projected moved, source inventory stale
- source inventory released, StayChange incomplete
- audit missing
- foreign/ambiguous target ownership
- another REBOOK won
- payment classifier discrepancy

| Phase | Recovery |
|-------|----------|
| Before source projection | resume or exact own-target compensation |
| After source projection | forward-only recovery |
| Ambiguous | `needs_reconciliation` + MRI |

### 23.31 Audit / MRI

New MRI category: `stay_change_rebook_reconciliation` (or exact canonical equivalent). Safe identifiers only. No unnecessary guest PII.

Audit action: `reservation_rebook` (or exact canonical equivalent). Exactly-once durable dedupe tied to StayChange.

Audit failure must **not** undo a safely completed move.

### 23.32 REBOOK read / OPS UX later

**Do NOT generalize R3:** `GET …/reallocate-candidates` remains same-product Unit selection.

REBOOK later gets separate product-level preview, conceptually:

```text
GET /api/ops/reservations/:id/rebook-targets
```

Must return: commercial products, capacity, availability, target unit choices where applicable, external warnings, canonical quote, delta/waiver context. **No second availability engine** — use canonical conflict/pricing services.

UI later uses separate action initially: **Rebook** or **Change accommodation**. **Do NOT merge** current Move Unit UI in first backend batch.

### 23.33 First implementation batch order (LOCKED)

| Stage | Scope |
|-------|--------|
| **REBOOK-S0** | this spec amendment |
| **REBOOK-S1** | single-cabin permanent night-claim foundation and production cutover — **§24** |
| **REBOOK-S2** | StayChange REBOOK schema/spine; source/target snapshots; money fields; canonical contractual/coverage resolvers; payment classifier support for `settledByStayChangeId`; reporting/attribution guards required for safe replacement — **IMPLEMENTED (schema/spine only; no mutation endpoint)** |
| **REBOOK-S3** | REBOOK mutation: equal-price; upgrade with explicit complimentary waiver; no Stripe delta; no downgrade |
| **REBOOK-S4** | read preview + first OPS Rebook UI |
| **REBOOK-S5** | downgrade refund/credit/retain |
| **REBOOK-S6** | paid/partial upgrade collection |
| **Later** | unified Move / Modify stay router/wizard |

**Do NOT collapse S1–S3.**

**S2 delivered artifacts (no production index cutover):** `StayChange` REBOOK fields (`targetBookingId`, cabin shape fields nullable, `sourceSnapshot`/`targetSnapshot`, `money`); `Booking.settledByStayChangeId` (optional, no index); helpers in `server/services/stayChange/rebookStayChangeSpine.js` + `rebookMoneyEvidence.js` + `commercialProductIdentity.js`; payment classifier + creator gross guards. **Out of S2:** REBOOK API, replacement Booking create, claim/Payment/Stripe mutation, client, Cleaning.
### 23.34 S1 safety requirement

**Full lock:** **§24**. S1 must be treated like I6 infrastructure.

Before authoritative cutover it must audit **ALL** existing single-cabin blocking Bookings and ensure permanent `CabinNightClaim`s match exactly.

It must cover **all production single-cabin inventory writers** before the unique claim index becomes authoritative.

**No REBOOK targeting single-cabin may deploy before §24 S1 closes** (S1.6 + S1.7 + post-cutover verification).

### 23.35 S2 financial fail-closed rule

S2 must refuse REBOOK when recognized source coverage cannot be determined reliably.

Examples: disputed payment; chargeback ambiguity; Payment trail / Booking paid aggregate inconsistency; manual/cash booking that appears paid without durable evidence; invalid legacy contractual total.

**Do not guess.** Create reconciliation/MRI or explicit unsupported operational response as appropriate.

### 23.36 Test contract

Final REBOOK implementation must eventually include **at least 150 meaningful scenarios** across staged batches.

S1 requires dedicated infrastructure tests analogous to I1–I6.

S2/S3 must cover at least:

- eligibility; product shape; single→multi; multi→single once S1 live; multi→different-multi
- same-product rejection; Location rejection; unallocated rejection
- target-first ordering; never source-first; operation-scoped target ownership; concurrency
- idempotency; replay after source projection; fingerprint mismatch; crash recovery
- equal-price fully paid / partially paid / unpaid; voucher-covered; €0 source
- upgrade full waiver / partial waiver; waiver does not create coverage
- disputed fail closed; manual cash ambiguous fail closed; Payment/stripe discrepancy fail closed
- source Payments unchanged; no fake replacement Payments; no copied Stripe aggregate; no voucher double redemption; no promo re-use
- replacement pending/confirmed classification; `settledByStayChangeId` classification
- creator attribution not copied; no second conversion; no double creator gross; no double active revenue
- normal cancellation email suppressed; replacement create/confirm emails suppressed; no automatic move email; GMA not duplicated
- source projection; source inventory release; replacement inventory permanent
- audit dedupe; MRI dedupe; reconciliation
- R1 156 baseline; I1–I6 baseline; R3 baseline; Cleaning non-regression

Add actual implementation discoveries.

### 23.37 Out of scope

Do **NOT** include in REBOOK v1 / S3:

- AMEND
- date change
- guest-count change during REBOOK
- LocationBooking
- whole-location move
- same-product REALLOCATE rewrite
- Cleaning redesign
- duplicate A-Frame 02 cleanup
- StayChange history UI
- automatic move email
- Stripe upgrade collection in S3
- downgrade/refund in S3

---

## 24. REBOOK-S1 — CabinNightClaim foundation (LOCKED)

**Production baseline (S1.6.1):** `8bdec9cba10fca3d07c884fbd21e86464cdec847`
**Depends on:** I6 authoritative `UnitNightClaim` (live).
**Purpose:** Lock **REBOOK-S1** as the permanent **single-cabin inventory-integrity** foundation. This is **NOT** a REBOOK-specific hold table.

**CabinNightClaim** becomes the permanent occupied-night ownership primitive for every authoritative Booking writer using:

```text
cabinId set
cabinTypeId null
unitId null
```

**No application implementation** is authorized by §24 alone. **S1.7 writer cutover** is locked in **§24.44** and still requires separate implementation authorization.

### 24.1 Purpose and conceptual model

| Field | |
|-------|--|
| `cabinId` | required |
| `night` | required (Sofia civil day-start) |
| `bookingId` | required |
| `stayChangeId` | optional/null |
| `source` | required (stable provenance) |
| `createdAt` | required |

Occupied-night semantics: **`[checkIn, checkOut)`**
Timezone: **Europe/Sofia civil dates**
Authoritative exclusivity: **ONE owner** for each `{ cabinId, night }`

### 24.2 Architectural role

| Layer | Role |
|-------|------|
| **Booking** | commercial reservation source of truth |
| **CabinNightClaim** | authoritative **INTERNAL** single-cabin occupied-night exclusivity |
| **UnitNightClaim** | authoritative **INTERNAL** allocated multi-unit occupied-night exclusivity |
| **AvailabilityBlock** | manual / maintenance / external / checkout / location holds and optional projection state |
| **`Cabin.blockedDates`** | legacy/read compatibility where still applicable |

**Locks:**

- AvailabilityBlock **MUST NOT** become the uniqueness authority for single-cabin reservations.
- External Airbnb/iCal AvailabilityBlocks **NEVER** create CabinNightClaims.

### 24.3 Claim-owning Booking shape

**Canonical single-cabin claim shape:**

```text
cabinId present
cabinTypeId absent
unitId absent
```

**Canonical blocking statuses:** `pending`, `confirmed`, `in_house`
**Nonblocking:** `completed`, `cancelled`

Malformed mixed product identities are **NOT** silently normalized. A Booking with both `cabinId` and `cabinTypeId` must be reported **malformed** and must **block authoritative cutover** until inventory ownership is understood or explicitly excluded by a later approved repair.

### 24.4 Test / archived policy

Lock CabinNightClaim expected ownership to operational Booking semantics:

```text
status ∈ { pending, confirmed, in_house }
AND valid single-cabin commercial shape
AND isTest !== true
AND archivedAt absent
```

**Location child Bookings** are **NOT** excluded merely because they have `locationBookingId`. If a LocationBooking child has valid blocking single-cabin shape, it **must** own CabinNightClaims.

**Current asymmetry (must not change silently):** public single-cabin availability may still count `isTest` / `archived` Bookings while OPS/base filters exclude them. S1 **MUST NOT** silently change guest-facing availability semantics during shadow/dual-write phases. Reader migration must be **explicit and tested**. Do not make an unrelated public-availability behavior change merely by introducing claims.

### 24.5 Night generation

Reuse existing canonical night semantics:

- `expandOccupiedSofiaNightDateOnlys(checkIn, checkOut)` (`server/services/ops/reporting/stayNights.js`)
- existing Europe/Sofia day-start normalization (`server/utils/dateTime.js`)

**Do NOT** implement another timezone/night iterator.

Occupied nights are exactly **`[checkIn, checkOut)`**. Checkout day is **not** claimed.

Reject/report: invalid dates; same-day zero-night stay where invalid by current domain; negative/inverted ranges; unparseable legacy dates. DST behavior must follow the same Sofia civil-night logic already used by UnitNightClaim reporting/integrity tooling.

### 24.6 Minimal data model

Lock minimal fields only (see §24.1). **No `updatedAt` required.**

**Do NOT add:** guest data; Booking dates; cabin name; Booking status; price; payment data; availability labels; duplicated commercial projections.

Claim rows are **ownership facts only**.

### 24.7 Authoritative unique index

**Exact authoritative unique index:**

```text
keys:  { cabinId: 1, night: 1 }
name:  cabinNightClaim_cabinId_night_unique
unique: true
```

**Critical deployment rule:**

- **DO NOT** rely on ordinary Mongoose startup/index synchronization to create this authoritative unique index.
- **DO NOT** allow application startup to create it before controlled cutover.
- Define the authoritative index specification centrally for validation and the S1 cutover tool.
- Create the actual unique index **ONLY** through the explicit controlled S1 cutover command after all gates pass.

If useful, ordinary **non-unique** operational indexes may remain schema-managed:

```text
{ cabinId: 1 }
{ night: 1 }
{ bookingId: 1 }
{ stayChangeId: 1 }
{ bookingId: 1, cabinId: 1 }
```

**Do not** automatically delete a legacy/wrong index.

**Startup:** `autoIndex: false` for authoritative unique (mirror UnitNightClaim I6 pattern).

### 24.8 Claim source semantics

`source` records **stable acquisition provenance**, not every later operation that touched the claim.

Use a controlled service allowlist (not uncontrolled free-form; not an unnecessarily rigid schema enum that complicates migrations).

Conceptual allowed provenance:

```text
finalize | legacy_create | manual_reservation | location_child |
date_edit | reassign | rebook | bootstrap | recovery | test | other
```

Implementation may tighten names during S1.1, but semantics must remain **stable provenance**.

### 24.9 Claim ownership

**Permanent ownership:**

```text
bookingId = Booking._id that owns the occupied night
```

Normal create/edit/reassign: `stayChangeId = null` unless an explicit StayChange owns the operation.

REBOOK target:

```text
bookingId = pre-generated future replacement Booking._id
stayChangeId = REBOOK StayChange._id
source = rebook
```

| Case | Result |
|------|--------|
| Same Booking reclaiming same cabin/night | idempotent |
| Different Booking | hard conflict |
| Different StayChange borrowing another operation's target claim | hard conflict |

**No silent claim reassignment.**

### 24.10 Pre-generated Booking id

Lock preferred REBOOK and create-path pattern:

1. generate Booking `ObjectId` **BEFORE** persistence
2. acquire target claims using that exact future Booking id
3. persist Booking later using the **exact same `_id`**

Repository precedent: manual reservation creation; multi-unit checkout finalization; LocationBooking child creation.

**No temporary StayChange-only ownership/rebinding** is required for the normal design.

### 24.11 Claim service contract

Conceptually require:

```text
claimCabinNights(...)
releaseCabinNights(...)
releaseStayChangeTargetCabinClaims(...)
assertBookingOwnsCabinNights(...)
listCabinNightClaims(...)
compensateCabinClaimAttempt(...)
assertAuthoritativeCabinNightIndex(...)
```

A range-replacement helper may be implemented for date/cabin changes but must preserve **target-first** semantics.

Parameters must bind: `cabinId`, `bookingId`, `checkIn`, `checkOut`, `source`, optional `stayChangeId`. **No guest data.**

### 24.12 Multi-night acquisition

After unique cutover, Mongo uniqueness is the hard race barrier.

For N occupied nights: acquire every required `{ cabinId, night }` ownership row.

If acquisition fails part-way:

- compensate **ONLY** rows inserted by **THIS** attempt
- **do NOT** remove pre-existing same-owner claims, foreign-owner claims, or claims outside this attempt's deterministic insertion set

Surface deterministic errors conceptually: `FOREIGN_OWNER`, `PARTIAL_ACQUISITION`, `COMPENSATION_FAILED` (exact names finalized in S1.1).

### 24.13 Release semantics

**Delete-on-release.**

Release when a Booking ceases to own inventory:

- cancelled
- completed
- date shrink/shift removes nights
- cabin reassignment vacates source cabin
- failed create compensation
- location finalize rollback
- REBOOK source release after forward boundary
- safe reconciliation of deterministic stale ownership

**Do NOT** release merely because payment state changes.

### 24.14 Create writer coverage

S1 must eventually cover **every** authoritative single-cabin CREATE writer, including:

- legacy booking POST path while it remains live
- V2 checkout/finalization
- checkout finalization worker
- paid checkout recovery / historical recovery paths
- OPS manual reservation creation
- LocationBooking single-cabin child creation
- any production-reachable equivalent discovered during implementation

**No writer** may remain capable of creating a blocking single-cabin Booking without corresponding claim ownership after S1 authority flips.

### 24.15 Authoritative create ordering

**After S1 authority:**

1. generate Booking `_id`
2. validate current conflict policy
3. claim CabinNightClaims
4. verify full ownership
5. persist authoritative blocking Booking
6. perform remaining safe projections/side effects
7. on failure compensate only operation-owned claims

Claims exist **before** the Booking becomes authoritative/blocking. Public external-hold policy remains unchanged.

**S1.7 elaboration (crash, finalize, legacy, manual, Location):** **§24.44.6–§24.44.11**.

### 24.16 Shadow / dual-write phase semantics

**Critical distinction:**

| Phase | Canonical inventory |
|-------|---------------------|
| **Before unique-index authority** | Booking remains canonical |
| **After unique index + writer readiness + authority flip** | claim-first mandatory; claim conflict = hard internal inventory failure |

During shadow/dual-write:

- existing Booking mutation succeeds/fails according to existing production semantics
- CabinNightClaims mirror the resulting Booking ownership
- claim mismatch/failure is logged/reported for reconciliation
- claim shadow failure must **not** pretend exclusivity exists when unique authority is not live
- foreign ownership/collision findings are **cutover blockers**

**Do NOT** call the pre-authority phase "authoritative claim-first inventory."

S1 dual-write must **NOT** unexpectedly change guest-facing booking behavior.

### 24.17 Date change ordering

**After authority:**

1. determine old and new occupied-night sets
2. preserve already-owned overlap
3. claim all **NEW** required nights first
4. verify complete target ownership
5. CAS/commit Booking dates
6. release old nights no longer required

**Never release old nights first.**

If Booking date commit fails: release only newly acquired nights belonging to this attempt. Existing overlapping claims remain.

**S1.7 elaboration:** **§24.44.12**.

### 24.18 Single-cabin Reassign ordering

Legacy single-cabin Reassign **must be included** before S1 authority.

**After authority:**

1. validate target cabin
2. claim target cabin occupied nights
3. verify ownership
4. commit `Booking.cabinId`
5. release source cabin claims

Internal claim conflict: **hard, no override.** External Airbnb/iCal warning policy: **unchanged.**

A production Reassign path that can mutate `cabinId` without claim conversion is an **S1 cutover blocker**.

**S1.7 elaboration (including locked AvailabilityBlock cabin projection sync):** **§24.44.13**.

### 24.19 Location child rule

LocationBooking children with `locationBookingId` + valid single-cabin shape **must** participate in CabinNightClaim ownership when their Booking status blocks inventory.

This closes the current gap where single-cabin children skip the UnitNightClaim path.

**Do not redesign LocationBooking.** Multi-unit Location children continue using UnitNightClaim.

### 24.20 Paid checkout race

**After authoritative claim-first acquisition**, if payment is already successful but target CabinNightClaim acquisition loses a race:

- do **NOT** create/confirm a second overlapping Booking
- do **NOT** delete or rewrite Payment evidence
- do **NOT** silently choose another cabin
- preserve durable paid checkout/recovery evidence
- suppress inappropriate normal guest confirmation where existing recovery policy requires review
- route to deterministic paid-checkout recovery / MRI / needs-review behavior

**At most one Booking** may own the disputed cabin-night.

### 24.21 AvailabilityBlock

**Do NOT** create mandatory reservation AvailabilityBlocks merely because CabinNightClaim exists.

Booking + CabinNightClaim are sufficient permanent internal reservation facts.

AvailabilityBlock remains for: manual block; maintenance; external_hold; checkout/location holds; existing optional reservation projections.

External blocks do **not** create claims.

### 24.22 Reader migration

| Phase | Reader truth |
|-------|--------------|
| **Before S1 authority** | Booking overlap + AvailabilityBlock remain current reader truth; claims are shadow/reconciliation evidence |
| **After unique authority + all writers converted** | CabinNightClaim = hard internal exclusivity for **mutation safety**; Booking overlap may remain defense / reconciliation / commercial read / legacy compatibility |

**Do NOT** require every public/calendar reader to switch to claim-based queries in the same deployment that creates the unique index. Reader migration must be staged and regression-tested. **No semantic change** to external hold policy.

### 24.23 Expected claim set

S1 integrity tooling computes expected CabinNightClaim set from every valid blocking single-cabin Booking satisfying §24.4.

Expected identity: `{ cabinId, Sofia occupied night, bookingId }`. `stayChangeId` / `source` do not change expected ownership identity for bootstrap parity.

For every expected claim there must eventually be **exactly one** canonical claim row.

### 24.24 Production preflight classification

Read-only S1 audit must report at minimum:

```text
blocking Bookings scanned
valid single-cabin blocking Bookings
expected occupied-night claims
actual CabinNightClaim rows
missing claims | stale claims | orphan claims
wrongCabin | outsideRange
sameOwnerDuplicates | foreignOwnerDuplicates/collisions
claimsForNonblockingBooking | claimsForMultiInventoryBooking
malformed mixed commercial shapes
missing/invalid cabin references | invalid dates
zero/negative occupied ranges
Location child counts | isTest/archived excluded counts
scan completeness
```

**No production mutation** in default verify mode.

### 24.25 Foreign collisions

**Canonical foreign collision:** same `{ cabinId, night }` expected by more than one distinct blocking Booking owner, or an existing claim owned by a different Booking than canonical expected owner.

- **Never** auto-select a winner.
- Foreign collisions are **hard blockers** for authoritative unique cutover.
- Report safe identifiers: booking ids, cabin id, night, status/type classification. **Avoid guest PII.**

### 24.26 Backfill

Backfill: generate expected claims; insert missing uncontested ownership rows with `source = bootstrap`.

Requirements: idempotent; restartable; batchable; safe under live dual-write traffic; machine-readable output.

Existing correct claims: leave unchanged. Foreign collision: report and refuse winner selection.

**Do not** mutate Bookings. **Do not** perform destructive foreign-ownership repair.

### 24.27 Reconciliation

Permanent reconciliation must detect: missing; stale; orphan; wrongCabin; outsideRange; sameOwnerDuplicates; foreignOwnerDuplicates; claimsForNonblockingBooking; claimsForMultiInventoryBooking; invalid/malformed ownership.

**Safe deterministic repairs may include:**

- insert missing uncontested own claim
- delete stale own claim for definitively nonblocking Booking
- delete wrong-cabin/outside-range own claim and restore expected own claim when uncontested
- deduplicate exact same-owner duplicates pre-unique
- release obvious orphan/wrong-collection claims when deterministic

**Never auto-repair:** foreign-owner collision; ambiguous Booking shape; ambiguous cabin ownership. Those **fail closed** / require explicit repair.

### 24.28 Live traffic cutover

**Do NOT** perform audit / backfill / unique index while legacy writers continue creating blocking Bookings with no claim dual-write.

Minimum safe progression:

```text
dual-write compatibility on ALL writers
→ production audit/backfill
→ stable verification
→ unique index
→ authoritative claim-first mode
```

If all writer coverage cannot be proven under live traffic: use a controlled writer pause/maintenance window for final cutover.

**Do not** assume I6 exact deployment sequence fits without verifying single-cabin writers.

### 24.29 S1 sub-batches (LOCKED)

| Stage | Scope |
|-------|--------|
| **S1.1** | CabinNightClaim model/service foundation; night helper reuse; non-authoritative indexes; cutover specification constants; tests; **NO unique authority** |
| **S1.2** | shadow/dual-write **ALL** single-cabin inventory writers; Booking remains canonical; observability/parity |
| **S1.3** | read-only production preflight/audit |
| **S1.4** | idempotent production backfill under dual-write |
| **S1.5** | stable clean verification — minimum **two** clean equivalent canonical fingerprints |
| **S1.6** | controlled authoritative unique index creation |
| **S1.6.1** | post-authority `--verify` exit-code correction (`readyForStableVerification` success path); readiness semantics unchanged |
| **S1.7** | authoritative claim-first writer mode; mode=`authoritative`; exact-index per-acquire + inventory-writer boot gates; archive release; AB reassign cabin projection sync — **§24.44** |
| **S1.8** | post-cutover reconciliation; safe deterministic repairs only; foreign ambiguity → MRI/manual |

**Do not collapse S1.1–S1.7.** S1.7 implementation contract is locked in **§24.44**.

### 24.30 Stable verification

Require **at least TWO** clean full-scan verification passes before unique cutover.

Canonical fingerprint must **exclude volatile timestamps** and bind:

```text
sorted expected ownership tuples
sorted foreign collision tuples
expected claim count | actual canonical claim count
malformed/invalid blockers | drift-class counts
scan completeness
```

If the repository's proven I6 fingerprint pattern can represent this without losing information, **reuse that architecture**.

Unique cutover requires: full scan; clean pass; prior matching clean fingerprint; no intervening blocker.

### 24.31 Cutover tool

Lock one controlled S1 tool:

```text
server/scripts/cabinNightClaimS1Cutover.js
```

(Exact name may remain unless implementation finds a repository naming conflict.)

| Mode | Behavior |
|------|----------|
| **Default** | **READ-ONLY VERIFY** |
| `--backfill` | explicit mutation |
| `--create-unique-index` | explicit mutation |

Support machine-readable JSON; prior/stable fingerprint gating.

The tool must **NEVER** create the unique index merely because the model is loaded.

### 24.32 Unique-index refusal gates

Refuse authoritative unique-index creation if **ANY** of:

```text
scan not full
expected missing claims | unsafe stale/orphan drift
foreign-owner collision
same-key duplicate rows incompatible with unique creation
malformed blocking Booking | invalid cabin reference
invalid occupied-night range | wrongCabin/outsideRange unresolved
claim on wrong inventory shape
writer readiness incomplete | dual-write coverage incomplete
prior stable fingerprint absent when required
current fingerprint differs from accepted prior fingerprint
existing conflicting/wrong index state | tool/inventory scan failure
```

**Do not** automatically drop an existing wrong index.

### 24.33 Startup safety

Ordinary production process startup **MUST NOT** be able to perform the authoritative S1 cutover.

Application startup may **verify/assert** the authoritative index **after S1.6**, but **creation** belongs to the controlled cutover tool.

`autoIndex` must not create the unique authority. Do not rely solely on developer convention if a schema/syncIndexes path could accidentally create it.

**S1.7:** exact-index **read-only** boot assertion for inventory writers when `CABIN_NIGHT_CLAIM_MODE=authoritative` is locked in **§24.44.4** / **§24.44.24**.

### 24.34 Writer readiness

Before S1.6/S1.7, production must prove every process capable of single-cabin inventory mutation runs claim-compatible code.

Repo-known critical writers: **main API** and **finalize worker**.

Also **production-audit the live PM2 process list** before cutover. Do not assume `ecosystem.config.cjs` is complete.

Messaging/confirmation-only workers need not write claims unless runtime audit proves otherwise.

**S1.7:** authoritative path completeness + archive-under-`status_release` locked in **§24.44.15** / **§24.44.23**.

### 24.35 Deployment ordering

Conceptual production progression:

```text
deploy S1.1/S1.2 compatible code
→ restart every inventory writer
→ verify versions/SHA
→ verify dual-write readiness
→ run S1.3 → S1.4 → S1.5 (twice/stably)
→ run S1.6 unique cutover
→ S1.6.1 verify-exit correction (live)
→ deploy S1.7 while env remains shadow
→ controlled env flip to authoritative (§24.44.28)
→ verify all inventory writer processes
→ run S1.8 reconciliation
```

Exact deploy commands deferred until implementation and production audit. **S1.7 cutover sequence is locked in §24.44.28.**

### 24.36 Rollback

| Phase | Posture |
|-------|---------|
| **Pre-authority** | Booking canonical; claim shadow can be disabled/reverted; claims may remain as inert evidence; no need to mutate Booking history merely to rollback code |
| **Post-authority** | do **NOT** casually drop the unique index; do **NOT** return to writers that bypass claims while index/data model is authoritative; prefer **forward repair** |

Distinguish: code rollback; feature/authority flag rollback; data repair; index rollback — **these are not equivalent**.

### 24.37 Observability

S1 requires structured low-PII observability for:

```text
claim acquisition conflict | foreign owner | partial acquisition
compensation success/failure | shadow mismatch | writer lacking readiness
backfill inserted/skipped/collided | reconciliation drift
cutover fingerprint | index missing/wrong | paid checkout claim failure
```

Reuse existing logging/MRI infrastructure. **No new monitoring platform.**

### 24.38 Cleaning

**NO Cleaning changes.** Cleaning remains Booking-derived. CabinNightClaim is inventory integrity only. No Cleaning calendar/read-model dependency on claim rows is introduced by S1.

### 24.39 Reporting

CabinNightClaim is **NOT:** revenue; payment; occupancy reporting ledger; creator attribution; conversion evidence.

**No financial/reporting migration** belongs to S1. Existing reporting remains Booking/payment based.

### 24.40 REBOOK dependency

REBOOK targeting a `cabinId`-only product is **forbidden** until:

1. **S1.6** unique authority is live
2. **S1.7** claim-first writer mode is live
3. post-cutover verification has **no blocking drift**

REBOOK multi-unit work may rely on UnitNightClaim separately, but the locked overall S3 cross-product feature must respect product-specific inventory authority.

### 24.41 Test contract

S1 implementation must contain **at least 140 meaningful tests** across sub-batches.

**S1.7 alone** must contain **at least 120** meaningful S1.7-focused assertions/scenarios (**§24.44.27**).

Must include:

- model validation; startup/index safety; index specification
- Sofia night generation; DST; half-open range; single-night; invalid range
- same-owner idempotency; foreign-owner rejection; multi-night acquisition; partial acquisition; attempt-scoped compensation; concurrent races
- V2 finalize; legacy create; OPS manual create; Location child; recovery
- blocking / terminal statuses; isTest; archived; Location child; malformed mixed shape
- date extension / shortening / shift; date commit failure compensation
- single-cabin Reassign; target-first ordering; reassign commit failure
- cancel; complete; failed create; location rollback
- paid checkout race; payment evidence preservation; MRI/recovery
- shadow writer behavior; shadow failure does not falsely claim authority; dual-write parity; writer readiness
- preflight; backfill; restartability
- missing / stale / orphan / wrongCabin / outsideRange / same-owner duplicates / foreign collisions / wrong inventory collection
- stable fingerprint; full-scan requirement; cutover refusal gates; unique-index exactness; wrong-index refusal
- authoritative claim-first behavior; index assertion; post-cutover reconcile
- AvailabilityBlock external/manual behavior unchanged
- public availability regression; OPS availability regression
- UnitNightClaim regression; I1–I6 regression; R1 regression; R3 regression; Cleaning non-regression

Implementation may add cases discovered during code work.

### 24.42 Production unknown policy

Do **not** fabricate production data assumptions into the spec.

Known unknowns requiring later production verification:

- existing foreign overlapping single-cabin Bookings
- historical paid overlap anomalies
- current exact live PM2 writer list
- existing future CabinNightClaim/index state when deployed

These are **S1.3/cutover facts**. They do **NOT** block this architecture/spec lock. They **DO** block authoritative cutover if unresolved.

### 24.43 Out of scope

Do **NOT** include:

- REBOOK mutation implementation
- AMEND
- REBOOK money implementation
- REBOOK UI
- Cleaning redesign
- LocationBooking redesign
- duplicate A-Frame Unit cleanup
- multi-unit UnitNightClaim redesign
- new public external-hold policy
- financial reporting redesign

### 24.44 S1.7 — Authoritative claim-first writer cutover (LOCKED)

**Purpose:** Lock the exact **S1.7** implementation contract before code authorization.

S1.7 is the **AUTHORITATIVE CABIN NIGHT CLAIM WRITER CUTOVER**. It switches single-cabin internal inventory mutations from:

```text
Booking-first + best-effort claim shadow
```

to:

```text
CabinNightClaim-first hard database authority
```

while preserving:

- Booking commercial / canonical record semantics
- AvailabilityBlock as projection / external-hold representation
- existing payment / messaging behavior
- UnitNightClaim semantics
- REBOOK scope boundary (S1.7 does **not** implement REBOOK)
- standalone Mongo compensation model (no multi-document transaction requirement)

**No application implementation is authorized by this subsection alone.** Implementation requires a separate authorization after this lock is committed.

#### 24.44.1 Production preconditions

Before production **authority env flip**:

- CabinNightClaim parity clean (`expected = actual`, all drift/collision classes = 0)
- exact permanent unique index exists:

```text
name: cabinNightClaim_cabinId_night_unique
key:  { cabinId: 1, night: 1 }
unique: true
```

- S1.6.1 post-authority verify exits **0** when clean
- Current production before S1.7 cutover remains:

```text
CABIN_NIGHT_CLAIM_MODE=shadow
Booking still canonical for inventory mutation ordering
```

**Deploy rule:** S1.7 code **MUST** be deployable while env remains `shadow`. The env flip to `authoritative` is a **separate controlled production action** after deploy verification.

#### 24.44.2 Canonical claim qualification

One qualification source only. A Booking owns CabinNightClaims only when:

```text
commercial shape VALID_SINGLE:
  cabinId present
  cabinTypeId absent
  unitId absent
status ∈ { pending, confirmed, in_house }
isTest !== true
archivedAt absent
valid Cabin reference
valid [checkIn, checkOut) Europe/Sofia occupied-night range
```

LocationBooking single-cabin children **participate** when they satisfy the above.

S1.7 writers **MUST** reuse the canonical qualification helpers (`shouldBookingOwnCabinNightClaims` / shared exact helpers). **No** second writer-specific definition of blocking inventory.

#### 24.44.3 Mode contract (`CABIN_NIGHT_CLAIM_MODE`)

One mode module governs behavior. No scattered bespoke env parsing.

| Mode | Behavior |
|------|----------|
| **off** | Legacy Booking behavior; no CabinNightClaim writes. Retained for development / controlled emergency compatibility. **NOT** permitted as a normal production mode after successful S1.7 authority cutover. Rollback from `authoritative` → `off` is **outside S1.7** and requires a separately controlled procedure. |
| **shadow** | Current S1.2 behavior: Booking canonical mutation first; claim mirror/release best effort; failures observed but do not gate Booking. |
| **authoritative** | S1.7 behavior: claim-first hard internal exclusivity; internal conflict fails closed; exact unique index required; claim failures gate canonical mutations where target inventory is being acquired; source claims are **never** released before canonical ownership moves away. |

#### 24.44.4 Exact-index runtime gate

**A. Per-acquisition gate.** Authoritative `claimCabinNights` must assert exact authority before acquiring (existing foundation).

**B. Process startup gate.** When `mode=authoritative`, the two inventory-writing processes must perform a **READ-ONLY** exact-index assertion before becoming healthy / serving inventory mutations:

1. `driftdwells` API
2. `driftdwells-finalize-worker`

**Do NOT** require this for: `driftdwells-gma-worker`, `driftdwells-confirmation-worker`.

Startup assertion must:

- read index metadata only
- never create / drop / sync indexes
- fail closed if authority missing / wrong

Environment loading must be reliable for both process CWDs. Do not rely on the finalize worker's CWD implicitly finding `server/.env`.

#### 24.44.5 Claim service reuse

Reuse:

- `claimCabinNights`
- `releaseCabinNights`
- attempt-scoped compensation
- `assertAuthoritativeCabinNightIndex`

Preserve: same-owner idempotency; StayChange compatibility; foreign-owner hard conflict; E11000 conflict handling; owner-scoped release; attempt-owned compensation only.

**Do NOT** create a second authority service. S1.7 is writer orchestration + mode conversion.

#### 24.44.6 CREATE ordering

For every **NEW** blocking single-cabin Booking:

1. pre-mint stable Booking ObjectId
2. construct/validate canonical booking payload
3. run existing UX / external-hold checks where applicable
4. acquire all required CabinNightClaims using `bookingId = pre-minted id`, `acquisitionMode = authoritative`
5. verify target ownership
6. persist Booking using exact pre-minted id
7. create/sync AvailabilityBlock reservation projection
8. continue payment / messaging / confirmation side effects
9. if Booking persistence fails: compensate **ONLY** claims inserted by this attempt
10. if compensation itself fails: retain conservative claims; emit reconciliation-required evidence; do not delete/steal foreign claims

**Never** save Booking first and claim afterward under authoritative mode.

#### 24.44.7 CREATE crash semantics

| Boundary | Behavior |
|----------|----------|
| Crash before target claim | safe retry |
| Crash after claim before Booking persist | possible orphan conservative claims owned by pre-minted `bookingId` |
| Retry with SAME operation / booking identity | same-owner acquisition is idempotent |
| Operation cannot safely resume | S1.8 reconciliation handles orphan determination |

**Never** solve by: generating a new `bookingId` on every retry; blind claim deletion; foreign-owner release.

#### 24.44.8 Finalize

V2 checkout finalization single-cabin authoritative acquisition must mirror the proven UnitNightClaim preclaim architecture:

1. resolve/preserve stable Booking identity before persistence
2. if final Booking qualifies as blocking single: acquire CabinNightClaims **before** Booking survival/save
3. hard claim conflict prevents second Booking creation
4. preserve payment / finalization evidence
5. preserve finalize replay / idempotency
6. preserve existing paid-race MRI / recovery behavior
7. after Booking survival: AvailabilityBlock / confirmation / messaging remain side effects
8. Booking failure: compensate attempt-owned CabinNightClaims

A paid inventory race must **NEVER** create a second Booking merely because payment already exists. Payment evidence remains durable and is resolved by existing recovery/MRI semantics.

#### 24.44.9 Legacy create

Legacy POST create must pre-mint Booking `_id`.

Existing overlap checks may remain for UX / external hold warnings / early error messaging, but they are **NOT** exclusivity authority.

Authoritative sequence: pre-mint id → claim nights → persist Booking → projection/side effects.

Foreign internal owner: hard conflict; no override; no second Booking. Booking persistence failure: attempt-owned claim compensation.

#### 24.44.10 OPS manual create

Manual reservation already pre-mints `_id`. Authoritative sequence: existing validation/external warning policy → claim target nights → persist Booking → projection → existing post-save checks if still needed.

If a later canonical race/guard invalidates the create and the Booking is removed: make Booking nonblocking/delete first where already persisted, **then** release owner claims — unless claims belong solely to a pre-persist failed attempt.

Internal claim conflict: deterministic staff inventory conflict; **no override**.

#### 24.44.11 Location single-cabin children

For each single-cabin child: pre-mint child `_id` → claim child's nights → persist child Booking. Multi-unit children remain governed by UnitNightClaim.

For mixed location checkout failure, distinguish:

| Case | Behavior |
|------|----------|
| **A. Claim acquired but child Booking never persisted** | safe attempt compensation of that child's attempt-owned claims |
| **B. Child Booking already persisted and still blocking** | **DO NOT** release its claims first. Rollback: (1) make persisted Booking nonblocking/remove canonical child → (2) then owner-scope release its claims |

Reason: release-first would temporarily expose inventory while a blocking Booking still exists.

If canonical rollback succeeds but claim release fails: leave conservative stale claim; emit reconciliation evidence; S1.8 resolves safely.

Standalone Mongo remains compensation-based. No fake transaction abstraction.

#### 24.44.12 Date edit target-first

For blocking valid single-cabin Booking date edit, compute old/new occupied-night sets; derive:

```text
intersection = retained
newOnly     = target nights not already owned
oldOnly     = surplus source nights
```

Authoritative sequence:

1. acquire `newOnly` target nights first
2. verify ownership
3. commit Booking date mutation
4. sync reservation AvailabilityBlock date projection
5. release `oldOnly` source nights
6. final ownership/invariant verification where practical

**Never** release `oldOnly` before Booking date commit.

| Failure | Behavior |
|---------|----------|
| Target claim conflicts | no Booking date mutation |
| Booking commit fails after `newOnly` acquisition | compensate only `newOnly` inserted by this attempt |
| AB projection fails after Booking commit | do not revert into unsafe source-first state; retain conservative claims as needed; record reconciliation-required evidence |
| Source release fails | Booking already owns new dates; extra old claims remain conservative; record/retry owner-scoped release; do not revert Booking merely to remove stale claims |

#### 24.44.13 Reassign target-first + AB cabin projection

S1.7 does **NOT** change product-routing policy. Legacy Reassign remains only for the currently permitted legacy scope until REBOOK replaces cross-product behavior.

For any valid single-cabin `cabinId` reassignment that still exists:

1. calculate target cabin occupied-night keys
2. claim **TARGET** cabin nights first for existing `bookingId`
3. verify target ownership
4. commit `Booking.cabinId` target
5. sync reservation AvailabilityBlock **`cabinId` projection** to target cabin
6. release **SOURCE** cabin claims last
7. verify final ownership where practical

**LOCKED AB decision:** S1.7 **DOES** update reservation-scoped AvailabilityBlock `cabinId` projection during a successful single-cabin Reassign. Reason: AB remains a legacy/read projection and external-hold representation. It is **NOT** the internal authority, but knowingly leaving reservation blocks attached to the old cabin after authoritative Booking reassignment would create avoidable projection drift. This is **projection synchronization only**. Do **NOT** make AB a competing exclusivity gate.

| Failure | Behavior |
|---------|----------|
| Internal target conflict | hard failure; no override; Booking remains on source; source claims remain owned |
| Booking save failure after target acquisition | compensate attempt-owned target claims; source remains untouched |
| AB projection failure after Booking commit | **DO NOT** release source claims yet if doing so would make legacy projection inconsistent with the operational recovery contract; leave conservative dual claim occupancy; record reconciliation-required evidence; retry projection/release |
| Once projection synced | release source claims owner-scoped |
| Source-release failure | target Booking + target claims remain; source claim remains conservative; reconciliation required; do not revert Booking |

#### 24.44.14 Status release

For transition from blocking owner state to nonblocking (`cancelled`, `completed`, `archived`, deleted where production workflow supports it):

1. canonical Booking must cease blocking **FIRST**
2. then release owner-scoped CabinNightClaims

**Never** release claim first while Booking still canonically blocks. Release must be retry-safe.

If release fails after canonical transition: do not reopen Booking; do not delete foreign claims; leave conservative claim; emit reconciliation-required evidence; allow deterministic retry / S1.8 repair.

#### 24.44.15 Archive gap (IN SCOPE)

**LOCK** `archiveReservation` into S1.7 scope.

Current archive: cancel/archive + AB tombstone but **no** CabinNightClaim release. S1.7 must correct this.

Archive sequence:

1. canonical Booking becomes non-owning
2. AB projection/tombstone as existing architecture requires
3. owner-scoped CabinNightClaim release

If claim release fails: archive remains durable; claim remains conservative; structured reconciliation evidence; S1.8 handles safe repair.

Treat archive as part of **`status_release`** writer readiness unless a separate registry key is demonstrably cleaner. Do not add a new arbitrary readiness key without reason.

#### 24.44.16 Maintenance delete invariant

For a persisted blocking Booking: canonical delete/nonblocking state must not occur after inventory was prematurely released.

Preferred safety invariant:

```text
while Booking still blocks → claim remains held
once Booking no longer blocks → claim may be released
```

If current maintenance delete releases-before-delete, S1.7 must make ordering safe under authority. For pre-persist fixture attempts, attempt compensation remains allowed. Do not conflate fixture cleanup with production authority semantics.

#### 24.44.17 External holds

External Airbnb/iCal holds remain AvailabilityBlock records. They **NEVER** become CabinNightClaims.

| Conflict type | Semantics |
|---------------|-----------|
| Internal claim conflict | hard; no override |
| External hold | warning + explicit acknowledgement in workflows that already support it |

External warning acknowledgement **must not** bypass internal claim authority.

#### 24.44.18 Error contract

Reuse existing claim error codes wherever possible.

| Class | Code / mapping |
|-------|----------------|
| Foreign / internal ownership conflict | `CABIN_NIGHT_CLAIM_FOREIGN_OWNER` → normally 409 / `NOT_AVAILABLE`-style depending on endpoint |
| Authority index absent | `CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING` → fail closed / inventory unavailable |
| Authority index wrong | `CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_WRONG` → fail closed / inventory unavailable |
| Validation | existing 400-style semantics |
| Release after canonical commit failed | do **not** convert successful cancel/archive/etc. back into inventory conflict; record reconciliation-required state/event |
| Paid finalize conflict | preserve payment evidence; no duplicate Booking; MRI/recovery path |

Use endpoint conventions already present. Do not introduce arbitrary new public status codes if existing equivalents fit.

#### 24.44.19 Idempotency

| Writer | Stable identity |
|--------|-----------------|
| Finalize | checkout/finalize replay identity + pre-minted Booking `_id` |
| Legacy | stable pre-minted `_id` within the request/attempt, reused through claim + Booking persistence |
| Manual | existing OPS identity / pre-mint |
| Location | pre-minted child ids |
| Date edit | existing `bookingId` + target date fingerprint/operation attempt; same-owner claims idempotent |
| Reassign | existing `bookingId` + target cabin operation; same-owner target claim idempotent |
| Status release | `bookingId` owner-scoped release idempotent |

Do **NOT** generate a fresh claim owner merely because the same logical operation retries inside one controlled flow.

#### 24.44.20 Crash matrix (minimum)

| Category | Boundary | Behavior |
|----------|----------|----------|
| **CREATE** | before target claim | safe retry |
| | after target claim before Booking | attempt compensation if synchronous failure; otherwise conservative orphan → retry/reconcile |
| | after Booking before projection | Booking + claim authoritative; retry projection |
| **DATE EDIT** | after `newOnly` claim before Booking commit | compensate `newOnly` on known failure |
| | after Booking commit before AB | Booking/new claims authoritative; old claims retained; reconcile/retry projection |
| | after AB before `oldOnly` release | safe conservative overlap; retry release |
| **REASSIGN** | after target claim before Booking | compensate target |
| | after Booking before AB target projection | both source+target claims may remain; reconcile projection |
| | after AB before source release | safe conservative dual hold; retry release |
| **STATUS RELEASE** | after canonical nonblocking before claim release | claim remains conservative; retry release/reconcile |

**Unacceptable states:** foreign claim deletion; source-first release; silent internal double booking; second Booking after paid race; Booking claims belonging to unrelated owner.

#### 24.44.21 Reconciliation boundary

S1.7 must include **MINIMUM** durable/structured evidence when a writer cannot finish safely (examples: claim acquisition succeeded but compensation failed; Booking changed but AB projection failed; canonical terminal/archive succeeded but claim release failed; reassign Booking switched but source release failed; paid finalize claim race).

Use existing MRI/recovery/audit/event patterns where available.

**S1.7 does NOT** build the full S1.8 reconciliation/repair CLI. Conservative extra claims are preferred over unsafe release. **S1.8** owns deterministic repair after cutover.

#### 24.44.22 Observability

Extend existing low-PII structured CabinNightClaim observability. Semantic events such as:

```text
authority_claim_acquired
authority_claim_conflict
authority_claim_compensated
authority_claim_compensation_failed
authority_claim_release_failed
authority_index_unavailable
authority_reconciliation_required
```

Use existing JSON logging/event conventions. **No guest PII** (name, email, phone, address, special requests). Safe identifiers may include: `bookingId`, `cabinId`, night/count, operation/source, claim ids where useful. Do not build a monitoring subsystem.

#### 24.44.23 Writer readiness

Intended registry:

```text
finalize
legacy_create
manual_reservation
location_child
date_edit
reassign
status_release
```

Archive belongs under **`status_release`** unless implementation proves a separate key materially improves correctness.

S1.7 cannot report code-ready for authoritative mode until every registry writer has an authoritative path. Implementation must repeat a repository-wide static search for production single-cabin Booking mutations. No hidden/unregistered blocking writer may remain Booking-only while authoritative mode is enabled.

#### 24.44.24 Startup / process safety

- Deploy S1.7 first while env remains `shadow`.
- In authoritative mode: API must refuse inventory service readiness if exact index assertion fails; finalize worker must refuse/start-fail if exact index assertion fails.
- GMA and confirmation workers do not require CabinNightClaim index boot gates.
- No startup code may: create index; drop index; repair claims; backfill claims. **Read-only assertion only.**

#### 24.44.25 Non-touch locks

| Domain | Rule |
|--------|------|
| **UnitNightClaim** | Do not alter schema, unique index, multi-unit authority ordering, R1 REALLOCATE, I1–I6 behavior. Shared orchestration may be reused carefully without regressing multi-unit inventory. |
| **REBOOK** | Do not implement StayChange REBOOK mutation, replacement Booking workflow, money transfer, upgrade waiver, downgrade, Stripe delta, or REBOOK OPS UI. S1.7 only satisfies the single-cabin authority prerequisite for later REBOOK. |
| **Readers** | Do not migrate public/internal readers to CabinNightClaim. Public availability, calendar, conflictService, OPS availability preview remain on existing authority until a later planned migration. Claim authority applies to **WRITES** / internal exclusivity barrier. |
| **Also out** | `client/`; Cleaning behavior; payment/pricing semantics; Stripe flows; CabinNightClaim index create/drop; S1.4 backfill behavior; S1.6 cutover behavior; full S1.8 reconcile/repair; unrelated refactoring. |

#### 24.44.26 Expected implementation touch set

Expected application touch areas (exact paths as in repository at implementation time):

- `server/services/inventory/cabinNightClaimMode.js`
- CabinNightClaim shadow / mode-aware writer wrappers
- `server/services/checkout/executeBookingFinalizeWork.js` (or exact current finalize path)
- `server/routes/bookingRoutes.js`
- `server/services/ops/domain/reservationWriteService.js`
- `server/services/locationCheckout/locationCheckoutService.js`
- `server/services/maintenance/maintenanceOpsService.js`
- CabinNightClaim observability / readiness
- API + finalize startup read-only assertion path
- `server/scripts/cabinNightClaim.s7.test.cjs` (+ minimal directly affected existing tests)

#### 24.44.27 S1.7 test lock

Require **at least 120** meaningful S1.7-focused assertions/scenarios (prefer more if writer coverage requires it).

Must cover: mode (`off`/`shadow`/`authoritative`/invalid); authoritative exact-index startup gate; missing/wrong index; finalize claim-first (pre-mint, retry, foreign/unpaid/paid conflict, Booking save compensation, compensation-failure recon); legacy create; manual create (external warning vs internal hard conflict; post-save rollback ordering); Location (single child claim-first; mixed single/multi; pre-persist compensation; persisted-child canonical-first then release; release failure conservative; no UnitNightClaim regression); date edit (extension/contraction/shift; retained intersection; claim only `newOnly`; target conflict; Booking/AB/release failure paths; retry); Reassign (target-first; AB cabin projection update; AB failure retains source; source release last/failure; retry); status (cancel/complete/archive/maintenance delete as applicable; canonical-before-release; repeated release; release-failure recon); authority service (same-owner; foreign; E11000; index missing/wrong; attempt-only compensation); external vs internal; startup gates for API + finalize worker; non-touch UnitNightClaim/R1/Cleaning/client/REBOOK/payment; regressions S1.1–S1.6.1, I1–I6, R1, R3 service/route, Cleaning baseline.

#### 24.44.28 Production cutover sequence (DO NOT execute in S1.7 implementation)

S1.7 implementation does **NOT** itself flip production env.

Eventual controlled production sequence:

1. production on clean S1.6.1 baseline
2. deploy exact S1.7 code with `CABIN_NIGHT_CLAIM_MODE=shadow`
3. restart API + finalize worker
4. verify both on exact SHA / online / shadow
5. health
6. full CabinNightClaim verify: exact authority; parity clean; zero drift/collisions
7. verify S1.7 writer-code readiness complete
8. verify exact-index boot assertion succeeds
9. controlled production env change: `CABIN_NIGHT_CLAIM_MODE=authoritative`
10. restart API + finalize worker with `--update-env`
11. verify **BOTH** inventory writers authoritative
12. refuse mixed shadow/authoritative writer state
13. health
14. full read-only CabinNightClaim verify
15. inspect structured authority events
16. no arbitrary real Booking mutation required for smoke
17. stop before S1.8

**Forbidden:** one writer authoritative while another remains shadow; authority with missing/wrong index; switching production to `off` casually after authority cutover; dropping/rebuilding index during writer flip.

#### 24.44.29 S1.8 boundary (OUT of S1.7)

Locked **out** of S1.7:

- full post-cutover reconciliation CLI
- deterministic orphan/stale repair tooling
- foreign ambiguity resolution
- reader migration / final authority closure
- legacy cleanup
- claim backfill/rebuild
- index rebuild
- REBOOK

S1.8 follows only after S1.7 production authority cutover is verified.

### 24.45 S1.8 — Post-cutover reconciliation (LOCKED)

**Purpose:** Close the CabinNightClaim foundation after authoritative cutover with deterministic, conservative reconciliation.

| | |
|--|--|
| **IN** | read-only verify; deterministic safe repairs; foreign/ambiguous → MANUAL + MRI; post-repair verify; exit 0/2/1 |
| **OUT** | reader migration; legacy shadow-path cleanup; REBOOK; index create/drop/rebuild; claim backfill rebuild; client; Cleaning; payment/pricing; UnitNightClaim; R1 |

#### 24.45.1 Tool

```text
server/scripts/cabinNightClaimS1Reconcile.js
server/services/inventory/cabinNightClaimS1ReconciliationService.js
```

| Invocation | Behavior |
|------------|----------|
| default / `--verify` | READ-ONLY plan + classify; **zero** claim mutations |
| `--repair --apply-safe-repairs` | BOTH flags required; applies only SAFE plan items; then fresh verify |
| either flag alone | refuse (exit 1) |

#### 24.45.2 Repair matrix

| Class | Action |
|-------|--------|
| missing (uncontested) | SAFE_INSERT via `claimCabinNights` authoritative |
| claimsForNonblockingBooking / claimsForExcludedBooking | SAFE_RELEASE owner-scoped |
| wrongCabin / outsideRange | SAFE_TARGET_FIRST (target claim → then surplus release) |
| sameOwnerDuplicates | SAFE dedupe extras by claimId (keep lowest id) |
| orphan | MANUAL (`ORPHAN_AMBIGUOUS`) — never auto-delete |
| foreignClaimConflicts / foreignOwnerDuplicates / canonicalCollisions | MANUAL |
| malformed Booking/claim / invalid cabin / invalid dates / multi-inventory / malformed shape | MANUAL |

#### 24.45.3 Invariants

- Exact unique index required for mutation; refuse if missing/wrong
- Target-first: never release surplus before target secured
- Target conflict: stop; retain source; no claim stealing
- Source release failure after target success: retain conservative extra; recon evidence
- Idempotent rerun
- No guest PII in reports/MRI
- No createIndex/dropIndex/syncIndexes
- Post-mutation always re-verifies; `clean` only when parity + no manual blockers + no repair failures

#### 24.45.4 Exit codes

| Code | Meaning |
|------|---------|
| **0** | `clean === true` (verify clean or repair completed clean) |
| **2** | completed with remaining manual/drift/refusal (not a tool crash) |
| **1** | tool failure / invalid flags |

---

### Batch 2 — StayChange spine (amend/rebook-ready) — **SUPERSEDED for REBOOK by §23.33**

| | |
|--|--|
| **Status** | Legacy Batch 2–5 REBOOK rows superseded by **REBOOK-S0…S6** (§23.33). AMEND spine portions remain conceptually aligned with **Batch 6**. |
| **REBOOK path** | S0 (spec) → S1 (§24 CabinNightClaim) → S2 (schema/spine/classifiers) → S3 (first mutation) → S4 (preview/UI) → S5/S6 (money expansion) |

---

### Batch 3 — REBOOK base — **SUPERSEDED by REBOOK-S2 + REBOOK-S3 (§23)**

| | |
|--|--|
| **Was** | Combined spine + mutation + move email |
| **Now locked** | S2 = spine/classifiers/guards; S3 = equal-price + upgrade-with-waiver only; **no automatic move email** (§23.26) |

---

### Batch 4 — Downgrade settlement — **SUPERSEDED by REBOOK-S5 (§23.33)**

| | |
|--|--|
| **Delivered (when approved)** | Negative-delta outcomes per §23.13 later scope |

---

### Batch 5 — Upgrade paid/partial — **SUPERSEDED by REBOOK-S6 (§23.33)**

| | |
|--|--|
| **Delivered (when approved)** | Stripe upgrade collection; partial/paid upgrade per later batch |

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
| **Delivered** | Single UI action; automatic mode routing across REALLOCATE / AMEND / REBOOK; preview (conflicts, canonical vs contractual, delta disposition, email plan, attribution impact); confirm commit. Builds on R3 Move Unit for the REALLOCATE path — does not replace R3’s dedicated Move Unit as the first REALLOCATE surface. |
| **Touched** | `OpsReservationDetail` / new wizard components; `opsApi`; permissions `ops.reservation.stay_change` (name TBD in batch) |
| **Invariants proven** | Operator cannot select illegal REALLOCATE/REBOOK mix-ups via UI |
| **Required tests** | Classifier unit tests; permission tests; preview/commit contract tests |
| **Prod verification** | Operator walkthrough all three kinds |
| **Still unsupported** | Deep reconciliation dashboards |
| **Prerequisite** | R3 Move Unit LIVE for pre-stay REALLOCATE; AMEND/REBOOK domain batches as required |

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

- Exact Mongoose indexes and unique keys for StayChange (REBOOK idempotency locked §23.29).
- ~~Whether optional `movedFromBookingId` thin pointer is added on replacement~~ — **not required for correctness** (§23.28); separate justification if added later.
- Multi-unit target claim ownership transition before replacement Booking persistence (§23.19) — resolve in implementation audit.
- ~~CabinNightClaim S1 cutover gates, writer graph, fingerprint~~ — locked in §24.
- Exact guest email template copy and provider (SMTP / existing lifecycle pipeline) — **automatic move email out of S3 scope** (§23.26).
- Permission string naming.
- Feature flag names and rollout order per propertyKind.
- ~~UnitNightClaim I6 unique-index migration tooling shape~~ — locked in I6 (`unitNightClaimI6Cutover.js`; explicit `--create-unique-index`; no auto-enforce before cutover).

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
| 2026-08-21 | Amendment: I6 authoritative cutover — unique named index via explicit CLI (no legacy drop; Mongo 7 coexistence); autoIndex false; once-per-acquisition index guard; claim-first writers + compensation primary (no txn dependency); paid/voucher demotion; date-edit secure-target-first; reassign hard-block; pooled cabinType capacity fix; Location compensation atomicity; shadow wrappers removed/converted; REALLOCATE still disabled. |
| 2026-08-21 | Amendment: R1 minimal StayChange REALLOCATE — pre-stay pending/confirmed only; cabinType-only unit move; durable StayChange + scoped idempotency; staged target claims → Booking CAS → reservation block sync → source release; do not wire combined transferUnitNightClaims as sole workflow; external holds reassign-style ack; focused reconcile; separate OPS reallocate route; no UI (R3); no settledByStayChangeId; ≥90+105 test contract. |
| 2026-08-23 | Amendment: R3 OPS Move Unit — detail inventory identity; read-only `GET …/reallocate-candidates` via `evaluateTargetConflicts`; Move Unit dialog/selector/ack/idempotency; legacy Reassign visibility boundary; structured error map; ≥80 test contract; no AMEND/REBOOK/wizard; R1 indexes already live (not an R3 blocker). |
| 2026-08-23 | Amendment: REBOOK cross-product stay change (§23) — `bookingId` = source only (no `sourceBookingId`); `targetBookingId`; `CabinNightClaim` S1 prerequisite; deferred replacement Booking create; contractual/coverage resolvers; fail-closed financial evidence; S3 equal-price + upgrade-waiver only; `settledByStayChangeId`; target-first ordering; attribution/reporting/messaging guards; REBOOK-S0…S6 staged batches; ≥150 test contract; supersede legacy Batch 2–5 REBOOK rows. |
| 2026-08-23 | Amendment: REBOOK-S1 CabinNightClaim foundation (§24) — permanent single-cabin occupied-night exclusivity; claim-owning Booking rule; test/archived policy; night helper reuse; authoritative unique index + startup safety; claim service contract; shadow/dual-write vs authority; create/date/reassign ordering; Location child rule; paid checkout race; backfill/reconcile/fingerprint gates; S1.1–S1.8 sub-batches; cutover tool; ≥140 S1 test contract; REBOOK single-cabin blocked until S1.6+S1.7+verification. |
| 2026-08-26 | Amendment: S1.7 authoritative claim-first writer cutover lock (§24.44) — mode contract; exact-index per-acquire + API/finalize boot gates; CREATE/finalize/legacy/manual/location/date-edit/reassign/status-release orderings; AB reassign cabin projection sync; archive under status_release; maintenance delete invariant; crash/recon/observability; ≥120 S1.7 tests; shadow-deploy then env flip; S1.8 boundary; REBOOK/reader/UnitNightClaim/Cleaning non-touch. |
| 2026-08-26 | Amendment: S1.8 post-cutover reconciliation lock (§24.45) — verify-default CLI; dual-flag repair; safe insert/release/target-first matrix; orphan/foreign MANUAL; exact-index gate; exit 0/2/1; no reader migration / legacy cleanup / REBOOK. |

---

**END OF LOCKED ARCHITECTURE — R1 LIVE; R3 LIVE; REBOOK §23 + S1 §24 SPEC LOCKED (THROUGH S1.8 RECONCILIATION §24.45); NO REBOOK APPLICATION AUTHORIZED BY DOCS ALONE**
