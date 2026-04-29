const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const { adminModuleWriteGate } = require('../../../middleware/adminModuleCutoverEnforcement');
const {
  listReviewsForModeration,
  createReviewForModeration,
  updateReviewModerationStatus,
  getReviewForModeration,
  applyReviewModeratorUpdate
} = require('../../../services/reviews/reviewModerationService');

const createReviewValidators = [
  body('cabinId').isMongoId().withMessage('Valid cabin ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('text').trim().isLength({ min: 1, max: 2000 }).withMessage('Review text is required (max 2000 characters)'),
  body('reviewerName').optional().trim().isLength({ max: 100 }),
  body('reviewerId').optional().trim().isLength({ max: 100 }),
  body('reviewHighlight').optional().trim().isLength({ max: 100 }),
  body('highlightType').optional().isIn(['LENGTH_OF_STAY', 'TYPE_OF_TRIP']),
  body('language').optional().trim().isLength({ max: 10 })
];

const patchReviewValidators = [
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('text').optional().trim().isLength({ max: 2000 }),
  body('reviewerName').optional().trim().isLength({ max: 100 }),
  body('reviewerId').optional().trim().isLength({ max: 100 }),
  body('reviewHighlight').optional().trim().isLength({ max: 100 }),
  body('highlightType').optional().isIn(['LENGTH_OF_STAY', 'TYPE_OF_TRIP']),
  body('language').optional().trim().isLength({ max: 10 }),
  body('status').optional().isIn(['approved', 'pending', 'hidden']),
  body('pinned').optional().isBoolean(),
  body('locked').optional().isBoolean()
];

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
    const {
      status,
      page,
      limit,
      q,
      cabinId,
      source,
      sort,
      minRating,
      maxRating,
      lang
    } = req.query;
    const result = await listReviewsForModeration({
      status: status || undefined,
      page,
      limit,
      q: q || undefined,
      cabinId: cabinId || undefined,
      source: source || undefined,
      sort: sort || 'newest',
      minRating: minRating || undefined,
      maxRating: maxRating || undefined,
      lang: lang || undefined
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

router.get('/:id', validateId('id'), async (req, res) => {
  try {
    const review = await getReviewForModeration(req.params.id);
    return res.json({ success: true, data: { review } });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === 'VALIDATION') {
      return res.status(error.status || 400).json({ success: false, message: error.message });
    }
    console.error('OPS review get error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post(
  '/',
  createReviewValidators,
  adminModuleWriteGate('reviews_communications'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION',
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const review = await createReviewForModeration({
        body: req.body,
        ctx: { editedBy: getOpsIdentity(req) }
      });

      return res.status(201).json({
        success: true,
        message: 'Review created successfully',
        data: { review }
      });
    } catch (error) {
      if (error.code === 'VALIDATION') {
        return res.status(error.status || 400).json({
          success: false,
          code: 'VALIDATION',
          message: error.message
        });
      }
      if (error.code === 'CABIN_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          code: error.code,
          message: error.message
        });
      }
      if (error.code === 'DUPLICATE_EXTERNAL_ID') {
        return res.status(400).json({
          success: false,
          code: error.code,
          message: error.message
        });
      }
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION',
          message: 'Validation failed',
          details: error.message
        });
      }
      console.error('OPS review create error:', error);
      return res.status(400).json({
        success: false,
        code: 'CREATE_REVIEW_FAILED',
        message: error?.message || 'Unable to create review'
      });
    }
  }
);

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

router.patch(
  '/:id',
  validateId('id'),
  patchReviewValidators,
  adminModuleWriteGate('reviews_communications'),
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

      const review = await applyReviewModeratorUpdate({
        reviewId: req.params.id,
        body: req.body,
        ctx: { editedBy: getOpsIdentity(req) }
      });

      return res.json({
        success: true,
        message: 'Review updated successfully',
        data: { review }
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.code === 'REVIEW_LOCKED') {
        return res.status(403).json({
          success: false,
          code: error.code,
          message: error.message
        });
      }
      if (error.code === 'VALIDATION') {
        return res.status(error.status || 400).json({
          success: false,
          code: 'VALIDATION',
          message: error.message
        });
      }
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION',
          message: 'Validation failed',
          details: error.message
        });
      }
      console.error('OPS review patch error:', error);
      return res.status(400).json({
        success: false,
        message: error?.message || 'Unable to update review'
      });
    }
  }
);

module.exports = router;
