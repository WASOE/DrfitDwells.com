# Architecture Lock: Multi-Unit CabinType Capacity Guard and Paid Orphan Recovery

**Status:** BINDING DESIGN — implementation must follow this document
**Created:** 2026-08-01
**Remediated:** 2026-08-03 (post REJECTED audit)
**Clarified:** 2026-08-03 (capability module, digest freshness, confirmationQueuedAt split, S1 grouping, paid-overlap readers, disputed capacity, lease indexes)
**Ownership-restricted:** 2026-08-03 (AsyncLocalStorage recovery context; runner import ownership; paid-overlap guest-stay predicates; dry-run envelope timestamp equality)
**Resume-scoped:** 2026-08-03 (incident-scoped ALS; real Node ALS semantics; initial/resume modes; recoveryStatus through EDS/MRI; durable MRI hold; 15-minute lease)
**Ownership-finalized:** 2026-08-03 (ensure-only EDS; sole confirmationQueuedAt owner; recoveryDedupeKey unique completion MRI; exact hold transfer; hold-aware resolvers; matchesIncidentScope)
**Scope:** Immediate allowlisted recovery of one paid multi-unit orphan (R0 / S0), permanent capacity-aware same-cabinType booking behavior (R1 / S1), deferred quantity-two UX (R2 / S2)
**Branch basis:** `origin/master`
**Out of scope:** Confirmation-worker Batches 1–3, PM2 confirmation-worker process, automatic refunds, public quantity=2 checkout

This document is the single source of truth for the multi-unit cabinType capacity and paid-orphan recovery sidequest. Application code must not diverge from these decisions without an explicit architecture revision.

**Audit trail:** Prior findings addressed through `cfee6f0`; this revision remediates `APPROVED AFTER MINOR` for confirmationQueuedAt ownership, completion-MRI uniqueness, hold transfer, hold-aware writers, and exact scope matching.

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
- Source-boundary scanning protects the trusted repository against **accidental privilege widening**. It does **not** claim to stop malicious committed code.
- **No** database field, HTTP field, Stripe metadata, CLI argument, webhook payload, job payload, CheckoutSession field, CheckoutFinalizationJob field, Payment field, ManualReviewItem field, or other persisted value is treated as an authorization capability. Persisted incident identifiers and MRI holds are **scope and coordination** evidence only.

### 1.1 Module ownership

| Layer | Path |
|-------|------|
| CLI | `server/scripts/recoverMultiUnitPaidOrphanCheckout.js` — calls recovery service only; **must not** import any capability-module API |
| Recovery service | `server/services/checkout/multiUnitPaidOrphanRecoveryService.js` → **`recoverAllowlistedMultiUnitPaidOrphanCheckout(...)`** — **sole** importer of `runInMultiUnitPaidOrphanRecoveryContext` |
| Private capability module | `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js` |
| Recovery errors | `server/services/checkout/multiUnitPaidOrphanRecoveryErrors.js` |
| Commercial guard | `commercialStayGuardService.js` — exclusivity bypass only after branded context + argument identity match |
| Exact-unit injection | Private recovery path sets `finalizeContext.assignedUnitId` only after context + identity assert |
| Job lease / phase / confirmationQueuedAt | Recovery-specific helpers in `checkoutFinalizationJobService.js` — **sole** S0 owner of job `confirmationQueuedAt` |
| Payment link MRI suppress / hold | Hold-aware resolution helper + payment-linking — ALS + durable hold |
| Side effects | `checkoutFinalizeSideEffects.js` — **MRI hold-awareness / suppress only**; not confirmation queue or Ops push owner during S0 |
| Confirmation EDS | `server/services/email/bookingConfirmationDeliveryService.js` → **`ensurePendingConfirmationDelivery` only** while recovery incomplete |
| ManualReview hold gate | Shared hold-evaluation helper used by **every** resolve writer |

### 1.2 Private capability module (incident-scoped AsyncLocalStorage)

File: `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js`

```js
const { AsyncLocalStorage } = require('async_hooks');

// Module-private — NEVER exported, returned, thrown, logged, serialized, or persisted
const BRAND = Symbol('multiUnitPaidOrphanRecoveryCapability');
const recoveryContext = new AsyncLocalStorage();

function runInMultiUnitPaidOrphanRecoveryContext(scope, callback) {
  // scope = validated immutable incident fields from recovery service (no brand yet)
  // Runner constructs brand internally. Callback receives NO context argument.
  const store = Object.freeze({
    brand: BRAND,
    schemaVersion: 'multi-unit-paid-orphan-recovery-context/v1',
    recoveryMode: scope.recoveryMode, // 'initial' | 'resume'
    recoveryExecutionId: scope.recoveryExecutionId,
    checkoutId: scope.checkoutId,
    checkoutSessionId: scope.checkoutSessionId,
    paymentIntentId: scope.paymentIntentId,
    paymentId: scope.paymentId,
    finalizationJobId: scope.finalizationJobId,
    manualReviewItemId: scope.manualReviewItemId,
    cabinTypeId: scope.cabinTypeId,
    expectedTargetUnitId: scope.expectedTargetUnitId,
    evidenceDigest: scope.evidenceDigest
  });
  return recoveryContext.run(store, callback);
}

function getMultiUnitPaidOrphanRecoveryContext() {
  const store = recoveryContext.getStore();
  if (!store || store.brand !== BRAND) return null;
  return store;
}

function matchesIncidentScope(store, expectedScope) {
  // Binding equality rules: see §1.5.1
  return compareIncidentScope(store, expectedScope);
}

function isMultiUnitPaidOrphanRecoveryContext(expectedScope) {
  const store = getMultiUnitPaidOrphanRecoveryContext();
  if (!store) return false;
  if (!expectedScope) return true; // presence-only diagnostic — MUST NOT authorize privileged mutations
  return matchesIncidentScope(store, expectedScope);
}

function assertMultiUnitPaidOrphanRecoveryContext(expectedScope) {
  const store = getMultiUnitPaidOrphanRecoveryContext();
  if (!store || store.brand !== BRAND) {
    throw createSanitizedRecoveryError('MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED');
  }
  // Privileged callers MUST pass expectedScope. Omitting it fails closed.
  if (!expectedScope || !matchesIncidentScope(store, expectedScope)) {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH');
  }
}

module.exports = {
  runInMultiUnitPaidOrphanRecoveryContext,
  getMultiUnitPaidOrphanRecoveryContext,
  isMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext
  // BRAND / Symbol / AsyncLocalStorage instance intentionally NOT exported
};
```

#### Final incident-scoped context schema (binding)

```js
{
  brand,                 // private Symbol — never exported
  schemaVersion,         // 'multi-unit-paid-orphan-recovery-context/v1'
  recoveryMode,          // 'initial' | 'resume'
  recoveryExecutionId,   // unique per recovery execution; retained across lease reclaim
  checkoutId,
  checkoutSessionId,
  paymentIntentId,
  paymentId,
  finalizationJobId,
  manualReviewItemId,
  cabinTypeId,
  expectedTargetUnitId,
  evidenceDigest         // SHA-256 hex of canonicalEvidence
}
```

Rules:

- Complete store is created only by the approved recovery service calling the runner.
- Store is frozen before entering AsyncLocalStorage; no field is mutable during the run.
- Store is never serialized, persisted, logged, returned, thrown, or placed in model/service options.
- Identifiers are ordinary incident **scope**, not independent authorization.
- Private brand + approved runner establishes trusted recovery execution.
- Exact incident fields prevent recovery context for incident A from affecting incident B.

#### Capability-value ban (absolute)

The private brand Symbol and the ALS store are **never**:

- exported
- returned from any function (except `getMultiUnitPaidOrphanRecoveryContext` returning the frozen in-memory store to trusted callers during the active run — never across the CLI/HTTP boundary)
- thrown as an error payload
- logged
- serialized
- persisted
- passed through function parameters as a capability token
- placed on dependency objects / service options
- stored on CheckoutSession, CheckoutFinalizationJob, Payment, Stripe metadata, ManualReviewItem (MRI hold stores only ordinary IDs, not the brand)
- accepted from HTTP, webhook, CLI, reconcile, or worker input
- exposed to tests as a forgeable token

