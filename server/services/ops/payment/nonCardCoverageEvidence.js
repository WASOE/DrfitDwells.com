const mongoose = require('mongoose');
const GiftVoucherRedemption = require('../../../models/GiftVoucherRedemption');
const StayCreditReservation = require('../../../models/StayCreditReservation');

function toObjectIds(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value == null) continue;
    const key = String(value);
    if (seen.has(key) || !mongoose.Types.ObjectId.isValid(key)) continue;
    seen.add(key);
    out.push(new mongoose.Types.ObjectId(key));
  }
  return out;
}

/**
 * Batch-loads ledger evidence for voucher / stay-credit coverage (two queries total).
 * Read-only; returns lookups keyed by booking id.
 */
async function loadNonCardCoverageEvidence(bookings) {
  const list = Array.isArray(bookings) ? bookings : [];
  const voucherBookings = list.filter(
    (b) => b && b.giftVoucherRedemptionId && Number(b.giftVoucherAppliedCents) > 0
  );
  const stayCreditBookings = list.filter((b) => b && Number(b.stayCreditAppliedCents) > 0);

  const redemptionIds = toObjectIds(voucherBookings.map((b) => b.giftVoucherRedemptionId));
  const stayCreditBookingIds = toObjectIds(stayCreditBookings.map((b) => b._id));

  const [redemptions, stayCreditReservations] = await Promise.all([
    redemptionIds.length
      ? GiftVoucherRedemption.find({ _id: { $in: redemptionIds } })
          .select('_id status bookingId reservationId checkoutId amountAppliedCents currency')
          .lean()
      : [],
    stayCreditBookingIds.length
      ? StayCreditReservation.find({ bookingId: { $in: stayCreditBookingIds }, status: 'consumed' })
          .select('_id status bookingId stayCreditId amountCents')
          .lean()
      : []
  ]);

  const redemptionById = new Map(redemptions.map((r) => [String(r._id), r]));
  const stayCreditByBookingId = new Map();
  for (const row of stayCreditReservations) {
    const key = String(row.bookingId);
    if (!stayCreditByBookingId.has(key)) stayCreditByBookingId.set(key, []);
    stayCreditByBookingId.get(key).push(row);
  }

  return function evidenceForBooking(booking) {
    return {
      giftVoucherRedemption: booking?.giftVoucherRedemptionId
        ? redemptionById.get(String(booking.giftVoucherRedemptionId)) || null
        : null,
      stayCreditReservations: stayCreditByBookingId.get(String(booking?._id)) || []
    };
  };
}

module.exports = { loadNonCardCoverageEvidence };
