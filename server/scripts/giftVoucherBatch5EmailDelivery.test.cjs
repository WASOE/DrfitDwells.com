const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const ManualReviewItem = require('../models/ManualReviewItem');
const emailService = require('../services/emailService');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent
} = require('../services/giftVouchers/giftVoucherPaymentService');
const {
  handleActivatedGiftVoucherDelivery,
  resendRecipientGiftVoucherEmail
} = require('../services/giftVouchers/giftVoucherEmailService');

let mongoServer;
let originalSendEmail;

function buildCreatePayload(overrides = {}) {
  return {
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: 'gvr_b5_req_12345678',
    ...overrides
  };
}

function buildWebhookEvent({ voucherId, purchaseRequestId, paymentIntentId, eventId }) {
  return {
    id: eventId,
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
          giftVoucherId: voucherId,
          purchaseRequestId
        }
      }
    }
  };
}

function countEmailEvents(giftVoucherId, type, keyPrefix) {
  return GiftVoucherEvent.countDocuments({
    giftVoucherId,
    type,
    'metadata.emailLifecycleKey': new RegExp(`^${keyPrefix}:`)
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
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
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await ManualReviewItem.deleteMany({});
  await GiftVoucher.deleteMany({});
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_b5_1', client_secret: 'cs_b5_1' }),
      retrieve: async () => ({ id: 'pi_b5_1', client_secret: 'cs_b5_1' })
    }
  });
  emailService.sendEmail = async () => ({ success: true, method: 'sent', messageId: `msg_${Date.now()}` });
});

test('activation sends buyer receipt once', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_buyer_once'
  });

  await activatePaidVoucherFromStripeEvent(event);

  const sentCount = await countEmailEvents(created.giftVoucherId, 'sent', 'buyer_receipt');
  assert.equal(sentCount, 1);
});

test('activation sends recipient voucher once for deliveryMode=email', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_recipient_once'
  });

  await activatePaidVoucherFromStripeEvent(event);

  const sentCount = await countEmailEvents(created.giftVoucherId, 'sent', 'recipient_voucher');
  assert.equal(sentCount, 1);
});

test('duplicate webhook does not duplicate buyer/recipient sends', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_duplicate'
  });

  await activatePaidVoucherFromStripeEvent(event);
  await activatePaidVoucherFromStripeEvent(event);

  assert.equal(await countEmailEvents(created.giftVoucherId, 'sent', 'buyer_receipt'), 1);
  assert.equal(await countEmailEvents(created.giftVoucherId, 'sent', 'recipient_voucher'), 1);
});

test('email failure keeps voucher active', async () => {
  emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_fail_active'
  });

  const result = await activatePaidVoucherFromStripeEvent(event);
  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(result.ok, true);
  assert.equal(voucher.status, 'active');
});

test('email failure writes send_failed', async () => {
  emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_fail_event'
  });

  await activatePaidVoucherFromStripeEvent(event);
  const failedCount = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'send_failed'
  });
  assert.ok(failedCount >= 1);
});

test('email failure opens gift_voucher_email_failed manual review', async () => {
  emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_fail_review'
  });

  await activatePaidVoucherFromStripeEvent(event);
  const review = await ManualReviewItem.findOne({ category: 'gift_voucher_email_failed' }).lean();
  assert.ok(review);
});

test('postal mode sends buyer receipt only', async () => {
  const calls = [];
  emailService.sendEmail = async (payload) => {
    calls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${calls.length}` };
  };
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryMode: 'postal',
      recipientEmail: null,
      purchaseRequestId: 'gvr_b5_postal_only_1',
      deliveryAddress: {
        addressLine1: '16 Forest Lane',
        addressLine2: null,
        city: 'Plovdiv',
        postalCode: '4000',
        country: 'Bulgaria'
      }
    })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_postal_only'
  });

  await activatePaidVoucherFromStripeEvent(event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'buyer@example.com');
});

test('postal mode does not send recipient voucher email by default', async () => {
  const calls = [];
  emailService.sendEmail = async (payload) => {
    calls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${calls.length}` };
  };
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryMode: 'postal',
      recipientEmail: null,
      purchaseRequestId: 'gvr_b5_postal_only_2',
      deliveryAddress: {
        addressLine1: '16 Forest Lane',
        addressLine2: null,
        city: 'Plovdiv',
        postalCode: '4000',
        country: 'Bulgaria'
      }
    })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_postal_no_recipient'
  });

  await activatePaidVoucherFromStripeEvent(event);
  assert.equal(calls.some((c) => c.to === 'recipient@example.com'), false);
});

test('postal mode opens gift_voucher_physical_card_required manual review', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryMode: 'postal',
      recipientEmail: null,
      purchaseRequestId: 'gvr_b5_postal_review',
      deliveryAddress: {
        addressLine1: '16 Forest Lane',
        addressLine2: null,
        city: 'Plovdiv',
        postalCode: '4000',
        country: 'Bulgaria'
      }
    })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_postal_review'
  });

  await activatePaidVoucherFromStripeEvent(event);
  const review = await ManualReviewItem.findOne({ category: 'gift_voucher_physical_card_required' }).lean();
  assert.ok(review);
});

