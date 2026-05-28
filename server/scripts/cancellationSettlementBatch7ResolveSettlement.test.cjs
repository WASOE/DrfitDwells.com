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
const {
  transitionReservation,
  resolveCancellationSettlement
} = require('../services/ops/domain/reservationWriteService');
const {
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
} = require('../services/giftVouchers/giftVoucherIssuance');
const {
  issueCancellationCompensationVoucher,
  COMPENSATION_EVENT_TYPE
} = require('../services/giftVouchers/issueCancellationCompensationVoucherService');
const { derivePaymentAttention } = require('../services/ops/payment/reservationPaymentSignals');

let mongoServer;

const PURCHASE_LIFECYCLE_TYPES = new Set(['paid', 'activated', 'sent']);

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function adminCtx(overrides = {}) {
  return {
    user: { id: 'admin-batch7', role: 'admin' },
    req: { headers: overrides.headers || {} },
    route: 'test/resolve',
    ...overrides
  };
}

async function createCabin() {
  return Cabin.create({
    name: `Batch7 Cabin ${new mongoose.Types.ObjectId().toString().slice(-6)}`,
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

async function cancelToResolutionPending(booking, ctx = adminCtx()) {
  return transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cancel',
    ctx
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

test('cancel to resolution_pending, then resolve to payment_retained', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Guest accepted non-refundable terms',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'payment_retained');
  assert.equal(await GiftVoucher.countDocuments({}), 0);

  const attention = derivePaymentAttention({
    reservationStatus: 'cancelled',
    paymentStatus: 'paid',
    cancellationSettlementOutcome: result.cancellationSettlement.outcome
  });
  assert.deepEqual(attention, {
    cancelledPaid: false,
    refundPending: false,
    paymentAttention: false
  });
});

test('cancel to resolution_pending, then resolve to credits_issued', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Guest chose stay credit',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'credits_issued');
  assert.equal(result.cancellationSettlement.creditAmountCents, 12000);
  assert.ok(result.cancellationSettlement.compensationGiftVoucherId);
  assert.ok(result.compensationVoucher?.code);

  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.cancellationSettlement.outcome, 'credits_issued');
  assert.equal(
    String(saved.cancellationSettlement.compensationGiftVoucherId),
    result.compensationVoucher.giftVoucherId
  );
});

test('cancelled booking with missing cancellationSettlement resolves to payment_retained', async () => {
  const booking = await createBooking({ status: 'cancelled' });

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Legacy cancelled row finalized as retained',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'payment_retained');
});

test('non-cancelled booking resolve returns 409', async () => {
  const booking = await createBooking({ status: 'confirmed' });
  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Should not resolve',
      settlement: { outcome: 'payment_retained' },
      ctx: adminCtx()
    }),
    { type: 'invalid_transition' }
  );
});

test('already payment_retained returns 409', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Non-refundable',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Try again',
      settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
      ctx: adminCtx()
    }),
    { type: 'invalid_transition' }
  );
});

test('already credits_issued returns 409', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Issue credit on cancel',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Try again',
      settlement: { outcome: 'payment_retained' },
      ctx: adminCtx()
    }),
    { type: 'invalid_transition' }
  );
});

test('credits_issued missing creditAmountCents returns 400', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Missing amount',
      settlement: { outcome: 'credits_issued' },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
  assert.equal(await GiftVoucher.countDocuments({}), 0);
});

test('credits_issued below 10000 returns 400', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Too small',
      settlement: { outcome: 'credits_issued', creditAmountCents: 9999 },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
  assert.equal(await GiftVoucher.countDocuments({}), 0);
});

test('credits_issued amount mismatch with existing voucher returns 409', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  await issueCancellationCompensationVoucher({
    reservationId: booking._id,
    creditAmountCents: 15000,
    recipientEmail: booking.guestInfo.email,
    recipientName: 'Guest One',
    actor: 'ops@test.com',
    reason: 'Prior compensation'
  });

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Different amount',
      settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
      ctx: adminCtx()
    }),
    { type: 'conflict', code: 'CREDIT_AMOUNT_MISMATCH' }
  );

  assert.equal(await GiftVoucher.countDocuments({}), 1);
  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.cancellationSettlement.outcome, 'resolution_pending');
});

test('same idempotency key retry does not duplicate voucher or event', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  const headers = { 'x-idempotency-key': `resolve-credit-${booking._id}` };
  const params = {
    bookingId: booking._id,
    reason: 'Guest chose stay credit',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx({ headers })
  };

  const first = await resolveCancellationSettlement(params);
  const second = await resolveCancellationSettlement(params);

  assert.equal(second.reservationId, first.reservationId);
  assert.equal(second.cancellationSettlement.outcome, 'credits_issued');
  assert.equal(second.compensationVoucher.giftVoucherId, first.compensationVoucher.giftVoucherId);

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

test('does not create GiftVoucherCreatorCommission rows', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);
  await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Guest chose stay credit',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });
  assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 0);
});

test('does not create paid activated or sent events on compensation voucher', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);
  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Guest chose stay credit',
    settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
    ctx: adminCtx()
  });

  const events = await GiftVoucherEvent.find({ giftVoucherId: result.compensationVoucher.giftVoucherId }).lean();
  for (const event of events) {
    assert.ok(!PURCHASE_LIFECYCLE_TYPES.has(event.type), `unexpected event type: ${event.type}`);
  }
});

test('audit event reservation_resolve_cancellation_settlement with before/after snapshots', async () => {
  const booking = await createBooking();
  await cancelToResolutionPending(booking);

  await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Finalize as retained',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });

  const audit = await AuditEvent.findOne({
    entityType: 'Reservation',
    entityId: String(booking._id),
    action: 'reservation_resolve_cancellation_settlement'
  }).lean();

  assert.ok(audit);
  assert.equal(audit.beforeSnapshot.status, 'cancelled');
  assert.equal(audit.beforeSnapshot.cancellationSettlement.outcome, 'resolution_pending');
  assert.equal(audit.afterSnapshot.status, 'cancelled');
  assert.equal(audit.afterSnapshot.cancellationSettlement.outcome, 'payment_retained');
  assert.equal(audit.reason, 'Finalize as retained');
});
