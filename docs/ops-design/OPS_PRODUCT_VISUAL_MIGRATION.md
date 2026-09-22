# Ops premium product migration

This document records the architecture boundary for the v1.5 product-wide visual revision.

## Shared ownership

- `OpsPage` owns page width, responsive padding, and the content container query.
- `OpsPageHeader` owns page-title hierarchy, description, metadata, and action placement.
- `OpsSurface` owns section chrome, section-title hierarchy, and mobile-card/desktop-rule behavior.
- `OpsMetric` owns metric labels, values, and display typography.
- `OpsTable` owns comparable desktop data presentation and divider treatment.
- `OpsRecord` owns non-tabular collection-row chrome across list pages.
- `OpsModal` owns overlay behavior, focus management, sizes, and the optional mobile-sheet contract.
- Buttons, fields, statuses, banners, empty states, and overlays remain canonical primitives.
- `CabinEditorSection` composes those core primitives for the cabin domain; cabin editors do not own a second visual system.

Feature CSS owns domain composition only: grids, spatial timelines, content flow, and responsive ordering. It does not own surface borders, backgrounds, radii, shadows, or heading type.

## Menu-destination ledger

All 23 destinations in `OPS_NAV_ITEMS` inherit the same desktop shell, page-width, typography, control, status, and surface contracts. This ledger is intentionally explicit so a menu destination cannot silently fall outside the product migration.

- `/ops` — `OpsPage`, `OpsPageHeader`, `OpsSurface`, `OpsMetric`; the audited dashboard signal ledger remains at zero missing signals.
- `/ops/calendar` — shared page/header contract; the calendar grid remains a registered spatial exception.
- `/ops/calendar/work-windows` — shared page/header and plain surfaces; the timeline remains a registered spatial exception.
- `/ops/cleaning` — shared page/header contract; the cleaning calendar remains a registered spatial exception.
- `/ops/reservations` — shared page/header, filter bar, table, and `OpsRecord` mobile collection rows.
- `/ops/payments` — shared page/header, fields, statuses, surfaces, and table.
- `/ops/promo-codes` — shared page/header, fields, statuses, surfaces, table, and overlays.
- `/ops/rate-plans` — fully migrated from legacy local chrome to shared page/header, filter, table, statuses, fields, surface, sheet, and confirmation primitives.
- `/ops/creator-partners` — shared page/header and `OpsRecord` collection rows; detail composition inherits shared surfaces.
- `/ops/sync` — shared page/header, statuses, surfaces, tables, and actions.
- `/ops/cabins` — shared page/header and `OpsRecord` collection rows; active detail editors compose `CabinEditorSection` from canonical primitives.
- `/ops/reviews` — shared page/header, filter controls, statuses, and `OpsRecord` collection rows.
- `/ops/communications` — shared page/header, filters, statuses, surfaces, tables, and canonical message-preview overlay.
- `/ops/messaging` — shared page/header, filters, statuses, surfaces, tables, and canonical email/WhatsApp preview overlays.
- `/ops/gift-vouchers` — shared page/header, filter bar, statuses, surfaces, tables, fields, and overlays.
- `/ops/insights` — shared page/header, metrics, filters, and surfaces.
- `/ops/insights/performance` — shared page/header, metrics, filters, surfaces, and tables.
- `/ops/conversion` — shared page/header, metrics, filters, surfaces, and tables.
- `/ops/conversion/recovery` — shared page/header, statuses, filters, surfaces, and tables.
- `/ops/manual-review` — shared page/header, statuses, filters, surfaces, and tables.
- `/ops/readiness` — shared page/header, statuses, surfaces, and actions.
- `/ops/settings/cleaning` — shared page/header, fields, banners, and surfaces.
- `/ops/users` — shared page/header, statuses, fields, table, and overlays.

Menu-destination missing count: **0**.

## Nested workflow coverage

- Reservation Move Unit uses the canonical modal, fields, buttons, banners, statuses, and reusable mobile-sheet behavior while preserving its idempotency and conflict-handling workflow.
- Email and WhatsApp previews use the canonical modal/table/banner system while preserving sandboxing, metadata, reference bodies, and variable evidence.
- Cabin content, arrival, occupancy, pricing, experiences, transport, media, and unit/export editors use one domain composition layer over the core primitives.
- `CreateCabinModal.jsx` is dead legacy source with no production import; the live Create Cabin workflow already uses the canonical modal in `OpsCabinsList`.

## Responsive contract

- Below the desktop content threshold, existing card composition, control sizes, and typography remain unchanged.
- At desktop content widths, default sections become open ruled groups and tables become divider-led surfaces.
- The desktop sidebar and topbar are governed by the shared shell: white canvas, restrained uppercase groups, soft-graphite active destinations, and consistent page insets.
- Spatial products retain bounded grids where removing containment would reduce comprehension.

## Behavior contract

This migration changes presentation only. Routes, permissions, API calls, actions, statuses, form behavior, data fields, and drilldowns are unchanged.
