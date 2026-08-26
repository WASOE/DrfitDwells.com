# OPS UI standard (existing conventions)

This documents **canonical patterns already used** in mature OPS pages — especially the Dashboard and list-style tools (Reservations, Payments, Sync, Cabins). It is not a new visual redesign.

**Primary references:** `client/src/pages/ops/OpsDashboard.jsx`, `client/src/layouts/OpsLayout.jsx`

**Calendar / Cleaning family** (`rounded-2xl`, Playfair, `max-w-lg`) is a separate legacy fork. **New OPS features should follow Dashboard/list patterns**, not Calendar.

---

## Page wrapper

```text
space-y-4 pb-16 sm:pb-0
```

- `pb-16 sm:pb-0` clears the mobile bottom tab bar.
- Do **not** add another page-level `max-w-*` on top-level OPS tools.

## Width

Use `OpsLayout` shell only:

```text
max-w-7xl mx-auto px-4 sm:px-6 lg:px-8
```

Wide tools (timelines, tables) use the full shell width. Put horizontal overflow **inside** the tool (`overflow-x-auto`), not on the page root.

## Panel

```text
bg-white border border-gray-200 rounded-xl p-4
```

- No `shadow-sm` by default.
- Nested rows: `border border-gray-200 rounded-lg px-3 py-2`

## Page title

```text
h2 text-lg font-semibold text-gray-900
```

## Subtitle

```text
text-sm text-gray-500
```

## Section title

```text
text-sm font-semibold text-gray-900
```

Use `h3` when inside a panel section.

## Controls

- Labels: `text-xs text-gray-500 mb-1`
- Inputs/selects: `px-3 py-2 text-sm border border-gray-200 rounded-lg`
- Filter grids: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2`

## Primary CTA

Use the established sage button (Reservations, Cabins, Reviews):

```text
px-4 py-2 text-sm font-medium rounded-lg bg-[#81887A] text-white hover:bg-[#707668]
```

Secondary actions: `border border-gray-200|300 … hover:bg-gray-50`

## Status chips / badges

```text
text-xs px-2 py-0.5|py-1 rounded border border-gray-200 bg-gray-50
```

Add semantic border/bg only when the chip carries meaning (amber warning, emerald healthy, etc.).

## Color

- Default chrome: white panels, gray borders, gray text.
- Semantic color: timeline bars, small chips, alert tones — not full informational panels.

## Loading / error / empty

- Loading: `text-sm text-gray-500`
- Error: `text-sm text-red-600` (Dashboard) or boxed red only when the page already uses alert panels
- Empty: short `text-sm text-gray-500`; avoid large custom empty-state heroes

## Top-level navigation pages

Work Windows, Dashboard, Reservations, etc. are **top-level nav destinations**.

- **No** square back-arrow tile.
- Nested detail pages use a text link: `text-sm text-[#81887A] hover:underline` (“Back to …”).

## Wide tools

- Full OPS shell width.
- Sticky columns and internal scroll for timelines/tables.
- `overflow-x-hidden` on page root only to prevent accidental page-wide scroll.

## Avoid for new OPS pages

- Page-specific `max-w-lg`, `max-w-3xl`, `max-w-5xl` without a strong reason (detail/read views excepted)
- Playfair / `font-serif` page titles
- `rounded-2xl shadow-sm` panel chrome (Calendar family)
- `bg-gray-900` or other one-off primary button colors
- Uppercase tracked section eyebrows (`BEST WORK WINDOWS`)
- Full-color promotional cards (`bg-emerald-50` panels) for operational data
- New typography scales when Dashboard patterns already exist

## Shared components

There is **no** shared OPS page-header or card component yet. Copy Tailwind strings from Dashboard/list pages until duplication justifies extraction.
