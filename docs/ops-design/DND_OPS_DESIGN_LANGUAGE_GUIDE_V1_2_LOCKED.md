# Drift & Dwells Ops Design Language Guide

**Version:** 1.2  
**Status:** LOCKED BASELINE. Supersedes 1.0 and proposed 1.1.  
**Date:** 19 September 2026  
**Scope:** `driftdwells.com/ops` only

This document is the design contract for Drift & Dwells Ops. It governs the product shell, visual language, responsive behavior, components, page composition, interaction patterns, and accessibility baseline.

It does **not** define business logic, route semantics, permissions, API behavior, or new product functionality.

The public Drift & Dwells website may remain cinematic and editorial. Ops must feel like professional infrastructure.

### How to read this document

This guide is written to be implemented by people and by AI coding agents (Cursor). Soft wording gets interpreted as permission, so the language is normative:

- **MUST / MUST NOT:** required. Deviation needs an entry in the exception register (section 30).
- **SHOULD / SHOULD NOT:** the default. Deviation is allowed with a one-line reason in the PR or audit notes.
- **MAY:** optional.

Plain statements of rules (for example "Header is not wrapped in a decorative card") carry MUST weight.

Every number in this document is exact. Where a range appears, the first value is the default and the range is the only allowed variation. If a value is missing, it is not "free": add it to section 31 instead of improvising.

### What changed in 1.2

See section 30.1. In short: all remaining product decisions are resolved; dark mode is required; admin/operator UI is English while the cleaner shell supports English and Bulgarian; the status system is now namespaced and locked at the semantic level; coarse-pointer row sizing is explicit; accessibility wording is corrected; and `Insights` replaces the ambiguous `Growth` navigation label.

---

## 1. Product design position

Drift & Dwells Ops is an operational application used repeatedly by people who already understand the business. It is not a marketing website and it is not a showcase interface.

The target feeling is:

- quiet
- fast
- dense where density improves work
- predictable
- obvious without explanation
- robust
- restrained
- consistent across every module
- comfortable on mobile without making desktop feel like enlarged mobile UI

Reference qualities:

- **Stripe:** operational clarity, searchability, strong object/list patterns, quiet interface
- **Shopify Admin / Polaris:** high-density admin design, predictable patterns, software rather than website thinking
- **Linear:** hierarchy through restraint, navigation that recedes after orientation, attention must be earned
- **Atlassian:** scalable side navigation, progressive disclosure, tokenized spacing and reusable navigation primitives

We borrow principles, not visual branding.

---

## 2. Core principles

### 2.1 Software, not website

Ops screens are tools. Component size, whitespace, typography, and hierarchy must reflect frequency and task importance.

No hero sections. No editorial layouts. No decorative page introductions. No oversized marketing typography.

### 2.2 Quiet by default, loud on exception

Healthy states should recede. Problems, blocked work, failed syncs, overdue actions, unresolved exceptions, or destructive consequences may receive stronger visual weight.

A healthy worker does not need a permanent banner. A failed worker does.

### 2.3 Attention must be earned

Navigation, chrome, metadata, IDs, technical details, and secondary actions should not visually compete with the task the operator came to perform.

The content area is visually dominant. The shell is orientation, not decoration.

### 2.4 Density with hierarchy

Dense does not mean cramped. Ops should show enough information to scan and compare without forcing unnecessary scrolling or opening every record.

Desktop collection screens SHOULD use tables or compact rows. Mobile collection screens should favor structured rows/cards with clear priority.

### 2.5 Predictability over novelty

Components that look the same must behave the same.

The same concepts use the same:

- labels
- status treatment
- action placement
- filters
- confirmation behavior
- loading behavior
- error behavior
- spacing

### 2.6 Progressive disclosure

Show the information needed for the common task first. Advanced controls, technical diagnostics, infrequent actions, and secondary metadata appear only when requested or when relevant.

### 2.7 One system across desktop and mobile

Desktop and mobile use the same terminology, status semantics, page hierarchy, and object model.

They do **not** use the same layout.

Desktop optimizes for scanning and throughput. Mobile optimizes for focus and touch.

### 2.8 Brand is restrained

Drift & Dwells identity should be recognizable through name, tone, and a restrained sage accent.

Ops should not inherit the public site's Playfair/editorial language.

---

## 3. Non-negotiable visual direction

### Locked

- Inter is the Ops typeface.
- No serif typography inside Ops.
- **Both light mode and dark mode are required.**
- Neutral surfaces dominate in both themes.
- Sage is an accent, not the page background and not the default text color.
- No gradients.
- No decorative shadows.
- No card around every section.
- No nested card-on-card visual hierarchy unless a real nested object requires it.
- No globally scrolling desktop navigation.
- No giant rounded SaaS cards.
- No excessive pill shapes.
- No all-caps tracked section titles as a primary hierarchy device.
- No decorative animation.

### 3.1 Appearance behavior

Ops supports three appearance choices:

1. `System`
2. `Light`
3. `Dark`

Rules:

- `System` is the default for a user/device that has never chosen an Ops appearance.
- `System` follows `prefers-color-scheme`.
- An explicit Light or Dark choice overrides the system preference until the user changes it.
- The choice is persisted per device. No backend preference storage is required for v1.
- The theme MUST be applied before the first rendered frame so the app does not flash the wrong appearance during startup.
- The active appearance MUST set the browser `color-scheme` so native form controls, scrollbars, and browser-provided UI match the application.
- Print/export surfaces use the light palette unless that surface has a separately approved print design.
- Dark mode is a semantic theme, not an inversion filter. Every color token has an intentional dark counterpart.
- Images, charts, calendar blocks, status states, focus indicators, form controls, and overlays MUST be reviewed in both themes.

---

## 4. Foundation tokens

These values are the canonical starting point. They may only change through an explicit design-system revision, not page-by-page.

### 4.1 Color

#### Neutral

| Token | Value | Use |
|---|---:|---|
| `--ops-canvas` | `#F7F8F6` | App background |
| `--ops-surface` | `#FFFFFF` | Primary surface |
| `--ops-surface-subtle` | `#F2F4F1` | Secondary/inset surface |
| `--ops-surface-elevated` | `#FFFFFF` | Floating/elevated surface |
| `--ops-border` | `#E1E5DF` | Standard borders/dividers |
| `--ops-border-strong` | `#CDD3CB` | Stronger separation |
| `--ops-text` | `#171A17` | Primary text |
| `--ops-text-secondary` | `#59615A` | Secondary text |
| `--ops-text-muted` | `#666D67` | Low-priority metadata |
| `--ops-text-disabled` | `#9AA198` | Disabled labels and values only |
| `--ops-border-control` | `#858C82` | Input, select, checkbox and other control boundaries |
| `--ops-focus` | `#3F4A3A` | Focus ring |

Contrast (verified, WCAG 2.x formula):

