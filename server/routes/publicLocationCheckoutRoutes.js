const express = require('express');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');
const { createDomainError } = require('../services/ops/domain/errors');
const {
  createLocationCheckoutPaymentIntent,
  finalizeLocationCheckout
} = require('../services/locationCheckout/locationCheckoutService');

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many checkout requests. Please try again shortly.' }
});

function handleCheckoutError(err, res) {
  if (err?.code === 'validation') {
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
  console.error('Location checkout error:', err);
  return res.status(500).json({ success: false, message: 'Location checkout failed' });
}

router.post('/location-checkout/create-payment-intent', checkoutLimiter, async (req, res) => {
  try {
    const result = await createLocationCheckoutPaymentIntent(req.body, { stripe });
    return res.json({ success: true, data: result });
  } catch (err) {
    return handleCheckoutError(err, res);
  }
});

router.post('/location-checkout/finalize', checkoutLimiter, async (req, res) => {
  try {
    const result = await finalizeLocationCheckout(req.body, { stripe });
    return res.json({ success: true, data: result });
  } catch (err) {
    return handleCheckoutError(err, res);
  }
});

module.exports = router;
