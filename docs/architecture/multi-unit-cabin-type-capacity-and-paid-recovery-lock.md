# Architecture Lock: Multi-Unit CabinType Capacity Guard and Paid Orphan Recovery

**Status:** BINDING DESIGN — implementation must follow this document  
**Created:** 2026-08-01  
**Remediated:** 2026-08-03 (post REJECTED audit — trust boundary, recovery lease, dry-run purity, paid-loser retention, self-exclusion, MRI suppression)  
**Scope:** Immediate allowlisted recovery of one paid multi-unit orphan (R0 / S0), permanent capacity-aware same-cabinType booking behavior (R1 / S1), deferred quantity-two UX (R2 / S2)  
**Branch basis:** `origin/master`  
**Out of scope:** Confirmation-worker Batches 1–3, PM2 confirmation-worker process, automatic refunds, public quantity=2 checkout

This document is the single source of truth for the multi-unit cabinType capacity and paid-orphan recovery sidequest. Application code must not diverge from these decisions without an explicit architecture revision.

**Prior audit verdict addressed:** `REJECTED — ARCHITECTURE REMEDIATION REQUIRED`. This remediation supersedes the 2026-08-01 draft where it conflicts.

---

## CURRENT PRODUCTION SAFETY STATE

> **Operational freeze for this incident (as of this lock):**

- First booking `6a6da47c5d2bf6cbd804d7a5` remains **confirmed** on unit `69b2ff947f141a71ffa7c445` (AF-04 / “A-Frame 3”) for 2026-09-08 → 2026-09-10.
- Second PaymentIntent `pi_3TzXfaITK7w1tlgb03q2fRj4` remains **paid**.
- Payment record `6a6da522d383478dc62c43cb` remains **paid and unlinked** (`reservationId` null at audit time).
- CheckoutSession for checkout `93b9d631-7531-4b62-896b-ba5553f0c013` (Mongo `_id` `6a6da502b6410db9d013ec20`) remains **paid / unfinalized** (`bookingId` null).
- CheckoutFinalizationJob `6a6da522b6410db9d013ec7c` remains **`failed_permanent`** at stage `acquire_lock` with `lastErrorCode=DUPLICATE_STAY_CONFLICT`.
- ManualReviewItem `6a6da522d383478dc62c43cf` remains **open**.
- AF-03 (`69b2ff947f141a71ffa7c444`) was available at audit time and **must be rechecked** at dry-run and execute.
- No refund and no recovery have been executed under this sidequest.
- PM2 process `driftdwells-confirmation-worker` remains **stopped**. Confirmation-worker remediation is a **separate track**.

**Hard operator bans until S0 is deployed and dry-run evidence is approved:**

- Do **not** click Resolve on the manual review.
- Do **not** insert a raw Booking.
- Do **not** refund until guest intent is confirmed **or** recovery is explicitly rejected.
- Do **not** sell AF-03 again until live availability is rechecked and incident disposition is approved.
- Do **not** start the confirmation worker.
- Do **not** clear fingerprints, disable the commercial guard globally, or execute recovery before S0 deploy + approved dry-run.

This document does **not** authorize production access or executable production commands from Cursor.

---

## 0. Binding problem statement

### 0.1 Incident classification

**Combined defect:**

1. **Unsupported quantity flow** — public booking supports one unit per checkout only; no `quantity=2`.
2. **Commercial-stay exclusivity defect relative to multi-unit inventory** — `commercialStayFingerprint` / `stayFingerprint` hash guest email + `cabinType` + cabinTypeId + dates and **deliberately exclude `unitId`** (`bookingCommercialStayFingerprint.js`, `checkoutSessionFingerprints.js`). The C3 guard therefore treats two legitimate same-guest cabinType units as one exclusive commercial stay.
3. **Money-path ordering gap** — exclusivity is enforced at finalization (`assertCheckoutSessionReadyForFinalize` / `assertCommercialStayClearAfterLock`), not before PaymentIntent creation.

Not inventory unavailable. Not a unit-allocation defect. Allocation never ran for the second checkout.

### 0.2 Proven root cause (repository)

- Fingerprint: `stay-v1|normalizedEmail|cabinType|<cabinTypeId>|<checkIn>|<checkOut>` → sha256.
- Guard: `commercialStayGuardService.js` — Booking statuses `pending|confirmed|in_house` (not archived); sessions `finalizeStatus` ∈ `in_progress|finalized`.
- Job: `DUPLICATE_STAY_CONFLICT` ∈ `PERMANENT_ERROR_CODES` → immediate `failed_permanent`, stage `acquire_lock`.
- Taxonomy bug: `safeDetails.permanent` may be `false` while job is permanent — must share one classifier (S1 / taxonomy module).

### 0.3 Tracks

| Track | Purpose |
|-------|---------|
| **R0 / S0** | Allowlisted recovery of this paid orphan; no global guard behavior change |
| **R1 / S1** | Capacity-aware same-cabinType booking behind `MULTI_UNIT_CAPACITY_STAY_GUARD` |
| **R2 / S2** | Client sequential UX + quantity rejection; no quantity-two product |

Confirmation-worker Batches 1–3 remain a separate lock.

---

## 1. S0 recovery trust boundary

### 1.1 Module ownership

