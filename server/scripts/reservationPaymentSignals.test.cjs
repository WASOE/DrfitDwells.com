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

test('Batch 2: payment_retained suppresses cancelled paid/partial follow-up only', () => {
  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'payment_retained'
    }),
    {
      cancelledPaid: false,
      refundPending: false,
      paymentAttention: false
    }
  );

  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'partial',
      cancellationSettlementOutcome: 'payment_retained'
    }),
    {
      cancelledPaid: false,
      refundPending: false,
      paymentAttention: false
    }
  );

  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'pending_verification',
      cancellationSettlementOutcome: 'payment_retained'
    }),
    {
      cancelledPaid: false,
      refundPending: true,
      paymentAttention: true
    }
  );
});

test('Batch 2: resolution_pending or missing outcome keeps legacy behavior', () => {
  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'resolution_pending'
    }),
    {
      cancelledPaid: true,
      refundPending: true,
      paymentAttention: true
    }
  );

  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid'
    }),
    {
      cancelledPaid: true,
      refundPending: true,
      paymentAttention: true
    }
  );
});

test('Batch 5: credits_issued suppresses cancelled paid/partial follow-up', () => {
  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'credits_issued'
    }),
    {
      cancelledPaid: false,
      refundPending: false,
      paymentAttention: false
    }
  );

  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'partial',
      cancellationSettlementOutcome: 'credits_issued'
    }),
    {
      cancelledPaid: false,
      refundPending: false,
      paymentAttention: false
    }
  );

  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'pending_verification',
      cancellationSettlementOutcome: 'credits_issued'
    }),
    {
      cancelledPaid: false,
      refundPending: true,
      paymentAttention: true
    }
  );
});

test('Batch 5: refund_follow_up alert suppressed for credits_issued', () => {
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'credits_issued'
    }),
    false
  );
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'partial',
      cancellationSettlementOutcome: 'credits_issued'
    }),
    false
  );
});

test('Batch 10: cash_refunded suppresses cancelled paid/partial follow-up', () => {
  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'cash_refunded'
    }),
    {
      cancelledPaid: false,
      refundPending: false,
      paymentAttention: false
    }
  );

  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'cash_refunded'
    }),
    false
  );
});

test('Batch 10: cash_refund_pending keeps cancelled paid follow-up', () => {
  assert.deepEqual(
    derivePaymentAttention({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'cash_refund_pending'
    }),
    {
      cancelledPaid: true,
      refundPending: true,
      paymentAttention: true
    }
  );

  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'cash_refund_pending'
    }),
    true
  );
});

test('Batch 2: refund_follow_up alert suppression only for payment_retained', () => {
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'payment_retained'
    }),
    false
  );
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'resolution_pending'
    }),
    true
  );
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid'
    }),
    true
  );
});

// --- Gift voucher / stay credit coverage (voucher-only booking false "unpaid" regression) ---
const {
  assessReservationPaymentCoverage,
  hasOutstandingNonCardBalance
} = require('../services/ops/payment/reservationPaymentSignals');

const PROD_BOOKING_ID = '6ab97bb39da21ab9cc0040de';
const PROD_REDEMPTION_ID = '6ab97bb19da21ab9cc0040af';
const PROD_CHECKOUT_ID = 'c0a0e935-54d8-417b-9ddb-10e75b936acc';

function voucherOnlyBooking(overrides = {}) {
  return {
    _id: PROD_BOOKING_ID,
    status: 'confirmed',
    totalPrice: 110,
    totalValueCents: 11000,
    giftVoucherAppliedCents: 11000,
    giftVoucherRedemptionId: PROD_REDEMPTION_ID,
    stripePaidAmountCents: 0,
    stripePaymentIntentId: null,
    paymentSettlementStatus: 'not_required',
    paymentMethod: 'gift_voucher',
    checkoutId: PROD_CHECKOUT_ID,
    provenance: { source: 'guest_portal' },
    ...overrides
  };
}

function confirmedRedemption(overrides = {}) {
  return {
    _id: PROD_REDEMPTION_ID,
    status: 'confirmed',
    bookingId: null,
    reservationId: null,
    checkoutId: PROD_CHECKOUT_ID,
    amountAppliedCents: 11000,
    ...overrides
  };
}

function assess(booking, extra = {}) {
  return assessReservationPaymentCoverage({
    booking,
    linkedPaymentTrail: [],
    hasUnlinkedStripePayment: false,
    rebookStayChange: null,
    ...extra
  });
}

