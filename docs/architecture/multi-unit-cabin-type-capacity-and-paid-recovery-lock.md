# Architecture Lock: Multi-Unit CabinType Capacity Guard and Paid Orphan Recovery

**Status:** BINDING DESIGN — implementation must follow this document
**Created:** 2026-08-01
**Remediated:** 2026-08-03 (post REJECTED audit)
**Clarified:** 2026-08-03 (post APPROVED AFTER MINOR — capability module, digest freshness, confirmationQueuedAt split, S1 grouping, paid-overlap readers, disputed capacity, lease indexes)
**Scope:** Immediate allowlisted recovery of one paid multi-unit orphan (R0 / S0), permanent capacity-aware same-cabinType booking behavior (R1 / S1), deferred quantity-two UX (R2 / S2)
**Branch basis:** `origin/master`
**Out of scope:** Confirmation-worker Batches 1–3, PM2 confirmation-worker process, automatic refunds, public quantity=2 checkout

This document is the single source of truth for the multi-unit cabinType capacity and paid-orphan recovery sidequest. Application code must not diverge from these decisions without an explicit architecture revision.

**Audit trail:** Prior `REJECTED` findings addressed 2026-08-03; this clarification addresses `APPROVED AFTER MINOR ARCHITECTURE REMEDIATION` for commit `7e70a5f`.

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
| CLI | `server/scripts/recoverMultiUnitPaidOrphanCheckout.js` — calls recovery service only |
| Recovery service | `server/services/checkout/multiUnitPaidOrphanRecoveryService.js` → **`recoverAllowlistedMultiUnitPaidOrphanCheckout(...)`** |
| Private capability module | `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js` |
| Commercial guard | `commercialStayGuardService.js` — exclusivity bypass only after `assertMultiUnitPaidOrphanRecoveryCapability` |
| Exact-unit injection | Private recovery path sets `finalizeContext.assignedUnitId` after live validation |
| Job lease / success / confirmationQueuedAt | Recovery-specific helpers in `checkoutFinalizationJobService.js` |
| Payment link MRI suppress | `paymentLinkingService.js` — validates capability via exported predicate |
| Side effects | `checkoutFinalizeSideEffects.js` — `send:false` + MRI suppress under capability |
| Confirmation | `ensurePendingConfirmationDelivery` / `processBookingConfirmationDelivery({ send: false })` |

### 1.2 Private capability module (binding Pattern B)

File: `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js`

```js
// Module-private — NEVER exported
const CAPABILITY = Symbol('multiUnitPaidOrphanRecoveryCapability');

function runWithMultiUnitPaidOrphanRecoveryCapability(callback) {
  return callback(CAPABILITY);
}

function isMultiUnitPaidOrphanRecoveryCapability(value) {
  return value === CAPABILITY;
}

function assertMultiUnitPaidOrphanRecoveryCapability(value) {
  if (!isMultiUnitPaidOrphanRecoveryCapability(value)) {
    throw new Error('MULTI_UNIT_PAID_ORPHAN_RECOVERY_CAPABILITY_REQUIRED');
  }
}

module.exports = {
  runWithMultiUnitPaidOrphanRecoveryCapability,
  isMultiUnitPaidOrphanRecoveryCapability,
  assertMultiUnitPaidOrphanRecoveryCapability
  // CAPABILITY / Symbol intentionally NOT exported
};
```

Rules:

- The Symbol is owned only by this module and is **never** exported.
- The recovery entrypoint obtains the capability only by calling `runWithMultiUnitPaidOrphanRecoveryCapability`.
- Guard, exact-unit injection path, payment-linking, and side-effect modules validate **only** via `assertMultiUnitPaidOrphanRecoveryCapability` / `isMultiUnitPaidOrphanRecoveryCapability`.
- No normal caller can construct or obtain the capability.
- Plain properties such as `{ bypassCommercialStayExclusivity: true, expectedUnitId: '...' }` have **no effect** without a valid capability.
- The capability must **never** be: stored in MongoDB, serialized, accepted from CLI args as a forgeable token, HTTP bodies/query/headers, Stripe metadata, CheckoutSession fields, job payloads, webhook, reconcile, or the normal worker.
- The CLI calls **only** `recoverAllowlistedMultiUnitPaidOrphanCheckout(...)`.
- Capability checks live inside **real** production guard / link / side-effect functions. Dependency injection must not replace those validators with a mock that always returns true. Tests must exercise the real predicate.

### 1.3 Exact ownership call boundary