| Layer | Path |
|-------|------|
| Authoritative recovery entrypoint | `server/services/checkout/multiUnitPaidOrphanRecoveryService.js` → **`recoverAllowlistedMultiUnitPaidOrphanCheckout(...)`** |
| CLI (only calls recovery entrypoint) | `server/scripts/recoverMultiUnitPaidOrphanCheckout.js` |
| Private capability token | Unexported `Symbol` (or closure-only object) defined inside `multiUnitPaidOrphanRecoveryService.js` and accepted **only** by narrow internal hooks |
| Commercial guard | `commercialStayGuardService.js` — bypass only when private capability present |
| Exact-unit injection | Private recovery path sets `finalizeContext.assignedUnitId` after live validation |
| Job lease / success | New recovery-specific helpers in `checkoutFinalizationJobService.js` |
| Confirmation | `ensurePendingConfirmationDelivery` / `processBookingConfirmationDelivery({ send: false })` |

### 1.2 Capability rules (binding)

The recovery module creates a **module-private** capability, preferably:

```js
// multiUnitPaidOrphanRecoveryService.js — NOT exported
const RECOVERY_CAPABILITY = Symbol('multiUnitPaidOrphanRecoveryCapability');
```

Rules:

- Commercial-stay exclusivity bypass and exact-unit assignment are accepted **only** when this private capability is present on an internal options bag that never leaves the recovery call stack.
- The capability must **never** be:
  - stored in MongoDB
  - serialized to JSON / logs / allowlists
  - accepted from CLI arguments as a forgeable flag
  - accepted from HTTP bodies / query / headers
  - accepted from Stripe metadata
  - accepted from CheckoutSession fields
  - accepted from CheckoutFinalizationJob payloads
  - accepted by webhook, reconciliation, or the normal finalization worker
- A caller passing `{ bypassCommercialStayExclusivity: true }` (or any similar plain boolean) **without** the private capability must have **no effect**.
- The recovery CLI calls **only** `recoverAllowlistedMultiUnitPaidOrphanCheckout`. It must **never** call `finalizePaidCheckout` with user-controlled bypass options.
- Normal `finalizePaidCheckout`, `runCheckoutFinalizeOrchestration`, webhook worker, and reconcile paths must not export or accept the Symbol.

### 1.3 Call boundary

```text
CLI recoverMultiUnitPaidOrphanCheckout.js
  └─ recoverAllowlistedMultiUnitPaidOrphanCheckout({ allowlist, digest, intent, execute, actor, ... })
       ├─ read-only preflight / digest verify
       ├─ claimRecoveryLeaseOnFinalizationJob(...)     // failed_permanent stays failed_permanent
       ├─ with private RECOVERY_CAPABILITY:
       │    ├─ validateUnitForCabinTypeBooking(AF-03…)
       │    ├─ assertNoCommercialStayConflict(..., { capability }) // exclusivity only
       │    ├─ execute authoritative booking finalize with assignedUnitId
       │    ├─ linkStripePaymentToBooking(..., { suppressPaymentUnlinkedResolve: capability })
       │    └─ enqueue side effects with send:false + MRI suppress until verify gate
       └─ recovery-specific job success transition + MRI resolve after verify
```

---

## 2. Recovery-specific job ownership

### 2.1 Why not normal `claimed`

Repository facts:

- `ACTIVE_EXECUTABLE_STATUSES = ['scheduled', 'claimed']` (`CheckoutFinalizationJob.js`).
- `markCheckoutFinalizationJobSucceeded` matches **`status: 'claimed'` only** and clears `lastErrorCode` / `lastErrorSummary`.

Therefore S0 **must not** move the incident job to `claimed` and **must not** call unmodified `markCheckoutFinalizationJobSucceeded()` for this transition.

### 2.2 Proposed fields (S0 schema additions on `CheckoutFinalizationJob`)

Add recovery-only fields (names binding):

| Field | Type | Purpose |
|-------|------|---------|
| `recoveryStatus` | enum: `null\|none\|leased\|succeeded\|failed` (default null/none) | Recovery lease state; independent of worker `status` |
| `recoveryClaimedBy` | String \| null | e.g. `multi-unit-paid-orphan-recovery:<runId>` |
| `recoveryClaimedAt` | Date \| null | Lease start |
| `recoveryVisibilityTimeoutAt` | Date \| null | Lease expiry for crash retry |
| `recoveryAttemptCount` | Number ≥ 0 | Execute attempts |
| `recoveryLastErrorCode` | String \| null | Last recovery error |
| `recoveryLastErrorSummary` | String \| null | Truncated ≤500 |
| `recoveryHistory` | Array of Mixed | Append-only execute history (never written on dry-run) |
| `recoveredAt` | Date \| null | Success timestamp |
| `recoveredBy` | String \| null | Actor / run identity |

**Normal `status` remains `failed_permanent` until the recovery-specific success transition sets it to `succeeded`.**

Worker and reconcile must ignore jobs with active non-expired `recoveryStatus=leased` for mutation; worker already ignores non-`scheduled|claimed` statuses for poll — keeping `failed_permanent` prevents worker race.

### 2.3 Atomic recovery claim

Match **all** of:

