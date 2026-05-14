# Guest Message Automation — 03: Implementation Batches

Status: design lock, V0 (plan)
Owner: Jose (product), engineering (implementation), Cursor (executor), ChatGPT (reviewer)
Supersedes: nothing
Reads from (must be consistent with):
- `docs/guest-message-automation/01_VISION_AND_BOUNDARIES.md`
- `docs/guest-message-automation/02_V1_SPEC.md`

This document defines **how the V1 work is split into safe, ordered batches**, what each batch is allowed to do, what it must not do, and what gate it must pass before it ships. It is the operating contract between Cursor (the executor) and ChatGPT (the reviewer) for the V1 build-out. It contains no code, no migrations, no schema definitions; those live in `02_V1_SPEC.md`. If a batch reveals that `02_V1_SPEC.md` is wrong, the batch stops and the spec is patched first.

---

## 1. Batch philosophy

The build is split into small, independently-reviewable, individually-revertable batches. The philosophy is:

- **Audit before build.** Every batch starts with a read-only audit against the V1 spec. The audit asks: "Has the codebase moved since the spec was written? Are the assumptions still true? Are there hidden couplings the spec missed?" Cursor returns the audit before writing any code. If the audit invalidates the batch scope, the batch is replanned.
- **Propose before implement.** After the audit, Cursor writes a concise implementation proposal (files added, files modified, files explicitly left alone, tests, rollback). No code is written until the proposal is approved.
- **Lighter review for safe batches, hard gate for risky ones.** Docs, isolated UI, and read-only views ship after a short plan. Anything touching booking lifecycle, the dispatcher, the real WhatsApp provider, or auto-mode rollout requires explicit ChatGPT review before implementation.
- **No giant mixed patches.** A batch does **one** thing. If a batch is becoming "this thing and also that thing", it is two batches.
- **No "while we are here" refactors.** Code outside the batch scope is not touched, not renamed, not reformatted, not "cleaned up". Even if it's tempting. Even if it looks broken. Those go into a separate, opt-in cleanup ticket.
- **No touching legacy systems** unless the batch scope explicitly says so. The hard list: booking core, payment, Stripe, gift voucher, creator, referral, attribution, iCal sync, legacy email lifecycle (`bookingLifecycleEmailService`, `emailService`, `EmailEvent`). The new system runs **alongside** the legacy one.
- **Reversible by configuration.** Every batch ends in a state where the new behaviour can be turned off via a rule flag, a worker flag, or an environment toggle — without a code revert.
- **Tempo matters.** Small batches are not slow batches. Each is sized to ship within one or two working sessions, including review. If a batch is dragging beyond that, it is too big.
- **Shadow before auto.** Real guest sends are the **last** thing turned on. The rule engine, scheduler, orchestrator, and OPS UI all run in shadow mode (per §35 of `02_V1_SPEC.md`) before a single real message goes out.

---

## 2. Risk levels

Risk classifies how aggressive the gate must be before a batch is allowed to land.

- **Low** — Docs, isolated read-only OPS UI screens, internal notes, dev-only scaffolds. No data model change. No write path change. No legacy code touched. Worst case of a bug: a misleading UI or a stale doc. Reversible by deleting a file.
- **Medium** — New collections, new server-side modules that do not run on production traffic yet (e.g. scheduler in shadow only, dispatcher without a live provider), seed data, OPS UI that reads from new collections, template authoring screens, indexes. Worst case of a bug: bad data in new-only collections, recoverable by truncating those collections (which are not yet load-bearing).
- **High** — Anything that touches booking lifecycle hooks, the real dispatcher path, the real WhatsApp or email provider call, the auto-mode rollout, or any code that can cause a guest-visible message to be sent (or not sent when it should have been). Worst case of a bug: duplicate sends, wrong-property sends, missed pre-arrival, real-money provider charges. Reversible by configuration only if the kill switch was wired in correctly.

Classification table for the V1 batches:

| Batch | Title | Risk |
|---|---|---|
| 0 | Business decisions and provider readiness | Low |
| 1 | Source audit against V1 spec | Low |
| 2 | `propertyKind` foundation | Medium |
| 3 | Message automation data models | Medium |
| 4 | Phone normalisation and contact preference foundation | Medium |
| 5 | Template and rule seed layer | Medium |
| 6 | `SchedulerWorker` and job claiming (shadow only) | Medium |
| 7 | `MessageOrchestrator` hooks | **High** |
| 8 | `MessageDispatcher` and provider abstraction | Medium |
| 9 | Email fallback adapter | **High** |
| 10 | OPS UI foundation | Low (mostly) / Medium (where it writes) |
| 11 | WhatsApp provider integration | **High** |
| 12 | Internal OPS alerts | Medium |
| 13 | Shadow-mode production verification | Medium |
| 14 | Auto mode with safety gates | **High** |

---

## 3. Gate rules

The gate rules are non-negotiable. They define when a batch may start, when it may ship, and when it must stop.

### 3.1 Start rules (before a batch is implemented)

- The previous batch is **shipped and verified** (its post-build report is complete and signed off).
- Cursor has produced the **audit-first report** for this batch (see §4).
- Cursor has produced the **implementation proposal** for this batch and it has received the right level of review (see §3.2).
- All dependencies listed in the batch entry are satisfied.

### 3.2 Review depth by risk

- **Low risk** — Cursor produces a short plan. ChatGPT acknowledges. Implementation may proceed.
- **Medium risk** — Cursor produces a concise written proposal (files, tests, rollback). ChatGPT reviews for scope drift and hidden coupling. Implementation proceeds after explicit "go".
- **High risk** — Cursor produces a full proposal **plus** a written justification of how the batch interacts with the legacy systems it must not touch (booking, payment, Stripe, voucher, iCal, legacy email lifecycle). ChatGPT reviews in detail. **No implementation without an explicit written "go" from ChatGPT.**

### 3.3 Ship rules (before a batch is merged / deployed)

- Tests listed in the batch entry have been run and pass.
- The rollback path listed in the batch entry has been verified mentally and, where the batch touches data or workers, verified in a dev environment.
- No files outside the batch's declared "files likely touched" list have been modified, except those Cursor flags explicitly in the post-build report with justification.
- No legacy hard-list code (§1) has been modified.
- The OPS / config toggle for the new behaviour exists and is in the **off / shadow / disabled** position by default.

### 3.4 Hard-stop triggers (during a batch)

A batch **must stop and ask** if any of the following appear during implementation:

- Files outside the batch's declared scope need to be modified to make the batch work.
- A legacy hard-list system would need to be touched.
- The V1 spec contradicts the codebase in a non-trivial way.
- A test that previously passed now fails.
- A change to a public API or to a database collection's existing fields becomes necessary.
- Phone normalisation, suppression, idempotency, or property-resolution logic looks ambiguous.
- Any path that could cause a duplicate send, a wrong-property send, or a send to a cancelled booking is touched.

Hard-stop means: pause, write a one-paragraph note, and request review. Do not push through.

---

## 4. How Cursor must report **before** each batch

Before any code is written, Cursor must produce a single **pre-batch report**. Format:

```
Batch: <N — title>
Risk: <Low|Medium|High>

1. Audit findings
   - What the V1 spec says about this batch.
   - What the codebase actually looks like today (file paths, function signatures, model shapes, relevant exports).
   - Any drift between spec and code. If drift exists, propose either "patch the spec" or "adjust the batch" — do not silently re-interpret either.

2. Files likely touched
   - Added files (new files this batch will create).
   - Modified files (existing files this batch will change), with one-line reason each.
   - Files explicitly NOT touched even though they are nearby (e.g. legacy email lifecycle service).

3. Implementation scope
   - One paragraph in plain English describing what the batch will do.
   - The exact behaviour after this batch that did not exist before (preferably as a "before / after" pair).

4. Explicit out of scope
   - Things that look related but are deferred to a later batch.

5. Tests / checks
   - Unit tests added.
   - Integration / scenario tests added.
   - Manual verification steps.

6. Rollback strategy
   - Exact toggles or steps that disable the new behaviour without code revert.
   - Whether data created by this batch is safe to leave in place after rollback (preferred) or must be cleaned up (and how).

7. ChatGPT review requirement
   - "Light ack only" / "Proposal review" / "Full high-risk review".

8. Open questions
   - Anything Cursor wants confirmed before writing code.
```

If any of the sections cannot be filled honestly, the batch is not ready.

---

## 5. How Cursor must report **after** each batch

After implementation and before the batch is considered shipped, Cursor must produce a **post-batch report**. Format:

```
Batch: <N — title>
Status: <shipped | reverted | partially-shipped>

1. What was actually changed
   - Final list of files added.
   - Final list of files modified.
   - Final list of files NOT modified (including any "files likely touched" entries from the pre-batch report that turned out to be unnecessary).
   - Anything outside the declared scope that needed a tiny change, with justification.

2. Parity check vs the V1 spec
   - "<spec section> says X. Implementation does X." for each relevant section.
   - Any deviations, with rationale.

3. Tests run and outcomes
   - Pass/fail per test.
   - Any flaky tests with notes.

4. Manual verification performed
   - Steps run and results.

5. Default state of the new behaviour
   - Confirm the new path is OFF / shadow / disabled by default.
   - Confirm the toggle to enable it exists and was tested in the OFF position.

6. Rollback readiness
   - Confirm the rollback path is still valid in light of what actually got built.
   - Note any data created by this batch and its disposition.

7. Carry-overs into the next batch
   - Anything intentionally left for a later batch.
   - Anything unexpectedly discovered that should be noted for a future batch's audit.

8. Risk re-evaluation
   - Did the actual implementation surface any risks higher than what was anticipated at planning time?
   - If yes, the next dependent batch's risk classification is updated here.
```

