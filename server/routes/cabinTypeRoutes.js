const express = require('express');
const CabinType = require('../models/CabinType');
const featureFlags = require('../utils/featureFlags');

const router = express.Router();

const addMultiUnitMeta = (cabinTypeDoc) => {
  if (!cabinTypeDoc) return null;
  const cabinType = cabinTypeDoc.toObject ? cabinTypeDoc.toObject() : cabinTypeDoc;
  const isMultiUnit = featureFlags.isMultiUnitType(cabinType.slug);
  return {
    ...cabinType,
    meta: {
      ...(cabinType.meta || {}),
      isMultiUnit
    }
  };
};

// GET /api/cabin-types - Get all active cabin types
router.get('/', async (req, res) => {
  try {
    const cabinTypes = await CabinType.find({ isActive: true });
    
    res.json({
      success: true,
      data: {
        cabinTypes: cabinTypes.map(addMultiUnitMeta)
      }
    });
  } catch (error) {
    console.error('Get cabin types error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabin types',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/cabin-types/:slug - Get cabin type by slug
router.get('/:slug', async (req, res) => {
  try {
    const cabinType = await CabinType.findOne({ 
      slug: req.params.slug,
      isActive: true 
    });
    
    if (!cabinType) {
      return res.status(404).json({
        success: false,
        message: 'Cabin type not found'
      });
    }

    res.json({
      success: true,
      data: { cabinType: addMultiUnitMeta(cabinType) }
    });
  } catch (error) {
    console.error('Get cabin type error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabin type details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