Plain options such as `{ bypassCommercialStayExclusivity: true, expectedUnitId: '...', suppressPaymentUnlinkedResolution: true }` remain **ineffective** without branded ALS context **and** argument identity match.

### 1.3 Correct Node AsyncLocalStorage semantics (binding)

Lock the **actual** Node behavior:

- The ordinary caller outside `run()` has **no** recovery store after the awaited runner completes.
- Awaited operations created and completed inside the runner **retain** the recovery store as intended.
- Timers, Promise continuations, microtasks, detached async functions, and other async resources created inside the runner **may retain** that recovery store after the outer callback returns.
- EventEmitter callbacks use the context active when **emitted**, not necessarily when registered.
- A later worker process or separately invoked queue consumer does **not** inherit the in-process ALS store.

Therefore S0 safety relies on a **hard orchestration rule**, not automatic context removal.

#### Orchestration rules (absolute)

- Recovery orchestration must **not** create unawaited privileged work.
- No privileged `setTimeout`, `setImmediate`, `queueMicrotask`, detached Promise, unawaited async IIFE, event-emitter continuation, queue publish, worker spawn, or fire-and-forget callback may be created inside the recovery context.
- Every call that can use recovery privilege must be **awaited** before the recovery runner returns.
- Recovery must not return until all privileged Booking, payment, session, job, EDS, and MRI work is complete **or** durably recorded for resume (phase + lease + hold + history).
- Non-privileged asynchronous scheduling, where unavoidable, must execute through `AsyncLocalStorage.exit()` and must **not** call any recovery-sensitive function.
- Confirmation delivery remains durable only:
  - create or ensure EmailDeliveryState with `send:false`
  - do not invoke SMTP
  - do not launch an in-process confirmation task
  - later confirmation worker execution has no ALS recovery context
- Logging and error serialization must **not** inspect or include the AsyncLocalStorage store.
- The runner returns **only** the recovery result, never context internals.

### 1.4 Runner import ownership (static)

**Lock:**

- **Only** `server/services/checkout/multiUnitPaidOrphanRecoveryService.js` may import `runInMultiUnitPaidOrphanRecoveryContext`.
- Guard, finalization, payment-linking, job, MRI, and side-effect modules may import **only**:
  - `assertMultiUnitPaidOrphanRecoveryContext`
  - `isMultiUnitPaidOrphanRecoveryContext`
  - `getMultiUnitPaidOrphanRecoveryContext` (when needed for identity match helpers)
- Capability-module imports must use a **literal static module path**.
- Dynamic `require(variable)` or computed imports resolving to the capability module are **forbidden**.
- Re-exporting the runner is forbidden.
- Aliasing the runner and re-exporting the alias is forbidden.
- The recovery service must **not** export the runner.
- The CLI must **not** import any capability-module API.
- Routes, webhooks, workers, reconciliation, and unrelated services must **not** import the runner.

#### Implementation enforcement

**A.** Existing ESLint `no-restricted-imports` when current lint infrastructure supports it. Do not invent a new lint system solely for this sidequest.

**B. Mandatory:** deterministic architecture / source-boundary test that detects:

- CommonJS direct `require(...)`
- destructured requires
- multiline requires
- aliases
- direct or indirect re-exports
- ESM imports if present
- dynamic/computed require of the capability-module path
- runner export from the recovery service
- CLI / route / webhook / worker / reconcile importing the runner

Use AST-based inspection when an existing repository parser supports it. Otherwise require:

- literal-import allowlist checking
- rejection of dynamic require/import in files touching the capability module
- explicit source review

Tests must prove real production ownership. They must **not** mock the capability validator to always succeed.

### 1.5 Context and argument identity matching

Every privileged inner function must assert:

**A.** a valid branded recovery context exists
**and**
**B.** its current arguments match the immutable incident scope via `assertMultiUnitPaidOrphanRecoveryContext(expectedScope)` with a **complete** expectedScope appropriate to that operation.

Calling `assertMultiUnitPaidOrphanRecoveryContext()` **without** expected incident identity must **not** authorize a privileged mutation (fail closed → `RECOVERY_SCOPE_MISMATCH`).

Presence-only `isMultiUnitPaidOrphanRecoveryContext()` (no expectedScope) may be used **only** for diagnostics or selecting a non-mutating branch. It must **not** authorize:

- guard bypass
- unit injection
- MRI suppression
- job lease / transition
- confirmation phase transition
- MRI resolution

| Privileged seam | Minimum identity checks |
|-----------------|-------------------------|
| Commercial-stay exclusivity bypass | checkoutId, CheckoutSession ID, PaymentIntent ID, cabinTypeId, dates or evidenceDigest where applicable |
| Exact-unit injection (`assignedUnitId`) | checkoutId, PaymentIntent ID, expectedTargetUnitId, cabinTypeId |
| Payment-link MRI suppression | paymentId, PaymentIntent ID, Booking/checkout linkage, ManualReviewItem ID (active review) |
| Finalize-side-effect MRI suppression | checkoutId, Booking ID after creation, finalizationJobId, ManualReviewItem ID (active review) |
| Recovery lease acquisition / renewal | finalizationJobId, checkoutId, PaymentIntent ID, recoveryExecutionId, evidenceDigest |
| Recovery-specific job transitions | same job + recoveryExecutionId + expected current recoveryStatus phase |
| confirmationQueuedAt patch | finalizationJobId, Booking ID, recoveryExecutionId, expected EDS correlation key |
| Recovery-only MRI resolution | active ManualReviewItem ID (`activeRecoveryReviewItemId`), Booking ID, paymentId, checkoutId, finalizationJobId, recoveryExecutionId |

**Required invariant:** A valid recovery context for incident A cannot bypass a guard, suppress MRI resolution, mutate a job, queue confirmation, or resolve review evidence for incident B.

Assertion failure must:

- fail closed
- use sanitized code `RECOVERY_SCOPE_MISMATCH` (or context-required code)
- perform no privileged mutation
- not expose the ALS store

Do **not** rely on assertion only in the outer recovery service. Assert immediately before applying the privileged behavior. Normal behavior remains unchanged when no active matching context exists.

### 1.5.1 `matchesIncidentScope(store, expectedScope)` (binding)

Required normalization / equality:

- ObjectIds → lowercase 24-character hexadecimal strings before compare
- Stripe IDs and `checkoutId` compared as exact non-empty strings (**no** trimming; **no** case-folding of provider IDs)
- `recoveryExecutionId` compared as exact non-empty string
- `evidenceDigest` compared as exact lowercase hexadecimal SHA-256 string
- no trimming or case-folding of provider IDs
- missing required fields → fail closed (no match)
- `null` / `undefined` do not match
- arrays or objects are invalid for scalar identity fields
- `expectedTargetUnitId` and `cabinTypeId` use canonical ObjectId strings
- Booking ID, when required after creation, is canonicalized before comparison

Scope mismatch raises `RECOVERY_SCOPE_MISMATCH` and performs no mutation.

### 1.6 Exact ownership call boundary

```text
CLI recoverMultiUnitPaidOrphanCheckout.js
  └─ recoverAllowlistedMultiUnitPaidOrphanCheckout({ mode, allowlist, originalEvidence, digest, intentOverlay, execute, ... })
       ├─ read-only preflight (initial or resume) / digest verify / live classify
       └─ runInMultiUnitPaidOrphanRecoveryContext(frozenScopeWithoutBrand, async () => {
            // callback receives NO context argument
            ├─ acquire/reclaim lease + renew TTL
            ├─ acquire/verify MRI resolution hold
            ├─ adopt/create Booking (exact unit after assert+match)
            ├─ link Payment / finalize session (hold-aware MRI paths)
            ├─ recovery job success → linkage_complete (lease retained)
            ├─ ensurePendingConfirmationDelivery only (no processBookingConfirmationDelivery; no job stamps)
            ├─ markCheckoutFinalizationJobConfirmationQueued → awaiting_review_resolution
            ├─ verify gate → recovery-only MRI resolve (activeRecoveryReviewItemId)
            └─ recoveryStatus complete; release lease + hold
          })
```

