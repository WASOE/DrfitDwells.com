const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const {
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
} = require('../services/giftVouchers/giftVoucherIssuance');
const {
  issueCancellationCompensationVoucher,
  COMPENSATION_EVENT_TYPE
} = require('../services/giftVouchers/issueCancellationCompensationVoucherService');

let mongoServer;

const PURCHASE_LIFECYCLE_TYPES = new Set(['paid', 'activated', 'sent']);

function issueParams(overrides = {}) {
  const reservationId = overrides.reservationId || new mongoose.Types.ObjectId();
  return {
    reservationId,
    creditAmountCents: 15000,
    recipientEmail: 'guest@example.com',
    recipientName: 'Guest Name',
    actor: 'ops@driftdwells.com',
    reason: 'Cancellation stay credit',
    ...overrides
  };
}

function assertAttributionEmpty(voucher) {
  const attr = voucher.attribution;
  assert.ok(attr == null || (typeof attr === 'object' && Object.keys(attr).length === 0));
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await GiftVoucherCreatorCommission.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await GiftVoucherEvent.collection.deleteMany({});
  await GiftVoucherCreatorCommission.deleteMany({});
  await GiftVoucher.deleteMany({});
});

test('issues active compensation voucher with expected fields', async () => {
  const reservationId = new mongoose.Types.ObjectId();
  const result = await issueCancellationCompensationVoucher(issueParams({ reservationId }));

  assert.equal(result.ok, true);
  assert.equal(result.idempotentReplay, false);
  assert.equal(result.issuanceSource, ISSUANCE_SOURCE_CANCELLATION_COMPENSATION);
  assert.equal(result.sourceReservationId, String(reservationId));

  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.ok(voucher);
  assert.equal(voucher.issuanceSource, ISSUANCE_SOURCE_CANCELLATION_COMPENSATION);
  assert.equal(voucher.status, 'active');
  assert.ok(voucher.code);
  assert.match(voucher.code, /^DD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(result.code, voucher.code);
  assert.equal(voucher.amountOriginalCents, 15000);
  assert.equal(voucher.balanceRemainingCents, 15000);
  assert.equal(voucher.deliveryMode, 'manual');
  assert.equal(String(voucher.sourceReservationId), String(reservationId));
  assert.equal(voucher.issuedByActorId, 'ops@driftdwells.com');
  assert.equal(voucher.compensationNote, 'Cancellation stay credit');
  assert.equal(voucher.stripePaymentIntentId, null);
  assert.equal(voucher.stripeCheckoutSessionId, null);
  assert.equal(voucher.purchaseRequestId, null);
  assert.equal(voucher.recipientEmail, 'guest@example.com');
  assert.equal(voucher.recipientName, 'Guest Name');
  assertAttributionEmpty(voucher);
});

test('rejects creditAmountCents below 10000', async () => {
  await assert.rejects(
    () => issueCancellationCompensationVoucher(issueParams({ creditAmountCents: 9999 })),
    (err) => err.code === 'CREDIT_AMOUNT_TOO_LOW'
  );
});

test('allows creditAmountCents equal to 10000', async () => {
  const result = await issueCancellationCompensationVoucher(
    issueParams({ creditAmountCents: 10000 })
  );
  assert.equal(result.ok, true);

  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.equal(voucher.amountOriginalCents, 10000);
  assert.equal(voucher.balanceRemainingCents, 10000);
});

test('duplicate issue for same reservation is idempotent', async () => {
  const reservationId = new mongoose.Types.ObjectId();
  const first = await issueCancellationCompensationVoucher(issueParams({ reservationId }));
  const second = await issueCancellationCompensationVoucher(issueParams({ reservationId }));

  assert.equal(second.idempotentReplay, true);
  assert.equal(second.giftVoucherId, first.giftVoucherId);
  assert.equal(second.code, first.code);

  const count = await GiftVoucher.countDocuments({
    sourceReservationId: reservationId,
    issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
  });
  assert.equal(count, 1);
});

test('appends exactly one compensation_issued event on first issue', async () => {
  const result = await issueCancellationCompensationVoucher(issueParams());

  const events = await GiftVoucherEvent.find({ giftVoucherId: result.giftVoucherId }).lean();
  const compensationEvents = events.filter((e) => e.type === COMPENSATION_EVENT_TYPE);
  assert.equal(compensationEvents.length, 1);
  assert.equal(compensationEvents[0].metadata.issuanceSource, ISSUANCE_SOURCE_CANCELLATION_COMPENSATION);
  assert.equal(compensationEvents[0].metadata.creditAmountCents, 15000);
});

test('duplicate replay does not append duplicate compensation_issued event', async () => {
  const reservationId = new mongoose.Types.ObjectId();
  const first = await issueCancellationCompensationVoucher(issueParams({ reservationId }));
  await issueCancellationCompensationVoucher(issueParams({ reservationId }));

  const events = await GiftVoucherEvent.find({ giftVoucherId: first.giftVoucherId }).lean();
  const compensationEvents = events.filter((e) => e.type === COMPENSATION_EVENT_TYPE);
  assert.equal(compensationEvents.length, 1);
});

test('does not create GiftVoucherCreatorCommission rows', async () => {
  await issueCancellationCompensationVoucher(issueParams());
  const count = await GiftVoucherCreatorCommission.countDocuments({});
  assert.equal(count, 0);
});

test('does not create paid, activated, or sent events', async () => {
  const result = await issueCancellationCompensationVoucher(issueParams());

  const events = await GiftVoucherEvent.find({ giftVoucherId: result.giftVoucherId }).lean();
  for (const event of events) {
    assert.ok(!PURCHASE_LIFECYCLE_TYPES.has(event.type), `unexpected event type: ${event.type}`);
  }
});

test('parallel double issue does not create duplicate vouchers', async () => {
  const reservationId = new mongoose.Types.ObjectId();
  const params = issueParams({ reservationId });

  const [a, b] = await Promise.all([
    issueCancellationCompensationVoucher(params),
    issueCancellationCompensationVoucher(params)
  ]);

  assert.equal(a.giftVoucherId, b.giftVoucherId);
  assert.equal(a.code, b.code);
  assert.ok(a.idempotentReplay === false || b.idempotentReplay === false);
  assert.ok(a.idempotentReplay === true || b.idempotentReplay === true);

  const count = await GiftVoucher.countDocuments({
    sourceReservationId: reservationId,
    issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
  });
  assert.equal(count, 1);

  const compensationEvents = await GiftVoucherEvent.countDocuments({
    giftVoucherId: a.giftVoucherId,
    type: COMPENSATION_EVENT_TYPE
  });
  assert.equal(compensationEvents, 1);
});
