const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const {
  classifyGiftVoucherNoiseRecord,
  isDryRunEnv
} = require('../services/giftVouchers/giftVoucherNoiseCleanupService');
const { runCleanup } = require('./cleanupGiftVoucherNoise.cjs');

let mongoServer;

function buildVoucher(overrides = {}) {
  return {
    amountOriginalCents: 5000,
    balanceRemainingCents: 5000,
    currency: 'EUR',
    status: 'pending_payment',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    purchaseRequestId: `gvr_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucher.deleteMany({});
});

test('classify smoke pending_payment as matched void candidate', () => {
  const result = classifyGiftVoucherNoiseRecord({
    status: 'pending_payment',
    purchaseRequestId: 'gvr_smoke_123',
    buyerEmail: 'smoke-payments+1@example.com',
    buyerName: 'SMOKE PAYMENTS (auto cleanup)'
  });
  assert.equal(result.matched, true);
  assert.equal(result.action, 'void');
});

test('classify audit pending_payment as matched', () => {
  const result = classifyGiftVoucherNoiseRecord({
    status: 'pending_payment',
    purchaseRequestId: 'gvr_audit_abc',
    buyerName: 'Audit Buyer 1',
    buyerEmail: 'audit@example.com',
    recipientEmail: 'audit@example.com'
  });
  assert.equal(result.matched, true);
  assert.match(result.reasons.join(','), /audit/);
});

test('classify example.com pending_payment as matched', () => {
  const result = classifyGiftVoucherNoiseRecord({
    status: 'pending_payment',
    purchaseRequestId: 'gvr_real_attempt_1',
    buyerName: 'R3',
    buyerEmail: 'r3@example.com',
    recipientName: 'R3',
    recipientEmail: 'r3@example.com'
  });
  assert.equal(result.matched, true);
});

test('classify active paid voucher is never matched', () => {
  const result = classifyGiftVoucherNoiseRecord({
    status: 'active',
    code: 'DD-ABCD-EFGH-JKLM',
    activatedAt: new Date(),
    purchaseRequestId: 'gvr_smoke_should_not_touch',
    buyerEmail: 'buyer@example.com'
  });
  assert.equal(result.matched, false);
  assert.equal(result.skippedPaid, true);
});

test('classify real customer pending_payment is not matched', () => {
  const result = classifyGiftVoucherNoiseRecord({
    status: 'pending_payment',
    purchaseRequestId: 'gvr_customer_real_1',
    buyerName: 'Maria Petrova',
    buyerEmail: 'maria.petrova@gmail.com',
    recipientName: 'Ivan Petrova',
    recipientEmail: 'ivan.petrova@gmail.com'
  });
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'no_noise_markers');
});

test('classify Jose/Kremena only when flag enabled and no payment evidence', () => {
  const withoutFlag = classifyGiftVoucherNoiseRecord({
    status: 'pending_payment',
    buyerName: 'Jose Test',
    buyerEmail: 'jose@driftdwells.com',
    recipientName: 'Kremena Test',
    recipientEmail: 'kremena@driftdwells.com'
  });
  assert.equal(withoutFlag.matched, false);

  const withFlag = classifyGiftVoucherNoiseRecord(
    {
      status: 'pending_payment',
      buyerName: 'Jose Test',
      buyerEmail: 'jose@driftdwells.com',
      recipientName: 'Kremena Test',
      recipientEmail: 'kremena@driftdwells.com'
    },
    { includeJoseKremenaTests: true }
  );
  assert.equal(withFlag.matched, true);

  const withPaymentEvidence = classifyGiftVoucherNoiseRecord(
    {
      status: 'pending_payment',
      buyerName: 'Jose Test',
      buyerEmail: 'jose@driftdwells.com',
      activatedAt: new Date(),
      code: 'DD-JOSE-TEST-CODE'
    },
    { includeJoseKremenaTests: true }
  );
  assert.equal(withPaymentEvidence.matched, false);
  assert.equal(withPaymentEvidence.reason, 'payment_success_evidence');
});

test('dry run updates nothing', async () => {
  await GiftVoucher.create(
    buildVoucher({
      purchaseRequestId: 'gvr_smoke_dry_run_1',
      buyerName: 'SMOKE PAYMENTS (auto cleanup)'
    })
  );

  const summary = await runCleanup({
    mongoUri: mongoServer.getUri(),
    dryRun: true,
    includeJoseKremenaTests: false
  });

  assert.equal(summary.updatedCount, 0);
  assert.equal(summary.wouldUpdateCount, 1);
  const voucher = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_smoke_dry_run_1' }).lean();
  assert.equal(voucher.status, 'pending_payment');
});

test('DRY_RUN=0 voids matched smoke pending_payment', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      purchaseRequestId: 'gvr_smoke_apply_1',
      buyerName: 'SMOKE PAYMENTS (auto cleanup)'
    })
  );

  const summary = await runCleanup({
    mongoUri: mongoServer.getUri(),
    dryRun: false,
    includeJoseKremenaTests: false
  });

  assert.equal(summary.updatedCount, 1);
  const updated = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(updated.status, 'voided');
  const event = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'voided',
    'metadata.action': 'noise_cleanup'
  }).lean();
  assert.ok(event);
});

test('already voided smoke record remains voided without re-update', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      status: 'voided',
      purchaseRequestId: 'gvr_smoke_already_void_1',
      buyerName: 'SMOKE PAYMENTS (auto cleanup)'
    })
  );

  const summary = await runCleanup({
    mongoUri: mongoServer.getUri(),
    dryRun: false,
    includeJoseKremenaTests: false
  });

  assert.equal(summary.matchedCount, 1);
  assert.equal(summary.updatedCount, 0);
  const unchanged = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(unchanged.status, 'voided');
});

test('real customer pending_payment is not touched by cleanup run', async () => {
  await GiftVoucher.create(
    buildVoucher({
      purchaseRequestId: 'gvr_customer_safe_1',
      buyerName: 'Anna Guest',
      buyerEmail: 'anna.guest@proton.me',
      recipientName: 'Chris Guest',
      recipientEmail: 'chris.guest@proton.me'
    })
  );

  const summary = await runCleanup({
    mongoUri: mongoServer.getUri(),
    dryRun: false,
    includeJoseKremenaTests: false
  });

  assert.equal(summary.matchedCount, 0);
  assert.equal(summary.updatedCount, 0);
  const voucher = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_customer_safe_1' }).lean();
  assert.equal(voucher.status, 'pending_payment');
});

test('Jose/Kremena pending_payment is touched only with INCLUDE flag', async () => {
  await GiftVoucher.create(
    buildVoucher({
      purchaseRequestId: 'gvr_jose_test_1',
      buyerName: 'Jose',
      buyerEmail: 'jose@driftdwells.com',
      recipientName: 'Kremena',
      recipientEmail: 'kremena@driftdwells.com'
    })
  );

  const withoutFlag = await runCleanup({
    mongoUri: mongoServer.getUri(),
    dryRun: false,
    includeJoseKremenaTests: false
  });
  assert.equal(withoutFlag.updatedCount, 0);

  const withFlag = await runCleanup({
    mongoUri: mongoServer.getUri(),
    dryRun: false,
    includeJoseKremenaTests: true
  });
  assert.equal(withFlag.updatedCount, 1);
  const voucher = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_jose_test_1' }).lean();
  assert.equal(voucher.status, 'voided');
});

test('isDryRunEnv defaults to true unless DRY_RUN=0', () => {
  assert.equal(isDryRunEnv({}), true);
  assert.equal(isDryRunEnv({ DRY_RUN: '1' }), true);
  assert.equal(isDryRunEnv({ DRY_RUN: '0' }), false);
});