| Pair | Ratio | Result |
|---|---:|---|
| `--ops-text-muted` on surface / canvas / surface-subtle / accent-soft | 5.32 / 4.99 / 4.81 / 4.66 | Pass 4.5:1 |
| `--ops-text-secondary` on surface-subtle | 5.78 | Pass |
| `--ops-border-control` on surface / canvas / surface-subtle | 3.46 / 3.25 / 3.13 | Pass 3:1 non-text |
| White on `--ops-accent` | 5.68 | Pass |
| `--ops-focus` on surface / canvas | 9.33 / 8.75 | Pass |

Why 1.0 changed: the 1.0 muted value `#737B74` measured 4.36:1 on white, 4.09:1 on canvas and 3.94:1 on surface-subtle. Metadata is 12px, so it failed the 4.5:1 target this guide itself sets. The 1.0 border tokens (1.27:1 and 1.52:1 on white) are fine for dividers but cannot identify a control boundary, which needs 3:1.

Rules:

- `--ops-border` and `--ops-border-strong` are for dividers and surface edges only. Any control whose boundary is the only thing that identifies it MUST use `--ops-border-control`.
- Disabled content is exempt from contrast minimums but MUST still be recognizable as present. Disabled controls use `--ops-text-disabled` on `--ops-surface-subtle`.
- Read-only is not disabled. Read-only values (for example the cleaner payout view) use normal text tokens without a control boundary.

#### Brand/accent

| Token | Value | Use |
|---|---:|---|
| `--ops-accent` | `#62695C` | Primary actions, selected emphasis |
| `--ops-accent-hover` | `#52584D` | Hover/pressed primary action |
| `--ops-accent-soft` | `#EEF1EB` | Selected/active soft background |
| `--ops-accent-border` | `#BFC6B9` | Accent boundary (decorative, not a state indicator) |

Selected and active states:

- `--ops-accent-soft` measures 1.14:1 against white. A fill alone is not enough. Every selected/active state (nav item, selected row, active tab, chosen option) MUST add a non-text state indicator with at least 3:1 contrast: a 2px `--ops-accent` bar, an `--ops-accent` border, a check icon, or another explicit shape/icon indicator. Font weight MAY reinforce selection, but font weight alone does not satisfy this rule.
- `--ops-accent-soft` (`#EEF1EB`) and the success soft background (`#EDF8F1`) are visually close. Selected rows MUST NOT look like success. Never use accent-soft behind status content, and never use success-soft to show selection.

Links:

- Links in prose use `--ops-accent` with an underline at all times.
- Standalone links (for example "View reservation") use `--ops-accent`, underline on hover and focus.
- Links MUST NOT use the Info blue.

The historic sage `#81887A` may remain as a secondary decorative/supporting tone, but it must **not** be used for small body text on white because it does not meet the preferred 4.5:1 body-text contrast target.

#### Semantic

| Meaning | Strong | Soft background |
|---|---:|---:|
| Success | `#1F7A4D` | `#EDF8F1` |
| Warning | `#9A5B00` | `#FFF7E8` |
| Danger | `#B42318` | `#FEF3F2` |
| Info | `#175CD3` | `#EFF6FF` |

Semantic colors communicate meaning only. They are never used merely to make a page more colorful.

Status must never rely on color alone. Text/icon/shape must communicate the same meaning.

### 4.2 Typography

Typeface: **Inter**.

| Role | Size / line height | Weight |
|---|---|---|
| Page title | 20 / 28 px | 600 |
| Section title | 15 / 20 px | 600 |
| Body | 14 / 20 px | 400 |
| Body strong | 14 / 20 px | 500–600 |
| Compact/table | 13 / 18 px | 400 |
| Label | 13 / 18 px | 500 |
| Metadata | 12 / 16 px | 400 |
| Button | 14 / 20 px | 500 |

Rules:

- Sentence case everywhere except true abbreviations.
- IDs use tabular/monospace treatment only when it aids recognition.
- Numeric columns use tabular numerals where available.
- Mobile form inputs use at least 16px text to avoid browser zoom behavior.
- Do not use font size as the only hierarchy tool. Weight, placement, contrast, and spacing matter more.
- Tabular numerals are applied with `font-variant-numeric: tabular-nums` on numeric columns, totals, times and currency.
- Proper nouns keep their own casing (Airbnb, WhatsApp, The Valley).

Font loading:

- Inter is self-hosted as a variable WOFF2 font. No third-party font request at runtime.
- Subsets MUST include Latin and Cyrillic, because Ops content contains Bulgarian names and text.
- `font-display: swap`, with a fallback stack of `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Ops MUST NOT load Playfair Display or Lato. Public-site font preloads MUST NOT run on `/ops` routes.

### 4.3 Spacing

Atomic unit: **4px**. Primary rhythm: **8px**.

Allowed standard spacing values:

`4, 8, 12, 16, 24, 32, 48`

Avoid arbitrary one-off spacing values unless required by a physical/layout constraint. In Tailwind terms: no arbitrary values such as `p-[13px]` in Ops code (see section 29).

### 4.4 Radius

| Use | Radius |
|---|---:|
| Controls | 6px |
| Cards/surfaces | 8px |
| Popovers/modals | 8px |
| Status pills | full/pill permitted |

Large 16–24px rounded containers are not part of Ops v1.

### 4.5 Borders and elevation

Borders do most grouping work.

- Standard: 1px `--ops-border`
- Strong separation: 1px `--ops-border-strong`
- Shadows are reserved for floating UI: popovers, dropdowns, modals, sheets
- Static content surfaces have no shadow

Elevation communicates layering, not importance.

| Token | Value | Use |
|---|---|---|
| `--ops-shadow-overlay` | `0 4px 12px rgba(23, 26, 23, 0.08), 0 1px 3px rgba(23, 26, 23, 0.06)` | Popovers, dropdowns, menus |
| `--ops-shadow-modal` | `0 12px 32px rgba(23, 26, 23, 0.12), 0 2px 6px rgba(23, 26, 23, 0.08)` | Modals, drawers, sheets |
| `--ops-scrim` | `rgba(23, 26, 23, 0.32)` | Behind modal overlays |

No other shadow values are allowed.

### 4.6 Sizing

| Token | Value | Use |
|---|---:|---|
| `--ops-control-h-compact` | 32px | Filter bars and table toolbars only |
| `--ops-control-h` | 36px | Default desktop control height |
| `--ops-control-h-touch` | 44px | Any control when `pointer: coarse` |
| `--ops-row-h` | 40px | Default desktop table row |
| `--ops-row-h-compact` | 32px | Opt-in dense tables (for example payout lines) |
| `--ops-row-min-mobile` | 56px | Minimum mobile collection row |
| `--ops-topbar-h` | 48px | Desktop top bar |
| `--ops-bottomnav-h` | 56px | Mobile bottom navigation, plus safe-area inset |
| `--ops-sidebar-w` | 240px | Expanded sidebar |
| `--ops-sidebar-w-collapsed` | 56px | Collapsed sidebar |

### 4.7 Layering

| Token | Value |
|---|---:|
| `--ops-z-sticky` | 10 |
| `--ops-z-nav` | 20 |
| `--ops-z-dropdown` | 30 |
| `--ops-z-overlay` | 40 |
| `--ops-z-modal` | 50 |
| `--ops-z-toast` | 60 |

No z-index outside this scale.

### 4.8 Breakpoints and input modality

| Token | Value |
|---|---:|
| `--ops-bp-md` | 768px |
| `--ops-bp-lg` | 1024px |

Width decides layout. Input modality decides target size. A tablet at 768px or wider gets the desktop shell, but it is still a touch device. Touch sizing therefore follows `@media (pointer: coarse)`, not the width breakpoint: under `pointer: coarse` all interactive controls use `--ops-control-h-touch`, table row actions get a 44×44px hit area, and hover-only affordances MUST have a visible or long-press equivalent.

### 4.9 Dark appearance token values

The same semantic token names are used in both appearances. Components MUST reference semantic tokens, never theme-specific raw values.

#### Dark neutral

| Token | Dark value | Use |
|---|---:|---|
| `--ops-canvas` | `#0F1110` | App background |
| `--ops-surface` | `#151815` | Primary surface |
| `--ops-surface-subtle` | `#1B1F1B` | Secondary/inset surface |
| `--ops-surface-elevated` | `#202420` | Popovers, drawers, modals, elevated UI |
| `--ops-border` | `#2C322C` | Standard dividers |
| `--ops-border-strong` | `#3A423A` | Stronger separation |
| `--ops-text` | `#F3F5F2` | Primary text |
| `--ops-text-secondary` | `#C7CDC6` | Secondary text |
| `--ops-text-muted` | `#AAB2A9` | Low-priority metadata |
| `--ops-text-disabled` | `#6F776F` | Disabled labels and values only |
| `--ops-border-control` | `#7E897D` | Control boundaries |
| `--ops-focus` | `#D2DBC8` | Focus ring |

