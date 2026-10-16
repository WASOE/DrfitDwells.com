'use strict';

const Stripe = require('stripe');
const { STRIPE_API_VERSION } = require('../../config/stripeApiVersion');
const { loadNonCardCoverageEvidence } = require('../ops/payment/nonCardCoverageEvidence');
const { createDomainError } = require('../ops/domain/errors');

function ambiguous(reason) {
  return createDomainError('conflict', 'Refund coverage requires verified Stripe evidence', {
    code: 'PAYMENT_EVIDENCE_AMBIGUOUS', reason
  }, 409);
}

/** Only GETs: never ingest Stripe events or modify the historical ledgers. */
async function loadRebookCoverageEvidence(booking, payments, { stripe = null } = {}) {
  const evidenceFor = await loadNonCardCoverageEvidence([booking]);
  const stripePaymentIntents = [];
  const stripeRefundEvents = [];
  const refundable = payments.filter(payment =>
    payment.provider === 'stripe' && ['partial', 'refunded'].includes(payment.status)
  );
  if (refundable.length) {
    const client = stripe || (process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
      : null);
    if (!client) {
      throw ambiguous('stripe_verification_unavailable');
    }
    for (const id of new Set(refundable.map(payment => payment.providerReference))) {
      if (!/^pi_[A-Za-z0-9_]+$/.test(id || '')) {
        throw ambiguous('payment_intent_identity_invalid');
      }
      try {
        stripePaymentIntents.push(await client.paymentIntents.retrieve(id, { expand: ['latest_charge'] }));
      } catch {
        throw ambiguous('stripe_verification_failed');
      }
    }
    const refundEvents = refundable.filter(payment =>
      payment.metadata?.stripeObjectType === 'refund' ||
      String(payment.metadata?.stripeEventType || '').startsWith('refund.')
    );
    for (const id of new Set(refundEvents.map(payment => payment.sourceReference))) {
      if (!/^evt_[A-Za-z0-9_]+$/.test(id || '')) throw ambiguous('refund_event_identity_invalid');
      try {
        stripeRefundEvents.push(await client.events.retrieve(id));
      } catch {
        throw ambiguous('stripe_refund_event_verification_failed');
      }
    }
  }
  return { ...evidenceFor(booking), stripePaymentIntents, stripeRefundEvents };
}

module.exports = { loadRebookCoverageEvidence };
