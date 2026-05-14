# Guest Message Automation — 01: Vision & Boundaries

Status: design lock, V0 (vision)
Owner: Jose (product), engineering (implementation)
Supersedes: nothing
Related (read for inventory, not for scope): `EMAIL_WEBHOOK_SETUP.md`, `docs/email/BOOKING_EMAIL_TEMPLATE_SYSTEM_MASTER.md`, `docs/backoffice-migration/`

This is the **source-of-truth** document for the Drift & Dwells Guest Communication Automation system. It defines vision, boundaries, principles, and product direction only. It contains no code, no schemas, no migration steps, and no implementation details beyond architectural boundaries. Subsequent documents in this folder will translate this into a V1 spec and implementation batches.

---

## 1. Purpose

Drift & Dwells operates two off-grid stays in Bulgaria — **The Cabin** and **The Valley** — where guest experience depends on practical, timely, accurate information delivered before, during, and after the stay (directions, transfer logistics, arrival window, safety notes, weather caveats, checkout details). Today most of this communication is manual.

The Guest Communication Automation system exists to:

- Replace error-prone manual sending with a small set of well-defined automatic flows, plus durable manual controls.
- Deliver the right operational information, to the right guest, at the right time, on the right channel.
- Keep WhatsApp and email as **separate first-class channels**, with WhatsApp generally primary for time-sensitive guest operations.
- Give OPS a single place to edit templates, monitor delivery, intervene on a single booking, or stop a flow per property/rule.
- Stay strictly **operational / transactional**. It is not a marketing tool.

This system is internal infrastructure. It is not a product feature shipped to guests, and it must never feel like one.

---

## 2. Product vision

A small, durable, internal automation that:

- Knows that a booking exists.
- Knows which property the booking is for (The Cabin or The Valley) via a real persisted field, never via string heuristics.
- Knows what should be communicated at each lifecycle moment, per property.
- Picks the right channel (WhatsApp first, email fallback, or one of them only) based on a configurable strategy.
- Schedules the message in a durable queue.
- Sends it once, via a provider-agnostic adapter.
- Records what happened.
- Lets OPS see, pause, cancel, retry, or override anything individually, without code changes.

The vision is **boring, observable, and reversible**. No clever side-effects, no implicit behaviour, no flow that only one person understands.

---

## 3. Business reason

- **Guest experience.** Off-grid arrivals are sensitive. Missing or wrong instructions cause delays, lost guests, and bad reviews. Automation makes the right information arrive at the right time, every time.
- **Operational cost.** Each manual message takes Jose's time and is the most common interrupt during peak season. Automation removes a recurring, low-leverage task.
- **Risk reduction.** Today, property differentiation between The Cabin and The Valley depends on fragile heuristics. A persisted property model and per-property templates eliminate the entire class of "wrong-property message" incidents.
- **Future capability.** Once the operational core is solid, the same infrastructure can later host segmented mailing for past guests and leads — without re-architecting from scratch.

---

## 4. What the system must eventually control

The system must eventually own, end-to-end, the following operational guest communication moments. Each is a candidate flow; the system must be capable of expressing all of them. **V1 will only ship one of them** (see §16).

- **Pre-arrival instructions.** What to bring, what to expect, what time to be at the meeting point, weather caveats, transfer logistics.
- **Arrival-day messages.** Confirmation that the guest is on track, last-minute changes (road state, transfer adjustments), point-of-contact reminder.
- **Transport coordination.** For The Valley: jeep / horse / ATV pickup confirmation, time window, what3words / GPS. For The Cabin: parking / road advisory.
- **Check-in help.** Wifi, heating, water, hot tub basics, safety quick-card.
- **During-stay support.** Mid-stay nudge (only if useful), help reminder. Manual-approve only by default.
- **Checkout reminders.** Departure time, leaving instructions, key/lock-up notes.
- **Post-stay messages.** Thank-you, retention messages classified as marketing-adjacent and gated by future opt-in (out of V1).
- **Internal OPS alerts.** New booking, status changes that need attention, failed send escalations, suspected wrong-property dispatch, scheduled-job anomalies. Routed to ops channels (email at minimum; WhatsApp ops-channel later if simple).

