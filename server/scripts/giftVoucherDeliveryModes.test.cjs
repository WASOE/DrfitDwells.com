const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const emailService = require('../services/emailService');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent,
  computeGiftVoucherPricing
} = require('../services/giftVouchers/giftVoucherPaymentService');
const {
  handleActivatedGiftVoucherDelivery,
  performLifecycleSend,
  resendRecipientGiftVoucherEmail
} = require('../services/giftVouchers/giftVoucherEmailService');
const { SCHEDULED_DELIVERY_ENV_FLAG } = require('../services/giftVouchers/giftVoucherCustomizationConstants');
const { addCalendarDaysIso, sofiaDateIso } = require('../services/giftVouchers/giftVoucherDeliveryOption');

let mongoServer;
let originalSendEmail;
let scheduledEnvBefore;

function buildCreatePayload(overrides = {}) {
  return {
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay offline',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: `gvr_dm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...overrides
  };
}

function buildWebhookEvent({
  voucherId,
  purchaseRequestId,
  paymentIntentId,
  eventId,
  amountOriginalCents = 15000,
  deliveryMode = 'email'
}) {
  const { totalDueCents } = computeGiftVoucherPricing({ amountOriginalCents, deliveryMode });
  return {
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        amount: totalDueCents,
        amount_received: totalDueCents,
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

function assertPlainTextParity(text, { names = true, downloadUrl = null } = {}) {
  assert.match(text, /Enjoy your stay offline|Message:/);
  assert.match(text, /€|EUR|150/);
  assert.match(text, /DD-/);
  assert.match(text, /Valid until|expires/i);
  assert.match(text, /driftdwells\.com/i);
  if (names) {
    assert.match(text, /Recipient|For:/i);
    assert.match(text, /Buyer|From:/i);
  }
  if (downloadUrl) {
    assert.match(text, new RegExp(downloadUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  scheduledEnvBefore = process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  process.env[SCHEDULED_DELIVERY_ENV_FLAG] = '1';
  originalSendEmail = emailService.sendEmail.bind(emailService);
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  if (scheduledEnvBefore === undefined) {
    delete process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  } else {
    process.env[SCHEDULED_DELIVERY_ENV_FLAG] = scheduledEnvBefore;
  }
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucher.deleteMany({});
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_dm_1', client_secret: 'cs_dm_1' }),
      retrieve: async () => ({ id: 'pi_dm_1', client_secret: 'cs_dm_1' })
    }
  });
  emailService.sendEmail = async () => ({ success: true, method: 'sent', messageId: `msg_${Date.now()}` });
});

test('recipient_now sets sentAt only after recipient_voucher sent event', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ deliveryOption: 'recipient_now', purchaseRequestId: 'gvr_dm_recipient_now' })
  );
  const activation = await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dm_recipient_now'
    })
  );
  assert.ok(activation.cardAccessToken);

  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.ok(voucher.sentAt);

  const buyerReceiptSent = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'buyer_receipt'
  }).lean();
  const recipientSent = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'recipient_voucher'
  }).lean();
  assert.ok(buyerReceiptSent);
  assert.ok(recipientSent);
});

test('postal activation does not set sentAt', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryOption: 'postal',
      recipientEmail: null,
      purchaseRequestId: 'gvr_dm_postal_sentat',
      deliveryAddress: {
        addressLine1: '16 Forest Lane',
        city: 'Plovdiv',
        postalCode: '4000',
        country: 'Bulgaria'
      }
    })
  );
  await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dm_postal_sentat',
      deliveryMode: 'postal'
    })
  );
  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucher.sentAt, null);
});

