const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const { BLOCKING_BOOKING_STATUSES } = require('./blockingStatusConstants');
const { isPublicIcsExportSafetyEnforced } = require('../../config/publicIcsConfig');
const { resolveBookingExportSafety } = require('./bookingExportSafety');

const PAID_LIKE = ['paid', 'partial'];

/**
 * @param {string[]} reservationIds
 * @returns {Promise<Set<string>>}
 */
async function loadPaidOrPartialReservationIdSet(reservationIds) {
  const ids = (reservationIds || [])
    .map((id) => (id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null))
    .filter(Boolean);
  if (ids.length === 0) return new Set();
  const found = await Payment.distinct('reservationId', {
    reservationId: { $in: ids },
    status: { $in: PAID_LIKE }
  });
  return new Set((found || []).map((x) => String(x)));
}

/**
 * @param {{ status: string, _id?: unknown }} bookingLean
 * @param {Set<string>} paidReservationIdSet
 * @param {boolean} strictIcs
 */
function isBookingEligibleForPublicIcs(bookingLean, paidReservationIdSet, strictIcs) {
  if (!bookingLean || !BLOCKING_BOOKING_STATUSES.includes(bookingLean.status)) return false;
  if (isPublicIcsExportSafetyEnforced()) {
    const safety = resolveBookingExportSafety(bookingLean, paidReservationIdSet);
    if (!safety.effectiveSafe) return false;
  }
  if (!strictIcs) return true;
  if (bookingLean.status === 'confirmed' || bookingLean.status === 'in_house') return true;
  if (bookingLean.status === 'pending') {
    return paidReservationIdSet.has(String(bookingLean._id));
  }
  return false;
}

module.exports = {
  loadPaidOrPartialReservationIdSet,
  isBookingEligibleForPublicIcs,
  PAID_LIKE
};
