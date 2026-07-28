# Paid Booking Finalization — Final Implementation Specification

**Status:** Binding for implementation  
**Scope:** V2 cabin / cabinType accommodation checkout only (not location buyout, not gift-voucher purchase)  
**Precedence:** Red-team review overrides the initial audit wherever they conflict  
**Code:** Do not implement until Batch N is explicitly started  

---

## Invariant

A successfully captured V2 accommodation PaymentIntent (`status === succeeded`, canonical for the CheckoutSession) must result in:

1. **exactly one** confirmed `Booking` linked to that PaymentIntent / `checkoutId`, **or**
2. a durable `CheckoutFinalizationJob` in `failed_retryable` (with backoff) or `failed_permanent` (with precise error code/stage), plus matching ops review records.

The system must **never** automatically:

- create another PaymentIntent;
- charge the guest again;
- refund the guest;
- invent missing guest details or legal acceptance;
- create duplicate bookings;
- silently suppress a failed confirmation email (claim-before-send is forbidden).

---

## Binding references (current code)

| Concern | Path |
|---|---|
| CheckoutSession | `server/models/CheckoutSession.js` |
| Quote snapshot / hash | `server/services/checkout/checkoutSessionSnapshot.js` |
| Canonical PI | `server/services/checkout/checkoutCanonicalPaymentIntentService.js` |
| Finalize orchestration | `server/services/checkout/checkoutFinalizeService.js` (`runCheckoutFinalizeOrchestration`) |
| Booking work | `server/services/checkout/executeBookingFinalizeWork.js` |
| Booking route | `server/routes/bookingRoutes.js` `POST /` |
| Stripe webhook | `server/services/ops/ingestion/stripeIngestionService.js` |
| Confirmation claim | `server/services/checkout/claimBookingConfirmationSideEffectsOnce.js` |
| Lifecycle email | `server/services/bookingLifecycleEmailService.js` |
| Email delivery state | `server/models/EmailDeliveryState.js`, `server/services/email/emailDeliveryStateService.js` |
| Job pattern to copy | `server/models/OpsPushScheduledJob.js`, `server/services/ops/push/opsPushScheduledJobService.js`, `opsPushSchedulerWorker.js` |
| Sofia dates | `server/utils/dateTime.js` |
| Target architecture (aspirational) | `docs/checkout-payment-architecture/01_CHECKOUT_SESSION_TARGET_ARCHITECTURE.md` |

**Runtime:** MongoDB 7.0.37, Mongoose 8.18.0 — `partialFilterExpression` with `$in` is supported.

---

## A. Final state machines

### A.1 `CheckoutSession.status`

Existing enum retained. Paid-finalization-relevant transitions:

| From | To | When | Allowed? |
|---|---|---|---|
| `payment_required` / `quoted` | `pi_active` | Canonical PI claimed | Yes (existing) |
| `pi_active` | `pi_active` | PI reuse / refresh | Yes |
| `pi_active` | `paid` | Webhook verified canonical PI succeeded **or** domain finalize confirms paid (idempotent) | **Yes — new** |
| `paid` | `paid` | Idempotent re-mark | Yes |
| `*` | `needs_review` | Permanent finalize failure | Yes |
| `paid` / `pi_active` | (finalize) | Finalize does **not** require leaving `paid`; `finalizeStatus` is authoritative for completion | Yes |
| `expired` / `superseded` | `paid` | Only if canonical PI already succeeded (paid override path may keep status `paid` or leave prior; prefer `$set: status: 'paid'` when marking payment) | Yes for paid mark |
| Any | new PI create after `paid` | | **Forbidden** |
| `finalized` session (`finalizeStatus`) | mutate quote / new PI | | **Forbidden** |

Note: `finalizeStatus === 'finalized'` is the completion signal; `status: 'paid'` means money confirmed, booking may still be pending finalize.

### A.2 `CheckoutSession.paymentStatus`

| From | To | When | Allowed? |
|---|---|---|---|
| `unpaid` | `processing` | Optional: client confirms PaymentElement started (not required for v1) | Optional |
| `unpaid` / `processing` | `paid` | Verified canonical PI `succeeded` | **Yes — new writer** |
| `paid` | `paid` | Idempotent | Yes |
| `not_required` | (card path) | | Unchanged voucher/zero-due |
| `paid` | `unpaid` | | **Forbidden** |
| Webhook gift_voucher PI | accommodation session paid | | **Forbidden** (wrong PI type) |

### A.3 `CheckoutSession.finalizeStatus`

| From | To | When | Allowed? |
|---|---|---|---|
| `open` | `in_progress` | `acquireFinalizeLock` | Yes |
| `in_progress` | `open` | Release on retryable failure **or** stale reclaim | Yes |
| `in_progress` | `finalized` | `markFinalizeSucceeded` + `bookingId` | Yes |
| `in_progress` / `open` | `needs_review` | Permanent failure only | Yes |
| `finalized` | anything else | | **Forbidden** |
| `needs_review` | `open` | Manual ops unlock only (explicit recovery tool) | Ops-only |
| `in_progress` stuck forever | | | **Forbidden** — reclaim required (see E) |

**Stale lock rule:** If `finalizeStatus === 'in_progress'` AND `finalizeStartedAt < now - FINALIZE_LOCK_VISIBILITY_MS` (default 5 min), reclaim to `open` (or directly re-acquire) before retry. Never leave permanently unrecoverable.

### A.4 `CheckoutFinalizationJob.status`

| From | To | When |
|---|---|---|
| (create) | `scheduled` | Enqueue |
| `scheduled` | `claimed` | Worker claim |
| `claimed` | `succeeded` | Domain finalize + required side-effect enqueue OK |
| `claimed` | `failed_retryable` | Retryable error; set `nextAttemptAt` |
| `failed_retryable` | `scheduled` | Sweeper / self-transition when due (or claim directly from `failed_retryable` with due time) |
| `claimed` | `failed_permanent` | Permanent taxonomy |
| `claimed` | `scheduled` | Visibility timeout reclaim |
| `succeeded` / `failed_permanent` / `cancelled` | active again | **Forbidden** (new row only via ops if needed) |

