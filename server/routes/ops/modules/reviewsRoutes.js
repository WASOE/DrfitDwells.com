const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const { adminModuleWriteGate } = require('../../../middleware/adminModuleCutoverEnforcement');
const {
  listReviewsForModeration,
  updateReviewModerationStatus
} = require('../../../services/reviews/reviewModerationService');

const router = express.Router();

const EXCERPT_LEN = 220;

function getOpsIdentity(req) {
  return process.env.ADMIN_EMAIL || req.user?.email || 'admin';
}

function mapReviewToOpsItem(review) {
  const cabin = review.cabinId && typeof review.cabinId === 'object' ? review.cabinId : null;
  const cabinIdRaw = cabin?._id ?? review.cabinId;
  const text = review.text || '';
  const excerpt =
    text.length > EXCERPT_LEN ? `${text.slice(0, EXCERPT_LEN).trim()}…` : text.trim();

  return {
    reviewId: String(review._id),
    cabinId: cabinIdRaw ? String(cabinIdRaw) : null,
    cabinName: cabin?.name || null,
    textExcerpt: excerpt,
    reviewerName: review.reviewerName || null,
    reviewerDisplay: review.reviewerName?.trim() ? review.reviewerName : 'Guest',
    source: review.source || null,
    rating: review.rating,
    status: review.status,
    pinned: Boolean(review.pinned),
    locked: Boolean(review.locked),
    createdAtSource: review.createdAtSource || null
  };
}

router.get('/', async (req, res) => {
  try {
    const { status, page, limit, q } = req.query;
    const result = await listReviewsForModeration({
      status: status || undefined,
      page,
      limit,
      q: q || undefined,
      sort: 'newest'
    });

    const data = {
      items: result.reviews.map(mapReviewToOpsItem),
      moderationSummary: result.moderationSummary,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages
      }
    };

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch(
  '/:id/status',
  validateId('id'),
  adminModuleWriteGate('reviews_communications'),
  body('status').isIn(['approved', 'hidden']).withMessage('status must be approved or hidden'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const review = await updateReviewModerationStatus({
        reviewId: req.params.id,
        status: req.body.status,
        ctx: { editedBy: getOpsIdentity(req) }
      });

      return res.json({
        success: true,
        message: 'Review status updated',
        data: {
          review: {
            _id: review._id,
            status: review.status,
            editedAt: review.editedAt,
            editedBy: review.editedBy
          }
        }
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.code === 'VALIDATION') {
        return res.status(error.status || 400).json({ success: false, message: error.message });
      }
      console.error('OPS review status error:', error);
      return res.status(500).json({
        success: false,
        message: error?.message || 'Unable to update review status'
      });
    }
  }
);

module.exports = router;