The post-batch report is the artefact that proves the batch is ready to be considered the new baseline. The next batch's audit reads from it.

---

## 6. Stop conditions

The build pauses, in whole or per-batch, if any of these are true. These are different from §3.4 hard-stops (which pause a single batch); these pause the **programme**:

- **Provider not confirmed.** Without an answer to D-2 (Meta vs Twilio vs 360dialog) and D-1 (sender number identity), batches 11, 13, and 14 cannot start. Batches 0–10 may continue.
- **Spec contradiction discovered.** If a batch audit shows the spec is wrong in a non-trivial way, the batch pauses and the spec is patched first via a focused doc-only PR. The batch then re-audits against the patched spec.
- **Legacy regression risk.** If a proposed change to the new system would force a corresponding change in legacy email lifecycle, payment, Stripe, voucher, creator, referral, attribution, or iCal code, the programme pauses for explicit re-scoping. This includes "we'd need to refactor X to make this clean" — that is exactly the case where the programme must pause.
- **Duplicate-send risk surfaces.** Any evidence (review, test, manual check) that the system could produce a duplicate send halts dispatcher and orchestrator work until reproduced and fixed.
- **Wrong-property risk surfaces.** Same severity as duplicate-send. Halts orchestrator work until reproduced and fixed.
- **Restart-induced loss or duplication.** If PM2 restart causes a missed claim or a duplicate claim, scheduler work halts until reproduced and fixed.
- **Failure escalation broken.** If `ManualReviewItem` escalation does not happen on a failed dispatch, the dispatcher cannot ship.
- **OPS cannot stop a run.** If OPS cannot pause a rule, pause a booking, or cancel a scheduled job through the UI, batches 13 and 14 cannot start.

Resume is always explicit; nothing auto-resumes.

---

## 7. Full batch list

Each batch follows the canonical entry format:

```
Goal
Risk
Dependencies
Files likely touched
What Cursor must audit first
Implementation scope
Explicit out of scope
Tests / checks
Rollback strategy
ChatGPT review requirement
```

The batch order below is the recommended order. The real audit in Batch 1 may propose a refined ordering; if it does, the new ordering must be reviewed and ratified before any subsequent batch starts.

---

### Batch 0 — Business decisions and provider readiness

**Status: LOCKED.** Jose's Batch 0 decisions D-1..D-13 are now recorded verbatim in `02_V1_SPEC.md` §4.1, and the engineering cross-reference table in `02_V1_SPEC.md` §4 has been updated to reflect the locked answers. Batch 1 (Source audit) is unblocked.

**Goal.** Close the open business decisions in `02_V1_SPEC.md` §4 (D-1 … D-13) and confirm provider readiness before any code is written. This is a no-code batch whose output is the written decisions log in `02_V1_SPEC.md` §4.1.

**Risk.** Low.

**Dependencies.** `01_VISION_AND_BOUNDARIES.md` and `02_V1_SPEC.md` exist and are signed off.

**Files likely touched.**
- Modified (doc only): `docs/guest-message-automation/02_V1_SPEC.md` — §4 status column + new §4.1 Batch 0 decisions log. (Done.)
- Modified: none in `server/` or `client/`.
- Not touched: all code.

**What Cursor must audit first.**
- Re-read `02_V1_SPEC.md` §4 (decisions table) and `01_VISION_AND_BOUNDARIES.md` §19 to confirm the decision list is complete.
- Identify which decisions block which downstream batches.

**Implementation scope (all CLOSED below).**
1. **D-1 (LOCKED).** Official WhatsApp sender = **Jose's current Bulgarian private WhatsApp number** for V1. Move to a dedicated Drift & Dwells business number later if needed. The `BookingSuccess.jsx` number inconsistency stays a Batch 1 audit catalogue item (no code edit in Batch 0).
2. **D-2 (LOCKED).** Provider direction = **Meta WhatsApp Cloud API direct first.** Twilio only if Meta setup becomes too painful. 360dialog is not pursued.
3. **D-3 (LOCKED).** Dedicated vs private number = **private number accepted** for V1. The provider abstraction (§20 of the spec) and per-rule sender identity keep the WABA number swappable later **without touching rules, templates, the scheduler, or OPS UI**.
4. **D-4 (LOCKED, scope only).** V1 guest template = **arrival / pre-arrival instructions only.** Template keys are `arrival_3d_the_cabin` and `arrival_3d_the_valley` (WhatsApp + email variants, `en`). Final copy is a content task confirmed at Batch 5 seed time.
5. **D-5 (LOCKED).** Send timing for both The Cabin and The Valley = **T-72h (3 days before check-in).** T-24h and T-48h are not the V1 default and remain only as historical/alternative offsets. Sofia hour-of-day is a Batch 5 seed-time sub-decision (working default `17:00 Europe/Sofia`).
6. **D-6 (LOCKED).** Internal OPS alerts = **all three on**, email-only: `OPS-INT-8D` (guest arriving in 8 days), `OPS-INT-CIT` (check-in tomorrow), `OPS-INT-COT` (checkout today). Recipient is the existing `EMAIL_TO_INTERNAL` address.
7. **D-7 (LOCKED).** `propertyKind` enum = **`cabin | valley`** (Batch 0 D-7, mapped to spec §4 D-8).
8. **D-8 (LOCKED).** Default phone country = **`BG`**; fully-qualified international numbers are accepted as-is when a country code is present (Batch 0 D-8, mapped to spec §4 D-9).
9. **D-9 (LOCKED).** Consent wording = **add transactional communication wording to checkout/terms; no separate popup** (Batch 0 D-9, mapped to spec §4 D-10). Exact copy = focused content task, not a code-batch blocker.
10. **D-10 (LOCKED).** Marketing consent = **out of V1**, per vision doc §6 and §15. No engineering action.
11. **D-11 (LOCKED).** Rollout = **`shadow → auto with safety gates`.** No manual-approval stage. Manual-approve exists only as emergency/override mode. (Spec §35.)
12. **D-12 (LOCKED).** `BOOKING_CONFIRM_WITHOUT_STRIPE` policy = **block guest automation** for these bookings unless explicitly marked safe/manual in OPS. Surfaces as a dispatcher guard in spec §32.
13. **D-13 (LOCKED).** Worker model = **design for a separate PM2 worker.** May start integrated only if moving to a split process later requires no code rewrite (Batch 0 D-13, mapped to spec §4 D-7).

**Explicit out of scope.**
- No code changes.
- No template submission to Meta (this is a Batch 11 activity, gated on D-2 being locked — which it now is).
- No environment variable additions.
- No change to the provider abstraction requirement: it remains as specified in §20 and is reinforced by D-3 (number/provider must stay swappable).

**Tests / checks.** N/A (docs only). Check: every Batch 0 D-N has an explicit locked answer in `02_V1_SPEC.md` §4.1, or a documented "sub-decision deferred to Batch X with rationale" (only D-4 Sofia hour, D-4 final template copy, and D-9 exact consent copy fall into this latter bucket, and none of them block Batch 1).

**Rollback strategy.** Decisions are recorded in the V1 spec; rolling back means reopening one or more D-items in §4 / §4.1. No runtime impact.

**ChatGPT review requirement.** Light ack only — done. ChatGPT confirmed the locked answers are internally consistent and do not contradict the vision/spec.

---

### Batch 1 — Source audit against V1 spec

**Goal.** Read-only audit of the **actual current codebase** against `02_V1_SPEC.md`. Output a written audit identifying the exact files to touch, exact conflicts with the spec, and a proposed final implementation sequence (which may refine the batch ordering below).

**Risk.** Low.

**Dependencies.** Batch 0 decisions logged (or explicitly deferred).

**Files likely touched.**
- Added: `docs/guest-message-automation/audits/B01-source-audit.md`.
- Modified: none.
- Not touched: all code.

**What Cursor must audit first.**
- `server/models/Booking.js`, `server/models/Cabin.js`, `server/models/CabinType.js`, `server/models/Guest.js`.
- `server/services/emailService.js`, `server/services/bookingLifecycleEmailService.js`, `server/services/giftVouchers/giftVoucherEmailService.js`, `server/services/ops/domain/communicationWriteService.js`.
- `server/routes/bookingRoutes.js`, `server/routes/emailWebhookRoutes.js`, `server/routes/stripeWebhookRoutes.js`.
- `server/services/ops/ingestion/icalSyncScheduler.js` (only scheduler currently present).
- `server/server.js` (startup wiring).
- OPS screens under `client/src/pages/ops/`.
- All known `wa.me` references.

**Implementation scope.** Produce a written audit covering, at minimum:
1. Exact current shape of `Booking.guestInfo` (fields, validators) and confirmation that `phone` validation is `min length 1` and not stricter.
2. Exact current shape of `Cabin` and `CabinType` — confirm `propertyKind` does not exist and what fields are nearby.
3. Exact public methods of `emailService` (signature of `sendEmail` confirmed, presence/absence of any other relevant helpers).
4. Exact lifecycle trigger points in `bookingRoutes.js` (where `Booking` saves happen and what is called after).
5. Existing OPS screens enumerated, and which screen will host the new comms surfaces (per §26 of the spec).
6. Existing `EmailEvent` shape (confirm we will not modify it).
7. Existing `ManualReviewItem` shape (confirm we will use it as-is).
8. Any inconsistencies between spec assumptions and reality, listed explicitly.
9. Proposed final batch sequence — accept the default ordering or propose a refined one with rationale.

