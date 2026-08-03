# Architecture Lock: Multi-Unit CabinType Capacity Guard and Paid Orphan Recovery

**Status:** BINDING DESIGN — implementation must follow this document
**Created:** 2026-08-01
**Remediated:** 2026-08-03 (post REJECTED audit)
**Clarified:** 2026-08-03 (capability module, digest freshness, confirmationQueuedAt split, S1 grouping, paid-overlap readers, disputed capacity, lease indexes)
**Ownership-restricted:** 2026-08-03 (AsyncLocalStorage recovery context; runner import ownership; paid-overlap guest-stay predicates; dry-run envelope timestamp equality)
**Scope:** Immediate allowlisted recovery of one paid multi-unit orphan (R0 / S0), permanent capacity-aware same-cabinType booking behavior (R1 / S1), deferred quantity-two UX (R2 / S2)
**Branch basis:** `origin/master`
**Out of scope:** Confirmation-worker Batches 1–3, PM2 confirmation-worker process, automatic refunds, public quantity=2 checkout

This document is the single source of truth for the multi-unit cabinType capacity and paid-orphan recovery sidequest. Application code must not diverge from these decisions without an explicit architecture revision.

**Audit trail:** Prior `REJECTED` findings addressed; commit `ce18bd5` addressed digest/confirmationQueuedAt/grouping; this revision addresses `APPROVED AFTER MINOR` for public `runWith` minting, paid-overlap guest-stay coverage, and dry-run envelope timestamp binding.

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

### 1.0 Trust-scope statement (binding)

- The capability mechanism protects recovery privileges from **untrusted runtime inputs** and **accidental ordinary-path invocation**.
- It is **not** designed to defend against malicious application code already committed inside the trusted server repository.
- All application modules are trusted code. Node does **not** provide runtime per-import access control between trusted CommonJS modules.
- Trusted-code ownership is therefore enforced through:
  - narrow exports
  - static import restrictions
  - source-boundary tests
  - code review
- **No** database field, HTTP field, Stripe metadata, CLI argument, webhook payload, job payload, CheckoutSession field, CheckoutFinalizationJob field, Payment field, or other persisted value is treated as an authorization capability.

### 1.1 Module ownership

| Layer | Path |
|-------|------|
| CLI | `server/scripts/recoverMultiUnitPaidOrphanCheckout.js` — calls recovery service only; **must not** import the capability module |
| Recovery service | `server/services/checkout/multiUnitPaidOrphanRecoveryService.js` → **`recoverAllowlistedMultiUnitPaidOrphanCheckout(...)`** — **sole** importer of `runInMultiUnitPaidOrphanRecoveryContext` |
| Private capability module | `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js` |
| Commercial guard | `commercialStayGuardService.js` — exclusivity bypass only after `assertMultiUnitPaidOrphanRecoveryContext()` |
| Exact-unit injection | Private recovery path sets `finalizeContext.assignedUnitId` only after `assertMultiUnitPaidOrphanRecoveryContext()` |
| Job lease / success / confirmationQueuedAt | Recovery-specific helpers in `checkoutFinalizationJobService.js` — assert context before privileged lease/complete |
| Payment link MRI suppress | `paymentLinkingService.js` — asserts active recovery context before suppress |
| Side effects | `checkoutFinalizeSideEffects.js` — `send:false` + MRI suppress after context assert |
| Confirmation | `ensurePendingConfirmationDelivery` / `processBookingConfirmationDelivery({ send: false })` |

### 1.2 Private capability module (binding AsyncLocalStorage context)

File: `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js`

