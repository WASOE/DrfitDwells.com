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
function calculateCabinPrice(entity, checkIn, checkOut, adults, children = 0, experienceKeys = [], opts = {}) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const totalGuests = Math.max(0, parseInt(adults, 10) || 0) + Math.max(0, parseInt(children, 10) || 0);

  let totalPrice = totalNights * (entity.pricePerNight || 0);
  if ((entity.pricingModel || 'per_night') === 'per_person') {
    totalPrice *= Math.max(totalGuests, 1);
  }

  const experiences = Array.isArray(entity.experiences)
    ? entity.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(experiences.map(e => e.key));

  const keysUsed = [];
  const uniqueKeys = [...new Set(Array.isArray(experienceKeys) ? experienceKeys : [])];
  for (const key of uniqueKeys) {
    if (!allowedKeys.has(key)) continue;
    const exp = experiences.find(e => e.key === key);
    if (exp) {
      const qty = exp.unit === 'per_guest' ? Math.max(totalGuests, 1) : 1;
      totalPrice += (exp.price || 0) * qty;
      keysUsed.push(key);
    }
  }

  if (opts.transportMethod && opts.transportMethod !== 'Not selected') {
    const transportOptions = entity.transportOptions || [];
    const opt = transportOptions.find(t => t && t.type === opts.transportMethod);
    if (opt && opt.pricePerPerson != null) {
      totalPrice += opt.pricePerPerson * totalGuests;
    }
  }

  if (opts.romanticSetup) {
    totalPrice += 30;
  }

  return { totalPrice: Math.round(totalPrice * 100) / 100, totalNights, experienceKeysUsed: keysUsed };
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
  validateExperienceKeys
};