- `_id` = allowlisted job ID (`6a6da522b6410db9d013ec7c`)
- `checkoutId` = allowlisted checkout ID
- `paymentIntentId` = allowlisted PI
- `status` = `failed_permanent`
- `lastErrorCode` = `DUPLICATE_STAY_CONFLICT` (allowlisted expected failure)
- and either:
  - `recoveryStatus` ∈ `{ null, none, failed }` with no active lease, **or**
  - `recoveryStatus=leased` **and** `recoveryVisibilityTimeoutAt < now` (expired lease reclaim)

On success of claim: set `recoveryStatus=leased`, `recoveryClaimedBy`, `recoveryClaimedAt`, `recoveryVisibilityTimeoutAt`, increment `recoveryAttemptCount`. Do **not** set normal `claimedBy` / `status=claimed`.

### 2.4 Success transition (recovery-specific helper)

New helper e.g. `markCheckoutFinalizationJobSucceededFromMultiUnitRecovery`:

Filter:

- `_id` = jobId
- `status` = `failed_permanent`
- `recoveryStatus` = `leased`
- `recoveryClaimedBy` = this run’s claim identity
- `recoveryVisibilityTimeoutAt` ≥ now

Set:

- `status: succeeded`
- `stage: succeeded`
- `bookingId`
- `paymentLinkedAt`, `sessionFinalizedAt`
- `quoteConvertedAt` when applicable
- `confirmationQueuedAt` **only after** pending EDS exists
- `recoveredAt`, `recoveredBy`
- `recoveryStatus: succeeded`
- clear recovery lease fields (`recoveryClaimedBy/At/VisibilityTimeoutAt` → null)
- **Preserve** original failure: copy `{ lastErrorCode, lastErrorSummary, stage, firstFailedAt, lastFailedAt }` into `safeDetails.priorPermanentFailure` **before** any clear; append success entry to `recoveryHistory`
- Do **not** erase `firstFailedAt`

### 2.5 Dry-run vs execute history

- **Dry-run:** zero writes — including **no** `recoveryHistory` append, no lease claim.
- **Execute:** append `recoveryHistory` entries for claim, steps, success/failure.

### 2.6 Crash / concurrency

- Lease expiry → another execute may reclaim.
- Two concurrent executes: only one claim wins; loser gets `RECOVERY_JOB_LEASE_CONFLICT`.
- Second successful execute after full success is idempotent (`RECOVERY_ALREADY_COMPLETED` / adopt path).

---

## 3. Dry-run purity and evidence digest

### 3.1 Dry-run write ban (absolute)

Dry-run must not:

- create or ensure a finalization job
- claim a job / update job history
- change CheckoutSession
- link Payment / create Booking
- resolve or create ManualReviewItem
- create EmailDeliveryState
- convert SavedQuote
- allocate or hold a Unit
- write AuditEvent
- update any document timestamps via save

Dry-run uses **read-only** loaders and pure validators only.

### 3.2 Digest

`recoverySchemaVersion` = `multi-unit-paid-orphan-recovery/v1`

Digest = sha256 over a **canonical JSON** of digest inputs (sorted keys, no PII). Inputs at minimum:

- recoverySchemaVersion
- checkoutId, checkoutSessionMongoId, paymentIntentId, paymentRecordId, finalizationJobId, manualReviewItemId
- expectedCabinTypeId, expectedTargetUnitId
- expectedCheckInDateOnly, expectedCheckOutDateOnly
- expectedAmountCents, expectedCurrency
- expectedQuoteSnapshotHash, expectedFinalizeIntentHash
- expectedFailureCode
- live: session.status, session.finalizeStatus, session.paymentStatus, session.bookingId
- live: job.status, job.lastErrorCode, job.stage
- live: payment.status, payment.reservationId (null/string)
- live: MRI.status, MRI.category
- firstBookingId, firstBookingUnitId, firstBookingStatus
- targetUnit.isActive, targetUnit.updatedAt (ISO)
- targetUnitAvailabilityResult (`available`\|`unavailable` + reason code)
- guestIdentityMatch (boolean only)
- stayFingerprintMatch (boolean \| null)
- dryRunAt (ISO)
- operatorActorId
- recoveryReason

**Never** include raw guest email or reversible email material in digest inputs or report output beyond booleans.

### 3.3 Execute gates

Execute requires **all** of:

- `--execute`
- env `MULTI_UNIT_PAID_ORPHAN_RECOVERY=1`
- exact allowlist match
- exact dry-run digest re-verified against freshly recomputed evidence
- fixed confirmation phrase (§5)
- operator actor ID
- operator intent-confirmed timestamp
- non-empty recovery reason

If any digest input changed (including AF-03 availability) → `RECOVERY_DIGEST_MISMATCH`; require new dry-run.

---

## 4. Guest identity comparison

Canonical normalizer (reuse exactly):

```js
// bookingCommercialStayFingerprint.normalizeGuestEmail
String(raw).trim().toLowerCase()
```

Also used by CheckoutSession creation (`guestEmail` lowercased in `checkoutSessionService.normalizeCheckoutSessionInput`).

### 4.1 Required behavior

