'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const StayCreditReservation = require('../models/StayCreditReservation');
const { loadRebookCoverageEvidence } = require('../services/stayChange/loadRebookCoverageEvidence');
const { resolveRecognizedNetSettledCoverageCents: resolve } = require('../services/stayChange/rebookMoneyEvidence');
let mongo;
test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('loads authoritative voucher/credit ledgers read-only and retrieves each refund PI once', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const redemptionId = new mongoose.Types.ObjectId();
  const creditId = new mongoose.Types.ObjectId();
  await GiftVoucherRedemption.collection.insertOne({
    _id: redemptionId, bookingId, checkoutId: 'foundation-checkout',
    amountAppliedCents: 2500, status: 'confirmed', currency: 'EUR'
  });
  await StayCreditReservation.collection.insertOne({
    bookingId, stayCreditId: creditId, amountCents: 2500, status: 'consumed'
  });
  const b = {
    _id: bookingId, checkoutId: 'foundation-checkout', totalValueCents: 20000,
    giftVoucherAppliedCents: 2500, giftVoucherRedemptionId: redemptionId,
    stayCreditAppliedCents: 2500, stayCreditId: creditId
  };
  const payments = [{
    reservationId: bookingId, provider: 'stripe', providerReference: 'pi_foundation',
    status: 'partial', amount: 100, currency: 'eur'
  }];
  const before = {
    voucher: await GiftVoucherRedemption.findById(redemptionId).lean(),
    credit: await StayCreditReservation.findOne({ bookingId }).lean()
  };
  const calls = [];
  const pi = {
    id: 'pi_foundation', status: 'succeeded', currency: 'eur', amount_received: 10000,
    latest_charge: { id: 'ch_foundation', payment_intent: 'pi_foundation', paid: true,
      captured: true, disputed: false, currency: 'eur', amount: 10000,
      amount_captured: 10000, amount_refunded: 2500 }
  };
  const stripe = { paymentIntents: { retrieve: async (...args) => { calls.push(args); return pi; } } };
  const evidence = await loadRebookCoverageEvidence(b, payments, { stripe });
  assert.equal(resolve(b, payments, evidence).cents, 12500);
  assert.deepEqual(calls, [['pi_foundation', { expand: ['latest_charge'] }]]);
  const duplicates = await loadRebookCoverageEvidence(b, [...payments, ...payments], { stripe });
  assert.equal(calls.length, 2);
  assert.equal(resolve(b, [...payments, ...payments], duplicates).ok, false);
  assert.deepEqual(await GiftVoucherRedemption.findById(redemptionId).lean(), before.voucher);
  assert.deepEqual(await StayCreditReservation.findOne({ bookingId }).lean(), before.credit);
});

test('Stripe read failure blocks explicitly without exposing provider errors', async () => {
  const stripe = { paymentIntents: { retrieve: async () => { throw new Error('sensitive provider error'); } } };
  await assert.rejects(loadRebookCoverageEvidence({ _id: new mongoose.Types.ObjectId() }, [
    { provider: 'stripe', providerReference: 'pi_foundation', status: 'partial' }
  ], { stripe }), error => error.details.code === 'PAYMENT_EVIDENCE_AMBIGUOUS' &&
    error.details.reason === 'stripe_verification_failed' && !error.message.includes('sensitive'));
});

test('paid historic ledger does not require Stripe connectivity; invalid refund identity fails', async () => {
  const stripe = { paymentIntents: { retrieve: async () => { throw new Error('must not call'); } } };
  const b = { _id: new mongoose.Types.ObjectId() };
  const evidence = await loadRebookCoverageEvidence(b, [{ provider: 'stripe', status: 'paid' }], { stripe });
  assert.deepEqual(evidence.stripePaymentIntents, []);
  await assert.rejects(loadRebookCoverageEvidence(b, [
    { provider: 'stripe', status: 'partial', providerReference: 'ch_not_an_intent' }
  ], { stripe }), error => error.details.reason === 'payment_intent_identity_invalid');
});

test('refund-object ledgers read canonical PI and originating event without Stripe writes', async () => {
  const calls = [];
  const stripe = {
    paymentIntents: { retrieve: async (...args) => { calls.push(['pi', ...args]); return { id: 'pi_foundation' }; } },
    events: { retrieve: async (...args) => { calls.push(['event', ...args]); return { id: 'evt_foundation' }; } }
  };
  const evidence = await loadRebookCoverageEvidence({ _id: new mongoose.Types.ObjectId() }, [{
    provider: 'stripe', providerReference: 'pi_foundation', status: 'refunded',
    sourceReference: 'evt_foundation', metadata: { stripeObjectType: 'refund', stripeEventType: 'refund.updated' }
  }], { stripe });
  assert.deepEqual(calls, [
    ['pi', 'pi_foundation', { expand: ['latest_charge'] }],
    ['event', 'evt_foundation']
  ]);
  assert.deepEqual(evidence.stripeRefundEvents, [{ id: 'evt_foundation' }]);
});
