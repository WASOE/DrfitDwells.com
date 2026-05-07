const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const {
  quoteGiftVoucherPurchase,
  createGiftVoucherPaymentIntent
} = require('../services/giftVouchers/giftVoucherPaymentService');

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

const quoteValidators = [
  body('amountOriginalCents').isInt({ min: 1 }).withMessage('amountOriginalCents must be an integer'),
  body('currency').optional().isString().withMessage('currency must be a string')
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
  body('deliveryMode').optional().isIn(['email', 'postal', 'manual']).withMessage('deliveryMode must be email, postal, or manual'),
  body('recipientEmail').custom((value, { req }) => {
    const mode = req.body?.deliveryMode || 'email';
    if (mode === 'email' && (!value || !String(value).trim())) {
      throw new Error('recipientEmail is required for email delivery');
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
    const mode = req.body?.deliveryMode || 'email';
    if (mode === 'postal') {
      const address = value || {};
      if (!address.addressLine1 || !address.city || !address.postalCode || !address.country) {
        throw new Error('deliveryAddress.addressLine1, city, postalCode and country are required for postal delivery');
      }
    }
    return true;
  }),
  body('deliveryDate').optional().isISO8601().withMessage('deliveryDate must be a valid ISO date'),
  body('message').optional().isString().isLength({ max: 1000 }).withMessage('message is too long'),
  body('purchaseRequestId').optional().isString().isLength({ min: 8, max: 128 }).withMessage('purchaseRequestId is invalid'),
  body('termsAccepted').custom((value) => value === true).withMessage('termsAccepted must be true'),
  body('termsVersion').optional().isString().isLength({ max: 50 }).withMessage('termsVersion is too long')
];

function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array()
  });
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
    return res.status(500).json({ success: false, message: 'Quote failed' });
  }
});

// POST /api/gift-vouchers/create-payment-intent
router.post('/create-payment-intent', paymentIntentLimiter, paymentIntentValidators, async (req, res) => {
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
    if (['INVALID_AMOUNT_CENTS', 'AMOUNT_BELOW_MINIMUM', 'UNSUPPORTED_CURRENCY', 'MISSING_REQUIRED_FIELDS', 'TERMS_NOT_ACCEPTED', 'INVALID_PURCHASE_REQUEST_ID', 'INVALID_DELIVERY_MODE'].includes(error.code)) {
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
