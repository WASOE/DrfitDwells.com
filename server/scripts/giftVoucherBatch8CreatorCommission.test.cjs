const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherCreatorCommission = require('../models/GiftVoucherCreatorCommission');
const CreatorPartner = require('../models/CreatorPartner');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CreatorCommission = require('../models/CreatorCommission');
const CreatorReferralVisit = require('../models/CreatorReferralVisit');
const ManualReviewItem = require('../models/ManualReviewItem');

const giftVoucherPaymentService = require('../services/giftVouchers/giftVoucherPaymentService');
const {
  activatePaidVoucherFromStripeEvent,
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent
} = giftVoucherPaymentService;
const { ensureGiftVoucherCreatorCommissionAfterActivation } = require('../services/giftVouchers/giftVoucherCommissionService');
const { recalculateCreatorCommissionForPartner } = require('../services/ops/creatorCommissionLedgerService');
const { buildAllCreatorPartnerStats } = require('../services/ops/creatorPartnerStatsService');

let mongoServer;

async function syncAllIndexes() {
  await GiftVoucher.syncIndexes();
  await GiftVoucherCreatorCommission.syncIndexes();
  await CreatorPartner.syncIndexes();
  await Booking.syncIndexes();
  await Cabin.syncIndexes();
  await CreatorCommission.syncIndexes();
  await ManualReviewItem.syncIndexes();
}

function uniqSlug(prefix = 'cr') {
  return `${prefix}-${new mongoose.Types.ObjectId().toString().slice(-8)}`;
}

async function createCreator(overrides = {}) {
  const base = {
    name: `Creator ${uniqSlug('n')}`,
    slug: uniqSlug(),
    status: 'active',
    referral: { code: `inf.${uniqSlug('ref')}`, cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' },
    promo: { code: null }
  };
  const merged = { ...base, ...overrides };
  if (overrides.promo && typeof overrides.promo === 'object') {
    merged.promo = { ...base.promo, ...overrides.promo };
  }
  return CreatorPartner.create(merged);
}

async function createStripeStub(piId = 'pi_batch8') {
  setStripeClientForTesting({
    paymentIntents: {
      create: async ({ metadata }) => ({
        id: piId,
        client_secret: 'secret',
        metadata,
        currency: 'eur',
        amount: metadata?.amountParsed || undefined
      }),
      retrieve: async () => ({
        client_secret: 'secret'
      })
    }
  });
}

async function purchaseViaIntent({
  purchaseRequestId,
  amountOriginalCents,
  attribution,
  piSuffix = ''
}) {
  const piId = `pi_${purchaseRequestId}${piSuffix}`;
  await createStripeStub(piId);

  const piRes = await createGiftVoucherPaymentIntent({
    amountOriginalCents,
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    termsAccepted: true,
    purchaseRequestId,
    attribution,
    deliveryMode: 'email'
  });

  assert.equal(piRes.ok, true);

  return {
    purchaseRequestId,
    voucherId: piRes.giftVoucherId,
    stripePaymentIntentId: piRes.stripePaymentIntentId
  };
}

function buildStripeEvent(webhookEventId, purchaseRequestId, giftVoucherId, stripePaymentIntentId, amountCents) {
  return {
    id: webhookEventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: stripePaymentIntentId,
        amount: amountCents,
        amount_received: amountCents,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId,
          purchaseRequestId
        }
      }
    }
  };
}

function nextDates() {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 14);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  return { checkIn, checkOut };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await syncAllIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await GiftVoucherCreatorCommission.deleteMany({});
  await CreatorCommission.deleteMany({});
  await GiftVoucher.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await CreatorPartner.deleteMany({});
  await CreatorReferralVisit.deleteMany({});
  await ManualReviewItem.deleteMany({});
  setStripeClientForTesting(null);
});

test('1 voucher purchase with referral creates exactly one GiftVoucherCreatorCommission row', async () => {
  const c = await createCreator({
    slug: uniqSlug('t1'),
    referral: { code: 'alice.stay', cookieDays: 60 },
    promo: { code: null }
  });

  const amountOriginalCents = 25000;
  const purchaseRequestId = 'gvr_req_1';

  await purchaseViaIntent({
    purchaseRequestId,
    amountOriginalCents,
    attribution: { referralCode: 'alice.stay' }
  });

  const gvDoc = await GiftVoucher.findOne({ purchaseRequestId }).lean();
  const event = buildStripeEvent(
    'evt_1',
    purchaseRequestId,
    String(gvDoc._id),
    gvDoc.stripePaymentIntentId,
    amountOriginalCents
  );
  const act = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(act.ok, true);

  const rows = await GiftVoucherCreatorCommission.find({}).lean();
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].giftVoucherId), String(gvDoc._id));
  assert.equal(String(rows[0].creatorPartnerId), String(c._id));
  assert.equal(rows[0].commissionableRevenueCents, amountOriginalCents);
  assert.equal(rows[0].commissionRateBps, 1000);
  assert.equal(rows[0].commissionAmountCents, 2500);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].eligibilityStatus, 'pending_manual_approval');
});

