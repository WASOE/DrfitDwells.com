# Datepicker Complete Design Audit - Every Element Analyzed

## COMPARISON BASELINE: Guest Selector Popup

**Guest Selector Container:**
- Background: `bg-white` (#FFFFFF)
- Border: `border border-gray-200` (1px solid #e5e7eb)
- Border Radius: `rounded-xl` (0.75rem / 12px)
- Shadow: `shadow-2xl` (0 25px 50px -12px rgba(0, 0, 0, 0.25))
- Padding: `py-4` (1rem / 16px vertical, 0 horizontal)
- Overflow: `overflow-hidden`
- Font: System font (Inter, system-ui, sans-serif) - NOT explicitly set, inherits
- Z-index: `10001` (inline style)

**Guest Selector Content:**
- Row Padding: `px-6` (1.5rem / 24px horizontal)
- Row Spacing: `pb-6 mb-6` (1.5rem / 24px) between rows
- Row Border: `border-b border-gray-200` (1px solid #e5e7eb) between rows
- Label: `text-sm font-medium text-gray-900` (0.875rem, 500 weight, #111827)
- Description: `text-xs text-gray-500` (0.75rem, 400 weight, #6b7280)
- Value Display: `text-base font-medium text-gray-900` (1rem, 500 weight, #111827)
- Button Size: `w-8 h-8` (2rem / 32px)
- Button Border: `border border-gray-300` (1px solid #d1d5db)
- Button Border Radius: `rounded-full` (50%)
- Button Hover: `hover:border-gray-400` (#9ca3af)
- Button Disabled: `opacity-30` (0.3)
- Gap Between Elements: `gap-4` (1rem / 16px)

---

## DATEPICKER ELEMENT-BY-ELEMENT AUDIT

### 1. PORTAL CONTAINER
**Element:** `#datepicker-portal`
- **Position:** `relative`
- **Z-index:** `999999`
- **Current State:** ✅ Correct
- **Inconsistency:** ❌ Guest selector uses z-index `10001`, datepicker uses `999999` (inconsistent but intentional for layering)

### 2. POPPER WRAPPER
**Element:** `.react-datepicker-popper`
- **Position:** `fixed` (forced)
- **Z-index:** `999999`
- **Current State:** ✅ Correct
- **Inconsistency:** ❌ Different z-index than guest selector (10001 vs 999999)

### 3. MAIN CALENDAR CONTAINER
**Element:** `.react-datepicker`
- **Background:** `white` (#FFFFFF) ✅
- **Border:** `1px solid #e5e7eb` (gray-200) ✅
- **Border Radius:** `0.75rem` (12px, rounded-xl) ✅
- **Box Shadow:** `0 25px 50px -12px rgba(0, 0, 0, 0.25)` (shadow-2xl) ✅
- **Font Family:** `'Inter', system-ui, sans-serif` ✅
- **Padding:** `1rem 0` (py-4, no horizontal) ✅
- **Overflow:** `hidden` ✅
- **Z-index:** `999999`
- **Width:** Auto (default)
- **Current State:** ✅ Matches guest selector container

### 4. HEADER SECTION
**Element:** `.react-datepicker__header`
- **Background:** `white` (#FFFFFF) ✅
- **Border Bottom:** `1px solid #e5e7eb` (gray-200) ✅
- **Border Radius Top:** `0.75rem 0.75rem 0 0` ✅
- **Padding:** `0.75rem 1.5rem 0.5rem 1.5rem` (pt-3 px-6 pb-2)
  - Top: 0.75rem (12px)
  - Horizontal: 1.5rem (24px) ✅ matches guest selector px-6
  - Bottom: 0.5rem (8px)
- **Current State:** ⚠️ Padding structure different from guest selector (guest has consistent py-4, this has mixed padding)

### 5. MONTH/YEAR DISPLAY
**Element:** `.react-datepicker__current-month`
- **Font Family:** `'Inter', system-ui, sans-serif` ✅
- **Font Size:** `0.875rem` (14px, text-sm) ✅
- **Font Weight:** `500` (font-medium) ✅
- **Color:** `#111827` (gray-900) ✅
- **Text Align:** `center` ✅
- **Margin Bottom:** `0.5rem` (8px)
- **Letter Spacing:** Not set (default)
- **Line Height:** Not set (default)
- **Current State:** ✅ Typography matches guest selector label style

### 6. NAVIGATION ARROWS - LEFT
**Element:** `.react-datepicker__navigation--previous`
- **Position:** `absolute`
- **Top:** `0.75rem` (12px)
- **Left:** Default (not set)
- **Width:** `2rem` (32px) ✅ matches guest selector button size
- **Height:** `2rem` (32px) ✅ matches guest selector button size
- **Border:** `1px solid #d1d5db` (gray-300) ✅ matches guest selector
- **Border Radius:** `50%` (rounded-full) ✅ matches guest selector
- **Background:** `white` ✅
- **Hover Border:** `#9ca3af` (gray-400) ✅ matches guest selector
- **Hover Background:** `#f9fafb` (gray-50)
- **Transition:** `all 0.15s ease` ✅
- **Icon Color:** `#6b7280` (gray-500)
- **Icon Size:** `6px` width/height
- **Current State:** ✅ Matches guest selector button styling

### 7. NAVIGATION ARROWS - RIGHT
**Element:** `.react-datepicker__navigation--next`
- **Same as left arrow** ✅
- **Right:** Default (not set)
- **Current State:** ✅ Matches left arrow

### 8. DAY NAMES ROW CONTAINER
**Element:** `.react-datepicker__day-names`
- **Border Bottom:** `1px solid #e5e7eb` (gray-200) ✅
- **Margin Bottom:** `0.5rem` (8px)
- **Padding:** `0.5rem 0` (py-2, no horizontal)
- **Display:** `flex` ✅
- **Justify Content:** `space-around` ✅
- **Current State:** ⚠️ Padding structure different (guest selector rows have px-6, this has no horizontal padding but day names are inside month-container which has px-6)

### 9. INDIVIDUAL DAY NAMES
**Element:** `.react-datepicker__day-name`
- **Font Family:** `'Inter', system-ui, sans-serif` ✅
- **Font Size:** `0.75rem` (12px, text-xs) ✅ matches guest selector description
- **Font Weight:** `400` (normal) ⚠️ Guest selector description uses 400, but labels use 500
- **Color:** `#6b7280` (gray-500) ✅ matches guest selector description
- **Text Transform:** `uppercase` ✅
- **Letter Spacing:** `0.05em` (0.8px)
- **Width:** `2.5rem` (40px)
- **Text Align:** `center` ✅
- **Current State:** ✅ Matches guest selector description typography

### 10. MONTH CONTAINER
**Element:** `.react-datepicker__month-container`
- **Padding:** `0 1.5rem` (px-6) ✅ matches guest selector content padding
- **Current State:** ✅ Correct

### 11. MONTH WRAPPER
**Element:** `.react-datepicker__month`
- **Margin:** `0` ✅
- **Padding:** `0` ✅
- **Current State:** ✅ Correct

### 12. WEEK ROW
**Element:** `.react-datepicker__week`
- **Display:** `flex` ✅
- **Justify Content:** `space-around` ✅
- **Margin:** `0` ✅
- **Current State:** ✅ Correct

### 13. DATE CELLS - DEFAULT STATE
**Element:** `.react-datepicker__day`
- **Width:** `2.5rem` (40px)
- **Height:** `2.5rem` (40px)
- **Line Height:** `2.5rem` (40px)
- **Margin:** `0.125rem` (2px) - creates gap between cells
- **Border Radius:** `0.5rem` (8px, rounded-lg) ⚠️ Guest selector buttons use `rounded-full` (50%), date cells use rounded-lg
- **Font Family:** `'Inter', system-ui, sans-serif` ✅
- **Font Size:** `0.875rem` (14px, text-sm) ✅
- **Font Weight:** `400` (normal)
- **Color:** `#111827` (gray-900) ✅
- **Background:** `transparent` ✅
- **Border:** `none` ✅
- **Transition:** `all 0.15s ease` ✅
- **Display:** `inline-flex` ✅
- **Align Items:** `center` ✅
- **Justify Content:** `center` ✅
- **Current State:** ⚠️ Border radius is rounded-lg (0.5rem) vs guest selector buttons which are rounded-full

### 14. DATE CELLS - HOVER STATE
**Element:** `.react-datepicker__day:hover`
- **Background:** `#f9fafb` (gray-50) ✅ matches guest selector button hover
- **Color:** `#111827` (gray-900) ✅
- **Border Radius:** `0.5rem` (8px) ✅
- **Current State:** ✅ Matches guest selector hover behavior

### 15. DATE CELLS - SELECTED STATE
**Element:** `.react-datepicker__day--selected`
- **Background:** `#111827` (black/gray-900) ✅
- **Color:** `white` ✅
- **Font Weight:** `600` (semibold) ⚠️ Guest selector value uses `font-medium` (500)
- **Border Radius:** `0.5rem` (8px) ✅
- **Current State:** ⚠️ Font weight is 600 vs guest selector uses 500

**Selected Hover:**
- **Background:** `#1f2937` (gray-800) ✅
- **Current State:** ✅ Correct

### 16. DATE CELLS - KEYBOARD SELECTED
**Element:** `.react-datepicker__day--keyboard-selected`
- **Same as --selected** ✅
- **Current State:** ✅ Correct

### 17. DATE CELLS - IN RANGE
**Element:** `.react-datepicker__day--in-range`
- **Background:** `#f3f4f6` (gray-100) ✅
- **Color:** `#111827` (gray-900) ✅
- **Border Radius:** `0` (square for range continuity) ✅
- **Current State:** ✅ Correct

### 18. DATE CELLS - SELECTING RANGE
**Element:** `.react-datepicker__day--in-selecting-range`
- **Background:** `#f9fafb` (gray-50) ✅
- **Color:** `#111827` (gray-900) ✅
- **Current State:** ✅ Correct

### 19. DATE CELLS - RANGE START
**Element:** `.react-datepicker__day--range-start`
- **Background:** `#111827` (black) ✅
- **Color:** `white` ✅
- **Border Radius:** `0.5rem 0 0 0.5rem` (rounded left only) ✅
- **Current State:** ✅ Correct

### 20. DATE CELLS - RANGE END
**Element:** `.react-datepicker__day--range-end`
- **Background:** `#111827` (black) ✅
- **Color:** `white` ✅
- **Border Radius:** `0 0.5rem 0.5rem 0` (rounded right only) ✅
- **Current State:** ✅ Correct

### 21. DATE CELLS - RANGE START AND END (SAME DAY)
**Element:** `.react-datepicker__day--range-start.react-datepicker__day--range-end`
- **Border Radius:** `0.5rem` (fully rounded) ✅
- **Current State:** ✅ Correct

### 22. DATE CELLS - TODAY INDICATOR
**Element:** `.react-datepicker__day--today`
- **Font Weight:** `600` (semibold) ⚠️ Guest selector uses 500
- **Border:** `1px solid #d1d5db` (gray-300) ✅
- **Background:** `transparent` ✅
- **Color:** Inherits (#111827) ✅
- **Current State:** ⚠️ Font weight is 600 vs guest selector 500

**Today Hover:**
- **Background:** `#f9fafb` (gray-50) ✅
- **Current State:** ✅ Correct

### 23. DATE CELLS - DISABLED STATE
**Element:** `.react-datepicker__day--disabled`
- **Color:** `#d1d5db` (gray-300) ✅
- **Opacity:** `0.4` (40%) ⚠️ Guest selector disabled uses `opacity-30` (0.3)
- **Cursor:** `not-allowed` ✅
- **Background:** `transparent` ✅
- **Current State:** ⚠️ Opacity is 0.4 vs guest selector 0.3

**Disabled Hover:**
- **Background:** `transparent` (no change) ✅
- **Current State:** ✅ Correct

### 24. DATE CELLS - OUTSIDE MONTH
**Element:** `.react-datepicker__day--outside-month`
- **Color:** `#9ca3af` (gray-400) ✅
- **Opacity:** `0.5` (50%) ✅
- **Current State:** ✅ Correct

### 25. DATE CELLS - WEEKEND
**Element:** `.react-datepicker__day--weekend`
- **Styling:** Not explicitly set (uses default)
- **Current State:** ⚠️ No special styling (may be intentional)

### 26. INPUT FIELD (IN SEARCH BAR)
**Element:** `.react-datepicker__input-container input`
- **Color:** `inherit` ✅
- **Font:** Inherits from parent ✅
- **Current State:** ✅ Correct

**Placeholder:**
- **Color:** `inherit` ✅
- **Opacity:** `0.7` (70%) ✅
- **Current State:** ✅ Correct

---

## SUMMARY OF INCONSISTENCIES

### 🔴 CRITICAL INCONSISTENCIES:

1. **Z-index Mismatch:**
   - Guest selector: `10001`
   - Datepicker: `999999`
   - **Impact:** Different stacking contexts, may cause layering issues

2. **Font Weight Inconsistencies:**
   - Selected date: `600` (semibold) vs guest selector value: `500` (medium)
   - Today indicator: `600` (semibold) vs guest selector: `500` (medium)
   - **Impact:** Visual weight difference, dates appear bolder than guest selector values

3. **Border Radius Difference:**
   - Date cells: `0.5rem` (rounded-lg, 8px)
   - Guest selector buttons: `rounded-full` (50%, fully circular)
   - **Impact:** Different visual style - dates are rounded squares, guest buttons are circles

4. **Disabled Opacity:**
   - Datepicker disabled: `0.4` (40%)
   - Guest selector disabled: `0.3` (30%)
   - **Impact:** Slight visual difference in disabled state

### ⚠️ MINOR INCONSISTENCIES:

5. **Header Padding Structure:**
   - Datepicker header: Mixed padding (pt-3 px-6 pb-2)
   - Guest selector: Consistent row padding (px-6, pb-6 mb-6)
   - **Impact:** Slight spacing difference, but functionally similar

6. **Day Names Font Weight:**
   - Day names: `400` (normal)
   - Guest selector labels: `500` (medium)
   - **Impact:** Day names appear lighter than guest selector labels

7. **Weekend Styling:**
   - No special styling for weekends
   - **Impact:** May be intentional, but worth noting

### ✅ CONSISTENT ELEMENTS:

- Container background, border, radius, shadow
- Font family (Inter)
- Color system (gray scale)
- Hover states
- Border colors
- Spacing system (px-6 for content)
- Transition timing (0.15s ease)

---

## RECOMMENDED FIXES

1. **Align Font Weights:**
   - Change selected date from `600` to `500`
   - Change today indicator from `600` to `500`

2. **Align Disabled Opacity:**
   - Change from `0.4` to `0.3` to match guest selector

3. **Consider Border Radius:**
   - Keep `0.5rem` for dates (rounded-lg) OR change to match guest selector aesthetic
   - Note: Circular dates may look odd, rounded-lg is probably better for dates

4. **Z-index Alignment:**
   - Consider using same z-index value for consistency, or document why different values are needed

5. **Day Names Font Weight:**
   - Consider changing from `400` to `500` to match guest selector label weight