```text
CLI recoverMultiUnitPaidOrphanCheckout.js
  └─ recoverAllowlistedMultiUnitPaidOrphanCheckout({ allowlist, originalEvidence, digest, intent, execute, actor, ... })
       ├─ read-only preflight / digest verify / live recheck
       ├─ claimRecoveryLeaseOnFinalizationJob(...)   // status stays failed_permanent
       └─ runWithMultiUnitPaidOrphanRecoveryCapability(async (capability) => {
            ├─ validateUnitForCabinTypeBooking(AF-03…)
            ├─ assertNoCommercialStayConflict(..., { capability })  // exclusivity only
            ├─ private recovery finalize path sets assignedUnitId + asserts capability
            ├─ linkStripePaymentToBooking(..., { recoveryCapability: capability }) // MRI suppress
            ├─ side effects send:false + MRI suppress (assert capability)
            ├─ recovery-specific job success (may leave confirmationQueuedAt null)
            ├─ ensure pending EDS
            ├─ markCheckoutFinalizationJobConfirmationQueued(...)
            └─ verify gate → resolve MRI
          })
```

---

## 2. Recovery-specific job ownership

### 2.1 Why not normal `claimed`

Repository facts:

- `ACTIVE_EXECUTABLE_STATUSES = ['scheduled', 'claimed']` (`CheckoutFinalizationJob.js`).
- `markCheckoutFinalizationJobSucceeded` matches **`status: 'claimed'` only** and clears `lastErrorCode` / `lastErrorSummary`.

Therefore S0 **must not** move the incident job to `claimed` and **must not** call unmodified `markCheckoutFinalizationJobSucceeded()` for this transition.

### 2.2 Proposed fields (S0 schema additions on `CheckoutFinalizationJob`)

| Field | Type | Purpose |
|-------|------|---------|
| `recoveryStatus` | enum: `null\|none\|leased\|succeeded\|failed` (default null/none) | Recovery lease state; independent of worker `status` |
| `recoveryClaimedBy` | String \| null | e.g. `multi-unit-paid-orphan-recovery:<runId>` |
| `recoveryClaimedAt` | Date \| null | Lease start |
| `recoveryVisibilityTimeoutAt` | Date \| null | Lease expiry for crash retry |
| `recoveryAttemptCount` | Number ≥ 0 | Execute attempts |
| `recoveryLastErrorCode` | String \| null | Last recovery error |
| `recoveryLastErrorSummary` | String \| null | Truncated ≤500 (same convention as `truncateSummary`) |
| `recoveryHistory` | Array of Mixed | Bounded execute history (never written on dry-run) |
| `recoveredAt` | Date \| null | Success timestamp |
| `recoveredBy` | String \| null | Actor / run identity |

**Normal `status` remains `failed_permanent` until the recovery-specific success transition sets it to `succeeded`.**

### 2.3 Bounded recoveryHistory

- Maximum **40** entries (aligned with truncated summary / bounded-history conventions elsewhere).
- On append beyond the cap, drop oldest entries deterministically (`slice(-40)`).
- Each entry may contain only: `at` (ISO), `runId`, `actor` (`ops:<username>`), `phase`, `code`, `summary` (≤500), `digestPrefix` (first 16 hex of digest), `bookingId` (string|null).
- No guest email, phone, secrets, Stripe client secrets, or unbounded payloads.

### 2.4 Indexes

Add:

```js
{ recoveryStatus: 1, recoveryVisibilityTimeoutAt: 1 }
```

Purpose: lease acquisition / reclaim / expiry scans. Must **not** make normal worker poll recovery jobs (worker continues to filter `status ∈ scheduled|claimed` only).

Existing incident lookup by `checkoutId` / `paymentIntentId` remains authoritative.

### 2.5 Atomic recovery claim

Match **all** of:

- `_id` = allowlisted job ID (`6a6da522b6410db9d013ec7c`)
- `checkoutId` = allowlisted checkout ID
- `paymentIntentId` = allowlisted PI
- `status` = `failed_permanent`
- `lastErrorCode` = `DUPLICATE_STAY_CONFLICT`
- and either:
  - `recoveryStatus` ∈ `{ null, none, failed }` with no active lease, **or**
  - `recoveryStatus=leased` **and** `recoveryVisibilityTimeoutAt < now` (expired lease reclaim)

On claim success: set `recoveryStatus=leased`, `recoveryClaimedBy`, `recoveryClaimedAt`, `recoveryVisibilityTimeoutAt`, increment `recoveryAttemptCount`. Do **not** set normal `claimedBy` / `status=claimed`.

### 2.6 Recovery-specific job completion (separate from confirmationQueuedAt)

Helper: `markCheckoutFinalizationJobSucceededFromMultiUnitRecovery`

