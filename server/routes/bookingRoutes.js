const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Booking = require('../models/Booking');
const PromoCode = require('../models/PromoCode');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const PaymentFinalization = require('../models/PaymentFinalization');
const AssignmentEngine = require('../services/assignmentEngine');
const featureFlags = require('../utils/featureFlags');
const moment = require('moment');
const {
  normalizeGuestStayRange,
  assertSingleCabinGuestStayAvailableOrThrow,
  countBlockingBlocksForSingleCabin,
  countBlockingBlocksForUnit,
  findParentCabinForCabinType
} = require('../services/publicAvailabilityService');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('../services/calendar/blockingStatusConstants');
const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');
const bookingQuoteService = require('../services/bookingQuoteService');
const promoService = require('../services/promoService');
const emailService = require('../services/emailService');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_TERMS_URL,
  LEGAL_ACCEPTANCE_CANCELLATION_URL
} = require('../config/legalAcceptance');
const Stripe = require('stripe');

const { validateId } = require('../middleware/validateId');
const { sanitizeMetaClientContext } = require('../utils/sanitizeMetaClientContext');
const {
  buildPurchaseTrackingPayload,
  populateBookingForTracking,
  trySendMetaCapiPurchase,
  processMetaPurchaseAfterConfirm
} = require('../services/bookingPurchaseTracking');

const router = express.Router();

function sanitizeAttribution(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const clip = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
  const o = {
    utmSource: clip(raw.utmSource),
    utmMedium: clip(raw.utmMedium),
    utmCampaign: clip(raw.utmCampaign),
    utmTerm: clip(raw.utmTerm),
    utmContent: clip(raw.utmContent),
    gclid: clip(raw.gclid),
    gbraid: clip(raw.gbraid),
    wbraid: clip(raw.wbraid),
    fbclid: clip(raw.fbclid),
    msclkid: clip(raw.msclkid),
    referrer: clip(raw.referrer),
    landingPath: clip(raw.landingPath)
  };
  return Object.values(o).some(Boolean) ? o : undefined;
}

const ACCEPTANCE_EMAIL_RETRY_DELAY_MS = 5000;

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const validateTransportMethod = (value, transportOptions) => {
  if (!value || value === 'Not selected') return null;
  const opts = Array.isArray(transportOptions) ? transportOptions : [];
  const match = opts.find((t) => t && t.type === value);
  return match ? value : null;
};

const bookingCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many booking requests, please slow down.' }
});

const paymentIntentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment attempts. Please try again in a minute.' }
});

const bookingQuoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many quote requests. Please try again shortly.' }
});

function buildLegalAcceptanceConfirmationEmailPayload(booking) {
  const acceptance = booking.legalAcceptance || {};
  const legalSubject = `Legal acceptance confirmation — booking ${String(booking._id)}`;
  const baseSite = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
  const termsLink = `${baseSite}${LEGAL_ACCEPTANCE_TERMS_URL}`;
  const cancellationLink = `${baseSite}${LEGAL_ACCEPTANCE_CANCELLATION_URL}`;
  const legalAcceptedAtIso = acceptance.acceptedAt ? new Date(acceptance.acceptedAt).toISOString() : new Date().toISOString();

  return {
    to: booking.guestInfo.email,
    subject: legalSubject,
    html: `
      <p>Hello ${booking.guestInfo?.firstName || 'Guest'},</p>
      <p>This email confirms legal acceptance captured for your booking.</p>
      <ul>
        <li><strong>Booking ID:</strong> ${String(booking._id)}</li>
        <li><strong>Accepted at:</strong> ${legalAcceptedAtIso}</li>
        <li><strong>Terms version:</strong> ${acceptance.termsVersion || ''}</li>
        <li><strong>Activity risk version:</strong> ${acceptance.activityRiskVersion || ''}</li>
      </ul>
      <p><strong>Accepted statements:</strong></p>
      <ol>
        <li>${acceptance.checkbox1TextSnapshot || ''}</li>
        <li>${acceptance.checkbox2TextSnapshot || ''}</li>
      </ol>
      <p>Terms PDF: <a href="${termsLink}">${termsLink}</a></p>
      <p>Cancellation policy: <a href="${cancellationLink}">${cancellationLink}</a></p>
    `,
    text: `Hello ${booking.guestInfo?.firstName || 'Guest'},

This email confirms legal acceptance captured for your booking.

Booking ID: ${String(booking._id)}
Accepted at: ${legalAcceptedAtIso}
Terms version: ${acceptance.termsVersion || ''}
Activity risk version: ${acceptance.activityRiskVersion || ''}

Accepted statements:
1) ${acceptance.checkbox1TextSnapshot || ''}
2) ${acceptance.checkbox2TextSnapshot || ''}

Terms PDF: ${termsLink}
Cancellation policy: ${cancellationLink}
`,
    trigger: 'booking_legal_acceptance',
    bookingId: booking._id
  };
}

