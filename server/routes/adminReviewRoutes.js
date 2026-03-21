const express = require('express');
const { body, validationResult } = require('express-validator');
const { adminAuth } = require('../middleware/adminAuth');
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Cabin = require('../models/Cabin');
const { adminModuleWriteGate } = require('../middleware/adminModuleCutoverEnforcement');

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

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = { deletedAt: { $exists: false } };

    if (cabinId) query.cabinId = cabinId;
    if (status) query.status = status;
    if (source) query.source = source;
    if (lang) query.language = lang;
    if (minRating) query.rating = { ...query.rating, $gte: parseInt(minRating) };
    if (maxRating) {
      query.rating = { ...query.rating, $lte: parseInt(maxRating) };
    }

    // Text search
    if (q) {
      query.$text = { $search: q };
    }

    // Build sort object
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

    // Get reviews and total
    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('cabinId', 'name location')
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
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

    const {
      cabinId,
      rating,
      text,
      reviewerName = 'Guest',
      language = 'en',
      status = 'approved',
      pinned = false,
      locked = false,
      ownerResponse
    } = req.body || {};

    // Validate required fields
    if (!cabinId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'cabinId is required'
      });
    }

    const ratingNum = Number(rating);
    if (!(ratingNum >= 1 && ratingNum <= 5)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'rating must be between 1 and 5'
      });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'text is required'
      });
    }

    // Normalize status
    const normalizedStatus = String(status || 'approved').toLowerCase();
    if (!['approved', 'pending', 'hidden'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION',
        message: 'status must be one of: approved, pending, hidden'
      });
    }

    // Verify cabin exists
    const cabin = await Cabin.findById(cabinId);
    if (!cabin) {
      return res.status(404).json({
        success: false,
        code: 'CABIN_NOT_FOUND',
        message: 'Cabin not found'
      });
    }

    // Normalize booleans
    const pinnedBool = pinned === true || pinned === 'true';
    const lockedBool = locked === true || locked === 'true';

    // Sanitize reviewerName (will be sanitized by model pre-save hook, but normalize here too)
    const { sanitizeName } = require('../utils/nameUtils');
    const normalizedReviewerName = reviewerName ? sanitizeName(String(reviewerName).trim()) : null;

    // Create review
    const review = new Review({
      cabinId,
      source: 'manual',
      rating: ratingNum,
      text: sanitizeHtml(text.trim()),
      reviewerName: normalizedReviewerName, // Will be null if empty, which displays as "Guest" in UI
      language: language || 'en',
      status: normalizedStatus,
      pinned: pinnedBool,
      locked: lockedBool,
      createdAtSource: new Date()
    });

    await review.save();

    // Add owner response if provided
    if (ownerResponse && ownerResponse.text && ownerResponse.text.trim()) {
      review.ownerResponse = {
        text: sanitizeHtml(ownerResponse.text.trim()),
        respondedBy: sanitizeHtml(ownerResponse.respondedBy || getAdminIdentity(req)),
        respondedAt: new Date()
      };
      await review.save();
    }

    // Recalculate cabin stats
    try {
      await recalculateCabinStats(cabinId);
    } catch (recalcError) {
      console.error('Recalc stats error (non-fatal):', recalcError);
      // Don't fail the review creation if stats recalculation fails
    }

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Create review error:', error);
    
    // Handle duplicate externalId error (shouldn't happen for manual reviews, but just in case)
    if (error?.code === 11000 && error?.keyPattern?.externalId) {
      return res.status(400).json({
        success: false,
        code: 'DUPLICATE_EXTERNAL_ID',
        message: 'A review with this externalId already exists'
      });
    }

    // Handle validation errors
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

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if locked and trying to edit text
    const isUnlocking = req.body.locked === false || req.body.locked === 'false';
    if (review.locked && req.body.text && !isUnlocking) {
      return res.status(403).json({
        success: false,
        code: 'REVIEW_LOCKED',
        message: 'Review is locked. Set locked to false to edit the text.'
      });
    }

    const adminIdentity = getAdminIdentity(req);
    const updateFields = {};

    // Normalize and set editable fields
    if (req.body.rating !== undefined) {
      const ratingNum = Number(req.body.rating);
      if (!(ratingNum >= 1 && ratingNum <= 5)) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION',
          message: 'rating must be between 1 and 5'
        });
      }
      updateFields.rating = ratingNum;
    }
    if (req.body.text !== undefined) updateFields.text = sanitizeHtml(req.body.text.trim());
    if (req.body.reviewerName !== undefined) {
      const { sanitizeName } = require('../utils/nameUtils');
      const normalized = sanitizeName(String(req.body.reviewerName).trim());
      updateFields.reviewerName = normalized || null; // Store null instead of empty string
    }
    if (req.body.reviewerId !== undefined) updateFields.reviewerId = String(req.body.reviewerId).trim() || null;
    if (req.body.reviewHighlight !== undefined) updateFields.reviewHighlight = sanitizeHtml(String(req.body.reviewHighlight).trim()) || null;
    if (req.body.highlightType !== undefined) updateFields.highlightType = req.body.highlightType || null;
    if (req.body.language !== undefined) updateFields.language = req.body.language;
    if (req.body.status !== undefined) {
      const normalizedStatus = String(req.body.status).toLowerCase();
      if (!['approved', 'pending', 'hidden'].includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION',
          message: 'status must be one of: approved, pending, hidden'
        });
      }
      updateFields.status = normalizedStatus;
    }
    if (req.body.pinned !== undefined) {
      updateFields.pinned = req.body.pinned === true || req.body.pinned === 'true';
    }
    if (req.body.locked !== undefined) {
      updateFields.locked = req.body.locked === true || req.body.locked === 'true';
    }
    if (req.body.moderationNotes !== undefined) updateFields.moderationNotes = req.body.moderationNotes;

    // Owner response
    if (req.body.ownerResponse) {
      updateFields.ownerResponse = {
        text: sanitizeHtml(req.body.ownerResponse.text || ''),
        respondedBy: sanitizeHtml(req.body.ownerResponse.respondedBy || adminIdentity),
        respondedAt: new Date()
      };
    }

    // Never change externalId for imported reviews
    // Never change source or raw

    // Update timestamps
    updateFields.editedAt = new Date();
    updateFields.editedBy = adminIdentity;

    Object.assign(review, updateFields);
    await review.save();

    // Recalculate cabin stats if rating or status changed
    try {
      if (req.body.rating !== undefined || req.body.status !== undefined) {
        await recalculateCabinStats(review.cabinId);
      }
    } catch (recalcError) {
      console.error('Recalc stats error (non-fatal):', recalcError);
      // Don't fail the review update if stats recalculation fails
    }

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Update review error:', error);
    
    // Handle validation errors
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

    await recalculateCabinStats(cabinId);

    const updatedCabin = await Cabin.findById(cabinId);
    res.json({
      success: true,
      message: 'Cabin stats recalculated',
      data: {
        cabin: {
          reviewsCount: updatedCabin.reviewsCount,
          averageRating: updatedCabin.averageRating
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

// Helper: Recalculate cabin review statistics
async function recalculateCabinStats(cabinId) {
  const stats = await Review.aggregate([
    {
      $match: {
        cabinId: new mongoose.Types.ObjectId(cabinId),
        status: 'approved',
        rating: { $gte: 2 },
        deletedAt: { $exists: false }
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
  const averageRating = stats[0]?.avgRating || 0;

  await Cabin.findByIdAndUpdate(cabinId, {
    reviewsCount,
    averageRating: Math.round(averageRating * 10) / 10 // Round to 1 decimal
  });
}

module.exports = router;

