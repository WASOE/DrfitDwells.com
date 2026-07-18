/**
 * Map site language to a Stripe Elements locale.
 * Without an explicit locale, Stripe follows the browser language (e.g. Dutch UI on /bg).
 */
export function getStripeElementsLocale(siteLanguage) {
  return siteLanguage === 'bg' ? 'bg' : 'en';
}