```js
const { AsyncLocalStorage } = require('async_hooks');

// Module-private — NEVER exported, returned, thrown, logged, serialized, or persisted
const CAPABILITY = Symbol('multiUnitPaidOrphanRecoveryCapability');
const recoveryContext = new AsyncLocalStorage();

function runInMultiUnitPaidOrphanRecoveryContext(callback) {
  // Callback receives NO capability argument.
  return recoveryContext.run(CAPABILITY, callback);
}

function isMultiUnitPaidOrphanRecoveryContext() {
  return recoveryContext.getStore() === CAPABILITY;
}

function assertMultiUnitPaidOrphanRecoveryContext() {
  if (!isMultiUnitPaidOrphanRecoveryContext()) {
    throw new Error('MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED');
  }
}

module.exports = {
  runInMultiUnitPaidOrphanRecoveryContext,
  isMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
  // CAPABILITY / Symbol / AsyncLocalStorage instance intentionally NOT exported
};
```

#### Capability-value ban (absolute)

The private Symbol / store value is **never**:

- exported
- returned from any function
- thrown as an error payload
- logged
- serialized
- persisted
- passed through function parameters
- placed on dependency objects / service options
- placed on finalization context as a capability token
- stored on CheckoutSession, CheckoutFinalizationJob, Payment, Stripe metadata
- accepted from HTTP, webhook, CLI, reconcile, or worker input
- exposed to tests as a forgeable token

Plain options such as:

```js
{
  bypassCommercialStayExclusivity: true,
  expectedUnitId: '...',
  suppressPaymentUnlinkedResolution: true
}
```

remain **ineffective** outside an active recovery AsyncLocalStorage context. Downstream code may still accept such option shapes for readability, but each privileged behavior must call `assertMultiUnitPaidOrphanRecoveryContext()` (or `isMultiUnitPaidOrphanRecoveryContext()`) immediately before applying the privilege.

#### Required behavior

- `runInMultiUnitPaidOrphanRecoveryContext` creates an asynchronous context containing the private Symbol.
- The callback receives **no** capability argument.
- Async context must propagate through **awaited** recovery operations.
- Normal HTTP, webhook, worker, reconciliation, and ordinary finalization execution have **no** recovery context and therefore cannot enable:
  - commercial-stay exclusivity bypass
  - exact-unit recovery injection
  - MRI auto-resolution suppression
  - recovery-only job transitions
- Logging and error serialization must **not** inspect or include the AsyncLocalStorage store.
- The runner returns **only** the recovery result, never context internals.
- Confirmation delivery is queued with `send:false`; no worker task inherits recovery context.
- The durable EmailDeliveryState contains **no** recovery capability or bypass marker.

### 1.3 Runner import ownership (static)

Acknowledge: repository ownership of the context **runner** must be statically enforced because Node cannot prevent one trusted module from importing another.

**Lock:**

- **Only** `server/services/checkout/multiUnitPaidOrphanRecoveryService.js` may import `runInMultiUnitPaidOrphanRecoveryContext`.
- Guard, finalization, payment-linking, job, and side-effect modules may import **only**:
  - `assertMultiUnitPaidOrphanRecoveryContext`
  - `isMultiUnitPaidOrphanRecoveryContext`
- Routes, webhook handlers, workers, reconciliation, scripts other than the approved recovery CLI, and unrelated services **must not** import the runner.
- The CLI **must not** import the capability module. It calls only the recovery service.
- The recovery service **must not** re-export the runner.
- The capability module **must not** export the Symbol.

#### Implementation enforcement

**A.** Existing ESLint `no-restricted-imports` (or an equivalent repository import-boundary rule), **when** current lint infrastructure supports it. Do **not** invent a new lint system solely for this sidequest. Server application lint today is not guaranteed to host this rule; if unavailable, skip inventing one.

**B. Mandatory regardless of lint:** a deterministic architecture / source-boundary test that scans application `import` / `require` graphs and **fails** unless the runner import appears only in the approved recovery service.

The source-boundary test must also fail when:

- another module imports the runner
- another module re-exports the runner
- the private capability module exports the Symbol
- the recovery service re-exports the runner
- a route, webhook, worker, or reconcile module imports the capability runner

Tests must prove real production ownership. They must **not** mock the capability validator to always succeed.

### 1.4 Sensitive inner functions that must assert context

Do **not** rely on assertion only in the outer recovery service. Active recovery context must be asserted inside the **real production function** that performs each privileged seam, **immediately before** applying the privileged behavior:

| Privileged seam | Assert inside |
|-----------------|---------------|
| Bypass of same-guest commercial-stay exclusivity | Real commercial-stay guard path that would otherwise throw `DUPLICATE_STAY_CONFLICT` |
| Insertion of `expectedTargetUnitId` into `finalizeContext.assignedUnitId` | Real recovery finalize injection helper / path that assigns the unit |
| Suppression of payment-unlinked MRI auto-resolution during Payment linking | Real `linkStripePaymentToBooking` (or equivalent production linker) suppress branch |
| Suppression of payment-unlinked MRI auto-resolution during finalize side effects | Real `checkoutFinalizeSideEffects` / `resolveAlertsForBooking` suppress branch |
| Recovery-specific acquisition of a failed-permanent job lease | Real recovery lease claim helper |
| Recovery-specific completion of the failed-permanent job | Real `markCheckoutFinalizationJobSucceededFromMultiUnitRecovery` (or equivalent) |
| Recovery-only ManualReview resolution after final verification | Real recovery MRI resolve helper |

Normal behavior must remain unchanged when no active context exists.

### 1.5 Asynchronous-context escape prevention

- Recovery must **not** start unawaited background work inside the capability context.
- No callback, timer, queue task, event emitter, or detached Promise may retain recovery privileges after the authoritative recovery call completes.
- All privileged work must be **awaited** before `runInMultiUnitPaidOrphanRecoveryContext` returns.
- Parallel normal finalization must remain outside recovery context.
- Parallel recovery executions must not share incident state (each run has its own allowlist/evidence; ALS stores only the private Symbol, not incident payloads).

### 1.6 Exact ownership call boundary

```text
CLI recoverMultiUnitPaidOrphanCheckout.js
  └─ recoverAllowlistedMultiUnitPaidOrphanCheckout({ allowlist, originalEvidence, digest, intent, execute, actor, ... })
       ├─ read-only preflight / digest verify / live recheck
       ├─ claimRecoveryLeaseOnFinalizationJob(...)   // asserts context OR is invoked only under runner; see §1.4
       └─ runInMultiUnitPaidOrphanRecoveryContext(async () => {
            // callback receives NO capability argument
            ├─ validateUnitForCabinTypeBooking(AF-03…)
            ├─ assertNoCommercialStayConflict(...)  // inner guard asserts ALS context before exclusivity bypass
            ├─ private recovery finalize path sets assignedUnitId (asserts ALS before inject)
            ├─ linkStripePaymentToBooking(...)      // asserts ALS before MRI suppress
            ├─ side effects send:false + MRI suppress (asserts ALS)
            ├─ recovery-specific job success (asserts ALS; confirmationQueuedAt may remain null)
            ├─ ensure pending EDS
            ├─ markCheckoutFinalizationJobConfirmationQueued(...)
            └─ verify gate → resolve MRI (asserts ALS)
          })
```