---

## 2. Recovery-specific job ownership and lifecycle

### 2.1 Why not normal `claimed`

Repository facts:

- `ACTIVE_EXECUTABLE_STATUSES = ['scheduled', 'claimed']` (`CheckoutFinalizationJob.js`).
- `markCheckoutFinalizationJobSucceeded` matches **`status: 'claimed'` only** and clears `lastErrorCode` / `lastErrorSummary`.

Therefore S0 **must not** move the incident job to `claimed` and **must not** call unmodified `markCheckoutFinalizationJobSucceeded()` for this transition.

### 2.2 RecoveryStatus lifecycle (binding)

Exact `recoveryStatus` values:

- `idle`
- `leased`
- `linkage_complete`
- `awaiting_confirmation_queue`
- `awaiting_review_resolution`
- `complete`
- `failed`

Authoritative progression:

```text
idle
→ leased
→ linkage_complete
→ awaiting_confirmation_queue
→ awaiting_review_resolution
→ complete
```

`failed` is used only for a terminal or operator-paused recovery condition with preserved evidence.

**Required invariant:** Normal job status `succeeded` does **not** imply `recoveryStatus: complete`.

A recovery may have:

- job `status: succeeded`
- `recoveryStatus: awaiting_confirmation_queue`
- `confirmationQueuedAt: null`
- MRI open (or held)

and still be safely resumable.

#### Phase behavior

**`leased`**

- exclusive recovery ownership acquired
- MRI resolution hold acquired
- Booking / payment / session linkage work may run
- normal job may still be `failed_permanent`

**`linkage_complete`**

- Booking exists
- Payment linked
- CheckoutSession linked / finalized
- normal finalization job may now be set `succeeded`
- recovery ownership and lease **remain active**

**`awaiting_confirmation_queue`**

- normal job succeeded
- SavedQuote conversion may be completed or recorded as non-blocking
- confirmation EDS not yet verified
- recovery lease **remains active**

**`awaiting_review_resolution`**

- pending or already-succeeded EDS exists
- `confirmationQueuedAt` patch exists
- authoritative links verified
- MRI resolution hold remains active
- recovery lease **remains active**

**`complete`**

- incident MRI (or recovery-completion MRI — §11) resolved by the recovery-only path
- final completion history / audit evidence persisted
- MRI hold released / completed
- recovery lease released
- no further mutation required

### 2.3 Proposed fields (S0 schema additions on `CheckoutFinalizationJob`)

| Field | Type | Purpose |
|-------|------|---------|
| `recoveryStatus` | enum above (default `idle` / null treated as idle) | Recovery lifecycle; independent of worker `status` |
| `recoveryExecutionId` | String \| null | Stable execution id retained across lease reclaim |
| `recoveryEvidenceDigest` | String \| null | Bound dry-run digest for this execution |
| `recoveryAllowlistHash` | String \| null | Hash / identity of allowlist used |
| `recoveryClaimedBy` | String \| null | e.g. `multi-unit-paid-orphan-recovery:<recoveryExecutionId>` |
| `recoveryClaimedAt` | Date \| null | Lease start / last reclaim |
| `recoveryVisibilityTimeoutAt` | Date \| null | Lease expiry (`now + 15 minutes`) |
| `recoveryAttemptCount` | Number ≥ 0 | Execute / resume attempts |
| `recoveryLastErrorCode` | String \| null | Last recovery error |
| `recoveryLastErrorSummary` | String \| null | Truncated ≤500 |
| `recoveryHistory` | Array of Mixed | Bounded execute history (never written on dry-run) |
| `recoveryOperatorActorId` | String \| null | Original `ops:<username>` |
| `recoveryOperatorIntentConfirmedAt` | Date \| null | Original intent timestamp |
| `recoveryReason` | String \| null | Original reason ≤500 |
| `activeRecoveryReviewItemId` | ObjectId / String \| null | **Persistence owner for active held review** (incident MRI or completion MRI after transfer) |
| `recoveredAt` | Date \| null | `complete` timestamp |
| `recoveredBy` | String \| null | Actor / run identity at complete |

**Normal `status` remains `failed_permanent` until the recovery-specific success transition sets it to `succeeded` during/after linkage.** Lease and `recoveryStatus` continue past that point.

### 2.4 Lease duration and renewal (binding)

- Default recovery lease duration: **15 minutes**.
- One shared constant owned by the recovery job service.
- No arbitrary caller-supplied duration.
- Tests may inject a deterministic clock, not an unsafe production duration.

Required behavior:

- Lease acquisition sets `recoveryVisibilityTimeoutAt = now + 15 minutes`.
- Lease owner is `recoveryExecutionId` plus `recoveryClaimedBy`.
- Lease is renewed atomically before each major mutation phase:
  - Booking creation / adoption
  - Payment / session linkage
  - job success transition
  - EDS ensure
  - MRI resolution
- Renewal matches: exact job, exact `recoveryExecutionId`, exact current `recoveryStatus`.
- Expired incomplete leases may be reclaimed **only** by the recovery CLI in **resume** mode.
- **Ownership rule (preferred, locked):** retain the **same** `recoveryExecutionId` for lease reclaim of the same incomplete recovery; only `recoveryClaimedBy` and lease timestamps change.
- Normal worker and generic reconciliation never execute or complete the recovery.
- Generic reconcile may **report** the unfinished recovery but may **not** acquire it.
- Recovery ownership is released only at `complete`, or explicitly moved to `failed`.

If lease expires after job success but before EDS / MRI:

- resume mode reclaims the **same** incomplete `recoveryExecutionId`
- must not create another Booking
- must adopt the succeeded job and continue EDS / MRI work

### 2.5 Bounded recoveryHistory

- Maximum **40** entries.
- On append beyond the cap, drop oldest entries deterministically (`slice(-40)`).
- Each entry may contain only: `at` (ISO), `recoveryExecutionId`, `actor` (`ops:<username>`), `resumedBy` (optional), `phase`, `code`, `summary` (≤500), `digestPrefix` (first 16 hex), `bookingId` (string|null), `mode` (`initial`|`resume`).
- No guest email, phone, secrets, Stripe client secrets, or unbounded payloads.

### 2.6 Indexes

Add:

```js
{ recoveryStatus: 1, recoveryVisibilityTimeoutAt: 1 }
{ recoveryExecutionId: 1 }
```

Purpose: lease acquisition / reclaim / expiry scans and execution lookup. Must **not** make normal worker poll recovery jobs (worker continues to filter `status ∈ scheduled|claimed` only).

### 2.7 Atomic recovery claim / reclaim

**Initial claim** match all of:

- `_id` = allowlisted job ID
- `checkoutId` / `paymentIntentId` = allowlisted
- `status` = `failed_permanent`
- `lastErrorCode` = `DUPLICATE_STAY_CONFLICT`
- `recoveryStatus` ∈ `{ idle, null, none, failed }` with no active incomplete foreign execution, **or** expired incomplete lease reclaim rules below

On initial claim success: set `recoveryStatus=leased`, mint/persist `recoveryExecutionId`, `recoveryEvidenceDigest`, allowlist hash, operator evidence, lease timestamps, increment `recoveryAttemptCount`. Do **not** set normal `claimedBy` / `status=claimed`.

**Resume reclaim** (preferred ownership rule) may match when:

- same allowlisted job / checkout / PI
- same `recoveryExecutionId`
- same `recoveryEvidenceDigest`
- `recoveryStatus` ∈ incomplete set (`leased` | `linkage_complete` | `awaiting_confirmation_queue` | `awaiting_review_resolution`)
- and either active lease owned by this execution (renew), **or** `recoveryVisibilityTimeoutAt < now` (expired reclaim)
- normal job may be `failed_permanent` **or** `succeeded` (incomplete recovery after linkage)

On reclaim: refresh `recoveryClaimedBy` / lease timestamps; **do not** change `recoveryExecutionId`.

### 2.8 Recovery-specific job completion (does not end recovery ownership)

Helper: `markCheckoutFinalizationJobSucceededFromMultiUnitRecovery`