test('2 duplicate activation webhook does not duplicate voucher commission', async () => {
  await createCreator({
    slug: uniqSlug('t2'),
    referral: { code: 'bob.stay', cookieDays: 60 },
    promo: { code: null }
  });

  const amountOriginalCents = 20000;
  const purchaseRequestId = 'gvr_req_dup';

  await purchaseViaIntent({
    purchaseRequestId,
    amountOriginalCents,
    attribution: { referralCode: 'bob.stay' }
  });

  const gvDoc = await GiftVoucher.findOne({ purchaseRequestId }).lean();
  const e1 = buildStripeEvent(
    'evt_d1',
    purchaseRequestId,
    String(gvDoc._id),
    gvDoc.stripePaymentIntentId,
    amountOriginalCents
  );
  await activatePaidVoucherFromStripeEvent(e1);

  const e2 = buildStripeEvent(
    'evt_d2',
    purchaseRequestId,
    String(gvDoc._id),
    gvDoc.stripePaymentIntentId,
    amountOriginalCents
  );
  await activatePaidVoucherFromStripeEvent(e2);

  assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 1);
});

test('3 voucher purchase without creator attribution creates no commission row', async () => {
  const purchaseRequestId = 'gvr_no_attr';
  const amountOriginalCents = 18000;

  await purchaseViaIntent({
    purchaseRequestId,
    amountOriginalCents,
    attribution: {}
  });

  const gvDoc = await GiftVoucher.findOne({ purchaseRequestId }).lean();
  const event = buildStripeEvent(
    'evt_na',
    purchaseRequestId,
    String(gvDoc._id),
    gvDoc.stripePaymentIntentId,
    amountOriginalCents
  );
  await activatePaidVoucherFromStripeEvent(event);
  assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 0);
});

test('4 creatorPartnerId only resolves; referral-only resolves', async () => {
  const cIdOnly = await createCreator({
    slug: uniqSlug('idonly'),
    referral: { code: 'verified.id.path', cookieDays: 60 },
    promo: { code: null }
  });

  const gv1 = await GiftVoucher.create({
    code: 'DD-AA-BB-CC-11',
    amountOriginalCents: 16000,
    balanceRemainingCents: 16000,
    buyerName: 'B',
    buyerEmail: 'b@e.com',
    recipientName: 'R',
    recipientEmail: 'r@e.com',
    deliveryMode: 'email',
    status: 'active',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    attribution: { creatorPartnerId: cIdOnly._id }
  });

  await ensureGiftVoucherCreatorCommissionAfterActivation(gv1.toObject({ virtuals: true }));
  let row = await GiftVoucherCreatorCommission.findOne({ giftVoucherId: gv1._id }).lean();
  assert.ok(row);
  assert.equal(String(row.creatorPartnerId), String(cIdOnly._id));

  await GiftVoucherCreatorCommission.deleteMany({});

  await createCreator({
    slug: uniqSlug('refonly'),
    referral: { code: 'charlie.only', cookieDays: 60 },
    promo: { code: null }
  });

  const gv2 = await GiftVoucher.create({
    code: 'DD-AA-BB-CC-22',
    amountOriginalCents: 17000,
    balanceRemainingCents: 17000,
    buyerName: 'B',
    buyerEmail: 'b2@e.com',
    recipientName: 'R',
    recipientEmail: 'r2@e.com',
    deliveryMode: 'email',
    status: 'active',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    attribution: { referralCode: 'charlie.only' }
  });

  await ensureGiftVoucherCreatorCommissionAfterActivation(gv2.toObject({ virtuals: true }));
  row = await GiftVoucherCreatorCommission.findOne({ giftVoucherId: gv2._id }).lean();
  assert.ok(row);
  const creatorByRef = await CreatorPartner.findOne({ 'referral.code': 'charlie.only' }).lean();
  assert.equal(String(row.creatorPartnerId), String(creatorByRef._id));
});