**Executable statuses:** `scheduled`, `claimed` (and optionally due `failed_retryable` treated as claimable).  
**At most one executable job per `checkoutId`** (unique partial index).

### A.5 Email delivery status (booking confirmation)

Use / extend `EmailDeliveryState.latestStatus` plus an explicit attempt lease:

| State | Meaning |
|---|---|
| `pending` | Booking finalized; confirmation not yet successfully sent |
| `sending` | Worker/route holds send lease (`claimedAt` + visibility) |
| `succeeded` | Provider accepted (SMTP success / messageId) |
| `failed` | Exhausted retries or permanent send failure — **visible to ops**, not silent |
| `skipped` | Explicit policy skip (rare) |

**Semantics:** **at-least-once delivery attempts** with durable state. **Not** exactly-once.  
**Forbidden:** set `Booking.confirmationEmailSentAt` before provider success.  
**Forbidden:** roll back Booking because email failed.

---

## B. FinalizeIntent schema

### B.1 Storage

Persist on `CheckoutSession`:

- `finalizeIntent: Mixed` (structured subdocument recommended)
- `finalizeIntentHash: String | null`
- `finalizeIntentCapturedAt: Date | null` (denormalized mirror of `finalizeIntent.capturedAt`)
- `finalizeIntentImmutableAt: Date | null` (set when payment succeeds / intent frozen)

### B.2 Fields

| Field | Type | Required | Limits / rules |
|---|---|---|---|
| `schemaVersion` | Number | yes | integer ≥ 1; current = **1** |
| `capturedAt` | Date | yes | server clock at accept |
| `guestInfo.firstName` | String | yes | trim, 1–50 |
| `guestInfo.lastName` | String | yes | trim, 1–50 |
| `guestInfo.email` | String | yes | normalized email, lowercase |
| `guestInfo.phone` | String | yes | trim, 1–40 |
| `specialRequests` | String \| null | no | max 500 |
| `legalAcceptance.acceptedTermsAndCancellation` | Boolean | yes | must be `true` |
| `legalAcceptance.acceptedActivityRisk` | Boolean | yes | must be `true` |
| `legalAcceptance.termsVersion` | String | yes | must equal server `LEGAL_ACCEPTANCE_TERMS_VERSION` at capture |
| `legalAcceptance.activityRiskVersion` | String | yes | must equal server activity risk version at capture |
| `legalAcceptance.checkbox1TextSnapshot` | String | yes | must equal server checkbox 1 text at capture |
| `legalAcceptance.checkbox2TextSnapshot` | String | yes | must equal server checkbox 2 text at capture |
| `legalAcceptance.locale` | String \| null | no | max 50 |
| `requestMeta.ip` | String \| null | no | max 100 |
| `requestMeta.userAgent` | String \| null | no | max 500 |
| `requestMeta.acceptLanguage` | String \| null | no | max 200 |
| `tripType` | String \| null | no | max 50 |
| `customTripType` | String \| null | no | max 100 |
| `transportMethod` | String \| null | no | max 50; empty/`Not selected` → null |
| `romanticSetup` | Boolean | yes | default false |
| `consents.quoteDeliveryRequested` | Boolean | yes | default false |
| `consents.bookingReminderConsent` | Boolean | yes | default false |
| `consents.marketingConsent` | Boolean | yes | default false |
| `attribution` | Object \| null | no | sanitized; keys max lengths per existing `sanitizeAttribution` |
| `metaClientContext` | Object \| null | no | sanitized; optional on webhook path |
| `experienceKeys` | String[] | yes | sorted unique; must match `quoteSnapshot.experienceKeys` |

**Worker rule:** If any required field missing → permanent `FINALIZE_INTENT_MISSING` / `FINALIZE_INTENT_INVALID`. Never invent.

### B.3 Canonical serialization + `finalizeIntentHash`

1. Build **hash payload** (only stable fields; exclude volatile non-binding fields if any — v1 includes all fields above except optionally `metaClientContext` **excluded from hash** so Meta cookies can refresh without breaking PI; document exclusion).

**v1 hash includes:** schemaVersion, guestInfo, specialRequests, legalAcceptance (all), requestMeta, tripType, customTripType, transportMethod, romanticSetup, consents, attribution (stable-sorted), experienceKeys.  
**v1 hash excludes:** `metaClientContext`, `capturedAt` (timestamp noise) — store `capturedAt` but hash without it **or** include ISO `capturedAt` and forbid updates that change it (prefer: include `capturedAt` ISO and treat any update as new capture → new hash).

**Chosen rule (binding):** Hash **includes** `capturedAt` as ISO string. Any update sets new `capturedAt` and new hash.

2. Stable-sort object keys recursively (reuse `stableSortKeys` / `stableStringify` from `checkoutSessionSnapshot.js`).
3. `finalizeIntentHash = sha256_hex(stableStringify(payload))`.

### B.4 Lifecycle

| Phase | Rule |
|---|---|
| **Create** | After session quoted / before PaymentElement confirm; API e.g. `PUT /api/checkout-sessions/:checkoutId/finalize-intent` or fold into existing session ensure endpoint |
| **Update** | Allowed while `paymentStatus !== 'paid'` AND canonical PI status ∉ `{processing, succeeded}` AND `finalizeIntentImmutableAt == null` |
| **On update** | Recompute hash; if canonical PI exists and is cancellable/`requires_*`, `stripe.paymentIntents.update` metadata `{ finalizeIntentHash }` (and keep `quoteSnapshotHash`, `checkoutId`) |
| **Immutable** | When webhook/domain marks `paymentStatus = paid` **or** PI retrieved as `succeeded` for canonical id — set `finalizeIntentImmutableAt` |
| **After immutable** | Reject all intent mutations |

