const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const ManualReviewItem = require('../models/ManualReviewItem');
const emailService = require('../services/emailService');
const {
  performLifecycleSend,
  findLifecycleState,
  lifecycleKey,
  EMAIL_FAILED_CATEGORY
} = require('../services/giftVouchers/giftVoucherEmailService');
const {
  tickOnce,
  claimScheduledVoucher,
  sweepStaleClaimsOnce,
  isFlagEnabled
} = require('../services/giftVouchers/giftVoucherScheduledDeliveryWorker');
const {
  deliverScheduledRecipientVoucher,
  evaluateScheduledVoucherEligibility,
  isRetryBackoffElapsed,
  SCHEDULED_DELIVERY_RETRY_BACKOFF_MS
} = require('../services/giftVouchers/giftVoucherScheduledDeliveryService');
const { sofiaDateIso, addCalendarDaysIso } = require('../services/giftVouchers/giftVoucherDeliveryOption');
const { SCHEDULED_DELIVERY_ENV_FLAG } = require('../services/giftVouchers/giftVoucherCustomizationConstants');

let mongoServer;
let originalSendEmail;
let scheduledPurchaseFlagBefore;
let workerFlagBefore;
let sendCalls;

function sofiaMiddayUtc(isoDate) {
  return new Date(`${isoDate}T10:00:00.000Z`);
}

function buildScheduledVoucher(overrides = {}) {
  const todayIso = sofiaDateIso();
  const deliveryDate = overrides.deliveryDate ?? sofiaMiddayUtc(todayIso);
  const expiresAt = overrides.expiresAt ?? sofiaMiddayUtc(addCalendarDaysIso(todayIso, 180));
  return {
    amountOriginalCents: 15000,
    balanceRemainingCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay offline',
    deliveryMode: 'email',
    deliveryOption: 'scheduled',
    deliveryDate,
    expiresAt,
    status: 'active',
    code: `DD-SCHD-${Math.random().toString(36).slice(2, 6).toUpperCase()}-AAAA`,
    activatedAt: new Date(),
    cardAccessTokenHash: 'a'.repeat(64),
    ...overrides
  };
}

async function createScheduledVoucher(overrides = {}) {
  return GiftVoucher.create(buildScheduledVoucher(overrides));
}

async function deferVoucher(voucherId) {
  await GiftVoucherEvent.create({
    giftVoucherId: voucherId,
    type: 'recipient_delivery_deferred',
    actor: 'system',
    note: 'deferred',
    metadata: { deliveryOption: 'scheduled' }
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await ManualReviewItem.syncIndexes();
  scheduledPurchaseFlagBefore = process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  workerFlagBefore = process.env.GIFT_VOUCHER_DELIVERY_WORKER_ENABLED;
  originalSendEmail = emailService.sendEmail.bind(emailService);
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  if (scheduledPurchaseFlagBefore === undefined) delete process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  else process.env[SCHEDULED_DELIVERY_ENV_FLAG] = scheduledPurchaseFlagBefore;
  if (workerFlagBefore === undefined) delete process.env.GIFT_VOUCHER_DELIVERY_WORKER_ENABLED;
  else process.env.GIFT_VOUCHER_DELIVERY_WORKER_ENABLED = workerFlagBefore;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await ManualReviewItem.deleteMany({});
  await GiftVoucher.deleteMany({});
  sendCalls = [];
  emailService.sendEmail = async (payload) => {
    sendCalls.push(payload);
    return { success: true, method: 'sent', messageId: `msg_${sendCalls.length}` };
  };
  process.env.GIFT_VOUCHER_DELIVERY_WORKER_ENABLED = '1';
});

test('due voucher sends recipient email, sets sentAt, and writes sent lifecycle event', async () => {
  const voucher = await createScheduledVoucher();
  await deferVoucher(voucher._id);
  const now = sofiaMiddayUtc(sofiaDateIso());

  const outcome = await deliverScheduledRecipientVoucher(voucher, { workerId: 'test-worker', now });
  assert.equal(outcome.status, 'sent');

  const saved = await GiftVoucher.findById(voucher._id).lean();
  assert.ok(saved.sentAt);
  assert.ok(!saved.scheduledDeliveryClaimedBy);

  const sentEvent = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'sent',
    'metadata.templateKind': 'recipient_voucher'
  }).lean();
  assert.ok(sentEvent);
  assert.equal(sendCalls.length, 1);
  assert.match(sendCalls[0].html, /data-gv-card/);
});

test('boundary_day_before is not due', async () => {
  const deliveryIso = addCalendarDaysIso(sofiaDateIso(), 1);
  const voucher = await createScheduledVoucher({ deliveryDate: sofiaMiddayUtc(deliveryIso) });
  const now = sofiaMiddayUtc(sofiaDateIso());

  const eligibility = await evaluateScheduledVoucherEligibility(voucher, { now });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'not_due');

  const tick = await tickOnce({ now });
  assert.equal(tick.sent, 0);
  assert.equal(sendCalls.length, 0);
});

