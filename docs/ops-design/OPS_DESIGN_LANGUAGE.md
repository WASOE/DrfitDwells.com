# Drift & Dwells OPS design language

Status: **authoritative and locked**

Scope: every authenticated OPS route, component, workflow, and future feature

Companion: `OPS_DESIGN_EXCEPTION_REGISTER.md` contains the only approved deviations

This is the single source of truth for the Drift & Dwells operational product. It replaces every earlier dashboard style guide, migration note, and page-local convention.

The design is not a skin applied to the Dashboard. It is the shared product language for the complete OPS application.

## 1. Product character

OPS should feel like a calm, premium operating system for hospitality:

- minimal without hiding information;
- monochrome and restrained until meaning requires color;
- spacious at the page level, dense where operators compare records;
- typographically confident, with clear financial and operational hierarchy;
- consistent across Dashboard, lists, details, settings, calendars, and overlays;
- fast to scan and predictable to operate.

The visual reference established a direction, not a reduced data model. Product truth always wins over visual minimalism.

## 2. Non-negotiable product rules

1. **Preserve operational information.** A redesign may reorganize information but must not remove a metric, alert, status, identity, date, source, action, health signal, or drilldown.
2. **Keep distinct signals distinct.** `Confirmed`, `Paid`, `Arriving tomorrow`, and `Airbnb` describe different facts and must never be collapsed into one generic badge.
3. **Use the shared system before writing feature CSS.** Page code composes primitives; it does not recreate their chrome.
4. **Make exceptions semantic.** Color, elevation, and emphasis are earned by state or task importance, never added for decoration.
5. **Do not redesign mobile by accident.** Desktop and mobile share semantics and components, while their compositions may differ intentionally.
6. **Do not change behavior during visual work.** Permissions, API calls, routes, validation, idempotency, and workflows remain unchanged unless separately specified and tested.
7. **One product, one language.** A new menu destination or nested workflow is part of OPS immediately; there is no provisional local design system.

## 3. System ownership

Use these layers in this order:

| Layer | Authority | Owns |
|---|---|---|
| Foundation | `client/src/ops/ops.css` | semantic color, typography, spacing, radius, shadow, sizing, motion, breakpoints, z-index |
| Shell | `client/src/layouts/ops/opsShell.css` | sidebar, topbar, navigation, global content frame |
| Primitives | `client/src/ops/primitives/` | reusable visual and interaction contracts |
| Status | `client/src/ops/status/opsStatusRegistry.js` | labels, tones, loudness, icons, status meaning |
| Domain composition | `client/src/pages/ops/**` | domain layout, data binding, feature behavior, responsive ordering |
| Exceptions | `docs/ops-design/OPS_DESIGN_EXCEPTION_REGISTER.md` | reviewed deviations with owner and expiry |

Feature CSS may own grids, timelines, charts, data-specific alignment, and responsive ordering. It must not own a second token palette, surface system, type scale, button system, status system, or overlay system.

## 4. Visual foundation

### 4.1 Color

The structural foundation is black, white, and neutral gray.

- Canvas, sidebar, topbar, surfaces, borders, navigation, and primary actions are neutral.
- Graphite is the primary action and selected-state color.
- Green is semantic only. It is not brand chrome.
- Blue is informational or focus-related.
- Amber is warning or pending attention.
- Red is destructive, failed, or critical.
- Raw visual hex values are allowed only in the canonical token source.
- Light and dark appearance use the same semantic token names.

Use `--ops-*` variables. Never introduce page-local colors, Tailwind `gray-*` palettes, `dark:` forks, or decorative gradients.

### 4.2 Typography

OPS uses two roles:

- **Montserrat** for the premium display hierarchy: desktop page titles, surface titles, metrics, and the Dashboard lead value.
- **Inter** for controls, labels, body copy, metadata, tables, and dense operational text.

Montserrat is loaded centrally and includes Cyrillic support. Do not add a page-local `font-family`. Do not use Playfair, serif, script, or public-site editorial typography inside OPS.

Typography is sentence case. Avoid decorative uppercase except restrained navigation group labels already owned by the shell.

### 4.3 Spacing and shape

Use the canonical spacing scale: 4, 8, 12, 16, 20, 24, 32, and 48 pixels through the existing tokens.

- Controls use the canonical control radius.
- Mobile/card surfaces use the canonical surface radius.
- Desktop ruled sections are not rounded cards.
- Shadows are rare and reserved for overlays or genuinely raised interactive layers.
- Do not use arbitrary spacing, radius, z-index, or shadow values when a token exists.

### 4.4 Motion

Motion is short, functional, and optional. Use the canonical fast duration and easing. Respect reduced motion. Never use animation to make static operational information feel promotional.

## 5. Composition grammar

### 5.1 Shell

The desktop shell is a quiet white/neutral frame with a persistent sidebar, compact topbar, and consistent content inset. Active navigation uses soft graphite, not a colored brand block.

The mobile shell retains its purpose-built navigation and touch sizing. Desktop shell refinements must not leak into mobile through broad selectors.

