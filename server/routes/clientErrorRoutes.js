'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const ClientErrorEvent = require('../models/ClientErrorEvent');
const {
  CLIENT_ERROR_EVENT_TYPES,
  UA_CLASSES
} = require('../models/ClientErrorEvent');

const router = express.Router();

const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' }
});

const ALLOWED_BODY_KEYS = new Set([
  'eventType',
  'checkoutId',
  'stripeAmountCents',
  'priceShownCents',
  'uaClass',
  'propertyKind'
]);

function rejectUnknownFields(req, res, next) {
  const bodyObj = req.body && typeof req.body === 'object' ? req.body : {};
  const keys = Object.keys(bodyObj);
  for (const key of keys) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return res.status(400).json({ success: false, message: 'Invalid client error payload' });
    }
  }
  return next();
}

const validators = [
  body('eventType')
    .isString()
    .isIn([...CLIENT_ERROR_EVENT_TYPES])
    .withMessage('Invalid eventType'),
  body('checkoutId').optional({ nullable: true }).isString().isLength({ max: 64 }),
  body('stripeAmountCents').optional({ nullable: true }).isInt({ min: 0, max: 50_000_000 }),
  body('priceShownCents').optional({ nullable: true }).isInt({ min: 0, max: 50_000_000 }),
  body('uaClass').optional({ nullable: true }).isIn([...UA_CLASSES]),
  body('propertyKind').optional({ nullable: true }).isIn(['cabin', 'valley'])
];

router.post('/', rejectUnknownFields, validators, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Invalid client error payload' });
    }

    const eventType = String(req.body.eventType).trim();
    const checkoutId =
      typeof req.body.checkoutId === 'string' && req.body.checkoutId.trim()
        ? req.body.checkoutId.trim().slice(0, 64)
        : null;

    const stripeAmountRaw = req.body.stripeAmountCents;
    const priceShownRaw = req.body.priceShownCents;
    const stripeAmountCents =
      stripeAmountRaw == null || stripeAmountRaw === ''
        ? null
        : Math.round(Number(stripeAmountRaw));
    const priceShownCents =
      priceShownRaw == null || priceShownRaw === ''
        ? null
        : Math.round(Number(priceShownRaw));

    const uaClass =
      typeof req.body.uaClass === 'string' && UA_CLASSES.includes(req.body.uaClass)
        ? req.body.uaClass
        : null;
    const propertyKind =
      req.body.propertyKind === 'cabin' || req.body.propertyKind === 'valley'
        ? req.body.propertyKind
        : null;

    const dedupeKey = `${eventType}:${checkoutId || 'none'}`;

    try {
      await ClientErrorEvent.create({
        eventType,
        checkoutId,
        stripeAmountCents: Number.isFinite(stripeAmountCents) ? stripeAmountCents : null,
        priceShownCents: Number.isFinite(priceShownCents) ? priceShownCents : null,
        uaClass,
        propertyKind,
        dedupeKey
      });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(202).json({ success: true, duplicate: true });
      }
      throw err;
    }

    return res.status(202).json({ success: true });
  } catch (err) {
    console.error('[client-errors] ingest failed', { message: err?.message || String(err) });
    return res.status(202).json({ success: false, message: 'Client error not recorded' });
  }
});

module.exports = router;
module.exports.clientErrorLimiter = clientErrorLimiter;
