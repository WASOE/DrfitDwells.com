/**
 * SP7 — cancellationReview ops actions (inspect / note / resolve).
 * Never cancels booking or releases inventory.
 */
'use strict';

const Booking = require('../models/Booking');

class CancellationReviewError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CancellationReviewError';
    this.code = code;
    this.details = details;
  }
}

async function addCancellationReviewNote({
  bookingId,
  text,
  actorId = 'ops',
  BookingModel = Booking,
  now = new Date()
}) {
  const noteText = text == null ? '' : String(text).trim();
  if (!noteText) {
    throw new CancellationReviewError('NOTE_REQUIRED', 'Note text is required');
  }
  const updated = await BookingModel.findOneAndUpdate(
    { _id: bookingId, 'cancellationReview.status': 'open' },
    {
      $push: {
        'cancellationReview.notes': {
          at: now,
          actorId: String(actorId),
          text: noteText.slice(0, 2000)
        }
      }
    },
    { new: true }
  );
  if (!updated) {
    throw new CancellationReviewError(
      'REVIEW_NOT_OPEN',
      'No open cancellation review on this booking'
    );
  }
  return updated.cancellationReview;
}

async function resolveCancellationReview({
  bookingId,
  note = null,
  actorId = 'ops',
  BookingModel = Booking,
  now = new Date()
}) {
  const booking = await BookingModel.findById(bookingId);
  if (!booking?.cancellationReview) {
    throw new CancellationReviewError('REVIEW_MISSING', 'No cancellation review on this booking');
  }
  if (String(booking.cancellationReview.status) === 'resolved') {
    return { cancellationReview: booking.cancellationReview, idempotent: true, bookingStatus: booking.status };
  }

  const set = {
    'cancellationReview.status': 'resolved',
    'cancellationReview.resolvedAt': now,
    'cancellationReview.resolvedNote': note ? String(note).trim().slice(0, 2000) : null
  };

  const updated = await BookingModel.findOneAndUpdate(
    { _id: bookingId, 'cancellationReview.status': 'open' },
    {
      $set: set,
      ...(note
        ? {
            $push: {
              'cancellationReview.notes': {
                at: now,
                actorId: String(actorId),
                text: `Resolved: ${String(note).trim().slice(0, 1900)}`
              }
            }
          }
        : {})
    },
    { new: true }
  );

  // Never changes booking.status or inventory.
  return {
    cancellationReview: updated?.cancellationReview || booking.cancellationReview,
    idempotent: false,
    bookingStatus: updated?.status || booking.status
  };
}

module.exports = {
  CancellationReviewError,
  addCancellationReviewNote,
  resolveCancellationReview
};
