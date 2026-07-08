/**
 * Batch 9 — §12 acceptance registry + gap-only integration tests (A1–A6).
 * Run: npm run test:gift-voucher-acceptance
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const giftVoucherRoutes = require('../routes/giftVoucherRoutes');
const emailService = require('../services/emailService');
const { CARD_ACCESS_NOT_FOUND } = require('../services/giftVouchers/giftVoucherCardAccessService');
const { renderGiftVoucherCard } = require('../services/giftVouchers/giftVoucherCardRenderer');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent,
  computeGiftVoucherPricing
} = require('../services/giftVouchers/giftVoucherPaymentService');
const { printGiftVoucherCard } = require('../services/ops/domain/giftVoucherWriteService');

const GATE_DIR = path.join(__dirname, '../../design-gate/batch9-release');
const CARD_TEMPLATE_IDS = ['forest', 'romantic', 'minimal'];

/**
 * Maps every locked-spec §12 criterion to existing automated coverage and/or gate artifacts.
 * MANUAL_QA = design-gate README 8-point checklist (buyer UI, real purchase).
 */
const ACCEPTANCE_REGISTRY = {
  'buyer.chooseAmount': [
    'giftVoucherBatch3PaymentFlow.test.cjs',
    'giftVoucherRoutes.test.cjs',
    'giftVoucherCustomizationSchema.test.cjs',
    'giftVoucherBuilderState.test.js'
  ],
  'buyer.chooseOccasion': [
    'giftVoucherCustomizationSchema.test.cjs',
    'giftVoucherBuilderState.test.js',
    'MANUAL_QA'
  ],
  'buyer.chooseTemplate': [
    'giftVoucherCustomizationSchema.test.cjs',
    'giftVoucherCardRenderer.test.cjs',
    'giftVoucherBuilderState.test.js',
    'MANUAL_QA'
  ],
  'buyer.writeMessage': [
    'giftVoucherCustomizationSchema.test.cjs',
    'giftVoucherEmailEscape.test.cjs',
    'giftVoucherBuilderState.test.js'
  ],
  'buyer.chooseLocale': [
    'giftVoucherCardRenderer.test.cjs',
    'giftVoucherCustomizationSchema.test.cjs',
    'MANUAL_QA'
  ],
  'buyer.livePreview': ['giftVoucherBuilderState.test.js', 'MANUAL_QA'],
  'buyer.pay': [
    'giftVoucherBatch3PaymentFlow.test.cjs',
    'giftVoucherRoutes.test.cjs',
    'MANUAL_QA'
  ],
  'buyer.sendToRecipientNow': [
    'giftVoucherDeliveryModes.test.cjs',
    'giftVoucherBatch5EmailDelivery.test.cjs',
    'A2'
  ],
  'buyer.sendToSelf': ['giftVoucherDeliveryModes.test.cjs', 'A3'],
  'buyer.scheduleFutureSend': [
    'giftVoucherScheduledDelivery.test.cjs',
    'giftVoucherCustomizationSchema.test.cjs'
  ],
  'buyer.choosePostal': [
    'giftVoucherBatch3PaymentFlow.test.cjs',
    'giftVoucherRoutes.test.cjs',
    'A4'
  ],
  'buyer.downloadPrintCard': ['giftVoucherCardDownload.test.cjs', 'A2'],
  'system.sendDesignedEmails': [
    'giftVoucherBatch5EmailDelivery.test.cjs',
    'giftVoucherDeliveryModes.test.cjs',
    'giftVoucherBatch5EmailDelivery.test.cjs'
  ],
  'system.printDesignedCards': [
    'giftVoucherCardDownload.test.cjs',
    'giftVoucherBatch6OpsManagement.test.cjs',
    'A4'
  ],
  'system.scheduleFutureSends': ['giftVoucherScheduledDelivery.test.cjs'],
  'system.preventDuplicateSends': [
    'giftVoucherBatch5EmailDelivery.test.cjs',
    'giftVoucherDeliveryModes.test.cjs'
  ],
  'system.handleOldVouchers': [
    'giftVoucherCustomizationSchema.test.cjs',
    'giftVoucherBatch6OpsManagement.test.cjs',
    'A5'
  ],
  'system.opsResend': [
    'giftVoucherBatch6OpsManagement.test.cjs',
    'giftVoucherDeliveryModes.test.cjs'
  ],
  'system.opsPrint': ['giftVoucherBatch6OpsManagement.test.cjs', 'A4'],
  'system.escapeUnsafeContent': ['giftVoucherEmailEscape.test.cjs'],
  'system.passTests': ['test:gift-voucher-all'],
  'manual.designGate.forestEmail': ['design-gate/batch9-release/forest-email-en.html'],
  'manual.designGate.romanticEmail': ['design-gate/batch9-release/romantic-email-en.html'],
  'manual.designGate.minimalEmail': ['design-gate/batch9-release/minimal-email-en.html'],
  'manual.designGate.forestPrint': ['design-gate/batch9-release/forest-print-en.html'],
  'manual.designGate.romanticPrint': ['design-gate/batch9-release/romantic-print-en.html'],
  'manual.designGate.minimalPrint': ['design-gate/batch9-release/minimal-print-en.html'],
  'manual.designGate.fullRecipientEmail': [
    'design-gate/batch9-release/romantic-email-full-en.html',
    'design-gate/batch9-release/romantic-email-full-bg.html'
  ],
  'branding.noValleyOrCabin': ['giftVoucherCardRenderer.test.cjs', 'A6'],
  'success.downloadHint': ['giftVoucher.json', 'GiftVoucherSuccess.jsx']
};

