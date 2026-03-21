/**
 * Stripe webhooks for payment reconciliation.
 * Primary events: refund.created, refund.updated, refund.failed (recommended by Stripe).
 * Optional: charge.refunded as extra signal.
 * Must be mounted with raw body (before express.json).
 */
const express = require('express');
const Stripe = require('stripe');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Raw body is applied at mount time in server.js for this path only
router.post(
  '/webhook',
  async (req, res) => {
    if (!stripe || !webhookSecret) {
      return res.status(503).send('Stripe webhook not configured');
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Stripe webhook signature verification failed:', err.message);
      }
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await processStripeWebhookEvent(event);
    } catch (dbErr) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Webhook handler error:', dbErr.message);
      }
      return res.status(500).send('Webhook handler error');
    }

    res.json({ received: true });
  }
);

module.exports = router;
