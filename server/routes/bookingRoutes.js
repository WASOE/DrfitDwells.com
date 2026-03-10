const express = require('express');
const { body, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const AssignmentEngine = require('../services/assignmentEngine');
const featureFlags = require('../utils/featureFlags');
const moment = require('moment');
const emailService = require('../services/emailService');
const pricingService = require('../services/pricingService');
const Stripe = require('stripe');

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// POST /api/bookings/create-payment-intent - Create Stripe PaymentIntent for cabin booking
router.post('/create-payment-intent', [
  body('cabinId').isMongoId().withMessage('Valid cabin ID is required'),
  body('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  body('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  body('adults').isInt({ min: 1, max: 10 }).withMessage('Adults must be between 1 and 10'),
  body('children').optional().isInt({ min: 0, max: 10 }).withMessage('Children must be between 0 and 10'),
  body('experienceKeys').optional().isArray().withMessage('experienceKeys must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Payment is not configured'
      });
    }

    const { cabinId, checkIn, checkOut, adults, children = 0, experienceKeys = [] } = req.body;
    const checkInDate = moment(checkIn).startOf('day').toDate();
    const checkOutDate = moment(checkOut).startOf('day').toDate();

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

    const cabin = await Cabin.findById(cabinId);
    if (!cabin || !cabin.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Cabin not found or not available'
      });
    }

    const totalGuests = parseInt(adults, 10) + parseInt(children, 10);
    if (totalGuests > cabin.capacity) {
      return res.status(400).json({
        success: false,
        message: `This cabin can only accommodate ${cabin.capacity} guests`
      });
    }

    const errKeys = pricingService.validateExperienceKeys(cabin, experienceKeys);
    if (errKeys) {
      return res.status(400).json({
        success: false,
        message: errKeys
      });
    }

    const { totalPrice } = pricingService.calculateCabinPrice(
      cabin,
      checkInDate,
      checkOutDate,
      parseInt(adults, 10),
      parseInt(children, 10),
      experienceKeys
    );

    if (totalPrice < 0.5) {
      return res.status(400).json({
        success: false,
        message: 'Invalid price'
      });
    }

    const currency = (process.env.STRIPE_CURRENCY || 'eur').toLowerCase();
    const amountCents = Math.round(totalPrice * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true }
    });

    return res.json({
      success: true,
      clientSecret: paymentIntent.client_secret
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? err.message : 'Payment setup failed'
    });
  }
});

