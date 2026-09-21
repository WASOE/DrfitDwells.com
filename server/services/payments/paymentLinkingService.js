const Payment = require('../../models/Payment');
const { resolvePaymentUnlinkedReviews } = require('./paymentReviewResolutionService');

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

  const resolveStaleReviews = async () => {
    if (!apply) {
      return {
        attempted: false,
        resolvedCount: 0,
        error: null
      };
    }
    try {
      const outcome = await resolvePaymentUnlinkedReviews({
        paymentId: String(payment._id),
        paymentIntentId,
        reservationId: bookingId,
        resolvedBy: linkedBy,
        note: 'Auto-resolved: payment now linked to booking.'
      });
      return {
        attempted: true,
        resolvedCount: Number(outcome.resolvedCount || 0),
        error: null
      };
    } catch (error) {
      return {
        attempted: true,
        resolvedCount: 0,
        error: error?.message || String(error)
      };
    }
  };

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
      const reviewResolution = await resolveStaleReviews();
      return {
        status: 'linked',
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        paymentId: String(payment._id),
        reviewResolution
      };
    }

    const latest = await Payment.findById(payment._id).lean();
    const latestReservationId = toObjectIdString(latest?.reservationId);
    if (latestReservationId === bookingId) {
      const reviewResolution = await resolveStaleReviews();
      return {
        status: 'already_linked',
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        paymentId: String(payment._id),
        reviewResolution
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
    const reviewResolution = await resolveStaleReviews();
    return {
      status: 'already_linked',
      bookingId,
      stripePaymentIntentId: paymentIntentId,
      paymentId: String(payment._id),
      reviewResolution
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

/**
 * Authoritative ledger check: Payment.reservationId must equal booking._id.
 * Used by finalize workers / side effects so paymentLinkedAt and MRI resolve
 * are never stamped from booking existence alone.
 */
async function verifyPaymentLinkedToBooking({
  booking = null,
  paymentIntentId = null
} = {}) {
  const bookingId = toObjectIdString(booking?._id);
  const piId = normalizePaymentIntentId(
    paymentIntentId || booking?.stripePaymentIntentId || null
  );
  if (!bookingId || !piId) {
    return {
      linked: false,
      reason: 'invalid_input',
      bookingId: bookingId || null,
      stripePaymentIntentId: piId || null,
      paymentId: null
    };
  }

  const payment = await Payment.findOne(buildPaymentIntentLookupQuery(piId)).sort({
    createdAt: -1
  });
  if (!payment) {
    return {
      linked: false,
      reason: 'not_found',
      bookingId,
      stripePaymentIntentId: piId,
      paymentId: null
    };
  }

  const reservationId = toObjectIdString(payment.reservationId);
  if (reservationId === bookingId) {
    return {
      linked: true,
      reason: null,
      bookingId,
      stripePaymentIntentId: piId,
      paymentId: String(payment._id)
    };
  }

  return {
    linked: false,
    reason: reservationId ? 'linked_elsewhere' : 'unlinked',
    bookingId,
    stripePaymentIntentId: piId,
    paymentId: String(payment._id),
    existingReservationId: reservationId
  };
}

module.exports = {
  linkStripePaymentToBooking,
  verifyPaymentLinkedToBooking,
  normalizePaymentIntentId,
  buildPaymentIntentLookupQuery
};