**Explicit out of scope.**
- No code changes.
- No data model changes.
- No "tiny fix" commits.

**Tests / checks.** None. The audit is the output.

**Rollback strategy.** Delete the audit doc.

**ChatGPT review requirement.** Proposal review. ChatGPT reads the audit, confirms no scope drift, ratifies any reordering proposal.

---

### Batch 2 — `propertyKind` foundation

**Goal.** Persist a `propertyKind` field on `Cabin` and `CabinType` and provide a **controlled, auditable** one-off backfill via an **idempotent internal CLI or maintenance script** (not an OPS action). No messaging code is added. No sending happens. This is the foundation Batches 3, 5, 7, 11 all depend on.

**Risk.** Medium. Touches existing core domain models, but with additive-only changes.

**Dependencies.** Batches 0, 1.

**Files likely touched.**
- Modified: `server/models/Cabin.js`, `server/models/CabinType.js` (additive field only).
- Added: an idempotent internal backfill script or maintenance command (location decided in audit, e.g. under `server/scripts/` — **no public HTTP route, no OPS UI button, no casual staff trigger**).
- Added: a small read helper `server/services/propertyKindResolver.js` (or similar) used only by the new messaging system later.
- Tests added.
- Not touched: any other model, any route, any UI, any legacy email pipeline.

**What Cursor must audit first.**
- Current `Cabin` and `CabinType` field set and validators.
- Whether either model has hooks that would fire on an additive field.
- Whether anywhere in the codebase uses `cabin.location.toLowerCase().includes('valley')` or equivalent string sniffing — these are catalogued for future removal but **not removed in this batch**.
- Current rows in those collections, to size the backfill.

**Implementation scope.**
- Add an additive, optional `propertyKind` field with the enum agreed in D-7.
- Provide the one-off backfill as an **idempotent internal script or maintenance command**: **dry-run first** (no writes), printing the **exact** list of affected `Cabin` / `CabinType` records and each **proposed** `propertyKind` value; **write mode only after explicit human approval** of that output (e.g. a second invocation with an explicit `--apply` / `WRITE=1` flag — exact mechanism decided at implementation time). **Safe to re-run** (idempotent upserts or no-op when already correct). **Must not run on startup.** **No public route. No OPS UI button.** `propertyKind` is a foundational data boundary; backfill must stay controlled and auditable, not a normal OPS workflow.
- Add `propertyKindResolver` as the **only** sanctioned read path for the new messaging system. The resolver throws if `propertyKind` is unset.
- Tests cover: additive field shape, resolver throws on missing, resolver returns enum on present, no impact on existing booking flow.

**Explicit out of scope.**
- Removing string heuristics from legacy email lifecycle (not in V1).
- Making `propertyKind` required (additive only for now; required can be a later spec amendment after backfill is complete).
- Any messaging logic.
- Any OPS-callable endpoint, admin UI control, or "one-click" staff action for `propertyKind` backfill (use the internal script / maintenance command only).

**Tests / checks.**
- Unit tests on `propertyKindResolver`.
- Schema tests confirming `propertyKind` is optional and validated as enum.
- Manual: on a dev database, run **dry-run** and confirm the printed Cabin/CabinType list and proposed values match expectation; obtain explicit approval; run **write mode** once; re-run dry-run to confirm no further changes; verify resolver works on every row.
- Regression: existing `Cabin` / `CabinType` write paths unchanged.

**Rollback strategy.**
- The field is additive and optional. No code path consumes it yet (resolver is unreferenced until Batch 7). Rollback = revert the model edits; existing data with the new field set is harmless.

**ChatGPT review requirement.** Proposal review. The risk here is hidden coupling: ChatGPT confirms no hook fires on the new field and no existing query is affected.

---

### Batch 3 — Message automation data models

**Goal.** Add the new collections and indexes defined in `02_V1_SPEC.md` §§11–16: `MessageTemplate`, `MessageAutomationRule`, `ScheduledMessageJob`, `MessageDispatch`, `MessageDeliveryEvent`, `GuestContactPreference`. No runtime sends. No orchestrator. No worker. Just the data layer with enforced indexes.

**Risk.** Medium. New collections only; no existing data touched.

**Dependencies.** Batches 0, 1.

**Files likely touched.**
- Added: `server/models/MessageTemplate.js`, `server/models/MessageAutomationRule.js`, `server/models/ScheduledMessageJob.js`, `server/models/MessageDispatch.js`, `server/models/MessageDeliveryEvent.js`, `server/models/GuestContactPreference.js`.
- Added: tests for each model.
- Modified: none of: `Booking`, `EmailEvent`, `ManualReviewItem`, `Cabin`, `CabinType`, `Guest`.

**What Cursor must audit first.**
- Existing model conventions (timestamps, validators, helpers, plugin usage).
- Whether any existing collection name collides with the proposed names.
- Whether `ManualReviewItem` already has hooks or categories that we plan to reuse (per §30 of the spec).

**Implementation scope.**
- Define schemas per `02_V1_SPEC.md` §§11–16 exactly. Names, enums, and indexes match the spec.
- Enforce the idempotency unique key on `ScheduledMessageJob` on `(bookingId, ruleKey, scheduledFor)` — **one job per rule occurrence; channel is deliberately excluded** (see §13). WhatsApp and email are dispatch attempts under one job, not separate jobs.
- Enforce the per-attempt unique key on `MessageDispatch.idempotencyKey` (composite `${ruleKey}:${bookingId}:${scheduledFor}:${channel}`, per §14). Channel lives here, not on `ScheduledMessageJob`.
- Enforce `GuestContactPreference` unique key on `(recipientType, recipientValue)` (per §16).
- All models include `createdAt`/`updatedAt`. No fields beyond the spec.

**Explicit out of scope.**
- Any logic that uses these models.
- Any route that reads or writes them.
- Any OPS UI.
- Any seeding of templates or rules (Batch 5).

**Tests / checks.**
- Schema validation tests per model.
- Unique-index enforcement tests: attempting to insert two rows that should collide actually fails.
- No regression: existing models and routes unaffected.

**Rollback strategy.**
- Revert the new model files. Drop the (empty) new collections. No legacy data is affected because nothing wrote to them.

**ChatGPT review requirement.** Proposal review. ChatGPT confirms the indexes match the spec exactly, since these are the load-bearing duplicate-send guards.

---

### Batch 4 — Phone normalisation and contact preference foundation

**Goal.** On booking create and OPS contact edit, normalise the submitted phone to E.164 and persist the result in `GuestContactPreference` (per `02_V1_SPEC.md` §8). The raw phone on `Booking` is preserved. The booking schema is **not** mutated. No provider send happens.

**Risk.** Medium. Touches the booking-create flow, but in an additive, side-effect-isolated way (a `try/catch` write to a new collection, never blocking the booking save).

**Dependencies.** Batches 0, 1, 3.