### B.5 PaymentIntent metadata binding

Extend `buildPaymentIntentMetadata` in `checkoutCanonicalPaymentIntentService.js`:

- existing fields unchanged;
- add `finalizeIntentHash: session.finalizeIntentHash || ''`.

**Gate:** If flag `FINALIZE_INTENT_REQUIRED_FOR_PI=1`, refuse `ensureCanonicalPaymentIntent` when hash/intent incomplete.

### B.6 Webhook / worker verification

1. Load session by `pi.metadata.checkoutId`.
2. Assert `pi.id === session.canonicalPaymentIntentId`.
3. Assert `pi.id` not in `supersededPaymentIntentIds`.
4. Assert `pi.metadata.quoteSnapshotHash === session.quoteSnapshotHash`.
5. Assert `pi.metadata.finalizeIntentHash === session.finalizeIntentHash`.
6. Re-hash stored intent; assert equals `session.finalizeIntentHash`.
7. Assert amount/currency vs `session.stripeAmountCents` / snapshot currency.
8. Assert cabin/cabinType + checkIn/checkOut vs snapshot (ISO or date-only policy: compare Sofia date-only + entity ids).

**On any mismatch:** do **not** finalize; enqueue/mark job `failed_permanent`; open ManualReview + PaymentResolutionIssue; **no invent**.

---

## C. CheckoutFinalizationJob schema and indexes

### C.1 Mongoose schema (exact)

```text
CheckoutFinalizationJob {
  checkoutId: String, required, trim, maxlength 128
  paymentIntentId: String, required, trim
  stripeEventId: String | null
  quoteSnapshotHash: String | null
  finalizeIntentHash: String | null
  status: enum [
    scheduled, claimed, succeeded,
    failed_retryable, failed_permanent, cancelled
  ], required, default scheduled
  stage: enum [
    queued,
    verify_payment,
    acquire_lock,
    assign_unit,
    save_booking,
    link_payment,
    patch_stripe_metadata,
    finalize_session,
    convert_quote,
    resolve_alerts,
    enqueue_side_effects,
    succeeded
  ], default queued
  attemptCount: Number, default 0, min 0
  maxAttempts: Number, default 20, min 1
  claimedBy: String | null
  claimedAt: Date | null
  visibilityTimeoutAt: Date | null
  nextAttemptAt: Date, required, default Date.now
  lastErrorCode: String | null
  lastErrorSummary: String | null, maxlength 500
  safeDetails: Mixed | null          // no secrets / raw card data
  bookingId: ObjectId | null, ref Booking
  paymentLinkedAt: Date | null
  sessionFinalizedAt: Date | null
  quoteConvertedAt: Date | null
  confirmationQueuedAt: Date | null
  confirmationSentAt: Date | null
  firstFailedAt: Date | null
  lastFailedAt: Date | null
  createdReason: enum [webhook, reconcile, manual], required
}, { timestamps: true }
```

### C.2 Indexes (MongoDB 7.0.37 / Mongoose 8.18.0)

1. **Unique executable job per checkout** (supported partial + `$in`):

```js
{ checkoutId: 1 } unique
partialFilterExpression: {
  status: { $in: ['scheduled', 'claimed'] }
}
```

2. Worker poll:

```js
{ status: 1, nextAttemptAt: 1 }
```

3. Stale claim sweep:

```js
{ status: 1, visibilityTimeoutAt: 1 }
```

4. Ops / reconcile by PI:

```js
{ paymentIntentId: 1, createdAt: -1 }
```

5. Optional: `{ createdReason: 1, status: 1, createdAt: -1 }`

### C.3 Enqueue (idempotent)

```js
// Pseudo
try {
  await CheckoutFinalizationJob.create({
    checkoutId, paymentIntentId, stripeEventId,
    quoteSnapshotHash, finalizeIntentHash,
    status: 'scheduled', stage: 'queued',
    nextAttemptAt: new Date(),
    createdReason
  });
} catch (e) {
  if (e.code === 11000) {
    // active job exists — OK
    return { created: false, duplicate: true };
  }
  throw e;
}
```

Reconcile must use the same create-or-exist pattern — **never** two active jobs.

### C.4 Claim query

```js
CheckoutFinalizationJob.findOneAndUpdate(
  {
    _id: jobId,
    status: { $in: ['scheduled', 'failed_retryable'] },
    nextAttemptAt: { $lte: now }
  },
  {
    $set: {
      status: 'claimed',
      claimedBy: workerId,
      claimedAt: now,
      visibilityTimeoutAt: new Date(now.getTime() + visibilityTimeoutMs)
    },
    $inc: { attemptCount: 1 }
  },
  { new: true }
)
```

Batch poll alternative: find due ids, then claim each by `_id` as above.

### C.5 Reclaim stale claimed

```js
CheckoutFinalizationJob.findOneAndUpdate(
  {
    status: 'claimed',
    visibilityTimeoutAt: { $lte: now }
  },
  {
    $set: {
      status: 'scheduled', // or failed_retryable
      nextAttemptAt: now,
      claimedBy: null,
      claimedAt: null,
      visibilityTimeoutAt: null,
      lastErrorCode: 'JOB_VISIBILITY_TIMEOUT',
      lastErrorSummary: 'Claim visibility timeout; reclaimed'
    }
  },
  { new: true }
)
```

Mirror `opsPushScheduledJobService.rescheduleStaleClaimedJob` backoff when attemptCount high.

### C.6 Backoff

- Base 30s, exponential ×2, cap 15m, jitter ±20%.  
- `maxAttempts` default 20 then `failed_permanent` with `FINALIZE_RETRY_EXHAUSTED` if still retryable class (ops escalate).

