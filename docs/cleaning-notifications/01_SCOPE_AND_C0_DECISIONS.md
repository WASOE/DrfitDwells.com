# Cleaning Notifications — Scope & C0 Decisions

Status: **C0 locked** (decision record)  
Owner: Product + engineering  
Related: Guest Message Automation (GMA) — `docs/guest-message-automation/`  
Implementation: **Not started** (C1+ blocked on guest GMA shadow-live gate; see §C0.10)

This document records the **locked C0 decisions** for automated notifications to cleaning staff, reusing the GMA stack. It supersedes open questions from the cleaning-notifications audit (conversation, 2026). **No code, DB, env, rules, or templates in this phase.**

---

## Goal (unchanged)

Automated notifications to assigned cleaners via GMA:

- **Channel:** `whatsapp_first_email_fallback` (same strategy as guest arrival rules).
- **Triggers:** (a) day-before checkout; (b) checkout today (clean needed).
- **Recipient:** assigned cleaner(s) per **propertyKind** — not the guest, not a shared OPS inbox.
- **Safety:** identical to guest GMA — new rules ship `enabled: false`, `mode: 'shadow'`, templates `draft`, no env flags, insert-only seed, no sends until explicit rollout.

---

## C0 — Locked decisions

### C0.1 Assignment granularity

**Per `propertyKind` only** (`cabin` vs `valley`).  
**Not** per unit (`cabinId`, `cabinTypeId`, or individual cabin row).

### C0.2 Cardinality & preferred data model

- A **list** of cleaners per `propertyKind`.
- **Notify ALL** assigned cleaners for that propertyKind on each qualifying checkout event.
- **Preferred model (default):** `propertyKinds` array on the cleaner’s `OpsUser` row, e.g. `OpsUser.propertyKinds: ['cabin' | 'valley']`.
- **Alternative (defer unless needed):** `CleanerPropertyAssignment` collection when assignment metadata is required (priority, active date ranges, per-kind overrides). Default to **array-on-user** unless a later batch proves metadata is necessary.

### C0.3 Recipient resolution — fan-out (structural)

Recipient resolution for cleaners is **fan-out**, not single-recipient:

- One checkout event → **N** assigned cleaners for that booking’s `propertyKind`.
- This **differs structurally** from the guest path (always exactly one guest).
- **`resolveRecipient` (cleaner branch) must return a list** of recipients (or equivalent multi-recipient contract).
- **Dispatcher must create one `MessageDispatch` per assigned cleaner** (per channel attempt), with stable idempotency keys that include cleaner identity.
- **C4 batch must implement fan-out explicitly** — do **not** reuse the guest single-recipient shape or a single-dispatch assumption.

### C0.4 Copy & Meta template scope

- **Distinct copy per property** (`cabin` vs `valley`).
- Property difference is **access/logistics** (e.g. Valley last-km on foot/jeep/ATV vs Cabin park-and-walk); **operational core is shared** across properties where copy allows.
- **Meta (WhatsApp) total scope:**

  `2 triggers × 2 properties (cabin/valley) × 2 locales (en/bg) = **8** WhatsApp Meta templates`

- **Email fallback:** **8** email templates (same trigger × property × locale matrix).
- Each distinct WhatsApp message body/locale requires its **own Meta-approved template**.

### C0.5 Triggers (scheduling)

Unchanged from audit — use existing GMA `time_relative_to_check_out` orchestrator path:

| Trigger | `triggerType` | `triggerConfig` (Sofia) |
|---------|-------------|-------------------------|
| Day-before checkout | `time_relative_to_check_out` | `offsetHours: -24`, morning send (Sofia hour TBD in template seed, e.g. 09:00) |
| Checkout today | `time_relative_to_check_out` | `offsetHours: 0`, ~08:00 Sofia (align with `ops_alert_guest_checkout_today` pattern) |

Scheduling hooks: existing orchestrator booking lifecycle (no new checkout hook required). `ops_alert_guest_checkout_today` proves checkout-day **scheduling mechanism** only; cleaner rules are new rows (audience, recipient, channel, copy).

### C0.6 Payment guard — in-scope prerequisite (not deferred)

**Locked:** fixing payment-guard behaviour for cleaner rules is **in-scope for this feature**, not deferred hygiene.

**Problem:** `ruleApplicableTo()` in `messageOrchestrator` applies `passesPaymentProofGuard()` to **all** rules and does **not** honor `requirePaidIfStripe: false` on the rule row (same gap exists at dispatch). Cleaner notifications **must not** be suppressed by Stripe/payment state — a physical checkout needs cleaning regardless of payment proof.

**Requirement:** Cleaner rules must schedule and dispatch regardless of booking payment method/PI state. Resolve via cleaner-specific guard behaviour and/or **honoring `requirePaidIfStripe: false`** for cleaner audience rules. Silent skip = invisible failure (unacceptable).

**Batch placement:** Address in **C3 or C4** before any cleaner shadow verification (C8).

### C0.7 Variables — no guest PII

- Build a separate **`CLEANER_VARIABLE_SCHEMA`** (and resolver); do **not** extend guest/OPS schemas in place.
- **Must NOT include:** `guestFirstName`, guest email, guest phone, or any other guest-identifying fields.
- **Allowed (non-exhaustive):** `propertyName`, `unitLabel`, `checkOutDate`, `checkInDate` (turnaround context), `cleaningNotes` (`Booking.cleaningNotes`), property access / meeting-point info, checkout time.

### C0.8 Audience enum