After Booking, Payment, and CheckoutSession authoritative linkage succeed, match leased ownership + `recoveryExecutionId` + phase expectations.

Set:

- `status: succeeded`
- `stage: succeeded`
- `bookingId`
- `paymentLinkedAt`, `sessionFinalizedAt`
- `quoteConvertedAt` when applicable
- **`confirmationQueuedAt` may remain null**
- advance `recoveryStatus` to `linkage_complete` (then orchestration advances to `awaiting_confirmation_queue` as appropriate)
- **retain** lease fields and renew TTL
- Preserve original failure into `safeDetails.priorPermanentFailure`
- Do **not** erase `firstFailedAt`
- Do **not** set `recoveryStatus: complete` here

### 2.9 Confirmation queue patch (privileged phase transition — sole S0 owner)

```js
markCheckoutFinalizationJobConfirmationQueued({
  finalizationJobId,
  bookingId,
  recoveryExecutionId,
  expectedCorrelationKey,
  queuedAt
})
```

**This helper is the sole S0 owner of `CheckoutFinalizationJob.confirmationQueuedAt`.**

Required behavior:

- assert matching incident-scoped ALS context with complete expectedScope
- require `recoveryStatus: awaiting_confirmation_queue`
- verify expected pending **or** truthfully succeeded EmailDeliveryState exists for `expectedCorrelationKey`
- match expected succeeded finalization job and Booking
- set `confirmationQueuedAt` only when currently `null`
- **never** set `confirmationSentAt`
- advance `recoveryStatus` to `awaiting_review_resolution`
- retain lease and MRI hold; renew lease TTL
- idempotent

If `confirmationQueuedAt` already exists because of historical or buggy prior behavior:

- do **not** treat the timestamp alone as proof
- verify the expected EDS
- if EDS evidence is valid, idempotently advance the phase (even when timestamp already set)
- if EDS evidence is absent or contradictory, fail with sanitized hostile / partial-state evidence (`RECOVERY_HOSTILE_STATE_DRIFT` or `RECOVERY_PARTIAL_LINKAGE`)
- never stamp `confirmationSentAt` as part of repair

A normal non-recovery caller must not use this helper to advance the recovery phase.

### 2.10 Reconciliation during incomplete recovery

While `recoveryStatus` is incomplete (`leased` … `awaiting_review_resolution`):

- Generic Batch 7/8 reconciliation **must no-op** for that job’s mutations (may report unfinished recovery).
- Must not open duplicate ManualReviewItems for the same recovery execution (except the locked premature-resolution completion MRI in §11).
- Must not alter job `status` or clear recovery lease / hold fields.
- After lease expiry, ordinary reconcile may still classify / report, but **must not** execute recovery; only the recovery CLI may reclaim.
- Worker remains unable to poll when job is still `failed_permanent`; when job is `succeeded`, worker still must not run recovery completion.

### 2.11 Dry-run vs execute history

- **Dry-run:** zero writes — including no `recoveryHistory` append, no lease claim, no MRI hold.
- **Execute / resume:** append bounded `recoveryHistory` entries for claim, phases, success/failure.

### 2.12 Phase-aware resume next actions

| recoveryStatus | Required next action |
|----------------|----------------------|
| `leased` | adopt/create Booking; complete Payment/session links |
| `linkage_complete` | ensure normal job succeeded; quote conversion where appropriate; advance toward confirmation queue |
| `awaiting_confirmation_queue` | ensure EDS via `ensurePendingConfirmationDelivery` only; then §2.9 confirmationQueuedAt phase patch |
| `awaiting_review_resolution` | verify links and EDS; resolve held MRI; complete recovery |
| `complete` | return idempotent already-complete; no writes except optional read-only verification; no new lease |
| `failed` | require operator decision; no automatic continuation unless failure code is explicitly resumable |

### 2.13 Crash / concurrency

- Lease expiry → resume reclaim of same `recoveryExecutionId`.
- Two concurrent executes: only one claim/renew wins; loser gets `RECOVERY_JOB_LEASE_CONFLICT`.
- No concurrent finisher for EDS/MRI while lease is active.
- After `complete`, further executes return `RECOVERY_ALREADY_COMPLETE`.

---

## 3. Dry-run purity, evidence digest, and execute modes

### 3.1 Dry-run write ban (absolute)

Dry-run must not:

- create or ensure a finalization job
- claim a job / update job history
- change CheckoutSession
- link Payment / create Booking
- resolve, create, or hold ManualReviewItem
- create EmailDeliveryState
- convert SavedQuote
- allocate or hold a Unit
- write AuditEvent
- update any document timestamps via save

Dry-run uses **read-only** loaders and pure validators only.

### 3.2 Two distinct evidence objects

#### A. Original dry-run evidence

```js
{
  schemaVersion: 'multi-unit-paid-orphan-recovery/v1',
  dryRunGeneratedAt, // MUST equal canonicalEvidence.dryRunGeneratedAt
  canonicalEvidence, // sole digest input
  digest             // SHA-256 of canonical serialization of canonicalEvidence ONLY
}
```

**Envelope timestamp equality (binding):**

- Invariant: `dryRunGeneratedAt === canonicalEvidence.dryRunGeneratedAt`
- Execute **must reject** when those values differ.
- Digest hashes **only** `canonicalEvidence`.
- The outer timestamp is display / convenience data and must not create a second independent time value.
- Maximum age (binding default **24 hours**) is calculated from `canonicalEvidence.dryRunGeneratedAt` after envelope equality is verified.
- Execute-only operator evidence (phrase, actor, intent timestamp, reason, mode) remains **outside** the digest.

#### B. Execute overlay evidence (not part of digest)

Execute validates **after** digest verification and **before** lease acquisition:

- fixed confirmation phrase
- `operatorActorId` (`ops:<username>`)
- `operatorIntentConfirmedAt`
- non-empty `recoveryReason`
- `mode: 'initial' | 'resume'`
- `--execute` and `MULTI_UNIT_PAID_ORPHAN_RECOVERY=1`

These fields are **not** in dry-run `canonicalEvidence` unless genuinely known and fixed at dry-run time (they are not for this incident).

### 3.3 Modes: `initial` vs `resume`

#### Initial mode

Allowed only when:

- original `canonicalEvidence` and digest authenticate correctly
- envelope timestamps match
- digest age ≤ 24 hours
- live material evidence still matches the original **pre-mutation** evidence
- no prior recovery progress exists
- no Booking exists for the orphan checkout or PaymentIntent
- job has no unfinished recovery execution
- MRI remains in the expected pre-recovery state
- target AF-03 remains valid and available

After successful initial validation:

- generate a unique `recoveryExecutionId`
- enter incident-scoped ALS context
- atomically acquire the recovery lease
- persist: recoveryExecutionId, evidenceDigest, allowlist hash/identity, operatorActorId, operator intent timestamp, recovery reason, initial phase `leased`
- acquire the MRI resolution hold **before** Booking creation
- begin forward mutation

#### Resume mode

Used only when durable recovery progress already exists for the same allowlisted incident.

Resume must verify:

- original `canonicalEvidence` and digest are authentic
- incident identifiers match exactly
- stored job `recoveryEvidenceDigest` matches the submitted digest
- stored `recoveryExecutionId` exists
- stored allowlist identity matches
- fixed intent phrase was previously accepted or is resubmitted
- operator evidence is compatible with the original execution (same original actor/intent preserved; optional new `resumedBy`)
- recovery is incomplete (`recoveryStatus` ≠ `complete`)
- current state is a valid monotonic continuation of the stored recovery phase

Resume **does not** require the live database to equal the original pre-recovery snapshot.

Expected recovery progress is adoptable evidence, including:

- Booking now exists for the expected checkout / PI
- Payment now links to that Booking
- CheckoutSession now links / finalizes
- normal job status is `succeeded`
- EDS now exists
- `confirmationQueuedAt` now exists
- MRI may be resolved only when the stored phase permits it

Resume must abort on hostile or contradictory drift (`RECOVERY_HOSTILE_STATE_DRIFT`), including:

- Booking belongs to a different PaymentIntent
- Booking uses a different unit
- Payment links to a foreign Booking
- CheckoutSession links to a foreign Booking
- amount / currency / hash / date / cabinType changed
- target unit changed unexpectedly
- another `recoveryExecutionId` owns the incident
- MRI was resolved without the required recovery completion evidence
- recovery evidence digest or allowlist identity changed

**Do not** require a new dry-run for ordinary resume of the same incomplete `recoveryExecutionId`.

**Require a new dry-run when:**

- no compatible recovery progress exists
- the previous execution was explicitly abandoned (`failed` / operator abandon)
- operator changes the target unit, amount, dates, cabin type, or intent
- allowlist identity changes
- hostile drift must be manually remediated
- the recovery digest is older than the locked maximum **and** no active incomplete recovery owns it

### 3.4 Material live fields (initial equality)

For **initial** mode, material changes include:

- target unit `isActive`
- target unit `updatedAt`
- target unit availability result
- first Booking status / unit / dates
- Payment status / `reservationId`
- CheckoutSession status / finalizeStatus / bookingId / paymentStatus
- finalization-job status / lastErrorCode / recovery lease / recoveryStatus fields
- ManualReviewItem status / category / resolutionHold
- PI identity and paid evidence
- amount / currency
- quoteSnapshotHash / finalizeIntentHash
- dates / cabinTypeId
- guestIdentityMatch / stayFingerprintMatch booleans
- appearance of any Booking for the orphan checkoutId or PI (**aborts initial**; may enter resume only if durable recovery progress already exists — otherwise abort)

### 3.5 Canonical serialization

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

### 3.6 `canonicalEvidence` minimum contents

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

**Exclude from dry-run canonicalEvidence:** operatorActorId, operatorIntentConfirmedAt, recoveryReason, confirmation phrase (execute overlay only).

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

Execute / resume requires the **exact** fixed phrase (execute overlay; not part of digest):

```text
I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME
```

Plus execute-overlay fields validated after digest verification and before lease acquisition:

- `operatorActorId` — **operator-supplied CLI evidence string**, format `ops:<username>` (non-empty). Not cryptographically authenticated identity. Persisted in redacted recovery history/audit only. Must not contain guest data or secrets.
- `operatorIntentConfirmedAt` (ISO timestamp)
- non-empty `recoveryReason`
- matching original dry-run digest + received original evidence
- exact incident allowlist identities
- `--execute` and `MULTI_UNIT_PAID_ORPHAN_RECOVERY=1`

At **initial** lease acquisition, persist sanitized operator evidence into bounded recovery history and job fields.

**Resume** may require the same original operator evidence **or** a new `resumedBy` operator entry, but must preserve the original actor / intent evidence.

Distinguish technical eligibility from confirmed commercial intent. If intent is not confirmed → `RECOVERY_INTENT_NOT_CONFIRMED`; **no Booking**.

---

## 6. Exact-unit injection point

### 6.1 Flow (binding)

1. Read and validate immutable `quoteSnapshot` + `finalizeIntent` (hashes must match allowlist / evidence).
2. Recalculate target-unit availability via `AssignmentEngine.validateUnitForCabinTypeBooking(expectedTargetUnitId, cabinTypeId, checkIn, checkOut)`.
3. Inside the ALS recovery context only, after `assertMultiUnitPaidOrphanRecoveryContext({ checkoutId, paymentIntentId, expectedTargetUnitId, cabinTypeId, ... })`, set:

   ```js
   finalizeContext.assignedUnitId = expectedTargetUnitId
   ```

   Do **not** pass a capability Symbol into finalize context. Context presence and incident identity are proven only via ALS assert + argument match.
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

### 8.2 Explicit operator release (S1 only)

`metadata.provisionalCapacityRelease` belongs **exclusively to S1** capacity implementation.

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

**S0 must not** create, modify, consume, or depend on this field. S0 uses exact-unit validation only. S1 owns refund / dispute / admin-release capacity semantics.

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

### 10.1 Exact execute / resume order (narrow operations — no generic side-effect bundle)

S0 uses narrow authoritative operations separately. Do **not** route S0 through a generic finalization side-effect bundle that can perform unrelated actions (Ops push, guest messaging, arrival/access, SMTP, confirmationQueuedAt stamps).

0. Initial or resume preflight (digest authenticity; mode-specific live rules; intent overlay; envelope timestamp equality).
1. Enter incident-scoped recovery context (`runInMultiUnitPaidOrphanRecoveryContext`).
2. Acquire or reclaim the recovery lease (15-minute TTL; same `recoveryExecutionId` on reclaim).
3. Acquire or verify the MRI resolution hold; persist `activeRecoveryReviewItemId` on the job (incident MRI initially).
4. Search / adopt existing Booking by checkoutId, CheckoutSession ID, PaymentIntent, and Payment.reservationId.
5. Create Booking through authoritative finalization only when no valid Booking exists (exact-unit inject after assert + match).
6. Link Payment.reservationId (hold-aware; MRI auto-resolution suppressed / held).
7. Link / finalize CheckoutSession.
8. Verify authoritative linkage.
9. Mark normal finalization job succeeded through recovery-specific transition.
10. Advance `recoveryStatus` to `linkage_complete`, retaining lease.
11. Convert SavedQuote where applicable (non-blocking toward money truth).
12. Advance to `awaiting_confirmation_queue`.
13. **Ensure-only** confirmation EDS via `ensurePendingConfirmationDelivery` (see §12) — not `processBookingConfirmationDelivery`.
14. Apply `markCheckoutFinalizationJobConfirmationQueued` (sole confirmationQueuedAt owner; advances to `awaiting_review_resolution`).
15. Perform final authoritative verification.
16. Resolve active held MRI through recovery-only resolution (`activeRecoveryReviewItemId`).
17. Persist final sanitized recovery history / audit evidence.
18. Advance `recoveryStatus` to `complete`.
19. Release recovery lease and MRI hold.

If `checkoutFinalizeSideEffects` requires a narrow S0 hook solely to suppress automatic MRI resolution / hold awareness, that is allowed. It must **not** become the owner of confirmation queueing, `confirmationSentAt`, Ops push, or other non-EDS effects during S0.

All steps must be idempotent and forward-reconciling.

**Never** delete a successfully created paid Booking.

No step creates:

- a new PaymentIntent
- another charge
- a refund
- a second Booking
- direct SMTP delivery
- Ops push
- guest messaging / arrival / access workflows

### 10.2 Crash behavior

- Second execution uses **resume** mode and reconciles forward from stored `recoveryStatus`.
- Booking without Payment link → resumable from `leased`.
- Payment linked without session finalize → resumable.
- Session finalized without job success → resumable.
- Job success without EDS / confirmationQueuedAt → resumable (`awaiting_confirmation_queue`); MRI stays open / held.
- MRI is **not** the transaction boundary for money/Booking truth.
- No second charge; no second Booking (unique indexes on checkoutId / stripePaymentIntentId).
- Original digest remains bound to the same `recoveryExecutionId` for resume; no new dry-run for ordinary incomplete resume.

---

## 11. MRI resolution hold and concurrent writers (S0)

### 11.1 Problem

ALS suppresses only calls inside the recovery stack. It cannot block unrelated processes.

Repository writers that can set ManualReviewItem `status: 'resolved'` include **at least**:

- `paymentReviewResolutionService` (`updateMany` for `payment_unlinked`)
- `paymentLinkingService` → that service
- `checkoutFinalizeSideEffects.resolveAlertsForBooking` → that service
- Stripe ingestion / link reconciliation → that service or linking
- `reconcilePaymentLinkageAndManualReviews.js` (**direct** `updateOne`)
- `manualReviewService.resolveManualReviewItem` (Ops UI / any category)
- `manualReviewRoutes` `POST /:id/resolve`
- administrative scripts
- any other direct `ManualReviewItem.updateOne` / `findOneAndUpdate` / `updateMany` writing resolved status

There is **not** currently a single Mongo writer. S0 must make **every** writer hold-aware.

`ManualReviewItem` statuses are `open | resolved | ignored`. There is **no** first-class reopen helper in `manualReviewService`.

### 11.2 Durable MRI resolution hold (binding)

