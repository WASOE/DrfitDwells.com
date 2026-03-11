# Safe Area System for Floating UI

## Problem

Fixed/floating elements (chat widget, audio player) can overlap primary CTAs (sticky booking bar, "Request to book" button). This creates poor UX and accessibility issues.

## Solution: Route-Aware Safe Areas

We use a **centralized layout constants + hook** pattern:

1. **`utils/layoutConstants.js`** – Defines which routes have sticky bottom bars and the offset floating elements need.
2. **`hooks/useFloatingSafeArea.js`** – Returns `{ bottomOffset, isDesktop }` based on current route and viewport.
3. **Components** – Apply `style={{ bottom: \`${bottomOffset}px\` }}` (or use `var(--floating-bottom-offset)` in CSS).

## Modern Standards Referenced

- **Apple HIG**: Safe area insets for notches/home indicator; content should not be obscured.
- **Material Design**: FAB placement guidelines; avoid overlap with navigation bars.
- **CSS `env(safe-area-inset-*)`**: Used for device-level safe areas (notches); we extend this concept for app-level bars.

## Adding a New Floating Element

1. Import the hook: `import { useFloatingSafeArea } from '../hooks/useFloatingSafeArea';`
2. Call it: `const { bottomOffset, isDesktop } = useFloatingSafeArea();`
3. Apply the offset: `style={isDesktop ? { bottom: \`${bottomOffset}px\` } : undefined}` (or use `bottom` for mobile too if appropriate).

## Adding a New Route with a Sticky Bar

Edit `utils/layoutConstants.js` and add to `ROUTES_WITH_BOTTOM_BAR`:

```js
{ pattern: /^\/your-route$/, desktop: true, mobile: true },
```

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `BOTTOM_BAR_HEIGHT` | 72px | Height of StickyBookingBar |
| `FLOATING_GAP` | 16px | Gap between floating elements and bar |
| `FLOATING_BOTTOM_OFFSET` | 88px | Default offset when bar is visible |
