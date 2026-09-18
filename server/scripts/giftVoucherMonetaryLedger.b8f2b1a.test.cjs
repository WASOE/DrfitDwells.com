/**
 * B8F2B1A — Idempotent voucher monetary ledger (MongoMemoryServer standalone).
 * No attempt markers, orchestrator, CheckoutSession, PI, routes, or finalization.
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
const {
  LEDGER_PROTOCOL_VERSION_V1,
  AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC,
  AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC
} = require('../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const {
  AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC
} = require('../models/GiftVoucherEvent');

const {
  reserveVoucherAmount,
  confirmReservedRedemption,
  releaseReservedRedemption,
  reserveVoucherAmountV1,
  releaseVoucherRedemptionV1,
  confirmVoucherRedemptionV1,
  recoverVoucherRedemptionV1,
  expireVoucherRedemptionsV1,
  ensureVoucherLedgerIndexesForTests,
  assertVoucherLedgerAuthoritativeIndexes,
  LEDGER_EVENT_INCOMPLETE,
  VOUCHER_LEDGER_INTEGRITY,
  VOUCHER_LEDGER_PROTOCOL_MISMATCH,
  VOUCHER_LEDGER_INDEX_MISSING,
  buildOperationId,
  buildLedgerEventKey,
  __setAfterV1PendingCreateHookForTests
} = require('../services/giftVouchers/giftVoucherLedgerService');

const { appendFinancialVoucherEvent } = require('../services/giftVouchers/giftVoucherEventService');

const NOW = new Date('2026-09-09T12:00:00.000Z');
const LATER = new Date('2026-09-09T12:30:00.000Z');
const VOUCHER_EXPIRY = new Date('2027-01-01T00:00:00.000Z');

let mongoServer;

function buildVoucher(overrides = {}) {
  return {
    code: null,
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
    ...overrides
  };
}

async function createVoucher(overrides = {}) {
  return GiftVoucher.create(buildVoucher(overrides));
}

function key(suffix) {
  return `rk-b8f2b1a-${suffix}`;
}

async function dropIndexSafe(collectionName, indexName) {
  const coll = mongoose.connection.collection(collectionName);
  try {
    await coll.dropIndex(indexName);
  } catch (err) {
    if (!/index not found/i.test(String(err.message || ''))) throw err;
  }
}

describe('B8F2B1A gift voucher monetary ledger', () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
    await GiftVoucher.syncIndexes();
    await GiftVoucherRedemption.syncIndexes();
    await GiftVoucherEvent.syncIndexes();
    await ensureVoucherLedgerIndexesForTests();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
    await GiftVoucherRedemption.deleteMany({});
    await GiftVoucher.deleteMany({});
    await ensureVoucherLedgerIndexesForTests();
    __setAfterV1PendingCreateHookForTests(null);
  });

  it('1. required indexes permit v1 writes', async () => {
    await assertVoucherLedgerAuthoritativeIndexes();
    const voucher = await createVoucher();
    const result = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 5000,
      currency: 'EUR',
      reservationKey: key('idx-ok'),
      checkoutId: 'co-idx-ok',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(result.ok, true);
    assert.equal(result.protocolVersion, 1);
  });

  it('2. missing index fails before writes', async () => {
    await dropIndexSafe('giftvoucherredemptions', AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC.options.name);
    const voucher = await createVoucher();
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1000,
          currency: 'EUR',
          reservationKey: key('missing-idx'),
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === VOUCHER_LEDGER_INDEX_MISSING
    );
    assert.equal(await GiftVoucherRedemption.countDocuments({}), 0);
    await ensureVoucherLedgerIndexesForTests();
  });

  it('3. wrong index definition fails before writes', async () => {
    await dropIndexSafe('giftvoucherredemptions', AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.options.name);
    await mongoose.connection.collection('giftvoucherredemptions').createIndex(
      { checkoutId: 1 },
      {
        unique: true,
        name: AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.options.name,
        partialFilterExpression: {
          ledgerProtocolVersion: 1,
          status: 'reserved',
          checkoutId: { $type: 'string' }
        }
      }
    );
    const voucher = await createVoucher();
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1000,
          currency: 'EUR',
          reservationKey: key('wrong-idx'),
          checkoutId: 'co-wrong',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === VOUCHER_LEDGER_INDEX_MISSING
    );
    await dropIndexSafe('giftvoucherredemptions', AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.options.name);
    await ensureVoucherLedgerIndexesForTests();
  });

  it('4-5. permanent reservation key unique after release; cannot debit again', async () => {
    const voucher = await createVoucher();
    const rk = key('permanent');
    const first = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 4000,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-perm',
      expiresAt: LATER,
      now: NOW
    });
    await releaseVoucherRedemptionV1({
      redemptionId: first.redemptionId,
      now: NOW
    });
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 20000);

    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 4000,
          currency: 'EUR',
          reservationKey: rk,
          checkoutId: 'co-perm',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === 'VOUCHER_RESERVATION_KEY_TERMINAL'
    );
    const after2 = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after2.balanceRemainingCents, 20000);
    assert.equal(await GiftVoucherRedemption.countDocuments({ reservationKey: rk }), 1);
  });

  it('6-7. create pending before debit; exact debit once', async () => {
    const voucher = await createVoucher();
    const result = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 7500,
      currency: 'EUR',
      reservationKey: key('exact'),
      checkoutId: 'co-exact',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(result.ok, true);
    const redemption = await GiftVoucherRedemption.findById(result.redemptionId).lean();
    assert.equal(redemption.status, 'reserved');
    assert.equal(redemption.ledgerProtocolVersion, 1);
    assert.equal(redemption.operationId, buildOperationId(redemption._id));
    assert.equal(redemption.amountAppliedCents, 7500);
    assert.equal(redemption.currency, 'EUR');

    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 12500);
    assert.equal(updated.reservationLedgerOperations.length, 1);
    const op = updated.reservationLedgerOperations[0];
    assert.equal(op.state, 'debited');
    assert.equal(op.amountCents, 7500);
    assert.equal(op.currency, 'EUR');
    assert.equal(op.reservationKey, key('exact'));
    assert.equal(String(op.redemptionId), String(redemption._id));
  });

  it('8. concurrent debit once', async () => {
    const voucher = await createVoucher({ balanceRemainingCents: 5000, amountOriginalCents: 5000 });
    const rk = key('concurrent-debit');
    const args = {
      giftVoucherId: voucher._id,
      amountCents: 5000,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-concurrent-debit',
      expiresAt: LATER,
      now: NOW
    };
    const [a, b] = await Promise.all([
      reserveVoucherAmountV1(args),
      reserveVoucherAmountV1(args)
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.redemptionId, b.redemptionId);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 0);
    assert.equal(updated.reservationLedgerOperations.length, 1);
    assert.equal(await GiftVoucherRedemption.countDocuments({ reservationKey: rk }), 1);
  });

  it('9. retry after unknown debit is idempotent', async () => {
    const voucher = await createVoucher();
    const rk = key('retry-debit');
    const first = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 3000,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-retry-debit',
      expiresAt: LATER,
      now: NOW
    });
    const second = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 3000,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-retry-debit',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.redemptionId, first.redemptionId);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 17000);
    assert.equal(updated.reservationLedgerOperations.length, 1);
  });

  it('10. multikey absence filter handles multiple existing operations', async () => {
    const voucher = await createVoucher();
    await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2000,
      currency: 'EUR',
      reservationKey: key('multi-a'),
      checkoutId: 'co-multi-a',
      expiresAt: LATER,
      now: NOW
    });
    await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 3000,
      currency: 'EUR',
      reservationKey: key('multi-b'),
      checkoutId: 'co-multi-b',
      expiresAt: LATER,
      now: NOW
    });
    const third = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 4000,
      currency: 'EUR',
      reservationKey: key('multi-c'),
      checkoutId: 'co-multi-c',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(third.ok, true);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 11000);
    assert.equal(updated.reservationLedgerOperations.length, 3);
  });

  it('11. same operation id with different amount fails closed', async () => {
    const voucher = await createVoucher();
    const rk = key('amt-mismatch');
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2500,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-amt',
      expiresAt: LATER,
      now: NOW
    });
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 2501,
          currency: 'EUR',
          reservationKey: rk,
          checkoutId: 'co-amt',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === VOUCHER_LEDGER_INTEGRITY
    );
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 17500);
    assert.equal(String(reserved.redemptionId), String((await GiftVoucherRedemption.findOne({ reservationKey: rk }))._id));
  });

  it('12-13. redemption/operation/voucher/currency/key mismatches fail closed', async () => {
    const voucher = await createVoucher();
    const other = await createVoucher({ code: null, amountOriginalCents: 9000, balanceRemainingCents: 9000 });
    const rk = key('identity');
    await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 1000,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-id',
      expiresAt: LATER,
      now: NOW
    });
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: other._id,
          amountCents: 1000,
          currency: 'EUR',
          reservationKey: rk,
          checkoutId: 'co-id',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === VOUCHER_LEDGER_INTEGRITY
    );
  });

  it('14. insufficient balance voids pending without restore', async () => {
    const voucher = await createVoucher({ balanceRemainingCents: 1500, amountOriginalCents: 1500 });
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 5000,
          currency: 'EUR',
          reservationKey: key('insuff'),
          checkoutId: 'co-insuff',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === 'RESERVE_FAILED'
    );
    const redemption = await GiftVoucherRedemption.findOne({ reservationKey: key('insuff') }).lean();
    assert.equal(redemption.status, 'voided');
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 1500);
    assert.equal((updated.reservationLedgerOperations || []).length, 0);
  });

  it('15. expired voucher voids pending without restore', async () => {
    const voucher = await createVoucher({
      expiresAt: new Date('2020-01-01T00:00:00.000Z')
    });
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1000,
          currency: 'EUR',
          reservationKey: key('vexp'),
          checkoutId: 'co-vexp',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === 'RESERVE_FAILED'
    );
    const redemption = await GiftVoucherRedemption.findOne({ reservationKey: key('vexp') }).lean();
    assert.equal(redemption.status, 'voided');
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal((updated.reservationLedgerOperations || []).length, 0);
  });

  it('16. crash after pending create before debit — first write already has final identity', async () => {
    const voucher = await createVoucher();
    const rk = key('crash-before');
    let observed = null;
    __setAfterV1PendingCreateHookForTests(async (ctx) => {
      observed = ctx;
      const durable = await GiftVoucherRedemption.findById(ctx.redemption._id).lean();
      assert.equal(String(durable._id), String(ctx.redemption._id));
      assert.equal(durable.operationId, buildOperationId(durable._id));
      assert.equal(durable.reservationKey, rk);
      assert.equal(durable.amountAppliedCents, 2000);
      assert.equal(durable.currency, 'EUR');
      assert.equal(durable.ledgerProtocolVersion, 1);
      assert.equal(String(durable.giftVoucherId), String(voucher._id));
      assert.equal(durable.checkoutId, 'co-crash-before');
      assert.ok(durable.expiresAt instanceof Date);
      assert.equal(durable.status, 'pending_debit');
      const err = new Error('forced-after-pending-create');
      err.code = 'FORCED_AFTER_PENDING_CREATE';
      throw err;
    });

    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 2000,
          currency: 'EUR',
          reservationKey: rk,
          checkoutId: 'co-crash-before',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === 'FORCED_AFTER_PENDING_CREATE'
    );
    assert.ok(observed);

    const mid = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(mid.balanceRemainingCents, 20000);
    assert.equal((mid.reservationLedgerOperations || []).length, 0);

    __setAfterV1PendingCreateHookForTests(null);
    const resumed = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2000,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-crash-before',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.redemptionId, String(observed.redemption._id));
    assert.equal(resumed.operationId, observed.operationId);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 18000);
    assert.equal(updated.reservationLedgerOperations.length, 1);
    assert.equal(await GiftVoucherRedemption.countDocuments({ reservationKey: rk }), 1);
  });

  it('16b. malformed v1 pending without operationId fails closed', async () => {
    const voucher = await createVoucher();
    const rk = key('malformed-opid');
    const plantedId = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('giftvoucherredemptions').insertOne({
      _id: plantedId,
      giftVoucherId: voucher._id,
      checkoutId: 'co-malformed',
      reservationKey: rk,
      amountAppliedCents: 1500,
      currency: 'EUR',
      ledgerProtocolVersion: 1,
      status: 'pending_debit',
      expiresAt: LATER,
      reservedAt: NOW,
      operationId: null,
      createdAt: NOW,
      updatedAt: NOW
    });

    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1500,
          currency: 'EUR',
          reservationKey: rk,
          checkoutId: 'co-malformed',
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === VOUCHER_LEDGER_INTEGRITY
    );
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal((updated.reservationLedgerOperations || []).length, 0);
  });

  it('17. crash after debit before reserved recovery', async () => {
    const voucher = await createVoucher();
    const rk = key('crash-after-debit');
    const pendingId = new mongoose.Types.ObjectId();
    const operationId = buildOperationId(pendingId);
    const pending = await GiftVoucherRedemption.create({
      _id: pendingId,
      giftVoucherId: voucher._id,
      checkoutId: 'co-crash-after',
      reservationKey: rk,
      amountAppliedCents: 2200,
      currency: 'EUR',
      ledgerProtocolVersion: 1,
      status: 'pending_debit',
      expiresAt: LATER,
      operationId,
      reservedAt: NOW
    });

    await GiftVoucher.updateOne(
      { _id: voucher._id },
      {
        $inc: { balanceRemainingCents: -2200 },
        $push: {
          reservationLedgerOperations: {
            operationId,
            redemptionId: pending._id,
            reservationKey: rk,
            amountCents: 2200,
            currency: 'EUR',
            state: 'debited',
            debitedAt: NOW,
            restoredAt: null,
            protocolVersion: 1
          }
        },
        $set: { status: 'partially_redeemed' }
      }
    );

    const resumed = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2200,
      currency: 'EUR',
      reservationKey: rk,
      checkoutId: 'co-crash-after',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(resumed.ok, true);
    const redemption = await GiftVoucherRedemption.findById(pending._id).lean();
    assert.equal(redemption.status, 'reserved');
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 17800);
    assert.equal(updated.reservationLedgerOperations.length, 1);
  });

  it('18-19. reserved before event failure and repair; event count exactly one', async () => {
    const voucher = await createVoucher();
    const rk = key('event-repair');
    const originalAppend = appendFinancialVoucherEvent;
    let failOnce = true;
    const eventService = require('../services/giftVouchers/giftVoucherEventService');
    eventService.appendFinancialVoucherEvent = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('forced-event-failure');
      }
      return originalAppend(...args);
    };

    try {
      await assert.rejects(
        () =>
          reserveVoucherAmountV1({
            giftVoucherId: voucher._id,
            amountCents: 1500,
            currency: 'EUR',
            reservationKey: rk,
            checkoutId: 'co-event',
            expiresAt: LATER,
            now: NOW
          }),
        (err) => err.code === LEDGER_EVENT_INCOMPLETE
      );

      const redemption = await GiftVoucherRedemption.findOne({ reservationKey: rk }).lean();
      assert.equal(redemption.status, 'reserved');
      const mid = await GiftVoucher.findById(voucher._id).lean();
      assert.equal(mid.balanceRemainingCents, 18500);
      assert.equal(mid.reservationLedgerOperations[0].state, 'debited');

      const repaired = await reserveVoucherAmountV1({
        giftVoucherId: voucher._id,
        amountCents: 1500,
        currency: 'EUR',
        reservationKey: rk,
        checkoutId: 'co-event',
        expiresAt: LATER,
        now: NOW
      });
      assert.equal(repaired.ok, true);

      const opId = redemption.operationId;
      const count = await GiftVoucherEvent.countDocuments({
        giftVoucherId: voucher._id,
        type: 'redeemed_reserved',
        'metadata.ledgerEventKey': buildLedgerEventKey('redeemed_reserved', opId)
      });
      assert.equal(count, 1);
      const finalVoucher = await GiftVoucher.findById(voucher._id).lean();
      assert.equal(finalVoucher.balanceRemainingCents, 18500);
    } finally {
      eventService.appendFinancialVoucherEvent = originalAppend;
    }
  });

  it('20-22. release before restore crash; resume restore once; concurrent restore once', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 6000,
      currency: 'EUR',
      reservationKey: key('rel-crash'),
      checkoutId: 'co-rel-crash',
      expiresAt: LATER,
      now: NOW
    });

    await GiftVoucherRedemption.updateOne(
      { _id: reserved.redemptionId, status: 'reserved' },
      { $set: { status: 'released', releasedAt: NOW, reason: 'injected' } }
    );

    const mid = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(mid.balanceRemainingCents, 14000);
    assert.equal(mid.reservationLedgerOperations[0].state, 'debited');

    const [r1, r2] = await Promise.all([
      releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
      releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW })
    ]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const finalVoucher = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(finalVoucher.balanceRemainingCents, 20000);
    assert.equal(finalVoucher.reservationLedgerOperations[0].state, 'restored');
    assert.ok(['active', 'partially_redeemed'].includes(finalVoucher.status));

    const eventCount = await GiftVoucherEvent.countDocuments({
      giftVoucherId: voucher._id,
      type: 'redeemed_released',
      'metadata.ledgerEventKey': buildLedgerEventKey('redeemed_released', reserved.operationId)
    });
    assert.equal(eventCount, 1);
  });

  it('23-24. unknown restore result retry; restoration uses embedded amount', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 4500,
      currency: 'EUR',
      reservationKey: key('restore-amt'),
      checkoutId: 'co-restore-amt',
      expiresAt: LATER,
      now: NOW
    });

    // Bypass mongoose immutability to simulate corrupted redemption amount
    await mongoose.connection.collection('giftvoucherredemptions').updateOne(
      { _id: new mongoose.Types.ObjectId(reserved.redemptionId) },
      { $set: { amountAppliedCents: 99999 } }
    );

    await assert.rejects(
      () => releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
      (err) => err.code === VOUCHER_LEDGER_INTEGRITY
    );

    const still = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(still.balanceRemainingCents, 15500);
    assert.equal(still.reservationLedgerOperations[0].state, 'debited');
    assert.equal(still.reservationLedgerOperations[0].amountCents, 4500);
  });

  it('25-26. restoration uses embedded amount; corrupted amount cannot over-restore', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 3500,
      currency: 'EUR',
      reservationKey: key('embed-amt'),
      checkoutId: 'co-embed',
      expiresAt: LATER,
      now: NOW
    });
    const release = await releaseVoucherRedemptionV1({
      redemptionId: reserved.redemptionId,
      now: NOW
    });
    assert.equal(release.restore.amountCents, 3500);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
  });

  it('27. restore ceiling blocks balance above original', async () => {
    const voucher = await createVoucher({ amountOriginalCents: 10000, balanceRemainingCents: 10000 });
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 4000,
      currency: 'EUR',
      reservationKey: key('ceiling'),
      checkoutId: 'co-ceiling',
      expiresAt: LATER,
      now: NOW
    });

    // Manually inflate balance so restore would exceed original
    await GiftVoucher.updateOne(
      { _id: voucher._id },
      { $set: { balanceRemainingCents: 9000 } }
    );

    await GiftVoucherRedemption.updateOne(
      { _id: reserved.redemptionId },
      { $set: { status: 'released', releasedAt: NOW, reason: 'injected' } }
    );

    await assert.rejects(
      () => releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
      (err) => err.code === VOUCHER_LEDGER_INTEGRITY && err.reason === 'restore_exceeds_original_ceiling'
    );
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 9000);
    assert.equal(updated.reservationLedgerOperations[0].state, 'debited');
  });

  it('28. release versus confirm race — one terminal wins', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2800,
      currency: 'EUR',
      reservationKey: key('race-rc'),
      checkoutId: 'co-race-rc',
      expiresAt: LATER,
      now: NOW
    });

    const results = await Promise.allSettled([
      releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
      confirmVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW })
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
    assert.ok(['released', 'confirmed'].includes(redemption.status));
    const updated = await GiftVoucher.findById(voucher._id).lean();
    if (redemption.status === 'released') {
      assert.equal(updated.balanceRemainingCents, 20000);
      assert.equal(updated.reservationLedgerOperations[0].state, 'restored');
    } else {
      assert.equal(updated.balanceRemainingCents, 17200);
      assert.equal(updated.reservationLedgerOperations[0].state, 'debited');
    }
  });

  it('29. expiry versus release race', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2100,
      currency: 'EUR',
      reservationKey: key('race-exp'),
      checkoutId: 'co-race-exp',
      expiresAt: new Date(NOW.getTime() - 1000),
      now: new Date(NOW.getTime() - 60_000)
    });

    const [a, b] = await Promise.all([
      releaseVoucherRedemptionV1({
        redemptionId: reserved.redemptionId,
        reason: 'expired_hold',
        now: NOW
      }),
      expireVoucherRedemptionsV1({ now: NOW, limit: 10 })
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.scanned >= 0, true);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal(updated.reservationLedgerOperations[0].state, 'restored');
  });

  it('30-32. confirm changes no balance; requires debited; confirmed cannot restore', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 8000,
      currency: 'EUR',
      reservationKey: key('confirm'),
      checkoutId: 'co-confirm',
      expiresAt: LATER,
      now: NOW
    });
    const before = await GiftVoucher.findById(voucher._id).lean();
    const confirmed = await confirmVoucherRedemptionV1({
      redemptionId: reserved.redemptionId,
      now: NOW
    });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.balanceRemainingCents, before.balanceRemainingCents);

    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 12000);
    assert.equal(after.reservationLedgerOperations[0].state, 'debited');

    await assert.rejects(
      () => releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
      (err) => err.code === 'INVALID_REDEMPTION_STATUS'
    );
    const finalVoucher = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(finalVoucher.balanceRemainingCents, 12000);
    assert.equal(finalVoucher.reservationLedgerOperations[0].state, 'debited');
  });

  it('33. pending without debit expires to voided', async () => {
    const voucher = await createVoucher();
    const pendingId = new mongoose.Types.ObjectId();
    const pending = await GiftVoucherRedemption.create({
      _id: pendingId,
      giftVoucherId: voucher._id,
      checkoutId: 'co-pend-void',
      reservationKey: key('pend-void'),
      amountAppliedCents: 1000,
      currency: 'EUR',
      ledgerProtocolVersion: 1,
      status: 'pending_debit',
      expiresAt: new Date(NOW.getTime() - 1000),
      operationId: buildOperationId(pendingId),
      reservedAt: NOW
    });

    const summary = await expireVoucherRedemptionsV1({ now: NOW, limit: 10 });
    assert.equal(summary.voided, 1);
    const redemption = await GiftVoucherRedemption.findById(pending._id).lean();
    assert.equal(redemption.status, 'voided');
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal((updated.reservationLedgerOperations || []).length, 0);
  });

  it('34. pending with debit expires and restores once', async () => {
    const voucher = await createVoucher();
    const rk = key('pend-debit-exp');
    const pendingId = new mongoose.Types.ObjectId();
    const operationId = buildOperationId(pendingId);
    const pending = await GiftVoucherRedemption.create({
      _id: pendingId,
      giftVoucherId: voucher._id,
      checkoutId: 'co-pend-debit-exp',
      reservationKey: rk,
      amountAppliedCents: 2700,
      currency: 'EUR',
      ledgerProtocolVersion: 1,
      status: 'pending_debit',
      expiresAt: new Date(NOW.getTime() - 1000),
      reservedAt: NOW,
      operationId
    });
    await GiftVoucher.updateOne(
      { _id: voucher._id },
      {
        $inc: { balanceRemainingCents: -2700 },
        $push: {
          reservationLedgerOperations: {
            operationId,
            redemptionId: pending._id,
            reservationKey: rk,
            amountCents: 2700,
            currency: 'EUR',
            state: 'debited',
            debitedAt: NOW,
            restoredAt: null,
            protocolVersion: 1
          }
        },
        $set: { status: 'partially_redeemed' }
      }
    );

    const summary = await expireVoucherRedemptionsV1({ now: NOW, limit: 10 });
    assert.ok(summary.released + summary.alreadyTerminal >= 1);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal(updated.reservationLedgerOperations[0].state, 'restored');
  });

  it('35. voucher status remains redeemable after valid restore', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 20000,
      currency: 'EUR',
      reservationKey: key('status'),
      checkoutId: 'co-status',
      expiresAt: LATER,
      now: NOW
    });
    await releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW });
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal(updated.status, 'active');

    const again = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 1000,
      currency: 'EUR',
      reservationKey: key('status-2'),
      checkoutId: 'co-status-2',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal(again.ok, true);
  });

  it('36. different checkouts cannot overspend one voucher', async () => {
    const voucher = await createVoucher({ amountOriginalCents: 5000, balanceRemainingCents: 5000 });
    const results = await Promise.allSettled([
      reserveVoucherAmountV1({
        giftVoucherId: voucher._id,
        amountCents: 5000,
        currency: 'EUR',
        reservationKey: key('over-a'),
        checkoutId: 'co-over-a',
        expiresAt: LATER,
        now: NOW
      }),
      reserveVoucherAmountV1({
        giftVoucherId: voucher._id,
        amountCents: 5000,
        currency: 'EUR',
        reservationKey: key('over-b'),
        checkoutId: 'co-over-b',
        expiresAt: LATER,
        now: NOW
      })
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(fail.length, 1);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 0);
    assert.equal(updated.reservationLedgerOperations.length, 1);
  });

  it('37-39. legacy reserved releasable; confirmed stable; incomplete released review-required', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmount({
      giftVoucherId: voucher._id,
      amountToReserveCents: 3300,
      actor: 'system',
      note: 'legacy reserve'
    });
    assert.equal(reserved.ok, true);
    const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
    assert.equal(redemption.ledgerProtocolVersion, null);
    assert.equal(redemption.status, 'reserved');

    const released = await releaseReservedRedemption({
      redemptionId: reserved.redemptionId,
      actor: 'system',
      note: 'legacy release'
    });
    assert.equal(released.ok, true);
    const afterRelease = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(afterRelease.balanceRemainingCents, 20000);

    const reserved2 = await reserveVoucherAmount({
      giftVoucherId: voucher._id,
      amountToReserveCents: 2000,
      note: 'legacy confirm path'
    });
    const confirmed = await confirmReservedRedemption({
      redemptionId: reserved2.redemptionId,
      note: 'legacy confirm'
    });
    assert.equal(confirmed.ok, true);
    const afterConfirm = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(afterConfirm.balanceRemainingCents, 18000);

    const incomplete = await GiftVoucherRedemption.create({
      giftVoucherId: voucher._id,
      amountAppliedCents: 500,
      status: 'released',
      reservedAt: NOW,
      releasedAt: NOW,
      reason: 'forced-incomplete'
    });
    await assert.rejects(
      () =>
        releaseReservedRedemption({
          redemptionId: incomplete._id,
          note: 'retry incomplete'
        }),
      (err) => err.code === 'RELEASE_STATE_INCOMPLETE_REQUIRES_REVIEW'
    );
  });

  it('40. v1 rows never enter legacy mutation path', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 1200,
      currency: 'EUR',
      reservationKey: key('no-legacy'),
      checkoutId: 'co-no-legacy',
      expiresAt: LATER,
      now: NOW
    });
    await assert.rejects(
      () => releaseReservedRedemption({ redemptionId: reserved.redemptionId }),
      (err) => err.code === VOUCHER_LEDGER_PROTOCOL_MISMATCH
    );
    await assert.rejects(
      () => confirmReservedRedemption({ redemptionId: reserved.redemptionId }),
      (err) => err.code === VOUCHER_LEDGER_PROTOCOL_MISMATCH
    );
  });

  it('41. keyless existing reserve API remains legacy', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmount({
      giftVoucherId: voucher._id,
      amountToReserveCents: 900,
      note: 'keyless legacy'
    });
    const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
    assert.equal(redemption.ledgerProtocolVersion == null, true);
    assert.equal(redemption.reservationKey, null);
    assert.equal(redemption.status, 'reserved');
  });

  it('42-44. no attempt markers, orchestrator, or payment wiring in allowlisted surface', () => {
    const ledgerSrc = fs.readFileSync(
      path.join(__dirname, '../services/giftVouchers/giftVoucherLedgerService.js'),
      'utf8'
    );
    const redemptionSrc = fs.readFileSync(
      path.join(__dirname, '../models/GiftVoucherRedemption.js'),
      'utf8'
    );
    assert.doesNotMatch(ledgerSrc, /acquisitionAttemptId/);
    assert.doesNotMatch(redemptionSrc, /acquisitionAttemptId/);
    assert.doesNotMatch(ledgerSrc, /resourceAttemptOrchestrator|CheckoutResourceAttempt|PaymentIntent|stripe/i);
    assert.doesNotMatch(ledgerSrc, /prepareCheckoutResourceBundle/);

    const bookingSrc = fs.readFileSync(
      path.join(__dirname, '../services/bookings/bookingVoucherRedemptionService.js'),
      'utf8'
    );
    // booking service must remain on legacy path (untouched for v1 wiring)
    assert.doesNotMatch(bookingSrc, /reserveVoucherAmountV1/);
    assert.doesNotMatch(bookingSrc, /acquisitionAttemptId/);
  });

  it('recoverVoucherRedemptionV1 resumes released+debited', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 1600,
      currency: 'EUR',
      reservationKey: key('recover'),
      checkoutId: 'co-recover',
      expiresAt: LATER,
      now: NOW
    });
    await GiftVoucherRedemption.updateOne(
      { _id: reserved.redemptionId },
      { $set: { status: 'released', releasedAt: NOW, reason: 'partial' } }
    );
    const recovered = await recoverVoucherRedemptionV1({
      redemptionId: reserved.redemptionId,
      now: NOW
    });
    assert.equal(recovered.ok, true);
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 20000);
    assert.equal(updated.reservationLedgerOperations[0].state, 'restored');
  });

  it('confirm requires debited not restored', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 1100,
      currency: 'EUR',
      reservationKey: key('conf-restored'),
      checkoutId: 'co-conf-restored',
      expiresAt: LATER,
      now: NOW
    });
    await releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW });
    await GiftVoucherRedemption.updateOne(
      { _id: reserved.redemptionId },
      { $set: { status: 'reserved', releasedAt: null, reason: null } }
    );
    await assert.rejects(
      () => confirmVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
      (err) => err.code === VOUCHER_LEDGER_INTEGRITY
    );
  });

  async function assertTerminalRestorePreserved({ status, expiresAt = VOUCHER_EXPIRY, label }) {
    const voucher = await createVoucher({
      amountOriginalCents: 20000,
      balanceRemainingCents: 20000,
      expiresAt
    });
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 4000,
      currency: 'EUR',
      reservationKey: key(`status-${label}`),
      checkoutId: `co-status-${label}`,
      expiresAt: LATER,
      now: NOW
    });
    await GiftVoucher.updateOne({ _id: voucher._id }, { $set: { status } });
    const mid = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(mid.balanceRemainingCents, 16000);
    assert.equal(mid.status, status);

    const released = await releaseVoucherRedemptionV1({
      redemptionId: reserved.redemptionId,
      now: NOW
    });
    assert.equal(released.ok, true);
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 20000);
    assert.equal(after.reservationLedgerOperations[0].state, 'restored');
    assert.equal(after.status, status);

    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1000,
          currency: 'EUR',
          reservationKey: key(`status-${label}-again`),
          checkoutId: `co-status-${label}-again`,
          expiresAt: LATER,
          now: NOW
        }),
      (err) => err.code === 'RESERVE_FAILED'
    );

    const retry = await releaseVoucherRedemptionV1({
      redemptionId: reserved.redemptionId,
      now: NOW
    });
    assert.equal(retry.alreadyReleased, true);
    const finalVoucher = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(finalVoucher.balanceRemainingCents, 20000);
    assert.equal(finalVoucher.status, status);
  }

  it('status: active restore derives redeemable status', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 5000,
      currency: 'EUR',
      reservationKey: key('status-active'),
      checkoutId: 'co-status-active',
      expiresAt: LATER,
      now: NOW
    });
    await releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW });
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 20000);
    assert.equal(after.status, 'active');
  });

  it('status: partially_redeemed restore may return active', async () => {
    const voucher = await createVoucher({
      amountOriginalCents: 20000,
      balanceRemainingCents: 12000,
      status: 'partially_redeemed'
    });
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2000,
      currency: 'EUR',
      reservationKey: key('status-partial'),
      checkoutId: 'co-status-partial',
      expiresAt: LATER,
      now: NOW
    });
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).status, 'partially_redeemed');
    await releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW });
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 12000);
    assert.equal(after.status, 'partially_redeemed');
  });

  it('status: expiresAt <= now becomes expired and stays non-redeemable', async () => {
    const voucher = await createVoucher({
      expiresAt: new Date(NOW.getTime() + 60_000)
    });
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 3000,
      currency: 'EUR',
      reservationKey: key('status-clock'),
      checkoutId: 'co-status-clock',
      expiresAt: LATER,
      now: NOW
    });
    // Clock advances past voucher expiresAt while hold is live
    const afterExpiry = new Date(NOW.getTime() + 120_000);
    await releaseVoucherRedemptionV1({
      redemptionId: reserved.redemptionId,
      now: afterExpiry
    });
    const after = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(after.balanceRemainingCents, 20000);
    assert.equal(after.status, 'expired');
    assert.equal(after.reservationLedgerOperations[0].state, 'restored');
    await assert.rejects(
      () =>
        reserveVoucherAmountV1({
          giftVoucherId: voucher._id,
          amountCents: 1000,
          currency: 'EUR',
          reservationKey: key('status-clock-again'),
          checkoutId: 'co-status-clock-again',
          expiresAt: new Date(afterExpiry.getTime() + 30_000),
          now: afterExpiry
        }),
      (err) => err.code === 'RESERVE_FAILED'
    );
  });

  it('status: expired preserved on restore', async () => {
    await assertTerminalRestorePreserved({ status: 'expired', label: 'expired' });
  });

  it('status: voided preserved on restore', async () => {
    await assertTerminalRestorePreserved({ status: 'voided', label: 'voided' });
  });

  it('status: refunded preserved on restore', async () => {
    await assertTerminalRestorePreserved({ status: 'refunded', label: 'refunded' });
  });

  it('status: redeemed preserved on restore', async () => {
    await assertTerminalRestorePreserved({ status: 'redeemed', label: 'redeemed' });
  });

  it('status: draft preserved on restore', async () => {
    await assertTerminalRestorePreserved({ status: 'draft', label: 'draft' });
  });

  it('status: pending_payment preserved on restore', async () => {
    await assertTerminalRestorePreserved({ status: 'pending_payment', label: 'pending-payment' });
  });

  it('two v1 ops: release one leaves the other debited', async () => {
    const voucher = await createVoucher();
    const a = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 3000,
      currency: 'EUR',
      reservationKey: key('two-a'),
      checkoutId: 'co-two-a',
      expiresAt: LATER,
      now: NOW
    });
    const b = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 4000,
      currency: 'EUR',
      reservationKey: key('two-b'),
      checkoutId: 'co-two-b',
      expiresAt: LATER,
      now: NOW
    });
    await releaseVoucherRedemptionV1({ redemptionId: a.redemptionId, now: NOW });
    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 16000);
    const opA = updated.reservationLedgerOperations.find((o) => o.operationId === a.operationId);
    const opB = updated.reservationLedgerOperations.find((o) => o.operationId === b.operationId);
    assert.equal(opA.state, 'restored');
    assert.equal(opB.state, 'debited');
    assert.equal(opB.amountCents, 4000);
  });

  it('release event failure then repair — exactly one keyed event', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2400,
      currency: 'EUR',
      reservationKey: key('rel-event'),
      checkoutId: 'co-rel-event',
      expiresAt: LATER,
      now: NOW
    });
    const eventService = require('../services/giftVouchers/giftVoucherEventService');
    const originalAppend = eventService.appendFinancialVoucherEvent;
    let failReleaseOnce = true;
    eventService.appendFinancialVoucherEvent = async (...args) => {
      const type = args[0]?.type;
      if (failReleaseOnce && type === 'redeemed_released') {
        failReleaseOnce = false;
        throw new Error('forced-release-event-failure');
      }
      return originalAppend(...args);
    };
    try {
      await assert.rejects(
        () => releaseVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
        (err) => err.code === LEDGER_EVENT_INCOMPLETE
      );
      const mid = await GiftVoucher.findById(voucher._id).lean();
      assert.equal(mid.balanceRemainingCents, 20000);
      assert.equal(mid.reservationLedgerOperations[0].state, 'restored');

      const repaired = await releaseVoucherRedemptionV1({
        redemptionId: reserved.redemptionId,
        now: NOW
      });
      assert.equal(repaired.ok, true);
      const count = await GiftVoucherEvent.countDocuments({
        giftVoucherId: voucher._id,
        type: 'redeemed_released',
        'metadata.ledgerEventKey': buildLedgerEventKey('redeemed_released', reserved.operationId)
      });
      assert.equal(count, 1);
      assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    } finally {
      eventService.appendFinancialVoucherEvent = originalAppend;
    }
  });

  it('confirm event failure then repair — exactly one keyed event', async () => {
    const voucher = await createVoucher();
    const reserved = await reserveVoucherAmountV1({
      giftVoucherId: voucher._id,
      amountCents: 2600,
      currency: 'EUR',
      reservationKey: key('conf-event'),
      checkoutId: 'co-conf-event',
      expiresAt: LATER,
      now: NOW
    });
    const eventService = require('../services/giftVouchers/giftVoucherEventService');
    const originalAppend = eventService.appendFinancialVoucherEvent;
    let failConfirmOnce = true;
    eventService.appendFinancialVoucherEvent = async (...args) => {
      const type = args[0]?.type;
      if (failConfirmOnce && type === 'redeemed_confirmed') {
        failConfirmOnce = false;
        throw new Error('forced-confirm-event-failure');
      }
      return originalAppend(...args);
    };
    try {
      await assert.rejects(
        () => confirmVoucherRedemptionV1({ redemptionId: reserved.redemptionId, now: NOW }),
        (err) => err.code === LEDGER_EVENT_INCOMPLETE
      );
      const mid = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
      assert.equal(mid.status, 'confirmed');
      const bal = await GiftVoucher.findById(voucher._id).lean();
      assert.equal(bal.balanceRemainingCents, 17400);

      const repaired = await confirmVoucherRedemptionV1({
        redemptionId: reserved.redemptionId,
        now: NOW
      });
      assert.equal(repaired.ok, true);
      const count = await GiftVoucherEvent.countDocuments({
        giftVoucherId: voucher._id,
        type: 'redeemed_confirmed',
        'metadata.ledgerEventKey': buildLedgerEventKey('redeemed_confirmed', reserved.operationId)
      });
      assert.equal(count, 1);
      assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 17400);
    } finally {
      eventService.appendFinancialVoucherEvent = originalAppend;
    }
  });
});
