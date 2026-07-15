/**
 * From-price label for stay listings without selected dates.
 * Matches CabinDetails / AFrameDetails: `search.priceFromPerNight` with locale-formatted price.
 *
 * @param {{ pricePerNight?: number|null, pricingModel?: string, minGuests?: number }|null|undefined} listing
 * @param {(key: string, options?: object) => string} t - booking namespace translator
 * @returns {string|null}
 */
export function formatListingFromPrice(listing, t) {
  const price = listing?.pricePerNight;
  if (price == null || !Number.isFinite(Number(price))) return null;

  return t('search.priceFromPerNight', {
    price: Number(price).toLocaleString()
  });
}