test('send_to_buyer sends buyer_gift_card only with zero recipient_voucher events', async () => {
  const calls = [];
  emailService.sendEmail = async (payload) => {
    calls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${calls.length}` };
  };
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryOption: 'send_to_buyer',
      recipientEmail: null,
      purchaseRequestId: 'gvr_dm_send_to_buyer'
    })
  );
  await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dm_send_to_buyer'
    })
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'buyer@example.com');
  assert.match(calls[0].html, /data-gv-card/);

  const recipientEvents = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    'metadata.templateKind': 'recipient_voucher'
  });
  assert.equal(recipientEvents, 0);

  const giftCardSent = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'buyer_gift_card'
  }).lean();
  assert.ok(giftCardSent);

  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.ok(voucher.sentAt);
});

test('performLifecycleSend rejects recipient_voucher without email (MISSING_RECIPIENT_EMAIL)', async () => {
  const voucher = await GiftVoucher.create({
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay offline',
    deliveryMode: 'email',
    deliveryOption: 'recipient_now',
    status: 'active',
    code: 'DD-GUARD-TEST-AAAA',
    balanceRemainingCents: 15000,
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000 * 365)
  });
  await assert.rejects(
    () =>
      performLifecycleSend({
        voucher,
        recipientEmail: '',
        templateKind: 'recipient_voucher',
        cardDownloadUrl: null
      }),
    (err) => err.code === 'MISSING_RECIPIENT_EMAIL'
  );
});

test('scheduled activation sends buyer_receipt with download link and deferral event only', async () => {
  const calls = [];
  emailService.sendEmail = async (payload) => {
    calls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${calls.length}` };
  };
  const deliveryDate = new Date(`${addCalendarDaysIso(sofiaDateIso(), 7)}T10:00:00.000Z`);
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      deliveryOption: 'scheduled',
      deliveryDate,
      purchaseRequestId: 'gvr_dm_scheduled'
    })
  );
  const activation = await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dm_scheduled'
    })
  );
  assert.ok(activation.cardAccessToken);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'buyer@example.com');
  assert.match(calls[0].html, /data-gv-card/);
  assert.match(calls[0].html, new RegExp(activation.cardAccessToken));
  assertPlainTextParity(calls[0].text, { downloadUrl: activation.cardAccessToken });

  const deferral = await GiftVoucherEvent.findOne({
    giftVoucherId: created.giftVoucherId,
    type: 'recipient_delivery_deferred'
  }).lean();
  assert.ok(deferral);

  const recipientSent = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    'metadata.templateKind': 'recipient_voucher',
    type: 'sent'
  });
  assert.equal(recipientSent, 0);

  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucher.sentAt, null);
});

test('manual compensation voucher skips designed email delivery', async () => {
  const voucher = await GiftVoucher.create({
    amountOriginalCents: 10000,
    currency: 'EUR',
    buyerName: 'Guest',
    buyerEmail: 'guest@example.com',
    recipientName: 'Guest',
    message: 'Compensation',
    deliveryMode: 'manual',
    issuanceSource: 'cancellation_compensation',
    status: 'active',
    code: 'DD-COMP-SKIP-AAAA',
    balanceRemainingCents: 10000,
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000 * 365)
  });

  const calls = [];
  emailService.sendEmail = async (payload) => {
    calls.push(payload);
    return { success: true, method: 'sent' };
  };

  const result = await handleActivatedGiftVoucherDelivery({
    giftVoucherId: voucher._id,
    actor: 'system',
    cardAccessToken: 'should_not_matter'
  });
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test('resend email includes download link after token rotation (Batch 8)', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ purchaseRequestId: 'gvr_dm_resend_nolink' })
  );
  await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dm_resend_activate'
    })
  );

  let resendPayload;
  emailService.sendEmail = async (payload) => {
    resendPayload = payload;
    return { success: true, method: 'sent', messageId: 'resend_1' };
  };

  await resendRecipientGiftVoucherEmail({
    giftVoucherId: created.giftVoucherId,
    actor: 'ops_user'
  });

  assert.ok(resendPayload);
  assert.match(resendPayload.html, /\/api\/gift-vouchers\/card\//);
  assert.match(resendPayload.text, /\/api\/gift-vouchers\/card\//);
  assert.match(resendPayload.html, /data-gv-card/);
  assertPlainTextParity(resendPayload.text, { names: true });
  assert.match(resendPayload.text, /\/api\/gift-vouchers\/card\//);
});

test('activation emails include designed card HTML and plain-text parity for recipient_now', async () => {
  const calls = [];
  emailService.sendEmail = async (payload) => {
    calls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${calls.length}` };
  };
  const created = await createGiftVoucherPaymentIntent(
    buildCreatePayload({ deliveryOption: 'recipient_now', purchaseRequestId: 'gvr_dm_designed' })
  );
  const activation = await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dm_designed'
    })
  );

  assert.equal(calls.length, 2);
  const [buyerReceipt, recipientCard] = calls;
  for (const call of [buyerReceipt, recipientCard]) {
    assert.match(call.html, /data-gv-card/);
    assertPlainTextParity(call.text, {
      downloadUrl: activation.cardAccessToken
    });
  }
});
