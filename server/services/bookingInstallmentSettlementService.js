/**
 * SP6 — deterministic Booking settlement from paid BookingInstallment rows.
 * Never naively increment paid cents.
 */
'use strict';

const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');

async function recomputeBookingSettlementFromInstallments({
  bookingId,
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment
} = {}) {
  if (!bookingId) {
    throw new Error('bookingId is required to recompute settlement');
  }

  const booking = await BookingModel.findById(bookingId);
  if (!booking) {
    throw new Error(`Booking ${bookingId} not found for settlement recompute`);
  }

  if (String(booking.paymentSettlementStatus || '') === 'not_required') {
    return {
      booking,
      paidCents: 0,
      settlementStatus: 'not_required',
      changed: false
    };
  }

  const rows = await BookingInstallmentModel.find({ bookingId: booking._id }).lean();
  if (!rows.length) {
    return {
      booking,
      paidCents: Number(booking.stripePaidAmountCents) || 0,
      settlementStatus: booking.paymentSettlementStatus || null,
      changed: false
    };
  }

  const paidCents = rows
    .filter((r) => String(r.status) === 'paid')
    .reduce((sum, r) => sum + Math.trunc(Number(r.amountCents) || 0), 0);

  const outstanding = rows.some(
    (r) => !['paid', 'voided', 'cancelled', 'waived'].includes(String(r.status))
  );

  const settlementStatus = outstanding ? 'partially_paid' : 'paid_in_full';

  const prevPaid = Number(booking.stripePaidAmountCents) || 0;
  const prevStatus = booking.paymentSettlementStatus || null;
  const changed = prevPaid !== paidCents || prevStatus !== settlementStatus;

  if (changed) {
    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: {
          stripePaidAmountCents: paidCents,
          paymentSettlementStatus: settlementStatus
        }
      }
    );
    booking.stripePaidAmountCents = paidCents;
    booking.paymentSettlementStatus = settlementStatus;
  }

  return { booking, paidCents, settlementStatus, changed };
}

module.exports = {
  recomputeBookingSettlementFromInstallments
};
