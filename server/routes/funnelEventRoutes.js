'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const {
  isFunnelTrackingEnabled,
  recordClientFunnelEvent
} = require('../services/conversion/funnelEventService');
const { isClientEventType, isServerOnlyEventType } = require('../services/conversion/funnelEventConstants');

const router = express.Router();

const funnelEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' }
});

const clientEventValidators = [
  body('eventType')
    .isString()
    .isLength({ min: 1, max: 64 })
    .custom((value) => {
      if (isServerOnlyEventType(value) && value !== 'checkout_started') return false;
      if (
        [
          'quote_created',
          'payment_succeeded',
          'payment_started',
          'payment_failed',
          'payment_cancelled',
          'booking_created',
          'booking_confirmed',
          'quote_received',
          'booking_converted'
        ].includes(value)
      ) {
        return false;
      }
      return isClientEventType(value);
    })
    .withMessage('Invalid eventType'),
  body('eventId').isUUID(),
  body('sessionKey').isString().isLength({ min: 1, max: 120 }),
  body('visitorKey').optional().isString().isLength({ max: 120 }),
  body('anonymousId').optional().isString().isLength({ max: 120 }),
  body('cabinId').optional().isString().isLength({ max: 64 }),
  body('cabinTypeId').optional().isString().isLength({ max: 64 }),
  body('unitId').optional().isString().isLength({ max: 64 }),
  body('locationId').optional().isString().isLength({ max: 64 }),
  body('checkInDateOnly').optional().isString().isLength({ max: 10 }),
  body('checkOutDateOnly').optional().isString().isLength({ max: 10 }),
  body('adults').optional().isInt({ min: 0, max: 20 }),
  body('children').optional().isInt({ min: 0, max: 20 }),
  body('pets').optional().isInt({ min: 0, max: 10 }),
  body('searchResultCount').optional().isInt({ min: 0, max: 500 }),
  body('checkoutId').optional().isString().isLength({ max: 64 }),
  body('quoteId').optional().isString().isLength({ max: 64 }),
  body('propertyKind').optional().isIn(['cabin', 'valley']),
  body('pagePath').optional().isString().isLength({ max: 1000 }),
  body('pageTitle').optional().isString().isLength({ max: 200 }),
  body('routeName').optional().isString().isLength({ max: 80 }),
  body('occurredAt').optional().isISO8601(),
  body('attribution').optional().isObject(),
  body('firstTouch').optional().isObject(),
  body('lastTouch').optional().isObject()
];

router.post('/', clientEventValidators, async (req, res) => {
  if (!isFunnelTrackingEnabled()) {
    return res.status(202).json({ success: true, skipped: true });
  }

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Invalid funnel event', errors: errors.array() });
    }

    const result = await recordClientFunnelEvent(req.body, { req });
    if (result.skipped) {
      return res.status(202).json({ success: true, skipped: true });
    }
    if (result.duplicate) {
      return res.status(202).json({ success: true, duplicate: true });
    }
    return res.status(202).json({ success: true });
  } catch (err) {
    if (err?.code === 'VALIDATION_ERROR' || err?.code === 'INVALID_EVENT_TYPE' || err?.code === 'SERVER_ONLY_EVENT') {
      return res.status(400).json({ success: false, message: 'Invalid funnel event' });
    }
    if (err?.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(400).json({ success: false, message: 'Invalid funnel event' });
    }
    console.error('[funnel-events] ingest failed', { message: err?.message || String(err) });
    return res.status(202).json({ success: false, message: 'Funnel event not recorded' });
  }
});

module.exports = router;
module.exports.funnelEventLimiter = funnelEventLimiter;
