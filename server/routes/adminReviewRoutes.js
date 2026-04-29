const express = require('express');
const { body, validationResult } = require('express-validator');
const { adminAuth } = require('../middleware/adminAuth');
const Review = require('../models/Review');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const { adminModuleWriteGate } = require('../middleware/adminModuleCutoverEnforcement');
const {
  listReviewsForModeration,
  recalculateCabinStats,
  createReviewForModeration,
  applyReviewModeratorUpdate
} = require('../services/reviews/reviewModerationService');

const router = express.Router();

// All admin review routes require authentication
router.use(adminAuth);

// Helper: Sanitize HTML (basic XSS prevention)
const sanitizeHtml = (text) => {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

// Helper: Get admin identity
const getAdminIdentity = (req) => {
  return process.env.ADMIN_EMAIL || req.user?.email || 'admin';
};

// GET /api/admin/reviews - List reviews with filters
router.get('/', async (req, res) => {
  try {
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
    } = req.query;

    const result = await listReviewsForModeration({
      q,
      cabinId,
      status,
      source,
      minRating,
      maxRating,
      lang,
      page,
      limit,
      sort
    });

    res.json({
      success: true,
      data: {
        reviews: result.reviews,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      }
    });
  } catch (error) {
    console.error('List reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/admin/reviews/:id - Get single review
router.get('/:id', async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('cabinId', 'name location')
      .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.json({
      success: true,
      data: { review }
    });
  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching review',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/admin/reviews - Create manual review
router.post('/', [
  body('cabinId').isMongoId().withMessage('Valid cabin ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('text').trim().isLength({ min: 1, max: 2000 }).withMessage('Review text is required (max 2000 characters)'),
  body('reviewerName').optional().trim().isLength({ max: 100 }),
  body('reviewerId').optional().trim().isLength({ max: 100 }),
  body('reviewHighlight').optional().trim().isLength({ max: 100 }),
  body('highlightType').optional().isIn(['LENGTH_OF_STAY', 'TYPE_OF_TRIP']),
  body('language').optional().trim().isLength({ max: 10 })
], adminModuleWriteGate('reviews_communications'), async (req, res) => {
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
      ctx: { editedBy: getAdminIdentity(req) }
    });

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Create review error:', error);

    if (error.code === 'DUPLICATE_EXTERNAL_ID') {
      return res.status(400).json({
        success: false,
        code: error.code,
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

    res.status(400).json({
      success: false,
      code: 'CREATE_REVIEW_FAILED',
      message: error?.message || 'Unable to create review',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// PATCH /api/admin/reviews/:id - Update review
router.patch('/:id', [
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
], adminModuleWriteGate('reviews_communications'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const adminIdentity = getAdminIdentity(req);
    let review;
    try {
      review = await applyReviewModeratorUpdate({
        reviewId: req.params.id,
        body: req.body,
        ctx: { editedBy: adminIdentity }
      });
    } catch (serviceErr) {
      if (serviceErr.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: serviceErr.message
        });
      }
      if (serviceErr.code === 'REVIEW_LOCKED') {
        return res.status(403).json({
          success: false,
          code: serviceErr.code,
          message: serviceErr.message
        });
      }
      if (serviceErr.code === 'VALIDATION') {
        return res.status(serviceErr.status || 400).json({
          success: false,
          code: 'VALIDATION',
          message: serviceErr.message
        });
      }
      throw serviceErr;
    }

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Update review error:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'Validation failed',
        details: error.message
      });
    }

    res.status(400).json({
      success: false,
      code: 'UPDATE_REVIEW_FAILED',
      message: error?.message || 'Unable to update review',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// POST /api/admin/reviews/bulk - Bulk actions
router.post('/bulk', [
  body('ids').isArray().withMessage('ids must be an array'),
  body('ids.*').isMongoId().withMessage('Each ID must be valid'),
  body('action').isIn(['approve', 'hide', 'pin', 'unpin', 'delete']).withMessage('Invalid action')
], adminModuleWriteGate('reviews_communications'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { ids, action } = req.body;
    const adminIdentity = getAdminIdentity(req);
    const updateFields = {};
    const cabinIds = new Set();

    switch (action) {
      case 'approve':
        updateFields.status = 'approved';
        break;
      case 'hide':
        updateFields.status = 'hidden';
        break;
      case 'pin':
        updateFields.pinned = true;
        break;
      case 'unpin':
        updateFields.pinned = false;
        break;
      case 'delete':
        updateFields.deletedAt = new Date();
        updateFields.status = 'hidden';
        break;
    }

    updateFields.editedAt = new Date();
    updateFields.editedBy = adminIdentity;

    // Get reviews to find cabinIds
    const reviews = await Review.find({ _id: { $in: ids } });
    reviews.forEach(review => {
      if (review.cabinId) cabinIds.add(review.cabinId.toString());
    });

    // Update all reviews
    const result = await Review.updateMany(
      { _id: { $in: ids } },
      { $set: updateFields }
    );

    // Recalculate stats for affected cabins
    for (const cabinId of cabinIds) {
      await recalculateCabinStats(cabinId);
    }

    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      data: {
        updated: result.modifiedCount,
        affectedCabins: Array.from(cabinIds)
      }
    });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({
      success: false,
      message: 'Error performing bulk action',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/admin/reviews/recalc/:cabinId - Recalculate cabin stats
router.post('/recalc/:cabinId', adminModuleWriteGate('reviews_communications'), async (req, res) => {
  try {
    const { cabinId } = req.params;

    const cabin = await Cabin.findById(cabinId);
    if (!cabin) {
      return res.status(404).json({
        success: false,
        message: 'Cabin not found'
      });
    }

    const statsResult = await recalculateCabinStats(cabinId);

    const statsDoc =
      statsResult && statsResult.kind === 'cabinType'
        ? await CabinType.findById(statsResult.id).select('reviewsCount averageRating')
        : await Cabin.findById(cabinId).select('reviewsCount averageRating');

    res.json({
      success: true,
      message: 'Cabin stats recalculated',
      data: {
        cabin: {
          reviewsCount: statsDoc?.reviewsCount || 0,
          averageRating: statsDoc?.averageRating || 0
        }
      }
    });
  } catch (error) {
    console.error('Recalc stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error recalculating stats',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

