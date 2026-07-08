/** Paid / deep-link hashes that should scroll to the booking UI (not reviews). */
export function isStayBookingHash(hash) {
  return hash === '#booking' || hash === '#details';
}

/** First visible `[data-booking-anchor]` (mobile strip or desktop aside). */
export function findVisibleBookingAnchor() {
  const anchors = document.querySelectorAll('[data-booking-anchor]');
  return [...anchors].find((el) => el.offsetParent !== null) ?? null;
}

/**
 * Smooth-scroll to the visible booking anchor after a short layout delay.
 * @param {number} [delayMs]
 * @returns {boolean} whether an anchor was found
 */
export function scrollToVisibleBookingAnchor(delayMs = 100) {
  const el = findVisibleBookingAnchor();
  if (!el) return false;
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, delayMs);
  return true;
}
