'use strict';

const CheckoutSession = require('../../../models/CheckoutSession');

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  // Lazy require to avoid boot cost when Stripe unset
  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Read-only list of recent unpaid CheckoutSessions with an active PI,
 * optionally filtered to Stripe status requires_payment_method / requires_action.
 */
async function getAbandonedCheckoutsReadModel({ sinceHours = 48, limit = 40 } = {}) {
  const hours = Math.min(Math.max(Number(sinceHours) || 48, 1), 168);
  const max = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const sessions = await CheckoutSession.find({
    updatedAt: { $gte: since },
    bookingId: { $in: [null, undefined] },
    paymentStatus: 'unpaid',
    canonicalPaymentIntentId: { $exists: true, $type: 'string', $gt: '' },
    status: { $in: ['pi_active', 'payment_required'] }
  })
    .sort({ updatedAt: -1 })
    .limit(max)
    .select(
      'checkoutId status paymentStatus guestEmail stripeAmountCents canonicalPaymentIntentId quoteSnapshot createdAt updatedAt expiresAt'
    )
    .lean();

  const stripe = getStripeClient();
  const items = [];

  for (const session of sessions) {
    const piId = String(session.canonicalPaymentIntentId || '').trim();
    let paymentIntentStatus = null;
    let include = true;

    if (stripe && piId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        paymentIntentStatus = pi.status || null;
        include =
          paymentIntentStatus === 'requires_payment_method' ||
          paymentIntentStatus === 'requires_action';
      } catch {
        paymentIntentStatus = 'retrieve_failed';
        include = true;
      }
    }

    if (!include) continue;

    const snap = session.quoteSnapshot || {};
    items.push({
      checkoutId: session.checkoutId,
      status: session.status,
      paymentStatus: session.paymentStatus,
      guestEmail: session.guestEmail || null,
      stripeAmountCents: session.stripeAmountCents ?? snap.stripeAmountCents ?? null,
      canonicalPaymentIntentId: piId,
      paymentIntentStatus,
      entityType: snap.entityType || null,
      cabinId: snap.cabinId || null,
      cabinTypeId: snap.cabinTypeId || null,
      checkInISO: snap.checkInISO || null,
      checkOutISO: snap.checkOutISO || null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt || null
    });
  }

  return {
    sinceHours: hours,
    count: items.length,
    items
  };
}

module.exports = {
  getAbandonedCheckoutsReadModel
};
