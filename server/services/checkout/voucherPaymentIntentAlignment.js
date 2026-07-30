/**
 * Diagnose PaymentIntent ↔ voucher reservation alignment at booking finalization.
 * Source of the production MRI:
 *   "Stripe PaymentIntent metadata or amount does not align with voucher reservation at booking finalization"
 */

function diagnoseVoucherPaymentIntentAlignment({
  paymentIntent,
  checkoutId,
  redemptionId,
  giftVoucherAppliedCents,
  stripePaidAmountCents
}) {
  const piMeta = paymentIntent?.metadata || {};
  const paymentAmountCents = Number(paymentIntent?.amount || 0);
  const metaVoucherAppliedCents = Number(piMeta.voucherAppliedCents || 0);
  const expectedRedemptionId = String(redemptionId || '');
  const expectedCheckoutId = String(checkoutId || '');
  const expectedVoucherApplied = Number(giftVoucherAppliedCents || 0);
  const expectedStripeAmount = Number(stripePaidAmountCents || 0);

  const fields = {
    redemptionId: {
      pi: String(piMeta.redemptionId || ''),
      expected: expectedRedemptionId,
      ok: String(piMeta.redemptionId || '') === expectedRedemptionId
    },
    checkoutId: {
      pi: String(piMeta.checkoutId || ''),
      expected: expectedCheckoutId,
      ok: String(piMeta.checkoutId || '') === expectedCheckoutId
    },
    voucherAppliedCents: {
      pi: metaVoucherAppliedCents,
      expected: expectedVoucherApplied,
      ok: metaVoucherAppliedCents === expectedVoucherApplied
    },
    stripeAmountCents: {
      pi: paymentAmountCents,
      expected: expectedStripeAmount,
      ok: paymentAmountCents === expectedStripeAmount
    }
  };

  const mismatchedFields = Object.entries(fields)
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);

  return {
    aligned: mismatchedFields.length === 0,
    mismatchedFields,
    fields,
    primaryMismatchField: mismatchedFields[0] || null
  };
}

module.exports = {
  diagnoseVoucherPaymentIntentAlignment
};
