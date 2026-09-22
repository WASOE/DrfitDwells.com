/**
 * SP5B — Authoritative off-session PaymentMethod verification for split payments.
 * Cards only. Does not create invoices or collect future installments.
 */
'use strict';

const { getPaymentChoice } = require('./splitPaymentChoiceService');

class SplitOffSessionVerificationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SplitOffSessionVerificationError';
    this.code = code;
    this.details = details;
  }
}

const VERIFICATION_CODES = Object.freeze({
  STRIPE_REQUIRED: 'SPLIT_OFF_SESSION_STRIPE_REQUIRED',
  PI_REQUIRED: 'SPLIT_OFF_SESSION_PI_REQUIRED',
  PI_NOT_SUCCEEDED: 'SPLIT_OFF_SESSION_PI_NOT_SUCCEEDED',
  CHECKOUT_MISMATCH: 'SPLIT_OFF_SESSION_CHECKOUT_MISMATCH',
  CUSTOMER_MISSING: 'SPLIT_OFF_SESSION_CUSTOMER_MISSING',
  CUSTOMER_MISMATCH: 'SPLIT_OFF_SESSION_CUSTOMER_MISMATCH',
  PM_MISSING: 'SPLIT_OFF_SESSION_PM_MISSING',
  PM_NOT_CARD: 'SPLIT_OFF_SESSION_PM_NOT_CARD',
  PM_NOT_ATTACHED: 'SPLIT_OFF_SESSION_PM_NOT_ATTACHED',
  SETUP_FUTURE_USAGE_MISSING: 'SPLIT_OFF_SESSION_SETUP_FUTURE_USAGE_MISSING'
});

function customerIdFrom(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return String(value).trim();
  if (typeof value === 'object' && value.id) return String(value.id).trim();
  return null;
}

function stripeObjectIdFrom(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return String(value).trim();
  if (typeof value === 'object' && value.id) return String(value.id).trim();
  return null;
}

/**
 * Retrieve and verify that a succeeded split PI has a reusable card PM
 * attached to the expected Customer with off_session future usage.
 *
 * @returns {{ paymentMethodId: string, customerId: string, paymentIntent: object, paymentMethod: object }}
 */
async function verifySplitOffSessionPaymentMethod({ stripe, session, paymentIntent }) {
  if (getPaymentChoice(session) !== 'split') {
    return null;
  }
  if (!stripe?.paymentIntents?.retrieve) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.STRIPE_REQUIRED,
      'Stripe client is required to verify split off-session PaymentMethod'
    );
  }

  const expectedCheckoutId = String(session.checkoutId || '');
  const expectedCustomerId = session.stripeCustomerId
    ? String(session.stripeCustomerId).trim()
    : null;
  if (!expectedCustomerId) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.CUSTOMER_MISSING,
      'CheckoutSession.stripeCustomerId is required before split off-session verification',
      { checkoutId: expectedCheckoutId }
    );
  }

  const intentId = stripeObjectIdFrom(paymentIntent);
  if (!intentId) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.PI_REQUIRED,
      'PaymentIntent is required for split off-session verification'
    );
  }

  // Always re-retrieve with expansions — never trust unexpanded string PM alone.
  const pi = await stripe.paymentIntents.retrieve(intentId, {
    expand: ['payment_method', 'customer']
  });

  if (String(pi.status || '') !== 'succeeded') {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.PI_NOT_SUCCEEDED,
      'PaymentIntent must be succeeded for split off-session verification',
      { paymentIntentId: intentId, status: pi.status || null }
    );
  }

  const metaCheckout = String(pi.metadata?.checkoutId || '');
  if (!metaCheckout || metaCheckout !== expectedCheckoutId) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.CHECKOUT_MISMATCH,
      'PaymentIntent checkoutId metadata does not match CheckoutSession',
      { paymentIntentId: intentId, metaCheckout, expectedCheckoutId }
    );
  }

  const piCustomerId = customerIdFrom(pi.customer);
  if (!piCustomerId || piCustomerId !== expectedCustomerId) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.CUSTOMER_MISMATCH,
      'PaymentIntent Customer does not match CheckoutSession Stripe Customer',
      { paymentIntentId: intentId, piCustomerId, expectedCustomerId }
    );
  }

  if (String(pi.setup_future_usage || '') !== 'off_session') {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.SETUP_FUTURE_USAGE_MISSING,
      'PaymentIntent setup_future_usage must be off_session for split payments',
      { paymentIntentId: intentId, setup_future_usage: pi.setup_future_usage || null }
    );
  }

  let paymentMethod = pi.payment_method;
  const pmId = stripeObjectIdFrom(paymentMethod);
  if (!pmId) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.PM_MISSING,
      'Succeeded split PaymentIntent has no PaymentMethod',
      { paymentIntentId: intentId }
    );
  }

  if (!paymentMethod || typeof paymentMethod !== 'object' || !paymentMethod.type) {
    if (!stripe.paymentMethods?.retrieve) {
      throw new SplitOffSessionVerificationError(
        VERIFICATION_CODES.PM_MISSING,
        'Unable to retrieve PaymentMethod for split off-session verification',
        { paymentIntentId: intentId, paymentMethodId: pmId }
      );
    }
    paymentMethod = await stripe.paymentMethods.retrieve(pmId);
  }

  if (String(paymentMethod.type || '') !== 'card') {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.PM_NOT_CARD,
      'Split payments require a card PaymentMethod',
      { paymentIntentId: intentId, paymentMethodId: pmId, type: paymentMethod.type || null }
    );
  }

  const pmCustomerId = customerIdFrom(paymentMethod.customer);
  if (!pmCustomerId || pmCustomerId !== expectedCustomerId) {
    throw new SplitOffSessionVerificationError(
      VERIFICATION_CODES.PM_NOT_ATTACHED,
      'PaymentMethod must be attached to the expected Stripe Customer',
      { paymentIntentId: intentId, paymentMethodId: pmId, pmCustomerId, expectedCustomerId }
    );
  }

  return {
    paymentMethodId: String(pmId),
    customerId: expectedCustomerId,
    paymentIntent: pi,
    paymentMethod
  };
}

module.exports = {
  VERIFICATION_CODES,
  SplitOffSessionVerificationError,
  verifySplitOffSessionPaymentMethod,
  customerIdFrom,
  stripeObjectIdFrom
};
