/**
 * Email delivery state hardening — Batch 1 tests.
 * Run: cd server && node --test scripts/emailDeliveryHardening.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const EmailEvent = require('../models/EmailEvent');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const ManualReviewItem = require('../models/ManualReviewItem');
const GiftVoucher = require('../models/GiftVoucher');
const emailService = require('../services/emailService');
const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');
const {
  resendRecipientGiftVoucherEmail
} = require('../services/giftVouchers/giftVoucherEmailService');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');
const {
  BOOKING_LIFECYCLE_EMAIL_FAILED,
  GIFT_VOUCHER_EMAIL_FAILED
} = require('../services/email/emailDeliveryStateService');
const {
  bookingLifecycleCorrelationKey,
  giftVoucherRecipientCorrelationKey
} = require('../services/email/emailDeliveryCorrelation');

let mongoServer;
let originalSendEmail;

const minimalEntity = {
  name: 'Test Cabin',
  location: 'Test Valley',
  arrivalWindowDefault: '15:00–18:00'
};

function minimalBooking(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    checkIn: new Date('2026-07-01'),
    checkOut: new Date('2026-07-03'),
    adults: 2,
    children: 0,
    totalPrice: 100,
    status: 'confirmed',
    guestInfo: { firstName: 'A', lastName: 'B', email: 'guest@example.com', phone: '+10000000000' },
    ...overrides
  };
}

function emailAlertsFromDashboard(dashboardResult) {
  const alerts = dashboardResult?.dashboard?.alerts || dashboardResult?.sections?.actionNeeded || [];
  return alerts.filter(
    (a) => a.type === 'guest_email_failed' || a.type === 'gift_voucher_email_failed'
  );
}

async function sendLifecycle({ booking, templateKey, lifecycleSource, overrideRecipient, success, error }) {
  emailService.sendEmail = async () =>
    success
      ? { success: true, method: 'sent', messageId: `msg_${Date.now()}_${Math.random()}` }
      : { success: false, method: 'failed', error: error || 'smtp down' };

  return bookingLifecycleEmailService.sendBookingLifecycleEmail({
    booking,
    templateKey,
    overrideRecipient,
    lifecycleSource,
    actorContext: lifecycleSource === 'manual_resend' ? { actorId: 'ops-1', actorRole: 'admin' } : null,
    entity: minimalEntity
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await EmailEvent.syncIndexes();
  await EmailDeliveryState.syncIndexes();
  await ManualReviewItem.syncIndexes();
  await GiftVoucher.syncIndexes();
  originalSendEmail = emailService.sendEmail.bind(emailService);
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  emailService.sendEmail = originalSendEmail;
  await Promise.all([
    EmailEvent.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    GiftVoucher.deleteMany({}),
    mongoose.connection.db.collection('giftvoucherevents').deleteMany({})
  ]);
});

test('1. failed lifecycle email with no later success -> dashboard alert shown', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: false
  });

  const dashboard = await getDashboardReadModel();
  const alerts = emailAlertsFromDashboard(dashboard);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'guest_email_failed');
  assert.match(alerts[0].detail, /guest@example.com/);
});

test('2. failed lifecycle email followed by successful manual_resend -> dashboard alert hidden', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: false
  });
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    success: true
  });

  const dashboard = await getDashboardReadModel();
  assert.equal(emailAlertsFromDashboard(dashboard).length, 0);

  const failedEvents = await EmailEvent.find({ bookingId: booking._id, sendStatus: 'failed' }).lean();
  assert.equal(failedEvents.length, 1);
});

test('3. failed email to recipient A, success to recipient B -> A still alert', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    overrideRecipient: 'a@example.com',
    success: false
  });
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    overrideRecipient: 'b@example.com',
    success: true
  });

  const dashboard = await getDashboardReadModel();
  const alerts = emailAlertsFromDashboard(dashboard);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].detail, /a@example.com/);
});

test('4. failed template X, success template Y -> X still alert', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
    lifecycleSource: 'automatic',
    success: false
  });
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: true
  });

  const dashboard = await getDashboardReadModel();
  const alerts = emailAlertsFromDashboard(dashboard);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].detail, /booking_received/);
});

test('5. success then newer failure -> alert shown', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: true
  });
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    success: false
  });

  const dashboard = await getDashboardReadModel();
  assert.equal(emailAlertsFromDashboard(dashboard).length, 1);
});

test('6. duplicate failures -> one open ManualReviewItem / one dashboard alert', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: false
  });
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    success: false,
    error: 'still down'
  });

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipientEmail: 'guest@example.com'
  });

  const openReviews = await ManualReviewItem.find({
    category: BOOKING_LIFECYCLE_EMAIL_FAILED,
    status: 'open',
    'evidence.deliveryCorrelationKey': correlationKey
  }).lean();
  assert.equal(openReviews.length, 1);

  const dashboard = await getDashboardReadModel();
  assert.equal(emailAlertsFromDashboard(dashboard).length, 1);
});

test('7. successful OPS resend resolves matching ManualReviewItem', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: false
  });

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipientEmail: 'guest@example.com'
  });

  let review = await ManualReviewItem.findOne({
    category: BOOKING_LIFECYCLE_EMAIL_FAILED,
    'evidence.deliveryCorrelationKey': correlationKey
  }).lean();
  assert.equal(review.status, 'open');

  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    success: true
  });

  review = await ManualReviewItem.findById(review._id).lean();
  assert.equal(review.status, 'resolved');
  assert.ok(review.resolution?.resolvedAt);
  assert.match(review.resolution?.note || '', /resend/i);
});

test('8. failed resend leaves ManualReviewItem open', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: false
  });
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    success: false,
    error: 'resend failed'
  });

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipientEmail: 'guest@example.com'
  });

  const review = await ManualReviewItem.findOne({
    category: BOOKING_LIFECYCLE_EMAIL_FAILED,
    'evidence.deliveryCorrelationKey': correlationKey
  }).lean();
  assert.equal(review.status, 'open');
});

test('9. gift voucher recipient resend success resolves gift_voucher_email_failed', async () => {
  const voucher = await GiftVoucher.create({
    code: 'DD-TEST-AAAA-BBBB',
    status: 'active',
    amountOriginalCents: 10000,
    balanceRemainingCents: 10000,
    currency: 'EUR',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  });

  const correlationKey = giftVoucherRecipientCorrelationKey({
    giftVoucherId: voucher._id,
    recipientEmail: 'recipient@example.com'
  });

  await ManualReviewItem.create({
    category: GIFT_VOUCHER_EMAIL_FAILED,
    severity: 'high',
    status: 'open',
    entityType: 'GiftVoucher',
    entityId: String(voucher._id),
    title: 'Gift voucher email failed',
    details: 'seeded failure',
    evidence: { deliveryCorrelationKey: correlationKey, giftVoucherId: String(voucher._id) }
  });

  await EmailDeliveryState.create({
    correlationKey,
    domain: 'gift_voucher',
    giftVoucherId: voucher._id,
    templateKind: 'recipient_voucher',
    recipient: 'recipient@example.com',
    latestStatus: 'failed',
    latestEventAt: new Date()
  });

  emailService.sendEmail = async () => ({ success: true, method: 'sent', messageId: 'gv-resend-1' });
  await resendRecipientGiftVoucherEmail({ giftVoucherId: voucher._id, actor: 'ops' });

  const review = await ManualReviewItem.findOne({
    category: GIFT_VOUCHER_EMAIL_FAILED,
    'evidence.deliveryCorrelationKey': correlationKey
  }).lean();
  assert.equal(review.status, 'resolved');

  const dashboard = await getDashboardReadModel();
  assert.equal(emailAlertsFromDashboard(dashboard).length, 0);
});

test('10. historical EmailEvent rows remain unchanged after successful resend', async () => {
  const booking = minimalBooking();
  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'automatic',
    success: false,
    error: 'original failure'
  });

  const failedBefore = await EmailEvent.findOne({ bookingId: booking._id, sendStatus: 'failed' }).lean();
  assert.ok(failedBefore);
  const failedSnapshot = {
    sendStatus: failedBefore.sendStatus,
    errorMessage: failedBefore.errorMessage,
    lifecycleSource: failedBefore.lifecycleSource,
    to: failedBefore.to
  };

  await sendLifecycle({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    lifecycleSource: 'manual_resend',
    success: true
  });

  const failedAfter = await EmailEvent.findById(failedBefore._id).lean();
  assert.deepEqual(
    {
      sendStatus: failedAfter.sendStatus,
      errorMessage: failedAfter.errorMessage,
      lifecycleSource: failedAfter.lifecycleSource,
      to: failedAfter.to
    },
    failedSnapshot
  );
  assert.equal(await EmailEvent.countDocuments({ bookingId: booking._id }), 2);
});