test('boundary_same_day sends', async () => {
  const todayIso = sofiaDateIso();
  const voucher = await createScheduledVoucher({ deliveryDate: sofiaMiddayUtc(todayIso) });
  const now = sofiaMiddayUtc(todayIso);

  const outcome = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  assert.equal(outcome.status, 'sent');
});

test('boundary_day_after overdue still sends', async () => {
  const deliveryIso = addCalendarDaysIso(sofiaDateIso(), -2);
  const voucher = await createScheduledVoucher({ deliveryDate: sofiaMiddayUtc(deliveryIso) });
  const now = sofiaMiddayUtc(sofiaDateIso());

  const outcome = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  assert.equal(outcome.status, 'sent');
});

test('already_sent voucher is skipped', async () => {
  const voucher = await createScheduledVoucher({ sentAt: new Date() });
  const now = sofiaMiddayUtc(sofiaDateIso());
  const outcome = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  assert.equal(outcome.skipped, true);
  assert.equal(outcome.reason, 'already_sent');
  assert.equal(sendCalls.length, 0);
});

test('voided voucher is skipped', async () => {
  const voucher = await createScheduledVoucher({ status: 'voided' });
  const eligibility = await evaluateScheduledVoucherEligibility(voucher, {
    now: sofiaMiddayUtc(sofiaDateIso())
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'status_not_deliverable');
});

test('refunded voucher is skipped', async () => {
  const voucher = await createScheduledVoucher({ status: 'refunded' });
  const eligibility = await evaluateScheduledVoucherEligibility(voucher, {
    now: sofiaMiddayUtc(sofiaDateIso())
  });
  assert.equal(eligibility.eligible, false);
});

test('expired status voucher is skipped', async () => {
  const voucher = await createScheduledVoucher({ status: 'expired' });
  const eligibility = await evaluateScheduledVoucherEligibility(voucher, {
    now: sofiaMiddayUtc(sofiaDateIso())
  });
  assert.equal(eligibility.eligible, false);
});

test('delivery date on expiry opens manual review and excludes voucher', async () => {
  const iso = sofiaDateIso();
  const voucher = await createScheduledVoucher({
    deliveryDate: sofiaMiddayUtc(iso),
    expiresAt: sofiaMiddayUtc(iso)
  });
  const now = sofiaMiddayUtc(iso);

  const eligibility = await evaluateScheduledVoucherEligibility(voucher, { now });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'delivery_date_past_expiry');

  const pastExpiryEvent = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'scheduled_delivery_date_past_expiry'
  }).lean();
  assert.ok(pastExpiryEvent);

  const review = await ManualReviewItem.findOne({
    entityId: String(voucher._id),
    category: EMAIL_FAILED_CATEGORY,
    status: 'open'
  }).lean();
  assert.ok(review);
  assert.equal(review.evidence.source, 'scheduled_worker_past_expiry');
});

test('claim contention allows only one winner', async () => {
  const voucher = await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());
  const [a, b] = await Promise.all([
    claimScheduledVoucher({ giftVoucherId: voucher._id, workerId: 'w-a', now, visibilityTimeoutMs: 60000 }),
    claimScheduledVoucher({ giftVoucherId: voucher._id, workerId: 'w-b', now, visibilityTimeoutMs: 60000 })
  ]);
  const winners = [a, b].filter(Boolean);
  assert.equal(winners.length, 1);
});

test('overlapping tick does not double-send when claim is held', async () => {
  const voucher = await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());
  const claimed = await claimScheduledVoucher({
    giftVoucherId: voucher._id,
    workerId: 'holder',
    now,
    visibilityTimeoutMs: 300000
  });
  assert.ok(claimed);

  const tick = await tickOnce({ now });
  assert.ok(tick.lost >= 0);
  assert.equal(sendCalls.length, 0);
});

test('stale claim is reclaimed by sweeper', async () => {
  const voucher = await createScheduledVoucher();
  const past = new Date(Date.now() - 60000);
  await GiftVoucher.updateOne(
    { _id: voucher._id },
    {
      $set: {
        scheduledDeliveryClaimedBy: 'stale',
        scheduledDeliveryClaimedAt: past,
        scheduledDeliveryClaimExpiresAt: past
      }
    }
  );
  const sweep = await sweepStaleClaimsOnce({ now: new Date() });
  assert.equal(sweep.cleared, 1);
  const saved = await GiftVoucher.findById(voucher._id).lean();
  assert.ok(!saved.scheduledDeliveryClaimedBy);
});

test('attempt 1 fails, tick 2 minutes later does not retry, tick after backoff does', async () => {
  emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
  const voucher = await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());

  const first = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  assert.equal(first.status, 'failed');
  assert.equal(first.attemptNumber, 1);

  const twoMinutesLater = new Date(now.getTime() + 2 * 60_000);
  const second = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now: twoMinutesLater });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'retry_backoff');

  const lastAttempt = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'scheduled_delivery_attempt_failed'
  }).lean();
  assert.ok(lastAttempt);
  assert.equal(isRetryBackoffElapsed(lastAttempt, twoMinutesLater), false);

  const afterBackoff = new Date(lastAttempt.createdAt.getTime() + SCHEDULED_DELIVERY_RETRY_BACKOFF_MS + 1000);
  emailService.sendEmail = async (payload) => {
    sendCalls.push(payload);
    return { success: true, method: 'sent', messageId: 'retry-ok' };
  };
  const third = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now: afterBackoff });
  assert.equal(third.status, 'sent');
});

