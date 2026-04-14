# Booking Email Template System + Preview + Controlled Override — Master lock

Operational feature track for driftdwells.com. This document is the **source of truth** for scope, phases, and workflow. Implementation follows **phase spec → audit → review → approve build → build → post-build review → gate**.

---

## Master feature lock

### Purpose

Deliver **operationally excellent, consistent, and trustworthy** booking lifecycle emails: strong layout and hierarchy, predictable structure, and workflows for **preview before send** and later **safe edit-before-resend**—without replacing the proven **booking lifecycle pipeline** (`bookingLifecycleEmailService`, durable `EmailEvent`, admin resend with optional override recipient).

### Locked end result

- **Visual and structural quality:** Coherent design system (typography, spacing, colors, components, footer, mobile-first layout with sensible desktop width caps).
- **Single composition truth:** The **same server-side composition path** used for real sends is used for **preview** (same booking + entity + template key → same HTML/text subject rules).
- **Preview before send (Phase 2):** Authorized users can render a **read-only preview** (see **Phase 2 locks** below).
- **Controlled override (Phase 3):** Optional edit-before-resend for **manual resend only**; automatic sends always use default approved output (see **Phase 3 locks** below).
- **Strong audit trail:** Sends and override-related actions remain durably logged; preview logging only if explicitly approved later.
- **Backward compatibility:** Resend, override recipient, and Email Activity must not regress unless a phase explicitly approves a breaking change.
- **Operational, not marketing:** Transactional / operational booking communications only—not newsletters, drip campaigns, or a general-purpose ESP/CMS.

### Boundaries

- **In scope:** Server-generated templates for booking lifecycle; admin (and OPS if desired) preview and resend UX improvements on the existing service; audit for template-related actions.
- **Out of scope unless a future phase is opened:** Full marketing email platform, WYSIWYG CMS for non-engineers, A/B testing, multi-language product (unless a later optional phase), changing SMTP/Exim/SES architecture, guest-facing template editor, replacing `bookingLifecycleEmailService` as orchestration source of truth.

### Architecture principles

- **Orchestration unchanged:** `bookingLifecycleEmailService` remains the orchestrator for template choice, entity load, recipient rules.
- **Preview = compose + no transport (Phase 2):** No send, no hidden side effects; preferably **no** durable audit row for preview unless explicitly decided.
- **Override (Phase 3):** Manual resend path only; allowlists, limits, sanitization, explicit confirm; automatic lifecycle sends have **no** override path.
- **Template implementation:** Lives primarily in `emailService` (or a dedicated module it calls), organized (layout partials, tokens).
- **Design quality:** Constrained product surface (Gmail, Apple Mail, Outlook web); mobile-first + desktop max-width per project rules.

### Hard constraints

- Do not break current lifecycle sends, resend API, override recipient, or Email Activity durability.
- Do not reopen completed lifecycle resend work unless audit proves regression or hard dependency.
- No full CMS in early phases; late “template management” stays narrow if approved.
- SMTP path unchanged; tests remain non-SMTP where possible.

### Explicitly not included (unless a future phase opens)

- Newsletter / promotional sends, segmentation, journeys.
- Self-serve arbitrary HTML for untrusted roles.
- Phase 2.3-style actor identity redesign (separate project unless approved).

### Approved amendments (locked)

1. **Internal emails secondary in Phase 1:** Guest lifecycle templates (`booking_received`, `booking_confirmed`, `booking_cancelled`) are **primary**. Internal new-booking notification may **share the same shell** later in Phase 1 but **must not** drive design decisions or expand Phase 1 scope.

2. **Phase 2 preview read-only:** Preview must be **compose-only**, **no send**, **no hidden side effects**. **Preferably no** durable `EmailEvent` (or equivalent) row for preview unless product **explicitly** wants preview history—otherwise Phase 2 must not mix preview and audit policy early.

3. **Phase 3 override manual-only:** Override is for **manual resend only**. **Automatic** lifecycle sends **always** use default approved template output. **No** override path for automatic lifecycle sends.

---

## Locked phases

