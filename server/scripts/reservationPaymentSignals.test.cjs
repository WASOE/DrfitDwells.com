/**
 * Pre-settlement reservation payment signal behavior (Batch 1 refactor guard).
 * Run: cd server && node --test scripts/reservationPaymentSignals.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  derivePaymentStatusFromTrail,
  classifyReservationPaymentStatus,
  derivePaymentAttention,
  shouldEmitRefundFollowUpAlert
} = require('../services/ops/payment/reservationPaymentSignals');

test('derivePaymentStatusFromTrail priority: disputed > failed > refunded > partial > paid', () => {
  assert.equal(derivePaymentStatusFromTrail([{ status: 'paid' }, { status: 'disputed' }]), 'disputed');
  assert.equal(derivePaymentStatusFromTrail([{ status: 'paid' }, { status: 'failed' }]), 'failed');
  assert.equal(derivePaymentStatusFromTrail([{ status: 'paid' }, { status: 'refunded' }]), 'refunded');
  assert.equal(derivePaymentStatusFromTrail([{ status: 'paid' }, { status: 'partial' }]), 'partial');
  assert.equal(derivePaymentStatusFromTrail([{ status: 'paid' }]), 'paid');
  assert.equal(derivePaymentStatusFromTrail([]), null);
  assert.equal(derivePaymentStatusFromTrail(null), null);
});

test('classifyReservationPaymentStatus fallbacks', () => {
  assert.equal(
    classifyReservationPaymentStatus({
      booking: {},
      linkedPaymentTrail: [{ status: 'paid' }],
      hasUnlinkedStripePayment: false
    }),
    'paid'
  );

  assert.equal(
    classifyReservationPaymentStatus({
      booking: { stripePaymentIntentId: 'pi_123', totalPrice: 100 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: true
    }),
    'unlinked_payment'
  );

  assert.equal(
    classifyReservationPaymentStatus({
      booking: { stripePaymentIntentId: 'pi_123', totalPrice: 100 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false
    }),
    'pending_verification'
  );

  assert.equal(
    classifyReservationPaymentStatus({
      booking: { provenance: { source: 'admin_manual' }, totalPrice: 100 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false
    }),
    'manual_not_required'
  );

  assert.equal(
    classifyReservationPaymentStatus({
      booking: { totalPrice: 150 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false
    }),
    'unpaid'
  );

  assert.equal(
    classifyReservationPaymentStatus({
      booking: { totalPrice: 0 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false
    }),
    'unknown'
  );
});

test('derivePaymentAttention — cancelled combinations', () => {
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'cancelled', paymentStatus: 'paid' }), {
    cancelledPaid: true,
    refundPending: true,
    paymentAttention: true
  });
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'cancelled', paymentStatus: 'partial' }), {
    cancelledPaid: true,
    refundPending: true,
    paymentAttention: true
  });
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'cancelled', paymentStatus: 'pending_verification' }), {
    cancelledPaid: false,
    refundPending: true,
    paymentAttention: true
  });
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'cancelled', paymentStatus: 'refunded' }), {
    cancelledPaid: false,
    refundPending: false,
    paymentAttention: false
  });
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'cancelled', paymentStatus: 'unpaid' }), {
    cancelledPaid: false,
    refundPending: false,
    paymentAttention: true
  });
});

test('derivePaymentAttention — active combinations', () => {
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'confirmed', paymentStatus: 'unpaid' }), {
    cancelledPaid: false,
    refundPending: false,
    paymentAttention: true
  });
  assert.deepEqual(derivePaymentAttention({ reservationStatus: 'confirmed', paymentStatus: 'paid' }), {
    cancelledPaid: false,
    refundPending: false,
    paymentAttention: false
  });
});

test('shouldEmitRefundFollowUpAlert — dashboard refund_follow_up predicate', () => {
  assert.equal(shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'paid' }), true);
  assert.equal(shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'partial' }), true);
  assert.equal(
    shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'pending_verification' }),
    false
  );
  assert.equal(shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'refunded' }), false);
  assert.equal(shouldEmitRefundFollowUpAlert({ reservationStatus: 'confirmed', paymentStatus: 'paid' }), false);
});