1. Normalize first Booking `guestInfo.email`.
2. Normalize second session `guestEmail` and/or `finalizeIntent.guestInfo.email` (both must agree when both present).
3. Compare **in memory** only.
4. Never print or persist either email.
5. Never print or persist a reversible email hash.
6. Dry-run / execute reports record only:
   - `guestIdentityMatch: true|false`
   - `stayFingerprintMatch: true|false|null` (compare `Booking.commercialStayFingerprint` to `CheckoutSession.stayFingerprint` when both non-empty)
7. Mismatch → `RECOVERY_GUEST_IDENTITY_MISMATCH` / `RECOVERY_FINGERPRINT_MISMATCH` — abort.
8. Missing guest identity on either side → abort (`RECOVERY_GUEST_IDENTITY_MISMATCH`).

No new salted hash store.

---

## 5. Operator intent confirmation

Free boolean is insufficient.

Execute requires the **exact** fixed phrase:

```text
I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME
```

Plus:

- `operatorActorId` (non-empty string)
- `operatorIntentConfirmedAt` (ISO timestamp)
- non-empty `recoveryReason`
- matching dry-run digest
- exact incident allowlist identities

Distinguish:

- **Technical eligibility** (paid, hashes, AF-03 free, fingerprint match, …)
- **Confirmed commercial intent** (phrase + actor + timestamp)

If intent is not confirmed → `RECOVERY_INTENT_NOT_CONFIRMED`; **no Booking**.

---

## 6. Exact-unit injection point

### 6.1 Flow (binding)

1. Read and validate immutable `quoteSnapshot` + `finalizeIntent` (hashes must match allowlist).
2. Recalculate target-unit availability via `AssignmentEngine.validateUnitForCabinTypeBooking(expectedTargetUnitId, cabinTypeId, checkIn, checkOut)` (uses `isUnitGuestStayAvailable`: active unit, cabinType match, bookings, AvailabilityBlocks, unit `blockedDates`).
3. Inside the private recovery entrypoint only, set:

   ```js
   finalizeContext.assignedUnitId = expectedTargetUnitId
   ```

4. Continue through authoritative finalize work (`executeBookingFinalizeWork` → `resolveCabinTypeUnitForFinalize` honors requested unit).

### 6.2 Rules

- Do **not** modify `quoteSnapshot`, `finalizeIntent`, or Stripe PaymentIntent metadata as authority for unit selection.
- Do **not** fabricate historical unit selection on the checkout.
- Unit ID becomes authoritative on the resulting **Booking** (and finalization result) only.
- Inactive / wrong cabinType / blocked / AvailabilityBlock / overlap / changed availability → `RECOVERY_TARGET_UNIT_UNAVAILABLE`.
- This incident requires exact unit `69b2ff947f141a71ffa7c444` (AF-03). **No silent alternate unit.**

---

## 7. Self-exclusion and capacity deduplication (S1 + R0 checks)

### 7.1 Exclusion identities

When evaluating capacity for a subject checkout, exclude that purchase using **all** available identities:

- `checkoutId`
- CheckoutSession `_id`
- canonical PaymentIntent ID
- CheckoutFinalizationJob `_id`

### 7.2 Counting rules

| Record | Counts toward capacity? |
|--------|-------------------------|
| First confirmed Booking on AF-04 | **Yes** (occupies that unit) |
| Its linked finalized CheckoutSession | **No** (dedupe) |
| Its finalization job | **No** |
| Second paid orphan under recovery | **Excluded** from its own decision |
| Unrelated paid unfinalized checkout | **Yes** — one provisional aggregate slot |
| Multiple jobs for one session | **Once** (group by checkoutId / canonical PI) |
| Session already linked to Booking | **No** provisional (Booking counts) |

One purchase consumes **at most one** provisional slot (group by checkoutId or canonical PaymentIntent).

### 7.3 Shared function

One authoritative `buildCabinTypeCapacityEvidence({ cabinTypeId, checkIn, checkOut, excludeIdentities })` shared by pre-charge and finalization. R0 exact-unit validation remains per-unit; when aggregate evidence is consulted, apply the same exclusion.

---

## 8. Provisional paid-capacity lifecycle (S1)

Paid unfinalized checkouts have **no unitId** → they consume **aggregate** capacity (one slot), not a pinned unit.

### 8.1 Lifecycle

Each distinct paid + unfinalized purchase consumes one provisional aggregate slot until one of:

1. Linked Booking is created (slot converts to unit occupancy), **or**
2. Payment status becomes `refunded` (Payment model enum includes `refunded`) with recorded refund evidence, **or**
3. Checkout/payment is administratively cancelled through an authoritative ops process with audit evidence, **or**
4. Operator explicitly releases the provisional slot with audit evidence (ops tool; fields TBD in S1 implementation but must be durable)

### 8.2 Non-expiry

- Paid provisional capacity **must not** expire merely because CheckoutSession `expiresAt` passed.
- Unpaid expired / abandoned / superseded sessions consume **no** capacity.
- `failed_permanent` paid orphans **continue** to consume capacity until recovery, refund, or explicit release.

### 8.3 Operational consequence

Unresolved paid orphans can **intentionally block** future inventory until money disposition is resolved. That is preferred to silent oversell.

---

## 9. Paid last-unit loser semantics (S1)

### 9.1 Repository reality

`executeBookingFinalizeWork.runPostSaveOverlapChecks` + `retainPaidBookingOnOverlap`:

- On paid path, loser Booking is **retained** (not deleted).
- Sets `metadata.paidOverlapConflict`, `paidOverlapConflictAt`, `paidOverlapConflictCode`, `paidOverlapConflictSummary`.
- Opens MRI `paid_booking_overlap_conflict`.
- Throws; unpaid path may `deleteOne`.

`isUnitGuestStayAvailable` today counts `status ∈ pending|confirmed|in_house` and does **not** exclude `paidOverlapConflict` — **S1 must fix this**.

### 9.2 Locked target behavior

- Concurrent finalizers may temporarily create competing Bookings.
- Authoritative winner = existing deterministic oldest-by-`createdAt,_id` overlap logic.
- Paid loser Booking is **retained** for financial evidence; **never silently deleted**.
- Enrich conflict metadata (extend retain helper in S1):

  - `paidOverlapConflict: true`
  - `paidOverlapConflictWinningBookingId`
  - `paidOverlapConflictUnitId`
  - `paidOverlapConflictCheckIn` / `CheckOut` (date-only)
  - paymentIntentId / checkoutId
  - conflict timestamp (existing `paidOverlapConflictAt`)

- Loser must **not**: receive confirmation; trigger normal guest confirmation side effects; appear as a valid guest stay; consume sellable inventory.

### 9.3 Inventory exclusion rule (required S1)

Availability, AssignmentEngine, and capacity evidence **must exclude** Bookings where:

```js
metadata.paidOverlapConflict === true
```

from blocking inventory (treat as non-occupying for sellable capacity), while retaining the row for money/ops evidence.

Loser job / classification: `INVENTORY_EXHAUSTED_AFTER_PAYMENT` (permanent, MRI, no indefinite retry loop). Payment remains `paid`. No automatic refund in this sidequest.

Do **not** require a new Booking status enum value for S1 minimum; metadata exclusion is the binding inventory rule. Optional later: ops UI filter + archive tooling.

---

## 10. Recovery mutation order and forward reconciliation

### 10.1 Exact execute order

0. Recompute read-only preflight; verify digest, intent phrase, actor, timestamps.
1. Atomically acquire recovery-specific lease (`failed_permanent` remains).
2. Search existing Booking by: `checkoutId`, `checkoutSessionId`, `stripePaymentIntentId`, `Payment.reservationId`.
3. Create Booking through authoritative finalize **only** if none exists (with capability + `assignedUnitId`).
4. Link `Payment.reservationId` (MRI auto-resolve **suppressed** — §11).
5. Finalize / link CheckoutSession (`bookingId`, `finalizeStatus=finalized`, `finalizedAt`).
6. Recovery-specific job success transition (after links verified enough for bookingId).
7. Convert SavedQuote where applicable (non-fatal toward overall money truth).
8. Ensure one pending confirmation EDS with `send:false`; set `confirmationQueuedAt` only after pending exists.
9. Verify all authoritative links (Booking unit AF-03, Payment, session, job, EDS).
10. Resolve incident MRI under §11.
11. Write redacted recovery audit evidence.
12. Complete recovery lease (`recoveryStatus=succeeded`).

### 10.2 Crash behavior

- **Never** delete a paid Booking created successfully.
- Second execution adopts partial work and reconciles forward.
- Booking without Payment link → recoverable.
- Payment linked without session finalize → recoverable.
- Session finalized without job success → recoverable.
- Job success without confirmation enqueue → recoverable; **MRI stays open**.
- MRI is **not** the transaction boundary.
- No second charge; no second Booking (unique indexes on checkoutId / stripePaymentIntentId).

---

## 11. MRI auto-resolution policy (S0 preferred)

### 11.1 Problem

`linkStripePaymentToBooking` and `checkoutFinalizeSideEffects.resolveAlertsForBooking` auto-resolve open `payment_unlinked` reviews when a reservationId is present.

### 11.2 Locked policy

- Recovery passes the private capability into payment-linking and side-effects to **suppress** automatic `payment_unlinked` resolution during recovery.
- Incident MRI remains **open** until the final verification gate passes.
- Final verification requires **all** of:
  - Booking exists
  - `unitId` = expected AF-03
  - `Payment.reservationId` matches Booking
  - `CheckoutSession.bookingId` matches Booking
  - session `finalizeStatus=finalized`
  - job `status=succeeded` with recovery success evidence
  - confirmation EmailDeliveryState exists in `pending` (or already `succeeded`/`success` if somehow sent out-of-band)
- Only then resolve MRI with controlled note (no secrets), `resolvedBy` = recovery service / actor.
- If confirmation enqueue fails → keep MRI open; preserve Booking/Payment/session links; second run may finish enqueue then resolve.
- Narrow hooks in payment-linking + side-effects are **in S0 scope**.

---

## 12. Confirmation enqueue behavior

- S0 calls existing delivery SM with **`send: false`**.
- Ensures one durable pending `EmailDeliveryState` (`correlationKey` unique).
- Must not invoke SMTP; must not set `Booking.confirmationEmailSentAt`; must not set job `confirmationSentAt`.
- Set job `confirmationQueuedAt` only after pending state exists.
- Confirmation worker remains stopped.
- Second run adopts existing pending/succeeded EDS.
- Enqueue failure does not undo Booking/Payment/session; MRI stays open (§11).