#### Dark accent

| Token | Dark value |
|---|---:|
| `--ops-accent` | `#A4AE99` |
| `--ops-accent-hover` | `#B2BBA8` |
| `--ops-accent-soft` | `#252B23` |
| `--ops-accent-border` | `#6F7B68` |

Filled primary buttons in dark mode use `#171A17` text on `--ops-accent`.

#### Dark semantic

| Meaning | Strong | Soft background |
|---|---:|---:|
| Success | `#5AC58A` | `#173223` |
| Warning | `#E5A94F` | `#332817` |
| Danger | `#F27A72` | `#381B1B` |
| Info | `#6FA9FF` | `#172A42` |

Verified dark-mode contrast examples:

| Pair | Ratio |
|---|---:|
| primary text on surface | 16.32:1 |
| muted text on surface | 8.22:1 |
| control border on surface | 4.91:1 |
| focus ring on surface | 12.53:1 |
| accent indicator on surface | 7.75:1 |
| dark button text on accent | 7.60:1 |
| success strong on success-soft | 6.45:1 |
| warning strong on warning-soft | 6.95:1 |
| danger strong on danger-soft | 5.82:1 |
| info strong on info-soft | 6.08:1 |

Rules:

- Dark mode MUST NOT use pure black as the main canvas and MUST NOT use pure white as normal body text.
- Elevated surfaces are slightly lighter than base surfaces so layering remains visible without decorative shadows.
- Soft semantic fills remain dark; semantic foregrounds become lighter. Do not reuse the light soft-background values in dark mode.
- Selected states still require the explicit selected-state indicator from section 4.1.
- Static dividers may remain below 3:1 because they are not the sole identifier of a control or state. Interactive boundaries follow the 3:1 rule.


---

## 5. Application shell

### 5.1 Desktop

At `>= 768px`, Ops uses an application shell, not a website header with horizontal tabs.

Structure:

1. left navigation
2. compact top bar
3. page content
4. problem-only system/attention region when required

#### Sidebar

- Expanded width: `--ops-sidebar-w` (240px)
- Collapsed width: `--ops-sidebar-w-collapsed` (56px)
- `768–1023px`: collapsed by default; `>= 1024px`: expanded by default
- The user's expand/collapse choice persists per device
- Collapsed items show a tooltip with the label on hover and focus
- Top-level concepts, not raw routes
- Only the active group expands by default
- Other groups remain compact
- Active group and active page are both visible
- The active page uses the selected-state rule in 4.1 (fill plus a 3:1 indicator), never fill alone
- Empty permission groups are hidden
- Admin/system content remains visually separated at the bottom

Locked high-level taxonomy:

- Home
- Calendar
- Guests
- Finance
- Property
- Cleaning
- Insights
- Admin

The exact route mapping follows the audited IA and current permissions. No permission-module rewrite is implied by this taxonomy.

#### Top bar

The top bar contains only global/contextual controls:

- current page context/title or breadcrumb when useful
- reserved global search/command location
- notifications
- account/role menu

Height: `--ops-topbar-h` (48px). Sticky. It is not a second navigation system.

#### Content width

Pages choose a width based on task:

- `narrow`: settings/forms, max 720px
- `default`: standard content/detail, max 1040px
- `wide`: collections/data, max 1360px
- `full`: calendar/planner/high-density spatial views, no max width

Content padding: 24px at `>= 1024px`, 16px below. Width is set once by the page template, never by a wrapper inside the page.

Do not apply one global `max-w-7xl` to every Ops page.

### 5.2 Mobile

Below 768px, preserve the successful bottom-navigation model:

- Home
- Calendar
- Guests
- Finance
- More

Rules:

- No sixth primary tab
- More remains a grouped sheet, not an unstructured menu
- Safe-area padding remains
- Bottom navigation must never cover page actions/content
- Touch controls use a 44×44px minimum hit area
- The same IA terminology as desktop is used
- For admin/operator roles, `Cleaning`, `Property`, `Insights`, and `Admin` remain reachable through `More`; cleaner-only sessions use the dedicated Cleaning shell.

Mobile may use cards/structured list rows where desktop uses tables.

Cleaner-only sessions retain their dedicated Cleaning-only shell behavior.

---

## 6. Page grammar

Every normal Ops page should fit one of four canonical page patterns. Exceptions are explicit.

### 6.1 Collection

For reservations, vouchers, cabins, reviews, promo codes, users, manual review, creator partners, recovery lists.

Order:

1. page header
2. optional summary/attention strip
3. search + filters
4. results
5. pagination / result count

Desktop: semantic table or compact list rows.  
Mobile: structured rows/cards.

### 6.2 Detail

For reservation, voucher, cabin, and future resource details.

Order:

1. entity identity
2. status
3. primary action
4. secondary actions
5. key operational facts
6. sections/tabs
7. activity/technical details later

