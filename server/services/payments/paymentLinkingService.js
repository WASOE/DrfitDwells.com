const Payment = require('../../models/Payment');

function normalizePaymentIntentId(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  return value || null;
}

function toObjectIdString(value) {
  if (!value) return null;
  return String(value);
}

function buildPaymentIntentLookupQuery(paymentIntentId) {
  return {
    provider: 'stripe',
    $or: [
      { providerReference: paymentIntentId },
      { paymentIntentId },
      { stripePaymentIntentId: paymentIntentId },
      { 'metadata.paymentIntentId': paymentIntentId },
      { 'metadata.stripePaymentIntentId': paymentIntentId },
      { 'metadata.id': paymentIntentId }
    ]
  };
}

async function linkStripePaymentToBooking({
  booking,
  linkedBy = 'booking_create_reconciliation',
  apply = true
}) {
  const bookingId = toObjectIdString(booking?._id);
  const paymentIntentId = normalizePaymentIntentId(booking?.stripePaymentIntentId);
  if (!bookingId || !paymentIntentId) {
    return { status: 'invalid_input', bookingId: bookingId || null, stripePaymentIntentId: paymentIntentId || null };
  }

  const payment = await Payment.findOne(buildPaymentIntentLookupQuery(paymentIntentId)).sort({ createdAt: -1 });
  if (!payment) {
    return { status: 'not_found', bookingId, stripePaymentIntentId: paymentIntentId };
  }

  const existingReservationId = toObjectIdString(payment.reservationId);
  if (!existingReservationId) {
    if (!apply) {
      return {
        status: 'linked',
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        paymentId: String(payment._id),
        dryRun: true
      };
    }

    const nextMetadata = {
      ...(payment.metadata || {}),
      linkageConfidence: 'high',
      linkedBy,
      linkedAt: new Date().toISOString()
    };
    const updateResult = await Payment.updateOne(
      { _id: payment._id, reservationId: null },
      {
        $set: {
          reservationId: booking._id,
          metadata: nextMetadata
        }
      }
    );

    if (updateResult.modifiedCount === 1) {
      return {
        status: 'linked',
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        paymentId: String(payment._id)
      };
    }

    const latest = await Payment.findById(payment._id).lean();
    const latestReservationId = toObjectIdString(latest?.reservationId);
    if (latestReservationId === bookingId) {
      return {
        status: 'already_linked',
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        paymentId: String(payment._id)
      };
    }
    if (latestReservationId && latestReservationId !== bookingId) {
      return {
        status: 'conflict',
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        paymentId: String(payment._id),
        existingReservationId: latestReservationId
      };
    }
    return {
      status: 'error',
      bookingId,
      stripePaymentIntentId: paymentIntentId,
      paymentId: String(payment._id),
      reason: 'link_update_race'
    };
  }

  if (existingReservationId === bookingId) {
    return {
      status: 'already_linked',
      bookingId,
      stripePaymentIntentId: paymentIntentId,
      paymentId: String(payment._id)
    };
  }

  return {
    status: 'conflict',
    bookingId,
    stripePaymentIntentId: paymentIntentId,
    paymentId: String(payment._id),
    existingReservationId
  };
}

module.exports = {
  linkStripePaymentToBooking,
  normalizePaymentIntentId,
  buildPaymentIntentLookupQuery
};
