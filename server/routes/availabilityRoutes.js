const express = require('express');
const { query, validationResult } = require('express-validator');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const AssignmentEngine = require('../services/assignmentEngine');
const featureFlags = require('../utils/featureFlags');
const moment = require('moment');

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
    
    // Parse dates
    const checkInDate = moment(checkIn).startOf('day').toDate();
    const checkOutDate = moment(checkOut).startOf('day').toDate();
    const totalGuests = parseInt(adults) + parseInt(children);

    // Validate dates
    if (checkInDate >= checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Check-out date must be after check-in date'
      });
    }

    if (checkInDate < moment().startOf('day').toDate()) {
      return res.status(400).json({
        success: false,
        message: 'Check-in date cannot be in the past'
      });
    }

    // Get all active cabins
    const allCabins = await Cabin.find({ isActive: true });

    // Filter cabins by capacity
    const capacityFilteredCabins = allCabins.filter(cabin => cabin.capacity >= totalGuests);

    // Check availability for each cabin
    const availableCabins = [];

    for (const cabin of capacityFilteredCabins) {
      // Check if cabin has blocked dates in the requested period
      const hasBlockedDates = cabin.blockedDates.some(blockedDate => {
        const blocked = moment(blockedDate).startOf('day').toDate();
        return blocked >= checkInDate && blocked < checkOutDate;
      });

      if (hasBlockedDates) {
        continue;
      }

      // Check for existing bookings that overlap with the requested period
      const conflictingBookings = await Booking.find({
        cabinId: cabin._id,
        status: { $in: ['pending', 'confirmed'] },
        $or: [
          {
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
          }
        ]
      });

      if (conflictingBookings.length === 0) {
        // Calculate total price
        const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
        const totalPrice = totalNights * cabin.pricePerNight;

        availableCabins.push({
          ...cabin.toObject(),
          totalNights,
          totalPrice,
          available: true
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
    
    // Parse dates
    const checkInDate = moment(checkIn).startOf('day').toDate();
    const checkOutDate = moment(checkOut).startOf('day').toDate();
    const totalGuests = parseInt(adults) + parseInt(children);

    // Validate dates
    if (checkInDate >= checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Check-out date must be after check-in date'
      });
    }

    if (checkInDate < moment().startOf('day').toDate()) {
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

    // Check capacity
    if (totalGuests > cabinType.capacity) {
      return res.status(400).json({
        success: false,
        message: `This cabin type can only accommodate ${cabinType.capacity} guests`
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
    const totalPrice = totalNights * cabinType.pricePerNight;

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
