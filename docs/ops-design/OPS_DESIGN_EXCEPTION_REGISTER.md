# Ops design exception register

Approved deviations from `docs/ops-design/DND_OPS_DESIGN_LANGUAGE_GUIDE_V1_2_LOCKED.md`.

Legacy Ops screens under `client/src/pages/ops/**` are **not migrated yet**. They are not listed here. Do not turn the unmigrated tree into hundreds of exceptions.

An exception without a review date is not valid. Exceptions that survive two reviews become either a rule change or a fix.

Owner of the locked guide: Jose Antonio Fiallo León.

| ID | Screen / component | Rule | Reason | Owner | Date approved | Review date | Status |
|---|---|---|---|---|---|---|---|
| EX-CAL-01 | Ops Calendar index + cabin month (`/ops/calendar`, `/ops/calendar/:cabinId`) | §6.5 spatial exception; page width `full`; calendar category colors via `--ops-calendar-*` (incl. violet external hold) | Approved spatial planner surface: dense month grid + preview strips need full width and stable category colors that are not status families. Ordinary occupied reservations stay reservation blue, not danger. | Jose Antonio Fiallo León | 2026-09-20 | 2026-12-20 | active |
| EX-WW-01 | Ops Work Windows (`/ops/calendar/work-windows`) | §6.5 spatial exception; page width `full`; work-window span colors via `--ops-work-*` (free / turnaround / occupied / blocked) | Approved spatial Gantt planner: sticky resource labels + day columns need full width and internal H-scroll. Occupied means guest occupancy (info/blue), never danger/red. | Jose Antonio Fiallo León | 2026-09-20 | 2026-12-20 | active |
