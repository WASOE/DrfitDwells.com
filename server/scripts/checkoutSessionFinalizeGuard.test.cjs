/**
 * CheckoutSession V2 finalization guard (C2D-B).
 *
 * Run: node --test server/scripts/checkoutSessionFinalizeGuard.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const { assertV2CheckoutSessionCanFinalize } = require('../routes/checkoutSessionRouteAdapter');
const { CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');

let mongoServer;

async function seedSession(overrides = {}) {
  const checkoutId = overrides.checkoutId || 'chk_finalize_guard_01';
  const doc = {
    checkoutId,
    flowVersion: overrides.flowVersion ?? 'v2',
    status: overrides.status ?? 'payment_required',
    paymentStatus: overrides.paymentStatus ?? 'unpaid',
    stayFingerprint: 'fp_stay_finalize_1',
    replayFingerprint: 'fp_replay_finalize_1',
    quoteSnapshotHash: 'hash_finalize_1',
    stripeAmountCents: overrides.stripeAmountCents ?? 10000,
    giftVoucherAppliedCents: overrides.giftVoucherAppliedCents ?? 0,
    sessionVersion: 1,
    canonicalPaymentIntentId:
      overrides.canonicalPaymentIntentId !== undefined
        ? overrides.canonicalPaymentIntentId
        : 'pi_canonical_guard_1',
    supersededPaymentIntentIds: overrides.supersededPaymentIntentIds ?? [],
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
    quoteSnapshot: overrides.quoteSnapshot ?? { fullVoucherCoverage: false }
  };
  return CheckoutSession.create({ ...doc, ...overrides, checkoutId });
}

async function expectCheckoutError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
});

test.beforeEach(async () => {
  await CheckoutSession.deleteMany({});
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('legacy checkoutId with no CheckoutSession does not apply guard', async () => {
  const result = await assertV2CheckoutSessionCanFinalize({
    checkoutId: 'chk_legacy_minted_no_doc',
    paymentIntentId: 'pi_any'
  });
  assert.equal(result.applied, false);
});

test('non-v2 CheckoutSession does not apply guard', async () => {
  const checkoutId = 'chk_finalize_legacy_flow';
  await seedSession({ checkoutId, flowVersion: 'legacy' });

  const result = await assertV2CheckoutSessionCanFinalize({
    checkoutId,
    paymentIntentId: null
  });
  assert.equal(result.applied, false);
});

test('V2 card session with matching canonical paymentIntentId passes', async () => {
  const checkoutId = 'chk_finalize_v2_match';
  await seedSession({
    checkoutId,
    canonicalPaymentIntentId: 'pi_match_ok',
    status: 'pi_active',
    paymentStatus: 'processing'
  });

  const result = await assertV2CheckoutSessionCanFinalize({
    checkoutId,
    paymentIntentId: 'pi_match_ok'
  });
  assert.equal(result.applied, true);
  assert.equal(result.noPaymentRequired, false);
});

test('V2 card session with wrong paymentIntentId rejects CANONICAL_PAYMENT_INTENT_MISMATCH', async () => {
  const checkoutId = 'chk_finalize_v2_wrong_pi';
  await seedSession({ checkoutId, canonicalPaymentIntentId: 'pi_canonical_guard_1' });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: 'pi_wrong_guest'
    }),
    CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH
  );
});

test('V2 card session with superseded paymentIntentId rejects SUPERSEDED_PAYMENT_INTENT', async () => {
  const checkoutId = 'chk_finalize_v2_superseded_pi';
  await seedSession({
    checkoutId,
    canonicalPaymentIntentId: 'pi_canonical_new',
    supersededPaymentIntentIds: ['pi_superseded_old']
  });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: 'pi_superseded_old'
    }),
    CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT
  );
});

test('V2 card session with missing paymentIntentId rejects CANONICAL_PAYMENT_INTENT_MISMATCH', async () => {
  const checkoutId = 'chk_finalize_v2_missing_pi';
  await seedSession({ checkoutId, canonicalPaymentIntentId: 'pi_required_1' });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: null
    }),
    CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH
  );
});

test('V2 voucher_only_reserved without canonical PI allows no paymentIntentId', async () => {
  const checkoutId = 'chk_finalize_v2_full_voucher';
  await seedSession({
    checkoutId,
    status: 'voucher_only_reserved',
    paymentStatus: 'not_required',
    canonicalPaymentIntentId: null,
    stripeAmountCents: 0,
    giftVoucherAppliedCents: 36000,
    quoteSnapshot: { fullVoucherCoverage: true }
  });

  const result = await assertV2CheckoutSessionCanFinalize({
    checkoutId,
    paymentIntentId: null
  });
  assert.equal(result.applied, true);
  assert.equal(result.noPaymentRequired, true);
});

test('V2 payment_not_required without canonical PI allows no paymentIntentId', async () => {
  const checkoutId = 'chk_finalize_v2_zero_due';
  await seedSession({
    checkoutId,
    status: 'payment_not_required',
    paymentStatus: 'not_required',
    canonicalPaymentIntentId: null,
    stripeAmountCents: 0
  });

  const result = await assertV2CheckoutSessionCanFinalize({
    checkoutId,
    paymentIntentId: null
  });
  assert.equal(result.applied, true);
  assert.equal(result.noPaymentRequired, true);
});

test('V2 payment_required without canonical PI rejects CHECKOUT_SESSION_NOT_USABLE', async () => {
  const checkoutId = 'chk_finalize_v2_no_pi_ready';
  await seedSession({
    checkoutId,
    status: 'payment_required',
    paymentStatus: 'unpaid',
    canonicalPaymentIntentId: null
  });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: null
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE
  );
});

test('V2 expired session rejects CHECKOUT_SESSION_EXPIRED', async () => {
  const checkoutId = 'chk_finalize_v2_expired';
  await seedSession({
    checkoutId,
    expiresAt: new Date(Date.now() - 60 * 1000)
  });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: 'pi_canonical_guard_1'
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED
  );
});

test('V2 superseded session status rejects CHECKOUT_SESSION_SUPERSEDED', async () => {
  const checkoutId = 'chk_finalize_v2_superseded_sess';
  await seedSession({
    checkoutId,
    status: 'superseded'
  });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: 'pi_canonical_guard_1'
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_SUPERSEDED
  );
});

test('V2 needs_review session rejects CHECKOUT_SESSION_NOT_USABLE', async () => {
  const checkoutId = 'chk_finalize_v2_needs_review';
  await seedSession({
    checkoutId,
    status: 'needs_review'
  });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId: 'pi_canonical_guard_1'
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE
  );
});

test('V2 finalized checkout session rejects before booking creation', async () => {
  const checkoutId = 'chk_finalize_v2_finalized';
  const paymentIntentId = 'pi_finalized_guard';
  await seedSession({
    checkoutId,
    flowVersion: 'v2',
    status: 'pi_active',
    paymentStatus: 'paid',
    finalizeStatus: 'finalized',
    canonicalPaymentIntentId: paymentIntentId
  });

  await expectCheckoutError(
    assertV2CheckoutSessionCanFinalize({
      checkoutId,
      paymentIntentId
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE
  );
});

test('bookingRoutes wires assertV2CheckoutSessionCanFinalize before Stripe verify', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '../routes/bookingRoutes.js'),
    'utf8'
  );
  const guardIdx = source.indexOf('assertV2CheckoutSessionCanFinalize');
  const stripeVerifyIdx = source.indexOf('// Verify Stripe payment if paymentIntentId is provided');
  assert.ok(guardIdx > 0, 'guard call missing from bookingRoutes');
  assert.ok(stripeVerifyIdx > guardIdx, 'guard must appear before Stripe payment verification');
  const bookingCreateIdx = source.indexOf('new Booking(');
  assert.ok(bookingCreateIdx > guardIdx, 'guard must appear before Booking creation');
});