---

## D. Authoritative domain service

### D.1 API

**New module:** `server/services/checkout/finalizePaidCheckout.js`

```js
finalizePaidCheckout({
  checkoutId,
  paymentIntentId,
  source, // 'frontend' | 'webhook_worker' | 'reconcile' | 'manual'
  now = new Date(),
  dependencies // stripe, etc.
}) → {
  ok, bookingId, booking, checkoutId,
  idempotentReplay, adoptedExisting,
  session, jobHints
}
```

**Callers:**

| Caller | Adapter |
|---|---|
| Frontend | `bookingRoutes.js` validates body → ensures intent already stored → calls domain → maps HTTP |
| Worker | Loads job → calls domain → updates job stage/status |
| Reconcile | Ensure job / optional sync call under flag |
| Manual | Ops tool / script with `source: 'manual'` |

### D.2 Responsibilities (ordered)

1. **Load** V2 CheckoutSession by `checkoutId`.
2. **Replay** if `finalizeStatus === 'finalized'` && `bookingId` → return idempotent success (load Booking).
3. **Adopt** if Booking exists by `checkoutId` or by `stripePaymentIntentId === paymentIntentId`:
   - verify fingerprint / PI / checkout match;
   - if session not finalized → acquire/reclaim lock → `markFinalizeSucceeded`;
   - continue side-effect enqueue as needed;
   - return `adoptedExisting: true`.
4. **Retrieve** Stripe PI; require `status === 'succeeded'`.
5. **Verify canonical:** `assertCanonicalPaymentIntentForSession` + not superseded.
6. **Verify** `quoteSnapshotHash`, `finalizeIntentHash` (metadata + re-hash).
7. **Verify** amount (`stripeAmountCents`), currency, entity ids, Sofia date-only check-in/out vs snapshot.
8. **Paid-expiry override:** if `paymentStatus === 'paid'` OR PI succeeded canonical, **do not** throw `CHECKOUT_SESSION_EXPIRED` for finalize.
9. **Acquire or reclaim** finalize lock (`open`→`in_progress`; reclaim stale `in_progress`).
10. **Build finalizeContext** solely from `quoteSnapshot` + `finalizeIntent` + verified PI (never invent; never trust live body prices for worker). Frontend may pass body only to **confirm** it matches stored intent (mismatch → 409 permanent).
11. **Assign/validate unit** via existing `AssignmentEngine` path inside `executeBookingFinalizeWork` (or extracted).
12. **Save exactly one Booking** (unique `checkoutId` / `stripePaymentIntentId`).
13. **Link Payment** via `linkStripePaymentToBooking`.
14. **Patch** Stripe metadata `bookingId` / `reservationId` (non-fatal retryable if fails after booking exists).
15. **Mark** session finalized (`markFinalizeSucceeded`); set `paymentStatus: 'paid'` if not already.
16. **Convert** SavedBookingQuote (Batch 6+).
17. **Resolve** `payment_unlinked` / related alerts (Batch 6+).
18. **Enqueue** confirmation email delivery state `pending` (Batch 6+); do not SMTP inline in domain core ideally.
19. Return idempotent result.

`runCheckoutFinalizeOrchestration` + `executeBookingFinalizeWork` remain the inner engines **after** adopt/verify/lock policy upgrades (Batch 4). Domain service orchestrates policy; avoid duplicating booking save logic.

### D.3 HTTP separation

- Keep `checkoutFinalizeHttpAdapter.js` for status/code mapping.
- Route must **not** own unit assign / email / meta / ops push after Batch 4/6.
- Extract side effects to `server/services/checkout/checkoutFinalizeSideEffects.js` (or split modules).

### D.4 Provenance

Change hardcoded `createdByRoute: 'POST /api/bookings'` in `executeBookingFinalizeWork` to depend on `source`.

---

## E. Crash-recovery rules

Assume job + session + booking uniques. Worker always: load job → domain → update job.

| Crash point | Persisted | Next worker action | Dup booking? | Dup email? |
|---|---|---|---|---|
| After evidence, before session paid | Evidence (+ Payment maybe) | Re-mark paid + ensure job | No | No |
| After session paid, before job | Session paid | Reconcile enqueue job | No | No |
| After job create, before claim | Job scheduled | Claim + run | No | No |
| After claim, before lock | Job claimed | Continue / visibility reclaim | No | No |
| After lock, before Booking save | Session `in_progress` | Reclaim if stale; retry save | No | No |
| **After Booking save, before session finalized** | Booking exists; session `in_progress` | **Adopt by checkoutId/PI → finalize session** (mandatory; unique indexes alone insufficient) | No | No |
| After Payment link | Linked | Continue metadata/session | No | No |
| After Stripe metadata patch | Meta may be set | Continue finalize session | No | No |
| After session finalized, before quote convert | Finalized | Convert quote idempotently | No | No |
| After finalize, before email pending | Finalized | Enqueue email pending | No | No |
| After email `sending` lease, before SMTP | Delivery `sending` | Reclaim lease after VT; retry send | No | Possible rare dup if provider accepted — prefer ops visibility |
| SMTP accepts, crash before EmailEvent / succeeded | Guest may have mail | On retry: if ambiguous, check provider/messageId if any; else bounded retry; accept rare dup over silence | No | Possible |
| Stale finalize lock | `in_progress` old | Reclaim → open → retry/adopt | No | No |
| Job visibility timeout | claimed stale | Reschedule scheduled | No | No |
| Frontend + worker simultaneous | Lock serializes | Loser: `FINALIZE_IN_PROGRESS` → **retryable** (worker) or 409 then client retry/replay | No | Claim/delivery state serializes email |

**Mandatory:** Domain step 3 (adopt) runs **before** requiring `finalizeStatus === open` exclusively — or reclaim then adopt.

---