Feature-flag note: even if `FINALIZE_SIDE_EFFECTS=1`, recovery must force `send:false` and MRI suppress. Do not rely on ambient worker send flags.

---

## 13. Error taxonomy (single authoritative module)

Introduce `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js` (or shared finalize taxonomy module extended in S0/S1) used by recovery, job classifier, `safeDetails`, CLI, MRI evidence.

`safeDetails.permanent` and job permanence **must** use this source.

| Code | Retryable | Permanent | Job effect | Recovery lease | MRI | HTTP | Refund rec. |
|------|-----------|-----------|------------|----------------|-----|------|-------------|
| `SAME_CHECKOUT_REPLAY` | n/a success | n/a | none / succeed idempotent | n/a | no | 200 | none |
| `SAME_PAYMENT_INTENT_REPLAY` | no | yes if conflict | permanent if bad | release/fail | if paid mismatch | 409 | investigate |
| `INVENTORY_EXHAUSTED` | n/a (no PI) | n/a | n/a | n/a | no | 409 | none |
| `INVENTORY_EXHAUSTED_AFTER_PAYMENT` | no | yes | `failed_permanent` | n/a | **yes** | 409 | operator |
| `DUPLICATE_STAY_CONFLICT` | no | yes | `failed_permanent` | n/a | yes (legacy flag-off) | 409 | merge/ops |
| `RECOVERY_ALLOWLIST_MISMATCH` | no | abort | no job mutate | no claim | keep open | CLI | none |
| `RECOVERY_DIGEST_MISMATCH` | no | abort | no | no | keep open | CLI | none |
| `RECOVERY_INTENT_NOT_CONFIRMED` | no | abort | no | no | keep open | CLI | refund path if ops rejects intent |
| `RECOVERY_GUEST_IDENTITY_MISMATCH` | no | abort | no | no | keep open | CLI | none |
| `RECOVERY_FINGERPRINT_MISMATCH` | no | abort | no | no | keep open | CLI | none |
| `RECOVERY_JOB_LEASE_CONFLICT` | yes (after timeout) | no | no status change | contested | keep open | CLI | none |
| `RECOVERY_TARGET_UNIT_UNAVAILABLE` | no | abort | leave `failed_permanent` | fail lease | keep open | CLI | operator |
| `RECOVERY_PAYMENT_NOT_PAID` | no | abort | no | no | keep open | CLI | none |
| `RECOVERY_PAYMENT_ALREADY_LINKED_ELSEWHERE` | no | abort | no | fail | **yes** | CLI | investigate |
| `RECOVERY_EXISTING_BOOKING_CONFLICT` | no | abort | no | fail | **yes** | CLI | investigate |
| `RECOVERY_PARTIAL_LINKAGE` | yes via re-run | until fixed | may stay leased/failed | reclaimable | **yes** keep open | CLI | none |
| `RECOVERY_CONFIRMATION_ENQUEUE_FAILED` | yes via re-run | until fixed | job may already succeeded | complete/re-run side effects | **keep open** | CLI | none |
| `RECOVERY_ALREADY_COMPLETED` | n/a success | n/a | already succeeded | n/a | may already resolved | CLI | none |

Client-safe messages: generic “payment received / booking needs review” patterns for guest HTTP; CLI shows operator-safe codes without PII.

---

## 14. S0 independence and deployment order

### 14.1 Independence

- S0 does **not** require `MULTI_UNIT_CAPACITY_STAY_GUARD`.
- S0 works while legacy commercial exclusivity remains enabled (private capability bypasses only same-guest exclusivity for the allowlisted orphan).
- S0 does not require client deploy or confirmation worker running.
- S0 must deploy before incident execute.

### 14.2 Ordering

- **Incident execute before enabling S1 capacity flag**, unless self-exclusion + provisional rules are already verified in the deployed build.
- S1 may deploy first only with §7–§8 complete and tested.

### 14.3 S3 production order

1. Deploy approved S0 server/tooling.  
2. Production dry-run (zero writes).  
3. Confirm operator intent (fixed phrase).  
4. Recheck digest + AF-03 availability.  
5. Execute recovery.  
6. Verify Booking / Payment / session / job / unit / EDS.  
7. Resolve MRI only after verification.  
8. Leave confirmation pending.  
9. Continue S1/S2 separately.

---

## 15. S2 session-storage and quantity scope

### 15.1 Client risk

`commercialBoundaryKey` is entity+dates only (`checkoutSessionV2Storage.js`). Restoring sessionStorage for the same boundary can restore a **prior completed checkoutId**.

S2 must:

- Clear completed/finalized checkout storage before starting a second sequential one-unit checkout.
- Mint a **new** `checkoutId` for the second purchase.
- Keep communicating remaining unit availability honestly.

### 15.2 Quantity

- Quantity remains **absent** from the public product model (no field in quote snapshot / ConfirmBooking cabinType path today).
- Defensive API validation rejects `quantity > 1` if supplied.
- Do **not** build quantity-two support in this sidequest.

---

## 16. Feature flags