// POST /api/bookings - Create a new booking
// Supports both legacy single-cabin bookings (cabinId) and multi-unit cabin type bookings (cabinTypeId)
router.post('/', [
  body('cabinId').optional().isMongoId().withMessage('Valid cabin ID is required if provided'),
  body('cabinTypeId').optional().isMongoId().withMessage('Valid cabin type ID is required if provided'),
  body('unitId').optional().isMongoId().withMessage('Valid unit ID is required if provided'),
  body('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  body('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  body('adults').isInt({ min: 1, max: 10 }).withMessage('Adults must be between 1 and 10'),
  body('children').optional().isInt({ min: 0, max: 10 }).withMessage('Children must be between 0 and 10'),
  body('guestInfo.firstName').trim().isLength({ min: 1, max: 50 }).withMessage('First name is required (max 50 characters)'),
  body('guestInfo.lastName').trim().isLength({ min: 1, max: 50 }).withMessage('Last name is required (max 50 characters)'),
  body('guestInfo.email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('guestInfo.phone').trim().isLength({ min: 1 }).withMessage('Phone number is required'),
  body('specialRequests').optional().isLength({ max: 500 }).withMessage('Special requests cannot exceed 500 characters')
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

    const { cabinId, cabinTypeId, unitId, checkIn, checkOut, adults, children = 0, guestInfo, specialRequests } = req.body;

    // Validate: must have either cabinId OR cabinTypeId, not both
    if (!cabinId && !cabinTypeId) {
      return res.status(400).json({
        success: false,
        message: 'Either cabinId or cabinTypeId is required'
      });
    }

    if (cabinId && cabinTypeId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot specify both cabinId and cabinTypeId'
      });
    }

    // Parse dates
    const checkInDate = moment(checkIn).startOf('day').toDate();
    const checkOutDate = moment(checkOut).startOf('day').toDate();

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

    const totalGuests = parseInt(adults) + parseInt(children);
    let cabin = null;
    let cabinType = null;
    let assignedUnitId = unitId || null;
    let pricePerNight = 0;
    let pricingModel = 'per_night';
    let minGuests = 1;
    let transportOptions = [];

    // Handle legacy single-cabin booking
    if (cabinId) {
      cabin = await Cabin.findById(cabinId);
      if (!cabin || !cabin.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Cabin not found or not available'
        });
      }

      if (totalGuests > cabin.capacity) {
        return res.status(400).json({
          success: false,
          message: `This cabin can only accommodate ${cabin.capacity} guests`
        });
      }
      if (totalGuests < (cabin.minGuests || 1)) {
        return res.status(400).json({
          success: false,
          message: `This cabin requires at least ${cabin.minGuests || 1} guests`
        });
      }

      // Check for conflicting bookings
      const conflictingBookings = await Booking.find({
        cabinId,
        status: { $in: ['pending', 'confirmed'] },
        $or: [
          {
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
          }
        ]
      });

      if (conflictingBookings.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'This cabin is not available for the selected dates'
        });
      }

      pricePerNight = cabin.pricePerNight;
      pricingModel = cabin.pricingModel || 'per_night';
      minGuests = cabin.minGuests || 1;
      transportOptions = cabin.transportOptions || [];
    } 
    // Handle multi-unit cabin booking
    else if (cabinTypeId) {
      cabinType = await CabinType.findById(cabinTypeId);
      if (!cabinType || !cabinType.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Cabin type not found or not available'
        });
      }

      if (!featureFlags.isMultiUnitGloballyEnabled()) {
        return res.status(403).json({
          success: false,
          message: 'Multi-unit cabins feature is disabled'
        });
      }

      if (!featureFlags.isMultiUnitType(cabinType.slug)) {
        return res.status(400).json({
          success: false,
          message: 'This cabin type is not configured for multi-unit bookings'
        });
      }

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

      // If specific unit requested, verify it's available
      if (unitId) {
        const isAvailable = await AssignmentEngine.isUnitAvailable(unitId, checkInDate, checkOutDate);
        if (!isAvailable) {
          return res.status(409).json({
            success: false,
            message: 'The requested unit is not available for the selected dates'
          });
        }
        assignedUnitId = unitId;
      } else {
        // Auto-assign best available unit
        const assignedUnit = await AssignmentEngine.assignUnit(cabinTypeId, checkInDate, checkOutDate);
        if (!assignedUnit) {
          return res.status(409).json({
            success: false,
            message: 'No units available for the selected dates'
          });
        }
        assignedUnitId = assignedUnit._id;
      }

      pricePerNight = cabinType.pricePerNight;
      pricingModel = cabinType.pricingModel || 'per_night';
      minGuests = cabinType.minGuests || 1;
      transportOptions = cabinType.transportOptions || [];
    }

    // Calculate total price
    const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
    let totalPrice = totalNights * pricePerNight;
    if (pricingModel === 'per_person') {
      totalPrice *= totalGuests;
    }
    
    // Add transport cost if provided
    if (req.body.transportMethod && req.body.transportMethod !== 'Not selected') {
      const transportOption = transportOptions.find(t => t.type === req.body.transportMethod);
      if (transportOption) {
        totalPrice += transportOption.pricePerPerson * totalGuests;
      }
    }
    
    // Add romantic setup cost if requested
    if (req.body.romanticSetup) {
      totalPrice += 30; // €30 flat fee for romantic setup
    }

    // Create booking
    const bookingData = {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      adults: parseInt(adults),
      children: parseInt(children),
      guestInfo,
      specialRequests,
      totalPrice,
      // Legacy fields for backward compatibility
      tripType: req.body.tripType,
      transportMethod: req.body.transportMethod,
      romanticSetup: req.body.romanticSetup || false,
      // Future-proof craft object
      craft: req.body.craft || {
        version: 1,
        tripType: req.body.tripType,
        transportMethod: req.body.transportMethod,
        extras: {
          romanticSetup: req.body.romanticSetup || false,
          customTripType: req.body.customTripType || '',
          specialRequests: req.body.specialRequests || ''
        }
      },
      status: 'pending'
    };

    // Add appropriate ID fields based on booking type
    if (cabinId) {
      bookingData.cabinId = cabinId;
    } else if (cabinTypeId) {
      bookingData.cabinTypeId = cabinTypeId;
      if (assignedUnitId) {
        bookingData.unitId = assignedUnitId;
      }
    }

    const booking = new Booking(bookingData);
    await booking.save();

    // Populate details for response
    if (cabinId) {
      await booking.populate('cabinId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
    } else if (cabinTypeId) {
      await booking.populate('cabinTypeId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
      await booking.populate('unitId', 'unitNumber displayName');
    }

    // Get the appropriate entity for email (cabin or cabinType)
    const entityForEmail = cabin || cabinType;

    // Send emails
    try {
      // Guest confirmation email
      const guestEmail = emailService.generateBookingReceivedEmail(booking, entityForEmail);
      await emailService.sendEmail({
        to: booking.guestInfo.email,
        subject: guestEmail.subject,
        html: guestEmail.html,
        text: guestEmail.text,
        trigger: 'booking_received',
        bookingId: booking._id
      });

      // Internal notification email
      const internalEmail = emailService.generateInternalNotificationEmail(booking, entityForEmail);
      const internalEmailTo = process.env.EMAIL_TO_INTERNAL || 'ops@driftdwells.com';
      await emailService.sendEmail({
        to: internalEmailTo,
        subject: internalEmail.subject,
        html: internalEmail.html,
        text: internalEmail.text,
        trigger: 'booking_received_internal',
        bookingId: booking._id
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Don't fail the booking creation if emails fail
    }

    res.status(201).json({
      success: true,
      message: 'Booking request submitted successfully',
      data: {
        booking: booking.toObject(),
        totalNights,
        totalPrice
      }
    });

  } catch (error) {
    console.error('Booking creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating booking',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/bookings/:id - Get booking details
router.get('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Populate appropriate fields based on booking type
    if (booking.cabinId) {
      await booking.populate('cabinId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
    } else if (booking.cabinTypeId) {
      await booking.populate('cabinTypeId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
      await booking.populate('unitId', 'unitNumber displayName');
    }

    res.json({
      success: true,
      data: { booking }
    });

  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving booking',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/bookings/:id/addon-request - Submit add-on request (Jeep/ATV/Horse/Guide)
router.post('/:id/addon-request', [
  body('type').isIn(['jeep', 'atv', 'horse', 'guide']).withMessage('Valid add-on type is required'),
  body('date').optional().isISO8601().withMessage('Valid date is required'),
  body('timeWindow').optional().isString().withMessage('Time window must be a string'),
  body('pax').optional().isInt({ min: 1 }).withMessage('Number of people must be at least 1'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const { type, date, pax, notes } = req.body;

    // Store add-on request (for now, just log it - could store in booking or separate collection)
    console.log('Add-on request received:', {
      bookingId: booking._id,
      type,
      date,
      pax,
      notes,
      guestEmail: booking.guestInfo.email,
      guestName: `${booking.guestInfo.firstName} ${booking.guestInfo.lastName}`
    });

    // TODO: Store in database (could add addonRequests array to Booking model)
    // For now, just return success - admin can check logs or we can add email notification

    res.json({
      success: true,
      message: 'Add-on request submitted successfully. We will contact you soon.',
      data: {
        bookingId: booking._id,
        type,
        date,
        pax,
        notes
      }
    });

  } catch (error) {
    console.error('Add-on request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting add-on request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

