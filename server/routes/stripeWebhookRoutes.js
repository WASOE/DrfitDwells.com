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

function logWebhookAudit(fields) {
  const base = {
    source: 'stripe-webhook',
    route: fields.route || null,
    eventId: fields.eventId || null,
    eventType: fields.eventType || null,
    signatureVerified: Boolean(fields.signatureVerified),
    httpStatus: fields.httpStatus,
    processingResult: fields.processingResult || 'unknown',
    error: fields.error || null
  };
  const level = base.httpStatus >= 400 ? 'warn' : 'info';
  console[level](JSON.stringify(base));
}

// Raw body is applied at mount time in server.js for this path only
const handleStripeWebhook = async (req, res) => {
  const route = req.originalUrl || req.path || null;
  if (!stripe || !webhookSecret) {
    logWebhookAudit({
      route,
      signatureVerified: false,
      httpStatus: 503,
      processingResult: 'failed',
      error: 'stripe-webhook-not-configured'
    });
    return res.status(503).send('Stripe webhook not configured');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logWebhookAudit({
      route,
      signatureVerified: false,
      httpStatus: 400,
      processingResult: 'failed',
      error: err.message
    });
    if (process.env.NODE_ENV === 'development') {
      console.warn('Stripe webhook signature verification failed:', err.message);
    }
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await processStripeWebhookEvent(event);
  } catch (dbErr) {
    logWebhookAudit({
      route,
      eventId: event.id,
      eventType: event.type,
      signatureVerified: true,
      httpStatus: 500,
      processingResult: 'failed',
      error: dbErr.message
    });
    if (process.env.NODE_ENV === 'development') {
      console.error('Webhook handler error:', dbErr.message);
    }
    return res.status(500).send('Webhook handler error');
  }

  logWebhookAudit({
    route,
    eventId: event.id,
    eventType: event.type,
    signatureVerified: true,
    httpStatus: 200,
    processingResult: 'processed'
  });
  return res.json({ received: true });
};

// Keep both paths active to avoid dashboard/config drift causing 404s.
router.post('/', handleStripeWebhook);
router.post('/webhook', handleStripeWebhook);

module.exports = router;