## F. Paid overlap policy

### Current hazard

`executeBookingFinalizeWork.runPostSaveOverlapChecks` may `Booking.deleteOne` then throw `PAID_BOOKING_SAVE_FAILED` → session `needs_review`, Payment unlinked — paid orphan with destroyed booking.

### Binding policy (paid / stripe-verified path)

1. **Before save:** assignment + availability checks (existing). Prefer fail **before** insert when possible.
2. **After save, overlap detected on paid path:**
   - **Do not delete** the Booking if `stripePaymentIntentId` is set OR `paymentStatus` on session is `paid` OR finalize source is paid worker/frontend with verified PI.
   - Instead:
     - keep Booking in a non-guest-visible holding status **or** keep `confirmed` but open **critical** review immediately;
     - **preferred:** set Booking `status` to a dedicated ops state if product allows; if enum cannot change in-batch, keep `confirmed`, attach `metadata.paidOverlapConflict = true`, open ManualReview `paid_booking_overlap_conflict`, job → `failed_permanent`, session → `needs_review`, **job row retained** with `bookingId` set.
3. **Unpaid / non-stripe paths** may retain delete-on-overlap behavior.
4. **Never** leave: paid + deleted booking + no job + only generic `payment_unlinked`.
5. Ops decides relocation/refund; **no auto-refund**.

---

## G. Email delivery redesign

### G.1 Semantics (honest)

- **At-least-once attempts**
- Durable `EmailDeliveryState` (extend if needed with lease fields, or parallel `BookingConfirmationDelivery` doc keyed by correlation key)
- Correlation key: existing `bookingLifecycleCorrelationKey({ bookingId, templateKey, recipientEmail })`
- Visibility timeout on `sending`
- Bounded retries (e.g. 10) then `failed` + ops alert
- Manual resend remains (`lifecycleSource: 'manual_resend'`)
- **No booking rollback**

### G.2 Replace `claimBookingConfirmationSideEffectsOnce` usage for automatic confirmation

| Old | New |
|---|---|
| CAS set `confirmationEmailSentAt` **before** SMTP | Set `confirmationEmailSentAt` **only on provider success** (or treat it as “succeeded at”) |
| In-memory SMTP dedupe | Durable delivery state only |
| Fire-and-forget after HTTP | Enqueue `pending`; Batch 6 worker/flag sends |

**Proposed flow:**

1. Domain finalize success → upsert EmailDeliveryState `pending` for `booking_confirmed` (or `booking_received` only if unpaid policy — paid uses `booking_confirmed`).
2. Sender claims: `pending|failed` → `sending` with VT.
3. SMTP send.
4. On success → `succeeded`; set `Booking.confirmationEmailSentAt` + session mirror; set job `confirmationSentAt`.
5. On failure → `failed` (retryable) + backoff; **clear sending lease**.
6. On VT expire in `sending` → revert to `pending`/`failed` for retry (**ambiguous**: may duplicate; acceptable vs silence; log `AMBIGUOUS_SMTP_RETRY`).

Internal ops notification / legal acceptance mail: separate correlation keys; same at-least-once rules; failures must not block booking.

### G.3 Flag

`FINALIZE_WORKER_SEND_CONFIRMATION=0` initially (Batch 5): booking finalizes; email still from frontend path or pending queue unsent until Batch 6.

---

## H. Error taxonomy

### H.1 Retryable

| Code | Session finalizeStatus | Job | Backoff | PRI type | ManualReview | Guest | Refund? |
|---|---|---|---|---|---|---|---|
| `MONGO_TRANSIENT` | leave/reopen lock | `failed_retryable` | yes | optional log | no until exhaust | completing | no |
| `STRIPE_RETRIEVE_TIMEOUT` | reopen | `failed_retryable` | yes | — | — | completing | no |
| `FINALIZE_IN_PROGRESS` / `FINALIZE_LOCK_HELD` | — | `failed_retryable` | short | — | — | completing | no |
| `JOB_CLAIM_CONFLICT` | — | retry | short | — | — | — | no |
| `JOB_VISIBILITY_TIMEOUT` | — | reschedule | — | — | — | — | no |
| `SMTP_FAILURE` | finalized OK | job may succeeded; email state failed | email backoff | — | after exhaust | booking OK | no |
| `STRIPE_METADATA_PATCH_FAILED` | can finalize | retry patch | yes | — | after exhaust | OK | no |
| `FINALIZE_RETRY_EXHAUSTED` | `needs_review` | `failed_permanent` | — | `paid_booking_unknown_failure` | `paid_not_finalized` | needs review | ops |

### H.2 Permanent

| Code | Session | Job | PRI `issueType` | ManualReview category | Guest | Ops |
|---|---|---|---|---|---|---|
| `CHECKOUT_SESSION_NOT_FOUND` | — | `failed_permanent` | `paid_booking_unknown_failure` | `paid_not_finalized` | needs review | refund decision |
| `FINALIZE_INTENT_MISSING` / `INVALID` | `needs_review` | permanent | `paid_booking_save_failed` | `paid_not_finalized` | needs review | collect data / refund |
| `FINALIZE_INTENT_HASH_MISMATCH` | `needs_review` | permanent | `paid_booking_conflict` | `paid_not_finalized` | needs review | investigate |
| `QUOTE_SNAPSHOT_HASH_MISMATCH` | `needs_review` | permanent | `paid_booking_conflict` | `paid_not_finalized` | needs review | investigate |
| `AMOUNT_MISMATCH` / `CURRENCY_MISMATCH` | `needs_review` | permanent | `paid_booking_conflict` | `paid_not_finalized` | needs review | refund decision |
| `DATE_MISMATCH` / `ENTITY_MISMATCH` | `needs_review` | permanent | `paid_booking_conflict` | `paid_not_finalized` | needs review | investigate |
| `SUPERSEDED_PAYMENT_INTENT` | no auto booking | permanent | `paid_booking_conflict` | `superseded_pi_captured` | needs review | **refund decision** |
| `NO_UNITS_AVAILABLE` / `UNIT_*` | `needs_review` | permanent | `paid_booking_conflict` | `paid_not_finalized` | needs review | relocate / refund |
| `DUPLICATE_STAY_CONFLICT` | `needs_review` or attach | permanent | `paid_booking_conflict` | `duplicate_stay_conflict` | safe message | merge |
| `PAID_BOOKING_OVERLAP_CONFLICT` | `needs_review` | permanent + booking kept | `paid_booking_conflict` | `paid_booking_overlap_conflict` | needs review | relocate / refund |
| `LEGAL_ACCEPTANCE_INVALID` | block before pay; if paid | permanent | `paid_booking_save_failed` | `paid_not_finalized` | needs review | ops |
| `GUEST_DATA_INVALID` | same | permanent | `paid_booking_save_failed` | `paid_not_finalized` | needs review | ops |