Each of these is a "flow". Each flow is described declaratively as a **rule** (trigger + timing + property + channel strategy + template). The system never hard-codes flows.

---

## 5. Initial scope

V1 covers **guests with confirmed bookings made through the direct Drift & Dwells site** only.

- **In scope:** bookings persisted in the `Booking` collection with a guest identity (email + normalisable phone) and a property reference (`Cabin` or `CabinType`).
- **Out of scope for V1:** leads, newsletter subscribers, marketing list contacts, OTA bookings (Airbnb, Booking.com) imported via channels without a verified phone, and gift voucher recipients.

The system must be agnostic enough that adding non-booking audiences later is a configuration change, not a redesign — but V1 does not ship that.

---

## 6. Future scope

These are explicit follow-on capabilities, listed so the architecture leaves room for them. None of them are V1.

- **Mailing list segmentation.** Past-guest segments, dormant segments, "looking but didn't book" segments.
- **Leads vs guests.** Distinct lifecycle for leads (inquiry, abandoned-quote, follow-up) vs confirmed guests.
- **Targeted email later.** Editorial / seasonal / product updates with proper marketing consent, suppression list, and unsubscribe flow.
- **OTA / multi-channel guests.** Same pipeline, sourced from a normalised guest contact, with the same suppression rules.
- **BG locale.** Structure ready from V1; BG copy and Meta-approved BG templates come later.
- **Two-way conversation history.** Inbound webhook events captured per dispatch (for context), without building an ops inbox replacement.

The boundary is firm: marketing-style automation is **never** added inside the operational rule engine without first introducing a separate marketing consent surface.

---

## 7. Channel model

WhatsApp and email are **separate channels**. The system never collapses them into a single abstract "message".

A rule can be configured with one of the following channel strategies:

- `whatsapp_only` — send via WhatsApp; if not possible, the rule resolves to "skipped, recorded, optionally escalated".
- `email_only` — send via email; equivalent skip behaviour.
- `whatsapp_first_email_fallback` — attempt WhatsApp; on hard failure / no consent / invalid phone, send the equivalent email template.
- `both` — send both, independently and idempotently. Used rarely (e.g. critical arrival info where redundancy is justified).

Constraints:

- WhatsApp business-initiated messages outside the customer-service window require Meta-approved templates. The system must treat WhatsApp as **template-driven** for any scheduled outbound; free-form is allowed only when an open 24h window is detected, and only for manual ops sends.
- Email is free-form by template (HTML + plain text); content lives in the same template store but as a separate template record per channel.
- Channel-specific failures must not silently swap channels mid-flight unless the rule's strategy says so.

---

## 8. Template model

Templates are **first-class persisted records**, not code constants.

Each template has:

- A stable `key` (e.g. `arrival_3d_the_cabin`, `arrival_3d_the_valley`).
- A `channel` (`email` | `whatsapp`).
- A `locale` (`en` for V1; `bg` later).
- A `propertyKind` scope (`cabin` | `valley` | `any`).
- A `variableSchema` describing what variables it expects (guest first name, check-in date, meeting point label, map URL, host phone, etc.).
- For WhatsApp: the Meta-approved `templateName` plus the Meta `locale` code.
- For email: subject + body markup using the existing branded shell.
- A `version`. Templates are immutable once approved; new edits create a new version. Old dispatches keep referring to the version they used.
- A `status`: `draft` | `approved` | `disabled`.

OPS edits templates inside the OPS UI. Editing produces a new version; approval is required before the new version is used by automatic rules. Versioning is not required in V1's first iteration but the schema must leave room for it.

Templates are **property-specific** by design. The Cabin and The Valley do not share a template instance, even if their copy is similar. Mixing them is impossible by construction, not by convention.

Variables are typed and explicit. Free-form interpolation against a booking object is forbidden — the orchestrator builds a `payloadSnapshot` at schedule time, the template consumes only declared variables.

---

## 9. Strategy model

A **strategy** is a declarative rule that ties a trigger to one or more templates and a channel strategy. The OPS UI can eventually control, per rule:

- Trigger type (booking status change, time relative to check-in/check-out, manual, etc.).
- Trigger configuration (e.g. "T-72h (3 days) before check-in, at Sofia 17:00").
- Property scope (`cabin` | `valley` | `any`).
- Channel strategy (per §7).
- Template references per channel + locale.
- Required consent (`transactional` for V1; `marketing` when introduced).
- Enabled / disabled toggle.
- Mode (`auto` | `manual_approve`) — manual-approve means the system schedules the job but holds it for OPS confirmation before dispatch.
- Fallback behaviour: what to do when the primary channel cannot send.

V1 ships with the rule engine plumbed but only **one rule** active. Adding flows is a config / template change, never a code change.

---

## 10. Property boundaries

The Cabin and The Valley are **fully separate** for messaging purposes.

- Each rule, template, and dispatch references a `propertyKind` derived from a **persisted field** on `Cabin` and `CabinType`. The exact field name and enum are spec-level decisions deferred to the V1 spec doc.
- The orchestrator refuses to dispatch a rule whose `propertyScope` does not match the booking's resolved `propertyKind`.
- String heuristics like `location.toLowerCase().includes('valley')` are **forbidden** in this system. The existing inline heuristic in the legacy email pipeline is allowed to stay (we are not touching legacy email lifecycle code) but must not be propagated into the new pipeline.
- A booking that cannot resolve a `propertyKind` is treated as a configuration error: no automatic dispatch, escalation to ManualReviewItem.

---

## 11. OPS requirements

OPS is the **only** operating interface for this system. Admin (legacy) does not gain new messaging UI.

OPS must be able to:

- **Edit templates** (per channel, per locale, per property) and submit a new version.
- **Enable / disable a rule** globally without code changes.
- **Stop a rule for one property** without affecting the other (e.g. pause pre-arrival for The Valley during a road closure, leave The Cabin running).
- **Pause automation for one booking** (suspend all future scheduled jobs for that bookingId) without cancelling the booking.
- **View upcoming messages** for a given booking (the queue of scheduled jobs) and across all bookings.
- **View message history** per booking, per channel, with status (sent / failed / skipped / suppressed) and provider delivery events (delivered / read / bounced / spam complaint).
- **View failed, skipped, and suppressed messages** as a filterable list, ideally surfaced through the existing ManualReviewItem backlog where appropriate.
- **Cancel a single scheduled message** before dispatch.
- **Manually trigger a send** (one-off send of a template against a booking, with preview).
- **Preview before send** for any manual dispatch.

Granularity rule: OPS must be able to act at the **rule level, property level, booking level, and individual scheduled-job level**. No coarser, no finer.

---

## 12. Scheduler principles

The scheduler is the riskiest moving part. Principles:

- **DB-backed scheduled jobs.** Every future message is a persisted row with `scheduledFor`, `status`, `bookingId`, and rule reference. Memory is never the source of truth.
- **Atomic claiming.** A worker picks a job with a single atomic state transition (`scheduled → claimed`) that fails closed if another worker has it. No double-claim is structurally possible.
- **Unique indexes** enforce idempotency at insertion time, not at dispatch time. The exact composite key is a V1 spec decision; the principle is: "the database refuses to create two jobs for the same `(bookingId, ruleKey, scheduledFor)`".
- **Restart safe.** PM2 restart, deploy, or crash never causes duplicate sends. A claimed-but-not-finished job is reclaimable after a visibility timeout, and the dispatcher checks for an existing successful dispatch before sending.
- **Cancellation on booking lifecycle.** Any `status → cancelled` transition cascade-cancels all future scheduled jobs for that bookingId. Edits to check-in/check-out dates cancel and reschedule affected jobs.
- **Future separate PM2 worker.** V1 may run the worker in-process for simplicity, but the design must support extracting it into a dedicated PM2 process later without code changes beyond startup wiring.
- **Single-leader execution.** Whether through DB advisory lock, environment-controlled startup flag, or another mechanism, only one worker ticks at a time. The exact mechanism is a V1 spec decision; the principle is non-negotiable.
- **No external broker (V1).** No Redis, BullMQ, Agenda, or Temporal dependency in V1. The MongoDB job collection is the queue. If volume ever justifies a real broker, that is a contained refactor behind the same dispatcher interface.