| Phase | Name | Intent |
|-------|------|--------|
| **1** | Template system foundation | Maintainable template architecture + redesigned guest lifecycle HTML/text first. Internal may share shell; secondary. Same triggers, `EmailEvent` contract, resend behavior. |
| **2** | Authoritative preview | Read-only preview using same composer as production; no send, no hidden side effects; preview audit only if explicitly approved. |
| **3** | Controlled edit-before-resend | Subject/body (or structured blocks) for **manual resend only**; validation, sanitization, durable snapshot; no automatic override. |
| **4** | Template lifecycle / hardening (optional) | One of: versioned templates, a11y pass, localization hook, narrow snippet library—not a full marketing CMS. |

---

## Per-phase workflow (every phase)

1. **Phase spec (plan-only)** — Goal, in/out scope, success criteria, non-goals, dependencies, risks, rollback.
2. **Audit only** — Trace code, APIs, DB, permissions, `EmailEvent`; no implementation.
3. **Review / narrow** — Smallest shippable batch; no SMTP redesign, no marketing creep.
4. **Approve build** — Explicit “build Phase P only” with boundaries.
5. **Build** — Smallest diff; preserve resend + activity.
6. **Post-build review** — Parity, audit, security, layout, no duplicate sends.
7. **Gate** — Close P or fix-only micro-pass; then P+1 spec.

No phase implements until the prior phase is gated closed (except agreed hotfixes).

---

## Recommended first phase

**Phase 1 — Template system foundation.** Preview and override depend on a stable, shared layout and composition surface; visual upgrade with identical semantics is the lowest-risk first increment.

---

## Phase 1 audit prompt (copy to Cursor)

Use verbatim for the Phase 1 **audit-only** pass.

---

**Audit only. Do not build.**

**Project:** driftdwells.com  
**Feature track:** Booking Email Template System + Preview + Controlled Override  
**Current phase:** Phase 1 — Template system foundation (audit only)

**Context to respect**

- Booking lifecycle email system is **live**; **`bookingLifecycleEmailService`** is the **source of truth** for which template runs for which `templateKey`.  
- **`emailService`** (or equivalent) holds **HTML/text generators** today.  
- Admin booking detail: **resend**, **override recipient**, **durable Email Activity** — **must not regress**.  
- SMTP/Exim/SES path is **working**; **do not** propose architecture changes unless a **blocker** is found.  
- Project CSS rules: **mobile-first**, **desktop max-width** for email containers.  
- **Guest lifecycle templates are primary in Phase 1. Internal notifications may follow the same shell, but must not expand scope or drive the redesign.**

**Audit goals**

1. **Inventory** every **booking-related** email generator: **guest lifecycle** (`booking_received`, `booking_confirmed`, `booking_cancelled`), **internal new booking** (if in scope), and any **other** booking-tagged mail that shares the same codepath or styles.  
2. Map **call graph**: from **`sendBookingLifecycleEmail` / `composePayload`** down to **HTML assembly**; note **duplication** (headers, footers, CTAs, support email).  
3. Assess **structure** for a **shared layout shell** (what is common vs template-specific); identify **inline style** hotspots and **Outlook/Gmail** risks.  
4. List **hard constraints** for a foundation refactor: **must preserve** `subject`, **trigger** mapping, **`EmailEvent`** fields (`templateKey`, `lifecycleSource`, `sendStatus`, etc.), and **resend** behavior.  
5. Flag **security/safety** (user-controlled fields interpolated into HTML today, `htmlEscape` coverage gaps if any).  
6. Propose **smallest** foundation approach (e.g. shared partials + token object + one layout function) **without** choosing libraries yet—options with tradeoffs only.  
7. Output **exact files** likely touched in a **future** Phase 1 build and **what must stay frozen**.

**Scope out**

- No preview UI/API design detail beyond **one sentence** on “preview will call same composer later.”  
- No override/edit-before-send design.  
- No CMS, no marketing tooling.  
- No code changes.

**Deliverables**

- **A.** Current template inventory (template key → function → approximate responsibilities)  
- **B.** Duplication / inconsistency findings  
- **C.** Recommended foundation shape (1–2 options, pick recommendation)  
- **D.** Risks + mitigations  
- **E.** Explicit **non-goals** for Phase 1 build  
- **F.** Smallest **Phase 1 build** sketch (bullet list only, still not implementation)

---
