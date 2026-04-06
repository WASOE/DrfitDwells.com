/**
 * Shared pricing logic for cabin bookings.
 * Used by create-payment-intent and booking creation to ensure consistency.
 * Never trust client-supplied amounts.
 */
const moment = require('moment');

/**
 * Calculate total price for a cabin or cabin-type booking.
 * @param {Object} entity - Cabin or CabinType document (pricePerNight, pricingModel, transportOptions)
 * @param {Date|string} checkIn
 * @param {Date|string} checkOut
 * @param {number} adults
 * @param {number} children
 * @param {string[]} experienceKeys - Whitelisted keys from entity.experiences
 * @param {Object} opts - { transportMethod?: string, romanticSetup?: boolean }
 * @returns {{ totalPrice: number, totalNights: number, experienceKeysUsed: string[] }}
 */
/**
 * Nights × rate (and per-person multiplier). Excludes experiences, transport, romantic setup.
 */
function calculateBaseLodgingPrice(entity, checkIn, checkOut, adults, children = 0) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const totalGuests = Math.max(0, parseInt(adults, 10) || 0) + Math.max(0, parseInt(children, 10) || 0);
  let base = totalNights * (entity.pricePerNight || 0);
  if ((entity.pricingModel || 'per_night') === 'per_person') {
    base *= Math.max(totalGuests, 1);
  }
  return Math.round(base * 100) / 100;
}

/**
 * Full price split: lodging (promo-eligible in v1) vs extras (experiences + transport + romantic).
 */
function calculateCabinPriceBreakdown(entity, checkIn, checkOut, adults, children = 0, experienceKeys = [], opts = {}) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const totalGuests = Math.max(0, parseInt(adults, 10) || 0) + Math.max(0, parseInt(children, 10) || 0);

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
  validateExperienceKeys
};
