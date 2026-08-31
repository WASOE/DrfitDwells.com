/**
 * Guest-facing lodging price helpers — mirrors server/services/pricingService.js.
 * Pets never count toward human guest pricing.
 */

export function humanGuestCount(adults = 0, children = 0) {
  return Math.max(0, Number(adults) || 0) + Math.max(0, Number(children) || 0);
}

/**
 * Nightly lodging rate for a cabin/cabinType entity.
 */
export function calculateNightlyLodgingRate(entity, adults = 0, children = 0) {
  const rate = Number(entity?.pricePerNight) || 0;
  const guests = humanGuestCount(adults, children);
  const model = entity?.pricingModel || 'per_night';

  if (model === 'per_person') {
    return rate * Math.max(guests, 1);
  }

  if (model === 'base_plus_extra') {
    const included = Math.max(0, parseInt(entity.includedGuests, 10) || 0);
    const extraRate = Number(entity.extraGuestPricePerNight) || 0;
    const extraGuests = Math.max(0, guests - included);
    return rate + extraGuests * extraRate;
  }

  return rate;
}

export function calculateBaseLodgingPrice(entity, totalNights, adults = 0, children = 0) {
  const nights = Math.max(0, Number(totalNights) || 0);
  const nightly = calculateNightlyLodgingRate(entity, adults, children);
  return Math.round(nights * nightly * 100) / 100;
}