### 5.2 Pages

Every page begins with `OpsPage` and `OpsPageHeader`.

- `OpsPage` owns width, horizontal padding, vertical rhythm, and the content container.
- `OpsPageHeader` owns title, description, metadata, and page actions.
- Choose `narrow`, `default`, `wide`, or `full` from the existing width contract.
- Do not add a second page-level max width.
- Use `full` only for approved spatial tools such as calendars and timelines.

### 5.3 Surfaces

Use `OpsSurface` for a meaningful section.

- On desktop, ordinary surfaces become open, divider-led groups with premium title hierarchy.
- On smaller layouts, they retain bounded card composition where containment improves scanning.
- Nested content should use rows and dividers, not cards inside cards.
- A feature may control internal layout but may not recreate borders, background, radius, shadow, or title styling.

Use `OpsSurfaceHeader`, `OpsSurfaceTitle`, and `OpsSurfaceDescription` instead of local heading chrome.

### 5.4 Collections and tables

Use `OpsTable` when columns are meaningfully comparable. Use `OpsRecord` or `OpsCollectionRow` for responsive records and non-tabular lists.

- Desktop tables are divider-led, aligned, and compact.
- Mobile records may stack labels and values, but must preserve every useful field and action.
- Numeric values align consistently and use tabular numerals where appropriate.
- Horizontal scrolling belongs inside the data tool, never on the page root.

### 5.5 Metrics

Use `OpsMetric` and `OpsMetricGroup` for standard metrics.

- The Dashboard may use one oversized lead value to express the primary business result.
- Supporting metrics remain subordinate and comparable.
- A large number must still have an explicit label and unambiguous money/time semantics.
- Goal, comparison, or pace treatments may be added only when backed by a real source of truth. Do not manufacture targets or projections in presentation code.

## 6. Dashboard contract

The Dashboard is the clearest expression of the system, not a special page with unrelated styling.

Its hierarchy is:

1. current date and primary actions;
2. business lead value and supporting monthly metrics;
3. today’s arrivals, in-house stays, and departures;
4. critical work and upcoming operations;
5. voucher/cash information and product health signals.

The oversized financial value is intentionally motivational and visually dominant. It must not push today’s operations beyond useful first-screen reach on normal desktop viewports.

The Dashboard information-preservation contract includes, when available:

- critical alerts, severity, and action;
- arriving today, staying now, and leaving today;
- guest identity, external identity, unit, dates, and source/channel;
- reservation, payment, and operational timing statuses as separate signals;
- upcoming operations and their drilldowns;
- bookings MTD, gross booked MTD, paid active stays, open-payment active stays, cancellations MTD, and refunds MTD;
- gift-voucher sales, collected cash, fees, liability, and redemptions;
- sync, communications, webhook, and manual-review health;
- every useful action and drilldown.

Any Dashboard change must include a current-signal-to-new-location ledger. Missing-signal count must be zero before merge.

The graphite **New booking** action must reuse the supported Reservations `Create reservation` workflow. Never create a second booking flow from the Dashboard.

## 7. Canonical primitives

Use the existing primitive that matches the job:

- Structure: `OpsPage`, `OpsPageHeader`, `OpsSurface`
- Data: `OpsMetric`, `OpsTable`, `OpsRecord`, `OpsCollectionRow`, `OpsPagination`
- Controls: `OpsButton`, `OpsIconButton`, `OpsTextField`, `OpsTextarea`, `OpsSelect`, `OpsCheckbox`, `OpsFilterBar`
- Meaning: `OpsStatus`, `OpsBadge`, `OpsBanner`, `OpsInlineError`
- States: `OpsLoadingState`, `OpsEmptyState`
- Overlays: `OpsModal`, `OpsSheet`, `OpsConfirmDialog`, `OpsTooltip`

Before adding a primitive:

1. prove that no existing primitive can express the pattern;
2. confirm the pattern is useful in more than one domain or is a true system-level interaction;
3. add it to the design-system showcase and tests;
4. document its ownership here;
5. do not introduce another UI or overlay library without explicit approval.

## 8. Actions, forms, and overlays

### Actions

- One primary action per decision area.
- Primary means graphite, not green.
- Secondary actions are neutral and quieter.
- Destructive styling is reserved for a real destructive consequence.
- Icon-only controls require an accessible name and tooltip where meaning is not universally obvious.

### Forms

- Use canonical fields and visible labels.
- Help text explains format or consequence; errors explain how to recover.
- Required state, disabled state, saving state, and validation must remain visible without relying on color alone.
- Do not create local input height, border, focus, or label systems.

### Overlays

- Use `OpsModal` for focused decisions and bounded editing.
- Use `OpsSheet` for contextual workflows that benefit from retained page context.
- Use `OpsConfirmDialog` for consequential confirmation.
- Reuse the canonical mobile-sheet behavior when provided by the primitive.
- Never use `window.confirm`, `alert`, `prompt`, page-local portals, or a second focus-management implementation.

## 9. Status and semantic language

All operational statuses come from `opsStatusRegistry.js`.