async function sendLegalAcceptanceConfirmationWithRetry(booking) {
  const payload = buildLegalAcceptanceConfirmationEmailPayload(booking);
  const firstAttempt = await emailService.sendEmail(payload);
  if (firstAttempt.success) return;

  console.error('[booking-email] legal acceptance send failed (attempt 1)', {
    event: 'booking_legal_acceptance_send_failed',
    bookingId: String(booking._id),
    method: firstAttempt.method,
    error: firstAttempt.error
  });

  await new Promise((resolve) => setTimeout(resolve, ACCEPTANCE_EMAIL_RETRY_DELAY_MS));
  const secondAttempt = await emailService.sendEmail(payload);
  if (!secondAttempt.success) {
    console.error('[booking-email] legal acceptance send failed (attempt 2)', {
      event: 'booking_legal_acceptance_send_failed_retry',
      bookingId: String(booking._id),
      method: secondAttempt.method,
      error: secondAttempt.error,
      retryDelayMs: ACCEPTANCE_EMAIL_RETRY_DELAY_MS
    });
  }
}

const purchaseTrackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' }
});

// GET /api/bookings/config - Public config for booking flow (e.g. stripeEnabled)
router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      stripeEnabled: !!stripe
    }
  });
});

const bookingQuoteBodyValidators = [
  body('cabinId').optional().isMongoId().withMessage('Valid cabin ID is required if provided'),
  body('cabinTypeId').optional().isMongoId().withMessage('Valid cabin type ID is required if provided'),
  body('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  body('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  body('adults').isInt({ min: 1, max: 10 }).withMessage('Adults must be between 1 and 10'),
  body('children').optional().isInt({ min: 0, max: 10 }).withMessage('Children must be between 0 and 10'),
  body('experienceKeys').optional().isArray().withMessage('experienceKeys must be an array'),
  body('promoCode').optional().isString().isLength({ max: 40 }).withMessage('promoCode is too long')
];

// POST /api/bookings/quote — server-owned price + optional promo (display / PI / booking must match)
router.post('/quote', bookingQuoteLimiter, bookingQuoteBodyValidators, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const result = await bookingQuoteService.buildPublicBookingQuote(req.body);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        errors: result.errors
      });
    }

    const { subtotalPrice, discountAmount, totalPrice, promo } = result;
    return res.json({
      success: true,
      data: {
        subtotalPrice,
        discountAmount,
        totalPrice,
        promo
      }
    });
  } catch (err) {
    console.error('Booking quote error:', err);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? err.message : 'Quote failed'
    });
  }
});

