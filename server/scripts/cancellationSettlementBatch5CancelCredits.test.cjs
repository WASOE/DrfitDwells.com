const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const AuditEvent = require('../models/AuditEvent');
const { transitionReservation } = require('../services/ops/domain/reservationWriteService');
const {
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
} = require('../services/giftVouchers/giftVoucherIssuance');
const {
  issueCancellationCompensationVoucher,
  COMPENSATION_EVENT_TYPE
} = require('../services/giftVouchers/issueCancellationCompensationVoucherService');

let mongoServer;

const PURCHASE_LIFECYCLE_TYPES = new Set(['paid', 'activated', 'sent']);

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function adminCtx(overrides = {}) {
  return {
    user: { id: 'admin-batch5', role: 'admin' },
    req: { headers: overrides.headers || {} },
    route: 'test/cancel',
    ...overrides
  };
}

async function createCabin() {
  return Cabin.create({
    name: `Batch5 Cabin ${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    description: 'Test cabin',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/a.jpg',
    location: 'Bulgaria'
  });
}

async function createBooking(overrides = {}) {
  const cabin = overrides.cabin || (await createCabin());
  return Booking.create({
    cabinId: cabin._id,
    checkIn: plusDays(5),
    checkOut: plusDays(7),
    adults: 2,
    children: 0,
    status: overrides.status || 'confirmed',
    guestInfo: {
      firstName: 'Guest',
      lastName: 'One',
      email: `guest-${new mongoose.Types.ObjectId().toString()}@example.com`,
      phone: '+359000000'
    },
    totalPrice: 300,
    stripePaidAmountCents: 30000,
    ...overrides,
    cabin: undefined
  });
}

async function assertDomainError(promise, { type, code }) {
  await assert.rejects(promise, (err) => {
    if (type && err.type !== type) return false;
    if (code && err.details?.code !== code && err.code !== code) return false;
    return true;
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await GiftVoucherCreatorCommission.syncIndexes();
  await AuditEvent.syncIndexes();
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
  await AuditEvent.collection.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
});

test('cancel with reason only defaults to resolution_pending without voucher', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cancel',
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'resolution_pending');
  assert.equal(await GiftVoucher.countDocuments({}), 0);
});

test('cancel with payment_retained does not create compensation voucher', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Non-refundable cancel',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'payment_retained');
  assert.equal(await GiftVoucher.countDocuments({}), 0);
});

test('cancel with credits_issued creates voucher and persists settlement', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'D&D cancelled due to issue',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'credits_issued');
  assert.equal(result.cancellationSettlement.creditAmountCents, 12000);
  assert.ok(result.cancellationSettlement.compensationGiftVoucherId);
  assert.ok(result.compensationVoucher?.code);
  assert.equal(result.compensationVoucher.idempotentReplay, false);

  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.status, 'cancelled');
  assert.equal(saved.cancellationSettlement.outcome, 'credits_issued');
  assert.equal(String(saved.cancellationSettlement.compensationGiftVoucherId), result.compensationVoucher.giftVoucherId);

  const voucher = await GiftVoucher.findById(result.compensationVoucher.giftVoucherId).lean();
  assert.equal(voucher.status, 'active');
  assert.equal(voucher.issuanceSource, ISSUANCE_SOURCE_CANCELLATION_COMPENSATION);
  assert.equal(String(voucher.sourceReservationId), String(booking._id));
  assert.equal(voucher.amountOriginalCents, 12000);

  const events = await GiftVoucherEvent.find({ giftVoucherId: voucher._id }).lean();
  assert.equal(events.filter((e) => e.type === COMPENSATION_EVENT_TYPE).length, 1);
});

test('credits_issued without creditAmountCents is rejected', async () => {
  const booking = await createBooking();
  await assertDomainError(
    transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'Cancel with credit',
      settlement: { outcome: 'credits_issued' },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
  assert.equal(await GiftVoucher.countDocuments({}), 0);
  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.status, 'confirmed');
});

test('creditAmountCents below minimum is rejected', async () => {
  const booking = await createBooking();
  await assertDomainError(
    transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'Cancel with credit',
      settlement: { outcome: 'credits_issued', creditAmountCents: 9999 },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
  assert.equal(await GiftVoucher.countDocuments({}), 0);
});

test('offer.stayCreditAmountCents without credits_issued outcome does not issue voucher', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Offer recorded only',
    settlement: {
      offer: { stayCreditAmountCents: 12000, note: 'Guest may choose credit' }
    },
    ctx: adminCtx()
  });

  assert.equal(result.cancellationSettlement.outcome, 'resolution_pending');
  assert.equal(await GiftVoucher.countDocuments({}), 0);
});

test('same idempotency key retry does not duplicate voucher or event', async () => {
  const booking = await createBooking();
  const headers = { 'x-idempotency-key': `cancel-credit-${booking._id}` };
  const params = {
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'D&D cancelled due to issue',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx({ headers })
  };

  const first = await transitionReservation(params);
  const second = await transitionReservation(params);

  assert.equal(second.reservationId, first.reservationId);
  assert.equal(second.status, 'cancelled');

  const voucherCount = await GiftVoucher.countDocuments({
    sourceReservationId: booking._id,
    issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
  });
  assert.equal(voucherCount, 1);

  const eventCount = await GiftVoucherEvent.countDocuments({
    giftVoucherId: first.compensationVoucher.giftVoucherId,
    type: COMPENSATION_EVENT_TYPE
  });
  assert.equal(eventCount, 1);
});

test('existing compensation voucher with different amount returns conflict', async () => {
  const booking = await createBooking();
  await issueCancellationCompensationVoucher({
    reservationId: booking._id,
    creditAmountCents: 15000,
    recipientEmail: booking.guestInfo.email,
    recipientName: 'Guest One',
    actor: 'ops@test.com',
    reason: 'Prior compensation'
  });

  await assertDomainError(
    transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'D&D cancelled due to issue',
      settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
      ctx: adminCtx()
    }),
    { type: 'conflict', code: 'CREDIT_AMOUNT_MISMATCH' }
  );

  assert.equal(await GiftVoucher.countDocuments({}), 1);
  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.status, 'confirmed');
});

test('does not create GiftVoucherCreatorCommission rows', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'D&D cancelled due to issue',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });
  assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 0);
});

test('does not create paid activated or sent events on compensation voucher', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'D&D cancelled due to issue',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });

  const events = await GiftVoucherEvent.find({ giftVoucherId: result.compensationVoucher.giftVoucherId }).lean();
  for (const event of events) {
    assert.ok(!PURCHASE_LIFECYCLE_TYPES.has(event.type), `unexpected event type: ${event.type}`);
  }
});