Human-recognizable identity comes before database ID.

### 6.3 Dashboard / analytics

Order:

1. page title + scope/date controls
2. exceptions / actions needed
3. primary metrics
4. trends
5. drill-downs

Healthy system data stays quiet.

### 6.4 Settings

Order:

1. page title
2. grouped settings
3. explanatory text only where needed
4. save state
5. danger zone when relevant

Long settings pages may use a sticky save/action area.

### 6.5 Explicit exceptions

Do not force these into generic page templates:

- Calendar
- Cabin month calendar
- Work windows
- Cleaning calendar

They adopt the Ops shell, tokens, components, and interaction language while preserving their spatial workflow.

---

## 7. Page header

One canonical `OpsPageHeader` pattern.

Contains:

- title
- optional short description
- primary action
- optional secondary actions
- breadcrumbs only when hierarchy is genuinely useful

Rules:

- Header is not wrapped in a decorative card
- One primary action maximum in the header
- Secondary actions use quiet/secondary treatment or overflow menu
- Status may sit beside entity identity on detail pages

---

## 8. Cards and surfaces

A card means: "these things are one meaningful object/group."

A card does **not** mean: "we need some visual separation."

Use cards for:

- discrete dashboard metrics/groups
- grouped detail information
- meaningful nested objects
- mobile list items where touch/scanning benefits

Do not use cards for:

- every table row on desktop
- every settings subsection
- every filter block
- page headers
- wrappers around wrappers

Prefer whitespace, typography, surface contrast, and table dividers before adding another card.

---

## 9. Tables and collection rows

Tables are the default desktop pattern for comparable operational data.

Rules:

- Row height is `--ops-row-h` (40px) by default; `--ops-row-h-compact` only for tables where most columns are numeric
- If the entire row is an interactive target under `pointer: coarse`, its minimum interactive height is 44px. A 40px row may remain visually dense only when the row itself is not the primary target and all interactive descendants independently meet the 44×44px coarse-pointer hit-area rule.
- Long text truncates with an ellipsis on a single line and exposes the full value on hover and focus; IDs and money never truncate
- Table headers are sticky when the table scrolls within the page

- Use semantic HTML table structure for true tabular data
- Text left-aligned
- Numbers/currency right-aligned
- Headers align with cell data
- Never center-align normal table columns
- Headers use concise sentence case
- One row represents one resource/object
- Row hover is subtle
- If the row navigates, make the navigation affordance predictable
- Per-row secondary actions live in a consistent trailing action area/menu
- Avoid repeated units in cells when the unit can live in the column header
- Avoid zebra stripes unless testing proves a dense table requires them
- Use row dividers, not individual row cards, on desktop
- Allow sorting only where it is meaningful
- Sort state must be visible and keyboard accessible

Responsive rule:

Do not default to horizontally scrolling every desktop table on mobile. Convert collections into prioritized structured rows when possible. Preserve horizontal data grids only where column comparison itself is the task.

---

## 10. Forms

Rules:

- Labels above controls
- Placeholder is never the only label
- Help text below the field
- Validation/error directly below the relevant field
- Required state is explicit
- Use standard control heights and spacing
- Group related fields by task, not by database schema
- Advanced/rare fields use progressive disclosure
- Destructive settings live separately
- Unsaved-change protection is required for forms where accidental navigation could lose meaningful work

Control heights come from section 4.6:

- compact (32px): filter bars and table toolbars only
- standard (36px): everything else on desktop
- touch (44px): any control under `pointer: coarse`, including tablets using the desktop shell

---

## 11. Buttons and actions

Canonical hierarchy:

1. **Primary:** one main action for the current context
2. **Secondary:** valid alternative actions
3. **Quiet:** low-emphasis utility action
4. **Destructive:** destructive action, visually reserved for destructive meaning

Rules:

- Do not use the accent-filled primary style for navigation
- Do not create multiple competing primary buttons in one region
- Icon-only buttons require accessible labels and tooltip/help where meaning is not obvious
- Buttons use verbs when the action matters: `Create voucher`, `Save changes`, `Cancel reservation`
- Use `More`/ellipsis for infrequent secondary record actions

Destructive actions require the shared confirmation pattern when consequences are meaningful.

Never use `window.confirm` in the final system.

---

## 12. Status language

One status system is used across Ops, but **status semantics are namespaced by domain**. The word `Pending` does not automatically mean the same severity everywhere.

Each registry entry MUST specify:

- canonical key
- canonical label
- semantic family: neutral / info / success / warning / danger
- loudness: quiet / normal / attention
- icon if needed
- allowed contexts
- localized cleaner label when the state appears in the cleaner shell

Rules:

- Components render statuses only through `OpsStatus` backed by one registry.
- A visible status not present in the registry is not allowed on a migrated screen.
- Raw backend keys such as `in_house`, `partially_redeemed`, or `pending_verification` MUST NOT be shown directly.
- Do not create page-specific colors for the same namespaced status.
- Do not use color alone.
- Healthy/normal states remain quieter than exceptions.
- Technical state is secondary unless it blocks work.
- Two statuses may share a visible English word while having different namespaced semantics, for example `reservation.pending` and `cleaning.pending`.
- Backend enum inconsistencies may map to one UI status. The UI registry does not require a backend rewrite.

### 12.1 Locked core registry

#### Reservation lifecycle

| Key | Label | Family | Loudness |
|---|---|---|---|
| `reservation.pending` | Pending | neutral | normal |
| `reservation.confirmed` | Confirmed | success | quiet |
| `reservation.in_house` | In house | info | normal |
| `reservation.completed` | Completed | neutral | quiet |
| `reservation.cancelled` | Cancelled | neutral | normal |

#### Reservation operational state

| Key | Label | Family | Loudness |
|---|---|---|---|
| `reservation.currently_staying` | Currently staying | info | quiet |
| `reservation.arriving_today` | Arriving today | info | normal |
| `reservation.arriving_tomorrow` | Arriving tomorrow | info | quiet |
| `reservation.arriving_later` | Arriving in N days | info | quiet |
| `reservation.checked_out` | Checked out | neutral | quiet |
| `reservation.checking_out_today` | Checking out today | info | normal |
| `reservation.cancelled_paid` | Cancelled + paid | info | normal |
| `reservation.refund_pending` | Refund pending | warning | attention |
| `reservation.payment_attention` | Payment attention | danger | attention |
| `reservation.conflict` | Conflict | danger | attention |

#### Reservation payment

| Key | Label | Family | Loudness |
|---|---|---|---|
| `payment.paid` | Paid | success | quiet |
| `payment.partial` | Partial | warning | normal |
| `payment.failed` | Failed | danger | attention |
| `payment.disputed` | Disputed | danger | attention |
| `payment.refunded` | Refunded | info | quiet |
| `payment.unpaid` | Unpaid | warning | normal |
| `payment.pending_verification` | Pending verification | warning | normal |
| `payment.manual_not_required` | Manual / not required | neutral | quiet |
| `payment.unlinked` | Unlinked payment | danger | attention |
| `payment.unknown` | Unknown | warning | normal |

