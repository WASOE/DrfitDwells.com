const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');

const {
  generateVoucherCode,
  isVoucherCodeFormatValid,
  generateUniqueVoucherCode
} = require('../services/giftVouchers/giftVoucherCodeService');
const {
  assertIntegerCents,
  assertVoucherRedeemable
} = require('../services/giftVouchers/giftVoucherValidationService');
const {
  appendFinancialVoucherEvent
} = require('../services/giftVouchers/giftVoucherEventService');
const {
  reserveVoucherAmount,
  confirmReservedRedemption,
  releaseReservedRedemption
} = require('../services/giftVouchers/giftVoucherLedgerService');

let mongoServer;

function buildVoucher(overrides = {}) {
  const now = new Date();
  return {
    code: null,
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherRedemption.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucherRedemption.deleteMany({});
  await GiftVoucher.deleteMany({});
});

test('voucher code generation is unique and format is valid', async () => {
  const generated = new Set();
  for (let i = 0; i < 200; i += 1) {
    const code = generateVoucherCode();
    assert.equal(isVoucherCodeFormatValid(code), true);
    generated.add(code);
  }
  assert.equal(generated.size, 200);
});

test('generateUniqueVoucherCode returns non-existing code', async () => {
  const first = await generateUniqueVoucherCode();
  await GiftVoucher.create(buildVoucher({ code: first.code }));
  const second = await generateUniqueVoucherCode();
  assert.notEqual(first.code, second.code);
  assert.equal(isVoucherCodeFormatValid(second.code), true);
});

test('multiple vouchers with null code are allowed and duplicate non-null code is rejected', async () => {
  await GiftVoucher.create(buildVoucher({ code: null, buyerEmail: 'a1@example.com' }));
  await GiftVoucher.create(buildVoucher({ code: null, buyerEmail: 'a2@example.com', recipientEmail: 'r2@example.com' }));
  await GiftVoucher.create(buildVoucher({ code: 'DD-ABCD-EFGH-JKLM', buyerEmail: 'a3@example.com', recipientEmail: 'r3@example.com' }));

  await assert.rejects(
    () =>
      GiftVoucher.create(
        buildVoucher({
          code: 'DD-ABCD-EFGH-JKLM',
          buyerEmail: 'a4@example.com',
          recipientEmail: 'r4@example.com'
        })
      ),
    /duplicate key/i
  );
});

test('pending_payment/expired/voided/redeemed vouchers cannot be redeemed', async () => {
  const now = new Date();
  const pending = buildVoucher({ status: 'pending_payment' });
  const expired = buildVoucher({ status: 'active', expiresAt: new Date(now.getTime() - 1000) });
  const voided = buildVoucher({ status: 'voided' });
  const redeemed = buildVoucher({ status: 'redeemed', balanceRemainingCents: 0 });

  assert.throws(() => assertVoucherRedeemable(pending));
  assert.throws(() => assertVoucherRedeemable(expired));
  assert.throws(() => assertVoucherRedeemable(voided));
  assert.throws(() => assertVoucherRedeemable(redeemed));
});

test('partially_redeemed voucher can be redeemed when balance remains', async () => {
  const voucher = buildVoucher({ status: 'partially_redeemed', amountOriginalCents: 30000, balanceRemainingCents: 5000 });
  assert.equal(assertVoucherRedeemable(voucher), true);
});

test('cents validation rejects floats', async () => {
  assert.throws(() => assertIntegerCents(12.34, 'amountOriginalCents'));
  await assert.rejects(() => GiftVoucher.create(buildVoucher({ amountOriginalCents: 25000.5 })));
  await assert.rejects(() => GiftVoucherRedemption.create({ giftVoucherId: new mongoose.Types.ObjectId(), amountAppliedCents: 1.2 }));
  await assert.rejects(
    () =>
      GiftVoucherEvent.create({
        giftVoucherId: new mongoose.Types.ObjectId(),
        type: 'adjusted',
        actor: 'ops',
        note: 'x',
        previousBalanceCents: 100.2
      })
  );
});

test('reserve decrements balance and cannot overspend', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 10000, balanceRemainingCents: 10000 }));
  const reserve = await reserveVoucherAmount({
    giftVoucherId: voucher._id,
    amountToReserveCents: 7000,
    actor: 'system',
    note: 'reserve for test'
  });
  assert.equal(reserve.ok, true);
  const updated = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(updated.balanceRemainingCents, 3000);
  assert.equal(updated.status, 'partially_redeemed');

  await assert.rejects(() =>
    reserveVoucherAmount({
      giftVoucherId: voucher._id,
      amountToReserveCents: 4000,
      actor: 'system',
      note: 'overspend attempt'
    })
  );
});

test('release restores balance and duplicate release does not restore twice', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 20000, balanceRemainingCents: 20000 }));
  const reserve = await reserveVoucherAmount({
    giftVoucherId: voucher._id,
    amountToReserveCents: 5000,
    actor: 'system',
    note: 'reserve'
  });
  assert.equal(reserve.ok, true);

  const released = await releaseReservedRedemption({
    redemptionId: reserve.redemptionId,
    actor: 'system',
    note: 'release'
  });
  assert.equal(released.ok, true);
  assert.equal(released.alreadyReleased, false);

  const second = await releaseReservedRedemption({
    redemptionId: reserve.redemptionId,
    actor: 'system',
    note: 'release again'
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyReleased, true);

  const finalVoucher = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(finalVoucher.balanceRemainingCents, 20000);
  assert.equal(finalVoucher.status, 'active');

  const releaseEvents = await GiftVoucherEvent.countDocuments({
    giftVoucherId: voucher._id,
    type: 'redeemed_released'
  });
  assert.equal(releaseEvents, 1);
});

