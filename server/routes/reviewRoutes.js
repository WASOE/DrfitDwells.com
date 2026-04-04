const express = require('express');
const mongoose = require('mongoose');
const { validateId } = require('../middleware/validateId');
const Review = require('../models/Review');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

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

    // Resolve review owner IDs for both single-cabin and multi-unit entities.
    let cabinIds = [];
    const cabinType = await CabinType.findById(id);
    if (cabinType) {
      const cabins = await Cabin.find(
        { $or: [{ cabinTypeRef: id }, { cabinTypeId: id }] },
        '_id'
      );
      cabinIds = cabins.map((c) => c._id);
      cabinIds.push(new mongoose.Types.ObjectId(id));
    } else {
      const cabin = await Cabin.findById(id).select('_id inventoryType cabinTypeId');
      cabinIds = [new mongoose.Types.ObjectId(id)];

      if (cabin && cabin.inventoryType === 'multi' && cabin.cabinTypeId) {
        const typeId = cabin.cabinTypeId.toString();
        const relatedCabins = await Cabin.find(
          { $or: [{ cabinTypeRef: typeId }, { cabinTypeId: typeId }] },
          '_id'
        );
        cabinIds.push(new mongoose.Types.ObjectId(typeId));
        cabinIds.push(...relatedCabins.map((c) => c._id));
      }
    }

    cabinIds = Array.from(new Set(cabinIds.map((value) => value.toString()))).map(
      (value) => new mongoose.Types.ObjectId(value)
    );

    // Build query - only approved reviews, minRating filter, no deleted
    // For CabinType, search across all related Cabin instances
    const query = {
      cabinId: { $in: cabinIds },
      status: 'approved',
      rating: { $gte: minRatingNum },
      $or: [
        { deletedAt: { $exists: false } },
        { deletedAt: null }
      ]
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

