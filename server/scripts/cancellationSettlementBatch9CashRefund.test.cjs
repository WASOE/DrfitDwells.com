const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const AuditEvent = require('../models/AuditEvent');
const {
  transitionReservation,
  resolveCancellationSettlement
} = require('../services/ops/domain/reservationWriteService');
const { derivePaymentAttention, shouldEmitRefundFollowUpAlert } = require('../services/ops/payment/reservationPaymentSignals');

let mongoServer;

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function adminCtx(overrides = {}) {
  return {
    user: { id: 'admin-batch9', role: 'admin' },
    req: { headers: overrides.headers || {} },
    route: 'test/cash-refund',
    ...overrides
  };
}

async function createCabin() {
  return Cabin.create({
    name: `Batch9 Cabin ${new mongoose.Types.ObjectId().toString().slice(-6)}`,
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

async function assertDomainError(promise, { type }) {
  await assert.rejects(promise, (err) => {
    if (type && err.type !== type) return false;
    return true;
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await AuditEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await GiftVoucherEvent.collection.deleteMany({});
  await GiftVoucher.deleteMany({});
  await AuditEvent.collection.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
});

test('cancel confirmed booking with cash_refund_pending', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cash refund',
    settlement: {
      outcome: 'cash_refund_pending',
      cashRefundAmountCents: 30000,
      cashRefundNote: 'Refund via Stripe dashboard'
    },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'cash_refund_pending');
  assert.equal(result.cancellationSettlement.cashRefundAmountCents, 30000);
  assert.equal(result.cancellationSettlement.cashRefundNote, 'Refund via Stripe dashboard');
  assert.equal(result.compensationVoucher, undefined);

  const vouchers = await GiftVoucher.find({ sourceReservationId: booking._id }).lean();
  assert.equal(vouchers.length, 0);

  const attention = derivePaymentAttention({
    reservationStatus: 'cancelled',
    paymentStatus: 'paid',
    cancellationSettlementOutcome: result.cancellationSettlement.outcome
  });
  assert.equal(attention.refundPending, true);
  assert.equal(attention.cancelledPaid, true);
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: result.cancellationSettlement.outcome
    }),
    true
  );
});

test('cancel with cash_refunded saves evidence and suppresses follow-up', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest refunded manually before cancel recorded',
    settlement: {
      outcome: 'cash_refunded',
      cashRefundEvidence: {
        amountCents: 30000,
        method: 'stripe_manual',
        reference: 're_manual_123',
        note: 'Refunded in Stripe dashboard'
      }
    },
    ctx: adminCtx()
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellationSettlement.outcome, 'cash_refunded');
  assert.equal(result.cancellationSettlement.cashRefundAmountCents, 30000);
  assert.equal(result.cancellationSettlement.cashRefundEvidence.amountCents, 30000);
  assert.equal(result.cancellationSettlement.cashRefundEvidence.method, 'stripe_manual');
  assert.equal(result.cancellationSettlement.cashRefundEvidence.reference, 're_manual_123');
  assert.equal(result.cancellationSettlement.cashRefundEvidence.note, 'Refunded in Stripe dashboard');
  assert.ok(result.cancellationSettlement.cashRefundEvidence.recordedAt);

  const vouchers = await GiftVoucher.find({ sourceReservationId: booking._id }).lean();
  assert.equal(vouchers.length, 0);

  const attention = derivePaymentAttention({
    reservationStatus: 'cancelled',
    paymentStatus: 'paid',
    cancellationSettlementOutcome: result.cancellationSettlement.outcome
  });
  assert.equal(attention.refundPending, false);
  assert.equal(attention.cancelledPaid, false);
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: result.cancellationSettlement.outcome
    }),
    false
  );
});

test('resolve pending settlement to cash_refund_pending', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cancel',
    ctx: adminCtx()
  });

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Guest chose cash refund',
    settlement: {
      outcome: 'cash_refund_pending',
      cashRefundAmountCents: 30000
    },
    ctx: adminCtx()
  });

  assert.equal(result.cancellationSettlement.outcome, 'cash_refund_pending');
  assert.equal(result.cancellationSettlement.cashRefundAmountCents, 30000);

  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.cancellationSettlement.outcome, 'cash_refund_pending');
});