After Booking, Payment, and CheckoutSession authoritative linkage succeed, match:

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
- **`confirmationQueuedAt` may remain null**
- `recoveredAt`, `recoveredBy`
- `recoveryStatus: succeeded`
- clear recovery lease fields (`recoveryClaimedBy/At/VisibilityTimeoutAt` → null)
- Preserve original failure into `safeDetails.priorPermanentFailure` before any clear; append success entry to `recoveryHistory`
- Do **not** erase `firstFailedAt`

### 2.7 Confirmation queue patch (separate idempotent helper)

After one pending or already-succeeded `EmailDeliveryState` exists:

```js
markCheckoutFinalizationJobConfirmationQueued({ jobId, bookingId, queuedAt })
```

Required behavior:

- Matches only the expected **succeeded** job + `bookingId`
- Sets `confirmationQueuedAt` only when currently `null`
- Does **not** reopen recovery lease
- Does **not** change job `status`
- Does **not** set `confirmationSentAt`
- Idempotent; second recovery execution may finish this patch
- MRI remains open until this evidence exists (§11)

### 2.8 Reconciliation during active recovery lease

While `recoveryStatus=leased` and `recoveryVisibilityTimeoutAt >= now`:

- Generic Batch 7/8 reconciliation **must no-op** for that job’s mutations.
- Must not open duplicate ManualReviewItems for the same leased recovery.
- Must not alter job `status` or clear recovery lease fields.
- After lease expiry, ordinary reconcile may still classify as permanent failure / manual-review required, but **must not** execute recovery; only the recovery CLI may reclaim the lease.
- Worker remains unable to poll (`failed_permanent` ∉ executable statuses).

### 2.9 Dry-run vs execute history

- **Dry-run:** zero writes — including no `recoveryHistory` append, no lease claim.
- **Execute:** append bounded `recoveryHistory` entries for claim, steps, success/failure.

### 2.10 Crash / concurrency

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

Dry-run uses **read-only** loaders and pure validators only. Avoid writey helpers even if named like validators (`ensureCheckoutFinalizationJob`, `ensurePendingConfirmationDelivery`, quote refresh that `session.save()`s, etc.).

### 3.2 Two distinct evidence objects

#### A. Original dry-run evidence

Dry-run produces:

```js
{
  schemaVersion: 'multi-unit-paid-orphan-recovery/v1',
  dryRunGeneratedAt, // fixed ISO UTC at dry-run time
  canonicalEvidence, // includes the same dryRunGeneratedAt
  digest             // SHA-256 of canonical serialization of canonicalEvidence
}
```

#### B. Execute-time live evidence

Execute receives the **original** `canonicalEvidence` + `digest`, plus phrase, actor, intent timestamp, reason, execute flag.

Execute must:

1. Recompute SHA-256 from the **received original** `canonicalEvidence`.
2. Verify it matches the submitted digest.
3. Enforce maximum digest age (binding default **24 hours**) using original `dryRunGeneratedAt`.
4. Independently reread all live evidence.
5. Compare live material fields with the original `canonicalEvidence`.
6. Abort (`RECOVERY_DIGEST_MISMATCH`) when any material field changed.

The execute-time clock must **not** replace `dryRunGeneratedAt` inside the original digest.

### 3.3 Material live fields

Material changes include:

- target unit `isActive`
- target unit `updatedAt` (freshness signal)
- target unit availability result
- first Booking status / unit / dates
- Payment status / `reservationId`
- CheckoutSession status / finalizeStatus / bookingId / paymentStatus
- finalization-job status / lastErrorCode / recovery lease fields
- ManualReviewItem status / category
- PI identity and paid evidence
- amount / currency
- quoteSnapshotHash / finalizeIntentHash
- dates / cabinTypeId
- guestIdentityMatch / stayFingerprintMatch booleans
- appearance of any Booking for the orphan checkoutId or PI

### 3.4 Canonical serialization

- Stable lexicographic object-key order
- Arrays sorted where semantic order is irrelevant
- ObjectIds → lowercase hex strings
- Dates → UTC ISO-8601
- `undefined` omitted; `null` preserved
- Numbers remain numbers
- Strings NFC Unicode-normalized
- `schemaVersion` included
- Algorithm: SHA-256 hex
- No guest email or reversible guest identifier

### 3.5 `canonicalEvidence` minimum contents

