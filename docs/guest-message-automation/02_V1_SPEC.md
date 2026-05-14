# Guest Message Automation — 02: V1 Specification

Status: design lock, V1 spec
Owner: Jose (product), engineering (implementation)
Depends on: `docs/guest-message-automation/01_VISION_AND_BOUNDARIES.md` (vision is binding; this doc must not contradict it)
Scope: V1 only. Subsequent docs (`03_BATCH_PLAN.md`) split this spec into shippable batches.

This document is the technical specification for the first implementation slice of the Drift & Dwells Guest Communication Automation system. It defines schemas, behaviour contracts, rule definitions, OPS surfaces, failure handling, idempotency, and rollout. It does **not** contain code. Implementation batches will translate sections of this spec into Cursor work, each gated by an audit and a plan-review cycle.

Hard scope reminder (from `01_VISION_AND_BOUNDARIES.md`):
- OPS is the only interface. Legacy admin is not extended for this feature.
- No string sniffing for property type. A persisted `propertyKind` field is required.
- WhatsApp and email are separate channels.
- No changes to booking, payment, Stripe, voucher, creator, referral, attribution, iCal, or legacy email lifecycle code.
- `EmailEvent` is not overloaded; WhatsApp gets its own delivery-event store.
- Provider-agnostic WhatsApp adapter from day one.

---

## 1. V1 purpose

V1 proves the architecture end-to-end by shipping **exactly one guest-facing automatic flow**, with full operational controls, observability, and reversibility:

- **Arrival / pre-arrival instructions** delivered automatically before check-in.
- WhatsApp first, email fallback.
- Property-specific templates for The Cabin and The Valley, never mixed.
- Editable templates and rule toggles in OPS.
- Persisted scheduled jobs, atomic claiming, zero duplicate sends across restarts.
- Optional simple internal OPS alerts.

If this slice runs cleanly for two production cycles without manual incident, the system is considered architecturally proven and additional rules can be added without further architectural work — only template + rule + OPS UI changes.

---

## 2. V1 scope

Included in V1:

- One guest-facing rule: `arrival_instructions_pre_arrival`, scheduled per booking, per property, **T-72h (3 days) before check-in** (Europe/Sofia) for **both** The Cabin and The Valley — per Batch 0 D-5 (see §4.1). Earlier wording in this doc that referenced T-24h or T-48h as the V1 default is superseded; T-24h and T-48h remain as historical/alternative offsets only.
- Two WhatsApp templates (Meta-approved): `arrival_3d_the_cabin_v1`, `arrival_3d_the_valley_v1`, English only.
- Two email fallback templates: equivalent content for The Cabin and The Valley, English only, rendered through the existing branded email shell (read-only consumption — we do not modify the legacy email pipeline).
- Persisted `propertyKind` on `Cabin` and `CabinType`, populated by a one-off OPS backfill.
- Phone normalisation to E.164 at booking create and on OPS contact edit.
- A new collection group: `MessageTemplate`, `MessageAutomationRule`, `ScheduledMessageJob`, `MessageDispatch`, `MessageDeliveryEvent`, `GuestContactPreference`.
- A `MessageOrchestrator` service responsible for resolving rules into jobs.
- A `SchedulerWorker` (in-process for V1, extractable later) that claims and dispatches due jobs.
- A `MessageDispatcher` with channel adapters (`WhatsAppProvider`, `EmailProvider`).
- A `WhatsAppProvider` interface with one adapter (provider TBD — see §4).
- Provider webhook endpoints (WhatsApp inbound + delivery events) normalised into `MessageDeliveryEvent`.
- OPS UI: per-booking message panel (upcoming + history), template editor, rule toggles, per-property disable, pause-for-this-booking, manual one-off send with preview, failures filter on `OpsManualReviewBacklog`.
- Optional simple internal OPS alerts (`OPS-INT-8D`, `OPS-INT-CIT`, `OPS-INT-COT`) gated behind their own feature flag; failing or unbuilt internal alerts must never block guest-facing dispatch.

Rollout progression for guest-facing rules is **`shadow → auto with safety gates`** (see §35). Manual approval is available as an **emergency/override mode**, not as a required rollout stage.

Out of V1 (kept here for clarity, full list in §3):

- Bulgarian locale.
- Any rule other than the one above.
- Marketing automation, review requests, post-stay thank-you, mid-stay nudges.
- Gift voucher WhatsApp delivery.
- Lead automation or abandoned-quote follow-up.
- Multi-instance horizontal scaling beyond single-leader scheduler.

---

## 3. Explicit V1 non-goals

- **Not** a generic messaging platform. Scope is direct-site bookings with a confirmed guest and a resolvable property.
- **Not** a CMS. Template editing is structured (subject + body + declared variables), not WYSIWYG.
- **Not** a CRM. No segments, no campaigns, no lifecycle outside booking arrival.
- **Not** a two-way inbox. Inbound WhatsApp events are stored as context only.
- **Not** a replacement for the legacy email lifecycle pipeline. Existing `booking_received`, `booking_confirmed`, `booking_cancelled`, internal-new-booking, legal-acceptance, and gift-voucher emails continue on their current paths, untouched.
- **Not** coupled to booking, payment, Stripe, voucher, creator, referral, attribution, or iCal logic. V1 consumes triggers from those domains; it never writes back.
- **Not** a queue infrastructure project. MongoDB-backed jobs are the queue. No Redis, no BullMQ, no Agenda, no Temporal in V1.
- **Not** a marketing-consent surface. Transactional only.
- **Not** a multi-provider runtime. V1 ships with one WhatsApp provider adapter; the abstraction exists for future swap, not parallel use.
- **Not** an analytics surface. Delivery events are persisted but no dashboards beyond OPS lists are built.

---

## 4. Required business decisions before build

These were the open decisions before Batch 0. All twelve are now **LOCKED** by Jose's Batch 0 decisions (recorded verbatim in §4.1). The table below remains as the engineering cross-reference; §4.1 is the authoritative log.

| ID | Decision | Status / locked answer (see §4.1) |
|---|---|---|
| D-1 | **Sender identity.** Dedicated WABA number vs Jose's private number. Resolves the two-number inconsistency (`+359 87 634 2540` vs `+359 88 123 4567` in `BookingSuccess.jsx`). | **LOCKED** — Use Jose's current Bulgarian private WhatsApp number for V1; move to a dedicated D&D business number later if needed. (Batch 0 D-1 + D-3.) |
| D-2 | **Provider choice.** Meta Cloud API direct vs Twilio vs 360dialog. | **LOCKED** — Meta Cloud API direct first. Twilio only if Meta setup becomes too painful. (Batch 0 D-2.) |
| D-3 | **Final template copy** for the V1 templates (WhatsApp + email variants, EN). | **OPEN — content task.** Locked: scope is arrival / pre-arrival instructions only (Batch 0 D-4). Final copy + variable schema confirmation deferred to Batch 5 / Batch 11. |
| D-4 | **Default send hour** in Europe/Sofia for the arrival schedule. | **OPEN — implementation-time sub-decision.** Locked: timing is **T-72h before check-in** for both properties (Batch 0 D-5). Sofia hour-of-day stays a Batch 5 seed-time choice (working default `17:00 Europe/Sofia` until confirmed). |
| D-5 | ~~Valley T-48h option.~~ | **SUPERSEDED** — Batch 0 D-5 locks T-72h for both properties. T-24h and T-48h are historical/alternative offsets only. Per-property timing remains supported by the rule schema but is not used in V1. |
| D-6 | **Internal OPS alerts.** Which of the three alerts to ship; recipient and channel. | **LOCKED** — All three on: `OPS-INT-8D` (guest arriving in 8 days), `OPS-INT-CIT` (check-in tomorrow), `OPS-INT-COT` (checkout today). Email-only. (Batch 0 D-6.) Recipient address remains the existing `EMAIL_TO_INTERNAL`. |
| D-7 | **Worker process model.** In-process vs separate PM2 worker. | **LOCKED** — Design for a separate PM2 worker. May start integrated only if moving later requires no code rewrite. (Batch 0 D-13.) |
| D-8 | **Property field naming and enum.** Confirm `propertyKind: 'cabin' \| 'valley'`. | **LOCKED** — `propertyKind` enum: `cabin \| valley`. (Batch 0 D-7.) |
| D-9 | **Default phone country** for ambiguous parsing. | **LOCKED** — `BG` by default; fully-qualified international numbers are accepted as-is when a country code is present. (Batch 0 D-8.) |
| D-10 | **Transactional consent wording** to add to booking terms / checkout. | **LOCKED — direction.** Add transactional communication wording to checkout/terms; no separate popup. (Batch 0 D-9.) Final exact copy deferred to a focused content task. |
| D-11 | **Safety-gate configuration** for the `shadow → auto` transition (§35). | **LOCKED** — `shadow → auto with safety gates`. No manual-approval stage. Manual-approve exists only as emergency/override mode. (Batch 0 D-11.) |
| D-12 | **`BOOKING_CONFIRM_WITHOUT_STRIPE` policy.** | **LOCKED** — Guest-facing automation is **blocked** for any booking confirmed via `BOOKING_CONFIRM_WITHOUT_STRIPE`. No automatic provenance inference (e.g. `Booking.provenance.source`) is used to derive a "safe to send" decision. Exceptions are handled by **manual OPS send** only. An explicit per-booking "automation-safe" override may be introduced in a later version; V1 does not have one. (Batch 0 D-12.) Surfaces as a guard in §32. |

### 4.1 Batch 0 — Locked decisions log (Jose)

This log captures Jose's Batch 0 decisions verbatim, in his numbering, and is the authoritative source. Where Jose's numbering differs from §4's engineering numbering, a mapping is shown.

| Batch 0 D# | Decision (Jose's wording) | Engineering mapping |
|---|---|---|
| D-1 | **Official WhatsApp sender.** Use Jose's current Bulgarian private WhatsApp number for V1. Move to a dedicated Drift & Dwells business number later if needed. | §4 D-1 |
| D-2 | **Provider.** Meta Cloud API direct first. Twilio only if Meta setup becomes too painful. | §4 D-2 |
| D-3 | **Dedicated vs private number.** Private number accepted for now. Architecture must keep provider/number swappable later. | §4 D-1 (operational), §20 (architectural). The provider abstraction and per-rule sender identity stay unchanged so the WABA number can be swapped later without touching rules, templates, the scheduler, or OPS UI. |
| D-4 | **V1 guest template.** Arrival / pre-arrival instructions only. | §2 scope; §23.A; §4 D-3. |
| D-5 | **Send timing.** Both The Cabin and The Valley: **3 days before check-in**. Do not use 24h or 48h as the V1 default anymore. | §2; §12 seed; §23.A; §36 testing math. Replaces §4 D-4 and §4 D-5. |
| D-6 | **OPS alerts.** Yes: guest arriving in 8 days; guest check-in tomorrow; guest checkout today. | §4 D-6; §23.B; §27. |
| D-7 | **`propertyKind` enum.** `cabin \| valley`. | §4 D-8; §6. |
| D-8 | **Default phone country.** `BG` by default, but parse international numbers when a country code exists. | §4 D-9; §8. |
| D-9 | **Consent wording.** Add transactional communication wording to checkout/terms. No extra popup. | §4 D-10; §9. |
| D-10 | **Marketing consent.** Out of V1. | Already covered in §3 (non-goals) and §10. No engineering action in V1. |
| D-11 | **Rollout.** `shadow → auto with safety gates`. No manual approval stage. | §4 D-11; §35. |
| D-12 | **`BOOKING_CONFIRM_WITHOUT_STRIPE`.** Block guest automation for these bookings. V1 uses no automatic provenance inference. Exceptions handled by manual OPS send. | §4 D-12; §32. |
| D-13 | **Worker model.** Design for a separate PM2 worker. May start integrated only if moving later requires no rewrite. | §4 D-7; §18; §37. |