test('confirm does not change balance and duplicate confirm does not duplicate event', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 10000, balanceRemainingCents: 10000 }));
  const reserve = await reserveVoucherAmount({
    giftVoucherId: voucher._id,
    amountToReserveCents: 10000,
    actor: 'system',
    note: 'reserve full'
  });
  assert.equal(reserve.ok, true);
  let snapshot = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(snapshot.balanceRemainingCents, 0);
  assert.equal(snapshot.status, 'partially_redeemed');

  const first = await confirmReservedRedemption({
    redemptionId: reserve.redemptionId,
    actor: 'system',
    note: 'confirm'
  });
  assert.equal(first.ok, true);
  assert.equal(first.alreadyConfirmed, false);

  const second = await confirmReservedRedemption({
    redemptionId: reserve.redemptionId,
    actor: 'system',
    note: 'confirm again'
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyConfirmed, true);

  snapshot = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(snapshot.balanceRemainingCents, 0);
  assert.equal(snapshot.status, 'redeemed');

  const confirmEvents = await GiftVoucherEvent.countDocuments({
    giftVoucherId: voucher._id,
    type: 'redeemed_confirmed'
  });
  assert.equal(confirmEvents, 1);
});

test('event service rejects financial event without actor/note/balance fields', async () => {
  const voucher = await GiftVoucher.create(buildVoucher());
  await assert.rejects(() =>
    appendFinancialVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'adjusted',
      actor: '',
      note: 'x',
      previousBalanceCents: 1,
      newBalanceCents: 2,
      deltaCents: 1
    })
  );
  await assert.rejects(() =>
    appendFinancialVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'adjusted',
      actor: 'ops',
      note: '',
      previousBalanceCents: 1,
      newBalanceCents: 2,
      deltaCents: 1
    })
  );
  await assert.rejects(() =>
    appendFinancialVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'adjusted',
      actor: 'ops',
      note: 'ok'
    })
  );
});

test('reserve creation failure attempts compensation and returns structured failure', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 15000, balanceRemainingCents: 15000 }));
  const originalCreate = GiftVoucherRedemption.create.bind(GiftVoucherRedemption);
  GiftVoucherRedemption.create = async () => {
    throw new Error('forced-create-failure');
  };

  try {
    const result = await reserveVoucherAmount({
      giftVoucherId: voucher._id,
      amountToReserveCents: 4000,
      actor: 'system',
      note: 'forced fail reserve'
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'RESERVE_REDEMPTION_CREATE_FAILED');
    assert.equal(result.compensationAttempted, true);
    assert.equal(typeof result.compensationSucceeded, 'boolean');
    assert.equal(result.amountAppliedCents, 4000);

    const updated = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(updated.balanceRemainingCents, 15000);
    assert.equal(updated.status, 'active');
  } finally {
    GiftVoucherRedemption.create = originalCreate;
  }
});

test('release in incomplete state (released without event) returns structured review error', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 20000, balanceRemainingCents: 15000 }));
  const redemption = await GiftVoucherRedemption.create({
    giftVoucherId: voucher._id,
    amountAppliedCents: 5000,
    status: 'released',
    reservedAt: new Date(),
    releasedAt: new Date(),
    reason: 'forced-state'
  });

  await assert.rejects(
    () =>
      releaseReservedRedemption({
        redemptionId: redemption._id,
        actor: 'system',
        note: 'retry release'
      }),
    (err) => {
      assert.equal(err.code, 'RELEASE_STATE_INCOMPLETE_REQUIRES_REVIEW');
      assert.equal(err.redemptionId, String(redemption._id));
      assert.equal(err.giftVoucherId, String(voucher._id));
      assert.equal(err.amountAppliedCents, 5000);
      return true;
    }
  );
});

test('confirm in incomplete state (confirmed without event) writes missing event once', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 10000, balanceRemainingCents: 0, status: 'redeemed' }));
  const redemption = await GiftVoucherRedemption.create({
    giftVoucherId: voucher._id,
    amountAppliedCents: 10000,
    status: 'confirmed',
    reservedAt: new Date(),
    confirmedAt: new Date()
  });

  const first = await confirmReservedRedemption({
    redemptionId: redemption._id,
    actor: 'system',
    note: 'recover confirm event'
  });
  assert.equal(first.ok, true);
  assert.equal(first.alreadyConfirmed, true);
  assert.equal(first.eventRecovered, true);

  const second = await confirmReservedRedemption({
    redemptionId: redemption._id,
    actor: 'system',
    note: 'confirm again'
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyConfirmed, true);
  assert.equal(second.eventRecovered, undefined);

  const events = await GiftVoucherEvent.find({
    giftVoucherId: voucher._id,
    type: 'redeemed_confirmed',
    'metadata.redemptionId': String(redemption._id)
  }).lean();
  assert.equal(events.length, 1);
});

test('reserve event write failure throws structured error and does not return ok', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ amountOriginalCents: 12000, balanceRemainingCents: 12000 }));
  const originalCreate = GiftVoucherEvent.create.bind(GiftVoucherEvent);
  GiftVoucherEvent.create = async () => {
    throw new Error('forced-event-write-failure');
  };

  try {
    await assert.rejects(
      () =>
        reserveVoucherAmount({
          giftVoucherId: voucher._id,
          amountToReserveCents: 3000,
          actor: 'system',
          note: 'force reserve event fail'
        }),
      (err) => {
        assert.equal(err.code, 'RESERVE_EVENT_WRITE_FAILED');
        assert.equal(err.voucherId, String(voucher._id));
        assert.equal(err.amountAppliedCents, 3000);
        assert.ok(err.redemptionId);
        return true;
      }
    );
  } finally {
    GiftVoucherEvent.create = originalCreate;
  }
});