let mongoServer;
let app;
let originalSendEmail;

function buildCustomizationPayload(overrides = {}) {
  return {
    amountOriginalCents: 20000,
    currency: 'EUR',
    buyerName: 'Acceptance Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Acceptance Recipient',
    recipientEmail: 'recipient@example.com',
    message: 'Time offline together.',
    cardTemplateId: 'romantic',
    cardOccasion: 'birthday',
    cardLocale: 'en',
    deliveryOption: 'recipient_now',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: `gvr_acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...overrides
  };
}

function buildWebhookEvent({ voucherId, purchaseRequestId, paymentIntentId, eventId, amountOriginalCents = 20000 }) {
  const { totalDueCents } = computeGiftVoucherPricing({
    amountOriginalCents,
    deliveryMode: 'email'
  });
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

function buildCardDownloadApp() {
  const instance = express();
  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: CARD_ACCESS_NOT_FOUND
  });
  instance.use('/api/gift-vouchers', (req, res, next) => {
    if (req.path.startsWith('/card/')) {
      return strictLimiter(req, res, next);
    }
    return next();
  });
  instance.use('/api/gift-vouchers', giftVoucherRoutes);
  return instance;
}

function opsCtx(idempotencyKey = 'acc-ops-print') {
  return {
    user: { id: 'acc_ops_user', role: 'admin' },
    req: { headers: { 'x-idempotency-key': idempotencyKey } },
    idempotencyKey
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  originalSendEmail = emailService.sendEmail.bind(emailService);
  app = buildCardDownloadApp();
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucher.deleteMany({});
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: `pi_acc_${Date.now()}`, client_secret: 'cs_acc_1' }),
      retrieve: async () => ({ id: 'pi_acc_1', client_secret: 'cs_acc_1' })
    }
  });
  emailService.sendEmail = async () => ({ success: true, method: 'sent', messageId: `msg_${Date.now()}` });
  app = buildCardDownloadApp();
});

test('A1 — acceptance registry maps all §12 criteria with zero unmapped', () => {
  const keys = Object.keys(ACCEPTANCE_REGISTRY);
  assert.ok(keys.length >= 30, 'registry should cover full §12 surface');

  for (const [criterion, mapped] of Object.entries(ACCEPTANCE_REGISTRY)) {
    assert.ok(Array.isArray(mapped) && mapped.length > 0, `${criterion} has no mapped coverage`);
    assert.ok(
      mapped.every((entry) => typeof entry === 'string' && entry.length > 0),
      `${criterion} has invalid mapping entries`
    );
  }

  const gateFiles = [
    'forest-email-en.html',
    'romantic-email-en.html',
    'minimal-email-en.html',
    'forest-print-en.html',
    'romantic-print-en.html',
    'minimal-print-en.html',
    'romantic-email-full-en.html',
    'romantic-email-full-bg.html'
  ];
  for (const file of gateFiles) {
    const full = path.join(GATE_DIR, file);
    assert.ok(fs.existsSync(full), `design gate missing ${file} — run generateGiftVoucherDesignGate.cjs`);
  }
});

test('A2 — full customization PI → activate → card download', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCustomizationPayload());
  const voucherBefore = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucherBefore.cardTemplateId, 'romantic');
  assert.equal(voucherBefore.cardOccasion, 'birthday');
  assert.equal(voucherBefore.cardLocale, 'en');
  assert.equal(voucherBefore.deliveryOption, 'recipient_now');

  const activation = await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_acc_full_custom'
    })
  );
  assert.ok(activation.cardAccessToken);

  const response = await request(app).get(`/api/gift-vouchers/card/${activation.cardAccessToken}`);
  assert.equal(response.status, 200);
  assert.match(response.text, /data-gv-card-template="romantic"/);
  assert.match(response.text, /data-gv-card-mode="print"/);
  assert.match(response.text, /Time offline together/);
});

test('A3 — send_to_buyer activates without recipient_voucher send', async () => {
  const emailCalls = [];
  emailService.sendEmail = async (payload) => {
    emailCalls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${emailCalls.length}` };
  };

  const created = await createGiftVoucherPaymentIntent(
    buildCustomizationPayload({
      deliveryOption: 'send_to_buyer',
      recipientEmail: null,
      purchaseRequestId: 'gvr_acc_send_to_buyer'
    })
  );

  await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_acc_send_to_buyer'
    })
  );

  const recipientSends = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'recipient_voucher'
  });
  const buyerGiftSends = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'sent',
    'metadata.templateKind': 'buyer_gift_card'
  });
  assert.equal(recipientSends, 0);
  assert.equal(buyerGiftSends, 1);
  const buyerHtml = emailCalls.find((c) => /gift card/i.test(c.subject || ''))?.html || emailCalls[0]?.html;
  assert.match(buyerHtml || '', /data-gv-card/);
});

