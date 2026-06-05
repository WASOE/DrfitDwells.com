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
const adminController = require('../controllers/adminController');
const emailService = require('../services/emailService');
const giftVoucherEmailService = require('../services/giftVouchers/giftVoucherEmailService');
const {
  transitionReservation,
  resolveCancellationSettlement
} = require('../services/ops/domain/reservationWriteService');

let mongoServer;
const sentEmails = [];
const purchaseEmailCalls = [];

const originalSendEmail = emailService.sendEmail.bind(emailService);
const originalHandleActivatedGiftVoucherDelivery =
  giftVoucherEmailService.handleActivatedGiftVoucherDelivery.bind(giftVoucherEmailService);
const originalResendRecipientGiftVoucherEmail =
  giftVoucherEmailService.resendRecipientGiftVoucherEmail.bind(giftVoucherEmailService);

function makeRes() {
  return {
    statusCode: 200,
    _payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this._payload = payload;
      return this._payload;
    }
  };
}

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function adminCtx(overrides = {}) {
  return {
    user: { id: 'admin-batch11', role: 'admin' },
    req: { headers: overrides.headers || {} },
    route: 'test/final-blockers',
    ...overrides
  };
}

async function createCabin() {
  return Cabin.create({
    name: `Batch11 Cabin ${new mongoose.Types.ObjectId().toString().slice(-6)}`,
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

function stayCreditEmails() {
  return sentEmails.filter((entry) => entry.trigger === 'cancellation_stay_credit');
}

function cancelledLifecycleEmails() {
  return sentEmails.filter((entry) => entry.trigger === 'booking_cancelled');
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
  emailService.sendEmail = originalSendEmail;
  giftVoucherEmailService.handleActivatedGiftVoucherDelivery = originalHandleActivatedGiftVoucherDelivery;
  giftVoucherEmailService.resendRecipientGiftVoucherEmail = originalResendRecipientGiftVoucherEmail;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  sentEmails.length = 0;
  purchaseEmailCalls.length = 0;
  emailService.sendEmail = async (opts) => {
    sentEmails.push(opts);
    return { success: true, method: 'logged' };
  };
  giftVoucherEmailService.handleActivatedGiftVoucherDelivery = async (...args) => {
    purchaseEmailCalls.push({ fn: 'handleActivatedGiftVoucherDelivery', args });
    return { success: true };
  };
  giftVoucherEmailService.resendRecipientGiftVoucherEmail = async (...args) => {
    purchaseEmailCalls.push({ fn: 'resendRecipientGiftVoucherEmail', args });
    return { success: true };
  };

  await GiftVoucherEvent.collection.deleteMany({});
  await GiftVoucherCreatorCommission.deleteMany({});
  await GiftVoucher.deleteMany({});
  await AuditEvent.collection.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
});

test('legacy admin status endpoint rejects cancelled and leaves booking unchanged', async () => {
  const booking = await createBooking({ status: 'confirmed' });
  const req = {
    params: { id: String(booking._id) },
    body: { status: 'cancelled' },
    user: { id: 'admin', role: 'admin' }
  };
  const res = makeRes();

  await adminController.updateBookingStatus(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res._payload?.errorType, 'legacy_cancel_blocked');
  assert.match(res._payload?.message, /OPS reservation cancellation settlement flow/i);

  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.cancellationSettlement, undefined);
});

test('legacy admin non-cancel status update still works', async () => {
  const booking = await createBooking({ status: 'pending' });
  const req = {
    params: { id: String(booking._id) },
    body: { status: 'confirmed' },
    user: { id: 'admin', role: 'admin' }
  };
  const res = makeRes();

  await adminController.updateBookingStatus(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._payload?.success, true);

  const saved = await Booking.findById(booking._id).lean();
  assert.equal(saved.status, 'confirmed');
});

test('cancel with credits_issued sends stay-credit email with voucher code', async () => {
  const booking = await createBooking();
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Issue stay credit on cancel',
    settlement: {
      outcome: 'credits_issued',
      creditAmountCents: 12000
    },
    ctx: adminCtx()
  });

  assert.equal(result.cancellationSettlement.outcome, 'credits_issued');
  assert.ok(result.compensationVoucher?.code);

  const stayEmails = stayCreditEmails();
  assert.equal(stayEmails.length, 1);
  assert.equal(stayEmails[0].trigger, 'cancellation_stay_credit');
  assert.match(stayEmails[0].subject, /stay credit/i);
  assert.match(stayEmails[0].text, new RegExp(result.compensationVoucher.code));
  assert.match(stayEmails[0].text, /stay credit/i);
  assert.match(stayEmails[0].text, /not a purchased gift card/i);
  assert.equal(purchaseEmailCalls.length, 0);
});

test('resolve to credits_issued sends stay-credit email with voucher code', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cancel',
    ctx: adminCtx()
  });

  sentEmails.length = 0;

  const result = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'Guest accepted stay credit',
    settlement: {
      outcome: 'credits_issued',
      creditAmountCents: 15000
    },
    ctx: adminCtx()
  });

  assert.equal(result.cancellationSettlement.outcome, 'credits_issued');
  assert.ok(result.compensationVoucher?.code);

  const stayEmails = stayCreditEmails();
  assert.equal(stayEmails.length, 1);
  assert.match(stayEmails[0].text, new RegExp(result.compensationVoucher.code));
  assert.equal(purchaseEmailCalls.length, 0);
});

test('payment_retained does not send stay-credit email', async () => {
  const booking = await createBooking();
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Payment retained',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });

  assert.equal(stayCreditEmails().length, 0);
  assert.ok(cancelledLifecycleEmails().length >= 0);
});

test('cash_refund_pending does not send stay-credit email', async () => {
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

  assert.equal(stayCreditEmails().length, 0);
});

test('cash_refunded does not send stay-credit email', async () => {
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
        note: 'Refunded manually'
      }
    },
    ctx: adminCtx()
  });

  assert.equal(stayCreditEmails().length, 0);
});