test('production booking 6ab97bb3… (full voucher, legacy redemption without back-link) is paid with €0 outstanding', () => {
  const result = assess(voucherOnlyBooking(), { giftVoucherRedemption: confirmedRedemption() });
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.coverage.dueCents, 11000);
  assert.equal(result.coverage.giftVoucherCents, 11000);
  assert.equal(result.coverage.outstandingCents, 0);
  assert.equal(hasOutstandingNonCardBalance(result), false);
  const attention = derivePaymentAttention({ reservationStatus: 'confirmed', paymentStatus: result.paymentStatus });
  assert.equal(attention.paymentAttention, false);
});

test('full voucher with back-linked redemption is paid; classifyReservationPaymentStatus agrees', () => {
  const extra = { giftVoucherRedemption: confirmedRedemption({ bookingId: PROD_BOOKING_ID }) };
  assert.equal(assess(voucherOnlyBooking(), extra).paymentStatus, 'paid');
  assert.equal(
    classifyReservationPaymentStatus({ booking: voucherOnlyBooking(), linkedPaymentTrail: [], hasUnlinkedStripePayment: false, ...extra }),
    'paid'
  );
});

test('booking fields alone (not_required / gift_voucher / applied cents) never establish payment', () => {
  assert.equal(assess(voucherOnlyBooking()).paymentStatus, 'unpaid');
  assert.equal(assess(voucherOnlyBooking(), { giftVoucherRedemption: null }).paymentStatus, 'unpaid');
});

test('released, voided, pending or reserved redemptions provide no coverage', () => {
  for (const status of ['released', 'voided', 'pending_debit', 'reserved']) {
    const result = assess(voucherOnlyBooking(), { giftVoucherRedemption: confirmedRedemption({ status }) });
    assert.equal(result.paymentStatus, 'unpaid', status);
  }
});

test('mismatched redemption evidence fails closed', () => {
  const cases = [
    confirmedRedemption({ _id: '6ab97bb19da21ab9cc0040ff' }),
    confirmedRedemption({ bookingId: '6ab97bb39da21ab9cc0040ff' }),
    confirmedRedemption({ reservationId: '6ab97bb39da21ab9cc0040ff' }),
    confirmedRedemption({ checkoutId: 'other-checkout' }),
    confirmedRedemption({ amountAppliedCents: 10999 }),
    confirmedRedemption({ amountAppliedCents: 22000 }),
    confirmedRedemption({ currency: 'USD' })
  ];
  for (const giftVoucherRedemption of cases) {
    assert.equal(assess(voucherOnlyBooking(), { giftVoucherRedemption }).paymentStatus, 'unpaid');
  }
});

test('booking total inflated beyond voucher stays outstanding (uses larger of totalPrice / totalValueCents)', () => {
  const result = assess(voucherOnlyBooking({ totalPrice: 120 }), { giftVoucherRedemption: confirmedRedemption() });
  assert.equal(result.paymentStatus, 'partial');
  assert.equal(result.coverage.outstandingCents, 1000);
});

test('partial voucher without card payment is partial with attention and outstanding balance', () => {
  const booking = voucherOnlyBooking({ totalPrice: 170, totalValueCents: 17000, giftVoucherAppliedCents: 5000 });
  const result = assess(booking, { giftVoucherRedemption: confirmedRedemption({ amountAppliedCents: 5000 }) });
  assert.equal(result.paymentStatus, 'partial');
  assert.equal(result.coverage.outstandingCents, 12000);
  assert.equal(hasOutstandingNonCardBalance(result), true);
  const attention = derivePaymentAttention({
    reservationStatus: 'confirmed',
    paymentStatus: result.paymentStatus,
    outstandingBalance: hasOutstandingNonCardBalance(result)
  });
  assert.equal(attention.paymentAttention, true);
  // Stripe-only partial (refund residue) keeps prior non-attention behaviour.
  assert.equal(derivePaymentAttention({ reservationStatus: 'confirmed', paymentStatus: 'partial' }).paymentAttention, false);
});

test('voucher + Stripe: Stripe trail keeps precedence (paid / partial / refunded / failed / disputed unchanged)', () => {
  const booking = voucherOnlyBooking({
    totalPrice: 170,
    totalValueCents: 17000,
    giftVoucherAppliedCents: 10000,
    stripePaidAmountCents: 7000,
    stripePaymentIntentId: 'pi_mixed',
    paymentMethod: 'stripe_plus_gift_voucher',
    paymentSettlementStatus: 'paid_in_full'
  });
  const giftVoucherRedemption = confirmedRedemption({ amountAppliedCents: 10000 });
  for (const status of ['paid', 'partial', 'refunded', 'failed', 'disputed']) {
    assert.equal(
      assess(booking, { giftVoucherRedemption, linkedPaymentTrail: [{ status, amount: 70 }] }).paymentStatus,
      status
    );
  }
  // Unverified Stripe portion is never masked by voucher coverage.
  assert.equal(assess(booking, { giftVoucherRedemption }).paymentStatus, 'pending_verification');
  assert.equal(
    assess(booking, { giftVoucherRedemption, hasUnlinkedStripePayment: true }).paymentStatus,
    'unlinked_payment'
  );
});

