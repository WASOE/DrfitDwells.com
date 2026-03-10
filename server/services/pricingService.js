/**
 * Shared pricing logic for cabin bookings.
 * Used by create-payment-intent and booking creation to ensure consistency.
 * Never trust client-supplied amounts.
 */
const moment = require('moment');

/**
 * Calculate total price for a single-cabin booking.
 * @param {Object} cabin - Cabin document (must have pricePerNight, pricingModel, capacity, minGuests, experiences)
 * @param {Date|string} checkIn
 * @param {Date|string} checkOut
 * @param {number} adults
 * @param {number} children
 * @param {string[]} experienceKeys - Whitelisted keys from cabin.experiences; unknown keys are ignored
 * @returns {{ totalPrice: number, totalNights: number, experienceKeysUsed: string[] }}
 */
function calculateCabinPrice(cabin, checkIn, checkOut, adults, children = 0, experienceKeys = []) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const totalGuests = Math.max(0, parseInt(adults, 10) || 0) + Math.max(0, parseInt(children, 10) || 0);

  let totalPrice = totalNights * (cabin.pricePerNight || 0);
  if ((cabin.pricingModel || 'per_night') === 'per_person') {
    totalPrice *= Math.max(totalGuests, 1);
  }

  const cabinExperiences = Array.isArray(cabin.experiences)
    ? cabin.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(cabinExperiences.map(e => e.key));

  const keysUsed = [];
  const uniqueKeys = [...new Set(Array.isArray(experienceKeys) ? experienceKeys : [])];
  for (const key of uniqueKeys) {
    if (!allowedKeys.has(key)) continue; // Whitelist: only add price for cabin-defined keys
    const exp = cabinExperiences.find(e => e.key === key);
    if (exp) {
      const qty = exp.unit === 'per_guest' ? Math.max(totalGuests, 1) : 1;
      totalPrice += (exp.price || 0) * qty;
      keysUsed.push(key);
    }
  }

  return { totalPrice: Math.round(totalPrice * 100) / 100, totalNights, experienceKeysUsed: keysUsed };
}

/**
 * Validate experienceKeys: reject if any key is not in cabin's allowed list.
 * @returns {string|null} Error message or null if valid
 */
function validateExperienceKeys(cabin, experienceKeys) {
  const cabinExperiences = Array.isArray(cabin.experiences)
    ? cabin.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(cabinExperiences.map(e => e.key));
  const keys = Array.isArray(experienceKeys) ? experienceKeys : [];
  const unknown = keys.filter(k => k && !allowedKeys.has(k));
  if (unknown.length > 0) {
    return `Invalid experience key(s): ${unknown.join(', ')}`;
  }
  return null;
}

module.exports = {
  calculateCabinPrice,
  validateExperienceKeys
};