---

## 13. WhatsApp provider principle

The system must own a thin internal interface and treat the provider as a plug-in.

- **Internal `sendTemplate` interface.** All WhatsApp sends go through one function with a stable signature (recipient E.164, template name, locale, structured variables, optional media header). No business logic touches the provider SDK directly.
- **Adapters.** At least one adapter per supported provider, behind the same interface. Initial candidates: Meta WhatsApp Cloud API (direct), Twilio WhatsApp, 360dialog. Final choice is deferred (see §19).
- **No provider-specific data leaking upward.** Provider-specific message IDs, statuses, and webhook payloads are normalised at the adapter boundary into a channel-agnostic `MessageDeliveryEvent` shape.
- **Provider swap is a config change.** Replacing Meta with Twilio (or vice versa) must not require touching rules, templates, the scheduler, or OPS UI.
- **Webhook normalisation.** Each provider has its own signed webhook endpoint, but the persisted events are identical in shape across providers.

The goal is that "which provider we use" becomes an environment + adapter file question, never a system architecture question.

---

## 14. Phone number principles

- **Normalise to E.164** at the point of capture (booking create and contact edit). Persist the normalised string alongside the original raw input.
- **Validate.** If the raw input cannot be parsed into E.164 with a plausible country code, mark it as `invalid` on the booking-side guest contact and do not attempt WhatsApp sends.
- **Fallback.** Invalid phone → channel strategy degrades to `email_only` automatically. The dispatch is recorded as a structured skip, not a silent failure.
- **OPS visibility.** Bookings with invalid phones surface in OPS (per-booking and as a queryable list) so they can be corrected before time-sensitive sends.
- **Country code.** Default country for parsing ambiguous inputs is a V1 spec decision (likely Bulgaria, given primary audience), but the system must allow per-booking override and must accept fully-qualified international numbers as-is.
- **Never auto-guess.** The system never invents a country code. Ambiguous inputs without an inferable country fail validation explicitly.

---

## 15. Consent principles

- **Transactional guest communication is part of the booking operation.** When a guest books an off-grid stay, operationally necessary messages (pre-arrival, arrival, checkout) are part of fulfilling the booking, not a separate marketing relationship. The terms / checkout copy must say so clearly.
- **Avoid unnecessary popups.** Do not introduce a separate transactional-consent dialog. Instead, the existing booking flow's legal acceptance and checkout copy must explicitly include language about operational WhatsApp and email communication for the stay. Wording is a content task tracked separately; the schema must capture acceptance as a snapshot (consistent with how `legalAcceptance` is captured today).
- **Marketing consent is separate and out of V1.** Newsletter, post-stay retention, review requests, seasonal updates are all marketing-adjacent and require their own explicit opt-in surface, suppression list, and unsubscribe flow. None of this ships in V1.
- **Suppression is enforced before send.** Bounce, spam complaint, manual opt-out, and provider hard-failure mark a contact (email or phone) as suppressed for the relevant channel. The dispatcher consults the suppression list at claim time and records the skip.
- **Revocability.** A guest who asks to stop receiving messages is honoured at the contact level immediately, even for transactional messages, with the caveat that we may need to reach them by other means for stay-critical info. The exact UX for revocation is a V1 spec decision.

---

## 16. V1 useful slice

The smallest slice that delivers real value and proves the architecture end-to-end.

**Included in V1:**

