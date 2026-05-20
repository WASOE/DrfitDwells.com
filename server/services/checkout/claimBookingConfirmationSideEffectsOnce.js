const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');

const REASON_ALREADY_CLAIMED_OR_MISSING = 'already_claimed_or_missing';

function normalizeNow(now) {
  return now instanceof Date ? now : new Date(now);
}

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function missingConfirmationEmailSentAtClause() {
  return {
    $or: [
      { confirmationEmailSentAt: { $exists: false } },
      { confirmationEmailSentAt: null }
    ]
  };
}

/**
 * Atomically claim post-finalize confirmation side effects for a booking (C3-F).
 * Does not send email. Caller runs side effects only when claimed === true.
 */
async function claimBookingConfirmationSideEffectsOnce({
  bookingId,
  checkoutSessionId = null,
  now = new Date()
}) {
  const claimedAt = normalizeNow(now);
  const bookingObjectId = toObjectId(bookingId);

  const booking = await Booking.findOneAndUpdate(
    {
      _id: bookingObjectId,
      ...missingConfirmationEmailSentAtClause()
    },
    { $set: { confirmationEmailSentAt: claimedAt } },
    { new: true }
  );

  if (!booking) {
    return { claimed: false, reason: REASON_ALREADY_CLAIMED_OR_MISSING };
  }

  if (checkoutSessionId != null && checkoutSessionId !== '') {
    const sessionObjectId = toObjectId(checkoutSessionId);
    await CheckoutSession.updateOne(
      {
        _id: sessionObjectId,
        ...missingConfirmationEmailSentAtClause()
      },
      { $set: { confirmationEmailSentAt: claimedAt } }
    );
  }

  return { claimed: true, claimedAt };
}

module.exports = {
  claimBookingConfirmationSideEffectsOnce
};