S0 adds proposed fields on `ManualReviewItem` (strict schema addition):

```js
resolutionHold: {
  kind: String,                 // 'multi_unit_paid_orphan_recovery'
  recoveryExecutionId: String,
  finalizationJobId: String,
  checkoutId: String,
  paymentIntentId: String,
  heldAt: Date,
  status: String,               // 'active' | 'released'
  transferredToManualReviewItemId: String | null,
  transferredAt: Date | null
}
```

Also add:

```js
recoveryDedupeKey: String | null  // completion MRI only; see §11.4
```

Required hold values:

- `kind: "multi_unit_paid_orphan_recovery"`
- `status: "active" | "released"`

Required hold behavior:

- Hold acquisition occurs atomically after recovery job lease acquisition and **before** Booking creation.
- Hold acquisition matches the exact open incident MRI and incident IDs.
- Persist `CheckoutFinalizationJob.activeRecoveryReviewItemId` = that MRI `_id` (**persistence owner** for the active held review).
- Hold is idempotent for the same `recoveryExecutionId`.
- A different `recoveryExecutionId` cannot replace an active hold (`RECOVERY_MRI_HOLD_CONFLICT`).
- Hold remains active across recovery-lease expiry.
- Hold remains active until `recoveryStatus` becomes `complete` or an explicit audited operator override occurs.
- Lease expiry alone does **not** release the MRI hold.

Indexes (proposed):

```js
{ 'resolutionHold.status': 1, 'resolutionHold.paymentIntentId': 1 }
// plus recoveryDedupeKey partial unique — §11.4
```

### 11.3 Shared hold-evaluation helper (every resolve writer)

Lock one shared hold-evaluation helper (exact module path chosen in S0), for example:

```js
assertManualReviewResolutionAllowed({
  manualReviewItem,
  recoveryExecutionId,       // optional; required for recovery-only path
  recoveryContextRequired    // false for normal callers; true for recovery-only final resolve
})
```

or an equivalent result-based helper.

**Every** code path that changes a ManualReviewItem into a resolved state must call the hold evaluator **immediately before** the conditional status update.

Cover at minimum:

- `paymentReviewResolutionService`
- `manualReviewService.resolveManualReviewItem`
- payment-link auto-resolution
- checkout finalization side-effect resolution
- Stripe ingestion / link reconciliation
- `reconcilePaymentLinkageAndManualReviews.js`
- paid-checkout finalization reconciliation
- Ops Manual Review Resolve route
- administrative scripts
- any direct ManualReviewItem `updateOne` / `findOneAndUpdate` / `updateMany` that writes resolved status

**Normal caller behavior:**

- no active hold → existing behavior
- active multi-unit recovery hold → return explicit held / no-op result; do **not** resolve; do **not** remove or overwrite the hold
- mismatched `recoveryExecutionId` (when a recovery-only caller supplies one) → reject

**Recovery-only final resolver behavior:**

- requires matching incident-scoped ALS context with complete expectedScope
- matching active hold for `activeRecoveryReviewItemId`
- `recoveryStatus` is `awaiting_review_resolution`
- complete verification evidence (§11.5)
- resolves MRI idempotently
- advances recovery to `complete`
- releases / completes hold

The architecture may redirect direct writers through a common resolution service, but it must still **identify and remediate every existing direct writer**.

The Ops instruction “do not click Resolve” remains an operational safeguard, **not** the only technical protection.

### 11.4 Premature / out-of-band MRI resolution + completion MRI uniqueness (locked)

Architecture must **not** treat `MRI.status === resolved` alone as recovery success.

If the active incident MRI is found resolved before the recovery verification gate:

- inspect resolution evidence
- if resolution was performed by the same `recoveryExecutionId` after the correct verification gate, adoption is allowed
- otherwise treat as premature / out-of-band (`RECOVERY_REVIEW_RESOLVED_PREMATURELY`)

**Chosen policy:** create or adopt a **new** recovery-completion ManualReviewItem (do **not** reopen the original).

#### Database-enforced identity

Dedicated sanitized field:

```js
recoveryDedupeKey: 'multi_unit_paid_orphan_completion:<recoveryExecutionId>'
```

Requirements:

- populated **only** for the recovery-completion MRI
- contains no guest data or secret
- deterministic for one recovery execution
- immutable once written
- unique through a partial unique index that applies only when `recoveryDedupeKey` exists

Index:

```js
{ recoveryDedupeKey: 1 }
// unique: true
// partialFilterExpression: { recoveryDedupeKey: { $type: 'string' } }
```

#### Create-or-adopt behavior

- atomically upsert by `recoveryDedupeKey`
- dedicated recovery-completion category
- links: original ManualReviewItem ID, recoveryExecutionId, finalizationJobId, checkoutId, CheckoutSession ID, Payment ID, PaymentIntent ID, Booking ID when present
- `provenance.source` = `multi_unit_paid_orphan_recovery`
- `provenance.sourceReference` = `recoveryExecutionId`
- reason / code = `RECOVERY_REVIEW_RESOLVED_PREMATURELY`
- repeated resume adopts the same completion MRI
- concurrent attempts cannot create two completion MRIs
- duplicate-key race (11000) must reread and adopt the authoritative existing item
- examples and tests use **fake** identifiers only

#### Exact hold-transfer sequence (binding — one design)

1. Create or adopt the unique completion MRI (`recoveryDedupeKey`).
2. Atomically acquire an active recovery resolution hold on the **completion** MRI for the same `recoveryExecutionId`.
3. Verify the completion MRI hold is active and matches the incident scope.
4. Only then mark the **original** MRI hold as released / transferred.
5. Record on the original hold: `transferredToManualReviewItemId`, `transferredAt`, `recoveryExecutionId`.
6. Persist `CheckoutFinalizationJob.activeRecoveryReviewItemId` = completion MRI `_id` (sole persistence owner for subsequent resume / resolve).

**Failure behavior:**

- If step 2 succeeds and releasing the original hold fails, both reviews may remain held temporarily; this is **safe and resumable**.
- Never release the original hold before the completion MRI has an active hold.
- A second resume reconciles the transfer forward.
- The original resolved MRI is never reopened.
- Recovery cannot become complete until the **active** completion MRI (`activeRecoveryReviewItemId`) passes the controlled final-resolution gate.

### 11.5 Final verification before recovery-only resolve

Requires **all** of:

- Booking exists with `unitId` = expected AF-03
- `Payment.reservationId` matches Booking
- `CheckoutSession.bookingId` matches Booking
- session `finalizeStatus=finalized`
- job `status=succeeded` with recovery linkage evidence
- confirmation EmailDeliveryState exists (`pending` or already definitive / truthfully succeeded)
- `confirmationQueuedAt` set via §2.9 evidence
- `recoveryStatus=awaiting_review_resolution`
- active hold for this `recoveryExecutionId` on `activeRecoveryReviewItemId`

---

## 12. Confirmation enqueue behavior (ensure-only EDS + sole confirmationQueuedAt owner)

### 12.1 Repository reality

`processBookingConfirmationDelivery({ send: false, jobId })` can independently stamp:

- `CheckoutFinalizationJob.confirmationQueuedAt`
- `CheckoutFinalizationJob.confirmationSentAt` (adopted-sent path)

`checkoutFinalizeSideEffects` can also stamp `confirmationQueuedAt` and invoke Ops push.

Therefore S0 must **not** use those paths for incomplete recovery.

### 12.2 Ensure-only EDS contract (binding)

While `recoveryStatus` is incomplete, S0 recovery:

- **must** call `ensurePendingConfirmationDelivery` directly from `server/services/email/bookingConfirmationDeliveryService.js` (or a narrowly extracted equivalent that only creates/adopts durable EmailDeliveryState evidence)
- **must not** call `processBookingConfirmationDelivery`
- **must not** pass `jobId` into any delivery function that can stamp `confirmationQueuedAt` or `confirmationSentAt`
- **must not** run generic `checkoutFinalizeSideEffects` merely to create confirmation delivery state
- **must not** trigger SMTP, logged-delivery success, Ops push, guest messaging, arrival/access workflows, or other non-EDS side effects

