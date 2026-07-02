const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const {
  quoteGiftVoucherPurchase,
  createGiftVoucherPaymentIntent
} = require('../services/giftVouchers/giftVoucherPaymentService');
const { attachPaymentFlowMonitor } = require('../services/ops/paymentFlowMonitorService');
const {
  CARD_OCCASIONS,
  CARD_TEMPLATE_IDS,
  CARD_LOCALES,
  DELIVERY_OPTIONS,
  MESSAGE_MAX_LENGTH
} = require('../services/giftVouchers/giftVoucherCustomizationConstants');

const GIFT_VOUCHER_PAYMENT_INTENT_ROUTE = '/api/gift-vouchers/create-payment-intent';

const router = express.Router();

const quoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many quote requests. Please try again shortly.' }
});

const paymentIntentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment attempts. Please try again in a minute.' }
});

function isPostalPurchase(body = {}) {
  if (body.deliveryOption === 'postal') return true;
  return (body.deliveryMode || 'email') === 'postal';
}

function recipientEmailRequiredOnRequest(body = {}) {
  if (body.deliveryOption === 'send_to_buyer' || body.deliveryOption === 'postal') return false;
  if (body.deliveryOption === 'recipient_now' || body.deliveryOption === 'scheduled') return true;
  return (body.deliveryMode || 'email') === 'email';
}

const quoteValidators = [
  body('amountOriginalCents').isInt({ min: 1 }).withMessage('amountOriginalCents must be an integer'),
  body('currency').optional().isString().withMessage('currency must be a string'),
  body('deliveryMode').optional().isIn(['email', 'postal']).withMessage('deliveryMode must be email or postal'),
  body('deliveryOption').optional().isIn(DELIVERY_OPTIONS).withMessage('deliveryOption is invalid')
];

const paymentIntentValidators = [
  body('amountOriginalCents').isInt({ min: 1 }).withMessage('amountOriginalCents must be an integer'),
  body('currency').optional().isString().withMessage('currency must be a string'),
  body('buyerName').trim().isLength({ min: 1, max: 120 }).withMessage('buyerName is required'),
  body('buyerEmail').isEmail().normalizeEmail().withMessage('buyerEmail must be valid'),
  body('recipientName').trim().isLength({ min: 1, max: 120 }).withMessage('recipientName is required'),
  body('recipientEmail')
    .optional({ checkFalsy: true })
    .isEmail()
    .normalizeEmail()
    .withMessage('recipientEmail must be valid'),
  body('deliveryMode').optional().isIn(['email', 'postal']).withMessage('deliveryMode must be email or postal'),
  body('deliveryOption').optional().isIn(DELIVERY_OPTIONS).withMessage('deliveryOption is invalid'),
  body('cardOccasion').optional({ checkFalsy: true }).isIn(CARD_OCCASIONS).withMessage('cardOccasion is invalid'),
  body('cardTemplateId').optional({ checkFalsy: true }).isIn(CARD_TEMPLATE_IDS).withMessage('cardTemplateId is invalid'),
  body('cardLocale').optional({ checkFalsy: true }).isIn(CARD_LOCALES).withMessage('cardLocale is invalid'),
  body('recipientEmail').custom((value, { req }) => {
    if (!recipientEmailRequiredOnRequest(req.body)) return true;
    if (!value || !String(value).trim()) {
      throw new Error('recipientEmail is required for this delivery option');
    }
    return true;
  }),
  body('deliveryAddress.addressLine1')
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isLength({ max: 200 })
    .withMessage('deliveryAddress.addressLine1 is invalid'),
  body('deliveryAddress.addressLine2')
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isLength({ max: 200 })
    .withMessage('deliveryAddress.addressLine2 is invalid'),
  body('deliveryAddress.city')
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isLength({ max: 120 })
    .withMessage('deliveryAddress.city is invalid'),
  body('deliveryAddress.postalCode')
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isLength({ max: 40 })
    .withMessage('deliveryAddress.postalCode is invalid'),
  body('deliveryAddress.country')
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isLength({ max: 120 })
    .withMessage('deliveryAddress.country is invalid'),
  body('deliveryAddress').custom((value, { req }) => {
    if (!isPostalPurchase(req.body)) return true;
    const address = value || {};
    if (!address.addressLine1 || !address.city || !address.postalCode || !address.country) {
      throw new Error('deliveryAddress.addressLine1, city, postalCode and country are required for postal delivery');
    }
    return true;
  }),
  body('deliveryDate')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage('deliveryDate must be a valid ISO date'),
  body('message')
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isLength({ max: MESSAGE_MAX_LENGTH })
    .withMessage('message is too long'),
  body('purchaseRequestId').optional().isString().isLength({ min: 8, max: 128 }).withMessage('purchaseRequestId is invalid'),
  body('termsAccepted').custom((value) => value === true).withMessage('termsAccepted must be true'),
  body('termsVersion').optional().isString().isLength({ max: 50 }).withMessage('termsVersion is too long')
];

