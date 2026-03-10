# Date Picker Audit – Design Doc vs Current Usage (Audit Only)

**Scope:** Compare your standardized design (Airbnb-style, aligned with Guest Selector) to where date pickers are used across the app. No code changes—audit only.

---

## 1. Design documents (what “we had” / standard)

- **`DATEPICKER_DESIGN_AUDIT.md`** – Element-level audit of the **react-datepicker** calendar (popper, header, day cells, states). Baseline: match **Guest Selector** (white container, gray-200 border, rounded-xl, shadow-2xl, Playfair Display on container; many date-cell states still “using defaults”).
- **`DATEPICKER_COMPLETE_AUDIT.md`** – Full spec for **react-datepicker** aligned to **Guest Selector**: Inter font, gray scale, px-6 content padding, rounded-lg date cells, selected = gray-900, range styling, z-index 999999, etc. Notes inconsistencies (font weight 600 vs 500, disabled opacity 0.4 vs 0.3, rounded-lg vs guest’s rounded-full).

**Standardized intent:** Airbnb-style date picking; calendar styling consistent with the Guest Selector popup (same container look, spacing, typography, and interaction patterns where applicable).

---

## 2. Where date pickers are used

| Location | Component / library | UX | Design doc reference |
|----------|--------------------|----|------------------------|
| **SearchBar (desktop)** | `react-datepicker` via `DatePickerLazy.jsx` | Two inline inputs (Check-in, Check-out); calendar opens in portal `#datepicker-portal`; range selection (selectsStart/selectsEnd). | **react-datepicker** – `DATEPICKER_DESIGN_AUDIT.md` and `DATEPICKER_COMPLETE_AUDIT.md` both target this (popper, `.react-datepicker__*` classes). |
| **BookingModal** (“Plan your stay”) | **react-day-picker** (`DayPicker`) | Single range calendar in a modal; “When will you be there?”; 1 or 2 months; dropdown month/year; fromDate = today; stone palette (stone-900, stone-100). | **Not** in the design docs. Design docs only specify **react-datepicker** and Guest Selector. |
| **ChangeDatesModal** (Confirm booking flow) | **react-day-picker** (`DayPicker`) | Explicitly “Airbnb-style” in code comment: range calendar, “Clear dates”, “Save”; 1 or 2 months; dropdown caption; gray palette (gray-900, gray-100); uses `daypicker-theme.css`. | **daypicker-theme.css** says “aligned with DATEPICKER_DESIGN_AUDIT.md / design system” but design docs don’t define DayPicker; only react-datepicker. |

---

## 3. Two different libraries

- **SearchBar (desktop):** **react-datepicker** – input + popper calendar, portal, range. This is what both design audits describe (classes like `.react-datepicker`, `.react-datepicker__day`, etc.).
- **BookingModal + ChangeDatesModal:** **react-day-picker** – inline calendar only (no input), different API and CSS (`.rdp-*`, `modifiersClassNames`). Design docs do **not** define this component; `daypicker-theme.css` only sets a few CSS variables (e.g. `--rdp-accent-color: #111827`).

So the “standardized” design in the docs applies **only** to the **SearchBar** date picker (react-datepicker). The other two are **DayPicker** and are not fully specified in the design docs.

---

## 4. Consistency vs design standard

### 4.1 SearchBar (react-datepicker)

- **Design doc:** `DATEPICKER_COMPLETE_AUDIT.md` describes the desired state (Inter, gray scale, px-6, rounded-lg, selected gray-900, etc.). `DATEPICKER_DESIGN_AUDIT.md` flags many elements as “using defaults” (date cell states, spacing, typography).
- **Current:** Calendar is loaded lazily (DatePickerLazy + dynamic CSS); renders in `#datepicker-portal`. Global overrides in `index.css`: `.react-datepicker-popper` and `.react-datepicker` z-index 9999. No custom CSS file in the repo applies the full COMPLETE audit (header padding, day names, nav arrows, all cell states). So the **implemented** styling does **not** fully match the **documented** standard.

### 4.2 BookingModal (DayPicker)

- **Design doc:** None for DayPicker. Not mentioned in the two datepicker audits.
- **Current:** Range picker, stone palette, Playfair Display caption, 1/2 months, dropdown caption. Matches the **tone** of the site but not the same component or spec as the react-datepicker design.

### 4.3 ChangeDatesModal (DayPicker) – “Airbnb-style”

- **Design doc:** Comment says “Airbnb-style”; `daypicker-theme.css` says aligned with DATEPICKER_DESIGN_AUDIT. The design audits themselves only describe react-datepicker, so “Airbnb-style” here means: range selection, “Clear dates”, “Save”, modal layout—not the same CSS spec as the audits.
- **Current:** Range picker, gray palette, `rounded-full` for selected in modifiersClassNames, `daypicker-theme.css` (rdp variables). This is the one that explicitly aims for Airbnb-like behavior and reuses the design system colors (e.g. #111827).

---

## 5. Summary table (audit only)

| Item | Design doc | Current implementation | Aligned? |
|------|------------|------------------------|----------|
| SearchBar desktop date picker | react-datepicker, full spec in COMPLETE audit (Inter, gray, px-6, cells, z-index, etc.) | react-datepicker in portal; only z-index in index.css; no full custom theme file | ❌ Spec exists; implementation does not match full spec. |
| BookingModal calendar | No DayPicker spec | DayPicker, stone palette, Playfair, range | N/A (no spec). |
| ChangeDatesModal calendar | “Airbnb-style” + daypicker-theme “aligned with design” | DayPicker + daypicker-theme.css (rdp vars) + gray UI | ⚠️ Conceptually Airbnb-style; design docs don’t define DayPicker. |
| Guest Selector | Baseline for datepicker (container, padding, typography) | Used in SearchBar next to date fields | ✅ Guest Selector is the reference; datepicker should match it per docs. |

---

## 6. Findings (audit only)

1. **Single design standard in docs:** The written standard is **react-datepicker** aligned to **Guest Selector** (DATEPICKER_DESIGN_AUDIT.md + DATEPICKER_COMPLETE_AUDIT.md). Only **SearchBar** uses that library.
2. **SearchBar date picker:** Does not implement the full design (no custom CSS applying the COMPLETE audit). Only z-index and lazy-load behavior are clearly present.
3. **Other date pickers:** **BookingModal** and **ChangeDatesModal** use **react-day-picker**, which the design docs do not define. They are “Airbnb-style” in behavior (range, clear, save); styling is via inline modifiers + `daypicker-theme.css` (DayPicker only).
4. **Two libraries:** So you effectively have two patterns: (a) react-datepicker for SearchBar (intended to match the written standard), (b) react-day-picker for modals (Airbnb-style UX, design alignment only by color/tone, not by written spec).

No code or repo state was changed for this audit.