Ensure-only result must be one of:

- pending EmailDeliveryState exists
- truthfully succeeded EmailDeliveryState already exists

Ensure-only must **not** write:

- `Booking.confirmationEmailSentAt`
- `CheckoutFinalizationJob.confirmationQueuedAt`
- `CheckoutFinalizationJob.confirmationSentAt`

(`ensurePendingConfirmationDelivery` may adopt preexisting definitive EDS / Booking sent evidence into EDS state without SMTP; S0 still must not stamp job queue/sent fields here, and must not newly stamp Booking sent-at.)

### 12.3 Sole confirmationQueuedAt ownership

After ensure-only succeeds, S0 calls **only** §2.9 `markCheckoutFinalizationJobConfirmationQueued(...)`.

- Confirmation worker remains stopped; later worker has no ALS recovery context.
- Durable EDS contains **no** recovery capability or bypass marker.
- Second run (resume) adopts existing pending/succeeded EDS.
- Enqueue / ensure failure does not undo Booking/Payment/session/job success; recovery remains incomplete and held.

---

## 13. Error taxonomy (single authoritative module)

Introduce `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js` and `multiUnitPaidOrphanRecoveryErrors.js` (S0 recovery codes first; S1 expands shared finalize permanence). Used by recovery, job classifier hooks for S0 codes, `safeDetails`, CLI, MRI evidence.

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
| `RECOVERY_PARTIAL_LINKAGE` | yes via re-run | until fixed | may stay incomplete | reclaimable | **yes** keep open/held | CLI | none |
| `RECOVERY_CONFIRMATION_ENQUEUE_FAILED` | yes via re-run | until fixed | job may already succeeded | reclaimable | **keep open/held** | CLI | none |
| `RECOVERY_ALREADY_COMPLETE` | n/a success | n/a | already complete | n/a | already resolved | CLI | none |
| `RECOVERY_RESUME_PHASE_MISMATCH` | no | abort | no phase jump | keep/fail | keep held | CLI | none |
| `RECOVERY_EXECUTION_ID_CONFLICT` | no | abort | no | contested | keep held | CLI | none |
| `RECOVERY_LEASE_EXPIRED` | yes via resume reclaim | no | no auto-complete | reclaimable | keep held | CLI | none |
| `RECOVERY_MRI_HOLD_CONFLICT` | no | abort | no | fail/keep | contested | CLI | none |
| `RECOVERY_REVIEW_RESOLVED_PREMATURELY` | yes via completion MRI | until fixed | continue incomplete | reclaimable | new completion MRI | CLI | none |
| `RECOVERY_HOSTILE_STATE_DRIFT` | no | abort | no | fail/keep | keep held | CLI | investigate |
| `RECOVERY_SCOPE_MISMATCH` | no | abort | no privileged mutate | keep | keep held | CLI | none |
| `MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED` | no | abort | no privileged mutate | keep | keep held | CLI | none |

---

## 14. S0 independence and deployment order

### 14.1 Independence

- S0 does **not** require `MULTI_UNIT_CAPACITY_STAY_GUARD`.
- S0 works while legacy commercial exclusivity remains enabled (ALS-gated exclusivity bypass only for the allowlisted orphan).
- S0 does not require client deploy or confirmation worker running.
- S0 does not require the S1 provisional-capacity algorithm or paid-overlap predicates.
- The current incident does **not** yet contain a retained paid-overlap loser Booking.
- S0 exact AF-03 recovery is independent of S1 paid-overlap predicates.
- S1 remains independently blocked until its own implementation audit.
- `MULTI_UNIT_CAPACITY_STAY_GUARD` remains **false** during S0 incident recovery.
- S0 must deploy before incident execute.

### 14.2 Ordering

- **Incident execute / resume before enabling S1 capacity flag**, unless self-exclusion + provisional rules are already verified in the deployed build.

### 14.3 S3 production order

1. Deploy approved S0 server/tooling.
2. Production dry-run (zero writes) → original evidence + digest.
3. Confirm operator intent (fixed phrase + `ops:<username>` overlay).
4. Initial execute with original evidence/digest; live recheck AF-03; or resume incomplete recoveryExecutionId.
5. Verify Booking / Payment / session / job / unit / EDS / confirmationQueuedAt / recoveryStatus.
6. Resolve held MRI only after verification gate.
7. Leave confirmation EDS pending; confirmation worker remains stopped.
8. Continue S1/S2 separately with capacity flag still false until S1 audit.

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

S0 recovery does **not** depend solely on the capacity flag. Active incident-scoped ALS context + lease + MRI hold remain required for privileged seams. Logs show boolean policy only; no PII.

---

## 17. Exact S0 file boundary

### 17.1 Add

- `server/services/checkout/multiUnitPaidOrphanRecoveryCapability.js`
- `server/services/checkout/multiUnitPaidOrphanRecoveryService.js`
- `server/services/checkout/multiUnitPaidOrphanRecoveryErrors.js`
- `server/scripts/recoverMultiUnitPaidOrphanCheckout.js`
- `server/scripts/multiUnitPaidOrphanRecovery.test.cjs`
- capability source-boundary test (exact path chosen in S0; mandatory)
- `docs/checkout-payment-architecture/04_MULTI_UNIT_PAID_ORPHAN_RECOVERY_CLI.md` (fake IDs only)
- `docs/checkout-payment-architecture/examples/multi-unit-paid-orphan-allowlist.example.json` (fake IDs)
- `server/services/checkout/multiUnitRecoveryAndCapacityErrorTaxonomy.js` (S0 recovery codes first; S1 expands later)
- shared ManualReview hold-evaluation helper (exact path chosen in S0)

If current lint infrastructure supports repository `no-restricted-imports` for the runner, include that existing lint configuration file in S0 scope. If not, do not invent a new lint system; the source-boundary test remains mandatory.

### 17.2 Narrow modify

- `server/models/CheckoutFinalizationJob.js` — recovery lifecycle fields, `activeRecoveryReviewItemId`, lease / execution indexes, bounded history
- `server/models/ManualReviewItem.js` — `resolutionHold`, `recoveryDedupeKey`, hold lookup index, partial unique `recoveryDedupeKey` index
- `server/services/checkout/checkoutFinalizationJobService.js` — claim/reclaim, renew, succeed-from-`failed_permanent`, **sole** confirmationQueuedAt phase patch; reconcile report-only while incomplete
- `server/services/checkout/commercialStayGuardService.js` — exclusivity bypass only after branded context + identity match
- `server/services/checkout/finalizePaidCheckout.js` / `checkoutFinalizeService.js` — private recovery path hooks only under matching ALS context
- exact-unit finalize-context seam (`assignedUnitId` injection)
- `server/services/checkout/executeBookingFinalizeWork.js` — only if needed to honor pre-assigned unit (already supported)
- `server/services/payments/paymentReviewResolutionService.js` / payment-linking — hold-aware resolution
- `server/services/checkout/checkoutFinalizeSideEffects.js` — **MRI hold-awareness / suppression only** during S0; must not own confirmation queueing or Ops push for incomplete recovery
- `server/services/ops/ingestion/manualReviewService.js` — hold-aware `resolveManualReviewItem`
- Ops Manual Review Resolve route and all direct review-resolution callers / scripts (including `reconcilePaymentLinkageAndManualReviews.js`)
- Stripe ingestion / link path — hold awareness for held reviews
- `server/services/checkout/reconcilePaidCheckoutFinalization.js` — hold awareness / no-op mutate while incomplete
- `server/services/email/bookingConfirmationDeliveryService.js` — owns `ensurePendingConfirmationDelivery`; S0 incomplete recovery uses ensure-only path and must not use `processBookingConfirmationDelivery` for queue/sent stamps
- `server/utils/featureFlags.js` — `isMultiUnitPaidOrphanRecoveryEnabled()`

Do not otherwise widen S0.

### 17.3 Explicitly exclude

