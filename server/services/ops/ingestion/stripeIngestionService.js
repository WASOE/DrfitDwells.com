const crypto = require('crypto');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const StripeEventEvidence = require('../../../models/StripeEventEvidence');
const PaymentFinalization = require('../../../models/PaymentFinalization');
const { openManualReviewItem } = require('./manualReviewService');
const { activatePaidVoucherFromStripeEvent } = require('../../giftVouchers/giftVoucherPaymentService');

function digestEvent(event) {
  return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

function mapPaymentStatusFromStripeEvent(event) {
  const type = event.type;
  const obj = event.data?.object || {};
  if (type === 'payment_intent.succeeded') return 'paid';
  if (type === 'payment_intent.payment_failed') return 'failed';
  if (type === 'payment_intent.created') return 'unpaid';
  if (type === 'charge.dispute.created') return 'disputed';
  if (type === 'charge.refunded') {
    const amount = Number(obj.amount || 0);
    const amountRefunded = Number(obj.amount_refunded || 0);
    return amountRefunded > 0 && amountRefunded < amount ? 'partial' : 'refunded';
  }
  if (type === 'refund.created' || type === 'refund.updated' || type === 'refund.failed') {
    if (obj.status === 'failed' || type === 'refund.failed') return 'failed';
    if (obj.status === 'succeeded') return 'refunded';
    return 'partial';
  }
  return null;
}

function extractPaymentReference(event) {
  const obj = event.data?.object || {};
  if (obj.object === 'payment_intent') return obj.id || null;
  if (obj.object === 'charge') return obj.payment_intent || obj.id || null;
  if (obj.object === 'refund') return obj.payment_intent || obj.charge || obj.id || null;
  return obj.payment_intent || null;
}

function extractPayoutReference(event) {
  const obj = event.data?.object || {};
  if (obj.object === 'payout') return obj.id || null;
  return null;
}

async function ensureStripeEventEvidence(event) {
  const eventId = event.id;
  const newDigest = digestEvent(event);
  const existing = await StripeEventEvidence.findOne({ eventId }).lean();
  if (existing) {
    if (existing.payloadDigest !== newDigest) {
      await openManualReviewItem({
        category: 'provider_reference_inconsistent',
        severity: 'critical',
        entityType: 'StripeEventEvidence',
        entityId: existing._id,
        title: 'Duplicate Stripe event ID with mismatched payload digest',
        details: `Event ${eventId} was received with differing payload digests`,
        provenance: {
          source: 'stripe_webhook',
          sourceReference: eventId
        },
        evidence: {
          existingDigest: existing.payloadDigest,
          newDigest
        }
      });
    }
    return { alreadyProcessed: true, evidence: existing };
  }
  const payloadDigest = newDigest;
  const evidence = await StripeEventEvidence.create({
    eventId,
    eventType: event.type,
    objectType: event.data?.object?.object || null,
    objectId: event.data?.object?.id || null,
    createdAtProvider: new Date((event.created || Date.now() / 1000) * 1000),
    livemode: Boolean(event.livemode),
    payloadDigest,
    metadata: {
      apiVersion: event.api_version || null
    }
  });
  return { alreadyProcessed: false, evidence };
}

async function upsertCanonicalPaymentFromEvent(event) {
  const paymentStatus = mapPaymentStatusFromStripeEvent(event);
  if (!paymentStatus) return null;

  const providerReference = extractPaymentReference(event);
  if (!providerReference) {
    await openManualReviewItem({
      category: 'payment_unlinked',
      severity: 'high',
      entityType: 'Payment',
      entityId: null,
      title: 'Stripe event without payment reference',
      details: `Event ${event.id} (${event.type}) did not include a payment reference`,
      provenance: {
        source: 'stripe_webhook',
        sourceReference: event.id
      },
      evidence: {
        eventType: event.type
      }
    });
    return null;
  }

  const obj = event.data?.object || {};
  const metadata = obj.metadata || {};
  const reservationId = metadata.bookingId || metadata.reservationId || null;
  const amount =
    typeof obj.amount_received === 'number'
      ? obj.amount_received / 100
      : typeof obj.amount === 'number'
      ? obj.amount / 100
      : null;
  const currency = (obj.currency || 'eur').toLowerCase();

  const payment = await Payment.findOneAndUpdate(
    { provider: 'stripe', providerReference: String(providerReference) },
    {
      $set: {
        reservationId: reservationId || null,
        status: paymentStatus,
        amount: amount ?? 0,
        currency,
        source: 'webhook',
        sourceReference: event.id,
        importedAt: new Date((event.created || Date.now() / 1000) * 1000),
        metadata: {
          ...(obj.metadata || {}),
          stripeObjectType: obj.object || null,
          stripeEventType: event.type,
          linkageConfidence: reservationId ? 'high' : 'low'
        }
      },
      $setOnInsert: {
        provider: 'stripe'
      }
    },
    { new: true, upsert: true }
  );

  if (!reservationId) {
    await openManualReviewItem({
      category: 'payment_unlinked',
      severity: 'high',
      entityType: 'Payment',
      entityId: payment._id,
      title: 'Payment ingested without reservation linkage',
      details: `Payment ${payment.providerReference} has no reservation linkage`,
      provenance: {
        source: 'stripe_webhook',
        sourceReference: event.id
      },
      evidence: {
        providerReference: payment.providerReference,
        status: payment.status
      }
    });
  }

  return payment;
}

function mapPayoutStatus(event) {
  const type = event.type;
  if (type === 'payout.created') return 'pending';
  if (type === 'payout.paid') return 'paid';
  if (type === 'payout.failed') return 'failed';
  if (type === 'payout.reconciliation_completed') return 'reconciliation_completed';
  return null;
}

async function upsertCanonicalPayoutFromEvent(event) {
  const payoutStatus = mapPayoutStatus(event);
  if (!payoutStatus) return null;

  const obj = event.data?.object || {};
  const providerReference = extractPayoutReference(event);
  if (!providerReference) {
    await openManualReviewItem({
      category: 'payout_unlinked',
      severity: 'high',
      entityType: 'Payout',
      entityId: null,
      title: 'Payout event missing payout reference',
      details: `Event ${event.id} (${event.type}) missing payout reference`,
      provenance: { source: 'stripe_webhook', sourceReference: event.id },
      evidence: { eventType: event.type }
    });
    return null;
  }

  const payout = await Payout.findOneAndUpdate(
    { provider: 'stripe', providerReference: providerReference },
    {
      $set: {
        status: payoutStatus,
        amount: typeof obj.amount === 'number' ? obj.amount / 100 : 0,
        currency: (obj.currency || 'eur').toLowerCase(),
        expectedArrivalDate: obj.arrival_date ? new Date(obj.arrival_date * 1000) : null,
        paidAt: obj.arrival_date && payoutStatus === 'paid' ? new Date(obj.arrival_date * 1000) : null,
        source: 'webhook',
        sourceReference: event.id,
        importedAt: new Date((event.created || Date.now() / 1000) * 1000),
        metadata: {
          ...(obj.metadata || {}),
          stripeEventType: event.type
        }
      },
      $setOnInsert: {
        provider: 'stripe'
      }
    },
    { new: true, upsert: true }
  );

  if (!payout.metadata?.reservationId) {
    await openManualReviewItem({
      category: 'payout_unlinked',
      severity: 'medium',
      entityType: 'Payout',
      entityId: payout._id,
      title: 'Payout ingested without reservation linkage',
      details: `Payout ${payout.providerReference} has no reservation linkage`,
      provenance: {
        source: 'stripe_webhook',
        sourceReference: event.id
      },
      evidence: {
        providerReference: payout.providerReference,
        status: payout.status
      }
    });
  }

  return payout;
}

async function applyLegacyFinalizationCompatibility(event) {
  const type = event.type;
  const obj = event.data?.object || {};
  const getPaymentIntentId = () => {
    const pi = obj.payment_intent;
    return typeof pi === 'string' ? pi : pi?.id;
  };
  const paymentIntentId = getPaymentIntentId();
  if (!paymentIntentId) return;

  if (type === 'refund.created' && obj.status === 'pending') {
    await PaymentFinalization.updateOne(
      { paymentIntentId, status: 'finalization_failed' },
      { $set: { status: 'refund_pending', stripeRefundId: obj.id, updatedAt: new Date() } }
    );
  }
  if ((type === 'refund.updated' && obj.status === 'succeeded') || type === 'refund.created' || type === 'charge.refunded') {
    await PaymentFinalization.updateOne(
      { paymentIntentId, status: { $in: ['refund_pending', 'finalization_failed'] } },
      { $set: { status: 'refunded', updatedAt: new Date() } }
    );
  }
  if ((type === 'refund.updated' && obj.status === 'failed') || type === 'refund.failed') {
    await PaymentFinalization.updateOne(
      { paymentIntentId },
      {
        $set: {
          status: 'refund_failed',
          refundError: obj.failure_reason || 'Stripe refund failed',
          updatedAt: new Date()
        }
      }
    );
  }
}

async function processStripeWebhookEvent(event) {
  const { alreadyProcessed, evidence } = await ensureStripeEventEvidence(event);
  const isGiftVoucherSucceeded =
    event?.type === 'payment_intent.succeeded'
    && event?.data?.object?.object === 'payment_intent'
    && event?.data?.object?.metadata?.type === 'gift_voucher';

  if (isGiftVoucherSucceeded) {
    await activatePaidVoucherFromStripeEvent(event);
  }

  if (alreadyProcessed) {
    return {
      ok: true,
      deduped: true,
      eventId: event.id
    };
  }

  const [payment, payout] = await Promise.all([
    upsertCanonicalPaymentFromEvent(event),
    upsertCanonicalPayoutFromEvent(event)
  ]);
  await applyLegacyFinalizationCompatibility(event);

  return {
    ok: true,
    deduped: false,
    eventId: event.id,
    paymentId: payment ? String(payment._id) : null,
    payoutId: payout ? String(payout._id) : null,
    evidenceId: String(evidence._id)
  };
}

module.exports = {
  processStripeWebhookEvent
};