test('stay credit coverage requires exactly one consumed reservation bound to the booking', () => {
  const booking = voucherOnlyBooking({
    giftVoucherAppliedCents: 0,
    giftVoucherRedemptionId: null,
    stayCreditAppliedCents: 11000,
    stayCreditId: 'sc1',
    paymentMethod: 'stay_credit'
  });
  const row = { status: 'consumed', bookingId: PROD_BOOKING_ID, stayCreditId: 'sc1', amountCents: 11000 };
  assert.equal(assess(booking, { stayCreditReservations: [row] }).paymentStatus, 'paid');
  assert.equal(assess(booking, { stayCreditReservations: [] }).paymentStatus, 'unpaid');
  assert.equal(assess(booking, { stayCreditReservations: [{ ...row, status: 'released' }] }).paymentStatus, 'unpaid');
  assert.equal(assess(booking, { stayCreditReservations: [{ ...row, status: 'reserved' }] }).paymentStatus, 'unpaid');
  assert.equal(assess(booking, { stayCreditReservations: [{ ...row, amountCents: 5000 }] }).paymentStatus, 'unpaid');
  assert.equal(assess(booking, { stayCreditReservations: [{ ...row, stayCreditId: 'sc2' }] }).paymentStatus, 'unpaid');
  assert.equal(assess(booking, { stayCreditReservations: [row, { ...row }] }).paymentStatus, 'unpaid');
});

test('voucher + stay credit combine without double counting', () => {
  const booking = voucherOnlyBooking({ giftVoucherAppliedCents: 6000, stayCreditAppliedCents: 5000 });
  const extra = {
    giftVoucherRedemption: confirmedRedemption({ amountAppliedCents: 6000 }),
    stayCreditReservations: [{ status: 'consumed', bookingId: PROD_BOOKING_ID, amountCents: 5000 }]
  };
  const result = assess(booking, extra);
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.coverage.coveredCents, 11000);
  // Repeated evaluation / duplicated evidence rows never increase coverage beyond booking fields.
  const again = assess(booking, extra);
  assert.deepEqual(again, result);
  const dupRedemptionBooking = voucherOnlyBooking({ giftVoucherAppliedCents: 6000, stayCreditAppliedCents: 0 });
  const partial = assess(dupRedemptionBooking, { giftVoucherRedemption: confirmedRedemption({ amountAppliedCents: 6000 }) });
  assert.equal(partial.coverage.coveredCents, 6000);
  assert.equal(partial.paymentStatus, 'partial');
});

test('manual reservations keep precedence over voucher coverage', () => {
  const manual = voucherOnlyBooking({ provenance: { source: 'admin_manual' } });
  assert.equal(assess(manual, { giftVoucherRedemption: confirmedRedemption() }).paymentStatus, 'manual_not_required');
  assert.equal(assess(manual).paymentStatus, 'manual_not_required');
});

test('cancelled voucher-paid booking raises refund/credit follow-up unless settlement recorded', () => {
  const result = assess(voucherOnlyBooking({ status: 'cancelled' }), { giftVoucherRedemption: confirmedRedemption() });
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'paid' }), true);
  assert.equal(
    shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'paid', cancellationSettlementOutcome: 'credits_issued' }),
    false
  );
  // Released on cancellation → no remaining coverage, no refund follow-up.
  const released = assess(voucherOnlyBooking({ status: 'cancelled' }), {
    giftVoucherRedemption: confirmedRedemption({ status: 'released' })
  });
  assert.equal(released.paymentStatus, 'unpaid');
  assert.equal(shouldEmitRefundFollowUpAlert({ reservationStatus: 'cancelled', paymentStatus: 'unpaid' }), false);
  // Outstanding-balance attention does not apply to cancelled bookings.
  assert.equal(
    derivePaymentAttention({ reservationStatus: 'cancelled', paymentStatus: 'unknown', outstandingBalance: true }).paymentAttention,
    false
  );
});

test('genuinely unpaid booking (no voucher, no credit, no Stripe) remains unpaid with attention', () => {
  const result = assess({ _id: 'x', status: 'confirmed', totalPrice: 150, provenance: { source: 'guest_portal' } });
  assert.equal(result.paymentStatus, 'unpaid');
  assert.equal(derivePaymentAttention({ reservationStatus: 'confirmed', paymentStatus: 'unpaid' }).paymentAttention, true);
});
