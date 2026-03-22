const express = require('express');
const { query, validationResult } = require('express-validator');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const AssignmentEngine = require('../services/assignmentEngine');
const featureFlags = require('../utils/featureFlags');
const moment = require('moment');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  normalizeGuestStayRange,
  isSingleCabinGuestStayAvailable
} = require('../services/publicAvailabilityService');
const { guestFacingCabinMatch } = require('../utils/fixtureExclusion');

const router = express.Router();

// GET /api/availability - Search for available cabins
router.get('/', [
  query('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  query('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  query('adults').isInt({ min: 1, max: 10 }).withMessage('Adults must be between 1 and 10'),
  query('children').optional().isInt({ min: 0, max: 10 }).withMessage('Children must be between 0 and 10')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { checkIn, checkOut, adults, children = 0 } = req.query;

    let checkInDate;
    let checkOutDate;
    try {
      const n = normalizeGuestStayRange(checkIn, checkOut);
      checkInDate = n.startDate;
      checkOutDate = n.endDate;
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid stay range (check-out must be after check-in)'
      });
    }

    const totalGuests = parseInt(adults, 10) + parseInt(children, 10);

    const todayStart = normalizeDateToSofiaDayStart(new Date());
    if (checkInDate < todayStart) {
      return res.status(400).json({
        success: false,
        message: 'Check-in date cannot be in the past'
      });
    }

    // Guest-facing cabins only (exclude validation fixture names)
    const allCabins = await Cabin.find(guestFacingCabinMatch());

    // Filter cabins by capacity and minimum guest requirements
    const capacityFilteredCabins = allCabins.filter(cabin => {
      const minGuests = cabin.minGuests || 1;
      return cabin.capacity >= totalGuests && totalGuests >= minGuests;
    });

    const availableCabins = [];
    for (const cabin of capacityFilteredCabins) {
      const ok = await isSingleCabinGuestStayAvailable(cabin, checkIn, checkOut);
      if (!ok) continue;

      // Calculate total price
        const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
        let totalPrice = totalNights * cabin.pricePerNight;
        if ((cabin.pricingModel || 'per_night') === 'per_person') {
          totalPrice *= totalGuests;
        }

      availableCabins.push({
        ...cabin.toObject(),
        totalNights,
        totalPrice,
        available: true
      });
    }

    // Include multi-unit cabin types (e.g. A-Frames) when enabled
    if (featureFlags.isMultiUnitGloballyEnabled()) {
      const cabinTypes = await CabinType.find({ isActive: true });

      for (const cabinType of cabinTypes) {
        if (!featureFlags.isMultiUnitType(cabinType.slug)) {
          continue;
        }

        const minGuests = cabinType.minGuests || 1;
        if (totalGuests > cabinType.capacity || totalGuests < minGuests) {
          continue;
        }

        const availabilitySummary = await AssignmentEngine.getAvailabilitySummary(
          cabinType._id,
          checkInDate,
          checkOutDate
        );

        if (availabilitySummary.availableUnits.length === 0) {
          continue;
        }

        const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
        let totalPrice = totalNights * cabinType.pricePerNight;
        if ((cabinType.pricingModel || 'per_night') === 'per_person') {
          totalPrice *= totalGuests;
        }

        availableCabins.push({
          ...cabinType.toObject(),
          totalNights,
          totalPrice,
          available: true,
          inventoryMode: 'multi',
          inventoryType: 'multi',
          cabinTypeId: cabinType._id,
          cabinTypeRef: cabinType._id,
          unitsAvailable: availabilitySummary.availableUnits.length,
          unitsTotal: availabilitySummary.totalUnits
        });
      }
    }

    res.json({
      success: true,
      data: {
        cabins: availableCabins,
        searchCriteria: {
          checkIn,
          checkOut,
          adults: parseInt(adults),
          children: parseInt(children),
          totalGuests
        },
        totalFound: availableCabins.length
      }
    });

  } catch (error) {
    console.error('Availability search error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching for available cabins',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/availability/cabin-type/:slug - Check pooled availability for a multi-unit cabin type
router.get('/cabin-type/:slug', [
  query('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  query('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  query('adults').isInt({ min: 1, max: 10 }).withMessage('Adults must be between 1 and 10'),
  query('children').optional().isInt({ min: 0, max: 10 }).withMessage('Children must be between 0 and 10')
], async (req, res) => {
  try {
    if (!featureFlags.isMultiUnitGloballyEnabled()) {
      return res.status(403).json({
        success: false,
        message: 'Multi-unit cabins feature is disabled'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { checkIn, checkOut, adults, children = 0 } = req.query;
    const typeSlug = req.params.slug?.trim().toLowerCase();

    if (!featureFlags.isMultiUnitType(typeSlug)) {
      return res.status(404).json({
        success: false,
        message: 'Multi-unit cabin type not found'
      });
    }

    let checkInDate;
    let checkOutDate;
    try {
      const n = normalizeGuestStayRange(checkIn, checkOut);
      checkInDate = n.startDate;
      checkOutDate = n.endDate;
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid stay range (check-out must be after check-in)'
      });
    }

    const totalGuests = parseInt(adults, 10) + parseInt(children, 10);

    const todayStart = normalizeDateToSofiaDayStart(new Date());
    if (checkInDate < todayStart) {
      return res.status(400).json({
        success: false,
        message: 'Check-in date cannot be in the past'
      });
    }

    // Get cabin type by slug
    const cabinType = await CabinType.findOne({ 
      slug: typeSlug,
      isActive: true 
    });

    if (!cabinType) {
      return res.status(404).json({
        success: false,
        message: 'Cabin type not found'
      });
    }

    // Check capacity + minimum guests
    if (totalGuests > cabinType.capacity) {
      return res.status(400).json({
        success: false,
        message: `This cabin type can only accommodate ${cabinType.capacity} guests`
      });
    }
    if (totalGuests < (cabinType.minGuests || 1)) {
      return res.status(400).json({
        success: false,
        message: `This cabin type requires at least ${cabinType.minGuests || 1} guests`
      });
    }

    // Get availability summary using assignment engine
    const availabilitySummary = await AssignmentEngine.getAvailabilitySummary(
      cabinType._id,
      checkInDate,
      checkOutDate
    );

    const isAvailable = availabilitySummary.availableUnits.length > 0;

    // Calculate total price
    const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
    let totalPrice = totalNights * cabinType.pricePerNight;
    if ((cabinType.pricingModel || 'per_night') === 'per_person') {
      totalPrice *= totalGuests;
    }

    res.json({
      success: true,
      data: {
        cabinType: {
          ...cabinType.toObject(),
          totalNights,
          totalPrice,
          available: isAvailable,
          availableUnitsCount: availabilitySummary.availableUnits.length,
          totalUnitsCount: availabilitySummary.totalUnits
        },
        availabilitySummary,
        searchCriteria: {
          checkIn,
          checkOut,
          adults: parseInt(adults),
          children: parseInt(children),
          totalGuests
        }
      }
    });

  } catch (error) {
    console.error('Cabin type availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking cabin type availability',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
