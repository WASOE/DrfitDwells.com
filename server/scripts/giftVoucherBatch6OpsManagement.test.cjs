const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const ManualReviewItem = require('../models/ManualReviewItem');
const emailService = require('../services/emailService');
const giftVouchersRoutes = require('../routes/ops/modules/giftVouchersRoutes');
const {
  getGiftVouchersWorkspaceReadModel,
  getGiftVoucherDetailReadModel
} = require('../services/ops/readModels/giftVouchersReadModel');
const {
  resendVoucher,
  voidVoucher,
  extendVoucherExpiry,
  adjustVoucherBalance,
  updateRecipientEmailBeforeSend
} = require('../services/ops/domain/giftVoucherWriteService');

let mongoServer;
let originalSendEmail;

function buildVoucher(overrides = {}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  return {
    code: 'DD-ABCD-EFGH-JKLM',
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    purchaseRequestId: `gvr_ops_${Date.now()}`,
    stripePaymentIntentId: `pi_ops_${Date.now()}`,
    activatedAt: now,
    expiresAt,
    ...overrides
  };
}

function opsCtx({ role = 'admin', idempotencyKey = null } = {}) {
  return {
    user: { id: 'ops_user_1', role },
    req: { headers: idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {} },
    idempotencyKey
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await GiftVoucherRedemption.syncIndexes();
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
  await GiftVoucherRedemption.deleteMany({});
  await ManualReviewItem.deleteMany({});
  await GiftVoucher.deleteMany({});
  emailService.sendEmail = async () => ({ success: true, method: 'sent', messageId: `msg_${Date.now()}` });
});

test('list vouchers', async () => {
  await GiftVoucher.create(buildVoucher({ code: 'DD-LIST-ONE1-AAAA', buyerEmail: 'a@example.com' }));
  await GiftVoucher.create(buildVoucher({ code: 'DD-LIST-TWO2-BBBB', buyerEmail: 'b@example.com' }));
  const data = await getGiftVouchersWorkspaceReadModel({ page: 1, limit: 20 });
  assert.equal(data.items.length, 2);
});

test('search vouchers', async () => {
  await GiftVoucher.create(buildVoucher({ code: 'DD-SEARCH-AAAA-BBBB', buyerName: 'Alice Search' }));
  await GiftVoucher.create(buildVoucher({ code: 'DD-OTHER-AAAA-BBBB', buyerName: 'Bob Other' }));
  const data = await getGiftVouchersWorkspaceReadModel({ search: 'alice', page: 1, limit: 20 });
  assert.equal(data.items.length, 1);
  assert.match(data.items[0].buyerName, /Alice/i);
});

test('filter by status', async () => {
  await GiftVoucher.create(buildVoucher({ status: 'active', code: 'DD-ST-ACT1-AAAA' }));
  await GiftVoucher.create(buildVoucher({ status: 'expired', code: 'DD-ST-EXP2-BBBB' }));
  const data = await getGiftVouchersWorkspaceReadModel({ status: 'expired', page: 1, limit: 20 });
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].status, 'expired');
});

test('filter by deliveryMode', async () => {
  await GiftVoucher.create(buildVoucher({ deliveryMode: 'email', code: 'DD-DM-EMAI-AAAA' }));
  await GiftVoucher.create(
    buildVoucher({
      deliveryMode: 'postal',
      recipientEmail: null,
      code: 'DD-DM-POST-BBBB',
      deliveryAddress: {
        addressLine1: '16 Forest Lane',
        city: 'Plovdiv',
        postalCode: '4000',
        country: 'Bulgaria'
      }
    })
  );
  const data = await getGiftVouchersWorkspaceReadModel({ deliveryMode: 'postal', page: 1, limit: 20 });
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].deliveryMode, 'postal');
});

test('detail includes events', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-DET-EVNT-AAAA' }));
  await GiftVoucherEvent.create({
    giftVoucherId: voucher._id,
    type: 'activated',
    actor: 'system',
    note: 'activated test'
  });
  const detail = await getGiftVoucherDetailReadModel(voucher._id);
  assert.ok(detail.events.length >= 1);
});

test('detail includes redemptions', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-DET-REDM-AAAA' }));
  await GiftVoucherRedemption.create({
    giftVoucherId: voucher._id,
    amountAppliedCents: 5000,
    status: 'reserved'
  });
  const detail = await getGiftVoucherDetailReadModel(voucher._id);
  assert.equal(detail.redemptions.length, 1);
});

test('detail includes relevant manual review items', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-DET-MREV-AAAA' }));
  await ManualReviewItem.create({
    category: 'gift_voucher_email_failed',
    severity: 'high',
    entityType: 'GiftVoucher',
    entityId: String(voucher._id),
    title: 'Email failed'
  });
  await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    entityType: 'GiftVoucher',
    entityId: String(voucher._id),
    title: 'Other category'
  });
  const detail = await getGiftVoucherDetailReadModel(voucher._id);
  assert.equal(detail.manualReviewItems.length, 1);
  assert.equal(detail.manualReviewItems[0].category, 'gift_voucher_email_failed');
});

test('resend calls service and writes resent event', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-RESD-EVNT-AAAA' }));
  const result = await resendVoucher({
    giftVoucherId: voucher._id,
    recipientOverride: 'override@example.com',
    note: 'ops resend',
    ctx: opsCtx({ idempotencyKey: 'resend-key-1' })
  });
  assert.equal(result.ok, true);
  const resent = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'resent'
  }).lean();
  assert.ok(resent);
});