- schemaVersion, dryRunGeneratedAt
- checkoutId, checkoutSessionMongoId, paymentIntentId, paymentRecordId, finalizationJobId, manualReviewItemId
- expectedCabinTypeId, expectedTargetUnitId
- expectedCheckInDateOnly, expectedCheckOutDateOnly
- expectedAmountCents, expectedCurrency
- expectedQuoteSnapshotHash, expectedFinalizeIntentHash
- expectedFailureCode
- session.status, finalizeStatus, paymentStatus, bookingId
- job.status, lastErrorCode, stage, recoveryStatus
- payment.status, reservationId
- MRI.status, MRI.category
- firstBookingId, firstBookingUnitId, firstBookingStatus
- targetUnit.isActive, targetUnit.updatedAt
- targetUnitAvailabilityResult
- guestIdentityMatch, stayFingerprintMatch
- operatorActorId, recoveryReason

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
   - `stayFingerprintMatch: true|false|null`
7. Mismatch → `RECOVERY_GUEST_IDENTITY_MISMATCH` / `RECOVERY_FINGERPRINT_MISMATCH` — abort.
8. Missing guest identity on either side → abort.

Proof hierarchy:

1. Direct normalized identity comparison
2. Compatible fingerprint equality as corroborating evidence
3. Mismatch or missing identity aborts

No new salted hash store.

---

## 5. Operator intent confirmation

Execute requires the **exact** fixed phrase:

```text
I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME
```

Plus:

- `operatorActorId` — **operator-supplied CLI evidence string**, format `ops:<username>` (non-empty). Not cryptographically authenticated identity (repository has no authenticated CLI actor). Persisted in redacted recovery history/audit only. Must not contain guest data or secrets.
- `operatorIntentConfirmedAt` (ISO timestamp)
- non-empty `recoveryReason`
- matching original dry-run digest + received original evidence
- exact incident allowlist identities
- `--execute` and `MULTI_UNIT_PAID_ORPHAN_RECOVERY=1`

Distinguish technical eligibility from confirmed commercial intent. If intent is not confirmed → `RECOVERY_INTENT_NOT_CONFIRMED`; **no Booking**.

---

## 6. Exact-unit injection point

### 6.1 Flow (binding)

1. Read and validate immutable `quoteSnapshot` + `finalizeIntent` (hashes must match allowlist / evidence).
2. Recalculate target-unit availability via `AssignmentEngine.validateUnitForCabinTypeBooking(expectedTargetUnitId, cabinTypeId, checkIn, checkOut)`.
3. Inside the capability-gated private recovery path only, set:

   ```js
   finalizeContext.assignedUnitId = expectedTargetUnitId
   ```

4. Continue through authoritative finalize work (`executeBookingFinalizeWork` → `resolveCabinTypeUnitForFinalize` honors requested unit).

### 6.2 Rules

- Do **not** modify `quoteSnapshot`, `finalizeIntent`, or Stripe PaymentIntent metadata as authority for unit selection.
- Unit ID becomes authoritative on the resulting **Booking** only.
- Inactive / wrong cabinType / blocked / AvailabilityBlock / overlap / changed availability → `RECOVERY_TARGET_UNIT_UNAVAILABLE`.
- This incident requires exact unit `69b2ff947f141a71ffa7c444` (AF-03). **No silent alternate unit.**

### 6.3 S0 exact-unit scope (not S1 provisional capacity)

S0 does **not** depend on the global S1 provisional-capacity algorithm.

S0 exact-unit recovery checks only:

- target AF-03 active
- target belongs to cabin type
- no blockedDates conflict
- no AvailabilityBlock conflict
- no blocking Booking overlap (excluding `metadata.paidOverlapConflict === true` losers if already present)
- no existing Booking for orphan checkout/PI
- current paid orphan session does **not** make AF-03 unavailable merely because the session exists (it has no assigned unit)

Aggregate provisional-slot self-exclusion tests belong to **S1**. Keep one S0 test proving the orphan paid session alone does not occupy AF-03.

---

## 7. Self-exclusion and capacity deduplication (S1)

### 7.1 Current-purchase exclusion object

When evaluating capacity for a subject checkout, exclude that purchase using:

- `checkoutId`
- CheckoutSession `_id`
- canonical PaymentIntent ID
- finalization-job `_id`

Apply exclusion **before** counting.

### 7.2 Deterministic grouping precedence

One purchase consumes **at most one** provisional capacity slot. Grouping key precedence:

1. Existing linked Booking `_id`
2. Canonical PaymentIntent ID
3. Checkout `checkoutId`
4. CheckoutSession `_id`
5. Finalization-job `_id` only when none of the stronger purchase identities exist

Required deduplication:

- Booking and linked CheckoutSession count once
- CheckoutSession and all its jobs count once
- Payment and CheckoutSession for the same canonical PI count once
- Multiple Stripe events for one PI count once
- Multiple jobs for one checkout count once

### 7.3 Authoritative builder

One shared function: `buildCabinTypeCapacityEvidence({ cabinTypeId, checkIn, checkOut, excludeIdentities })` used by pre-charge and finalization. Applies the hierarchy above.

