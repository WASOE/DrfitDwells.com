const test = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const CheckoutSession = require('../models/CheckoutSession');
const { issueManualVoucher } = require('../services/giftVouchers/issueManualVoucherService');
const routes = require('../routes/ops/modules/giftVouchersRoutes');
const { purchasedGiftVoucherQuery } = require('../services/giftVouchers/giftVoucherIssuance');
const { renderOpsGiftVoucherPrintHtml } = require('../services/giftVouchers/giftVoucherOpsCardPrintService');
const { buildRecipientVoucherDesignedEmail } = require('../services/giftVouchers/giftVoucherDesignedEmailBuilder');
const { reserveVoucherForCheckout, confirmVoucherReservation } = require('../services/bookings/bookingVoucherRedemptionService');
const { rotateCardAccessTokenForVoucher, resolveVoucherByCardAccessToken } = require('../services/giftVouchers/giftVoucherCardAccessService');
const { getGiftVouchersWorkspaceReadModel, getGiftVoucherDetailReadModel } = require('../services/ops/readModels/giftVouchersReadModel');
const emailService = require('../services/emailService');
const { run: installIndex } = require('./ensureGiftVoucherManualIssuanceIndex.cjs');

let mongo;
let originalSendEmail;
let originalCheckoutFlag;
const reason = 'INTERNAL ONLY: approved goodwill exception';
const input = (overrides = {}) => ({
  amountCents: 26000,
  reason,
  ctx: { user: { id: 'admin-test', role: 'admin' }, idempotencyKey: 'manual-test-key' },
  ...overrides
});
function app(role = 'admin') {
  const instance = express();
  instance.use(express.json());
  instance.use((req, res, next) => {
    req.user = { id: 'admin-test', role };
    next();
  });
  instance.use('/api/ops/gift-vouchers', routes);
  return instance;
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await GiftVoucherRedemption.syncIndexes();
  await CheckoutSession.syncIndexes();
  originalSendEmail = emailService.sendEmail;
  originalCheckoutFlag = process.env.CHECKOUT_SESSION_V2;
  process.env.CHECKOUT_SESSION_V2 = '0';
  emailService.sendEmail = async () => { throw new Error('Manual issuance must not send email'); };
});
test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  if (originalCheckoutFlag == null) delete process.env.CHECKOUT_SESSION_V2;
  else process.env.CHECKOUT_SESSION_V2 = originalCheckoutFlag;
  await mongoose.disconnect();
  await mongo.stop();
});
test.beforeEach(async () => {
  await GiftVoucher.deleteMany({});
  await GiftVoucherEvent.collection.deleteMany({});
  await GiftVoucherRedemption.deleteMany({});
  await CheckoutSession.deleteMany({});
});

test('issues EUR260 active goodwill with one-year validity, internal audit and no payment/checkout/revenue', async () => {
  const before = new Date();
  const result = await issueManualVoucher(input({ recipientName: ' Guest ', recipientEmail: ' Guest@Example.com ' }));
  const after = new Date();
  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.match(result.code, /^DD-/);
  assert.equal(result.balanceRemainingCents, 26000);
  assert.equal(result.idempotentReplay, false);
  assert.equal(voucher.status, 'active');
  assert.equal(voucher.issuanceSource, 'goodwill_ops');
  assert.equal(voucher.deliveryMode, 'manual');
  assert.equal(voucher.recipientName, 'Guest');
  assert.equal(voucher.recipientEmail, 'guest@example.com');
  assert.equal(voucher.issuedByActorId, 'admin-test');
  assert.equal(voucher.compensationNote, reason);
  assert.equal(voucher.message, null);
  assert.equal(voucher.stripePaymentIntentId, null);
  assert.equal(voucher.stripeCheckoutSessionId, null);
  assert.equal(voucher.purchaseRequestId, null);
  assert.match(voucher.cardAccessTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(voucher.activatedAt >= before && voucher.activatedAt <= after);
  const expiry = new Date(voucher.activatedAt);
  expiry.setFullYear(expiry.getFullYear() + 1);
  assert.equal(voucher.expiresAt.toISOString(), expiry.toISOString());
  const events = await GiftVoucherEvent.find({ giftVoucherId: voucher._id }).lean();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'created');
  assert.equal(events[0].note, reason);
  assert.equal(events[0].actor, 'admin-test');
  assert.equal(events[0].metadata.amountCents, 26000);
  assert.equal(events[0].createdAt.toISOString(), voucher.activatedAt.toISOString());
  assert.equal(await CheckoutSession.countDocuments({}), 0);
  assert.equal(await GiftVoucher.countDocuments(purchasedGiftVoucherQuery()), 0);
  assert.equal((await getGiftVouchersWorkspaceReadModel({})).items.length, 1);
  const detail = await getGiftVoucherDetailReadModel(voucher._id);
  assert.equal(detail.voucher.compensationNote, reason);
});