Payment and payout ledgers MAY display provider-specific status text where the provider state itself is the data being inspected, but derived reservation payment state uses the registry above.

#### Calendar category grammar

Calendar resource categories are not success/error statuses. They use stable category colors:

- Reservation: blue
- Manual block: amber
- Maintenance: slate
- External hold: violet
- Conflict: red overlay/ring
- Warning: amber overlay/ring

`calendarVisualTokens.js` remains the implementation source during migration and MUST be reconciled to these meanings.

Work Windows is an approved spatial exception but MUST NOT use red merely to mean an ordinary occupied reservation. Its locked visual grammar is:

- occupied reservation: reservation blue
- free work window: success green
- turnaround: warning amber
- blocked/unavailable: slate
- conflict/error overlay: danger red

#### Cleaning

| Key | EN label | BG label | Family | Loudness |
|---|---|---|---|---|
| `cleaning.pending` | Pending | За почистване | warning | normal |
| `cleaning.done` | Done | Почистено | success | quiet |
| `cleaning.same_day_turn` | Same-day turn | Смяна в същия ден | warning | attention |
| `cleaning_payment.pending` | Pending | За плащане | warning | normal |
| `cleaning_payment.partial` | Partial | Частично платено | warning | normal |
| `cleaning_payment.paid` | Paid | Платено | success | quiet |

A normal uncleaned checkout is **warning**, not danger. Danger is reserved for a missed/blocked cleaning state that requires separate business logic.

#### Sync and system health

| Key | Label | Family | Loudness |
|---|---|---|---|
| `sync.healthy` | Sync healthy | success | quiet |
| `sync.warning` | Sync warning | warning | normal |
| `sync.stale` | Sync stale | warning | normal |
| `sync.failed` | Sync failed | danger | attention |

`stale` is amber/warning everywhere. The current gray/amber split is removed during migration.

#### Reviews

| Key | Label | Family | Loudness |
|---|---|---|---|
| `review.approved` | Approved | success | quiet |
| `review.pending` | Pending | warning | normal |
| `review.hidden` | Hidden | neutral | quiet |

#### Gift vouchers

| Key | Label | Family | Loudness |
|---|---|---|---|
| `voucher.draft` | Draft | neutral | quiet |
| `voucher.pending_payment` | Pending payment | warning | normal |
| `voucher.active` | Active | success | quiet |
| `voucher.partially_redeemed` | Partially redeemed | info | normal |
| `voucher.redeemed` | Redeemed | success | quiet |
| `voucher.expired` | Expired | neutral | quiet |
| `voucher.voided` | Voided | neutral | normal |
| `voucher.refunded` | Refunded | info | quiet |

#### Promo codes and cabins

| Key | Label | Family | Loudness |
|---|---|---|---|
| `promo.active` | Active | success | quiet |
| `promo.inactive` | Inactive | neutral | quiet |
| `cabin.active` | Active | neutral | quiet |
| `cabin.inactive` | Inactive | neutral | quiet |
| `cabin.blocked` | Blocked units | warning | normal |

`Multi-unit type` / `Single cabin` describe object type, not status. They do not use semantic success/warning colors.

#### Manual review and readiness

| Key | Label | Family | Loudness |
|---|---|---|---|
| `manual_review.open` | Open | warning | normal |
| `manual_review.high` | High | warning | attention |
| `manual_review.critical` | Critical | danger | attention |
| `readiness.ready` | Ready for primary use | success | quiet |
| `readiness.restricted` | Ready for restricted cutover | warning | normal |
| `readiness.conditional` | Conditionally ready | warning | normal |
| `readiness.not_ready` | Not ready | danger | attention |

Warning uses the one warning family. The existing yellow-only readiness treatment is removed during migration.

#### Messaging / communication jobs

| Key | Label | Family | Loudness |
|---|---|---|---|
| `template.approved` | Approved | success | quiet |
| `template.draft` | Draft | warning | normal |
| `template.disabled` | Disabled | neutral | quiet |
| `job.scheduled` | Scheduled | info | quiet |
| `job.claimed` | Processing | info | quiet |
| `job.sent` | Sent | success | quiet |
| `job.failed` | Failed | danger | attention |
| `job.cancelled` | Cancelled | neutral | quiet |
| `job.suppressed` | Suppressed | neutral | normal |
| `job.skipped_status_guard` | Skipped | neutral | quiet |
| `job.skipped_no_consent` | Skipped: no consent | neutral | quiet |

#### Creator partners and commissions

| Key | Label | Family | Loudness |
|---|---|---|---|
| `partner.draft` | Draft | neutral | quiet |
| `partner.active` | Active | success | quiet |
| `partner.paused` | Paused | neutral | normal |
| `partner.archived` | Archived | neutral | quiet |
| `commission.pending` | Pending | warning | normal |
| `commission.approved` | Approved | info | quiet |
| `commission.paid` | Paid | success | quiet |
| `commission.voided` | Voided | neutral | quiet |
| `commission.needs_review` | Needs review | warning | attention |
| `commission.eligible` | Eligible | success | quiet |
| `commission.not_eligible` | Not eligible | neutral | quiet |

Backend `void` and `voided` both map to the UI key `commission.voided`.

#### Quote recovery / conversion

| Key | Label | Family | Loudness |
|---|---|---|---|
| `quote.quoted` | Quoted | info | quiet |
| `quote.checkout_started` | Checkout started | info | normal |
| `quote.converted` | Converted | success | quiet |
| `quote.expired` | Expired | neutral | quiet |
| `quote.superseded` | Superseded | neutral | quiet |
| `quote.ineligible` | Ineligible | neutral | quiet |
| `quote.suppressed` | Suppressed | warning | normal |

### 12.2 Registry implementation boundary

The factual audit found many duplicated label/color helpers. Migration consolidates presentation into one registry without changing backend enum values or business logic.

The registry MAY contain aliases from legacy/backend keys to one canonical UI status. This is explicitly allowed for cases such as `void` / `voided`.

Roles, sources, object types, delivery modes, and channels are labels/categories, not statuses. They do not receive semantic success/warning colors unless they genuinely represent a state requiring meaning.

---

## 13. Filters and search

Filters belong directly above the data they affect.

Rules:

- Search is the first filter when search is a common workflow
- Active filters are visibly identifiable
- Clearing filters is obvious
- Shareable collection state should live in the URL when practical
- Mobile filters open in a sheet/drawer rather than forcing dense multi-column control bars
- Advanced filters stay collapsed until needed
- Search should not be visually styled as a primary action button

Global search/command is a later product capability, but the shell reserves a permanent location for it now.

---

## 14. Modals, drawers, sheets, popovers

Use one overlay system.

