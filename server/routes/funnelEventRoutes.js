'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const {
  isFunnelTrackingEnabled,
  recordClientFunnelEvent
} = require('../services/conversion/funnelEventService');
const { isClientEventType } = require('../services/conversion/funnelEventConstants');

const router = express.Router();

const funnelEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' }
});

const clientEventValidators = [
  body('eventType')
    .isString()
    .isLength({ min: 1, max: 64 })
    .custom((value) => isClientEventType(value))
    .withMessage('Invalid eventType'),
  body('sessionKey').isString().isLength({ min: 1, max: 120 }),
  body('visitorKey').optional().isString().isLength({ max: 120 }),
  body('cabinId').optional().isString().isLength({ max: 64 }),
  body('cabinTypeId').optional().isString().isLength({ max: 64 }),
  body('checkInDateOnly').optional().isString().isLength({ max: 10 }),
  body('checkOutDateOnly').optional().isString().isLength({ max: 10 }),
  body('adults').optional().isInt({ min: 0, max: 10 }),
  body('children').optional().isInt({ min: 0, max: 10 }),
  body('searchResultCount').optional().isInt({ min: 0, max: 500 }),
  body('propertyKind').optional().isIn(['cabin', 'valley']),
  body('attribution').optional().isObject()
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

    const result = await recordClientFunnelEvent(req.body);
    if (result.skipped) {
      return res.status(202).json({ success: true, skipped: true });
    }
    if (result.duplicate) {
      return res.status(202).json({ success: true, duplicate: true });
    }
    return res.status(202).json({ success: true });
  } catch (err) {
    if (err?.code === 'VALIDATION_ERROR' || err?.code === 'INVALID_EVENT_TYPE') {
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
