'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRecognizedNetSettledCoverageCents: resolve, computeTransferredValueCents } = require('../services/stayChange/rebookMoneyEvidence');
const { resolveVerifiedGiftVoucherCents, resolveVerifiedStayCreditCents } = require('../services/ops/payment/reservationPaymentSignals');
const { detectPromotionalSourceEconomics } = require('../services/stayChange/rebookPromoEligibility');
const booking = () => ({ _id: 'source', checkoutId: 'checkout', totalValueCents: 20000, status: 'confirmed' });
const payment = (overrides = {}) => ({
  _id: 'payment', reservationId: 'source', provider: 'stripe', providerReference: 'pi_source',
  currency: 'eur', amount: 100, status: 'paid', ...overrides
});
const intent = (refund = 2500) => ({
  id: 'pi_source', status: 'succeeded', currency: 'eur', amount_received: 10000,
  metadata: { bookingId: 'source', checkoutId: 'checkout' },
  latest_charge: { id: 'ch_source', payment_intent: 'pi_source', paid: true, captured: true,
    disputed: false, currency: 'eur', amount: 10000, amount_captured: 10000, amount_refunded: refund }
});
const voucher = (overrides = {}) => ({
  _id: 'redemption', bookingId: 'source', checkoutId: 'checkout', status: 'confirmed',
  currency: 'EUR', amountAppliedCents: 2500, ...overrides
});
const credit = (overrides = {}) => ({
  _id: 'credit-reservation', bookingId: 'source', stayCreditId: 'credit',
  status: 'consumed', amountCents: 2500, ...overrides
});
const withVoucher = () => ({ ...booking(), giftVoucherAppliedCents: 2500, giftVoucherRedemptionId: 'redemption' });
const withCredit = () => ({ ...booking(), stayCreditAppliedCents: 2500, stayCreditId: 'credit' });