- Do not create a page-local label or color map.
- A new backend state requires an explicit registry entry, context, tone family, and loudness.
- Status labels describe facts, not vague sentiment.
- Success should be quiet when it represents normal operation.
- Warnings and danger earn attention only when action is required.
- Color is reinforced by text and, when useful, an icon.

Spatial category colors for calendars and work windows are approved domain tokens, not reusable status colors.

## 10. Responsive behavior

Responsive design preserves meaning, not identical geometry.

### Mobile

- Keep the established mobile shell and touch targets.
- Prefer stacked records to compressed tables.
- Preserve labels, values, statuses, and actions.
- Use cards where they improve grouping and tap comprehension.
- Never hide a signal merely to make the layout smaller.

### Tablet

- Reflow actions and filter groups before reducing readable spacing.
- Avoid awkward half-desktop table layouts; choose the record or table mode intentionally.

### Desktop

- Use open ruled surfaces, consistent insets, and asymmetry to establish hierarchy.
- Keep operations visible near the top of the Dashboard.
- Use whitespace between major groups, not excessive padding inside every row.

Every visual change must be checked at 432, 1024, and 1440 pixels unless the feature has a more relevant documented breakpoint matrix.

## 11. Accessibility and interaction baseline

- Preserve semantic headings in order.
- Every interactive element is keyboard reachable.
- Focus is visible with the canonical focus token.
- Dialogs trap focus, restore focus, and expose an accessible name.
- Touch targets use the canonical mobile minimum.
- Text and meaningful UI meet WCAG AA contrast.
- Do not communicate state through color alone.
- Loading, empty, error, offline, stale, and saving states must be designed—not left as raw text or browser behavior.

## 12. Spatial exceptions

Calendar, Work Windows, and Cleaning Calendar are spatial products. They may use full width, bounded planner grids, sticky axes, and approved category colors because removing those structures would reduce comprehension.

They still inherit the shell, page header, typography, controls, statuses, overlays, and semantic tokens. Their exact deviations live in the exception register and expire unless reviewed.

No other feature may copy a spatial exception by resemblance. Request its own reviewed exception.

## 13. Adding a new OPS feature

Follow this sequence:

1. **Inventory information** — list every field, state, action, permission, and drilldown.
2. **Choose the page grammar** — dashboard, collection, detail, settings, or approved spatial tool.
3. **Map to primitives** — decide which canonical components own each part.
4. **Choose width and responsive mode** — document desktop, tablet, and mobile composition.
5. **Register statuses** — add missing semantic states centrally before rendering them.
6. **Compose domain layout** — write only the CSS needed for domain structure.
7. **Verify preservation** — confirm every inventory item has a rendered location.
8. **Test behavior** — permissions, routes, API calls, validation, and actions remain correct.
9. **Run design gates** — no raw visual values or parallel systems.
10. **Review at 432 / 1024 / 1440** — include populated, empty, loading, error, and long-content cases.

A feature is not complete if it looks correct in isolation but does not inherit the shell and primitive contracts.

## 14. Forbidden patterns

Do not:

- create a local card, button, field, badge, modal, or typography system;
- add raw hex colors outside the token source;
- use Playfair, serif, script, or page-local font declarations;
- use green for structural chrome or primary actions;
- add decorative gradients, glass effects, heavy shadows, or promotional illustration treatment;
- nest multiple bordered cards to manufacture hierarchy;
- use arbitrary Tailwind visual values when tokens exist;
- add a new status map outside the registry;
- add another overlay, animation, or component library without explicit approval;
- hide operational data on mobile;
- simplify by deleting information;
- introduce a second workflow when an existing production workflow can be reused;
- change information architecture during an unapproved visual task;
- copy an exception into another feature;
- add a new design-language document.

## 15. Governance and enforcement

This document is the only OPS design-language authority.

- Changes to the language must update this file, canonical tokens/primitives where applicable, and tests in the same commit.
- Deviations require an entry in `OPS_DESIGN_EXCEPTION_REGISTER.md` with reason, owner, approval date, review date, and status.
- Historical redesign notes belong in commit history, not parallel living documents.
- `/ops/design-system` is an internal showcase and test surface. It must not appear in operator navigation.
- New files under `client/src/pages/ops/**` are automatically covered by the design guard.

Run from `client/`:

```bash
npm run test:ops-design
```

For a feature release, also run the relevant unit/integration suite, production build, and browser QA.

## 16. Definition of done

An OPS feature is visually complete only when all answers are yes:

- Does it use the shared shell, page, header, and surface grammar?
- Are typography and colors entirely token-driven?
- Are actions, fields, statuses, tables/records, and overlays canonical?
- Is every useful signal still present and distinct?
- Does mobile preserve meaning and usability?
- Are loading, empty, error, offline/stale, saving, and long-content states handled?
- Do permissions and workflows behave exactly as intended?
- Are there zero unregistered visual exceptions?
- Does `npm run test:ops-design` pass?
- Has it been reviewed at the required viewport widths?

If any answer is no, the feature is not integrated into the Drift & Dwells OPS product.