test('optional recipient, minimum and custom cent amounts follow existing amount rules', async () => {
  for (const amountCents of [1500, 1523, 1000001]) {
    const result = await issueManualVoucher(input({
      amountCents,
      ctx: { user: { id: 'admin-test', role: 'admin' }, idempotencyKey: `amount-${amountCents}` }
    }));
    assert.equal(result.balanceRemainingCents, amountCents);
  }
});

test('rejects invalid amounts, reason, email, name, issuer, and key at service boundary', async () => {
  for (const changes of [
    { amountCents: 1499 }, { amountCents: 260.5 }, { amountCents: '26000' },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 }, { amountCents: Infinity },
    { reason: '' }, { reason: '  ' }, { reason: 'x'.repeat(501) }, { reason: {} },
    { recipientEmail: 'invalid' }, { recipientEmail: null }, { recipientName: 'x'.repeat(201) },
    { ctx: { user: { role: 'admin' }, idempotencyKey: 'test' } },
    { ctx: { user: { id: 'admin-test', role: 'admin' }, idempotencyKey: 'a' } },
    { ctx: { user: { id: 'admin-test', role: 'admin' }, idempotencyKey: 'x'.repeat(121) } }
  ]) {
    await assert.rejects(issueManualVoucher(input(changes)));
  }
  assert.equal(await GiftVoucher.countDocuments(), 0);
});

test('service and route deny operators, cleaners, missing and unknown roles', async () => {
  for (const role of ['operator', 'cleaner', undefined, 'guest']) {
    await assert.rejects(issueManualVoucher(input({
      ctx: { user: { id: 'actor', role }, idempotencyKey: 'permission-key' }
    })), { code: 'PERMISSION_DENIED' });
    const response = await request(app(role || 'guest')).post('/api/ops/gift-vouchers/actions/issue-manual')
      .send({ amountCents: 26000, reason, idempotencyKey: 'route-key' });
    assert.equal(response.status, 403);
  }
  assert.equal(await GiftVoucher.countDocuments(), 0);
});

test('concurrent identical requests and later replay produce exactly one voucher and one event', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => issueManualVoucher(input())));
  assert.equal(new Set(results.map((result) => result.giftVoucherId)).size, 1);
  assert.equal(results.filter((result) => !result.idempotentReplay).length, 1);
  assert.equal(await GiftVoucher.countDocuments(), 1);
  assert.equal(await GiftVoucherEvent.countDocuments(), 1);
  const replay = await issueManualVoucher(input());
  assert.equal(replay.code, results[0].code);
  assert.equal(replay.idempotentReplay, true);
});

test('same-key changed amount, recipient, reason or issuer is a conflict; normalized payload replays', async () => {
  await issueManualVoucher(input({ recipientEmail: 'Guest@Example.com', recipientName: 'Guest' }));
  const base = { recipientEmail: 'guest@example.com', recipientName: 'Guest' };
  const replay = await issueManualVoucher(input({ ...base, reason: ` ${reason} ` }));
  assert.equal(replay.idempotentReplay, true);
  for (const changes of [
    { amountCents: 27000 }, { recipientEmail: 'different@example.com' }, { recipientName: 'Different' },
    { reason: 'Another reason' },
    { ctx: { user: { id: 'another-admin', role: 'admin' }, idempotencyKey: 'manual-test-key' } }
  ]) {
    await assert.rejects(issueManualVoucher(input({ ...base, ...changes })), { code: 'IDEMPOTENCY_CONFLICT' });
  }
  assert.equal(await GiftVoucher.countDocuments(), 1);
});