- Exactly **one rule** active: **pre-arrival / arrival instructions** at **T-72h (3 days)** before check-in for **both** The Cabin and The Valley (locked in `02_V1_SPEC.md` §4.1 / Batch 0).
- **WhatsApp template first**, with one approved template per property (Meta names `arrival_3d_the_cabin_v1`, `arrival_3d_the_valley_v1`; stable keys `arrival_3d_the_cabin`, `arrival_3d_the_valley`) in `en`.
- **Email fallback** with one matching email template per property in `en`, riding on the existing branded shell from the legacy email pipeline (consumed read-only — we do not modify legacy lifecycle code).
- **Editable templates in OPS** (subject / body / variables) with preview and explicit save.
- **Property-specific templates** referenced by the new `propertyKind` field on `Cabin` / `CabinType`.
- **OPS visibility:** upcoming messages per booking, history per booking, cross-booking failure list.
- **Pause automation for one booking** (suspend all future scheduled jobs for that bookingId).
- **Stop per rule / per property** (rule-level toggle scoped to one property).
- **Internal OPS notifications** for failed sends and wrong-property guards (email-only in V1 if WhatsApp ops-channel is not trivial).
- **Manual-approve mode** available behind a flag, so V1 can ship in "auto" or "manual-approve" depending on confidence.

**Explicitly NOT in V1:**

- Marketing automation of any kind.
- Review requests.
- Post-stay thank-you messages.
- Mid-stay nudges.
- Gift voucher WhatsApp (vouchers continue email-only via their existing pipeline, untouched).
- Lead automation, abandoned-quote follow-up, payment reminders.
- BG locale.
- Two-way conversation UI.
- Multi-instance horizontal scaling beyond single-leader scheduler.

**V1 success criterion:** every confirmed direct booking with a valid phone receives the correct property's arrival template at the scheduled time, with a persisted dispatch record and delivery webhook event, or a ManualReviewItem if anything failed. Zero duplicate sends across one production cycle including at least one PM2 restart.

---

## 17. Explicit non-goals

This section is a hard contract.

- **Not a marketing platform.** No segments, no campaigns, no A/B testing, no broadcast lists.
- **Not a CMS.** No WYSIWYG editor, no rich-content pipeline, no asset library beyond what existing email templates need.
- **Not a CRM.** No lead scoring, no pipeline stages, no contact deduplication beyond what's needed for suppression.
- **Not a two-way inbox.** Inbound provider events are stored as context; replying to guests stays in the guest's WhatsApp app and the host's WhatsApp client.
- **Not a replacement for the legacy email lifecycle pipeline.** Existing booking lifecycle emails (`booking_received`, `booking_confirmed`, `booking_cancelled`, internal new-booking notification, legal acceptance confirmation, gift voucher emails) continue to run on their current pipeline, untouched. The new system runs alongside.
- **Not coupled to booking, payment, Stripe, voucher, creator, referral, attribution, or iCal logic.** It consumes events from those domains as triggers, but never writes to them.
- **Not a generic notification service** for the rest of the platform. Scope is guest communication for confirmed direct bookings.
- **Not a queue infrastructure project.** It uses MongoDB-backed jobs and is allowed to graduate to a real broker only when load justifies it.

---

## 18. Design risks

Risks that the V1 spec must explicitly address.

- **Duplicate sends after restart.** The single largest reputational risk. Mitigated by DB-enforced uniqueness on scheduled jobs and atomic claiming.
- **Wrong-property dispatch.** Catastrophic for guest experience. Mitigated by required `propertyKind` persisted field and orchestrator refusing scope mismatches.
- **Cancelled booking still gets pre-arrival.** Mitigated by cascade-cancel on `status → cancelled` and a re-check at claim time.
- **Invalid phone causes silent miss.** Mitigated by validated normalisation, structured skip, and OPS visibility.
- **Meta template rejection or revocation.** Templates can be rejected or paused by Meta unilaterally. The system must detect provider errors and degrade gracefully (skip + escalate, do not stack failures).
- **Provider lock-in.** Mitigated by the adapter interface; if Meta proves painful, swap to Twilio without changing rules or templates' shape.
- **Locale mismatch.** A guest receives `en` when they expected `bg`. V1 is `en` only, so the risk is bounded to BG-only guests being addressed in English; copy must acknowledge this.
- **Scheduler clock drift / tz bugs.** All scheduling is in Sofia time for property operations, with explicit UTC storage and explicit timezone conversion at the boundary. The V1 spec must define the exact tz contract.
- **OPS visibility lag.** If dispatches take seconds to surface, OPS may double-action a job. Mitigated by optimistic UI on cancel + idempotent backend.
- **EmailEvent overload.** The existing `EmailEvent` collection already mixes Postmark webhook rows and app-side lifecycle rows. Adding WhatsApp into it would compound the overload. V1 introduces a separate, channel-agnostic delivery-event store; `EmailEvent` is not modified.
- **Hidden cost of "free" simplicity.** A MongoDB-backed queue with single-leader execution is simple but caps throughput. Acceptable for current volume; the V1 spec must include the explicit volume assumption and a tripwire for when to revisit.

