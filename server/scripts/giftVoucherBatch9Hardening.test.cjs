const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const CreatorPartner = require('../models/CreatorPartner');
const ManualReviewItem = require('../models/ManualReviewItem');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const bookingRoutesFresh = () => require('../routes/bookingRoutes');
const bookingVoucherSvcPath = '../services/bookings/bookingVoucherRedemptionService';
const ledgerSvcPath = '../services/giftVouchers/giftVoucherLedgerService';
const paymentSvcPath = '../services/giftVouchers/giftVoucherPaymentService';
const commissionSvcPath = '../services/giftVouchers/giftVoucherCommissionService';

const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

const { expireDueGiftVouchers, releaseStaleGiftVoucherReservations } = require('../services/giftVouchers/giftVoucherMaintenanceService');
const emailService = require('../services/emailService');

const { reserveVoucherForCheckout } = require('../services/bookings/bookingVoucherRedemptionService');

let mongoServer;
let originalSendEmail;

function buildCreatePayload(overrides = {}) {
  return {
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer Nine',
    buyerEmail: 'buyer9@example.com',
    recipientName: 'Recipient Nine',
    recipientEmail: 'recipient9@example.com',
    message: 'Batch 9 hardening',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: `gvr_req_${new mongoose.Types.ObjectId().toString().slice(-12)}`,
    attribution: {},
    ...overrides
  };
}

function buildWebhookEvent(giftVoucherId, purchaseRequestId, paymentIntentId, stripeEventId = 'evt_b9_single') {
  return {
    id: stripeEventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: String(giftVoucherId),
          purchaseRequestId: String(purchaseRequestId)
        }
      }
    }
  };
}

function nextDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function createCabin() {
  return Cabin.create({
    name: 'Batch9 Cabin',
    description: 'Test',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
}

async function createCreator(overrides = {}) {
  const slug = `cr-b9-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
  return CreatorPartner.create({
    name: `Creator ${slug}`,
    slug,
    status: 'active',
    referral: { code: `ref.${slug}`, cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' },
    promo: { code: null },
    ...overrides
  });
}

function loadPaymentServiceWithCommissionThrow(throwError) {
  delete require.cache[require.resolve(paymentSvcPath)];
  delete require.cache[require.resolve(commissionSvcPath)];
  const commission = require(commissionSvcPath);
  const original = commission.ensureGiftVoucherCreatorCommissionAfterActivation;
  commission.ensureGiftVoucherCreatorCommissionAfterActivation = async () => {
    throw throwError;
  };
  const payment = require(paymentSvcPath);
  payment.setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_b9', client_secret: 'cs_b9' }),
      retrieve: async () => ({ id: 'pi_b9', client_secret: 'cs_b9' })
    }
  });
  return {
    payment,
    restore: () => {
      commission.ensureGiftVoucherCreatorCommissionAfterActivation = original;
      delete require.cache[require.resolve(paymentSvcPath)];
      delete require.cache[require.resolve(commissionSvcPath)];
    }
  };
}

function loadLedgerAndRedemptionWithReleaseStub(releaseImpl) {
  delete require.cache[require.resolve(ledgerSvcPath)];
  delete require.cache[require.resolve(bookingVoucherSvcPath)];
  const ledger = require(ledgerSvcPath);
  const original = ledger.releaseReservedRedemption;
  ledger.releaseReservedRedemption = releaseImpl;
  const redemption = require(bookingVoucherSvcPath);
  return {
    redemption,
    restore: () => {
      ledger.releaseReservedRedemption = original;
      delete require.cache[require.resolve(ledgerSvcPath)];
      delete require.cache[require.resolve(bookingVoucherSvcPath)];
    }
  };
}

function loadBookingRouteWithConfirmStub() {
  delete require.cache[require.resolve(ledgerSvcPath)];
  delete require.cache[require.resolve(bookingVoucherSvcPath)];
  delete require.cache[require.resolve('../routes/bookingRoutes')];
  const ledger = require(ledgerSvcPath);
  const original = ledger.confirmReservedRedemption;
  ledger.confirmReservedRedemption = async () => {
    throw new Error('simulated_confirm_failure');
  };
  require(bookingVoucherSvcPath);
  const routes = bookingRoutesFresh();
  return {
    routes,
    restore: () => {
      ledger.confirmReservedRedemption = original;
      delete require.cache[require.resolve(ledgerSvcPath)];
      delete require.cache[require.resolve(bookingVoucherSvcPath)];
      delete require.cache[require.resolve('../routes/bookingRoutes')];
    }
  };
}

async function purgeDb() {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucherRedemption.deleteMany({});
  await GiftVoucher.deleteMany({});
  await GiftVoucherCreatorCommission.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await ManualReviewItem.deleteMany({});
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await GiftVoucherRedemption.syncIndexes();
  await GiftVoucherCreatorCommission.syncIndexes();
  await CreatorPartner.syncIndexes();
  await Booking.syncIndexes();
  await Cabin.syncIndexes();
  await ManualReviewItem.syncIndexes();
  originalSendEmail = emailService.sendEmail.bind(emailService);
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await purgeDb();
  await CreatorPartner.deleteMany({});
  delete require.cache[require.resolve(paymentSvcPath)];
  delete require.cache[require.resolve(commissionSvcPath)];
  delete require.cache[require.resolve(ledgerSvcPath)];
  delete require.cache[require.resolve(bookingVoucherSvcPath)];
  delete require.cache[require.resolve('../routes/bookingRoutes')];
  const pay = require(paymentSvcPath);
  pay.setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_b9', client_secret: 'cs_b9' }),
      retrieve: async () => ({ id: 'pi_b9', client_secret: 'cs_b9' })
    }
  });
  emailService.sendEmail = async () => ({ success: true, method: 'stub', messageId: `msg_${Date.now()}` });
});

test('duplicate Stripe webhook ingestion still activates only once (paid/activated events)', async () => {
  const { createGiftVoucherPaymentIntent, activatePaidVoucherFromStripeEvent } = require(paymentSvcPath);
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload({ purchaseRequestId: 'gvr_req_b9_dupe_evt' }));
  const event = buildWebhookEvent(
    created.giftVoucherId,
    created.purchaseRequestId,
    created.stripePaymentIntentId,
    'evt_b9_twice_same'
  );
  await activatePaidVoucherFromStripeEvent(event);
  await activatePaidVoucherFromStripeEvent(event);
  const paid = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'paid',
    'metadata.stripeEventId': 'evt_b9_twice_same'
  });
  const activated = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'activated',
    'metadata.stripeEventId': 'evt_b9_twice_same'
  });
  assert.equal(paid, 1);
  assert.equal(activated, 1);
});

test('active voucher duplicate webhook does not duplicate email or commission artefacts', async () => {
  const c = await createCreator();
  const { createGiftVoucherPaymentIntent, activatePaidVoucherFromStripeEvent } = require(paymentSvcPath);
  const payload = buildCreatePayload({
    purchaseRequestId: 'gvr_req_b9_active_dupe',
    attribution: {
      referralCode: c.referral.code,
      creatorPartnerId: String(c._id)
    }
  });
  const created = await createGiftVoucherPaymentIntent(payload);
  const event = buildWebhookEvent(
    created.giftVoucherId,
    created.purchaseRequestId,
    created.stripePaymentIntentId,
    'evt_b9_active_twice'
  );
  await activatePaidVoucherFromStripeEvent(event);
  await activatePaidVoucherFromStripeEvent(event);
  const sentBuyer = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'buyer_receipt'
  });
  const sentRecipient = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'recipient_voucher'
  });
  assert.equal(sentBuyer, 1);
  assert.equal(sentRecipient, 1);
  assert.equal(await GiftVoucherCreatorCommission.countDocuments({ giftVoucherId: created.giftVoucherId }), 1);
});

test('activation event write failure opens payment_finalization_failure manual review', async () => {
  const eventSvc = require('../services/giftVouchers/giftVoucherEventService');
  const origAppend = eventSvc.appendVoucherEvent;
  eventSvc.appendVoucherEvent = async (p) => {
    if (p.type === 'paid' || p.type === 'activated') {
      throw new Error('forced_append_failure');
    }
    return origAppend.call(eventSvc, p);
  };
  try {
    delete require.cache[require.resolve(paymentSvcPath)];
    const payReload = require(paymentSvcPath);
    payReload.setStripeClientForTesting({
      paymentIntents: {
        create: async () => ({ id: 'pi_b9', client_secret: 'cs_b9' }),
        retrieve: async () => ({ id: 'pi_b9', client_secret: 'cs_b9' })
      }
    });
    const { createGiftVoucherPaymentIntent, activatePaidVoucherFromStripeEvent } = payReload;
    const created = await createGiftVoucherPaymentIntent(
      buildCreatePayload({ purchaseRequestId: 'gvr_req_b9_event_fail' })
    );
    const event = buildWebhookEvent(
      created.giftVoucherId,
      created.purchaseRequestId,
      created.stripePaymentIntentId,
      'evt_b9_append_fail'
    );
    const result = await activatePaidVoucherFromStripeEvent(event);
    assert.equal(result.ok, true);
    assert.equal(result.requiresManualReview, true);
    assert.equal(result.code, 'ACTIVATION_EVENT_WRITE_FAILED');
    const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).lean();
    assert.ok(review);
  } finally {
    eventSvc.appendVoucherEvent = origAppend;
  }
});

test('commission hook failure after activation does not rollback; opens manual review and returns commissionStatus failed', async () => {
  const c = await createCreator();
  const { payment, restore } = loadPaymentServiceWithCommissionThrow(new Error('commission_row_explodes'));
  try {
    const created = await payment.createGiftVoucherPaymentIntent(
      buildCreatePayload({
        purchaseRequestId: 'gvr_req_b9_comm_fail',
        attribution: { referralCode: c.referral.code, creatorPartnerId: String(c._id) }
      })
    );
    const event = buildWebhookEvent(
      created.giftVoucherId,
      created.purchaseRequestId,
      created.stripePaymentIntentId,
      'evt_b9_comm_fail'
    );
    const result = await payment.activatePaidVoucherFromStripeEvent(event);
    assert.equal(result.ok, true);
    assert.equal(result.activationCompleted, true);
    assert.equal(result.commissionStatus, 'failed');
    assert.equal(result.giftVoucherCommission?.ok, false);
    const v = await GiftVoucher.findById(created.giftVoucherId).lean();
    assert.equal(v.status, 'active');
    assert.ok(v.code);
    const review = await ManualReviewItem.findOne({ category: 'gift_voucher_commission_creation_failed' }).lean();
    assert.ok(review);
    assert.equal(String(review.entityId), String(created.giftVoucherId));
  } finally {
    restore();
  }
});

test('parallel reservations with different checkoutIds cannot overspend same voucher', async () => {
  const voucher = await GiftVoucher.create({
    code: 'DD-B9-PP-QQ-RR',
    amountOriginalCents: 50000,
    balanceRemainingCents: 50000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: nextDate(10)
  });
  const exp = nextDate(1);
  const outcomes = await Promise.allSettled([
    reserveVoucherForCheckout({
      voucherCode: voucher.code,
      checkoutId: 'chk_b9_parallel_a',
      totalValueCents: 40000,
      redemptionExpiresAt: exp
    }),
    reserveVoucherForCheckout({
      voucherCode: voucher.code,
      checkoutId: 'chk_b9_parallel_b',
      totalValueCents: 40000,
      redemptionExpiresAt: exp
    })
  ]);
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(reloaded.balanceRemainingCents, 10000);
  const reservedRows = await GiftVoucherRedemption.countDocuments({ status: 'reserved' });
  assert.equal(reservedRows, 1);
});

test('releaseExpiredVoucherReservations is idempotent on repeated runs', async () => {
  const voucher = await GiftVoucher.create({
    code: 'DD-B9-ST-AL-01',
    amountOriginalCents: 40000,
    balanceRemainingCents: 40000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: nextDate(10)
  });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_b9_stale_idem',
    totalValueCents: 10000,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });
  const { releaseExpiredVoucherReservations } = require(bookingVoucherSvcPath);
  const s1 = await releaseExpiredVoucherReservations({ now: new Date(), limit: 10 });
  const s2 = await releaseExpiredVoucherReservations({ now: new Date(), limit: 10 });
  assert.ok(s1.released >= 1);
  assert.equal(s2.released, 0);
  assert.equal(s2.failed, 0);
  const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
  assert.equal(redemption.status, 'released');
  const after = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(after.balanceRemainingCents, 40000);
});

test('releaseStaleGiftVoucherReservations restores balance and uses maintenance delegation', async () => {
  const voucher = await GiftVoucher.create({
    code: 'DD-B9-ST-AL-02',
    amountOriginalCents: 30000,
    balanceRemainingCents: 30000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: nextDate(10)
  });
  await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_b9_stale_maint',
    totalValueCents: 8000,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });
  const summary = await releaseStaleGiftVoucherReservations({ now: new Date(), limit: 10 });
  assert.ok(summary.released >= 1);
  const after = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(after.balanceRemainingCents, 30000);
});

test('stale release failure opens gift_voucher_reservation_release_failed manual review', async () => {
  const voucher = await GiftVoucher.create({
    code: 'DD-B9-FL-RL-01',
    amountOriginalCents: 20000,
    balanceRemainingCents: 20000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: nextDate(10)
  });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_b9_release_fail',
    totalValueCents: 5000,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });

  const { redemption, restore } = loadLedgerAndRedemptionWithReleaseStub(async () => {
    throw new Error('simulated_release_failure');
  });
  try {
    const summary = await redemption.releaseExpiredVoucherReservations({
      now: new Date(),
      limit: 10,
      openManualReviewOnFailure: true
    });
    assert.equal(summary.failed, 1);
    const review = await ManualReviewItem.findOne({ category: 'gift_voucher_reservation_release_failed' }).lean();
    assert.ok(review);
    assert.equal(String(review.entityId), String(reserved.redemptionId));
  } finally {
    restore();
  }
});

test('expireDueGiftVouchers transitions due rows and is idempotent on expired events', async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const v = await GiftVoucher.create({
    code: 'DD-B9-EX-PI-01',
    amountOriginalCents: 10000,
    balanceRemainingCents: 10000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: past
  });
  const s1 = await expireDueGiftVouchers({ now: new Date(), limit: 5, actor: 'test' });
  assert.equal(s1.transitioned, 1);
  assert.equal(s1.eventsAppended, 1);
  assert.equal(s1.repairEventsAppended, 0);
  const s2 = await expireDueGiftVouchers({ now: new Date(), limit: 5, actor: 'test' });
  assert.equal(s2.transitioned, 0);
  assert.equal(s2.repairEventsAppended, 0);
  const reloaded = await GiftVoucher.findById(v._id).lean();
  assert.equal(reloaded.status, 'expired');
  const evCount = await GiftVoucherEvent.countDocuments({ giftVoucherId: v._id, type: 'expired' });
  assert.equal(evCount, 1);
});

test('expireDueGiftVouchers repairs expired voucher missing expired ledger event', async () => {
  const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const v = await GiftVoucher.create({
    code: 'DD-B9-EX-RP-01',
    amountOriginalCents: 20000,
    balanceRemainingCents: 15000,
    currency: 'EUR',
    status: 'expired',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: past
  });
  const summary = await expireDueGiftVouchers({ now: new Date(), limit: 5, actor: 'test' });
  assert.equal(summary.repairEventsAppended, 1);
  assert.equal(summary.transitioned, 0);
  const ev = await GiftVoucherEvent.findOne({ giftVoucherId: v._id, type: 'expired' }).lean();
  assert.ok(ev);
  assert.equal(ev.deltaCents, 0);
});

test('expireDueGiftVouchers repair of missing expired event is idempotent', async () => {
  const past = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const v = await GiftVoucher.create({
    code: 'DD-B9-EX-ID-01',
    amountOriginalCents: 12000,
    balanceRemainingCents: 12000,
    currency: 'EUR',
    status: 'expired',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: past
  });
  const s1 = await expireDueGiftVouchers({ now: new Date(), limit: 5, actor: 'test' });
  assert.equal(s1.repairEventsAppended, 1);
  const s2 = await expireDueGiftVouchers({ now: new Date(), limit: 5, actor: 'test' });
  assert.equal(s2.repairEventsAppended, 0);
  assert.equal(await GiftVoucherEvent.countDocuments({ giftVoucherId: v._id, type: 'expired' }), 1);
});

test('expired event write failure opens gift_voucher_expiry_event_failed manual review', async () => {
  const past = new Date(Date.now() - 96 * 60 * 60 * 1000);
  await GiftVoucher.create({
    code: 'DD-B9-EX-WF-01',
    amountOriginalCents: 8000,
    balanceRemainingCents: 8000,
    currency: 'EUR',
    status: 'expired',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: past
  });

  const giftVoucherEventService = require('../services/giftVouchers/giftVoucherEventService');
  const originalAppend = giftVoucherEventService.appendFinancialVoucherEvent;
  giftVoucherEventService.appendFinancialVoucherEvent = async () => {
    throw new Error('forced_expired_event_failure');
  };
  try {
    const summary = await expireDueGiftVouchers({ now: new Date(), limit: 5, actor: 'test' });
    assert.equal(summary.expiryEventWriteFailures, 1);
    assert.equal(summary.repairEventsAppended, 0);
    const review = await ManualReviewItem.findOne({ category: 'gift_voucher_expiry_event_failed' }).lean();
    assert.ok(review);
    assert.equal(review.evidence.balanceRemainingCents, 8000);
    assert.ok(String(review.evidence.error || '').includes('forced_expired_event_failure'));
  } finally {
    giftVoucherEventService.appendFinancialVoucherEvent = originalAppend;
  }
});

test('booking save with confirm failure returns guest-safe response and opens manual review', async () => {
  const cabin = await createCabin();
  const voucher = await GiftVoucher.create({
    code: 'DD-B9-CF-IR-01',
    amountOriginalCents: 60000,
    balanceRemainingCents: 60000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'B',
    buyerEmail: 'b@example.com',
    recipientName: 'R',
    recipientEmail: 'r@example.com',
    expiresAt: nextDate(30)
  });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_b9_confirm_fail',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });

  const { routes, restore } = loadBookingRouteWithConfirmStub();
  try {
    routes.__setStripeClientForTesting(null);
    const app = express();
    app.use(express.json());
    app.use('/api/bookings', routes);

    const response = await request(app)
      .post('/api/bookings')
      .send({
        cabinId: String(cabin._id),
        checkIn: nextDate(3).toISOString(),
        checkOut: nextDate(5).toISOString(),
        adults: 2,
        children: 0,
        checkoutId: 'chk_b9_confirm_fail',
        voucherRedemptionId: reserved.redemptionId,
        guestInfo: { firstName: 'A', lastName: 'B', email: 'guest@example.com', phone: '+359999999' },
        legalAcceptance: {
          acceptedTermsAndCancellation: true,
          acceptedActivityRisk: true,
          termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
          activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
          checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
          checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
        }
      });

    assert.equal(response.status, 500);
    assert.equal(response.body?.success, false);
    const bookings = await Booking.find({ checkoutId: 'chk_b9_confirm_fail' }).lean();
    assert.equal(bookings.length, 1);
    const review = await ManualReviewItem.findOne({
      category: 'gift_voucher_redemption_confirm_failed'
    }).lean();
    assert.ok(review);
  } finally {
    restore();
  }
});