### Modal

Use for:

- blocking confirmation
- short create/edit flows
- actions requiring focused decision

### Drawer

Use for:

- contextual details/editing while preserving collection context
- medium-complexity work that should not replace the whole page

### Bottom sheet

Use on mobile for:

- filters
- More navigation
- contextual actions/details
- existing calendar/cleaning interactions

Rules:

- Focus is trapped correctly
- Escape closes every overlay, except a modal with unsaved input, which asks before discarding
- Focus returns to the triggering element
- Background interaction is disabled while modal
- Destructive confirmation is explicit
- Do not create independent overlay behavior inside each feature

---

## 15. Loading, saving, errors and feedback

### Loading

- Shell remains mounted
- Use skeletons when the structure is predictable and load is noticeable
- Use spinner for indeterminate small/action states
- Never replace the entire page with bare `Loading...` text once migrated

### Saving

- Prevent duplicate submission
- Button can change to `Saving…`
- Critical reservation/payment state changes favor confirmed server response over optimistic presentation

### Success

- Quiet toast or inline confirmation
- Do not interrupt workflow with success modals

### Error

- Explain what failed in plain operational language
- Keep user input when possible
- Place field/action errors next to the action that failed
- System-wide failure may use an attention banner

### Empty

State what is empty and, if useful, provide exactly one relevant next action or reset-filter action.

Distinguish the two empty states: "nothing exists yet" and "nothing matches these filters" use different copy, and only the second offers `Clear filters`.

### Toasts

- Position: bottom right on desktop; above the bottom navigation on mobile
- Success toasts dismiss after 4 seconds; error toasts stay until dismissed
- Toasts never carry the only copy of important information or the only way to undo
- Announced via a polite live region

### 15.1 Connectivity and data freshness

Ops is used on site at The Valley, which is off-grid. Mobile use on a weak or dropped connection is a normal condition, not an edge case. This section defines presentation only; it does not authorize offline sync or backend work.

