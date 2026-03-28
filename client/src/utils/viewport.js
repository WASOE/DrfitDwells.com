/** Matches Tailwind `md` breakpoint (768px). */
export function getIsMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || 'ontouchstart' in window;
}