Lease claim may occur immediately before or inside the runner; if lease claim performs recovery-only privileged mutation, it must assert active context (prefer claiming inside the runner after context starts, or start context before claim). Authoritative rule: every recovery-only privileged seam asserts ALS immediately before the privilege.

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
  dryRunGeneratedAt, // outer display/convenience — MUST equal canonicalEvidence.dryRunGeneratedAt
  canonicalEvidence, // includes dryRunGeneratedAt; sole digest input
  digest             // SHA-256 of canonical serialization of canonicalEvidence ONLY
}
```

**Envelope timestamp equality (binding):**

- Invariant: `dryRunGeneratedAt === canonicalEvidence.dryRunGeneratedAt`
- Execute **must reject** when those values differ (`RECOVERY_DIGEST_MISMATCH` or a dedicated envelope-integrity code that aborts before mutation).
- The digest hashes **only** `canonicalEvidence`.
- The outer timestamp is a display/convenience field and **must not** create a second independent time value.
- Maximum age is calculated from the timestamp **inside** `canonicalEvidence` **after** envelope equality is verified.

#### B. Execute-time live evidence

Execute receives the **original** envelope (`dryRunGeneratedAt`, `canonicalEvidence`, `digest`), plus phrase, actor, intent timestamp, reason, execute flag.

Execute must:

1. Verify `envelope.dryRunGeneratedAt === canonicalEvidence.dryRunGeneratedAt`.
2. Recompute SHA-256 from the **received original** `canonicalEvidence`.
3. Verify it matches the submitted digest.
4. Enforce maximum digest age (binding default **24 hours**) using `canonicalEvidence.dryRunGeneratedAt`.
5. Independently reread all live evidence.
6. Compare live material fields with the original `canonicalEvidence`.
7. Abort (`RECOVERY_DIGEST_MISMATCH`) when any material field changed.

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
3. Inside the ALS recovery context only, after `assertMultiUnitPaidOrphanRecoveryContext()`, set:

   ```js
   finalizeContext.assignedUnitId = expectedTargetUnitId
   ```

   Do **not** pass a capability Symbol into finalize context. Context presence is proven only via ALS assert.
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
- Status remains a normal Booking enum value (`confirmed`/`pending`/…) today while carrying `metadata.paidOverlapConflict === true`.

### 9.2 Shared predicates (binding ownership)

S1 must introduce shared predicates with distinct ownership (exact module path chosen during S1; one authoritative home, reused everywhere):

- `isInventoryBlockingBooking(booking)`
- `isGuestStayEligibleBooking(booking)`
- optionally `isOperationalReservationBooking(booking)`

**All** of these predicates must return **false** for:

`metadata.paidOverlapConflict === true`

unless the caller is explicitly an Ops / payment-conflict evidence reader that intentionally opts out of the shared predicate and documents why.

Missing metadata remains **backward-compatible** (treat as non-conflict).

### 9.3 Preferred narrow policy (binding)

Required retained-conflict behavior:

- remains visible to payment / conflict Ops views
- remains linked to financial evidence
- does **not** block sellable inventory
- does **not** appear as a valid guest stay
- does **not** receive confirmation, reminder, arrival, cleaning, access, cancellation, review-request, or channel side effects
- cannot be modified through ordinary guest-stay workflows
- is resolved only through an explicit paid-overlap disposition path

Additional policy:

- Retain / enrich `metadata.paidOverlapConflict === true` plus winning Booking ID, unitId, dates, payment/checkout linkage, timestamp.
- Loser classification: `INVENTORY_EXHAUSTED_AFTER_PAYMENT` (permanent, MRI, no indefinite retry).
- No automatic refund in this sidequest.

### 9.4 Inventory exclusion readers (S1 must update all)

Inventory exclusion via `isInventoryBlockingBooking` (or equivalent shared filter) must cover every blocking query and reader already listed here, and any newly discovered sellable-occupancy reader:

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
- `icsBlockingEligibility` and calendar/ICS export eligibility paths
- any other query discovered in S1 that treats those statuses as sellable occupancy without conflict exclusion

### 9.5 Guest-stay and operational exclusion (S1 — mandatory expansion)

Guest-stay and operational exclusion via `isGuestStayEligibleBooking` / `isOperationalReservationBooking` must cover **every** repository path that could treat the retained conflict as a real stay, including at minimum:

- `messageVariableResolver`
- messaging confirmed-stay selectors
- scheduled guest messages
- confirmation lifecycle paths
- reminder lifecycle paths
- cancellation lifecycle paths, unless handling conflict disposition explicitly
- arrival / access message creation
- arrival-guide eligibility
- cleaning task generation
- housekeeping schedules
- guest portal booking lists
- calendar / ICS export eligibility
- `icsBlockingEligibility`
- `maintenanceIntegrityPreviews`
- `reservationIntegritySignals`
- `reservationIntegrityCleanup`
- channel / export synchronization
- reservation notes or operational work queues derived from confirmed stays
- admin guest-stay dashboards
- any query selecting `pending|confirmed|in_house` without conflict-metadata exclusion

Do **not** leave exclusion as a list of selected inventory files only.

### 9.6 Required repository-wide search during S1 implementation

S1 implementation must search the repository for (and remediate matches that treat conflict Bookings as real stays / blockers without exclusion):

- `status: { $in: ... confirmed ... }`
- `status: 'confirmed'`
- confirmed / in_house selectors
- arrival
- reminder
- cleaning
- access
- guest portal
- ICS
- channel sync
- lifecycle email
- message scheduling

Extend §9.4 / §9.5 lists when new readers are found.

## 10. Recovery mutation order and forward reconciliation

### 10.1 Exact execute order

0. Verify original digest against received original `canonicalEvidence`; enforce max age; reread live evidence; abort on material diffs; verify intent phrase/actor/reason.
1. Atomically acquire recovery-specific lease (`failed_permanent` remains).
2. Search existing Booking by: `checkoutId`, `checkoutSessionId`, `stripePaymentIntentId`, `Payment.reservationId`.
3. Create Booking through ALS-gated authoritative finalize **only** if none exists (`assignedUnitId` set after context assert).
4. Link `Payment.reservationId` (MRI auto-resolve **suppressed** after ALS assert — §11).
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

- Recovery runs payment-linking and side-effects **inside** `runInMultiUnitPaidOrphanRecoveryContext`. Those modules call `assertMultiUnitPaidOrphanRecoveryContext()` immediately before suppressing auto-resolve. No capability value is passed as an argument.
- Incident MRI remains **open** until the final verification gate passes.
- Final verification requires **all** of:
  - Booking exists with `unitId` = expected AF-03
  - `Payment.reservationId` matches Booking
  - `CheckoutSession.bookingId` matches Booking
  - session `finalizeStatus=finalized`
  - job `status=succeeded` with recovery success evidence
  - confirmation EmailDeliveryState exists (`pending` or already definitive sent)
  - `confirmationQueuedAt` set (or EDS adopted-sent path equivalent)
- Only then resolve MRI with controlled note (no secrets), after ALS assert in the recovery MRI resolve helper.
- If confirmation enqueue / confirmationQueuedAt patch fails → keep MRI open; preserve Booking/Payment/session/job success links; second run may finish then resolve.
- Concurrent non-recovery callers of `linkStripePaymentToBooking` (ingestion/reconcile scripts) have **no** recovery ALS context and must not suppress MRI during S0 execute window; ops should avoid concurrent link scripts on this PI while recovery runs.

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
- S0 works while legacy commercial exclusivity remains enabled (ALS-gated exclusivity bypass only for the allowlisted orphan).
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

S0 recovery does **not** depend solely on the capacity flag. Active ALS recovery context remains required for privileged seams. Logs show boolean policy only; no PII.

---

## 17. Exact S0 file boundary

### 17.1 Add

- `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js`
- `server/services/checkout/multiUnitPaidOrphanRecoveryService.js`
- `server/scripts/recoverMultiUnitPaidOrphanCheckout.js`
- `server/scripts/multiUnitPaidOrphanRecovery.test.cjs`
- `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.boundary.test.cjs` (or equivalent under `server/tests` / `server/services/checkout` — exact path chosen in S0; **mandatory** source-boundary test)
- `docs/checkout-payment-architecture/04_MULTI_UNIT_PAID_ORPHAN_RECOVERY_CLI.md` (fake IDs only)
- `docs/checkout-payment-architecture/examples/multi-unit-paid-orphan-allowlist.example.json` (fake IDs)
- `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js`

If current lint infrastructure supports repository `no-restricted-imports` (or equivalent) for the runner, include that **existing** lint configuration file in S0 scope. If not, do **not** invent a new lint system solely for this sidequest; the source-boundary test remains mandatory.

### 17.2 Narrow modify

- `server/models/CheckoutFinalizationJob.js` — recovery fields + lease index + bounded history
- `server/services/checkout/checkoutFinalizationJobService.js` — claim, succeed-from-`failed_permanent`, confirmationQueuedAt patch; reconcile no-op while leased; ALS assert on privileged recovery helpers
- `server/services/checkout/commercialStayGuardService.js` — exclusivity bypass only after `assertMultiUnitPaidOrphanRecoveryContext()`
- `server/services/checkout/finalizePaidCheckout.js` / `checkoutFinalizeService.js` — private recovery path hooks only under ALS context
- `server/services/checkout/executeBookingFinalizeWork.js` — only if needed to honor pre-assigned unit (already supported)
- `server/services/payments/paymentLinkingService.js` — suppress `payment_unlinked` auto-resolve only when ALS context asserts
- `server/services/checkout/checkoutFinalizeSideEffects.js` — force `send:false`; suppress MRI auto-resolve under ALS context
- `server/services/checkout/reconcilePaidCheckoutFinalization.js` — no-op mutate path while recovery lease active
- `server/utils/featureFlags.js` — `isMultiUnitPaidOrphanRecoveryEnabled()`

Do not otherwise widen S0.
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
5. Digest generated deterministically from original `canonicalEvidence` only.
6. Outer `dryRunGeneratedAt` must equal `canonicalEvidence.dryRunGeneratedAt`; execute rejects when they differ.
7. Execute rejects when submitted digest ≠ H(received original `canonicalEvidence`).
8. Execute rejects when live material fields diverge from original evidence (including AF-03 availability / unit updatedAt).
9. Digest older than max age rejects (age from `canonicalEvidence.dryRunGeneratedAt` after envelope equality).
10. Wrong identifiers / hashes / amount / dates reject.
11. Guest identity mismatch rejects without exposing email.
12. Real ALS context predicate: normal finalizer args / plain bypass flags cannot forge bypass outside recovery context.
13. HTTP / webhook / worker / reconcile paths cannot bypass guard.
14. Source-boundary: only recovery service may import `runInMultiUnitPaidOrphanRecoveryContext`; Symbol not exported; runner not re-exported.
15. Recovery lease acquired **without** job `status=claimed`.
16. Normal worker cannot execute recovery-leased `failed_permanent` job.
17. Active lease → reconcile mutates nothing / opens no duplicate MRI.
18. Expired recovery lease can be reclaimed by recovery CLI only.
19. Original permanent failure evidence preserved after success.
20. Exact AF-03 validation passes when available.
21. Inactive / wrong-type / blocked / overlapping unit rejects.
22. Orphan paid session alone does **not** make AF-03 unavailable (no assigned unit).
23. No new PaymentIntent, charge, or refund.
24. Existing Booking by checkoutId/PI is adopted.
25. Concurrent creation race creates/adopts only one Booking.
26. Partial failure after Booking creation reconciles forward (no delete).
27. Payment link failure reconciles on second run.
28. Session link failure reconciles on second run.
29. Job completion failure reconciles on second run.
30. Job may succeed with `confirmationQueuedAt` null; patch sets it after EDS.
31. MRI remains open until full verification including confirmationQueuedAt/EDS.
32. Payment-link auto-resolution suppressed during recovery (real ALS assert in linker).
33. Sensitive inner functions assert ALS immediately before privilege (guard, unit inject, MRI suppress, lease, job complete, MRI resolve).
34. One pending confirmation EDS with `send:false`; EDS contains no recovery/bypass marker.
35. Confirmation enqueue failure leaves MRI open and links intact.
36. Second run idempotent.
37. No SMTP invoked.
38. No production identifiers / emails in tests.
39. `recoveryHistory` never exceeds 40 entries.
40. Async-context: context active across awaited operations.
41. Async-context: context absent before runner invocation.
42. Async-context: context absent after runner completion.
43. Async-context: context not present in a later timer or detached task.
44. Parallel normal finalization remains outside recovery context.
45. Parallel recovery executions do not share incident state.

**S1-only:** aggregate provisional-slot self-exclusion, grouping precedence, disputed release, multi-reader paidOverlapConflict exclusion (inventory **and** guest-stay), concurrent last-unit loser inventory exclusion.

---

## 19. Exact S1 additions

### 19.1 Behavior

- Self-exclusion + grouping precedence (§7)
- Provisional lifecycle including disputed / explicit release (§8)
- Paid-loser retention + shared predicates + **inventory and guest-stay reader lists** (§9)
- Pre-charge checks: quote, session refresh, before PI create
- Finalizer capacity recheck
- `INVENTORY_EXHAUSTED` / `INVENTORY_EXHAUSTED_AFTER_PAYMENT`
- Unified taxonomy permanence for inventory codes
- Feature flag `MULTI_UNIT_CAPACITY_STAY_GUARD` default false
- Single-cabin inventory keeps exclusivity
- Sequential same-guest multi-unit allowed when capacity remains (flag on)

### 19.2 S1 files

- Guard / quote / session / PI services as previously listed
- Shared predicate module(s) for `isInventoryBlockingBooking` / `isGuestStayEligibleBooking` / optional operational predicate
- All §9.4 inventory readers and §9.5 guest-stay / operational readers (extend after repository-wide search §9.6)
- `featureFlags.js`
- Docs I5/P1/T17 + finalization taxonomy rows

### 19.3 Locked S1 paid-overlap predicate tests

- paid-overlap Booking excluded from public availability
- excluded from AssignmentEngine blocking spans
- excluded from calendar and ICS blocking
- excluded from guest portal stay list
- excluded from confirmation eligibility
- excluded from reminders
- excluded from arrival / access messages
- excluded from cleaning schedules
- excluded from message variable resolution
- excluded from channel / export synchronization
- excluded from ordinary reservation modification flows
- still visible in payment-conflict and ManualReview Ops views
- normal confirmed Booking without `paidOverlapConflict` remains eligible
- missing metadata remains backward-compatible
- shared predicate is used rather than duplicated metadata checks where practical

These are **S1** requirements and do **not** expand S0 implementation.

Additional S1 tests: capacity matrix, grouping precedence, disputed release, concurrent last-unit loser inventory exclusion, flag off/on.
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
| Trust scope | Protects untrusted inputs / accidental ordinary paths; not malicious trusted in-repo code |
| Capability | Private Symbol in AsyncLocalStorage; never exported, passed, or persisted |
| Runner ownership | Only recovery service imports `runInMultiUnitPaidOrphanRecoveryContext`; source-boundary test mandatory |
| Sensitive seams | Inner production functions assert ALS immediately before privilege |
| Async escape | No unawaited work; context gone after runner; timers/detached tasks have no privilege |
| Digest | Hash `canonicalEvidence` only; outer `dryRunGeneratedAt` must equal inner; age from inner |
| Job success | From `failed_permanent` via recovery helper; `confirmationQueuedAt` may be null |
| confirmationQueuedAt | Separate idempotent patch after EDS |
| Lease | recoveryStatus fields; worker never claimed; reconcile no-op while leased |
| Dry-run | Zero writes |
| Guest identity | In-memory normalize + compare; booleans only |
| Intent | Fixed phrase + `ops:<username>` evidence + timestamp + reason + digest |
| Unit | Exact AF-03 via `assignedUnitId` after validateUnitForCabinTypeBooking + ALS assert |
| MRI | Suppress auto-resolve under ALS context; resolve after verify including queued confirmation |
| Confirmation | `send:false` pending EDS; worker stopped; EDS has no bypass marker |
| Paid loser | Retain Booking; `isInventoryBlockingBooking` + `isGuestStayEligibleBooking` exclude conflict |
| Guest-stay coverage | Messaging, arrival, cleaning, portal, ICS, channel, integrity, lifecycle — not inventory-only |
| Provisional | Aggregate slot; no auto-expiry; disputed stays blocked; explicit release field |
| Grouping | Booking → PI → checkoutId → session → job |
| Deploy | S0 deploy → dry-run → intent → execute → verify → MRI; then S1 flag |

**End of binding architecture lock (ownership-restricted 2026-08-03).**