V1 build may now start. The remaining open items (D-3 final template copy in §4, Sofia hour-of-day under §4 D-4, exact consent copy under §4 D-10) are content / seed-time sub-decisions and do not block the Batch 1 source audit.

---

## 5. Data model overview

Six new collections, plus one persisted field added to two existing collections. Nothing else is modified.

New collections (full schemas in §11–§16):

- `MessageTemplate` — versioned, per channel, per locale, per property.
- `MessageAutomationRule` — declarative trigger → template mapping.
- `ScheduledMessageJob` — durable queue of pending sends.
- `MessageDispatch` — record of one actual send attempt.
- `MessageDeliveryEvent` — provider webhook events, channel-agnostic.
- `GuestContactPreference` — per-channel-per-recipient consent + suppression.

Modified collections:

- `Cabin` — add `propertyKind` field (enum, persisted).
- `CabinType` — add `propertyKind` field (enum, persisted).

Untouched (explicitly):

- `Booking`, `Guest`, `Payment`, `PaymentFinalization`, `GiftVoucher`, `GiftVoucherEvent`, `GiftVoucherRedemption`, `CreatorPartner`, `CreatorCommission`, `CreatorPortalAccess`, `CreatorReferralVisit`, `PromoCode`, `Review`, `Unit`, `AvailabilityBlock`, `EmailEvent` (legacy stays as-is), `ManualReviewItem` (we add new categories but the schema stands), `AuditEvent`.

Relationships at a glance:

```
MessageAutomationRule  ─(1..n)─►  ScheduledMessageJob  ─(0..1)─►  MessageDispatch  ─(1..n)─►  MessageDeliveryEvent
        │                                  │                              │
        └────────► MessageTemplate ◄───────┘                              │
                                                                          │
                              GuestContactPreference ◄───── checked at claim time
                                                                          │
                                                                          ▼
                                                                 ManualReviewItem (on failure / wrong-property guard)
```

All collections use Mongo ObjectIds. All timestamps are stored UTC. All scheduling math is performed against Europe/Sofia and converted to UTC at insert time; the `scheduledFor` field is UTC and indexed.

---

## 6. Cabin and CabinType propertyKind plan

Add a single new field to both `Cabin` and `CabinType`:

- Field name: `propertyKind`
- Type: enum string
- Allowed values (V1): `'cabin'`, `'valley'`
- Required: not required at first (optional during migration), becomes required for new documents after backfill is verified
- Indexed: yes (used by orchestrator to filter and by OPS lists)
- Validation: enum-only; refusing writes for unknown values

Resolution rule for a booking's property:

- If `booking.cabinId` is set → `propertyKind = Cabin.findById(booking.cabinId).propertyKind`.
- Else if `booking.cabinTypeId` is set → `propertyKind = CabinType.findById(booking.cabinTypeId).propertyKind`.
- If neither resolves a `propertyKind`, the booking is treated as a configuration error: no automatic schedule is created, a ManualReviewItem of category `comms_property_unresolved` is opened.

The legacy email pipeline's inline heuristic (`location.toLowerCase().includes('valley')`) is allowed to remain in legacy code only. The new system never reads it.

---

## 7. propertyKind backfill plan

One-off, OPS-supervised, non-destructive. The backfill runs via an **idempotent internal CLI / maintenance script** — never a public route, never an OPS UI button, never a casual staff trigger. The script's role is to **propose** values heuristically and to **persist** them only after explicit human approval.

### 7.1 Backfill approach (Batch 1 clarification)

V1 uses a **heuristic-proposed + human-approved** dry-run model. The dry-run is allowed to read existing legacy signals (`Cabin.location`, `CabinType.slug`, `CabinType.name`, the legacy `location.toLowerCase().includes('valley')` heuristic, any known mapping table) **purely to propose** a `propertyKind` value per row. The proposal has zero authority; nothing is written based on it alone.

### 7.2 Phases

Phase 1 — dry-run audit (no writes):
- The script enumerates every `Cabin` and `CabinType` row.
- For each row, it prints the **exact** record: `id`, `name`, `slug` (where applicable), `location`, `current propertyKind` (or "unset"), and the **proposed** `propertyKind`.
- Rows where the heuristic cannot produce a confident proposal are printed in a distinct **unresolved** section with the reason (e.g. "ambiguous location string", "no slug match", "neither cabin nor valley signal found"). Unresolved rows must **not** be auto-written and must **not** be silently mapped to a default value.
- No row is mutated. The dry-run is safe to re-run.

Phase 2 — gated write:
- A human (Jose or a delegated reviewer) reviews the printed dry-run output and explicitly approves it.
- The script is then invoked in write mode (e.g. a second invocation with `--apply` / `WRITE=1` — exact mechanism decided at implementation time) and persists `propertyKind` for the **approved** rows only.
- Unresolved rows are skipped in write mode; they are surfaced separately so a human can author their mapping (additional dry-run + approval cycle) before another write pass.
- The script refuses to overwrite an existing non-empty `propertyKind` unless an explicit `--force` flag is set.
- Each write emits an `AuditEvent` row.
- The script is safe to re-run: a second write-mode invocation against an already-correct dataset is a no-op.

Phase 3 — verification:
- Read-only re-check: every active `Cabin` and `CabinType` has a `propertyKind`. Any row still without one is escalated to a `ManualReviewItem` of category `comms_property_kind_missing` and the orchestrator skips bookings tied to it.

Phase 4 — strict mode (post-V1 launch):
- Field becomes required on insert/update at the Mongoose level.
- New admin/ops UI surfaces the field as a required input when creating a new Cabin/CabinType.

### 7.3 Hard rules

- **No OPS UI button. No public HTTP route. No casual staff trigger.** The script is run by an engineer / authorised operator with shell access only.
- The dry-run is purely a proposal. The heuristic is a **convenience for review**, not authority for writes.
- Unknown / ambiguous records are surfaced as **unresolved** and must never be silently auto-written to a default value.
- Write mode is explicit and idempotent; re-running it must not duplicate or churn values.
- No bookings, no payments, no calendars are touched in the backfill.

---

## 8. Phone normalization plan

Goal: every guest contact has a deterministic E.164 representation or is explicitly marked invalid for WhatsApp.

### 8.1 Storage decision (V1)

The V1 decision is explicit:

1. **Raw phone is preserved on `Booking`.** `Booking.guestInfo.phone` continues to hold exactly what the guest submitted, character-for-character. It is the audit-of-record. The existing validation contract is not tightened (current server rule is `min length 1`).
2. **Normalised E.164 phone lives in the new `GuestContactPreference` record**, in the `recipientValue` field on rows where `recipientType='whatsapp_phone'` (see §16), alongside `phoneCountry` and `phoneStatus`. The most recently observed raw input is also kept on `GuestContactPreference.rawValueLastSeen` for OPS troubleshooting. This `GuestContactPreference` row is the **single source of truth** for "what number do we actually dial WhatsApp at".
3. **A `Booking` schema mutation is not part of V1.** A booking-side denormalised snapshot (e.g. `Booking.guestInfo.phoneE164`) is **only** added later if the implementation audit during the corresponding batch proves it is the cleanest path — for example, if OPS read queries hot-path joins to `GuestContactPreference` measurably hurt list performance. Until that proof exists, no booking schema change occurs.
4. **The dispatcher uses normalised E.164 only.** Any code path that sends a WhatsApp message reads the normalised E.164 from `GuestContactPreference.recipientValue` (with `recipientType='whatsapp_phone'` and `phoneStatus='valid'`). The raw `Booking.guestInfo.phone` is never passed to a provider adapter.

### 8.2 Where normalisation runs

- Booking create endpoint server-side, after request validation. Normalisation produces the `GuestContactPreference` row; it **does not** write to `Booking`.
- OPS contact edit endpoint, when `phone` changes — the raw value is written to `Booking.guestInfo.phone` as today, and `GuestContactPreference.phoneE164` is recomputed.
- (Read-only) at orchestrator claim time, as a defensive recompute against the persisted normalised value.

### 8.3 Library

- A standard E.164 parser (e.g. `libphonenumber-js`). Added as a server dependency in the appropriate batch, not now.

### 8.4 Rules

- Default country for ambiguous numbers: per D-9 (recommended Bulgaria, `BG`).
- Inputs starting with `+` are treated as fully-qualified and parsed without default country.
- Unparseable inputs → `phoneStatus = 'invalid'` on `GuestContactPreference`. `Booking.guestInfo.phone` retains the original raw value unchanged.
- Numbers with a valid country code but invalid national number → `phoneStatus = 'invalid'`.

### 8.5 Effect on dispatch

- `phoneStatus === 'valid'` → WhatsApp channel is available. Dispatcher uses `GuestContactPreference.phoneE164`.
- `phoneStatus !== 'valid'` → WhatsApp channel is **skipped** for that recipient. If the rule's `channelStrategy` is `whatsapp_first_email_fallback`, the dispatcher schedules an email fallback dispatch instead. An OPS warning surfaces on the booking and on the `OpsManualReviewBacklog` filter for invalid-phone bookings. The guest is not silently dropped.

---

## 9. Consent and terms wording plan

V1 captures transactional consent **implicitly through booking acceptance**, not via a separate dialog. Per §15 of the vision doc.

What V1 does:

- Extend the existing booking-terms / checkout copy with a clear sentence that says: "By booking, you agree to receive operational communications about your stay by email and, when available, WhatsApp. These are not marketing messages and are limited to information needed to complete your stay."
- Snapshot this acceptance similarly to how `legalAcceptance` is captured today: the exact wording, version, and timestamp are stored. Storage location: a small extension to the new `GuestContactPreference` document (one record per recipient identity, written at booking time), **not** an addition to the `Booking` schema. Rationale: keep all comms-related state in the new collections; do not modify the booking model.
- A versioned wording string (e.g. `transactional_v1`) is stored alongside the boolean. New wording = new version.

What V1 does not do:

- Marketing consent of any kind.
- A new mandatory checkbox at checkout (the language is incorporated into existing copy, with Jose's sign-off on the exact wording — D-10).
- A separate consent management page.

What an opt-out looks like:

- For V1, opt-out is OPS-driven: OPS marks a `GuestContactPreference` as suppressed for the relevant channel. There is no public unsubscribe URL in V1. This is acceptable because V1 is transactional only.
- Post-V1, when marketing comms ship, a proper unsubscribe + preferences page is introduced.

---

## 10. Suppression plan

Suppression is the deny-list the dispatcher consults before every send.

Sources of suppression entries:

- **Email**: Postmark webhook events of types `Bounce` (hard bounces only) and `SpamComplaint` are turned into suppression entries automatically. Soft bounces are not auto-suppressed.
- **WhatsApp**: provider hard-failure event types (provider-specific, normalised by the adapter — e.g. Meta `131056 (Re-engagement message)`, `131026 (Message undeliverable)`, recipient-not-on-whatsapp signals, opted-out / blocked signals) become suppression entries automatically.
- **Manual**: OPS marks a contact as suppressed for one or more channels with a free-text reason.
- **Guest request**: an inbound WhatsApp message with text matching a configurable list (e.g. `STOP`, `STOPPEN`, `СПРИ`) marks the phone as suppressed for WhatsApp and opens a ManualReviewItem so OPS can decide whether to email-suppress as well.

How suppression is enforced:

- Suppression entries live on `GuestContactPreference`, keyed by `(recipientType, recipientValue)` where `recipientType ∈ {'email', 'whatsapp_phone'}` and `recipientValue` is lower-cased email or normalised E.164.
- At job claim time, the orchestrator looks up the relevant preference. A suppression for the rule's required channel → dispatch is recorded as `status = 'skipped_suppressed'` (not "failed").
- Channel-fallback aware: if WhatsApp is suppressed but email is not, a `whatsapp_first_email_fallback` rule sends email. If both are suppressed, the dispatch is skipped entirely.

Reversibility:

- OPS can clear a suppression entry with a reason. Cleared entries remain in the audit trail.

---

## 11. MessageTemplate model

Purpose: versioned, per-channel, per-locale, per-property template definitions. Editable in OPS.

Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `key` | string | Stable slug. Example: `arrival_3d_the_cabin`, `arrival_3d_the_valley` (per Batch 0 D-5; T-72h scheduling). |
| `version` | integer | Increments per approved edit. Old versions immutable. |
| `channel` | enum `'email' \| 'whatsapp'` | |
| `locale` | enum `'en'` (V1) | `'bg'` allowed in schema; not used in V1. |
| `propertyKind` | enum `'cabin' \| 'valley' \| 'any'` | `'any'` reserved for internal OPS alerts. |
| `status` | enum `'draft' \| 'approved' \| 'disabled'` | Only `approved` templates can be dispatched. |
| `whatsappTemplateName` | string \| null | Required when `channel='whatsapp'`. Meta-approved template identifier. |
| `whatsappLocale` | string \| null | Meta locale code (e.g. `en`, `en_US`). Required when `channel='whatsapp'`. |
| `emailSubject` | string \| null | Required when `channel='email'`. |
| `emailBodyMarkup` | string \| null | Required when `channel='email'`. Plain HTML fragment consumed by the existing branded shell. |
| `variableSchema` | object | JSON Schema declaring expected variables (names + types + required flags). |
| `notes` | string | Free OPS notes (changelog). |
| `createdAt`, `updatedAt` | Date | |
| `approvedBy`, `approvedAt` | string \| Date | Set when status moves to `approved`. |

Indexes:

- Unique: `(key, channel, locale, propertyKind, version)`.
- Lookup: `(key, channel, locale, propertyKind, status)`.

Editing flow:

- OPS edits create a new draft version, never mutate the approved one.
- "Approve" moves draft → approved; old approved version becomes superseded (status remains `approved` historically but new dispatches always pick the highest-version `approved` row matching the lookup).
- "Disable" sets status `disabled`; the orchestrator treats the template as unavailable and the rule resolves to "no template available" (skip + escalate).

V1 templates pre-seeded:

- `arrival_3d_the_cabin` × `whatsapp` × `en` × `cabin` v1 (Meta name: `arrival_3d_the_cabin_v1`).
- `arrival_3d_the_cabin` × `email` × `en` × `cabin` v1.
- `arrival_3d_the_valley` × `whatsapp` × `en` × `valley` v1 (Meta name: `arrival_3d_the_valley_v1`).
- `arrival_3d_the_valley` × `email` × `en` × `valley` v1.

---

## 12. MessageAutomationRule model

Purpose: declarative trigger → template mapping. Editable in OPS.

Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `ruleKey` | string | Unique. E.g. `arrival_instructions_pre_arrival`. |
| `description` | string | Human-readable. |
| `triggerType` | enum `'time_relative_to_check_in' \| 'time_relative_to_check_out' \| 'booking_status_change' \| 'manual'` | V1 uses `time_relative_to_check_in` for the guest rule and `time_relative_to_check_in/out` for OPS alerts. |
| `triggerConfig` | object | Per type. For `time_relative_to_check_in`: `{ offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 }` (V1 arrival rule per Batch 0 D-5). Negative `offsetHours` = before. |
| `propertyScope` | enum `'cabin' \| 'valley' \| 'any'` | Cabin/Valley have separate rule rows, even if structurally identical, to allow per-property disable. |
| `channelStrategy` | enum `'whatsapp_only' \| 'email_only' \| 'whatsapp_first_email_fallback' \| 'both'` | |
| `templateKeyByChannel` | object | `{ whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' }`. Locale resolved per booking (V1: always `en`). |
| `requiresConsent` | enum `'transactional'` (V1) | `'marketing'` reserved for future. |
| `enabled` | boolean | Master switch. |
| `mode` | enum `'auto' \| 'shadow' \| 'manual_approve'` | `auto` is the standard production mode (with safety gates, see §35). `shadow` schedules but does not send; used for the first cycle. `manual_approve` is an **emergency/override mode** that holds jobs for explicit OPS confirmation; it is **not** a required step in the rollout progression. |
| `audience` | enum `'guest' \| 'ops'` | V1 guest rule = `guest`. Internal alerts = `ops`. |
| `requiredBookingStatus` | array of enum | E.g. `['confirmed']`. Job is skipped at claim if booking is not in one of these statuses. |
| `requirePaidIfStripe` | boolean | If true, dispatcher additionally checks `booking.stripePaymentIntentId != null`. Useful to skip the `BOOKING_CONFIRM_WITHOUT_STRIPE` dev/invoice case (D-12). |
| `createdAt`, `updatedAt` | Date | |

Indexes:

- Unique: `ruleKey`.
- Lookup: `(triggerType, enabled, propertyScope)`.

V1 rules pre-seeded:

- `arrival_instructions_pre_arrival_cabin` — `propertyScope='cabin'`, channel `whatsapp_first_email_fallback`, audience `guest`. Offset **T-72h** (per Batch 0 D-5).
- `arrival_instructions_pre_arrival_valley` — `propertyScope='valley'`, channel `whatsapp_first_email_fallback`, audience `guest`. Offset **T-72h** (per Batch 0 D-5; the legacy T-48h option is dropped from V1).
- `ops_alert_guest_arriving_in_8_days` — `audience='ops'`, channel `email_only`.
- `ops_alert_guest_check_in_tomorrow` — `audience='ops'`, channel `email_only`.
- `ops_alert_guest_checkout_today` — `audience='ops'`, channel `email_only`.

The three internal alerts can ship together or in a second batch; they must not block the guest rule.

---

## 13. ScheduledMessageJob model

Purpose: durable queue. Every future message is one row. The single source of truth for "what will be sent and when".

**Unit of work.** One `ScheduledMessageJob` represents **one rule occurrence** for a given booking — it is **not** scoped per channel. WhatsApp and email are recorded as separate **dispatch attempts** (rows in `MessageDispatch`) under the same job. Channel is therefore deliberately **excluded** from the `ScheduledMessageJob` unique key. Including channel in the unique key would allow two jobs to exist for the same rule occurrence (one for WA, one for email), which would weaken the fallback safety contract — the orchestrator/dispatcher must always decide channel resolution **inside** a single job, not by pre-splitting jobs per channel.

Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `ruleKey` | string | FK by key to `MessageAutomationRule`. |
| `ruleVersionAtSchedule` | integer | Snapshot of the rule's version if rules become versioned later. V1 may store `1`. |
| `bookingId` | ObjectId \| null | Null only for `audience='ops'` rules that are not per-booking. |
| `audience` | enum `'guest' \| 'ops'` | Mirrored from rule for query speed. |
| `propertyKind` | enum `'cabin' \| 'valley' \| 'any'` | Snapshotted at schedule time. |
| `scheduledFor` | Date (UTC) | When the worker should claim this job. Indexed. |
| `scheduledForSofia` | string `'YYYY-MM-DDTHH:mm'` | Human-readable mirror for OPS lists. |
| `status` | enum `'scheduled' \| 'claimed' \| 'sent' \| 'failed' \| 'cancelled' \| 'suppressed' \| 'skipped_status_guard' \| 'skipped_no_consent'` | |
| `attemptCount` | integer | 0 at create. |
| `maxAttempts` | integer | Default 3 for guest; 1 for ops alerts. |
| `claimedBy` | string \| null | Worker identifier (e.g. `driftdwells-worker@hostname#pid`). |
| `claimedAt` | Date \| null | |
| `visibilityTimeoutAt` | Date \| null | Reclaimable after this UTC if still `claimed`. |
| `payloadSnapshot` | object | Rendered template variables at schedule time. Snapshotted again at claim time for staleness check (§33). |
| `cancelReason` | string \| null | |
| `cancelActor` | string \| null | OPS user id or `system`. |
| `lastError` | string \| null | |
| `createdAt`, `updatedAt` | Date | |

Indexes:

- **Unique:** `(bookingId, ruleKey, scheduledFor)` with partial filter `bookingId != null`. This is the primary idempotency guarantee for guest rules.
- **Unique:** `(ruleKey, scheduledFor)` with partial filter `bookingId == null`. For ops rules that fire on a calendar tick (e.g. "everyone arriving tomorrow" is one job per booking, not a global job; ops-aggregate rules are out of V1 except as separate per-booking jobs).
- Lookup: `(status, scheduledFor)` for the worker tick query.
- Lookup: `(bookingId, status)` for OPS per-booking listing.

Status transitions:

```
scheduled ──claim──► claimed ──dispatch──► sent
                                       └──► failed (attemptCount < maxAttempts → retry → claimed again later)
scheduled ──cancel──► cancelled
scheduled ──suppress──► suppressed   (guest opted out / hard bounce)
claimed   ──skip──► skipped_status_guard | skipped_no_consent
```

Failed jobs at `maxAttempts` are terminal; a `ManualReviewItem` is opened.

---

## 14. MessageDispatch model

Purpose: record of one concrete send attempt. There can be more than one per job (retries) and there can be dispatches without a job (manual sends).

Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `scheduledMessageJobId` | ObjectId \| null | Null for manual sends. |
| `bookingId` | ObjectId \| null | Null for ops alerts not tied to a booking. |
| `ruleKey` | string \| null | Snapshot. |
| `templateKey` | string | |
| `templateVersion` | integer | The version actually rendered. |
| `channel` | enum `'whatsapp' \| 'email'` | |
| `recipient` | string | Normalised E.164 or lower-cased email. |
| `recipientChannelId` | string \| null | E.g. WA `phone_number_id` from provider. |
| `lifecycleSource` | enum `'automatic' \| 'manual_first_send' \| 'manual_resend'` | |
| `status` | enum `'accepted' \| 'failed' \| 'skipped_suppressed' \| 'skipped_no_consent' \| 'skipped_no_recipient' \| 'skipped_status_guard' \| 'skipped_wrong_property'` | |
| `providerName` | enum `'meta_whatsapp' \| 'twilio_whatsapp' \| 'three_sixty_dialog' \| 'postmark' \| 'internal'` | |
| `providerMessageId` | string \| null | What the provider returned. Unique-indexed when present. |
| `error` | object \| null | `{ code, message, providerRaw? }`. |
| `actorId` | string \| null | OPS user for manual sends. |
| `actorRole` | string \| null | |
| `idempotencyKey` | string | Composite: `${ruleKey}:${bookingId}:${scheduledFor}:${channel}` for automatic; `${bookingId}:${templateKey}:${channel}:${manualSendUuid}` for manual. |
| `createdAt`, `updatedAt` | Date | |

Indexes:

- Unique: `idempotencyKey`.
- Unique sparse: `(providerName, providerMessageId)`.
- Lookup: `(bookingId, createdAt)` for OPS per-booking history.

Relationship rules:

- Each `ScheduledMessageJob` produces 0..1 successful `MessageDispatch` and 0..N failed ones (one per attempt).
- A manual send produces exactly one `MessageDispatch`, no job.

---

## 15. MessageDeliveryEvent model

Purpose: provider webhook events normalised across channels. Replaces what `EmailEvent` does for the legacy pipeline, scoped to the new system. **Does not modify `EmailEvent`.**

Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `dispatchId` | ObjectId \| null | Resolved by matching `providerMessageId`; null if unmatched (rare). |
| `bookingId` | ObjectId \| null | Mirrored from dispatch for query speed. |
| `provider` | enum `'meta_whatsapp' \| 'twilio_whatsapp' \| 'three_sixty_dialog' \| 'postmark' \| 'internal'` | |
| `channel` | enum `'whatsapp' \| 'email'` | |
| `eventType` | enum `'accepted' \| 'sent' \| 'delivered' \| 'read' \| 'failed' \| 'bounced' \| 'spam_complaint' \| 'opened' \| 'clicked'` | |
| `isTerminal` | boolean | True for `delivered`, `read`, `failed`, `bounced`, `spam_complaint`. |
| `providerEventId` | string | |
| `providerMessageId` | string \| null | Used to backfill `dispatchId` if not present at insert. |
| `occurredAt` | Date | Provider timestamp; falls back to receipt time. |
| `payload` | object | Provider-raw safe slice. PII-minimal. |
| `createdAt` | Date | Receipt time. |

Indexes:

- Unique: `(provider, providerEventId)`.
- Lookup: `(dispatchId, occurredAt)`.
- Lookup: `(bookingId, channel, occurredAt)`.

Email separation:

- The legacy Postmark webhook keeps writing to `EmailEvent` for legacy `booking:*` sends.
- The new dispatcher, when it sends through the email adapter, writes a `MessageDispatch` and (when the webhook routing below is in place) a new `MessageDeliveryEvent` upon provider webhook for that dispatch. It must **never** write to `EmailEvent`. `EmailEvent` is the legacy lifecycle store; the new system has its own delivery-event store on purpose (§3 non-goals, §40 risk row).

**Desired design — Postmark tag namespace (Batch 9).**

- New email sends should ideally be namespaced with a Postmark tag of the form `dispatch:<dispatchId>` and a `Metadata.dispatchId` field carrying the same id. This gives the email webhook a clean way to fork: tags starting with `booking:` continue to write to `EmailEvent` (legacy path, untouched); tags starting with `dispatch:` resolve to a `MessageDispatch` and write a `MessageDeliveryEvent` (new path).
- This namespace **must not overload `EmailEvent`.** `EmailEvent` stays scoped to the legacy lifecycle. New automation events live in `MessageDeliveryEvent`.

**Audit-first caveat (Batch 9 must verify before implementing).**

- Batch 9 must **first audit** whether `emailService.sendEmail` actually accepts and forwards custom Postmark tag and metadata values per send. The current code uses a fixed legacy tag (`booking:<bookingId>` / `booking:<trigger>` style) and may not expose per-call tag/metadata overrides.
- If `emailService.sendEmail` cannot stamp dispatch-scoped tag/metadata, Cursor must **stop** and propose the smallest safe design before implementation. Options live on a spectrum from "extend `emailService` with an additive, opt-in tag/metadata parameter" to "record evidence only at the dispatcher boundary (no webhook mirroring)" — the choice is made in Batch 9's pre-batch report, reviewed by ChatGPT, not assumed here.
- Do **not** assume the email webhook alone can route `dispatch:*` events: if `sendEmail` cannot stamp the dispatch metadata in the first place, the webhook will see only the legacy tag shape and cannot correlate Postmark events to a new-system dispatch.
- Until the audit is complete, V1's email-channel delivery evidence falls back to the dispatcher-boundary record only (`MessageDispatch` row + Postmark API response), per §21.

---

## 16. GuestContactPreference model

Purpose: per-channel, per-recipient consent + suppression + phone normalisation result.

Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `recipientType` | enum `'email' \| 'whatsapp_phone'` | |
| `recipientValue` | string | Lower-cased email or normalised E.164. |
| `rawValueLastSeen` | string \| null | For phones only; the most recent un-normalised input. |
| `phoneStatus` | enum `'valid' \| 'invalid' \| 'unknown'` | Only meaningful when `recipientType='whatsapp_phone'`. |
| `phoneCountry` | string \| null | ISO2; resolved at normalisation. |
| `transactional` | enum `'granted' \| 'denied' \| 'unknown'` | Defaults to `granted` when a booking is created with the new wording. |
| `transactionalWordingVersion` | string \| null | E.g. `transactional_v1`. |
| `transactionalCapturedAt` | Date \| null | |
| `marketing` | enum `'granted' \| 'denied' \| 'unknown'` | V1: always `denied` until a marketing surface ships. |
| `suppressed` | boolean | Convenience flag derived from `transactional='denied'` OR explicit suppression entry below. |
| `suppressedReason` | enum `'hard_bounce' \| 'spam_complaint' \| 'user_optout_stop' \| 'provider_failure' \| 'manual' \| null` | |
| `suppressedAt` | Date \| null | |
| `suppressedNote` | string | OPS free text. |
| `linkedBookingIds` | array<ObjectId> | Recent bookings for OPS context. Not authoritative. |
| `lastEventAt` | Date \| null | Most recent dispatch or webhook event. |
| `createdAt`, `updatedAt` | Date | |

Indexes:

- Unique: `(recipientType, recipientValue)`.
- Lookup: `(suppressed, recipientType)`.

Reading rules:

- The dispatcher reads this collection at claim time.
- If no row exists for a channel, behaviour defaults to: `transactional='granted'` (because the guest accepted booking terms with V1 wording) and `phoneStatus='unknown'`. The dispatcher attempts normalisation lazily and upserts the row.

---

## 17. MessageOrchestrator design

The orchestrator is a small set of pure functions plus three integration points. It does not run a loop; it is called by booking lifecycle code (for status-change triggers) and by the scheduler tick (for time-based triggers).

Responsibilities:

1. **On booking lifecycle event** (create / status change / date edit / cancel): resolve which rules apply, compute their `scheduledFor`, upsert `ScheduledMessageJob` rows. Date edit cancels and re-creates affected jobs.
2. **On scheduler tick** (every N seconds, V1: 60): identify time-based rules whose schedule horizon may need backfilled jobs (V1's only rule is per-booking, so this is a no-op except for safety nets that re-create missing jobs for newly-confirmed-but-recently-created bookings whose lifecycle event was missed).
3. **At job claim** (called by worker): perform the guard suite below and return either `proceed(payload)` or `skip(reason)` or `defer(retryAt)`.

Booking lifecycle hook points (V1):

- `Booking` create with `status='pending'` → schedule guest arrival job only if `enabled && requiredBookingStatus.includes('pending')` (V1: rule requires `confirmed`, so no job at this point).
- `Booking` create with `status='confirmed'` → schedule.
- Status `pending → confirmed` → schedule.
- Status `* → cancelled` → cascade-cancel.
- Date edit (`editReservationDates`) → cancel + re-schedule.

These hooks are **read-only consumers** of booking events. They do not modify booking, payment, or any other domain. They emit jobs into the new collection.

Claim-time guard suite (single pass, in this exact order, fail-fast):

1. Booking still exists.
2. Booking status ∈ rule's `requiredBookingStatus`.
3. **`BOOKING_CONFIRM_WITHOUT_STRIPE` block (D-12, locked).** If the booking reached `confirmed` via the `BOOKING_CONFIRM_WITHOUT_STRIPE=1` code path, **skip** the dispatch (`skipped_status_guard`, reason `confirmed_without_stripe`). No provenance inference, no override field in V1. Exceptions are handled by manual OPS send only.
4. If rule's `requirePaidIfStripe`, then `booking.stripePaymentIntentId` exists (or `paymentMethod === 'gift_voucher'` with a confirmed redemption).
5. Resolve `propertyKind` from `Cabin`/`CabinType`. Must match the rule's `propertyScope`.
6. Recipient resolution: pick channel per strategy.
7. Suppression check on `GuestContactPreference` for the chosen channel.
8. Phone validity check if channel is WhatsApp.
9. Staleness check: `payloadSnapshot.checkIn === booking.checkIn`.
10. Build the variable bag.

Any guard failure → record a skipped dispatch with the correct status code, optionally open a ManualReviewItem.

Property mismatch in step 4 is **always** a high-severity ManualReviewItem of category `comms_property_mismatch_blocked`.

---

## 18. SchedulerWorker design

V1 ships a single worker process. The implementation is structured so that moving it to a dedicated PM2 process (`driftdwells-worker`) requires only startup-wiring changes.

Loop:

- Every `WORKER_TICK_MS` (V1 default: 60s), the worker runs a single tick.
- Tick query: `find { status: 'scheduled', scheduledFor: { $lte: now } }` limited to `BATCH_SIZE` (V1 default: 50), sorted by `scheduledFor` ASC.
- For each candidate, atomically claim via `findOneAndUpdate({ _id, status: 'scheduled' }, { $set: { status: 'claimed', claimedBy, claimedAt: now, visibilityTimeoutAt: now + VISIBILITY_TIMEOUT } })`. If `null` returned, another worker won; skip.
- After claim, run guard suite (§17) → either dispatch via `MessageDispatcher` or skip.
- Outcomes:
  - Success → `status='sent'`.
  - Skip → `status='skipped_*'`.
  - Failure with `attemptCount < maxAttempts` → `status='scheduled'`, `scheduledFor = now + backoff(attemptCount)`, `attemptCount++`, `lastError` set. Backoff: 5min × 2^attempt, capped 30min.
  - Failure terminal → `status='failed'`, open ManualReviewItem.

Visibility timeout sweeper:

- A secondary sub-tick (every `SWEEPER_TICK_MS`, V1: 120s) re-marks `claimed` jobs older than `visibilityTimeoutAt` back to `scheduled` and increments a separate `reclaimCount`. Reclaim is bounded (max 2) before failing the job to prevent infinite loops.

Single-leader execution (V1 default):

- The worker only starts if `MESSAGE_WORKER_ENABLED='1'` (env). In a single-process deployment this is set on the main app process. In a future split deployment, only `driftdwells-worker` sets this and the main app does not.
- If both processes have it set by mistake, the unique-index on `ScheduledMessageJob.(bookingId, ruleKey, scheduledFor)` plus the atomic claim mechanism still prevents duplicate sends. The leader rule is a defence-in-depth, not the primary safety.

Per D-7, V1 may ship in either configuration.

---

## 19. MessageDispatcher design

The dispatcher is a thin function: given `(channel, recipient, templateKey, templateVersion, variables, idempotencyKey)`, it:

1. Loads the approved `MessageTemplate` row.
2. Validates `variables` against `template.variableSchema` (fail fast).
3. Picks the adapter for the channel.
4. Inserts a `MessageDispatch` row with `status='accepted'` and the idempotency key (unique-indexed → duplicate inserts caught).
5. Calls the adapter's `send(...)` returning `{ providerMessageId, providerStatus, providerRaw }`.
6. Updates the dispatch row with the provider message id.
7. Returns the dispatch outcome to the caller.

Failure handling:

- Adapter throws → dispatch row updated to `status='failed'` with `error`.
- Adapter returns non-success → dispatch row updated to `status='failed'`.
- Unique-index violation on `idempotencyKey` → return the existing dispatch row (treated as already sent — caller treats as success).

The dispatcher never schedules retries itself. Retry logic belongs to the worker.

---

## 20. WhatsAppProvider abstraction

Single interface:

```
sendTemplate({
  to: string (E.164),
  templateName: string,
  locale: string,
  variables: object,
  mediaHeader?: { kind: 'image'|'document', url: string }
}) → { providerMessageId, providerStatus, providerRaw }

verifyWebhookSignature(rawBody: Buffer, headers: object) → boolean

parseInboundEvent(payload: object) → NormalisedInboundEvent

parseStatusEvent(payload: object) → NormalisedStatusEvent
```

V1 implements one adapter, picked per D-2. Candidate folders:

- `server/services/messageAutomation/providers/whatsapp/metaCloudAdapter.js`
- `server/services/messageAutomation/providers/whatsapp/twilioAdapter.js`
- `server/services/messageAutomation/providers/whatsapp/threeSixtyDialogAdapter.js`

Required env vars vary per provider and will be documented inside the adapter when added. The abstraction's selection rule is a single env var: `WHATSAPP_PROVIDER='meta'|'twilio'|'three_sixty_dialog'`.

Provider-specific failure mapping:

- Adapters translate provider error codes into a small stable enum: `'invalid_recipient' | 'template_not_approved' | 'rate_limited' | 'provider_unavailable' | 'auth_failure' | 'other'`. Dispatcher uses the enum to decide retry vs terminal.

Adapter unit-testability:

- Adapters expose deterministic functions and accept an injected HTTP client. Tests use fakes; V1 does not require live provider tests.

---

## 21. EmailProvider design using existing emailService

V1 does not replace `server/services/emailService.js`. The new email adapter wraps it.

Adapter responsibilities:

- Render the approved email template's `emailSubject` and `emailBodyMarkup` against variables, then place the body inside the existing branded shell (`server/services/emailTemplates/guestLifecycleLayout.js`). The legacy shell is imported and used unchanged.
- Call the **existing public method** `emailService.sendEmail(...)` with the rendered subject, html, text, `trigger`, and `bookingId`. The adapter must not bypass, monkey-patch, or otherwise mutate `emailService` internals. `emailService.sendEmail` is the only public surface used.
- **Idempotency is owned by the new system**, not by the legacy email service. The authoritative duplicate-send protection is two-layered: `ScheduledMessageJob` unique on `(bookingId, ruleKey, scheduledFor)` — **one job per rule occurrence, channel deliberately excluded** (see §13) — and `MessageDispatch.idempotencyKey` unique on the per-attempt composite `(ruleKey:bookingId:scheduledFor:channel)` (see §14). The orchestrator decides whether a send is allowed; the adapter is downstream of that decision.
- **Legacy in-memory window — verified parameter.** `emailService.sendEmail` exposes a verified `skipIdempotencyWindow` boolean parameter (confirmed at `server/services/emailService.js:250`, already used in production by `bookingLifecycleEmailService` for manual resends and by `giftVoucherEmailService`). For dispatches that originate from this new system, the adapter passes `skipIdempotencyWindow: true` **solely** to prevent the legacy 10-minute in-memory window from returning a spurious `skipped-duplicate` response for a job the new DB layer has already validated as a legitimate, non-duplicate send. This is a defensive pass-through of an existing verified option, not the system's idempotency mechanism. **The new DB-backed idempotency must hold even if this flag is removed or the legacy parameter changes.**
- **Desired Postmark namespace.** Outgoing sends should ideally carry tag `dispatch:<dispatchId>` and metadata `{ dispatchId, bookingId, ruleKey, templateKey, templateVersion, channel: 'email' }`. This is the namespace the email webhook can later fork on (`booking:*` → legacy `EmailEvent`, `dispatch:*` → `MessageDeliveryEvent`). See §15.
- **Audit-first requirement.** Before implementing this, Batch 9 must verify that `emailService.sendEmail` actually supports per-call Postmark tag and metadata overrides. If it does not, Cursor must **stop and propose the smallest safe design** (e.g. an additive, opt-in `tag` / `metadata` parameter on `sendEmail`, or fallback to dispatcher-boundary evidence only). Do **not** assume the email webhook alone can route `dispatch:*` events: without dispatch-scoped tag/metadata on the outbound, the webhook cannot correlate Postmark events to a new-system dispatch.
- **No overloading of `EmailEvent`.** Even if dispatch-scoped tagging proves easy, the new system must continue to write its delivery events to `MessageDeliveryEvent`, never to `EmailEvent`.
- Return `{ providerMessageId, providerStatus }` derived from nodemailer's response.

The implementer must not assume any other `emailService` option exists; if a future need arises (e.g. custom headers, alternate transport), it must be confirmed against the current `emailService` source before being written into a plan.

What the email adapter does **not** touch:

- `bookingLifecycleEmailService` and its templates.
- `EmailEvent` writes.
- The Postmark webhook route (`/api/email/webhook/postmark`).

V1's email-channel delivery evidence comes from the `MessageDispatch` row + provider response. Later phase, gated by the Batch 9 audit above: mirror Postmark webhook events into `MessageDeliveryEvent` when the tag matches `dispatch:*`. This is **not** the V1 default; it ships only if Batch 9 confirms `emailService.sendEmail` can stamp dispatch-scoped tag/metadata cleanly. `EmailEvent` is never modified or extended for the new system.

---

## 22. Provider webhook design

WhatsApp inbound + delivery webhooks land on new endpoints:

- `POST /api/message-automation/webhook/whatsapp` — single endpoint, adapter picks based on `WHATSAPP_PROVIDER` env, signature verified by the chosen adapter.
- (Future) `POST /api/message-automation/webhook/whatsapp/<provider>` if multi-provider parallel ingestion is ever needed. Not in V1.

Behaviour:

- Raw body parsing, HMAC verification.
- Adapter normalises payload via `parseInboundEvent` / `parseStatusEvent`.
- For status events: upsert `MessageDeliveryEvent` keyed by `(provider, providerEventId)`. If `dispatchId` not present, resolve by `providerMessageId`. Otherwise insert with `dispatchId=null` for OPS investigation.
- For inbound messages: match phone to a `GuestContactPreference`; check for STOP-style keywords (per §10) and update suppression; persist a minimal record for OPS context. No auto-reply in V1.

Email webhook:

- Legacy `POST /api/email/webhook/postmark` is **not modified in V1's default path**. It continues to route `booking:*` tagged events to `EmailEvent` exactly as it does today.
- The new system's email delivery evidence is recorded at the dispatcher boundary (the `MessageDispatch` row + Postmark API response).
- **Desired future routing (conditional, Batch 9 — see §15 and §21).** If Batch 9 confirms that `emailService.sendEmail` can stamp per-call dispatch tag (`dispatch:<dispatchId>`) and metadata, the legacy webhook may be extended **additively** to fork on tag prefix: `booking:*` → existing `EmailEvent` write (unchanged), `dispatch:*` → new `MessageDeliveryEvent` write. If the audit shows this is not cleanly feasible, the legacy webhook stays untouched and the new system relies on dispatcher-boundary evidence only. Either way, `EmailEvent` is never overloaded with new-system events.

Webhook rate limiting & abuse protection:

- Inherit the existing app-wide `express-rate-limit` configuration. WhatsApp webhooks require lenient limits because providers retry aggressively; configure a higher limit for the webhook route specifically.

---

## 23. V1 automation rule definitions

### A. Guest-facing rules

**`arrival_instructions_pre_arrival_cabin`**

- `audience`: `guest`
- `propertyScope`: `cabin`
- `triggerType`: `time_relative_to_check_in`
- `triggerConfig`: `{ offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 }` — T-72h per Batch 0 D-5; Sofia hour is a Batch 5 seed-time default (working value 17:00 until confirmed).
- `channelStrategy`: `whatsapp_first_email_fallback`
- `templateKeyByChannel`: `{ whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' }`
- `requiredBookingStatus`: `['confirmed']`
- `requirePaidIfStripe`: `true` (per Batch 0 D-12 policy — see §32)
- `requiresConsent`: `transactional`
- `mode`: per Batch 0 D-11 — starts `shadow` for the first cycle, then `auto` with safety gates. `manual_approve` is emergency/override only.
- `enabled`: `true` after templates are approved by Meta

**`arrival_instructions_pre_arrival_valley`**

- Same as above with:
- `propertyScope`: `valley`
- `templateKeyByChannel`: `{ whatsapp: 'arrival_3d_the_valley', email: 'arrival_3d_the_valley' }`
- `triggerConfig.offsetHours`: `-72` (same as Cabin — Batch 0 D-5 locked both properties to T-72h; the legacy T-48h Valley option is dropped from V1).

### B. Internal OPS alerts (audience: `ops`)

These ship together as a second batch if simple; they must not block the guest-facing rules.

**`ops_alert_guest_arriving_in_8_days`**

- `triggerType`: `time_relative_to_check_in`
- `triggerConfig`: `{ offsetHours: -192, sofiaHour: 9, sofiaMinute: 0 }` (8 days × 24h before check-in, Sofia 09:00)
- `propertyScope`: `any`
- `channelStrategy`: `email_only`
- `templateKeyByChannel`: `{ email: 'ops_alert_arriving_8d' }`
- Recipient: `EMAIL_TO_INTERNAL` env (existing, used by legacy internal new-booking notification).
- `enabled`: per D-6.

**`ops_alert_guest_check_in_tomorrow`**

- `triggerType`: `time_relative_to_check_in`
- `triggerConfig`: `{ offsetHours: -24, sofiaHour: 9, sofiaMinute: 0 }`
- `propertyScope`: `any`
- `channelStrategy`: `email_only`
- `templateKeyByChannel`: `{ email: 'ops_alert_check_in_tomorrow' }`

**`ops_alert_guest_checkout_today`**

- `triggerType`: `time_relative_to_check_out`
- `triggerConfig`: `{ offsetHours: 0, sofiaHour: 8, sofiaMinute: 0 }` (checkout day, Sofia 08:00)
- `propertyScope`: `any`
- `channelStrategy`: `email_only`
- `templateKeyByChannel`: `{ email: 'ops_alert_checkout_today' }`

For ops alerts, `requiredBookingStatus = ['confirmed', 'in_house']` and `audience='ops'`. The orchestrator schedules one job per booking; the dispatcher does not batch ops alerts together (one email per guest per alert) to keep the system simple and auditable.

---

## 24. V1 WhatsApp template variable schemas

Both templates use the same variable bag. Submitted to Meta for approval per D-3.

Meta template names (`whatsappTemplateName` in `MessageTemplate`):

- `arrival_3d_the_cabin_v1`
- `arrival_3d_the_valley_v1`

Declared variables (V1 — stable booking + stay fields, no AI text, no marketing):

| Variable | Source | Required | Notes |
|---|---|---|---|
| `guestFirstName` | `booking.guestInfo.firstName` | yes | Trimmed, max 50 chars. |
| `propertyName` | `Cabin.name` / `CabinType.name` | yes | E.g. "The Cabin", "The Valley A-frame". |
| `checkInDate` | `booking.checkIn` rendered in Europe/Sofia, format `Mon 12 May` | yes | Localised English in V1. |
| `checkOutDate` | `booking.checkOut` rendered same way | yes | |
| `arrivalWindow` | `Cabin.arrivalWindowDefault` / `CabinType.arrivalWindowDefault` | yes | Free string today; passed through verbatim. |
| `guideUrl` | Resolved per property: `arrivalGuideUrl` of the resolved stay, or `${APP_URL}/my-trip/<bookingId>/valley-guide` for Valley | yes | If missing → orchestrator skips with `comms_missing_guide_url` ManualReviewItem. |
| `meetingPointLabel` | `stay.meetingPoint.label` (`Cabin.meetingPoint` or `CabinType.meetingPoint`) | yes | |
| `googleMapsUrl` | `stay.meetingPoint.googleMapsUrl` | yes | |
| `supportPhone` | A new env-derived constant `OPS_SUPPORT_PHONE_E164` (resolves D-1) | yes | Same string for both properties. |
| `transportNote` | Static per template (Cabin: parking note; Valley: transfer mode reminder) | yes | Hard-coded copy inside the email template body and inside the Meta template; not user-data. |
| `packingReminderShort` | Static per template, one sentence | yes | E.g. "Pack warm layers, headlamp, and any prescription meds." |

Variable rules:

- All variables are strings at the boundary.
- The orchestrator renders dates from UTC to Europe/Sofia using existing date utilities; it never sends ISO strings to the template.
- Variables with empty/null source → orchestrator either uses a documented fallback (e.g. `arrivalWindow` defaults to "as confirmed by your host") or, for required-no-fallback variables (`guideUrl`, `meetingPointLabel`, `googleMapsUrl`), refuses to dispatch and opens a ManualReviewItem.
- No dynamic AI text. No marketing language.
- WhatsApp template body must be plain text + at most one media header. No buttons in V1.

---

## 25. V1 email fallback template variables

Same variable bag as §24, plus:

- `subject`: server-rendered from `template.emailSubject`, allowed to use `{{guestFirstName}}` and `{{propertyName}}`. Example: `"Your arrival to {{propertyName}} — {{checkInDate}}"`.
- The body lives in `template.emailBodyMarkup` and uses the same variables.
- The body is wrapped by the existing branded shell (`buildGuestTransactionalHtml`). No styling is duplicated.

Email variants are dispatched **only when WhatsApp cannot be used** for that booking (channel strategy `whatsapp_first_email_fallback`).

---

## 26. OPS UI requirements

All UI lives under `/ops`. Admin (legacy) is not extended.

### 26.1 OpsReservationDetail additions

- **Messaging panel** below the existing Communication section, clearly separated:
  - **Upcoming messages** (list of `ScheduledMessageJob` for this booking, status `scheduled` or `claimed`), columns: rule, channel, scheduledFor (Sofia), status, actions (Cancel, Pause-this-booking, View payload).
  - **History** (list of `MessageDispatch` for this booking), columns: createdAt, rule, channel, recipient, status, providerMessageId, delivery state (latest `MessageDeliveryEvent.eventType` per dispatch).
  - **Pause automation for this booking**: a toggle that sets all future jobs for this bookingId to `cancelled` with reason `paused_per_booking_by_ops` and refuses future scheduling for this booking until cleared.
  - **Manual send** button: opens a modal where OPS picks a `MessageTemplate` (filtered to property), previews the rendered HTML/WhatsApp body, optionally overrides recipient, and confirms. Produces a `MessageDispatch` with `lifecycleSource='manual_first_send'`. Does not interact with legacy email resend.
- **Guest contact panel** addendum: show resolved `phoneStatus`, suppression flags, link to `GuestContactPreference`.

### 26.2 OpsCommunicationOversight (existing read-only screen) additions

- Section split into "Legacy email events" (existing read-only summary) and "Comms automation" (new):
  - Counters: scheduled count, sent-last-24h count, failed-last-24h count, suppressed-last-24h count.
  - Recent 50 `MessageDispatch` rows with status and rule.
  - Per-rule small table: rule key, enabled, mode, last successful send.

### 26.3 New OPS screens

- **OpsMessageTemplates** — list of templates, filterable by `propertyKind`, `channel`, `locale`, `status`. Detail page allows editing draft, previewing, and approving.
- **OpsAutomationRules** — list of rules, with master `enabled` toggle, `mode` switch (`shadow` / `manual_approve` / `auto`), per-property disable (which is just the rule row for that property), recent dispatch counts.
- **OpsScheduledMessages** — global queue view, filterable by date / property / rule / status, with cancel action.
- **OpsManualReviewBacklog** — existing screen, extended to surface new categories (§30).

### 26.4 Access control

- All new endpoints and screens require the same OPS role as existing reservation write actions. Permissions are added to the existing `permissionService` action list. No new role tier is introduced in V1.

---

## 27. OPS internal notification requirements

Only if simple and safe. They are decoupled from the guest-facing path.

V1 ships these alerts as email-only:

- `ops_alert_guest_arriving_in_8_days` — daily Sofia 09:00 forecast, one email per guest arriving in 8 days.
- `ops_alert_guest_check_in_tomorrow` — daily Sofia 09:00 for tomorrow's check-ins.
- `ops_alert_guest_checkout_today` — daily Sofia 08:00 for today's checkouts.

Format:

- Subject: e.g. `[Drift & Dwells OPS] Tomorrow check-in: <propertyName> — <guestName>`.
- Body: minimal — guest first/last name, email, phone (raw + normalised), property, check-in/out, arrival window, link to OPS reservation page, any open ManualReviewItems for this booking.
- Recipient: `EMAIL_TO_INTERNAL` (existing env). No new recipient list collection in V1.

Behaviour:

- Each alert is one `ScheduledMessageJob` per booking, per alert key.
- Alert sends never block guest-facing dispatches. If the ops-alerts batch isn't ready, guest rules still ship.
- Per D-6, all three alerts can launch in `enabled=false` mode and OPS flips them on.

---

## 28. Pause, cancel, and disable behavior

Granularity hierarchy, from broad to narrow:

1. **Disable a rule globally** — `MessageAutomationRule.enabled=false`. Orchestrator stops scheduling new jobs for this rule. Already-scheduled jobs keep their state; OPS may bulk-cancel via the queue view.
2. **Disable a rule for one property** — because The Cabin and Valley are separate rule rows, the per-property toggle is identical to (1) for that row.
3. **Stop all future sends for one booking** — pause toggle on `OpsReservationDetail`. Sets every `scheduled` job for that bookingId to `cancelled (reason: paused_per_booking_by_ops)`, and writes a flag the orchestrator checks before re-creating any job for that booking (idempotent: re-enabling is a single click).
4. **Cancel one scheduled job** — single-row action. `status: scheduled → cancelled (reason, actor)`. Audit logged.
5. **Cancel a claimed job (in flight)** — best-effort: the worker checks job status after claim and before dispatch; if `cancelled` by OPS in the meantime, dispatch is aborted. If the provider call has already started, cancel is recorded but not enforced (dispatch completes; mark as `sent_then_cancelled_after` for visibility).

All cancel and pause actions write `AuditEvent` rows via the existing `auditWriter`.

---

## 29. Failure handling

Failure categories, observable outcomes, and ops impact:

| Failure | What the system does | OPS sees |
|---|---|---|
| Provider 5xx, network error | Retry per `maxAttempts` with exponential backoff. | Job stays `scheduled`, `attemptCount > 0`, `lastError` set. |
| Provider auth failure | Terminal. Open high-severity ManualReviewItem `comms_provider_auth_failure`. | Job `failed`, alert in backlog. |
| Template not approved by Meta | Terminal. Open high-severity ManualReviewItem `comms_template_not_approved`. | Job `failed`, alert in backlog. |
| Invalid recipient (WhatsApp number not on WA) | Dispatch `failed`; if strategy is `whatsapp_first_email_fallback`, immediately schedule a follow-up job for email channel with same `scheduledFor` (in the past → claimed on next tick). Persist a `GuestContactPreference` suppression entry `whatsapp_phone_invalid` so future rules skip WA for this phone. | Two dispatches per job: WA failed, email sent. OPS sees both. |
| Recipient suppressed | Job `suppressed`. No dispatch attempt. ManualReviewItem only if suppression reason was a hard bounce that day. | Job `suppressed`. |
| Wrong-property guard tripped | Job `failed` with reason `wrong_property`. High-severity ManualReviewItem `comms_property_mismatch_blocked`. **No dispatch sent.** | Job `failed`, alert in backlog. |
| Booking status not eligible | Job `skipped_status_guard`. No dispatch. | Job `skipped_status_guard`. |
| Booking cancelled between schedule and claim | Job cancelled by cancellation cascade. | Job `cancelled`. |
| Stale payload (date moved between schedule and claim) | Job `failed`; orchestrator re-evaluates and schedules a new job at the new time if applicable. | Job `failed → re-scheduled`. |

Hard rule: **a guard failure never silently swaps to a different template, a different recipient, or a different time.** The only allowed automatic fallback is WhatsApp → email when the strategy says so.

---

## 30. ManualReviewItem categories

New categories added to the existing collection. No schema change.

| Category | Severity | When |
|---|---|---|
| `comms_property_unresolved` | high | Booking has neither cabin nor cabin-type with a `propertyKind`. |
| `comms_property_mismatch_blocked` | high | Resolved `propertyKind` does not match rule's `propertyScope`. |
| `comms_property_kind_missing` | medium | Cabin/CabinType row has no `propertyKind`. |
| `comms_template_not_approved` | high | Provider returned template-not-approved. |
| `comms_provider_auth_failure` | high | Provider auth/credential failure. |
| `comms_phone_invalid` | low | Phone could not be normalised. |
| `comms_phone_not_on_whatsapp` | low | Provider reports number not on WhatsApp. Triggered once per phone. |
| `comms_dispatch_terminal_failure` | medium | Job hit `maxAttempts`. |
| `comms_inbound_stop_keyword` | low | Inbound STOP-keyword received; OPS decides whether to suppress email as well. |
| `comms_missing_guide_url` | medium | Required `guideUrl` variable unresolved. |
| `comms_scheduler_visibility_breach` | medium | Job re-claimed > max times. |

All categories are documented inline in code comments when added; no need to change the `ManualReviewItem` schema.

---

## 31. Idempotency and duplicate-send prevention

Layered defences:

1. **DB uniqueness on `ScheduledMessageJob`.** `(bookingId, ruleKey, scheduledFor)` unique-indexed. A second insertion attempt errors and the orchestrator treats it as "already scheduled".
2. **Atomic claim on the job.** Worker uses `findOneAndUpdate({_id, status:'scheduled'}, {status:'claimed', ...})`. Only one worker can win.
3. **DB uniqueness on `MessageDispatch.idempotencyKey`.** Composite key blocks a second dispatch for the same `(ruleKey, bookingId, scheduledFor, channel)`.
4. **Provider-message id uniqueness.** `(providerName, providerMessageId)` unique-sparse. Same provider id cannot create a second dispatch record.
5. **Visibility timeout.** Stuck `claimed` jobs are reclaimable only up to `reclaimCount=2`; beyond that they fail terminally to avoid infinite loops.
6. **Cancellation cascade.** Status-change handlers and date-edit handlers run inside the existing audit-event transaction pattern; cancelling future jobs is the same write as recording the cancel reason.
7. **Restart drill.** Pre-launch testing must include a PM2 restart mid-tick. The expected result is zero duplicate sends and zero stuck-claimed jobs that didn't recover.

The legacy `idempotencyService` (in-memory) is not used for V1's automation path. It remains in place for the legacy email lifecycle and arrival-instructions code; the new system has its own DB-backed equivalents.

---

## 32. Booking status guards

Per-rule `requiredBookingStatus` enforced at both schedule time and claim time:

- **At schedule time**: orchestrator only enqueues a job if the current status is allowed. For most cases V1 schedules at booking-create-with-confirmed and at status `pending → confirmed`.
- **At claim time**: worker re-reads the booking and re-checks. If status no longer eligible, job is `skipped_status_guard`.

Statuses considered eligible per rule (V1):

- `arrival_instructions_pre_arrival_*`: `['confirmed']`. Not `in_house` (already arrived) or `completed` (already left).
- `ops_alert_*`: `['confirmed', 'in_house']`.

`pending` bookings never receive guest-facing arrival messages because we do not promise a stay we haven't confirmed.

`BOOKING_CONFIRM_WITHOUT_STRIPE=1` interaction (D-12, locked).

V1 rule: **guest-facing automation is blocked, full stop, for any booking confirmed via the `BOOKING_CONFIRM_WITHOUT_STRIPE=1` code path.** This is enforced at both schedule time and claim time.

- **At schedule time.** The orchestrator detects bookings that reached `confirmed` via this path and refuses to enqueue any guest-facing `ScheduledMessageJob` for them. No job is created.
- **At claim time (defence in depth).** Even if a job somehow exists for such a booking (e.g. created before the policy was wired, or via a future-batch flag-flip race), the dispatcher's safety gate re-checks and skips the dispatch with status `skipped_status_guard` and reason `confirmed_without_stripe`.

V1 explicitly does **not** infer "safe to send" from any other field on the booking — `Booking.provenance.source`, channel, intake metadata, or anything else. Heuristic provenance inference is rejected as too risky: an unpaid / manual / dev-mode booking that happens to have the same provenance shape as a legitimate manual reservation must not silently start receiving guest WhatsApp messages.

Exceptions are handled by **manual OPS send** only: an operator can compose and send a one-off message from `OpsReservationDetail` (§26.1, "Manual send"), which is audit-logged and never runs through the automatic rule path.

A future version may introduce an explicit per-booking "automation-safe override" (e.g. an OPS UI toggle that writes a dedicated, audit-logged field). V1 does **not** ship such an override; the default of "blocked" stands until that future spec amendment lands.

Internal OPS alerts (audience `ops`) are evaluated independently. By default they follow the same block rule for `BOOKING_CONFIRM_WITHOUT_STRIPE=1` bookings to avoid noisy alerts on dev/manual rows; whether to relax that for the internal `ops_alert_*` rules is a Batch 12 decision, not a V1 default.

---

## 33. Booking date-change behavior

When a booking's `checkIn` or `checkOut` is edited (legacy admin path **and** ops `editReservationDates`):

- The orchestrator listens to the existing edit hooks (read-only consumer; no modification to booking write code).
- For every `scheduled` or `claimed`-but-not-yet-dispatched job tied to this booking:
  - Recompute the rule's target time against the new dates.
  - If unchanged → leave job as-is.
  - If changed → set old job `status='cancelled' (reason: rescheduled_due_to_date_edit)`, create a new job with the new `scheduledFor`. The new insert may fail on the unique index if the recomputed time matches an existing job — that's fine and means the system was already consistent.
- For dispatched jobs (already sent): nothing is rewritten; the audit trail preserves the original send.

At **claim time** the worker re-checks `payloadSnapshot.checkIn === booking.checkIn`. If mismatched (because a date edit slipped past the edit hook), the job is failed with reason `stale_snapshot` and a new schedule is computed via the orchestrator. This is a defence-in-depth.

---

## 34. Cancellation behavior

When booking status transitions `* → cancelled`:

- Orchestrator listens (read-only) and runs a cascade cancel:
  - All `scheduled` jobs for this bookingId → `cancelled (reason: booking_cancelled)`.
  - All `claimed`-but-not-dispatched jobs → flag set; worker aborts at next pre-dispatch re-check.
  - `sent` jobs are untouched (they happened in the past).
- The cancellation cascade is idempotent. Running it twice is a no-op.
- The cancellation cascade does **not** write to `Booking`. It only writes to `ScheduledMessageJob`, `MessageDispatch`, and `AuditEvent`.

The orchestrator hook is **the only** integration point between the booking domain and the comms domain for cancellation. The hook is a function call from the existing status-change handler. It is wrapped in try/catch and never blocks the booking-status write; failures are logged and surface as ManualReviewItems of category `comms_cancellation_cascade_failed`.

---

## 35. Rollout modes

Rollout progression for guest-facing rules is **two-stage**: `shadow → auto with safety gates`. Manual approval is a separate emergency mode that is **not** part of the rollout progression.

### 35.1 Shadow mode (first stage)

- `MessageAutomationRule.mode = 'shadow'`.
- Jobs are scheduled and claimed normally.
- The dispatcher is called with a `shadow=true` flag.
- The dispatcher renders the message, validates variables, and **does not** call the provider.
- A `MessageDispatch` row is written with `status='accepted'`, `providerMessageId=null`, and a `details.shadow=true` marker.
- No real WhatsApp message and no real email is sent.

Use shadow for the first complete production cycle to confirm:
- Jobs are created at the right time.
- Variable resolution works.
- Property matching works.
- Suppression and status guards behave correctly.

### 35.2 Auto mode with safety gates (second stage, standard production)

- `MessageAutomationRule.mode = 'auto'`.
- Normal flow. Worker claims and dispatches.
- The following **safety gates** are enforced by the orchestrator and worker at all times in auto mode (per D-11):
  1. **Property guard** — refuses any dispatch where the resolved `propertyKind` does not match the rule's `propertyScope`. Mismatch = high-severity ManualReviewItem, no send.
  2. **Status guard** — refuses if booking status is not in the rule's `requiredBookingStatus`.
  3. **`BOOKING_CONFIRM_WITHOUT_STRIPE` block (D-12)** — refuses if the booking reached `confirmed` via the `BOOKING_CONFIRM_WITHOUT_STRIPE=1` code path. No provenance inference. Exceptions handled by manual OPS send only. See §32.
  4. **Payment guard** — when `requirePaidIfStripe=true`, refuses if `booking.stripePaymentIntentId` is null and `paymentMethod` is not a confirmed gift-voucher redemption.
  5. **Staleness guard** — refuses if `payloadSnapshot.checkIn !== booking.checkIn`.
  6. **Suppression guard** — refuses the relevant channel if `GuestContactPreference` marks it suppressed.
  7. **Phone validity guard** — degrades WhatsApp to email if `phoneStatus !== 'valid'`.
  8. **Per-rule daily cap** (defensive) — environment-configurable maximum dispatches per rule per day; exceeding the cap pauses the rule and opens a ManualReviewItem.
  9. **Per-booking dedup guard** — refuses if a non-failed `MessageDispatch` already exists for `(bookingId, ruleKey, scheduledFor, channel)`.

Auto mode is the **default production state** for V1 once a rule has completed at least one shadow cycle and the dispatches have been reviewed. There is no required intermediate manual-approve stage.

### 35.3 Manual-approve (emergency / override mode)

Manual-approve is **not** a rollout stage. It exists as an emergency mode that OPS can flip on for a single rule if a problem is detected (e.g. a content issue, a provider incident, an unverified property mapping) and OPS wants to inspect each pending dispatch individually until the issue is resolved.

- `MessageAutomationRule.mode = 'manual_approve'`.
- Jobs are scheduled normally and reach `scheduled` status.
- The worker does **not** auto-claim manual-approve jobs.
- OPS sees them in `OpsScheduledMessages` with an "Approve to send" action.
- OPS approval flips the job to `claimed` and the worker dispatches on its next tick.
- OPS rejection cancels the job with reason `ops_rejected_in_manual_approve`.

Use cases:
- Reacting to a content bug spotted in production without disabling the rule entirely.
- Spot-checking a small batch after a template or rule change.
- Holding sends while a provider incident is being investigated.

Operational expectation: a rule in `manual_approve` for more than 7 days should be either fixed and moved back to `auto`, or disabled. Long-lived manual-approve mode defeats the system's purpose.

### 35.4 Rollout progression for V1 guest rules

```
Day 0:   enable rule in shadow mode. Run for one full production cycle that includes at least
         one confirmed booking with check-in within the next 5 days.
Day N:   review every shadow-created dispatch row, every rendered payload, every property match,
         and every guard skip. Sign-off recorded against the rule.
Day N+1: flip rule to auto mode with all safety gates enabled.
         Per-rule daily cap starts conservative (e.g. 10/day) and is raised as confidence grows.
```

Manual-approve is **not** in this progression and **not** required between shadow and auto.

---

## 36. Testing strategy

V1's tests are structured around `node:test` (consistent with existing `server/scripts/*.test.cjs`).

Unit tests:

- `propertyKind` resolver (cabin / cabinType / unresolved).
- Phone normaliser (valid / ambiguous / invalid).
- Orchestrator schedule math (Europe/Sofia → UTC conversion across DST boundaries; T-72h at Sofia 17:00 for a 14:00 check-in date — per Batch 0 D-5).
- Suppression lookup.
- Guard suite ordering and short-circuit.
- Idempotency-key composition.
- Dispatcher template-variable validation against `variableSchema`.
- Adapter mocks: success, retryable failure, terminal failure, malformed provider response.

Integration tests:

- End-to-end with `mongodb-memory-server`: schedule → claim → dispatch → mark sent → webhook event ingested → `MessageDeliveryEvent` written.
- Cancellation cascade on `booking → cancelled`.
- Date edit reschedule path.
- Per-property guard tripping (wrong-property scenario must produce a `failed` job and a `comms_property_mismatch_blocked` review item).
- Shadow-mode dispatch produces no provider call.
- Manual-approve mode does not auto-claim.

Restart-safety tests (manual checklist in staging):

- Stop the worker process mid-dispatch (after claim, before provider call). Restart. Verify the job is reclaimed exactly once and no duplicate dispatch occurs.

Contract tests:

- Legacy email pipeline (`bookingLifecycleEmailService` contract tests at `server/scripts/bookingLifecycleEmail.contract.test.cjs`) must remain green. The V1 work must add a smoke run of these to CI/local checklists to confirm zero regression.
- Gift voucher email tests (`giftVoucherBatch5EmailDelivery.test.cjs`) must remain green.

V1 does not require live-provider end-to-end tests. Adapters are unit-tested with HTTP fakes; sandbox provider tests are documented in §37 but optional.

---

## 37. Deployment considerations

Env vars introduced (each batch documents its own additions; the V1 superset):

```
# Worker
MESSAGE_WORKER_ENABLED=0|1
MESSAGE_WORKER_TICK_MS=60000
MESSAGE_WORKER_SWEEPER_TICK_MS=120000
MESSAGE_WORKER_BATCH_SIZE=50
MESSAGE_WORKER_VISIBILITY_TIMEOUT_MS=300000

# Provider selection
WHATSAPP_PROVIDER=meta|twilio|three_sixty_dialog

# Provider credentials (only the chosen one's set is required)
WHATSAPP_META_PHONE_NUMBER_ID=
WHATSAPP_META_BUSINESS_ACCOUNT_ID=
WHATSAPP_META_TOKEN=
WHATSAPP_META_APP_SECRET=
WHATSAPP_META_WEBHOOK_VERIFY_TOKEN=

WHATSAPP_TWILIO_ACCOUNT_SID=
WHATSAPP_TWILIO_AUTH_TOKEN=
WHATSAPP_TWILIO_FROM=
WHATSAPP_TWILIO_WEBHOOK_AUTH_TOKEN=

WHATSAPP_THREE_SIXTY_DIALOG_API_KEY=
WHATSAPP_THREE_SIXTY_DIALOG_WEBHOOK_SECRET=

# Sender + ops
OPS_SUPPORT_PHONE_E164=+359...
DEFAULT_PHONE_COUNTRY=BG

# Locale
COMMS_DEFAULT_LOCALE=en
```

PM2:

- V1 may run the worker inside the main app. If D-7 chooses split:
  - New ecosystem entry `driftdwells-worker` runs the same codebase with `MESSAGE_WORKER_ENABLED=1` and the main app with `MESSAGE_WORKER_ENABLED=0`.
  - Both processes connect to the same MongoDB.
  - No shared in-memory state.

Database:

- MongoDB only. No Redis, no new infra.
- New indexes per §11–§16. All created via Mongoose schema definitions on first connect (no manual migration script needed beyond the propertyKind backfill).

Webhooks:

- Add WhatsApp provider webhook URL to the chosen provider's console once credentials are in place.
- Stripe and Postmark webhooks are untouched.

Reverse proxy:

- Add the new webhook path(s) to the existing CORS/proxy whitelist. No HTTPS termination change.

Observability:

- V1 uses console logging (existing pattern).
- OPS UI is the operator dashboard.
- No external APM in V1.

---

## 38. Stop-go checklist before implementation

Implementation does not start until **every** item below has a recorded answer / artefact.

- [x] D-1 through D-12 from §4 are answered (Batch 0 decisions locked in §4.1). Remaining sub-decisions (final template copy, Sofia hour-of-day, exact consent copy) tracked in §4 status column.
- [ ] Vision doc (`01_VISION_AND_BOUNDARIES.md`) is signed off as binding.
- [ ] Property backfill audit list (§7 phase 1) is generated and reviewed by Jose. No writes yet.
- [ ] Meta-template submissions for `arrival_3d_the_cabin_v1` and `arrival_3d_the_valley_v1` are drafted (copy + variable schema match this doc).
- [ ] Sender WhatsApp number is confirmed; the `BookingSuccess.jsx` number inconsistency is acknowledged (no code change yet).
- [ ] Backoffice migration rules (`docs/backoffice-migration/03_RULES_FOR_CURSOR.md`) are re-read; this work fits inside them (OPS only, shared services).
- [ ] Engineering owner confirmed for each batch.
- [ ] `03_BATCH_PLAN.md` is written and approved.

Until then, the codebase remains untouched.

---

## 39. Files likely touched later

Recorded for transparency. None are touched in this document.

New (created in implementation batches):

- `server/services/messageAutomation/orchestrator.js`
- `server/services/messageAutomation/schedulerWorker.js`
- `server/services/messageAutomation/dispatcher.js`
- `server/services/messageAutomation/providers/whatsapp/<adapter>.js`
- `server/services/messageAutomation/providers/email/emailAdapter.js` (wraps `emailService`)
- `server/services/messageAutomation/templates/renderer.js`
- `server/services/messageAutomation/phoneNormalizer.js`
- `server/services/messageAutomation/propertyResolver.js`
- `server/models/MessageTemplate.js`
- `server/models/MessageAutomationRule.js`
- `server/models/ScheduledMessageJob.js`
- `server/models/MessageDispatch.js`
- `server/models/MessageDeliveryEvent.js`
- `server/models/GuestContactPreference.js`
- `server/routes/messageAutomationWebhookRoutes.js`
- `server/routes/ops/modules/messageAutomationRoutes.js`
- `server/scripts/backfillPropertyKind.js`
- `client/src/pages/ops/OpsMessageTemplates.jsx`
- `client/src/pages/ops/OpsAutomationRules.jsx`
- `client/src/pages/ops/OpsScheduledMessages.jsx`
- Augmentations to `client/src/pages/ops/OpsReservationDetail.jsx` (added panel only, no existing behaviour changed).

Possibly touched (additive only, no behaviour change):

- `server/server.js` — add worker startup behind `MESSAGE_WORKER_ENABLED`. Add webhook route mount.
- `server/services/ops/readModels/reviewsCommsReadModel.js` — extend with new counters (no existing field removed).
- `server/models/Cabin.js`, `server/models/CabinType.js` — add `propertyKind` field (optional during migration).
- `client/src/services/opsApi.js` — add new endpoints.
- `package.json` (server) — add `libphonenumber-js` and the chosen WhatsApp provider SDK.
- `.env.example` — add new env block.

Explicitly untouched:

- `server/services/emailService.js`
- `server/services/bookingLifecycleEmailService.js`
- `server/services/emailTemplates/guestLifecycleLayout.js` (read-only consumer of)
- `server/routes/emailWebhookRoutes.js`
- `server/models/EmailEvent.js`
- `server/routes/bookingRoutes.js` (booking-create flow)
- `server/routes/stripeWebhookRoutes.js`
- `server/services/giftVouchers/*`
- `server/services/ops/ingestion/icalSyncScheduler.js`
- `server/services/ops/ingestion/stripeIngestionService.js`
- Anything under `server/services/ops/creator*`, `server/services/creators*`, `server/services/creatorPortal*`.
- All gift voucher templates and tests.

---

## 40. Risks and mitigations

Live risks and their concrete mitigations in V1.

| Risk | Mitigation |
|---|---|
| Duplicate WhatsApp send after restart. | DB uniqueness on `(bookingId, ruleKey, scheduledFor)`; atomic claim; dispatch idempotency key; restart drill in staging before launch. |
| Wrong-property dispatch. | Required persisted `propertyKind`; orchestrator refuses scope mismatch; high-severity ManualReviewItem on every mismatch. |
| Cancelled booking still receives arrival message. | Cascade cancel on `status → cancelled`; claim-time re-check; date-edit re-check. |
| Date edit slips past orchestrator hook. | Claim-time staleness check (`payloadSnapshot.checkIn === booking.checkIn`). |
| Invalid phone causes silent miss. | Phone normalised at capture, status persisted; channel degrades to email; OPS visibility list. |
| Meta template rejected after launch. | Detected via provider error code; terminal failure + high-severity item; rules can be flipped to email-only or disabled per property without code change. |
| Provider lock-in. | Adapter abstraction; one env var swaps providers; no business logic touches the SDK. |
| Locale mismatch (BG guest receives EN). | V1 ships EN only; copy acknowledges. Structure supports BG in `MessageTemplate.locale`. |
| Scheduler clock drift / DST bug. | All scheduling math centralised in one utility; unit tests cross DST. UTC stored; Europe/Sofia only at the boundary. |
| Worker dies mid-dispatch. | Visibility timeout + reclaim count; idempotency key prevents duplicate provider calls. |
| `BOOKING_CONFIRM_WITHOUT_STRIPE` produces no-payment "confirmed" bookings that should not receive paid-reminder messages. | `requirePaidIfStripe=true` on the rule + claim-time check. |
| EmailEvent overload from also tracking WhatsApp. | Separate `MessageDeliveryEvent` collection; legacy `EmailEvent` untouched. |
| Two WhatsApp numbers in the codebase cause guest confusion. | Decision D-1 records the authoritative number; OPS_SUPPORT_PHONE_E164 env is the single source for templates; the `BookingSuccess.jsx` inconsistency is fixed in a separate, audited code batch (not part of this spec). |
| Hidden cost of "simple" MongoDB queue. | Volume assumption (V1 target: < 50 dispatches/day, peak 200/day during high season). Tripwire: if daily count exceeds 500 sustained, revisit with broker + cluster. |
| Scope creep ("just one more rule"). | New rules are config-only; no code change. The spec explicitly limits V1 to the arrival rule plus optional ops alerts. |

---

End of V1 spec. Implementation cannot start until §38 is satisfied. The next document in this folder is `03_BATCH_PLAN.md`, which splits this spec into reversible, audited batches.
