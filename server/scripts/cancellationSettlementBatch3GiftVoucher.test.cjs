const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const CreatorPartner = require('../models/CreatorPartner');
const {
  ISSUANCE_SOURCE_PURCHASE,
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
  purchasedGiftVoucherQuery
} = require('../services/giftVouchers/giftVoucherIssuance');
const {
  getGiftVouchersWorkspaceReadModel,
  getGiftVoucherDetailReadModel
} = require('../services/ops/readModels/giftVouchersReadModel');
const { buildAllCreatorPartnerStats } = require('../services/ops/creatorPartnerStatsService');

let mongoServer;

function buildVoucher(overrides = {}) {
  const now = new Date();
  return {
    code: `DD-B3-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
    amountOriginalCents: 15000,
    balanceRemainingCents: 15000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    activatedAt: now,
    expiresAt: new Date(now.getTime() + 86400000),
    ...overrides
  };
}

async function insertLegacyWithoutIssuanceSource(overrides = {}) {
  const doc = buildVoucher(overrides);
  delete doc.issuanceSource;
  const inserted = await GiftVoucher.collection.insertOne(doc);
  return GiftVoucher.findById(inserted.insertedId).lean();
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherCreatorCommission.syncIndexes();
  await CreatorPartner.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await GiftVoucherCreatorCommission.deleteMany({});
  await GiftVoucher.deleteMany({});
  await CreatorPartner.deleteMany({});
});

test('purchasedGiftVoucherQuery: new documents default issuanceSource to purchase', async () => {
  const created = await GiftVoucher.create(buildVoucher());
  assert.equal(created.issuanceSource, ISSUANCE_SOURCE_PURCHASE);

  const found = await GiftVoucher.find(purchasedGiftVoucherQuery({ _id: created._id })).lean();
  assert.equal(found.length, 1);
});

test('purchasedGiftVoucherQuery: legacy missing issuanceSource counts as purchase', async () => {
  const legacy = await insertLegacyWithoutIssuanceSource();
  assert.equal(legacy.issuanceSource, undefined);

  const found = await GiftVoucher.find(purchasedGiftVoucherQuery({ _id: legacy._id })).lean();
  assert.equal(found.length, 1);
});

test('purchasedGiftVoucherQuery: compensation voucher is excluded', async () => {
  const compensation = await GiftVoucher.create(
    buildVoucher({
      issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
      deliveryMode: 'manual',
      buyerName: null,
      buyerEmail: null,
      recipientEmail: null
    })
  );

  const found = await GiftVoucher.find(purchasedGiftVoucherQuery({ _id: compensation._id })).lean();
  assert.equal(found.length, 0);
});

test('purchasedGiftVoucherQuery composes with attribution $or', async () => {
  await GiftVoucher.create(
    buildVoucher({
      attribution: { referralCode: 'creator.a' }
    })
  );
  await GiftVoucher.create(
    buildVoucher({
      issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
      deliveryMode: 'manual',
      recipientEmail: null,
      attribution: { referralCode: 'creator.a' }
    })
  );

  const rows = await GiftVoucher.find(
    purchasedGiftVoucherQuery({
      $or: [{ 'attribution.referralCode': 'creator.a' }]
    })
  ).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issuanceSource, ISSUANCE_SOURCE_PURCHASE);
});

test('creator stats exclude compensation from giftVoucherPurchases and revenue', async () => {
  const creator = await CreatorPartner.create({
    name: 'Stats Creator',
    slug: `stats-${Date.now()}`,
    status: 'active',
    referral: { code: 'stats.b3', cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' },
    promo: { code: null }
  });

  const purchase = await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 9900,
      balanceRemainingCents: 9900,
      attribution: { referralCode: 'stats.b3' }
    })
  );

  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 12000,
      balanceRemainingCents: 12000,
      issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
      deliveryMode: 'manual',
      recipientEmail: null,
      attribution: { referralCode: 'stats.b3' }
    })
  );

  await GiftVoucherCreatorCommission.create({
    giftVoucherId: purchase._id,
    creatorPartnerId: creator._id,
    referralCode: 'stats.b3',
    amountOriginalCents: 9900,
    commissionableRevenueCents: 9900,
    commissionRateBps: 1000,
    commissionAmountCents: 990,
    status: 'pending',
    eligibilityStatus: 'pending_manual_approval',
    source: 'gift_voucher_referral'
  });

  const all = await buildAllCreatorPartnerStats();
  const row = all.find((r) => String(r.creatorPartnerId) === String(creator._id));
  assert.ok(row);
  assert.equal(row.stats.giftVoucherPurchases, 1);
  assert.equal(row.stats.giftVoucherRevenueCents, 9900);
  assert.equal(row.stats.giftVoucherCommissionCents, 990);
});

test('OPS list default excludes compensation voucher', async () => {
  await GiftVoucher.create(buildVoucher({ code: 'DD-B3-PURCH-AAAA' }));
  const compensation = await GiftVoucher.create(
    buildVoucher({
      code: 'DD-B3-COMP-BBBB',
      issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
      deliveryMode: 'manual',
      recipientEmail: null
    })
  );

  const list = await getGiftVouchersWorkspaceReadModel({ page: 1, limit: 20 });
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].code, 'DD-B3-PURCH-AAAA');
  assert.equal(list.pagination.total, 1);

  const ids = list.items.map((item) => item.giftVoucherId);
  assert.equal(ids.includes(String(compensation._id)), false);
});

test('OPS detail returns compensation voucher with issuance fields', async () => {
  const reservationId = new mongoose.Types.ObjectId();
  const compensation = await GiftVoucher.create(
    buildVoucher({
      issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
      sourceReservationId: reservationId,
      issuedByActorId: 'ops_user_1',
      compensationNote: 'Stay credit after cancel',
      deliveryMode: 'manual',
      recipientEmail: null
    })
  );

  const detail = await getGiftVoucherDetailReadModel(compensation._id);
  assert.ok(detail);
  assert.equal(detail.voucher.issuanceSource, ISSUANCE_SOURCE_CANCELLATION_COMPENSATION);
  assert.equal(detail.voucher.sourceReservationId, String(reservationId));
  assert.equal(detail.voucher.issuedByActorId, 'ops_user_1');
  assert.equal(detail.voucher.compensationNote, 'Stay credit after cancel');
});
