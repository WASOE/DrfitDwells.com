const express = require('express');
const Review = require('../models/Review');

const router = express.Router();

// GET /api/cabins/:id/reviews - Public endpoint for cabin reviews
router.get('/cabins/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      page = 1,
      limit = 10,
      minRating = 2,
      lang,
      sort = 'pinned_first'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const minRatingNum = parseInt(minRating);
    const skip = (pageNum - 1) * limitNum;

    // Build query - only approved reviews, minRating filter, no deleted
    const query = {
      cabinId: id,
      status: 'approved',
      rating: { $gte: minRatingNum },
      deletedAt: { $exists: false }
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

