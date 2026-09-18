/**
 * B8F2B1B — Attempt-fenced voucher reservations (MongoMemoryServer).
 * Real fence + ledger services. No orchestrator / PI / routes / B8F2B2.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const CheckoutResourceAttempt = require('../models/CheckoutResourceAttempt');

const {
  acquireCheckoutResourceAttemptFence,
  failCheckoutResourceAttemptFence,
  ensureCheckoutResourceAttemptIndexesForTests,
  FENCE_ERROR_CODES
} = require('../services/checkout/checkoutResourceAttemptFenceService');

const {
  reserveVoucherAmountV1,
  releaseVoucherRedemptionV1,
  confirmVoucherRedemptionV1,
  recoverVoucherRedemptionV1,
  expireVoucherRedemptionsV1,
  ensureVoucherLedgerIndexesForTests,
  debitPendingLedgerOperationV1,
  claimPendingLedgerOperationV1,
  transferLedgerOperationMarkerV1,
  findEmbeddedOperation,
  buildOperationId,
  VOUCHER_RESERVATION_IN_PROGRESS,
  __setAfterV1PendingOpClaimHookForTests,
  __setBeforeV1PendingOpClaimHookForTests,
  __setAfterV1OpMarkerTransferHookForTests,
  __setAfterV1SealPartialClearHookForTests,
  __setAfterV1CompensationPartialHookForTests,
  __setBeforeV1CompensationReleaseCasHookForTests,
  __setBeforeV1SealRedemptionClearHookForTests,
  __setBeforeV1ConfirmCasHookForTests
} = require('../services/giftVouchers/giftVoucherLedgerService');

const {
  reserveExactVoucherAmountForAttempt,
  assertAttemptVoucherReservationActive,
  releaseAttemptVoucherReservation,
  sealAttemptVoucherReservation,
  listCurrentAttemptVoucherMarkers,
  buildAttemptReservationKey,
  VOUCHER_COMPENSATION_INCOMPLETE,
  VOUCHER_COMPENSATION_SEAL_COMPLETED,
  VOUCHER_COMPENSATION_STATE_UNPROVEN,
  VOUCHER_MARKER_CLEAR_INCOMPLETE,
  VOUCHER_IDENTITY_MISMATCH,
  VOUCHER_ATTEMPT_IN_PROGRESS,
  VOUCHER_ATTEMPT_REFERENCE_INVALID,
  VOUCHER_ATTEMPT_MARKER_MISMATCH,
  __setBeforeMarkerlessClassifyHookForTests,
  __setAfterAttemptPendingMarkedHookForTests,
  __setAfterAttemptPreDebitFenceHookForTests,
  __setAfterAttemptDebitHookForTests,
  __setAfterAttemptReservedCasHookForTests,
  __setAfterAttemptRestoreBeforeEventHookForTests,
  __setAfterAttemptEventBeforeMarkerClearHookForTests,
  __setAfterAttemptFirstMarkerClearHookForTests
} = require('../services/giftVouchers/giftVoucherAttemptReservationService');

const NOW = new Date('2026-09-09T12:00:00.000Z');
const BUNDLE_UNTIL = new Date('2026-09-09T12:25:00.000Z');
const VOUCHER_EXPIRY = new Date('2027-06-01T00:00:00.000Z');
const SNAP = 'snap-b8f2b1b-aaaa';
const SNAP_B = 'snap-b8f2b1b-bbbb';

let mongoServer;
let voucherSeq = 0;

function code() {
  voucherSeq += 1;
  const n = String(voucherSeq).padStart(4, '0');
  return `DD-A2B3-C4D5-${n}`;
}

async function createVoucher(overrides = {}) {
  const c = Object.prototype.hasOwnProperty.call(overrides, 'code') ? overrides.code : code();
  return GiftVoucher.create({
    code: c,
    amountOriginalCents: 20000,
    balanceRemainingCents: 20000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: VOUCHER_EXPIRY,
    reservationLedgerOperations: [],
    ...overrides,
    code: c
  });
}

async function acquireFence({
  checkoutId,
  quoteSnapshotHash = SNAP,
  bundleValidUntil = BUNDLE_UNTIL,
  now = NOW
} = {}) {
  return acquireCheckoutResourceAttemptFence(
    { checkoutId, quoteSnapshotHash, bundleValidUntil },
    { now }
  );
}

async function failFence(fence, now = NOW) {
  return failCheckoutResourceAttemptFence(
    { checkoutId: fence.checkoutId, attemptId: fence.attemptId, failureCode: 'TEST_FAIL' },
    { now }
  );
}

describe('B8F2B1B attempt-fenced voucher reservations', () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
    await GiftVoucher.syncIndexes();
    await GiftVoucherRedemption.syncIndexes();
    await GiftVoucherEvent.syncIndexes();
    await CheckoutResourceAttempt.syncIndexes();
    await ensureCheckoutResourceAttemptIndexesForTests();
    await ensureVoucherLedgerIndexesForTests();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    __setAfterV1PendingOpClaimHookForTests(null);
    __setBeforeV1PendingOpClaimHookForTests(null);
    __setAfterV1OpMarkerTransferHookForTests(null);
    __setAfterV1SealPartialClearHookForTests(null);
    __setAfterV1CompensationPartialHookForTests(null);
    __setBeforeV1CompensationReleaseCasHookForTests(null);
    __setBeforeV1SealRedemptionClearHookForTests(null);
    __setBeforeV1ConfirmCasHookForTests(null);
    __setBeforeMarkerlessClassifyHookForTests(null);
    __setAfterAttemptPendingMarkedHookForTests(null);
    __setAfterAttemptPreDebitFenceHookForTests(null);
    __setAfterAttemptDebitHookForTests(null);
    __setAfterAttemptReservedCasHookForTests(null);
    __setAfterAttemptRestoreBeforeEventHookForTests(null);
    __setAfterAttemptEventBeforeMarkerClearHookForTests(null);
    __setAfterAttemptFirstMarkerClearHookForTests(null);
    await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
    await GiftVoucherRedemption.deleteMany({});
    await GiftVoucher.deleteMany({});
    await CheckoutResourceAttempt.deleteMany({});
  });

  it('1-5: creates marked redemption + pending then debit once; retry idempotent', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_01' });
    let pendingSeen = false;
    __setAfterV1PendingOpClaimHookForTests(async () => {
      const v = await GiftVoucher.findById(voucher._id).lean();
      const op = v.reservationLedgerOperations[0];
      assert.equal(op.state, 'pending');
      assert.equal(op.acquisitionAttemptId, fence.attemptId);
      assert.equal(v.balanceRemainingCents, 20000);
      pendingSeen = true;
    });

    const r1 = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 2500,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(pendingSeen, true);
    assert.equal(r1.outcome, 'created');
    assert.equal(r1.acquisitionAttemptId, fence.attemptId);
    assert.equal(new Date(r1.expiresAt).getTime(), BUNDLE_UNTIL.getTime());

    const mid = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(mid.balanceRemainingCents, 17500);
    const op = mid.reservationLedgerOperations[0];
    assert.equal(op.state, 'debited');
    assert.equal(op.acquisitionAttemptId, fence.attemptId);

    const red = await GiftVoucherRedemption.findById(r1.redemptionId).lean();
    assert.equal(red.status, 'reserved');
    assert.equal(red.acquisitionAttemptId, fence.attemptId);
    assert.equal(red.voucherCode, voucher.code);
    assert.equal(red.quoteSnapshotHash, SNAP);

    const r2 = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 2500,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.ok(['resumed', 'renewed'].includes(r2.outcome));
    assert.equal(r2.redemptionId, r1.redemptionId);
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 17500);
    assert.equal(after.reservationLedgerOperations.length, 1);
  });

  it('6: same-attempt pending recovery completes debit', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_06' });
    let calls = 0;
    __setAfterV1PendingOpClaimHookForTests(async ({ operationId }) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('injected_after_pending_claim');
        err.code = 'INJECTED';
        throw err;
      }
      void operationId;
    });

    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1800,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED'
    );

    const mid = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(mid.balanceRemainingCents, 20000);
    assert.equal(mid.reservationLedgerOperations[0].state, 'pending');

    __setAfterV1PendingOpClaimHookForTests(null);
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1800,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.ok(['resumed', 'renewed', 'created'].includes(r.outcome));
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 18200);
    assert.equal(after.reservationLedgerOperations[0].state, 'debited');
  });

  it('7: live A blocks B', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_07' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1000,
        currency: 'EUR'
      },
      { now: NOW }
    );

    await assert.rejects(
      () => acquireFence({ checkoutId: 'chk_b8f2b1b_07' }),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_IN_PROGRESS
    );
  });

  it('8-10,19: dead A permits takeover; op before redemption; crash recovers; adopts old key', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_08' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 2200,
        currency: 'EUR'
      },
      { now: NOW }
    );
    const oldKey = a.reservationKey;
    await failFence(fenceA);

    let transferOrder = [];
    __setAfterV1OpMarkerTransferHookForTests(async () => {
      transferOrder.push('op');
      const red = await GiftVoucherRedemption.findById(a.redemptionId).lean();
      transferOrder.push(`red:${red.acquisitionAttemptId}`);
      const err = new Error('crash_between_transfers');
      err.code = 'INJECTED_TRANSFER_CRASH';
      throw err;
    });

    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_08' });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 2200,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_TRANSFER_CRASH'
    );
    assert.equal(transferOrder[0], 'op');
    assert.equal(transferOrder[1], `red:${fenceA.attemptId}`);

    const midV = await GiftVoucher.findById(voucher._id).lean();
    const midOp = midV.reservationLedgerOperations[0];
    assert.equal(midOp.acquisitionAttemptId, fenceB.attemptId);
    const midR = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    assert.equal(midR.acquisitionAttemptId, fenceA.attemptId);

    __setAfterV1OpMarkerTransferHookForTests(null);
    const b = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 2200,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(b.outcome, 'taken_over');
    assert.equal(b.reservationKey, oldKey);
    assert.equal(b.redemptionId, a.redemptionId);
    assert.notEqual(
      b.reservationKey,
      buildAttemptReservationKey({
        checkoutId: fenceB.checkoutId,
        attemptId: fenceB.attemptId,
        giftVoucherId: voucher._id,
        amountCents: 2200,
        currency: 'EUR',
        quoteSnapshotHash: SNAP
      })
    );
  });

  it('11-14,46: A cannot debit/restore/release/seal after transfer; stale A no success', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_11' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1500,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await failFence(fenceA);
    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_11' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1500,
        currency: 'EUR'
      },
      { now: NOW }
    );

    await assert.rejects(
      () =>
        debitPendingLedgerOperationV1({
          giftVoucherId: voucher._id,
          redemptionId: a.redemptionId,
          operationId: a.operationId,
          reservationKey: a.reservationKey,
          amountCents: 1500,
          currency: 'EUR',
          acquisitionAttemptId: fenceA.attemptId,
          now: NOW
        }),
      (e) => e.code === VOUCHER_ATTEMPT_MARKER_MISMATCH
    );

    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fenceA.checkoutId,
            acquisitionAttemptId: fenceA.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );

    await assert.rejects(
      () =>
        sealAttemptVoucherReservation(
          {
            checkoutId: fenceA.checkoutId,
            acquisitionAttemptId: fenceA.attemptId,
            quoteSnapshotHash: SNAP,
            redemptionId: a.redemptionId
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );

    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fenceA.checkoutId,
            acquisitionAttemptId: fenceA.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1500,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );
  });

  it('15-17: missing / cross-checkout / malformed attempt fail closed', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_15' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 900,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await failFence(fence);
    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_15' });

    await GiftVoucherRedemption.updateOne(
      { checkoutId: 'chk_b8f2b1b_15', status: 'reserved' },
      { $set: { acquisitionAttemptId: 'missing_attempt_zzz' } }
    );
    await GiftVoucher.updateOne(
      { _id: voucher._id },
      { $set: { 'reservationLedgerOperations.0.acquisitionAttemptId': 'missing_attempt_zzz' } }
    );

    let missingErr = null;
    try {
      await reserveExactVoucherAmountForAttempt(
        {
          checkoutId: fenceB.checkoutId,
          acquisitionAttemptId: fenceB.attemptId,
          quoteSnapshotHash: SNAP,
          voucherCode: voucher.code,
          amountCents: 900,
          currency: 'EUR'
        },
        { now: NOW }
      );
    } catch (err) {
      missingErr = err;
    }
    assert.ok(missingErr, 'expected missing attempt to fail');
    assert.equal(missingErr.code, VOUCHER_ATTEMPT_REFERENCE_INVALID);

    await GiftVoucherRedemption.updateOne(
      { checkoutId: 'chk_b8f2b1b_15' },
      { $set: { acquisitionAttemptId: 'cross_checkout_attempt_yyy' } }
    );
    await GiftVoucher.updateOne(
      { _id: voucher._id },
      { $set: { 'reservationLedgerOperations.0.acquisitionAttemptId': 'cross_checkout_attempt_yyy' } }
    );
    await CheckoutResourceAttempt.create({
      attemptId: 'cross_checkout_attempt_yyy',
      checkoutId: 'chk_OTHER_CHECKOUT_XX',
      quoteSnapshotHash: SNAP,
      generation: 99,
      status: 'failed',
      isLive: false,
      startedAt: NOW,
      bundleValidUntil: BUNDLE_UNTIL
    });

    let crossErr = null;
    try {
      await reserveExactVoucherAmountForAttempt(
        {
          checkoutId: fenceB.checkoutId,
          acquisitionAttemptId: fenceB.attemptId,
          quoteSnapshotHash: SNAP,
          voucherCode: voucher.code,
          amountCents: 900,
          currency: 'EUR'
        },
        { now: NOW }
      );
    } catch (err) {
      crossErr = err;
    }
    assert.ok(crossErr, 'expected cross-checkout attempt to fail');
    assert.equal(crossErr.code, VOUCHER_ATTEMPT_REFERENCE_INVALID);

    let malformedErr = null;
    try {
      await reserveExactVoucherAmountForAttempt(
        {
          checkoutId: fenceB.checkoutId,
          acquisitionAttemptId: '   ',
          quoteSnapshotHash: SNAP,
          voucherCode: voucher.code,
          amountCents: 900,
          currency: 'EUR'
        },
        { now: NOW }
      );
    } catch (err) {
      malformedErr = err;
    }
    assert.ok(malformedErr, 'expected malformed attempt to fail');
    assert.ok(
      ['INVALID_ATTEMPT_RESERVE_INPUT', FENCE_ERROR_CODES.RESOURCE_BUNDLE_INVALID_INPUT].includes(
        malformedErr.code
      ) || malformedErr.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );
  });

  it('18: new attempt after terminal uses new key', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_18' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1100,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await releaseAttemptVoucherReservation(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    const terminal = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    assert.ok(['released', 'voided'].includes(terminal.status));

    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_18' });
    const b = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1100,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(b.outcome, 'created');
    assert.notEqual(b.reservationKey, a.reservationKey);
    assert.notEqual(b.redemptionId, a.redemptionId);
  });

  it('20-21: sealed reuse without retag; not compensable', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_20' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1300,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await sealAttemptVoucherReservation(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: a.redemptionId
      },
      { now: NOW }
    );
    await failCheckoutResourceAttemptFence(
      {
        checkoutId: fenceA.checkoutId,
        attemptId: fenceA.attemptId,
        failureCode: 'AFTER_SEAL'
      },
      { now: NOW }
    );

    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_20' });
    const reused = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1300,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(reused.outcome, 'reused');
    assert.equal(reused.compensable, false);
    assert.equal(reused.acquisitionAttemptId, null);
    const red = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    assert.equal(red.acquisitionAttemptId, null);
    const v = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(v.reservationLedgerOperations[0].acquisitionAttemptId, null);

    // B failure must not release sealed; completed seal rejects compensation.
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_SEAL_COMPLETED
    );
    const still = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    assert.equal(still.status, 'reserved');
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 18700);
    const fenceBLive = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
    assert.equal(fenceBLive.isLive, true);
    assert.equal(fenceBLive.status, 'open');
    assert.ok(fenceBLive.failureCode == null);
  });

  it('22-26: identity mismatches fail closed', async () => {
    const voucher = await createVoucher();
    const other = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_22' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1400,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await sealAttemptVoucherReservation(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: a.redemptionId
      },
      { now: NOW }
    );
    await failFence(fenceA);
    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_22' });

    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1401,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_IDENTITY_MISMATCH
    );
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: other.code,
            amountCents: 1400,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_IDENTITY_MISMATCH
    );
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP_B,
            voucherCode: voucher.code,
            amountCents: 1400,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) =>
        e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST ||
        e.message.includes('quoteSnapshotHash')
    );
  });

  it('27-30: expiry equals bundleValidUntil; never shorten; renew short; expired fence rejected', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_27' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1000,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(new Date(r.expiresAt).getTime(), BUNDLE_UNTIL.getTime());

    const later = new Date('2026-09-09T13:00:00.000Z');
    await GiftVoucherRedemption.updateOne(
      { _id: r.redemptionId },
      { $set: { expiresAt: later } }
    );
    const r2 = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1000,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(new Date(r2.expiresAt).getTime(), later.getTime());

    await GiftVoucherRedemption.updateOne(
      { _id: r.redemptionId },
      { $set: { expiresAt: new Date('2026-09-09T12:10:00.000Z') } }
    );
    const r3 = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1000,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(new Date(r3.expiresAt).getTime(), BUNDLE_UNTIL.getTime());
    assert.ok(['renewed', 'resumed'].includes(r3.outcome));

    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1000,
            currency: 'EUR'
          },
          { now: new Date(BUNDLE_UNTIL.getTime() + 1000) }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );
  });

  it('31-33: tokenless release/confirm/recover cannot touch marked state', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_31' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1600,
        currency: 'EUR'
      },
      { now: NOW }
    );

    await assert.rejects(
      () => releaseVoucherRedemptionV1({ redemptionId: r.redemptionId, now: NOW }),
      (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
    );
    await assert.rejects(
      () => confirmVoucherRedemptionV1({ redemptionId: r.redemptionId, now: NOW }),
      (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
    );
    await assert.rejects(
      () => recoverVoucherRedemptionV1({ redemptionId: r.redemptionId, now: NOW }),
      (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 18400);
  });

  it('34-37: compensation restores once; pending voids durably; stale cannot recreate', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_34' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1700,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    const op = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0];
    assert.equal(op.state, 'restored');
    assert.equal(op.acquisitionAttemptId, null);

    // Pending void path
    const fence2 = await acquireFence({ checkoutId: 'chk_b8f2b1b_36' });
    const voucher2 = await createVoucher();
    let once = false;
    __setAfterV1PendingOpClaimHookForTests(async () => {
      if (!once) {
        once = true;
        const err = new Error('stop_before_debit');
        err.code = 'INJECTED';
        throw err;
      }
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence2.checkoutId,
            acquisitionAttemptId: fence2.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher2.code,
            amountCents: 500,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED'
    );
    __setAfterV1PendingOpClaimHookForTests(null);
    await releaseAttemptVoucherReservation(
      {
        checkoutId: fence2.checkoutId,
        acquisitionAttemptId: fence2.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    const v2 = await GiftVoucher.findById(voucher2._id).lean();
    assert.equal(v2.balanceRemainingCents, 20000);
    assert.equal(v2.reservationLedgerOperations[0].state, 'voided');

    await assert.rejects(
      () =>
        debitPendingLedgerOperationV1({
          giftVoucherId: voucher2._id,
          redemptionId: v2.reservationLedgerOperations[0].redemptionId,
          operationId: v2.reservationLedgerOperations[0].operationId,
          reservationKey: v2.reservationLedgerOperations[0].reservationKey,
          amountCents: 500,
          currency: 'EUR',
          acquisitionAttemptId: fence2.attemptId,
          now: NOW
        }),
      (e) => e.code === 'VOUCHER_LEDGER_INTEGRITY' || e.code === VOUCHER_ATTEMPT_MARKER_MISMATCH
    );
    void r;
  });

  it('38-39: fence loss prevents compensation; partial compensation keeps fence live', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_38' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 800,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await failFence(fence);
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 19200);

    const fence2 = await acquireFence({ checkoutId: 'chk_b8f2b1b_39' });
    const voucher2 = await createVoucher();
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence2.checkoutId,
        acquisitionAttemptId: fence2.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher2.code,
        amountCents: 800,
        currency: 'EUR'
      },
      { now: NOW }
    );
    __setAfterV1CompensationPartialHookForTests(async () => {
      const err = new Error('partial_comp');
      err.code = 'INJECTED_PARTIAL';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence2.checkoutId,
            acquisitionAttemptId: fence2.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_INCOMPLETE || e.code === 'INJECTED_PARTIAL'
    );
    const attempt = await CheckoutResourceAttempt.findOne({ attemptId: fence2.attemptId }).lean();
    assert.equal(attempt.isLive, true);
    assert.equal(attempt.status, 'open');
  });

  it('40-42: seal clears both markers; partial seal keeps live; retry repairs', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_40' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 750,
        currency: 'EUR'
      },
      { now: NOW }
    );

    __setAfterV1SealPartialClearHookForTests(async () => {
      const err = new Error('seal_partial');
      err.code = 'INJECTED_SEAL';
      throw err;
    });
    await assert.rejects(
      () =>
        sealAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            redemptionId: r.redemptionId
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_SEAL' || e.code === VOUCHER_MARKER_CLEAR_INCOMPLETE
    );
    const midRed = await GiftVoucherRedemption.findById(r.redemptionId).lean();
    assert.equal(midRed.acquisitionAttemptId, null);
    const midOp = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0];
    assert.equal(midOp.acquisitionAttemptId, fence.attemptId);
    const live = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(live.isLive, true);

    __setAfterV1SealPartialClearHookForTests(null);
    const sealed = await sealAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: r.redemptionId
      },
      { now: NOW }
    );
    assert.equal(sealed.sealed, true);
    assert.equal(sealed.acquisitionAttemptId, null);
    const op = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0];
    assert.equal(op.acquisitionAttemptId, null);
  });

  it('43-45: system expiry restores marked debit / voids pending; pre-expiry no-op', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_43' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 950,
        currency: 'EUR'
      },
      { now: NOW }
    );

    const pre = await expireVoucherRedemptionsV1({ now: NOW, limit: 10 });
    assert.equal(pre.scanned, 0);

    const afterExpiry = new Date(BUNDLE_UNTIL.getTime() + 1000);
    const exp = await expireVoucherRedemptionsV1({ now: afterExpiry, limit: 10 });
    assert.ok(exp.released + exp.voided >= 1);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    const red = await GiftVoucherRedemption.findById(r.redemptionId).lean();
    assert.equal(red.status, 'released');
    assert.equal(red.acquisitionAttemptId, null);

    // pending void via expiry
    const voucher2 = await createVoucher();
    const fence2 = await acquireFence({ checkoutId: 'chk_b8f2b1b_44' });
    __setAfterV1PendingOpClaimHookForTests(async () => {
      const err = new Error('stop');
      err.code = 'INJECTED';
      throw err;
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence2.checkoutId,
            acquisitionAttemptId: fence2.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher2.code,
            amountCents: 400,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED'
    );
    __setAfterV1PendingOpClaimHookForTests(null);
    const pendingRed = await GiftVoucherRedemption.findOne({
      checkoutId: fence2.checkoutId,
      status: 'pending_debit'
    }).lean();
    await GiftVoucherRedemption.updateOne(
      { _id: pendingRed._id },
      { $set: { expiresAt: BUNDLE_UNTIL } }
    );
    const exp2 = await expireVoucherRedemptionsV1({ now: afterExpiry, limit: 10 });
    assert.ok(exp2.voided >= 1);
    const v2 = await GiftVoucher.findById(voucher2._id).lean();
    assert.equal(v2.balanceRemainingCents, 20000);
    assert.equal(v2.reservationLedgerOperations[0].state, 'voided');
  });

  it('47-49: no orchestrator/PI/route wiring in allowlisted creations; unmarked B8F2B1A still works', async () => {
    const attemptSrc = fs.readFileSync(
      path.join(__dirname, '../services/giftVouchers/giftVoucherAttemptReservationService.js'),
      'utf8'
    );
    assert.equal(/resourceAttemptOrchestrator/.test(attemptSrc), false);
    assert.equal(/require\(['"][^'"]*stripe/i.test(attemptSrc), false);
    assert.equal(/bookingRoutes/.test(attemptSrc), false);
    assert.equal(/checkoutCanonicalPaymentIntent/i.test(attemptSrc), false);

    const voucher = await createVoucher({ code: null });
    const unmarked = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2000,
      currency: 'EUR',
      reservationKey: 'rk-unmarked-b8f2b1b',
      checkoutId: 'chk_unmarked_only',
      expiresAt: BUNDLE_UNTIL,
      now: NOW
    });
    assert.equal(unmarked.ok, true);
    const red = await GiftVoucherRedemption.findById(unmarked.redemptionId).lean();
    assert.equal(red.acquisitionAttemptId, null);
    const op = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0];
    assert.equal(op.state, 'debited');
    assert.equal(op.acquisitionAttemptId, null);
  });

  it('assertAttemptVoucherReservationActive and list markers', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_assert' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 600,
        currency: 'EUR'
      },
      { now: NOW }
    );
    const active = await assertAttemptVoucherReservationActive(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: r.redemptionId
      },
      { now: NOW }
    );
    assert.equal(active.ok, true);
    const markers = await listCurrentAttemptVoucherMarkers({
      checkoutId: fence.checkoutId,
      acquisitionAttemptId: fence.attemptId
    });
    assert.equal(markers.length, 1);
    assert.equal(markers[0].redemptionMarker, fence.attemptId);
  });

  function defer() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('CORR: A/B race operation creation — one op; stale A cannot debit after B owns', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_race_op' });

    __setBeforeV1PendingOpClaimHookForTests(async () => {
      const err = new Error('stop_before_claim');
      err.code = 'INJECTED_NO_OP';
      throw err;
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fenceA.checkoutId,
            acquisitionAttemptId: fenceA.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1800,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_NO_OP'
    );
    __setBeforeV1PendingOpClaimHookForTests(null);

    const pendingRed = await GiftVoucherRedemption.findOne({
      checkoutId: fenceA.checkoutId,
      status: 'pending_debit'
    }).lean();
    assert.ok(pendingRed);
    assert.equal(pendingRed.acquisitionAttemptId, fenceA.attemptId);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations.length,
      0
    );
    await failFence(fenceA);

    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_race_op' });
    const aAtClaim = defer();
    const bAtClaim = defer();
    const releaseClaims = defer();

    __setBeforeV1PendingOpClaimHookForTests(async (payload) => {
      const id = String(payload.acquisitionAttemptId || '');
      if (id === fenceA.attemptId) aAtClaim.resolve();
      if (id === fenceB.attemptId) bAtClaim.resolve();
      await releaseClaims.promise;
    });

    const bReserve = reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1800,
        currency: 'EUR'
      },
      { now: NOW }
    );

    const aRace = (async () => {
      const claim = await claimPendingLedgerOperationV1({
        giftVoucherId: voucher._id,
        redemptionId: pendingRed._id,
        operationId: pendingRed.operationId,
        reservationKey: pendingRed.reservationKey,
        amountCents: 1800,
        currency: 'EUR',
        acquisitionAttemptId: fenceA.attemptId,
        now: NOW
      });
      if (claim.ok) {
        try {
          return await debitPendingLedgerOperationV1({
            giftVoucherId: voucher._id,
            redemptionId: pendingRed._id,
            operationId: pendingRed.operationId,
            reservationKey: pendingRed.reservationKey,
            amountCents: 1800,
            currency: 'EUR',
            acquisitionAttemptId: fenceA.attemptId,
            now: NOW
          });
        } catch (err) {
          return { ok: false, error: err };
        }
      }
      return claim;
    })();

    await Promise.all([aAtClaim.promise, bAtClaim.promise]);
    releaseClaims.resolve();

    const [bSettled, aSettled] = await Promise.allSettled([bReserve, aRace]);
    assert.equal(bSettled.status, 'fulfilled');
    assert.equal(bSettled.value.ok, true);
    assert.equal(bSettled.value.acquisitionAttemptId, fenceB.attemptId);

    const v = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(v.reservationLedgerOperations.length, 1);
    assert.equal(v.balanceRemainingCents, 18200);
    const op = v.reservationLedgerOperations[0];
    assert.equal(op.state, 'debited');
    assert.equal(op.acquisitionAttemptId, fenceB.attemptId);

    const red = await GiftVoucherRedemption.findById(pendingRed._id).lean();
    assert.equal(red.acquisitionAttemptId, fenceB.attemptId);
    assert.equal(red.status, 'reserved');

    // Stale A cannot debit after B owns the operation
    await assert.rejects(
      () =>
        debitPendingLedgerOperationV1({
          giftVoucherId: voucher._id,
          redemptionId: pendingRed._id,
          operationId: pendingRed.operationId,
          reservationKey: pendingRed.reservationKey,
          amountCents: 1800,
          currency: 'EUR',
          acquisitionAttemptId: fenceA.attemptId,
          now: NOW
        }),
      (e) => e.code === VOUCHER_ATTEMPT_MARKER_MISMATCH || e.code === 'VOUCHER_ATTEMPT_MARKER_MISMATCH'
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 18200);
    void aSettled;
  });

  it('CORR: seal wins vs compensate — reserved unmarked, debited, balance held', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_seal_wins' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1100,
        currency: 'EUR'
      },
      { now: NOW }
    );
    const fenceBefore = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();

    const sealAtClear = defer();
    const compAtRelease = defer();
    const releaseSeal = defer();
    const releaseComp = defer();
    const sealDone = defer();

    __setBeforeV1SealRedemptionClearHookForTests(async () => {
      sealAtClear.resolve();
      await releaseSeal.promise;
    });
    __setBeforeV1CompensationReleaseCasHookForTests(async () => {
      compAtRelease.resolve();
      await releaseComp.promise;
    });

    const sealP = sealAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: r.redemptionId
      },
      { now: NOW }
    ).then((res) => {
      sealDone.resolve(res);
      return res;
    });

    const compP = releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );

    await Promise.all([sealAtClear.promise, compAtRelease.promise]);
    // Seal proceeds first and completes before compensation CAS
    releaseSeal.resolve();
    const sealed = await sealDone.promise;
    assert.equal(sealed.sealed, true);
    releaseComp.resolve();

    const compSettled = await Promise.allSettled([compP]);
    assert.equal(compSettled[0].status, 'rejected');
    assert.equal(compSettled[0].reason.code, VOUCHER_COMPENSATION_SEAL_COMPLETED);

    const red = await GiftVoucherRedemption.findById(r.redemptionId).lean();
    const v = await GiftVoucher.findById(voucher._id).lean();
    const op = v.reservationLedgerOperations[0];
    assert.equal(red.status, 'reserved');
    assert.equal(red.acquisitionAttemptId, null);
    assert.equal(op.state, 'debited');
    assert.equal(op.acquisitionAttemptId, null);
    assert.equal(v.balanceRemainingCents, 18900);
    // Forbidden: restored after seal
    assert.notEqual(op.state, 'restored');

    const fenceAfter = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceAfter.status, 'open');
    assert.equal(fenceAfter.isLive, true);
    assert.ok(fenceAfter.failureCode == null);
    assert.equal(String(fenceAfter.attemptId), String(fenceBefore.attemptId));
    assert.equal(String(fenceAfter.checkoutId), String(fenceBefore.checkoutId));
    assert.equal(fenceAfter.generation, fenceBefore.generation);
    assert.equal(String(fenceAfter.quoteSnapshotHash), String(fenceBefore.quoteSnapshotHash));
    assert.equal(
      new Date(fenceAfter.bundleValidUntil).getTime(),
      new Date(fenceBefore.bundleValidUntil).getTime()
    );

    const releaseEvents = await GiftVoucherEvent.find({
      redemptionId: r.redemptionId,
      type: 'redeemed_released'
    }).lean();
    assert.equal(releaseEvents.length, 0);

    const replayBefore = {
      status: red.status,
      redMarker: red.acquisitionAttemptId,
      opState: op.state,
      opMarker: op.acquisitionAttemptId,
      balance: v.balanceRemainingCents
    };
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
            // default failFence: true
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_SEAL_COMPLETED
    );
    const redReplay = await GiftVoucherRedemption.findById(r.redemptionId).lean();
    const vReplay = await GiftVoucher.findById(voucher._id).lean();
    const opReplay = vReplay.reservationLedgerOperations[0];
    assert.deepEqual(
      {
        status: redReplay.status,
        redMarker: redReplay.acquisitionAttemptId,
        opState: opReplay.state,
        opMarker: opReplay.acquisitionAttemptId,
        balance: vReplay.balanceRemainingCents
      },
      replayBefore
    );

    const fenceAfterReplay = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceAfterReplay.status, 'open');
    assert.equal(fenceAfterReplay.isLive, true);
    assert.ok(fenceAfterReplay.failureCode == null);

    await sealP;
  });

  it('CORR: compensate wins vs seal — released+restored; seal no success', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_comp_wins' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1200,
        currency: 'EUR'
      },
      { now: NOW }
    );

    const sealAtClear = defer();
    const compAtRelease = defer();
    const releaseSeal = defer();
    const releaseComp = defer();
    const compDone = defer();

    __setBeforeV1SealRedemptionClearHookForTests(async () => {
      sealAtClear.resolve();
      await releaseSeal.promise;
    });
    __setBeforeV1CompensationReleaseCasHookForTests(async () => {
      compAtRelease.resolve();
      await releaseComp.promise;
    });

    const sealP = sealAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: r.redemptionId
      },
      { now: NOW }
    );

    const compP = releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    ).then((res) => {
      compDone.resolve(res);
      return res;
    });

    await Promise.all([sealAtClear.promise, compAtRelease.promise]);
    // Compensation proceeds first
    releaseComp.resolve();
    const released = await compDone.promise;
    assert.equal(released.released, true);
    releaseSeal.resolve();

    const sealSettled = await Promise.allSettled([sealP]);
    assert.equal(sealSettled[0].status, 'rejected');
    assert.ok(
      sealSettled[0].reason.code === VOUCHER_MARKER_CLEAR_INCOMPLETE ||
        sealSettled[0].reason.code === 'VOUCHER_RESERVATION_INACTIVE'
    );

    const red = await GiftVoucherRedemption.findById(r.redemptionId).lean();
    const v = await GiftVoucher.findById(voucher._id).lean();
    const op = v.reservationLedgerOperations[0];
    assert.equal(red.status, 'released');
    assert.equal(op.state, 'restored');
    assert.equal(v.balanceRemainingCents, 20000);
    // Forbidden state must not occur
    assert.notEqual(red.status === 'reserved' && !red.acquisitionAttemptId && op.state === 'restored', true);
    await compP;
  });

  it('CORR: tokenless reserveVoucherAmountV1 cannot touch marked state', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_tokenless' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1300,
        currency: 'EUR'
      },
      { now: NOW }
    );

    const snapshot = async () => {
      const red = await GiftVoucherRedemption.findById(r.redemptionId).lean();
      const v = await GiftVoucher.findById(voucher._id).lean();
      const op = v.reservationLedgerOperations[0];
      return {
        balance: v.balanceRemainingCents,
        status: red.status,
        redMarker: red.acquisitionAttemptId,
        opState: op.state,
        opMarker: op.acquisitionAttemptId
      };
    };

    const before = await snapshot();
    assert.equal(before.status, 'reserved');
    assert.equal(before.redMarker, fence.attemptId);
    assert.equal(before.opMarker, fence.attemptId);

    // 1. Replay marked reserved
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1300,
          currency: 'EUR',
          reservationKey: r.reservationKey,
          checkoutId: fence.checkoutId,
          expiresAt: BUNDLE_UNTIL,
          now: NOW
        }),
      (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
    );
    assert.deepEqual(await snapshot(), before);

    // 2–5. Marked pending: resume / debit / advance / clear blocked
    await GiftVoucherRedemption.updateOne(
      { _id: r.redemptionId },
      { $set: { status: 'pending_debit' } }
    );
    await GiftVoucher.updateOne(
      { _id: voucher._id, 'reservationLedgerOperations.operationId': r.operationId },
      {
        $set: {
          'reservationLedgerOperations.$.state': 'pending',
          balanceRemainingCents: 20000
        },
        $unset: { 'reservationLedgerOperations.$.debitedAt': '' }
      }
    );
    // Re-mark (already marked)
    await GiftVoucherRedemption.updateOne(
      { _id: r.redemptionId },
      { $set: { acquisitionAttemptId: fence.attemptId, status: 'pending_debit' } }
    );
    await GiftVoucher.updateOne(
      { _id: voucher._id, 'reservationLedgerOperations.operationId': r.operationId },
      {
        $set: {
          'reservationLedgerOperations.$.acquisitionAttemptId': fence.attemptId,
          'reservationLedgerOperations.$.state': 'pending'
        }
      }
    );

    const pendingBefore = await snapshot();
    assert.equal(pendingBefore.status, 'pending_debit');
    assert.equal(pendingBefore.opState, 'pending');
    assert.equal(pendingBefore.redMarker, fence.attemptId);
    assert.equal(pendingBefore.opMarker, fence.attemptId);
    assert.equal(pendingBefore.balance, 20000);

    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1300,
          currency: 'EUR',
          reservationKey: r.reservationKey,
          checkoutId: fence.checkoutId,
          expiresAt: BUNDLE_UNTIL,
          now: NOW
        }),
      (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
    );
    assert.deepEqual(await snapshot(), pendingBefore);

    // 6. Split ownership still blocked
    await GiftVoucherRedemption.updateOne(
      { _id: r.redemptionId },
      { $set: { acquisitionAttemptId: null } }
    );
    const splitBefore = await snapshot();
    assert.equal(splitBefore.redMarker, null);
    assert.equal(splitBefore.opMarker, fence.attemptId);
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1300,
          currency: 'EUR',
          reservationKey: r.reservationKey,
          checkoutId: fence.checkoutId,
          expiresAt: BUNDLE_UNTIL,
          now: NOW
        }),
      (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
    );
    assert.deepEqual(await snapshot(), splitBefore);
  });

  it('CORR: tokenless confirm CAS race maps to VOUCHER_RESERVATION_IN_PROGRESS', async () => {
    async function runConfirmMarkerRace({ label, inject }) {
      const voucher = await createVoucher();
      const reserved = await reserveVoucherAmountV1({
        giftVoucherId: voucher._id,
        amountCents: 1400,
        currency: 'EUR',
        reservationKey: `rk-confirm-race-${label}`,
        checkoutId: `chk_confirm_race_${label}`,
        expiresAt: BUNDLE_UNTIL,
        now: NOW
      });
      const balanceBefore = (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents;
      let injected = false;
      __setBeforeV1ConfirmCasHookForTests(async ({ redemptionId, operationId, giftVoucherId }) => {
        if (injected) return;
        injected = true;
        await inject({ redemptionId, operationId, giftVoucherId });
      });
      await assert.rejects(
        () =>
          confirmVoucherRedemptionV1({
            redemptionId: reserved.redemptionId,
            actor: 'system',
            note: `confirm race ${label}`,
            now: NOW
          }),
        (e) => e.code === VOUCHER_RESERVATION_IN_PROGRESS
      );
      const redemptionAfter = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
      const voucherAfter = await GiftVoucher.findById(voucher._id).lean();
      const opAfter = voucherAfter.reservationLedgerOperations[0];
      assert.notEqual(redemptionAfter.status, 'confirmed');
      assert.equal(opAfter.state, 'debited');
      assert.equal(voucherAfter.balanceRemainingCents, balanceBefore);
      const confirmedEvents = await GiftVoucherEvent.find({
        redemptionId: reserved.redemptionId,
        type: 'redeemed_confirmed'
      }).lean();
      assert.equal(confirmedEvents.length, 0);
      __setBeforeV1ConfirmCasHookForTests(null);
      return { redemptionAfter, opAfter };
    }

    // Redemption marker only
    {
      const { redemptionAfter, opAfter } = await runConfirmMarkerRace({
        label: 'red',
        inject: async ({ redemptionId }) => {
          await GiftVoucherRedemption.updateOne(
            { _id: redemptionId, status: 'reserved' },
            { $set: { acquisitionAttemptId: 'cra:confirm-race-red' } }
          );
        }
      });
      assert.equal(redemptionAfter.status, 'reserved');
      assert.equal(redemptionAfter.acquisitionAttemptId, 'cra:confirm-race-red');
      assert.equal(opAfter.acquisitionAttemptId, null);
    }

    // Operation marker only (force CAS zero-match without redemption marker so remap runs)
    {
      const { redemptionAfter, opAfter } = await runConfirmMarkerRace({
        label: 'op',
        inject: async ({ redemptionId, giftVoucherId, operationId }) => {
          await GiftVoucher.updateOne(
            { _id: giftVoucherId, 'reservationLedgerOperations.operationId': operationId },
            { $set: { 'reservationLedgerOperations.$.acquisitionAttemptId': 'cra:confirm-race-op' } }
          );
          // Confirm CAS filters status:reserved + unmarked redemption; flip status so
          // modifiedCount=0 while only the operation marker is present.
          await GiftVoucherRedemption.updateOne(
            { _id: redemptionId, status: 'reserved' },
            { $set: { status: 'pending_debit' } }
          );
        }
      });
      assert.equal(redemptionAfter.acquisitionAttemptId, null);
      assert.equal(opAfter.acquisitionAttemptId, 'cra:confirm-race-op');
      assert.notEqual(redemptionAfter.status, 'confirmed');
    }

    // Split ownership
    {
      const { redemptionAfter, opAfter } = await runConfirmMarkerRace({
        label: 'split',
        inject: async ({ redemptionId, giftVoucherId, operationId }) => {
          await GiftVoucherRedemption.updateOne(
            { _id: redemptionId, status: 'reserved' },
            { $set: { acquisitionAttemptId: 'cra:confirm-race-split-red' } }
          );
          await GiftVoucher.updateOne(
            { _id: giftVoucherId, 'reservationLedgerOperations.operationId': operationId },
            {
              $set: {
                'reservationLedgerOperations.$.acquisitionAttemptId': 'cra:confirm-race-split-op'
              }
            }
          );
        }
      });
      assert.equal(redemptionAfter.acquisitionAttemptId, 'cra:confirm-race-split-red');
      assert.equal(opAfter.acquisitionAttemptId, 'cra:confirm-race-split-op');
    }

    // Both markers same attempt
    {
      const { redemptionAfter, opAfter } = await runConfirmMarkerRace({
        label: 'both',
        inject: async ({ redemptionId, giftVoucherId, operationId }) => {
          await GiftVoucherRedemption.updateOne(
            { _id: redemptionId, status: 'reserved' },
            { $set: { acquisitionAttemptId: 'cra:confirm-race-both' } }
          );
          await GiftVoucher.updateOne(
            { _id: giftVoucherId, 'reservationLedgerOperations.operationId': operationId },
            { $set: { 'reservationLedgerOperations.$.acquisitionAttemptId': 'cra:confirm-race-both' } }
          );
        }
      });
      assert.equal(redemptionAfter.acquisitionAttemptId, 'cra:confirm-race-both');
      assert.equal(opAfter.acquisitionAttemptId, 'cra:confirm-race-both');
    }
  });

  it('CORR: markerless post-seal compensation with default failFence rejects as seal-completed', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_markerless_seal' });
    const r = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1150,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await sealAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: r.redemptionId
      },
      { now: NOW }
    );
    const fenceBefore = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    const balanceBefore = (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents;

    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
            // default failFence: true
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_SEAL_COMPLETED
    );

    const fenceAfter = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceAfter.status, 'open');
    assert.equal(fenceAfter.isLive, true);
    assert.ok(fenceAfter.failureCode == null);
    assert.equal(String(fenceAfter.attemptId), String(fenceBefore.attemptId));
    assert.equal(String(fenceAfter.checkoutId), String(fenceBefore.checkoutId));
    assert.equal(fenceAfter.generation, fenceBefore.generation);
    assert.equal(String(fenceAfter.quoteSnapshotHash), String(fenceBefore.quoteSnapshotHash));
    assert.equal(
      new Date(fenceAfter.bundleValidUntil).getTime(),
      new Date(fenceBefore.bundleValidUntil).getTime()
    );

    const red = await GiftVoucherRedemption.findById(r.redemptionId).lean();
    const v = await GiftVoucher.findById(voucher._id).lean();
    const op = v.reservationLedgerOperations[0];
    assert.equal(red.status, 'reserved');
    assert.equal(red.acquisitionAttemptId, null);
    assert.equal(op.state, 'debited');
    assert.equal(op.acquisitionAttemptId, null);
    assert.equal(v.balanceRemainingCents, balanceBefore);

    const events = await GiftVoucherEvent.find({
      redemptionId: r.redemptionId,
      type: { $in: ['redeemed_released'] }
    }).lean();
    assert.equal(events.length, 0);

    // Repeat: same error, no mutation
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_SEAL_COMPLETED
    );
    const fenceRepeat = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceRepeat.isLive, true);
    assert.ok(fenceRepeat.failureCode == null);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents,
      balanceBefore
    );
  });

  it('CORR: markerless restored and voided retries are completed compensation; malformed fails closed', async () => {
    // Restored: compensate once, then markerless retry
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_markerless_restored' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1050,
        currency: 'EUR'
      },
      { now: NOW }
    );
    const first = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.equal(first.released, true);
    assert.equal(first.balanceRestored, true);
    assert.equal(first.monetaryDisposition, 'restored');
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.alreadyClear, true);
    assert.equal(retry.released, false);
    assert.equal(retry.monetaryDisposition, 'restored');
    assert.equal(retry.balanceRestored, true);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);

    // Voided pending: crash after claim, compensate voids, retry markerless
    const voucher2 = await createVoucher();
    const fence2 = await acquireFence({ checkoutId: 'chk_b8f2b1b_markerless_voided' });
    __setAfterV1PendingOpClaimHookForTests(async () => {
      const err = new Error('stop_after_pending');
      err.code = 'INJECTED_PENDING';
      throw err;
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence2.checkoutId,
            acquisitionAttemptId: fence2.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher2.code,
            amountCents: 900,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_PENDING'
    );
    __setAfterV1PendingOpClaimHookForTests(null);
    const voided = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence2.checkoutId,
        acquisitionAttemptId: fence2.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.equal(voided.released, true);
    assert.equal(voided.monetaryDisposition, 'voided');
    assert.equal(voided.balanceRestored, false);
    const v2 = await GiftVoucher.findById(voucher2._id).lean();
    assert.equal(v2.balanceRemainingCents, 20000);
    assert.equal(v2.reservationLedgerOperations[0].state, 'voided');

    const voidRetry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence2.checkoutId,
        acquisitionAttemptId: fence2.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.equal(voidRetry.alreadyClear, true);
    assert.equal(voidRetry.monetaryDisposition, 'voided');
    assert.equal(voidRetry.balanceRestored, false);

    // Malformed: reserved unmarked with missing operation must not return ok:true
    const voucher3 = await createVoucher();
    const fence3 = await acquireFence({ checkoutId: 'chk_b8f2b1b_markerless_malformed' });
    const bad = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence3.checkoutId,
        acquisitionAttemptId: fence3.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher3.code,
        amountCents: 800,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await sealAttemptVoucherReservation(
      {
        checkoutId: fence3.checkoutId,
        acquisitionAttemptId: fence3.attemptId,
        quoteSnapshotHash: SNAP,
        redemptionId: bad.redemptionId
      },
      { now: NOW }
    );
    await GiftVoucher.updateOne(
      { _id: voucher3._id },
      { $set: { reservationLedgerOperations: [] } }
    );
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence3.checkoutId,
            acquisitionAttemptId: fence3.attemptId,
            quoteSnapshotHash: SNAP,
            failFence: false
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'VOUCHER_LEDGER_INTEGRITY' ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE ||
        e.code === 'VOUCHER_COMPENSATION_INCOMPLETE'
    );
  });

  it('CORR: empty markerless lookup is VOUCHER_COMPENSATION_STATE_UNPROVEN; fence untouched', async () => {
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_markerless_empty' });
    const fenceBefore = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
            // default failFence: true
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_STATE_UNPROVEN
    );
    const fenceAfter = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceAfter.status, 'open');
    assert.equal(fenceAfter.isLive, true);
    assert.ok(fenceAfter.failureCode == null);
    assert.equal(fenceAfter.generation, fenceBefore.generation);
  });

  it('CORR: takeover-adopted key markerless retry returns restored via compensatingAttemptId evidence', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_takeover_retry' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1750,
        currency: 'EUR'
      },
      { now: NOW }
    );
    const adoptedKey = a.reservationKey;
    assert.ok(adoptedKey.includes(`:att:${fenceA.attemptId}:`));
    await failFence(fenceA);

    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_takeover_retry' });
    const b = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1750,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal(b.outcome, 'taken_over');
    assert.equal(b.reservationKey, adoptedKey);
    assert.ok(!adoptedKey.includes(`:att:${fenceB.attemptId}:`));

    const compensated = await releaseAttemptVoucherReservation(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.equal(compensated.released, true);
    assert.equal(compensated.monetaryDisposition, 'restored');
    assert.equal(compensated.balanceRestored, true);

    const red = await GiftVoucherRedemption.findById(b.redemptionId).lean();
    assert.equal(red.status, 'released');
    assert.equal(red.acquisitionAttemptId, null);
    const vAfter = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(vAfter.balanceRemainingCents, 20000);
    assert.equal(vAfter.reservationLedgerOperations[0].state, 'restored');
    assert.equal(vAfter.reservationLedgerOperations[0].acquisitionAttemptId, null);
    const releaseEvents = await GiftVoucherEvent.find({
      giftVoucherId: voucher._id,
      type: 'redeemed_released'
    }).lean();
    assert.equal(releaseEvents.length, 1);
    assert.equal(releaseEvents[0].metadata.compensatingAttemptId, fenceB.attemptId);
    const balanceBeforeRetry = vAfter.balanceRemainingCents;

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.notEqual(retry.monetaryDisposition, 'never_acquired');
    assert.equal(retry.ok, true);
    assert.equal(retry.alreadyClear, true);
    assert.equal(retry.released, false);
    assert.equal(retry.monetaryDisposition, 'restored');
    assert.equal(retry.balanceRestored, true);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents,
      balanceBeforeRetry
    );
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      1
    );
  });

  it('CORR: unrelated historical terminal is not attributed to a later attempt', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_hist_term' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1100,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await releaseAttemptVoucherReservation(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    const fenceAAfter = await CheckoutResourceAttempt.findOne({ attemptId: fenceA.attemptId }).lean();
    assert.equal(fenceAAfter.isLive, false);

    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_hist_term' });
    const fenceBefore = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === VOUCHER_COMPENSATION_STATE_UNPROVEN
    );
    const fenceAfter = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
    assert.equal(fenceAfter.isLive, true);
    assert.ok(fenceAfter.failureCode == null);
    assert.equal(fenceAfter.generation, fenceBefore.generation);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
  });

  it('CORR: same-attempt release/acquire barrier — four durable orderings', async () => {
    function createBarrier() {
      let releaseResume;
      let pausedResolve;
      const paused = new Promise((r) => {
        pausedResolve = r;
      });
      const resumeGate = new Promise((r) => {
        releaseResume = r;
      });
      return {
        async pause() {
          pausedResolve();
          await resumeGate;
        },
        waitUntilPaused: () => paused,
        resume() {
          releaseResume();
        }
      };
    }

    async function runOrdering({ label, armAcquirePause, afterReleaseThrown }) {
      const voucher = await createVoucher();
      const fence = await acquireFence({ checkoutId: `chk_b8f2b1b_barrier_${label}` });
      const fenceBefore = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
      const releaseBarrier = createBarrier();
      const acquireBarrier = createBarrier();

      __setBeforeMarkerlessClassifyHookForTests(async () => {
        await releaseBarrier.pause();
      });
      armAcquirePause(acquireBarrier);

      const releasePromise = releaseAttemptVoucherReservation(
        {
          checkoutId: fence.checkoutId,
          acquisitionAttemptId: fence.attemptId,
          quoteSnapshotHash: SNAP
        },
        { now: NOW }
      ).then(
        (ok) => ({ ok: true, value: ok }),
        (err) => ({ ok: false, err })
      );

      await releaseBarrier.waitUntilPaused();

      let acquirePromise;
      let releaseResult;

      if (label === 'before_pending') {
        // Resume classification while durable state is still empty, then start acquire.
        releaseBarrier.resume();
        releaseResult = await releasePromise;
        acquirePromise = reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1300,
            currency: 'EUR'
          },
          { now: NOW }
        ).then(
          (ok) => ({ ok: true, value: ok }),
          (err) => ({ ok: false, err })
        );
      } else {
        acquirePromise = reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1300,
            currency: 'EUR'
          },
          { now: NOW }
        ).then(
          (ok) => ({ ok: true, value: ok }),
          (err) => ({ ok: false, err })
        );
        await acquireBarrier.waitUntilPaused();
        releaseBarrier.resume();
        releaseResult = await releasePromise;
        acquireBarrier.resume();
      }

      assert.equal(releaseResult.ok, false, `${label}: release must not succeed as no-op`);
      assert.notEqual(
        releaseResult.err?.code,
        'never_acquired',
        `${label}: must not claim never_acquired`
      );
      assert.notEqual(releaseResult.err?.monetaryDisposition, 'never_acquired');
      if (releaseResult.value) {
        assert.notEqual(releaseResult.value.monetaryDisposition, 'never_acquired');
        assert.notEqual(releaseResult.value.alreadyClear, true);
      }

      const fenceMid = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
      assert.equal(fenceMid.isLive, true, `${label}: fence must stay live after markerless miss`);
      assert.ok(fenceMid.failureCode == null, `${label}: no fence annotation from marker absence`);
      assert.equal(fenceMid.generation, fenceBefore.generation);

      const acquireResult = await acquirePromise;

      __setBeforeMarkerlessClassifyHookForTests(null);
      __setAfterAttemptPendingMarkedHookForTests(null);
      __setAfterAttemptPreDebitFenceHookForTests(null);
      __setAfterAttemptDebitHookForTests(null);
      __setAfterAttemptReservedCasHookForTests(null);

      await afterReleaseThrown({
        label,
        voucher,
        fence,
        releaseResult,
        acquireResult,
        fenceBefore
      });
    }

    // 1. Resume release before pending creation
    await runOrdering({
      label: 'before_pending',
      armAcquirePause: () => {},
      afterReleaseThrown: async ({ voucher, fence, releaseResult, acquireResult }) => {
        assert.equal(releaseResult.err.code, VOUCHER_COMPENSATION_STATE_UNPROVEN);
        assert.equal(acquireResult.ok, true);
        assert.equal(acquireResult.value.ok, true);
        const bal = (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents;
        assert.equal(bal, 20000 - 1300);
        const markers = await listCurrentAttemptVoucherMarkers({
          checkoutId: fence.checkoutId,
          acquisitionAttemptId: fence.attemptId
        });
        assert.ok(markers.length > 0);
        const released = await releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            failFence: false
          },
          { now: NOW }
        );
        assert.equal(released.released, true);
        assert.equal(released.monetaryDisposition, 'restored');
        assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
      }
    });

    // 2. After pending marker creation (dual markers)
    await runOrdering({
      label: 'after_pending_markers',
      armAcquirePause: (acquireBarrier) => {
        __setAfterAttemptPendingMarkedHookForTests(async () => {
          await acquireBarrier.pause();
        });
      },
      afterReleaseThrown: async ({ voucher, fence, releaseResult, acquireResult }) => {
        assert.equal(releaseResult.err.code, VOUCHER_COMPENSATION_INCOMPLETE);
        assert.equal(acquireResult.ok, true);
        const ops = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations;
        assert.equal(ops.length, 1);
        assert.equal(ops[0].state, 'debited');
        const retry = await releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            failFence: false
          },
          { now: NOW }
        );
        assert.equal(retry.released, true);
        assert.equal(retry.monetaryDisposition, 'restored');
        assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
      }
    });

    // 3. After pre-debit fence assertion
    await runOrdering({
      label: 'after_pre_debit_fence',
      armAcquirePause: (acquireBarrier) => {
        __setAfterAttemptPreDebitFenceHookForTests(async () => {
          await acquireBarrier.pause();
        });
      },
      afterReleaseThrown: async ({ voucher, fence, releaseResult, acquireResult }) => {
        assert.equal(releaseResult.err.code, VOUCHER_COMPENSATION_INCOMPLETE);
        assert.equal(acquireResult.ok, true);
        const retry = await releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            failFence: false
          },
          { now: NOW }
        );
        assert.equal(retry.released, true);
        assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
      }
    });

    // 4. After debit
    await runOrdering({
      label: 'after_debit',
      armAcquirePause: (acquireBarrier) => {
        __setAfterAttemptDebitHookForTests(async () => {
          await acquireBarrier.pause();
        });
      },
      afterReleaseThrown: async ({ voucher, fence, releaseResult, acquireResult }) => {
        assert.equal(releaseResult.err.code, VOUCHER_COMPENSATION_INCOMPLETE);
        assert.equal(acquireResult.ok, true);
        const v = await GiftVoucher.findById(voucher._id).lean();
        assert.equal(v.reservationLedgerOperations[0].state, 'debited');
        assert.equal(v.balanceRemainingCents, 20000 - 1300);
        const retry = await releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            failFence: false
          },
          { now: NOW }
        );
        assert.equal(retry.released, true);
        assert.equal(retry.monetaryDisposition, 'restored');
        assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
        const ops = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations;
        assert.equal(ops.filter((o) => o.state === 'restored').length, 1);
        assert.equal(ops.filter((o) => o.state === 'debited').length, 0);
      }
    });
  });

  it('CORR: after-reserved — release wins before final acquire fence; acquire cannot succeed', async () => {
    function createBarrier() {
      let releaseResume;
      let pausedResolve;
      const paused = new Promise((r) => {
        pausedResolve = r;
      });
      const resumeGate = new Promise((r) => {
        releaseResume = r;
      });
      return {
        async pause() {
          pausedResolve();
          await resumeGate;
        },
        waitUntilPaused: () => paused,
        resume() {
          releaseResume();
        }
      };
    }

    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_after_reserved_release_wins' });
    const acquireBarrier = createBarrier();
    __setAfterAttemptReservedCasHookForTests(async () => {
      await acquireBarrier.pause();
    });

    const acquirePromise = reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1400,
        currency: 'EUR'
      },
      { now: NOW }
    ).then(
      (ok) => ({ ok: true, value: ok }),
      (err) => ({ ok: false, err })
    );

    await acquireBarrier.waitUntilPaused();

    const releaseResult = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
        // default failFence: true
      },
      { now: NOW }
    );
    assert.equal(releaseResult.ok, true);
    assert.equal(releaseResult.released, true);
    assert.equal(releaseResult.monetaryDisposition, 'restored');
    assert.equal(releaseResult.balanceRestored, true);

    const fenceAfterRelease = await CheckoutResourceAttempt.findOne({
      attemptId: fence.attemptId
    }).lean();
    assert.equal(fenceAfterRelease.status, 'failed');
    assert.equal(fenceAfterRelease.isLive, false);
    assert.equal(fenceAfterRelease.failureCode, 'VOUCHER_COMPENSATED');

    acquireBarrier.resume();
    const acquireResult = await acquirePromise;
    __setAfterAttemptReservedCasHookForTests(null);

    assert.equal(acquireResult.ok, false);
    assert.equal(acquireResult.err.code, FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    const ops = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations;
    assert.equal(ops.filter((o) => o.state === 'restored').length, 1);
    assert.equal(ops.filter((o) => o.state === 'debited').length, 0);
  });

  it('CORR: after-reserved — acquire returns first; later release fails fence; stale active/seal fail', async () => {
    function createBarrier() {
      let releaseResume;
      let pausedResolve;
      const paused = new Promise((r) => {
        pausedResolve = r;
      });
      const resumeGate = new Promise((r) => {
        releaseResume = r;
      });
      return {
        async pause() {
          pausedResolve();
          await resumeGate;
        },
        waitUntilPaused: () => paused,
        resume() {
          releaseResume();
        }
      };
    }

    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_after_reserved_acquire_first' });
    const acquireBarrier = createBarrier();
    __setAfterAttemptReservedCasHookForTests(async () => {
      await acquireBarrier.pause();
    });

    const acquirePromise = reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1450,
        currency: 'EUR'
      },
      { now: NOW }
    );

    await acquireBarrier.waitUntilPaused();
    // Allow acquire to finish final fence and return before release starts.
    acquireBarrier.resume();
    const acquired = await acquirePromise;
    __setAfterAttemptReservedCasHookForTests(null);
    assert.equal(acquired.ok, true);
    assert.equal(acquired.outcome, 'created');

    const fenceLive = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceLive.isLive, true);

    const released = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(released.ok, true);
    assert.equal(released.released, true);
    assert.equal(released.balanceRestored, true);

    const fenceFailed = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceFailed.status, 'failed');
    assert.equal(fenceFailed.isLive, false);
    assert.equal(fenceFailed.failureCode, 'VOUCHER_COMPENSATED');

    // Invalid overlap cannot occur: acquire already returned; release then closed fence.
    assert.notEqual(fenceLive.isLive && fenceFailed.isLive, true);

    await assert.rejects(
      () =>
        assertAttemptVoucherReservationActive(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            redemptionId: acquired.redemptionId
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );

    await assert.rejects(
      () =>
        sealAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            redemptionId: acquired.redemptionId
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );

    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
  });

  it('CORR: crash after restore before event — marked terminal; retry writes event and fails fence', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_crash_before_event' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1600,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await failFence(fenceA);
    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_crash_before_event' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1600,
        currency: 'EUR'
      },
      { now: NOW }
    );

    __setAfterAttemptRestoreBeforeEventHookForTests(async () => {
      const err = new Error('crash_after_restore_before_event');
      err.code = 'INJECTED_RESTORE_EVENT_CRASH';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'INJECTED_RESTORE_EVENT_CRASH' ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE
    );
    __setAfterAttemptRestoreBeforeEventHookForTests(null);

    const midRed = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    const midV = await GiftVoucher.findById(voucher._id).lean();
    const midOp = midV.reservationLedgerOperations[0];
    assert.equal(midRed.status, 'released');
    assert.equal(midRed.acquisitionAttemptId, fenceB.attemptId);
    assert.equal(midOp.state, 'restored');
    assert.equal(midOp.acquisitionAttemptId, fenceB.attemptId);
    assert.equal(midV.balanceRemainingCents, 20000);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      0
    );
    const fenceMid = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
    assert.equal(fenceMid.isLive, true);
    assert.equal(fenceMid.status, 'open');

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.released, true);
    assert.equal(retry.monetaryDisposition, 'restored');
    assert.equal(retry.balanceRestored, true);

    const endRed = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    const endV = await GiftVoucher.findById(voucher._id).lean();
    const endOp = endV.reservationLedgerOperations[0];
    assert.equal(endRed.acquisitionAttemptId, null);
    assert.equal(endOp.acquisitionAttemptId, null);
    assert.equal(endV.balanceRemainingCents, 20000);
    const events = await GiftVoucherEvent.find({
      giftVoucherId: voucher._id,
      type: 'redeemed_released'
    }).lean();
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.compensatingAttemptId, fenceB.attemptId);
    assert.equal(events[0].metadata.checkoutId, fenceB.checkoutId);
    const fenceEnd = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
    assert.equal(fenceEnd.status, 'failed');
    assert.equal(fenceEnd.isLive, false);
  });

  it('CORR: crash after event before marker clear — retry clears markers without second restore', async () => {
    const voucher = await createVoucher();
    const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_crash_after_event' });
    const a = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceA.checkoutId,
        acquisitionAttemptId: fenceA.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1550,
        currency: 'EUR'
      },
      { now: NOW }
    );
    await failFence(fenceA);
    const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_crash_after_event' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1550,
        currency: 'EUR'
      },
      { now: NOW }
    );

    __setAfterAttemptEventBeforeMarkerClearHookForTests(async () => {
      const err = new Error('crash_after_event_before_clear');
      err.code = 'INJECTED_EVENT_CLEAR_CRASH';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fenceB.checkoutId,
            acquisitionAttemptId: fenceB.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'INJECTED_EVENT_CLEAR_CRASH' ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE
    );
    __setAfterAttemptEventBeforeMarkerClearHookForTests(null);

    const midV = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(midV.balanceRemainingCents, 20000);
    assert.equal(midV.reservationLedgerOperations[0].state, 'restored');
    assert.equal(midV.reservationLedgerOperations[0].acquisitionAttemptId, fenceB.attemptId);
    const midEvents = await GiftVoucherEvent.find({
      giftVoucherId: voucher._id,
      type: 'redeemed_released'
    }).lean();
    assert.equal(midEvents.length, 1);
    assert.equal(midEvents[0].metadata.compensatingAttemptId, fenceB.attemptId);
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean()).isLive,
      true
    );

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fenceB.checkoutId,
        acquisitionAttemptId: fenceB.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(retry.released, true);
    assert.equal(retry.balanceRestored, true);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      1
    );
    const endRed = await GiftVoucherRedemption.findById(a.redemptionId).lean();
    const endOp = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0];
    assert.equal(endRed.acquisitionAttemptId, null);
    assert.equal(endOp.acquisitionAttemptId, null);
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean()).status,
      'failed'
    );
  });

  it('CORR: exact attribution negatives return STATE_UNPROVEN without fence mutation', async () => {
    async function seedTakeoverTerminal(checkoutId) {
      const voucher = await createVoucher();
      const fenceA = await acquireFence({ checkoutId });
      const a = await reserveExactVoucherAmountForAttempt(
        {
          checkoutId: fenceA.checkoutId,
          acquisitionAttemptId: fenceA.attemptId,
          quoteSnapshotHash: SNAP,
          voucherCode: voucher.code,
          amountCents: 900,
          currency: 'EUR'
        },
        { now: NOW }
      );
      await failFence(fenceA);
      const fenceB = await acquireFence({ checkoutId });
      await reserveExactVoucherAmountForAttempt(
        {
          checkoutId: fenceB.checkoutId,
          acquisitionAttemptId: fenceB.attemptId,
          quoteSnapshotHash: SNAP,
          voucherCode: voucher.code,
          amountCents: 900,
          currency: 'EUR'
        },
        { now: NOW }
      );
      await releaseAttemptVoucherReservation(
        {
          checkoutId: fenceB.checkoutId,
          acquisitionAttemptId: fenceB.attemptId,
          quoteSnapshotHash: SNAP,
          failFence: false
        },
        { now: NOW }
      );
      const events = await GiftVoucherEvent.find({
        giftVoucherId: voucher._id,
        type: 'redeemed_released'
      }).lean();
      assert.equal(events.length, 1);
      assert.ok(!String(a.reservationKey).includes(`:att:${fenceB.attemptId}:`));
      return { voucher, fenceB, a, event: events[0] };
    }

    async function assertUnproven({ checkoutId, mutate }) {
      const { voucher, fenceB, event } = await seedTakeoverTerminal(checkoutId);
      await mutate({ voucher, fenceB, event });
      const fenceBefore = await CheckoutResourceAttempt.findOne({
        attemptId: fenceB.attemptId
      }).lean();
      await assert.rejects(
        () =>
          releaseAttemptVoucherReservation(
            {
              checkoutId: fenceB.checkoutId,
              acquisitionAttemptId: fenceB.attemptId,
              quoteSnapshotHash: SNAP,
              failFence: false
            },
            { now: NOW }
          ),
        (e) => e.code === VOUCHER_COMPENSATION_STATE_UNPROVEN
      );
      const fenceAfter = await CheckoutResourceAttempt.findOne({
        attemptId: fenceB.attemptId
      }).lean();
      assert.equal(fenceAfter.isLive, fenceBefore.isLive);
      assert.equal(fenceAfter.status, fenceBefore.status);
      assert.equal(String(fenceAfter.failureCode), String(fenceBefore.failureCode));
      assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    }

    await assertUnproven({
      checkoutId: 'chk_b8f2b1b_attr_wrong_checkout',
      mutate: async ({ event }) => {
        await GiftVoucherEvent.collection.updateOne(
          { _id: event._id },
          { $set: { 'metadata.checkoutId': 'chk_other' } }
        );
      }
    });

    await assertUnproven({
      checkoutId: 'chk_b8f2b1b_attr_wrong_op',
      mutate: async ({ event }) => {
        await GiftVoucherEvent.collection.updateOne(
          { _id: event._id },
          { $set: { 'metadata.operationId': 'op_wrong' } }
        );
      }
    });

    await assertUnproven({
      checkoutId: 'chk_b8f2b1b_attr_wrong_red',
      mutate: async ({ event }) => {
        await GiftVoucherEvent.collection.updateOne(
          { _id: event._id },
          { $set: { 'metadata.redemptionId': 'red_wrong' } }
        );
      }
    });

    await assertUnproven({
      checkoutId: 'chk_b8f2b1b_attr_wrong_type',
      mutate: async ({ event }) => {
        await GiftVoucherEvent.collection.updateOne(
          { _id: event._id },
          { $set: { type: 'voided' } }
        );
      }
    });

    await assertUnproven({
      checkoutId: 'chk_b8f2b1b_attr_wrong_key',
      mutate: async ({ event }) => {
        await GiftVoucherEvent.collection.updateOne(
          { _id: event._id },
          { $set: { 'metadata.ledgerEventKey': 'bad:key' } }
        );
      }
    });

    // Unrelated historical: A compensated; B sees terminal without B event
    {
      const voucher = await createVoucher();
      const fenceA = await acquireFence({ checkoutId: 'chk_b8f2b1b_attr_hist' });
      await reserveExactVoucherAmountForAttempt(
        {
          checkoutId: fenceA.checkoutId,
          acquisitionAttemptId: fenceA.attemptId,
          quoteSnapshotHash: SNAP,
          voucherCode: voucher.code,
          amountCents: 950,
          currency: 'EUR'
        },
        { now: NOW }
      );
      await releaseAttemptVoucherReservation(
        {
          checkoutId: fenceA.checkoutId,
          acquisitionAttemptId: fenceA.attemptId,
          quoteSnapshotHash: SNAP
        },
        { now: NOW }
      );
      const fenceB = await acquireFence({ checkoutId: 'chk_b8f2b1b_attr_hist' });
      const before = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
      await assert.rejects(
        () =>
          releaseAttemptVoucherReservation(
            {
              checkoutId: fenceB.checkoutId,
              acquisitionAttemptId: fenceB.attemptId,
              quoteSnapshotHash: SNAP
            },
            { now: NOW }
          ),
        (e) => e.code === VOUCHER_COMPENSATION_STATE_UNPROVEN
      );
      const after = await CheckoutResourceAttempt.findOne({ attemptId: fenceB.attemptId }).lean();
      assert.equal(after.isLive, true);
      assert.equal(after.generation, before.generation);
    }
  });

  it('CORR: mid-release fence replacement prevents release success', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_fence_cas_mismatch' });
    await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1250,
        currency: 'EUR'
      },
      { now: NOW }
    );

    __setAfterAttemptEventBeforeMarkerClearHookForTests(async () => {
      // Fail the live fence, then tamper immutable identity so the post-fail
      // exact reread cannot match the fence captured at release entry.
      await failFence(fence);
      await CheckoutResourceAttempt.collection.updateOne(
        { attemptId: fence.attemptId },
        { $set: { quoteSnapshotHash: 'tampered-snap-b8f2b1b' } }
      );
    });

    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );
    __setAfterAttemptEventBeforeMarkerClearHookForTests(null);

    const original = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(original.isLive, false);
    assert.equal(original.status, 'failed');
    assert.equal(String(original.quoteSnapshotHash), 'tampered-snap-b8f2b1b');
    // Balance restored and event durable, but release must not report success.
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      1
    );
  });

  it('CORR: crash mid marker-clear after restore — retry clears remaining marker without second restore', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_mid_clear_restore' });
    const reserved = await reserveExactVoucherAmountForAttempt(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        voucherCode: voucher.code,
        amountCents: 1700,
        currency: 'EUR'
      },
      { now: NOW }
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 18300);

    __setAfterAttemptFirstMarkerClearHookForTests(async (payload) => {
      assert.equal(payload.clearedMarker, 'operation');
      assert.equal(payload.remainingMarker, 'redemption');
      const err = new Error('crash_after_first_marker_clear');
      err.code = 'INJECTED_MID_CLEAR_CRASH';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'INJECTED_MID_CLEAR_CRASH' ||
        e.code === VOUCHER_MARKER_CLEAR_INCOMPLETE ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE
    );
    __setAfterAttemptFirstMarkerClearHookForTests(null);

    const midRed = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
    const midV = await GiftVoucher.findById(voucher._id).lean();
    const midOp = midV.reservationLedgerOperations[0];
    assert.equal(midRed.status, 'released');
    assert.equal(midRed.acquisitionAttemptId, fence.attemptId);
    assert.equal(midOp.state, 'restored');
    assert.equal(midOp.acquisitionAttemptId, null);
    assert.equal(midV.balanceRemainingCents, 20000);
    const midEvents = await GiftVoucherEvent.find({
      giftVoucherId: voucher._id,
      type: 'redeemed_released'
    }).lean();
    assert.equal(midEvents.length, 1);
    assert.equal(midEvents[0].metadata.compensatingAttemptId, fence.attemptId);
    const fenceMid = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceMid.isLive, true);
    assert.equal(fenceMid.status, 'open');
    assert.equal(fenceMid.generation, fence.generation);
    assert.equal(fenceMid.quoteSnapshotHash, SNAP);

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.released, true);
    assert.equal(retry.monetaryDisposition, 'restored');
    assert.equal(retry.balanceRestored, true);

    const endRed = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
    const endV = await GiftVoucher.findById(voucher._id).lean();
    const endOp = endV.reservationLedgerOperations[0];
    assert.equal(endRed.status, 'released');
    assert.equal(endRed.acquisitionAttemptId, null);
    assert.equal(endOp.state, 'restored');
    assert.equal(endOp.acquisitionAttemptId, null);
    assert.equal(endV.balanceRemainingCents, 20000);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      1
    );
    const fenceEnd = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceEnd.status, 'failed');
    assert.equal(fenceEnd.isLive, false);
    assert.equal(fenceEnd.generation, fence.generation);
    assert.equal(String(fenceEnd.quoteSnapshotHash), SNAP);
  });

  it('CORR: crash after pending void before event — retry writes one void event and fails fence', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_void_before_event' });
    __setAfterV1PendingOpClaimHookForTests(async () => {
      const err = new Error('stop_after_pending_for_void');
      err.code = 'INJECTED_PENDING_VOID';
      throw err;
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1100,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_PENDING_VOID'
    );
    __setAfterV1PendingOpClaimHookForTests(null);

    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    const pendingRed = await GiftVoucherRedemption.findOne({
      checkoutId: fence.checkoutId,
      acquisitionAttemptId: fence.attemptId
    }).lean();
    assert.equal(pendingRed.status, 'pending_debit');

    __setAfterAttemptRestoreBeforeEventHookForTests(async (payload) => {
      assert.equal(payload.phase, 'after_void_before_event');
      const err = new Error('crash_after_void_before_event');
      err.code = 'INJECTED_VOID_EVENT_CRASH';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'INJECTED_VOID_EVENT_CRASH' ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE
    );
    __setAfterAttemptRestoreBeforeEventHookForTests(null);

    const midRed = await GiftVoucherRedemption.findById(pendingRed._id).lean();
    const midV = await GiftVoucher.findById(voucher._id).lean();
    const midOp = midV.reservationLedgerOperations[0];
    assert.equal(midRed.status, 'voided');
    assert.equal(midRed.acquisitionAttemptId, fence.attemptId);
    assert.equal(midOp.state, 'voided');
    assert.equal(midOp.acquisitionAttemptId, fence.attemptId);
    assert.equal(midV.balanceRemainingCents, 20000);
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id, type: 'voided' }).lean()).length,
      0
    );
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean()).isLive,
      true
    );

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.released, true);
    assert.equal(retry.monetaryDisposition, 'voided');
    assert.equal(retry.balanceRestored, false);

    const endRed = await GiftVoucherRedemption.findById(pendingRed._id).lean();
    const endV = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(endRed.acquisitionAttemptId, null);
    assert.equal(endV.reservationLedgerOperations[0].acquisitionAttemptId, null);
    assert.equal(endV.balanceRemainingCents, 20000);
    const voidEvents = await GiftVoucherEvent.find({
      giftVoucherId: voucher._id,
      type: 'voided'
    }).lean();
    assert.equal(voidEvents.length, 1);
    assert.equal(voidEvents[0].metadata.compensatingAttemptId, fence.attemptId);
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean()).status,
      'failed'
    );

    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) => e.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST
    );
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id, type: 'voided' }).lean()).length,
      1
    );
  });

  it('CORR: crash after void event before marker clear — retry clears markers without duplicate void', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_void_after_event' });
    __setAfterV1PendingOpClaimHookForTests(async () => {
      const err = new Error('stop_after_pending');
      err.code = 'INJECTED_PENDING';
      throw err;
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 1050,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_PENDING'
    );
    __setAfterV1PendingOpClaimHookForTests(null);
    const pendingRed = await GiftVoucherRedemption.findOne({
      checkoutId: fence.checkoutId
    }).lean();

    __setAfterAttemptEventBeforeMarkerClearHookForTests(async (payload) => {
      assert.equal(payload.disposition, 'voided');
      const err = new Error('crash_after_void_event_before_clear');
      err.code = 'INJECTED_VOID_CLEAR_CRASH';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'INJECTED_VOID_CLEAR_CRASH' ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE
    );
    __setAfterAttemptEventBeforeMarkerClearHookForTests(null);

    const midV = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(midV.balanceRemainingCents, 20000);
    assert.equal(midV.reservationLedgerOperations[0].state, 'voided');
    assert.equal(midV.reservationLedgerOperations[0].acquisitionAttemptId, fence.attemptId);
    assert.equal(
      (await GiftVoucherRedemption.findById(pendingRed._id).lean()).acquisitionAttemptId,
      fence.attemptId
    );
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id, type: 'voided' }).lean()).length,
      1
    );
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean()).isLive,
      true
    );

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(retry.released, true);
    assert.equal(retry.monetaryDisposition, 'voided');
    assert.equal(retry.balanceRestored, false);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id, type: 'voided' }).lean()).length,
      1
    );
    assert.equal(
      (await GiftVoucherRedemption.findById(pendingRed._id).lean()).acquisitionAttemptId,
      null
    );
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0]
        .acquisitionAttemptId,
      null
    );
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean()).status,
      'failed'
    );
  });

  it('CORR: crash mid marker-clear after void — retry clears remaining marker without duplicate event', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_void_mid_clear' });
    __setAfterV1PendingOpClaimHookForTests(async () => {
      const err = new Error('stop_after_pending');
      err.code = 'INJECTED_PENDING';
      throw err;
    });
    await assert.rejects(
      () =>
        reserveExactVoucherAmountForAttempt(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP,
            voucherCode: voucher.code,
            amountCents: 980,
            currency: 'EUR'
          },
          { now: NOW }
        ),
      (e) => e.code === 'INJECTED_PENDING'
    );
    __setAfterV1PendingOpClaimHookForTests(null);
    const pendingRed = await GiftVoucherRedemption.findOne({
      checkoutId: fence.checkoutId
    }).lean();

    __setAfterAttemptFirstMarkerClearHookForTests(async () => {
      const err = new Error('crash_void_mid_clear');
      err.code = 'INJECTED_VOID_MID_CLEAR';
      throw err;
    });
    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: fence.checkoutId,
            acquisitionAttemptId: fence.attemptId,
            quoteSnapshotHash: SNAP
          },
          { now: NOW }
        ),
      (e) =>
        e.code === 'INJECTED_VOID_MID_CLEAR' ||
        e.code === VOUCHER_MARKER_CLEAR_INCOMPLETE ||
        e.code === VOUCHER_COMPENSATION_INCOMPLETE
    );
    __setAfterAttemptFirstMarkerClearHookForTests(null);

    const midRed = await GiftVoucherRedemption.findById(pendingRed._id).lean();
    const midOp = (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0];
    assert.equal(midRed.status, 'voided');
    assert.equal(midRed.acquisitionAttemptId, fence.attemptId);
    assert.equal(midOp.state, 'voided');
    assert.equal(midOp.acquisitionAttemptId, null);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id, type: 'voided' }).lean()).length,
      1
    );
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean()).isLive,
      true
    );

    const retry = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.monetaryDisposition, 'voided');
    assert.equal(retry.balanceRestored, false);
    assert.equal(
      (await GiftVoucherRedemption.findById(pendingRed._id).lean()).acquisitionAttemptId,
      null
    );
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0]
        .acquisitionAttemptId,
      null
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id, type: 'voided' }).lean()).length,
      1
    );
    const fenceEnd = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceEnd.status, 'failed');
    assert.equal(fenceEnd.isLive, false);
    assert.equal(fenceEnd.generation, fence.generation);
    assert.equal(String(fenceEnd.quoteSnapshotHash), SNAP);
  });

  it('CORR: void_no_op repeated release cannot restore money or leave live markers', async () => {
    const voucher = await createVoucher();
    const fence = await acquireFence({ checkoutId: 'chk_b8f2b1b_void_no_op' });
    const redemptionId = new mongoose.Types.ObjectId();
    const operationId = buildOperationId(redemptionId);
    const reservationKey = buildAttemptReservationKey({
      checkoutId: fence.checkoutId,
      attemptId: fence.attemptId,
      giftVoucherId: voucher._id,
      amountCents: 750,
      currency: 'EUR',
      quoteSnapshotHash: SNAP
    });
    await GiftVoucherRedemption.create({
      _id: redemptionId,
      giftVoucherId: voucher._id,
      voucherCode: voucher.code,
      amountAppliedCents: 750,
      currency: 'EUR',
      status: 'pending_debit',
      ledgerProtocolVersion: 1,
      operationId,
      reservationKey,
      checkoutId: fence.checkoutId,
      quoteSnapshotHash: SNAP,
      acquisitionAttemptId: fence.attemptId,
      expiresAt: BUNDLE_UNTIL
    });
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations.length,
      0
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);

    const first = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP,
        failFence: false
      },
      { now: NOW }
    );
    assert.equal(first.ok, true);
    assert.equal(first.released, true);
    assert.equal(first.monetaryDisposition, 'voided');
    assert.equal(first.balanceRestored, false);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (await GiftVoucherRedemption.findById(redemptionId).lean()).status,
      'voided'
    );
    assert.equal(
      (await GiftVoucherRedemption.findById(redemptionId).lean()).acquisitionAttemptId,
      null
    );
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id }).lean()).length,
      0
    );
    assert.equal(
      (await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean()).isLive,
      true
    );

    const second = await releaseAttemptVoucherReservation(
      {
        checkoutId: fence.checkoutId,
        acquisitionAttemptId: fence.attemptId,
        quoteSnapshotHash: SNAP
      },
      { now: NOW }
    );
    assert.equal(second.ok, true);
    assert.equal(second.alreadyClear, true);
    assert.equal(second.balanceRestored, false);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (await GiftVoucherEvent.find({ giftVoucherId: voucher._id }).lean()).length,
      0
    );
    const markers = await listCurrentAttemptVoucherMarkers({
      checkoutId: fence.checkoutId,
      acquisitionAttemptId: fence.attemptId
    });
    assert.equal(
      markers.filter(
        (m) =>
          m.redemptionMarker === fence.attemptId || m.operationMarker === fence.attemptId
      ).length,
      0
    );
    const fenceEnd = await CheckoutResourceAttempt.findOne({ attemptId: fence.attemptId }).lean();
    assert.equal(fenceEnd.status, 'failed');
    assert.equal(fenceEnd.isLive, false);
  });
});