- New audience value: **`audience: 'cleaner'`** in `messagingEnums` + `MessageAutomationRule` enum.
- **Do NOT** reuse `audience: 'ops'` — that routes to `EMAIL_TO_INTERNAL` shared inbox and **rejects WhatsApp**.

### C0.9 Safety posture

Identical to guest GMA for all new cleaner artefacts:

- Rules: `enabled: false`, `mode: 'shadow'`
- Templates: `draft` until human/Meta approval
- No production env flags enabled for orchestrator/scheduler/dispatcher/real provider as part of seed
- Insert-only seed scripts (no silent updates to existing rows)

### C0.10 Build sequence & Meta parallelism

- **Cleaner implementation batches C1 onward wait** until **Cabin guest GMA rollout reaches shadow-live** (guest rules enabled in shadow, orchestrator/worker/dispatcher path exercised in production without real guest sends).
- **Exception — Meta submission:** Cleaner **WhatsApp Meta templates should be submitted together with guest WhatsApp templates** so Meta review clocks run **in parallel**.
- **Implication:** Lock cleaner **copy** early (before C1 code) to support joint Meta submission even while cleaner code is gated.

---

## Audit summary (baseline facts)

| Question | Answer |
|----------|--------|
| Dedicated `Cleaner` model? | **No** — cleaners are `OpsUser` with `role: 'cleaner'` |
| Phone on cleaner today? | **No** — email + name only |
| Per-property assignment today? | **No** — schedule is booking/checkout-derived; no roster |
| GMA reuse without new work? | **No** — needs `cleaner` audience, fan-out resolver, staff variables, rules/templates |
| Largest prerequisite | **Contact + assignment model** (+ payment guard fix) |

**Primary cleaning feature paths (reference):** `OpsUser`, `CleaningRecord`, `cleaningRoutes.js`, `cleaningReadModel.js`, `OpsCleaningCalendar.jsx`, `OpsUsers.jsx`, `OpsCleaningSettings.jsx`.

**Primary GMA insertion points (reference):** `messageDispatcher.resolveRecipient`, `messageOrchestrator.ruleApplicableTo` / `computeScheduledForForRule`, `messagingEnums`, `messageAutomationRules.js` / seed, `messageVariableResolver` (fork for cleaner).

---

## Batch breakdown (C1–C10)

Each batch is independently shippable and **safe-inert** by default unless noted. **C1+ code waits on C0.10 guest shadow-live gate** (except early copy lock / Meta submission per C0.10).

| Batch | Title | Scope |
|-------|--------|--------|
| **C0** | Decisions | **Done** — this document |
| **C1** | Contact + assignment (array-on-user) | Add `OpsUser.phone` (E.164), optional `locale`; `OpsUser.propertyKinds: ['cabin'\|'valley'][]`; validation; defaults safe/empty. No GMA yet. |
| **C2** | OPS admin UI | `/ops/users` (or cleaning settings): edit phone, assign propertyKinds list; no sends |
| **C3** | GMA audience + payment guard | `audience: 'cleaner'` enum; orchestrator honors `requirePaidIfStripe` and/or cleaner-specific guard so payment state never blocks cleaner jobs; job rows carry `audience: 'cleaner'` |
| **C4** | Fan-out recipient resolver + dispatch | **Explicit fan-out:** cleaner branch returns **list** of recipients; **one `MessageDispatch` per cleaner** per channel; staff consent path (not `GuestContactPreference` guest logic); idempotency keys include cleaner id; **do not reuse guest single-recipient shape** |
| **C5** | Cleaner variable resolver | `resolveCleanerVariables` + `CLEANER_VARIABLE_SCHEMA`; no guest PII; wire preview if needed |
| **C6** | Rules + templates seed | 2 triggers × 2 propertyScopes × channels; 8 WA + 8 email template rows (draft); rules `enabled:false`, `mode:'shadow'`, `whatsapp_first_email_fallback`; insert-only seed |
| **C7** | OPS visibility | List cleaner rules on `/ops/messaging`; optional staff-safe preview on reservation (compose-only) |
| **C8** | Shadow verification | Staging/prod shadow: enable cleaner rule(s); verify jobs + shadow dispatches + fan-out per cleaner; no real WA/email |
| **C9** | Meta + human approval | Submit **8** WA templates to Meta (parallel with guest WA per C0.10); approve email copy; approval scripts |
| **C10** | Rollout | Enable shadow rules in prod; `auto`/real sends only under explicit programme (analogous to guest batch 14) |

---

## Explicit out of scope (C0)

- Per-`cabinId` assignment
- Notifying a single “primary” cleaner only (must notify all assigned)
- Reusing `audience: 'ops'` or `EMAIL_TO_INTERNAL` for cleaners
- Guest PII in cleaner templates
- Deferring payment-guard fix
- Implementation code, DB migrations, env changes, or sends in C0

---

## Risks (carried from audit, updated for C0)

| Risk | Mitigation |
|------|------------|
| Fan-out/idempotency bugs → duplicate or missed cleaner messages | C4 tests per cleaner per job; explicit idempotency key shape |
| Payment guard silently skips cleaner jobs | C0.6 — fix before C8 |
| Guest PII leak via shared resolver | C0.7 — separate schema |
| Meta template count / copy drift | C0.4 matrix; lock copy early for parallel Meta (C0.10) |
| Cleaner code before guest shadow-live destabilises guest rollout | C0.10 gate on C1+ |
| `propertyKinds` on user insufficient later | C0.2 — migrate to assignment collection only if metadata needed |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-09 | C0 decisions locked and recorded (this document) |