test('5 voucher redemption booking does not commission voucher-covered amount', async () => {
  const c = await createCreator({
    slug: uniqSlug('stay5'),
    referral: { code: 'stay.cover', cookieDays: 60 },
    promo: { code: null }
  });

  const cabin = await Cabin.create({
    name: 'Cabin T',
    description: 'T',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });

  const { checkIn, checkOut } = nextDates();

  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'G', lastName: 'uest', email: 'g@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 360,
    subtotalPrice: 360,
    discountAmount: 0,
    totalValueCents: 36000,
    giftVoucherAppliedCents: 36000,
    stripePaidAmountCents: 0,
    paymentMethod: 'gift_voucher',
    attribution: { referralCode: 'stay.cover' }
  });

  const r = await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findById(c._id).select('_id status referral promo commission').lean()
  );
  assert.equal(r.upserted, 1);
  const ledger = await CreatorCommission.findOne({}).lean();
  assert.ok(ledger);
  assert.equal(ledger.commissionableRevenueSnapshot, 0);
  assert.equal(ledger.amountSnapshot, 0);
});

test('6 partial voucher + attribution commissions only Stripe cash portion', async () => {
  const c = await createCreator({
    slug: uniqSlug('stay6'),
    referral: { code: 'stay.partial', cookieDays: 60 },
    promo: { code: null }
  });

  const cabin = await Cabin.create({
    name: 'Cabin P',
    description: 'T',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });

  const { checkIn, checkOut } = nextDates();

  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'H', lastName: 'ost', email: 'h@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 360,
    subtotalPrice: 360,
    discountAmount: 0,
    totalValueCents: 36000,
    giftVoucherAppliedCents: 25000,
    stripePaidAmountCents: 11000,
    paymentMethod: 'stripe_plus_gift_voucher',
    stripePaymentIntentId: 'pi_extra',
    attribution: { referralCode: 'stay.partial' }
  });

  await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findById(c._id).select('_id status referral promo commission').lean()
  );
  const ledger = await CreatorCommission.findOne({}).lean();
  assert.ok(ledger);
  assert.equal(ledger.commissionableRevenueSnapshot, 110);
});

test('7 partial voucher top-up without booking attribution creates no stay commission', async () => {
  await createCreator({
    slug: uniqSlug('ghost'),
    referral: { code: 'ghost.ref', cookieDays: 60 },
    promo: { code: null }
  });

  const cabin = await Cabin.create({
    name: 'Cabin U',
    description: 'T',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });

  const { checkIn, checkOut } = nextDates();

  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'U', lastName: 'Nr', email: 'u@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 5000,
    stripePaidAmountCents: 15000,
    paymentMethod: 'stripe_plus_gift_voucher'
  });

  await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findOne({ 'referral.code': 'ghost.ref' }).select('_id status referral promo commission').lean()
  );
  assert.equal(await CreatorCommission.countDocuments({}), 0);
});

test('8 creator stats separate gift voucher revenue from stay booking revenue', async () => {
  const promoCode = 'STAT10BV';
  const c = await createCreator({
    slug: uniqSlug('stats'),
    referral: { code: 'stats.person', cookieDays: 60 },
    promo: { code: promoCode }
  });

  const cabin = await Cabin.create({
    name: 'Cab S',
    description: '.',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 50,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });

  const { checkIn, checkOut } = nextDates();

  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'S', lastName: 'B', email: 'sb@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 100,
    subtotalPrice: 100,
    discountAmount: 0,
    totalValueCents: 10000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 10000,
    promoCode,
    stripePaymentIntentId: 'pi_sb'
  });

  await GiftVoucher.create({
    code: 'DD-STAT-ST-VO-UCH',
    amountOriginalCents: 9900,
    balanceRemainingCents: 9900,
    buyerName: 'Bv',
    buyerEmail: 'bv@e.com',
    recipientName: 'Rv',
    recipientEmail: 'rv@e.com',
    deliveryMode: 'email',
    status: 'active',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    attribution: { referralCode: 'stats.person' }
  });

  const gvOne = await GiftVoucher.findOne({ code: 'DD-STAT-ST-VO-UCH' }).lean();

  await GiftVoucherCreatorCommission.create({
    giftVoucherId: gvOne._id,
    creatorPartnerId: c._id,
    referralCode: 'stats.person',
    amountOriginalCents: 9900,
    commissionableRevenueCents: 9900,
    commissionRateBps: 1000,
    commissionAmountCents: 990,
    status: 'pending',
    eligibilityStatus: 'pending_manual_approval',
    source: 'gift_voucher_referral'
  });

  const b = await Booking.findOne({}).lean();
  await CreatorCommission.create({
    creatorPartnerId: c._id,
    bookingId: b._id,
    referralCode: null,
    promoCode,
    source: 'creator_promo',
    rateBpsSnapshot: 1000,
    commissionableRevenueSnapshot: 100,
    amountSnapshot: 10,
    currency: 'EUR',
    bookingStatusSnapshot: 'confirmed',
    paymentStatusSnapshot: 'paid',
    eligibilityStatus: 'eligible',
    status: 'pending'
  });

  const all = await buildAllCreatorPartnerStats();
  const row = all.find((r) => String(r.creatorPartnerId) === String(c._id));
  assert.ok(row);
  const s = row.stats;
  assert.equal(s.giftVoucherPurchases, 1);
  assert.equal(s.giftVoucherRevenueCents, 9900);
  assert.equal(s.stayBookingRevenueCents, 10000);
});