test('resolve pending settlement to cash_refunded with evidence', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cancel',
    ctx: adminCtx()
  });

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Refund completed manually',
    settlement: {
      outcome: 'cash_refunded',
      cashRefundEvidence: {
        amountCents: 25000,
        method: 'bank_transfer',
        reference: 'TRX-9988',
        note: 'Bank transfer sent'
      }
    },
    ctx: adminCtx()
  });

  assert.equal(result.cancellationSettlement.outcome, 'cash_refunded');
  assert.equal(result.cancellationSettlement.cashRefundEvidence.amountCents, 25000);
  assert.equal(result.cancellationSettlement.cashRefundEvidence.method, 'bank_transfer');
});

test('reject cash_refunded without required amount/evidence', async () => {
  const booking = await createBooking();

  await assertDomainError(
    transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'Missing evidence',
      settlement: { outcome: 'cash_refunded' },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );

  await assertDomainError(
    transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'Missing method',
      settlement: {
        outcome: 'cash_refunded',
        cashRefundEvidence: {
          amountCents: 30000,
          note: 'No method provided'
        }
      },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
});

test('cash_refund_pending can resolve to cash_refunded with evidence', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Cash refund pending',
    settlement: {
      outcome: 'cash_refund_pending',
      cashRefundAmountCents: 30000
    },
    ctx: adminCtx()
  });

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Refund completed in Stripe dashboard',
    settlement: {
      outcome: 'cash_refunded',
      cashRefundEvidence: {
        amountCents: 30000,
        method: 'stripe_manual',
        reference: 're_manual_456',
        note: 'Refunded manually'
      }
    },
    ctx: adminCtx()
  });

  assert.equal(result.cancellationSettlement.outcome, 'cash_refunded');
  assert.equal(result.cancellationSettlement.cashRefundEvidence.amountCents, 30000);
  assert.equal(result.cancellationSettlement.cashRefundEvidence.method, 'stripe_manual');

  const attention = derivePaymentAttention({
    reservationStatus: 'cancelled',
    paymentStatus: 'paid',
    cancellationSettlementOutcome: result.cancellationSettlement.outcome
  });
  assert.equal(attention.refundPending, false);
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: result.cancellationSettlement.outcome
    }),
    false
  );
});

test('cash_refund_pending rejects resolve to payment_retained', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Cash refund pending',
    settlement: {
      outcome: 'cash_refund_pending',
      cashRefundAmountCents: 30000
    },
    ctx: adminCtx()
  });

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Try payment retained',
      settlement: { outcome: 'payment_retained' },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
});

test('cash_refund_pending rejects resolve to credits_issued', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Cash refund pending',
    settlement: {
      outcome: 'cash_refund_pending',
      cashRefundAmountCents: 30000
    },
    ctx: adminCtx()
  });

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Try stay credit',
      settlement: { outcome: 'credits_issued', creditAmountCents: 12000 },
      ctx: adminCtx()
    }),
    { type: 'validation' }
  );
});

test('already cash_refunded rejects further resolve', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Already refunded',
    settlement: {
      outcome: 'cash_refunded',
      cashRefundEvidence: {
        amountCents: 30000,
        method: 'stripe_manual',
        note: 'Done'
      }
    },
    ctx: adminCtx()
  });

  await assertDomainError(
    resolveCancellationSettlement({
      bookingId: booking._id,
      reason: 'Try again',
      settlement: {
        outcome: 'cash_refunded',
        cashRefundEvidence: {
          amountCents: 30000,
          method: 'stripe_manual',
          note: 'Again'
        }
      },
      ctx: adminCtx()
    }),
    { type: 'invalid_transition' }
  );
});

test('completed booking cancel still rejected by API', async () => {
  const booking = await createBooking({ status: 'completed' });

  await assertDomainError(
    transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'Should not work',
      settlement: { outcome: 'cash_refund_pending', cashRefundAmountCents: 30000 },
      ctx: adminCtx()
    }),
    { type: 'invalid_transition' }
  );
});