---

## 8. Provisional paid-capacity lifecycle (S1)

Paid unfinalized checkouts have **no unitId** → they consume **aggregate** capacity (one slot), not a pinned unit.

### 8.1 Status / release rules (Payment model enums: unpaid|partial|paid|failed|refunded|disputed)

| Situation | Provisional capacity |
|-----------|----------------------|
| `paymentStatus=paid` + unfinalized, no Booking | Consumes one slot |
| Linked Booking created | Slot converts to unit occupancy |
| `Payment.status='refunded'` with authoritative refund evidence (ingestion sets refunded on refund events) | Releases slot |
| `Payment.status='disputed'` | **Does not** release; remains blocked |
| Chargeback / dispute unresolved | Remains blocked until dispute resolution, refund/cancel evidence, or explicit audited operator release |
| Partial refund | Does **not** auto-release full slot unless purchase authoritatively cancelled |
| CheckoutSession `expiresAt` passed while still paid/unfinalized | **Does not** release |
| Unpaid expired / abandoned / superseded | No capacity |
| ManualReview resolved alone | **Not** sufficient release evidence |

### 8.2 Explicit operator release (new durable evidence)

When no stronger release field applies, S0/S1 must add an authoritative release representation on CheckoutSession (proposed):

```js
metadata.provisionalCapacityRelease = {
  releasedAt: Date,
  releasedBy: 'ops:<username>',
  reason: String, // ≤500
  paymentIntentId: String,
  checkoutId: String
}
```

Required: operator actor, reason, timestamp, linked payment/checkout identity, audit evidence. MRI resolution alone is insufficient.

### 8.3 Operational consequence

Unresolved paid orphans (including disputed) can **intentionally block** future inventory until money disposition is resolved.

---

## 9. Paid last-unit loser semantics (S1)

### 9.1 Repository reality

`executeBookingFinalizeWork.runPostSaveOverlapChecks` + `retainPaidBookingOnOverlap`:

- On paid path, loser Booking is **retained** (not deleted).
- Sets `metadata.paidOverlapConflict`, `paidOverlapConflictAt`, `paidOverlapConflictCode`, `paidOverlapConflictSummary`.
- Opens MRI `paid_booking_overlap_conflict`.
- Status remains a normal blocking enum value (`confirmed`/`pending`/…) today.

### 9.2 Preferred narrow policy (binding)

- Retain current paid-overlap Booking for financial evidence.
- Retain / enrich `metadata.paidOverlapConflict === true` plus winning Booking ID, unitId, dates, payment/checkout linkage, timestamp.
- **Every** inventory / blocking / guest-stay reader excludes those records.
- Operational / MRI readers may still show them as financial conflicts.
- No confirmation, arrival, cleaning, lifecycle, or guest-stay side effects.
- Payment and checkout evidence remain linked for manual disposition.
- Loser classification: `INVENTORY_EXHAUSTED_AFTER_PAYMENT` (permanent, MRI, no indefinite retry).
- No automatic refund in this sidequest.

### 9.3 Complete reader change list (S1 must update all)

Inventory/blocking/guest-stay exclusion of `metadata.paidOverlapConflict === true` is required in at least:

- `server/services/publicAvailabilityService.js`
- `server/services/assignmentEngine.js`
- `server/services/calendar/selectBlockingSpans.js`
- `server/services/calendar/selectBlockingSpansForUnit.js`
- `server/services/ops/domain/conflictService.js`
- `server/services/ops/readModels/calendarReadModel.js`
- `server/services/ops/domain/reservationWriteService.js`
- `server/services/cabins/cabinVisibilityService.js`
- `server/services/locationQuote/locationAvailabilityService.js`
- `server/routes/bookingRoutes.js` (overlap guards)
- `server/services/checkout/commercialStayGuardService.js` (when counting inventory occupancy, not fingerprint exclusivity diagnostics)
- capacity-evidence builders (`buildCabinTypeCapacityEvidence`)
- administrative availability/calendar readers that treat `pending|confirmed|in_house` as blocking
- any other query discovered in S1 implementation that treats those statuses as sellable occupancy without the conflict exclusion

Do not leave this as a generic “exclude from inventory” statement without updating this list (extend the list if new readers are found).

---

## 10. Recovery mutation order and forward reconciliation

### 10.1 Exact execute order