test('9 giftVoucherCommissionCents appears separately in stats', async () => {
  const c = await createCreator({
    slug: uniqSlug('gc9'),
    referral: { code: 'gc.nine', cookieDays: 60 },
    promo: { code: null }
  });

  await GiftVoucher.create({
    code: 'DD-GC-NI-NE-99',
    amountOriginalCents: 5000,
    balanceRemainingCents: 5000,
    buyerName: 'B',
    buyerEmail: 'b@e.com',
    recipientName: 'R',
    recipientEmail: 'r@e.com',
    deliveryMode: 'email',
    status: 'active',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    attribution: { referralCode: 'gc.nine' }
  });

  const gv = await GiftVoucher.findOne({ code: 'DD-GC-NI-NE-99' }).lean();

  await GiftVoucherCreatorCommission.create({
    giftVoucherId: gv._id,
    creatorPartnerId: c._id,
    referralCode: 'gc.nine',
    amountOriginalCents: 5000,
    commissionableRevenueCents: 5000,
    commissionRateBps: 1000,
    commissionAmountCents: 500,
    status: 'pending',
    eligibilityStatus: 'pending_manual_approval',
    source: 'gift_voucher_referral'
  });

  const all = await buildAllCreatorPartnerStats();
  const row = all.find((r) => String(r.creatorPartnerId) === String(c._id));
  assert.equal(row.stats.giftVoucherCommissionCents, 500);
  assert.equal(row.stats.stayBookingCommissionCents, 0);
  assert.equal(row.stats.totalCommissionCents, 500);
});

test('10 legacy booking without totalValueCents uses decimal commission base (no regression)', async () => {
  const c = await createCreator({
    slug: uniqSlug('legacy'),
    referral: { code: 'legacy.ref', cookieDays: 60 },
    promo: { code: null }
  });

  const cabin = await Cabin.create({
    name: 'Cab L',
    description: '.',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });

  const { checkIn, checkOut } = nextDates();

  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'L', lastName: 'g', email: 'lg@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    attribution: { referralCode: 'legacy.ref' },
    stripePaymentIntentId: 'pi_leg'
  });

  await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findById(c._id).select('_id status referral promo commission').lean()
  );
  const ledger = await CreatorCommission.findOne({}).lean();
  assert.ok(ledger);
  assert.equal(ledger.commissionableRevenueSnapshot, 200);
  assert.equal(ledger.amountSnapshot, 20);
});

test('11 approved stay commission snapshot is preserved on recalculate', async () => {
  const c = await createCreator({
    slug: uniqSlug('lock'),
    referral: { code: 'lock.ref', cookieDays: 60 },
    promo: { code: null }
  });

  const cabin = await Cabin.create({
    name: 'Cab K',
    description: '.',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 50,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });

  const { checkIn, checkOut } = nextDates();

  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'K', lastName: 'eep', email: 'k@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 80,
    subtotalPrice: 80,
    discountAmount: 0,
    attribution: { referralCode: 'lock.ref' },
    stripePaymentIntentId: 'pi_lock'
  });

  await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findById(c._id).select('_id status referral promo commission').lean()
  );

  await CreatorCommission.updateOne(
    { bookingId: booking._id },
    { $set: { status: 'approved', approvedAt: new Date() } }
  );

  await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findById(c._id).select('_id status referral promo commission').lean()
  );

  const ledger = await CreatorCommission.findOne({ bookingId: booking._id }).lean();
  assert.equal(ledger.status, 'approved');
  assert.equal(ledger.amountSnapshot, 8);
});