test('void requires note and writes voided event', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-VOID-EVNT-AAAA' }));
  await assert.rejects(
    () =>
      voidVoucher({
        giftVoucherId: voucher._id,
        note: '',
        reason: '',
        ctx: opsCtx({ idempotencyKey: 'void-key-1' })
      }),
    (err) => err.code === 'NOTE_REQUIRED'
  );

  const result = await voidVoucher({
    giftVoucherId: voucher._id,
    note: 'void note',
    reason: 'void reason',
    ctx: opsCtx({ idempotencyKey: 'void-key-2' })
  });
  assert.equal(result.ok, true);
  const event = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'voided',
    'metadata.idempotencyKey': 'void-key-2'
  }).lean();
  assert.ok(event);
});

test('void blocks redemption-unsafe statuses', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-VOID-BLCK-AAAA',
      status: 'redeemed',
      balanceRemainingCents: 0
    })
  );
  await assert.rejects(
    () =>
      voidVoucher({
        giftVoucherId: voucher._id,
        note: 'void',
        reason: 'reason',
        ctx: opsCtx({ idempotencyKey: 'void-key-3' })
      }),
    (err) => err.code === 'INVALID_VOUCHER_STATUS_FOR_VOID'
  );
});

test('extend expiry writes expiry_extended event', async () => {
  const now = new Date();
  const voucher = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-EXPD-EVNT-AAAA',
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 10)
    })
  );
  const next = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 20).toISOString();
  const result = await extendVoucherExpiry({
    giftVoucherId: voucher._id,
    expiresAt: next,
    note: 'extend',
    reason: 'ops',
    ctx: opsCtx({ idempotencyKey: 'extend-key-1' })
  });
  assert.equal(result.ok, true);
  const event = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'expiry_extended',
    'metadata.idempotencyKey': 'extend-key-1'
  }).lean();
  assert.ok(event);
});

test('manual adjustment writes full financial event', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-ADJS-EVNT-AAAA',
      balanceRemainingCents: 20000
    })
  );
  const result = await adjustVoucherBalance({
    giftVoucherId: voucher._id,
    deltaCents: -5000,
    note: 'manual adjust',
    reason: 'ops correction',
    ctx: opsCtx({ idempotencyKey: 'adjust-key-1' })
  });
  assert.equal(result.ok, true);
  const event = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'adjusted',
    'metadata.idempotencyKey': 'adjust-key-1'
  }).lean();
  assert.equal(event.previousBalanceCents, 20000);
  assert.equal(event.newBalanceCents, 15000);
  assert.equal(event.deltaCents, -5000);
});

test('manual adjustment cannot exceed original amount', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-ADJS-HIGH-AAAA',
      balanceRemainingCents: 24000
    })
  );
  await assert.rejects(
    () =>
      adjustVoucherBalance({
        giftVoucherId: voucher._id,
        deltaCents: 2000,
        note: 'too high',
        ctx: opsCtx({ idempotencyKey: 'adjust-key-2' })
      }),
    (err) => err.code === 'BALANCE_EXCEEDS_ORIGINAL'
  );
});

test('manual adjustment cannot go negative', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-ADJS-NEGA-AAAA',
      balanceRemainingCents: 1000
    })
  );
  await assert.rejects(
    () =>
      adjustVoucherBalance({
        giftVoucherId: voucher._id,
        deltaCents: -2000,
        note: 'too low',
        ctx: opsCtx({ idempotencyKey: 'adjust-key-3' })
      }),
    (err) => err.code === 'BALANCE_BELOW_ZERO'
  );
});

test('recipient email update before send writes event', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-EMUP-BEFO-AAAA' }));
  const result = await updateRecipientEmailBeforeSend({
    giftVoucherId: voucher._id,
    recipientEmail: 'new-recipient@example.com',
    note: 'ops update',
    ctx: opsCtx({ idempotencyKey: 'email-key-1' })
  });
  assert.equal(result.ok, true);
  const event = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'recipient_email_updated',
    'metadata.idempotencyKey': 'email-key-1'
  }).lean();
  assert.ok(event);
});

test('recipient email update after sent is blocked', async () => {
  const voucher = await GiftVoucher.create(buildVoucher({ code: 'DD-EMUP-AFTR-AAAA' }));
  await GiftVoucherEvent.create({
    giftVoucherId: voucher._id,
    type: 'sent',
    actor: 'system',
    note: 'already sent',
    metadata: { templateKind: 'recipient_voucher' }
  });
  await assert.rejects(
    () =>
      updateRecipientEmailBeforeSend({
        giftVoucherId: voucher._id,
        recipientEmail: 'block@example.com',
        note: 'should fail',
        ctx: opsCtx({ idempotencyKey: 'email-key-2' })
      }),
    (err) => err.code === 'RECIPIENT_EMAIL_ALREADY_SENT'
  );
});

test('duplicate idempotencyKey does not duplicate mutation/event', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-IDEM-ADJS-AAAA',
      balanceRemainingCents: 22000
    })
  );
  const payload = {
    giftVoucherId: voucher._id,
    deltaCents: -2000,
    note: 'idem adjust',
    reason: 'idem',
    ctx: opsCtx({ idempotencyKey: 'adjust-idem-1' })
  };
  const first = await adjustVoucherBalance(payload);
  const second = await adjustVoucherBalance(payload);
  assert.equal(first.ok, true);
  assert.equal(second.idempotentReplay, true);
  const count = await GiftVoucherEvent.countDocuments({
    giftVoucherId: voucher._id,
    type: 'adjusted',
    'metadata.idempotencyKey': 'adjust-idem-1'
  });
  assert.equal(count, 1);
});

test('permission denied returns correct response', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'guest-user', role: 'guest' };
    next();
  });
  app.use('/ops/gift-vouchers', giftVouchersRoutes);
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/ops/gift-vouchers`);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.success, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