0. Verify original digest against received original `canonicalEvidence`; enforce max age; reread live evidence; abort on material diffs; verify intent phrase/actor/reason.
1. Atomically acquire recovery-specific lease (`failed_permanent` remains).
2. Search existing Booking by: `checkoutId`, `checkoutSessionId`, `stripePaymentIntentId`, `Payment.reservationId`.
3. Create Booking through capability-gated authoritative finalize **only** if none exists (`assignedUnitId` set).
4. Link `Payment.reservationId` (MRI auto-resolve **suppressed** — §11).
5. Finalize / link CheckoutSession (`bookingId`, `finalizeStatus=finalized`, `finalizedAt`).
6. Recovery-specific job success transition (confirmationQueuedAt may be null).
7. Convert SavedQuote where applicable (non-fatal toward money truth).
8. Ensure one pending confirmation EDS with `send:false`.
9. `markCheckoutFinalizationJobConfirmationQueued(...)`.
10. Verify all authoritative links (Booking unit AF-03, Payment, session, job succeeded, EDS, confirmationQueuedAt).
11. Resolve incident MRI under §11.
12. Write redacted recovery audit evidence.

### 10.2 Crash behavior

- **Never** delete a paid Booking created successfully.
- Second execution adopts partial work and reconciles forward.
- Booking without Payment link → recoverable.
- Payment linked without session finalize → recoverable.
- Session finalized without job success → recoverable.
- Job success without confirmation enqueue / confirmationQueuedAt → recoverable; **MRI stays open**.
- MRI is **not** the transaction boundary.
- No second charge; no second Booking (unique indexes on checkoutId / stripePaymentIntentId).

---

## 11. MRI auto-resolution policy (S0)

### 11.1 Problem

`linkStripePaymentToBooking` and `checkoutFinalizeSideEffects.resolveAlertsForBooking` auto-resolve open `payment_unlinked` reviews when a reservationId is present.

### 11.2 Locked policy

- Recovery passes capability into payment-linking and side-effects; those modules call `assertMultiUnitPaidOrphanRecoveryCapability` before suppressing auto-resolve.
- Incident MRI remains **open** until the final verification gate passes.
- Final verification requires **all** of:
  - Booking exists with `unitId` = expected AF-03
  - `Payment.reservationId` matches Booking
  - `CheckoutSession.bookingId` matches Booking
  - session `finalizeStatus=finalized`
  - job `status=succeeded` with recovery success evidence
  - confirmation EmailDeliveryState exists (`pending` or already definitive sent)
  - `confirmationQueuedAt` set (or EDS adopted-sent path equivalent)
- Only then resolve MRI with controlled note (no secrets).
- If confirmation enqueue / confirmationQueuedAt patch fails → keep MRI open; preserve Booking/Payment/session/job success links; second run may finish then resolve.
- Concurrent non-recovery callers of `linkStripePaymentToBooking` (ingestion/reconcile scripts) do **not** receive capability and must not suppress MRI during S0 execute window; ops should avoid concurrent link scripts on this PI while recovery runs.

---

## 12. Confirmation enqueue behavior

- S0 calls existing delivery SM with **`send: false`**.
- Ensures one durable pending `EmailDeliveryState` (`correlationKey` unique).
- Must not invoke SMTP; must not set `Booking.confirmationEmailSentAt`; must not set job `confirmationSentAt`.
- Set job `confirmationQueuedAt` only via §2.7 helper after pending/succeeded EDS exists.
- Confirmation worker remains stopped.
- Second run adopts existing pending/succeeded EDS.
- Enqueue failure does not undo Booking/Payment/session; MRI stays open (§11).

---

## 13. Error taxonomy (single authoritative module)

Introduce `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js` (S0 recovery codes first; S1 expands shared finalize permanence). Used by recovery, job classifier hooks for S0 codes, `safeDetails`, CLI, MRI evidence.

`safeDetails.permanent` and job permanence **must** use this source for codes this module owns.

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

---

## 14. S0 independence and deployment order

### 14.1 Independence

- S0 does **not** require `MULTI_UNIT_CAPACITY_STAY_GUARD`.
- S0 works while legacy commercial exclusivity remains enabled (capability-gated exclusivity bypass only for the allowlisted orphan).
- S0 does not require client deploy or confirmation worker running.
- S0 does not require the S1 provisional-capacity algorithm.
- S0 must deploy before incident execute.

### 14.2 Ordering

- **Incident execute before enabling S1 capacity flag**, unless self-exclusion + provisional rules are already verified in the deployed build.

### 14.3 S3 production order

1. Deploy approved S0 server/tooling.
2. Production dry-run (zero writes) → original evidence + digest.
3. Confirm operator intent (fixed phrase + `ops:<username>`).
4. Execute with original evidence/digest; live recheck AF-03.
5. Verify Booking / Payment / session / job / unit / EDS / confirmationQueuedAt.
6. Resolve MRI only after verification.
7. Leave confirmation pending.
8. Continue S1/S2 separately.