Extend `PaymentResolutionIssue` enums as needed in Batch 1 (`issueType` may stay coarse; put exact code in `errorCode` + `metadata.stage`).

Guest-facing copy: existing `PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW` pattern.

---

## I. Exact files to change

### I.1 Modify

| File | Change |
|---|---|
| `server/models/CheckoutSession.js` | finalizeIntent fields; optional status `paid` usage |
| `server/models/Booking.js` | Sofia calendar-day checkIn validator; stop wall-clock `> new Date()` |
| `server/models/PaymentResolutionIssue.js` | enrich metadata/stage; optional enum extensions |
| `server/models/EmailDeliveryState.js` | optional lease fields (`sending`, `claimedAt`, `visibilityTimeoutAt`, `attemptCount`) |
| `server/services/checkout/checkoutSessionSnapshot.js` | export stable stringify helpers if needed for intent hash |
| `server/services/checkout/checkoutSessionService.js` | intent persistence hooks; paid mark helper |
| `server/services/checkout/checkoutCanonicalPaymentIntentService.js` | metadata hash; intent-required gate |
| `server/services/checkout/checkoutFinalizeService.js` | paid expiry override; stale lock reclaim; adopt-friendly lock |
| `server/services/checkout/executeBookingFinalizeWork.js` | context from intent; provenance; **paid overlap no-delete**; stripe verified required for PI id |
| `server/services/ops/ingestion/stripeIngestionService.js` | mark session paid; enqueue job; exclude gift voucher; verify hashes |
| `server/routes/bookingRoutes.js` | thin adapter → `finalizePaidCheckout`; remove inline side effects over batches |
| `server/routes/stripeWebhookRoutes.js` | unchanged thin; behavior in ingestion |
| `server/services/checkout/claimBookingConfirmationSideEffectsOnce.js` | deprecate for auto path or redefine post-success only |
| `server/services/bookingLifecycleEmailService.js` | integrate delivery SM |
| `server/services/email/emailDeliveryStateService.js` | claim/sending/retry |
| `server/server.js` | start finalization worker if enabled |
| `server/utils/featureFlags.js` | optional helpers for new flags |
| `client/src/pages/ConfirmBooking.jsx` | persist finalizeIntent before `confirmPayment` |
| `client/src/hooks/useLocationRetreatBooking.js` | out of scope unless shares V2 cabin path — **do not** treat location as in-scope |
| `docs/checkout-payment-architecture/01_CHECKOUT_SESSION_TARGET_ARCHITECTURE.md` | cross-link this spec |

### I.2 Add

| File | Purpose |
|---|---|
| `server/models/CheckoutFinalizationJob.js` | Job schema |
| `server/services/checkout/finalizeIntentService.js` | validate, hash, persist, immutability |
| `server/services/checkout/finalizePaidCheckout.js` | domain service |
| `server/services/checkout/checkoutFinalizationJobService.js` | enqueue/claim/reclaim/complete |
| `server/services/checkout/checkoutFinalizationWorker.js` | tick/sweep (ops-push pattern) |
| `server/services/checkout/checkoutFinalizeSideEffects.js` | email queue, quote, alerts, messaging, meta, ops push |
| `server/services/checkout/paidCheckoutVerification.js` | PI/amount/hash/date/entity checks |
| `server/scripts/reconcilePaidCheckoutFinalization.js` | orphan detection + enqueue |
| `server/routes/checkoutFinalizeIntentRoutes.js` (or session routes) | PUT intent |
| `docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md` | this doc |
| Tests under `server/scripts/*Finalization*.test.cjs` | per batch |

### I.3 Extract / replace functions

| Existing | Action |
|---|---|
| `runCheckoutFinalizeOrchestration` | Keep; extend reclaim/expiry; called by domain |
| `executeBookingFinalizeWork` | Keep; feed context from intent; fix overlap policy |
| `processStripeWebhookEvent` | Extend; no sync finalize |
| `buildPaymentIntentMetadata` | Add hash |
| `claimBookingConfirmationSideEffectsOnce` | Replace auto usage (Batch 6) |
| Route block ~1525–1780 `bookingRoutes.js` | Move to domain + side effects |
| `recordPaidBookingResolutionIssue` | Enrich stage/codes (Batch 1) |

---

## J. Batch implementation plan

Feature flags (all default **off** / safe):

