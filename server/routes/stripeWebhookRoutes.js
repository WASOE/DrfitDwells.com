/**
 * Stripe webhooks for payment reconciliation.
 * Primary events: refund.created, refund.updated, refund.failed (recommended by Stripe).
 * Optional: charge.refunded as extra signal.
 * Must be mounted with raw body (before express.json).
 */
const express = require('express');
const Stripe = require('stripe');
const PaymentFinalization = require('../models/PaymentFinalization');

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
      const getPaymentIntentId = (obj) => {
        const pi = obj.payment_intent;
        return typeof pi === 'string' ? pi : pi?.id;
      };

      const updateRefunded = async (paymentIntentId) => {
        if (!paymentIntentId) return;
        const result = await PaymentFinalization.updateOne(
          { paymentIntentId, status: { $in: ['refund_pending', 'finalization_failed'] } },
          { $set: { status: 'refunded', updatedAt: new Date() } }
        );
        if (result.modifiedCount > 0 && process.env.NODE_ENV !== 'development') {
          console.info('[STRIPE_WEBHOOK] PaymentFinalization updated to refunded', { paymentIntentId });
        }
      };

      const updateRefundFailed = async (paymentIntentId, refundError) => {
        if (!paymentIntentId) return;
        const update = { status: 'refund_failed', updatedAt: new Date() };
        if (refundError) update.refundError = refundError;
        await PaymentFinalization.updateOne(
          { paymentIntentId },
          { $set: update }
        );
      };

      if (event.type === 'refund.created') {
        const refund = event.data.object;
        const paymentIntentId = getPaymentIntentId(refund);
        if (refund.status === 'succeeded') {
          await updateRefunded(paymentIntentId);
        } else if (refund.status === 'pending') {
          await PaymentFinalization.updateOne(
            { paymentIntentId, status: 'finalization_failed' },
            { $set: { status: 'refund_pending', stripeRefundId: refund.id, updatedAt: new Date() } }
          );
        }
      } else if (event.type === 'refund.updated') {
        const refund = event.data.object;
        if (refund.status === 'succeeded') {
          await updateRefunded(getPaymentIntentId(refund));
        } else if (refund.status === 'failed') {
          await updateRefundFailed(getPaymentIntentId(refund), refund.failure_reason || 'Stripe refund failed');
        }
      } else if (event.type === 'refund.failed') {
        const refund = event.data.object;
        await updateRefundFailed(getPaymentIntentId(refund), refund.failure_reason || 'Refund failed');
      } else if (event.type === 'charge.refunded') {
        const charge = event.data.object;
        await updateRefunded(getPaymentIntentId(charge));
      }
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
