/** Viewport inset so collapsed flyouts never sit flush against the screen edge. */
export const OPS_SIDEBAR_FLYOUT_INSET_PX = 8;

/**
 * Viewport-aware placement for a collapsed-rail flyout.
 * `top` / `left` are viewport coordinates for `position: fixed`.
 *
 * @param {{
 *   triggerTop: number,
 *   triggerRight: number,
 *   flyoutHeight: number,
 *   viewportHeight: number,
 *   inset?: number
 * }} params
 * @returns {{ top: number, left: number, maxHeight: number }}
 */
export function computeOpsSidebarFlyoutPosition({
  triggerTop,
  triggerRight,
  flyoutHeight,
  viewportHeight,
  inset = OPS_SIDEBAR_FLYOUT_INSET_PX
}) {
  const safeInset = Number.isFinite(inset) ? Math.max(0, inset) : OPS_SIDEBAR_FLYOUT_INSET_PX;
  const viewH = Number.isFinite(viewportHeight) ? viewportHeight : 0;
  const maxHeight = Math.max(0, viewH - safeInset * 2);
  const usedHeight = Math.min(Math.max(0, Number(flyoutHeight) || 0), maxHeight);
  const minTop = safeInset;
  const maxTop = viewH - usedHeight - safeInset;
  const desiredTop = Number.isFinite(triggerTop) ? triggerTop : minTop;
  const top = maxTop < minTop ? minTop : Math.min(Math.max(desiredTop, minTop), maxTop);
  const left = Number.isFinite(triggerRight) ? triggerRight : 0;
  return { top, left, maxHeight };
}