| Flag | Default | Purpose |
|------|---------|---------|
| `MULTI_UNIT_PAID_ORPHAN_RECOVERY` | false | S0 execute gate (with `--execute` + allowlist + digest + phrase) |
| `MULTI_UNIT_CAPACITY_STAY_GUARD` | false | S1 capacity-aware guard + pre-charge |

S0 recovery does **not** depend solely on the capacity flag. Logs must show `policy=legacy_exclusivity|capacity_aware` and never log PII.

---

## 17. Exact S0 file boundary

### 17.1 Add

- `server/services/checkout/multiUnitPaidOrphanRecoveryService.js`
- `server/scripts/recoverMultiUnitPaidOrphanCheckout.js`
- `server/scripts/multiUnitPaidOrphanRecovery.test.cjs`
- `docs/checkout-payment-architecture/04_MULTI_UNIT_PAID_ORPHAN_RECOVERY_CLI.md` (fake IDs only)
- `docs/checkout-payment-architecture/examples/multi-unit-paid-orphan-allowlist.example.json` (fake IDs)
- `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js` (or equivalent shared taxonomy module)

### 17.2 Narrow modify

- `server/models/CheckoutFinalizationJob.js` — recovery lease fields (§2.2)
- `server/services/checkout/checkoutFinalizationJobService.js` — claim + success-from-`failed_permanent` helpers; **do not** weaken normal worker succeed-from-`claimed`
- `server/services/checkout/commercialStayGuardService.js` — capability-gated exclusivity bypass only
- `server/services/checkout/finalizePaidCheckout.js` / `checkoutFinalizeService.js` — internal hooks callable only with capability (no HTTP-shaped bypass)
- `server/services/checkout/executeBookingFinalizeWork.js` — only if needed to honor pre-assigned unit (already supported via `assignedUnitId`)
- `server/services/payments/paymentLinkingService.js` — suppress `payment_unlinked` auto-resolve when capability present
- `server/services/checkout/checkoutFinalizeSideEffects.js` — force `send:false`; suppress MRI auto-resolve under capability; controlled ordering
- `server/utils/featureFlags.js` — `isMultiUnitPaidOrphanRecoveryEnabled()`

### 17.3 Explicitly exclude

- Confirmation-worker PM2 / Batches 2–3
- Global S1 capacity default-on
- Client quantity product
- Payment amount / Stripe charge or refund creation
- Unrelated voucher or messaging code
- Calling Batch 8 `reconcilePaidCheckoutSubject` as the mutator for this `failed_permanent` incident

---

## 18. Exact S0 acceptance tests

1. Dry-run performs **zero** Mongo mutations (job/session/payment/MRI/EDS/Booking/AuditEvent).  
2. Exact allowlist required; wildcards rejected.  
3. Fixed operator confirmation phrase required.  
4. Actor / timestamp / reason required.  
5. Digest generated deterministically from canonical inputs.  
6. Changed unit availability invalidates digest.  
7. Wrong identifiers / hashes / amount / dates reject (`RECOVERY_ALLOWLIST_MISMATCH`).  
8. Guest identity mismatch rejects without exposing email.  
9. Private capability cannot be forged through normal finalizer arguments / plain `bypassCommercialStayExclusivity: true`.  
10. Normal HTTP / webhook / worker / reconcile paths cannot bypass guard.  
11. Recovery lease acquired **without** job `status=claimed`.  
12. Normal worker cannot execute recovery-leased `failed_permanent` job.  
13. Expired recovery lease can be reclaimed.  
14. Original permanent failure evidence preserved after success.  
15. Exact AF-03 validation passes when available.  
16. Inactive / wrong-type / blocked / overlapping unit rejects.  
17. Current orphan excluded from its own capacity/availability decision.  
18. Unrelated paid orphan still counts toward capacity evidence.  
19. No new PaymentIntent, charge, or refund.  
20. Existing Booking by checkoutId/PI is adopted.  
21. Concurrent creation race creates/adopts only one Booking.  
22. Partial failure after Booking creation reconciles forward (no delete).  
23. Payment link failure reconciles on second run.  
24. Session link failure reconciles on second run.  
25. Job completion failure reconciles on second run.  
26. MRI remains open until full verification.  
27. Payment-link auto-resolution suppressed during recovery.  
28. One pending confirmation EDS with `send:false`.  
29. Confirmation enqueue failure leaves MRI open and links intact.  
30. Second run idempotent.  
31. No SMTP invoked.  
32. No production identifiers / emails in tests.

---

## 19. Exact S1 additions

### 19.1 Behavior

- Self-exclusion identities (§7)
- Session/job/Booking deduplication
- Aggregate provisional-slot semantics + non-auto-expiry (§8)
- Manual / refund / recovery release rules
- Paid-loser retention + `metadata.paidOverlapConflict` inventory exclusion (§9)
- Pre-charge checks: quote, session refresh, before PI create
- Finalizer capacity recheck
- `INVENTORY_EXHAUSTED` / `INVENTORY_EXHAUSTED_AFTER_PAYMENT`
- Unified taxonomy permanence (`safeDetails.permanent` == job permanence)
- Feature flag `MULTI_UNIT_CAPACITY_STAY_GUARD` default false
- Single-cabin inventory keeps exclusivity
- Sequential same-guest multi-unit allowed when capacity remains (flag on)

### 19.2 S1 files (modify/add)