| Flag | Meaning |
|---|---|
| `FINALIZE_OBSERVABILITY=1` | Batch 1 |
| `FINALIZE_INTENT_PERSIST=1` | Batch 2 store |
| `FINALIZE_INTENT_REQUIRED_FOR_PI=1` | Batch 2 gate |
| `CHECKOUT_MARK_PAID_ON_WEBHOOK=1` | Batch 3 |
| `FINALIZE_JOB_ENQUEUE=1` | Batch 3 |
| `FINALIZE_JOB_EXECUTE=0` | Batch 3–4 stay 0 |
| `FINALIZE_DOMAIN_SERVICE=1` | Batch 4 frontend uses domain |
| `FINALIZE_JOB_EXECUTE=1` | Batch 5 |
| `FINALIZE_WORKER_SEND_CONFIRMATION=0→1` | Batch 6 |
| `FINALIZE_SIDE_EFFECTS=1` | Batch 6 |
| `FINALIZE_RECONCILE_ENQUEUE=1` | Batch 7 |
| `FINALIZE_RECONCILE_HISTORICAL=1` | Batch 8 |
| `FINALIZE_LOCK_VISIBILITY_MS` | config |
| `FINALIZE_JOB_VISIBILITY_TIMEOUT_MS` | config |

---

### Batch 1 — Observability only

**Goal:** Precise failure capture; no booking behavior change.

**Files:** `PaymentResolutionIssue.js`, `recordPaidBookingResolutionIssue` in `bookingRoutes.js`, optional structured logger helper, docs.

**Migration:** none required (Additive fields on `metadata`).

**Flags:** `FINALIZE_OBSERVABILITY=1`

**Tests:** issue metadata includes checkoutId, PI, stage, errorCode; gift voucher unchanged.

**Deploy:** API only.

**Verify:**

```js
db.paymentresolutionissues.find({ updatedAt: { $gte: ISODate("...") } }).pretty()
// metadata.stage, metadata.checkoutId present on new failures
```

**Rollback:** flag off / revert deploy.

**Risks:** log volume.

**Done when:** paid finalize failures persist exact code+stage; no change to success rate.

---

### Batch 2 — FinalizeIntent persistence + PI metadata

**Goal:** Intent stored + hashed + bound to PI; **no** worker execution.

**Files:** CheckoutSession model; `finalizeIntentService.js`; session routes; `checkoutCanonicalPaymentIntentService.js`; ConfirmBooking client; tests.

**Migration:** additive schema fields; `syncIndexes` not critical.

**Flags:** `FINALIZE_INTENT_PERSIST=1`; later `FINALIZE_INTENT_REQUIRED_FOR_PI=1` after soak.

**Tests:** hash stability; update before pay; reject after paid; metadata contains hash; missing intent blocks PI when required.

**Deploy:** API + client together if required-for-PI enabled; else API first with persist optional.

**Verify:** sessions have `finalizeIntentHash`; PI metadata shows hash for new checkouts.

**Rollback:** disable required gate first; persist can remain.

**Risks:** client not sending intent → PI blocked when required.

**Done when:** 100% of new V2 card checkouts in staging have intent+hash before confirm.

---

### Batch 3 — Mark paid + job enqueue (execute off)

**Goal:** Webhook marks `paymentStatus=paid`, creates `CheckoutFinalizationJob`, responds fast.

**Files:** `CheckoutFinalizationJob.js`, job service, `stripeIngestionService.js`, indexes sync script/test.

**Migration:** create collection + indexes (unique partial).

**Flags:** `CHECKOUT_MARK_PAID_ON_WEBHOOK=1`, `FINALIZE_JOB_ENQUEUE=1`, `FINALIZE_JOB_EXECUTE=0`

**Tests:** gift voucher excluded; duplicate webhook idempotent; enqueue E11000 safe; superseded PI does not enqueue accommodation finalize (or enqueues permanent review job — choose: **no booking job**, open `superseded_pi_captured` only).

**Deploy:** API; ensure index build before enable enqueue.

**Verify:**

```js
db.checkoutsessions.find({ paymentStatus: "paid", finalizeStatus: "open" })
db.checkoutfinalizationjobs.find({ status: "scheduled" })
```

**Rollback:** disable enqueue + mark-paid flags; jobs remain inert.

**Risks:** noise jobs without execute — monitor count.

**Done when:** every new paid V2 accommodation PI has session paid + ≤1 active job.

---

### Batch 4 — Domain service + lock reclaim + adopt + frontend switch (worker still off)

**Goal:** `finalizePaidCheckout` authoritative; frontend uses it; crash-safe adopt/reclaim; paid expiry override; paid overlap no-delete; Sofia checkIn validator fix.

**Files:** `finalizePaidCheckout.js`, finalize service, execute work, bookingRoutes thin, Booking model dates, side-effect stub hooks.

**Migration:** Booking validator change (behavior for same-day).

**Flags:** `FINALIZE_DOMAIN_SERVICE=1`, execute still 0.

**Tests:** adopt after save; stale lock; expired+paid finalize; overlap keeps booking; simultaneous frontend calls; no worker.

**Deploy:** API; monitor same-day bookings.

**Verify:** frontend-only finalize still works; inject crash test in staging.

**Rollback:** flag off → previous route path if dual-maintained; prefer short bake with dual call shadow.

**Risks:** route regression; date validator edge cases.

**Done when:** frontend production traffic uses domain service; staging crash-after-save recovers via adopt.

---

### Batch 5 — Worker execute (no worker email)

**Goal:** Worker runs `finalizePaidCheckout` for new jobs; email still frontend or pending unsent.

**Files:** `checkoutFinalizationWorker.js`, `server.js` start, job stage updates.

**Flags:** `FINALIZE_JOB_EXECUTE=1`, `FINALIZE_WORKER_SEND_CONFIRMATION=0`

**Tests:** browser never calls POST → booking exists; webhook before/after browser; duplicate events; superseded; no units; mismatches.

**Deploy:** enable execute on one node first.

**Verify:**

```js
db.checkoutfinalizationjobs.find({ status: "succeeded" })
db.bookings.find({ checkoutId: "..." })
// confirmation may still depend on browser if flag 0
```

**Rollback:** `FINALIZE_JOB_EXECUTE=0` immediately; jobs stay scheduled.

**Risks:** double finalize races (should be safe); review permanent errors.