const DOMAIN_BAD_REQUEST_CODES = new Set([
  'INVALID_AMOUNT_CENTS',
  'AMOUNT_BELOW_MINIMUM',
  'UNSUPPORTED_CURRENCY',
  'MISSING_REQUIRED_FIELDS',
  'TERMS_NOT_ACCEPTED',
  'INVALID_PURCHASE_REQUEST_ID',
  'INVALID_DELIVERY_MODE',
  'INVALID_DELIVERY_OPTION',
  'INVALID_CUSTOMIZATION_FIELD',
  'SCHEDULED_DELIVERY_NOT_ENABLED',
  'MISSING_SCHEDULED_DELIVERY_DATE',
  'INVALID_SCHEDULED_DELIVERY_DATE'
]);

function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array()
  });
}

function handleDomainError(res, error, fallbackMessage) {
  if (DOMAIN_BAD_REQUEST_CODES.has(error.code)) {
    return res.status(400).json({ success: false, message: error.message, code: error.code });
  }
  return res.status(500).json({ success: false, message: fallbackMessage });
}

// POST /api/gift-vouchers/quote
router.post('/quote', quoteLimiter, quoteValidators, async (req, res) => {
  try {
    const fail = sendValidationErrors(req, res);
    if (fail) return fail;
    const result = quoteGiftVoucherPurchase(req.body);
    return res.json({ success: true, data: result });
  } catch (error) {
    if (['INVALID_AMOUNT_CENTS', 'AMOUNT_BELOW_MINIMUM', 'UNSUPPORTED_CURRENCY'].includes(error.code)) {
      return res.status(400).json({ success: false, message: error.message, code: error.code });
    }
    return handleDomainError(res, error, 'Quote failed');
  }
});

// POST /api/gift-vouchers/create-payment-intent
router.post('/create-payment-intent', paymentIntentLimiter, paymentIntentValidators, async (req, res) => {
  attachPaymentFlowMonitor(res, GIFT_VOUCHER_PAYMENT_INTENT_ROUTE);
  try {
    const fail = sendValidationErrors(req, res);
    if (fail) return fail;
    const result = await createGiftVoucherPaymentIntent(req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.code === 'PURCHASE_REQUEST_CONFLICT') {
      return res.status(409).json({ success: false, message: error.message, code: error.code });
    }
    if (error.code === 'PURCHASE_REQUEST_CLOSED') {
      return res.status(409).json({ success: false, message: error.message, code: error.code });
    }
    if (DOMAIN_BAD_REQUEST_CODES.has(error.code)) {
      return res.status(400).json({ success: false, message: error.message, code: error.code });
    }
    if (error.code === 'PAYMENT_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: error.message, code: error.code });
    }
    if (error.code === 'PAYMENT_INTENT_INIT_FAILED') {
      return res.status(502).json({ success: false, message: 'Unable to initialize payment', code: error.code });
    }
    return res.status(500).json({ success: false, message: 'Payment setup failed' });
  }
});

module.exports = router;