**Files likely touched.**
- Modified: `server/routes/bookingRoutes.js` (post-save hook to invoke normalisation — write to `GuestContactPreference` is fire-and-forget so it never blocks booking creation).
- Modified: the OPS contact-edit endpoint (location identified in Batch 1 audit).
- Added: `server/services/messaging/phoneNormalisationService.js` (or similar).
- Added: `libphonenumber-js` as a dependency (only if Batch 1 audit confirms it isn't already pulled in transitively; otherwise reuse).
- Tests added.
- Not touched: `Booking` schema; `emailService`; `bookingLifecycleEmailService`; payment; Stripe; voucher; iCal.

**What Cursor must audit first.**
- The exact location of the booking create save and how it currently triggers `bookingLifecycleEmailService` (so the new normalisation hook does not interfere with it).
- The OPS contact edit endpoint and its error handling.
- Whether `libphonenumber-js` is already an indirect dependency.

**Implementation scope.**
- Implement E.164 normalisation with default country per D-9 (recommended `BG`).
- After a successful booking save, upsert a `GuestContactPreference` row (`recipientType='whatsapp_phone'`, `recipientValue=<E.164>`, `phoneStatus=valid|invalid|unknown`, `phoneCountry`, `rawValueLastSeen=<original>`). The upsert is **non-blocking** for the booking response.
- After an OPS contact edit that changes `phone`, recompute and upsert.
- Invalid → write the row with `phoneStatus='invalid'`. Do not mutate `Booking.guestInfo.phone`.
- Expose a small OPS read path that surfaces invalid-phone bookings (no UI yet; just the query helper for Batch 10).

**Explicit out of scope.**
- Sending anything.
- Modifying `Booking` schema (per §8.1 of the spec, a booking snapshot field is **not** part of V1).
- Modifying any legacy email behaviour.

**Tests / checks.**
- Parse a Bulgarian local number → valid E.164.
- Parse a fully-international number → valid E.164.
- Parse junk → `phoneStatus='invalid'` and `Booking.guestInfo.phone` unchanged.
- Booking save still succeeds when the normalisation write fails (fault isolation).
- OPS contact edit recomputes correctly.

**Rollback strategy.**
- Disable the post-save normalisation hook via a feature flag (default off until tested). On rollback, the existing booking flow is unchanged. Existing `GuestContactPreference` rows are harmless because nothing reads them yet.

**ChatGPT review requirement.** Proposal review with extra attention to "the booking save must never be blocked or rolled back by a normalisation failure".

---

### Batch 5 — Template and rule seed layer

**Goal.** Seed the V1 `MessageTemplate` rows (WhatsApp + email, one per property, `en` only) and the one V1 `MessageAutomationRule` (`arrival_instructions_pre_arrival`, mode `shadow` initially). Optionally seed the internal OPS alert rules if D-5 is on. No sending. No worker. No orchestrator.

**Risk.** Medium. The seed runs in dev/prod but the rule is in shadow mode, so nothing actually dispatches.

**Dependencies.** Batches 0 (D-3 template copy, D-4 timing, D-5 ops alerts), 3.

**Files likely touched.**
- Added: `server/scripts/seedMessageAutomation.js` (idempotent, replayable).
- Added: seed data files for template bodies (`server/data/messageTemplates/*.json` or similar — Cursor proposes the structure).
- Added: tests confirming the seed is idempotent.
- Not touched: anything outside `server/scripts/` and `server/data/messageTemplates/`.

**What Cursor must audit first.**
- Existing seed patterns in the repo (so the new seed feels native).
- The agreed final template copy from D-3.
- The agreed send timing from D-4.
- Whether D-5 is on or off.

**Implementation scope.**
- Seed `MessageTemplate` rows: `arrival_3d_the_cabin@whatsapp@en@v1`, `arrival_3d_the_cabin@email@en@v1`, `arrival_3d_the_valley@whatsapp@en@v1`, `arrival_3d_the_valley@email@en@v1` (T-72h scheduling per Batch 0 D-5). All start in status `approved` for the agreed copy. WhatsApp rows include placeholder `metaTemplateName` to be populated in Batch 11.
- Seed `MessageAutomationRule` row: `arrival_instructions_pre_arrival`, `mode='shadow'`, `enabled=false` until Batch 13.
- If D-5 is on: seed the internal alert rules, also `mode='shadow'`, `enabled=false`.
- Seed is idempotent: re-running does not duplicate or overwrite approved templates (per §11 of the spec, approved templates are immutable; the seed only inserts missing rows).

**Explicit out of scope.**
- Any dispatcher, worker, orchestrator, or OPS UI work.
- Meta template submission (Batch 11).
- Enabling any rule (Batch 13).

**Tests / checks.**
- Seed runs cleanly on an empty dev DB.
- Seed runs cleanly on a DB that already has the rows (idempotency).
- Templates conform to the variable schemas in §24 and §25 of the spec.

**Rollback strategy.**
- Disable any rule (`enabled=false`) and / or set `mode='shadow'`. Templates can remain; they are inert without an enabled rule.

**ChatGPT review requirement.** Proposal review. The risk is incorrect template copy or wrong variable schema, which would propagate into Batch 13.

---

### Batch 6 — `SchedulerWorker` and job claiming (shadow only)

**Goal.** Implement the MongoDB-backed scheduler worker per `02_V1_SPEC.md` §18: atomic claim, visibility timeout, duplicate-send prevention. The worker runs in **shadow-only** mode — when it claims a job it logs and writes a shadow `MessageDispatch` row but **does not call any provider adapter**. Wired into the server startup but feature-flagged off by default.

**Risk.** Medium. No real sends; the worker can claim and "process" jobs without touching providers.

**Dependencies.** Batches 1, 3.

**Files likely touched.**
- Added: `server/services/messaging/schedulerWorker.js` (or path Cursor proposes).
- Modified: `server/server.js` to optionally start the worker on startup behind a feature flag (default off).
- Added: tests for atomic claim, visibility-timeout reclaim, restart-safety.
- Not touched: existing `icalSyncScheduler`, any booking lifecycle code.

**What Cursor must audit first.**
- `server/services/ops/ingestion/icalSyncScheduler.js` for in-process patterns and `setInterval` conventions.
- `server.js` startup wiring.
- Whether MongoDB's `findOneAndUpdate` with `returnDocument: 'after'` is the right primitive for atomic claim (per §18.2 of the spec).

**Implementation scope.**
- Implement the tick loop, atomic claim, visibility timeout, leader-election approach agreed in D-6.
- In shadow mode, write a `MessageDispatch` row with `status='accepted'`, `providerMessageId=null`, `details.shadow=true`. Do not call any adapter.
- Mark the `ScheduledMessageJob` as `dispatched` on success.
- Test that a job is claimed exactly once, even with parallel ticks simulated.
- Test that a PM2 restart in the middle of processing a job leads to exactly one final dispatch (the visibility-timeout reclaim path).

**Explicit out of scope.**
- Calling any provider adapter (Batch 8 + Batch 11 + Batch 9).
- Wiring the orchestrator to create jobs (Batch 7).
- OPS UI for upcoming messages (Batch 10).

**Tests / checks.**
- Concurrent claim test: two ticks, same job, only one claim succeeds.
- Visibility-timeout test: a "stuck" job becomes reclaimable after timeout.
- Idempotent finalisation: marking a job `dispatched` twice is a no-op.
- The worker is OFF by default in `.env` defaults.

**Rollback strategy.**
- Feature flag `MESSAGE_SCHEDULER_WORKER_ENABLED=false` (default). On rollback, the worker simply does not start; existing iCal scheduler unaffected.

**ChatGPT review requirement.** Proposal review with extra attention to atomic claim correctness. This is the single most "interesting" piece of plumbing.

---

### Batch 7 — `MessageOrchestrator` hooks

**Goal.** Wire the orchestrator (per `02_V1_SPEC.md` §17) into the booking lifecycle so that confirmed bookings generate `ScheduledMessageJob` rows for the active rule. Handle booking date changes (cancel + reschedule affected jobs) and cancellation (cascade-cancel future jobs). All of this remains in **shadow mode** because the rule is still in shadow.

**Risk.** **High.** This is the first batch that hooks into the booking lifecycle. Failure modes touch real bookings.

**Dependencies.** Batches 2, 3, 4, 5, 6.

**Files likely touched.**
- Added: `server/services/messaging/messageOrchestrator.js`.
- Modified (carefully, additive only): the **six** booking-lifecycle hook surfaces enumerated below. All orchestrator calls are fire-and-forget; none of them are allowed to affect the underlying booking / status / date write.
- Tests added.
- **Not touched (hard list):** `bookingLifecycleEmailService`, `emailService`, `EmailEvent`, `giftVoucherEmailService`, payment, Stripe, voucher, creator, referral, attribution, iCal.

**Hook surfaces (exhaustive, per Batch 1 audit).** The orchestrator is invoked from exactly these places, additively, after the existing legacy work (including legacy lifecycle email) has completed:

1. `server/routes/bookingRoutes.js` — the **post-save booking-create** async block (the existing IIFE that fires `sendBookingLifecycleEmail` and `sendInternalNewBookingNotification`). Orchestrator runs after legacy email, never replacing it.
2. `server/services/ops/domain/reservationWriteService.js` → `transitionReservation` — for `pending → confirmed`, `* → cancelled`, and any other status edge that the rule cares about.
3. `server/services/ops/domain/reservationWriteService.js` → `editReservationDates` — when `checkIn` / `checkOut` change, **cancel** stale future jobs computed off the old dates and **reschedule** from the new check-in. Today this path triggers no comms; that is the change.
4. `server/services/ops/domain/reservationWriteService.js` → `reassignReservation` — when `cabinId` changes, re-evaluate whether the resolved `propertyKind` or the stay target has changed; **cancel + reschedule** if it has, otherwise leave existing jobs in place.
5. `server/services/ops/domain/reservationWriteService.js` → `createManualReservation` — manual-create with `initialStatus === 'confirmed'` schedules; `pending` manual-create does not.
6. `server/controllers/adminController.js` → the `PATCH /api/admin/bookings/:id/status` path — legacy admin status edits go through the same orchestrator call as the OPS path, so coverage is identical.

**What Cursor must audit first.**
- Re-confirm each of the six hook surfaces above is still present in code and that the legacy lifecycle email call inside each one is unchanged.
- Confirm transactions are used (so the orchestrator hook is **outside** any booking transaction, never inside it — see spec §17).
- Confirm the existing fire-and-forget pattern in `bookingRoutes.js` (the async IIFE) and replicate the same isolation in the OPS/admin hooks.

**Implementation scope.**
- Implement the orchestrator: rule resolution, `payloadSnapshot` build, `ScheduledMessageJob` upsert (idempotent on the unique key `(bookingId, ruleKey, scheduledFor)` from Batch 3), property guard (refuses if `propertyKind` mismatch), status guard, payment guard.
- Wire the orchestrator into each of the six hook surfaces.

**Behavioural rules (locked).**
- **Date edits** must cancel every stale future job for the booking and reschedule from the new `checkIn`. A date edit that leaves `scheduledFor` unchanged is a no-op (the existing job is kept). A date edit that moves `scheduledFor` into the past is a no-op (the past job already happened or already passed). A defence-in-depth staleness check at claim time (§33 of the spec) catches any edit that slipped past the hook.
- **Reassignment** must cancel and reschedule **only if** `propertyKind` (resolved from the new `cabinId` / `cabinTypeId`) or the stay target the rule depends on actually changed; otherwise existing jobs are kept. A `propertyKind` flip on reassignment is also treated as a `comms_property_mismatch_blocked` candidate at claim time if the old job is somehow still in flight.
- **Orchestrator failures must never block** the booking / status / date / reassignment / manual-create / admin-status write. All orchestrator calls are wrapped in try/catch, log on failure, and escalate to `ManualReviewItem` of category `comms_orchestrator_hook_failed`. The underlying domain write completes regardless.
- **Legacy lifecycle emails remain unchanged.** `bookingLifecycleEmailService.sendBookingLifecycleEmail` and `sendInternalNewBookingNotification` continue to fire from each of the six hook surfaces exactly as they do today; the orchestrator is an **additional** call, not a replacement.

**Explicit out of scope.**
- Any provider send (still shadow).
- Any change to legacy email lifecycle sends.
- Any OPS UI (Batch 10).

**Tests / checks.**
- Creating a confirmed booking produces exactly one `ScheduledMessageJob` for the arrival rule, with the right `scheduledFor`.
- Creating a duplicate scheduling attempt (same booking, same rule) is a no-op (idempotency on the unique key from Batch 3).
- Cancelling a booking cancels all of its future scheduled jobs.
- Editing `checkIn` reschedules the arrival job to the new time.
- A booking whose property does not resolve `propertyKind` produces a `ManualReviewItem`, not a job.
- Orchestrator failure does **not** affect the booking save (test by forcing the orchestrator to throw — booking still saves).
- Existing booking lifecycle emails (`booking_received`, `booking_confirmed`, etc.) still fire exactly as before.

**Rollback strategy.**
- Feature flag `MESSAGE_ORCHESTRATOR_ENABLED=false` (default). On rollback, no `ScheduledMessageJob` rows are created from booking events; existing legacy email flow is unaffected; existing jobs (if any) stay inert because Batch 6 is shadow-only.

**ChatGPT review requirement.** **Full high-risk review.** This is the first batch that touches the booking flow. ChatGPT must read the proposal carefully, look for hidden side-effects, and confirm the "orchestrator failure never affects booking save" property.

---

### Batch 8 — `MessageDispatcher` and provider abstraction

**Goal.** Build the dispatcher interface (per `02_V1_SPEC.md` §19) and the channel-adapter abstraction (per §20 and §21). Include a **fake / dev provider** that satisfies the interface for tests. Wire the dispatcher into the scheduler worker. **No real WhatsApp send** unless D-2 is confirmed (in which case the real WA adapter is still gated to Batch 11). **No real email send** unless Batch 9 has shipped.

**Risk.** Medium. The interface and the fake adapter alone are low risk; the wiring into the worker is medium because a misrouted call could in principle reach a real provider. Defended by a hard runtime check that real adapters require explicit env config plus rule `mode !== 'shadow'`.

**Dependencies.** Batches 3, 6.

**Files likely touched.**
- Added: `server/services/messaging/messageDispatcher.js`.
- Added: `server/services/messaging/providers/whatsappProviderInterface.js`, `server/services/messaging/providers/emailProviderInterface.js`, `server/services/messaging/providers/devShadowProvider.js`.
- Modified: `schedulerWorker.js` to call the dispatcher instead of writing a shadow row directly (the dispatcher now owns shadow-vs-real branching, per §35.1 of the spec).
- Tests added.
- Not touched: legacy email pipeline.

**What Cursor must audit first.**
- The shadow logic added in Batch 6 (this batch absorbs it).
- The `MessageDispatch` model written in Batch 3 (the dispatcher writes these rows).

**Implementation scope.**
- Implement the dispatcher: load rule + template, render variables, apply suppression and phone-validity guards (per §35.2 safety gates), call the chosen provider adapter, write a `MessageDispatch` row, surface failures to `ManualReviewItem`.
- Implement the dev/shadow provider that simply records the rendered content.
- Implement adapter interface for WhatsApp and email (concrete implementations come in Batch 9 and Batch 11).
- The dispatcher refuses to use a real adapter unless: (a) the rule mode is `auto`, (b) the env says the provider is enabled, (c) the provider was registered with the dispatcher at startup.
- Per-rule daily cap and per-booking dedup guard are implemented here.

**Explicit out of scope.**
- Real provider implementations (Batches 9 and 11).
- OPS UI (Batch 10).
- Auto-mode rollout (Batch 14).

**Tests / checks.**
- Dispatcher rejects a job whose rule's `propertyScope` does not match the booking's `propertyKind`.
- Dispatcher writes one `MessageDispatch` row per claim, with the right shape.
- Per-booking dedup guard: dispatching the same `(bookingId, ruleKey, scheduledFor, channel)` twice produces one dispatch.
- Dev shadow provider records content but never calls anything external.
- Real adapter refused unless explicitly enabled.

**Rollback strategy.**
- Feature flag pins the dispatcher to the dev/shadow provider only. Even with real adapters wired in by later batches, this flag overrides and forces shadow.

**ChatGPT review requirement.** Proposal review.

---

### Batch 9 — Email fallback adapter

**Goal.** Implement the concrete `EmailProvider` adapter (per `02_V1_SPEC.md` §21) that wraps the existing `emailService.sendEmail` via its **verified public method**, and integrate the fallback strategy `whatsapp_first_email_fallback`. Email fallback fires only when WhatsApp is unavailable for that recipient.

**Risk.** **High.** This is the first time the new system actually sends a real email. The risk is double-send (legacy lifecycle email + new email both reaching the guest) or wrong-template sends. The mitigation is the new DB-backed idempotency layer (per §21 of the spec) plus rule-level enable.

**Dependencies.** Batches 3, 4, 5, 6, 7, 8.

**Files likely touched.**
- Added: `server/services/messaging/providers/emailProviderAdapter.js`.
- Modified: dispatcher wiring to register the email adapter.
- Tests added.
- **Not modified:** `emailService.js`, `bookingLifecycleEmailService.js`, `EmailEvent.js`, `guestLifecycleLayout.js`. All of these are read / called, never edited.

**What Cursor must audit first.**
- Confirm (again, against current code) that `emailService.sendEmail` is the only public entry point used.
- Confirm `skipIdempotencyWindow` is still the name of the verified parameter on `emailService.sendEmail` (validated against `server/services/emailService.js` at audit time, not assumed).
- Confirm `guestLifecycleLayout.js` exports are unchanged from the spec's reference.
- **Tag/metadata capability audit (gating).** Verify whether `emailService.sendEmail` actually supports per-call **custom Postmark tag and metadata** values (the desired V1 namespace is `tag = dispatch:<dispatchId>` plus `Metadata.dispatchId`, per spec §15 and §21). If it does **not**, Cursor must **stop and propose the smallest safe design** in the pre-batch report before writing any code. Acceptable designs include: (a) extending `emailService` with an additive, opt-in `tag` / `metadata` parameter (still legacy-safe — existing callers unaffected), or (b) abandoning webhook-driven `MessageDeliveryEvent` for email in V1 and recording evidence at the dispatcher boundary only. The choice is reviewed by ChatGPT, not assumed here. Until this audit lands, no assumption is made that `emailWebhookRoutes.js` can route `dispatch:*` events — without dispatch-scoped tag/metadata on the outbound, the webhook has nothing to fork on.

**Implementation scope.**
- Implement the email adapter: render the email template's `emailSubject` + `emailBodyMarkup` against variables, place inside the legacy branded shell, call `emailService.sendEmail(...)` with the verified parameters.
- Idempotency: rely on the new `MessageDispatch` / `ScheduledMessageJob` DB layer. The legacy in-memory `skipIdempotencyWindow` flag is passed through as a defensive bypass only (per §21), and the new layer must hold even if the flag is removed.
- **Postmark tag + metadata namespace (conditional).** If the tag/metadata audit above confirms `emailService.sendEmail` supports per-call overrides, the adapter stamps each send with `tag = dispatch:<dispatchId>` and `Metadata.dispatchId` (plus `bookingId`, `ruleKey`, `templateKey`, `templateVersion`, `channel: 'email'`) per spec §21. If the audit says the capability is not there, the adapter ships without the `dispatch:*` namespace and the system relies on dispatcher-boundary evidence only — the design chosen in the pre-batch report decides which path ships.
- **Email webhook handling.** V1's default does **not** modify `server/routes/emailWebhookRoutes.js`. A later phase may extend it additively to fork on tag prefix (`booking:*` → `EmailEvent` legacy, `dispatch:*` → `MessageDeliveryEvent` new) only if the tag/metadata audit above succeeds. `EmailEvent` is never overloaded with new-system events.
- The adapter is **not** used by any legacy code. Legacy email lifecycle continues to use its existing calls into `emailService.sendEmail` exactly as before.

**Explicit out of scope.**
- Any change to legacy email lifecycle (`bookingLifecycleEmailService`, `giftVoucherEmailService`, `communicationWriteService`).
- Any change to `EmailEvent` (continues to be written by the legacy paths only; the new system writes `MessageDispatch` and `MessageDeliveryEvent`).
- Any WhatsApp work.

**Tests / checks.**
- The adapter renders the email template correctly with the spec's variable schema.
- A second dispatch attempt for the same `(bookingId, ruleKey, scheduledFor, channel='email')` is refused at the DB layer.
- The legacy `booking_received` / `booking_confirmed` emails continue to fire on test bookings exactly as before, with no change in count or shape.
- Calling the adapter does not write to `EmailEvent`; it writes to `MessageDispatch`.
- A failed `emailService.sendEmail` (simulated) escalates to `ManualReviewItem` and does not retry-stack.

**Rollback strategy.**
- Feature flag the email adapter off (dispatcher falls back to the dev/shadow provider for email). On rollback, no new email goes out.

**ChatGPT review requirement.** **Full high-risk review.** ChatGPT must verify the "no double-send with legacy lifecycle" guarantee on paper before code is written.

---

### Batch 10 — OPS UI foundation

**Goal.** Build the OPS UI surfaces per `02_V1_SPEC.md` §26: upcoming messages per booking, message history per booking, failed/skipped/suppressed list, pause-this-booking, cancel a scheduled job, disable a rule per property. Read-only screens land first; write actions (pause, cancel, disable) land second within this batch.

**Risk.** Read-only screens: **Low.** Write actions (pause / cancel / disable): **Medium**.

**Dependencies.** Batches 3, 4, 5, 6, 7, 8 (so the data exists to display and the dispatcher honours the guards being set from the UI).

**Files likely touched.**
- Modified: `client/src/pages/ops/OpsReservationDetail.jsx` (add Communication panel sections per §26.1).
- Modified: `client/src/pages/ops/OpsCommunicationOversight.jsx` (per §26.2) — additive only.
- Added: new OPS screens listed in §26.3 (`OpsScheduledMessages`, `OpsRules`, `OpsTemplates`, `OpsManualReviewBacklog` filter additions). Cursor proposes exact paths.
- Modified: a small set of server routes under `server/routes/ops/` to expose read endpoints and the three write endpoints (pause-booking, cancel-job, disable-rule-per-property). Cursor identifies exact paths in Batch 1 audit.
- Tests added (UI + server route).
- **Not touched:** admin (legacy) pages, booking core routes, payment, voucher, iCal.

**What Cursor must audit first.**
- Current `OpsReservationDetail.jsx` structure.
- Current OPS auth middleware (per §26.4).
- Whether OPS already has a generic "filter and paginate" pattern to reuse.

**Implementation scope.**
- Read-only first: upcoming messages, history, failures list, template view.
- Write actions next, gated by role: pause-this-booking, cancel-job, disable-rule-per-property.
- Template authoring (`OpsTemplates`) is read-only in this batch; full edit + new-version flow is a later sub-batch if scope grows (Cursor proposes the split in the pre-batch report).

**Explicit out of scope.**
- Any change to admin (legacy).
- Any send action from the UI (the manual one-off send is also a later sub-batch decision — Cursor proposes whether it fits in Batch 10 or splits to 10b).

**Tests / checks.**
- Read screens render against seed data without errors.
- Pause-this-booking sets the booking's "messaging paused" marker (mechanism per spec) and the dispatcher honours it next tick.
- Cancel-job flips the job to `cancelled`, and the worker no longer claims it.
- Disable-rule-per-property prevents new jobs from being created for that property; pre-existing jobs are unaffected (cancellation is a separate action).

**Rollback strategy.**
- UI rollback = remove the new components. Server-route rollback = unmount the new endpoints. No data damage since the new collections were already in place.

**ChatGPT review requirement.** Proposal review (write actions warrant a closer pass than read-only screens).

---

### Batch 11 — WhatsApp provider integration

**Goal.** Implement the concrete WhatsApp provider adapter for the provider chosen in D-2 (Meta / Twilio / 360dialog), register it with the dispatcher, submit the approved Meta templates, and wire the provider's signed webhook into a normalised `MessageDeliveryEvent` row (per `02_V1_SPEC.md` §20 and §22).

**Risk.** **High.** This is the first batch that can put a real outbound WhatsApp message in flight. Defended by: rule still in shadow mode (until Batch 13), real send is impossible until both adapter is enabled and rule mode is `auto`.

**Dependencies.** Batches 3, 5, 6, 7, 8. D-1, D-2, D-3 confirmed.

**Files likely touched.**
- Added: `server/services/messaging/providers/whatsappProviderAdapter.js` (single adapter for the chosen provider).
- Added: `server/routes/messaging/whatsappWebhookRoutes.js` (signed webhook, normalised into `MessageDeliveryEvent`).
- Modified: dispatcher wiring to register the WA adapter.
- Modified: env handling (new env vars per provider).
- Modified: `server.js` to mount the webhook route.
- Tests added.
- Not touched: any legacy email pipeline.

**What Cursor must audit first.**
- Existing webhook conventions in the codebase (`emailWebhookRoutes.js`, `stripeWebhookRoutes.js`) so the new WA webhook follows the same patterns (signature verification, raw-body parsing, rate-limiting).
- The provider's signed-webhook headers (provider-specific).
- The exact env-var naming convention used elsewhere.

**Implementation scope.**
- Implement the adapter: `sendTemplate({recipient, templateName, locale, variables, mediaHeader?})`. Returns `{providerMessageId, providerStatus}`. Maps errors into the adapter-agnostic error shape per §20.
- Submit `arrival_3d_the_cabin` and `arrival_3d_the_valley` for Meta approval (or provider-equivalent). Update the seeded `MessageTemplate.metaTemplateName` rows with the approved names once approval lands.
- Wire the signed webhook, verify the signature, normalise into `MessageDeliveryEvent`. The webhook **never** writes to `EmailEvent`.
- Handle inbound messages minimally (per §22 of the spec): match phone to a `GuestContactPreference`, check for STOP-style keywords, update suppression, persist a minimal record. No auto-reply.

**Explicit out of scope.**
- Enabling the rule in `auto` mode (Batch 14).
- Two-way conversation UI.
- Anything beyond the V1 rule.

**Tests / checks.**
- Adapter tested against the provider's sandbox / test environment with the approved templates.
- Webhook signature verification: invalid signature → 4xx.
- Webhook event normalisation: provider-specific payloads produce identical `MessageDeliveryEvent` shape.
- A simulated send in shadow mode still results in **no** call to the provider.
- A real send (manually invoked in a dev environment, not via the rule) reaches the provider sandbox and shows up as a normalised delivery event.

**Rollback strategy.**
- Feature flag `WHATSAPP_PROVIDER_ENABLED=false` (default). On rollback, the WA adapter is unregistered from the dispatcher and the rule's WA leg becomes "skip → fallback to email" (per the channel strategy).

**ChatGPT review requirement.** **Full high-risk review.** This is the integration point where provider-specific behaviour meets the codebase. Misbehaviour here is guest-visible.

---

### Batch 12 — Internal OPS alerts

**Goal.** Implement the optional internal OPS alert rules (`OPS-INT-8D`, `OPS-INT-CIT`, `OPS-INT-COT`) per `02_V1_SPEC.md` §23.B and §27. Email-only in V1 unless D-5 explicitly approves an OPS WhatsApp channel. Must **not** block guest-facing dispatch if internal alerts misbehave.

**Risk.** Medium. Internal-only audience reduces blast radius, but the rules still touch the orchestrator.

**Dependencies.** Batches 5, 7, 8, 9.

**Files likely touched.**
- Modified: rule seeds to enable the internal rules behind their own feature flag.
- Modified: orchestrator if internal rules need scheduling logic distinct from guest rules.
- Modified: the email adapter if internal alerts use a different `from` / template path (no change to `emailService` itself).
- Tests added.
- Not touched: legacy email lifecycle.

**What Cursor must audit first.**
- Whether internal alerts can reuse the same `MessageAutomationRule` / `MessageTemplate` shape as guest rules with `audience='ops'` (per §12 of the spec).
- The OPS notification list (per D-5).

**Implementation scope.**
- Enable internal alert rules behind their own feature flag (`OPS_INTERNAL_ALERTS_ENABLED`).
- Internal-alert failures escalate to `ManualReviewItem` of a distinct category, and **never** affect a guest-facing dispatch in flight.

**Explicit out of scope.**
- OPS WhatsApp channel beyond email, unless D-5 says so.
- Any change to legacy email pipeline.

**Tests / checks.**
- Internal alert rules fire at the right time relative to a booking's lifecycle.
- A simulated failure of an internal alert does not affect any guest-facing job in the same tick.
- The feature flag fully disables internal alerts when off.

**Rollback strategy.**
- Feature flag off.

**ChatGPT review requirement.** Proposal review.

---

### Batch 13 — Shadow-mode production verification

**Goal.** Deploy everything (worker on, orchestrator on, dispatcher on, providers registered) with the V1 rule in **shadow mode**. No real guest sends happen. Run for one full production cycle that includes at least one confirmed booking with check-in within the next 5 days. Verify per `02_V1_SPEC.md` §35.1.

**Risk.** Medium. No real sends, but the deploy itself is the first production exposure of the new code. A bug in the worker's tick loop, or in the orchestrator's lifecycle hook, could affect server stability.

**Dependencies.** Batches 0..12.

**Files likely touched.**
- Modified: env / config to enable worker, orchestrator, dispatcher, providers in production — with the V1 rule's `mode='shadow'`.
- Added: a short observability checklist doc.
- Not modified: any application code (this batch is a deploy + verification batch).

**What Cursor must audit first.**
- The full env / config matrix needed in production for shadow mode.
- The observability surfaces (logs, dashboards, ops screen) needed to validate.

**Implementation scope.**
- Deploy with all rules in `mode='shadow'`, all feature flags on except `WHATSAPP_PROVIDER_ENABLED` (kept on so webhook can be received; outbound is gated by rule mode).
- For one full cycle, observe: jobs scheduled at the right time, variables resolved correctly, property matched correctly, suppression and status guards behaving, no errors, no PM2 restart issues.
- Verify cancellation and date-change behaviour with at least one real test booking (made by an internal user).
- Produce a written verification report.

**Explicit out of scope.**
- Any real guest send.
- Any code change.

**Tests / checks.**
- Shadow dispatch rows exist for every booking that should have triggered the rule.
- Every shadow dispatch's `payloadSnapshot` is reviewed for correctness.
- OPS visibility for upcoming / history / failures works on real data.
- A simulated PM2 restart does not create duplicate shadow rows or lose jobs.

**Rollback strategy.**
- Disable the worker and orchestrator via env flags. Shadow rows are inert and can stay or be cleaned up.

**ChatGPT review requirement.** Proposal review of the verification plan; ChatGPT signs off on the verification report before Batch 14.

---

### Batch 14 — Auto mode with safety gates

**Goal.** Flip the V1 rule from `shadow` to `auto` (per `02_V1_SPEC.md` §35.2). All nine safety gates active (including the `BOOKING_CONFIRM_WITHOUT_STRIPE` block per D-12). Per-rule daily cap starts conservative (e.g. 10/day) and is raised as confidence grows. **This is the moment real guest messages start going out.**

**Risk.** **High.** Real guest-visible side effects. Real provider charges (where applicable). Real reputational exposure on duplicate or wrong-property sends.

**Dependencies.** Batch 13 verification report signed off. All §38 stop-go items in the spec answered yes.

**Files likely touched.**
- Modified: the seeded rule's `mode` field from `'shadow'` to `'auto'` (via OPS UI or a config change, not a code edit if possible).
- Modified: env / config to set the per-rule daily cap.
- Added: a final launch checklist (see §14 of this doc).
- Not modified: any application code (Batch 14 is a configuration flip, not a code change).

**What Cursor must audit first.**
- The Batch 13 verification report (must be signed off).
- The §38 stop-go checklist from the V1 spec (every item must be confirmed yes).
- The state of all safety gates (every gate from §35.2 must be wired and tested).

**Implementation scope.**
- Flip `mode='auto'` on the arrival rule.
- Set the per-rule daily cap to a conservative starting value.
- Activate kill-switch readiness: the OPS-visible toggle that flips `mode` back to `manual_approve` (emergency override) and the env-level kill switch that flips `enabled=false` on the rule are both verified to work in the production environment before the flip.
- Monitor failures, retries, suppressions, and provider acknowledgments for the first cycle. Specifically watch: (a) no duplicate sends across a PM2 restart, (b) no wrong-property send, (c) every send has a corresponding `MessageDispatch` and at least one `MessageDeliveryEvent` (or a logged provider error).
- After one cycle of clean operation, raise the cap.

**Explicit out of scope.**
- Any new rule (only the arrival rule goes auto in V1).
- Any new code.

**Tests / checks.**
- Pre-flip: every safety gate triggered at least once in shadow / dev tests.
- Post-flip: first cycle observed end-to-end. One PM2 restart performed deliberately in a quiet window to verify restart safety on a real (test) booking.
- Both kill switches (rule `mode → manual_approve`, rule `enabled → false`) tested in production before any guest send occurs.

**Rollback strategy.**
- Primary: flip rule `mode` back to `shadow` (no further sends).
- Secondary: flip rule `enabled` to `false`.
- Tertiary: env kill switch disables the worker entirely.
- All three rehearsed before the flip, all three documented in the launch checklist.

**ChatGPT review requirement.** **Full high-risk review.** ChatGPT signs off on the launch checklist and the kill-switch rehearsal evidence before the flip.

---

## 8. Files likely touched per batch

This is a consolidated index of files this programme is likely to touch, by batch. **Files not on this list are presumed not touched.** Anything not on this list that needs to be modified during a batch is a hard-stop trigger (per §3.4).

| Path | Batches |
|---|---|
| `docs/guest-message-automation/decisions/*` | 0 |
| `docs/guest-message-automation/audits/*` | 1, 13 |
| `server/models/Cabin.js` | 2 (additive) |
| `server/models/CabinType.js` | 2 (additive) |
| `server/models/MessageTemplate.js` | 3 (new) |
| `server/models/MessageAutomationRule.js` | 3 (new) |
| `server/models/ScheduledMessageJob.js` | 3 (new) |
| `server/models/MessageDispatch.js` | 3 (new) |
| `server/models/MessageDeliveryEvent.js` | 3 (new) |
| `server/models/GuestContactPreference.js` | 3 (new) |
| `server/services/messaging/phoneNormalisationService.js` | 4 (new) |
| `server/services/messaging/propertyKindResolver.js` | 2 (new) |
| `server/scripts/*propertyKind*backfill*` (internal-only; path TBD in audit) | 2 (new) |
| `server/services/messaging/schedulerWorker.js` | 6 (new) |
| `server/services/messaging/messageOrchestrator.js` | 7 (new) |
| `server/services/messaging/messageDispatcher.js` | 8 (new) |
| `server/services/messaging/providers/*` | 8, 9, 11 (new) |
| `server/scripts/seedMessageAutomation.js` | 5 (new) |
| `server/data/messageTemplates/*` | 5 (new) |
| `server/routes/messaging/whatsappWebhookRoutes.js` | 11 (new) |
| `server/routes/ops/*` (additive ops endpoints) | 10 |
| `server/routes/bookingRoutes.js` | 4 (post-save hook), 7 (lifecycle hook) — additive only |
| `server/server.js` | 6 (worker startup), 11 (webhook mount) — additive only |
| `client/src/pages/ops/OpsReservationDetail.jsx` | 10 (Communication panel additions) |
| `client/src/pages/ops/OpsCommunicationOversight.jsx` | 10 (additive) |
| `client/src/pages/ops/OpsScheduledMessages.*` | 10 (new) |
| `client/src/pages/ops/OpsRules.*` | 10 (new) |
| `client/src/pages/ops/OpsTemplates.*` | 10 (new) |

Explicitly **not touched** in any V1 batch:

- `server/services/emailService.js`
- `server/services/bookingLifecycleEmailService.js`
- `server/services/giftVouchers/giftVoucherEmailService.js`
- `server/services/ops/domain/communicationWriteService.js` (the arrival-instructions OPS flow stays on its existing path)
- `server/models/EmailEvent.js`
- `server/routes/emailWebhookRoutes.js`
- `server/routes/stripeWebhookRoutes.js`
- `server/services/ops/ingestion/icalSyncScheduler.js`
- Anything under `server/services/stripe*`, `server/services/voucher*`, `server/services/creator*`, `server/services/referral*`, `server/services/attribution*`.
- `server/models/Booking.js` (V1 explicitly does not mutate this schema — see §8.1 of the spec).
- Admin (legacy) pages under `client/src/pages/admin/`.

---

## 9. Tests required per batch

The principle: every batch ships with the tests that prove its own scope, and a regression check that the legacy systems it must not affect still behave as before.

| Batch | Test surface |
|---|---|
| 0 | N/A (docs only). |
| 1 | N/A (audit only). |
| 2 | Model unit tests, resolver unit tests, no-regression on existing `Cabin` / `CabinType` reads. |
| 3 | Model unit tests, unique-index enforcement (insertion collision tests), no-regression on existing models. |
| 4 | Normalisation unit tests (valid local, valid international, invalid junk), booking-save-not-blocked test, OPS contact edit recompute test. |
| 5 | Seed idempotency test, template variable schema conformance. |
| 6 | Concurrent-claim test, visibility-timeout reclaim test, restart-safety test, worker-off-by-default test. |
| 7 | Orchestrator creates / cancels / reschedules jobs correctly, orchestrator failure does not block booking save, **regression: legacy booking lifecycle emails still fire exactly as before**, property mismatch → ManualReviewItem instead of dispatch. |
| 8 | Dispatcher safety-gate tests, per-booking dedup, real-adapter-refused-unless-enabled. |
| 9 | Adapter renders correctly, DB-layer idempotency holds against duplicate dispatch attempts, **regression: legacy `booking_received` / `booking_confirmed` / `booking_cancelled` emails still fire exactly as before with no count change**, failure → ManualReviewItem. |
| 10 | UI rendering tests, pause / cancel / disable server-route tests, role-based access tests. |
| 11 | Provider sandbox round-trip, webhook signature verification, webhook event normalisation, inbound STOP-keyword handling, regression: dispatcher in shadow does **not** call provider. |
| 12 | Internal alert scheduling + dispatch, internal alert failure does not affect guest dispatch in the same tick. |
| 13 | Shadow verification scenarios (see §13.4–§13.5 above), PM2 restart drill, OPS visibility on real data. |
| 14 | Pre-flip verification of all nine safety gates (including `BOOKING_CONFIRM_WITHOUT_STRIPE` block per D-12); post-flip first-cycle observation with deliberate PM2 restart on a quiet test booking. |

Cross-cutting regression suite (must pass on every batch from Batch 2 onward):

- Existing booking lifecycle emails fire unchanged (one each on `received`, `confirmed`, `cancelled`).
- Gift voucher emails fire unchanged.
- Payment and Stripe flows unchanged.
- iCal sync unchanged.
- OPS legacy screens render unchanged.

---

## 10. Deployment notes

- **Per-batch deploys.** Every batch that ships is one deploy. No batch piggybacks on another batch's deploy.
- **Order in production.** The batch order in §7 is the deploy order. Deviating requires a written justification because the dependencies are real (e.g. Batch 6 cannot run before Batch 3's collections exist).
- **Feature flags as defaults.** Every new code path lands behind a feature flag that defaults to OFF. The flag flips only after the post-batch report is signed off.
- **Index creation.** Index builds on `ScheduledMessageJob` and `MessageDispatch` are foreground-creatable today (the collections are empty when introduced). After data lands, index changes must be background-built. This is a Batch 3 concern.
- **Env var rollout.** New env vars are added to production first (with safe defaults), then code referencing them ships. This prevents a deploy from booting in a half-configured state.
- **Webhook endpoint rollout (Batch 11).** Webhook mount must precede provider configuration that points at it. If the provider is configured to call a non-existent endpoint, retries pile up.
- **No mid-cycle deploys.** Once Batch 13 is running shadow-mode verification, no unrelated deploys should land until either Batch 13 is signed off or rolled back, to keep the cycle's evidence clean.
- **Production-like staging.** Batches 6, 7, 9, 11, 13, 14 are rehearsed on a staging environment with a real-shaped (anonymised) data subset before they touch production.
- **Time-zone discipline.** All scheduled times are stored UTC, converted to Sofia time at the boundary (per §37.5 of the spec). The first dev cycle must include a `scheduledFor` that spans a Sofia DST boundary to catch tz bugs early.

---

## 11. Rollback notes

Rollback strategy in priority order:

1. **Configuration rollback** (preferred for all batches). The new behaviour disables via a rule flag, a feature flag, a `mode='shadow'` flip, or `enabled=false`. No code revert.
2. **Single-batch revert** (next preferred). Revert exactly the batch's PR. The previous batch's post-batch report is the known-good baseline.
3. **Data cleanup** (rarely needed). Because new collections are not load-bearing until Batch 13, truncating them is safe. The exception is `GuestContactPreference` once it accumulates suppression history — truncating that means losing suppression state. From Batch 9 onward, treat `GuestContactPreference` as durable.

Per-batch rollback specifics are listed inside each batch entry in §7. Common across all of them:

- Legacy email lifecycle and gift voucher pipelines are untouched in every batch, so rolling back the new system cannot regress them.
- Booking core, payment, Stripe, voucher, creator, referral, attribution, and iCal are untouched in every batch.
- Existing OPS screens continue to work; new screens are additive and can be removed independently.

The kill switches that are explicitly required:

- `MESSAGE_SCHEDULER_WORKER_ENABLED` (env).
- `MESSAGE_ORCHESTRATOR_ENABLED` (env).
- Each provider's enable flag (`WHATSAPP_PROVIDER_ENABLED`, `EMAIL_PROVIDER_ENABLED`).
- Per-rule `enabled` (DB / OPS UI).
- Per-rule `mode` (`auto` / `shadow` / `manual_approve`) (DB / OPS UI).
- Per-property-per-rule pause (DB / OPS UI).
- Per-booking pause (DB / OPS UI).

All seven kill switches are operational from Batch 10 onward and rehearsed before Batch 14.

---

## 12. What must be reviewed by ChatGPT before implementation

Hard list — these batches **cannot start coding** without a written go from ChatGPT:

- **Batch 7 — `MessageOrchestrator` hooks.** Reason: first batch that touches the booking lifecycle. Side-effect risk on the booking save is the central concern.
- **Batch 9 — Email fallback adapter.** Reason: first batch that can produce a real outbound email from the new system. The "no double-send with legacy" guarantee must be reviewed on paper.
- **Batch 11 — WhatsApp provider integration.** Reason: first batch that can put a real WhatsApp message in flight. Provider-specific behaviour and webhook signature handling are the focus.
- **Batch 14 — Auto mode with safety gates.** Reason: the moment real guest sends start. The launch checklist (§14) and kill-switch rehearsal are the focus.

Additionally, ChatGPT must review **any batch's pre-batch report** whose audit reveals one or more of:

- The V1 spec is wrong about a real-code shape (forces a spec patch first).
- A file outside the declared "files likely touched" list needs editing.
- A legacy hard-list file needs editing (this should never happen; if it does, the batch is wrong-shaped).
- A duplicate-send or wrong-property risk surfaces.

---

## 13. What can be implemented after a lighter review

The batches below ship after Cursor's pre-batch report plus a short ChatGPT acknowledgement / proposal review. No full high-risk review needed.

- **Batch 0 — Business decisions.** Light ack.
- **Batch 1 — Source audit.** Proposal review (the audit content itself is the review).
- **Batch 2 — `propertyKind` foundation.** Proposal review.
- **Batch 3 — Data models.** Proposal review (index correctness is the review focus).
- **Batch 4 — Phone normalisation.** Proposal review.
- **Batch 5 — Seed layer.** Proposal review (template copy correctness is the review focus).
- **Batch 6 — Scheduler worker (shadow only).** Proposal review (atomic claim correctness is the review focus).
- **Batch 8 — Dispatcher abstraction.** Proposal review.
- **Batch 10 — OPS UI foundation.** Proposal review for write actions; read-only screens ship after a short plan ack.
- **Batch 12 — Internal OPS alerts.** Proposal review.
- **Batch 13 — Shadow-mode verification.** Proposal review of the verification plan; ChatGPT signs off on the report before Batch 14.

The lighter review still requires:

- A pre-batch report (§4).
- A post-batch report (§5).
- All listed tests passing.
- The rollback path tested mentally and, where it touches data or workers, in a dev environment.

---

## 14. Final launch checklist

Sign-off requirements before Batch 14's flip from `shadow` to `auto`:

### 14.1 Spec & decisions

- [ ] `01_VISION_AND_BOUNDARIES.md` and `02_V1_SPEC.md` are the latest signed-off versions.
- [ ] Every decision D-1..D-13 in §4 of the spec is closed (answered or explicitly deferred with rationale).
- [ ] The sender number discrepancy (`+359 87 634 2540` vs `+359 88 123 4567`) is resolved and a single official WABA sender is in place.
- [ ] V1 templates `arrival_3d_the_cabin` and `arrival_3d_the_valley` (WhatsApp + email, `en`, T-72h scheduling) are Meta-approved (where applicable) and seeded.

### 14.2 Data foundation

- [ ] `propertyKind` is populated on every active `Cabin` and `CabinType` row.
- [ ] The resolver throws on any row without `propertyKind`, confirmed by a dry-run query.
- [ ] All six new collections exist, with the required indexes built.
- [ ] `GuestContactPreference` is being populated on booking create and OPS contact edit.

### 14.3 Worker, orchestrator, dispatcher

- [ ] Scheduler worker passes the concurrent-claim, visibility-timeout, and restart-safety tests in staging.
- [ ] Orchestrator does not block the booking save under simulated failure.
- [ ] Dispatcher honours the nine safety gates (§35.2 of the spec, including the `BOOKING_CONFIRM_WITHOUT_STRIPE` block per D-12), each exercised at least once in shadow / dev tests.
- [ ] Per-rule daily cap configured to a conservative starting value.
- [ ] Per-booking dedup guard exercised.

### 14.4 Providers

- [ ] WhatsApp adapter round-trip tested against the provider's sandbox.
- [ ] Email adapter exercised against staging; legacy email lifecycle confirmed unaffected (counts and shapes unchanged).
- [ ] Both webhooks (WA + Postmark) receiving correctly, signature verification active, normalised into the right tables (`MessageDeliveryEvent` for WA, **not** `EmailEvent`).

### 14.5 Shadow cycle

- [ ] Batch 13 verification report signed off.
- [ ] At least one full shadow cycle has run in production with at least one confirmed booking and a deliberate PM2 restart inside the cycle.
- [ ] No duplicate shadow dispatches across the restart.
- [ ] No wrong-property shadow dispatches across the cycle.
- [ ] Cancellation cascade-cancel observed on a test cancellation.
- [ ] Date-change reschedule observed on a test edit.

### 14.6 OPS controls

- [ ] OPS can see upcoming messages, history, and failures.
- [ ] OPS can pause a single booking, cancel a single scheduled job, disable a rule per property.
- [ ] OPS knows where to find the failures list and what to do with `ManualReviewItem` entries.
- [ ] OPS knows the emergency mode (`manual_approve`) toggle and has practised flipping it.

### 14.7 Kill switches rehearsed in production

- [ ] `MESSAGE_SCHEDULER_WORKER_ENABLED=false` rehearsed (worker stops cleanly, no in-flight job left in `claimed` indefinitely).
- [ ] `MESSAGE_ORCHESTRATOR_ENABLED=false` rehearsed (no new jobs created from booking events).
- [ ] Rule `mode='manual_approve'` flip rehearsed (jobs hold for OPS approval).
- [ ] Rule `enabled=false` flip rehearsed (no further sends).
- [ ] `WHATSAPP_PROVIDER_ENABLED=false` rehearsed (WA leg degrades to email fallback per channel strategy).

### 14.8 Documentation

- [ ] Each batch's post-batch report is filed and linked from this document's batch list.
- [ ] Any spec deviations across the build are listed and reconciled.
- [ ] OPS has a one-page operator runbook: how to pause a booking, cancel a job, switch to emergency mode, find a failed dispatch.

### 14.9 Final go

- [ ] ChatGPT high-risk review of Batch 14 signed off.
- [ ] Jose has confirmed the WABA sender, the templates, the timing, and the per-rule daily cap.
- [ ] The flip is scheduled in a quiet window with someone monitoring for the first cycle.

When every box is ticked, and only then, Batch 14 flips the V1 rule from `shadow` to `auto`. The first real guest WhatsApp goes out.