test('attempt 3 failure opens manual review and writes exhausted event', async () => {
  emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
  const voucher = await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());

  for (let i = 0; i < 3; i += 1) {
    const attemptNow = new Date(now.getTime() + i * (SCHEDULED_DELIVERY_RETRY_BACKOFF_MS + 1000));
    await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now: attemptNow });
  }

  const exhausted = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'scheduled_delivery_exhausted'
  }).lean();
  assert.ok(exhausted);

  const review = await ManualReviewItem.findOne({
    entityId: String(voucher._id),
    category: EMAIL_FAILED_CATEGORY,
    status: 'open',
    'evidence.source': 'scheduled_worker'
  }).lean();
  assert.ok(review);

  const eligibility = await evaluateScheduledVoucherEligibility(
    await GiftVoucher.findById(voucher._id).lean(),
    { now: new Date(now.getTime() + 4 * SCHEDULED_DELIVERY_RETRY_BACKOFF_MS) }
  );
  assert.equal(eligibility.eligible, false);
  assert.ok(['exhausted', 'open_manual_review'].includes(eligibility.reason));
});

test('duplicate tick after success is idempotent', async () => {
  const voucher = await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());
  await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  sendCalls.length = 0;
  const second = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already_sent');
  assert.equal(sendCalls.length, 0);
});

test('token is rotated at scheduled send time', async () => {
  const voucher = await createScheduledVoucher({ cardAccessTokenHash: 'oldhash'.padEnd(64, '0') });
  const beforeHash = voucher.cardAccessTokenHash;
  const now = sofiaMiddayUtc(sofiaDateIso());
  await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  const saved = await GiftVoucher.findById(voucher._id).lean();
  assert.notEqual(saved.cardAccessTokenHash, beforeHash);
  assert.match(sendCalls[0].text, /\/api\/gift-vouchers\/card\//);
});

test('ops recipient email update before send uses updated address', async () => {
  const voucher = await createScheduledVoucher({ recipientEmail: 'old@example.com' });
  await GiftVoucher.updateOne({ _id: voucher._id }, { recipientEmail: 'new@example.com' });
  const now = sofiaMiddayUtc(sofiaDateIso());
  await deliverScheduledRecipientVoucher(await GiftVoucher.findById(voucher._id), { workerId: 'w1', now });
  assert.equal(sendCalls[0].to, 'new@example.com');
});

test('worker flag off means standalone entry would not start', async () => {
  process.env.GIFT_VOUCHER_DELIVERY_WORKER_ENABLED = '0';
  assert.equal(isFlagEnabled(), false);
});

test('purchase flag off still delivers in-flight scheduled vouchers', async () => {
  process.env[SCHEDULED_DELIVERY_ENV_FLAG] = '0';
  const voucher = await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());
  const outcome = await deliverScheduledRecipientVoucher(voucher, { workerId: 'w1', now });
  assert.equal(outcome.status, 'sent');
});

test('fail then succeed on same lifecycle key writes both events without duplicate key error', async () => {
  const voucher = await createScheduledVoucher();
  const key = lifecycleKey('recipient_voucher', voucher._id);

  emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
  const failed = await performLifecycleSend({
    voucher,
    recipientEmail: voucher.recipientEmail,
    templateKind: 'recipient_voucher',
    actor: 'scheduled_worker',
    cardDownloadUrl: 'https://driftdwells.com/api/gift-vouchers/card/testtoken',
    lifecycleSource: 'scheduled_worker'
  });
  assert.equal(failed.status, 'failed');

  emailService.sendEmail = async () => ({ success: true, method: 'sent', messageId: 'ok-1' });
  const succeeded = await performLifecycleSend({
    voucher,
    recipientEmail: voucher.recipientEmail,
    templateKind: 'recipient_voucher',
    actor: 'scheduled_worker',
    cardDownloadUrl: 'https://driftdwells.com/api/gift-vouchers/card/testtoken2',
    allowRetryAfterFailure: true,
    lifecycleSource: 'scheduled_worker'
  });
  assert.equal(succeeded.status, 'sent');

  const state = await findLifecycleState(voucher._id, key);
  assert.ok(state.sendFailed);
  assert.ok(state.sent);
  assert.ok(state.sendAttempted);
});

test('tickOnce sends due voucher end-to-end', async () => {
  await createScheduledVoucher();
  const now = sofiaMiddayUtc(sofiaDateIso());
  const tick = await tickOnce({ now });
  assert.equal(tick.sent, 1);
  assert.equal(sendCalls.length, 1);
});