---

## 15. S2 session-storage and quantity scope

### 15.1 Client risk

`commercialBoundaryKey` is entity+dates only. Restoring sessionStorage for the same boundary can restore a prior completed checkoutId.

S2 must clear completed/finalized checkout storage before a second sequential one-unit checkout and mint a **new** `checkoutId`.

### 15.2 Quantity

Quantity remains absent from the public product model. Defensive API validation rejects `quantity > 1` if supplied. Do **not** build quantity-two support in this sidequest.

---

## 16. Feature flags

| Flag | Default | Purpose |
|------|---------|---------|
| `MULTI_UNIT_PAID_ORPHAN_RECOVERY` | false | S0 execute gate (with `--execute` + allowlist + digest + phrase) |
| `MULTI_UNIT_CAPACITY_STAY_GUARD` | false | S1 capacity-aware guard + pre-charge |

S0 recovery does **not** depend solely on the capacity flag. Capability remains required. Logs show boolean policy only; no PII.

---

## 17. Exact S0 file boundary

### 17.1 Add

- `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js`
- `server/services/checkout/multiUnitPaidOrphanRecoveryService.js`
- `server/scripts/recoverMultiUnitPaidOrphanCheckout.js`
- `server/scripts/multiUnitPaidOrphanRecovery.test.cjs`
- `docs/checkout-payment-architecture/04_MULTI_UNIT_PAID_ORPHAN_RECOVERY_CLI.md` (fake IDs only)
- `docs/checkout-payment-architecture/examples/multi-unit-paid-orphan-allowlist.example.json` (fake IDs)
- `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js`

### 17.2 Narrow modify

- `server/models/CheckoutFinalizationJob.js` — recovery fields + lease index + bounded history
- `server/services/checkout/checkoutFinalizationJobService.js` — claim, succeed-from-`failed_permanent`, confirmationQueuedAt patch; reconcile no-op while leased
- `server/services/checkout/commercialStayGuardService.js` — exclusivity bypass only after capability assert
- `server/services/checkout/finalizePaidCheckout.js` / `checkoutFinalizeService.js` — private recovery path hooks only under capability
- `server/services/checkout/executeBookingFinalizeWork.js` — only if needed to honor pre-assigned unit (already supported)
- `server/services/payments/paymentLinkingService.js` — suppress `payment_unlinked` auto-resolve only when capability asserts
- `server/services/checkout/checkoutFinalizeSideEffects.js` — force `send:false`; suppress MRI auto-resolve under capability
- `server/services/checkout/reconcilePaidCheckoutFinalization.js` — no-op mutate path while recovery lease active
- `server/utils/featureFlags.js` — `isMultiUnitPaidOrphanRecoveryEnabled()`

### 17.3 Explicitly exclude

- Confirmation-worker PM2 / Batches 2–3
- Global S1 capacity default-on
- Client quantity product
- Payment amount / Stripe charge or refund creation
- Unrelated voucher or messaging code
- Using Batch 8 `reconcilePaidCheckoutSubject` as the mutator for this incident

---

## 18. Exact S0 acceptance tests

S0 tests (exact-unit / recovery; **not** S1 provisional algorithm):

1. Dry-run performs **zero** Mongo mutations.
2. Exact allowlist required; wildcards rejected.
3. Fixed operator confirmation phrase required.
4. Actor (`ops:<username>`) / timestamp / reason required.
5. Digest generated deterministically from original canonicalEvidence.
6. Execute rejects when submitted digest ≠ H(received original evidence).
7. Execute rejects when live material fields diverge from original evidence (including AF-03 availability / unit updatedAt).
8. Digest older than max age rejects.
9. Wrong identifiers / hashes / amount / dates reject.
10. Guest identity mismatch rejects without exposing email.
11. Real capability predicate: normal finalizer args / plain bypass flags cannot forge bypass.
12. HTTP / webhook / worker / reconcile paths cannot bypass guard.
13. Recovery lease acquired **without** job `status=claimed`.
14. Normal worker cannot execute recovery-leased `failed_permanent` job.
15. Active lease → reconcile mutates nothing / opens no duplicate MRI.
16. Expired recovery lease can be reclaimed by recovery CLI only.
17. Original permanent failure evidence preserved after success.
18. Exact AF-03 validation passes when available.
19. Inactive / wrong-type / blocked / overlapping unit rejects.
20. Orphan paid session alone does **not** make AF-03 unavailable (no assigned unit).
21. No new PaymentIntent, charge, or refund.
22. Existing Booking by checkoutId/PI is adopted.
23. Concurrent creation race creates/adopts only one Booking.
24. Partial failure after Booking creation reconciles forward (no delete).
25. Payment link failure reconciles on second run.
26. Session link failure reconciles on second run.
27. Job completion failure reconciles on second run.
28. Job may succeed with `confirmationQueuedAt` null; patch sets it after EDS.
29. MRI remains open until full verification including confirmationQueuedAt/EDS.
30. Payment-link auto-resolution suppressed during recovery (real capability).
31. One pending confirmation EDS with `send:false`.
32. Confirmation enqueue failure leaves MRI open and links intact.
33. Second run idempotent.
34. No SMTP invoked.
35. No production identifiers / emails in tests.
36. `recoveryHistory` never exceeds 40 entries.

