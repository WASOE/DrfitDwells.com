const EmailEvent = require('../../../models/EmailEvent');
const { listReviewsForModeration } = require('../../reviews/reviewModerationService');

async function getReviewsReadModel({ page = 1, limit = 20 }) {
  const result = await listReviewsForModeration({ page, limit, sort: 'newest' });
  return {
    items: result.reviews.map((review) => ({
      reviewId: String(review._id),
      cabinId: review.cabinId
        ? typeof review.cabinId === 'object' && review.cabinId._id
          ? String(review.cabinId._id)
          : String(review.cabinId)
        : null,
      source: review.source,
      rating: review.rating,
      status: review.status,
      pinned: Boolean(review.pinned),
      locked: Boolean(review.locked),
      createdAtSource: review.createdAtSource || null
    })),
    moderationSummary: result.moderationSummary,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages
    }
  };
}

async function getCommunicationOversightReadModel() {
  const {
    getBookingConfirmationDeliveryHealthReadModel
  } = require('../../email/bookingConfirmationDeliveryHealthService');

  const [recentFailures, recentEvents, confirmationDelivery] = await Promise.all([
    EmailEvent.countDocuments({ type: { $in: ['Bounce', 'SpamComplaint'] } }),
    EmailEvent.find({}).sort({ createdAt: -1 }).limit(50).lean(),
    getBookingConfirmationDeliveryHealthReadModel()
  ]);

  return {
    summary: {
      failedEvents: recentFailures,
      totalRecentEvents: recentEvents.length,
      confirmationPendingDue: confirmationDelivery.backlog?.pendingDueCount ?? 0,
      confirmationAmbiguous: confirmationDelivery.backlog?.ambiguousCount ?? 0,
      confirmationFailed: confirmationDelivery.backlog?.failedCount ?? 0
    },
    confirmationDelivery,
    recent: recentEvents.map((evt) => ({
      eventId: String(evt._id),
      type: evt.type || null,
      bookingId: evt.bookingId ? String(evt.bookingId) : null,
      recipient: evt.to || null,
      happenedAt: evt.createdAt
    })),
    degraded: {
      eventTrackingGapsPossible: true,
      overdueConfirmationBacklog: Boolean(
        confirmationDelivery.backlog?.pendingDueCount > 0
      ),
      confirmationWorkerUnhealthy: confirmationDelivery.healthy !== true
    }
  };
}

module.exports = {
  getReviewsReadModel,
  getCommunicationOversightReadModel
};
