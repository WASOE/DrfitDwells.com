/** Matches Tailwind `md` breakpoint (768px). Width only — a touch laptop is still desktop. */
export function getIsMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}