**S1-only:** aggregate provisional-slot self-exclusion, grouping precedence, disputed release, multi-reader paidOverlapConflict exclusion, concurrent last-unit loser inventory exclusion.

---

## 19. Exact S1 additions

### 19.1 Behavior

- Self-exclusion + grouping precedence (§7)
- Provisional lifecycle including disputed / explicit release (§8)
- Paid-loser retention + **full reader list** exclusion (§9)
- Pre-charge checks: quote, session refresh, before PI create
- Finalizer capacity recheck
- `INVENTORY_EXHAUSTED` / `INVENTORY_EXHAUSTED_AFTER_PAYMENT`
- Unified taxonomy permanence for inventory codes
- Feature flag `MULTI_UNIT_CAPACITY_STAY_GUARD` default false
- Single-cabin inventory keeps exclusivity
- Sequential same-guest multi-unit allowed when capacity remains (flag on)

### 19.2 S1 files

- Guard / quote / session / PI services as previously listed
- All §9.3 readers
- `featureFlags.js`
- Docs I5/P1/T17 + finalization taxonomy rows
- Tests: capacity matrix, grouping precedence, disputed, paidOverlapConflict across readers, flag off/on

---

## 20. Pre-charge behavior (S1)

Capacity checked at quote refresh, CheckoutSession refresh, and immediately before canonical PI creation. When exhausted: no new PI; clear conflict. Same-guest second-unit with capacity remaining must not be `DUPLICATE_STAY_CONFLICT`. Finalizer always rechecks. Existing PI reuse for same checkout follows canonical PI ownership when that session’s provisional slot still applies.

---

## 21. Replay identity vs inventory capacity

**Replay:** checkoutId, canonical PI, replayFingerprint, finalizeIntentHash, quoteSnapshotHash, Booking unique PI/checkout indexes.

**Capacity:** active units, per-unit overlap (excluding `paidOverlapConflict`), blockedDates, AvailabilityBlocks, provisional paid slots (§8).

`commercialStayFingerprint` may remain for audit/grouping; must not alone grant exclusive ownership of a multi-unit cabinType when capacity remains (flag on).

`commercialBoundaryKey` remains session-boundary metadata only — not inventory lock.

---

## 22. Indexes (must remain / respect)

- Booking unique `checkoutId` (partial string)
- Booking unique `stripePaymentIntentId` (partial)
- Booking `{ unitId, checkIn, checkOut }` (non-unique)
- Booking `{ commercialStayFingerprint, status }` **non-unique**
- CheckoutSession unique `checkoutId`; partial unique canonical PI
- CheckoutFinalizationJob unique active executable (`scheduled|claimed`) per checkoutId
- CheckoutFinalizationJob `{ recoveryStatus, recoveryVisibilityTimeoutAt }` (new)
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
| Trust boundary | Dedicated capability module; Symbol never exported; assert via predicate |
| Digest | Original evidence + digest; execute rematch original; live recheck separate |
| Job success | From `failed_permanent` via recovery helper; `confirmationQueuedAt` may be null |
| confirmationQueuedAt | Separate idempotent patch after EDS |
| Lease | recoveryStatus fields; worker never claimed; reconcile no-op while leased |
| Dry-run | Zero writes |
| Guest identity | In-memory normalize + compare; booleans only |
| Intent | Fixed phrase + `ops:<username>` evidence + timestamp + reason + digest |
| Unit | Exact AF-03 via `assignedUnitId` after validateUnitForCabinTypeBooking |
| MRI | Suppress auto-resolve under capability; resolve after verify including queued confirmation |
| Confirmation | `send:false` pending EDS; worker stopped |
| Paid loser | Retain Booking; exclude paidOverlapConflict in **all** listed readers |
| Provisional | Aggregate slot; no auto-expiry; disputed stays blocked; explicit release field |
| Grouping | Booking → PI → checkoutId → session → job |
| Deploy | S0 deploy → dry-run → intent → execute → verify → MRI; then S1 flag |

**End of binding architecture lock (clarified 2026-08-03).**
