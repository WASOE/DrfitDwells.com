const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CreatorPartner = require('../models/CreatorPartner');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const CreatorCommission = require('../models/CreatorCommission');
const {
  buildCreatorAttributionMaps,
  resolveBookingCreatorAttribution
} = require('../services/creators/creatorAttributionResolver');
const { buildAllCreatorPartnerStats } = require('../services/ops/creatorPartnerStatsService');
const { recalculateCreatorCommissionForPartner } = require('../services/ops/creatorCommissionLedgerService');

let mongoServer;

function uniq(s = 'x') {
  return `${s}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
}

function nextDates() {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 14);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  return { checkIn, checkOut };
}

async function createCabin() {
  return Cabin.create({
    name: `Cabin ${uniq('c')}`,
    description: 'Test cabin',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CreatorPartner.syncIndexes();
  await Booking.syncIndexes();
  await Cabin.syncIndexes();
  await PaymentResolutionIssue.syncIndexes();
  await CreatorCommission.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CreatorCommission.deleteMany({});
  await PaymentResolutionIssue.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await CreatorPartner.deleteMany({});
});

test('resolver maps include archived, exclude draft, and promo beats referral', async () => {
  const active = await CreatorPartner.create({
    name: 'Active',
    slug: uniq('active'),
    status: 'active',
    referral: { code: 'creator.active', cookieDays: 60 },
    promo: { code: 'PROMOACTIVE' }
  });
  const archived = await CreatorPartner.create({
    name: 'Archived',
    slug: uniq('arch'),
    status: 'archived',
    referral: { code: 'creator.archived', cookieDays: 60 },
    promo: { code: 'PROMOARCH' }
  });
  await CreatorPartner.create({
    name: 'Draft',
    slug: uniq('draft'),
    status: 'draft',
    referral: { code: 'creator.draft', cookieDays: 60 },
    promo: { code: 'PROMODRAFT' }
  });

  const maps = buildCreatorAttributionMaps(
    await CreatorPartner.find({}).select('_id status referral promo').lean()
  );

  assert.equal(maps.referralToCreatorId.has('creator.active'), true);
  assert.equal(maps.referralToCreatorId.has('creator.archived'), true);
  assert.equal(maps.referralToCreatorId.has('creator.draft'), false);
  assert.equal(maps.promoToCreatorId.has('PROMOARCH'), true);
  assert.equal(maps.promoToCreatorId.has('PROMODRAFT'), false);

  const resolved = resolveBookingCreatorAttribution(
    { promoCode: 'PROMOACTIVE', attribution: { referralCode: 'creator.archived' } },
    maps
  );
  assert.equal(resolved.creatorPartnerId, String(active._id));
  assert.equal(resolved.source, 'creator_promo');
  assert.equal(String(archived._id) !== resolved.creatorPartnerId, true);
});

test('stats separate attributed value from paid stay revenue and exclude needs_review from paid metrics', async () => {
  const creator = await CreatorPartner.create({
    name: 'Stats Creator',
    slug: uniq('stats'),
    status: 'active',
    referral: { code: 'stats.ref', cookieDays: 60 },
    promo: { code: 'STATSPROMO' }
  });
  const cabin = await createCabin();
  const { checkIn, checkOut } = nextDates();

  const bookingNeedsReview = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'ab@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 100,
    subtotalPrice: 100,
    discountAmount: 0,
    totalValueCents: 10000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 10000,
    stripePaymentIntentId: 'pi_review',
    promoCode: 'STATSPROMO'
  });

  await PaymentResolutionIssue.create({
    paymentIntentId: 'pi_review',
    issueType: 'paid_booking_save_failed',
    status: 'needs_review',
    metadata: { bookingId: String(bookingNeedsReview._id) }
  });

  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'C', lastName: 'D', email: 'cd@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 120,
    subtotalPrice: 120,
    discountAmount: 0,
    totalValueCents: 12000,
    giftVoucherAppliedCents: 2000,
    stripePaidAmountCents: 10000,
    stripePaymentIntentId: 'pi_clean',
    promoCode: 'STATSPROMO'
  });

  const rows = await buildAllCreatorPartnerStats();
  const row = rows.find((r) => r.creatorPartnerId === String(creator._id));
  assert.ok(row);

  assert.equal(row.stats.attributedBookings, 2);
  assert.equal(row.stats.attributedBookingValue, 220);
  assert.equal(row.stats.paidConfirmedBookings, 1);
  assert.equal(row.stats.paidStayRevenue, 100);
});

test('ledger recalculation includes archived creator promo attribution', async () => {
  const creator = await CreatorPartner.create({
    name: 'Archived Creator',
    slug: uniq('arch-ledger'),
    status: 'archived',
    referral: { code: 'arch.ref', cookieDays: 60 },
    promo: { code: 'ARCHPROMO' },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  const cabin = await createCabin();
  const { checkIn, checkOut } = nextDates();
  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'E', lastName: 'F', email: 'ef@test.com', phone: '+3591' },
    status: 'confirmed',
    totalPrice: 80,
    subtotalPrice: 80,
    discountAmount: 0,
    totalValueCents: 8000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 8000,
    promoCode: 'ARCHPROMO',
    stripePaymentIntentId: 'pi_arch'
  });

  const out = await recalculateCreatorCommissionForPartner(
    await CreatorPartner.findById(creator._id).select('_id status referral promo commission').lean()
  );

  assert.equal(out.processed, 1);
  assert.equal(out.upserted, 1);
  const row = await CreatorCommission.findOne({ creatorPartnerId: creator._id }).lean();
  assert.ok(row);
  assert.equal(row.source, 'creator_promo');
});
