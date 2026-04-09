const express = require('express');
const { validateId } = require('../middleware/validateId');
const Review = require('../models/Review');
const {
  resolveReviewOwnerObjectIds,
  softDeleteOrCondition
} = require('../services/reviewOwnershipService');

const router = express.Router();

// GET /api/cabins/:id/reviews - Public endpoint for cabin reviews
// Supports both Cabin IDs and CabinType IDs (for multi-unit properties)
router.get('/cabins/:id/reviews', validateId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      page = 1,
      limit = 10,
      minRating = 2,
      lang,
      sort = 'pinned_first'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const minRatingNum = parseInt(minRating, 10) || 2;
    const skip = (pageNum - 1) * limitNum;

    const cabinIds = await resolveReviewOwnerObjectIds(id);
    if (cabinIds.length === 0) {
      return res.json({
        success: true,
        data: {
          items: [],
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0
        }
      });
    }

    // Build query - only approved reviews, minRating filter, same soft-delete as admin
    const query = {
      cabinId: { $in: cabinIds },
      status: 'approved',
      rating: { $gte: minRatingNum },
      ...softDeleteOrCondition()
    };

    if (lang) {
      query.language = lang;
    }

    // Build sort object
    let sortObj = {};
    switch (sort) {
      case 'pinned_first':
        sortObj = { pinned: -1, createdAtSource: -1, _id: -1 };
        break;
      case 'newest':
        sortObj = { createdAtSource: -1, _id: -1 };
        break;
      case 'rating':
        sortObj = { rating: -1, createdAtSource: -1, _id: -1 };
        break;
      default:
        sortObj = { pinned: -1, createdAtSource: -1, _id: -1 };
    }

    // Get reviews and total count
    const [reviews, total] = await Promise.all([
      Review.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(query)
    ]);

    // Sanitize output - remove admin-only fields
    const sanitizedReviews = reviews.map(review => {
      const { raw, moderationNotes, deletedAt, editedBy, ...publicReview } = review;
      
      // Only include ownerResponse if it exists
      if (!publicReview.ownerResponse || !publicReview.ownerResponse.text) {
        delete publicReview.ownerResponse;
      }
      
      return publicReview;
    });

    res.json({
      success: true,
      data: {
        items: sanitizedReviews,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