- S1 global capacity builder
- paid-overlap reader predicates
- frontend quantity support
- Stripe charge / refund creation
- confirmation-worker PM2 / Batches 2–3
- unrelated payment, voucher, messaging, or checkout architecture
- Using Batch 8 `reconcilePaidCheckoutSubject` as the mutator for this incident
- `metadata.provisionalCapacityRelease` (S1 only)
- Routing incomplete S0 recovery through generic `checkoutFinalizeSideEffects` / `processBookingConfirmationDelivery` for EDS creation

---

## 18. Exact S0 acceptance tests

S0 tests (exact-unit / recovery; **not** S1 provisional algorithm / paid-overlap predicates):

#### Dry-run / digest / overlay

1. Dry-run performs **zero** Mongo mutations.
2. Exact allowlist required; wildcards rejected.
3. Fixed operator confirmation phrase required (execute overlay).
4. Actor (`ops:<username>`) / timestamp / reason required as execute overlay (not in digest).
5. Digest generated deterministically from original `canonicalEvidence` only.
6. Outer `dryRunGeneratedAt` must equal `canonicalEvidence.dryRunGeneratedAt`; execute rejects when they differ.
7. Execute rejects when submitted digest ≠ H(received original `canonicalEvidence`).
8. Initial execute rejects when live material fields diverge from original pre-mutation evidence.
9. Digest older than max age rejects when no active incomplete recovery owns it.
10. Wrong identifiers / hashes / amount / dates reject.
11. Guest identity mismatch rejects without exposing email.

#### Context / ALS / scope matching

12. No recovery context before runner.
13. Correct incident scope across awaited operations.
14. No context in ordinary caller after awaited runner completion.
15. Documented behavioral probe: timer / detached Promise created inside ALS **would retain** context (documents Node; not a production path).
16. Recovery orchestration invokes no forbidden detached scheduler / fire-and-forget seam.
17. Incident A context cannot authorize incident B.
18. Parallel normal finalization has no recovery context.
19. Parallel recoveries retain distinct incident scopes.
20. Plain bypass flags ineffective without matching branded context + expectedScope.
21. Canonical ObjectId equality; provider IDs remain case-sensitive; no trimming of provider IDs.
22. Missing expectedScope fails closed (`RECOVERY_SCOPE_MISMATCH`).
23. Presence-only context cannot authorize mutations.
24. Mismatched Booking ID after creation rejects.
25. No ALS store appears in error output.

#### Source boundary

26. Only recovery service imports runner.
27. Dynamic / computed capability-module imports rejected.
28. Runner re-export rejected; Symbol not exported; CLI cannot import capability module.
29. HTTP / webhook / worker / reconcile paths cannot import runner or forge bypass.

#### Initial / resume

30. Initial execute requires unchanged dry-run evidence.
31. Booking appearance before any recovery lease aborts initial execute.
32. Booking appearance after stored recovery progress enters resume adoption.
33. Partial failure after every mutation phase resumes forward.
34. Original digest remains bound to same `recoveryExecutionId`.
35. Hostile drift aborts resume.
36. Complete recovery is idempotent (`RECOVERY_ALREADY_COMPLETE`).

#### Lease / lifecycle

37. Lease TTL exactly 15 minutes; renewal before every major phase.
38. Job succeeded while recovery incomplete remains reclaimable with same `recoveryExecutionId`.
39. No concurrent finisher; ownership retained through EDS and MRI; `complete` releases lease.
40. Recovery lease acquired without job `status=claimed`; worker cannot execute recovery-owned incomplete work.

#### Confirmation ownership

41. Ensure-only EDS creation does **not** set job `confirmationQueuedAt`.
42. Ensure-only EDS creation does **not** set `confirmationSentAt`.
43. Ensure-only EDS creation does **not** newly stamp `Booking.confirmationEmailSentAt`.
44. Recovery does **not** call `processBookingConfirmationDelivery` while incomplete.
45. Recovery does **not** invoke generic Ops push / finalization side-effect bundle for EDS creation.
46. Privileged phase helper alone sets `confirmationQueuedAt`.
47. Pre-existing `confirmationQueuedAt` without valid EDS does **not** advance phase.
48. Pre-existing `confirmationQueuedAt` with valid EDS advances phase idempotently.
49. `confirmationSentAt` remains unchanged by recovery helpers.
50. No SMTP.

#### Completion MRI / hold transfer

51. Concurrent completion-MRI creation returns one item.
52. Partial unique index rejects duplicate `recoveryDedupeKey`.
53. Duplicate-key race adopts existing item.
54. Repeated resume adopts same completion MRI.
55. Completion MRI links original MRI and incident identities (fake IDs only).
56. Completion MRI hold acquired **before** original hold release.
57. Failure after new hold leaves both held and resumable.
58. Original MRI never reopened.
59. Second run completes transfer; final resolution applies only to `activeRecoveryReviewItemId`.

#### Resolution writers

60. Each identified automatic / manual resolver refuses active held MRI.
61. Ops Resolve cannot bypass hold.
62. Reconcile cannot bypass hold.
63. Recovery-only resolver requires exact ALS incident scope + phase.
64. Mismatched `recoveryExecutionId` rejects.
65. Normal behavior unchanged without a hold.
66. MRI cannot resolve before confirmationQueuedAt evidence from §2.9.

#### Exact unit / money / hygiene

67. Exact AF-03 validation; inactive / wrong-type / blocked / overlapping unit rejects.
68. Orphan paid session alone does not make AF-03 unavailable.
69. No new PaymentIntent, charge, refund, second Booking, raw Booking insert, or paid Booking deletion.
70. `recoveryHistory` never exceeds 40 entries.
71. No production identifiers / emails in tests.

**S1-only:** aggregate provisional-slot self-exclusion, grouping precedence, disputed release, multi-reader paidOverlapConflict exclusion, `provisionalCapacityRelease`.

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

### 19.4 S1 independence from S0

- Keep the existing S1 shared-predicate and repository-wide reader requirements.
- Do **not** move their implementation into S0.
- S1 remains independently blocked until its own implementation audit.
- `MULTI_UNIT_CAPACITY_STAY_GUARD` remains false during S0 incident recovery.
- The current incident does not yet contain a retained paid-overlap loser Booking.
- S0 exact AF-03 recovery is independent of S1 paid-overlap predicates.

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
- CheckoutFinalizationJob `{ recoveryExecutionId }` (new)
- ManualReviewItem resolutionHold lookup index (new; exact keys per §11.2)
- ManualReviewItem `{ recoveryDedupeKey: 1 }` unique partial when string (new; §11.4)
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
| ALS semantics | Ordinary caller clears after await; awaited work keeps store; timers/detached created inside may retain store |
| Orchestration | No unawaited privileged work; no generic side-effect bundle for incomplete S0 |
| Context schema | Frozen incident-scoped store with private brand + recoveryExecutionId + digest + IDs |
| Scope match | Exact `matchesIncidentScope`; expectedScope required for privilege; presence-only diagnostic only |
| Runner ownership | Only recovery service imports runner; literal path; no dynamic require; boundary test |
| Modes | `initial` (pre-mutation equality) vs `resume` (adopt progress; hostile drift aborts) |
| recoveryStatus | idle→leased→linkage_complete→awaiting_confirmation_queue→awaiting_review_resolution→complete |
| Job vs recovery | Job `succeeded` ≠ recovery `complete`; lease retained through EDS/MRI |
| Lease | 15 minutes; renew each major phase; reclaim same recoveryExecutionId |
| EDS | `ensurePendingConfirmationDelivery` only while incomplete; never `processBookingConfirmationDelivery` |
| confirmationQueuedAt | Sole owner: §2.9 recovery helper; never confirmationSentAt |
| MRI hold | Durable resolutionHold; every resolve writer hold-aware; survives lease expiry |
| Completion MRI | `recoveryDedupeKey` partial unique; hold on completion before release original; `activeRecoveryReviewItemId` on job |
| Digest | Hash canonicalEvidence only; envelope timestamp equality; operator overlay separate |
| Unit | Exact AF-03 via assignedUnitId after validate + ALS match |
| Paid loser / provisional | S1 only |
| Deploy | S0 deploy → dry-run → intent → initial/resume → verify → MRI → leave EDS pending; S1 flag off |

**End of binding architecture lock (ownership-finalized 2026-08-03).**