test('service-level resend sends recipient email and writes resent event', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_b5_resend_1' })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_resend_activate'
  });
  await activatePaidVoucherFromStripeEvent(event);

  const resend = await resendRecipientGiftVoucherEmail({
    giftVoucherId: created.giftVoucherId,
    actor: 'ops_user'
  });
  assert.equal(resend.ok, true);

  const resentEvent = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'resent'
  }).lean();
  assert.ok(resentEvent);
});

test('resend with override records override metadata', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_b5_resend_override' })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_resend_override_activate'
  });
  await activatePaidVoucherFromStripeEvent(event);

  await resendRecipientGiftVoucherEmail({
    giftVoucherId: created.giftVoucherId,
    actor: 'ops_user',
    recipientOverride: 'override@example.com'
  });

  const resentEvent = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'resent',
    'metadata.recipientOverrideUsed': true
  }).lean();
  assert.ok(resentEvent);
  assert.equal(resentEvent.metadata.recipientOverride, 'override@example.com');
});

test('incomplete send_attempted state returns EMAIL_SEND_STATE_INCOMPLETE_REQUIRES_REVIEW', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_b5_incomplete' })
  );
  const voucher = await GiftVoucher.findById(created.giftVoucherId);
  voucher.status = 'active';
  voucher.code = 'DD-ABCD-EFGH-JKLM';
  voucher.activatedAt = new Date();
  voucher.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
  await voucher.save();

  await GiftVoucherEvent.create({
    giftVoucherId: voucher._id,
    type: 'send_attempted',
    actor: 'system',
    note: 'forced incomplete state',
    metadata: {
      emailLifecycleKey: `buyer_receipt:${String(voucher._id)}`
    }
  });

  await assert.rejects(
    () => handleActivatedGiftVoucherDelivery({ giftVoucherId: voucher._id, actor: 'system' }),
    (err) => err.code === 'EMAIL_SEND_STATE_INCOMPLETE_REQUIRES_REVIEW'
  );
});

test('sendEmail throws -> send_failed event exists', async () => {
  emailService.sendEmail = async () => {
    throw new Error('forced-throw');
  };
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_b5_throw_event' })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_throw_event'
  });

  await activatePaidVoucherFromStripeEvent(event);
  const failedEvent = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'send_failed',
    'metadata.thrown': true
  }).lean();
  assert.ok(failedEvent);
});

test('sendEmail throws -> gift_voucher_email_failed manual review exists', async () => {
  emailService.sendEmail = async () => {
    throw new Error('forced-throw');
  };
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_b5_throw_review' })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_throw_review'
  });

  await activatePaidVoucherFromStripeEvent(event);
  const review = await ManualReviewItem.findOne({
    category: 'gift_voucher_email_failed'
  }).lean();
  assert.ok(review);
});

test('send_attempted without terminal event -> gift_voucher_email_failed manual review exists', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_b5_incomplete_review' })
  );
  const voucher = await GiftVoucher.findById(created.giftVoucherId);
  voucher.status = 'active';
  voucher.code = 'DD-INCO-MPLE-TEST';
  voucher.activatedAt = new Date();
  voucher.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
  await voucher.save();

  await GiftVoucherEvent.create({
    giftVoucherId: voucher._id,
    type: 'send_attempted',
    actor: 'system',
    note: 'forced incomplete state',
    metadata: {
      emailLifecycleKey: `buyer_receipt:${String(voucher._id)}`
    }
  });

  await assert.rejects(
    () => handleActivatedGiftVoucherDelivery({ giftVoucherId: voucher._id, actor: 'system' }),
    (err) => err.code === 'EMAIL_SEND_STATE_INCOMPLETE_REQUIRES_REVIEW'
  );
  const review = await ManualReviewItem.findOne({
    category: 'gift_voucher_email_failed',
    entityId: String(voucher._id)
  }).lean();
  assert.ok(review);
});

test('duplicate postal handling treats physical_card_required as already_processed without email-failed review', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryMode: 'postal',
      recipientEmail: null,
      purchaseRequestId: 'gvr_b5_postal_duplicate_final',
      deliveryAddress: {
        addressLine1: '16 Forest Lane',
        addressLine2: null,
        city: 'Plovdiv',
        postalCode: '4000',
        country: 'Bulgaria'
      }
    })
  );
  const event = buildWebhookEvent({
    voucherId: created.giftVoucherId,
    purchaseRequestId: created.purchaseRequestId,
    paymentIntentId: created.stripePaymentIntentId,
    eventId: 'evt_b5_postal_duplicate_final'
  });

  const first = await activatePaidVoucherFromStripeEvent(event);
  const second = await activatePaidVoucherFromStripeEvent(event);

  const physicalStepSecond = second.emailDelivery?.steps?.find(
    (s) => s?.emailLifecycleKey === `physical_card_required:${created.giftVoucherId}`
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.ok(physicalStepSecond);
  assert.equal(physicalStepSecond.reason, 'already_processed');

  const failedReview = await ManualReviewItem.findOne({
    category: 'gift_voucher_email_failed',
    entityId: String(created.giftVoucherId)
  }).lean();
  assert.equal(failedReview, null);

  const physicalReviews = await ManualReviewItem.countDocuments({
    category: 'gift_voucher_physical_card_required',
    entityId: String(created.giftVoucherId)
  });
  assert.equal(physicalReviews, 1);
});
