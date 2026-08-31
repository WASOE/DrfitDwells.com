/**
 * Shared pricing logic for cabin bookings.
 * Used by create-payment-intent and booking creation to ensure consistency.
 * Never trust client-supplied amounts.
 */
const moment = require('moment');

/**
 * Human guest count for lodging (adults + children). Pets never count.
 */
function humanGuestCount(adults, children = 0) {
  return Math.max(0, parseInt(adults, 10) || 0) + Math.max(0, parseInt(children, 10) || 0);
}

/**
 * Nightly lodging rate for an entity given human guest count.
 * Models:
 * - per_night: flat pricePerNight
 * - per_person: pricePerNight × guests (legacy)
 * - base_plus_extra: pricePerNight for up to includedGuests, then +extraGuestPricePerNight per extra guest
 */
function calculateNightlyLodgingRate(entity, adults, children = 0) {
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

/**
 * Nights × nightly rate. Excludes experiences, transport, romantic setup.
 * Pets never affect lodging.
 */
function calculateBaseLodgingPrice(entity, checkIn, checkOut, adults, children = 0) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const nightly = calculateNightlyLodgingRate(entity, adults, children);
  return Math.round(totalNights * nightly * 100) / 100;
}

/**
 * Full price split: lodging (promo-eligible in v1) vs extras (experiences + transport + romantic).
 */
function calculateCabinPriceBreakdown(entity, checkIn, checkOut, adults, children = 0, experienceKeys = [], opts = {}) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const totalGuests = humanGuestCount(adults, children);

  const baseLodgingPrice = calculateBaseLodgingPrice(entity, checkIn, checkOut, adults, children);

  const experiences = Array.isArray(entity.experiences)
    ? entity.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(experiences.map(e => e.key));

  let extrasTotal = 0;
  const keysUsed = [];
  const uniqueKeys = [...new Set(Array.isArray(experienceKeys) ? experienceKeys : [])];
  for (const key of uniqueKeys) {
    if (!allowedKeys.has(key)) continue;
    const exp = experiences.find(e => e.key === key);
    if (exp) {
      const qty = exp.unit === 'per_guest' ? Math.max(totalGuests, 1) : 1;
      extrasTotal += (exp.price || 0) * qty;
      keysUsed.push(key);
    }
  }

  if (opts.transportMethod && opts.transportMethod !== 'Not selected') {
    const transportOptions = entity.transportOptions || [];
    const opt = transportOptions.find(t => t && t.type === opts.transportMethod);
    if (opt && opt.pricePerPerson != null) {
      extrasTotal += opt.pricePerPerson * totalGuests;
    }
  }

  if (opts.romanticSetup) {
    extrasTotal += 30;
  }

  extrasTotal = Math.round(extrasTotal * 100) / 100;
  const totalPrice = Math.round((baseLodgingPrice + extrasTotal) * 100) / 100;

  return {
    baseLodgingPrice,
    extrasTotal,
    totalPrice,
    totalNights,
    experienceKeysUsed: keysUsed
  };
}

function calculateCabinPrice(entity, checkIn, checkOut, adults, children = 0, experienceKeys = [], opts = {}) {
  const b = calculateCabinPriceBreakdown(entity, checkIn, checkOut, adults, children, experienceKeys, opts);
  return { totalPrice: b.totalPrice, totalNights: b.totalNights, experienceKeysUsed: b.experienceKeysUsed };
}

/**
 * Validate experienceKeys: reject if any key is not in cabin's allowed list.
 * @returns {string|null} Error message or null if valid
 */
function validateExperienceKeys(entity, experienceKeys) {
  const experiences = Array.isArray(entity.experiences)
    ? entity.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(experiences.map(e => e.key));
  const keys = Array.isArray(experienceKeys) ? experienceKeys : [];
  const unknown = keys.filter(k => k && !allowedKeys.has(k));
  return unknown.length > 0 ? `Invalid experience key(s): ${unknown.join(', ')}` : null;
}

module.exports = {
  calculateCabinPrice,
  calculateCabinPriceBreakdown,
  calculateBaseLodgingPrice,
  calculateNightlyLodgingRate,
  humanGuestCount,
  validateExperienceKeys
};