test('different concurrent payloads with one key cannot both succeed', async () => {
  const results = await Promise.allSettled([
    issueManualVoucher(input()),
    issueManualVoucher(input({ amountCents: 27000 }))
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(await GiftVoucher.countDocuments(), 1);
});

test('event failure is surfaced and retry repairs event using original durable audit without reissuing', async () => {
  const original = GiftVoucherEvent.create;
  GiftVoucherEvent.create = async () => { throw new Error('injected event outage'); };
  try {
    await assert.rejects(issueManualVoucher(input()), /injected event outage/);
  } finally {
    GiftVoucherEvent.create = original;
  }
  assert.equal(await GiftVoucher.countDocuments(), 1);
  assert.equal(await GiftVoucherEvent.countDocuments(), 0);
  const replay = await issueManualVoucher(input());
  assert.equal(replay.idempotentReplay, true);
  assert.equal(await GiftVoucher.countDocuments(), 1);
  assert.equal(await GiftVoucherEvent.countDocuments(), 1);
});

test('manual voucher uses ordinary reserve/confirm redemption and replay never resets its balance', async () => {
  const issued = await issueManualVoucher(input());
  const reserved = await reserveVoucherForCheckout({
    voucherCode: issued.code,
    checkoutId: 'manual-normal-redemption',
    totalValueCents: 10000,
    redemptionExpiresAt: new Date(Date.now() + 3600000)
  });
  assert.equal(reserved.voucherAppliedCents, 10000);
  await confirmVoucherReservation({ redemptionId: reserved.redemptionId, actor: 'test' });
  const voucher = await GiftVoucher.findById(issued.giftVoucherId).lean();
  assert.equal(voucher.balanceRemainingCents, 16000);
  assert.equal(voucher.status, 'partially_redeemed');
  assert.equal((await issueManualVoucher(input())).balanceRemainingCents, 16000);
  assert.equal(await GiftVoucherEvent.countDocuments({ type: 'paid' }), 0);
});

test('normal guest print/email and token access work and do not expose internal reason or issuer', async () => {
  const issued = await issueManualVoucher(input({ recipientEmail: 'guest@example.com' }));
  const voucher = await GiftVoucher.findById(issued.giftVoucherId).lean();
  const print = await renderOpsGiftVoucherPrintHtml(voucher._id);
  const email = buildRecipientVoucherDesignedEmail({ voucher, recipientEmail: voucher.recipientEmail });
  for (const content of [print, JSON.stringify(email)]) {
    assert.ok(content.includes(issued.code));
    assert.ok(!content.includes(reason));
    assert.ok(!content.includes('admin-test'));
    assert.ok(!content.includes('manual-test-key'));
  }
  const { rawToken } = await rotateCardAccessTokenForVoucher(voucher._id);
  assert.equal(String((await resolveVoucherByCardAccessToken(rawToken))._id), issued.giftVoucherId);
});

test('HTTP returns 201, replay 200, validation 400 and changed-key payload 409', async () => {
  const body = { amountCents: 26000, reason, idempotencyKey: 'http-key' };
  const first = await request(app()).post('/api/ops/gift-vouchers/actions/issue-manual').send(body);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.balanceRemainingCents, 26000);
  assert.equal(JSON.stringify(first.body).includes(reason), false);
  const replay = await request(app()).post('/api/ops/gift-vouchers/actions/issue-manual').send(body);
  assert.equal(replay.status, 200);
  const conflict = await request(app()).post('/api/ops/gift-vouchers/actions/issue-manual').send({ ...body, amountCents: 27000 });
  assert.equal(conflict.status, 409);
  const invalid = await request(app()).post('/api/ops/gift-vouchers/actions/issue-manual').send({ ...body, reason: '' });
  assert.equal(invalid.status, 400);
});

test('missing unique index fails closed without startup DDL; explicit install gate works on standalone Mongo', async () => {
  const { keys, options } = GiftVoucher.MANUAL_ISSUANCE_INDEX;
  await GiftVoucher.collection.dropIndex(options.name);
  try {
    const response = await request(app()).post('/api/ops/gift-vouchers/actions/issue-manual')
      .send({ amountCents: 26000, reason, idempotencyKey: 'gate-key' });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'MANUAL_ISSUANCE_INDEX_REQUIRED');
    assert.equal(await GiftVoucher.countDocuments(), 0);
    const runInstaller = (args) => promisify(execFile)(process.execPath,
      [require.resolve('./ensureGiftVoucherManualIssuanceIndex.cjs'), ...args],
      { env: { ...process.env, MONGODB_URI: mongo.getUri() } });
    await assert.rejects(runInstaller([]), /Command failed/);
    assert.equal((await GiftVoucher.collection.indexes()).some((index) => index.name === options.name), false);
    await runInstaller(['--apply']);
    assert.equal((await GiftVoucher.collection.indexes()).find((index) => index.name === options.name).unique, true);
    const oldUri = process.env.MONGODB_URI;
    const oldMongoUri = process.env.MONGO_URI;
    try {
      delete process.env.MONGODB_URI;
      delete process.env.MONGO_URI;
      await assert.rejects(installIndex({ apply: true }), /explicitly/);
    } finally {
      if (oldUri != null) process.env.MONGODB_URI = oldUri;
      if (oldMongoUri != null) process.env.MONGO_URI = oldMongoUri;
    }
  } finally {
    await GiftVoucher.collection.createIndex(keys, options);
  }
  await issueManualVoucher(input());
});