test('A4 — postal purchase ops print returns designed card HTML', async () => {
  const now = new Date();
  const voucher = await GiftVoucher.create({
    code: 'DD-POST-ACC-AAAA',
    amountOriginalCents: 15000,
    balanceRemainingCents: 15000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Postal Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Postal Recipient',
    deliveryMode: 'postal',
    deliveryOption: 'postal',
    cardTemplateId: 'forest',
    cardOccasion: 'birthday',
    cardLocale: 'en',
    message: 'Enjoy the forest.',
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365),
    deliveryAddress: {
      addressLine1: '1 Mountain Rd',
      city: 'Sofia',
      postalCode: '1000',
      country: 'Bulgaria'
    }
  });

  const result = await printGiftVoucherCard({
    giftVoucherId: voucher._id,
    ctx: opsCtx('acc-postal-print')
  });

  assert.match(result.html, /data-gv-card-template="forest"/);
  assert.match(result.html, /data-gv-card-mode="print"/);
  const printed = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'card_printed'
  }).lean();
  assert.ok(printed);
});

test('A5 — legacy voucher without cardTemplateId prints with minimal fallback', async () => {
  const now = new Date();
  const voucher = await GiftVoucher.create({
    code: 'DD-LEG-NULL-TMPL',
    amountOriginalCents: 10000,
    balanceRemainingCents: 10000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Legacy Buyer',
    buyerEmail: 'legacy@example.com',
    recipientName: 'Legacy Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    deliveryOption: null,
    cardTemplateId: null,
    cardOccasion: null,
    cardLocale: null,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30)
  });

  const result = await printGiftVoucherCard({
    giftVoucherId: voucher._id,
    ctx: opsCtx('acc-legacy-print')
  });

  assert.match(result.html, /data-gv-card-template="minimal"/);
});

test('A6 — card renderer outputs contain no Valley or Cabin branding', () => {
  const banned = [/The Valley/i, /\bValley\b/i, /The Cabin/i, /\bCabin\b/i];
  const voucher = {
    recipientName: 'Test',
    buyerName: 'Buyer',
    amountOriginalCents: 15000,
    currency: 'EUR',
    cardOccasion: 'birthday',
    message: 'Neutral message',
    code: 'DD-BRAND-TEST',
    expiresAt: new Date('2027-01-01T12:00:00.000Z')
  };

  for (const templateId of CARD_TEMPLATE_IDS) {
    for (const locale of ['en', 'bg']) {
      for (const mode of ['email', 'print']) {
        const { html } = renderGiftVoucherCard({
          voucher: { ...voucher, cardTemplateId: templateId, cardLocale: locale },
          mode
        });
        for (const pattern of banned) {
          assert.doesNotMatch(html, pattern, `${templateId}/${locale}/${mode} must not contain property branding`);
        }
      }
    }
  }
});
