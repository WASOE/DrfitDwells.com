const express = require('express');
const Unit = require('../models/Unit');
const CabinType = require('../models/CabinType');
const featureFlags = require('../utils/featureFlags');
const { validateId } = require('../middleware/validateId');

const router = express.Router();

const multiUnitDisabled = (res) => res.status(403).json({
  success: false,
  message: 'Multi-unit cabins feature is disabled'
});

// GET /api/units/by-type/:cabinTypeId - Get all units for a cabin type
router.get('/by-type/:cabinTypeId', validateId('cabinTypeId'), async (req, res) => {
  try {
    if (!featureFlags.isMultiUnitGloballyEnabled()) {
      return multiUnitDisabled(res);
    }

    const cabinType = await CabinType.findById(req.params.cabinTypeId);
    if (!cabinType || !featureFlags.isMultiUnitType(cabinType.slug)) {
      return res.status(404).json({
        success: false,
        message: 'Multi-unit cabin type not found'
      });
    }

    const units = await Unit.find({
      cabinTypeId: req.params.cabinTypeId,
      isActive: true
    }).sort({ unitNumber: 1 });
    
    res.json({
      success: true,
      data: { units }
    });
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving units',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/units/:id - Get unit by ID
router.get('/:id', validateId('id'), async (req, res) => {
  try {
    if (!featureFlags.isMultiUnitGloballyEnabled()) {
      return multiUnitDisabled(res);
    }

    const unit = await Unit.findById(req.params.id).populate('cabinTypeId');
    
    if (!unit || !unit.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Unit not found'
      });
    }

    const cabinType = unit.cabinTypeId;
    if (!cabinType || !featureFlags.isMultiUnitType(cabinType.slug)) {
      return res.status(404).json({
        success: false,
        message: 'Multi-unit cabin type not found'
      });
    }

    res.json({
      success: true,
      data: { unit }
    });
  } catch (error) {
    console.error('Get unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving unit details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

