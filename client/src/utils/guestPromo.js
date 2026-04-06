/** Session key for promo code carried search → cabin → checkout */
export const GUEST_PROMO_STORAGE_KEY = 'dd_guest_promo';

export function readGuestPromo() {
  try {
    return (sessionStorage.getItem(GUEST_PROMO_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function writeGuestPromo(code) {
  try {
    const c = (code || '').trim().toUpperCase();
    if (c) sessionStorage.setItem(GUEST_PROMO_STORAGE_KEY, c);
    else sessionStorage.removeItem(GUEST_PROMO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