- **Offline:** a single quiet banner below the top bar or above the bottom nav: `You are offline. Changes can't be saved until you reconnect.` The shell and already-loaded data stay visible.
- **Stale data:** views where freshness matters (calendar, today's arrivals, cleaning schedule, sync status) show `Updated 14:32`. After a failed refresh the timestamp switches to warning treatment.
- **Failed save:** the form keeps every input, the action shows an inline error with `Retry`. Never clear a form on network failure.
- **Reconnect:** refresh data in place. Never swap the page for a full-screen spinner.
- **Money and reservation changes:** never show a change as done until the server confirms it (consistent with Saving rules above).

---

## 16. Navigation vs actions vs filters

These must remain visually and structurally separate.

- **Sidebar/bottom bar:** go somewhere
- **Page tabs/subnav:** change context inside the current object/module
- **Primary action:** do the main thing on this page
- **Record action:** act on one item
- **Filters:** change the visible data set
- **Settings:** configure behavior

Do not use button-like page shortcuts to compensate for weak navigation.

---

## 17. Iconography

Use **Lucide** consistently.

Standard sizes:

- 16px inline/compact
- 18px normal controls/navigation
- 20px primary mobile/navigation where needed

Rules:

- One icon family only
- Icons support recognition; they do not replace clear labels for important navigation
- Avoid decorative icons in dense tables
- Active/inactive icon style remains consistent

---

## 18. Motion

Motion communicates state change, not personality.

- Standard transition: 150ms; range 120–180ms
- Prefer ease-out for entering UI
- No bouncing/spring decoration unless the interaction physically requires it
- Sidebar, sheets, dropdowns, and dialogs may animate subtly
- Respect `prefers-reduced-motion`

---

## 19. Content language

Ops copy is operational, concise, and literal.

Use:

- `Gift vouchers`
- `Create voucher`
- `Payment failed`
- `Sync requires attention`
- `3 reservations need review`

Avoid:

- marketing phrases
- playful system copy during serious workflows
- technical implementation language when the operator only needs the consequence
- labels that vary between desktop and mobile

Dates must avoid ambiguity. Prefer formats such as:

`19 Sep 2026, 15:00`

Use 24-hour time in Ops.

Currency values use consistent formatting and right alignment in tables.

### 19.1 Localization

Locked product decision:

- **Admin and operator UI is English-only in v1.**
- **Cleaner-facing UI is available in English and Bulgarian.**
- Bulgarian guest names, addresses, notes, and other business data render correctly everywhere regardless of UI language.

Implementation boundary:

- Do **not** turn the entire Ops redesign into a full bilingual admin migration.
- Admin/operator-only components MAY remain English-only.
- Every string visible inside the cleaner-only shell MUST use the cleaner Ops translation namespace.
- Shared primitives that render user-visible copy inside the cleaner shell MUST accept translated labels/copy rather than hardcode English.
- Cleaner UI defaults to the cleaner user's existing `locale` when it is `en` or `bg`; otherwise it defaults to English.
- A cleaner MAY switch EN/BG from the account area. The override may persist locally; no backend preference rewrite is required.
- An admin/operator opening Cleaning remains in English.
- Layouts used by the cleaner shell MUST survive 30% longer labels.
- Guest names, addresses and notes in Cyrillic MUST render correctly and sort with locale-aware comparison.
- Dates and numbers are formatted with `Intl`, never by string concatenation.
- The document language (`lang`) MUST match the active cleaner UI language while the cleaner shell is active.

The existing public-site `i18next` / `react-i18next` infrastructure may be reused. A cleaner-specific Ops namespace is preferred over forcing all 28 Ops screens through i18n during this redesign.

### 19.2 Time

- All operational times display in the property's local time zone, `Europe/Sofia`, regardless of the viewer's device zone.
- If the viewer's device zone differs, the top bar account menu shows the property zone, and timestamps that could be misread show the zone abbreviation (`15:00 EET`).
- Relative time (`5 min ago`) is allowed only for activity and freshness under 24 hours. Anything older, and anything that is a commitment (check-in, check-out, cleaning windows, payment dates), uses absolute date and time.

### 19.3 Money

- Always show the currency. In EN: `€1,250.00`. In BG: `1 250,00 €`. Both come from `Intl.NumberFormat`.
- Views that can contain records in more than one currency (for example historical records from before Bulgaria's euro changeover, if any exist) MUST show the currency code on every row and MUST NOT sum across currencies.
- Negative amounts use a minus sign and the danger family only when the negative is a problem, not for ordinary refunds or payouts.

---

## 20. Analytics and charts

Charts are subordinate to decisions.

Rules:

- If a number or table answers the question more clearly, do not add a chart
- Neutral visual base with restrained accent use
- Semantic colors only when the semantics matter
- No rainbow series by default
- Axes/units/date ranges are explicit
- Current filters/date scope remain visible
- Charts must have accessible text/table equivalents where required

---

## 21. Accessibility baseline

Target: **WCAG 2.2 AA minimum**.

Some Drift & Dwells requirements deliberately exceed the AA minimum. In particular, the 44×44px coarse-pointer target and the explicit 2px/offset focus treatment are product standards, not claims that WCAG AA universally requires those exact values.

Locked practices:

- visible keyboard focus everywhere, via `:focus-visible`
- focus must not be hidden by sticky bars/sheets (use `scroll-padding` matching the top bar and bottom nav heights)
- focus ring: 2px solid `--ops-focus` with a 2px offset in the surface color, so it stays visible on filled accent buttons (a ring touching the accent button would measure 1.64:1)
- all pointer targets at least 24×24px (WCAG 2.5.8); under `pointer: coarse`, 44×44px
- selected, checked and active states are indicated with at least 3:1 contrast, not by a soft fill alone
- body text aims for at least 4.5:1 contrast
- non-text control boundaries/focus states meet accessible contrast
- semantic HTML first
- native table semantics for real tables
- labels for form controls
- accessible names for icon-only buttons
- keyboard operation for menus, dialogs, tables, sorting, tabs, and navigation
- status meaning does not depend on color alone

Accessibility is a component responsibility. Pages should receive accessible behavior by using the canonical primitive rather than rebuilding it.

---

## 22. Responsive behavior

### `< 768px`

- mobile shell
- bottom navigation
- More sheet
- single-column content
- structured collection rows
- large touch targets
- filters/actions in sheets where necessary

### `768–1023px`

- desktop application shell with collapsed sidebar by default
- usually a tablet: touch sizing applies via `pointer: coarse` (4.8)
- content remains dense but avoids multi-column layouts that become cramped

### `>= 1024px`

- expanded sidebar preferred
- tables and multi-column detail layouts permitted

Responsive behavior is component-defined, not patched page-by-page.

---

## 23. Internal component system

Required primitive layer:

- `OpsPageHeader`
- `OpsButton`
- `OpsIconButton`
- `OpsTextField`
- `OpsSelect`
- `OpsTextarea`
- `OpsCheckbox`
- `OpsDateField`
- `OpsBadge`
- `OpsStatus`
- `OpsTable`
- `OpsCollectionRow`
- `OpsTabs`
- `OpsFilterBar`
- `OpsPagination`
- `OpsEmptyState`
- `OpsLoadingState`
- `OpsInlineError`
- `OpsBanner`
- `OpsModal`
- `OpsDrawer`
- `OpsSheet`
- `OpsConfirmDialog`
- `OpsTooltip`

Templates:

- `OpsCollectionPage`
- `OpsDetailPage`
- `OpsDashboardPage`
- `OpsSettingsPage`

Existing feature/domain dialogs keep their business rules and migrate onto these shared primitives.

---

## 24. Design-system showcase

An admin-only internal route should be created early in the migration, once the first primitives exist:

`/ops/design-system`

Purpose:

- inspect tokens visually
- approve component states
- compare desktop/mobile states
- catch inconsistency before components spread across pages
- act as implementation documentation

It is not a user feature and should not appear in normal operator navigation.

Initial showcase sections:

1. typography
2. colors
3. spacing/radius/elevation
4. buttons
5. fields/selects
6. badges/statuses
7. tables/rows
8. page headers
9. filters
10. tabs
11. modals/drawers/sheets
12. alerts/errors
13. loading/empty states
14. responsive examples

No Storybook requirement in v1. The in-app route reflects the real CSS/runtime and current auth environment more accurately.

---

## 25. Explicit anti-pattern list

The following are considered design regressions:

- adding another desktop top-level horizontal tab
- using Playfair or public-site editorial typography in Ops
- adding a new one-off status color
- page-specific custom button styling when a primitive exists
- card-per-row desktop collections
- nested rounded containers used only for decoration
- permanent healthy-state banners
- technical worker/API details above the operational task
- arbitrary `max-w-*` wrappers fighting the application shell
- multiple unrelated primary buttons in one header
- desktop tables copied directly to mobile with unreadable horizontal scrolling when a structured row would work
- `window.confirm`
- icon-only navigation without labels
- decorative gradients or large shadows
- using tabs as global application navigation
- hiding important actions inside More purely to make the UI look cleaner
- introducing a new component library before the internal primitive layer proves insufficient
- raw hex values, arbitrary Tailwind values, or z-index values outside the token files
- selected/active states shown by soft fill alone
- commitment times (check-in, cleaning windows) shown as relative time or without a known time zone
- clearing a form or replacing the page with a spinner after a network failure
- hardcoded cleaner-shell user-visible strings outside the cleaner Ops translation namespace
- dark mode implemented with CSS inversion, duplicated component markup, or page-specific dark overrides instead of semantic tokens
- a component/state that has only been reviewed in one appearance

---

## 26. Design review test

Before a migrated/new Ops screen is accepted, answer all of these:

1. Can a user tell where they are immediately?
2. Is the main task visually dominant?
3. Is there only one obvious primary action?
4. Are healthy/system states quieter than exceptions?
5. Does the page match one canonical page grammar or an approved exception?
6. Are existing primitives used instead of one-off styling?
7. Are statuses identical to the rest of Ops?
8. Is desktop dense enough for repeated use?
9. Is mobile focused and touch-safe?
10. Can the page be operated with keyboard?
11. Are loading, empty, success, error, and destructive states defined?
12. Does any card exist without a meaningful grouping reason?
13. Would a new operator understand the label without knowing the database/code?
14. Does anything look like the public marketing site rather than operational software?
15. If this pattern appeared on ten more pages, would the system still feel coherent?
16. Does the screen hold up with 30% longer labels and Cyrillic content?
17. On a weak connection, does it show freshness, keep input on failure, and avoid full-page spinners?
18. Does it pass the automated checks in section 29 with zero new exceptions?
19. Are all times unambiguous and in property time?
20. Has the screen/component been checked in both light and dark appearances?
21. If it appears in the cleaner shell, is every user-visible string available in both English and Bulgarian?

If any answer is no, the design is not finished.

---

## 27. Implementation boundary

This design guide intentionally does **not** authorize:

- route changes
- permission-module changes
- backend rewrites
- new Guest CRM entities
- new Rate Plan product areas
- global search backend work
- redesigning business logic

Those require separate product/technical decisions.

The migration strategy remains incremental: isolate Ops visually, establish light/dark semantic tokens and primitives, replace the desktop shell, standardize page chrome/interactions, then migrate collections/details and finally regroup the IA.

Each migration step follows the existing workflow: define the work, Cursor audit only, review the audit, build, review the result.

---

## 28. Research basis

This guide is informed by the Drift & Dwells Ops factual audits plus current public guidance from mature operational systems and platform accessibility/theme guidance.

Stable primary references:

- Shopify Admin / Polaris web components: https://shopify.dev/docs/api/app-home/latest/web-components
- Shopify admin visual refresh guidance: https://shopify.dev/changelog/prepare-your-app-for-the-shopify-admins-new-look
- Atlassian, Designing the new navigation: https://www.atlassian.com/blog/how-we-build/designing-atlassians-new-navigation
- Atlassian Design System, Spacing: https://atlassian.design/foundations/spacing
- Atlassian Design System, Elevation: https://atlassian.design/foundations/elevation
- Linear, Behind the latest design refresh: https://linear.app/now/behind-the-latest-design-refresh
- Stripe Dashboard search: https://docs.stripe.com/dashboard/search
- Stripe Apps empty-state pattern: https://docs.stripe.com/stripe-apps/patterns/empty-state
- Apple Human Interface Guidelines, Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Apple Human Interface Guidelines, Color: https://developer.apple.com/design/human-interface-guidelines/color
- MDN, `color-scheme`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme
- MDN, `prefers-color-scheme`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme
- W3C WCAG 2.2: https://www.w3.org/TR/wcag/
- W3C non-text contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast
- W3C target size minimum: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- W3C focus appearance: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance

### Research conclusions applied here

- Mature admin software prioritizes predictable structure, density, reusable components, and low visual noise.
- Scalable application navigation benefits from a persistent side hierarchy rather than a growing row of equal-weight top-level destinations.
- Navigation should recede after orientation so operational content receives attention.
- Global search can eventually combine destination navigation and resource lookup, so the shell reserves a permanent location without making search a phase-one dependency.
- Dark appearance should use adaptive semantic colors rather than simple inversion; system preference should be supported, and browser-native controls should be told which color scheme is active.
- Accessibility requirements apply in both themes. Dark mode never relaxes contrast, focus, keyboard, or state-identification requirements.

---

## 29. Enforcement

A guide that is only read will drift. The rules that can be checked by machine MUST be checked by machine, so review time goes to judgment calls.

Automated checks on every change under Ops:

| Rule | Mechanism |
|---|---|
| No raw hex colors outside the token file | Stylelint `color-no-hex` scoped to Ops, token file excluded; lint for hex in class strings |
| No arbitrary Tailwind values (`p-[13px]`, `text-[#...]`) | Lint rule / grep check in CI |
| No `window.confirm`, `alert`, `prompt` | ESLint `no-restricted-globals` |
| No Playfair/Lato in Ops | Grep check on Ops routes and styles |
| Dark/light token completeness | CI verifies every required semantic token has both light and dark values |
| Cleaner translation coverage | Cleaner-shell user-visible strings must resolve through the cleaner Ops translation namespace |
| No direct overlay implementations | ESLint `no-restricted-imports` for overlay libraries outside the primitive layer |
| Accessibility | axe checks on `/ops/design-system` and each migrated page in both light and dark appearances, zero serious or critical violations |
| Tokens only from the token file | Token file is the single source; the guide's tables are generated from or checked against it |

Cursor:

- A project rule file (for example `.cursor/rules/ops-design.mdc`) scoped to Ops paths MUST reference this guide and list the MUST rules and anti-patterns in short form.
- Audit prompts for Ops work MUST ask the agent to report every deviation from this guide, not only fix bugs.

---

## 30. Governance

- **Owner:** Jose Antonio Fiallo León. Only the owner approves a version change.
- **Versioning:** token or rule changes bump the minor version (1.1, 1.2). A change to principles or shell structure bumps the major version.
- **Exception register:** a short table in the repo next to this guide. Each exception records screen, rule, reason, and review date. An exception without a review date is not valid. Exceptions that survive two reviews become either a rule change or a fix.

### 30.1 Changelog

**1.2 (LOCKED, 19 Sep 2026)**

- Dark mode is required; added System / Light / Dark behavior and exact dark semantic tokens
- Admin/operator UI locked to English; cleaner-only shell locked to EN/BG
- `Growth` nav label replaced with `Insights`
- Namespaced status registry semantics locked from the factual Cursor inventory
- Work Windows may remain a spatial exception but ordinary occupied reservations no longer use danger red
- Cleaning pending is warning, not danger
- Sync stale is warning/amber everywhere
- Review approved/pending/hidden statuses separated semantically
- Backend `void` / `voided` commission states map to one UI `Voided` status
- Coarse-pointer interactive rows explicitly require 44px minimum height
- Selected-state rule corrected: font weight alone is not a compliant state indicator
- Accessibility wording corrected to distinguish WCAG 2.2 AA from stricter Drift & Dwells product standards
- Stable dark-mode research references added
- Open decisions closed

**1.1 (proposed, 19 Sep 2026)**

- Normative MUST/SHOULD/MAY language; soft values replaced by exact values
- `--ops-text-muted` changed from `#737B74` (failed 4.5:1) to `#666D67`
- Added `--ops-border-control`, `--ops-focus`, `--ops-text-disabled`; contrast table
- Selected-state rule (soft fill plus 3:1 indicator); link rules
- Font loading, Cyrillic subset, tabular numerals
- Sizing, elevation, layering and breakpoint tokens; `pointer: coarse` touch rule
- Table row heights and truncation; toasts; empty-state distinction
- Connectivity and data freshness (15.1)
- Localization, time zone and money rules (19.1 to 19.3)
- Status registry structure (12.1)
- Enforcement (29), governance (30), open decisions (31)
- Removed em dashes for house style

**1.0 (19 Sep 2026):** initial locked baseline.

---

## 31. Resolved product decisions

These decisions are locked for v1.2.

1. **Ops UI language:** admin/operator is English-only. Cleaner-only shell supports English and Bulgarian.
2. **Status system:** namespaced registry in section 12. Backend keys remain unchanged; presentation is unified.
3. **Navigation label:** use `Insights`, not `Growth`, for Insights / Historical performance / Conversion / Quote recovery. Creator partners remain under Property.
4. **Cleaning on mobile:** for admin/operator roles, Cleaning stays under `More`. Cleaner-only users retain the dedicated Cleaning shell.
5. **Tablet behavior:** `768–1023px` uses the desktop shell with collapsed sidebar by default; `pointer: coarse` controls touch sizing independently.
6. **Appearance:** Light and Dark are both first-class. First-run default is System; explicit Light/Dark override persists per device.
7. **Dark-mode implementation:** semantic token override only; no inversion filter and no page-specific dark redesign.
8. **Research references:** preview Polaris hosts are not canonical references; stable Shopify/Atlassian/Linear/Stripe/Apple/MDN/W3C URLs in section 28 are the baseline.

---

## 32. Lock statement

This is **Drift & Dwells Ops Design Language v1.2**, the locked baseline for the Ops redesign.

It supersedes v1.0 and proposed v1.1.

New screens and migrated screens MUST conform to this guide unless a later explicitly versioned design decision supersedes part of it.

Page-by-page convenience is not a valid reason to diverge from the system.

Changes to this guide require the governance process in section 30. The implementation may be incremental; the design contract is not.
