/**
 * Public whole-location quote + checkout.
 * Run: node --test server/scripts/locationQuoteService.test.cjs server/scripts/locationCheckoutService.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ManualReviewItem = require('../models/ManualReviewItem');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const { buildPublicLocationQuote } = require('../services/locationQuote/locationQuoteService');
const {
  createLocationCheckoutPaymentIntent,
  finalizeLocationCheckout
} = require('../services/locationCheckout/locationCheckoutService');
const { createLocationBlock } = require('../services/ops/domain/locationBlockService');
const { evaluateLocationConflicts } = require('../services/ops/domain/locationConflictService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const { canUseMongoTransactions } = require('../utils/mongoTransactions');
const emailService = require('../services/emailService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

let mongoServer;
let quoteApp;
let checkoutApp;
let originalSendEmail;
let transactionSupport;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function guestInfo(overrides = {}) {
  return {
    firstName: 'Test',
    lastName: 'Guest',
    email: `guest-${new mongoose.Types.ObjectId()}@example.com`,
    phone: '+359800000000',
    ...overrides
  };
}

async function createValleySingle({
  name,
  slug,
  pricePerNight,
  buyoutPricePerNight = null,
  capacity = 4,
  bedConfig = []
}) {
  return Cabin.create({
    name,
    slug,
    description: 'Valley test cabin',
    capacity,
    minGuests: 1,
    pricePerNight,
    buyoutPricePerNight,
    pricingModel: slug === 'stone-house' ? 'per_person' : 'per_night',
    minNights: 2,
    bedConfig,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
}

async function createValleyAFrames({ unitCount = 3 } = {}) {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${suffix}`,
    description: 'Test A-frame type',
    capacity: 2,
    pricePerNight: 60,
    buyoutPricePerNight: 60,
    pricingModel: 'per_night',
    minNights: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });

  const parentCabin = await Cabin.create({
    name: `A-Frame Parent ${suffix}`,
    description: 'Multi parent',
    capacity: 2,
    pricePerNight: 60,
    minNights: 2,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    isActive: true,
    transportOptions: []
  });

  const units = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      await Unit.create({
        cabinTypeId: cabinType._id,
        unitNumber: `AF-${String(i).padStart(2, '0')}`,
        displayName: `A-Frame ${i}`,
        isActive: true
      })
    );
  }

  return { cabinType, parentCabin, units };
}

async function createFullValleyInventory(opts = {}) {
  const stone = await createValleySingle({
    name: 'Stone House',
    slug: 'stone-house',
    pricePerNight: 25,
    buyoutPricePerNight: 180,
    capacity: 6,
    bedConfig: [
      { bedType: 'double', count: 2 },
      { bedType: 'single', count: 2 }
    ]
  });
  const lux = await createValleySingle({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    pricePerNight: 85,
    buyoutPricePerNight: 85,
    capacity: 2,
    bedConfig: [{ bedType: 'double', count: 1 }]
  });
  const aframes = await createValleyAFrames(opts);
  return { stone, lux, aframes };
}

async function createBooking(overrides = {}) {
  const checkIn = overrides.checkIn || moment.tz(PROPERTY_TIMEZONE).startOf('day').add(10, 'days').toDate();
  const checkOut = overrides.checkOut || moment.tz(PROPERTY_TIMEZONE).startOf('day').add(14, 'days').toDate();
  return Booking.create({
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: guestInfo({ firstName: 'Secret', lastName: 'Guest', email: 'secret@example.com' }),
    totalPrice: 300,
    checkIn,
    checkOut,
    ...overrides
  });
}

async function createBlock({ cabinId, unitId = null, blockType = 'manual_block', checkIn, checkOut, metadata = {} }) {
  const { startDate, endDate } = normalizeGuestStayRange(checkIn, checkOut);
  return AvailabilityBlock.create({
    cabinId,
    unitId,
    blockType,
    startDate,
    endDate,
    status: 'active',
    source: 'internal_admin',
    metadata
  });
}

function quoteBody(overrides = {}) {
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  return {
    checkIn,
    checkOut,
    adults: 12,
    children: 0,
    ...overrides
  };
}

function mockStripe(amountCents) {
  const store = new Map();
  return {
  paymentIntents: {
    async create({ amount, metadata }) {
      const id = `pi_test_${new mongoose.Types.ObjectId()}`;
      const pi = {
        id,
        amount,
        currency: 'eur',
        status: 'requires_payment_method',
        client_secret: `${id}_secret`,
        metadata
      };
      store.set(id, pi);
      return pi;
    },
    async retrieve(id) {
      const pi = store.get(id);
      if (!pi) throw new Error('not found');
      return pi;
    },
    async update(id, patch) {
      const pi = store.get(id);
      Object.assign(pi, patch);
      if (patch.status) pi.status = patch.status;
      return pi;
    }
  },
  markSucceeded(id) {
    const pi = store.get(id);
    if (pi) pi.status = 'succeeded';
  }
};
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  transactionSupport = await canUseMongoTransactions();

  originalSendEmail = emailService.sendEmail;
  emailService.sendEmail = async () => ({ success: true, method: 'test' });

  quoteApp = express();
  quoteApp.use(express.json());
  quoteApp.use('/api/public', require('../routes/publicLocationQuoteRoutes'));

  checkoutApp = express();
  checkoutApp.use(express.json());
  checkoutApp.use('/api/public', require('../routes/publicLocationCheckoutRoutes'));
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    LocationBooking.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    PaymentResolutionIssue.deleteMany({})
  ]);
});

test('flat buyout quote sums all targets; guest count does not affect price', async () => {
  await createFullValleyInventory({ unitCount: 2 });
  const quote12 = await buildPublicLocationQuote('valley', quoteBody({ adults: 12 }));
  const quote4 = await buildPublicLocationQuote('valley', quoteBody({ adults: 4 }));

  assert.equal(quote12.available, true);
  assert.equal(quote12.totalPrice, quote4.totalPrice);
  assert.equal(quote12.nights, 4);
  assert.equal(quote12.totalPrice, 1540);

  const stone = quote12.includedTargets.find((row) => row.slug === 'stone-house');
  assert.equal(stone.pricingModel, 'flat_buyout');
  assert.equal(stone.buyoutRatePerNight, 180);
  assert.equal(stone.lodgingSubtotal, 720);
  assert.equal(quote12.stoneHousePricingPending, undefined);
});

test('roomAllocation is echoed but does not change totalPrice', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const allocation = {
    notes: 'Couples in A-frames, families in Stone House',
    assignments: [{ accommodationName: 'Stone House', plannedGuests: 6 }]
  };
  const quote = await buildPublicLocationQuote('valley', quoteBody({ roomAllocation: allocation }));
  assert.equal(quote.roomAllocation.notes, allocation.notes);
  assert.equal(quote.roomAllocation.assignments[0].accommodationName, 'Stone House');
  assert.equal(quote.totalPrice, 1300);
});

test('checkout_hold blocks concurrent quote when not excluded', async () => {
  const { lux } = await createFullValleyInventory({ unitCount: 1 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  const { startDate, endDate } = normalizeGuestStayRange(checkIn, checkOut);

  await AvailabilityBlock.create({
    cabinId: lux._id,
    blockType: 'checkout_hold',
    startDate,
    endDate,
    status: 'active',
    source: 'location_checkout',
    checkoutSessionId: 'other-session',
    expiresAt: new Date(Date.now() + 60_000),
    sourceReference: 'other-session'
  });

  const evaluation = await evaluateLocationConflicts('valley', startDate, endDate);
  assert.equal(evaluation.canBlock, false);

  const excluded = await evaluateLocationConflicts('valley', startDate, endDate, {
    excludeCheckoutSessionId: 'other-session'
  });
  assert.equal(excluded.canBlock, true);
});

test('create-payment-intent creates holds and returns client secret', async () => {
  await createFullValleyInventory({ unitCount: 2 });
  const stripe = mockStripe();
  const result = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });

  assert.ok(result.checkoutSessionId);
  assert.ok(result.clientSecret);
  assert.equal(result.quote.available, true);
  assert.equal(result.quote.totalPrice, 1540);

  const holds = await AvailabilityBlock.find({
    checkoutSessionId: result.checkoutSessionId,
    blockType: 'checkout_hold',
    status: 'active'
  });
  assert.equal(holds.length, 4);
});

test('finalize creates master + child bookings and suppresses child revenue flags', async () => {
  await createFullValleyInventory({ unitCount: 2 });
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  const result = await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guestInfo(),
      roomAllocation: {
        notes: 'Stone House for main group',
        assignments: [{ accommodationName: 'Stone House', plannedGuests: 6 }]
      }
    },
    { stripe }
  );

  assert.equal(result.childBookingIds.length, 4);
  const master = await LocationBooking.findById(result.locationBookingId);
  assert.equal(master.status, 'confirmed');
  assert.equal(master.totalPrice, 1540);
  assert.ok(master.confirmationEmailSentAt);
  assert.equal(master.childBookingIds.length, 4);

  const children = await Booking.find({ locationBookingId: master._id });
  assert.equal(children.length, 4);
  for (const child of children) {
    assert.equal(child.suppressGuestEmail, true);
    assert.equal(child.excludeFromRevenueReporting, true);
    assert.ok(child.childPriceShare > 0);
    if (child.cabinTypeId) assert.ok(child.unitId);
  }

  const unitIds = children.filter((b) => b.unitId).map((b) => String(b.unitId));
  assert.equal(new Set(unitIds).size, 2);
});

test('paid finalize failure opens manual review and keeps holds', async () => {
  const { lux } = await createFullValleyInventory({ unitCount: 1 });
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinId: lux._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  await assert.rejects(
    () =>
      finalizeLocationCheckout(
        {
          checkoutSessionId: created.checkoutSessionId,
          paymentIntentId: created.paymentIntentId,
          adults: 12,
          children: 0,
          guestInfo: guestInfo()
        },
        { stripe }
      ),
    /no longer available|not available/i
  );

  const reviewItems = await ManualReviewItem.find({ category: 'payment_finalization_failure' });
  assert.equal(reviewItems.length, 1);
  const issues = await PaymentResolutionIssue.find({ paymentIntentId: created.paymentIntentId });
  assert.equal(issues.length, 1);

  const holds = await AvailabilityBlock.countDocuments({
    checkoutSessionId: created.checkoutSessionId,
    blockType: 'checkout_hold',
    status: 'active'
  });
  assert.ok(holds > 0);
});

test('POST /api/public/location-quotes/the-valley', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const res = await request(quoteApp)
    .post('/api/public/location-quotes/the-valley')
    .send(quoteBody());
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, true);
  assert.ok(Array.isArray(res.body.data.includedTargets));
});

test('one A-frame unit booked → unavailable', async () => {
  const { aframes } = await createFullValleyInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinTypeId: aframes.cabinType._id,
    unitId: aframes.units[0]._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
  assert.ok(quote.includedTargets.length >= 1);
});

test('pooled A-frame booking without unitId → unavailable', async () => {
  const { aframes } = await createFullValleyInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinTypeId: aframes.cabinType._id,
    unitId: null,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
});

test('location-wide OPS manual block → unavailable', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const checkIn = sofiaDateOnly(20);
  const checkOut = sofiaDateOnly(24);
  await createLocationBlock({
    locationKey: 'valley',
    startDate: checkIn,
    endDate: checkOut,
    reason: 'Private retreat hold',
    ctx: { user: { role: 'admin' } }
  });
  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
});

test('reports mongo transaction support', async () => {
  console.log(`[location-checkout-test] canUseMongoTransactions=${transactionSupport}`);
  assert.equal(typeof transactionSupport, 'boolean');
});

test('I2: finalize creates UnitNightClaims for each allocated unit child', async () => {
  const UnitNightClaim = require('../models/UnitNightClaim');
  await UnitNightClaim.deleteMany({});
  await createFullValleyInventory({ unitCount: 2 });
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  const result = await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guestInfo()
    },
    { stripe }
  );

  assert.equal(result.idempotentReplay, false);
  const children = await Booking.find({ _id: { $in: result.childBookingIds } });
  const unitChildren = children.filter((c) => c.cabinTypeId && c.unitId);
  assert.ok(unitChildren.length >= 2);
  for (const child of unitChildren) {
    const claims = await UnitNightClaim.find({ bookingId: child._id }).lean();
    assert.ok(claims.length >= 1, `expected claims for child ${child._id}`);
    assert.ok(claims.every((c) => c.source === 'location_child'));
  }
  const singleChildren = children.filter((c) => c.cabinId && !c.unitId);
  for (const child of singleChildren) {
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: child._id }), 0);
  }
});

test('I2: one child shadow failure is nonfatal; other unit children still claim', async () => {
  const UnitNightClaim = require('../models/UnitNightClaim');
  const ManualReviewItem = require('../models/ManualReviewItem');
  const {
    SHADOW_OUTCOMES,
    MRI_CATEGORY
  } = require('../services/inventory/ensureUnitNightClaimsShadow');
  const realEnsure = require('../services/inventory/ensureUnitNightClaimsShadow')
    .ensureUnitNightClaimsShadow;

  await UnitNightClaim.deleteMany({});
  await createFullValleyInventory({ unitCount: 2 });
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  let failOnceUnitId = null;
  const ensureFn = async (args) => {
    const unitId = args.booking?.unitId ? String(args.booking.unitId) : null;
    if (unitId && !failOnceUnitId) failOnceUnitId = unitId;
    if (unitId && failOnceUnitId && unitId === failOnceUnitId) {
      return realEnsure({
        ...args,
        claimUnitNightsFn: async () => {
          throw Object.assign(new Error('forced location child claim fail'), {
            code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE'
          });
        }
      });
    }
    return realEnsure(args);
  };

  const result = await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guestInfo()
    },
    { stripe, ensureUnitNightClaimsShadowFn: ensureFn }
  );

  assert.ok(result.locationBookingId);
  const master = await LocationBooking.findById(result.locationBookingId);
  assert.equal(master.status, 'confirmed');
  const children = await Booking.find({ _id: { $in: result.childBookingIds } });
  assert.equal(children.length, result.childBookingIds.length);

  const unitChildren = children.filter((c) => c.unitId);
  assert.ok(unitChildren.length >= 2);
  const failedChild = unitChildren.find((c) => String(c.unitId) === failOnceUnitId);
  const okChild = unitChildren.find((c) => String(c.unitId) !== failOnceUnitId);
  assert.ok(failedChild);
  assert.ok(okChild);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: failedChild._id }), 0);
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: okChild._id })) >= 1);
  assert.ok(
    (await ManualReviewItem.countDocuments({
      category: MRI_CATEGORY,
      entityId: String(failedChild._id),
      status: 'open'
    })) >= 1
  );
  void SHADOW_OUTCOMES;
});

test('I2: location replay repairs missing child claims', async () => {
  const UnitNightClaim = require('../models/UnitNightClaim');
  await UnitNightClaim.deleteMany({});
  await createFullValleyInventory({ unitCount: 2 });
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);
  const guest = guestInfo();

  const first = await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guest
    },
    { stripe }
  );
  assert.equal(first.idempotentReplay, false);

  const unitChildIds = (
    await Booking.find({
      _id: { $in: first.childBookingIds },
      unitId: { $ne: null }
    }).select('_id')
  ).map((b) => b._id);
  assert.ok(unitChildIds.length >= 1);
  await UnitNightClaim.deleteMany({ bookingId: { $in: unitChildIds } });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: { $in: unitChildIds } }), 0);

  const replay = await finalizeLocationCheckout(
    {
      checkoutSessionId: created.checkoutSessionId,
      paymentIntentId: created.paymentIntentId,
      adults: 12,
      children: 0,
      guestInfo: guest
    },
    { stripe }
  );
  assert.equal(replay.idempotentReplay, true);
  for (const id of unitChildIds) {
    assert.ok((await UnitNightClaim.countDocuments({ bookingId: id })) >= 1);
  }
});

test('I2: canonical location finalize failure before success leaves zero claims', async () => {
  const UnitNightClaim = require('../models/UnitNightClaim');
  await UnitNightClaim.deleteMany({});
  const { lux } = await createFullValleyInventory({ unitCount: 1 });
  const stripe = mockStripe();
  const created = await createLocationCheckoutPaymentIntent(quoteBody(), { stripe });
  stripe.markSucceeded(created.paymentIntentId);

  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinId: lux._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  await assert.rejects(
    () =>
      finalizeLocationCheckout(
        {
          checkoutSessionId: created.checkoutSessionId,
          paymentIntentId: created.paymentIntentId,
          adults: 12,
          children: 0,
          guestInfo: guestInfo(),
          checkIn,
          checkOut
        },
        { stripe }
      ),
    /no longer available|not available/i
  );

  assert.equal(await UnitNightClaim.countDocuments({}), 0);
});
