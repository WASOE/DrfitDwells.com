/**
 * Shared review moderation queries + cabin stats (aligned with admin review routes).
 */
const mongoose = require('mongoose');
const Review = require('../../models/Review');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const {
  resolveReviewOwnerObjectIds,
  softDeleteOrCondition
} = require('../reviewOwnershipService');
const { sanitizeName } = require('../../utils/nameUtils');

/** Basic XSS prevention — aligned with admin review routes. */
function sanitizeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Recalculate aggregated review stats for the entity backing `entityId` (cabin or type).
 * Same logic as legacy admin review routes.
 */
async function recalculateCabinStats(entityId) {
  const cabin = await Cabin.findById(entityId).select('_id inventoryType inventoryMode cabinTypeId');
  let targetKind = 'cabin';
  let targetId = entityId;

  if (cabin) {
    if (
      cabin.cabinTypeId &&
      (cabin.inventoryType === 'multi' || cabin.inventoryMode === 'multi')
    ) {
      targetKind = 'cabinType';
      targetId = cabin.cabinTypeId.toString();
    }
  } else {
    const cabinType = await CabinType.findById(entityId).select('_id');
    if (!cabinType) {
      return null;
    }
    targetKind = 'cabinType';
    targetId = cabinType._id.toString();
  }

  const ownerIds = await resolveReviewOwnerObjectIds(entityId);
  if (ownerIds.length === 0) {
    return null;
  }

  const stats = await Review.aggregate([
    {
      $match: {
        cabinId: { $in: ownerIds },
        status: 'approved',
        rating: { $gte: 2 },
        ...softDeleteOrCondition()
      }
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);

  const reviewsCount = stats[0]?.count || 0;
  const averageRating = Math.round((stats[0]?.avgRating || 0) * 10) / 10;

  const payload = {
    reviewsCount,
    averageRating
  };

  if (targetKind === 'cabinType') {
    await CabinType.findByIdAndUpdate(targetId, payload);
  } else {
    await Cabin.findByIdAndUpdate(targetId, payload);
  }

  return {
    kind: targetKind,
    id: targetId,
    reviewsCount,
    averageRating
  };
}

const SOFT_DELETE_MATCH = softDeleteOrCondition();

/**
 * List reviews for moderation (admin-equivalent filters, soft-delete exclusion).
 * @param {object} query
 * @param {string} [query.q] — text search ($text) when non-empty
 * @param {string} [query.cabinId]
 * @param {string} [query.status]
 * @param {string} [query.source]
 * @param {number|string} [query.minRating]
 * @param {number|string} [query.maxRating]
 * @param {string} [query.lang]
 * @param {number|string} [query.page]
 * @param {number|string} [query.limit]
 * @param {string} [query.sort] — newest | oldest | rating | pinned
 */
async function listReviewsForModeration(query = {}) {
  const {
    q,
    cabinId,
    status,
    source,
    minRating,
    maxRating,
    lang,
    page = 1,
    limit = 20,
    sort = 'newest'
  } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const mongoQuery = {
    ...SOFT_DELETE_MATCH
  };

  if (cabinId) {
    const ownerIds = await resolveReviewOwnerObjectIds(cabinId);
    mongoQuery.cabinId = ownerIds.length ? { $in: ownerIds } : { $in: [] };
  }
  if (status) mongoQuery.status = status;
  if (source) mongoQuery.source = source;
  if (lang) mongoQuery.language = lang;
  if (minRating) mongoQuery.rating = { ...mongoQuery.rating, $gte: parseInt(minRating, 10) };
  if (maxRating) {
    mongoQuery.rating = { ...mongoQuery.rating, $lte: parseInt(maxRating, 10) };
  }
  if (q && String(q).trim()) {
    mongoQuery.$text = { $search: String(q).trim() };
  }

  let sortObj = {};
  switch (sort) {
    case 'newest':
      sortObj = { createdAtSource: -1, _id: -1 };
      break;
    case 'oldest':
      sortObj = { createdAtSource: 1, _id: 1 };
      break;
    case 'rating':
      sortObj = { rating: -1, createdAtSource: -1 };
      break;
    case 'pinned':
      sortObj = { pinned: -1, createdAtSource: -1 };
      break;
    default:
      sortObj = { createdAtSource: -1, _id: -1 };
  }

  const [reviews, total, moderationAgg] = await Promise.all([
    Review.find(mongoQuery)
      .populate('cabinId', 'name location')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Review.countDocuments(mongoQuery),
    Review.aggregate([
      { $match: SOFT_DELETE_MATCH },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);

  const statusCounts = moderationAgg.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  return {
    reviews,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 0,
    moderationSummary: {
      approved: statusCounts.approved || 0,
      pending: statusCounts.pending || 0,
      hidden: statusCounts.hidden || 0
    }
  };
}

/**
 * Set review moderation status to approved or hidden; updates audit fields and recomputes cabin stats.
 * @param {object} params
 * @param {string} params.reviewId
 * @param {'approved'|'hidden'} params.status
 * @param {object} [params.ctx]
 * @param {string} [params.ctx.editedBy]
 */
async function updateReviewModerationStatus({ reviewId, status, ctx = {} }) {
  if (!mongoose.Types.ObjectId.isValid(String(reviewId))) {
    const err = new Error('Invalid review id');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  const normalized = String(status || '').toLowerCase();
  if (!['approved', 'hidden'].includes(normalized)) {
    const err = new Error('status must be approved or hidden');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  const review = await Review.findById(reviewId);
  if (!review) {
    const err = new Error('Review not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const editedBy = ctx.editedBy || 'admin';
  review.status = normalized;
  review.editedAt = new Date();
  review.editedBy = editedBy;
  await review.save();

  try {
    await recalculateCabinStats(review.cabinId);
  } catch (recalcError) {
    console.error('Recalc stats error (non-fatal):', recalcError);
  }

  return review;
}

/**
 * Single review for moderation UI (admin-equivalent populate).
 * @param {string} reviewId
 * @returns {Promise<object>} lean review with populated cabinId (name, location)
 */
async function getReviewForModeration(reviewId) {
  if (!mongoose.Types.ObjectId.isValid(String(reviewId))) {
    const err = new Error('Invalid review id');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  const review = await Review.findById(reviewId).populate('cabinId', 'name location').lean();

  if (!review) {
    const err = new Error('Review not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  return review;
}

/**
 * Apply moderator PATCH payload — same behavior as legacy PATCH /api/admin/reviews/:id.
 * @param {object} params
 * @param {string} params.reviewId
 * @param {object} params.body — raw request body (validated upstream when applicable)
 * @param {object} [params.ctx]
 * @param {string} [params.ctx.editedBy]
 * @returns {Promise<import('mongoose').Document>}
 */
async function applyReviewModeratorUpdate({ reviewId, body = {}, ctx = {} }) {
  if (!mongoose.Types.ObjectId.isValid(String(reviewId))) {
    const err = new Error('Invalid review id');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  const review = await Review.findById(reviewId);
  if (!review) {
    const err = new Error('Review not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const isUnlocking = body.locked === false || body.locked === 'false';
  if (review.locked && body.text && !isUnlocking) {
    const err = new Error('Review is locked. Set locked to false to edit the text.');
    err.code = 'REVIEW_LOCKED';
    err.status = 403;
    throw err;
  }

  const adminIdentity = ctx.editedBy || ctx.identity || process.env.ADMIN_EMAIL || 'admin';
  const updateFields = {};

  if (body.rating !== undefined) {
    const ratingNum = Number(body.rating);
    if (!(ratingNum >= 1 && ratingNum <= 5)) {
      const err = new Error('rating must be between 1 and 5');
      err.code = 'VALIDATION';
      err.status = 400;
      throw err;
    }
    updateFields.rating = ratingNum;
  }
  if (body.text !== undefined) updateFields.text = sanitizeHtml(String(body.text).trim());
  if (body.reviewerName !== undefined) {
    const normalized = sanitizeName(String(body.reviewerName).trim());
    updateFields.reviewerName = normalized || null;
  }
  if (body.reviewerId !== undefined) updateFields.reviewerId = String(body.reviewerId).trim() || null;
  if (body.reviewHighlight !== undefined) {
    updateFields.reviewHighlight = sanitizeHtml(String(body.reviewHighlight).trim()) || null;
  }
  if (body.highlightType !== undefined) updateFields.highlightType = body.highlightType || null;
  if (body.language !== undefined) updateFields.language = body.language;
  if (body.status !== undefined) {
    const normalizedStatus = String(body.status).toLowerCase();
    if (!['approved', 'pending', 'hidden'].includes(normalizedStatus)) {
      const err = new Error('status must be one of: approved, pending, hidden');
      err.code = 'VALIDATION';
      err.status = 400;
      throw err;
    }
    updateFields.status = normalizedStatus;
  }
  if (body.pinned !== undefined) {
    updateFields.pinned = body.pinned === true || body.pinned === 'true';
  }
  if (body.locked !== undefined) {
    updateFields.locked = body.locked === true || body.locked === 'true';
  }
  if (body.moderationNotes !== undefined) updateFields.moderationNotes = body.moderationNotes;

  if (body.ownerResponse) {
    updateFields.ownerResponse = {
      text: sanitizeHtml(body.ownerResponse.text || ''),
      respondedBy: sanitizeHtml(body.ownerResponse.respondedBy || adminIdentity),
      respondedAt: new Date()
    };
  }

  updateFields.editedAt = new Date();
  updateFields.editedBy = adminIdentity;

  Object.assign(review, updateFields);
  await review.save();

  try {
    if (body.rating !== undefined || body.status !== undefined) {
      await recalculateCabinStats(review.cabinId);
    }
  } catch (recalcError) {
    console.error('Recalc stats error (non-fatal):', recalcError);
  }

  return review;
}

module.exports = {
  recalculateCabinStats,
  listReviewsForModeration,
  updateReviewModerationStatus,
  getReviewForModeration,
  applyReviewModeratorUpdate
};
