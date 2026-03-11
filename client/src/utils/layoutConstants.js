/**
 * Layout constants for consistent positioning of fixed/floating UI.
 * Prevents overlap between: sticky bottom bars, chat widget, audio player, etc.
 *
 * Modern standard: Define exclusion zones (safe areas) where primary CTAs live,
 * and position secondary floating elements above them. See:
 * - Apple HIG: Safe area insets
 * - Material Design: FAB placement guidelines
 * - env(safe-area-inset-*) for device notches
 */

/** Height of StickyBookingBar / BookingDrawer (px) */
export const BOTTOM_BAR_HEIGHT = 72;

/** Gap between floating elements and the bottom bar (px) */
export const FLOATING_GAP = 16;

/** Bottom offset for floating elements when a sticky bar is visible */
export const FLOATING_BOTTOM_OFFSET = BOTTOM_BAR_HEIGHT + FLOATING_GAP;

/** Routes that show a fixed bottom bar (StickyBookingBar or BookingDrawer) */
const ROUTES_WITH_BOTTOM_BAR = [
  // Cabin details: sticky bar only on mobile; desktop uses card + bands
  { pattern: /^\/cabin\/[^/]+$/, desktop: false, mobile: true },
  // Craft steps: sticky bar on both
  { pattern: /^\/craft\/step-[1-4]$/, desktop: true, mobile: true },
  // Home / Valley: booking drawer on mobile only
  { pattern: /^\/$/, desktop: false, mobile: true },
  { pattern: /^\/valley$/, desktop: false, mobile: true },
];

import { stripLocaleFromPath } from './localizedRoutes';

/**
 * Get the bottom offset (px) for floating elements based on current path.
 * @param {string} pathname - Current route path (may include locale, e.g. /bg/cabin/123)
 * @param {boolean} isDesktop - Whether viewport is md or larger
 * @returns {number} Bottom offset in pixels
 */
export function getFloatingBottomOffset(pathname, isDesktop = false) {
  const basePath = stripLocaleFromPath(pathname || '/');
  let hasBottomBar = false;
  for (const { pattern, desktop, mobile } of ROUTES_WITH_BOTTOM_BAR) {
    if (pattern.test(basePath)) {
      const showBar = isDesktop ? desktop : mobile;
      hasBottomBar = showBar;
      break;
    }
  }

  // Base offset: above sticky bar if present, otherwise small gap from viewport edge
  const baseOffset = hasBottomBar ? FLOATING_BOTTOM_OFFSET : FLOATING_GAP;
  return baseOffset;
}