**Done when:** staging “browser abandoned after pay” creates booking within SLA without duplicate.

---

### Batch 6 — Email SM + quote convert + alerts + secondary side effects

**Goal:** Durable confirmation delivery; convert quote; resolve alerts; messaging/meta/ops push from shared side effects.

**Files:** email delivery services, side effects module, deprecate pre-send claim.

**Flags:** `FINALIZE_SIDE_EFFECTS=1`, `FINALIZE_WORKER_SEND_CONFIRMATION=1`

**Tests:** SMTP failure; ambiguous timeout; no silent suppress; no booking rollback; alert resolve; quote convert idempotent.

**Deploy:** after Batch 5 stable.

**Verify:** EmailDeliveryState succeeded; `confirmationEmailSentAt` only after success; open failed states visible.

**Rollback:** disable worker send; keep finalize; manual resend.

**Risks:** rare duplicate email on ambiguous retry.

**Done when:** paid finalize without browser still emails guest; failures visible in ops.

---

### Batch 7 — Orphan reconciliation (new orphans only)

**Goal:** Periodic ensure-job for: Payment paid, reservationId null, accommodation checkoutId, session not finalized, not gift voucher.

**Files:** `reconcilePaidCheckoutFinalization.js`, scheduler tick or cron script under PM2.

**Flags:** `FINALIZE_RECONCILE_ENQUEUE=1`, historical off.

**Tests:** reconcile creates missing job; ignores gift vouchers; ignores in-progress active jobs.

**Frequency:** 1–5 minutes.

**Max orphan age target:** &lt; 15 minutes to active job or permanent review.

**Rollback:** flag off.

**Done when:** synthetic orphan repaired in staging via reconcile alone.

---

### Batch 8 — Historical recovery

**Goal:** Dry-run then allowlisted historical orphans.

**Flags:** `FINALIZE_RECONCILE_HISTORICAL=1` + allowlist file/env of checkoutIds or `createdAt` window.

**Always dry-run first.** No auto-refund.

**Done when:** ops sign-off on dry-run report; apply allowlist only.

---

## K. Test plan

### Unit

- Intent validate/hash/canonicalize  
- Job enqueue idempotency / claim / reclaim  
- Error classification matrix  
- Sofia day validator vs wall-clock  
- Gift voucher metadata detection  
- Paid overlap policy branch  

### Integration

- Webhook → paid → job → worker → booking (no browser)  
- Browser before webhook; webhook before browser; simultaneous  
- Duplicate Stripe event  
- Frontend + worker simultaneous  
- Expired session + paid PI  
- Adopt after Booking save / before session finalize  
- Stale `in_progress`  
- Superseded PI success; both PI succeed  
- No units; commercial stay conflict  
- Intent/hash/amount/currency/date/entity mismatch  
- Missing legal acceptance blocked pre-pay  
- Same-day Sofia check-in  

### Failure injection

- Crash after every durable stage (E table)  
- SMTP fail / timeout ambiguity  
- Stripe retrieve timeout  
- Lock held  
- Job VT expiry  
- Reconcile during live finalize  

### Invariants asserted in tests

- ≤1 Booking per checkoutId / PI  
- 0 new PaymentIntents from worker/reconcile  
- 0 auto refunds  
- Gift voucher never accommodation-finalized  
- Failed email ≠ booking delete  
- No permanent stuck `in_progress` after reclaim interval  

---

## L. Go / no-go criteria per flag

| Flag | Go only if |
|---|---|
| `FINALIZE_OBSERVABILITY` | Deployed; dashboards/query for errorCode/stage work |
| `FINALIZE_INTENT_PERSIST` | Client+API contract tested; no PII logging leaks |
| `FINALIZE_INTENT_REQUIRED_FOR_PI` | ≥1 day persist soak; &lt;1% intent-missing errors |
| `CHECKOUT_MARK_PAID_ON_WEBHOOK` | Intent hash present on new sessions; webhook tests green |
| `FINALIZE_JOB_ENQUEUE` | Indexes created; unique active job verified; EXECUTE=0 |
| `FINALIZE_DOMAIN_SERVICE` | Batch 4 tests green; shadow/compare on staging; Sofia date OK |
| `FINALIZE_JOB_EXECUTE` | Domain service in prod; reclaim/adopt tests green; kill switch documented; on-call aware |
| `FINALIZE_WORKER_SEND_CONFIRMATION` | Email SM tests green; ops can see `failed` deliveries |
| `FINALIZE_SIDE_EFFECTS` | Quote/alert/email paths idempotent in staging |
| `FINALIZE_RECONCILE_ENQUEUE` | Worker execute stable ≥ soak period; orphan query validated |
| `FINALIZE_RECONCILE_HISTORICAL` | Dry-run report signed by ops; allowlist only |

**Global no-go:** any batch that auto-refunds, creates PaymentIntents, invents guest/legal data, or claims email before SMTP success.

---

## Same-day Sofia check-in (binding rule)

- **Authority:** Europe/Sofia calendar date.  
- **Allow** if `formatSofiaDateOnly(checkIn) >= formatSofiaDateOnly(now)`.  
- **Store** dates as Sofia day-start UTC instants via `normalizeDateToSofiaDayStart`.  
- **Booking schema validator:** replace `v > new Date()` with Sofia day rule (and checkOut &gt; checkIn by Sofia day).  
- Route, worker, availability, manual recovery: same helper.

---

## Explicit non-goals

- Location retreat / `locationCheckoutService` auto-finalize  
- Gift voucher purchase PI accommodation linking  
- Automatic refunds / automatic replacement PaymentIntents  
- Exactly-once email  
- Redesigning commercial stay product policy beyond guard + review  

---

## Implementation order reminder

Execute **only** the next approved batch. After each batch: run its tests, verification queries, and go/no-go before enabling the next flag.