- `commercialStayGuardService.js` (capacity-aware result object)
- `bookingQuoteService.js`, `checkoutSessionService.js`, `checkoutCanonicalPaymentIntentService.js`
- `finalizePaidCheckout.js`, `checkoutFinalizeService.js`, `executeBookingFinalizeWork.js` (loser metadata enrichment + taxonomy)
- `publicAvailabilityService.js` / `assignmentEngine.js` — exclude `paidOverlapConflict` from blocking occupancy
- `featureFlags.js`
- Docs: update I5/P1/T17 in checkout target architecture + finalization spec taxonomy rows
- Tests: `multiUnitCapacityStayGuard.test.cjs` + extensions to commercialStay / cabinType allocation / finalize / worker taxonomy tests

### 19.3 S1 acceptance tests (minimum)

- Two active units, zero bookings → two same-guest sequential checkouts, different unitIds (flag on)
- One booked → second succeeds on remaining unit
- Both occupied → reject before PI
- Different guests unchanged
- Same checkout / same PI replay → one Booking
- Concurrent last unit → one clean occupant; loser retained with conflict metadata + excluded from inventory; `INVENTORY_EXHAUSTED_AFTER_PAYMENT`
- Inactive units excluded
- Expired unpaid does not consume capacity
- Paid unfinalized consumes one provisional slot; non-auto-expiry
- Self-exclusion identities
- Finalized session+booking counted once
- Flag off = legacy exclusivity
- Flag on = capacity policy; logs without PII
- `safeDetails.permanent` matches classifier

---

## 20. Pre-charge behavior (S1)

Capacity checked at:

1. Quote refresh (`bookingQuoteService`)
2. CheckoutSession refresh (`checkoutSessionService`)
3. Immediately before canonical PI creation (`checkoutCanonicalPaymentIntentService`)

When exhausted: no new PI; clear 409/`INVENTORY_EXHAUSTED`; refresh stale quote/session. Same-guest second-unit with capacity remaining must **not** be classified as `DUPLICATE_STAY_CONFLICT`. Finalizer always rechecks.

Existing PI for same checkout may still be reused per canonical PI ownership rules when capacity remains for that session’s provisional slot.

---

## 21. Replay identity vs inventory capacity (R1 concept)

**Replay:** checkoutId, canonical PI, replayFingerprint, finalizeIntentHash, quoteSnapshotHash, Booking unique PI/checkout indexes.

**Capacity:** active units, per-unit overlap (excluding `paidOverlapConflict`), blockedDates, AvailabilityBlocks, provisional paid slots (§8).

`commercialStayFingerprint` may remain for audit/grouping; must not alone grant exclusive ownership of a multi-unit cabinType when capacity remains (flag on).

`commercialBoundaryKey` remains session-boundary metadata only — not inventory lock.

---

## 22. Indexes (must remain / respect)

- Booking unique `checkoutId` (partial string)
- Booking unique `stripePaymentIntentId` (partial)
- Booking `{ unitId, checkIn, checkOut }` (non-unique; overlap via query)
- Booking `{ commercialStayFingerprint, status }` **non-unique**
- CheckoutSession unique `checkoutId`; partial unique canonical PI
- CheckoutFinalizationJob unique active executable (`scheduled|claimed`) per checkoutId
- Payment unique `{ provider, providerReference }`
- EmailDeliveryState unique `correlationKey`

Do **not** add a unique index on commercialStayFingerprint that reintroduces cabinType exclusivity.

---

## 23. Relationship to confirmation-worker lock

`docs/architecture/booking-confirmation-worker-production-readiness-lock.md` remains binding for confirmation delivery. This sidequest must not modify that architecture, PM2 process, or resume Batches 2/3. S0 only enqueues pending EDS.

---

## 24. Repository-unanswerable questions

1. Production in-memory guest-identity / stayFingerprint equality for the two checkouts.  
2. Operator-confirmed guest intent for a second physical A-frame.  
3. Exact live MRI category for `6a6da522d383478dc62c43cf`.  
4. Production `FINALIZE_SIDE_EFFECTS` / send flag values at execute time.  
5. Whether AF-03 remains free at dry-run and execute.  
6. Whether any out-of-band ops mutation occurred since audit.

---

## 25. Binding decision summary

| Topic | Decision |
|-------|----------|
| Trust boundary | Recovery-only entrypoint + unexported Symbol capability |
| Job lease | Recovery fields; stay `failed_permanent` until recovery-specific succeed; never worker `claimed` |
| Dry-run | Zero writes; deterministic digest; execute re-verifies |
| Guest identity | In-memory normalize + compare; booleans only in reports |
| Intent | Fixed phrase + actor + timestamp + reason + digest |
| Unit | Exact AF-03 via `assignedUnitId` after `validateUnitForCabinTypeBooking` |
| MRI | Suppress auto-resolve under capability; resolve after verify gate |
| Confirmation | `send:false` pending EDS; worker stopped |
| Paid loser | Retain Booking; exclude `paidOverlapConflict` from inventory |
| Provisional capacity | Aggregate slot; no auto-expiry on paid; self-exclude |
| Deploy | S0 deploy → dry-run → intent → execute → verify → MRI; then S1 flag |

**End of binding architecture lock (remediated 2026-08-03).**