---

## 19. Decisions still open

These block the V1 spec and must be answered before implementation starts. Each is tracked as an open question and will be closed in `02_V1_SPEC.md` once Jose confirms.

- **Sender identity.** Dedicated Drift & Dwells WhatsApp number vs Jose's private number. Two different numbers already appear in the codebase (`+359 87 634 2540` consistent across chat / guides / arrival; `+359 88 123 4567` in `BookingSuccess.jsx`). The official WABA sender must be picked before any outbound automation runs.
- **Provider choice.** Meta WhatsApp Cloud API direct vs Twilio vs 360dialog. Depends on existing WABA state and Jose's operational preference.
- **Exact V1 templates.** Final copy and variable schema for `arrival_3d_the_cabin` / `arrival_3d_the_valley` in both `whatsapp` and `email` variants (Meta WhatsApp names `arrival_3d_the_cabin_v1`, `arrival_3d_the_valley_v1`). Send timing is **T-72h for both properties**; Sofia send-hour remains a sub-decision.
- **Exact internal OPS alert rules.** Which failures trigger an ops notification, where it lands (email-only vs WhatsApp ops-channel), and severity thresholds.
- **Worker process model.** Whether the scheduler worker starts in-process for V1 or as a separate PM2 process immediately. The architecture supports both; the choice is operational.
- **Property field naming and migration.** Exact field name on `Cabin` / `CabinType` (`propertyKind` is the working name) and how existing rows are backfilled before the field becomes required.
- **Default phone country.** Bulgaria as default for ambiguous phone parsing, or stricter (require explicit country code).
- **Transactional consent wording.** Exact addition to terms / checkout copy that makes operational WhatsApp + email explicit without introducing a separate dialog.
- **Manual-approve flag default.** Whether V1 ships in `auto` mode or in `manual_approve` mode for the first weeks.
- **Cancellation-of-future-jobs semantics.** Whether ops can cancel a single job, all jobs for a booking, or both (recommended: both, but to be confirmed).

---

## 20. Workflow after this document

The next steps are sequenced and gated.

1. **Create V1 spec** as `docs/guest-message-automation/02_V1_SPEC.md`. This document translates the principles above into concrete schemas, exact rule definitions, template variable schemas, OPS UI surface diffs, and a phased rollout plan (shadow-mode → manual-approve → auto). No code yet.
2. **Split into implementation batches** in `docs/guest-message-automation/03_BATCH_PLAN.md`. Each batch is small, reversible, independently shippable, and has a clear before/after parity check.
3. **Cursor audits before each batch** if anything in the codebase has shifted since the last batch. Audits are short, read-only, and produce a written note attached to the batch.
4. **Cursor proposes a plan** per batch (files to add, files left untouched, tests to run, rollback steps). No code.
5. **ChatGPT reviews the plan** for scope drift, hidden coupling, or risk. The review is written and gated.
6. **Cursor implements only after approval.** Each batch ends with a written post-build review, parity check, and an updated batch plan.

Constraints that apply across every batch:

- OPS is the only UI surface. Admin (legacy) gets nothing.
- No changes to booking, payment, Stripe, voucher, creator, referral, attribution, or iCal code.
- No changes to legacy email lifecycle service (`bookingLifecycleEmailService`, `emailService`, `EmailEvent`). The new system runs alongside.
- Every send writes a structured dispatch record. Every failure routes to ManualReviewItem.
- Every batch is reversible by configuration (rules disabled, worker disabled) without code revert.

This document is the lock for vision and boundaries. Subsequent documents may extend it; they cannot contradict it without an explicit amendment line added here.
