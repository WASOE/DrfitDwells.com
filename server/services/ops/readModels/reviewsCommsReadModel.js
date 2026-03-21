const Review = require('../../../models/Review');
const EmailEvent = require('../../../models/EmailEvent');

async function getReviewsReadModel({ page = 1, limit = 20 }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, total, moderationSummary] = await Promise.all([
    Review.find({}).sort({ createdAtSource: -1 }).skip(skip).limit(safeLimit).lean(),
    Review.countDocuments({}),
    Review.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);

  const statusCounts = moderationSummary.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  return {
    items: items.map((review) => ({
      reviewId: String(review._id),
      cabinId: review.cabinId ? String(review.cabinId) : null,
      source: review.source,
      rating: review.rating,
      status: review.status,
      pinned: Boolean(review.pinned),
      locked: Boolean(review.locked),
      createdAtSource: review.createdAtSource || null
    })),
    moderationSummary: {
      approved: statusCounts.approved || 0,
      pending: statusCounts.pending || 0,
      hidden: statusCounts.hidden || 0
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  };
}

async function getCommunicationOversightReadModel() {
  const [recentFailures, recentEvents] = await Promise.all([
    EmailEvent.countDocuments({ type: { $in: ['Bounce', 'SpamComplaint'] } }),
    EmailEvent.find({}).sort({ createdAt: -1 }).limit(50).lean()
  ]);

  return {
    summary: {
      failedEvents: recentFailures,
      totalRecentEvents: recentEvents.length
    },
    recent: recentEvents.map((evt) => ({
      eventId: String(evt._id),
      type: evt.type || null,
      bookingId: evt.bookingId ? String(evt.bookingId) : null,
      recipient: evt.to || null,
      happenedAt: evt.createdAt
    })),
    degraded: {
      eventTrackingGapsPossible: true
    }
  };
}

module.exports = {
  getReviewsReadModel,
  getCommunicationOversightReadModel
};