test('12 attribution conflict opens manual review and creates no GiftVoucherCreatorCommission row', async () => {
  await createCreator({
    slug: uniqSlug('cfla'),
    referral: { code: 'conflict.ref.a', cookieDays: 60 },
    promo: { code: null }
  });
  const b = await createCreator({
    slug: uniqSlug('cflb'),
    referral: { code: 'conflict.ref.b', cookieDays: 60 },
    promo: { code: null }
  });

  const gv = await GiftVoucher.create({
    code: 'DD-CF-AA-BB-CC01',
    amountOriginalCents: 20000,
    balanceRemainingCents: 20000,
    buyerName: 'Buyer',
    buyerEmail: 'buy@test.com',
    recipientName: 'Rec',
    recipientEmail: 'rec@test.com',
    deliveryMode: 'email',
    status: 'active',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    stripePaymentIntentId: 'pi_cf',
    attribution: {
      referralCode: 'conflict.ref.a',
      creatorPartnerId: b._id
    }
  });

  const out = await ensureGiftVoucherCreatorCommissionAfterActivation(gv.toObject ? gv.toObject() : gv);

  assert.equal(out.ok, true);
  assert.equal(out.skipped, true);
  assert.equal(out.blocked, true);
  assert.equal(out.code, 'attribution_conflict');

  assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 0);

  const review = await ManualReviewItem.findOne({
    category: 'gift_voucher_commission_conflict',
    entityId: String(gv._id)
  }).lean();
  assert.ok(review);
  assert.equal(String(review.evidence?.resolutionCode), 'attribution_conflict');
});

test('13 pending_payment voided refunded voucher does not get commission row', async () => {
  for (const status of ['pending_payment', 'voided', 'refunded']) {
    await GiftVoucherCreatorCommission.deleteMany({});
    await GiftVoucher.deleteMany({});
    const gv = await GiftVoucher.create({
      amountOriginalCents: 9000,
      balanceRemainingCents: 9000,
      buyerName: 'B',
      buyerEmail: 'b@st.com',
      recipientName: 'R',
      recipientEmail: 'r@st.com',
      deliveryMode: 'email',
      attribution: { referralCode: 'status.chk.influencer' },
      code: `DD-ST-${status.slice(0, 3).toUpperCase()}-TST`,
      status
    });

    const out = await ensureGiftVoucherCreatorCommissionAfterActivation(gv.toObject());

    assert.equal(out.skipped, true, `expect skip for ${status}`);
    assert.equal(out.code, 'voucher_status_ineligible_for_commission', status);
    assert.equal(await GiftVoucherCreatorCommission.countDocuments({}), 0);
  }
});

test('14 voided GiftVoucherCreatorCommission is excluded from giftVoucherCommissionCents stats', async () => {
  const slug = uniqSlug('void-stat');
  const c = await createCreator({
    slug,
    referral: { code: 'void.stat.ref', cookieDays: 60 },
    promo: { code: null }
  });

  const mkVoucher = async (suffix) =>
    GiftVoucher.create({
      code: `DD-VSTAT-${suffix}`,
      amountOriginalCents: 10000,
      balanceRemainingCents: 10000,
      buyerName: 'B',
      buyerEmail: 'b@v.com',
      recipientName: 'R',
      recipientEmail: 'r@v.com',
      deliveryMode: 'email',
      status: 'active',
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      attribution: { referralCode: 'void.stat.ref' }
    });

  const gvPay = await mkVoucher('PAY');
  const gvVoid = await mkVoucher('VD');

  await GiftVoucherCreatorCommission.create({
    giftVoucherId: gvPay._id,
    creatorPartnerId: c._id,
    referralCode: 'void.stat.ref',
    amountOriginalCents: 10000,
    commissionableRevenueCents: 10000,
    commissionRateBps: 1000,
    commissionAmountCents: 3333,
    status: 'pending',
    eligibilityStatus: 'pending_manual_approval',
    source: 'gift_voucher_referral'
  });

  await GiftVoucherCreatorCommission.create({
    giftVoucherId: gvVoid._id,
    creatorPartnerId: c._id,
    referralCode: 'void.stat.ref',
    amountOriginalCents: 10000,
    commissionableRevenueCents: 8888,
    commissionRateBps: 1000,
    commissionAmountCents: 8888,
    status: 'voided',
    eligibilityStatus: 'pending_manual_approval',
    source: 'gift_voucher_referral'
  });

  const all = await buildAllCreatorPartnerStats();
  const row = all.find((r) => String(r.creatorPartnerId) === String(c._id));
  assert.ok(row);
  assert.equal(row.stats.giftVoucherCommissionCents, 3333);
});