test('historical paid ledger with matching gross aggregate remains supported', () => {
  assert.equal(resolve({ ...booking(), stripePaidAmountCents: 10000 }, [payment()]).cents, 10000);
});
test('partially refunded captured Stripe transaction transfers only verified net cents', () => {
  const result = resolve({ ...booking(), stripePaidAmountCents: 10000 }, [payment({ status: 'partial' })], { stripePaymentIntents: [intent()] });
  assert.equal(result.ok, true);
  assert.equal(result.cents, 7500);
  assert.equal(computeTransferredValueCents(5000, result.cents).cents, 5000);
});
test('fully refunded payment cannot fall back to gross booking aggregate', () => {
  assert.equal(resolve({ ...booking(), stripePaidAmountCents: 10000 }, [payment({ status: 'refunded' })], { stripePaymentIntents: [intent(10000)] }).cents, 0);
});
test('refunded ledger label does not imply full refund when fresh charge proves remaining capture', () => {
  assert.equal(resolve(booking(), [payment({ status: 'refunded' })], { stripePaymentIntents: [intent()] }).cents, 7500);
});
test('successful refund-object event amount is reconciled separately from gross capture', () => {
  const p = payment({ status: 'refunded', amount: 25, sourceReference: 'evt_refund',
    metadata: { stripeObjectType: 'refund', stripeEventType: 'refund.updated' } });
  const event = { id: 'evt_refund', type: 'refund.updated', data: { object: {
    object: 'refund', id: 're_source', payment_intent: 'pi_source', charge: 'ch_source',
    amount: 2500, currency: 'eur', status: 'succeeded'
  } } };
  const evidence = { stripePaymentIntents: [intent()], stripeRefundEvents: [event] };
  assert.equal(resolve({ ...booking(), stripePaidAmountCents: 10000 }, [p], evidence).cents, 7500);
  assert.equal(resolve(booking(), [p], { stripePaymentIntents: [intent()] }).ok, false);
  for (const patch of [{ status: 'pending' }, { payment_intent: 'pi_other' }, { charge: 'ch_other' }, { amount: 2600 }]) {
    assert.equal(resolve(booking(), [p], { ...evidence, stripeRefundEvents: [
      { ...event, data: { object: { ...event.data.object, ...patch } } }
    ] }).ok, false);
  }
});
for (const status of ['partial', 'refunded']) {
  test(`${status} without verified captured/refund evidence blocks REBOOK`, () => {
    assert.equal(resolve(booking(), [payment({ status })]).ok, false);
  });
}
for (const status of ['unpaid', 'failed', 'pending']) {
  test(`${status} payment contributes zero without aggregate fallback`, () => {
    assert.equal(resolve(booking(), [payment({ status })]).cents, 0);
  });
}
test('dispute always blocks, including a zero amount disputed row', () => {
  assert.equal(resolve(booking(), [payment(), payment({ status: 'disputed', amount: 0 })]).ok, false);
});
test('gross aggregate without matching ledger fails closed', () => {
  assert.equal(resolve({ ...booking(), stripePaidAmountCents: 10000 }, []).ok, false);
});
for (const [name, mutate] of [
  ['wrong PI', pi => { pi.id = 'pi_other'; }],
  ['wrong charge PI', pi => { pi.latest_charge.payment_intent = 'pi_other'; }],
  ['wrong booking', pi => { pi.metadata.bookingId = 'other'; }],
  ['wrong checkout', pi => { pi.metadata.checkoutId = 'other'; }],
  ['not captured', pi => { pi.latest_charge.captured = false; }],
  ['disputed charge', pi => { pi.latest_charge.disputed = true; }],
  ['currency mismatch', pi => { pi.latest_charge.currency = 'usd'; }],
  ['wrong captured amount', pi => { pi.latest_charge.amount_captured = 9999; }],
  ['invalid refund', pi => { pi.latest_charge.amount_refunded = 10001; }],
  ['unverified zero refund', pi => { pi.latest_charge.amount_refunded = 0; }]
]) {
  test(`refund evidence rejects ${name}`, () => {
    const pi = intent(); mutate(pi);
    assert.equal(resolve(booking(), [payment({ status: 'partial' })], { stripePaymentIntents: [pi] }).ok, false);
  });
}
for (const patch of [{ reservationId: 'other' }, { provider: 'gift_voucher' }, { currency: 'usd' }, { providerReference: '' }, { amount: -1 }]) {
  test(`cash ledger rejects ambiguous provenance ${JSON.stringify(patch)}`, () => {
    assert.equal(resolve(booking(), [payment(patch)]).ok, false);
  });
}
test('duplicate cash records and duplicate Stripe evidence fail closed, never sum twice', () => {
  assert.equal(resolve(booking(), [payment(), payment()]).ok, false);
  assert.equal(resolve(booking(), [payment({ status: 'partial' })], { stripePaymentIntents: [intent(), intent()] }).ok, false);
});
test('confirmed booking-bound and historical checkout-only vouchers count once', () => {
  for (const r of [voucher(), voucher({ bookingId: null })]) {
    assert.equal(resolve(withVoucher(), [], { giftVoucherRedemption: r }).cents, 2500);
  }
  assert.equal(detectPromotionalSourceEconomics(withVoucher()).promotional, true);
  assert.equal(resolve({ ...withVoucher(), checkoutId: undefined }, [], { giftVoucherRedemption: voucher() }).cents, 2500);
});
for (const patch of [
  { status: 'released' }, { status: 'voided' }, { status: 'reserved' },
  { bookingId: 'other' }, { reservationId: 'other' }, { checkoutId: 'other' },
  { _id: 'other' }, { amountAppliedCents: 2501 }, { currency: 'USD' },
  { bookingId: null, checkoutId: null }
]) {
  test(`voucher mismatch contributes zero and blocks transfer ${JSON.stringify(patch)}`, () => {
    const r = voucher(patch);
    assert.equal(resolveVerifiedGiftVoucherCents(withVoucher(), r), 0);
    assert.equal(resolve(withVoucher(), [], { giftVoucherRedemption: r }).ok, false);
  });
}
test('voucher without a ledger record blocks transfer', () => {
  assert.equal(resolve(withVoucher(), []).ok, false);
});
test('consumed booking-bound stay credit counts once', () => {
  assert.equal(resolve(withCredit(), [], { stayCreditReservations: [credit()] }).cents, 2500);
});
for (const rows of [
  [], [credit({ status: 'released' })], [credit({ bookingId: 'other' })],
  [credit({ stayCreditId: 'other' })], [credit({ amountCents: 2501 })], [credit(), credit()]
]) {
  test(`stay credit without unique matching consumed evidence blocks: ${JSON.stringify(rows)}`, () => {
    assert.equal(resolveVerifiedStayCreditCents(withCredit(), rows), 0);
    assert.equal(resolve(withCredit(), [], { stayCreditReservations: rows }).ok, false);
  });
}
test('mixed net cash, voucher and consumed credit are pure, repeatable and capped by contract', () => {
  const b = { ...withVoucher(), ...withCredit(), giftVoucherAppliedCents: 2500, giftVoucherRedemptionId: 'redemption' };
  const payments = [payment({ status: 'partial' })];
  const evidence = { stripePaymentIntents: [intent()], giftVoucherRedemption: voucher(), stayCreditReservations: [credit()] };
  const before = JSON.stringify([b, payments, evidence]);
  const first = resolve(b, payments, evidence), retry = resolve(b, payments, evidence);
  assert.equal(first.cents, 12500);
  assert.deepEqual(retry, first);
  assert.equal(computeTransferredValueCents(10000, first.cents).cents, 10000);
  assert.equal(JSON.stringify([b, payments, evidence]), before);
});