// POST /api/bookings/create-payment-intent - Create Stripe PaymentIntent for cabin booking
router.post('/create-payment-intent', paymentIntentLimiter, bookingQuoteBodyValidators, async (req, res) => {
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

    const { cabinId, cabinTypeId, experienceKeys = [] } = req.body;

    const result = await bookingQuoteService.buildPublicBookingQuote(req.body);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        errors: result.errors
      });
    }

    const {
      totalPrice,
      subtotalPrice,
      discountAmount,
      entityType,
      checkInDate,
      checkOutDate,
      appliedPromoCode
    } = result;

    if (totalPrice < 0.5) {
      return res.status(400).json({
        success: false,
        message: 'Invalid price'
      });
    }

    const currency = (process.env.STRIPE_CURRENCY || 'eur').toLowerCase();
    const amountCents = Math.round(totalPrice * 100);
    const subtotalCents = Math.round(subtotalPrice * 100);
    const discountAmountCents = Math.round(discountAmount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        entityType,
        cabinId: cabinId ? cabinId.toString() : '',
        cabinTypeId: cabinTypeId ? cabinTypeId.toString() : '',
        checkIn: checkInDate.toISOString(),
        checkOut: checkOutDate.toISOString(),
        amountCents: String(amountCents),
        experienceKeys: JSON.stringify(experienceKeys || []),
        transportMethod: String(req.body.transportMethod || ''),
        romanticSetup: String(!!req.body.romanticSetup),
        promoCode: appliedPromoCode || '',
        subtotalCents: String(subtotalCents),
        discountAmountCents: String(discountAmountCents),
        finalTotalCents: String(amountCents)
      }
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
router.post('/', bookingCreateLimiter, [
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
  body('legalAcceptance').isObject().withMessage('legalAcceptance is required'),
  body('legalAcceptance.acceptedTermsAndCancellation')
    .custom((value) => value === true)
    .withMessage('Terms and cancellation acceptance is required'),
  body('legalAcceptance.acceptedActivityRisk')
    .custom((value) => value === true)
    .withMessage('Activity risk acceptance is required'),
  body('legalAcceptance.termsVersion')
    .equals(LEGAL_ACCEPTANCE_TERMS_VERSION)
    .withMessage('Invalid terms version'),
  body('legalAcceptance.activityRiskVersion')
    .equals(LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION)
    .withMessage('Invalid activity risk version'),
  body('legalAcceptance.checkbox1TextSnapshot')
    .equals(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT)
    .withMessage('Invalid checkbox 1 text'),
  body('legalAcceptance.checkbox2TextSnapshot')
    .equals(LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT)
    .withMessage('Invalid checkbox 2 text'),
  body('legalAcceptance.locale').optional().isString().isLength({ max: 50 }).withMessage('locale is too long'),
  body('specialRequests').optional().isLength({ max: 500 }).withMessage('Special requests cannot exceed 500 characters'),
  body('promoCode').optional().isString().isLength({ max: 40 }).withMessage('promoCode is too long')
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

    const { cabinId, cabinTypeId, unitId, checkIn, checkOut, adults, children = 0, guestInfo, specialRequests, paymentIntentId, legalAcceptance } = req.body;

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

    if (checkInDate < normalizeDateToSofiaDayStart(new Date())) {
      return res.status(400).json({
        success: false,
        message: 'Check-in date cannot be in the past'
      });
    }

    const totalGuests = parseInt(adults) + parseInt(children);
    let cabin = null;
    let cabinType = null;
    let assignedUnitId = unitId || null;
    let parentCabinForUnit = null;
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

      const totalNightsCabin = moment(checkOutDate).diff(moment(checkInDate), 'days');
      if (totalNightsCabin < (cabin.minNights || 1)) {
        return res.status(400).json({
          success: false,
          message: `This cabin requires a minimum stay of ${cabin.minNights || 1} night${(cabin.minNights || 1) !== 1 ? 's' : ''}`
        });
      }

      try {
        await assertSingleCabinGuestStayAvailableOrThrow(cabin, checkIn, checkOut);
      } catch (e) {
        if (e.code === 'NOT_AVAILABLE') {
          return res.status(409).json({
            success: false,
            message: 'This cabin is not available for the selected dates'
          });
        }
        throw e;
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

      const totalNightsType = moment(checkOutDate).diff(moment(checkInDate), 'days');
      if (totalNightsType < (cabinType.minNights || 1)) {
        return res.status(400).json({
          success: false,
          message: `This cabin type requires a minimum stay of ${cabinType.minNights || 1} night${(cabinType.minNights || 1) !== 1 ? 's' : ''}`
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

      parentCabinForUnit = await findParentCabinForCabinType(cabinTypeId);
    }

    // Price + promo via bookingQuoteService (must match PI if paymentIntentId provided)
    const entity = cabin || cabinType;
    const experienceKeys = Array.isArray(req.body.experienceKeys) ? req.body.experienceKeys : [];
    const quote = await bookingQuoteService.computeQuoteFromEntity(
      entity,
      checkInDate,
      checkOutDate,
      parseInt(adults, 10),
      parseInt(children, 10),
      experienceKeys,
      req.body.transportMethod,
      req.body.romanticSetup,
      req.body.promoCode
    );
    const { subtotalPrice, discountAmount, totalPrice, promoSnapshot, appliedPromoCode } = quote;

    if (appliedPromoCode) {
      const pv = await promoService.resolvePromoDocument(appliedPromoCode);
      if (!pv.doc || pv.invalidReason) {
        return res.status(400).json({
          success: false,
          message: pv.invalidReason || 'Promo code is no longer valid.'
        });
      }
    }

    let stripePaymentVerified = false;
    // Verify Stripe payment if paymentIntentId is provided
    if (paymentIntentId && stripe) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status !== 'succeeded') {
          return res.status(402).json({
            success: false,
            message: `Payment not completed (status: ${pi.status})`
          });
        }
        const meta = pi.metadata || {};
        const metaCabinId = meta.cabinId;
        const metaCabinTypeId = meta.cabinTypeId;
        const metaCheckIn = meta.checkIn;
        const metaCheckOut = meta.checkOut;
        if (cabinId && (!metaCabinId || metaCabinId !== cabinId.toString())) {
          return res.status(400).json({ success: false, message: 'Payment was not created for this cabin' });
        }
        if (cabinTypeId && (!metaCabinTypeId || metaCabinTypeId !== cabinTypeId.toString())) {
          return res.status(400).json({ success: false, message: 'Payment was not created for this stay type' });
        }
        if (metaCheckIn && metaCheckIn !== checkInDate.toISOString()) {
          return res.status(400).json({ success: false, message: 'Payment dates do not match' });
        }
        if (metaCheckOut && metaCheckOut !== checkOutDate.toISOString()) {
          return res.status(400).json({ success: false, message: 'Payment dates do not match' });
        }
        const promoVerify = bookingQuoteService.verifyPaymentIntentPromoMetadata(pi, quote);
        if (!promoVerify.ok) {
          return res.status(400).json({ success: false, message: promoVerify.message });
        }
        stripePaymentVerified = true;
      } catch (stripeErr) {
        return res.status(400).json({
          success: false,
          message: 'Could not verify payment'
        });
      }
    }

    const attribution = sanitizeAttribution(req.body.attribution);
    const metaClientContext = sanitizeMetaClientContext(req.body.metaClientContext);
    let initialStatus = 'pending';
    if (stripePaymentVerified) {
      initialStatus = 'confirmed';
    } else if (!paymentIntentId && process.env.BOOKING_CONFIRM_WITHOUT_STRIPE === '1') {
      initialStatus = 'confirmed';
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
      subtotalPrice,
      discountAmount: discountAmount || 0,
      promoCode: appliedPromoCode || null,
      promoSnapshot: promoSnapshot || null,
      tripType: typeof req.body.tripType === 'string' ? req.body.tripType.trim().slice(0, 50) : undefined,
      transportMethod: validateTransportMethod(req.body.transportMethod, transportOptions),
      romanticSetup: !!req.body.romanticSetup,
      craft: {
        version: 1,
        tripType: typeof req.body.tripType === 'string' ? req.body.tripType.trim().slice(0, 50) : '',
        transportMethod: validateTransportMethod(req.body.transportMethod, transportOptions) || '',
        extras: {
          romanticSetup: !!req.body.romanticSetup,
          customTripType: typeof req.body.customTripType === 'string' ? req.body.customTripType.trim().slice(0, 100) : '',
          specialRequests: typeof req.body.specialRequests === 'string' ? req.body.specialRequests.trim().slice(0, 500) : ''
        }
      },
      status: initialStatus,
      isProductionSafe: true,
      isTest: false,
      stripePaymentIntentId: stripePaymentVerified ? String(paymentIntentId).trim() : null,
      provenance: {
        source: 'guest_portal',
        intakeRevision: 1,
        createdByRoute: 'POST /api/bookings'
      },
      legalAcceptance: {
        termsVersion: legalAcceptance.termsVersion,
        activityRiskVersion: legalAcceptance.activityRiskVersion,
        acceptedAt: new Date(),
        firstName: String(guestInfo.firstName || '').trim(),
        lastName: String(guestInfo.lastName || '').trim(),
        ip: String(req.ip || '').trim() || null,
        userAgent: String(req.get('user-agent') || '').trim() || null,
        locale: typeof legalAcceptance.locale === 'string' && legalAcceptance.locale.trim()
          ? legalAcceptance.locale.trim().slice(0, 50)
          : (typeof req.get('accept-language') === 'string' && req.get('accept-language').trim()
            ? req.get('accept-language').trim().slice(0, 50)
            : null),
        checkbox1TextSnapshot: legalAcceptance.checkbox1TextSnapshot,
        checkbox2TextSnapshot: legalAcceptance.checkbox2TextSnapshot
      }
    };

    if (attribution) {
      bookingData.attribution = attribution;
    }
    if (metaClientContext) {
      bookingData.metaClientContext = metaClientContext;
    }

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

    // Race-condition guard: overlapping booking saved concurrently, or block created after our read
    if (cabinId) {
      const overlaps = await Booking.countDocuments({
        cabinId,
        _id: { $ne: booking._id },
        status: { $in: BLOCKING_BOOKING_STATUSES },
        checkIn: { $lt: checkOutDate },
        checkOut: { $gt: checkInDate }
      });
      const blockRace = await countBlockingBlocksForSingleCabin(cabinId, checkInDate, checkOutDate);
      if (overlaps > 0 || blockRace > 0) {
        await Booking.deleteOne({ _id: booking._id });
        return res.status(409).json({
          success: false,
          message: 'This cabin was just booked by another guest. Please choose different dates.'
        });
      }
    }
    if (assignedUnitId) {
      const overlaps = await Booking.countDocuments({
        unitId: assignedUnitId,
        _id: { $ne: booking._id },
        status: { $in: BLOCKING_BOOKING_STATUSES },
        checkIn: { $lt: checkOutDate },
        checkOut: { $gt: checkInDate }
      });
      let blockRace = 0;
      if (parentCabinForUnit) {
        blockRace = await countBlockingBlocksForUnit(parentCabinForUnit._id, assignedUnitId, checkInDate, checkOutDate);
      }
      if (overlaps > 0 || blockRace > 0) {
        await Booking.deleteOne({ _id: booking._id });
        return res.status(409).json({
          success: false,
          message: 'This unit was just booked by another guest. Please choose different dates.'
        });
      }
    }

    if (initialStatus === 'confirmed' && quote.appliedPromoCode) {
      const inc = await PromoCode.updateOne(
        {
          code: quote.appliedPromoCode,
          $or: [
            { usageLimit: null },
            { usageLimit: { $exists: false } },
            { $expr: { $lt: [{ $ifNull: ['$usageCount', 0] }, '$usageLimit'] } }
          ]
        },
        { $inc: { usageCount: 1 } }
      );
      if (inc.matchedCount === 0) {
        await Booking.deleteOne({ _id: booking._id });
        return res.status(409).json({
          success: false,
          message: 'This promo code is no longer available for new bookings.'
        });
      }
    }

    // Populate details for response
    if (cabinId) {
      await booking.populate('cabinId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
    } else if (cabinTypeId) {
      await booking.populate('cabinTypeId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
      await booking.populate('unitId', 'unitNumber displayName');
    }

    // Get the appropriate entity for email (cabin or cabinType)
    const entityForEmail = cabin || cabinType;

    const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
    res.status(201).json({
      success: true,
      message: 'Booking request submitted successfully',
      data: {
        booking: booking.toObject(),
        totalNights,
        totalPrice
      }
    });

    // Decouple SMTP latency from the HTTP response; booking is already persisted.
    void (async () => {
      try {
        const guestTemplateKey =
          initialStatus === 'confirmed'
            ? bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED
            : bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED;
        const guestOutcome = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
          booking,
          templateKey: guestTemplateKey,
          overrideRecipient: null,
          lifecycleSource: 'automatic',
          actorContext: null,
          entity: entityForEmail
        });
        if (!guestOutcome.success) {
          console.error(
            initialStatus === 'confirmed'
              ? '[booking-email] Guest booking_confirmed not sent:'
              : '[booking-email] Guest booking_received not sent:',
            {
              bookingId: String(booking._id),
              method: guestOutcome.sendResult?.method,
              error: guestOutcome.sendResult?.error
            }
          );
        }

        const internalOutcome = await bookingLifecycleEmailService.sendInternalNewBookingNotification({
          booking,
          entity: entityForEmail,
          lifecycleSource: 'automatic'
        });
        if (!internalOutcome.success) {
          console.error('[booking-email] Internal notification not sent:', {
            bookingId: String(booking._id),
            method: internalOutcome.sendResult?.method,
            error: internalOutcome.sendResult?.error
          });
        }

        await sendLegalAcceptanceConfirmationWithRetry(booking);
      } catch (emailError) {
        console.error('[booking-email] Async delivery error:', emailError);
      }
    })();

    if (initialStatus === 'confirmed') {
      void processMetaPurchaseAfterConfirm(String(booking._id), req).catch((err) => {
        console.error('[meta-purchase] Post-confirm CAPI error:', err);
      });
    }

  } catch (error) {
    console.error('Booking creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating booking',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/bookings/refund-status - Get refund status for a payment intent
router.get('/refund-status', async (req, res) => {
  try {
    const { paymentIntentId, email } = req.query;
    if (!paymentIntentId || !email) {
      return res.status(400).json({ success: false, message: 'paymentIntentId and email are required' });
    }
    const record = await PaymentFinalization.findOne({ paymentIntentId }).populate('cabinId', 'name');
    if (!record || record.guestEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(404).json({ success: false, message: 'Refund record not found' });
    }
    res.json({
      success: true,
      data: {
        status: record.status,
        amountCents: record.amountCents,
        currency: record.currency,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        checkInDateOnly: formatSofiaDateOnly(record.checkIn),
        checkOutDateOnly: formatSofiaDateOnly(record.checkOut),
        cabinName: record.cabinId?.name || null
      }
    });
  } catch (error) {
    console.error('Refund status error:', error);
    res.status(500).json({ success: false, message: 'Error retrieving refund status' });
  }
});

// POST /api/bookings/:id/purchase-tracking — verified guest only; browser payload + optional Meta CAPI retry (primary send is on booking confirm)
router.post('/:id/purchase-tracking', purchaseTrackingLimiter, validateId('id'), async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const bookingEmail = (booking.guestInfo?.email || '').trim().toLowerCase();
    if (!bookingEmail || bookingEmail !== email) {
      return res.status(403).json({ success: false, message: 'Email does not match this booking' });
    }

    if (booking.status !== 'confirmed') {
      return res.status(403).json({
        success: false,
        code: 'NOT_ELIGIBLE',
        message: 'Booking is not in a paid-confirmed state'
      });
    }

    await populateBookingForTracking(booking);
    const payload = buildPurchaseTrackingPayload(booking);

    if (booking.metaPurchaseSentAt) {
      return res.json({
        success: true,
        data: {
          ...payload,
          meta_capi_already_sent: true
        }
      });
    }

    const capi = await trySendMetaCapiPurchase(booking, {
      clientIp: req.ip,
      userAgent: req.get('user-agent')
    });

    if (!capi.skipped && !capi.ok) {
      console.error('[purchase-tracking] Meta CAPI failed', capi);
    }

    return res.json({
      success: true,
      data: {
        ...payload,
        meta_capi_sent: !capi.skipped && !!capi.ok,
        meta_capi_skipped: !!capi.skipped,
        meta_capi_will_retry: !capi.ok && !capi.skipped
      }
    });
  } catch (error) {
    console.error('Purchase tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing purchase tracking',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/bookings/:id - Get booking details (requires guest email for PII access)
router.get('/:id', validateId('id'), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.cabinId) {
      await booking.populate('cabinId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
    } else if (booking.cabinTypeId) {
      await booking.populate('cabinTypeId', 'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs');
      await booking.populate('unitId', 'unitNumber displayName');
    }

    const bookingObj = booking.toObject();
    const { email } = req.query;
    const isOwner = email && email.toLowerCase() === (bookingObj.guestInfo?.email || '').toLowerCase();

    if (!isOwner && bookingObj.guestInfo) {
      const e = bookingObj.guestInfo.email || '';
      const [local, domain] = e.split('@');
      bookingObj.guestInfo.email = local ? `${local.slice(0, 3)}***@${domain || ''}` : '';
      const p = bookingObj.guestInfo.phone || '';
      bookingObj.guestInfo.phone = p.length > 4 ? `***${p.slice(-4)}` : '****';
    }

    if (bookingObj.checkIn) {
      bookingObj.checkInDateOnly = formatSofiaDateOnly(bookingObj.checkIn);
    }
    if (bookingObj.checkOut) {
      bookingObj.checkOutDateOnly = formatSofiaDateOnly(bookingObj.checkOut);
    }

    res.json({
      success: true,
      data: { booking: bookingObj }
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
router.post('/:id/addon-request', validateId('id'), [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required to verify booking ownership'),
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

    const providedEmail = (req.body.email || '').toLowerCase();
    const bookingEmail = (booking.guestInfo?.email || '').toLowerCase();
    if (providedEmail !== bookingEmail) {
      return res.status(403).json({
        success: false,
        message: 'Email does not match this booking'
      });
    }

    const { type, date, pax, notes } = req.body;

    if (process.env.NODE_ENV === 'development') {
      console.log('Add-on request received:', { bookingId: booking._id, type, date, pax, notes });
    }

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

